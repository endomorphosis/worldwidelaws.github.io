#!/usr/bin/env node
/**
 * Incremental ingestion of revision-pinned source artifacts.
 *
 * A change or removal builds a new immutable snapshot manifest, then replaces
 * current.json with rename. Readers of the pointer therefore see either the
 * previous complete snapshot or the next complete snapshot. Older snapshot
 * directories and content-addressed artifacts are left in place, so a snapshot
 * id that once verified keeps reading.
 *
 * An incompatible schema or a corrupt artifact is written under quarantine and
 * omitted from the manifest. It does not replace the source's last accepted
 * revision. One bad artifact does not roll back other accepted operations in
 * the same request; those operations publish together as one manifest.
 *
 * Records are stored as supplied. Required columns are id, title, and text.
 * They are not renamed, coerced, or invented. Extra record fields are kept.
 * This script does not fetch upstream bytes and does not rewrite the browser
 * catalog.
 */
import { createHash, randomBytes } from 'node:crypto';
import { open, mkdir, readFile, readdir, realpath, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { canonicalJson, sha256HexUtf8 } from '../../src/lib/worldwide/data/identity';

export const ARTIFACT_SCHEMA = 'worldwide-legal-search.ingestion-artifact@1';
export const MANIFEST_SCHEMA = 'worldwide-legal-search.ingestion-manifest@1';
export const CURRENT_SCHEMA = 'worldwide-legal-search.ingestion-current@1';
export const QUARANTINE_SCHEMA = 'worldwide-legal-search.ingestion-quarantine@1';
export const UPDATE_SCHEMA = 'worldwide-legal-search.incremental-update@1';
export const SCHEMA_VERSION = 1;
export const MAX_ARTIFACT_BYTES = 512 * 1024 * 1024;

const FLOATING_REVISIONS = new Set([
  'head',
  'main',
  'master',
  'latest',
  'trunk',
  'current',
  'floating',
  'unpinned',
  'none',
  'null',
  'undefined',
  'tip',
  'dev',
  'develop',
]);

const SHA256_HEX = /^[0-9a-f]{64}$/;
const ID_TEXT = /^\S(?:.*\S)?$/;

export class UpdateError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'UpdateError';
    this.code = code;
  }
}

export type QuarantineReason =
  | 'incompatible-schema'
  | 'corrupt-artifact'
  | 'missing-source-id'
  | 'missing-publisher-id'
  | 'missing-source-revision'
  | 'unpinned-source-revision'
  | 'invalid-source-revision'
  | 'invalid-source-id'
  | 'invalid-publisher-id'
  | 'revision-conflict'
  | 'stale-removal'
  | 'invalid-operation';

export interface QuarantineRecord {
  schema: typeof QUARANTINE_SCHEMA;
  schemaVersion: 1;
  quarantineId: string;
  reason: QuarantineReason;
  detail: string;
  operationIndex: number | null;
  sourceId: string | null;
  publisherId: string | null;
  sourceRevision: string | null;
  payloadSha256: string | null;
  rawSha256: string | null;
  poisonedCurrent: false;
}

export interface UpdateOperationRemove {
  op: 'remove';
  sourceId?: unknown;
  sourceRevision?: unknown;
}

export interface UpdateOperationUpsert {
  op: 'upsert';
  artifact?: unknown;
  raw?: unknown;
  bytes?: unknown;
}

export interface UpdateOperationUpsertFile {
  op: 'upsert-file';
  path?: unknown;
  artifact?: unknown;
  raw?: unknown;
  bytes?: unknown;
}

export type UpdateOperation = UpdateOperationRemove | UpdateOperationUpsert | UpdateOperationUpsertFile;

export interface UpdateRequest {
  asOf: string;
  operations: readonly UpdateOperation[];
}

export interface ManifestSource {
  sourceId: string;
  publisherId: string;
  sourceRevision: string;
  payloadSha256: string;
  recordCount: number;
  artifact: string;
}

export interface IngestionManifest {
  schema: typeof MANIFEST_SCHEMA;
  schemaVersion: 1;
  snapshotId: string;
  parentSnapshotId: string | null;
  asOf: string;
  sources: ManifestSource[];
  integrity: { sha256: string };
}

export interface PublishedSource extends ManifestSource {
  records: Array<Record<string, unknown>>;
}

export interface CurrentView {
  schema: typeof CURRENT_SCHEMA;
  schemaVersion: 1;
  snapshotId: string | null;
  manifestSha256: string | null;
  updatedAt: string | null;
  manifest: IngestionManifest | null;
  sources: PublishedSource[];
}

export interface SnapshotView {
  manifest: IngestionManifest;
  sources: PublishedSource[];
}

export interface AppliedChange {
  op: 'upsert' | 'remove';
  sourceId: string;
  sourceRevision: string;
  payloadSha256: string;
}

export interface SkippedChange {
  op: 'upsert' | 'remove';
  sourceId: string;
  sourceRevision: string;
  reason: 'already-current' | 'already-absent';
}

export interface UpdateResult {
  schema: typeof UPDATE_SCHEMA;
  changed: boolean;
  previousSnapshotId: string | null;
  snapshotId: string | null;
  manifestSha256: string | null;
  applied: AppliedChange[];
  skipped: SkippedChange[];
  quarantined: QuarantineRecord[];
}

export interface PublishBarrier {
  previousSnapshotId: string | null;
  nextSnapshotId: string;
  nextManifest: IngestionManifest;
}

export interface ApplyOptions {
  beforeSnapshotPublish?: (state: PublishBarrier) => void | Promise<void>;
  beforeCurrentPublish?: (state: PublishBarrier) => void | Promise<void>;
}

interface StagedSource extends PublishedSource {
  needsWrite: boolean;
  envelope: string;
}

interface QuarantineDraft {
  reason: QuarantineReason;
  detail: string;
  operationIndex: number | null;
  sourceId: string | null;
  publisherId: string | null;
  sourceRevision: string | null;
  payloadSha256: string | null;
  rawSha256: string | null;
}

interface ReadyStore {
  kind: 'ready';
  pointer: { snapshotId: string; manifestSha256: string; updatedAt: string };
  manifest: IngestionManifest;
  sources: Map<string, StagedSource>;
}

interface EmptyStore {
  kind: 'empty';
}

interface CorruptStore {
  kind: 'corrupt';
  code: 'corrupt-current' | 'corrupt-snapshot';
  detail: string;
  raw: Buffer;
}

type LoadedStore = ReadyStore | EmptyStore | CorruptStore;

function errnoCode(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('code' in error)) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

function sha256Buffer(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clampDetail(detail: string): string {
  const text = detail.trim();
  return text.length > 500 ? `${text.slice(0, 497)}...` : text;
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, path.resolve(target));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function assertInside(root: string, target: string): void {
  if (!isInside(root, target)) throw new UpdateError('outside-store', 'refusing to write outside the ingestion store');
}

function emptyView(): CurrentView {
  return {
    schema: CURRENT_SCHEMA,
    schemaVersion: 1,
    snapshotId: null,
    manifestSha256: null,
    updatedAt: null,
    manifest: null,
    sources: [],
  };
}

function validAsOf(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function assertRequest(request: UpdateRequest): void {
  if (!isPlainObject(request)) throw new UpdateError('invalid-request', 'update request must be an object');
  if (typeof request.asOf !== 'string' || !validAsOf(request.asOf)) {
    throw new UpdateError('invalid-request', 'asOf must be a real UTC timestamp');
  }
  if (!Array.isArray(request.operations)) throw new UpdateError('invalid-request', 'operations must be an array');
}

function bySourceId(left: { sourceId: string }, right: { sourceId: string }): number {
  if (left.sourceId < right.sourceId) return -1;
  if (left.sourceId > right.sourceId) return 1;
  return 0;
}

function artifactRelative(payloadSha256: string): string {
  return `artifacts/${payloadSha256}.json`;
}

function snapshotIdentity(parentSnapshotId: string | null, asOf: string, sources: readonly ManifestSource[]): Record<string, unknown> {
  return {
    schema: MANIFEST_SCHEMA,
    schemaVersion: SCHEMA_VERSION,
    parentSnapshotId,
    asOf,
    sources: [...sources].sort(bySourceId).map((source) => ({
      sourceId: source.sourceId,
      publisherId: source.publisherId,
      sourceRevision: source.sourceRevision,
      payloadSha256: source.payloadSha256,
      recordCount: source.recordCount,
    })),
  };
}

function manifestBody(snapshotId: string, parentSnapshotId: string | null, asOf: string, sources: readonly ManifestSource[]): Omit<IngestionManifest, 'integrity'> {
  return {
    schema: MANIFEST_SCHEMA,
    schemaVersion: SCHEMA_VERSION,
    snapshotId,
    parentSnapshotId,
    asOf,
    sources: [...sources].sort(bySourceId),
  };
}

function buildManifest(parentSnapshotId: string | null, asOf: string, sources: readonly ManifestSource[]): IngestionManifest {
  const sorted = [...sources].sort(bySourceId);
  const snapshotId = sha256HexUtf8(canonicalJson(snapshotIdentity(parentSnapshotId, asOf, sorted)));
  const body = manifestBody(snapshotId, parentSnapshotId, asOf, sorted);
  return {
    ...body,
    integrity: { sha256: sha256HexUtf8(canonicalJson(body)) },
  };
}

function quarantineRecord(draft: QuarantineDraft): QuarantineRecord {
  const body = {
    schema: QUARANTINE_SCHEMA,
    schemaVersion: SCHEMA_VERSION as 1,
    reason: draft.reason,
    detail: clampDetail(draft.detail),
    operationIndex: draft.operationIndex,
    sourceId: draft.sourceId,
    publisherId: draft.publisherId,
    sourceRevision: draft.sourceRevision,
    payloadSha256: draft.payloadSha256,
    rawSha256: draft.rawSha256,
    poisonedCurrent: false as const,
  };
  return {
    ...body,
    quarantineId: sha256HexUtf8(canonicalJson(body)),
  };
}

function draft(partial: Omit<QuarantineDraft, 'publisherId' | 'payloadSha256' | 'rawSha256'> & Partial<QuarantineDraft>): QuarantineDraft {
  return {
    publisherId: null,
    payloadSha256: null,
    rawSha256: null,
    ...partial,
    detail: clampDetail(partial.detail),
  };
}

function peekString(value: unknown, key: string): string | null {
  if (!isPlainObject(value)) return null;
  const item = value[key];
  if (typeof item !== 'string') return null;
  const trimmed = item.trim();
  return trimmed ? trimmed : null;
}

function idProblem(value: string | null, missing: QuarantineReason, invalid: QuarantineReason): QuarantineReason | null {
  if (!value) return missing;
  if (
    value.length > 200
    || value.includes('..')
    || value.includes('\\')
    || value.includes('//')
    || value.startsWith('/')
    || !/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/.test(value)
  ) {
    return invalid;
  }
  return null;
}

function revisionProblem(value: string | null): QuarantineReason | null {
  if (!value) return 'missing-source-revision';
  const folded = value.toLowerCase();
  if (FLOATING_REVISIONS.has(folded) || /(?:^|\/)(?:head|main|master|latest)$/i.test(value) || /^refs\//i.test(value)) {
    return 'unpinned-source-revision';
  }
  if (/^[A-Fa-f0-9]{40}$/.test(value) || /^[A-Fa-f0-9]{64}$/.test(value)) return null;
  if (/^[A-Za-z0-9._:+/-]{12,128}$/.test(value)) return null;
  return 'invalid-source-revision';
}

function canonicalRevision(value: string): string {
  if (/^[A-Fa-f0-9]{40}$/.test(value) || /^[A-Fa-f0-9]{64}$/.test(value)) return value.toLowerCase();
  return value;
}

function identityDraft(value: unknown, index: number | null, reason: QuarantineReason, detail: string, rawSha256: string | null): QuarantineDraft {
  const sourceRevision = peekString(value, 'sourceRevision');
  const payload = peekString(value, 'payloadSha256');
  return draft({
    reason,
    detail,
    operationIndex: index,
    sourceId: peekString(value, 'sourceId'),
    publisherId: peekString(value, 'publisherId'),
    sourceRevision,
    payloadSha256: payload && SHA256_HEX.test(payload.toLowerCase()) ? payload.toLowerCase() : null,
    rawSha256,
  });
}

function classifyValue(value: unknown, rawSha256: string | null, operationIndex: number): { ok: true; source: StagedSource } | { ok: false; quarantine: QuarantineDraft } {
  if (!isPlainObject(value)) {
    return { ok: false, quarantine: identityDraft(value, operationIndex, 'corrupt-artifact', 'artifact JSON must be an object', rawSha256) };
  }
  if (value.schema !== ARTIFACT_SCHEMA || value.schemaVersion !== SCHEMA_VERSION) {
    const observedSchema = typeof value.schema === 'string' ? value.schema.slice(0, 120) : 'absent';
    const observedVersion = typeof value.schemaVersion === 'number' || typeof value.schemaVersion === 'string'
      ? String(value.schemaVersion).slice(0, 40)
      : 'absent';
    return {
      ok: false,
      quarantine: identityDraft(
        value,
        operationIndex,
        'incompatible-schema',
        `incompatible artifact schema ${observedSchema} version ${observedVersion}`,
        rawSha256,
      ),
    };
  }
  const declaredHash = typeof value.payloadSha256 === 'string' ? value.payloadSha256.trim().toLowerCase() : '';
  if (!SHA256_HEX.test(declaredHash)) {
    return {
      ok: false,
      quarantine: identityDraft(value, operationIndex, 'corrupt-artifact', 'payloadSha256 is missing or is not a sha256 hex digest', rawSha256),
    };
  }
  if (!Array.isArray(value.records)) {
    return {
      ok: false,
      quarantine: identityDraft(value, operationIndex, 'incompatible-schema', 'records must be an array of objects with id, title, and text', rawSha256),
    };
  }
  let normalized: unknown;
  try {
    normalized = JSON.parse(JSON.stringify(value.records)) as unknown;
  } catch {
    return { ok: false, quarantine: identityDraft(value, operationIndex, 'corrupt-artifact', 'records are not JSON', rawSha256) };
  }
  if (!Array.isArray(normalized)) {
    return {
      ok: false,
      quarantine: identityDraft(value, operationIndex, 'incompatible-schema', 'records must be an array of objects with id, title, and text', rawSha256),
    };
  }
  let digest = '';
  try {
    digest = sha256HexUtf8(canonicalJson(normalized));
  } catch {
    return { ok: false, quarantine: identityDraft(value, operationIndex, 'corrupt-artifact', 'records are not canonical JSON', rawSha256) };
  }
  if (digest !== declaredHash) {
    return {
      ok: false,
      quarantine: identityDraft(value, operationIndex, 'corrupt-artifact', 'payloadSha256 does not match the records', rawSha256),
    };
  }
  const sourceId = peekString(value, 'sourceId');
  const sourceProblem = idProblem(sourceId, 'missing-source-id', 'invalid-source-id');
  if (sourceProblem) {
    return { ok: false, quarantine: identityDraft(value, operationIndex, sourceProblem, 'source id cannot be pinned', rawSha256) };
  }
  const publisherId = peekString(value, 'publisherId');
  const publisherProblem = idProblem(publisherId, 'missing-publisher-id', 'invalid-publisher-id');
  if (publisherProblem) {
    return { ok: false, quarantine: identityDraft(value, operationIndex, publisherProblem, 'publisher id cannot be pinned', rawSha256) };
  }
  const revisionText = peekString(value, 'sourceRevision');
  const revisionIssue = revisionProblem(revisionText);
  if (revisionIssue) {
    return {
      ok: false,
      quarantine: identityDraft(value, operationIndex, revisionIssue, 'source revision cannot be pinned', rawSha256),
    };
  }
  const sourceRevision = canonicalRevision(revisionText as string);
  const seen = new Set<string>();
  const records: Array<Record<string, unknown>> = [];
  for (const item of normalized) {
    if (!isPlainObject(item)) {
      return {
        ok: false,
        quarantine: identityDraft(value, operationIndex, 'incompatible-schema', 'a record is not an object', rawSha256),
      };
    }
    const id = item.id;
    const title = item.title;
    const text = item.text;
    if (typeof id !== 'string' || !ID_TEXT.test(id) || typeof title !== 'string' || typeof text !== 'string') {
      return {
        ok: false,
        quarantine: identityDraft(
          value,
          operationIndex,
          'incompatible-schema',
          'a record is missing string id, title, or text; columns were not renamed or invented',
          rawSha256,
        ),
      };
    }
    if (seen.has(id)) {
      return {
        ok: false,
        quarantine: identityDraft(value, operationIndex, 'incompatible-schema', 'a record id is duplicated inside the artifact', rawSha256),
      };
    }
    seen.add(id);
    records.push(item);
  }
  const payloadSha256 = digest;
  const envelopeObject = {
    schema: ARTIFACT_SCHEMA,
    schemaVersion: SCHEMA_VERSION,
    sourceId,
    publisherId,
    sourceRevision,
    payloadSha256,
    records,
  };
  return {
    ok: true,
    source: {
      sourceId: sourceId as string,
      publisherId: publisherId as string,
      sourceRevision,
      payloadSha256,
      recordCount: records.length,
      artifact: artifactRelative(payloadSha256),
      records,
      needsWrite: true,
      envelope: `${canonicalJson(envelopeObject)}\n`,
    },
  };
}

function classifyBytes(bytes: Buffer, operationIndex: number): { ok: true; source: StagedSource } | { ok: false; quarantine: QuarantineDraft } {
  const rawSha256 = sha256Buffer(bytes);
  if (bytes.length === 0) {
    return { ok: false, quarantine: draft({ reason: 'corrupt-artifact', detail: 'artifact is empty', operationIndex, sourceId: null, sourceRevision: null, rawSha256 }) };
  }
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return {
      ok: false,
      quarantine: draft({ reason: 'corrupt-artifact', detail: 'artifact has a byte order mark', operationIndex, sourceId: null, sourceRevision: null, rawSha256 }),
    };
  }
  if (bytes.length > MAX_ARTIFACT_BYTES) {
    return {
      ok: false,
      quarantine: draft({
        reason: 'corrupt-artifact',
        detail: `artifact exceeds ${MAX_ARTIFACT_BYTES} bytes`,
        operationIndex,
        sourceId: null,
        sourceRevision: null,
        rawSha256,
      }),
    };
  }
  const text = bytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(bytes)) {
    return {
      ok: false,
      quarantine: draft({ reason: 'corrupt-artifact', detail: 'artifact is not valid UTF-8', operationIndex, sourceId: null, sourceRevision: null, rawSha256 }),
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return {
      ok: false,
      quarantine: draft({ reason: 'corrupt-artifact', detail: 'artifact is not valid JSON', operationIndex, sourceId: null, sourceRevision: null, rawSha256 }),
    };
  }
  return classifyValue(parsed, rawSha256, operationIndex);
}

async function classifyUpsert(op: UpdateOperation, operationIndex: number): Promise<{ ok: true; source: StagedSource } | { ok: false; quarantine: QuarantineDraft }> {
  if (!isPlainObject(op) || (op.op !== 'upsert' && op.op !== 'upsert-file')) {
    return { ok: false, quarantine: draft({ reason: 'invalid-operation', detail: 'operation is not an upsert', operationIndex, sourceId: null, sourceRevision: null }) };
  }
  const hasArtifact = Object.prototype.hasOwnProperty.call(op, 'artifact');
  const hasRaw = Object.prototype.hasOwnProperty.call(op, 'raw');
  const hasBytes = Object.prototype.hasOwnProperty.call(op, 'bytes');
  if (op.op === 'upsert-file') {
    if (hasArtifact || hasRaw || hasBytes || typeof op.path !== 'string' || !op.path.trim()) {
      return { ok: false, quarantine: draft({ reason: 'invalid-operation', detail: 'upsert-file needs one readable path', operationIndex, sourceId: null, sourceRevision: null }) };
    }
    try {
      const info = await stat(op.path);
      if (!info.isFile()) {
        return { ok: false, quarantine: draft({ reason: 'corrupt-artifact', detail: 'artifact file is not a file', operationIndex, sourceId: null, sourceRevision: null }) };
      }
      if (info.size > MAX_ARTIFACT_BYTES) {
        return {
          ok: false,
          quarantine: draft({
            reason: 'corrupt-artifact',
            detail: `artifact exceeds ${MAX_ARTIFACT_BYTES} bytes`,
            operationIndex,
            sourceId: null,
            sourceRevision: null,
          }),
        };
      }
      return classifyBytes(await readFile(op.path), operationIndex);
    } catch (error) {
      if (error instanceof UpdateError) throw error;
      return { ok: false, quarantine: draft({ reason: 'corrupt-artifact', detail: 'artifact file is not readable', operationIndex, sourceId: null, sourceRevision: null }) };
    }
  }
  const modes = [hasArtifact, hasRaw, hasBytes].filter(Boolean).length;
  if (modes !== 1) {
    return { ok: false, quarantine: draft({ reason: 'invalid-operation', detail: 'upsert needs exactly one of artifact, raw, or bytes', operationIndex, sourceId: null, sourceRevision: null }) };
  }
  if (hasBytes) {
    if (!(op.bytes instanceof Uint8Array)) {
      return { ok: false, quarantine: draft({ reason: 'invalid-operation', detail: 'upsert bytes must be a byte array', operationIndex, sourceId: null, sourceRevision: null }) };
    }
    return classifyBytes(Buffer.from(op.bytes), operationIndex);
  }
  if (hasRaw) {
    if (typeof op.raw !== 'string') {
      return { ok: false, quarantine: draft({ reason: 'invalid-operation', detail: 'upsert raw must be a string', operationIndex, sourceId: null, sourceRevision: null }) };
    }
    return classifyBytes(Buffer.from(op.raw, 'utf8'), operationIndex);
  }
  let rawSha256: string | null = null;
  try {
    rawSha256 = sha256HexUtf8(canonicalJson(op.artifact));
  } catch {
    rawSha256 = null;
  }
  return classifyValue(op.artifact, rawSha256, operationIndex);
}

function classifyRemove(op: UpdateOperation, operationIndex: number): { ok: true; sourceId: string; sourceRevision: string } | { ok: false; quarantine: QuarantineDraft } {
  if (!isPlainObject(op)) {
    return { ok: false, quarantine: draft({ reason: 'invalid-operation', detail: 'operation is not an object', operationIndex, sourceId: null, sourceRevision: null }) };
  }
  const sourceId = peekString(op, 'sourceId');
  const sourceProblem = idProblem(sourceId, 'missing-source-id', 'invalid-source-id');
  if (sourceProblem) {
    return { ok: false, quarantine: draft({ reason: sourceProblem, detail: 'removal source id cannot be pinned', operationIndex, sourceId, sourceRevision: peekString(op, 'sourceRevision') }) };
  }
  const revisionText = peekString(op, 'sourceRevision');
  const revisionIssue = revisionProblem(revisionText);
  if (revisionIssue) {
    return {
      ok: false,
      quarantine: draft({ reason: revisionIssue, detail: 'removal revision cannot be pinned', operationIndex, sourceId, sourceRevision: revisionText }),
    };
  }
  return { ok: true, sourceId: sourceId as string, sourceRevision: canonicalRevision(revisionText as string) };
}

async function bestEffortSyncDir(dir: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(dir, 'r');
    await handle.sync();
  } catch {
    // Directory fsync is best-effort. File fsync plus rename is the publish barrier.
  } finally {
    if (handle) await handle.close();
  }
}

async function atomicWrite(root: string, target: string, data: string | Buffer): Promise<void> {
  const parent = path.dirname(target);
  await mkdir(parent, { recursive: true });
  const realParent = await realpath(parent);
  assertInside(root, realParent);
  const finalTarget = path.join(realParent, path.basename(target));
  assertInside(root, finalTarget);
  const temporary = path.join(realParent, `.${path.basename(target)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
  const handle = await open(temporary, 'w', 0o644);
  try {
    await handle.writeFile(data);
    await handle.sync();
  } catch (error) {
    await handle.close();
    await rm(temporary, { force: true });
    throw error;
  }
  await handle.close();
  try {
    await rename(temporary, finalTarget);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

async function writeQuarantineFile(root: string, record: QuarantineRecord): Promise<void> {
  const directory = path.join(root, 'quarantine');
  await mkdir(directory, { recursive: true });
  const realDirectory = await realpath(directory);
  assertInside(root, realDirectory);
  const target = path.join(realDirectory, `${record.quarantineId}.json`);
  assertInside(root, target);
  const text = `${canonicalJson(record)}\n`;
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(target, 'wx', 0o644);
  } catch (error) {
    if (errnoCode(error) !== 'EEXIST') throw error;
    const existing = await readFile(target, 'utf8');
    if (existing !== text) throw new UpdateError('quarantine-conflict', 'quarantine id already exists with different bytes');
    return;
  }
  try {
    await handle.writeFile(text);
    await handle.sync();
  } catch (error) {
    await handle.close();
    await rm(target, { force: true });
    throw error;
  }
  await handle.close();
}

async function writeQuarantine(root: string, records: readonly QuarantineRecord[]): Promise<void> {
  const seen = new Set<string>();
  for (const record of records) {
    if (seen.has(record.quarantineId)) continue;
    seen.add(record.quarantineId);
    await writeQuarantineFile(root, record);
  }
}

async function cleanArtifactTemps(root: string): Promise<void> {
  const directory = path.join(root, 'artifacts');
  let names: string[] = [];
  try {
    names = await readdir(directory);
  } catch (error) {
    if (errnoCode(error) === 'ENOENT') return;
    throw error;
  }
  await Promise.all(names.filter((name) => name.startsWith('.')).map((name) => rm(path.join(directory, name), { force: true })));
}

async function writeArtifact(root: string, source: StagedSource): Promise<void> {
  const directory = path.join(root, 'artifacts');
  await mkdir(directory, { recursive: true });
  const realDirectory = await realpath(directory);
  assertInside(root, realDirectory);
  const target = path.join(realDirectory, `${source.payloadSha256}.json`);
  assertInside(root, target);
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(target, 'wx', 0o644);
  } catch (error) {
    if (errnoCode(error) !== 'EEXIST') throw error;
    await verifyArtifact(root, source);
    return;
  }
  try {
    await handle.writeFile(source.envelope);
    await handle.sync();
  } catch (error) {
    await handle.close();
    await rm(target, { force: true });
    throw error;
  }
  await handle.close();
}

function parseManifest(value: unknown, expectedId: string | null): IngestionManifest {
  if (!isPlainObject(value)) throw new UpdateError('corrupt-snapshot', 'manifest is not an object');
  if (value.schema !== MANIFEST_SCHEMA || value.schemaVersion !== SCHEMA_VERSION) {
    throw new UpdateError('corrupt-snapshot', 'manifest schema is not supported');
  }
  if (typeof value.snapshotId !== 'string' || !SHA256_HEX.test(value.snapshotId)) {
    throw new UpdateError('corrupt-snapshot', 'manifest snapshot id is not a sha256');
  }
  if (expectedId && value.snapshotId !== expectedId) throw new UpdateError('corrupt-snapshot', 'manifest snapshot id does not match its directory');
  if (!(value.parentSnapshotId === null || (typeof value.parentSnapshotId === 'string' && SHA256_HEX.test(value.parentSnapshotId)))) {
    throw new UpdateError('corrupt-snapshot', 'manifest parent snapshot id is not valid');
  }
  if (typeof value.asOf !== 'string' || !validAsOf(value.asOf)) throw new UpdateError('corrupt-snapshot', 'manifest asOf is not a UTC timestamp');
  if (!Array.isArray(value.sources)) throw new UpdateError('corrupt-snapshot', 'manifest sources are not an array');
  const sources: ManifestSource[] = value.sources.map((entry) => {
    if (!isPlainObject(entry)) throw new UpdateError('corrupt-snapshot', 'manifest source is not an object');
    const sourceId = entry.sourceId;
    const publisherId = entry.publisherId;
    const sourceRevision = entry.sourceRevision;
    const payloadSha256 = entry.payloadSha256;
    const recordCount = entry.recordCount;
    const artifact = entry.artifact;
    if (typeof sourceId !== 'string' || idProblem(sourceId, 'missing-source-id', 'invalid-source-id')) {
      throw new UpdateError('corrupt-snapshot', 'manifest source id is not valid');
    }
    if (typeof publisherId !== 'string' || idProblem(publisherId, 'missing-publisher-id', 'invalid-publisher-id')) {
      throw new UpdateError('corrupt-snapshot', 'manifest publisher id is not valid');
    }
    if (typeof sourceRevision !== 'string' || revisionProblem(sourceRevision) || canonicalRevision(sourceRevision) !== sourceRevision) {
      throw new UpdateError('corrupt-snapshot', 'manifest source revision is not pinned');
    }
    if (typeof payloadSha256 !== 'string' || !SHA256_HEX.test(payloadSha256)) {
      throw new UpdateError('corrupt-snapshot', 'manifest payload hash is not a sha256');
    }
    if (typeof recordCount !== 'number' || !Number.isInteger(recordCount) || recordCount < 0) {
      throw new UpdateError('corrupt-snapshot', 'manifest record count is not a non-negative integer');
    }
    if (artifact !== artifactRelative(payloadSha256)) throw new UpdateError('corrupt-snapshot', 'manifest artifact path is not content-addressed');
    return { sourceId, publisherId, sourceRevision, payloadSha256, recordCount, artifact };
  });
  const seen = new Set<string>();
  for (const source of sources) {
    if (seen.has(source.sourceId)) throw new UpdateError('corrupt-snapshot', 'manifest lists a source twice');
    seen.add(source.sourceId);
  }
  const parentSnapshotId = value.parentSnapshotId as string | null;
  const asOf = value.asOf;
  const snapshotId = sha256HexUtf8(canonicalJson(snapshotIdentity(parentSnapshotId, asOf, sources)));
  if (snapshotId !== value.snapshotId) throw new UpdateError('corrupt-snapshot', 'manifest snapshot id does not match its sources');
  const body = manifestBody(snapshotId, parentSnapshotId, asOf, sources);
  const digest = sha256HexUtf8(canonicalJson(body));
  const integrity = value.integrity;
  if (!isPlainObject(integrity) || integrity.sha256 !== digest) {
    throw new UpdateError('corrupt-snapshot', 'manifest integrity digest does not match');
  }
  return { ...body, integrity: { sha256: digest } };
}

async function verifyArtifact(root: string, source: ManifestSource): Promise<PublishedSource> {
  if (source.artifact !== artifactRelative(source.payloadSha256)) {
    throw new UpdateError('corrupt-snapshot', 'artifact path is not content-addressed');
  }
  const target = path.resolve(root, source.artifact);
  assertInside(root, target);
  let bytes: Buffer;
  try {
    bytes = await readFile(target);
  } catch {
    throw new UpdateError('corrupt-snapshot', 'artifact file is missing');
  }
  const text = bytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(bytes)) throw new UpdateError('corrupt-snapshot', 'artifact is not valid UTF-8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new UpdateError('corrupt-snapshot', 'artifact is not valid JSON');
  }
  if (!isPlainObject(parsed) || parsed.schema !== ARTIFACT_SCHEMA || parsed.schemaVersion !== SCHEMA_VERSION) {
    throw new UpdateError('corrupt-snapshot', 'stored artifact schema does not match the manifest');
  }
  if (parsed.sourceId !== source.sourceId || parsed.publisherId !== source.publisherId || parsed.sourceRevision !== source.sourceRevision) {
    throw new UpdateError('corrupt-snapshot', 'stored artifact identity does not match the manifest');
  }
  if (parsed.payloadSha256 !== source.payloadSha256 || !Array.isArray(parsed.records)) {
    throw new UpdateError('corrupt-snapshot', 'stored artifact payload does not match the manifest');
  }
  let digest = '';
  try {
    digest = sha256HexUtf8(canonicalJson(parsed.records));
  } catch {
    throw new UpdateError('corrupt-snapshot', 'stored artifact records are not canonical JSON');
  }
  if (digest !== source.payloadSha256 || parsed.records.length !== source.recordCount) {
    throw new UpdateError('corrupt-snapshot', 'artifact bytes do not match payloadSha256');
  }
  const records: Array<Record<string, unknown>> = [];
  for (const item of parsed.records) {
    if (!isPlainObject(item)) throw new UpdateError('corrupt-snapshot', 'stored artifact record is not an object');
    records.push(item);
  }
  return { ...source, records };
}

async function loadSnapshot(root: string, snapshotId: string): Promise<SnapshotView> {
  if (!SHA256_HEX.test(snapshotId)) throw new UpdateError('invalid-request', 'snapshot id is not a sha256');
  const manifestPath = path.resolve(root, 'snapshots', snapshotId, 'manifest.json');
  assertInside(root, manifestPath);
  let text = '';
  try {
    text = await readFile(manifestPath, 'utf8');
  } catch (error) {
    if (errnoCode(error) === 'ENOENT') throw new UpdateError('missing-snapshot', 'snapshot manifest is not in the store');
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new UpdateError('corrupt-snapshot', 'snapshot manifest is not valid JSON');
  }
  const manifest = parseManifest(parsed, snapshotId);
  const sources: PublishedSource[] = [];
  for (const source of manifest.sources) sources.push(await verifyArtifact(root, source));
  return { manifest, sources };
}

async function loadStore(root: string): Promise<LoadedStore> {
  const pointerPath = path.join(root, 'current.json');
  let raw: Buffer;
  try {
    raw = await readFile(pointerPath);
  } catch (error) {
    if (errnoCode(error) === 'ENOENT') return { kind: 'empty' };
    throw error;
  }
  const text = raw.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(raw)) {
    return { kind: 'corrupt', code: 'corrupt-current', detail: 'current pointer is not valid UTF-8', raw };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return { kind: 'corrupt', code: 'corrupt-current', detail: 'current pointer is not valid JSON', raw };
  }
  if (!isPlainObject(parsed) || parsed.schema !== CURRENT_SCHEMA || parsed.schemaVersion !== SCHEMA_VERSION) {
    return { kind: 'corrupt', code: 'corrupt-current', detail: 'current pointer schema is not supported', raw };
  }
  if (typeof parsed.snapshotId !== 'string' || !SHA256_HEX.test(parsed.snapshotId)) {
    return { kind: 'corrupt', code: 'corrupt-current', detail: 'current pointer snapshot id is not a sha256', raw };
  }
  if (typeof parsed.manifestSha256 !== 'string' || !SHA256_HEX.test(parsed.manifestSha256)) {
    return { kind: 'corrupt', code: 'corrupt-current', detail: 'current pointer manifest hash is not a sha256', raw };
  }
  if (typeof parsed.updatedAt !== 'string' || !validAsOf(parsed.updatedAt)) {
    return { kind: 'corrupt', code: 'corrupt-current', detail: 'current pointer updatedAt is not a UTC timestamp', raw };
  }
  try {
    const loaded = await loadSnapshot(root, parsed.snapshotId);
    if (loaded.manifest.integrity.sha256 !== parsed.manifestSha256 || loaded.manifest.asOf !== parsed.updatedAt) {
      return { kind: 'corrupt', code: 'corrupt-current', detail: 'current pointer does not match the snapshot manifest', raw };
    }
    const sources = new Map<string, StagedSource>();
    for (const source of loaded.sources) {
      sources.set(source.sourceId, { ...source, needsWrite: false, envelope: '' });
    }
    return {
      kind: 'ready',
      pointer: { snapshotId: parsed.snapshotId, manifestSha256: parsed.manifestSha256, updatedAt: parsed.updatedAt },
      manifest: loaded.manifest,
      sources,
    };
  } catch (error) {
    if (error instanceof UpdateError) {
      const code = error.code === 'corrupt-snapshot' ? 'corrupt-snapshot' : 'corrupt-current';
      return { kind: 'corrupt', code, detail: error.message, raw };
    }
    throw error;
  }
}

async function openStore(storeDir: string): Promise<string> {
  if (typeof storeDir !== 'string' || !storeDir.trim()) throw new UpdateError('invalid-request', 'store directory is required');
  await mkdir(storeDir, { recursive: true });
  const root = await realpath(storeDir);
  const info = await stat(root);
  if (!info.isDirectory()) throw new UpdateError('invalid-request', 'store path is not a directory');
  return root;
}

async function acquireLock(root: string): Promise<Awaited<ReturnType<typeof open>>> {
  try {
    const handle = await open(path.join(root, '.update.lock'), 'wx', 0o644);
    await handle.writeFile(`${process.pid}\n`);
    return handle;
  } catch (error) {
    if (errnoCode(error) === 'EEXIST') throw new UpdateError('locked', 'ingestion store is already locked');
    throw error;
  }
}

async function releaseLock(root: string, handle: Awaited<ReturnType<typeof open>>): Promise<void> {
  await handle.close();
  await rm(path.join(root, '.update.lock'), { force: true });
}

async function commitSnapshot(
  root: string,
  manifest: IngestionManifest,
  previousSnapshotId: string | null,
  options: ApplyOptions,
): Promise<void> {
  const snapshotDir = path.join(root, 'snapshots', manifest.snapshotId);
  const manifestPath = path.join(snapshotDir, 'manifest.json');
  const text = `${canonicalJson(manifest)}\n`;
  let already = false;
  try {
    const existing = await readFile(manifestPath, 'utf8');
    if (existing !== text) throw new UpdateError('snapshot-conflict', 'snapshot id already exists with different manifest bytes');
    already = true;
  } catch (error) {
    if (error instanceof UpdateError) throw error;
    if (errnoCode(error) !== 'ENOENT') throw error;
    try {
      const info = await stat(snapshotDir);
      if (info.isDirectory()) throw new UpdateError('snapshot-conflict', 'snapshot directory exists without a matching manifest');
    } catch (statError) {
      if (statError instanceof UpdateError) throw statError;
      if (errnoCode(statError) !== 'ENOENT') throw statError;
    }
  }
  const staging = path.join(root, 'staging', manifest.snapshotId);
  if (!already) {
    await rm(staging, { recursive: true, force: true });
    await mkdir(staging, { recursive: true });
    await atomicWrite(root, path.join(staging, 'manifest.json'), text);
    await bestEffortSyncDir(staging);
  }
  const barrier: PublishBarrier = { previousSnapshotId, nextSnapshotId: manifest.snapshotId, nextManifest: manifest };
  let renamed = already;
  try {
    if (options.beforeSnapshotPublish) await options.beforeSnapshotPublish(barrier);
    if (!already) {
      await mkdir(path.join(root, 'snapshots'), { recursive: true });
      await rename(staging, snapshotDir);
      renamed = true;
      await bestEffortSyncDir(path.join(root, 'snapshots'));
    }
    if (options.beforeCurrentPublish) await options.beforeCurrentPublish(barrier);
    const pointer = {
      schema: CURRENT_SCHEMA,
      schemaVersion: SCHEMA_VERSION,
      snapshotId: manifest.snapshotId,
      manifestSha256: manifest.integrity.sha256,
      updatedAt: manifest.asOf,
    };
    await atomicWrite(root, path.join(root, 'current.json'), `${canonicalJson(pointer)}\n`);
    await bestEffortSyncDir(root);
    await rm(path.join(root, 'staging'), { recursive: true, force: true });
  } catch (error) {
    await rm(path.join(root, 'staging'), { recursive: true, force: true });
    throw error;
  }
}

function netChanges(original: ReadonlyMap<string, StagedSource>, next: ReadonlyMap<string, StagedSource>): AppliedChange[] {
  const changes: AppliedChange[] = [];
  const seen = new Set<string>();
  for (const [sourceId, source] of original) {
    seen.add(sourceId);
    const updated = next.get(sourceId);
    if (!updated) {
      changes.push({ op: 'remove', sourceId, sourceRevision: source.sourceRevision, payloadSha256: source.payloadSha256 });
      continue;
    }
    if (
      updated.sourceRevision !== source.sourceRevision
      || updated.payloadSha256 !== source.payloadSha256
      || updated.publisherId !== source.publisherId
    ) {
      changes.push({ op: 'upsert', sourceId, sourceRevision: updated.sourceRevision, payloadSha256: updated.payloadSha256 });
    }
  }
  for (const [sourceId, source] of next) {
    if (seen.has(sourceId)) continue;
    changes.push({ op: 'upsert', sourceId, sourceRevision: source.sourceRevision, payloadSha256: source.payloadSha256 });
  }
  return changes;
}

function unchangedResult(loaded: LoadedStore, skipped: SkippedChange[], quarantined: QuarantineRecord[]): UpdateResult {
  if (loaded.kind !== 'ready') {
    return {
      schema: UPDATE_SCHEMA,
      changed: false,
      previousSnapshotId: null,
      snapshotId: null,
      manifestSha256: null,
      applied: [],
      skipped,
      quarantined,
    };
  }
  return {
    schema: UPDATE_SCHEMA,
    changed: false,
    previousSnapshotId: loaded.pointer.snapshotId,
    snapshotId: loaded.pointer.snapshotId,
    manifestSha256: loaded.pointer.manifestSha256,
    applied: [],
    skipped,
    quarantined,
  };
}

async function applyLocked(root: string, request: UpdateRequest, options: ApplyOptions): Promise<UpdateResult> {
  await cleanArtifactTemps(root);
  const loaded = await loadStore(root);
  if (loaded.kind === 'corrupt') {
    const record = quarantineRecord(draft({
      reason: 'corrupt-artifact',
      detail: loaded.detail,
      operationIndex: null,
      sourceId: null,
      sourceRevision: null,
      rawSha256: sha256Buffer(loaded.raw),
    }));
    await writeQuarantine(root, [record]);
    throw new UpdateError(loaded.code, loaded.detail);
  }
  const base = new Map<string, StagedSource>();
  if (loaded.kind === 'ready') {
    for (const [sourceId, source] of loaded.sources) base.set(sourceId, source);
  }
  const original = new Map(base);
  const skipped: SkippedChange[] = [];
  const quarantined: QuarantineRecord[] = [];
  for (let index = 0; index < request.operations.length; index += 1) {
    const op = request.operations[index];
    if (!isPlainObject(op) || (op.op !== 'remove' && op.op !== 'upsert' && op.op !== 'upsert-file')) {
      quarantined.push(quarantineRecord(draft({
        reason: 'invalid-operation',
        detail: 'operation is not remove, upsert, or upsert-file',
        operationIndex: index,
        sourceId: null,
        sourceRevision: null,
      })));
      continue;
    }
    if (op.op === 'remove') {
      const classified = classifyRemove(op, index);
      if (!classified.ok) {
        quarantined.push(quarantineRecord(classified.quarantine));
        continue;
      }
      const existing = base.get(classified.sourceId);
      if (!existing) {
        skipped.push({ op: 'remove', sourceId: classified.sourceId, sourceRevision: classified.sourceRevision, reason: 'already-absent' });
        continue;
      }
      if (existing.sourceRevision !== classified.sourceRevision) {
        quarantined.push(quarantineRecord(draft({
          reason: 'stale-removal',
          detail: 'removal names a revision that is not the current pin',
          operationIndex: index,
          sourceId: classified.sourceId,
          publisherId: existing.publisherId,
          sourceRevision: classified.sourceRevision,
          payloadSha256: existing.payloadSha256,
        })));
        continue;
      }
      base.delete(classified.sourceId);
      continue;
    }
    const classified = await classifyUpsert(op, index);
    if (!classified.ok) {
      quarantined.push(quarantineRecord(classified.quarantine));
      continue;
    }
    const next = classified.source;
    const existing = base.get(next.sourceId);
    if (existing && existing.sourceRevision === next.sourceRevision) {
      if (existing.payloadSha256 === next.payloadSha256 && existing.publisherId === next.publisherId) {
        skipped.push({ op: 'upsert', sourceId: next.sourceId, sourceRevision: next.sourceRevision, reason: 'already-current' });
      } else {
        quarantined.push(quarantineRecord(draft({
          reason: 'revision-conflict',
          detail: existing.payloadSha256 !== next.payloadSha256
            ? 'payload does not match the pinned revision'
            : 'publisher id does not match the pinned revision',
          operationIndex: index,
          sourceId: next.sourceId,
          publisherId: next.publisherId,
          sourceRevision: next.sourceRevision,
          payloadSha256: next.payloadSha256,
          rawSha256: null,
        })));
      }
      continue;
    }
    base.set(next.sourceId, next);
  }
  const applied = netChanges(original, base);
  await writeQuarantine(root, quarantined);
  if (!applied.length) return unchangedResult(loaded, skipped, quarantined);
  for (const source of base.values()) {
    if (!source.needsWrite) await verifyArtifact(root, source);
  }
  for (const source of base.values()) {
    if (source.needsWrite) await writeArtifact(root, source);
  }
  const previousSnapshotId = loaded.kind === 'ready' ? loaded.pointer.snapshotId : null;
  const manifestSources: ManifestSource[] = [...base.values()].map((source) => ({
    sourceId: source.sourceId,
    publisherId: source.publisherId,
    sourceRevision: source.sourceRevision,
    payloadSha256: source.payloadSha256,
    recordCount: source.recordCount,
    artifact: source.artifact,
  }));
  const manifest = buildManifest(previousSnapshotId, request.asOf, manifestSources);
  await commitSnapshot(root, manifest, previousSnapshotId, options);
  return {
    schema: UPDATE_SCHEMA,
    changed: true,
    previousSnapshotId,
    snapshotId: manifest.snapshotId,
    manifestSha256: manifest.integrity.sha256,
    applied,
    skipped,
    quarantined,
  };
}

export async function applyIncrementalUpdate(storeDir: string, request: UpdateRequest, options: ApplyOptions = {}): Promise<UpdateResult> {
  assertRequest(request);
  const root = await openStore(storeDir);
  const lock = await acquireLock(root);
  try {
    return await applyLocked(root, request, options);
  } finally {
    await releaseLock(root, lock);
  }
}

export async function readCurrent(storeDir: string): Promise<CurrentView> {
  if (typeof storeDir !== 'string' || !storeDir.trim()) throw new UpdateError('invalid-request', 'store directory is required');
  const root = path.resolve(storeDir);
  let info;
  try {
    info = await stat(root);
  } catch (error) {
    if (errnoCode(error) === 'ENOENT') return emptyView();
    throw error;
  }
  if (!info.isDirectory()) throw new UpdateError('invalid-request', 'store path is not a directory');
  const resolved = await realpath(root);
  const loaded = await loadStore(resolved);
  if (loaded.kind === 'empty') return emptyView();
  if (loaded.kind === 'corrupt') throw new UpdateError(loaded.code, loaded.detail);
  return {
    schema: CURRENT_SCHEMA,
    schemaVersion: SCHEMA_VERSION,
    snapshotId: loaded.pointer.snapshotId,
    manifestSha256: loaded.pointer.manifestSha256,
    updatedAt: loaded.pointer.updatedAt,
    manifest: loaded.manifest,
    sources: [...loaded.sources.values()].map((source) => ({
      sourceId: source.sourceId,
      publisherId: source.publisherId,
      sourceRevision: source.sourceRevision,
      payloadSha256: source.payloadSha256,
      recordCount: source.recordCount,
      artifact: source.artifact,
      records: source.records,
    })).sort(bySourceId),
  };
}

export async function readSnapshot(storeDir: string, snapshotId: string): Promise<SnapshotView> {
  if (typeof storeDir !== 'string' || !storeDir.trim()) throw new UpdateError('invalid-request', 'store directory is required');
  const root = await realpath(storeDir);
  return loadSnapshot(root, snapshotId);
}

export async function listQuarantine(storeDir: string): Promise<QuarantineRecord[]> {
  if (typeof storeDir !== 'string' || !storeDir.trim()) throw new UpdateError('invalid-request', 'store directory is required');
  const root = path.resolve(storeDir);
  let names: string[] = [];
  try {
    names = await readdir(path.join(root, 'quarantine'));
  } catch (error) {
    if (errnoCode(error) === 'ENOENT') return [];
    throw error;
  }
  const records: QuarantineRecord[] = [];
  for (const name of names) {
    if (!/^[0-9a-f]{64}\.json$/.test(name)) continue;
    const text = await readFile(path.join(root, 'quarantine', name), 'utf8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      throw new UpdateError('corrupt-quarantine', 'quarantine file is not valid JSON');
    }
    if (!isPlainObject(parsed) || parsed.schema !== QUARANTINE_SCHEMA || parsed.poisonedCurrent !== false) {
      throw new UpdateError('corrupt-quarantine', 'quarantine file is not an ingestion quarantine record');
    }
    const record = quarantineRecord({
      reason: parsed.reason as QuarantineReason,
      detail: String(parsed.detail ?? ''),
      operationIndex: typeof parsed.operationIndex === 'number' ? parsed.operationIndex : null,
      sourceId: typeof parsed.sourceId === 'string' ? parsed.sourceId : null,
      publisherId: typeof parsed.publisherId === 'string' ? parsed.publisherId : null,
      sourceRevision: typeof parsed.sourceRevision === 'string' ? parsed.sourceRevision : null,
      payloadSha256: typeof parsed.payloadSha256 === 'string' ? parsed.payloadSha256 : null,
      rawSha256: typeof parsed.rawSha256 === 'string' ? parsed.rawSha256 : null,
    });
    if (record.quarantineId !== parsed.quarantineId || `${record.quarantineId}.json` !== name) {
      throw new UpdateError('corrupt-quarantine', 'quarantine id does not match its bytes');
    }
    records.push(record);
  }
  records.sort((left, right) => (left.quarantineId < right.quarantineId ? -1 : left.quarantineId > right.quarantineId ? 1 : 0));
  return records;
}

function flag(argv: string[], name: string): string {
  const index = argv.indexOf(name);
  const value = index >= 0 ? argv[index + 1] : undefined;
  if (!value || value.startsWith('--')) throw new UpdateError('invalid-request', `${name} needs a value`);
  return value;
}

function flagOptional(argv: string[], name: string): string | null {
  const index = argv.indexOf(name);
  if (index < 0) return null;
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new UpdateError('invalid-request', `${name} needs a value`);
  return value;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const command = argv[0];
  if (command === 'apply') {
    const requestText = await readFile(flag(argv, '--request'), 'utf8');
    const request = JSON.parse(requestText) as UpdateRequest;
    const result = await applyIncrementalUpdate(flag(argv, '--store'), request);
    process.stdout.write(`${canonicalJson(result)}\n`);
    return;
  }
  if (command === 'read') {
    const store = flag(argv, '--store');
    const snapshot = flagOptional(argv, '--snapshot');
    const view = snapshot ? await readSnapshot(store, snapshot) : await readCurrent(store);
    process.stdout.write(`${canonicalJson(view)}\n`);
    return;
  }
  throw new UpdateError('invalid-request', 'usage: update.ts apply --store DIR --request FILE | update.ts read --store DIR [--snapshot ID]');
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(path.resolve(entry)).href;
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'update failed';
    process.stderr.write(`${message}\n`);
    process.exit(1);
  });
}

#!/usr/bin/env node
/**
 * Repeatable source refresh.
 *
 * Read the pinned inventory, dispositions, rights, catalog schema, coverage
 * audit, ingestion ledger, and geography manifest. Hash each file before any
 * derived bytes are published. Audit redistribution rights, the coverage
 * schema, and the coverage counts. Publish a snapshot by renaming a staged
 * manifest into place and then replacing current.json. Readers therefore see
 * the previous complete snapshot or the next complete snapshot.
 *
 * An audit failure quarantines the attempt and leaves current.json untouched.
 * rollback() restores the previous pointer by the same rename. The refresh
 * store stays outside the site repository. This process does not read the host
 * supervisor configuration, does not start or stop its services, and does not
 * copy credentials into the site.
 */
import { createHash, randomBytes } from 'node:crypto';
import { open, mkdir, readFile, rm, stat, realpath, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

export const REFRESH_SCHEMA = 'worldwide-legal-search.refresh@1';
export const MANIFEST_SCHEMA = 'worldwide-legal-search.refresh-manifest@1';
export const POINTER_SCHEMA = 'worldwide-legal-search.refresh-current@1';
export const QUARANTINE_SCHEMA = 'worldwide-legal-search.refresh-quarantine@1';
export const SCHEMA_VERSION = 1;
export const COVERAGE_STATES = Object.freeze(['known', 'partial', 'missing', 'unknown', 'unavailable'] as const);
export const COLLECTION_LEVELS = Object.freeze(['national', 'regional', 'municipal', 'other'] as const);
export const REQUIRED_ORGANIZATIONS = Object.freeze(['justicedao', 'endomorphosis'] as const);
export const REQUIRED_ARTIFACT_KINDS = Object.freeze(['text', 'translation', 'embedding', 'boundary', 'index'] as const);

export const OWNERSHIP = Object.freeze({
  sourceMaintenance: 'site-maintainers',
  hostSupervisor: 'host-supervisor',
  sourceMaintenanceOwns: Object.freeze(['source-pins', 'rights-audit', 'schema-audit', 'coverage-audit', 'atomic-rollback']),
  hostSupervisorOwns: Object.freeze(['process-recovery', 'service-restart', 'watchdog']),
  credentialsEnterSite: false,
});

const ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const SHA256_HEX = /^[0-9a-f]{64}$/;
const AS_OF = /^[0-9]{4}-[0-9]{2}-[0-9]{2}(?:T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?Z)?$/;
const DATASET_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const FLOATING = new Set([
  'head', 'main', 'master', 'latest', 'trunk', 'current', 'floating', 'unpinned', 'none', 'null', 'undefined', 'tip', 'dev', 'develop',
]);
const SECRET_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bhf_[A-Za-z0-9]{20,}\b/,
  /\bsk-[A-Za-z0-9]{20,}\b/,
  /\b(?:api[_-]?key|secret|password|access[_-]?token)\s*[:=]\s*['"][^'"]{6,}['"]/i,
];
const HOST_INPUTS = new Set([
  'config/worldwide_supervisor_host.json',
  'scripts/worldwide_supervisor_host.py',
  'implementation_plan/worldwide_legal_search/plan.json',
  'implementation_plan/worldwide_legal_search/PLAN.md',
  'implementation_plan/worldwide_legal_search/build_plan.py',
  'implementation_plan/worldwide_legal_search/validate_plan.py',
  'implementation_plan/worldwide_legal_search/tasks.todo.md',
  'implementation_plan/worldwide_legal_search/goals.objectives.md',
  'implementation_plan/worldwide_legal_search/supervisor.json',
  'implementation_plan/worldwide_legal_search/watchdog.policy.json',
  'implementation_plan/worldwide_legal_search/test_watchdog.py',
  'implementation_plan/worldwide_legal_search/watchdog_loop.py',
]);
const DEFAULT_INPUTS = Object.freeze({
  inventory: 'data/worldwide/source-inventory.json',
  dispositions: 'data/worldwide/source-dispositions.json',
  rights: 'data/worldwide/rights.json',
  schema: 'data/worldwide/catalog.schema.json',
  coverage: 'docs/worldwide/coverage-audit.json',
  ledger: 'data/worldwide/ingestion-ledger.json',
  geography: 'data/worldwide/geography-manifest.json',
});

type InputRole = keyof typeof DEFAULT_INPUTS;
type CoverageState = (typeof COVERAGE_STATES)[number];
type CollectionLevel = (typeof COLLECTION_LEVELS)[number];
type FindingCode = 'pin' | 'rights' | 'schema' | 'coverage' | 'secret' | 'rollback';

export interface Finding {
  code: FindingCode;
  message: string;
  path: string;
}

export interface PinRecord {
  role: InputRole;
  path: string;
  sha256: string;
  documentSchema: string;
}

export interface PinChange extends PinRecord {
  previousSha256: string | null;
  changed: boolean;
}

export interface RefreshPointer {
  schema: typeof POINTER_SCHEMA;
  schemaVersion: 1;
  snapshotId: string;
  manifestSha256: string;
  updatedAt: string;
}

export interface AuditSummary {
  ok: true;
  rights: {
    ok: true;
    datasets: number;
    resolved: number;
    unresolved: number;
    organizations: string[];
    artifactKinds: string[];
  };
  schema: {
    ok: true;
    coverageStates: readonly CoverageState[];
    legalCompleteness: 'not_claimed';
  };
  coverage: {
    ok: true;
    states: readonly CoverageState[];
    nationalCount: number;
    localCount: number;
    regionalCount: number;
    otherCount: number;
    entryCount: number;
    legalCompleteness: 'not_claimed';
    countsAreNotLegalCompleteness: true;
  };
}

export interface RefreshSnapshot {
  rights: unknown;
  schema: unknown;
  coverage: unknown;
  ledger: unknown;
  geography: unknown;
  inventory: unknown;
  dispositions: unknown;
  pins: {
    inventorySha256: string;
    dispositionSha256: string;
    rightsSha256: string;
  };
}

export class RefreshError extends Error {
  readonly code: FindingCode;
  readonly findings: readonly Finding[];

  constructor(code: FindingCode, message: string, findings: readonly Finding[] = []) {
    super(message);
    this.name = 'RefreshError';
    this.code = code;
    this.findings = findings;
  }
}

interface LoadedInput {
  role: InputRole;
  path: string;
  fullPath: string;
  bytes: Buffer;
  sha256: string;
  text: string;
  value: unknown;
}

interface ManifestBody {
  schema: typeof MANIFEST_SCHEMA;
  schemaVersion: 1;
  snapshotId: string;
  parentSnapshotId: string | null;
  asOf: string;
  ownership: {
    sourceMaintenance: string;
    hostSupervisor: string;
    sourceMaintenanceOwns: string[];
    hostSupervisorOwns: string[];
    credentialsEnterSite: false;
  };
  pins: PinRecord[];
  changes: PinChange[];
  audit: AuditSummary;
}

interface StoreManifest extends ManifestBody {
  integrity: { sha256: string };
}

export interface PublishOptions {
  repoRoot?: string;
  storeDir?: string;
  asOf?: string;
  inputs?: Partial<Record<InputRole, string>>;
  checkOnly?: boolean;
}

export interface PublishResult {
  ok: boolean;
  schema: typeof REFRESH_SCHEMA;
  action: 'check' | 'publish' | 'unchanged' | 'rollback';
  snapshotId: string | null;
  parentSnapshotId: string | null;
  asOf: string | null;
  changed: boolean;
  poisonedCurrent: false;
  rolledBack: boolean;
  changes: PinChange[];
  ownership: typeof OWNERSHIP;
  audit: AuditSummary | null;
  findings: Finding[];
}

export interface RollbackResult {
  ok: true;
  schema: typeof REFRESH_SCHEMA;
  action: 'rollback';
  restoredSnapshotId: string;
  displacedSnapshotId: string | null;
  poisonedCurrent: false;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function errnoCode(error: unknown): string {
  return error !== null && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : '';
}

function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new RefreshError('pin', 'canonical JSON rejects a non-finite number');
    if (Object.is(value, -0)) return '0';
    if (Number.isInteger(value)) return String(value);
    return JSON.stringify(value);
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  if (isObject(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  throw new RefreshError('pin', 'canonical JSON rejects this value');
}

function sha256Buffer(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function sha256Text(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function pinRevision(revision: string): string {
  if (typeof revision !== 'string') throw new RefreshError('pin', 'revision required');
  const trimmed = revision.trim();
  if (!trimmed) throw new RefreshError('pin', 'revision required');
  if (FLOATING.has(trimmed.toLowerCase())) throw new RefreshError('pin', 'floating revision is not a pin');
  if (!/^[0-9a-fA-F]{7,64}$/.test(trimmed)) throw new RefreshError('pin', 'revision is not a pinned hex digest');
  return trimmed.toLowerCase();
}

function credentialFinding(text: string, at: string): Finding | null {
  for (const pattern of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) {
      return { code: 'secret', message: 'credential material is not allowed in the refresh pin', path: at };
    }
  }
  return null;
}

function push(findings: Finding[], code: FindingCode, message: string, at: string): void {
  findings.push({ code, message, path: at });
}

function requireSha256(value: unknown, findings: Finding[], code: FindingCode, at: string): value is string {
  if (typeof value !== 'string' || !SHA256_HEX.test(value)) {
    push(findings, code, 'sha256 digest is not pinned', at);
    return false;
  }
  return true;
}

function siteRelative(repoRoot: string, inputPath: string): { full: string; relative: string } {
  if (typeof inputPath !== 'string' || inputPath.length === 0 || inputPath.includes('\0')) {
    throw new RefreshError('pin', 'input path is required');
  }
  if (inputPath.split(/[\\/]/).includes('..')) throw new RefreshError('pin', 'input path escapes the site root');
  const full = path.resolve(repoRoot, inputPath);
  const root = path.resolve(repoRoot);
  if (full !== root && !full.startsWith(root + path.sep)) throw new RefreshError('pin', 'input path escapes the site root');
  const relative = path.relative(root, full).split(path.sep).join('/');
  if (HOST_INPUTS.has(relative)) throw new RefreshError('pin', 'host supervisor files are not source inputs');
  const base = path.basename(full);
  if (base === '.env' || base === 'id_rsa' || base === 'id_ed25519' || base.endsWith('.pem')) {
    throw new RefreshError('secret', 'credential files are not source inputs');
  }
  return { full, relative };
}

function assertStoreOutsideSite(repoRoot: string, store: string): void {
  const root = path.resolve(repoRoot);
  const target = path.resolve(store);
  if (target === root || target.startsWith(root + path.sep)) {
    throw new RefreshError('pin', 'refresh store must stay outside the site repository');
  }
}

async function openStore(repoRoot: string, storeDir: string): Promise<string> {
  if (typeof storeDir !== 'string' || !storeDir.trim()) throw new RefreshError('pin', 'refresh store directory is required');
  const resolved = path.resolve(storeDir);
  assertStoreOutsideSite(repoRoot, resolved);
  const parent = path.dirname(resolved);
  await mkdir(parent, { recursive: true });
  const realParent = await realpath(parent);
  const root = path.join(realParent, path.basename(resolved));
  assertStoreOutsideSite(repoRoot, root);
  await mkdir(root, { recursive: true });
  const realRoot = await realpath(root);
  assertStoreOutsideSite(repoRoot, realRoot);
  const info = await stat(realRoot);
  if (!info.isDirectory()) throw new RefreshError('pin', 'refresh store is not a directory');
  return realRoot;
}

function assertInside(root: string, target: string): void {
  const resolved = path.resolve(target);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new RefreshError('pin', 'path escapes the refresh store');
  }
}

async function atomicWrite(root: string, target: string, data: string): Promise<void> {
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

async function acquireLock(root: string): Promise<Awaited<ReturnType<typeof open>>> {
  try {
    const handle = await open(path.join(root, '.refresh.lock'), 'wx', 0o644);
    await handle.writeFile(`${process.pid}\n`);
    return handle;
  } catch (error) {
    if (errnoCode(error) === 'EEXIST') throw new RefreshError('pin', 'refresh store is already locked');
    throw error;
  }
}

async function releaseLock(root: string, handle: Awaited<ReturnType<typeof open>>): Promise<void> {
  await handle.close();
  await rm(path.join(root, '.refresh.lock'), { force: true });
}

async function readBytes(full: string): Promise<Buffer> {
  try {
    return await readFile(full);
  } catch (error) {
    if (errnoCode(error) === 'ENOENT') throw new RefreshError('pin', 'pinned input is absent');
    throw error;
  }
}

async function loadInputs(repoRoot: string, overrides: Partial<Record<InputRole, string>>): Promise<LoadedInput[]> {
  const roles = Object.keys(DEFAULT_INPUTS) as InputRole[];
  const loaded: LoadedInput[] = [];
  for (const role of roles) {
    const given = overrides[role] ?? DEFAULT_INPUTS[role];
    const located = siteRelative(repoRoot, given);
    const bytes = await readBytes(located.full);
    const text = bytes.toString('utf8');
    if (!Buffer.from(text, 'utf8').equals(bytes)) throw new RefreshError('pin', role + ' is not valid UTF-8');
    let value: unknown;
    try {
      value = JSON.parse(text) as unknown;
    } catch {
      throw new RefreshError('schema', role + ' is not valid JSON');
    }
    loaded.push({ role, path: located.relative, fullPath: located.full, bytes, sha256: sha256Buffer(bytes), text, value });
  }
  return loaded;
}

function inputMap(inputs: readonly LoadedInput[]): Record<InputRole, LoadedInput> {
  const mapped = {} as Record<InputRole, LoadedInput>;
  for (const item of inputs) mapped[item.role] = item;
  return mapped;
}

function selectAsOf(inventory: unknown, override?: string): string {
  if (override !== undefined) {
    if (!AS_OF.test(override)) throw new RefreshError('pin', 'as-of is not a pinned timestamp');
    return override;
  }
  if (isObject(inventory) && typeof inventory.retrieved_at === 'string' && AS_OF.test(inventory.retrieved_at)) return inventory.retrieved_at;
  throw new RefreshError('pin', 'inventory retrieved_at is not pinned');
}

function auditInventory(value: unknown, findings: Finding[]): void {
  if (!isObject(value) || value.schema !== 'worldwide-legal-search.source-inventory@1') {
    push(findings, 'pin', 'inventory schema is not pinned', 'inventory.schema');
    return;
  }
  const organizations = Array.isArray(value.organizations) ? value.organizations : [];
  const seen = new Set<string>();
  const datasets = new Set<string>();
  for (const organization of organizations) {
    if (!isObject(organization) || typeof organization.id !== 'string') {
      push(findings, 'pin', 'inventory organization is not pinned', 'inventory.organizations');
      continue;
    }
    seen.add(organization.id);
    const pagination = organization.pagination;
    if (!isObject(pagination) || pagination.exhausted !== true) {
      push(findings, 'pin', 'inventory pagination is not exhausted', 'inventory.organizations.' + organization.id);
    }
    const rows = Array.isArray(organization.datasets) ? organization.datasets : [];
    for (const row of rows) {
      if (!isObject(row) || typeof row.dataset_id !== 'string' || !DATASET_ID.test(row.dataset_id)) {
        push(findings, 'pin', 'inventory dataset id is not pinned', 'inventory.datasets');
        continue;
      }
      if (datasets.has(row.dataset_id)) push(findings, 'pin', 'inventory dataset id is repeated', row.dataset_id);
      datasets.add(row.dataset_id);
      if (typeof row.resolved_revision !== 'string') {
        push(findings, 'pin', 'resolved revision is not pinned', row.dataset_id);
        continue;
      }
      try {
        pinRevision(row.resolved_revision);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'resolved revision is not pinned';
        push(findings, 'pin', message, row.dataset_id);
      }
    }
  }
  for (const id of REQUIRED_ORGANIZATIONS) {
    if (!seen.has(id)) push(findings, 'pin', 'inventory does not cover ' + id, 'inventory.organizations');
  }
}

function auditDispositions(value: unknown, inventorySha256: string, findings: Finding[]): void {
  if (!isObject(value) || value.schema !== 'worldwide-legal-search.source-dispositions@1') {
    push(findings, 'pin', 'disposition schema is not pinned', 'dispositions.schema');
    return;
  }
  if (value.inventory_revision !== inventorySha256) {
    push(findings, 'pin', 'disposition inventory revision does not match the inventory bytes', 'dispositions.inventory_revision');
  }
}

function blockerOf(value: unknown, findings: Finding[], code: FindingCode, at: string, required: boolean): void {
  if (value === null && !required) return;
  if (!isObject(value) || !isNonEmpty(value.kind) || !isNonEmpty(value.reason)) {
    push(findings, code, 'blocker needs a kind and a reason', at);
  }
}

export function auditRights(document: unknown, pins: { inventorySha256: string; dispositionSha256: string }): Finding[] {
  const findings: Finding[] = [];
  if (!isObject(document) || document.schema !== 'worldwide-legal-search.rights@1') {
    push(findings, 'rights', 'rights schema is not pinned', 'rights.schema');
    return findings;
  }
  if (document.organization_membership_is_not_a_license !== true) {
    push(findings, 'rights', 'organization membership is not a redistribution license', 'rights.organization_membership_is_not_a_license');
  }
  if (document.inventory_revision !== pins.inventorySha256) {
    push(findings, 'rights', 'rights inventory revision does not match the inventory bytes', 'rights.inventory_revision');
  }
  if (document.disposition_revision !== pins.dispositionSha256) {
    push(findings, 'rights', 'rights disposition revision does not match the disposition bytes', 'rights.disposition_revision');
  }
  const records = Array.isArray(document.records) ? document.records : [];
  if (records.length === 0) push(findings, 'rights', 'rights records are required', 'rights.records');
  const organizations = new Set<string>();
  const kinds = new Map<string, { records: number; resolved: number; unresolved: number }>();
  let resolved = 0;
  let unresolved = 0;
  records.forEach((row, index) => {
    const at = 'rights.records[' + index + ']';
    if (!isObject(row)) {
      push(findings, 'rights', 'rights record must be an object', at);
      return;
    }
    if (typeof row.dataset_id !== 'string' || !DATASET_ID.test(row.dataset_id)) push(findings, 'rights', 'dataset id is required', at + '.dataset_id');
    else organizations.add(row.dataset_id.split('/')[0]);
    if (typeof row.artifact_revision !== 'string') push(findings, 'rights', 'artifact revision must be pinned', at + '.artifact_revision');
    else {
      try {
        pinRevision(row.artifact_revision);
      } catch (error) {
        push(findings, 'rights', error instanceof Error ? error.message : 'artifact revision must be pinned', at + '.artifact_revision');
      }
    }
    if (row.inferred_from_organization !== false) {
      push(findings, 'rights', 'organization membership is not a redistribution license', at + '.inferred_from_organization');
    }
    if (!Array.isArray(row.restrictions)) push(findings, 'rights', 'restrictions must be an array', at + '.restrictions');
    const artifactKinds = Array.isArray(row.artifact_kinds) ? row.artifact_kinds : [];
    if (row.status === 'resolved') {
      resolved += 1;
      if (!isNonEmpty(row.rights) || !isNonEmpty(row.attribution)) push(findings, 'rights', 'resolved rights need a license and attribution', at);
      if (row.blocker !== null) push(findings, 'rights', 'resolved rights cannot also be blocked', at + '.blocker');
    } else if (row.status === 'unresolved') {
      unresolved += 1;
      blockerOf(row.blocker, findings, 'rights', at + '.blocker', true);
    } else {
      push(findings, 'rights', 'status must be resolved or unresolved', at + '.status');
    }
    for (const kind of artifactKinds) {
      if (typeof kind !== 'string' || kind.length === 0) continue;
      const bucket = kinds.get(kind) ?? { records: 0, resolved: 0, unresolved: 0 };
      bucket.records += 1;
      if (row.status === 'resolved') bucket.resolved += 1;
      if (row.status === 'unresolved') bucket.unresolved += 1;
      kinds.set(kind, bucket);
    }
  });
  for (const id of REQUIRED_ORGANIZATIONS) {
    if (!organizations.has(id)) push(findings, 'rights', 'rights do not cover ' + id, 'rights.records');
  }
  for (const kind of REQUIRED_ARTIFACT_KINDS) {
    if (!kinds.has(kind)) push(findings, 'rights', 'rights do not cover ' + kind, 'rights.artifact_kinds');
  }
  if (Array.isArray(document.artifact_gaps)) {
    document.artifact_gaps.forEach((gap, index) => {
      const at = 'rights.artifact_gaps[' + index + ']';
      if (!isObject(gap) || !isNonEmpty(gap.kind) || (gap.status !== 'resolved' && gap.status !== 'unresolved')) {
        push(findings, 'rights', 'artifact gap needs a kind and a status', at);
        return;
      }
      if (gap.status === 'unresolved') blockerOf(gap.blocker, findings, 'rights', at + '.blocker', true);
      if (gap.status === 'resolved' && gap.blocker !== null) push(findings, 'rights', 'a resolved gap cannot also be blocked', at + '.blocker');
    });
  }
  if (isObject(document.summary)) {
    if (document.summary.datasets !== undefined && document.summary.datasets !== records.length) {
      push(findings, 'rights', 'rights summary dataset count drifted', 'rights.summary.datasets');
    }
    if (document.summary.resolved !== undefined && document.summary.resolved !== resolved) {
      push(findings, 'rights', 'rights summary resolved count drifted', 'rights.summary.resolved');
    }
    if (document.summary.unresolved !== undefined && document.summary.unresolved !== unresolved) {
      push(findings, 'rights', 'rights summary unresolved count drifted', 'rights.summary.unresolved');
    }
    if (isObject(document.summary.by_artifact_kind)) {
      for (const [kind, bucket] of kinds) {
        const published = document.summary.by_artifact_kind[kind];
        if (!isObject(published)) continue;
        if (published.records !== bucket.records || published.resolved !== bucket.resolved || published.unresolved !== bucket.unresolved) {
          push(findings, 'rights', 'rights summary drifted for ' + kind, 'rights.summary.by_artifact_kind.' + kind);
        }
      }
    }
  }
  return findings;
}

export function auditSchema(document: unknown): Finding[] {
  const findings: Finding[] = [];
  if (!isObject(document)) {
    push(findings, 'schema', 'catalog schema must be an object', 'schema');
    return findings;
  }
  if (document.$schema !== 'https://json-schema.org/draft/2020-12/schema') {
    push(findings, 'schema', 'catalog schema must use JSON Schema 2020-12', 'schema.$schema');
  }
  if (document.type !== 'object' || document.additionalProperties !== false) {
    push(findings, 'schema', 'catalog schema must close the cell', 'schema.additionalProperties');
  }
  const required = new Set(Array.isArray(document.required) ? document.required : []);
  for (const field of ['coverage_state', 'record_denominator', 'collection_count', 'legal_completeness', 'as_of', 'integrity']) {
    if (!required.has(field)) push(findings, 'schema', 'catalog schema must require ' + field, 'schema.required.' + field);
  }
  const properties = isObject(document.properties) ? document.properties : {};
  const coverage = properties.coverage_state;
  const enums = isObject(coverage) && Array.isArray(coverage.enum) ? coverage.enum : [];
  if (enums.length !== COVERAGE_STATES.length || COVERAGE_STATES.some((state) => !enums.includes(state))) {
    push(findings, 'schema', 'coverage_state enum must be exactly known, partial, missing, unknown and unavailable', 'schema.properties.coverage_state');
  }
  const legal = properties.legal_completeness;
  const legalEnum = isObject(legal) && Array.isArray(legal.enum) ? legal.enum : [];
  if (!legalEnum.includes('not_claimed') || legalEnum.includes('complete')) {
    push(findings, 'schema', 'legal completeness must stay not_claimed', 'schema.properties.legal_completeness');
  }
  for (const field of ['record_denominator', 'collection_count']) {
    const property = properties[field];
    if (!isObject(property) || property.type !== 'integer' || property.minimum !== 0) {
      push(findings, 'schema', field + ' must be a non-negative integer', 'schema.properties.' + field);
    }
  }
  const asOf = properties.as_of;
  if (!isObject(asOf) || asOf.type !== 'string' || typeof asOf.minLength !== 'number' || asOf.minLength < 10) {
    push(findings, 'schema', 'as_of must be a date string', 'schema.properties.as_of');
  }
  const integrity = properties.integrity;
  const digest = isObject(integrity) && isObject(integrity.properties) ? integrity.properties.sha256 : null;
  if (!isObject(integrity) || integrity.type !== 'object' || integrity.additionalProperties !== false || !Array.isArray(integrity.required) || !integrity.required.includes('sha256') || !isObject(digest) || digest.pattern !== '^[0-9a-f]{64}$') {
    push(findings, 'schema', 'integrity.sha256 must be a 64 digit hex digest', 'schema.properties.integrity');
  }
  return findings;
}

function countLevels(entries: readonly Record<string, unknown>[]): { sums: Record<CollectionLevel, number>; counts: Record<CollectionLevel, number>; ingestedNational: number; ingestedLocal: number } {
  const sums: Record<CollectionLevel, number> = { national: 0, regional: 0, municipal: 0, other: 0 };
  const counts: Record<CollectionLevel, number> = { national: 0, regional: 0, municipal: 0, other: 0 };
  let ingestedNational = 0;
  let ingestedLocal = 0;
  for (const entry of entries) {
    const level = entry.level;
    if (level === 'national' || level === 'regional' || level === 'municipal' || level === 'other') {
      counts[level] += 1;
      if (isInteger(entry.record_count) && entry.record_count >= 0) sums[level] += entry.record_count;
      if (entry.disposition === 'ingested' && isInteger(entry.record_count) && entry.record_count >= 0) {
        if (level === 'national') ingestedNational += entry.record_count;
        if (level === 'municipal') ingestedLocal += entry.record_count;
      }
    }
  }
  return { sums, counts, ingestedNational, ingestedLocal };
}

export function auditCoverage(coverage: unknown, ledger: unknown, pins: { inventorySha256: string; dispositionSha256: string; rightsSha256: string }): Finding[] {
  const findings: Finding[] = [];
  if (!isObject(ledger) || ledger.schema !== 'worldwide-legal-search.ingestion-ledger@1') {
    push(findings, 'coverage', 'ledger schema is not pinned', 'ledger.schema');
  }
  if (!isObject(coverage) || coverage.schema !== 'worldwide-legal-search.coverage-audit@1') {
    push(findings, 'coverage', 'coverage schema is not pinned', 'coverage.schema');
  }
  if (!isObject(ledger) || !isObject(coverage)) return findings;
  if (ledger.inventory_revision !== pins.inventorySha256 || coverage.inventory_revision !== pins.inventorySha256) {
    push(findings, 'coverage', 'coverage must bind the inventory bytes', 'coverage.inventory_revision');
  }
  if (ledger.disposition_revision !== pins.dispositionSha256 || coverage.disposition_revision !== pins.dispositionSha256) {
    push(findings, 'coverage', 'coverage must bind the disposition bytes', 'coverage.disposition_revision');
  }
  if (ledger.rights_sha256 !== pins.rightsSha256) push(findings, 'coverage', 'ledger rights digest does not match the rights bytes', 'ledger.rights_sha256');
  if (ledger.legal_completeness !== 'not_claimed' || coverage.legal_completeness !== 'not_claimed') {
    push(findings, 'coverage', 'coverage must not claim legal completeness', 'coverage.legal_completeness');
  }
  if (ledger.counts_are_not_legal_completeness !== true || coverage.counts_are_not_legal_completeness !== true) {
    push(findings, 'coverage', 'counts are not legal completeness', 'coverage.counts_are_not_legal_completeness');
  }
  const entries = Array.isArray(ledger.entries) ? ledger.entries : [];
  if (entries.length === 0) push(findings, 'coverage', 'ledger entries are required', 'ledger.entries');
  const rows: Record<string, unknown>[] = [];
  const levels = new Set<string>();
  entries.forEach((entry, index) => {
    const at = 'ledger.entries[' + index + ']';
    if (!isObject(entry)) {
      push(findings, 'coverage', 'ledger entry must be an object', at);
      return;
    }
    rows.push(entry);
    if (entry.public !== true) push(findings, 'coverage', 'the ledger lists public collections', at + '.public');
    if (typeof entry.dataset_id !== 'string' || !DATASET_ID.test(entry.dataset_id)) push(findings, 'coverage', 'dataset id is required', at + '.dataset_id');
    if (entry.level !== 'national' && entry.level !== 'regional' && entry.level !== 'municipal' && entry.level !== 'other') {
      push(findings, 'coverage', 'level is not a known collection level', at + '.level');
    } else levels.add(entry.level);
    if (!isNonEmpty(entry.disposition)) push(findings, 'coverage', 'disposition is required', at + '.disposition');
    if (entry.record_count !== null && (!isInteger(entry.record_count) || entry.record_count < 0)) {
      push(findings, 'coverage', 'record_count must be null or a non-negative integer', at + '.record_count');
    }
  });
  if (!levels.has('national') || !levels.has('municipal')) {
    push(findings, 'coverage', 'national and municipal collections must both be traceable', 'ledger.entries');
  }
  const counted = countLevels(rows);
  const expected: Record<string, number> = {
    national_count: counted.sums.national,
    local_count: counted.sums.municipal,
    regional_count: counted.sums.regional,
    other_count: counted.sums.other,
  };
  for (const [field, total] of Object.entries(expected)) {
    if (coverage[field] !== total) push(findings, 'coverage', field + ' does not match the ledger', 'coverage.' + field);
  }
  if (coverage.entry_count !== entries.length) push(findings, 'coverage', 'entry_count does not match the ledger', 'coverage.entry_count');
  const trace = Array.isArray(coverage.trace) ? coverage.trace : [];
  if (trace.length !== entries.length) push(findings, 'coverage', 'coverage trace must list every ledger entry', 'coverage.trace');
  entries.forEach((entry, index) => {
    const item = trace[index];
    if (!isObject(entry) || !isObject(item) || item.dataset_id !== entry.dataset_id || item.level !== entry.level || item.record_count !== entry.record_count) {
      push(findings, 'coverage', 'coverage trace drifted from ledger entry ' + index, 'coverage.trace[' + index + ']');
    }
  });
  if (isObject(coverage.level_entry_counts)) {
    for (const level of COLLECTION_LEVELS) {
      if (coverage.level_entry_counts[level] !== counted.counts[level]) {
        push(findings, 'coverage', 'level entry count drifted for ' + level, 'coverage.level_entry_counts.' + level);
      }
    }
  }
  if (coverage.ingested_national_count !== undefined && coverage.ingested_national_count !== counted.ingestedNational) {
    push(findings, 'coverage', 'ingested national count drifted', 'coverage.ingested_national_count');
  }
  if (coverage.ingested_local_count !== undefined && coverage.ingested_local_count !== counted.ingestedLocal) {
    push(findings, 'coverage', 'ingested local count drifted', 'coverage.ingested_local_count');
  }
  if (isInteger(ledger.verified_ingest_receipts) || isInteger(coverage.verified_ingest_receipts)) {
    if (ledger.verified_ingest_receipts !== coverage.verified_ingest_receipts) {
      push(findings, 'coverage', 'verified ingest receipts drifted', 'coverage.verified_ingest_receipts');
    }
  }
  if (Array.isArray(ledger.admitted_child_tasks) && coverage.admitted_child_tasks !== ledger.admitted_child_tasks.length) {
    push(findings, 'coverage', 'admitted child tasks drifted', 'coverage.admitted_child_tasks');
  }
  for (const field of ['eligible_datasets', 'blocked_datasets', 'excluded_datasets']) {
    if (ledger[field] !== undefined && coverage[field] !== undefined && ledger[field] !== coverage[field]) {
      push(findings, 'coverage', field + ' drifted between the ledger and the coverage audit', 'coverage.' + field);
    }
  }
  return findings;
}

function auditGeography(document: unknown, findings: Finding[]): void {
  if (!isObject(document) || document.schema !== 'worldwide-legal-search.geography-manifest@1') {
    push(findings, 'schema', 'geography schema is not pinned', 'geography.schema');
    return;
  }
  if (typeof document.dataset_id !== 'string' || !DATASET_ID.test(document.dataset_id)) {
    push(findings, 'schema', 'geography dataset id is required', 'geography.dataset_id');
  }
  if (typeof document.revision !== 'string') push(findings, 'pin', 'geography revision must be pinned', 'geography.revision');
  else {
    try {
      pinRevision(document.revision);
    } catch (error) {
      push(findings, 'pin', error instanceof Error ? error.message : 'geography revision must be pinned', 'geography.revision');
    }
  }
  if (!isNonEmpty(document.license) || !isNonEmpty(document.attribution)) {
    push(findings, 'rights', 'geography needs a license and attribution', 'geography.license');
  }
  if (document.complete_world !== false) push(findings, 'coverage', 'a place pack is not every municipality on earth', 'geography.complete_world');
  if (document.hierarchical !== true) push(findings, 'schema', 'geography layout must be hierarchical', 'geography.hierarchical');
  if (document.municipality_detail !== 'available' && document.municipality_detail !== 'partial' && document.municipality_detail !== 'unavailable') {
    push(findings, 'coverage', 'municipality detail must be available, partial, or unavailable', 'geography.municipality_detail');
  }
}

export function auditRefresh(snapshot: RefreshSnapshot): { rights: Finding[]; schema: Finding[]; coverage: Finding[] } {
  const rights = auditRights(snapshot.rights, snapshot.pins);
  const schema = auditSchema(snapshot.schema);
  const coverage = auditCoverage(snapshot.coverage, snapshot.ledger, snapshot.pins);
  auditGeography(snapshot.geography, schema);
  auditInventory(snapshot.inventory, schema);
  auditDispositions(snapshot.dispositions, snapshot.pins.inventorySha256, schema);
  return { rights, schema, coverage };
}

function rightsSummary(document: unknown): AuditSummary['rights'] {
  const records = isObject(document) && Array.isArray(document.records) ? document.records : [];
  const organizations = new Set<string>();
  const kinds = new Set<string>();
  let resolved = 0;
  let unresolved = 0;
  for (const row of records) {
    if (!isObject(row)) continue;
    if (typeof row.dataset_id === 'string') organizations.add(row.dataset_id.split('/')[0]);
    if (row.status === 'resolved') resolved += 1;
    if (row.status === 'unresolved') unresolved += 1;
    if (Array.isArray(row.artifact_kinds)) {
      for (const kind of row.artifact_kinds) if (typeof kind === 'string') kinds.add(kind);
    }
  }
  return {
    ok: true,
    datasets: records.length,
    resolved,
    unresolved,
    organizations: [...organizations].sort(),
    artifactKinds: [...kinds].sort(),
  };
}

function buildAudit(snapshot: RefreshSnapshot, coverage: unknown): AuditSummary {
  const coverageRecord = isObject(coverage) ? coverage : {};
  return {
    ok: true,
    rights: rightsSummary(snapshot.rights),
    schema: { ok: true, coverageStates: COVERAGE_STATES, legalCompleteness: 'not_claimed' },
    coverage: {
      ok: true,
      states: COVERAGE_STATES,
      nationalCount: coverageRecord.national_count as number,
      localCount: coverageRecord.local_count as number,
      regionalCount: coverageRecord.regional_count as number,
      otherCount: coverageRecord.other_count as number,
      entryCount: coverageRecord.entry_count as number,
      legalCompleteness: 'not_claimed',
      countsAreNotLegalCompleteness: true,
    },
  };
}

function ownershipBody(): ManifestBody['ownership'] {
  return {
    sourceMaintenance: OWNERSHIP.sourceMaintenance,
    hostSupervisor: OWNERSHIP.hostSupervisor,
    sourceMaintenanceOwns: [...OWNERSHIP.sourceMaintenanceOwns],
    hostSupervisorOwns: [...OWNERSHIP.hostSupervisorOwns],
    credentialsEnterSite: false,
  };
}

function documentSchema(value: unknown): string {
  return isObject(value) && typeof value.schema === 'string' ? value.schema : isObject(value) && typeof value.$schema === 'string' ? value.$schema : '';
}

function buildBody(parentSnapshotId: string | null, asOf: string, pins: PinRecord[], changes: PinChange[], audit: AuditSummary): { snapshotId: string; body: ManifestBody; text: string; manifestSha256: string } {
  const identity = {
    schema: MANIFEST_SCHEMA,
    schemaVersion: SCHEMA_VERSION,
    parentSnapshotId,
    asOf,
    ownership: ownershipBody(),
    pins,
    changes,
    audit,
  };
  const snapshotId = sha256Text(canonicalJson(identity));
  const body: ManifestBody = { ...identity, snapshotId };
  const manifestSha256 = sha256Text(canonicalJson(body));
  const text = `${canonicalJson({ ...body, integrity: { sha256: manifestSha256 } })}\n`;
  return { snapshotId, body, text, manifestSha256 };
}

function pointerFrom(snapshotId: string, manifestSha256: string, updatedAt: string): RefreshPointer {
  return { schema: POINTER_SCHEMA, schemaVersion: SCHEMA_VERSION, snapshotId, manifestSha256, updatedAt };
}

function pointerText(pointer: RefreshPointer): string {
  return `${canonicalJson(pointer)}\n`;
}

function parsePointer(text: string, raw: Buffer): RefreshPointer | null {
  if (!Buffer.from(text, 'utf8').equals(raw)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return null;
  }
  if (!isObject(parsed) || parsed.schema !== POINTER_SCHEMA || parsed.schemaVersion !== SCHEMA_VERSION) return null;
  if (typeof parsed.snapshotId !== 'string' || !SHA256_HEX.test(parsed.snapshotId)) return null;
  if (typeof parsed.manifestSha256 !== 'string' || !SHA256_HEX.test(parsed.manifestSha256)) return null;
  if (typeof parsed.updatedAt !== 'string' || !AS_OF.test(parsed.updatedAt)) return null;
  const pointer = pointerFrom(parsed.snapshotId, parsed.manifestSha256, parsed.updatedAt);
  if (canonicalJson(pointer) + '\n' !== text) return null;
  return pointer;
}

async function readPointer(root: string, name: string): Promise<{ pointer: RefreshPointer | null; raw: Buffer | null; corrupt: boolean }> {
  const full = path.join(root, name);
  let raw: Buffer;
  try {
    raw = await readFile(full);
  } catch (error) {
    if (errnoCode(error) === 'ENOENT') return { pointer: null, raw: null, corrupt: false };
    throw error;
  }
  const pointer = parsePointer(raw.toString('utf8'), raw);
  return { pointer, raw, corrupt: pointer === null };
}

function manifestValue(parsed: unknown): StoreManifest | null {
  if (!isObject(parsed) || parsed.schema !== MANIFEST_SCHEMA || parsed.schemaVersion !== SCHEMA_VERSION) return null;
  if (typeof parsed.snapshotId !== 'string' || !SHA256_HEX.test(parsed.snapshotId)) return null;
  if (!(parsed.parentSnapshotId === null || (typeof parsed.parentSnapshotId === 'string' && SHA256_HEX.test(parsed.parentSnapshotId)))) return null;
  if (typeof parsed.asOf !== 'string' || !AS_OF.test(parsed.asOf)) return null;
  if (!isObject(parsed.integrity) || parsed.integrity.sha256 !== undefined && typeof parsed.integrity.sha256 !== 'string') return null;
  const integrity = parsed.integrity.sha256;
  if (typeof integrity !== 'string' || !SHA256_HEX.test(integrity)) return null;
  const { integrity: _ignored, ...body } = parsed;
  void _ignored;
  if (sha256Text(canonicalJson(body)) !== integrity) return null;
  const { snapshotId: _id, ...identity } = body;
  void _id;
  if (sha256Text(canonicalJson(identity)) !== parsed.snapshotId) return null;
  return parsed as unknown as StoreManifest;
}

async function readManifest(root: string, snapshotId: string): Promise<StoreManifest> {
  if (!SHA256_HEX.test(snapshotId)) throw new RefreshError('rollback', 'snapshot id is not a sha256');
  const full = path.join(root, 'snapshots', snapshotId, 'manifest.json');
  assertInside(root, full);
  let raw: Buffer;
  try {
    raw = await readFile(full);
  } catch (error) {
    if (errnoCode(error) === 'ENOENT') throw new RefreshError('rollback', 'snapshot manifest is not in the store');
    throw error;
  }
  const text = raw.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(raw)) throw new RefreshError('rollback', 'snapshot manifest is not valid UTF-8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new RefreshError('rollback', 'snapshot manifest is not valid JSON');
  }
  const manifest = manifestValue(parsed);
  if (!manifest || canonicalJson(manifest) + '\n' !== text) throw new RefreshError('rollback', 'snapshot manifest integrity does not match');
  return manifest;
}

async function verifyPointer(root: string, pointer: RefreshPointer): Promise<StoreManifest> {
  const manifest = await readManifest(root, pointer.snapshotId);
  if (manifest.integrity.sha256 !== pointer.manifestSha256 || manifest.asOf !== pointer.updatedAt) {
    throw new RefreshError('rollback', 'current pointer does not match the snapshot manifest');
  }
  return manifest;
}

async function ensureSnapshot(root: string, snapshotId: string, text: string): Promise<void> {
  const snapshotDir = path.join(root, 'snapshots', snapshotId);
  const manifestPath = path.join(snapshotDir, 'manifest.json');
  try {
    const existing = await readFile(manifestPath, 'utf8');
    if (existing !== text) throw new RefreshError('pin', 'snapshot id already exists with different manifest bytes');
    return;
  } catch (error) {
    if (error instanceof RefreshError) throw error;
    if (errnoCode(error) !== 'ENOENT') throw error;
  }
  try {
    const info = await stat(snapshotDir);
    if (info.isDirectory()) throw new RefreshError('pin', 'snapshot directory exists without a matching manifest');
  } catch (error) {
    if (error instanceof RefreshError) throw error;
    if (errnoCode(error) !== 'ENOENT') throw error;
  }
  const staging = path.join(root, 'staging', snapshotId);
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  try {
    await atomicWrite(root, path.join(staging, 'manifest.json'), text);
    await bestEffortSyncDir(staging);
    await mkdir(path.join(root, 'snapshots'), { recursive: true });
    await rename(staging, snapshotDir);
    await bestEffortSyncDir(path.join(root, 'snapshots'));
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
  await rm(path.join(root, 'staging'), { recursive: true, force: true });
}

async function writeQuarantine(root: string, findings: Finding[], snapshotId: string | null): Promise<void> {
  const body = {
    schema: QUARANTINE_SCHEMA,
    schemaVersion: SCHEMA_VERSION,
    poisonedCurrent: false,
    rolledBack: true,
    currentSnapshotId: snapshotId,
    findings,
  };
  const quarantineId = sha256Text(canonicalJson(body));
  const record = { ...body, quarantineId };
  const text = `${canonicalJson(record)}\n`;
  const directory = path.join(root, 'quarantine');
  await mkdir(directory, { recursive: true });
  const target = path.join(directory, quarantineId + '.json');
  assertInside(root, target);
  try {
    const existing = await readFile(target, 'utf8');
    if (existing !== text) throw new RefreshError('pin', 'quarantine id already exists with different bytes');
    return;
  } catch (error) {
    if (error instanceof RefreshError) throw error;
    if (errnoCode(error) !== 'ENOENT') throw error;
  }
  await atomicWrite(root, target, text);
}

function samePins(previous: readonly PinRecord[], next: readonly PinRecord[]): boolean {
  if (previous.length !== next.length) return false;
  const byRole = new Map(previous.map((pin) => [pin.role, pin.sha256]));
  return next.every((pin) => byRole.get(pin.role) === pin.sha256);
}

function changesFrom(previous: readonly PinRecord[] | null, pins: readonly PinRecord[]): PinChange[] {
  const byRole = new Map((previous ?? []).map((pin) => [pin.role, pin.sha256]));
  return pins.map((pin) => {
    const previousSha256 = byRole.get(pin.role) ?? null;
    return { ...pin, previousSha256, changed: previousSha256 !== pin.sha256 };
  });
}

function failureResult(snapshotId: string | null, findings: Finding[], changes: PinChange[]): PublishResult {
  return {
    ok: false,
    schema: REFRESH_SCHEMA,
    action: 'rollback',
    snapshotId,
    parentSnapshotId: null,
    asOf: null,
    changed: false,
    poisonedCurrent: false,
    rolledBack: true,
    changes,
    ownership: OWNERSHIP,
    audit: null,
    findings,
  };
}

export async function publishRefresh(options: PublishOptions = {}): Promise<PublishResult> {
  const repoRoot = path.resolve(options.repoRoot ?? ROOT);
  const inputs = await loadInputs(repoRoot, options.inputs ?? {});
  const mapped = inputMap(inputs);
  const findings: Finding[] = [];
  for (const item of inputs) {
    const secret = credentialFinding(item.text, item.path);
    if (secret) findings.push(secret);
  }
  const pinsForAudit = {
    inventorySha256: mapped.inventory.sha256,
    dispositionSha256: mapped.dispositions.sha256,
    rightsSha256: mapped.rights.sha256,
  };
  const reports = auditRefresh({
    rights: mapped.rights.value,
    schema: mapped.schema.value,
    coverage: mapped.coverage.value,
    ledger: mapped.ledger.value,
    geography: mapped.geography.value,
    inventory: mapped.inventory.value,
    dispositions: mapped.dispositions.value,
    pins: pinsForAudit,
  });
  findings.push(...reports.rights, ...reports.schema, ...reports.coverage);
  const asOf = findings.length === 0 ? selectAsOf(mapped.inventory.value, options.asOf) : null;
  const pinRecords: PinRecord[] = inputs.map((item) => ({
    role: item.role,
    path: item.path,
    sha256: item.sha256,
    documentSchema: documentSchema(item.value),
  }));
  const checkOnly = options.checkOnly === true || !options.storeDir;
  if (checkOnly && !options.storeDir) {
    const changes = changesFrom(null, pinRecords);
    if (findings.length || !asOf) return failureResult(null, findings, changes);
    const built = buildBody(null, asOf, pinRecords, changes, buildAudit({
      rights: mapped.rights.value,
      schema: mapped.schema.value,
      coverage: mapped.coverage.value,
      ledger: mapped.ledger.value,
      geography: mapped.geography.value,
      inventory: mapped.inventory.value,
      dispositions: mapped.dispositions.value,
      pins: pinsForAudit,
    }, mapped.coverage.value));
    return {
      ok: true,
      schema: REFRESH_SCHEMA,
      action: 'check',
      snapshotId: built.snapshotId,
      parentSnapshotId: null,
      asOf,
      changed: changes.some((change) => change.changed),
      poisonedCurrent: false,
      rolledBack: false,
      changes,
      ownership: OWNERSHIP,
      audit: built.body.audit,
      findings: [],
    };
  }
  const store = await openStore(repoRoot, options.storeDir as string);
  const lock = await acquireLock(store);
  try {
    const current = await readPointer(store, 'current.json');
    if (current.corrupt) throw new RefreshError('rollback', 'current pointer is corrupt; rollback target was not invented');
    let previousPins: PinRecord[] | null = null;
    let parentSnapshotId: string | null = null;
    if (current.pointer) {
      const manifest = await verifyPointer(store, current.pointer);
      previousPins = manifest.pins;
      parentSnapshotId = current.pointer.snapshotId;
    }
    const changes = changesFrom(previousPins, pinRecords);
    if (findings.length || !asOf) {
      if (options.storeDir && !checkOnly) await writeQuarantine(store, findings, parentSnapshotId);
      const after = await readPointer(store, 'current.json');
      if (current.raw === null) {
        if (after.raw !== null) throw new RefreshError('rollback', 'audit failure replaced an empty current pointer');
      } else if (after.raw === null || !after.raw.equals(current.raw)) {
        throw new RefreshError('rollback', 'audit failure changed the current pointer');
      }
      return failureResult(parentSnapshotId, findings, changes);
    }
    const audit = buildAudit({
      rights: mapped.rights.value,
      schema: mapped.schema.value,
      coverage: mapped.coverage.value,
      ledger: mapped.ledger.value,
      geography: mapped.geography.value,
      inventory: mapped.inventory.value,
      dispositions: mapped.dispositions.value,
      pins: pinsForAudit,
    }, mapped.coverage.value);
    if (current.pointer && previousPins && samePins(previousPins, pinRecords)) {
      return {
        ok: true,
        schema: REFRESH_SCHEMA,
        action: 'unchanged',
        snapshotId: current.pointer.snapshotId,
        parentSnapshotId: null,
        asOf: current.pointer.updatedAt,
        changed: false,
        poisonedCurrent: false,
        rolledBack: false,
        changes,
        ownership: OWNERSHIP,
        audit,
        findings: [],
      };
    }
    if (checkOnly) {
      const preview = buildBody(parentSnapshotId, asOf, pinRecords, changes, audit);
      return {
        ok: true,
        schema: REFRESH_SCHEMA,
        action: 'check',
        snapshotId: preview.snapshotId,
        parentSnapshotId,
        asOf,
        changed: true,
        poisonedCurrent: false,
        rolledBack: false,
        changes,
        ownership: OWNERSHIP,
        audit,
        findings: [],
      };
    }
    const built = buildBody(parentSnapshotId, asOf, pinRecords, changes, audit);
    await ensureSnapshot(store, built.snapshotId, built.text);
    if (current.pointer && current.raw) {
      await atomicWrite(store, path.join(store, 'previous.json'), current.raw.toString('utf8'));
    }
    const pointer = pointerFrom(built.snapshotId, built.manifestSha256, asOf);
    await atomicWrite(store, path.join(store, 'current.json'), pointerText(pointer));
    await bestEffortSyncDir(store);
    return {
      ok: true,
      schema: REFRESH_SCHEMA,
      action: 'publish',
      snapshotId: built.snapshotId,
      parentSnapshotId,
      asOf,
      changed: true,
      poisonedCurrent: false,
      rolledBack: false,
      changes,
      ownership: OWNERSHIP,
      audit,
      findings: [],
    };
  } finally {
    await releaseLock(store, lock);
  }
}

export async function rollback(storeDir: string, repoRoot = ROOT): Promise<RollbackResult> {
  if (typeof storeDir !== 'string' || !storeDir.trim()) throw new RefreshError('rollback', 'rollback target required');
  const store = await openStore(repoRoot, storeDir);
  const lock = await acquireLock(store);
  try {
    const current = await readPointer(store, 'current.json');
    const previous = await readPointer(store, 'previous.json');
    if (current.corrupt || previous.corrupt) throw new RefreshError('rollback', 'rollback refused a corrupt pointer');
    if (!previous.pointer || !previous.raw) throw new RefreshError('rollback', 'rollback target required');
    await verifyPointer(store, previous.pointer);
    if (current.pointer) await verifyPointer(store, current.pointer);
    await atomicWrite(store, path.join(store, 'current.json'), previous.raw.toString('utf8'));
    if (current.raw) await atomicWrite(store, path.join(store, 'previous.json'), current.raw.toString('utf8'));
    await bestEffortSyncDir(store);
    return {
      ok: true,
      schema: REFRESH_SCHEMA,
      action: 'rollback',
      restoredSnapshotId: previous.pointer.snapshotId,
      displacedSnapshotId: current.pointer ? current.pointer.snapshotId : null,
      poisonedCurrent: false,
    };
  } finally {
    await releaseLock(store, lock);
  }
}

async function writeHashed(file: string, value: unknown): Promise<string> {
  const text = `${JSON.stringify(value)}\n`;
  await writeFile(file, text);
  return sha256Text(text);
}

function minimalSchema(): Record<string, unknown> {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    additionalProperties: false,
    required: ['coverage_state', 'record_denominator', 'collection_count', 'legal_completeness', 'as_of', 'integrity'],
    properties: {
      coverage_state: { enum: [...COVERAGE_STATES] },
      record_denominator: { type: 'integer', minimum: 0 },
      collection_count: { type: 'integer', minimum: 0 },
      legal_completeness: { enum: ['not_claimed'] },
      as_of: { type: 'string', minLength: 10 },
      integrity: {
        type: 'object',
        additionalProperties: false,
        required: ['sha256'],
        properties: { sha256: { type: 'string', pattern: '^[0-9a-f]{64}$' } },
      },
    },
  };
}

function assertCheck(condition: unknown, message: string): void {
  if (!condition) throw new RefreshError('pin', message);
}

export async function selfTestRefresh(): Promise<{ ok: true; schema: typeof REFRESH_SCHEMA; checks: number }> {
  assertCheck(pinRevision('A'.repeat(40)) === 'a'.repeat(40), 'pinRevision did not canonicalize hex');
  let rejected = false;
  try {
    pinRevision('main');
  } catch (error) {
    rejected = error instanceof RefreshError && error.code === 'pin';
  }
  assertCheck(rejected, 'pinRevision accepted a floating revision');
  const parent = await mkdirTemp('wwl-refresh-selftest-');
  const site = path.join(parent, 'site');
  const store = path.join(parent, 'store');
  await mkdir(site, { recursive: true });
  try {
    const inventory = {
      schema: 'worldwide-legal-search.source-inventory@1',
      retrieved_at: '2026-10-30T09:39:25.250Z',
      organizations: [
        { id: 'justicedao', pagination: { exhausted: true }, datasets: [{ dataset_id: 'justicedao/example_laws', resolved_revision: 'a'.repeat(40) }] },
        { id: 'endomorphosis', pagination: { exhausted: true }, datasets: [{ dataset_id: 'endomorphosis/example_laws', resolved_revision: 'b'.repeat(40) }] },
      ],
    };
    const inventorySha = await writeHashed(path.join(site, 'inventory.json'), inventory);
    const dispositions = { schema: 'worldwide-legal-search.source-dispositions@1', inventory_revision: inventorySha };
    const dispositionSha = await writeHashed(path.join(site, 'dispositions.json'), dispositions);
    const rights = {
      schema: 'worldwide-legal-search.rights@1',
      inventory_revision: inventorySha,
      disposition_revision: dispositionSha,
      organization_membership_is_not_a_license: true,
      records: [
        {
          dataset_id: 'justicedao/example_laws',
          artifact_revision: 'a'.repeat(40),
          restrictions: [],
          inferred_from_organization: false,
          artifact_kinds: ['text', 'translation'],
          rights: 'CC0-1.0',
          attribution: 'Example dedication for the pinned revision.',
          status: 'resolved',
          blocker: null,
        },
        {
          dataset_id: 'endomorphosis/example_laws',
          artifact_revision: 'b'.repeat(40),
          restrictions: [],
          inferred_from_organization: false,
          artifact_kinds: ['embedding', 'boundary', 'index'],
          rights: null,
          attribution: null,
          status: 'unresolved',
          blocker: { kind: 'rights', reason: 'The pinned card states no dataset-wide grant. Organization membership was not used.' },
        },
      ],
    };
    const rightsSha = await writeHashed(path.join(site, 'rights.json'), rights);
    const entries = [
      { dataset_id: 'justicedao/example_laws', public: true, level: 'national', disposition: 'blocked', record_count: 4, receipt_id: null },
      { dataset_id: 'endomorphosis/example_laws', public: true, level: 'municipal', disposition: 'blocked', record_count: 2, receipt_id: null },
    ];
    await writeHashed(path.join(site, 'ledger.json'), {
      schema: 'worldwide-legal-search.ingestion-ledger@1',
      inventory_revision: inventorySha,
      disposition_revision: dispositionSha,
      rights_sha256: rightsSha,
      legal_completeness: 'not_claimed',
      counts_are_not_legal_completeness: true,
      admitted_child_tasks: [],
      verified_ingest_receipts: 0,
      eligible_datasets: 2,
      blocked_datasets: 2,
      excluded_datasets: 0,
      entries,
    });
    await writeHashed(path.join(site, 'coverage.json'), {
      schema: 'worldwide-legal-search.coverage-audit@1',
      inventory_revision: inventorySha,
      disposition_revision: dispositionSha,
      national_count: 4,
      regional_count: 0,
      local_count: 2,
      other_count: 0,
      entry_count: 2,
      legal_completeness: 'not_claimed',
      counts_are_not_legal_completeness: true,
      verified_ingest_receipts: 0,
      admitted_child_tasks: 0,
      eligible_datasets: 2,
      blocked_datasets: 2,
      excluded_datasets: 0,
      level_entry_counts: { national: 1, regional: 0, municipal: 1, other: 0 },
      ingested_national_count: 0,
      ingested_local_count: 0,
      trace: entries.map((entry) => ({ dataset_id: entry.dataset_id, level: entry.level, record_count: entry.record_count })),
    });
    await writeHashed(path.join(site, 'schema.json'), minimalSchema());
    const geography = {
      schema: 'worldwide-legal-search.geography-manifest@1',
      dataset_id: 'example/boundaries',
      revision: 'c'.repeat(40),
      license: 'CC-BY-4.0',
      attribution: 'Example boundary contributors',
      municipality_detail: 'partial',
      complete_world: false,
      hierarchical: true,
    };
    await writeHashed(path.join(site, 'geography.json'), geography);
    const inputs = {
      inventory: 'inventory.json',
      dispositions: 'dispositions.json',
      rights: 'rights.json',
      schema: 'schema.json',
      coverage: 'coverage.json',
      ledger: 'ledger.json',
      geography: 'geography.json',
    };
    const first = await publishRefresh({ repoRoot: site, storeDir: store, inputs });
    assertCheck(first.ok && first.action === 'publish' && first.snapshotId, 'first publish did not pin a snapshot');
    const again = await publishRefresh({ repoRoot: site, storeDir: store, inputs });
    assertCheck(again.ok && again.action === 'unchanged' && again.snapshotId === first.snapshotId, 'repeat publish was not idempotent');
    const currentBefore = await readFile(path.join(store, 'current.json'));
    const tamperedRights = JSON.parse(await readFile(path.join(site, 'rights.json'), 'utf8')) as { records: Array<{ inferred_from_organization: boolean }> };
    tamperedRights.records[0].inferred_from_organization = true;
    await writeHashed(path.join(site, 'rights-tampered.json'), tamperedRights);
    const rightsFailure = await publishRefresh({ repoRoot: site, storeDir: store, inputs: { ...inputs, rights: 'rights-tampered.json' } });
    assertCheck(rightsFailure.ok === false && rightsFailure.rolledBack === true && rightsFailure.poisonedCurrent === false, 'rights failure did not roll back');
    assertCheck(rightsFailure.findings.some((finding) => finding.code === 'rights'), 'rights failure was not audited');
    const currentAfterRights = await readFile(path.join(store, 'current.json'));
    assertCheck(currentAfterRights.equals(currentBefore), 'rights failure replaced the current pointer');
    const weakSchema = minimalSchema();
    (weakSchema.properties as { coverage_state: { enum: string[] } }).coverage_state.enum = ['known', 'partial', 'missing', 'unavailable'];
    await writeHashed(path.join(site, 'schema-weak.json'), weakSchema);
    const schemaFailure = await publishRefresh({ repoRoot: site, storeDir: store, inputs: { ...inputs, schema: 'schema-weak.json' } });
    assertCheck(schemaFailure.ok === false && schemaFailure.findings.some((finding) => finding.code === 'schema'), 'schema failure was accepted');
    assertCheck((await readFile(path.join(store, 'current.json'))).equals(currentBefore), 'schema failure replaced the current pointer');
    const leaked = { ...geography, note: ['api', 'key'].join('_') + " = '" + 'abcdef' + 'ghijk' + "'" };
    await writeHashed(path.join(site, 'geography-leaked.json'), leaked);
    const secretFailure = await publishRefresh({ repoRoot: site, storeDir: store, inputs: { ...inputs, geography: 'geography-leaked.json' } });
    assertCheck(secretFailure.ok === false && secretFailure.findings.some((finding) => finding.code === 'secret'), 'credential material was published');
    assertCheck(!JSON.stringify(secretFailure).includes('abcdefghijk'), 'refresh echoed credential material');
    assertCheck((await readFile(path.join(store, 'current.json'))).equals(currentBefore), 'secret failure replaced the current pointer');
    const moved = { ...geography, attribution: 'Example boundary contributors, second pin' };
    await writeHashed(path.join(site, 'geography-next.json'), moved);
    const second = await publishRefresh({ repoRoot: site, storeDir: store, inputs: { ...inputs, geography: 'geography-next.json' } });
    assertCheck(second.ok && second.action === 'publish' && second.parentSnapshotId === first.snapshotId, 'second pin did not record its parent');
    assertCheck(second.snapshotId !== first.snapshotId, 'a changed pin reused the snapshot id');
    const restored = await rollback(store, site);
    assertCheck(restored.restoredSnapshotId === first.snapshotId && restored.displacedSnapshotId === second.snapshotId, 'rollback did not restore the previous manifest');
    const forward = await rollback(store, site);
    assertCheck(forward.restoredSnapshotId === second.snapshotId && forward.displacedSnapshotId === first.snapshotId, 'second rollback did not swap the pointers');
    let outside = false;
    try {
      await publishRefresh({ repoRoot: site, storeDir: path.join(site, 'inside-store'), inputs });
    } catch (error) {
      outside = error instanceof RefreshError && /outside the site/.test(error.message);
    }
    assertCheck(outside, 'an in-site refresh store was accepted');
    let missing = false;
    try {
      await rollback(path.join(parent, 'empty-store'), site);
    } catch (error) {
      missing = error instanceof RefreshError && error.message === 'rollback target required';
    }
    assertCheck(missing, 'rollback invented a target');
    return { ok: true, schema: REFRESH_SCHEMA, checks: 18 };
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
}

async function mkdirTemp(prefix: string): Promise<string> {
  const directory = path.join(tmpdir(), prefix + randomBytes(6).toString('hex'));
  await mkdir(directory, { recursive: true });
  return directory;
}

function argument(argv: string[], name: string): string {
  const index = argv.indexOf(name);
  if (index < 0) return '';
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new RefreshError('pin', name + ' needs a value');
  return value;
}

function mainArguments(argv: string[]): PublishOptions & { rollbackStore: string; selfTest: boolean } {
  const inputs: Partial<Record<InputRole, string>> = {};
  const flags: Record<string, InputRole> = {
    '--inventory': 'inventory',
    '--dispositions': 'dispositions',
    '--rights': 'rights',
    '--schema': 'schema',
    '--coverage': 'coverage',
    '--ledger': 'ledger',
    '--geography': 'geography',
  };
  let checkOnly = false;
  let selfTest = false;
  let rollbackStore = '';
  let storeDir = '';
  let repoRoot = '';
  let asOf = '';
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--check') {
      checkOnly = true;
      continue;
    }
    if (flag === '--self-test') {
      selfTest = true;
      continue;
    }
    if (flag === '--rollback') {
      rollbackStore = argument(argv, '--state');
      continue;
    }
    if (flag === '--state' || flag === '--root' || flag === '--as-of' || flags[flag]) {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new RefreshError('pin', flag + ' needs a value');
      if (flag === '--state') storeDir = value;
      else if (flag === '--root') repoRoot = value;
      else if (flag === '--as-of') asOf = value;
      else inputs[flags[flag]] = value;
      index += 1;
      continue;
    }
    throw new RefreshError('pin', 'unknown argument ' + flag);
  }
  if (argv.includes('--rollback') && !storeDir) throw new RefreshError('rollback', 'rollback target required');
  return {
    repoRoot: repoRoot || undefined,
    storeDir: storeDir || undefined,
    asOf: asOf || undefined,
    inputs,
    checkOnly: checkOnly || (!storeDir && !argv.includes('--rollback')),
    rollbackStore: argv.includes('--rollback') ? storeDir : rollbackStore,
    selfTest,
  };
}

async function main(argv: string[]): Promise<PublishResult | RollbackResult | { ok: true; schema: typeof REFRESH_SCHEMA; checks: number }> {
  const options = mainArguments(argv);
  if (options.selfTest) return selfTestRefresh();
  if (argv.includes('--rollback')) return rollback(options.storeDir as string, options.repoRoot ?? ROOT);
  return publishRefresh(options);
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

if (isDirectRun()) {
  main(process.argv.slice(2)).then((result) => {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    if (!('ok' in result) || result.ok !== true) process.exitCode = 1;
  }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'refresh failed';
    const findings = error instanceof RefreshError ? error.findings : [];
    const code = error instanceof RefreshError ? error.code : 'pin';
    process.stderr.write(JSON.stringify({ ok: false, code, error: message, findings }, null, 2) + '\n');
    process.exit(1);
  });
}

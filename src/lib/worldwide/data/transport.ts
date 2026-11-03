/**
 * Immutable artifact transport and measured Dataset Viewer compatibility.
 *
 * Artifact bytes are content-addressed and capped. A transport instance keeps
 * at most four requests in flight, retries only bounded transient failures,
 * and stops when the caller cancels. Parquet of unknown or country scale is
 * refused. HTTP Range counts only when a probe returns 206 with Content-Range.
 * COOP and COEP response headers are not Pages cross-origin-isolation proof.
 *
 * The Dataset Viewer path pages configs and splits through /splits, /rows,
 * /search, and /filter. Page length stays at most 100. Filter and search are
 * never joined. A joins or pinning flag in a payload is ignored. Viewer rows
 * are withheld from a pinned revision unless the payload commit is that
 * revision. This module does not claim a live production-origin measurement.
 */

import { sha256Bytes } from './identity.ts';

export const TRANSPORT_SCHEMA = 'worldwide-legal-search.transport@1';
export const CAPABILITY_SCHEMA = 'worldwide-legal-search.transport-capability@1';
export const ARTIFACT_SCHEMA = 'worldwide-legal-search.immutable-artifact@1';
export const ARTIFACT_BATCH_SCHEMA = 'worldwide-legal-search.artifact-batch@1';
export const VIEWER_PAGE_SCHEMA = 'worldwide-legal-search.viewer-page@1';
export const VIEWER_LAYOUT_SCHEMA = 'worldwide-legal-search.viewer-layout@1';
export const VIEWER_WALK_SCHEMA = 'worldwide-legal-search.viewer-walk@1';
export const VIEWER_COMPATIBILITY_SCHEMA = 'worldwide-legal-search.viewer-compatibility@1';

export const HUB_ORIGIN = 'https://huggingface.co';
export const VIEWER_ORIGIN = 'https://datasets-server.huggingface.co';
export const DEFAULT_PAGES_ORIGIN = 'https://worldwidelaws.github.io';

export const TRANSPORT_LIMITS = Object.freeze({
  maxAttempts: 4,
  defaultAttempts: 3,
  maxConcurrent: 4,
  maxBackoffMs: 8000,
  baseBackoffMs: 200,
  probeStart: 0,
  probeEnd: 31,
  probeMaxBytes: 64,
  errorBodyMaxBytes: 65536,
  defaultArtifactBytes: 2 * 1024 * 1024,
  absoluteArtifactBytes: 10 * 1024 * 1024,
  sessionArtifactBytes: 10 * 1024 * 1024,
  viewerPageLength: 100,
  viewerMaxPages: 4,
  viewerSessionMaxRows: 400,
  viewerPageMaxBytes: 1024 * 1024,
  viewerSessionMaxBytes: 2 * 1024 * 1024,
  maxMirrors: 3,
  maxOffset: 1_000_000,
  maxQueryChars: 512,
  maxWhereChars: 512,
});

export const VIEWER_JOINS_SUPPORTED = false;
export const VIEWER_REVISION_PIN_SUPPORTED = false;
export const VIEWER_MULTILINGUAL_COMPLETE = false;
export const VIEWER_STEMMING = 'english-porter';

export const TRANSPORT_LIMITATIONS = Object.freeze([
  'Retries stop at 4 attempts. Backoff stops at 8 seconds. A longer Retry-After is not waited out.',
  'Cancellation aborts the in-flight exchange and the backoff wait. An abort is not retried.',
  'CORS is accepted only when Access-Control-Allow-Origin is * or the configured Pages origin. Credentials are omitted. No Authorization header is sent.',
  'Range is accepted only for HTTP 206 whose Content-Range matches the requested bytes. A 200 that ignores Range is not Range support.',
  'COOP and COEP response headers are ignored. They are not proof that GitHub Pages is cross-origin isolated. SharedArrayBuffer is not assumed. Workers stay single-threaded in this module.',
  'Dataset Viewer page length is at most 100. One config and split keeps at most 400 rows and 2 MiB on a transport instance.',
  'Filter and search are separate endpoints. This transport does not join them and does not send a revision query.',
  'A payload flag that claims joins or revision pinning is ignored. Pinning is not a supported Viewer operation.',
  'Viewer search requires a Parquet export, uses English-oriented Porter stemming, and is not a complete multilingual index. partial means the index did not cover the split.',
  'Viewer rows are withheld from a pinned revision unless the payload commit equals that revision. A missing commit is not mixed into pinned bytes.',
  'Parquet of unknown size, and any artifact declared above 10 MiB, is refused. A session stops after 10 MiB of artifact bytes. This module does not walk Range slices to rebuild a country file.',
  'The /parquet and /is-valid endpoints are not consulted. Neither can establish joins, pinning, or a live Pages-origin measurement.',
]);

const DATASET_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const GIT_REVISION = /^[0-9a-f]{40}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const NAME_TOKEN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,80}$/;
const JOIN_WORD = /\bjoin\b/i;
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

export type TransportCode =
  | 'cancelled'
  | 'retry-exhausted'
  | 'retry-after-exceeds-bound'
  | 'http'
  | 'network'
  | 'integrity'
  | 'revision-mismatch'
  | 'revision-unconfirmed'
  | 'revision-mix'
  | 'revision-not-a-pin'
  | 'unbounded-country-download'
  | 'budget-exceeded'
  | 'viewer-join-unsupported'
  | 'viewer-error'
  | 'range-unsupported'
  | 'cors-blocked'
  | 'capability-not-measured'
  | 'shard-fallback-required'
  | 'unsafe-url'
  | 'invalid-request'
  | 'unreadable-body';

export class TransportError extends Error {
  readonly code: TransportCode;
  readonly retryable: boolean;
  readonly attempts: number;
  readonly status: number | null;
  readonly retryAfterMs: number | null;
  readonly responseHeaders: Headers | null;

  constructor(
    code: TransportCode,
    message: string,
    options: {
      retryable?: boolean;
      attempts?: number;
      status?: number | null;
      retryAfterMs?: number | null;
      responseHeaders?: Headers | null;
    } = {},
  ) {
    super(message);
    this.name = 'TransportError';
    this.code = code;
    this.retryable = options.retryable === true;
    this.attempts = options.attempts ?? 0;
    this.status = options.status ?? null;
    this.retryAfterMs = options.retryAfterMs ?? null;
    this.responseHeaders = options.responseHeaders ?? null;
  }
}

export interface TransportLimits {
  maxAttempts: number;
  maxConcurrent: number;
  maxBackoffMs: number;
  baseBackoffMs: number;
}

export interface ArtifactTarget {
  datasetId: string;
  revision: string;
  path: string;
  sha256: string;
  sizeBytes?: number | null;
  mediaType?: string | null;
  maxBytes?: number;
  range?: { start: number; end: number } | null;
  requireConfirmedRevision?: boolean;
}

export interface TransportCapability {
  schema: typeof CAPABILITY_SCHEMA;
  proof: 'measured-response';
  live: false;
  originProof: 'unproven';
  pagesOrigin: string;
  resourceUrl: string;
  cors: boolean;
  allowOrigin: string | null;
  range: boolean;
  acceptRanges: string | null;
  status: number | null;
  contentRange: string | null;
  bodyRefused: boolean;
  shardFallbackRequired: boolean;
  credentials: 'omit';
  crossOriginIsolationAssumed: false;
  sharedArrayBufferAssumed: false;
  workerModel: 'single-thread';
  ignoredIsolationHeaders: string[];
  failure: string | null;
  limitations: readonly string[];
}

export interface ImmutableArtifact {
  schema: typeof ARTIFACT_SCHEMA;
  datasetId: string;
  revision: string;
  path: string;
  sha256: string;
  bytes: Uint8Array;
  sizeBytes: number;
  revisionConfirmed: boolean;
  revisionEvidence: 'header' | 'url' | 'sha256-only';
  contentType: string | null;
  attempts: number;
  url: string;
}

export interface ArtifactBatch {
  schema: typeof ARTIFACT_BATCH_SCHEMA;
  artifacts: ImmutableArtifact[];
  revisions: Record<string, string>;
}

export interface ViewerPageRequest {
  datasetId: string;
  config: string;
  split: string;
  offset?: number;
  length: number;
  kind: 'rows' | 'search' | 'filter';
  query?: string | null;
  where?: string | null;
  requestedRevision?: string | null;
}

export interface ViewerRowPage {
  schema: typeof VIEWER_PAGE_SCHEMA;
  dataset: string;
  config: string;
  split: string;
  kind: 'rows' | 'search' | 'filter';
  offset: number;
  length: number;
  requestedLength: number;
  pageCapApplied: boolean;
  rows: unknown[];
  observedRowCount: number;
  numRowsTotal: number | null;
  numRowsPerPage: number | null;
  partialIndex: boolean;
  truncated: boolean;
  serverExceededCap: boolean;
  withheld: boolean;
  withheldReason: string | null;
  commit: string | null;
  requestedRevision: string | null;
  reconciled: boolean;
  joinsSupported: false;
  revisionPinSupported: false;
  multilingualComplete: false;
  stemming: typeof VIEWER_STEMMING;
  limitations: readonly string[];
  attempts: number;
}

export interface ViewerSplitInfo {
  name: string;
  numRows: number | null;
  numBytes: number | null;
}

export interface ViewerConfigInfo {
  name: string;
  splits: ViewerSplitInfo[];
}

export interface ViewerLayout {
  schema: typeof VIEWER_LAYOUT_SCHEMA;
  dataset: string;
  configs: ViewerConfigInfo[];
  pending: string[];
  failed: string[];
  commit: string | null;
  requestedRevision: string | null;
  foreignDatasetsDropped: number;
  joinsSupported: false;
  revisionPinSupported: false;
  limitations: readonly string[];
}

export interface ViewerWalk {
  schema: typeof VIEWER_WALK_SCHEMA;
  dataset: string;
  config: string;
  split: string;
  pages: ViewerRowPage[];
  rows: unknown[];
  complete: false | true;
  stoppedReason: string | null;
  joinsSupported: false;
  revisionPinSupported: false;
  limitations: readonly string[];
}

export interface ViewerEndpointReport {
  called: boolean;
  ok: boolean;
  status: number | null;
  failure: string | null;
}

export interface ViewerCompatibility {
  schema: typeof VIEWER_COMPATIBILITY_SCHEMA;
  dataset: string;
  live: false;
  originProof: 'unproven';
  layout: ViewerLayout | null;
  endpoints: {
    splits: ViewerEndpointReport;
    rows: ViewerEndpointReport;
    search: ViewerEndpointReport;
    filter: ViewerEndpointReport;
  };
  joinsSupported: false;
  revisionPinSupported: false;
  multilingualComplete: false;
  stemming: typeof VIEWER_STEMMING;
  maxPageLength: 100;
  parquetRequiredForSearch: true;
  ignoredClaims: string[];
  limitations: readonly string[];
}

export interface AccessDecision {
  mode: 'whole' | 'range' | 'refuse';
  url: string;
  code: TransportCode | null;
  reason: string;
  maxBytes: number;
  reserveBytes: number;
  start: number | null;
  end: number | null;
}

export interface TransportDeps {
  fetch?: (input: string, init: RequestInit) => Promise<Response>;
  sleep?: (ms: number, signal: AbortSignal | undefined) => Promise<void>;
  now?: () => number;
  pagesOrigin?: string;
  maxAttempts?: number;
  maxConcurrent?: number;
  maxBackoffMs?: number;
  baseBackoffMs?: number;
}

interface FetchedBody {
  status: number;
  headers: Headers;
  url: string;
  body: Uint8Array;
  attempts: number;
}

interface PreparedViewerRequest {
  datasetId: string;
  config: string;
  split: string;
  offset: number;
  length: number;
  requestedLength: number;
  pageCapApplied: boolean;
  kind: 'rows' | 'search' | 'filter';
  query: string | null;
  where: string | null;
  requestedRevision: string | null;
}

function fail(code: TransportCode, message: string, options?: ConstructorParameters<typeof TransportError>[2]): never {
  throw new TransportError(code, message, options);
}

function hex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

function decodeUtf8(bytes: Uint8Array): string {
  let out = '';
  for (let index = 0; index < bytes.length; index += 1) {
    const first = bytes[index] ?? 0;
    if (first < 0x80) {
      out += String.fromCharCode(first);
      continue;
    }
    let width = 0;
    let point = 0;
    if ((first & 0xe0) === 0xc0) {
      width = 2;
      point = first & 0x1f;
    } else if ((first & 0xf0) === 0xe0) {
      width = 3;
      point = first & 0x0f;
    } else if ((first & 0xf8) === 0xf0) {
      width = 4;
      point = first & 0x07;
    } else {
      throw new Error('bad utf-8');
    }
    if (index + width > bytes.length) throw new Error('bad utf-8');
    for (let extra = 1; extra < width; extra += 1) {
      const next = bytes[index + extra] ?? 0;
      if ((next & 0xc0) !== 0x80) throw new Error('bad utf-8');
      point = (point << 6) | (next & 0x3f);
    }
    if ((width === 2 && point < 0x80) || (width === 3 && point < 0x800) || (width === 4 && (point < 0x10000 || point > 0x10ffff))) {
      throw new Error('bad utf-8');
    }
    out += String.fromCodePoint(point);
    index += width - 1;
  }
  return out;
}

export function sha256HexBytes(data: Uint8Array): string {
  return hex(sha256Bytes(data));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function positiveInt(value: number | undefined, fallback: number, ceiling: number, label: string): number {
  const resolved = value === undefined ? fallback : value;
  if (!Number.isInteger(resolved) || resolved < 1 || resolved > ceiling) {
    fail('invalid-request', `${label} must be an integer from 1 to ${ceiling}.`);
  }
  return resolved;
}

export function transportLimitations(): readonly string[] {
  return TRANSPORT_LIMITATIONS;
}

export function normalizeRevision(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim().toLowerCase();
  return GIT_REVISION.test(text) ? text : null;
}

export function assertPinnedRevision(value: unknown): string {
  const revision = normalizeRevision(value);
  if (!revision) fail('revision-not-a-pin', 'A pinned revision must be a 40-digit hex commit. Branch names are not pins.');
  return revision;
}

export function assertDatasetId(value: unknown): string {
  if (typeof value !== 'string' || !DATASET_ID.test(value)) {
    fail('invalid-request', 'Dataset id must be org/name using public Hub characters.');
  }
  return value;
}

export function assertRepoPath(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) {
    fail('invalid-request', 'Artifact path is missing.');
  }
  if (value.startsWith('/') || value.includes('\\') || value.includes('\0') || value.includes('?') || value.includes('#')) {
    fail('unsafe-url', 'Artifact path must be a relative repo path.');
  }
  const parts = value.split('/');
  if (parts.some((part) => part.length === 0 || part === '.' || part === '..')) {
    fail('unsafe-url', 'Artifact path cannot climb out of the repository.');
  }
  return value;
}

function assertSha256(value: unknown): string {
  if (typeof value !== 'string' || !SHA256_HEX.test(value.trim().toLowerCase())) {
    fail('invalid-request', 'Artifact sha256 must be 64 hex characters.');
  }
  return value.trim().toLowerCase();
}

const TRANSPORT_CODES = new Set<TransportCode>([
  'cancelled',
  'retry-exhausted',
  'retry-after-exceeds-bound',
  'http',
  'network',
  'integrity',
  'revision-mismatch',
  'revision-unconfirmed',
  'revision-mix',
  'revision-not-a-pin',
  'unbounded-country-download',
  'budget-exceeded',
  'viewer-join-unsupported',
  'viewer-error',
  'range-unsupported',
  'cors-blocked',
  'capability-not-measured',
  'shard-fallback-required',
  'unsafe-url',
  'invalid-request',
  'unreadable-body',
]);

function knownCode(value: string): TransportCode {
  return TRANSPORT_CODES.has(value as TransportCode) ? value as TransportCode : 'network';
}

function pinArtifactTarget(target: ArtifactTarget): ArtifactTarget {
  return {
    ...target,
    datasetId: assertDatasetId(target.datasetId),
    revision: assertPinnedRevision(target.revision),
    path: assertRepoPath(target.path),
    sha256: assertSha256(target.sha256),
  };
}

function assertName(value: unknown, label: string): string {
  if (typeof value !== 'string' || !NAME_TOKEN.test(value)) fail('invalid-request', `${label} is not a Viewer name token.`);
  return value;
}

function assertPagesOrigin(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    fail('invalid-request', 'Pages origin is not a URL.');
  }
  if (parsed.origin !== value || parsed.username || parsed.password) {
    fail('invalid-request', 'Pages origin must be a scheme and host with no path or user info.');
  }
  if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
    fail('invalid-request', 'Pages origin must be https, except for a local test host.');
  }
  return parsed.origin;
}

function hostAllowed(hostname: string, extra: readonly string[]): boolean {
  const host = hostname.toLowerCase();
  if (extra.some((item) => item.toLowerCase() === host)) return true;
  if (host === 'huggingface.co' || host === 'datasets-server.huggingface.co') return true;
  return host.endsWith('.huggingface.co') || host.endsWith('.hf.co');
}

export function assertHttpsUrl(value: string, extraHosts: readonly string[] = []): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    fail('unsafe-url', 'Transport URL is not absolute.');
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    fail('unsafe-url', 'Transport URLs are https without user info.');
  }
  if (!hostAllowed(parsed.hostname, extraHosts)) fail('unsafe-url', 'Transport host is not an admitted Hugging Face or mirror host.');
  return parsed;
}

function quoteDataset(datasetId: string): string {
  const slash = datasetId.indexOf('/');
  return `${encodeURIComponent(datasetId.slice(0, slash))}/${encodeURIComponent(datasetId.slice(slash + 1))}`;
}

function quotePath(filePath: string): string {
  return filePath.split('/').map((part) => encodeURIComponent(part)).join('/');
}

export function buildArtifactUrl(datasetId: string, revision: string, filePath: string): string {
  const dataset = assertDatasetId(datasetId);
  const pin = assertPinnedRevision(revision);
  const path = assertRepoPath(filePath);
  return `${HUB_ORIGIN}/datasets/${quoteDataset(dataset)}/resolve/${pin}/${quotePath(path)}`;
}

function revisionInUrl(value: string): string | null {
  const match = /\/resolve\/([0-9a-f]{40})(?:\/|$)/i.exec(value);
  return match && match[1] ? match[1].toLowerCase() : null;
}

function contentLengthOf(headers: Headers): number | null {
  const raw = headers.get('content-length');
  if (!raw || !/^[0-9]+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

function isParquet(target: { path: string; mediaType?: string | null }): boolean {
  const path = target.path.toLowerCase();
  if (path.endsWith('.parquet')) return true;
  const media = (target.mediaType ?? '').toLowerCase();
  return media.includes('parquet');
}

function boundedMax(requested: number | undefined): number {
  const value = requested === undefined ? TRANSPORT_LIMITS.defaultArtifactBytes : requested;
  if (!Number.isInteger(value) || value < 1) fail('invalid-request', 'Artifact byte budget must be a positive integer.');
  if (value > TRANSPORT_LIMITS.absoluteArtifactBytes) {
    fail('unbounded-country-download', 'An artifact byte budget cannot exceed 10 MiB.');
  }
  return value;
}

export function chooseArtifactAccess(target: ArtifactTarget, capability: TransportCapability | null): AccessDecision {
  const url = buildArtifactUrl(target.datasetId, target.revision, target.path);
  assertSha256(target.sha256);
  const maxBytes = boundedMax(target.maxBytes);
  const declared = target.sizeBytes === undefined ? null : target.sizeBytes;
  if (declared !== null && (!Number.isInteger(declared) || declared < 0)) {
    fail('invalid-request', 'Declared artifact size must be a non-negative integer or null.');
  }
  const refuse = (code: TransportCode, reason: string): AccessDecision => ({
    mode: 'refuse',
    url,
    code,
    reason,
    maxBytes,
    reserveBytes: 0,
    start: null,
    end: null,
  });
  if (!capability || capability.schema !== CAPABILITY_SCHEMA || capability.proof !== 'measured-response') {
    return refuse('capability-not-measured', 'Byte access requires a measured CORS and Range capability.');
  }
  if (capability.sharedArrayBufferAssumed !== false || capability.crossOriginIsolationAssumed !== false) {
    return refuse('capability-not-measured', 'Isolation flags cannot authorize an artifact download.');
  }
  if (!capability.cors) return refuse('cors-blocked', 'The measured response did not allow this Pages origin.');
  const parquet = isParquet(target);
  const range = target.range ?? null;
  if (range) {
    if (!Number.isInteger(range.start) || !Number.isInteger(range.end) || range.start < 0 || range.end < range.start) {
      fail('invalid-request', 'A Range slice needs a non-negative inclusive start and end.');
    }
    const sliceBytes = range.end - range.start + 1;
    if (sliceBytes > maxBytes || sliceBytes > TRANSPORT_LIMITS.absoluteArtifactBytes) {
      return refuse('unbounded-country-download', 'A Range slice cannot exceed the artifact byte budget.');
    }
    if (!capability.range) return refuse('shard-fallback-required', 'Range is unavailable, so a partial country file is not fetched.');
    if (declared !== null && range.start === 0 && range.end >= declared - 1 && declared > maxBytes) {
      return refuse('unbounded-country-download', 'The slice would read the whole country file.');
    }
    return {
      mode: 'range',
      url,
      code: null,
      reason: 'measured-range-slice',
      maxBytes: sliceBytes,
      reserveBytes: sliceBytes,
      start: range.start,
      end: range.end,
    };
  }
  if (parquet && (declared === null || declared > TRANSPORT_LIMITS.defaultArtifactBytes)) {
    return refuse('unbounded-country-download', 'A country Parquet file is not downloaded in full.');
  }
  if (declared !== null && declared > TRANSPORT_LIMITS.absoluteArtifactBytes) {
    return refuse('unbounded-country-download', 'The declared artifact is larger than the session ceiling.');
  }
  if (declared !== null && declared > maxBytes) {
    return refuse(
      parquet ? 'unbounded-country-download' : 'shard-fallback-required',
      'The file is larger than the byte budget and is not fetched whole.',
    );
  }
  const reserveBytes = declared === null ? maxBytes : declared;
  return { mode: 'whole', url, code: null, reason: 'bounded-whole-shard', maxBytes, reserveBytes, start: null, end: null };
}

function contentRangeMatches(value: string | null, start: number, end: number): boolean {
  if (!value) return false;
  const match = /^bytes (\d+)-(\d+)\/(\d+|\*)$/i.exec(value.trim());
  if (!match || !match[1] || !match[2]) return false;
  return Number(match[1]) === start && Number(match[2]) === end;
}

export function interpretByteRangeResponse(input: {
  pagesOrigin: string;
  resourceUrl: string;
  status: number | null;
  headers: Headers;
  bodyByteLength: number;
  bodyRefused: boolean;
  failure?: string | null;
  declaredResourceBytes?: number | null;
}): TransportCapability {
  const pagesOrigin = assertPagesOrigin(input.pagesOrigin);
  const ignoredIsolationHeaders: string[] = [];
  if (input.headers.has('cross-origin-opener-policy')) ignoredIsolationHeaders.push('cross-origin-opener-policy');
  if (input.headers.has('cross-origin-embedder-policy')) ignoredIsolationHeaders.push('cross-origin-embedder-policy');
  const allow = input.headers.get('access-control-allow-origin');
  const allowOrigin = allow ? allow.trim() : null;
  const cors = allowOrigin === '*' || allowOrigin === pagesOrigin;
  const contentRange = input.headers.get('content-range');
  const range = input.status === 206
    && !input.bodyRefused
    && contentRangeMatches(contentRange, TRANSPORT_LIMITS.probeStart, TRANSPORT_LIMITS.probeEnd)
    && input.bodyByteLength <= TRANSPORT_LIMITS.probeEnd - TRANSPORT_LIMITS.probeStart + 1;
  const declared = input.declaredResourceBytes ?? null;
  const small = declared !== null && declared <= TRANSPORT_LIMITS.defaultArtifactBytes;
  const shardFallbackRequired = !cors || (!range && !small);
  return {
    schema: CAPABILITY_SCHEMA,
    proof: 'measured-response',
    live: false,
    originProof: 'unproven',
    pagesOrigin,
    resourceUrl: input.resourceUrl,
    cors: cors && input.status !== null && input.failure !== 'network',
    allowOrigin,
    range: range && cors && input.status !== null && input.failure !== 'network',
    acceptRanges: input.headers.get('accept-ranges'),
    status: input.status,
    contentRange,
    bodyRefused: input.bodyRefused,
    shardFallbackRequired,
    credentials: 'omit',
    crossOriginIsolationAssumed: false,
    sharedArrayBufferAssumed: false,
    workerModel: 'single-thread',
    ignoredIsolationHeaders,
    failure: input.failure ?? null,
    limitations: TRANSPORT_LIMITATIONS,
  };
}

export function clampViewerLength(length: number): { length: number; pageCapApplied: boolean } {
  if (!Number.isInteger(length) || length < 1) fail('invalid-request', 'Viewer page length must be a positive integer.');
  if (length > TRANSPORT_LIMITS.viewerPageLength) {
    return { length: TRANSPORT_LIMITS.viewerPageLength, pageCapApplied: true };
  }
  return { length, pageCapApplied: false };
}

function assertViewerText(value: string | undefined, max: number, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > max) {
    fail('invalid-request', `${label} must be a short non-empty string.`);
  }
  if (value.includes('\0') || value.includes('\n') || value.includes(';') || JOIN_WORD.test(value)) {
    fail('viewer-join-unsupported', 'Viewer text cannot contain a join, a statement separator, or a second query.');
  }
  return value;
}

export function prepareViewerRequest(request: ViewerPageRequest): PreparedViewerRequest {
  const datasetId = assertDatasetId(request.datasetId);
  const config = assertName(request.config, 'Config');
  const split = assertName(request.split, 'Split');
  const offset = request.offset ?? 0;
  if (!Number.isInteger(offset) || offset < 0 || offset > TRANSPORT_LIMITS.maxOffset) {
    fail('invalid-request', 'Viewer offset is outside the bounded page window.');
  }
  const clamped = clampViewerLength(request.length);
  const requestedRevision = request.requestedRevision == null || request.requestedRevision === ''
    ? null
    : assertPinnedRevision(request.requestedRevision);
  const query = request.query == null ? null : assertViewerText(request.query, TRANSPORT_LIMITS.maxQueryChars, 'Search query');
  const where = request.where == null ? null : assertViewerText(request.where, TRANSPORT_LIMITS.maxWhereChars, 'Filter predicate');
  if (request.kind === 'rows') {
    if (query || where) fail('viewer-join-unsupported', 'A rows page cannot carry a search query or a filter predicate.');
  } else if (request.kind === 'search') {
    if (!query || where) fail('viewer-join-unsupported', 'Search does not accept a filter join.');
  } else if (request.kind === 'filter') {
    if (!where || query) fail('viewer-join-unsupported', 'Filter does not accept a search join.');
  } else {
    fail('invalid-request', 'Viewer page kind must be rows, search, or filter.');
  }
  return {
    datasetId,
    config,
    split,
    offset,
    length: clamped.length,
    requestedLength: request.length,
    pageCapApplied: clamped.pageCapApplied,
    kind: request.kind,
    query,
    where,
    requestedRevision,
  };
}

export function buildViewerUrl(request: ViewerPageRequest): string {
  const prepared = prepareViewerRequest(request);
  const params = new URLSearchParams();
  params.set('dataset', prepared.datasetId);
  params.set('config', prepared.config);
  params.set('split', prepared.split);
  params.set('offset', String(prepared.offset));
  params.set('length', String(prepared.length));
  if (prepared.kind === 'search' && prepared.query) params.set('query', prepared.query);
  if (prepared.kind === 'filter' && prepared.where) params.set('where', prepared.where);
  const url = `${VIEWER_ORIGIN}/${prepared.kind}?${params.toString()}`;
  if (url.includes('revision=') || params.has('revision') || params.has('join')) {
    fail('viewer-join-unsupported', 'Viewer URLs do not carry a revision pin or a join.');
  }
  return url;
}

export function buildViewerSplitsUrl(datasetId: string): string {
  const dataset = assertDatasetId(datasetId);
  const params = new URLSearchParams();
  params.set('dataset', dataset);
  const url = `${VIEWER_ORIGIN}/splits?${params.toString()}`;
  if (url.includes('revision=')) fail('revision-not-a-pin', 'Config discovery does not send a revision pin.');
  return url;
}

function integerField(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER ? value : null;
}

function payloadCommit(payload: Record<string, unknown>): string | null {
  for (const key of ['commit', 'dataset_commit', 'git_commit']) {
    const revision = normalizeRevision(payload[key]);
    if (revision) return revision;
  }
  return null;
}

function rowEmbeddedRevision(row: unknown): string | null {
  const wrapper = asRecord(row);
  const record = asRecord(wrapper?.row) ?? wrapper;
  if (!record) return null;
  for (const key of ['sourceRevision', 'source_revision', 'revision']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

export function parseViewerSplits(datasetId: string, payload: unknown, requestedRevision: string | null): ViewerLayout {
  const dataset = assertDatasetId(datasetId);
  const pin = requestedRevision == null ? null : assertPinnedRevision(requestedRevision);
  const record = asRecord(payload);
  if (!record) fail('unreadable-body', 'Viewer splits payload is not an object.');
  if (typeof record.error === 'string' && record.error.trim()) {
    fail('viewer-error', record.error.trim().slice(0, 300));
  }
  const configs = new Map<string, Map<string, ViewerSplitInfo>>();
  let foreignDatasetsDropped = 0;
  const rows = Array.isArray(record.splits) ? record.splits : [];
  for (const row of rows) {
    const item = asRecord(row);
    const name = typeof item?.config === 'string' ? item.config : '';
    const split = typeof item?.split === 'string' ? item.split : '';
    const owner = typeof item?.dataset === 'string' ? item.dataset : dataset;
    if (owner !== dataset) {
      foreignDatasetsDropped += 1;
      continue;
    }
    if (!NAME_TOKEN.test(name) || !NAME_TOKEN.test(split)) continue;
    let splits = configs.get(name);
    if (!splits) {
      splits = new Map();
      configs.set(name, splits);
    }
    splits.set(split, {
      name: split,
      numRows: integerField(item?.num_rows),
      numBytes: integerField(item?.num_bytes),
    });
  }
  const names = (value: unknown): string[] => {
    if (!Array.isArray(value)) return [];
    const found: string[] = [];
    for (const entry of value) {
      const item = asRecord(entry);
      const config = typeof item?.config === 'string' ? item.config : typeof entry === 'string' ? entry : '';
      if (NAME_TOKEN.test(config)) found.push(config);
    }
    return [...new Set(found)].sort((left, right) => left.localeCompare(right));
  };
  return {
    schema: VIEWER_LAYOUT_SCHEMA,
    dataset,
    configs: [...configs.keys()].sort((left, right) => left.localeCompare(right)).map((name) => ({
      name,
      splits: [...(configs.get(name)?.values() ?? [])].sort((left, right) => left.name.localeCompare(right.name)),
    })),
    pending: names(record.pending),
    failed: names(record.failed),
    commit: payloadCommit(record),
    requestedRevision: pin,
    foreignDatasetsDropped,
    joinsSupported: false,
    revisionPinSupported: false,
    limitations: TRANSPORT_LIMITATIONS,
  };
}

export interface ReconciledViewerPage {
  rows: unknown[];
  observedRowCount: number;
  withheld: boolean;
  withheldReason: string | null;
  commit: string | null;
  reconciled: boolean;
  partialIndex: boolean;
  truncated: boolean;
  serverExceededCap: boolean;
  numRowsTotal: number | null;
  numRowsPerPage: number | null;
  joinsSupported: false;
  revisionPinSupported: false;
}

export function reconcileViewerPayload(input: {
  payload: unknown;
  dataset: string;
  requestedRevision: string | null;
}): ReconciledViewerPage {
  const dataset = assertDatasetId(input.dataset);
  const requested = input.requestedRevision == null ? null : assertPinnedRevision(input.requestedRevision);
  const record = asRecord(input.payload);
  if (!record) fail('unreadable-body', 'Viewer page payload is not an object.');
  if (typeof record.error === 'string' && record.error.trim()) fail('viewer-error', record.error.trim().slice(0, 300));
  const owner = typeof record.dataset === 'string' ? record.dataset : dataset;
  if (owner !== dataset) {
    return {
      rows: [],
      observedRowCount: Array.isArray(record.rows) ? record.rows.length : 0,
      withheld: true,
      withheldReason: 'revision-mix',
      commit: payloadCommit(record),
      reconciled: false,
      partialIndex: record.partial === true,
      truncated: false,
      serverExceededCap: false,
      numRowsTotal: integerField(record.num_rows_total),
      numRowsPerPage: integerField(record.num_rows_per_page),
      joinsSupported: false,
      revisionPinSupported: false,
    };
  }
  const rawRows = Array.isArray(record.rows) ? record.rows : [];
  const serverExceededCap = rawRows.length > TRANSPORT_LIMITS.viewerPageLength;
  const limited = rawRows.slice(0, TRANSPORT_LIMITS.viewerPageLength);
  const commit = payloadCommit(record);
  const embedded = limited.map((row) => rowEmbeddedRevision(row)).filter((value): value is string => Boolean(value));
  const normalizedEmbedded = embedded.map((value) => normalizeRevision(value));
  const distinct = [...new Set(normalizedEmbedded.filter((value): value is string => value !== null))];
  let withheldReason: string | null = null;
  if (
    normalizedEmbedded.some((value) => value === null)
    || distinct.length > 1
    || (commit !== null && distinct.some((value) => value !== commit))
    || (requested !== null && distinct.some((value) => value !== requested))
  ) {
    withheldReason = 'revision-mix';
  } else if (requested && commit !== requested) {
    withheldReason = commit ? 'revision-mix' : 'viewer-revision-unconfirmed';
  }
  const truncated = limited.some((row) => {
    const wrapper = asRecord(row);
    return Array.isArray(wrapper?.truncated_cells) && wrapper.truncated_cells.length > 0;
  });
  const kept = withheldReason ? [] : limited.map((row) => asRecord(row)?.row ?? row);
  return {
    rows: kept,
    observedRowCount: rawRows.length,
    withheld: withheldReason !== null,
    withheldReason,
    commit,
    reconciled: withheldReason === null && requested !== null && commit === requested,
    partialIndex: record.partial === true,
    truncated,
    serverExceededCap,
    numRowsTotal: integerField(record.num_rows_total),
    numRowsPerPage: integerField(record.num_rows_per_page),
    joinsSupported: false,
    revisionPinSupported: false,
  };
}

function headerRevision(headers: Headers): string | null {
  for (const name of ['x-repo-commit', 'x-commit', 'x-revision']) {
    const revision = normalizeRevision(headers.get(name));
    if (revision) return revision;
  }
  return null;
}

function embeddedArtifactRevision(bytes: Uint8Array, path: string, contentType: string | null): string | null {
  const json = path.endsWith('.json') || (contentType ?? '').toLowerCase().includes('json');
  if (!json || bytes.byteLength === 0) return null;
  try {
    const payload = JSON.parse(decodeUtf8(bytes)) as unknown;
    const record = asRecord(payload);
    if (!record) return null;
    for (const key of ['sourceRevision', 'source_revision', 'revision']) {
      const value = record[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return null;
  } catch {
    return null;
  }
}

function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  return (error as { name?: string }).name === 'AbortError';
}

function throwIfAborted(signal: AbortSignal | undefined, attempts: number): void {
  if (signal?.aborted) {
    fail('cancelled', 'The transport request was cancelled.', { retryable: false, attempts });
  }
}

function defaultSleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new TransportError('cancelled', 'The transport request was cancelled.', { retryable: false }));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new TransportError('cancelled', 'The transport request was cancelled.', { retryable: false }));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

class RequestGate {
  private active = 0;
  private readonly waiters: Array<{
    signal: AbortSignal | undefined;
    resolve: () => void;
    reject: (error: unknown) => void;
    onAbort: () => void;
  }> = [];

  constructor(private readonly limit: number) {}

  async enter(signal: AbortSignal | undefined): Promise<void> {
    throwIfAborted(signal, 0);
    if (this.active < this.limit) {
      this.active += 1;
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const waiter = {
        signal,
        resolve,
        reject,
        onAbort: () => undefined,
      };
      waiter.onAbort = () => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(new TransportError('cancelled', 'The transport request was cancelled.', { retryable: false }));
      };
      this.waiters.push(waiter);
      signal?.addEventListener('abort', waiter.onAbort, { once: true });
    });
    throwIfAborted(signal, 0);
    this.active += 1;
  }

  leave(): void {
    if (this.active > 0) this.active -= 1;
    while (this.waiters.length > 0) {
      const next = this.waiters.shift();
      if (!next) return;
      next.signal?.removeEventListener('abort', next.onAbort);
      if (next.signal?.aborted) {
        next.reject(new TransportError('cancelled', 'The transport request was cancelled.', { retryable: false }));
        continue;
      }
      next.resolve();
      return;
    }
  }
}

function parseRetryAfter(headers: Headers, now: number, maxBackoffMs: number): number | 'exceeds' | null {
  const raw = headers.get('retry-after');
  if (!raw) return null;
  const trimmed = raw.trim();
  let delay = NaN;
  if (/^[0-9]+$/.test(trimmed)) delay = Number(trimmed) * 1000;
  else {
    const dated = Date.parse(trimmed);
    if (Number.isFinite(dated)) delay = dated - now;
  }
  if (!Number.isFinite(delay)) return null;
  if (delay > maxBackoffMs) return 'exceeds';
  return Math.max(0, delay);
}

async function readBounded(response: Response, maxBytes: number, signal: AbortSignal | undefined): Promise<Uint8Array> {
  const declared = contentLengthOf(response.headers);
  if (declared !== null && declared > maxBytes) {
    await response.body?.cancel?.();
    fail('budget-exceeded', 'The response Content-Length exceeds the byte budget.', {
      retryable: false,
      status: response.status,
      responseHeaders: response.headers,
    });
  }
  const reader = response.body?.getReader?.();
  if (!reader) {
    const buffered = new Uint8Array(await response.arrayBuffer());
    if (buffered.byteLength > maxBytes) {
      fail('budget-exceeded', 'The response exceeds the byte budget.', {
        retryable: false,
        status: response.status,
        responseHeaders: response.headers,
      });
    }
    return buffered;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      throwIfAborted(signal, 0);
      const next = await reader.read();
      if (next.done) break;
      if (!next.value || next.value.byteLength === 0) continue;
      total += next.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        fail('budget-exceeded', 'The response exceeded the byte budget while it was being read.', {
          retryable: false,
          status: response.status,
          responseHeaders: response.headers,
        });
      }
      chunks.push(next.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function decodeJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(decodeUtf8(bytes)) as unknown;
  } catch {
    fail('unreadable-body', 'The response was not UTF-8 JSON.');
  }
}

export class ArtifactTransport {
  private readonly fetchImpl: (input: string, init: RequestInit) => Promise<Response>;
  private readonly sleepImpl: (ms: number, signal: AbortSignal | undefined) => Promise<void>;
  private readonly nowImpl: () => number;
  private readonly pagesOrigin: string;
  private readonly maxAttempts: number;
  private readonly maxBackoffMs: number;
  private readonly baseBackoffMs: number;
  private readonly gate: RequestGate;
  private readonly capabilityByUrl = new Map<string, TransportCapability>();
  private artifactBytes = 0;
  private readonly viewerRows = new Map<string, number>();
  private readonly viewerBytes = new Map<string, number>();

  constructor(deps: TransportDeps = {}) {
    this.fetchImpl = deps.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.sleepImpl = deps.sleep ?? defaultSleep;
    this.nowImpl = deps.now ?? (() => Date.now());
    this.pagesOrigin = assertPagesOrigin(deps.pagesOrigin ?? DEFAULT_PAGES_ORIGIN);
    this.maxAttempts = positiveInt(deps.maxAttempts, TRANSPORT_LIMITS.defaultAttempts, TRANSPORT_LIMITS.maxAttempts, 'maxAttempts');
    this.maxBackoffMs = positiveInt(deps.maxBackoffMs, TRANSPORT_LIMITS.maxBackoffMs, TRANSPORT_LIMITS.maxBackoffMs, 'maxBackoffMs');
    this.baseBackoffMs = positiveInt(deps.baseBackoffMs, TRANSPORT_LIMITS.baseBackoffMs, this.maxBackoffMs, 'baseBackoffMs');
    const concurrent = positiveInt(deps.maxConcurrent, TRANSPORT_LIMITS.maxConcurrent, TRANSPORT_LIMITS.maxConcurrent, 'maxConcurrent');
    this.gate = new RequestGate(concurrent);
  }

  limitations(): readonly string[] {
    return TRANSPORT_LIMITATIONS;
  }

  async discoverCapability(input: {
    url: string;
    signal?: AbortSignal;
    declaredResourceBytes?: number | null;
    extraHosts?: readonly string[];
  }): Promise<TransportCapability> {
    const extra = input.extraHosts ?? [];
    const parsed = assertHttpsUrl(input.url, extra);
    const resourceUrl = parsed.toString();
    try {
      const fetched = await this.send(resourceUrl, {
        accept: '*/*',
        range: `bytes=${TRANSPORT_LIMITS.probeStart}-${TRANSPORT_LIMITS.probeEnd}`,
        maxBytes: TRANSPORT_LIMITS.probeMaxBytes,
        signal: input.signal,
        extraHosts: extra,
      });
      return interpretByteRangeResponse({
        pagesOrigin: this.pagesOrigin,
        resourceUrl,
        status: fetched.status,
        headers: fetched.headers,
        bodyByteLength: fetched.body.byteLength,
        bodyRefused: false,
        declaredResourceBytes: input.declaredResourceBytes ?? null,
      });
    } catch (error) {
      if (error instanceof TransportError && error.code === 'cancelled') throw error;
      if (error instanceof TransportError && error.code === 'budget-exceeded') {
        return interpretByteRangeResponse({
          pagesOrigin: this.pagesOrigin,
          resourceUrl,
          status: error.status,
          headers: error.responseHeaders ?? new Headers(),
          bodyByteLength: 0,
          bodyRefused: true,
          declaredResourceBytes: input.declaredResourceBytes ?? null,
        });
      }
      if (error instanceof TransportError && (error.code === 'unsafe-url' || error.code === 'invalid-request')) throw error;
      const status = error instanceof TransportError ? error.status : null;
      const headers = error instanceof TransportError ? error.responseHeaders ?? new Headers() : new Headers();
      return interpretByteRangeResponse({
        pagesOrigin: this.pagesOrigin,
        resourceUrl,
        status,
        headers,
        bodyByteLength: 0,
        bodyRefused: true,
        failure: error instanceof TransportError ? error.code : 'network',
        declaredResourceBytes: input.declaredResourceBytes ?? null,
      });
    }
  }

  async fetchArtifact(target: ArtifactTarget, signal?: AbortSignal): Promise<ImmutableArtifact> {
    const pinned = pinArtifactTarget(target);
    const url = buildArtifactUrl(pinned.datasetId, pinned.revision, pinned.path);
    const capability = await this.capabilityFor(url, pinned.sizeBytes ?? null, signal);
    if (capability.failure) {
      fail(knownCode(capability.failure), 'The capability probe did not succeed.', {
        retryable: false,
        status: capability.status,
      });
    }
    const decision = chooseArtifactAccess(pinned, capability);
    if (decision.mode === 'refuse') {
      fail(decision.code ?? 'invalid-request', decision.reason);
    }
    let reserved = false;
    try {
      this.reserveArtifact(decision.reserveBytes);
      reserved = true;
      const range = decision.mode === 'range' && decision.start !== null && decision.end !== null
        ? `bytes=${decision.start}-${decision.end}`
        : undefined;
      const fetched = await this.send(decision.url, {
        accept: 'application/octet-stream, application/json;q=0.9, */*;q=0.1',
        range,
        maxBytes: decision.maxBytes,
        signal,
        extraHosts: [],
      });
      if (decision.mode === 'range' && fetched.status !== 206) {
        fail('range-unsupported', 'The Range slice was not returned as 206.', {
          retryable: false,
          status: fetched.status,
          attempts: fetched.attempts,
          responseHeaders: fetched.headers,
        });
      }
      const artifact = this.verifyArtifact(pinned, fetched);
      this.settleArtifact(decision.reserveBytes, artifact.sizeBytes);
      reserved = false;
      return artifact;
    } finally {
      if (reserved) this.settleArtifact(decision.reserveBytes, 0);
    }
  }

  async fetchArtifactBatch(targets: readonly ArtifactTarget[], signal?: AbortSignal): Promise<ArtifactBatch> {
    if (targets.length === 0) fail('invalid-request', 'An artifact batch needs at least one target.');
    if (targets.length > 32) fail('unbounded-country-download', 'An artifact batch is limited to 32 bounded shards.');
    const revisions: Record<string, string> = {};
    for (const target of targets) {
      const dataset = assertDatasetId(target.datasetId);
      const revision = assertPinnedRevision(target.revision);
      const existing = revisions[dataset];
      if (existing && existing !== revision) {
        fail('revision-mix', 'One batch cannot mix two revisions of the same dataset.');
      }
      revisions[dataset] = revision;
    }
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) controller.abort();
    try {
      const artifacts = await Promise.all(targets.map(async (target) => {
        try {
          return await this.fetchArtifact(target, controller.signal);
        } catch (error) {
          controller.abort();
          throw error;
        }
      }));
      return { schema: ARTIFACT_BATCH_SCHEMA, artifacts, revisions };
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
  }

  async fetchMirror(target: ArtifactTarget, mirrorUrl: string, signal?: AbortSignal): Promise<ImmutableArtifact> {
    const pinned = pinArtifactTarget(target);
    let hostname = '';
    try {
      hostname = new URL(mirrorUrl).hostname;
    } catch {
      fail('unsafe-url', 'Mirror URL is not absolute.');
    }
    const parsed = assertHttpsUrl(mirrorUrl, [hostname]);
    const capability = await this.discoverCapability({
      url: parsed.toString(),
      signal,
      declaredResourceBytes: pinned.sizeBytes ?? null,
      extraHosts: [parsed.hostname],
    });
    if (capability.failure) {
      fail(knownCode(capability.failure), 'The mirror probe did not succeed.', {
        retryable: false,
        status: capability.status,
      });
    }
    const decision = chooseArtifactAccess(pinned, capability);
    if (decision.mode === 'refuse') fail(decision.code ?? 'cors-blocked', decision.reason);
    const range = decision.mode === 'range' && decision.start !== null && decision.end !== null
      ? `bytes=${decision.start}-${decision.end}`
      : undefined;
    let reserved = false;
    try {
      this.reserveArtifact(decision.reserveBytes);
      reserved = true;
      const fetched = await this.send(parsed.toString(), {
        accept: 'application/octet-stream, application/json;q=0.9, */*;q=0.1',
        range,
        maxBytes: decision.maxBytes,
        signal,
        extraHosts: [parsed.hostname],
        requireResponseHost: parsed.hostname,
      });
      const artifact = this.verifyArtifact(pinned, fetched, parsed.toString());
      this.settleArtifact(decision.reserveBytes, artifact.sizeBytes);
      reserved = false;
      return artifact;
    } finally {
      if (reserved) this.settleArtifact(decision.reserveBytes, 0);
    }
  }

  async fetchFirstMirror(target: ArtifactTarget, mirrorUrls: readonly string[], signal?: AbortSignal): Promise<ImmutableArtifact> {
    if (mirrorUrls.length === 0) fail('invalid-request', 'A mirror list is empty.');
    const limited = mirrorUrls.slice(0, TRANSPORT_LIMITS.maxMirrors);
    let last: unknown = null;
    for (const mirrorUrl of limited) {
      throwIfAborted(signal, 0);
      try {
        return await this.fetchMirror(target, mirrorUrl, signal);
      } catch (error) {
        if (error instanceof TransportError && error.code === 'cancelled') throw error;
        last = error;
      }
    }
    if (last instanceof TransportError) throw last;
    fail('network', 'Every admitted mirror failed before a verified artifact was returned.');
  }

  async listViewerConfigs(datasetId: string, requestedRevision?: string | null, signal?: AbortSignal): Promise<ViewerLayout> {
    const dataset = assertDatasetId(datasetId);
    const pin = requestedRevision == null || requestedRevision === '' ? null : assertPinnedRevision(requestedRevision);
    const budgetKey = `${dataset}\n*\n*`;
    this.reserveViewer(budgetKey, 0, TRANSPORT_LIMITS.viewerPageMaxBytes);
    let held = true;
    try {
      const fetched = await this.send(buildViewerSplitsUrl(dataset), {
        accept: 'application/json',
        maxBytes: TRANSPORT_LIMITS.viewerPageMaxBytes,
        signal,
        extraHosts: [],
      });
      this.settleViewer(budgetKey, 0, 0, TRANSPORT_LIMITS.viewerPageMaxBytes, fetched.body.byteLength);
      held = false;
      return parseViewerSplits(dataset, decodeJson(fetched.body), pin);
    } finally {
      if (held) this.settleViewer(budgetKey, 0, 0, TRANSPORT_LIMITS.viewerPageMaxBytes, 0);
    }
  }

  async readViewerPage(request: ViewerPageRequest, signal?: AbortSignal): Promise<ViewerRowPage> {
    const prepared = prepareViewerRequest(request);
    const key = `${prepared.datasetId}\n${prepared.config}\n${prepared.split}`;
    this.reserveViewer(key, prepared.length, TRANSPORT_LIMITS.viewerPageMaxBytes);
    let settled = false;
    try {
      const fetched = await this.send(buildViewerUrl(prepared), {
        accept: 'application/json',
        maxBytes: TRANSPORT_LIMITS.viewerPageMaxBytes,
        signal,
        extraHosts: [],
      });
      const reconciled = reconcileViewerPayload({
        payload: decodeJson(fetched.body),
        dataset: prepared.datasetId,
        requestedRevision: prepared.requestedRevision,
      });
      const chargedRows = Math.min(reconciled.observedRowCount, prepared.length);
      this.settleViewer(key, prepared.length, chargedRows, TRANSPORT_LIMITS.viewerPageMaxBytes, fetched.body.byteLength);
      settled = true;
      return {
        schema: VIEWER_PAGE_SCHEMA,
        dataset: prepared.datasetId,
        config: prepared.config,
        split: prepared.split,
        kind: prepared.kind,
        offset: prepared.offset,
        length: prepared.length,
        requestedLength: prepared.requestedLength,
        pageCapApplied: prepared.pageCapApplied,
        rows: reconciled.rows,
        observedRowCount: reconciled.observedRowCount,
        numRowsTotal: reconciled.numRowsTotal,
        numRowsPerPage: reconciled.numRowsPerPage,
        partialIndex: reconciled.partialIndex,
        truncated: reconciled.truncated,
        serverExceededCap: reconciled.serverExceededCap,
        withheld: reconciled.withheld,
        withheldReason: reconciled.withheldReason,
        commit: reconciled.commit,
        requestedRevision: prepared.requestedRevision,
        reconciled: reconciled.reconciled,
        joinsSupported: false,
        revisionPinSupported: false,
        multilingualComplete: false,
        stemming: VIEWER_STEMMING,
        limitations: TRANSPORT_LIMITATIONS,
        attempts: fetched.attempts,
      };
    } finally {
      if (!settled) this.settleViewer(key, prepared.length, 0, TRANSPORT_LIMITS.viewerPageMaxBytes, 0);
    }
  }

  async paginateViewer(request: ViewerPageRequest, signal?: AbortSignal): Promise<ViewerWalk> {
    const prepared = prepareViewerRequest({ ...request, offset: request.offset ?? 0, length: TRANSPORT_LIMITS.viewerPageLength });
    const pages: ViewerRowPage[] = [];
    let offset = prepared.offset;
    let complete = false;
    let stoppedReason: string | null = null;
    for (let index = 0; index < TRANSPORT_LIMITS.viewerMaxPages; index += 1) {
      let page: ViewerRowPage;
      try {
        page = await this.readViewerPage({ ...request, offset, length: TRANSPORT_LIMITS.viewerPageLength }, signal);
      } catch (error) {
        if (error instanceof TransportError && error.code === 'unbounded-country-download' && pages.length > 0) {
          stoppedReason = 'row-budget';
          break;
        }
        throw error;
      }
      pages.push(page);
      if (page.withheld) {
        stoppedReason = page.withheldReason ?? 'revision-mix';
        break;
      }
      if (page.partialIndex) {
        stoppedReason = 'partial-index';
        break;
      }
      const reachedTotal = page.numRowsTotal !== null && offset + page.observedRowCount >= page.numRowsTotal;
      if (page.rows.length < page.length || reachedTotal) {
        complete = true;
        break;
      }
      offset += page.rows.length;
    }
    if (!complete && !stoppedReason) stoppedReason = 'page-budget';
    if (stoppedReason) complete = false;
    return {
      schema: VIEWER_WALK_SCHEMA,
      dataset: prepared.datasetId,
      config: prepared.config,
      split: prepared.split,
      pages,
      rows: pages.flatMap((page) => page.rows),
      complete,
      stoppedReason,
      joinsSupported: false,
      revisionPinSupported: false,
      limitations: TRANSPORT_LIMITATIONS,
    };
  }

  async measureViewer(input: {
    datasetId: string;
    requestedRevision?: string | null;
    probeSearch?: boolean;
    probeFilter?: boolean;
    live?: boolean;
    signal?: AbortSignal;
  }): Promise<ViewerCompatibility> {
    const dataset = assertDatasetId(input.datasetId);
    const ignoredClaims = input.live === true ? ['live'] : [];
    const endpoints: ViewerCompatibility['endpoints'] = {
      splits: { called: false, ok: false, status: null, failure: null },
      rows: { called: false, ok: false, status: null, failure: null },
      search: { called: false, ok: false, status: null, failure: null },
      filter: { called: false, ok: false, status: null, failure: null },
    };
    let layout: ViewerLayout | null = null;
    try {
      endpoints.splits.called = true;
      layout = await this.listViewerConfigs(dataset, input.requestedRevision ?? null, input.signal);
      endpoints.splits.ok = true;
      endpoints.splits.status = 200;
    } catch (error) {
      if (error instanceof TransportError && error.code === 'cancelled') throw error;
      endpoints.splits.failure = error instanceof TransportError ? error.code : 'network';
      endpoints.splits.status = error instanceof TransportError ? error.status : null;
    }
    const first = layout?.configs[0];
    const split = first?.splits[0];
    if (first && split) {
      await this.probeEndpoint(endpoints.rows, {
        datasetId: dataset,
        config: first.name,
        split: split.name,
        offset: 0,
        length: 1,
        kind: 'rows',
        requestedRevision: input.requestedRevision ?? null,
      }, input.signal);
      if (input.probeSearch) {
        await this.probeEndpoint(endpoints.search, {
          datasetId: dataset,
          config: first.name,
          split: split.name,
          offset: 0,
          length: 1,
          kind: 'search',
          query: 'law',
          requestedRevision: input.requestedRevision ?? null,
        }, input.signal);
      }
      if (input.probeFilter) {
        await this.probeEndpoint(endpoints.filter, {
          datasetId: dataset,
          config: first.name,
          split: split.name,
          offset: 0,
          length: 1,
          kind: 'filter',
          where: 'law',
          requestedRevision: input.requestedRevision ?? null,
        }, input.signal);
      }
    }
    return {
      schema: VIEWER_COMPATIBILITY_SCHEMA,
      dataset,
      live: false,
      originProof: 'unproven',
      layout,
      endpoints,
      joinsSupported: false,
      revisionPinSupported: false,
      multilingualComplete: false,
      stemming: VIEWER_STEMMING,
      maxPageLength: TRANSPORT_LIMITS.viewerPageLength,
      parquetRequiredForSearch: true,
      ignoredClaims,
      limitations: TRANSPORT_LIMITATIONS,
    };
  }

  private async probeEndpoint(
    report: ViewerEndpointReport,
    request: ViewerPageRequest,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    report.called = true;
    try {
      await this.readViewerPage(request, signal);
      report.ok = true;
      report.status = 200;
    } catch (error) {
      if (error instanceof TransportError && error.code === 'cancelled') throw error;
      report.ok = false;
      report.failure = error instanceof TransportError ? error.code : 'network';
      report.status = error instanceof TransportError ? error.status : null;
    }
  }

  private async capabilityFor(url: string, declared: number | null, signal: AbortSignal | undefined): Promise<TransportCapability> {
    const cached = this.capabilityByUrl.get(url);
    if (cached) return cached;
    const measured = await this.discoverCapability({ url, signal, declaredResourceBytes: declared });
    this.capabilityByUrl.set(url, measured);
    return measured;
  }

  private verifyArtifact(target: ArtifactTarget, fetched: FetchedBody, urlOverride?: string): ImmutableArtifact {
    const revision = assertPinnedRevision(target.revision);
    const digest = sha256HexBytes(fetched.body);
    if (digest !== assertSha256(target.sha256)) {
      fail('integrity', 'The artifact bytes do not match the pinned sha256.', {
        retryable: false,
        attempts: fetched.attempts,
        status: fetched.status,
      });
    }
    const header = headerRevision(fetched.headers);
    const urlRevision = revisionInUrl(fetched.url || urlOverride || '');
    if ((header && header !== revision) || (urlRevision && urlRevision !== revision) || (header && urlRevision && header !== urlRevision)) {
      fail('revision-mismatch', 'The response revision does not match the pinned commit.', {
        retryable: false,
        attempts: fetched.attempts,
        status: fetched.status,
      });
    }
    const contentType = fetched.headers.get('content-type');
    const embedded = embeddedArtifactRevision(fetched.body, target.path, contentType);
    if (embedded && normalizeRevision(embedded) !== revision) {
      fail('revision-mix', 'The artifact body names a different source revision.', {
        retryable: false,
        attempts: fetched.attempts,
        status: fetched.status,
      });
    }
    const revisionConfirmed = header === revision || urlRevision === revision;
    if (target.requireConfirmedRevision && !revisionConfirmed) {
      fail('revision-unconfirmed', 'The response did not confirm the pinned commit.', {
        retryable: false,
        attempts: fetched.attempts,
        status: fetched.status,
      });
    }
    let revisionEvidence: ImmutableArtifact['revisionEvidence'] = 'sha256-only';
    if (header === revision) revisionEvidence = 'header';
    else if (urlRevision === revision) revisionEvidence = 'url';
    return {
      schema: ARTIFACT_SCHEMA,
      datasetId: target.datasetId,
      revision,
      path: target.path,
      sha256: digest,
      bytes: fetched.body.slice(),
      sizeBytes: fetched.body.byteLength,
      revisionConfirmed,
      revisionEvidence,
      contentType,
      attempts: fetched.attempts,
      url: fetched.url || urlOverride || buildArtifactUrl(target.datasetId, target.revision, target.path),
    };
  }

  private reserveArtifact(bytes: number): void {
    if (bytes < 0 || this.artifactBytes + bytes > TRANSPORT_LIMITS.sessionArtifactBytes) {
      fail('unbounded-country-download', 'The artifact session would exceed the 10 MiB transfer budget.');
    }
    this.artifactBytes += bytes;
  }

  private settleArtifact(reserved: number, actual: number): void {
    this.artifactBytes += actual - reserved;
    if (this.artifactBytes < 0) this.artifactBytes = 0;
  }

  private viewerKeyCharge(key: string): { rows: number; bytes: number } {
    return { rows: this.viewerRows.get(key) ?? 0, bytes: this.viewerBytes.get(key) ?? 0 };
  }

  private reserveViewer(key: string, rows: number, bytes: number): void {
    const current = this.viewerKeyCharge(key);
    if (current.rows + rows > TRANSPORT_LIMITS.viewerSessionMaxRows || current.bytes + bytes > TRANSPORT_LIMITS.viewerSessionMaxBytes) {
      fail('unbounded-country-download', 'The Viewer session would exceed the row or byte budget for this config and split.');
    }
    this.viewerRows.set(key, current.rows + rows);
    this.viewerBytes.set(key, current.bytes + bytes);
  }

  private settleViewer(key: string, reservedRows: number, actualRows: number, reservedBytes: number, actualBytes: number): void {
    const current = this.viewerKeyCharge(key);
    this.viewerRows.set(key, Math.max(0, current.rows - reservedRows + actualRows));
    this.viewerBytes.set(key, Math.max(0, current.bytes - reservedBytes + actualBytes));
  }

  private async send(url: string, spec: {
    accept: string;
    range?: string;
    maxBytes: number;
    signal?: AbortSignal;
    extraHosts: readonly string[];
    requireResponseHost?: string;
  }): Promise<FetchedBody> {
    assertHttpsUrl(url, spec.extraHosts);
    let last: TransportError | null = null;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      throwIfAborted(spec.signal, attempt - 1);
      let entered = false;
      try {
        await this.gate.enter(spec.signal);
        entered = true;
        throwIfAborted(spec.signal, attempt);
        // A header record keeps Range. Some user agents still delete that name
        // inside the Headers constructor even though the Fetch standard allows it.
        const headers: Record<string, string> = { Accept: spec.accept };
        if (spec.range) headers.Range = spec.range;
        const response = await this.fetchImpl(url, {
          method: 'GET',
          headers,
          credentials: 'omit',
          redirect: 'follow',
          referrerPolicy: 'no-referrer',
          cache: 'no-store',
          signal: spec.signal,
        });
        const responseUrl = response.url || url;
        const extra = spec.requireResponseHost ? [...spec.extraHosts, spec.requireResponseHost] : spec.extraHosts;
        assertHttpsUrl(responseUrl, extra);
        if (spec.requireResponseHost) {
          const host = new URL(responseUrl).hostname.toLowerCase();
          if (host !== spec.requireResponseHost.toLowerCase() && !hostAllowed(host, [])) {
            fail('unsafe-url', 'The mirror redirected off the admitted host.', {
              retryable: false,
              status: response.status,
              attempts: attempt,
              responseHeaders: response.headers,
            });
          }
        }
        const retryAfter = parseRetryAfter(response.headers, this.nowImpl(), this.maxBackoffMs);
        if (RETRYABLE_STATUS.has(response.status)) {
          await response.body?.cancel?.().catch(() => undefined);
          last = new TransportError('http', `HTTP ${response.status} from the artifact host.`, {
            retryable: true,
            attempts: attempt,
            status: response.status,
            retryAfterMs: retryAfter === 'exceeds' ? this.maxBackoffMs + 1 : retryAfter,
            responseHeaders: response.headers,
          });
          if (retryAfter === 'exceeds') {
            fail('retry-after-exceeds-bound', 'Retry-After is outside the backoff bound.', {
              retryable: false,
              attempts: attempt,
              status: response.status,
              retryAfterMs: this.maxBackoffMs + 1,
              responseHeaders: response.headers,
            });
          }
        } else if (response.status < 200 || response.status >= 300) {
          await response.body?.cancel?.().catch(() => undefined);
          fail('http', `HTTP ${response.status} from the artifact host.`, {
            retryable: false,
            attempts: attempt,
            status: response.status,
            responseHeaders: response.headers,
          });
        } else {
          const body = await readBounded(response, spec.maxBytes, spec.signal);
          return { status: response.status, headers: response.headers, url: responseUrl, body, attempts: attempt };
        }
      } catch (error) {
        if (error instanceof TransportError && error.code === 'cancelled') throw error;
        if (isAbortError(error) || spec.signal?.aborted) {
          fail('cancelled', 'The transport request was cancelled.', { retryable: false, attempts: attempt });
        }
        if (error instanceof TransportError && !error.retryable) throw error;
        last = error instanceof TransportError
          ? error
          : new TransportError('network', error instanceof Error ? error.message : 'The transport request failed.', {
            retryable: true,
            attempts: attempt,
          });
        if (attempt >= this.maxAttempts) {
          fail(last.code === 'http' ? 'retry-exhausted' : last.code, last.message, {
            retryable: false,
            attempts: attempt,
            status: last.status,
            retryAfterMs: last.retryAfterMs,
            responseHeaders: last.responseHeaders,
          });
        }
      } finally {
        if (entered) this.gate.leave();
      }
      if (attempt >= this.maxAttempts) {
        fail('retry-exhausted', last?.message ?? 'Retries were exhausted.', {
          retryable: false,
          attempts: attempt,
          status: last?.status ?? null,
          retryAfterMs: last?.retryAfterMs ?? null,
          responseHeaders: last?.responseHeaders ?? null,
        });
      }
      const delay = this.delayFor(last, attempt);
      if (delay === null) {
        fail('retry-after-exceeds-bound', 'Retry-After is outside the backoff bound.', {
          retryable: false,
          attempts: attempt,
          status: last?.status ?? null,
          retryAfterMs: last?.retryAfterMs ?? null,
        });
      }
      try {
        await this.sleepImpl(delay, spec.signal);
      } catch (error) {
        if (error instanceof TransportError && error.code === 'cancelled') throw error;
        if (isAbortError(error) || spec.signal?.aborted) {
          fail('cancelled', 'The transport request was cancelled.', { retryable: false, attempts: attempt });
        }
        throw error;
      }
      throwIfAborted(spec.signal, attempt);
    }
    fail('retry-exhausted', 'Retries were exhausted.', { retryable: false, attempts: this.maxAttempts });
  }

  private delayFor(error: TransportError | null, attempt: number): number | null {
    if (error?.retryAfterMs != null) {
      if (error.retryAfterMs > this.maxBackoffMs) return null;
      return Math.max(this.baseBackoffMs, error.retryAfterMs);
    }
    return Math.min(this.maxBackoffMs, this.baseBackoffMs * 2 ** (attempt - 1));
  }
}

export function createArtifactTransport(deps: TransportDeps = {}): ArtifactTransport {
  return new ArtifactTransport(deps);
}

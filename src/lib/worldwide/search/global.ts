/**
 * Progressive worldwide search over a hierarchical term and citation routing index.
 *
 * A page loads the root, then only the directory path whose key range contains
 * the query, then a bounded number of shard summaries. It does not issue one
 * request per country and it does not load posting payloads or document bodies.
 *
 * Common terms keep a cursor bound to the catalog revision, the normalized
 * query, the filters, and the page budgets. matchTotal stays null until every
 * routed shard has been visited and catalog coverage is known. Routing
 * document frequency is not a result total. The label never says this is all
 * worldwide results.
 */

import { canonicalJson, sha256HexUtf8, utf8Bytes } from '../data/identity';
import { normalizeCiteKey } from './citation';
import { tokenize } from './tokenize';

export const GLOBAL_ROUTING_SCHEMA = 'worldwide-legal-search.global-routing@1';
export const ENVELOPE_SCHEMA = 'worldwide-legal-search.global-envelope@1';
export const DIRECTORY_SCHEMA = 'worldwide-legal-search.global-directory@1';
export const SHARD_SCHEMA = 'worldwide-legal-search.global-shard-summary@1';
export const SEARCH_SCHEMA = 'worldwide-legal-search.worldwide-search@1';
export const CURSOR_PREFIX = 'wwg1.';
export const GLOBAL_CONCURRENCY = 4;
export const FORBIDDEN_TOTAL_LABEL = 'all worldwide results';

export const GLOBAL_ROUTING_DEFAULTS = Object.freeze({
  maxConcurrentRequests: GLOBAL_CONCURRENCY,
  maxRequestsPerPage: 8,
  maxShardRequestsPerPage: 4,
  maxBytesPerPage: 1024 * 1024,
  maxDirectoryBytes: 48 * 1024,
  maxShardSummaryBytes: 32 * 1024,
  maxSummariesPerShard: 20,
  pageSizeDefault: 20,
  pageSizeMax: 100,
  commonDocumentFrequency: 32,
  maxQueryTerms: 64,
  maxCollections: 4096,
  maxTitleChars: 256,
  maxFilterValues: 64,
});

export const GLOBAL_ROUTING_CEILING = Object.freeze({
  maxRequestsPerPage: 32,
  maxShardRequestsPerPage: 8,
  maxBytesPerPage: 10 * 1024 * 1024,
  maxDirectoryBytes: 256 * 1024,
  maxShardSummaryBytes: 256 * 1024,
  maxSummariesPerShard: 100,
  pageSizeMax: 100,
  maxCollections: 10000,
});

export const COVERAGE_STATES = ['known', 'partial', 'missing', 'unknown', 'unavailable'] as const;
export const SEARCHABLE_COVERAGE = ['known', 'partial'] as const;

export const GLOBAL_LIMITATIONS = [
  'Worldwide search walks a hierarchical term or citation directory. It does not issue one request per country.',
  'A page loads at most the routing limits for requests, shard summaries, and bytes. Concurrent artifact requests stay at 4.',
  'Shard summaries are bounded. Full posting payloads, document bodies, and embeddings are not loaded.',
  'Common terms page through shard waves. A cursor is bound to the catalog revision, normalized query, filters, page size, and page budgets.',
  'matchTotal is null while any directory or shard remains, a summary was truncated, the query was token-capped, or catalog coverage is not known and complete. Routing document frequency is not a result total.',
  'The result never claims all worldwide results. A finished page counts only hits emitted from visited summaries.',
  'Continuation reads the remaining queued directories and shards. It does not reload summaries already visited.',
  'Strict filters are allow-lists. They remove collections and hits. They do not add a country and they are not score weights.',
  'Summary scores are stored integers used for stable order. This module does not rescore BM25 and does not fuse ranks. Titles are stored up to 256 characters.',
  'A missing, unknown, or unavailable collection stays in the coverage display and has no shard request.',
  'This search does not decide that an instrument binds conduct.',
] as const;

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const ID_TEXT = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

export type CoverageState = (typeof COVERAGE_STATES)[number];
export type SearchableCoverage = (typeof SEARCHABLE_COVERAGE)[number];
export type RouteKind = 'term' | 'citation' | 'coverage';
export type DirectoryKind = 'root' | RouteKind;

export class WorldwideSearchError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message.startsWith(`${code}:`) ? message : `${code}: ${message}`);
    this.name = 'WorldwideSearchError';
    this.code = code;
  }
}

export interface GlobalRoutingLimits {
  maxConcurrentRequests: typeof GLOBAL_CONCURRENCY;
  maxRequestsPerPage: number;
  maxShardRequestsPerPage: number;
  maxBytesPerPage: number;
  maxDirectoryBytes: number;
  maxShardSummaryBytes: number;
  maxSummariesPerShard: number;
  pageSizeDefault: number;
  pageSizeMax: number;
  commonDocumentFrequency: number;
  maxQueryTerms: number;
  maxCollections: number;
  maxTitleChars: number;
  maxFilterValues: number;
}

export interface Envelope<T> {
  schema: typeof ENVELOPE_SCHEMA;
  catalogRevision: string;
  relativePath: string;
  payloadSha256: string;
  payloadBytes: number;
  payload: T;
}

export interface StoredDocument<T = RoutingPayload> {
  envelope: Envelope<T>;
  loadedBytes: number;
}

export interface ChildPointer {
  directoryId: string;
  relativePath: string;
  kind: RouteKind;
  firstKey: string;
  lastKey: string;
  payloadSha256: string;
  loadedBytes: number;
}

export interface ShardPointer {
  shardId: string;
  relativePath: string;
  collectionId: string;
  jurisdictionId: string;
  sourceRevision: string;
  coverage: SearchableCoverage;
  languages: string[];
  documentFrequency: number;
  summariesTruncated: boolean;
  loadedBytes: number;
  payloadSha256: string;
  term: string;
  termDocumentFrequency: number;
  common: boolean;
}

export interface RouteEntry {
  key: string;
  documentFrequency: number;
  common: boolean;
  shards: ShardPointer[];
}

export interface CollectionCoverage {
  collectionId: string;
  jurisdictionId: string;
  sourceRevision: string;
  state: CoverageState;
  indexedRecords: number | null;
  languages: string[];
}

export interface CoverageRollup {
  collections: number;
  known: number;
  partial: number;
  missing: number;
  unknown: number;
  unavailable: number;
  indexedRecords: number | null;
  indexedRecordsComplete: boolean;
  rows: CollectionCoverage[];
}

export interface DirectoryPayload {
  schema: typeof DIRECTORY_SCHEMA;
  directoryId: string;
  kind: DirectoryKind;
  role: 'root' | 'internal' | 'leaf';
  firstKey: string;
  lastKey: string;
  perCountryFanout: false;
  routing: 'hierarchical-term-citation';
  children: ChildPointer[];
  entries: RouteEntry[];
  coverage: CoverageRollup | null;
  coverageInline: boolean;
  limits: GlobalRoutingLimits | null;
  asOf: string | null;
}

export interface SummaryHit {
  documentId: string;
  score: number;
  title: string;
  language: string;
  citation: string;
}

export interface ShardSummaryPayload {
  schema: typeof SHARD_SCHEMA;
  kind: 'term' | 'citation';
  key: string;
  shardId: string;
  relativePath: string;
  collectionId: string;
  jurisdictionId: string;
  sourceRevision: string;
  coverage: SearchableCoverage;
  perCountryFanout: false;
  fullPostingsLoaded: false;
  documentFrequency: number;
  summariesTruncated: boolean;
  hits: SummaryHit[];
}

export type RoutingPayload = DirectoryPayload | ShardSummaryPayload;

export interface GlobalRoutingStats {
  collections: number;
  terms: number;
  citations: number;
  directories: number;
  termLeaves: number;
  citationLeaves: number;
  shardSummaries: number;
  maxShardsPerTermLeaf: number;
  maxDirectoryLoadedBytes: number;
  maxShardLoadedBytes: number;
  rootBytes: number;
  remoteBytes: number;
  perCountryFanout: false;
}

export interface GlobalRoutingPages {
  logicalPath: string;
  bundledRoles: ['global-routing-root'];
  fullCorpusBundled: false;
  shardSummariesBundled: false;
  perCountryFanout: false;
  bundledBytes: number;
  bundledSha256: string;
}

export interface GlobalRoutingIndex {
  schema: typeof GLOBAL_ROUTING_SCHEMA;
  catalogRevision: string;
  asOf: string;
  limits: GlobalRoutingLimits;
  rootPath: string;
  perCountryFanout: false;
  fullCorpusBundled: false;
  documents: Readonly<Record<string, StoredDocument>>;
  stats: GlobalRoutingStats;
  pages: GlobalRoutingPages;
}

export interface WorldwideFilters {
  jurisdictions: string[];
  collectionIds: string[];
  languages: string[];
}

export interface WorldwideSearchRequest {
  query?: string | null;
  citation?: string | null;
  filters?: {
    jurisdictions?: readonly string[] | null;
    collectionIds?: readonly string[] | null;
    languages?: readonly string[] | null;
  } | null;
  pageSize?: number | null;
  cursor?: string | null;
  limits?: {
    maxRequestsPerPage?: number;
    maxShardRequestsPerPage?: number;
    maxBytesPerPage?: number;
  } | null;
}

export interface WorldwideHit {
  collectionId: string;
  jurisdictionId: string;
  sourceRevision: string;
  documentId: string;
  title: string;
  language: string;
  citation: string;
  score: number;
  matchedKeys: string[];
  coverage: SearchableCoverage;
  shardPaths: string[];
}

export interface WorldwidePage {
  schema: typeof SEARCH_SCHEMA;
  catalogRevision: string;
  mode: 'term' | 'citation';
  normalized: string;
  queryTruncated: boolean;
  fanout: 'hierarchical';
  perCountryFanout: false;
  fullPostingsLoaded: false;
  claimsAllWorldwideResults: false;
  unsearchedTotalClaimed: false;
  matchTotal: number | null;
  observedHits: number;
  partial: boolean;
  continuation: boolean;
  cursor: string | null;
  hits: WorldwideHit[];
  label: string;
  coverage: {
    state: 'partial' | 'known';
    catalogState: 'partial' | 'known';
    searchState: 'partial' | 'complete';
    partial: boolean;
    collections: number;
    known: number;
    partialCollections: number;
    missing: number;
    unknown: number;
    unavailable: number;
    indexedRecords: number | null;
    indexedRecordsComplete: boolean;
    partialCollectionIds: string[];
    missingCollectionIds: string[];
    unknownCollectionIds: string[];
    unavailableCollectionIds: string[];
    rowsPending: boolean;
    claimsAllWorldwideResults: false;
  };
  partialReasons: string[];
  budgets: {
    maxConcurrentRequests: typeof GLOBAL_CONCURRENCY;
    maxRequestsPerPage: number;
    maxShardRequestsPerPage: number;
    maxBytesPerPage: number;
    requests: number;
    bytes: number;
    shardRequests: number;
    batches: number;
    withinRequestBound: boolean;
    withinByteBound: boolean;
    withinShardBound: boolean;
  };
  walk: {
    loadedPaths: string[];
    openedShardPaths: string[];
    visitedShardPaths: string[];
    pendingShardPaths: string[];
    pendingDirectoryPaths: string[];
    filteredShards: number;
    siblingDirectoriesSkipped: number;
    siblingDirectoriesSkippedThisPage: number;
    unwalkedDirectories: number;
    remainingShardPointers: number;
    routedShardTotalKnown: boolean;
  };
  commonQuery: boolean;
  limitations: readonly string[];
}

interface PageLimits {
  maxRequestsPerPage: number;
  maxShardRequestsPerPage: number;
  maxBytesPerPage: number;
  pageSize: number;
}

interface CursorState {
  v: 1;
  bindingHash: string;
  pendingDirectories: ChildPointer[];
  pendingShards: ShardPointer[];
  visitedShardPaths: string[];
  visitedDirectoryPaths: string[];
  filteredShards: number;
  truncatedSeen: boolean;
  observedHits: number;
  waveHits: WorldwideHit[];
  siblingDirectoriesSkipped: number;
  commonQuery: boolean;
}

interface Binding {
  catalogRevision: string;
  mode: 'term' | 'citation';
  normalized: string;
  queryTruncated: boolean;
  filters: WorldwideFilters;
  pageSize: number;
  maxRequestsPerPage: number;
  maxShardRequestsPerPage: number;
  maxBytesPerPage: number;
}

export function sealEnvelope<T>(relativePath: string, catalogRevision: string, payload: T): StoredDocument<T> {
  const payloadJson = canonicalJson(payload);
  const envelope: Envelope<T> = {
    schema: ENVELOPE_SCHEMA,
    catalogRevision,
    relativePath,
    payloadSha256: sha256HexUtf8(payloadJson),
    payloadBytes: utf8Bytes(payloadJson).length,
    payload,
  };
  return { envelope, loadedBytes: utf8Bytes(canonicalJson(envelope)).length };
}

export function isDirectoryPayload(payload: RoutingPayload): payload is DirectoryPayload {
  return payload.schema === DIRECTORY_SCHEMA;
}

export interface CommonTermFanout {
  requests: number;
  shardRequests: number;
  maxConcurrentRequests: typeof GLOBAL_CONCURRENCY;
  perCountryFanout: false;
  commonQuery: boolean;
  unopenedShards: number;
  claimsAllWorldwideResults: false;
}

/**
 * Requests a common-term page actually scheduled.
 * A hierarchical page stays inside the four-request shard cap. Pending shard
 * paths are the countries that were not opened. Routing document frequency
 * is not a fanout count.
 */
export function readCommonTermFanout(page: WorldwidePage): CommonTermFanout {
  if (page.schema !== SEARCH_SCHEMA || page.fanout !== 'hierarchical' || page.perCountryFanout !== false) {
    throw new WorldwideSearchError('internal-invalid', 'common-term search fanned out by country');
  }
  if (page.claimsAllWorldwideResults !== false || page.fullPostingsLoaded !== false) {
    throw new WorldwideSearchError('internal-invalid', 'common-term search claimed a complete worldwide scan');
  }
  if (page.budgets.maxConcurrentRequests !== GLOBAL_CONCURRENCY || page.budgets.shardRequests > GLOBAL_CONCURRENCY) {
    throw new WorldwideSearchError('internal-invalid', 'common-term search opened more shards than the concurrency cap');
  }
  return {
    requests: page.budgets.requests,
    shardRequests: page.budgets.shardRequests,
    maxConcurrentRequests: GLOBAL_CONCURRENCY,
    perCountryFanout: false,
    commonQuery: page.commonQuery,
    unopenedShards: page.walk.pendingShardPaths.length,
    claimsAllWorldwideResults: false,
  };
}

export function pagesEnvelopeJson(index: GlobalRoutingIndex): string {
  const root = index.documents[index.rootPath];
  if (!root) throw new WorldwideSearchError('missing-document', 'the routing root is not in the index');
  return canonicalJson(root.envelope);
}

export function searchWorldwide(index: GlobalRoutingIndex, request: WorldwideSearchRequest | null | undefined): WorldwidePage {
  if (!index || index.schema !== GLOBAL_ROUTING_SCHEMA || index.perCountryFanout !== false) {
    throw new WorldwideSearchError('invalid-index', 'a hierarchical global routing index is required');
  }
  const root = directoryAt(index, index.rootPath);
  if (root.kind !== 'root' || root.perCountryFanout !== false) {
    throw new WorldwideSearchError('invalid-index', 'the routing root is not hierarchical');
  }
  if (index.catalogRevision !== rootEnvelope(index).catalogRevision) {
    throw new WorldwideSearchError('invalid-index', 'the catalog revision does not match the root');
  }
  const asked = request ?? {};
  const hasQuery = typeof asked.query === 'string' && asked.query.trim() !== '';
  const hasCitation = typeof asked.citation === 'string' && asked.citation.trim() !== '';
  if (hasQuery && hasCitation) throw new WorldwideSearchError('query-and-citation', 'pass a keyword query or a citation, not both');
  if (!hasQuery && !hasCitation) throw new WorldwideSearchError('query-empty', 'a keyword query or a citation is required');

  const filters = normalizeFilters(asked.filters, index.limits.maxFilterValues);
  const pageLimits = tightenLimits(index.limits, asked.limits, asked.pageSize);
  let mode: 'term' | 'citation';
  let normalized = '';
  let queryTruncated = false;
  let keys: string[] = [];
  if (hasCitation) {
    mode = 'citation';
    normalized = normalizeCiteKey(asked.citation);
    if (!normalized) throw new WorldwideSearchError('query-empty', 'the citation has no lookup key');
    keys = [normalized];
  } else {
    mode = 'term';
    const tokens = tokenize(asked.query);
    if (tokens.length === 0) throw new WorldwideSearchError('query-empty', 'the query has no searchable tokens');
    queryTruncated = tokens.length > index.limits.maxQueryTerms;
    keys = tokens.slice(0, index.limits.maxQueryTerms);
    normalized = keys.join(' ');
  }

  const binding: Binding = {
    catalogRevision: index.catalogRevision,
    mode,
    normalized,
    queryTruncated,
    filters,
    pageSize: pageLimits.pageSize,
    maxRequestsPerPage: pageLimits.maxRequestsPerPage,
    maxShardRequestsPerPage: pageLimits.maxShardRequestsPerPage,
    maxBytesPerPage: pageLimits.maxBytesPerPage,
  };

  const bindingHash = sha256HexUtf8(canonicalJson(binding));
  const keySet = new Set(keys);

  let state: CursorState;
  if (asked.cursor) {
    state = decodeCursor(asked.cursor);
    if (state.bindingHash !== bindingHash) {
      throw new WorldwideSearchError('cursor-mismatch', 'the cursor is bound to a different query, filter, catalog revision, or page budget');
    }
  } else {
    state = {
      v: 1,
      bindingHash,
      pendingDirectories: [],
      pendingShards: [],
      visitedShardPaths: [],
      visitedDirectoryPaths: [],
      filteredShards: 0,
      truncatedSeen: false,
      observedHits: 0,
      waveHits: [],
      siblingDirectoriesSkipped: 0,
      commonQuery: false,
    };
  }

  const siblingBefore = state.siblingDirectoriesSkipped;
  const loadedPaths: string[] = [];
  const openedShardPaths: string[] = [];
  let requests = 0;
  let bytes = 0;

  if (state.waveHits.length > 0) {
    return finishPage(index, root, binding, state, loadedPaths, openedShardPaths, requests, bytes, siblingBefore);
  }

  if (!asked.cursor) {
    const rootStored = storedAt(index, index.rootPath);
    if (rootStored.loadedBytes > pageLimits.maxBytesPerPage) {
      throw new WorldwideSearchError('root-exceeds-page-budget', `the routing root is ${rootStored.loadedBytes} bytes and the page budget is ${pageLimits.maxBytesPerPage}`);
    }
    const rootPointer: ChildPointer = {
      directoryId: root.directoryId,
      relativePath: index.rootPath,
      kind: 'coverage',
      firstKey: '',
      lastKey: '',
      payloadSha256: rootEnvelope(index).payloadSha256,
      loadedBytes: rootStored.loadedBytes,
    };
    loadDirectory(index, rootPointer, true);
  }

  while (state.pendingDirectories.length > 0) {
    const next = state.pendingDirectories[0];
    if (!next) break;
    if (next.loadedBytes > pageLimits.maxBytesPerPage) {
      throw new WorldwideSearchError('document-exceeds-page-budget', `${next.relativePath} is ${next.loadedBytes} bytes and the page budget is ${pageLimits.maxBytesPerPage}`);
    }
    if (bytes + next.loadedBytes > pageLimits.maxBytesPerPage) break;
    const reserve = state.pendingShards.length > 0
      ? Math.min(pageLimits.maxShardRequestsPerPage, state.pendingShards.length)
      : 0;
    if (requests + 1 + reserve > pageLimits.maxRequestsPerPage) break;
    state.pendingDirectories.shift();
    loadDirectory(index, next, false);
  }

  state.pendingShards.sort(compareShards);
  while (state.pendingShards.length > 0 && openedShardPaths.length < pageLimits.maxShardRequestsPerPage) {
    const next = state.pendingShards[0];
    if (!next) break;
    if (next.loadedBytes > pageLimits.maxBytesPerPage) {
      throw new WorldwideSearchError('document-exceeds-page-budget', `${next.relativePath} is ${next.loadedBytes} bytes and the page budget is ${pageLimits.maxBytesPerPage}`);
    }
    if (bytes + next.loadedBytes > pageLimits.maxBytesPerPage) break;
    if (requests + 1 > pageLimits.maxRequestsPerPage) break;
    state.pendingShards.shift();
    const stored = readStored(index, next.relativePath, next.payloadSha256, next.loadedBytes);
    const payload = stored.envelope.payload;
    if (isDirectoryPayload(payload) || payload.schema !== SHARD_SCHEMA) {
      throw new WorldwideSearchError('integrity', `${next.relativePath} is not a shard summary`);
    }
    if (payload.perCountryFanout !== false || payload.fullPostingsLoaded !== false || payload.relativePath !== next.relativePath) {
      throw new WorldwideSearchError('integrity', `${next.relativePath} is not a bounded shard summary`);
    }
    requests += 1;
    bytes += stored.loadedBytes;
    loadedPaths.push(next.relativePath);
    openedShardPaths.push(next.relativePath);
    state.visitedShardPaths.push(next.relativePath);
    if (payload.summariesTruncated || next.summariesTruncated) state.truncatedSeen = true;
    if (next.common) state.commonQuery = true;
    state.waveHits = mergeHits(state.waveHits, hitsFromSummary(payload));
  }

  return finishPage(index, root, binding, state, loadedPaths, openedShardPaths, requests, bytes, siblingBefore);

  function loadDirectory(target: GlobalRoutingIndex, pointer: ChildPointer, isRoot: boolean): void {
    if (state.visitedDirectoryPaths.includes(pointer.relativePath)) {
      throw new WorldwideSearchError('cursor-invalid', `directory ${pointer.relativePath} was already visited`);
    }
    const stored = readStored(target, pointer.relativePath, pointer.payloadSha256, pointer.loadedBytes);
    const payload = stored.envelope.payload;
    if (!isDirectoryPayload(payload)) throw new WorldwideSearchError('integrity', `${pointer.relativePath} is not a directory`);
    if (payload.perCountryFanout !== false || payload.routing !== 'hierarchical-term-citation') {
      throw new WorldwideSearchError('integrity', `${pointer.relativePath} is not hierarchical`);
    }
    requests += 1;
    bytes += stored.loadedBytes;
    loadedPaths.push(pointer.relativePath);
    state.visitedDirectoryPaths.push(pointer.relativePath);
    absorbDirectory(payload, isRoot);
  }

  function absorbDirectory(payload: DirectoryPayload, isRoot: boolean): void {
    if (payload.kind === 'coverage') {
      return;
    }
    if (isRoot || payload.kind === 'root') {
      const wanted = payload.children.filter((child) => child.kind === binding.mode || (child.kind === 'coverage' && !payload.coverageInline));
      state.siblingDirectoriesSkipped += payload.children.length - wanted.length;
      state.pendingDirectories.push(...wanted.map(copyPointer));
      return;
    }
    const matching = payload.children.filter((child) => keySetHasRange(child.firstKey, child.lastKey));
    state.siblingDirectoriesSkipped += payload.children.length - matching.length;
    state.pendingDirectories.push(...matching.map(copyPointer));
    for (const entry of payload.entries) {
      if (!keySet.has(entry.key)) continue;
      if (entry.common) state.commonQuery = true;
      for (const shard of entry.shards) considerShard(shard);
    }
    state.pendingShards.sort(compareShards);
  }

  function considerShard(shard: ShardPointer): void {
    if (state.visitedShardPaths.includes(shard.relativePath)) return;
    if (state.pendingShards.some((item) => item.relativePath === shard.relativePath)) return;
    if (!shardAllowed(shard, binding.filters)) {
      state.filteredShards += 1;
      return;
    }
    state.pendingShards.push(copyShard(shard));
    if (shard.common) state.commonQuery = true;
  }

  function keySetHasRange(firstKey: string, lastKey: string): boolean {
    for (const key of keys) {
      if (firstKey <= key && key <= lastKey) return true;
    }
    return false;
  }
}

function finishPage(
  index: GlobalRoutingIndex,
  root: DirectoryPayload,
  binding: Binding,
  state: CursorState,
  loadedPaths: string[],
  openedShardPaths: string[],
  requests: number,
  bytes: number,
  siblingBefore: number,
): WorldwidePage {
  const visible = filterHits(state.waveHits, binding.filters);
  const pageHits = visible.slice(0, binding.pageSize);
  const rest = visible.slice(binding.pageSize);
  const observedHits = state.observedHits + pageHits.length;
  const nextState: CursorState = {
    ...state,
    observedHits,
    waveHits: rest,
    pendingDirectories: state.pendingDirectories.map(copyPointer),
    pendingShards: state.pendingShards.map(copyShard),
    visitedShardPaths: [...state.visitedShardPaths],
    visitedDirectoryPaths: [...state.visitedDirectoryPaths],
  };
  const searchRemaining = nextState.pendingDirectories.length > 0 || nextState.pendingShards.length > 0 || nextState.waveHits.length > 0;
  const coverage = coverageView(index, root, nextState.visitedDirectoryPaths);
  const searchPartial = searchRemaining || nextState.truncatedSeen || binding.queryTruncated;
  coverage.searchState = searchPartial ? 'partial' : 'complete';
  coverage.state = coverage.catalogState === 'partial' || coverage.searchState === 'partial' || coverage.rowsPending ? 'partial' : 'known';
  coverage.partial = coverage.state === 'partial';
  const partialReasons: string[] = [];
  if (nextState.pendingDirectories.length > 0) partialReasons.push('unwalked-directories');
  if (nextState.pendingShards.length > 0) partialReasons.push('unopened-shards');
  if (nextState.waveHits.length > 0) partialReasons.push('wave-remainder');
  if (nextState.truncatedSeen) partialReasons.push('truncated-summaries');
  if (binding.queryTruncated) partialReasons.push('query-truncated');
  if (coverage.partialCollections > 0) partialReasons.push('partial-collection');
  if (coverage.missing > 0) partialReasons.push('missing-collection');
  if (coverage.unknown > 0) partialReasons.push('unknown-collection');
  if (coverage.unavailable > 0) partialReasons.push('unavailable-collection');
  if (!coverage.indexedRecordsComplete) partialReasons.push('indexed-records-incomplete');
  const catalogPartial = coverage.catalogState === 'partial';
  const blockedTotal = catalogPartial || nextState.truncatedSeen || binding.queryTruncated || searchRemaining;
  const matchTotal = blockedTotal ? null : observedHits;
  const continuation = searchRemaining;
  const cursor = continuation ? encodeCursor(nextState) : null;
  const routedShardTotalKnown = nextState.pendingDirectories.length === 0;
  const label = buildLabel({
    catalogPartial,
    visited: nextState.visitedShardPaths.length,
    pending: nextState.pendingShards.length,
    unwalked: nextState.pendingDirectories.length > 0,
    continuation,
    filtered: nextState.filteredShards,
  });
  if (label.toLowerCase().includes(FORBIDDEN_TOTAL_LABEL)) {
    throw new WorldwideSearchError('internal-invalid', 'the page label claims all worldwide results');
  }
  if (requests > binding.maxRequestsPerPage || bytes > binding.maxBytesPerPage || openedShardPaths.length > binding.maxShardRequestsPerPage) {
    throw new WorldwideSearchError('internal-invalid', 'the page exceeded a routing budget');
  }
  const partial = partialReasons.length > 0;
  return {
    schema: SEARCH_SCHEMA,
    catalogRevision: index.catalogRevision,
    mode: binding.mode,
    normalized: binding.normalized,
    queryTruncated: binding.queryTruncated,
    fanout: 'hierarchical',
    perCountryFanout: false,
    fullPostingsLoaded: false,
    claimsAllWorldwideResults: false,
    unsearchedTotalClaimed: false,
    matchTotal,
    observedHits,
    partial,
    continuation,
    cursor,
    hits: pageHits,
    label,
    coverage,
    partialReasons,
    budgets: {
      maxConcurrentRequests: GLOBAL_CONCURRENCY,
      maxRequestsPerPage: binding.maxRequestsPerPage,
      maxShardRequestsPerPage: binding.maxShardRequestsPerPage,
      maxBytesPerPage: binding.maxBytesPerPage,
      requests,
      bytes,
      shardRequests: openedShardPaths.length,
      batches: requests === 0 ? 0 : Math.ceil(requests / GLOBAL_CONCURRENCY),
      withinRequestBound: requests <= binding.maxRequestsPerPage,
      withinByteBound: bytes <= binding.maxBytesPerPage,
      withinShardBound: openedShardPaths.length <= binding.maxShardRequestsPerPage,
    },
    walk: {
      loadedPaths,
      openedShardPaths,
      visitedShardPaths: [...nextState.visitedShardPaths],
      pendingShardPaths: nextState.pendingShards.map((shard) => shard.relativePath),
      pendingDirectoryPaths: nextState.pendingDirectories.map((directory) => directory.relativePath),
      filteredShards: nextState.filteredShards,
      siblingDirectoriesSkipped: nextState.siblingDirectoriesSkipped,
      siblingDirectoriesSkippedThisPage: nextState.siblingDirectoriesSkipped - siblingBefore,
      unwalkedDirectories: nextState.pendingDirectories.length,
      remainingShardPointers: nextState.pendingShards.length,
      routedShardTotalKnown,
    },
    commonQuery: nextState.commonQuery,
    limitations: GLOBAL_LIMITATIONS,
  };
}

function buildLabel(input: {
  catalogPartial: boolean;
  visited: number;
  pending: number;
  unwalked: boolean;
  continuation: boolean;
  filtered: number;
}): string {
  const head = input.catalogPartial ? 'Partial coverage' : 'Pinned catalog coverage is known';
  const shards = input.unwalked
    ? `visited ${input.visited} routed shards; unwalked directories remain, so the shard total is unsearched`
    : `visited ${input.visited} of ${input.visited + input.pending} routed shards`;
  const tail = input.continuation
    ? 'Continuation visits the remaining routed shards. This page does not state an unsearched total.'
    : 'No routed shards remain for this cursor.';
  const filters = input.filtered > 0
    ? ` ${input.filtered} shard pointers were outside the filters and were not opened.`
    : '';
  return `${head}. ${shards}. ${tail}${filters}`;
}

function coverageView(index: GlobalRoutingIndex, root: DirectoryPayload, visitedDirectories: readonly string[]): WorldwidePage['coverage'] {
  const rollup = root.coverage;
  if (!rollup) throw new WorldwideSearchError('invalid-index', 'the routing root has no coverage rollup');
  let rows = rollup.rows;
  let rowsPending = false;
  if (!root.coverageInline) {
    rowsPending = true;
    rows = [];
    for (const path of visitedDirectories) {
      const payload = index.documents[path]?.envelope.payload;
      if (payload && isDirectoryPayload(payload) && payload.kind === 'coverage' && payload.coverage) {
        rows = payload.coverage.rows;
        rowsPending = false;
      }
    }
  }
  const ids = (state: CoverageState) => rows.filter((row) => row.state === state).map((row) => row.collectionId);
  const catalogPartial = rollup.partial > 0 || rollup.missing > 0 || rollup.unknown > 0 || rollup.unavailable > 0 || !rollup.indexedRecordsComplete;
  return {
    state: catalogPartial || rowsPending ? 'partial' : 'known',
    catalogState: catalogPartial ? 'partial' : 'known',
    searchState: 'partial',
    partial: true,
    collections: rollup.collections,
    known: rollup.known,
    partialCollections: rollup.partial,
    missing: rollup.missing,
    unknown: rollup.unknown,
    unavailable: rollup.unavailable,
    indexedRecords: rollup.indexedRecords,
    indexedRecordsComplete: rollup.indexedRecordsComplete,
    partialCollectionIds: ids('partial'),
    missingCollectionIds: ids('missing'),
    unknownCollectionIds: ids('unknown'),
    unavailableCollectionIds: ids('unavailable'),
    rowsPending,
    claimsAllWorldwideResults: false,
  };
}

function hitsFromSummary(payload: ShardSummaryPayload): WorldwideHit[] {
  return payload.hits.map((hit) => ({
    collectionId: payload.collectionId,
    jurisdictionId: payload.jurisdictionId,
    sourceRevision: payload.sourceRevision,
    documentId: hit.documentId,
    title: hit.title,
    language: hit.language,
    citation: hit.citation,
    score: hit.score,
    matchedKeys: [payload.key],
    coverage: payload.coverage,
    shardPaths: [payload.relativePath],
  }));
}

function mergeHits(existing: readonly WorldwideHit[], incoming: readonly WorldwideHit[]): WorldwideHit[] {
  const byKey = new Map<string, WorldwideHit>();
  for (const hit of [...existing, ...incoming]) {
    const key = `${hit.collectionId}\u0000${hit.documentId}`;
    const prior = byKey.get(key);
    if (!prior) {
      byKey.set(key, { ...hit, matchedKeys: [...hit.matchedKeys], shardPaths: [...hit.shardPaths] });
      continue;
    }
    prior.score += hit.score;
    prior.matchedKeys = [...new Set([...prior.matchedKeys, ...hit.matchedKeys])].sort();
    prior.shardPaths = [...new Set([...prior.shardPaths, ...hit.shardPaths])].sort();
    if (hit.coverage === 'partial') prior.coverage = 'partial';
    if (!prior.title && hit.title) prior.title = hit.title;
    if (!prior.language && hit.language) prior.language = hit.language;
    if (!prior.citation && hit.citation) prior.citation = hit.citation;
  }
  return [...byKey.values()].sort(compareHits);
}

function compareHits(left: WorldwideHit, right: WorldwideHit): number {
  if (left.score !== right.score) return right.score - left.score;
  if (left.collectionId !== right.collectionId) return left.collectionId < right.collectionId ? -1 : 1;
  if (left.documentId !== right.documentId) return left.documentId < right.documentId ? -1 : 1;
  return 0;
}

function compareShards(left: ShardPointer, right: ShardPointer): number {
  if (left.termDocumentFrequency !== right.termDocumentFrequency) return left.termDocumentFrequency - right.termDocumentFrequency;
  if (left.collectionId !== right.collectionId) return left.collectionId < right.collectionId ? -1 : 1;
  if (left.shardId !== right.shardId) return left.shardId < right.shardId ? -1 : 1;
  if (left.term !== right.term) return left.term < right.term ? -1 : 1;
  return 0;
}

function shardAllowed(shard: ShardPointer, filters: WorldwideFilters): boolean {
  if (filters.jurisdictions.length > 0 && !filters.jurisdictions.includes(shard.jurisdictionId)) return false;
  if (filters.collectionIds.length > 0 && !filters.collectionIds.includes(shard.collectionId)) return false;
  if (filters.languages.length > 0 && shard.languages.length > 0 && !shard.summariesTruncated) {
    return shard.languages.some((language) => filters.languages.includes(language));
  }
  return true;
}

function filterHits(hits: WorldwideHit[], filters: WorldwideFilters): WorldwideHit[] {
  if (filters.languages.length === 0) return hits;
  return hits.filter((hit) => hit.language !== '' && filters.languages.includes(hit.language));
}

function tightenLimits(indexLimits: GlobalRoutingLimits, requested: WorldwideSearchRequest['limits'], pageSize: number | null | undefined): PageLimits {
  const maxRequestsPerPage = clampDown(requested?.maxRequestsPerPage, indexLimits.maxRequestsPerPage, 1);
  const maxShardRequestsPerPage = clampDown(requested?.maxShardRequestsPerPage, indexLimits.maxShardRequestsPerPage, 1);
  const maxBytesPerPage = clampDown(requested?.maxBytesPerPage, indexLimits.maxBytesPerPage, 1);
  let size = indexLimits.pageSizeDefault;
  let supplied = false;
  if (pageSize !== undefined && pageSize !== null) {
    if (!Number.isSafeInteger(pageSize) || pageSize < 1) throw new WorldwideSearchError('invalid-page-size', 'pageSize must be a positive integer');
    size = pageSize;
    supplied = true;
  }
  if (size > indexLimits.pageSizeMax) size = indexLimits.pageSizeMax;
  if (supplied && pageSize && pageSize > indexLimits.pageSizeMax) size = indexLimits.pageSizeMax;
  return {
    maxRequestsPerPage: Math.min(maxRequestsPerPage, indexLimits.maxRequestsPerPage),
    maxShardRequestsPerPage: Math.min(maxShardRequestsPerPage, indexLimits.maxShardRequestsPerPage),
    maxBytesPerPage: Math.min(maxBytesPerPage, indexLimits.maxBytesPerPage),
    pageSize: size,
  };
}

function clampDown(value: number | undefined, ceiling: number, minimum: number): number {
  if (value === undefined) return ceiling;
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new WorldwideSearchError('invalid-budget', 'a page budget must be a positive integer');
  }
  return Math.min(value, ceiling);
}

function normalizeFilters(input: WorldwideSearchRequest['filters'], maxValues: number): WorldwideFilters {
  const source = input ?? {};
  return {
    jurisdictions: normalizeFilterList(source.jurisdictions, maxValues, 'jurisdictions', false),
    collectionIds: normalizeFilterList(source.collectionIds, maxValues, 'collectionIds', false),
    languages: normalizeFilterList(source.languages, maxValues, 'languages', true),
  };
}

function normalizeFilterList(value: readonly string[] | null | undefined, maxValues: number, field: string, lower: boolean): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new WorldwideSearchError('invalid-filter', `${field} must be an array`);
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || item.trim() === '' || item.length > 200) {
      throw new WorldwideSearchError('invalid-filter', `${field} contains an empty or oversized value`);
    }
    out.push(lower ? item.trim().toLowerCase() : item.trim());
  }
  const unique = [...new Set(out)].sort();
  if (unique.length > maxValues) throw new WorldwideSearchError('invalid-filter', `${field} exceeds ${maxValues} values`);
  return unique;
}

function copyPointer(pointer: ChildPointer): ChildPointer {
  return { ...pointer };
}

function copyShard(shard: ShardPointer): ShardPointer {
  return { ...shard, languages: [...shard.languages] };
}

function directoryAt(index: GlobalRoutingIndex, path: string): DirectoryPayload {
  const payload = storedAt(index, path).envelope.payload;
  if (!isDirectoryPayload(payload)) throw new WorldwideSearchError('invalid-index', `${path} is not a directory`);
  return payload;
}

function rootEnvelope(index: GlobalRoutingIndex): Envelope<RoutingPayload> {
  return storedAt(index, index.rootPath).envelope;
}

function storedAt(index: GlobalRoutingIndex, path: string): StoredDocument {
  const stored = index.documents[path];
  if (!stored) throw new WorldwideSearchError('missing-document', `${path} is not in the routing index`);
  return stored;
}

function readStored(index: GlobalRoutingIndex, path: string, expectedSha: string, expectedBytes: number): StoredDocument {
  const stored = storedAt(index, path);
  const payloadJson = canonicalJson(stored.envelope.payload);
  const actualSha = sha256HexUtf8(payloadJson);
  if (actualSha !== stored.envelope.payloadSha256 || stored.envelope.payloadSha256 !== expectedSha) {
    throw new WorldwideSearchError('integrity', `${path} payload checksum does not match`);
  }
  if (utf8Bytes(payloadJson).length !== stored.envelope.payloadBytes) {
    throw new WorldwideSearchError('integrity', `${path} payload byte count does not match`);
  }
  const loaded = utf8Bytes(canonicalJson(stored.envelope)).length;
  if (loaded !== stored.loadedBytes || loaded !== expectedBytes) {
    throw new WorldwideSearchError('integrity', `${path} loaded byte count does not match`);
  }
  if (stored.envelope.catalogRevision !== index.catalogRevision || stored.envelope.relativePath !== path) {
    throw new WorldwideSearchError('integrity', `${path} envelope identity does not match`);
  }
  return stored;
}

function encodeCursor(state: CursorState): string {
  return CURSOR_PREFIX + base64UrlEncode(utf8Bytes(canonicalJson(state)));
}

function decodeCursor(value: string): CursorState {
  if (typeof value !== 'string' || !value.startsWith(CURSOR_PREFIX)) {
    throw new WorldwideSearchError('cursor-invalid', 'the cursor prefix is not recognized');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(utf8Decode(base64UrlDecode(value.slice(CURSOR_PREFIX.length))));
  } catch {
    throw new WorldwideSearchError('cursor-invalid', 'the cursor is not canonical JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new WorldwideSearchError('cursor-invalid', 'the cursor payload is not an object');
  }
  const record = parsed as Record<string, unknown>;
  if (record.v !== 1 || typeof record.bindingHash !== 'string' || !/^[0-9a-f]{64}$/.test(record.bindingHash)) {
    throw new WorldwideSearchError('cursor-invalid', 'the cursor version or binding is invalid');
  }
  return {
    v: 1,
    bindingHash: record.bindingHash,
    pendingDirectories: readPointers(record.pendingDirectories),
    pendingShards: readShards(record.pendingShards),
    visitedShardPaths: readStrings(record.visitedShardPaths),
    visitedDirectoryPaths: readStrings(record.visitedDirectoryPaths),
    filteredShards: readCount(record.filteredShards),
    truncatedSeen: record.truncatedSeen === true,
    observedHits: readCount(record.observedHits),
    waveHits: readHits(record.waveHits),
    siblingDirectoriesSkipped: readCount(record.siblingDirectoriesSkipped),
    commonQuery: record.commonQuery === true,
  };
}

function readPointers(value: unknown): ChildPointer[] {
  if (!Array.isArray(value)) throw new WorldwideSearchError('cursor-invalid', 'pending directories are missing');
  return value.map((item) => {
    if (!item || typeof item !== 'object') throw new WorldwideSearchError('cursor-invalid', 'a directory pointer is invalid');
    const pointer = item as ChildPointer;
    if (typeof pointer.relativePath !== 'string' || typeof pointer.payloadSha256 !== 'string' || !Number.isSafeInteger(pointer.loadedBytes)) {
      throw new WorldwideSearchError('cursor-invalid', 'a directory pointer is invalid');
    }
    return copyPointer(pointer);
  });
}

function readShards(value: unknown): ShardPointer[] {
  if (!Array.isArray(value)) throw new WorldwideSearchError('cursor-invalid', 'pending shards are missing');
  return value.map((item) => {
    if (!item || typeof item !== 'object') throw new WorldwideSearchError('cursor-invalid', 'a shard pointer is invalid');
    const shard = item as ShardPointer;
    if (typeof shard.relativePath !== 'string' || typeof shard.collectionId !== 'string' || !Number.isSafeInteger(shard.loadedBytes)) {
      throw new WorldwideSearchError('cursor-invalid', 'a shard pointer is invalid');
    }
    return copyShard(shard);
  });
}

function readHits(value: unknown): WorldwideHit[] {
  if (!Array.isArray(value)) throw new WorldwideSearchError('cursor-invalid', 'wave hits are missing');
  return value.map((item) => {
    if (!item || typeof item !== 'object') throw new WorldwideSearchError('cursor-invalid', 'a wave hit is invalid');
    const hit = item as WorldwideHit;
    if (typeof hit.documentId !== 'string' || typeof hit.collectionId !== 'string' || !Number.isSafeInteger(hit.score)) {
      throw new WorldwideSearchError('cursor-invalid', 'a wave hit is invalid');
    }
    return {
      ...hit,
      matchedKeys: [...hit.matchedKeys],
      shardPaths: [...hit.shardPaths],
    };
  });
}

function readStrings(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new WorldwideSearchError('cursor-invalid', 'a cursor path list is invalid');
  }
  return [...value];
}

function readCount(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new WorldwideSearchError('cursor-invalid', 'a cursor counter is invalid');
  return value as number;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let out = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index] ?? 0;
    const b = index + 1 < bytes.length ? bytes[index + 1] ?? 0 : 0;
    const c = index + 2 < bytes.length ? bytes[index + 2] ?? 0 : 0;
    const triple = (a << 16) | (b << 8) | c;
    out += BASE64[(triple >> 18) & 63];
    out += BASE64[(triple >> 12) & 63];
    out += index + 1 < bytes.length ? BASE64[(triple >> 6) & 63] : '';
    out += index + 2 < bytes.length ? BASE64[triple & 63] : '';
  }
  return out;
}

function base64UrlDecode(text: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new WorldwideSearchError('cursor-invalid', 'the cursor encoding is invalid');
  const bytes: number[] = [];
  for (let index = 0; index < text.length; index += 4) {
    const a = BASE64.indexOf(text[index] ?? '');
    const b = BASE64.indexOf(text[index + 1] ?? '');
    const c = index + 2 < text.length ? BASE64.indexOf(text[index + 2] ?? '') : -2;
    const d = index + 3 < text.length ? BASE64.indexOf(text[index + 3] ?? '') : -2;
    if (a < 0 || b < 0 || c === -1 || d === -1) throw new WorldwideSearchError('cursor-invalid', 'the cursor encoding is invalid');
    const triple = (a << 18) | (b << 12) | ((c < 0 ? 0 : c) << 6) | (d < 0 ? 0 : d);
    bytes.push((triple >> 16) & 255);
    if (c >= 0) bytes.push((triple >> 8) & 255);
    if (d >= 0) bytes.push(triple & 255);
  }
  return Uint8Array.from(bytes);
}

function utf8Decode(bytes: Uint8Array): string {
  let out = '';
  for (let index = 0; index < bytes.length; index += 1) {
    const a = bytes[index] ?? 0;
    if (a < 0x80) out += String.fromCharCode(a);
    else if ((a & 0xe0) === 0xc0 && index + 1 < bytes.length) {
      const b = bytes[index + 1] ?? 0;
      out += String.fromCharCode(((a & 0x1f) << 6) | (b & 0x3f));
      index += 1;
    } else if ((a & 0xf0) === 0xe0 && index + 2 < bytes.length) {
      const b = bytes[index + 1] ?? 0;
      const c = bytes[index + 2] ?? 0;
      out += String.fromCharCode(((a & 0x0f) << 12) | ((b & 0x3f) << 6) | (c & 0x3f));
      index += 2;
    } else if (index + 3 < bytes.length) {
      const b = bytes[index + 1] ?? 0;
      const c = bytes[index + 2] ?? 0;
      const d = bytes[index + 3] ?? 0;
      const point = ((a & 0x07) << 18) | ((b & 0x3f) << 12) | ((c & 0x3f) << 6) | (d & 0x3f);
      out += String.fromCodePoint(point);
      index += 3;
    } else {
      throw new WorldwideSearchError('cursor-invalid', 'the cursor is not valid UTF-8');
    }
  }
  return out;
}

export function assertIdentifier(value: string, field: string): string {
  if (!ID_TEXT.test(value)) throw new WorldwideSearchError('invalid-identifier', `${field} is empty or uses unsupported characters`);
  return value;
}

/**
 * Place-scoped retrieval plan.
 *
 * The supported authority stack is resolved before any source is selected and
 * before any hit is ranked. Strict filters are allow-lists. They remove
 * sources and, later, hits. They are not score weights. Shard reads are then
 * grouped into batches of at most four. This module does not fetch and does
 * not rank.
 *
 * A municipality's administrative parent is included only when the authority
 * stack includes it. A nearer place, an unevidenced special district, and an
 * unevidenced supranational parent stay out. Nothing here decides that an
 * instrument binds conduct.
 */

import { canonicalJson, sha256HexUtf8 } from '../data/identity';
import { INSTRUMENT_KINDS } from '../data/schema';
import {
  APPLICABILITY,
  type JurisdictionGraph,
} from '../jurisdiction/schema';
import {
  AUTHORITY_BANDS,
  STACK_HEADING,
  joinAuthorityStack,
  type AuthorityBand,
  type AuthorityQuery,
  type AuthorityStack,
  type LawScopeInput,
} from '../jurisdiction/authority';
import {
  TEMPORAL_UNCERTAINTY,
  TemporalScopeError,
  scopeAsOf,
  type LawTemporalInput,
} from '../jurisdiction/temporal';

export const SEARCH_PLAN_SCHEMA = 'worldwide-legal-search.search-plan@1';
export const SEARCH_CONCURRENCY = 4;
export const RETRIEVAL_KINDS = ['bm25', 'citation', 'vector', 'title'] as const;
export const COVERAGE_STATES = ['known', 'partial', 'missing', 'unknown', 'unavailable'] as const;
export const SOURCE_DECISIONS = ['include', 'blocked', 'exclude'] as const;
export const STRICT_FILTER_FIELDS = [
  'bands',
  'placeIds',
  'topics',
  'instrumentKinds',
  'languages',
  'sourceIds',
  'statuses',
] as const;
export const RANKING_SIGNAL_FIELDS = ['query', 'citation', 'mode'] as const;
export const SEARCH_MODES = ['keyword', 'vector', 'hybrid', 'citation'] as const;
export const STATUS_FILTERS = [
  'current',
  'historical',
  'repealed',
  'superseded',
  'unknown',
  'in-force',
  'not-yet-in-force',
] as const;

export const PLAN_LIMITS = Object.freeze({
  maxSources: 500,
  maxShardsPerSource: 64,
  maxAuthorityIds: 64,
  maxFilterValues: 64,
  maxQueryChars: 2000,
  maxCitationChars: 500,
  maxIdChars: 200,
});

export const PLAN_LIMITATIONS = [
  'The authority stack is selected before source selection. This module does not rank and does not fetch shards.',
  'Strict filters are allow-lists. An empty list means that dimension is not applied. A filter never becomes a score weight.',
  'A strict place or band allow-list can narrow the stack. It cannot add a place the stack omitted.',
  'Searched collections are pinned sources with known or partial coverage. Missing, unknown, unavailable, blocked, excluded, and unpinned sources are counted and are not searched.',
  'Partial coverage is searched and remains partial. indexedRecords is the known-record denominator. eligibleRecords is not added to it. A null denominator makes the total incomplete.',
  'A stack candidate with no source is a coverage gap. It is not filled from a nearby place or a larger corpus.',
  'Shard requests are ordered by source id, kind, and shard id, then split into batches of at most 4. Record counts are not a priority.',
  'Temporal clocks are used only when the caller supplies them. A missing timezone is not treated as UTC, and unknown is not current.',
  'The plan does not decide that an instrument binds conduct.',
] as const;

const PINNED_REVISION = /^[0-9a-f]{40}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const KIND_SET = new Set<string>(RETRIEVAL_KINDS);
const COVERAGE_SET = new Set<string>(COVERAGE_STATES);
const DECISION_SET = new Set<string>(SOURCE_DECISIONS);
const BAND_SET = new Set<string>(AUTHORITY_BANDS);
const MODE_SET = new Set<string>(SEARCH_MODES);
const STATUS_SET = new Set<string>(STATUS_FILTERS);
const INSTRUMENT_SET = new Set<string>(INSTRUMENT_KINDS);
const STRICT_SET = new Set<string>(STRICT_FILTER_FIELDS);
const RANKING_SET = new Set<string>(RANKING_SIGNAL_FIELDS);

export type RetrievalKind = (typeof RETRIEVAL_KINDS)[number];
export type CoverageStateName = (typeof COVERAGE_STATES)[number];
export type SearchModeName = (typeof SEARCH_MODES)[number];
export type PlanStatus = 'stack-selected' | 'invalid-query' | 'unresolved';
export type SourceDisposition =
  | 'searched'
  | 'missing'
  | 'unknown'
  | 'unavailable'
  | 'blocked'
  | 'excluded'
  | 'unpinned'
  | 'unindexed'
  | 'filtered'
  | 'out-of-stack'
  | 'rejected';

export interface ShardInput {
  indexId?: unknown;
  kind?: unknown;
  shardId?: unknown;
  sha256?: unknown;
  relativePath?: unknown;
}

export interface SearchSourceInput {
  sourceId?: unknown;
  sourceRevision?: unknown;
  authorityIds?: unknown;
  bands?: unknown;
  coverageState?: unknown;
  decision?: unknown;
  indexedRecords?: unknown;
  eligibleRecords?: unknown;
  capabilities?: unknown;
  languages?: unknown;
  instrumentKinds?: unknown;
  topics?: unknown;
  shards?: unknown;
  reason?: unknown;
}

export interface SearchFilterInput {
  bands?: unknown;
  placeIds?: unknown;
  topics?: unknown;
  instrumentKinds?: unknown;
  languages?: unknown;
  sourceIds?: unknown;
  statuses?: unknown;
  query?: unknown;
  citation?: unknown;
  mode?: unknown;
}

export interface TemporalPlanInput {
  places?: readonly { placeId?: unknown; timeZone?: unknown }[];
  boundaries?: readonly { boundaryId?: unknown; timeZone?: unknown }[];
  laws?: readonly LawTemporalInput[];
}

export interface PlaceSearchInput {
  graph?: JurisdictionGraph | null;
  placeId?: unknown;
  asOf?: unknown;
  viewIds?: readonly string[] | null;
  laws?: readonly LawScopeInput[] | null;
  nearbyPlaceIds?: readonly string[] | null;
  sources?: readonly SearchSourceInput[] | null;
  filters?: SearchFilterInput | null;
  temporal?: TemporalPlanInput | null;
}

export interface StrictFilters {
  bands: string[];
  placeIds: string[];
  topics: string[];
  instrumentKinds: string[];
  languages: string[];
  sourceIds: string[];
  statuses: string[];
}

export interface RankingSignals {
  query: string;
  citation: string;
  mode: SearchModeName | null;
  queryTruncated: boolean;
  citationTruncated: boolean;
}

export interface IsolatedFilters {
  strict: StrictFilters;
  ranking: RankingSignals;
  problems: string[];
  fatal: boolean;
}

export interface SourceCounts {
  searchedSources: number;
  missingSources: number;
  searchedCollections: number;
  missingCollections: number;
  partialSources: number;
  unknownSources: number;
  unavailableSources: number;
  blockedSources: number;
  excludedSources: number;
  unpinnedSources: number;
  unindexedSources: number;
  filteredSources: number;
  outOfStackSources: number;
  rejectedSources: number;
  stackCandidates: number;
  stackCandidatesWithoutSource: number;
  stackCandidatesNotSearched: number;
  knownRecords: number;
  knownRecordsComplete: boolean;
}

export interface ClassifiedSource {
  sourceId: string;
  sourceRevision: string | null;
  disposition: SourceDisposition;
  reason: string;
  coverageState: string | null;
  authorityIds: string[];
  matchedCandidateIds: string[];
  indexedRecords: number | null;
  eligibleRecords: number | null;
  partial: boolean;
}

export interface PlannedRequest {
  sourceId: string;
  sourceRevision: string;
  indexId: string;
  kind: RetrievalKind;
  shardId: string;
  sha256: string | null;
  relativePath: string | null;
  authorityIds: string[];
  coverageState: 'known' | 'partial';
}

export interface ShardBatch {
  batchIndex: number;
  concurrency: typeof SEARCH_CONCURRENCY;
  requests: PlannedRequest[];
}

export interface PlannedTemporalLaw {
  lawId: string;
  lawStatus: string;
  current: boolean;
  declaredStatus: string | null;
}

export interface CandidateBand {
  id: string;
  band: AuthorityBand;
}

export interface TemporalSummary {
  requested: boolean;
  currentLawIds: string[];
  currentPlaceIds: string[];
  unknownNotCurrent: boolean;
  truncated: boolean;
  error: string | null;
}

export interface SearchPlan {
  schema: typeof SEARCH_PLAN_SCHEMA;
  status: PlanStatus;
  phase: 'stack-selected' | 'withheld';
  applicability: typeof APPLICABILITY;
  heading: typeof STACK_HEADING;
  ranking: 'deferred';
  stackResolvedBeforeRanking: boolean;
  steps: string[];
  placeId: string | null;
  asOf: string | null;
  graphId: string | null;
  stack: AuthorityStack | null;
  stackCandidateIds: string[];
  byBand: Record<AuthorityBand, string[]>;
  candidateBands: CandidateBand[];
  omitted: Array<{ id: string; reason: string }>;
  inclusionByCandidateId: Record<string, string[]>;
  strictFilters: StrictFilters;
  rankingSignals: RankingSignals;
  problems: string[];
  temporal: TemporalSummary;
  temporalLaws: PlannedTemporalLaw[];
  sources: ClassifiedSource[];
  searchedSourceIds: string[];
  missingSourceIds: string[];
  filteredSourceIds: string[];
  batches: ShardBatch[];
  counts: SourceCounts;
  selectionKey: string;
  limitations: readonly string[];
  uncertainty: string[];
  truncated: boolean;
}

export interface FilterableHit {
  sourceId?: string | null;
  authorityIds?: readonly string[] | null;
  territorialIds?: readonly string[] | null;
  issuerIds?: readonly string[] | null;
  bands?: readonly string[] | null;
  topics?: readonly string[] | null;
  instrumentKind?: string | null;
  language?: string | null;
  status?: string | null;
  lawId?: string | null;
}

export interface FilterContext {
  bandByAuthorityId: ReadonlyMap<string, string>;
  temporalByLawId: ReadonlyMap<string, PlannedTemporalLaw>;
}

interface NormalizedShard {
  indexId: string;
  kind: RetrievalKind;
  shardId: string;
  sha256: string | null;
  relativePath: string | null;
}

interface NormalizedSource {
  sourceId: string;
  sourceRevision: string | null;
  pinned: boolean;
  authorityIds: string[];
  declaredBands: string[];
  coverageState: CoverageStateName | null;
  decision: 'include' | 'blocked' | 'exclude' | null;
  indexedRecords: number | null;
  indexedRecordsKnown: boolean;
  eligibleRecords: number | null;
  capabilities: string[];
  languages: string[];
  instrumentKinds: string[];
  topics: string[];
  shards: NormalizedShard[];
  problems: string[];
  rejected: string | null;
}

interface ReadySource extends NormalizedSource {
  sourceRevision: string;
  coverageState: 'known' | 'partial';
  matchedCandidateIds: string[];
  requests: PlannedRequest[];
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function clean(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).trim();
  return text ? text : null;
}

function hasControl(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

function unique(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function sortedUnique(values: readonly string[]): string[] {
  return unique(values).sort(compareText);
}

export function emptyStrictFilters(): StrictFilters {
  return {
    bands: [],
    placeIds: [],
    topics: [],
    instrumentKinds: [],
    languages: [],
    sourceIds: [],
    statuses: [],
  };
}

function emptyRanking(): RankingSignals {
  return { query: '', citation: '', mode: null, queryTruncated: false, citationTruncated: false };
}

function emptyCounts(): SourceCounts {
  return {
    searchedSources: 0,
    missingSources: 0,
    searchedCollections: 0,
    missingCollections: 0,
    partialSources: 0,
    unknownSources: 0,
    unavailableSources: 0,
    blockedSources: 0,
    excludedSources: 0,
    unpinnedSources: 0,
    unindexedSources: 0,
    filteredSources: 0,
    outOfStackSources: 0,
    rejectedSources: 0,
    stackCandidates: 0,
    stackCandidatesWithoutSource: 0,
    stackCandidatesNotSearched: 0,
    knownRecords: 0,
    knownRecordsComplete: true,
  };
}

function emptyBands(): Record<AuthorityBand, string[]> {
  return {
    national: [],
    regional: [],
    local: [],
    special: [],
    supranational: [],
    unclassified: [],
  };
}

function emptyTemporal(): TemporalSummary {
  return {
    requested: false,
    currentLawIds: [],
    currentPlaceIds: [],
    unknownNotCurrent: false,
    truncated: false,
    error: null,
  };
}

function selectionKeyFor(material: unknown): string {
  return sha256HexUtf8(canonicalJson(material));
}

function readIdList(value: unknown, label: string, problems: string[]): string[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    problems.push(`${label} must be an array.`);
    return null;
  }
  const ids: string[] = [];
  for (const item of value) {
    const text = clean(item);
    if (!text || hasControl(text) || text.length > PLAN_LIMITS.maxIdChars) {
      problems.push(`${label} contains a value that is not a usable id.`);
      continue;
    }
    ids.push(text);
  }
  const deduped = unique(ids);
  if (deduped.length > PLAN_LIMITS.maxAuthorityIds) {
    problems.push(`${label} was past ${PLAN_LIMITS.maxAuthorityIds} and was not fully used.`);
    return deduped.slice(0, PLAN_LIMITS.maxAuthorityIds);
  }
  return deduped;
}

function safeRelative(path: string): boolean {
  if (!path || path.startsWith('/') || path.includes('\\') || path.includes('\0')) return false;
  return path.split('/').every((part) => part.length > 0 && part !== '.' && part !== '..');
}

function readCount(value: unknown): { value: number | null; known: boolean } {
  if (value === undefined || value === null || value === '') return { value: null, known: false };
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return { value: null, known: false };
  return { value, known: true };
}

function normalizeShard(input: ShardInput, problems: string[]): NormalizedShard | null {
  const indexId = clean(input?.indexId);
  const shardId = clean(input?.shardId);
  const kind = clean(input?.kind);
  if (!indexId || !shardId || !kind || !KIND_SET.has(kind) || hasControl(indexId) || hasControl(shardId)) {
    problems.push('A shard is missing a retrieval kind, index id, or shard id and was not planned.');
    return null;
  }
  let sha256: string | null = null;
  if (input.sha256 !== undefined && input.sha256 !== null && input.sha256 !== '') {
    const digest = clean(input.sha256);
    if (!digest || !SHA256_HEX.test(digest)) {
      problems.push(`Shard ${shardId} has no usable sha256 and was not planned.`);
      return null;
    }
    sha256 = digest;
  }
  let relativePath: string | null = null;
  if (input.relativePath !== undefined && input.relativePath !== null && input.relativePath !== '') {
    const path = clean(input.relativePath);
    if (!path || !safeRelative(path)) {
      problems.push(`Shard ${shardId} has an unsafe relative path and was not planned.`);
      return null;
    }
    relativePath = path;
  }
  return { indexId, shardId, kind: kind as RetrievalKind, sha256, relativePath };
}

function normalizeSource(input: SearchSourceInput, index: number): NormalizedSource {
  const problems: string[] = [];
  const sourceId = clean(input?.sourceId);
  if (!sourceId || hasControl(sourceId) || sourceId.length > PLAN_LIMITS.maxIdChars) {
    return {
      sourceId: sourceId || `source#${index}`,
      sourceRevision: null,
      pinned: false,
      authorityIds: [],
      declaredBands: [],
      coverageState: null,
      decision: null,
      indexedRecords: null,
      indexedRecordsKnown: false,
      eligibleRecords: null,
      capabilities: [],
      languages: [],
      instrumentKinds: [],
      topics: [],
      shards: [],
      problems: ['A source id is required. No source was invented.'],
      rejected: 'invalid-source',
    };
  }
  const authorityIds = readIdList(input.authorityIds, `${sourceId} authorityIds`, problems);
  if (!authorityIds || authorityIds.length === 0) {
    problems.push(`${sourceId} names no authority id.`);
    return rejectedSource(sourceId, problems, 'invalid-source');
  }
  const revision = clean(input.sourceRevision);
  const pinned = Boolean(revision && PINNED_REVISION.test(revision));
  const coverageText = clean(input.coverageState);
  const coverageState = coverageText && COVERAGE_SET.has(coverageText) ? coverageText as CoverageStateName : null;
  if (!coverageState) problems.push(`${sourceId} has no usable coverage state.`);
  const decisionText = input.decision === undefined || input.decision === null || input.decision === ''
    ? 'include'
    : clean(input.decision);
  const decision = decisionText && DECISION_SET.has(decisionText)
    ? decisionText as 'include' | 'blocked' | 'exclude'
    : null;
  if (!decision) problems.push(`${sourceId} has no usable decision and was not searched.`);
  const indexed = readCount(input.indexedRecords);
  const eligible = readCount(input.eligibleRecords);
  const capabilities = sortedUnique((readIdList(input.capabilities, `${sourceId} capabilities`, problems) ?? [])
    .map((item) => item.toLowerCase()));
  const languages = sortedUnique((readIdList(input.languages, `${sourceId} languages`, problems) ?? [])
    .map((item) => item.toLowerCase()));
  const instrumentKinds = sortedUnique((readIdList(input.instrumentKinds, `${sourceId} instrumentKinds`, problems) ?? [])
    .map((item) => item.toLowerCase()));
  const topics = sortedUnique((readIdList(input.topics, `${sourceId} topics`, problems) ?? [])
    .map((item) => item.toLowerCase()));
  const declaredBands = sortedUnique((readIdList(input.bands, `${sourceId} bands`, problems) ?? [])
    .map((item) => item.toLowerCase()));
  const shards: NormalizedShard[] = [];
  if (input.shards !== undefined && input.shards !== null && !Array.isArray(input.shards)) {
    problems.push(`${sourceId} shards must be an array.`);
  } else if (Array.isArray(input.shards)) {
    for (const shard of input.shards) {
      const normalized = normalizeShard(shard as ShardInput, problems);
      if (normalized) shards.push(normalized);
      if (shards.length >= PLAN_LIMITS.maxShardsPerSource) break;
    }
  }
  shards.sort((left, right) => compareText(left.kind, right.kind)
    || compareText(left.shardId, right.shardId)
    || compareText(left.indexId, right.indexId));
  const seen = new Set<string>();
  const uniqueShards: NormalizedShard[] = [];
  for (const shard of shards) {
    const key = `${shard.kind}\u001f${shard.shardId}\u001f${shard.indexId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueShards.push(shard);
  }
  return {
    sourceId,
    sourceRevision: revision,
    pinned,
    authorityIds,
    declaredBands,
    coverageState,
    decision,
    indexedRecords: indexed.value,
    indexedRecordsKnown: indexed.known,
    eligibleRecords: eligible.known ? eligible.value : null,
    capabilities,
    languages,
    instrumentKinds,
    topics,
    shards: uniqueShards,
    problems,
    rejected: null,
  };
}

function rejectedSource(sourceId: string, problems: string[], reason: string): NormalizedSource {
  return {
    sourceId,
    sourceRevision: null,
    pinned: false,
    authorityIds: [],
    declaredBands: [],
    coverageState: null,
    decision: null,
    indexedRecords: null,
    indexedRecordsKnown: false,
    eligibleRecords: null,
    capabilities: [],
    languages: [],
    instrumentKinds: [],
    topics: [],
    shards: [],
    problems,
    rejected: reason,
  };
}

function classifyRow(
  source: NormalizedSource,
  disposition: SourceDisposition,
  reason: string,
  matched: string[],
): ClassifiedSource {
  return {
    sourceId: source.sourceId,
    sourceRevision: source.sourceRevision,
    disposition,
    reason,
    coverageState: source.coverageState,
    authorityIds: [...source.authorityIds],
    matchedCandidateIds: [...matched],
    indexedRecords: source.indexedRecords,
    eligibleRecords: source.eligibleRecords,
    partial: source.coverageState === 'partial' && disposition === 'searched',
  };
}

function retrievalKinds(source: NormalizedSource): RetrievalKind[] {
  const kinds = new Set<RetrievalKind>();
  for (const capability of source.capabilities) {
    if (KIND_SET.has(capability)) kinds.add(capability as RetrievalKind);
  }
  for (const shard of source.shards) kinds.add(shard.kind);
  return [...kinds].sort(compareText);
}

function requestsFor(source: ReadySource): PlannedRequest[] {
  if (source.shards.length > 0) {
    return source.shards.map((shard) => ({
      sourceId: source.sourceId,
      sourceRevision: source.sourceRevision,
      indexId: shard.indexId,
      kind: shard.kind,
      shardId: shard.shardId,
      sha256: shard.sha256,
      relativePath: shard.relativePath,
      authorityIds: [...source.matchedCandidateIds],
      coverageState: source.coverageState,
    }));
  }
  return retrievalKinds(source).map((kind) => ({
    sourceId: source.sourceId,
    sourceRevision: source.sourceRevision,
    indexId: `${source.sourceId}:${kind}`,
    kind,
    shardId: `${source.sourceId}/${kind}`,
    sha256: null,
    relativePath: null,
    authorityIds: [...source.matchedCandidateIds],
    coverageState: source.coverageState,
  }));
}

function disjoint(declared: readonly string[], allowed: readonly string[]): boolean {
  if (declared.length === 0 || allowed.length === 0) return false;
  const allow = new Set(allowed);
  return declared.every((item) => !allow.has(item));
}

function readFilterTokens(
  value: unknown,
  label: string,
  problems: string[],
  accept: (token: string) => boolean,
  fold: (token: string) => string,
): { values: string[]; fatal: boolean } {
  if (value === undefined || value === null) return { values: [], fatal: false };
  const items = Array.isArray(value) ? value : [value];
  if (!Array.isArray(value) && typeof value !== 'string' && typeof value !== 'number') {
    problems.push(`${label} must be a list of strings.`);
    return { values: [], fatal: true };
  }
  if (items.length === 0) return { values: [], fatal: false };
  const accepted: string[] = [];
  let rejected = 0;
  for (const item of items) {
    const text = clean(item);
    if (!text || hasControl(text)) {
      rejected += 1;
      continue;
    }
    const folded = fold(text);
    if (!accept(folded)) {
      rejected += 1;
      problems.push(`${label} rejected ${JSON.stringify(text)}.`);
      continue;
    }
    accepted.push(folded);
  }
  const values = sortedUnique(accepted).slice(0, PLAN_LIMITS.maxFilterValues);
  if (accepted.length > PLAN_LIMITS.maxFilterValues) {
    problems.push(`${label} was past ${PLAN_LIMITS.maxFilterValues} values.`);
  }
  if (values.length === 0 && rejected > 0) {
    problems.push(`${label} had no usable value, so the search was not run.`);
    return { values: [], fatal: true };
  }
  return { values, fatal: false };
}

export function isolateStrictFilters(input: SearchFilterInput | null | undefined): IsolatedFilters {
  const problems: string[] = [];
  const strict = emptyStrictFilters();
  const ranking = emptyRanking();
  if (input === undefined || input === null) {
    return { strict, ranking, problems, fatal: false };
  }
  if (typeof input !== 'object' || Array.isArray(input)) {
    return {
      strict,
      ranking,
      problems: ['Filters must be an object. No filter was inferred.'],
      fatal: true,
    };
  }
  const record = input as unknown as Record<string, unknown>;
  for (const key of Object.keys(record).sort(compareText)) {
    if (!STRICT_SET.has(key) && !RANKING_SET.has(key)) {
      problems.push(`Filter ${JSON.stringify(key)} is not a strict filter or a ranking signal and was ignored.`);
    }
  }
  let fatal = false;
  const bands = readFilterTokens(record.bands, 'bands', problems, (token) => BAND_SET.has(token), (token) => token.toLowerCase());
  const places = readFilterTokens(record.placeIds, 'placeIds', problems, (token) => token.length <= PLAN_LIMITS.maxIdChars, (token) => token);
  const topics = readFilterTokens(record.topics, 'topics', problems, (token) => token.length <= 80, (token) => token.toLowerCase());
  const kinds = readFilterTokens(record.instrumentKinds, 'instrumentKinds', problems, (token) => INSTRUMENT_SET.has(token), (token) => token.toLowerCase());
  const languages = readFilterTokens(record.languages, 'languages', problems, (token) => /^[a-z0-9][a-z0-9-]{0,31}$/.test(token), (token) => token.toLowerCase());
  const sources = readFilterTokens(record.sourceIds, 'sourceIds', problems, (token) => token.length <= PLAN_LIMITS.maxIdChars, (token) => token);
  const statuses = readFilterTokens(record.statuses, 'statuses', problems, (token) => STATUS_SET.has(token), (token) => token.toLowerCase());
  fatal = bands.fatal || places.fatal || topics.fatal || kinds.fatal || languages.fatal || sources.fatal || statuses.fatal;
  strict.bands = bands.values;
  strict.placeIds = places.values;
  strict.topics = topics.values;
  strict.instrumentKinds = kinds.values;
  strict.languages = languages.values;
  strict.sourceIds = sources.values;
  strict.statuses = statuses.values;

  if (record.query !== undefined && record.query !== null && record.query !== '') {
    const query = clean(record.query);
    if (!query || hasControl(query)) {
      problems.push('The query is not usable text.');
      fatal = true;
    } else if (query.length > PLAN_LIMITS.maxQueryChars) {
      ranking.query = query.slice(0, PLAN_LIMITS.maxQueryChars);
      ranking.queryTruncated = true;
      problems.push('The query was truncated to the ranking-signal cap.');
    } else ranking.query = query;
  }
  if (record.citation !== undefined && record.citation !== null && record.citation !== '') {
    const citation = clean(record.citation);
    if (!citation || hasControl(citation)) {
      problems.push('The citation signal is not usable text.');
      fatal = true;
    } else if (citation.length > PLAN_LIMITS.maxCitationChars) {
      ranking.citation = citation.slice(0, PLAN_LIMITS.maxCitationChars);
      ranking.citationTruncated = true;
      problems.push('The citation signal was truncated.');
    } else ranking.citation = citation;
  }
  if (record.mode !== undefined && record.mode !== null && record.mode !== '') {
    const mode = clean(record.mode)?.toLowerCase() ?? '';
    if (!MODE_SET.has(mode)) {
      problems.push(`Search mode ${JSON.stringify(record.mode)} is not a ranking mode.`);
      fatal = true;
    } else ranking.mode = mode as SearchModeName;
  }
  return { strict, ranking, problems: sortedUnique(problems), fatal };
}

function languageMatches(hitLanguage: string, filterLanguage: string): boolean {
  const hit = hitLanguage.toLowerCase();
  const filter = filterLanguage.toLowerCase();
  if (hit === filter) return true;
  return !filter.includes('-') && (hit.startsWith(`${filter}-`) || hit.startsWith(`${filter}_`));
}

function statusAgrees(hitStatus: string, law: PlannedTemporalLaw): boolean {
  const status = hitStatus.toLowerCase();
  if (law.lawStatus === 'in-force') return status === 'current' || status === 'in-force';
  if (law.lawStatus === 'unknown') return status === 'unknown';
  return status === law.lawStatus;
}

function wantedStatus(hit: FilterableHit, wanted: string, temporal: PlannedTemporalLaw | undefined): boolean {
  if (temporal) {
    if (wanted === 'current' || wanted === 'in-force') return temporal.current;
    if (temporal.lawStatus !== wanted) return false;
    if (hit.status && !statusAgrees(hit.status, temporal)) return false;
    return true;
  }
  const status = clean(hit.status)?.toLowerCase() ?? '';
  if (!status) return false;
  if (wanted === 'current') return status === 'current' || status === 'in-force';
  if (wanted === 'in-force') return status === 'in-force' || status === 'current';
  return status === wanted;
}

/**
 * Strict filters are predicates. A miss returns a reason and no score.
 * Unknown status does not satisfy current or in-force.
 */
export function hitMatchesStrictFilters(
  hit: FilterableHit,
  filters: StrictFilters,
  context: FilterContext,
): { ok: true } | { ok: false; reason: string } {
  if (filters.bands.length > 0) {
    const declared = (hit.bands ?? []).map((item) => clean(item)?.toLowerCase() ?? '').filter((item) => item);
    const fromAuthority = (hit.authorityIds ?? [])
      .map((id) => context.bandByAuthorityId.get(clean(id) ?? ''))
      .filter((item): item is string => Boolean(item));
    const bands = declared.length > 0 ? declared : fromAuthority;
    if (bands.length === 0) return { ok: false, reason: 'strict-band-unknown' };
    if (!bands.some((band) => filters.bands.includes(band))) return { ok: false, reason: 'strict-band' };
  }
  if (filters.placeIds.length > 0) {
    const ids = unique([
      ...(hit.territorialIds ?? []),
      ...(hit.issuerIds ?? []),
      ...(hit.authorityIds ?? []),
    ].map((id) => clean(id) ?? '').filter((id) => id));
    if (ids.length === 0) return { ok: false, reason: 'strict-place-unknown' };
    if (!ids.some((id) => filters.placeIds.includes(id))) return { ok: false, reason: 'strict-place' };
  }
  if (filters.topics.length > 0) {
    const topics = (hit.topics ?? []).map((item) => clean(item)?.toLowerCase() ?? '').filter((item) => item);
    if (!topics.some((topic) => filters.topics.includes(topic))) return { ok: false, reason: 'strict-topic' };
  }
  if (filters.instrumentKinds.length > 0) {
    const kind = clean(hit.instrumentKind)?.toLowerCase() ?? '';
    if (!kind || !filters.instrumentKinds.includes(kind)) return { ok: false, reason: 'strict-instrument' };
  }
  if (filters.languages.length > 0) {
    const language = clean(hit.language) ?? '';
    if (!language || !filters.languages.some((filter) => languageMatches(language, filter))) {
      return { ok: false, reason: 'strict-language' };
    }
  }
  if (filters.sourceIds.length > 0) {
    const sourceId = clean(hit.sourceId) ?? '';
    if (!filters.sourceIds.includes(sourceId)) return { ok: false, reason: 'strict-source' };
  }
  if (filters.statuses.length > 0) {
    const lawId = clean(hit.lawId);
    const temporal = lawId ? context.temporalByLawId.get(lawId) : undefined;
    if (!filters.statuses.some((wanted) => wantedStatus(hit, wanted, temporal))) {
      return { ok: false, reason: 'strict-status' };
    }
  }
  return { ok: true };
}

function stackOrder(ids: readonly string[]): Map<string, number> {
  const order = new Map<string, number>();
  ids.forEach((id, index) => order.set(id, index));
  return order;
}

function inStackOrder(ids: readonly string[], order: ReadonlyMap<string, number>): string[] {
  return [...ids].sort((left, right) => (order.get(left) ?? Number.MAX_SAFE_INTEGER) - (order.get(right) ?? Number.MAX_SAFE_INTEGER)
    || compareText(left, right));
}

function inclusionMap(stack: AuthorityStack): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const candidate of stack.candidates) {
    const lines: string[] = [];
    for (const side of [candidate.territory, candidate.issuer]) {
      if (!side) continue;
      for (const inclusion of side.inclusions) lines.push(inclusion.because);
    }
    map[candidate.id] = lines;
  }
  return map;
}

function buildKey(input: {
  placeId: string | null;
  asOf: string | null;
  viewIds: string[];
  stackCandidateIds: string[];
  searchedSourceIds: string[];
  missingSourceIds: string[];
  filteredSourceIds: string[];
  batches: ShardBatch[];
  strict: StrictFilters;
}): string {
  return selectionKeyFor({
    asOf: input.asOf,
    batches: input.batches.map((batch) => batch.requests.map((request) => ({
      indexId: request.indexId,
      kind: request.kind,
      shardId: request.shardId,
      sourceId: request.sourceId,
      sourceRevision: request.sourceRevision,
    }))),
    filteredSourceIds: input.filteredSourceIds,
    missingSourceIds: input.missingSourceIds,
    placeId: input.placeId,
    searchedSourceIds: input.searchedSourceIds,
    stackCandidateIds: input.stackCandidateIds,
    strict: input.strict,
    viewIds: input.viewIds,
  });
}

/**
 * Resolve the place stack, isolate strict filters, and choose the collections
 * to search. Ranking stays deferred.
 */
export function planPlaceSearch(input: PlaceSearchInput | null | undefined): SearchPlan {
  const problems: string[] = [];
  const uncertainty: string[] = [];
  let truncated = false;
  const graph = input && typeof input === 'object' ? input.graph ?? null : null;
  const placeId = clean(input?.placeId);
  const asOf = clean(input?.asOf);
  const viewIds = Array.isArray(input?.viewIds) ? input.viewIds.filter((id): id is string => typeof id === 'string') : [];
  const query: AuthorityQuery = {
    placeId: placeId ?? '',
    asOf: asOf ?? '',
    viewIds,
    laws: Array.isArray(input?.laws) ? input.laws : [],
    nearbyPlaceIds: Array.isArray(input?.nearbyPlaceIds) ? input.nearbyPlaceIds : [],
  };
  const stack = joinAuthorityStack(graph as JurisdictionGraph, query);
  const stackCandidateIds = stack.candidates.map((candidate) => candidate.id);
  const order = stackOrder(stackCandidateIds);
  const candidateBands = stack.candidates.map((candidate) => ({ id: candidate.id, band: candidate.band }));
  const byBand = emptyBands();
  for (const band of AUTHORITY_BANDS) byBand[band] = [...(stack.byBand[band] ?? [])];
  const steps = ['authority-stack'];
  const isolated = isolateStrictFilters(input?.filters);
  steps.push('strict-filters');
  problems.push(...isolated.problems);

  let temporal = emptyTemporal();
  let temporalLaws: PlannedTemporalLaw[] = [];
  const temporalRequested = Boolean(input && input.temporal);
  if (!temporalRequested) {
    steps.push('temporal-scope-skipped');
  } else if (stack.status !== 'resolved' || !graph) {
    temporal = { ...emptyTemporal(), requested: true, error: 'Temporal scope was not run because the authority stack did not resolve.' };
    steps.push('temporal-scope-withheld');
  } else {
    try {
      const scoped = scopeAsOf({
        graph,
        asOf: asOf ?? '',
        viewIds,
        places: input?.temporal?.places,
        boundaries: input?.temporal?.boundaries,
        laws: input?.temporal?.laws,
      });
      temporal = {
        requested: true,
        currentLawIds: [...scoped.currentLawIds],
        currentPlaceIds: [...scoped.currentPlaceIds],
        unknownNotCurrent: scoped.uncertainty.includes(TEMPORAL_UNCERTAINTY.unknownNotCurrent),
        truncated: scoped.truncated,
        error: null,
      };
      temporalLaws = scoped.laws.map((law) => ({
        lawId: law.lawId,
        lawStatus: law.lawStatus,
        current: law.current,
        declaredStatus: law.declaredStatus,
      }));
      if (scoped.truncated) truncated = true;
      steps.push('temporal-scope');
    } catch (error) {
      const message = error instanceof TemporalScopeError ? error.message : 'Temporal scope failed. No clock was invented.';
      temporal = { ...emptyTemporal(), requested: true, error: message };
      problems.push(message);
      steps.push('temporal-scope-withheld');
    }
  }

  const withhold = !input
    || typeof input !== 'object'
    || !Array.isArray(input.sources)
    || isolated.fatal
    || temporal.error !== null
    || stack.status !== 'resolved';
  if (!input || typeof input !== 'object') problems.push('A place search input is required.');
  else if (!Array.isArray(input.sources)) problems.push('sources must be an array. No catalog was invented.');
  if (stack.uncertainty.length > 0) uncertainty.push(...stack.uncertainty);
  if (stack.truncated) {
    truncated = true;
    uncertainty.push('The authority stack stopped at a bounded limit and is incomplete.');
  }
  for (const place of isolated.strict.placeIds) {
    if (!order.has(place)) {
      problems.push(`${place} is outside the selected authority stack and was not added.`);
    }
  }

  const sources: ClassifiedSource[] = [];
  const ready: ReadySource[] = [];
  const seenIds = new Set<string>();
  if (!withhold && input && Array.isArray(input.sources)) {
    const stackIds = new Set(stackCandidateIds);
    const listed = input.sources.length > PLAN_LIMITS.maxSources
      ? input.sources.slice(0, PLAN_LIMITS.maxSources)
      : input.sources;
    if (input.sources.length > PLAN_LIMITS.maxSources) {
      truncated = true;
      uncertainty.push(`Source descriptors past ${PLAN_LIMITS.maxSources} were not classified.`);
    }
    listed.forEach((raw, index) => {
      const source = normalizeSource(raw, index);
      if (seenIds.has(source.sourceId)) {
        sources.push(classifyRow(source, 'rejected', 'duplicate-source', []));
        return;
      }
      seenIds.add(source.sourceId);
      if (source.rejected || source.decision === null) {
        sources.push(classifyRow(source, 'rejected', source.rejected ?? 'invalid-source', []));
        return;
      }
      const matched = inStackOrder(source.authorityIds.filter((id) => stackIds.has(id)), order);
      if (matched.length === 0) {
        sources.push(classifyRow(source, 'out-of-stack', 'out-of-stack', []));
        return;
      }
      const matchedBands = unique(matched.map((id) => candidateBands.find((row) => row.id === id)?.band ?? '').filter((band) => band));
      const bandsForFilter = source.declaredBands.length > 0 ? source.declaredBands : matchedBands;
      if (isolated.strict.sourceIds.length > 0 && !isolated.strict.sourceIds.includes(source.sourceId)) {
        sources.push(classifyRow(source, 'filtered', 'strict-source', matched));
        return;
      }
      if (isolated.strict.bands.length > 0 && disjoint(bandsForFilter, isolated.strict.bands)) {
        sources.push(classifyRow(source, 'filtered', 'strict-band', matched));
        return;
      }
      if (isolated.strict.placeIds.length > 0 && disjoint(matched, isolated.strict.placeIds)) {
        sources.push(classifyRow(source, 'filtered', 'strict-place', matched));
        return;
      }
      if (disjoint(source.languages, isolated.strict.languages)) {
        sources.push(classifyRow(source, 'filtered', 'strict-language', matched));
        return;
      }
      if (disjoint(source.instrumentKinds, isolated.strict.instrumentKinds)) {
        sources.push(classifyRow(source, 'filtered', 'strict-instrument', matched));
        return;
      }
      if (disjoint(source.topics, isolated.strict.topics)) {
        sources.push(classifyRow(source, 'filtered', 'strict-topic', matched));
        return;
      }
      if (!source.pinned || !source.sourceRevision) {
        sources.push(classifyRow(source, 'unpinned', 'unpinned-revision', matched));
        return;
      }
      if (source.decision === 'blocked') {
        sources.push(classifyRow(source, 'blocked', 'blocked', matched));
        return;
      }
      if (source.decision === 'exclude') {
        sources.push(classifyRow(source, 'excluded', 'excluded', matched));
        return;
      }
      if (source.coverageState === 'missing') {
        sources.push(classifyRow(source, 'missing', 'missing-coverage', matched));
        return;
      }
      if (source.coverageState === 'unknown' || source.coverageState === null) {
        sources.push(classifyRow(source, 'unknown', source.coverageState ? 'unknown-coverage' : 'invalid-coverage', matched));
        return;
      }
      if (source.coverageState === 'unavailable') {
        sources.push(classifyRow(source, 'unavailable', 'unavailable-coverage', matched));
        return;
      }
      const kinds = retrievalKinds(source);
      if (kinds.length === 0) {
        sources.push(classifyRow(source, 'unindexed', 'no-index', matched));
        return;
      }
      const readySource: ReadySource = {
        ...source,
        sourceRevision: source.sourceRevision,
        coverageState: source.coverageState,
        matchedCandidateIds: matched,
        requests: [],
      };
      readySource.requests = requestsFor(readySource);
      ready.push(readySource);
      sources.push(classifyRow(
        source,
        'searched',
        source.coverageState === 'partial' ? 'partial-coverage' : 'known-coverage',
        matched,
      ));
    });
    steps.push('source-selection', 'shard-batches');
  } else {
    steps.push('source-selection-withheld');
  }

  ready.sort((left, right) => compareText(left.sourceId, right.sourceId));
  sources.sort((left, right) => compareText(left.sourceId, right.sourceId) || compareText(left.disposition, right.disposition));
  const requests = ready.flatMap((source) => source.requests);
  const batches: ShardBatch[] = [];
  for (let index = 0; index < requests.length; index += SEARCH_CONCURRENCY) {
    batches.push({
      batchIndex: batches.length,
      concurrency: SEARCH_CONCURRENCY,
      requests: requests.slice(index, index + SEARCH_CONCURRENCY),
    });
  }

  const counts = emptyCounts();
  counts.stackCandidates = stackCandidateIds.length;
  const covered = new Set<string>();
  let knownComplete = true;
  let knownRecords = 0;
  for (const source of ready) {
    counts.searchedSources += 1;
    if (source.coverageState === 'partial') counts.partialSources += 1;
    for (const id of source.matchedCandidateIds) covered.add(id);
    if (!source.indexedRecordsKnown || source.indexedRecords === null) knownComplete = false;
    else if (knownRecords > Number.MAX_SAFE_INTEGER - source.indexedRecords) knownComplete = false;
    else knownRecords += source.indexedRecords;
  }
  counts.knownRecords = knownRecords;
  counts.knownRecordsComplete = ready.length === 0 ? true : knownComplete;
  for (const row of sources) {
    if (row.disposition === 'missing') counts.missingSources += 1;
    else if (row.disposition === 'unknown') counts.unknownSources += 1;
    else if (row.disposition === 'unavailable') counts.unavailableSources += 1;
    else if (row.disposition === 'blocked') counts.blockedSources += 1;
    else if (row.disposition === 'excluded') counts.excludedSources += 1;
    else if (row.disposition === 'unpinned') counts.unpinnedSources += 1;
    else if (row.disposition === 'unindexed') counts.unindexedSources += 1;
    else if (row.disposition === 'filtered') counts.filteredSources += 1;
    else if (row.disposition === 'out-of-stack') counts.outOfStackSources += 1;
    else if (row.disposition === 'rejected') counts.rejectedSources += 1;
  }
  const withoutSource = stackCandidateIds.filter((id) => !sources.some((row) => row.authorityIds.includes(id) && row.disposition !== 'rejected'));
  const notSearched = stackCandidateIds.filter((id) => !covered.has(id));
  counts.stackCandidatesWithoutSource = withoutSource.length;
  counts.stackCandidatesNotSearched = notSearched.length;
  counts.searchedCollections = counts.searchedSources;
  counts.missingCollections = counts.missingSources;

  const searchedSourceIds = ready.map((source) => source.sourceId);
  const missingSourceIds = sources.filter((row) => row.disposition === 'missing').map((row) => row.sourceId).sort(compareText);
  const filteredSourceIds = sources.filter((row) => row.disposition === 'filtered').map((row) => row.sourceId).sort(compareText);
  const status: PlanStatus = stack.status === 'resolved' && !isolated.fatal && !temporal.error && input && Array.isArray(input.sources)
    ? 'stack-selected'
    : stack.status === 'unresolved'
      ? 'unresolved'
      : 'invalid-query';
  const phase = status === 'stack-selected' ? 'stack-selected' : 'withheld';

  return {
    schema: SEARCH_PLAN_SCHEMA,
    status,
    phase,
    applicability: APPLICABILITY,
    heading: STACK_HEADING,
    ranking: 'deferred',
    stackResolvedBeforeRanking: true,
    steps,
    placeId: stack.placeId,
    asOf: stack.asOf,
    graphId: stack.graphId,
    stack,
    stackCandidateIds,
    byBand,
    candidateBands,
    omitted: stack.omitted.map((item) => ({ id: item.id, reason: item.reason })),
    inclusionByCandidateId: inclusionMap(stack),
    strictFilters: isolated.strict,
    rankingSignals: isolated.ranking,
    problems: sortedUnique(problems),
    temporal,
    temporalLaws,
    sources,
    searchedSourceIds,
    missingSourceIds,
    filteredSourceIds,
    batches: phase === 'stack-selected' ? batches : [],
    counts: phase === 'stack-selected'
      ? counts
      : { ...emptyCounts(), stackCandidates: stackCandidateIds.length },
    selectionKey: buildKey({
      placeId: stack.placeId,
      asOf: stack.asOf,
      viewIds: [...viewIds].sort(compareText),
      stackCandidateIds,
      searchedSourceIds: phase === 'stack-selected' ? searchedSourceIds : [],
      missingSourceIds: phase === 'stack-selected' ? missingSourceIds : [],
      filteredSourceIds: phase === 'stack-selected' ? filteredSourceIds : [],
      batches: phase === 'stack-selected' ? batches : [],
      strict: isolated.strict,
    }),
    limitations: PLAN_LIMITATIONS,
    uncertainty: sortedUnique(uncertainty),
    truncated,
  };
}

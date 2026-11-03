#!/usr/bin/env node
/**
 * Offline hierarchical global term and citation routing.
 *
 * Country and collection indexes stay behind shard summaries. The Pages
 * document is the routing root: coverage counts, budgets, and pointers to the
 * term and citation trees. A directory that would exceed its byte budget is
 * split by key range. A common term's postings are split into segments so one
 * page can open a bounded number of summaries instead of every country.
 *
 * This script does not copy posting payloads, document bodies, or embeddings.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { canonicalJson, sha256HexUtf8, utf8Bytes } from '../../src/lib/worldwide/data/identity';
import { normalizeCiteKey } from '../../src/lib/worldwide/search/citation';
import {
  COVERAGE_STATES,
  DIRECTORY_SCHEMA,
  GLOBAL_ROUTING_CEILING,
  GLOBAL_ROUTING_DEFAULTS,
  GLOBAL_ROUTING_SCHEMA,
  SEARCHABLE_COVERAGE,
  SHARD_SCHEMA,
  WorldwideSearchError,
  assertIdentifier,
  isDirectoryPayload,
  pagesEnvelopeJson,
  sealEnvelope,
  type ChildPointer,
  type CollectionCoverage,
  type CoverageRollup,
  type CoverageState,
  type DirectoryPayload,
  type GlobalRoutingIndex,
  type GlobalRoutingLimits,
  type GlobalRoutingPages,
  type GlobalRoutingStats,
  type RouteEntry,
  type SearchableCoverage,
  type ShardPointer,
  type ShardSummaryPayload,
  type StoredDocument,
  type SummaryHit,
} from '../../src/lib/worldwide/search/global';
import { tokenize } from '../../src/lib/worldwide/search/tokenize';

const GIT_REVISION = /^[0-9a-f]{40}$/;
const AS_OF = /^[0-9]{4}-[0-9]{2}-[0-9]{2}(?:T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?Z)?$/;
const LANGUAGE = /^[a-z]{2,16}$/;

const COLLECTION_KEYS = ['collectionId', 'jurisdictionId', 'sourceRevision', 'coverage', 'indexedRecords', 'languages', 'terms', 'citations'] as const;
const TERM_KEYS = ['term', 'documentFrequency', 'hits'] as const;
const HIT_KEYS = ['documentId', 'score', 'title', 'language', 'citation'] as const;
const CITATION_KEYS = ['citation', 'documentId', 'score', 'title', 'language'] as const;
const LIMIT_KEYS = [
  'maxRequestsPerPage',
  'maxShardRequestsPerPage',
  'maxBytesPerPage',
  'maxDirectoryBytes',
  'maxShardSummaryBytes',
  'maxSummariesPerShard',
  'pageSizeDefault',
  'pageSizeMax',
  'commonDocumentFrequency',
  'maxQueryTerms',
  'maxCollections',
] as const;

export interface GlobalHitInput {
  documentId: string;
  score: number;
  title?: string;
  language?: string;
  citation?: string;
}

export interface GlobalTermInput {
  term: string;
  documentFrequency?: number;
  hits?: GlobalHitInput[];
}

export interface GlobalCitationInput {
  citation: string;
  documentId: string;
  score?: number;
  title?: string;
  language?: string;
}

export interface GlobalCollectionInput {
  collectionId: string;
  jurisdictionId: string;
  sourceRevision?: string;
  coverage: CoverageState;
  indexedRecords: number | null;
  languages?: string[];
  terms?: GlobalTermInput[];
  citations?: GlobalCitationInput[];
}

export interface GlobalRoutingBuildInput {
  catalogRevision: string;
  asOf: string;
  collections: GlobalCollectionInput[];
  limits?: Partial<Pick<GlobalRoutingLimits, (typeof LIMIT_KEYS)[number]>>;
}

interface NormalizedHit {
  documentId: string;
  score: number;
  title: string;
  language: string;
  citation: string;
}

interface NormalizedCollection {
  collectionId: string;
  jurisdictionId: string;
  sourceRevision: string;
  coverage: CoverageState;
  indexedRecords: number | null;
  languages: string[];
  terms: Array<{ key: string; documentFrequency: number; hits: NormalizedHit[] }>;
  citations: Array<{ key: string; hits: NormalizedHit[] }>;
}

interface Fragment {
  firstKey: string;
  lastKey: string;
  pointer: ChildPointer;
}

function fail(code: string, message: string): never {
  throw new WorldwideSearchError(code, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[], field: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail('invalid-input', `${field}.${key} is not allowed`);
  }
}

function text(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string') fail('invalid-input', `${field} must be a string`);
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) fail('invalid-input', `${field} is empty or too long`);
  return trimmed;
}

function optionalText(value: unknown, field: string, max: number): string {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string' || value.length > max) fail('invalid-input', `${field} is too long`);
  return value;
}

function integer(value: unknown, field: string, minimum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    fail('invalid-input', `${field} must be an integer of at least ${minimum}`);
  }
  return value;
}

function resolveLimits(input: GlobalRoutingBuildInput['limits']): GlobalRoutingLimits {
  const limits: GlobalRoutingLimits = { ...GLOBAL_ROUTING_DEFAULTS };
  const source = input ?? {};
  if (!isRecord(source)) fail('invalid-budget', 'limits must be an object');
  onlyKeys(source, LIMIT_KEYS, 'limits');
  for (const key of LIMIT_KEYS) {
    if (source[key] === undefined) continue;
    const ceiling = key in GLOBAL_ROUTING_CEILING
      ? GLOBAL_ROUTING_CEILING[key as keyof typeof GLOBAL_ROUTING_CEILING]
      : key === 'commonDocumentFrequency' ? 1_000_000 : key === 'maxQueryTerms' ? 64 : limits[key];
    const value = integer(source[key], `limits.${key}`, 1);
    if (value > ceiling) fail('invalid-budget', `limits.${key} exceeds ${ceiling}`);
    limits[key] = value;
  }
  if (limits.maxDirectoryBytes > limits.maxBytesPerPage || limits.maxShardSummaryBytes > limits.maxBytesPerPage) {
    fail('invalid-budget', 'directory and shard summary budgets must fit in the page byte budget');
  }
  if (limits.maxShardRequestsPerPage > limits.maxRequestsPerPage) {
    fail('invalid-budget', 'shard requests per page cannot exceed requests per page');
  }
  if (limits.pageSizeDefault > limits.pageSizeMax) fail('invalid-budget', 'the default page size exceeds the page size maximum');
  if (limits.maxQueryTerms > 64) fail('invalid-budget', 'maxQueryTerms cannot exceed 64');
  return limits;
}

function languageOf(value: unknown, field: string): string {
  const raw = optionalText(value, field, 32).toLowerCase();
  if (raw && !LANGUAGE.test(raw)) fail('invalid-input', `${field} is not a language code`);
  return raw;
}

function normalizeHit(value: unknown, field: string, titleMax: number, citationRequired: boolean): NormalizedHit {
  const record = isRecord(value) ? value : fail('invalid-input', `${field} must be an object`);
  onlyKeys(record, citationRequired ? CITATION_KEYS : HIT_KEYS, field);
  const documentId = assertIdentifier(text(record.documentId, `${field}.documentId`, 200), `${field}.documentId`);
  const score = record.score === undefined && citationRequired ? 0 : integer(record.score, `${field}.score`, Number.MIN_SAFE_INTEGER);
  let title = optionalText(record.title, `${field}.title`, 4000);
  if ([...title].length > titleMax) title = [...title].slice(0, titleMax).join('');
  const citation = citationRequired
    ? text(record.citation, `${field}.citation`, 500)
    : optionalText(record.citation, `${field}.citation`, 500);
  return { documentId, score, title, language: languageOf(record.language, `${field}.language`), citation };
}

function normalizeCollection(value: unknown, index: number, titleMax: number): NormalizedCollection {
  const field = `collections[${index}]`;
  const record = isRecord(value) ? value : fail('invalid-input', `${field} must be an object`);
  onlyKeys(record, COLLECTION_KEYS, field);
  const collectionId = assertIdentifier(text(record.collectionId, `${field}.collectionId`, 200), `${field}.collectionId`);
  const jurisdictionId = assertIdentifier(text(record.jurisdictionId, `${field}.jurisdictionId`, 200), `${field}.jurisdictionId`);
  const sourceRevision = record.sourceRevision === undefined || record.sourceRevision === ''
    ? ''
    : (typeof record.sourceRevision === 'string' && GIT_REVISION.test(record.sourceRevision)
      ? record.sourceRevision
      : fail('invalid-revision', `${field}.sourceRevision must be a 40-character hex commit or empty`));
  if (typeof record.coverage !== 'string' || !COVERAGE_STATES.includes(record.coverage as CoverageState)) {
    fail('invalid-input', `${field}.coverage is not a coverage state`);
  }
  const coverage = record.coverage as CoverageState;
  const indexedRecords = record.indexedRecords === null ? null : integer(record.indexedRecords, `${field}.indexedRecords`, 0);
  const languages = Array.isArray(record.languages) ? record.languages.map((item, itemIndex) => languageOf(item, `${field}.languages[${itemIndex}]`)).filter((item) => item !== '') : [];
  if (record.languages !== undefined && !Array.isArray(record.languages)) fail('invalid-input', `${field}.languages must be an array`);
  const searchable = SEARCHABLE_COVERAGE.includes(coverage as SearchableCoverage);
  const termsIn = record.terms ?? [];
  const citationsIn = record.citations ?? [];
  if (!Array.isArray(termsIn) || !Array.isArray(citationsIn)) fail('invalid-input', `${field} terms and citations must be arrays`);
  if (!searchable && (termsIn.length > 0 || citationsIn.length > 0)) {
    fail('unsearchable-collection', `${collectionId} is ${coverage} and cannot contribute shards`);
  }
  const terms = new Map<string, { key: string; hits: NormalizedHit[]; documentFrequency: number | null }>();
  termsIn.forEach((item, itemIndex) => {
    const termField = `${field}.terms[${itemIndex}]`;
    const termRecord = isRecord(item) ? item : fail('invalid-input', `${termField} must be an object`);
    onlyKeys(termRecord, TERM_KEYS, termField);
    const tokens = tokenize(typeof termRecord.term === 'string' ? termRecord.term : fail('invalid-input', `${termField}.term must be a string`));
    if (tokens.length !== 1) fail('term-not-atomic', `${termField}.term must tokenize to one token`);
    const key = tokens[0] ?? '';
    const hitsIn = termRecord.hits ?? [];
    if (!Array.isArray(hitsIn)) fail('invalid-input', `${termField}.hits must be an array`);
    const hits = hitsIn.map((hit, hitIndex) => normalizeHit(hit, `${termField}.hits[${hitIndex}]`, titleMax, false));
    const seen = new Set<string>();
    for (const hit of hits) {
      if (seen.has(hit.documentId)) fail('duplicate-document', `${termField} repeats ${hit.documentId}`);
      seen.add(hit.documentId);
    }
    const declared = termRecord.documentFrequency === undefined ? null : integer(termRecord.documentFrequency, `${termField}.documentFrequency`, hits.length);
    if (terms.has(key)) fail('duplicate-term', `${termField} repeats ${key}`);
    terms.set(key, { key, hits, documentFrequency: declared });
  });
  const citations = new Map<string, NormalizedHit[]>();
  citationsIn.forEach((item, itemIndex) => {
    const citationField = `${field}.citations[${itemIndex}]`;
    const hit = normalizeHit(item, citationField, titleMax, true);
    const key = normalizeCiteKey(hit.citation);
    if (!key) fail('query-empty', `${citationField}.citation has no lookup key`);
    const list = citations.get(key) ?? [];
    if (list.some((item) => item.documentId === hit.documentId)) fail('duplicate-document', `${citationField} repeats ${hit.documentId}`);
    list.push(hit);
    citations.set(key, list);
  });
  return {
    collectionId,
    jurisdictionId,
    sourceRevision,
    coverage,
    indexedRecords,
    languages: [...new Set(languages)].sort(),
    terms: [...terms.values()].map((term) => ({
      key: term.key,
      hits: term.hits,
      documentFrequency: term.documentFrequency ?? term.hits.length,
    })).filter((term) => term.documentFrequency > 0),
    citations: [...citations.entries()].map(([key, hits]) => ({ key, hits })).filter((item) => item.hits.length > 0),
  };
}

function compareHits(left: NormalizedHit, right: NormalizedHit): number {
  if (left.score !== right.score) return right.score - left.score;
  return left.documentId < right.documentId ? -1 : left.documentId > right.documentId ? 1 : 0;
}

function rollup(rows: CollectionCoverage[]): CoverageRollup {
  const counts = { known: 0, partial: 0, missing: 0, unknown: 0, unavailable: 0 };
  let sum = 0;
  let complete = rows.length > 0;
  for (const row of rows) {
    counts[row.state] += 1;
    if (row.state !== 'known' || row.indexedRecords === null) complete = false;
    else sum += row.indexedRecords;
  }
  if (rows.length === 0) complete = false;
  return {
    collections: rows.length,
    known: counts.known,
    partial: counts.partial,
    missing: counts.missing,
    unknown: counts.unknown,
    unavailable: counts.unavailable,
    indexedRecords: complete ? sum : null,
    indexedRecordsComplete: complete,
    rows,
  };
}

export function buildGlobalRouting(input: GlobalRoutingBuildInput): GlobalRoutingIndex {
  if (!isRecord(input)) fail('invalid-input', 'the routing input must be an object');
  onlyKeys(input as unknown as Record<string, unknown>, ['catalogRevision', 'asOf', 'collections', 'limits'], 'input');
  if (typeof input.catalogRevision !== 'string' || !GIT_REVISION.test(input.catalogRevision)) {
    fail('invalid-revision', 'catalogRevision must be a 40-character hex commit');
  }
  if (typeof input.asOf !== 'string' || !AS_OF.test(input.asOf)) fail('invalid-as-of', 'asOf must be a calendar date or a UTC timestamp');
  if (!Array.isArray(input.collections) || input.collections.length === 0) fail('empty-input', 'at least one collection is required');
  const limits = resolveLimits(input.limits);
  if (input.collections.length > limits.maxCollections) fail('invalid-input', `collections exceed ${limits.maxCollections}`);
  const collections = input.collections.map((item, index) => normalizeCollection(item, index, limits.maxTitleChars));
  const seen = new Set<string>();
  for (const collection of collections) {
    if (seen.has(collection.collectionId)) fail('duplicate-collection', `${collection.collectionId} is repeated`);
    seen.add(collection.collectionId);
  }
  collections.sort((left, right) => (left.collectionId < right.collectionId ? -1 : 1));

  const documents: Record<string, StoredDocument> = {};
  const counters = { tl: 0, ti: 0, cl: 0, ci: 0, ss: 0, cv: 0 };
  const nextId = (prefix: keyof typeof counters) => {
    counters[prefix] += 1;
    return `${prefix}${String(counters[prefix]).padStart(6, '0')}`;
  };

  const groups = new Map<string, { kind: 'term' | 'citation'; key: string; shards: ShardPointer[]; documentFrequency: number }>();
  const addShard = (
    collection: NormalizedCollection,
    kind: 'term' | 'citation',
    key: string,
    hits: NormalizedHit[],
    documentFrequency: number,
  ) => {
    if (hits.length > 5000) fail('invalid-input', `${collection.collectionId} ${key} has too many summary hits`);
    const sorted = [...hits].sort(compareHits);
    let stored = sorted.slice(0, limits.maxSummariesPerShard);
    let truncated = documentFrequency > stored.length || sorted.length > stored.length;
    const shardId = nextId('ss');
    const relativePath = `routing/s/${shardId}.json`;
    let sealed: StoredDocument<ShardSummaryPayload> | null = null;
    while (stored.length >= 0) {
      const payload: ShardSummaryPayload = {
        schema: SHARD_SCHEMA,
        kind,
        key,
        shardId,
        relativePath,
        collectionId: collection.collectionId,
        jurisdictionId: collection.jurisdictionId,
        sourceRevision: collection.sourceRevision,
        coverage: collection.coverage as SearchableCoverage,
        perCountryFanout: false,
        fullPostingsLoaded: false,
        documentFrequency,
        summariesTruncated: truncated,
        hits: stored.map((hit): SummaryHit => ({
          documentId: hit.documentId,
          score: hit.score,
          title: hit.title,
          language: hit.language,
          citation: hit.citation,
        })),
      };
      const candidate = sealEnvelope(relativePath, input.catalogRevision, payload);
      if (candidate.loadedBytes <= limits.maxShardSummaryBytes) {
        sealed = candidate;
        break;
      }
      if (stored.length === 0) break;
      stored = stored.slice(0, -1);
      truncated = true;
    }
    if (!sealed) fail('summary-exceeds-budget', `${relativePath} does not fit in the shard summary budget`);
    documents[relativePath] = sealed;
    const languages = [...new Set(stored.map((hit) => hit.language).filter((item) => item !== ''))].sort();
    const groupKey = `${kind}\u0000${key}`;
    const group = groups.get(groupKey) ?? { kind, key, shards: [], documentFrequency: 0 };
    group.documentFrequency += documentFrequency;
    group.shards.push({
      shardId,
      relativePath,
      collectionId: collection.collectionId,
      jurisdictionId: collection.jurisdictionId,
      sourceRevision: collection.sourceRevision,
      coverage: collection.coverage as SearchableCoverage,
      languages,
      documentFrequency,
      summariesTruncated: sealed.envelope.payload.summariesTruncated,
      loadedBytes: sealed.loadedBytes,
      payloadSha256: sealed.envelope.payloadSha256,
      term: key,
      termDocumentFrequency: 0,
      common: false,
    });
    groups.set(groupKey, group);
  };

  for (const collection of collections) {
    if (!SEARCHABLE_COVERAGE.includes(collection.coverage as SearchableCoverage)) continue;
    for (const term of collection.terms) addShard(collection, 'term', term.key, term.hits, term.documentFrequency);
    for (const citation of collection.citations) addShard(collection, 'citation', citation.key, citation.hits, citation.hits.length);
  }

  const sealLeaf = (kind: 'term' | 'citation', entry: RouteEntry): Fragment => {
    const directoryId = nextId(kind === 'term' ? 'tl' : 'cl');
    const relativePath = `routing/d/${directoryId}.json`;
    const payload: DirectoryPayload = {
      schema: DIRECTORY_SCHEMA,
      directoryId,
      kind,
      role: 'leaf',
      firstKey: entry.key,
      lastKey: entry.key,
      perCountryFanout: false,
      routing: 'hierarchical-term-citation',
      children: [],
      entries: [entry],
      coverage: null,
      coverageInline: false,
      limits: null,
      asOf: null,
    };
    const stored = sealEnvelope(relativePath, input.catalogRevision, payload);
    if (stored.loadedBytes > limits.maxDirectoryBytes) fail('directory-exceeds-budget', `${relativePath} is ${stored.loadedBytes} bytes`);
    documents[relativePath] = stored;
    return {
      firstKey: entry.key,
      lastKey: entry.key,
      pointer: {
        directoryId,
        relativePath,
        kind,
        firstKey: entry.key,
        lastKey: entry.key,
        payloadSha256: stored.envelope.payloadSha256,
        loadedBytes: stored.loadedBytes,
      },
    };
  };

  const leafBytes = (kind: 'term' | 'citation', entry: RouteEntry): number => {
    const directoryId = `${kind === 'term' ? 'tl' : 'cl'}000000`;
    const payload: DirectoryPayload = {
      schema: DIRECTORY_SCHEMA,
      directoryId,
      kind,
      role: 'leaf',
      firstKey: entry.key,
      lastKey: entry.key,
      perCountryFanout: false,
      routing: 'hierarchical-term-citation',
      children: [],
      entries: [entry],
      coverage: null,
      coverageInline: false,
      limits: null,
      asOf: null,
    };
    return sealEnvelope(`routing/d/${directoryId}.json`, input.catalogRevision, payload).loadedBytes;
  };

  const splitEntry = (kind: 'term' | 'citation', entry: RouteEntry): RouteEntry[] => {
    if (leafBytes(kind, entry) <= limits.maxDirectoryBytes) return [entry];
    const marked = mark(entry, true);
    if (leafBytes(kind, marked) <= limits.maxDirectoryBytes) return [marked];
    const chunks: RouteEntry[] = [];
    let start = 0;
    while (start < marked.shards.length) {
      let best = 0;
      let lo = 1;
      let hi = marked.shards.length - start;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const trial = { ...marked, shards: marked.shards.slice(start, start + mid) };
        if (leafBytes(kind, trial) <= limits.maxDirectoryBytes) {
          best = mid;
          lo = mid + 1;
        } else hi = mid - 1;
      }
      if (best < 1) fail('shard-pointer-exceeds-directory', `${entry.key} shard pointer does not fit in a directory`);
      chunks.push({ ...marked, shards: marked.shards.slice(start, start + best) });
      start += best;
    }
    return chunks;
  };

  const leavesFor = (kind: 'term' | 'citation'): Fragment[] => {
    const entries = [...groups.values()].filter((group) => group.kind === kind).sort((left, right) => (left.key < right.key ? -1 : 1));
    const leaves: Fragment[] = [];
    for (const group of entries) {
      group.shards.sort((left, right) => (left.collectionId < right.collectionId ? -1 : left.collectionId > right.collectionId ? 1 : left.shardId < right.shardId ? -1 : 1));
      const base: RouteEntry = {
        key: group.key,
        documentFrequency: group.documentFrequency,
        common: false,
        shards: group.shards.map((shard) => ({ ...shard, term: group.key, termDocumentFrequency: group.documentFrequency, common: false })),
      };
      const common = base.shards.length > limits.maxShardRequestsPerPage || base.documentFrequency >= limits.commonDocumentFrequency;
      const marked = mark(base, common);
      for (const segment of splitEntry(kind, marked)) leaves.push(sealLeaf(kind, segment));
    }
    return leaves;
  };

  const termRoot = packForest(leavesFor('term'), 'term');
  const citationRoot = packForest(leavesFor('citation'), 'citation');
  const coverageRows: CollectionCoverage[] = collections.map((collection) => ({
    collectionId: collection.collectionId,
    jurisdictionId: collection.jurisdictionId,
    sourceRevision: collection.sourceRevision,
    state: collection.coverage,
    indexedRecords: collection.indexedRecords,
    languages: collection.languages,
  }));
  const rootStored = sealRoot(termRoot, citationRoot, coverageRows);
  documents[rootStored.envelope.relativePath] = rootStored;

  const index = assemble(rootStored);
  assertRouting(index);
  return index;

  function mark(entry: RouteEntry, common: boolean): RouteEntry {
    return {
      ...entry,
      common,
      shards: entry.shards.map((shard) => ({ ...shard, common })),
    };
  }

  function internalBytes(kind: 'term' | 'citation', bucket: Fragment[]): number {
    const directoryId = `${kind === 'term' ? 'ti' : 'ci'}000000`;
    const payload: DirectoryPayload = {
      schema: DIRECTORY_SCHEMA,
      directoryId,
      kind,
      role: 'internal',
      firstKey: bucket[0]?.firstKey ?? '',
      lastKey: bucket[bucket.length - 1]?.lastKey ?? '',
      perCountryFanout: false,
      routing: 'hierarchical-term-citation',
      children: bucket.map((item) => item.pointer),
      entries: [],
      coverage: null,
      coverageInline: false,
      limits: null,
      asOf: null,
    };
    return sealEnvelope(`routing/d/${directoryId}.json`, input.catalogRevision, payload).loadedBytes;
  }

  function sealInternal(kind: 'term' | 'citation', bucket: Fragment[]): Fragment {
    const directoryId = nextId(kind === 'term' ? 'ti' : 'ci');
    const relativePath = `routing/d/${directoryId}.json`;
    const firstKey = bucket[0]?.firstKey ?? '';
    const lastKey = bucket[bucket.length - 1]?.lastKey ?? '';
    const payload: DirectoryPayload = {
      schema: DIRECTORY_SCHEMA,
      directoryId,
      kind,
      role: 'internal',
      firstKey,
      lastKey,
      perCountryFanout: false,
      routing: 'hierarchical-term-citation',
      children: bucket.map((item) => item.pointer),
      entries: [],
      coverage: null,
      coverageInline: false,
      limits: null,
      asOf: null,
    };
    const stored = sealEnvelope(relativePath, input.catalogRevision, payload);
    if (stored.loadedBytes > limits.maxDirectoryBytes) fail('directory-exceeds-budget', `${relativePath} is ${stored.loadedBytes} bytes`);
    documents[relativePath] = stored;
    return {
      firstKey,
      lastKey,
      pointer: {
        directoryId,
        relativePath,
        kind,
        firstKey,
        lastKey,
        payloadSha256: stored.envelope.payloadSha256,
        loadedBytes: stored.loadedBytes,
      },
    };
  }

  function packForest(leaves: Fragment[], kind: 'term' | 'citation'): Fragment | null {
    if (leaves.length === 0) return null;
    let level = [...leaves].sort(compareFragments);
    while (level.length > 1) {
      const next: Fragment[] = [];
      let bucket: Fragment[] = [];
      const flush = () => {
        if (bucket.length === 0) return;
        next.push(sealInternal(kind, bucket));
        bucket = [];
      };
      for (const item of level) {
        if (bucket.length > 0 && internalBytes(kind, bucket.concat([item])) > limits.maxDirectoryBytes) flush();
        bucket.push(item);
        if (internalBytes(kind, bucket) > limits.maxDirectoryBytes) {
          fail('directory-exceeds-budget', 'one routing child does not fit in the directory budget');
        }
      }
      flush();
      if (next.length >= level.length) fail('directory-exceeds-budget', 'directory packing made no progress');
      level = next;
    }
    return level[0] ?? null;
  }

  function sealCoverage(rows: CollectionCoverage[]): ChildPointer {
    const full = rollup(rows);
    const directoryId = nextId('cv');
    const relativePath = `routing/d/${directoryId}.json`;
    const payload: DirectoryPayload = {
      schema: DIRECTORY_SCHEMA,
      directoryId,
      kind: 'coverage',
      role: 'leaf',
      firstKey: '',
      lastKey: '',
      perCountryFanout: false,
      routing: 'hierarchical-term-citation',
      children: [],
      entries: [],
      coverage: full,
      coverageInline: true,
      limits: null,
      asOf: null,
    };
    const stored = sealEnvelope(relativePath, input.catalogRevision, payload);
    if (stored.loadedBytes > limits.maxDirectoryBytes) fail('coverage-exceeds-budget', `coverage is ${stored.loadedBytes} bytes`);
    documents[relativePath] = stored;
    return {
      directoryId,
      relativePath,
      kind: 'coverage',
      firstKey: '',
      lastKey: '',
      payloadSha256: stored.envelope.payloadSha256,
      loadedBytes: stored.loadedBytes,
    };
  }

  function sealRoot(term: Fragment | null, citation: Fragment | null, rows: CollectionCoverage[]): StoredDocument<DirectoryPayload> {
    const children = [term?.pointer, citation?.pointer].filter((item): item is ChildPointer => Boolean(item));
    const inline = rollup(rows);
    const attempt = (coverage: CoverageRollup, inlineRows: boolean, extra: ChildPointer[]) => {
      const payload: DirectoryPayload = {
        schema: DIRECTORY_SCHEMA,
        directoryId: 'root',
        kind: 'root',
        role: 'root',
        firstKey: '',
        lastKey: '',
        perCountryFanout: false,
        routing: 'hierarchical-term-citation',
        children: [...extra, ...children],
        entries: [],
        coverage,
        coverageInline: inlineRows,
        limits,
        asOf: input.asOf,
      };
      return sealEnvelope('routing/root.json', input.catalogRevision, payload);
    };
    let stored = attempt(inline, true, []);
    if (stored.loadedBytes > limits.maxDirectoryBytes || stored.loadedBytes > limits.maxBytesPerPage) {
      const pointer = sealCoverage(rows);
      const spilled = rollup(rows);
      spilled.rows = [];
      stored = attempt(spilled, false, [pointer]);
    }
    if (stored.loadedBytes > limits.maxDirectoryBytes || stored.loadedBytes > limits.maxBytesPerPage) {
      fail('root-exceeds-budget', `the routing root is ${stored.loadedBytes} bytes`);
    }
    return stored;
  }

  function assemble(rootStored: StoredDocument<DirectoryPayload>): GlobalRoutingIndex {
    const rootJson = canonicalJson(rootStored.envelope);
    const pages: GlobalRoutingPages = {
      logicalPath: 'routing/root.json',
      bundledRoles: ['global-routing-root'],
      fullCorpusBundled: false,
      shardSummariesBundled: false,
      perCountryFanout: false,
      bundledBytes: utf8Bytes(rootJson).length,
      bundledSha256: sha256HexUtf8(rootJson),
    };
    let directories = 0;
    let termLeaves = 0;
    let citationLeaves = 0;
    let shardSummaries = 0;
    let maxShardsPerTermLeaf = 0;
    let maxDirectoryLoadedBytes = 0;
    let maxShardLoadedBytes = 0;
    let remoteBytes = 0;
    const terms = new Set<string>();
    const citations = new Set<string>();
    for (const stored of Object.values(documents)) {
      if (stored.envelope.relativePath !== rootStored.envelope.relativePath) remoteBytes += stored.loadedBytes;
      const payload = stored.envelope.payload;
      if (isDirectoryPayload(payload)) {
        directories += 1;
        maxDirectoryLoadedBytes = Math.max(maxDirectoryLoadedBytes, stored.loadedBytes);
        if (payload.role === 'leaf' && payload.kind === 'term') {
          termLeaves += 1;
          maxShardsPerTermLeaf = Math.max(maxShardsPerTermLeaf, payload.entries.reduce((sum, entry) => sum + entry.shards.length, 0));
        }
        if (payload.role === 'leaf' && payload.kind === 'citation') citationLeaves += 1;
        for (const entry of payload.entries) {
          if (payload.kind === 'term') terms.add(entry.key);
          if (payload.kind === 'citation') citations.add(entry.key);
        }
      } else {
        shardSummaries += 1;
        maxShardLoadedBytes = Math.max(maxShardLoadedBytes, stored.loadedBytes);
      }
    }
    const stats: GlobalRoutingStats = {
      collections: collections.length,
      terms: terms.size,
      citations: citations.size,
      directories,
      termLeaves,
      citationLeaves,
      shardSummaries,
      maxShardsPerTermLeaf,
      maxDirectoryLoadedBytes,
      maxShardLoadedBytes,
      rootBytes: rootStored.loadedBytes,
      remoteBytes,
      perCountryFanout: false,
    };
    return {
      schema: GLOBAL_ROUTING_SCHEMA,
      catalogRevision: input.catalogRevision,
      asOf: input.asOf,
      limits,
      rootPath: 'routing/root.json',
      perCountryFanout: false,
      fullCorpusBundled: false,
      documents,
      stats,
      pages,
    };
  }
}

function compareFragments(left: Fragment, right: Fragment): number {
  if (left.firstKey !== right.firstKey) return left.firstKey < right.firstKey ? -1 : 1;
  if (left.lastKey !== right.lastKey) return left.lastKey < right.lastKey ? -1 : 1;
  return left.pointer.directoryId < right.pointer.directoryId ? -1 : left.pointer.directoryId > right.pointer.directoryId ? 1 : 0;
}

function assertRouting(index: GlobalRoutingIndex): void {
  if (index.perCountryFanout !== false || index.fullCorpusBundled !== false || index.pages.perCountryFanout !== false) {
    fail('internal-invalid', 'routing claims per-country fanout or a bundled corpus');
  }
  if (pagesEnvelopeJson(index) !== canonicalJson(index.documents[index.rootPath]?.envelope)) {
    fail('internal-invalid', 'the pages envelope drifted');
  }
  if (index.pages.bundledBytes !== index.stats.rootBytes || index.pages.fullCorpusBundled !== false || index.pages.shardSummariesBundled !== false) {
    fail('internal-invalid', 'the pages bundle is not the routing root');
  }
  const root = index.documents[index.rootPath];
  if (!root || !isDirectoryPayload(root.envelope.payload) || root.envelope.payload.entries.length !== 0) {
    fail('internal-invalid', 'the routing root carries shard entries');
  }
  for (const [path, stored] of Object.entries(index.documents)) {
    if (stored.envelope.relativePath !== path) fail('internal-invalid', `${path} envelope path drifted`);
    const payloadJson = canonicalJson(stored.envelope.payload);
    if (sha256HexUtf8(payloadJson) !== stored.envelope.payloadSha256) fail('internal-invalid', `${path} checksum drifted`);
    if (utf8Bytes(canonicalJson(stored.envelope)).length !== stored.loadedBytes) fail('internal-invalid', `${path} byte count drifted`);
    const payload = stored.envelope.payload;
    if (isDirectoryPayload(payload)) {
      if (payload.perCountryFanout !== false || stored.loadedBytes > index.limits.maxDirectoryBytes) {
        fail('internal-invalid', `${path} exceeds the directory budget`);
      }
      for (const child of payload.children) {
        const target = index.documents[child.relativePath];
        if (!target || target.envelope.payloadSha256 !== child.payloadSha256 || target.loadedBytes !== child.loadedBytes) {
          fail('internal-invalid', `${path} points at a missing directory`);
        }
        if (child.firstKey < payload.firstKey || child.lastKey > payload.lastKey) {
          if (!(payload.kind === 'root' || payload.kind === 'coverage')) fail('internal-invalid', `${path} child range escapes its parent`);
        }
      }
      for (const entry of payload.entries) {
        if (entry.key < payload.firstKey || entry.key > payload.lastKey) fail('internal-invalid', `${path} entry escapes its range`);
        for (const shard of entry.shards) {
          const target = index.documents[shard.relativePath];
          if (!target || target.envelope.payloadSha256 !== shard.payloadSha256 || target.loadedBytes !== shard.loadedBytes) {
            fail('internal-invalid', `${path} points at a missing shard`);
          }
          if (isDirectoryPayload(target.envelope.payload) || target.envelope.payload.fullPostingsLoaded !== false) {
            fail('internal-invalid', `${shard.relativePath} is not a summary`);
          }
        }
      }
    } else if (stored.loadedBytes > index.limits.maxShardSummaryBytes || payload.perCountryFanout !== false) {
      fail('internal-invalid', `${path} exceeds the summary budget`);
    }
  }
}

export function pagesBundleDocument(index: GlobalRoutingIndex): StoredDocument<DirectoryPayload> {
  const stored = index.documents[index.rootPath];
  if (!stored || !isDirectoryPayload(stored.envelope.payload)) fail('missing-document', 'the routing root is missing');
  return stored as StoredDocument<DirectoryPayload>;
}

function runningAsCli(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(entry).href;
  } catch {
    return false;
  }
}

if (runningAsCli()) {
  try {
    const inputPath = process.argv[2];
    if (!inputPath || inputPath.startsWith('--')) {
      process.stderr.write('usage: build-global-routing.ts <routing-input.json> [--full]\n');
      process.exit(2);
    }
    const built = buildGlobalRouting(JSON.parse(readFileSync(inputPath, 'utf8')) as GlobalRoutingBuildInput);
    const payload = process.argv.includes('--full') ? built : pagesBundleDocument(built).envelope;
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'build-global-routing failed';
    process.stderr.write(`${message}\n`);
    process.exit(1);
  }
}

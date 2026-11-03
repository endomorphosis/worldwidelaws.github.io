#!/usr/bin/env node
/**
 * Offline shard and index preparation.
 *
 * A country IR release is reused only when its schema, BM25 constants, pinned
 * FTS5 tokenizer, checksums, shard bytes, and inclusive term ranges all
 * measure as compatible. The Pages document is the routing manifest. Corpus
 * paths are recorded as excluded and their bytes are not copied.
 *
 * Anything else emits worldwide-legal-search.compact-postings/v1. Postings
 * follow country_laws_ir/bm25.py: k1 1.2, b 0.75, title weight 5, body weight
 * 1, natural-log idf, and the pinned fts5-unicode61 tokenizer. Document
 * summaries keep identity, a short title, lengths, and a text checksum. They
 * do not keep the body. A missed term does not fall back to every shard.
 *
 * This script does not read parquet, does not invent an official citation,
 * and does not write a corpus into the site tree.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { CORPUS_SCHEMA_VERSION, canonicalJson, sha256HexUtf8, utf8Bytes } from '../../src/lib/worldwide/data/identity';
import { TOKENIZER_ID, TOKENIZER_UPSTREAM, tokenize } from '../../src/lib/worldwide/search/tokenize';

export const INDEX_SCHEMA = 'worldwide-legal-search.index-format@1';
export const REUSE_FORMAT = 'worldwide-legal-search.country-ir-reuse/v1';
export const COMPACT_FORMAT = 'worldwide-legal-search.compact-postings/v1';
export const COUNTRY_IR_SCHEMA = CORPUS_SCHEMA_VERSION;
export const LAYOUT_FAMILY = 'skillcenter-huggingface-release/v3';
export const UPSTREAM_TOKENIZER = 'fts5-unicode61-remove-diacritics-2-python/v1';
export const SCHEMA_DRAFT = 'https://json-schema.org/draft/2020-12/schema';
export const PAGES_LOGICAL_PATH = 'indexes/routing-manifest.json';
export const PAGES_ORIGIN = 'unbundled';

export const BM25 = Object.freeze({
  k1: 1.2,
  b: 0.75,
  titleWeight: 5,
  bodyWeight: 1,
  maxQueryTerms: 64,
});

export const INDEX_LIMITS = Object.freeze({
  absoluteShardBytes: 10 * 1024 * 1024,
  defaultShardBytes: 2 * 1024 * 1024,
  pagesBudgetBytes: 1024 * 1024,
  postingRowsPerRecord: 4096,
  termsPerShard: 4096,
  summaryRowsPerShard: 4096,
  titleTokenMax: 4096,
  titleStoreMax: 256,
  bodyTokenMax: 200_000,
});

export const EXCLUDED_ROLES = [
  'full-corpus',
  'document-bodies',
  'embeddings',
  'posting-payloads',
  'document-summaries',
  'parquet-corpus',
] as const;

const GIT_REVISION = /^[0-9a-f]{40}$/;
const AS_OF = /^[0-9]{4}-[0-9]{2}-[0-9]{2}(?:T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?Z)?$/;
const JURISDICTION_ID = /^[A-Za-z0-9:._-]{1,128}$/;
const COLLECTION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const POSTING_KINDS = new Set(['bm25_postings', 'country-ir-postings']);
const DOCUMENT_KINDS = new Set(['bm25_documents', 'country-ir-documents', 'bm25_document_chunks']);
const LEVELS = new Set(['national', 'regional', 'municipal', 'other']);

export type Level = 'national' | 'regional' | 'municipal' | 'other';
export type Decision = 'reuse-country-ir' | 'emit-compact';
export type ShardKind = 'country-ir-postings' | 'country-ir-documents' | 'compact-postings' | 'document-summaries';

export class IndexFormatError extends Error {
  readonly code: string;
  readonly reasons: readonly string[];

  constructor(code: string, message: string, reasons: readonly string[] = []) {
    super(message);
    this.name = 'IndexFormatError';
    this.code = code;
    this.reasons = reasons;
  }
}

export interface CountryIrShardInput {
  relative_path?: unknown;
  sha256?: unknown;
  size_bytes?: unknown;
  shard_id?: unknown;
  kind?: unknown;
  row_count?: unknown;
  first_key?: unknown;
  last_key?: unknown;
  start_document_index?: unknown;
  end_document_index?: unknown;
}

export interface CountryIrRelease {
  schema_version?: unknown;
  layout_family?: unknown;
  dataset_id?: unknown;
  dataset_revision?: unknown;
  jurisdiction_id?: unknown;
  level?: unknown;
  bundle_corpus_on_pages?: unknown;
  country?: { slug?: unknown; jurisdiction_id?: unknown };
  bm25?: Record<string, unknown>;
  counts?: Record<string, unknown>;
  keyword_shards?: unknown;
  document_shards?: unknown;
  corpus_shards?: unknown;
  indexes?: Record<string, unknown>;
  [extra: string]: unknown;
}

export interface IndexSourceDocument {
  entry_cid?: unknown;
  source_id?: unknown;
  source_record_id?: unknown;
  id?: unknown;
  title?: unknown;
  body?: unknown;
  text?: unknown;
  record_type?: unknown;
  language?: unknown;
  jurisdiction?: unknown;
  jurisdiction_id?: unknown;
  instrument_id?: unknown;
  law_id?: unknown;
  article_number?: unknown;
  identifier?: unknown;
  official_identifier?: unknown;
  source_revision?: unknown;
  [extra: string]: unknown;
}

export interface PrepareIndexInput {
  countryIr?: CountryIrRelease | null;
  documents?: readonly IndexSourceDocument[] | null;
  asOf: string;
  jurisdictionId?: string;
  level?: Level;
  datasetId?: string;
  sourceRevision?: string;
  collectionId?: string;
  shardByteCap?: number;
  pagesBudgetBytes?: number;
  termsPerShard?: number;
  postingRowsPerRecord?: number;
  summaryRowsPerShard?: number;
}

export interface Compatibility {
  measured: true;
  compatible: boolean;
  reasons: string[];
  notes: string[];
  country_ir_schema: string;
  country_ir_tokenizer: string;
}

export interface TokenizerBlock {
  tokenizer_id: typeof TOKENIZER_ID;
  strategy: 'fts5-unicode61';
  upstream_tokenizer: typeof UPSTREAM_TOKENIZER;
  upstream_commit: string;
  unicode: string;
  license: string;
  matches_country_ir: true;
}

export interface Coverage {
  coverage_state: 'known' | 'partial' | 'missing' | 'unknown' | 'unavailable';
  indexed_records: number | null;
  eligible_records: number | null;
  record_denominator: number;
  denominator_kind: 'indexed-documents' | 'not-counted';
  collection_count: number;
  blocked_count: number;
  legal_completeness: 'not_claimed';
  as_of: string;
  jurisdiction_id: string;
  level: Level;
  reason: string;
  tokenizer_id: typeof TOKENIZER_ID;
  integrity: { sha256: string };
}

export interface Bm25Block {
  k1: 1.2;
  b: 0.75;
  title_weight: 5;
  body_weight: 1;
  average_document_length: number;
  max_query_terms: 64;
  posting_rows_per_record: number;
  terms_per_shard: number;
  n_docs: number | null;
  n_terms: number | null;
  n_postings: number | null;
}

export interface ShardDescriptor {
  shard_id: number;
  kind: ShardKind;
  relative_path: string;
  sha256: string;
  size_bytes: number;
  first_key: string;
  last_key: string;
  row_count: number;
  bundled_on_pages: false;
}

export interface PostingRecord {
  term: string;
  document_indices: number[];
  title_frequencies: number[];
  body_frequencies: number[];
  tfs: number[];
  document_lengths: number[];
  document_frequency: number;
  corpus_frequency: number;
  idf: number;
  posting_chunk_index: number;
  posting_chunk_count: number;
  schema_version: typeof COMPACT_FORMAT;
}

export interface DocumentSummary {
  document_index: number;
  identity: string;
  identity_kind: 'entry_cid' | 'source-record';
  source_id: string;
  record_id: string;
  title: string;
  title_truncated: boolean;
  record_type: 'law' | 'article' | 'other';
  language: string;
  jurisdiction_id: string;
  jurisdiction_label: string;
  instrument_id: string;
  law_id: string;
  article_number: string;
  identifier: string;
  official_identifier: string;
  title_tokens: number;
  body_tokens: number;
  document_length: number;
  text_sha256: string;
  official_citation_invented: false;
}

export interface PayloadShard<T> {
  relative_path: string;
  sha256: string;
  size_bytes: number;
  records: T[];
}

export interface PreparedIndex {
  schema: typeof INDEX_SCHEMA;
  format_version: typeof REUSE_FORMAT | typeof COMPACT_FORMAT;
  decision: Decision;
  compatibility: Compatibility;
  tokenizer: TokenizerBlock;
  coverage: Coverage;
  bm25: Bm25Block;
  checksums: {
    routing_sha256: string;
    postings_sha256: string;
    summaries_sha256: string;
    pages_bundle_sha256: string;
  };
  term_routing: ShardDescriptor[];
  shards: ShardDescriptor[];
  excluded_corpus_paths: string[];
  pages: {
    full_corpus_bundled: false;
    index_payload_bundled: false;
    bundled_roles: ['routing-manifest'];
    excluded_roles: readonly string[];
    bundled_bytes: number;
    bundled_sha256: string;
    remote_shard_bytes: number;
    logical_path: typeof PAGES_LOGICAL_PATH;
    origin: typeof PAGES_ORIGIN;
    shard_byte_cap: number;
    pages_budget_bytes: number;
    absolute_shard_bytes: number;
  };
  source: {
    dataset_id: string;
    source_revision: string;
    collection_id: string;
    jurisdiction_id: string;
  };
  offline: {
    postings: PostingRecord[];
    document_summaries: DocumentSummary[];
    posting_shards: PayloadShard<PostingRecord>[];
    summary_shards: PayloadShard<DocumentSummary>[];
  };
}

export interface QueryRoute {
  term: string;
  route: ShardDescriptor | null;
}

export interface PagesBundle {
  schema: typeof INDEX_SCHEMA;
  format_version: PreparedIndex['format_version'];
  decision: Decision;
  compatibility: Compatibility;
  tokenizer: TokenizerBlock;
  coverage: Coverage;
  bm25: Bm25Block;
  term_routing: ShardDescriptor[];
  shards: ShardDescriptor[];
  excluded_corpus_paths: string[];
  source: PreparedIndex['source'];
  pages_policy: {
    full_corpus_bundled: false;
    index_payload_bundled: false;
    bundled_roles: ['routing-manifest'];
    excluded_roles: readonly string[];
    logical_path: typeof PAGES_LOGICAL_PATH;
    origin: typeof PAGES_ORIGIN;
  };
}

interface Admitted {
  summary: DocumentSummary;
  titleTokens: string[];
  bodyTokens: string[];
}

interface NormalizedShard extends ShardDescriptor {}

interface Inspection {
  compatibility: Compatibility;
  postings: NormalizedShard[];
  documents: NormalizedShard[];
  corpusPaths: string[];
  average: number | null;
  postingRows: number;
  termsPerShard: number;
  nDocs: number | null;
  corpusRows: number | null;
  nTerms: number | null;
  nPostings: number | null;
  datasetId: string;
  revision: string;
  jurisdictionId: string;
  level: Level | null;
  collectionId: string;
}

function fail(code: string, message: string, reasons: readonly string[] = []): never {
  const text = message.startsWith(`${code}:`) || message === code ? message : `${code}: ${message}`;
  throw new IndexFormatError(code, text, reasons);
}

function isPlain(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function utf8Size(text: string): number {
  return utf8Bytes(text).length;
}

export function checksumOf(value: unknown): string {
  return sha256HexUtf8(canonicalJson(value));
}

export function idf(nDocs: number, documentFrequency: number): number {
  return Math.log((nDocs - documentFrequency + 0.5) / (documentFrequency + 0.5) + 1);
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function cleanText(value: unknown, max: number): string {
  if (typeof value !== 'string' || max <= 0) return '';
  const source = value.length > max ? value.slice(0, max) : value;
  let out = '';
  for (const ch of source) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 32 || code === 127) continue;
    out += ch;
  }
  return out.trim();
}

function copyId(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  const cleaned = cleanText(value, max + 1);
  return cleaned.length > max ? '' : cleaned;
}

function isSafeRelative(value: string, allowCorpus: boolean): boolean {
  if (!value || value.length > 240) return false;
  if (value.startsWith('/') || value.includes('\\') || value.includes('..') || value.includes('//')) return false;
  if (!/^[A-Za-z0-9][A-Za-z0-9_./-]*$/.test(value)) return false;
  if (!allowCorpus && value.includes('data/corpus')) return false;
  return true;
}

function padIndex(value: number): string {
  return String(value).padStart(8, '0');
}

function near(value: unknown, expected: number): boolean {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value - expected) < 1e-9;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function intIn(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) return null;
  return value;
}

function sha256Ok(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function shardArray(release: Record<string, unknown>, field: string, indexField: string): unknown[] {
  if (Object.hasOwn(release, field)) return Array.isArray(release[field]) ? release[field] as unknown[] : [];
  const indexes = isPlain(release.indexes) ? release.indexes : null;
  if (indexes && Array.isArray(indexes[indexField])) return indexes[indexField] as unknown[];
  return [];
}

function jurisdictionToken(value: unknown): string {
  return typeof value === 'string' && JURISDICTION_ID.test(value) ? value : '';
}

function datasetToken(value: unknown): string {
  const cleaned = cleanText(value, 200);
  return cleaned && cleaned.length <= 200 ? cleaned : '';
}

function levelToken(value: unknown): Level | null {
  return typeof value === 'string' && LEVELS.has(value) ? value as Level : null;
}

function optionInt(value: number | undefined, fallback: number, max: number, label: string): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1 || value > max) {
    fail('invalid-option', `${label} must be an integer from 1 to ${max}`);
  }
  return value;
}

function optionId(value: string | undefined, label: string, pattern: RegExp): string {
  if (value === undefined || value === '') return '';
  if (!pattern.test(value)) fail('invalid-option', `${label} is not an accepted identifier`);
  return value;
}

const TOKENIZER_BLOCK: TokenizerBlock = {
  tokenizer_id: TOKENIZER_ID,
  strategy: 'fts5-unicode61',
  upstream_tokenizer: UPSTREAM_TOKENIZER,
  upstream_commit: TOKENIZER_UPSTREAM.commit,
  unicode: TOKENIZER_UPSTREAM.unicode,
  license: TOKENIZER_UPSTREAM.license,
  matches_country_ir: true,
};

function emptyCompatibility(schema: string, tokenizer: string, reasons: string[], notes: string[] = []): Compatibility {
  return {
    measured: true,
    compatible: reasons.length === 0,
    reasons: sortedUnique(reasons),
    notes: sortedUnique(notes),
    country_ir_schema: schema,
    country_ir_tokenizer: tokenizer,
  };
}

function readRange(item: Record<string, unknown>, documents: boolean): { first: string; last: string } | null {
  let first = typeof item.first_key === 'string' ? item.first_key : '';
  let last = typeof item.last_key === 'string' ? item.last_key : '';
  if (documents && (!first || !last)) {
    const start = intIn(item.start_document_index, 0, 1_000_000_000);
    const end = intIn(item.end_document_index, 0, 1_000_000_000);
    if (start !== null && end !== null) {
      first = padIndex(start);
      last = padIndex(end);
    }
  }
  if (!first || !last) return null;
  return { first, last };
}

function normalizeShards(
  rows: unknown[],
  kind: 'country-ir-postings' | 'country-ir-documents',
  reasons: string[],
  corpusPaths: string[],
): NormalizedShard[] {
  const allowed = kind === 'country-ir-postings' ? POSTING_KINDS : DOCUMENT_KINDS;
  const routingReason = kind === 'country-ir-postings' ? 'term-routing-missing' : 'document-routing-missing';
  const out: NormalizedShard[] = [];
  rows.forEach((row, index) => {
    if (!isPlain(row)) {
      reasons.push('shard-bytes-unmeasured');
      return;
    }
    const declared = typeof row.kind === 'string' ? row.kind : '';
    if (declared.includes('corpus')) {
      reasons.push('shard-path-is-corpus');
      const rel = typeof row.relative_path === 'string' ? row.relative_path : '';
      if (isSafeRelative(rel, true)) corpusPaths.push(rel);
      return;
    }
    if (declared && !allowed.has(declared)) reasons.push('shard-kind-mismatch');
    const rel = typeof row.relative_path === 'string' ? row.relative_path : '';
    if (!rel || rel.includes('data/corpus')) {
      reasons.push(rel.includes('data/corpus') ? 'shard-path-is-corpus' : 'shard-path-unsafe');
      if (isSafeRelative(rel, true)) corpusPaths.push(rel);
      return;
    }
    if (!isSafeRelative(rel, false)) {
      reasons.push('shard-path-unsafe');
      return;
    }
    if (!sha256Ok(row.sha256)) reasons.push('shard-checksum-missing');
    const size = intIn(row.size_bytes, 1, INDEX_LIMITS.absoluteShardBytes);
    if (size === null) {
      const raw = finiteNumber(row.size_bytes);
      reasons.push(raw !== null && raw > INDEX_LIMITS.absoluteShardBytes ? 'shard-exceeds-byte-cap' : 'shard-bytes-unmeasured');
    }
    const range = readRange(row, kind === 'country-ir-documents');
    if (!range) reasons.push(routingReason);
    else if (range.first > range.last) reasons.push('term-range-inverted');
    const rowCount = row.row_count === undefined ? 0 : intIn(row.row_count, 0, 1_000_000_000);
    if (rowCount === null) reasons.push('shard-row-count-invalid');
    if (!sha256Ok(row.sha256) || size === null || !range || range.first > range.last || rowCount === null) return;
    out.push({
      shard_id: index,
      kind,
      relative_path: rel,
      sha256: row.sha256,
      size_bytes: size,
      first_key: range.first,
      last_key: range.last,
      row_count: rowCount,
      bundled_on_pages: false,
    });
  });
  out.sort((left, right) => left.first_key.localeCompare(right.first_key) || left.shard_id - right.shard_id || left.relative_path.localeCompare(right.relative_path));
  out.forEach((shard, index) => {
    shard.shard_id = index;
  });
  for (let i = 1; i < out.length; i += 1) {
    const previous = out[i - 1];
    const current = out[i];
    if (!previous || !current) continue;
    if (current.first_key <= previous.last_key) reasons.push('term-ranges-overlap');
  }
  return out;
}

function inspectRelease(release: CountryIrRelease | null | undefined, callerRevision: string): Inspection {
  if (!release || !isPlain(release)) {
    return {
      compatibility: emptyCompatibility('', '', ['country-ir-not-supplied']),
      postings: [],
      documents: [],
      corpusPaths: [],
      average: null,
      postingRows: INDEX_LIMITS.postingRowsPerRecord,
      termsPerShard: INDEX_LIMITS.termsPerShard,
      nDocs: null,
      corpusRows: null,
      nTerms: null,
      nPostings: null,
      datasetId: '',
      revision: '',
      jurisdictionId: '',
      level: null,
      collectionId: '',
    };
  }
  const reasons: string[] = [];
  const notes: string[] = [];
  const schema = typeof release.schema_version === 'string' ? release.schema_version : '';
  const bm25 = isPlain(release.bm25) ? release.bm25 : {};
  const tokenizer = typeof bm25.tokenizer === 'string' ? bm25.tokenizer : '';
  if (schema !== COUNTRY_IR_SCHEMA) reasons.push('schema-version-mismatch');
  if (release.layout_family !== LAYOUT_FAMILY) reasons.push('layout-family-mismatch');
  if (!tokenizer) reasons.push('tokenizer-missing');
  else if (tokenizer !== UPSTREAM_TOKENIZER && tokenizer !== TOKENIZER_ID) reasons.push('tokenizer-mismatch');
  if (!near(bm25.k1, BM25.k1) || !near(bm25.b, BM25.b) || !near(bm25.title_weight, BM25.titleWeight) || !near(bm25.body_weight, BM25.bodyWeight)) {
    reasons.push('bm25-constants-mismatch');
  }
  if (bm25.max_query_terms === undefined) notes.push('max-query-terms-defaulted');
  else if (!near(bm25.max_query_terms, BM25.maxQueryTerms)) reasons.push('bm25-constants-mismatch');
  const average = finiteNumber(bm25.average_document_length);
  if (average === null || average < 0) reasons.push('average-document-length-missing');
  const postingRows = intIn(bm25.posting_rows_per_record, 1, 1_000_000) ?? INDEX_LIMITS.postingRowsPerRecord;
  const termsPerShard = intIn(bm25.terms_per_shard, 1, 1_000_000) ?? INDEX_LIMITS.termsPerShard;
  if (bm25.posting_rows_per_record !== undefined && intIn(bm25.posting_rows_per_record, 1, 1_000_000) === null) notes.push('posting-rows-defaulted');
  if (bm25.terms_per_shard !== undefined && intIn(bm25.terms_per_shard, 1, 1_000_000) === null) notes.push('terms-per-shard-defaulted');
  const record = release as Record<string, unknown>;
  const corpusPaths: string[] = [];
  const postings = normalizeShards(shardArray(record, 'keyword_shards', 'bm25_keyword_shards'), 'country-ir-postings', reasons, corpusPaths);
  const documents = normalizeShards(shardArray(record, 'document_shards', 'bm25_document_chunks'), 'country-ir-documents', reasons, corpusPaths);
  if (!shardArray(record, 'keyword_shards', 'bm25_keyword_shards').length) reasons.push('keyword-shards-missing');
  if (!shardArray(record, 'document_shards', 'bm25_document_chunks').length) reasons.push('document-shards-missing');
  for (const row of shardArray(record, 'corpus_shards', 'corpus_chunks')) {
    if (!isPlain(row) || typeof row.relative_path !== 'string') continue;
    if (!isSafeRelative(row.relative_path, true)) reasons.push('shard-path-unsafe');
    else corpusPaths.push(row.relative_path);
  }
  const seen = new Set<string>();
  for (const shard of [...postings, ...documents]) {
    if (seen.has(shard.relative_path)) reasons.push('duplicate-shard-path');
    seen.add(shard.relative_path);
  }
  if (release.bundle_corpus_on_pages === true) reasons.push('full-corpus-bundle-requested');
  const revision = typeof release.dataset_revision === 'string' ? release.dataset_revision : '';
  if (revision && !GIT_REVISION.test(revision)) reasons.push('revision-not-pinned');
  if (revision && callerRevision && revision !== callerRevision) reasons.push('revision-mismatch');
  if (!revision) notes.push(callerRevision ? 'source-revision-from-caller' : 'source-revision-absent');
  const counts = isPlain(release.counts) ? release.counts : {};
  const country = isPlain(release.country) ? release.country : null;
  const slug = country && typeof country.slug === 'string' && COLLECTION_ID.test(country.slug) ? country.slug : '';
  return {
    compatibility: emptyCompatibility(schema, tokenizer, reasons, notes),
    postings,
    documents,
    corpusPaths: sortedUnique(corpusPaths),
    average,
    postingRows,
    termsPerShard,
    nDocs: intIn(counts.bm25_documents, 0, 1_000_000_000),
    corpusRows: intIn(counts.corpus_rows, 0, 1_000_000_000),
    nTerms: intIn(counts.bm25_terms, 0, 1_000_000_000),
    nPostings: intIn(counts.bm25_postings, 0, 1_000_000_000),
    datasetId: datasetToken(release.dataset_id),
    revision: GIT_REVISION.test(revision) ? revision : '',
    jurisdictionId: jurisdictionToken(country?.jurisdiction_id) || jurisdictionToken(release.jurisdiction_id),
    level: levelToken(release.level),
    collectionId: slug,
  };
}

export function measureCountryIr(release: CountryIrRelease | null | undefined): Compatibility {
  return inspectRelease(release, '').compatibility;
}

function sealCoverage(fields: Omit<Coverage, 'integrity'>): Coverage {
  return { ...fields, integrity: { sha256: checksumOf(fields) } };
}

function reuseCoverage(inspection: Inspection, asOf: string, jurisdictionId: string, level: Level): Coverage {
  const indexed = inspection.nDocs;
  const eligible = inspection.corpusRows ?? indexed;
  let state: Coverage['coverage_state'] = 'unknown';
  if (indexed !== null && eligible !== null && indexed !== eligible) state = 'partial';
  else if (indexed !== null) state = 'known';
  const reason = indexed === null
    ? 'Reused measured country IR. Indexed record count was not published. Corpus shards are not bundled on Pages. legal_completeness is not_claimed.'
    : eligible !== null && eligible !== indexed
      ? `Reused measured country IR. Indexed records ${indexed} of ${eligible} corpus rows. Corpus shards are not bundled on Pages. legal_completeness is not_claimed.`
      : `Reused measured country IR. Indexed records ${indexed}. Corpus shards are not bundled on Pages. legal_completeness is not_claimed.`;
  return sealCoverage({
    coverage_state: state,
    indexed_records: indexed,
    eligible_records: eligible,
    record_denominator: indexed ?? 0,
    denominator_kind: indexed === null ? 'not-counted' : 'indexed-documents',
    collection_count: 1,
    blocked_count: 0,
    legal_completeness: 'not_claimed',
    as_of: asOf,
    jurisdiction_id: jurisdictionId,
    level,
    reason,
    tokenizer_id: TOKENIZER_ID,
  });
}

function countCoverage(admitted: number, supplied: number, excluded: Map<string, number>, asOf: string, jurisdictionId: string, level: Level): Coverage {
  const parts = [...excluded.entries()].sort((left, right) => left[0].localeCompare(right[0]));
  const detail = parts.map(([name, count]) => `${name}=${count}`).join(', ');
  const state = admitted === supplied ? 'known' : 'partial';
  const reason = `Indexed ${admitted} of ${supplied} supplied records.${detail ? ` Excluded ${detail}.` : ''} Corpus text is not bundled on Pages. legal_completeness is not_claimed.`;
  return sealCoverage({
    coverage_state: state,
    indexed_records: admitted,
    eligible_records: supplied,
    record_denominator: admitted,
    denominator_kind: 'indexed-documents',
    collection_count: 1,
    blocked_count: supplied - admitted,
    legal_completeness: 'not_claimed',
    as_of: asOf,
    jurisdiction_id: jurisdictionId,
    level,
    reason,
    tokenizer_id: TOKENIZER_ID,
  });
}

function admitDocuments(documents: readonly IndexSourceDocument[], jurisdictionId: string): { admitted: Admitted[]; excluded: Map<string, number> } {
  const excluded = new Map<string, number>();
  const seen = new Set<string>();
  const admitted: Admitted[] = [];
  const bump = (reason: string) => excluded.set(reason, (excluded.get(reason) ?? 0) + 1);
  documents.forEach((doc) => {
    if (!isPlain(doc)) {
      bump('missing-identity');
      return;
    }
    const rowRevision = doc.source_revision;
    if (rowRevision !== undefined && rowRevision !== null && rowRevision !== '' && (typeof rowRevision !== 'string' || !GIT_REVISION.test(rowRevision))) {
      bump('invalid-row-revision');
      return;
    }
    const entry = copyId(doc.entry_cid, 256);
    const sourceId = copyId(doc.source_id, 120);
    const recordId = copyId(doc.id, 120) || copyId(doc.source_record_id, 120);
    let identity = '';
    let identityKind: DocumentSummary['identity_kind'] | null = null;
    if (entry) {
      identity = entry;
      identityKind = 'entry_cid';
    } else if (sourceId && recordId) {
      identity = `${sourceId}#${recordId}`;
      identityKind = 'source-record';
    }
    if (!identity || !identityKind || identity.length > 256) {
      bump('missing-identity');
      return;
    }
    if (seen.has(identity)) {
      bump('duplicate-identity');
      return;
    }
    const rawTitle = typeof doc.title === 'string' ? doc.title : '';
    const tokenTitle = cleanText(rawTitle, INDEX_LIMITS.titleTokenMax);
    const tokenBody = cleanText(doc.body, INDEX_LIMITS.bodyTokenMax) || cleanText(doc.text, INDEX_LIMITS.bodyTokenMax);
    const titleTokens = tokenize(tokenTitle);
    const bodyTokens = tokenize(tokenBody);
    if (!titleTokens.length && !bodyTokens.length) {
      bump('no-searchable-tokens');
      return;
    }
    seen.add(identity);
    const storedTitle = tokenTitle.length > INDEX_LIMITS.titleStoreMax ? tokenTitle.slice(0, INDEX_LIMITS.titleStoreMax).trimEnd() : tokenTitle;
    const recordType = doc.record_type === 'law' || doc.record_type === 'article' ? doc.record_type : 'other';
    const language = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8}){0,3}$/.test(cleanText(doc.language, 32)) ? cleanText(doc.language, 32) : '';
    admitted.push({
      titleTokens,
      bodyTokens,
      summary: {
        document_index: admitted.length,
        identity,
        identity_kind: identityKind,
        source_id: sourceId,
        record_id: recordId,
        title: storedTitle,
        title_truncated: tokenTitle.length > storedTitle.length || rawTitle.length > INDEX_LIMITS.titleTokenMax,
        record_type: recordType,
        language,
        jurisdiction_id: jurisdictionToken(doc.jurisdiction_id) || jurisdictionId,
        jurisdiction_label: cleanText(doc.jurisdiction, 128),
        instrument_id: copyId(doc.instrument_id, 256),
        law_id: copyId(doc.law_id, 256),
        article_number: copyId(doc.article_number, 64),
        identifier: copyId(doc.identifier, 256),
        official_identifier: copyId(doc.official_identifier, 256),
        title_tokens: titleTokens.length,
        body_tokens: bodyTokens.length,
        document_length: titleTokens.length * BM25.titleWeight + bodyTokens.length * BM25.bodyWeight,
        text_sha256: sha256HexUtf8(`${tokenTitle}\n${tokenBody}`),
        official_citation_invented: false,
      },
    });
  });
  return { admitted, excluded };
}

function buildPostings(admitted: readonly Admitted[], postingRows: number): PostingRecord[] {
  const n = admitted.length;
  const buckets = new Map<string, Map<number, { title: number; body: number }>>();
  admitted.forEach((doc, index) => {
    const counts = new Map<string, { title: number; body: number }>();
    for (const term of doc.titleTokens) {
      const current = counts.get(term) ?? { title: 0, body: 0 };
      current.title += 1;
      counts.set(term, current);
    }
    for (const term of doc.bodyTokens) {
      const current = counts.get(term) ?? { title: 0, body: 0 };
      current.body += 1;
      counts.set(term, current);
    }
    for (const [term, tf] of counts) {
      let docs = buckets.get(term);
      if (!docs) {
        docs = new Map();
        buckets.set(term, docs);
      }
      docs.set(index, tf);
    }
  });
  const rows: PostingRecord[] = [];
  for (const term of [...buckets.keys()].sort()) {
    const docs = buckets.get(term);
    if (!docs) continue;
    const items = [...docs.entries()].sort((left, right) => left[0] - right[0]);
    const chunks: Array<typeof items> = [];
    for (let offset = 0; offset < items.length; offset += postingRows) chunks.push(items.slice(offset, offset + postingRows));
    const documentFrequency = items.length;
    const corpusFrequency = items.reduce((sum, [, tf]) => sum + tf.title + tf.body, 0);
    const weight = idf(n, documentFrequency);
    chunks.forEach((chunk, chunkIndex) => {
      rows.push({
        term,
        document_indices: chunk.map(([index]) => index),
        title_frequencies: chunk.map(([, tf]) => tf.title),
        body_frequencies: chunk.map(([, tf]) => tf.body),
        tfs: chunk.map(([, tf]) => BM25.titleWeight * tf.title + BM25.bodyWeight * tf.body),
        document_lengths: chunk.map(([index]) => admitted[index]?.summary.document_length ?? 0),
        document_frequency: documentFrequency,
        corpus_frequency: corpusFrequency,
        idf: weight,
        posting_chunk_index: chunkIndex,
        posting_chunk_count: chunks.length,
        schema_version: COMPACT_FORMAT,
      });
    });
  }
  return rows;
}

function packPostings(rows: readonly PostingRecord[], termsPerShard: number, byteCap: number): PostingRecord[][] {
  const packs: PostingRecord[][] = [];
  for (const row of rows) {
    const last = packs[packs.length - 1];
    if (last && last[0]?.term === row.term) last.push(row);
    else packs.push([row]);
  }
  const groups: PostingRecord[][] = [];
  let current: PostingRecord[] = [];
  let terms = 0;
  const flush = () => {
    if (current.length) groups.push(current);
    current = [];
    terms = 0;
  };
  for (const pack of packs) {
    const alone = utf8Size(canonicalJson(pack));
    if (alone > byteCap) fail('term-exceeds-shard-byte-cap', `term ${pack[0]?.term ?? ''} needs ${alone} bytes`);
    if (current.length && (terms + 1 > termsPerShard || utf8Size(canonicalJson(current.concat(pack))) > byteCap)) flush();
    current = current.concat(pack);
    terms += 1;
  }
  flush();
  return groups;
}

function packSummaries(rows: readonly DocumentSummary[], rowCap: number, byteCap: number): DocumentSummary[][] {
  const groups: DocumentSummary[][] = [];
  let current: DocumentSummary[] = [];
  const flush = () => {
    if (current.length) groups.push(current);
    current = [];
  };
  for (const row of rows) {
    if (utf8Size(canonicalJson([row])) > byteCap) fail('summary-exceeds-shard-byte-cap', 'one document summary exceeds the shard byte cap');
    if (current.length) {
      const next = current.concat([row]);
      if (current.length + 1 > rowCap || utf8Size(canonicalJson(next)) > byteCap) flush();
    }
    current = current.concat([row]);
  }
  flush();
  return groups;
}

function payloadShard<T>(records: readonly T[], relativePath: string): PayloadShard<T> {
  const body = canonicalJson(records);
  return {
    relative_path: relativePath,
    sha256: sha256HexUtf8(body),
    size_bytes: utf8Size(body),
    records: [...records],
  };
}

function descriptor(kind: ShardKind, shardId: number, payload: PayloadShard<unknown>, first: string, last: string, rowCount: number): ShardDescriptor {
  return {
    shard_id: shardId,
    kind,
    relative_path: payload.relative_path,
    sha256: payload.sha256,
    size_bytes: payload.size_bytes,
    first_key: first,
    last_key: last,
    row_count: rowCount,
    bundled_on_pages: false,
  };
}

function bundleShape(index: Omit<PreparedIndex, 'checksums' | 'pages' | 'offline'>): PagesBundle {
  return {
    schema: index.schema,
    format_version: index.format_version,
    decision: index.decision,
    compatibility: index.compatibility,
    tokenizer: index.tokenizer,
    coverage: index.coverage,
    bm25: index.bm25,
    term_routing: index.term_routing,
    shards: index.shards,
    excluded_corpus_paths: index.excluded_corpus_paths,
    source: index.source,
    pages_policy: {
      full_corpus_bundled: false,
      index_payload_bundled: false,
      bundled_roles: ['routing-manifest'],
      excluded_roles: EXCLUDED_ROLES,
      logical_path: PAGES_LOGICAL_PATH,
      origin: PAGES_ORIGIN,
    },
  };
}

export function pagesBundleDocument(index: PreparedIndex): PagesBundle {
  return bundleShape(index);
}

function finish(draft: Omit<PreparedIndex, 'checksums' | 'pages'>, shardByteCap: number, pagesBudget: number): PreparedIndex {
  const bundleJson = canonicalJson(bundleShape(draft));
  const bundledBytes = utf8Size(bundleJson);
  if (bundledBytes > pagesBudget) {
    fail('routing-exceeds-pages-budget', `routing manifest is ${bundledBytes} bytes and the Pages budget is ${pagesBudget}`);
  }
  const bundledSha = sha256HexUtf8(bundleJson);
  const remote = draft.shards.reduce((sum, shard) => sum + shard.size_bytes, 0);
  const index: PreparedIndex = {
    ...draft,
    checksums: {
      routing_sha256: checksumOf(draft.term_routing),
      postings_sha256: checksumOf(draft.offline.postings),
      summaries_sha256: checksumOf(draft.offline.document_summaries),
      pages_bundle_sha256: bundledSha,
    },
    pages: {
      full_corpus_bundled: false,
      index_payload_bundled: false,
      bundled_roles: ['routing-manifest'],
      excluded_roles: EXCLUDED_ROLES,
      bundled_bytes: bundledBytes,
      bundled_sha256: bundledSha,
      remote_shard_bytes: remote,
      logical_path: PAGES_LOGICAL_PATH,
      origin: PAGES_ORIGIN,
      shard_byte_cap: shardByteCap,
      pages_budget_bytes: pagesBudget,
      absolute_shard_bytes: INDEX_LIMITS.absoluteShardBytes,
    },
  };
  assertPrepared(index);
  return index;
}

function emitCompact(input: PrepareIndexInput, inspection: Inspection, jurisdictionId: string, level: Level, datasetId: string, revision: string, collectionId: string, shardByteCap: number, pagesBudget: number, termsPerShard: number, postingRows: number, summaryRows: number): PreparedIndex {
  const documents = input.documents ?? [];
  const { admitted, excluded } = admitDocuments(documents, jurisdictionId);
  if (!admitted.length) {
    const detail = [...excluded.entries()].map(([name, count]) => `${name}=${count}`).join(', ');
    fail('no-searchable-documents', `no supplied record had an identity and a searchable token${detail ? ` (${detail})` : ''}`);
  }
  const postings = buildPostings(admitted, postingRows);
  const postingGroups = packPostings(postings, termsPerShard, shardByteCap);
  const summaries = admitted.map((doc) => doc.summary);
  const summaryGroups = packSummaries(summaries, summaryRows, shardByteCap);
  const postingShards = postingGroups.map((records, index) => payloadShard(records, `indexes/compact-postings/part-${String(index).padStart(6, '0')}.json`));
  const summaryShards = summaryGroups.map((records, index) => payloadShard(records, `indexes/document-summaries/part-${String(index).padStart(6, '0')}.json`));
  const postingDescriptors = postingShards.map((payload, index) => {
    const records = postingGroups[index] ?? [];
    const first = records[0]?.term ?? '';
    const last = records[records.length - 1]?.term ?? first;
    return descriptor('compact-postings', index, payload, first, last, records.length);
  });
  const summaryDescriptors = summaryShards.map((payload, index) => {
    const records = summaryGroups[index] ?? [];
    const first = records[0] ? padIndex(records[0].document_index) : padIndex(0);
    const lastRecord = records[records.length - 1];
    const last = lastRecord ? padIndex(lastRecord.document_index) : first;
    return descriptor('document-summaries', index, payload, first, last, records.length);
  });
  const nPostings = postings.reduce((sum, row) => sum + (row.posting_chunk_index === 0 ? row.document_frequency : 0), 0);
  const average = admitted.reduce((sum, doc) => sum + doc.summary.document_length, 0) / admitted.length;
  const notes = [...inspection.compatibility.notes];
  if (input.countryIr) notes.push('country-ir-rejected');
  return finish({
    schema: INDEX_SCHEMA,
    format_version: COMPACT_FORMAT,
    decision: 'emit-compact',
    compatibility: {
      ...inspection.compatibility,
      compatible: false,
      notes: sortedUnique(notes),
    },
    tokenizer: { ...TOKENIZER_BLOCK },
    coverage: countCoverage(admitted.length, documents.length, excluded, input.asOf, jurisdictionId, level),
    bm25: {
      k1: 1.2,
      b: 0.75,
      title_weight: 5,
      body_weight: 1,
      average_document_length: average,
      max_query_terms: 64,
      posting_rows_per_record: postingRows,
      terms_per_shard: termsPerShard,
      n_docs: admitted.length,
      n_terms: new Set(postings.map((row) => row.term)).size,
      n_postings: nPostings,
    },
    term_routing: postingDescriptors,
    shards: [...postingDescriptors, ...summaryDescriptors],
    excluded_corpus_paths: inspection.corpusPaths,
    source: { dataset_id: datasetId || 'unstated', source_revision: revision, collection_id: collectionId || 'unstated', jurisdiction_id: jurisdictionId },
    offline: { postings, document_summaries: summaries, posting_shards: postingShards, summary_shards: summaryShards },
  }, shardByteCap, pagesBudget);
}

function reuseRelease(input: PrepareIndexInput, inspection: Inspection, jurisdictionId: string, level: Level, datasetId: string, revision: string, collectionId: string, pagesBudget: number): PreparedIndex {
  const notes = [...inspection.compatibility.notes];
  if (input.documents?.length) notes.push('supplied-documents-ignored');
  const shards = [...inspection.postings, ...inspection.documents];
  return finish({
    schema: INDEX_SCHEMA,
    format_version: REUSE_FORMAT,
    decision: 'reuse-country-ir',
    compatibility: { ...inspection.compatibility, compatible: true, reasons: [], notes: sortedUnique(notes) },
    tokenizer: { ...TOKENIZER_BLOCK },
    coverage: reuseCoverage(inspection, input.asOf, jurisdictionId, level),
    bm25: {
      k1: 1.2,
      b: 0.75,
      title_weight: 5,
      body_weight: 1,
      average_document_length: inspection.average ?? 0,
      max_query_terms: 64,
      posting_rows_per_record: inspection.postingRows,
      terms_per_shard: inspection.termsPerShard,
      n_docs: inspection.nDocs,
      n_terms: inspection.nTerms,
      n_postings: inspection.nPostings,
    },
    term_routing: inspection.postings,
    shards,
    excluded_corpus_paths: inspection.corpusPaths,
    source: {
      dataset_id: datasetId || 'unstated',
      source_revision: revision,
      collection_id: collectionId || 'unstated',
      jurisdiction_id: jurisdictionId,
    },
    offline: { postings: [], document_summaries: [], posting_shards: [], summary_shards: [] },
  }, INDEX_LIMITS.absoluteShardBytes, pagesBudget);
}

export function prepareIndex(input: PrepareIndexInput): PreparedIndex {
  if (!input || typeof input.asOf !== 'string' || !AS_OF.test(input.asOf)) {
    fail('invalid-as-of', 'asOf must be a calendar date or a UTC timestamp');
  }
  const callerRevision = input.sourceRevision === undefined || input.sourceRevision === ''
    ? ''
    : (GIT_REVISION.test(input.sourceRevision) ? input.sourceRevision : fail('invalid-revision', 'sourceRevision must be a 40-character hex commit'));
  const callerJurisdiction = optionId(input.jurisdictionId, 'jurisdictionId', JURISDICTION_ID);
  const callerCollection = optionId(input.collectionId, 'collectionId', COLLECTION_ID);
  const callerDataset = input.datasetId === undefined || input.datasetId === '' ? '' : datasetToken(input.datasetId);
  if (input.datasetId && !callerDataset) fail('invalid-option', 'datasetId is empty after cleaning');
  if (input.level !== undefined && !LEVELS.has(input.level)) fail('invalid-option', 'level is not a coverage level');
  const shardByteCap = optionInt(input.shardByteCap, INDEX_LIMITS.defaultShardBytes, INDEX_LIMITS.absoluteShardBytes, 'shardByteCap');
  const pagesBudget = optionInt(input.pagesBudgetBytes, INDEX_LIMITS.pagesBudgetBytes, INDEX_LIMITS.pagesBudgetBytes, 'pagesBudgetBytes');
  const termsPerShard = optionInt(input.termsPerShard, INDEX_LIMITS.termsPerShard, INDEX_LIMITS.termsPerShard, 'termsPerShard');
  const postingRows = optionInt(input.postingRowsPerRecord, INDEX_LIMITS.postingRowsPerRecord, INDEX_LIMITS.postingRowsPerRecord, 'postingRowsPerRecord');
  const summaryRows = optionInt(input.summaryRowsPerShard, INDEX_LIMITS.summaryRowsPerShard, INDEX_LIMITS.summaryRowsPerShard, 'summaryRowsPerShard');
  if (input.documents !== undefined && input.documents !== null && !Array.isArray(input.documents)) {
    fail('invalid-option', 'documents must be an array');
  }
  const hasIr = Boolean(input.countryIr);
  const inspection = inspectRelease(hasIr ? input.countryIr : null, callerRevision);
  const jurisdictionId = inspection.jurisdictionId || callerJurisdiction || 'unstated';
  const level = inspection.level || input.level || 'other';
  const datasetId = inspection.datasetId || callerDataset || 'unstated';
  const revision = inspection.revision || callerRevision;
  const collectionId = callerCollection || inspection.collectionId || 'unstated';
  if (inspection.compatibility.compatible) {
    return reuseRelease(input, inspection, jurisdictionId, level, datasetId, revision, collectionId, pagesBudget);
  }
  if (input.documents && input.documents.length) {
    return emitCompact(
      input,
      inspection,
      callerJurisdiction || 'unstated',
      input.level || 'other',
      callerDataset || 'unstated',
      callerRevision,
      callerCollection || 'unstated',
      shardByteCap,
      pagesBudget,
      termsPerShard,
      postingRows,
      summaryRows,
    );
  }
  if (hasIr) fail('country-ir-incompatible', inspection.compatibility.reasons.join('; '), inspection.compatibility.reasons);
  fail('no-index-input', 'pass a measured country IR release or document records');
}

export function routeTerm(index: PreparedIndex, term: string): ShardDescriptor | null {
  const hits = index.term_routing.filter((route) => route.first_key <= term && term <= route.last_key);
  if (hits.length > 1) fail('term-routing-ambiguous', `term ${term} matched ${hits.length} shards`);
  const hit = hits[0];
  return hit ? { ...hit } : null;
}

export function routeQuery(index: PreparedIndex, query: string): QueryRoute[] {
  const terms: string[] = [];
  const seen = new Set<string>();
  for (const term of tokenize(query)) {
    if (seen.has(term)) continue;
    seen.add(term);
    terms.push(term);
    if (terms.length >= BM25.maxQueryTerms) break;
  }
  return terms.map((term) => ({ term, route: routeTerm(index, term) }));
}

let cachedSchema: Record<string, unknown> | null = null;

export function loadIndexSchema(): Record<string, unknown> {
  if (cachedSchema) return cachedSchema;
  const fromModule = fileURLToPath(new URL('../../data/worldwide/index-format.schema.json', import.meta.url));
  const fromCwd = path.join(process.cwd(), 'data/worldwide/index-format.schema.json');
  const schemaFile = existsSync(fromModule) ? fromModule : existsSync(fromCwd) ? fromCwd : '';
  if (!schemaFile) fail('schema-missing', 'data/worldwide/index-format.schema.json was not found');
  const parsed = JSON.parse(readFileSync(schemaFile, 'utf8')) as unknown;
  if (!isPlain(parsed)) fail('schema-missing', 'index schema is not an object');
  cachedSchema = parsed;
  return parsed;
}

function jsonEqual(left: unknown, right: unknown): boolean {
  try {
    return canonicalJson(left) === canonicalJson(right);
  } catch {
    return false;
  }
}

function typeOk(declared: unknown, value: unknown): boolean {
  const types = Array.isArray(declared) ? declared : [declared];
  return types.some((kind) => {
    if (kind === 'null') return value === null;
    if (kind === 'boolean') return typeof value === 'boolean';
    if (kind === 'string') return typeof value === 'string';
    if (kind === 'integer') return typeof value === 'number' && Number.isInteger(value);
    if (kind === 'number') return typeof value === 'number' && Number.isFinite(value);
    if (kind === 'array') return Array.isArray(value);
    if (kind === 'object') return isPlain(value);
    return false;
  });
}

function deref(ref: string, root: Record<string, unknown>): Record<string, unknown> | null {
  if (!ref.startsWith('#/$defs/')) return null;
  const defs = root.$defs;
  if (!isPlain(defs)) return null;
  const target = defs[ref.slice('#/$defs/'.length)];
  return isPlain(target) ? target : null;
}

function pushProblem(problems: string[], message: string) {
  if (problems.length < 30) problems.push(message);
}

function checkSchema(schema: Record<string, unknown>, value: unknown, at: string, root: Record<string, unknown>, problems: string[]) {
  if (problems.length >= 30) return;
  if (typeof schema.$ref === 'string') {
    const target = deref(schema.$ref, root);
    if (!target) pushProblem(problems, `${at} unresolvable ${schema.$ref}`);
    else checkSchema(target, value, at, root, problems);
    return;
  }
  if (Object.hasOwn(schema, 'const') && !jsonEqual(value, schema.const)) {
    pushProblem(problems, `${at} must equal the schema const`);
    return;
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((item) => jsonEqual(item, value))) {
    pushProblem(problems, `${at} is not an allowed value`);
    return;
  }
  if (schema.type !== undefined && !typeOk(schema.type, value)) {
    pushProblem(problems, `${at} has the wrong type`);
    return;
  }
  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && [...value].length < schema.minLength) pushProblem(problems, `${at} is too short`);
    if (typeof schema.maxLength === 'number' && [...value].length > schema.maxLength) pushProblem(problems, `${at} is too long`);
    if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern).test(value)) pushProblem(problems, `${at} does not match the schema pattern`);
  }
  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) pushProblem(problems, `${at} is below the minimum`);
    if (typeof schema.maximum === 'number' && value > schema.maximum) pushProblem(problems, `${at} is above the maximum`);
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) pushProblem(problems, `${at} has too few items`);
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) pushProblem(problems, `${at} has too many items`);
    if (isPlain(schema.items)) value.forEach((item, index) => checkSchema(schema.items as Record<string, unknown>, item, `${at}[${index}]`, root, problems));
  }
  if (isPlain(value)) {
    const properties = isPlain(schema.properties) ? schema.properties : {};
    const types = Array.isArray(schema.type) ? schema.type : schema.type === undefined ? [] : [schema.type];
    const objectSchema = types.includes('object') || schema.properties !== undefined;
    if (objectSchema && schema.additionalProperties !== false) pushProblem(problems, `${at} schema must set additionalProperties false`);
    if (Array.isArray(schema.required)) {
      for (const key of schema.required) {
        if (typeof key === 'string' && !Object.hasOwn(value, key)) pushProblem(problems, `${at}.${key} is required`);
      }
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(properties, key)) pushProblem(problems, `${at}.${key} is not allowed`);
      }
    }
    for (const key of Object.keys(properties)) {
      if (Object.hasOwn(value, key)) {
        const child = properties[key];
        if (isPlain(child)) checkSchema(child, value[key], `${at}.${key}`, root, problems);
      }
    }
  }
}

export function schemaProblems(schema: unknown, value: unknown): string[] {
  if (!isPlain(schema)) return ['schema is not an object'];
  const problems: string[] = [];
  if (schema.$schema !== SCHEMA_DRAFT) pushProblem(problems, 'schema $schema must be JSON Schema 2020-12');
  checkSchema(schema, value, '$', schema, problems);
  return problems;
}

function same(left: unknown, right: unknown): boolean {
  return checksumOf(left) === checksumOf(right);
}

function assertPrepared(index: PreparedIndex): void {
  const problems = schemaProblems(loadIndexSchema(), index);
  if (problems.length) fail('internal-invalid', problems.join('; '));
  const bundle = canonicalJson(pagesBundleDocument(index));
  if (sha256HexUtf8(bundle) !== index.pages.bundled_sha256 || sha256HexUtf8(bundle) !== index.checksums.pages_bundle_sha256) {
    fail('internal-invalid', 'pages bundle checksum drifted');
  }
  if (utf8Size(bundle) !== index.pages.bundled_bytes) fail('internal-invalid', 'pages bundle byte count drifted');
  if (index.pages.full_corpus_bundled !== false || index.pages.index_payload_bundled !== false) {
    fail('internal-invalid', 'pages bundle flags drifted');
  }
  if (checksumOf(index.term_routing) !== index.checksums.routing_sha256) fail('internal-invalid', 'routing checksum drifted');
  if (checksumOf(index.offline.postings) !== index.checksums.postings_sha256) fail('internal-invalid', 'postings checksum drifted');
  if (checksumOf(index.offline.document_summaries) !== index.checksums.summaries_sha256) fail('internal-invalid', 'summary checksum drifted');
  const { integrity, ...coverage } = index.coverage;
  if (checksumOf(coverage) !== integrity.sha256) fail('internal-invalid', 'coverage checksum drifted');
  const remote = index.shards.reduce((sum, shard) => sum + shard.size_bytes, 0);
  if (remote !== index.pages.remote_shard_bytes) fail('internal-invalid', 'remote shard bytes drifted');
  const paths = new Set(index.shards.map((shard) => shard.relative_path));
  for (const excluded of index.excluded_corpus_paths) {
    if (paths.has(excluded)) fail('internal-invalid', 'corpus path leaked into shards');
  }
  for (let i = 1; i < index.term_routing.length; i += 1) {
    const previous = index.term_routing[i - 1];
    const current = index.term_routing[i];
    if (!previous || !current || current.first_key <= previous.last_key) fail('internal-invalid', 'term ranges overlap');
  }
  for (const route of index.term_routing) {
    if (route.kind !== 'country-ir-postings' && route.kind !== 'compact-postings') fail('internal-invalid', 'term routing points at a non-posting shard');
    const shard = index.shards.find((item) => item.relative_path === route.relative_path);
    if (!shard || !same(shard, route)) fail('internal-invalid', 'term routing does not match its shard');
  }
  if (Object.hasOwn(pagesBundleDocument(index) as unknown as Record<string, unknown>, 'offline')) {
    fail('internal-invalid', 'pages bundle includes an offline payload');
  }
  if (index.decision === 'reuse-country-ir') {
    if (index.format_version !== REUSE_FORMAT || !index.compatibility.compatible || index.compatibility.reasons.length) {
      fail('internal-invalid', 'reuse decision does not match compatibility');
    }
    if (index.offline.postings.length || index.offline.document_summaries.length || index.offline.posting_shards.length || index.offline.summary_shards.length) {
      fail('internal-invalid', 'reused country IR copied a local payload');
    }
    return;
  }
  if (index.format_version !== COMPACT_FORMAT || index.compatibility.compatible) fail('internal-invalid', 'compact decision does not match compatibility');
  const summaries = index.offline.document_summaries;
  summaries.forEach((summary, indexNumber) => {
    if (summary.document_index !== indexNumber) fail('internal-invalid', 'document indexes are not contiguous');
    if (summary.document_length !== summary.title_tokens * BM25.titleWeight + summary.body_tokens * BM25.bodyWeight) {
      fail('internal-invalid', 'document length does not use the title and body weights');
    }
  });
  const postingShards = index.shards.filter((shard) => shard.kind === 'compact-postings');
  const summaryShards = index.shards.filter((shard) => shard.kind === 'document-summaries');
  if (postingShards.length !== index.offline.posting_shards.length || summaryShards.length !== index.offline.summary_shards.length) {
    fail('internal-invalid', 'shard descriptors do not match payloads');
  }
  let postingCursor = 0;
  index.offline.posting_shards.forEach((payload, indexNumber) => {
    const described = postingShards[indexNumber];
    const body = canonicalJson(payload.records);
    if (!described || described.sha256 !== payload.sha256 || described.size_bytes !== payload.size_bytes || sha256HexUtf8(body) !== payload.sha256 || utf8Size(body) !== payload.size_bytes) {
      fail('internal-invalid', 'posting shard checksum drifted');
    }
    if (!same(payload.records, index.offline.postings.slice(postingCursor, postingCursor + payload.records.length))) {
      fail('internal-invalid', 'posting shard records drifted');
    }
    postingCursor += payload.records.length;
  });
  if (postingCursor !== index.offline.postings.length) fail('internal-invalid', 'posting shards do not cover every posting');
  const byTerm = new Map<string, PostingRecord[]>();
  for (const row of index.offline.postings) {
    const widths = [row.document_indices.length, row.title_frequencies.length, row.body_frequencies.length, row.tfs.length, row.document_lengths.length];
    if (new Set(widths).size !== 1) fail('internal-invalid', 'posting columns differ in length');
    for (let i = 0; i < row.document_indices.length; i += 1) {
      const title = row.title_frequencies[i] ?? 0;
      const body = row.body_frequencies[i] ?? 0;
      const doc = row.document_indices[i] ?? -1;
      if (row.tfs[i] !== BM25.titleWeight * title + BM25.bodyWeight * body) fail('internal-invalid', 'tf weight drifted');
      if (summaries[doc]?.document_length !== row.document_lengths[i]) fail('internal-invalid', 'posting length drifted');
      if (i > 0 && doc <= (row.document_indices[i - 1] ?? doc)) fail('internal-invalid', 'posting documents are not ordered');
    }
    const list = byTerm.get(row.term) ?? [];
    list.push(row);
    byTerm.set(row.term, list);
  }
  let pairs = 0;
  for (const [term, rows] of byTerm) {
    if (!/^[0-9a-z]+$/.test(term)) fail('internal-invalid', 'posting term is not pinned-tokenizer output');
    rows.forEach((row, chunk) => {
      if (row.posting_chunk_index !== chunk || row.posting_chunk_count !== rows.length) fail('internal-invalid', 'posting chunk index drifted');
      if (row.document_frequency !== rows.reduce((sum, item) => sum + item.document_indices.length, 0)) fail('internal-invalid', 'document frequency drifted');
    });
    const df = rows[0]?.document_frequency ?? 0;
    pairs += df;
    const expected = idf(summaries.length, df);
    const corpus = rows.reduce((sum, row) => sum + row.title_frequencies.reduce((inner, value) => inner + value, 0) + row.body_frequencies.reduce((inner, value) => inner + value, 0), 0);
    if (rows.some((row) => row.idf !== expected || row.corpus_frequency !== corpus)) fail('internal-invalid', 'idf or corpus frequency drifted');
  }
  if (index.bm25.n_postings !== pairs || index.bm25.n_docs !== summaries.length || index.bm25.n_terms !== byTerm.size) {
    fail('internal-invalid', 'bm25 counts drifted');
  }
  const mean = summaries.reduce((sum, row) => sum + row.document_length, 0) / summaries.length;
  if (index.bm25.average_document_length !== mean) fail('internal-invalid', 'average document length drifted');
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
      process.stderr.write('usage: build-index.ts <prepare-input.json> [--pages-bundle]\n');
      process.exit(2);
    }
    const prepared = prepareIndex(JSON.parse(readFileSync(inputPath, 'utf8')) as PrepareIndexInput);
    const payload = process.argv.includes('--pages-bundle') ? pagesBundleDocument(prepared) : prepared;
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'build-index failed';
    process.stderr.write(`${message}\n`);
    process.exit(1);
  }
}

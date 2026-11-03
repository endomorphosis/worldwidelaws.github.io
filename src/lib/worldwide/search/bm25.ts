/**
 * Bounded BM25 over compact postings.
 *
 * Scoring matches country_laws_ir/bm25.py score_query at the pinned commit:
 * k1 1.2, b 0.75, title weight 5, body weight 1, natural-log idf stored on
 * the posting, and one contribution per query token. A repeated query token
 * is added again. DuckDB bm25_search keeps each distinct term once; this
 * reader follows score_query.
 *
 * Equal scores keep the document that received a contribution first. That is
 * the stable order of score_query. Posting rows for a term are read in
 * posting_chunk_index order, and entries inside a row are read in stored
 * order. The compact builder stores those entries by document index.
 *
 * A term that misses every inclusive route is not searched. query.py falls
 * back to every shard; this reader does not.
 *
 * Memory and traversal budgets stop before the next record or entry. Earlier
 * contributions stay in the order a full scan would have applied them.
 */

import { canonicalJson, sha256HexUtf8, utf8Bytes } from "../data/identity";
import { TOKENIZER_UPSTREAM, tokenize } from "./tokenize";

export const BM25_K1 = 1.2;
export const BM25_B = 0.75;
export const BM25_TITLE_WEIGHT = 5;
export const BM25_BODY_WEIGHT = 1;
export const BM25_MAX_QUERY_TERMS = 64;

export const SEARCH_BUDGET = Object.freeze({
  maxPostingEntries: 50_000,
  maxBytes: 8 * 1024 * 1024,
  maxQueryTerms: BM25_MAX_QUERY_TERMS,
});

export const SEARCH_BUDGET_CEILING = Object.freeze({
  maxPostingEntries: 200_000,
  maxBytes: 32 * 1024 * 1024,
  maxQueryTerms: BM25_MAX_QUERY_TERMS,
});

export const BM25_TOP_K_DEFAULT = 10;
export const BM25_TOP_K_MAX = 100;

export const BM25_UPSTREAM = {
  repository: "/home/barberb/lift_coding/external/ipfs_datasets",
  commit: "2ea4ca6804b3c4cc44e43d0539f4c3fcae011747",
  license: "AGPL-3.0-only",
  files: {
    bm25: {
      path: "ipfs_datasets_py/processors/legal_scrapers/country_laws_ir/bm25.py",
      sha256: "f9393c3f58572e2db13c42d0e258e31384fae32f805539041bd32115c3812610",
    },
    query: {
      path: "ipfs_datasets_py/processors/legal_scrapers/country_laws_ir/query.py",
      sha256: "bca6bb94ff367d2758ce866065b6b9bcf1faa9ffd5102471d2c9cbbacc340eb3",
    },
    tokenize: TOKENIZER_UPSTREAM.files.tokenize,
  },
} as const;

export const BM25_LIMITATIONS = [
  "Scores follow bm25.score_query. Each query token adds its term again, so a repeated token changes the score. DuckDB bm25_search keeps one contribution per distinct term.",
  "Equal scores keep the first document that received a contribution. DuckDB orders those ties by document_index.",
  "A query term outside every inclusive first_key/last_key route is missed. query.py reads every posting shard in that case. This reader does not.",
  "k1, b, title weight, and body weight are the pinned constants. average_document_length comes from the index. Zero or a missing average becomes 1, matching score_query.",
  "The stored idf and document length are used. Term frequency is title_weight times the title count plus body_weight times the body count.",
  "A traversal budget stops before the next posting entry. A memory budget stops before the next posting record. Contributions already applied remain.",
  "Checksums cover a routed shard's record array. A shard without sha256 is rejected when integrity checks are on. Flat postings have no shard checksum.",
  "Query tokens are capped at 64. The cap slices the token list. It is not a cancellation.",
] as const;

export class Bm25SearchError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message.startsWith(`${code}:`) ? message : `${code}: ${message}`);
    this.name = "Bm25SearchError";
    this.code = code;
  }
}

export interface Bm25Parameters {
  k1?: number;
  b?: number;
  title_weight?: number;
  body_weight?: number;
  titleWeight?: number;
  bodyWeight?: number;
  average_document_length?: number;
  averageDocumentLength?: number;
  max_query_terms?: number;
  maxQueryTerms?: number;
}

export interface CompactPostingRecord {
  term: string;
  document_indices: readonly number[];
  title_frequencies: readonly number[];
  body_frequencies: readonly number[];
  document_lengths?: readonly number[];
  lengths?: readonly number[];
  idf: number;
  posting_chunk_index?: number;
}

export interface CompactDocumentSummary {
  document_index: number;
  identity?: string;
  identity_kind?: string;
  title?: string;
  record_type?: string;
  entry_cid?: string;
}

export interface TermRoute {
  first_key: string;
  last_key: string;
  relative_path: string;
  sha256?: string;
}

export interface PostingShard {
  relative_path: string;
  sha256?: string;
  records: readonly CompactPostingRecord[];
}

export interface SearchBudget {
  maxPostingEntries: number;
  maxBytes: number;
  maxQueryTerms: number;
}

export type CancelReason = "none" | "caller" | "traversal-budget" | "memory-budget";

export interface SearchHit {
  documentIndex: number;
  score: number;
  firstSeen: number;
  matchedTerms: readonly string[];
  identity: string | null;
  title: string | null;
  recordType: string | null;
}

export interface SearchDiagnostics {
  cancelled: boolean;
  cancelReason: CancelReason;
  examinedEntries: number;
  examinedBytes: number;
  examinedRecords: number;
  queryTerms: readonly string[];
  missedTerms: readonly string[];
  absentTerms: readonly string[];
  topK: number;
  ranked: number;
  truncated: boolean;
  budgetClamped: boolean;
  blockedRecordBytes: number | null;
}

export interface SearchResult {
  hits: SearchHit[];
  diagnostics: SearchDiagnostics;
}

export interface CompactSearchInput {
  query: string;
  bm25: Bm25Parameters;
  postings?: readonly CompactPostingRecord[];
  shards?: readonly PostingShard[];
  routes?: readonly TermRoute[];
  summaries?: readonly CompactDocumentSummary[];
  topK?: number;
  budget?: Partial<SearchBudget>;
  shouldCancel?: () => boolean;
  yieldEvery?: number;
  yieldNow?: () => void | Promise<void>;
  verifyIntegrity?: boolean;
}

interface NormalizedPosting {
  term: string;
  chunk: number;
  idf: number;
  docs: number[];
  title: number[];
  body: number[];
  lengths: number[];
  bytes: number;
}

interface PinnedWeights {
  k1: number;
  b: number;
  titleWeight: number;
  bodyWeight: number;
  avgdl: number;
  maxQueryTerms: number;
}

interface ScoredDoc {
  score: number;
  firstSeen: number;
  terms: string[];
}

const verifiedShards = new WeakMap<readonly CompactPostingRecord[], string>();

function fail(code: string, message: string): never {
  throw new Bm25SearchError(code, message);
}

function near(value: number, expected: number): boolean {
  return Number.isFinite(value) && Math.abs(value - expected) < 1e-9;
}

function pinnedNumber(value: number | undefined, expected: number, label: string): number {
  if (value === undefined) return expected;
  if (!near(value, expected)) fail("bm25-constants-mismatch", `${label} must be ${expected}`);
  return expected;
}

function resolveWeights(params: Bm25Parameters | undefined): PinnedWeights {
  if (!params || typeof params !== "object") fail("invalid-bm25", "bm25 parameters are required");
  const average = params.average_document_length ?? params.averageDocumentLength;
  const avgdl = typeof average === "number" && Number.isFinite(average) && average > 0 ? average : 1;
  const declaredCap = params.max_query_terms ?? params.maxQueryTerms;
  let maxQueryTerms = BM25_MAX_QUERY_TERMS;
  if (declaredCap !== undefined) {
    if (!Number.isInteger(declaredCap) || declaredCap < 1 || declaredCap > BM25_MAX_QUERY_TERMS) {
      fail("bm25-constants-mismatch", "max_query_terms must be an integer from 1 to 64");
    }
    maxQueryTerms = declaredCap;
  }
  return {
    k1: pinnedNumber(params.k1, BM25_K1, "k1"),
    b: pinnedNumber(params.b, BM25_B, "b"),
    titleWeight: pinnedNumber(params.title_weight ?? params.titleWeight, BM25_TITLE_WEIGHT, "title_weight"),
    bodyWeight: pinnedNumber(params.body_weight ?? params.bodyWeight, BM25_BODY_WEIGHT, "body_weight"),
    avgdl,
    maxQueryTerms,
  };
}

function resolveBudget(input: Partial<SearchBudget> | undefined, weightCap: number): { budget: SearchBudget; clamped: boolean } {
  const requestedEntries = input?.maxPostingEntries ?? SEARCH_BUDGET.maxPostingEntries;
  const requestedBytes = input?.maxBytes ?? SEARCH_BUDGET.maxBytes;
  const requestedTerms = input?.maxQueryTerms ?? weightCap;
  if (!Number.isInteger(requestedEntries) || requestedEntries < 0) {
    fail("invalid-budget", "maxPostingEntries must be a non-negative integer");
  }
  if (!Number.isInteger(requestedBytes) || requestedBytes < 0) {
    fail("invalid-budget", "maxBytes must be a non-negative integer");
  }
  if (!Number.isInteger(requestedTerms) || requestedTerms < 1 || requestedTerms > BM25_MAX_QUERY_TERMS) {
    fail("invalid-budget", "maxQueryTerms must be an integer from 1 to 64");
  }
  let clamped = false;
  let maxPostingEntries = requestedEntries;
  let maxBytes = requestedBytes;
  if (maxPostingEntries > SEARCH_BUDGET_CEILING.maxPostingEntries) {
    maxPostingEntries = SEARCH_BUDGET_CEILING.maxPostingEntries;
    clamped = true;
  }
  if (maxBytes > SEARCH_BUDGET_CEILING.maxBytes) {
    maxBytes = SEARCH_BUDGET_CEILING.maxBytes;
    clamped = true;
  }
  return {
    budget: {
      maxPostingEntries,
      maxBytes,
      maxQueryTerms: Math.min(requestedTerms, weightCap),
    },
    clamped,
  };
}

function resolveTopK(value: number | undefined): number {
  const topK = value ?? BM25_TOP_K_DEFAULT;
  if (!Number.isInteger(topK) || topK < 1 || topK > BM25_TOP_K_MAX) {
    fail("invalid-topk", `topK must be an integer from 1 to ${BM25_TOP_K_MAX}`);
  }
  return topK;
}

function numberArray(value: readonly number[] | undefined, label: string): number[] {
  if (!Array.isArray(value)) fail("invalid-posting", `${label} must be an array`);
  if (value.length > SEARCH_BUDGET_CEILING.maxPostingEntries) {
    fail("invalid-posting", `${label} exceeds the traversal ceiling`);
  }
  return value.map((item, index) => {
    if (typeof item !== "number" || !Number.isFinite(item)) {
      fail("invalid-posting", `${label}[${index}] must be a finite number`);
    }
    return item;
  });
}

function normalizePosting(record: CompactPostingRecord): NormalizedPosting {
  if (!record || typeof record !== "object" || typeof record.term !== "string" || record.term.length === 0) {
    fail("invalid-posting", "a posting needs a term");
  }
  const chunk = record.posting_chunk_index ?? 0;
  if (!Number.isInteger(chunk) || chunk < 0) fail("invalid-posting", "posting_chunk_index must be a non-negative integer");
  if (typeof record.idf !== "number" || !Number.isFinite(record.idf)) fail("invalid-posting", "idf must be a finite number");
  const docs = numberArray(record.document_indices, "document_indices");
  const title = numberArray(record.title_frequencies, "title_frequencies");
  const body = numberArray(record.body_frequencies, "body_frequencies");
  const lengths = numberArray(record.document_lengths ?? record.lengths, record.document_lengths ? "document_lengths" : "lengths");
  if (docs.length !== title.length || docs.length !== body.length || docs.length !== lengths.length) {
    fail("invalid-posting", "posting arrays have different lengths");
  }
  docs.forEach((doc, index) => {
    if (!Number.isInteger(doc) || doc < 0) fail("invalid-posting", `document_indices[${index}] must be a non-negative integer`);
    if (title[index] < 0 || body[index] < 0 || lengths[index] < 0) {
      fail("invalid-posting", "frequencies and lengths must be non-negative");
    }
  });
  let bytes = 0;
  try {
    bytes = utf8Bytes(canonicalJson(record)).length;
  } catch {
    fail("invalid-posting", "posting record is not canonical JSON");
  }
  return { term: record.term, chunk, idf: record.idf, docs, title, body, lengths, bytes };
}

export function measurePostingBytes(record: CompactPostingRecord): number {
  return normalizePosting(record).bytes;
}

function summaryMap(summaries: readonly CompactDocumentSummary[] | undefined): Map<number, CompactDocumentSummary> {
  const map = new Map<number, CompactDocumentSummary>();
  for (const summary of summaries ?? []) {
    if (!summary || typeof summary.document_index !== "number" || !Number.isInteger(summary.document_index) || summary.document_index < 0) {
      fail("invalid-summary", "document_index must be a non-negative integer");
    }
    if (map.has(summary.document_index)) fail("duplicate-summary", `document ${summary.document_index} is repeated`);
    map.set(summary.document_index, summary);
  }
  return map;
}

function pushUnique(list: string[], term: string) {
  if (!list.includes(term)) list.push(term);
}

function routeFor(term: string, routes: readonly TermRoute[]): TermRoute | null {
  const hits = routes.filter((route) => route.first_key <= term && term <= route.last_key);
  if (hits.length > 1) fail("term-routing-ambiguous", `term ${term} matched ${hits.length} shards`);
  return hits[0] ?? null;
}

function ensureChecksum(shard: PostingShard, verifyIntegrity: boolean) {
  if (!verifyIntegrity) return;
  const previous = verifiedShards.get(shard.records);
  if (previous !== undefined && previous === shard.sha256) return;
  if (typeof shard.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(shard.sha256)) {
    fail("checksum-mismatch", `shard ${shard.relative_path} is missing sha256`);
  }
  let digest = "";
  try {
    digest = sha256HexUtf8(canonicalJson(shard.records));
  } catch {
    fail("checksum-mismatch", `shard ${shard.relative_path} records are not canonical JSON`);
  }
  if (digest !== shard.sha256) fail("checksum-mismatch", `shard ${shard.relative_path} checksum does not match`);
  verifiedShards.set(shard.records, shard.sha256);
}

function shardMap(shards: readonly PostingShard[]): Map<string, PostingShard> {
  const map = new Map<string, PostingShard>();
  for (const shard of shards) {
    if (!shard || typeof shard.relative_path !== "string" || shard.relative_path.length === 0) {
      fail("invalid-posting", "a shard needs a relative path");
    }
    if (!Array.isArray(shard.records)) fail("invalid-posting", "shard records must be an array");
    if (map.has(shard.relative_path)) fail("duplicate-shard", `shard ${shard.relative_path} is repeated`);
    map.set(shard.relative_path, shard);
  }
  return map;
}

function rowsForTerm(records: readonly CompactPostingRecord[]): Array<{ record: CompactPostingRecord; index: number }> {
  const rows = records.map((record, index) => ({ record, index }));
  rows.sort((left, right) => {
    const chunk = (left.record?.posting_chunk_index ?? 0) - (right.record?.posting_chunk_index ?? 0);
    return chunk || left.index - right.index;
  });
  return rows;
}

function contribution(weights: PinnedWeights, idf: number, titleFreq: number, bodyFreq: number, length: number): number {
  const tf = weights.titleWeight * titleFreq + weights.bodyWeight * bodyFreq;
  const denom = tf + weights.k1 * (1 - weights.b + weights.b * (length / weights.avgdl));
  if (denom === 0) return 0;
  return idf * (tf * (weights.k1 + 1)) / denom;
}

export async function searchCompactPostings(input: CompactSearchInput): Promise<SearchResult> {
  if (!input || typeof input.query !== "string") fail("invalid-query", "query must be a string");
  const weights = resolveWeights(input.bm25);
  const { budget, clamped } = resolveBudget(input.budget, weights.maxQueryTerms);
  const topK = resolveTopK(input.topK);
  if (input.yieldEvery !== undefined && (!Number.isInteger(input.yieldEvery) || input.yieldEvery < 1)) {
    fail("invalid-budget", "yieldEvery must be a positive integer");
  }
  if (input.yieldEvery !== undefined && !input.yieldNow) fail("invalid-budget", "yieldEvery needs yieldNow");
  const summaries = summaryMap(input.summaries);
  const queryTerms = tokenize(input.query).slice(0, budget.maxQueryTerms);
  const missedTerms: string[] = [];
  const absentTerms: string[] = [];
  const scores = new Map<number, ScoredDoc>();
  const opened = new Set<string>();
  let seenOrder = 0;
  let examinedEntries = 0;
  let examinedBytes = 0;
  let examinedRecords = 0;
  let cancelReason: CancelReason = "none";
  let blockedRecordBytes: number | null = null;

  const routed = input.shards !== undefined;
  if (!routed && input.routes) fail("invalid-request", "routes require shards");
  if (!routed && !input.postings) fail("invalid-request", "pass postings or shards");
  const shards = routed ? shardMap(input.shards ?? []) : null;
  const routes = input.routes ?? [];
  const flatRows = routed ? null : rowsForTerm((input.postings ?? []).filter((record) => typeof record?.term === "string"));
  const verifyIntegrity = input.verifyIntegrity !== false;

  const finish = (): SearchResult => {
    const ranked = [...scores.entries()].map(([documentIndex, row]) => {
      const summary = summaries.get(documentIndex);
      const identity = summary?.identity || summary?.entry_cid || null;
      return {
        documentIndex,
        score: row.score,
        firstSeen: row.firstSeen,
        matchedTerms: [...row.terms],
        identity: identity ? String(identity) : null,
        title: summary?.title ? String(summary.title) : null,
        recordType: summary?.record_type ? String(summary.record_type) : null,
      };
    });
    ranked.sort((left, right) => {
      if (left.score < right.score) return 1;
      if (left.score > right.score) return -1;
      return left.firstSeen - right.firstSeen;
    });
    return {
      hits: ranked.slice(0, topK),
      diagnostics: {
        cancelled: cancelReason !== "none",
        cancelReason,
        examinedEntries,
        examinedBytes,
        examinedRecords,
        queryTerms,
        missedTerms,
        absentTerms,
        topK,
        ranked: ranked.length,
        truncated: ranked.length > topK,
        budgetClamped: clamped,
        blockedRecordBytes,
      },
    };
  };

  const addScore = (doc: number, value: number, term: string) => {
    let row = scores.get(doc);
    if (!row) {
      row = { score: 0, firstSeen: seenOrder, terms: [] };
      seenOrder += 1;
      scores.set(doc, row);
    }
    row.score += value;
    pushUnique(row.terms, term);
  };

  for (const term of queryTerms) {
    if (input.shouldCancel?.()) {
      cancelReason = "caller";
      return finish();
    }
    let source: readonly CompactPostingRecord[];
    let shardPath: string;
    if (routed) {
      const route = routeFor(term, routes);
      if (!route) {
        pushUnique(missedTerms, term);
        continue;
      }
      const shard = shards?.get(route.relative_path);
      if (!shard) fail("missing-shard", `term ${term} routed to ${route.relative_path}, which was not loaded`);
      ensureChecksum(shard, verifyIntegrity);
      source = shard.records.filter((record) => record?.term === term);
      shardPath = shard.relative_path;
    } else {
      source = (flatRows ?? []).filter((row) => row.record.term === term).map((row) => row.record);
      shardPath = "";
    }
    const ordered = rowsForTerm(source);
    if (!ordered.length) {
      pushUnique(absentTerms, term);
      continue;
    }
    for (const row of ordered) {
      if (input.shouldCancel?.()) {
        cancelReason = "caller";
        return finish();
      }
      const normalized = normalizePosting(row.record);
      const openKey = `${shardPath}\u0000${normalized.term}\u0000${normalized.chunk}\u0000${row.index}`;
      if (!opened.has(openKey)) {
        if (examinedBytes + normalized.bytes > budget.maxBytes) {
          cancelReason = "memory-budget";
          blockedRecordBytes = normalized.bytes;
          return finish();
        }
        opened.add(openKey);
        examinedBytes += normalized.bytes;
        examinedRecords += 1;
      }
      for (let index = 0; index < normalized.docs.length; index += 1) {
        if (input.shouldCancel?.()) {
          cancelReason = "caller";
          return finish();
        }
        if (examinedEntries + 1 > budget.maxPostingEntries) {
          cancelReason = "traversal-budget";
          return finish();
        }
        addScore(
          normalized.docs[index],
          contribution(weights, normalized.idf, normalized.title[index], normalized.body[index], normalized.lengths[index]),
          normalized.term,
        );
        examinedEntries += 1;
        if (input.yieldEvery && examinedEntries % input.yieldEvery === 0) {
          await input.yieldNow?.();
        }
      }
    }
  }
  return finish();
}

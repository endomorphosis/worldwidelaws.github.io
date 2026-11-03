/**
 * Optional semantic reranking for worldwide legal search.
 *
 * Lexical order is the result unless a pinned multilingual embedding model
 * has a measured cross-lingual gain, the visitor allows the download, and
 * WebGPU can run that model. Importing this module does not construct a
 * worker, fetch weights, or encode text. There is no warmup call.
 *
 * The English baseline is thenlper/gte-small at the country_laws_ir pin.
 * It is not an optional download. The only download this module can plan
 * is the int8 ONNX pack of Xenova/multilingual-e5-small, and only after
 * that model beats both lexical overlap and the English baseline on the
 * Dutch, Arabic, and Japanese witness slice.
 *
 * A relationship score is a retrieval score. It is not a claim that a law
 * applies.
 */

import { tokenize } from "../search/tokenize";

export const SEMANTIC_SCHEMA = "worldwide-research-semantic/v1";
export const SEMANTIC_APPLICABILITY = "not-asserted" as const;
export const SEMANTIC_CONSENT_DECISION = "allow-optional-semantic-download" as const;

export const SEMANTIC_QUERY_PREFIX = "query: ";
export const SEMANTIC_PASSAGE_PREFIX = "passage: ";

const DIMENSION = 384;
const MAX_SEQ_LENGTH = 512;
const MAX_CANDIDATES = 32;
const MAX_CANDIDATES_CEILING = 100;
const MAX_QUERY_CHARS = 2048;
const MAX_PASSAGE_CHARS = 4000;
const RECALL_K = 5;
const RECALL_K_CEILING = 20;
const RUNTIME_RESERVE_BYTES = 32 * 1024 * 1024;

export const ENGLISH_EMBEDDING = Object.freeze({
  id: "thenlper/gte-small",
  revision: "17e1f347d17fe144873b1201da91788898c639cd",
  dimension: DIMENSION,
  browserId: "Xenova/gte-small",
  role: "pinned-english-baseline",
  download: "not-offered",
});

const MULTILINGUAL_FILES = [
  {
    path: "config.json",
    bytes: 658,
    sha256: "cb99455288675345e1a4f411438d5d0adbba5fbd3a67ea4fb03c015433b996c1",
  },
  {
    path: "tokenizer.json",
    bytes: 17082730,
    sha256: "0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39",
  },
  {
    path: "tokenizer_config.json",
    bytes: 443,
    sha256: "a1d6bc8734a6f635dc158508bef000f8e2e5a759c7d92f984b2c86e5ff53425b",
  },
  {
    path: "special_tokens_map.json",
    bytes: 167,
    sha256: "d05497f1da52c5e09554c0cd874037a083e1dc1b9cfd48034d1c717f1afc07a7",
  },
  {
    path: "onnx/model_int8.onnx",
    bytes: 118054593,
    sha256: "4d24e2bc01a447951524466ef533e52944bf48509e6552810bcee1a2711cb02c",
  },
] as const;

const MULTILINGUAL_DOWNLOAD_BYTES = MULTILINGUAL_FILES.reduce((sum, file) => sum + file.bytes, 0);

export const MULTILINGUAL_EMBEDDING = Object.freeze({
  id: "intfloat/multilingual-e5-small",
  revision: "614241f622f53c4eeff9890bdc4f31cfecc418b3",
  browserId: "Xenova/multilingual-e5-small",
  browserRevision: "761b726dd34fb83930e26aab4e9ac3899aa1fa78",
  dimension: DIMENSION,
  maxSeqLength: MAX_SEQ_LENGTH,
  hiddenSize: DIMENSION,
  queryPrefix: SEMANTIC_QUERY_PREFIX,
  passagePrefix: SEMANTIC_PASSAGE_PREFIX,
  dtype: "int8",
  pooling: "mean",
  normalize: true,
  license: "mit",
  files: MULTILINGUAL_FILES,
  downloadBytes: MULTILINGUAL_DOWNLOAD_BYTES,
});

export const REQUIRED_CROSS_LINGUAL_LANGUAGES = Object.freeze(["nl", "ar", "ja"]);

export const SEMANTIC_BUDGET = Object.freeze({
  maxCandidates: MAX_CANDIDATES,
  maxQueryChars: MAX_QUERY_CHARS,
  maxPassageChars: MAX_PASSAGE_CHARS,
  maxSeqLength: MAX_SEQ_LENGTH,
  dimension: DIMENSION,
  k: RECALL_K,
  minCrossLingualJudgments: REQUIRED_CROSS_LINGUAL_LANGUAGES.length,
  maxModelBytes: MULTILINGUAL_DOWNLOAD_BYTES,
  maxEmbeddingBytes: (MAX_CANDIDATES + 1) * DIMENSION * 4,
  requiredHeapBytes: MULTILINGUAL_DOWNLOAD_BYTES + RUNTIME_RESERVE_BYTES,
  runtimeReserveBytes: RUNTIME_RESERVE_BYTES,
});

export const SEMANTIC_BUDGET_CEILING = Object.freeze({
  maxCandidates: MAX_CANDIDATES_CEILING,
  maxQueryChars: MAX_QUERY_CHARS,
  maxPassageChars: MAX_PASSAGE_CHARS,
  maxSeqLength: MAX_SEQ_LENGTH,
  dimension: DIMENSION,
  k: RECALL_K_CEILING,
  maxModelBytes: MULTILINGUAL_DOWNLOAD_BYTES,
  maxEmbeddingBytes: (MAX_CANDIDATES_CEILING + 1) * DIMENSION * 4,
  requiredHeapBytes: MULTILINGUAL_DOWNLOAD_BYTES + RUNTIME_RESERVE_BYTES,
});

export const SEMANTIC_UPSTREAM = Object.freeze({
  repository: "/home/barberb/lift_coding/external/ipfs_datasets",
  commit: "2ea4ca6804b3c4cc44e43d0539f4c3fcae011747",
  license: "AGPL-3.0-only",
  files: {
    vectors: {
      path: "ipfs_datasets_py/processors/legal_scrapers/country_laws_ir/vectors.py",
      sha256: "b8ab17f184850997f841ebb0b5bea9230b3a0c81e69410ad05dccdec43049bc9",
    },
  },
});

export const SEMANTIC_LIMITATIONS = [
  "Lexical order is unchanged when WebGPU is absent, when the pinned model is not resident and complete pinned embeddings were not supplied, or when a download would need a network that is absent.",
  "The only download plan is the int8 ONNX pack of Xenova/multilingual-e5-small at browser revision 761b726dd34fb83930e26aab4e9ac3899aa1fa78. fp16, fp32, q4, and bnb4 files are outside the byte budget and are refused.",
  "Optional download stays disabled until a measurement for intfloat/multilingual-e5-small at revision 614241f622f53c4eeff9890bdc4f31cfecc418b3 puts a relevant nl, ar, and ja passage first. Lexical overlap must not already rank that passage first, and thenlper/gte-small must not either. Recall at k is reported as well. Same-language Dutch best rank must not get worse.",
  "This module does not run the model. A measurement embeds nothing. The caller supplies finite 384-d vectors. A missing vector keeps the download disabled. Those vectors are not invented by this file.",
  "Token overlap is not BM25. A candidate with no shared language-aware token is a miss, not a zero-score tie for first place. The tokenizer is tokenize() with the passage and query languages.",
  "Importing this module does not construct a worker, read navigator.gpu, call fetch, or encode text. There is no warmup function. Download consent does not encode. A resident model is encoded only when rerank is asked for and WebGPU is true.",
  "Consent is the exact decision allow-optional-semantic-download. A boolean, or any other string, is not consent.",
  "Character budgets are not the model tokenizer. The tokenizer pack is downloaded only after consent. Query text over 2048 code points is not sent to the embedder. Passage text is clipped to 4000 code points for the embedder and the hit itself is kept.",
  "Rerank never drops, adds, or merges lexical hits. Only the first candidate window may move, and only when every window vector is accepted. A bad vector, a thrown embedder, or a budget over the ceiling returns the lexical order.",
  "Scores are retrieval scores. applicability stays not-asserted. Wording in a query or a passage does not change that.",
  "The legacy WetWijzer research screen is outside this module. Worldwide search does not import it and does not start its model effect.",
  "Heap must be reported as at least the int8 pack plus 32 MiB before a download is planned. An omitted heap is not treated as enough memory.",
] as const;

const PROMOTES = /\b(applies|applicable|applicability|governs|governing)\b/i;

export class SemanticError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = "SemanticError";
    this.code = code;
  }
}

export interface SemanticCapabilities {
  webgpu?: unknown;
  network?: unknown;
  heapBytes?: unknown;
}

export interface SemanticVectorModel {
  id?: unknown;
  revision?: unknown;
  dimension?: unknown;
}

export interface MeasurementCandidate {
  id?: unknown;
  text?: unknown;
  language?: unknown;
  multilingualEmbedding?: unknown;
  englishEmbedding?: unknown;
}

export interface MeasurementJudgment {
  id?: unknown;
  query?: unknown;
  queryLanguage?: unknown;
  relevantIds?: unknown;
  candidates?: unknown;
  crossLingual?: unknown;
  multilingualQuery?: unknown;
  englishQuery?: unknown;
}

export interface MeasurementInput {
  judgments?: unknown;
  multilingualModel?: unknown;
  englishModel?: unknown;
  k?: unknown;
}

export interface JudgmentScore {
  id: string;
  slice: "cross-lingual" | "same-language";
  queryLanguage: string;
  relevantLanguages: string[];
  lexicalFound: number;
  relevant: number;
  multilingualFound: number | null;
  englishFound: number | null;
  lexicalBestRank: number | null;
  multilingualBestRank: number | null;
  englishBestRank: number | null;
  improvedOverLexical: boolean;
  improvedOverEnglish: boolean;
}

export interface RecallSlice {
  judgments: number;
  languages: string[];
  lexicalFound: number;
  lexicalRelevant: number;
  multilingualFound: number;
  multilingualRelevant: number;
  englishFound: number;
  englishRelevant: number;
  improvedOverLexical: number;
  improvedOverEnglish: number;
  semanticComplete: boolean;
}

export interface MeasurementReport {
  schema: typeof SEMANTIC_SCHEMA;
  applicability: typeof SEMANTIC_APPLICABILITY;
  status: "measured" | "incomplete" | "rejected-pin" | "invalid";
  downloadsEnabled: false | true;
  reasons: string[];
  automaticWarmup: false;
  model: { id: string; revision: string; dimension: number } | null;
  englishModel: { id: string; revision: string; dimension: number } | null;
  k: number;
  crossLingual: RecallSlice;
  sameLanguage: RecallSlice;
  judgments: JudgmentScore[];
}

export interface LexicalHit {
  id?: unknown;
  text?: unknown;
  language?: unknown;
  lexicalScore?: unknown;
  embedding?: unknown;
}

export interface SemanticHit {
  id: string;
  lexicalRank: number;
  lexicalScore: number | null;
  semanticScore: number | null;
  rank: number;
  language: string | null;
  applicability: typeof SEMANTIC_APPLICABILITY;
  passageTruncated: boolean;
}

export interface SemanticRerankResult {
  schema: typeof SEMANTIC_SCHEMA;
  applicability: typeof SEMANTIC_APPLICABILITY;
  mode: "lexical" | "semantic";
  reason: string;
  reasons: string[];
  orderChanged: boolean;
  hits: SemanticHit[];
  model: { id: string; revision: string; dimension: number } | null;
  warmupCalls: 0;
  embedCalls: number;
  downloadCalls: number;
  promotesApplicability: false;
}

export interface DownloadFilePin {
  path: string;
  bytes: number;
  sha256: string;
}

export interface DownloadPlan {
  allowed: boolean;
  reasons: string[];
  request: {
    repository: string;
    revision: string;
    baseModel: string;
    baseRevision: string;
    dtype: "int8";
    files: DownloadFilePin[];
    maxBytes: number;
  } | null;
}

export interface DownloadReceipt {
  repository: string;
  revision: string;
  bytes: number;
  files: DownloadFilePin[];
  warmup: false;
}

export interface SemanticSession {
  schema: typeof SEMANTIC_SCHEMA;
  measurement: MeasurementReport | null;
  consent: { decision: typeof SEMANTIC_CONSENT_DECISION; at: string } | null;
  modelState: "absent" | "downloaded" | "resident";
  downloadReceipt: DownloadReceipt | null;
  downloadCalls: number;
  embedCalls: number;
  warmupCalls: 0;
}

export interface EmbedRequest {
  text: string;
  role: "query" | "passage";
  modelId: string;
  revision: string;
}

export type SemanticEmbedder = (input: EmbedRequest) => readonly number[] | Promise<readonly number[]>;

export interface DownloadTransportFile {
  bytes?: unknown;
  sha256?: unknown;
}

export type SemanticDownloadTransport = (request: NonNullable<DownloadPlan["request"]>) =>
  | Promise<{ files?: unknown }>
  | { files?: unknown };

export interface RerankInput {
  query?: unknown;
  queryLanguage?: unknown;
  hits?: unknown;
  capabilities?: SemanticCapabilities | null;
  embeddingModel?: unknown;
  queryEmbedding?: unknown;
  embedder?: SemanticEmbedder | null;
  maxCandidates?: unknown;
}

interface PreparedHit {
  id: string;
  text: string;
  language: string | null;
  lexicalScore: number | null;
  lexicalRank: number;
  embedding: number[] | null;
}

interface ModelPin {
  id: string;
  revision: string;
  dimension: number;
}

const EMPTY_SLICE: RecallSlice = {
  judgments: 0,
  languages: [],
  lexicalFound: 0,
  lexicalRelevant: 0,
  multilingualFound: 0,
  multilingualRelevant: 0,
  englishFound: 0,
  englishRelevant: 0,
  improvedOverLexical: 0,
  improvedOverEnglish: 0,
  semanticComplete: false,
};

/**
 * Labelled witness texts. Embeddings are not included. Cross-lingual
 * queries are English and share no tokens with the cited passage. The
 * same-language query is Dutch and names the cited article.
 */
export const SEMANTIC_WITNESS = Object.freeze({
  passages: Object.freeze([
    Object.freeze({
      id: "nl:bwbr0001854:1",
      language: "nl",
      text: "Geen feit is strafbaar dan uit kracht van een daaraan voorafgegane wettelijke strafbepaling.",
      sourceUrl: "https://wetten.overheid.nl/BWBR0001854/2026-07-01",
    }),
    Object.freeze({
      id: "bh:constitution:1",
      language: "ar",
      text: "مملكة البحرين عربية إسلامية مستقلة ذات سيادة تامة",
      sourceUrl: "https://www.lloc.gov.bh/page/%D8%AF%D8%B3%D8%AA%D9%88%D8%B1%20%D9%85%D9%85%D9%84%D9%83%D8%A9%20%D8%A7%D9%84%D8%A8%D8%AD%D8%B1%D9%8A%D9%86",
    }),
    Object.freeze({
      id: "jp:civil-code:1",
      language: "ja",
      text: "私権は、公共の福祉に適合しなければならない",
      sourceUrl: "https://laws.e-gov.go.jp/api/1/lawdata/129AC0000000089",
    }),
    Object.freeze({
      id: "nl:traffic:speed",
      language: "nl",
      text: "De maximumsnelheid binnen de bebouwde kom bedraagt vijftig kilometer per uur.",
      sourceUrl: null,
    }),
    Object.freeze({
      id: "en:traffic:speed",
      language: "en",
      text: "The speed limit inside town is fifty kilometres per hour.",
      sourceUrl: null,
    }),
  ]),
  judgments: Object.freeze([
    Object.freeze({
      id: "cross-nl-prior-statute",
      crossLingual: true,
      queryLanguage: "en",
      query: "punishable conduct requires an earlier criminal statute",
      relevantIds: Object.freeze(["nl:bwbr0001854:1"]),
    }),
    Object.freeze({
      id: "cross-ar-sovereign-kingdom",
      crossLingual: true,
      queryLanguage: "en",
      query: "sovereign independent arab islamic kingdom",
      relevantIds: Object.freeze(["bh:constitution:1"]),
    }),
    Object.freeze({
      id: "cross-ja-private-rights",
      crossLingual: true,
      queryLanguage: "en",
      query: "private rights must conform to public welfare",
      relevantIds: Object.freeze(["jp:civil-code:1"]),
    }),
    Object.freeze({
      id: "same-nl-strafbepaling",
      crossLingual: false,
      queryLanguage: "nl",
      query: "voorafgegane wettelijke strafbepaling",
      relevantIds: Object.freeze(["nl:bwbr0001854:1"]),
    }),
  ]),
});

export function createSemanticSession(): SemanticSession {
  return {
    schema: SEMANTIC_SCHEMA,
    measurement: null,
    consent: null,
    modelState: "absent",
    downloadReceipt: null,
    downloadCalls: 0,
    embedCalls: 0,
    warmupCalls: 0,
  };
}

export function wordingPromotesApplicability(text: string): boolean {
  return PROMOTES.test(text);
}

export function measureMultilingualBenefit(input: MeasurementInput): MeasurementReport {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new SemanticError("invalid-measurement", "Measurement input must be an object.");
  }
  const rawJudgments = input.judgments;
  if (!Array.isArray(rawJudgments)) {
    throw new SemanticError("invalid-measurement", "Judgments must be an array.");
  }
  const k = resolveK(input.k);
  const reasons: string[] = [];
  const multilingualPin = readModelPin(input.multilingualModel);
  const englishPin = readModelPin(input.englishModel);
  if (!k) {
    reasons.push("recall-k-refused");
  }
  if (!multilingualPin || !samePin(multilingualPin, pinnedMultilingualModel())) {
    reasons.push("multilingual-pin-mismatch");
  }
  if (!englishPin || !samePin(englishPin, pinnedEnglishModel())) {
    reasons.push("english-pin-mismatch");
  }

  const scores: JudgmentScore[] = [];
  let invalid = false;
  rawJudgments.forEach((entry, index) => {
    const scored = scoreJudgment(entry, index, k ?? RECALL_K);
    if (!scored) {
      invalid = true;
      reasons.push(`judgment-${index + 1}-invalid`);
      return;
    }
    scores.push(scored);
  });

  const cross = scores.filter((row) => row.slice === "cross-lingual");
  const same = scores.filter((row) => row.slice === "same-language");
  const crossLingual = summarize(cross);
  const sameLanguage = summarize(same);
  const languages = new Set(cross.flatMap((row) => row.relevantLanguages));
  const missingLanguage = REQUIRED_CROSS_LINGUAL_LANGUAGES.filter((language) => !languages.has(language));
  if (cross.length < REQUIRED_CROSS_LINGUAL_LANGUAGES.length || missingLanguage.length > 0) {
    reasons.push("cross-lingual-witness-incomplete");
  }
  const dutchSame = same.some((row) => row.queryLanguage === "nl" && row.relevantLanguages.every((language) => language === "nl"));
  if (!dutchSame) {
    reasons.push("same-language-dutch-missing");
  }
  if (!crossLingual.semanticComplete || !sameLanguage.semanticComplete) {
    reasons.push("embeddings-not-measured");
  }

  const gainOverLexical = crossLingual.semanticComplete && cross.length > 0 && cross.every((row) => row.improvedOverLexical);
  const gainOverEnglish = crossLingual.semanticComplete && cross.length > 0 && cross.every((row) => row.improvedOverEnglish);
  const dutchHolds = sameLanguage.semanticComplete && dutchSame && same.every((row) => (
    row.queryLanguage !== "nl"
    || (row.multilingualBestRank !== null && row.lexicalBestRank !== null && row.multilingualBestRank <= row.lexicalBestRank)
  ));
  if (crossLingual.semanticComplete && !gainOverLexical) reasons.push("no-gain-over-lexical");
  if (crossLingual.semanticComplete && !gainOverEnglish) reasons.push("no-gain-over-english");
  if (sameLanguage.semanticComplete && dutchSame && !dutchHolds) {
    reasons.push("same-language-regression");
  }

  const pinRejected = reasons.includes("multilingual-pin-mismatch") || reasons.includes("english-pin-mismatch") || reasons.includes("recall-k-refused");
  const downloadsEnabled = !pinRejected
    && !invalid
    && rawJudgments.length > 0
    && missingLanguage.length === 0
    && gainOverLexical
    && gainOverEnglish
    && dutchHolds
    && reasons.length === 0;

  let status: MeasurementReport["status"] = "measured";
  if (pinRejected) status = "rejected-pin";
  else if (invalid || rawJudgments.length === 0) status = "invalid";
  else if (!downloadsEnabled) status = "incomplete";

  return {
    schema: SEMANTIC_SCHEMA,
    applicability: SEMANTIC_APPLICABILITY,
    status,
    downloadsEnabled,
    reasons,
    automaticWarmup: false,
    model: multilingualPin,
    englishModel: englishPin,
    k: k ?? RECALL_K,
    crossLingual,
    sameLanguage,
    judgments: scores,
  };
}

export function recordMeasurement(session: SemanticSession, report: MeasurementReport): void {
  assertSession(session);
  if (!report || report.schema !== SEMANTIC_SCHEMA || report.applicability !== SEMANTIC_APPLICABILITY || report.automaticWarmup !== false) {
    throw new SemanticError("invalid-measurement", "The measurement report is not from measureMultilingualBenefit.");
  }
  session.measurement = report;
}

export function grantDownloadConsent(session: SemanticSession, decision: unknown, at: unknown): boolean {
  assertSession(session);
  if (decision !== SEMANTIC_CONSENT_DECISION || !nonEmpty(at)) {
    session.consent = null;
    return false;
  }
  session.consent = { decision: SEMANTIC_CONSENT_DECISION, at };
  return true;
}

export function revokeDownloadConsent(session: SemanticSession): void {
  assertSession(session);
  session.consent = null;
}

export function planModelDownload(session: SemanticSession, capabilities: SemanticCapabilities | null | undefined): DownloadPlan {
  assertSession(session);
  const reasons: string[] = [];
  if (!session.measurement || session.measurement.downloadsEnabled !== true) reasons.push("measurement-required");
  if (!session.consent || session.consent.decision !== SEMANTIC_CONSENT_DECISION) reasons.push("consent-required");
  if (!capabilities || capabilities.webgpu !== true) reasons.push("webgpu-required");
  if (!capabilities || capabilities.network !== true) reasons.push("network-required");
  if (!capabilities || !heapFits(capabilities.heapBytes)) reasons.push("heap-required");
  if (session.modelState === "resident") reasons.push("already-resident");
  if (session.modelState === "downloaded" && session.downloadReceipt) reasons.push("already-downloaded");
  const allowed = reasons.length === 0;
  return {
    allowed,
    reasons,
    request: allowed ? downloadRequest() : null,
  };
}

export async function requestModelDownload(
  session: SemanticSession,
  capabilities: SemanticCapabilities | null | undefined,
  transport: SemanticDownloadTransport,
): Promise<{ plan: DownloadPlan; receipt: DownloadReceipt | null; reason: string }> {
  assertSession(session);
  const plan = planModelDownload(session, capabilities);
  if (plan.reasons.includes("already-downloaded") && session.downloadReceipt && !plan.reasons.some((reason) => reason !== "already-downloaded")) {
    return { plan, receipt: session.downloadReceipt, reason: "already-downloaded" };
  }
  if (!plan.allowed || !plan.request) {
    return { plan, receipt: null, reason: plan.reasons[0] ?? "download-refused" };
  }
  session.downloadCalls += 1;
  let payload: { files?: unknown };
  try {
    payload = await transport(plan.request);
  } catch {
    return { plan, receipt: null, reason: "transport-failed" };
  }
  const receipt = verifyDownload(plan.request, payload);
  if (!receipt) {
    return { plan, receipt: null, reason: "receipt-rejected" };
  }
  session.modelState = "downloaded";
  session.downloadReceipt = receipt;
  return { plan, receipt, reason: "downloaded" };
}

export function markModelResident(session: SemanticSession, attestation: unknown): { resident: boolean; reason: string } {
  assertSession(session);
  if (session.modelState !== "downloaded" || !session.downloadReceipt) {
    return { resident: false, reason: "download-required" };
  }
  if (!attestation || typeof attestation !== "object" || Array.isArray(attestation)) {
    return { resident: false, reason: "attestation-invalid" };
  }
  const record = attestation as Record<string, unknown>;
  if (record.warmup === true) {
    return { resident: false, reason: "warmup-refused" };
  }
  if (record.modelId !== MULTILINGUAL_EMBEDDING.id || record.revision !== MULTILINGUAL_EMBEDDING.revision) {
    return { resident: false, reason: "pin-mismatch" };
  }
  if (record.browserRevision !== MULTILINGUAL_EMBEDDING.browserRevision) {
    return { resident: false, reason: "pin-mismatch" };
  }
  if (record.dimension !== DIMENSION || record.dtype !== "int8") {
    return { resident: false, reason: "pin-mismatch" };
  }
  session.modelState = "resident";
  return { resident: true, reason: "resident" };
}

export async function rerankSemantic(session: SemanticSession, input: RerankInput): Promise<SemanticRerankResult> {
  assertSession(session);
  const hits = prepareHits(input.hits);
  if (!hits) {
    return lexicalResult(session, [], "unreadable", ["unreadable"]);
  }
  if (hits.length === 0) {
    return lexicalResult(session, [], "empty", ["empty"]);
  }
  const windowLimit = resolveWindow(input.maxCandidates);
  if (!windowLimit) {
    return lexicalResult(session, hits, "budget-refused", ["budget-refused"]);
  }
  const query = typeof input.query === "string" ? input.query : "";
  const queryLanguage = languageCode(input.queryLanguage) ?? "und";
  if (codePointLength(query) > SEMANTIC_BUDGET.maxQueryChars) {
    return lexicalResult(session, hits, "query-over-budget", ["query-over-budget"]);
  }
  const webgpu = input.capabilities?.webgpu === true;
  if (!webgpu) {
    return lexicalResult(session, hits, "webgpu-absent", ["webgpu-absent"]);
  }
  const model = readModelPin(input.embeddingModel) ?? pinnedMultilingualModel();
  if (!samePin(model, pinnedMultilingualModel())) {
    return lexicalResult(session, hits, "unpinned-embedding", ["unpinned-embedding"]);
  }
  const window = hits.slice(0, windowLimit);
  const suppliedQuery = readVector(input.queryEmbedding);
  const suppliedComplete = suppliedQuery !== null && window.every((hit) => hit.embedding !== null);
  let queryVector = suppliedComplete ? suppliedQuery : null;
  const passageVectors: Array<number[] | null> = window.map((hit) => hit.embedding);
  const reasons: string[] = [];
  if (!suppliedComplete) {
    if (session.modelState !== "resident") {
      return lexicalResult(session, hits, "model-absent", ["model-absent"]);
    }
    if (!input.embedder) {
      return lexicalResult(session, hits, "embedder-absent", ["embedder-absent"]);
    }
    try {
      queryVector = await encode(session, input.embedder, prefixText(query, "query"), "query");
      for (let i = 0; i < window.length; i += 1) {
        if (passageVectors[i]) continue;
        const body = window[i].text;
        if (!body) {
          return lexicalResult(session, hits, "passage-missing", ["passage-missing"]);
        }
        const clipped = clipPassage(body);
        if (clipped.truncated) reasons.push("passage-truncated");
        passageVectors[i] = await encode(session, input.embedder, prefixText(clipped.text, "passage"), "passage");
      }
    } catch {
      return lexicalResult(session, hits, "embedder-failed", ["embedder-failed"]);
    }
  }
  if (!queryVector || passageVectors.some((vector) => vector === null)) {
    return lexicalResult(session, hits, "embedding-rejected", ["embedding-rejected"]);
  }
  const bytes = (passageVectors.length + 1) * DIMENSION * 4;
  if (bytes > SEMANTIC_BUDGET.maxEmbeddingBytes) {
    return lexicalResult(session, hits, "embedding-budget-refused", ["embedding-budget-refused"]);
  }
  const scored = window.map((hit, index) => ({
    hit,
    cosine: cosine(queryVector as number[], passageVectors[index] as number[]),
  }));
  if (scored.some((row) => row.cosine === null)) {
    return lexicalResult(session, hits, "embedding-rejected", ["embedding-rejected"]);
  }
  scored.sort((left, right) => {
    const delta = (right.cosine as number) - (left.cosine as number);
    if (Math.abs(delta) > 1e-12) return delta;
    return left.hit.lexicalRank - right.hit.lexicalRank;
  });
  const reordered = scored.map((row) => row.hit);
  const tail = hits.slice(window.length);
  const next = reordered.concat(tail);
  const semanticById = new Map(scored.map((row) => [row.hit.lexicalRank, row.cosine as number]));
  const orderChanged = next.some((hit, index) => hit.lexicalRank !== hits[index].lexicalRank);
  return {
    schema: SEMANTIC_SCHEMA,
    applicability: SEMANTIC_APPLICABILITY,
    mode: "semantic",
    reason: orderChanged ? "reranked" : "semantic-tied",
    reasons: reasons.length > 0 ? reasons : [orderChanged ? "reranked" : "semantic-tied"],
    orderChanged,
    hits: next.map((hit, index) => toSemanticHit(hit, index + 1, semanticById.get(hit.lexicalRank) ?? null)),
    model: pinnedMultilingualModel(),
    warmupCalls: 0,
    embedCalls: session.embedCalls,
    downloadCalls: session.downloadCalls,
    promotesApplicability: false,
  };
}

export function rankByLexicalOverlap(
  query: string,
  queryLanguage: string,
  candidates: ReadonlyArray<{ id: string; text: string; language: string }>,
): string[] {
  const ranked = candidates
    .map((candidate, index) => ({
      id: candidate.id,
      index,
      score: overlapScore(query, queryLanguage, candidate.text, candidate.language),
    }))
    .filter((row) => row.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index);
  return ranked.map((row) => row.id);
}

function pinnedMultilingualModel(): ModelPin {
  return {
    id: MULTILINGUAL_EMBEDDING.id,
    revision: MULTILINGUAL_EMBEDDING.revision,
    dimension: DIMENSION,
  };
}

function pinnedEnglishModel(): ModelPin {
  return {
    id: ENGLISH_EMBEDDING.id,
    revision: ENGLISH_EMBEDDING.revision,
    dimension: DIMENSION,
  };
}

function samePin(left: ModelPin, right: ModelPin): boolean {
  return left.id === right.id && left.revision === right.revision && left.dimension === right.dimension;
}

function downloadRequest(): NonNullable<DownloadPlan["request"]> {
  return {
    repository: MULTILINGUAL_EMBEDDING.browserId,
    revision: MULTILINGUAL_EMBEDDING.browserRevision,
    baseModel: MULTILINGUAL_EMBEDDING.id,
    baseRevision: MULTILINGUAL_EMBEDDING.revision,
    dtype: "int8",
    files: MULTILINGUAL_FILES.map((file) => ({ path: file.path, bytes: file.bytes, sha256: file.sha256 })),
    maxBytes: MULTILINGUAL_DOWNLOAD_BYTES,
  };
}

function resolveK(value: unknown): number | null {
  if (value === undefined) return RECALL_K;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > RECALL_K_CEILING) return null;
  return value;
}

function resolveWindow(value: unknown): number | null {
  if (value === undefined) return MAX_CANDIDATES;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > MAX_CANDIDATES_CEILING) return null;
  return value;
}

function readModelPin(value: unknown): ModelPin | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as SemanticVectorModel;
  if (typeof record.id !== "string" || typeof record.revision !== "string") return null;
  const dimension = record.dimension === undefined ? DIMENSION : record.dimension;
  if (dimension !== DIMENSION) return null;
  return { id: record.id, revision: record.revision, dimension: DIMENSION };
}

function scoreJudgment(entry: unknown, index: number, k: number): JudgmentScore | null {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const row = entry as MeasurementJudgment;
  if (typeof row.id !== "string" || !row.id.trim()) return null;
  if (typeof row.query !== "string" || typeof row.queryLanguage !== "string") return null;
  if (!Array.isArray(row.relevantIds) || row.relevantIds.length === 0) return null;
  if (!row.relevantIds.every((id) => typeof id === "string" && id.trim())) return null;
  if (!Array.isArray(row.candidates) || row.candidates.length === 0) return null;
  if (typeof row.crossLingual !== "boolean") return null;
  const queryLanguage = languageCode(row.queryLanguage);
  if (!queryLanguage) return null;
  const candidates: Array<{ id: string; text: string; language: string; multilingual: number[] | null; english: number[] | null }> = [];
  for (const candidate of row.candidates) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
    const item = candidate as MeasurementCandidate;
    if (typeof item.id !== "string" || !item.id.trim()) return null;
    if (typeof item.text !== "string") return null;
    const language = languageCode(item.language);
    if (!language) return null;
    candidates.push({
      id: item.id,
      text: item.text,
      language,
      multilingual: readVector(item.multilingualEmbedding),
      english: readVector(item.englishEmbedding),
    });
  }
  const relevant = row.relevantIds as string[];
  if (new Set(candidates.map((candidate) => candidate.id)).size !== candidates.length) return null;
  if (relevant.some((id) => !candidates.some((candidate) => candidate.id === id))) return null;
  const relevantLanguages = unique(relevant.map((id) => candidates.find((candidate) => candidate.id === id)?.language).filter((language): language is string => Boolean(language)));
  const cross = relevantLanguages.some((language) => language !== queryLanguage);
  const same = relevantLanguages.every((language) => language === queryLanguage);
  if (row.crossLingual !== cross || row.crossLingual === same) return null;
  const lexicalIds = rankByLexicalOverlap(row.query, queryLanguage, candidates);
  const multilingualIds = rankVectorIds(readVector(row.multilingualQuery), candidates.map((candidate) => ({
    id: candidate.id,
    vector: candidate.multilingual,
  })));
  const englishIds = rankVectorIds(readVector(row.englishQuery), candidates.map((candidate) => ({
    id: candidate.id,
    vector: candidate.english,
  })));
  const lexicalBest = bestRank(lexicalIds, relevant);
  const multilingualBest = multilingualIds ? bestRank(multilingualIds, relevant) : null;
  const englishBest = englishIds ? bestRank(englishIds, relevant) : null;
  return {
    id: row.id,
    slice: row.crossLingual ? "cross-lingual" : "same-language",
    queryLanguage,
    relevantLanguages,
    lexicalFound: foundAtK(lexicalIds, relevant, k),
    relevant: relevant.length,
    multilingualFound: multilingualIds ? foundAtK(multilingualIds, relevant, k) : null,
    englishFound: englishIds ? foundAtK(englishIds, relevant, k) : null,
    lexicalBestRank: lexicalBest,
    multilingualBestRank: multilingualBest,
    englishBestRank: englishBest,
    improvedOverLexical: multilingualBest === 1 && lexicalBest !== 1,
    improvedOverEnglish: multilingualBest === 1 && englishBest !== 1,
  };
}

function summarize(rows: JudgmentScore[]): RecallSlice {
  const languages = unique(rows.flatMap((row) => row.relevantLanguages));
  const semanticComplete = rows.length > 0 && rows.every((row) => row.multilingualFound !== null && row.englishFound !== null);
  return {
    judgments: rows.length,
    languages,
    lexicalFound: rows.reduce((sum, row) => sum + row.lexicalFound, 0),
    lexicalRelevant: rows.reduce((sum, row) => sum + row.relevant, 0),
    multilingualFound: rows.reduce((sum, row) => sum + (row.multilingualFound ?? 0), 0),
    multilingualRelevant: rows.reduce((sum, row) => sum + (row.multilingualFound === null ? 0 : row.relevant), 0),
    englishFound: rows.reduce((sum, row) => sum + (row.englishFound ?? 0), 0),
    englishRelevant: rows.reduce((sum, row) => sum + (row.englishFound === null ? 0 : row.relevant), 0),
    improvedOverLexical: rows.filter((row) => row.improvedOverLexical).length,
    improvedOverEnglish: rows.filter((row) => row.improvedOverEnglish).length,
    semanticComplete,
  };
}

function overlapScore(query: string, queryLanguage: string, passage: string, passageLanguage: string): number {
  const left = tokenize(query, { language: queryLanguage });
  const right = new Set(tokenize(passage, { language: passageLanguage }));
  let score = 0;
  for (const token of left) {
    if (right.has(token)) score += 1;
  }
  return score;
}

function rankVectorIds(query: number[] | null, passages: ReadonlyArray<{ id: string; vector: number[] | null }>): string[] | null {
  if (!query) return null;
  if (passages.some((passage) => passage.vector === null)) return null;
  const scored = passages.map((passage, index) => ({
    id: passage.id,
    index,
    cosine: cosine(query, passage.vector as number[]),
  }));
  if (scored.some((row) => row.cosine === null)) return null;
  return scored
    .sort((left, right) => {
      const delta = (right.cosine as number) - (left.cosine as number);
      if (Math.abs(delta) > 1e-12) return delta;
      return left.index - right.index;
    })
    .map((row) => row.id);
}

function bestRank(ranked: string[], relevant: readonly string[]): number | null {
  const wanted = new Set(relevant);
  for (let i = 0; i < ranked.length; i += 1) {
    if (wanted.has(ranked[i])) return i + 1;
  }
  return null;
}

function foundAtK(ranked: string[], relevant: readonly string[], k: number): number {
  const top = new Set(ranked.slice(0, k));
  return relevant.filter((id) => top.has(id)).length;
}

function readVector(value: unknown): number[] | null {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value) && !ArrayBuffer.isView(value)) return null;
  const source = Array.isArray(value) ? value : Array.from(value as ArrayLike<number>);
  if (source.length !== DIMENSION) return null;
  const next: number[] = [];
  for (const item of source) {
    if (typeof item !== "number" || !Number.isFinite(item)) return null;
    next.push(item);
  }
  return next;
}

function cosine(left: number[], right: number[]): number | null {
  const a = normalize(left);
  const b = normalize(right);
  if (!a || !b) return null;
  let dot = 0;
  for (let i = 0; i < DIMENSION; i += 1) dot += a[i] * b[i];
  if (!Number.isFinite(dot)) return null;
  return dot;
}

function normalize(vector: number[]): number[] | null {
  if (vector.length !== DIMENSION) return null;
  let sum = 0;
  for (const value of vector) {
    if (!Number.isFinite(value)) return null;
    sum += value * value;
  }
  if (!(sum > 1e-12)) return null;
  const scale = 1 / Math.sqrt(sum);
  return vector.map((value) => value * scale);
}

function verifyDownload(request: NonNullable<DownloadPlan["request"]>, payload: { files?: unknown }): DownloadReceipt | null {
  if (!payload || typeof payload !== "object" || !payload.files || typeof payload.files !== "object" || Array.isArray(payload.files)) {
    return null;
  }
  const files = payload.files as Record<string, DownloadTransportFile>;
  const keys = Object.keys(files);
  if (keys.length !== request.files.length) return null;
  let bytes = 0;
  for (const pin of request.files) {
    const got = files[pin.path];
    if (!got || got.bytes !== pin.bytes || got.sha256 !== pin.sha256) return null;
    bytes += pin.bytes;
  }
  if (bytes !== request.maxBytes || bytes !== MULTILINGUAL_DOWNLOAD_BYTES) return null;
  return {
    repository: request.repository,
    revision: request.revision,
    bytes,
    files: request.files.map((file) => ({ path: file.path, bytes: file.bytes, sha256: file.sha256 })),
    warmup: false,
  };
}

function prepareHits(value: unknown): PreparedHit[] | null {
  if (!Array.isArray(value)) return null;
  const hits: PreparedHit[] = [];
  value.forEach((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      hits.push({
        id: "",
        text: "",
        language: null,
        lexicalScore: null,
        lexicalRank: index + 1,
        embedding: null,
      });
      return;
    }
    const row = entry as LexicalHit;
    hits.push({
      id: typeof row.id === "string" ? row.id : "",
      text: typeof row.text === "string" ? row.text : "",
      language: languageCode(row.language),
      lexicalScore: typeof row.lexicalScore === "number" && Number.isFinite(row.lexicalScore) ? row.lexicalScore : null,
      lexicalRank: index + 1,
      embedding: readVector(row.embedding),
    });
  });
  return hits;
}

function lexicalResult(session: SemanticSession, hits: PreparedHit[], reason: string, reasons: string[]): SemanticRerankResult {
  return {
    schema: SEMANTIC_SCHEMA,
    applicability: SEMANTIC_APPLICABILITY,
    mode: "lexical",
    reason,
    reasons,
    orderChanged: false,
    hits: hits.map((hit, index) => toSemanticHit(hit, index + 1, null)),
    model: null,
    warmupCalls: 0,
    embedCalls: session.embedCalls,
    downloadCalls: session.downloadCalls,
    promotesApplicability: false,
  };
}

function toSemanticHit(hit: PreparedHit, rank: number, semanticScore: number | null): SemanticHit {
  const clipped = clipPassage(hit.text);
  return {
    id: hit.id,
    lexicalRank: hit.lexicalRank,
    lexicalScore: hit.lexicalScore,
    semanticScore,
    rank,
    language: hit.language,
    applicability: SEMANTIC_APPLICABILITY,
    passageTruncated: clipped.truncated,
  };
}

async function encode(session: SemanticSession, embedder: SemanticEmbedder, text: string, role: "query" | "passage"): Promise<number[] | null> {
  session.embedCalls += 1;
  const vector = readVector(await embedder({
    text,
    role,
    modelId: MULTILINGUAL_EMBEDDING.id,
    revision: MULTILINGUAL_EMBEDDING.revision,
  }));
  return vector;
}

function prefixText(text: string, role: "query" | "passage"): string {
  const prefix = role === "query" ? SEMANTIC_QUERY_PREFIX : SEMANTIC_PASSAGE_PREFIX;
  if (text.startsWith(prefix)) return text;
  return `${prefix}${text}`;
}

function clipPassage(text: string): { text: string; truncated: boolean } {
  const points = Array.from(text);
  if (points.length <= MAX_PASSAGE_CHARS) return { text, truncated: false };
  return { text: points.slice(0, MAX_PASSAGE_CHARS).join(""), truncated: true };
}

function codePointLength(text: string): number {
  return Array.from(text).length;
}

function languageCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.trim().toLowerCase();
  if (!/^[a-z]{2,3}$/.test(code)) return null;
  return code;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function heapFits(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= SEMANTIC_BUDGET.requiredHeapBytes;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function assertSession(session: SemanticSession): void {
  if (!session || session.schema !== SEMANTIC_SCHEMA || session.warmupCalls !== 0) {
    throw new SemanticError("invalid-session", "Semantic session is not from createSemanticSession.");
  }
}

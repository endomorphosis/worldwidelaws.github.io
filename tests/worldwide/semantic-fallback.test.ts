import { jest } from "@jest/globals";
import {
  ENGLISH_EMBEDDING,
  MULTILINGUAL_EMBEDDING,
  SEMANTIC_APPLICABILITY,
  SEMANTIC_BUDGET,
  SEMANTIC_BUDGET_CEILING,
  SEMANTIC_CONSENT_DECISION,
  SEMANTIC_PASSAGE_PREFIX,
  SEMANTIC_QUERY_PREFIX,
  SEMANTIC_SCHEMA,
  SEMANTIC_WITNESS,
  SemanticError,
  createSemanticSession,
  grantDownloadConsent,
  markModelResident,
  measureMultilingualBenefit,
  planModelDownload,
  rankByLexicalOverlap,
  recordMeasurement,
  requestModelDownload,
  rerankSemantic,
  revokeDownloadConsent,
  wordingPromotesApplicability,
  type MeasurementCandidate,
  type MeasurementInput,
  type MeasurementJudgment,
  type SemanticDownloadTransport,
  type SemanticEmbedder,
  type SemanticSession,
} from "../../src/lib/worldwide/research/semantic";

const DIMENSION = 384;
const CONSENT_AT = "2026-11-03T12:00:00Z";

function axis(index: number): number[] {
  const vector = Array.from({ length: DIMENSION }, () => 0);
  vector[index] = 1;
  return vector;
}

const PASSAGE_AXIS: Record<string, number> = {
  "nl:bwbr0001854:1": 0,
  "bh:constitution:1": 1,
  "jp:civil-code:1": 2,
  "nl:traffic:speed": 3,
  "en:traffic:speed": 4,
};

function passageRows(): MeasurementCandidate[] {
  return SEMANTIC_WITNESS.passages.map((passage) => ({
    id: passage.id,
    text: passage.text,
    language: passage.language,
  }));
}

function withVectors(
  mode: "benefit" | "no-gain" | "english-matches" | "same-language-regression" | "missing",
): MeasurementJudgment[] {
  return SEMANTIC_WITNESS.judgments.map((judgment) => {
    const relevant = judgment.relevantIds[0];
    const candidates = passageRows().map((candidate) => {
      const own = axis(PASSAGE_AXIS[String(candidate.id)]);
      if (mode === "missing") return candidate;
      return {
        ...candidate,
        multilingualEmbedding: own,
        englishEmbedding: own,
      };
    });
    const multilingualAxis = mode === "no-gain"
      ? PASSAGE_AXIS["en:traffic:speed"]
      : mode === "same-language-regression" && !judgment.crossLingual
        ? PASSAGE_AXIS["nl:traffic:speed"]
        : PASSAGE_AXIS[relevant];
    const englishAxis = mode === "english-matches" || !judgment.crossLingual
      ? PASSAGE_AXIS[relevant]
      : PASSAGE_AXIS["en:traffic:speed"];
    return {
      id: judgment.id,
      query: judgment.query,
      queryLanguage: judgment.queryLanguage,
      relevantIds: [...judgment.relevantIds],
      crossLingual: judgment.crossLingual,
      candidates,
      multilingualQuery: mode === "missing" ? undefined : axis(multilingualAxis),
      englishQuery: mode === "missing" ? undefined : axis(englishAxis),
    };
  });
}

function measurementInput(mode: Parameters<typeof withVectors>[0], modelRevision = MULTILINGUAL_EMBEDDING.revision): MeasurementInput {
  return {
    k: SEMANTIC_BUDGET.k,
    multilingualModel: {
      id: MULTILINGUAL_EMBEDDING.id,
      revision: modelRevision,
      dimension: MULTILINGUAL_EMBEDDING.dimension,
    },
    englishModel: {
      id: ENGLISH_EMBEDDING.id,
      revision: ENGLISH_EMBEDDING.revision,
      dimension: ENGLISH_EMBEDDING.dimension,
    },
    judgments: withVectors(mode),
  };
}

function heap(): number {
  return SEMANTIC_BUDGET.requiredHeapBytes;
}

function capabilities(overrides: Record<string, unknown> = {}) {
  return {
    webgpu: true,
    network: true,
    heapBytes: heap(),
    ...overrides,
  };
}

function receiptFiles() {
  return Object.fromEntries(MULTILINGUAL_EMBEDDING.files.map((file) => [file.path, { bytes: file.bytes, sha256: file.sha256 }]));
}

async function downloadedSession(transport: SemanticDownloadTransport = async () => ({ files: receiptFiles() })): Promise<SemanticSession> {
  const session = createSemanticSession();
  recordMeasurement(session, measureMultilingualBenefit(measurementInput("benefit")));
  grantDownloadConsent(session, SEMANTIC_CONSENT_DECISION, CONSENT_AT);
  const result = await requestModelDownload(session, capabilities(), transport);
  expect(result.reason).toBe("downloaded");
  return session;
}

const LEXICAL = [
  { id: "a", text: "alpha statute", language: "en", lexicalScore: 5 },
  { id: "b", text: "beta statute", language: "en", lexicalScore: 4 },
  { id: "c", text: "gamma statute", language: "en", lexicalScore: 3 },
];

describe("optional semantic reranking", () => {
  test("pins the multilingual pack, the English baseline, and the budgets", () => {
    expect(MULTILINGUAL_EMBEDDING.dimension).toBe(384);
    expect(MULTILINGUAL_EMBEDDING.maxSeqLength).toBe(512);
    expect(MULTILINGUAL_EMBEDDING.dtype).toBe("int8");
    expect(MULTILINGUAL_EMBEDDING.revision).toBe("614241f622f53c4eeff9890bdc4f31cfecc418b3");
    expect(MULTILINGUAL_EMBEDDING.browserRevision).toBe("761b726dd34fb83930e26aab4e9ac3899aa1fa78");
    expect(ENGLISH_EMBEDDING.revision).toBe("17e1f347d17fe144873b1201da91788898c639cd");
    expect(ENGLISH_EMBEDDING.download).toBe("not-offered");
    const bytes = MULTILINGUAL_EMBEDDING.files.reduce((sum, file) => sum + file.bytes, 0);
    expect(bytes).toBe(135138591);
    expect(MULTILINGUAL_EMBEDDING.downloadBytes).toBe(bytes);
    expect(SEMANTIC_BUDGET.maxModelBytes).toBe(bytes);
    expect(SEMANTIC_BUDGET_CEILING.maxModelBytes).toBe(bytes);
    expect(SEMANTIC_BUDGET.requiredHeapBytes).toBe(bytes + (32 * 1024 * 1024));
    expect(SEMANTIC_BUDGET.maxCandidates).toBe(32);
    expect(SEMANTIC_BUDGET.maxEmbeddingBytes).toBe(33 * 384 * 4);
    expect(MULTILINGUAL_EMBEDDING.files.map((file) => file.path)).toEqual([
      "config.json",
      "tokenizer.json",
      "tokenizer_config.json",
      "special_tokens_map.json",
      "onnx/model_int8.onnx",
    ]);
    expect(MULTILINGUAL_EMBEDDING.files.find((file) => file.path === "onnx/model_int8.onnx")?.sha256).toBe(
      "4d24e2bc01a447951524466ef533e52944bf48509e6552810bcee1a2711cb02c",
    );
  });

  test("measures a cross-lingual gain on the witness before downloads can open", () => {
    for (const judgment of SEMANTIC_WITNESS.judgments) {
      const ranked = rankByLexicalOverlap(judgment.query, judgment.queryLanguage, SEMANTIC_WITNESS.passages.map((passage) => ({
        id: passage.id,
        text: passage.text,
        language: passage.language,
      })));
      if (judgment.crossLingual) expect(ranked).toEqual([]);
      else expect(ranked).toEqual([...judgment.relevantIds]);
    }

    const closed = measureMultilingualBenefit(measurementInput("missing"));
    expect(closed.downloadsEnabled).toBe(false);
    expect(closed.reasons).toContain("embeddings-not-measured");
    expect(closed.crossLingual.lexicalFound).toBe(0);
    expect(closed.sameLanguage.lexicalFound).toBe(1);
    expect(closed.automaticWarmup).toBe(false);

    const opened = measureMultilingualBenefit(measurementInput("benefit"));
    expect(opened.status).toBe("measured");
    expect(opened.downloadsEnabled).toBe(true);
    expect(opened.crossLingual.lexicalFound).toBe(0);
    expect(opened.crossLingual.multilingualFound).toBe(3);
    expect(opened.crossLingual.improvedOverLexical).toBe(3);
    expect(opened.crossLingual.improvedOverEnglish).toBe(3);
    expect(opened.judgments.filter((row) => row.slice === "cross-lingual").map((row) => row.englishBestRank)).not.toContain(1);
    expect(opened.sameLanguage.lexicalFound).toBe(1);
    expect(opened.sameLanguage.multilingualFound).toBe(1);
    expect(opened.judgments.find((row) => row.id === "same-nl-strafbepaling")?.multilingualBestRank).toBe(1);
    expect(opened.applicability).toBe(SEMANTIC_APPLICABILITY);
    expect(opened.reasons).toEqual([]);
  });

  test("keeps the download closed when the multilingual vectors do not win", () => {
    expect(measureMultilingualBenefit(measurementInput("no-gain")).downloadsEnabled).toBe(false);
    expect(measureMultilingualBenefit(measurementInput("no-gain")).reasons).toEqual(expect.arrayContaining([
      "no-gain-over-lexical",
      "no-gain-over-english",
    ]));
    expect(measureMultilingualBenefit(measurementInput("english-matches")).reasons).toContain("no-gain-over-english");
    expect(measureMultilingualBenefit(measurementInput("same-language-regression")).reasons).toContain("same-language-regression");
    expect(measureMultilingualBenefit(measurementInput("benefit", "not-the-pin")).status).toBe("rejected-pin");
    expect(measureMultilingualBenefit(measurementInput("benefit", "not-the-pin")).downloadsEnabled).toBe(false);
    expect(measureMultilingualBenefit({ ...measurementInput("benefit"), k: 21 }).reasons).toContain("recall-k-refused");
  });

  test("requires the exact consent decision and does not treat a boolean as consent", () => {
    const session = createSemanticSession();
    recordMeasurement(session, measureMultilingualBenefit(measurementInput("benefit")));
    expect(grantDownloadConsent(session, true, CONSENT_AT)).toBe(false);
    expect(grantDownloadConsent(session, "yes", CONSENT_AT)).toBe(false);
    expect(grantDownloadConsent(session, SEMANTIC_CONSENT_DECISION, "  ")).toBe(false);
    expect(session.consent).toBeNull();
    expect(planModelDownload(session, capabilities()).reasons).toContain("consent-required");
    expect(grantDownloadConsent(session, SEMANTIC_CONSENT_DECISION, CONSENT_AT)).toBe(true);
    revokeDownloadConsent(session);
    expect(session.consent).toBeNull();
  });

  test("does not download without the measurement, WebGPU, network, and heap", async () => {
    const transport = jest.fn(async () => ({ files: receiptFiles() }));
    const session = createSemanticSession();
    grantDownloadConsent(session, SEMANTIC_CONSENT_DECISION, CONSENT_AT);
    expect((await requestModelDownload(session, capabilities(), transport)).reason).toBe("measurement-required");

    recordMeasurement(session, measureMultilingualBenefit(measurementInput("no-gain")));
    expect((await requestModelDownload(session, capabilities(), transport)).reason).toBe("measurement-required");

    recordMeasurement(session, measureMultilingualBenefit(measurementInput("benefit")));
    expect((await requestModelDownload(session, capabilities({ webgpu: false }), transport)).reason).toBe("webgpu-required");
    expect((await requestModelDownload(session, capabilities({ network: false }), transport)).reason).toBe("network-required");
    expect((await requestModelDownload(session, capabilities({ heapBytes: heap() - 1 }), transport)).reason).toBe("heap-required");
    expect((await requestModelDownload(session, capabilities({ heapBytes: undefined }), transport)).reason).toBe("heap-required");
    expect(transport).not.toHaveBeenCalled();
    expect(session.downloadCalls).toBe(0);
    expect(session.embedCalls).toBe(0);
    expect(session.warmupCalls).toBe(0);
    expect(session.modelState).toBe("absent");
  });

  test("downloads the pinned int8 pack once and does not warm it", async () => {
    const transport = jest.fn(async () => ({ files: receiptFiles() }));
    const session = await downloadedSession(transport);
    expect(transport).toHaveBeenCalledTimes(1);
    const request = transport.mock.calls[0][0];
    expect(request.repository).toBe("Xenova/multilingual-e5-small");
    expect(request.revision).toBe(MULTILINGUAL_EMBEDDING.browserRevision);
    expect(request.baseRevision).toBe(MULTILINGUAL_EMBEDDING.revision);
    expect(request.dtype).toBe("int8");
    expect(request.maxBytes).toBe(135138591);
    expect(request.files.map((file) => file.sha256)).toEqual(MULTILINGUAL_EMBEDDING.files.map((file) => file.sha256));
    expect(session.modelState).toBe("downloaded");
    expect(session.downloadReceipt?.warmup).toBe(false);
    expect(session.embedCalls).toBe(0);

    const again = await requestModelDownload(session, capabilities(), transport);
    expect(again.reason).toBe("already-downloaded");
    expect(transport).toHaveBeenCalledTimes(1);

    expect(markModelResident(session, {
      modelId: MULTILINGUAL_EMBEDDING.id,
      revision: MULTILINGUAL_EMBEDDING.revision,
      browserRevision: MULTILINGUAL_EMBEDDING.browserRevision,
      dimension: 384,
      dtype: "int8",
      warmup: true,
    }).reason).toBe("warmup-refused");
    expect(session.modelState).toBe("downloaded");
    expect(session.warmupCalls).toBe(0);

    expect(markModelResident(session, {
      modelId: MULTILINGUAL_EMBEDDING.id,
      revision: MULTILINGUAL_EMBEDDING.revision,
      browserRevision: MULTILINGUAL_EMBEDDING.browserRevision,
      dimension: 384,
      dtype: "int8",
      warmup: false,
    }).resident).toBe(true);
    expect(session.embedCalls).toBe(0);
  });

  test("rejects a download receipt that misses the pin", async () => {
    const session = createSemanticSession();
    recordMeasurement(session, measureMultilingualBenefit(measurementInput("benefit")));
    grantDownloadConsent(session, SEMANTIC_CONSENT_DECISION, CONSENT_AT);
    const files = receiptFiles();
    files["onnx/model_int8.onnx"] = { bytes: 118054593, sha256: "0".repeat(64) };
    const wrong = await requestModelDownload(session, capabilities(), async () => ({ files }));
    expect(wrong.reason).toBe("receipt-rejected");
    expect(session.modelState).toBe("absent");

    const extra = receiptFiles();
    extra["onnx/model.onnx"] = { bytes: 470268533, sha256: "1".repeat(64) };
    const bloated = await requestModelDownload(session, capabilities(), async () => ({ files: extra }));
    expect(bloated.reason).toBe("receipt-rejected");
    const failed = await requestModelDownload(session, capabilities(), async () => {
      throw new Error("offline");
    });
    expect(failed.reason).toBe("transport-failed");
    expect(session.modelState).toBe("absent");
    expect(session.embedCalls).toBe(0);
  });

  test("preserves lexical order and scores with no WebGPU, network, or model", async () => {
    const session = createSemanticSession();
    const embedder = jest.fn(() => axis(0));
    const result = await rerankSemantic(session, {
      query: "this law applies to the visitor",
      queryLanguage: "en",
      hits: LEXICAL,
      capabilities: { webgpu: false, network: false },
      embedder,
    });
    expect(result.mode).toBe("lexical");
    expect(result.reason).toBe("webgpu-absent");
    expect(result.orderChanged).toBe(false);
    expect(result.hits.map((hit) => hit.id)).toEqual(["a", "b", "c"]);
    expect(result.hits.map((hit) => hit.lexicalScore)).toEqual([5, 4, 3]);
    expect(result.hits.map((hit) => hit.semanticScore)).toEqual([null, null, null]);
    expect(result.hits.every((hit) => hit.applicability === "not-asserted")).toBe(true);
    expect(result.promotesApplicability).toBe(false);
    expect(result.warmupCalls).toBe(0);
    expect(embedder).not.toHaveBeenCalled();
    expect(wordingPromotesApplicability("this law applies")).toBe(true);
    expect(session.modelState).toBe("absent");
  });

  test("does not encode a resident model when WebGPU is absent", async () => {
    const session = await downloadedSession();
    markModelResident(session, {
      modelId: MULTILINGUAL_EMBEDDING.id,
      revision: MULTILINGUAL_EMBEDDING.revision,
      browserRevision: MULTILINGUAL_EMBEDDING.browserRevision,
      dimension: 384,
      dtype: "int8",
    });
    const embedder = jest.fn(() => axis(1));
    const result = await rerankSemantic(session, {
      query: "beta",
      queryLanguage: "en",
      hits: LEXICAL.map((hit, index) => ({ ...hit, embedding: axis(index) })),
      capabilities: { webgpu: false, network: true, heapBytes: heap() },
      embeddingModel: {
        id: MULTILINGUAL_EMBEDDING.id,
        revision: MULTILINGUAL_EMBEDDING.revision,
        dimension: 384,
      },
      queryEmbedding: axis(1),
      embedder,
    });
    expect(result.mode).toBe("lexical");
    expect(result.hits.map((hit) => hit.id)).toEqual(["a", "b", "c"]);
    expect(embedder).not.toHaveBeenCalled();
    expect(session.embedCalls).toBe(0);
  });

  test("reranks with the resident model only after an explicit rerank", async () => {
    const session = await downloadedSession();
    const embedder = jest.fn<ReturnType<SemanticEmbedder>, Parameters<SemanticEmbedder>>((input) => {
      if (input.role === "query") return axis(1);
      if (input.text.includes("beta")) return axis(1);
      return axis(0);
    });
    expect(session.embedCalls).toBe(0);
    markModelResident(session, {
      modelId: MULTILINGUAL_EMBEDDING.id,
      revision: MULTILINGUAL_EMBEDDING.revision,
      browserRevision: MULTILINGUAL_EMBEDDING.browserRevision,
      dimension: 384,
      dtype: "int8",
    });
    expect(session.embedCalls).toBe(0);

    const result = await rerankSemantic(session, {
      query: "beta statute",
      queryLanguage: "en",
      hits: LEXICAL,
      capabilities: { webgpu: true, network: false },
      embedder,
    });
    expect(result.mode).toBe("semantic");
    expect(result.orderChanged).toBe(true);
    expect(result.hits.map((hit) => [hit.id, hit.lexicalScore, hit.lexicalRank])).toEqual([
      ["b", 4, 2],
      ["a", 5, 1],
      ["c", 3, 3],
    ]);
    expect(result.model?.revision).toBe(MULTILINGUAL_EMBEDDING.revision);
    expect(result.schema).toBe(SEMANTIC_SCHEMA);
    expect(embedder.mock.calls.map((call) => call[0].text)).toEqual([
      `${SEMANTIC_QUERY_PREFIX}beta statute`,
      `${SEMANTIC_PASSAGE_PREFIX}alpha statute`,
      `${SEMANTIC_PASSAGE_PREFIX}beta statute`,
      `${SEMANTIC_PASSAGE_PREFIX}gamma statute`,
    ]);
    expect(embedder.mock.calls.every((call) => call[0].revision === MULTILINGUAL_EMBEDDING.revision)).toBe(true);
    expect(session.warmupCalls).toBe(0);
    expect(session.downloadCalls).toBe(1);
    expect(session.embedCalls).toBe(4);
  });

  test("uses supplied pinned embeddings without calling the embedder", async () => {
    const session = createSemanticSession();
    const embedder = jest.fn(() => axis(0));
    const result = await rerankSemantic(session, {
      query: "beta statute",
      queryLanguage: "en",
      hits: [
        { ...LEXICAL[0], embedding: axis(0) },
        { ...LEXICAL[1], embedding: axis(1) },
        { ...LEXICAL[2], embedding: axis(2) },
      ],
      capabilities: { webgpu: true, network: false },
      embeddingModel: {
        id: MULTILINGUAL_EMBEDDING.id,
        revision: MULTILINGUAL_EMBEDDING.revision,
        dimension: 384,
      },
      queryEmbedding: axis(1),
      embedder,
    });
    expect(result.mode).toBe("semantic");
    expect(result.hits.map((hit) => hit.id)).toEqual(["b", "a", "c"]);
    expect(embedder).not.toHaveBeenCalled();
    expect(session.modelState).toBe("absent");
    expect(session.downloadCalls).toBe(0);
  });

  test("keeps the lexical tail outside the candidate window and refuses a raised ceiling", async () => {
    const session = createSemanticSession();
    const hits = [
      { id: "a", text: "a", language: "en", lexicalScore: 4, embedding: axis(1) },
      { id: "b", text: "b", language: "en", lexicalScore: 3, embedding: axis(0) },
      { id: "c", text: "c", language: "en", lexicalScore: 2, embedding: axis(0) },
      { id: "d", text: "d", language: "en", lexicalScore: 1, embedding: axis(0) },
    ];
    const moved = await rerankSemantic(session, {
      query: "match",
      queryLanguage: "en",
      hits,
      capabilities: { webgpu: true },
      embeddingModel: {
        id: MULTILINGUAL_EMBEDDING.id,
        revision: MULTILINGUAL_EMBEDDING.revision,
        dimension: 384,
      },
      queryEmbedding: axis(0),
      maxCandidates: 2,
    });
    expect(moved.hits.map((hit) => hit.id)).toEqual(["b", "a", "c", "d"]);

    const refused = await rerankSemantic(session, {
      query: "match",
      queryLanguage: "en",
      hits,
      capabilities: { webgpu: true },
      maxCandidates: SEMANTIC_BUDGET_CEILING.maxCandidates + 1,
      queryEmbedding: axis(0),
    });
    expect(refused.mode).toBe("lexical");
    expect(refused.reason).toBe("budget-refused");
    expect(refused.hits.map((hit) => hit.id)).toEqual(["a", "b", "c", "d"]);
  });

  test("falls back to lexical order when the embedder fails or the query is over budget", async () => {
    const session = await downloadedSession();
    markModelResident(session, {
      modelId: MULTILINGUAL_EMBEDDING.id,
      revision: MULTILINGUAL_EMBEDDING.revision,
      browserRevision: MULTILINGUAL_EMBEDDING.browserRevision,
      dimension: 384,
      dtype: "int8",
    });
    const failing = jest.fn(() => {
      throw new Error("runtime");
    });
    const failed = await rerankSemantic(session, {
      query: "beta",
      queryLanguage: "en",
      hits: LEXICAL,
      capabilities: { webgpu: true },
      embedder: failing,
    });
    expect(failed.mode).toBe("lexical");
    expect(failed.reason).toBe("embedder-failed");
    expect(failed.hits.map((hit) => hit.id)).toEqual(["a", "b", "c"]);

    const embedder = jest.fn(() => axis(0));
    const longQuery = await rerankSemantic(session, {
      query: "x".repeat(SEMANTIC_BUDGET.maxQueryChars + 1),
      queryLanguage: "en",
      hits: LEXICAL,
      capabilities: { webgpu: true },
      embedder,
    });
    expect(longQuery.reason).toBe("query-over-budget");
    expect(embedder).not.toHaveBeenCalled();

    const clipped: string[] = [];
    await rerankSemantic(session, {
      query: "beta",
      queryLanguage: "en",
      hits: [{ id: "long", text: "y".repeat(SEMANTIC_BUDGET.maxPassageChars + 25), language: "en", lexicalScore: 1 }],
      capabilities: { webgpu: true },
      embedder: (input) => {
        clipped.push(input.text);
        return axis(0);
      },
    });
    expect(clipped[1].startsWith(SEMANTIC_PASSAGE_PREFIX)).toBe(true);
    expect(Array.from(clipped[1]).length).toBe(SEMANTIC_PASSAGE_PREFIX.length + SEMANTIC_BUDGET.maxPassageChars);
  });

  test("does not rerank an unpinned model or a missing model", async () => {
    const session = createSemanticSession();
    const unpinned = await rerankSemantic(session, {
      query: "beta",
      queryLanguage: "en",
      hits: LEXICAL.map((hit, index) => ({ ...hit, embedding: axis(index) })),
      capabilities: { webgpu: true, network: true, heapBytes: heap() },
      embeddingModel: { id: "Xenova/gte-small", revision: ENGLISH_EMBEDDING.revision, dimension: 384 },
      queryEmbedding: axis(1),
    });
    expect(unpinned.mode).toBe("lexical");
    expect(unpinned.reason).toBe("unpinned-embedding");

    const absent = await rerankSemantic(session, {
      query: "beta",
      queryLanguage: "en",
      hits: LEXICAL,
      capabilities: { webgpu: true, network: true, heapBytes: heap() },
    });
    expect(absent.reason).toBe("model-absent");
    expect(absent.hits.map((hit) => hit.lexicalRank)).toEqual([1, 2, 3]);
  });

  test("importing the module does not fetch, download, or encode", async () => {
    const fetchMock = jest.fn();
    const previous = globalThis.fetch;
    globalThis.fetch = fetchMock as typeof fetch;
    jest.resetModules();
    const loaded = await import("../../src/lib/worldwide/research/semantic");
    const session = loaded.createSemanticSession();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(session.warmupCalls).toBe(0);
    expect(session.downloadCalls).toBe(0);
    expect(session.embedCalls).toBe(0);
    expect(loaded.MULTILINGUAL_EMBEDDING.downloadBytes).toBe(135138591);
    globalThis.fetch = previous;
  });

  test("rejects a measurement that is not an object", () => {
    expect(() => measureMultilingualBenefit(null as unknown as MeasurementInput)).toThrow(SemanticError);
    const session = createSemanticSession();
    expect(session.schema).toBe(SEMANTIC_SCHEMA);
    expect(() => recordMeasurement(session, { schema: "other" } as unknown as ReturnType<typeof measureMultilingualBenefit>)).toThrow(SemanticError);
  });
});

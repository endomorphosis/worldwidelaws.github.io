import { canonicalJson, sha256HexUtf8 } from '../../src/lib/worldwide/data/identity';
import { tokenize } from '../../src/lib/worldwide/search/tokenize';
import {
  COMPACT_FORMAT,
  COUNTRY_IR_SCHEMA,
  INDEX_SCHEMA,
  LAYOUT_FAMILY,
  REUSE_FORMAT,
  UPSTREAM_TOKENIZER,
  IndexFormatError,
  checksumOf,
  idf,
  loadIndexSchema,
  measureCountryIr,
  pagesBundleDocument,
  prepareIndex,
  routeQuery,
  routeTerm,
  schemaProblems,
  utf8Size,
  type CountryIrRelease,
  type DocumentSummary,
  type PreparedIndex,
  type ShardDescriptor,
} from '../../scripts/worldwide/build-index';

const AS_OF = '2026-11-03';
const REVISION = '1'.repeat(40);
const OTHER_REVISION = '2'.repeat(40);
const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const SHA_C = 'c'.repeat(64);
const SHA_D = 'd'.repeat(64);
const CORPUS_PATH = 'data/corpus/part-000000.parquet';
const CORPUS_SENTINEL = `FULL CORPUS BODY ${'Q'.repeat(48)}`;
const BODY_SENTINEL = 'uniquebodysentinel9f3a';

function postingShard(partial: Record<string, unknown> = {}) {
  return {
    relative_path: 'data/bm25/postings/part-000000.parquet',
    sha256: SHA_A,
    size_bytes: 1200,
    first_key: 'act',
    last_key: 'law',
    row_count: 2,
    shard_id: 0,
    kind: 'bm25_postings',
    ...partial,
  };
}

function compatibleRelease(): CountryIrRelease {
  return {
    schema_version: COUNTRY_IR_SCHEMA,
    layout_family: LAYOUT_FAMILY,
    dataset_id: 'endomorphosis/ipfs_example_laws',
    dataset_revision: REVISION,
    jurisdiction_id: 'place:example',
    level: 'national',
    country: { slug: 'example', jurisdiction_id: 'place:example' },
    bm25: {
      k1: 1.2,
      b: 0.75,
      title_weight: 5,
      body_weight: 1,
      average_document_length: 12.5,
      tokenizer: UPSTREAM_TOKENIZER,
      max_query_terms: 64,
      posting_rows_per_record: 4096,
      terms_per_shard: 4096,
    },
    counts: { bm25_documents: 2, corpus_rows: 2, bm25_terms: 4, bm25_postings: 5 },
    keyword_shards: [
      postingShard(),
      postingShard({
        relative_path: 'data/bm25/postings/part-000001.parquet',
        sha256: SHA_B,
        size_bytes: 900,
        first_key: 'rule',
        last_key: 'statute',
        shard_id: 1,
      }),
    ],
    document_shards: [{
      relative_path: 'data/bm25/documents/part-000000.parquet',
      sha256: SHA_C,
      size_bytes: 1500,
      first_key: 'bafkrei1',
      last_key: 'bafkrei9',
      row_count: 2,
      kind: 'bm25_documents',
    }],
    corpus_shards: [{ relative_path: CORPUS_PATH, sha256: SHA_D, size_bytes: 500_000 }],
    documents: [{ body: CORPUS_SENTINEL, text: CORPUS_SENTINEL }],
    corpus_text: CORPUS_SENTINEL,
  };
}

function reasonsFor(patch: (release: CountryIrRelease) => void): string[] {
  const release = compatibleRelease();
  patch(release);
  return measureCountryIr(release).reasons;
}

function compactPair(): PreparedIndex {
  return prepareIndex({
    asOf: AS_OF,
    jurisdictionId: 'place:example',
    datasetId: 'endomorphosis/ipfs_example_laws',
    sourceRevision: REVISION,
    collectionId: 'example',
    documents: [
      { entry_cid: 'entry-act', title: 'Act', body: 'Act act rules', record_type: 'law', jurisdiction_id: 'place:example' },
      { entry_cid: 'entry-rules', title: 'Rules', body: 'Other', record_type: 'article', law_id: 'act-1', article_number: '2' },
    ],
  });
}

function postingShards(index: PreparedIndex): ShardDescriptor[] {
  return index.shards.filter((shard) => shard.kind === 'compact-postings' || shard.kind === 'country-ir-postings');
}

describe('index format schema', () => {
  test('encodes shard bytes, coverage, and tokenizer, and refuses a Pages corpus', () => {
    const schema = loadIndexSchema() as {
      $schema: string;
      additionalProperties: boolean;
      required: string[];
      $defs: { shard: { required: string[]; properties: { size_bytes: { type: string; minimum: number; maximum: number }; bundled_on_pages: { const: boolean } } } };
      properties: {
        coverage: { required: string[] };
        tokenizer: { required: string[]; properties: { tokenizer_id: { const: string }; strategy: { const: string } } };
        shards: { items: { $ref: string } };
        pages: { properties: { full_corpus_bundled: { const: boolean }; index_payload_bundled: { const: boolean } } };
      };
    };

    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(expect.arrayContaining(['tokenizer', 'coverage', 'shards', 'pages', 'term_routing', 'checksums']));
    expect(schema.properties.shards.items.$ref).toBe('#/$defs/shard');
    expect(schema.$defs.shard.required).toEqual(expect.arrayContaining(['size_bytes', 'sha256', 'relative_path', 'first_key', 'last_key']));
    expect(schema.$defs.shard.properties.size_bytes).toMatchObject({ type: 'integer', minimum: 1, maximum: 10 * 1024 * 1024 });
    expect(schema.$defs.shard.properties.bundled_on_pages.const).toBe(false);
    expect(schema.properties.coverage.required).toEqual(expect.arrayContaining([
      'coverage_state', 'indexed_records', 'eligible_records', 'legal_completeness', 'tokenizer_id', 'integrity',
    ]));
    expect(schema.properties.tokenizer.required).toEqual(expect.arrayContaining([
      'tokenizer_id', 'strategy', 'upstream_tokenizer', 'upstream_commit',
    ]));
    expect(schema.properties.tokenizer.properties.tokenizer_id.const).toBe('country-laws-ir-fts5-unicode61/v1');
    expect(schema.properties.tokenizer.properties.strategy.const).toBe('fts5-unicode61');
    expect(schema.properties.pages.properties.full_corpus_bundled.const).toBe(false);
    expect(schema.properties.pages.properties.index_payload_bundled.const).toBe(false);
  });
});

describe('measured country IR reuse', () => {
  test('reuses checksums, shard bytes, and term ranges without bundling the corpus', () => {
    const index = prepareIndex({
      asOf: AS_OF,
      countryIr: compatibleRelease(),
      documents: [{ entry_cid: 'ignored', title: 'Ignored', body: CORPUS_SENTINEL }],
    });
    const bundle = pagesBundleDocument(index);

    expect(index.schema).toBe(INDEX_SCHEMA);
    expect(index.decision).toBe('reuse-country-ir');
    expect(index.format_version).toBe(REUSE_FORMAT);
    expect(index.compatibility).toMatchObject({ measured: true, compatible: true, reasons: [] });
    expect(index.compatibility.notes).toContain('supplied-documents-ignored');
    expect(index.tokenizer).toMatchObject({
      tokenizer_id: 'country-laws-ir-fts5-unicode61/v1',
      strategy: 'fts5-unicode61',
      upstream_tokenizer: UPSTREAM_TOKENIZER,
      upstream_commit: '2ea4ca6804b3c4cc44e43d0539f4c3fcae011747',
      matches_country_ir: true,
    });
    expect(index.bm25).toMatchObject({ k1: 1.2, b: 0.75, title_weight: 5, body_weight: 1, average_document_length: 12.5, n_docs: 2, n_terms: 4, n_postings: 5 });
    expect(index.coverage).toMatchObject({
      coverage_state: 'known',
      indexed_records: 2,
      eligible_records: 2,
      legal_completeness: 'not_claimed',
      jurisdiction_id: 'place:example',
      level: 'national',
      tokenizer_id: 'country-laws-ir-fts5-unicode61/v1',
    });
    const { integrity, ...coverage } = index.coverage;
    expect(integrity.sha256).toBe(checksumOf(coverage));
    expect(index.term_routing.map((route) => [route.first_key, route.last_key, route.sha256, route.size_bytes])).toEqual([
      ['act', 'law', SHA_A, 1200],
      ['rule', 'statute', SHA_B, 900],
    ]);
    expect(index.shards.map((shard) => shard.relative_path)).toEqual([
      'data/bm25/postings/part-000000.parquet',
      'data/bm25/postings/part-000001.parquet',
      'data/bm25/documents/part-000000.parquet',
    ]);
    expect(index.excluded_corpus_paths).toEqual([CORPUS_PATH]);
    expect(index.pages).toMatchObject({
      full_corpus_bundled: false,
      index_payload_bundled: false,
      bundled_roles: ['routing-manifest'],
      remote_shard_bytes: 3600,
      origin: 'unbundled',
    });
    expect(index.pages.remote_shard_bytes).not.toBe(3600 + 500_000);
    expect(index.offline).toEqual({ postings: [], document_summaries: [], posting_shards: [], summary_shards: [] });
    expect(index.checksums.routing_sha256).toBe(checksumOf(index.term_routing));
    expect(index.checksums.pages_bundle_sha256).toBe(checksumOf(bundle));
    expect(index.pages.bundled_bytes).toBe(utf8Size(canonicalJson(bundle)));
    expect(JSON.stringify(index)).not.toContain(CORPUS_SENTINEL);
    expect(JSON.stringify(bundle)).not.toContain('Ignored');
    expect(bundle).not.toHaveProperty('offline');
    expect(routeTerm(index, 'law')?.relative_path).toBe('data/bm25/postings/part-000000.parquet');
    expect(routeTerm(index, 'rule')?.relative_path).toBe('data/bm25/postings/part-000001.parquet');
    expect(routeTerm(index, 'mmm')).toBeNull();
    expect(routeQuery(index, 'mmm')).toEqual([{ term: 'mmm', route: null }]);
    expect(schemaProblems(loadIndexSchema(), index)).toEqual([]);
  });

  test('marks coverage partial when the published index count is below the corpus rows', () => {
    const release = compatibleRelease();
    release.counts = { bm25_documents: 2, corpus_rows: 4, bm25_terms: 4, bm25_postings: 5 };
    const index = prepareIndex({ asOf: AS_OF, countryIr: release });
    expect(index.coverage.coverage_state).toBe('partial');
    expect(index.coverage.indexed_records).toBe(2);
    expect(index.coverage.eligible_records).toBe(4);
    expect(index.coverage.legal_completeness).toBe('not_claimed');
  });

  test('accepts routing rows from indexes when keyword_shards is omitted and the pinned tokenizer id', () => {
    const release = compatibleRelease();
    release.indexes = { bm25_keyword_shards: release.keyword_shards };
    delete release.keyword_shards;
    (release.bm25 as { tokenizer: string }).tokenizer = 'country-laws-ir-fts5-unicode61/v1';
    expect(measureCountryIr(release).compatible).toBe(true);

    const blocked = compatibleRelease();
    blocked.keyword_shards = [];
    blocked.indexes = { bm25_keyword_shards: compatibleRelease().keyword_shards };
    expect(measureCountryIr(blocked).reasons).toContain('keyword-shards-missing');
  });

  test('does not reuse an incompatible release', () => {
    expect(measureCountryIr(null).reasons).toContain('country-ir-not-supplied');
    expect(reasonsFor((release) => { release.schema_version = 'other'; })).toContain('schema-version-mismatch');
    expect(reasonsFor((release) => { release.layout_family = 'other'; })).toContain('layout-family-mismatch');
    expect(reasonsFor((release) => { (release.bm25 as { tokenizer: string }).tokenizer = 'porter'; })).toContain('tokenizer-mismatch');
    expect(reasonsFor((release) => { delete (release.bm25 as { tokenizer?: string }).tokenizer; })).toContain('tokenizer-missing');
    expect(reasonsFor((release) => { (release.bm25 as { k1: number }).k1 = 1.5; })).toContain('bm25-constants-mismatch');
    expect(reasonsFor((release) => { delete (release.bm25 as { average_document_length?: number }).average_document_length; })).toContain('average-document-length-missing');
    expect(reasonsFor((release) => { delete release.keyword_shards; })).toContain('keyword-shards-missing');
    expect(reasonsFor((release) => { delete release.document_shards; })).toContain('document-shards-missing');
    expect(reasonsFor((release) => { delete (release.keyword_shards as Array<Record<string, unknown>>)[0]?.sha256; })).toContain('shard-checksum-missing');
    expect(reasonsFor((release) => { delete (release.keyword_shards as Array<Record<string, unknown>>)[0]?.size_bytes; })).toContain('shard-bytes-unmeasured');
    expect(reasonsFor((release) => { (release.keyword_shards as Array<Record<string, unknown>>)[0]!.size_bytes = 10 * 1024 * 1024 + 1; })).toContain('shard-exceeds-byte-cap');
    expect(reasonsFor((release) => { (release.keyword_shards as Array<Record<string, unknown>>)[0]!.sha256 = 'A'.repeat(64); })).toContain('shard-checksum-missing');
    expect(reasonsFor((release) => { (release.keyword_shards as Array<Record<string, unknown>>)[0]!.relative_path = '../secret.parquet'; })).toContain('shard-path-unsafe');
    expect(reasonsFor((release) => { (release.keyword_shards as Array<Record<string, unknown>>)[0]!.relative_path = CORPUS_PATH; })).toContain('shard-path-is-corpus');
    expect(reasonsFor((release) => { delete (release.keyword_shards as Array<Record<string, unknown>>)[0]?.first_key; delete (release.keyword_shards as Array<Record<string, unknown>>)[0]?.last_key; })).toContain('term-routing-missing');
    expect(reasonsFor((release) => { (release.keyword_shards as Array<Record<string, unknown>>)[0]!.first_key = 'z'; (release.keyword_shards as Array<Record<string, unknown>>)[0]!.last_key = 'a'; })).toContain('term-range-inverted');
    expect(reasonsFor((release) => { (release.keyword_shards as Array<Record<string, unknown>>)[1]!.first_key = 'law'; })).toContain('term-ranges-overlap');
    expect(reasonsFor((release) => { release.bundle_corpus_on_pages = true; })).toContain('full-corpus-bundle-requested');
    expect(reasonsFor((release) => { release.dataset_revision = 'main'; })).toContain('revision-not-pinned');

    expect(() => prepareIndex({ asOf: AS_OF, countryIr: { ...compatibleRelease(), bundle_corpus_on_pages: true } })).toThrow(IndexFormatError);
    try {
      prepareIndex({ asOf: AS_OF, countryIr: compatibleRelease(), sourceRevision: OTHER_REVISION });
      throw new Error('revision mismatch was reused');
    } catch (error) {
      expect(error).toBeInstanceOf(IndexFormatError);
      expect((error as IndexFormatError).code).toBe('country-ir-incompatible');
      expect((error as IndexFormatError).reasons).toContain('revision-mismatch');
    }
  });
});

describe('compact postings emission', () => {
  test('emits versioned postings, summaries, checksums, and term routing', () => {
    const index = compactPair();
    const act = index.offline.postings.find((row) => row.term === 'act');
    const rules = index.offline.postings.find((row) => row.term === 'rules');
    const bundle = JSON.stringify(pagesBundleDocument(index));

    expect(index.decision).toBe('emit-compact');
    expect(index.format_version).toBe(COMPACT_FORMAT);
    expect(index.compatibility.compatible).toBe(false);
    expect(index.compatibility.reasons).toContain('country-ir-not-supplied');
    expect(index.bm25).toMatchObject({
      k1: 1.2,
      b: 0.75,
      title_weight: 5,
      body_weight: 1,
      average_document_length: 7,
      n_docs: 2,
      max_query_terms: 64,
    });
    expect(act).toMatchObject({
      document_indices: [0],
      title_frequencies: [1],
      body_frequencies: [2],
      tfs: [7],
      document_lengths: [8],
      document_frequency: 1,
      corpus_frequency: 3,
      idf: idf(2, 1),
    });
    expect(rules).toMatchObject({
      document_frequency: 2,
      corpus_frequency: 2,
      idf: idf(2, 2),
    });
    expect(idf(2, 1)).toBe(Math.log((2 - 1 + 0.5) / (1 + 0.5) + 1));
    expect(idf(2, 2)).toBe(Math.log((2 - 2 + 0.5) / (2 + 0.5) + 1));
    expect(index.offline.document_summaries.map((row) => row.identity)).toEqual(['entry-act', 'entry-rules']);
    expect(index.offline.document_summaries[1]).toMatchObject({ law_id: 'act-1', article_number: '2', record_type: 'article', official_citation_invented: false });
    expect(index.offline.document_summaries.every((row) => !('body' in row) && !('text' in row))).toBe(true);
    expect(index.checksums.postings_sha256).toBe(checksumOf(index.offline.postings));
    expect(index.checksums.summaries_sha256).toBe(checksumOf(index.offline.document_summaries));
    expect(index.pages.full_corpus_bundled).toBe(false);
    expect(bundle).not.toContain('Act act rules');
    expect(schemaProblems(loadIndexSchema(), index)).toEqual([]);
    expect(checksumOf(prepareIndex(samePairInput()))).toBe(checksumOf(index));
  });

  test('folds diacritics with the pinned tokenizer and does not follow the row language', () => {
    const index = prepareIndex({
      asOf: AS_OF,
      documents: [{
        entry_cid: 'entry-cafe',
        title: 'Café règlement',
        body: 'Привет statute',
        language: 'fr',
      }],
    });
    const terms = index.offline.postings.map((row) => row.term);
    expect(terms).toEqual(tokenize('Café règlement Привет statute').sort());
    expect(terms).toEqual(['cafe', 'reglement', 'statute']);
    expect(JSON.stringify(index.offline.document_summaries)).not.toContain('Привет');
    expect(index.offline.document_summaries[0]?.text_sha256).toBe(sha256HexUtf8('Café règlement\nПривет statute'));
    expect(JSON.stringify(pagesBundleDocument(index))).not.toContain('Café');
    expect(JSON.stringify(pagesBundleDocument(index))).not.toContain('Привет');
  });

  test('keeps a missed term off every other shard and splits chunks, terms, and summaries', () => {
    const index = prepareIndex({
      asOf: AS_OF,
      termsPerShard: 1,
      postingRowsPerRecord: 1,
      summaryRowsPerShard: 1,
      documents: [
        { entry_cid: 'c1', title: 'aaaa', body: 'shared one' },
        { entry_cid: 'c2', title: 'shared', body: 'two' },
        { entry_cid: 'c3', title: 'shared', body: 'three zzzz' },
      ],
    });
    const shared = index.offline.postings.filter((row) => row.term === 'shared');
    expect(shared.map((row) => row.posting_chunk_index)).toEqual([0, 1, 2]);
    expect(shared.every((row) => row.document_frequency === 3 && row.posting_chunk_count === 3)).toBe(true);
    expect(postingShards(index).length).toBe(index.bm25.n_terms);
    expect(index.offline.summary_shards.map((shard) => shard.records.map((row) => row.document_index))).toEqual([[0], [1], [2]]);
    expect(index.shards.filter((shard) => shard.kind === 'document-summaries').map((shard) => shard.first_key)).toEqual(['00000000', '00000001', '00000002']);
    expect(routeTerm(index, 'aaaa')?.relative_path).toBe(postingShards(index).find((shard) => shard.first_key === 'aaaa')?.relative_path);
    expect(routeTerm(index, 'mmm')).toBeNull();
    expect(routeQuery(index, 'mmm mmm')).toEqual([{ term: 'mmm', route: null }]);
    const many = routeQuery(index, Array.from({ length: 70 }, (_, number) => `t${number}`).join(' '));
    expect(many).toHaveLength(64);
    expect(many[63]?.term).toBe('t63');
    expect(many.every((item) => item.route === null || item.term === 'aaaa' || item.term === 'shared')).toBe(true);
  });

  test('packs terms under a byte cap and refuses a term that cannot fit', () => {
    const documents = Array.from({ length: 12 }, (_, index) => ({
      entry_cid: `entry-${index}`,
      title: `term${String(index).padStart(4, '0')}`,
      body: 'shared',
    }));
    const input = { asOf: AS_OF, documents, postingRowsPerRecord: 1, summaryRowsPerShard: 1 };
    const solo = prepareIndex({ ...input, termsPerShard: 1 });
    const postingSizes = postingShards(solo).map((shard) => shard.size_bytes);
    const summarySizes = solo.shards.filter((shard) => shard.kind === 'document-summaries').map((shard) => shard.size_bytes);
    const cap = Math.max(...postingSizes, ...summarySizes);
    const packed = prepareIndex({ ...input, termsPerShard: 100, shardByteCap: cap });
    expect(postingShards(packed).every((shard) => shard.size_bytes <= cap)).toBe(true);
    expect(packed.offline.posting_shards.every((shard) => shard.size_bytes === utf8Size(canonicalJson(shard.records)) && shard.sha256 === checksumOf(shard.records))).toBe(true);
    expect(postingShards(packed).length).toBeGreaterThan(1);
    expect(packed.offline.postings).toEqual(solo.offline.postings);
    expect(() => prepareIndex({ ...input, shardByteCap: Math.min(...postingSizes) - 1 })).toThrow(/term-exceeds-shard-byte-cap/);
  });

  test('does not invent an identity and excludes blank, duplicate, and non-token rows', () => {
    const index = prepareIndex({
      asOf: AS_OF,
      documents: [
        { title: 'Missing identity', body: 'statute' },
        { entry_cid: 'entry-keep', title: 'First statute', body: 'alpha' },
        { entry_cid: 'entry-keep', title: 'Second statute', body: 'beta uniquebeta' },
        { entry_cid: 'entry-cyrillic', title: 'Привет', body: 'закон' },
        { entry_cid: 'entry-number', title: 12, body: null },
      ],
    });
    expect(index.offline.document_summaries.map((row) => row.identity)).toEqual(['entry-keep']);
    expect(index.offline.document_summaries[0]?.title).toBe('First statute');
    expect(index.coverage).toMatchObject({ coverage_state: 'partial', indexed_records: 1, eligible_records: 5, blocked_count: 4, legal_completeness: 'not_claimed' });
    expect(index.coverage.reason).toContain('missing-identity=1');
    expect(index.coverage.reason).toContain('duplicate-identity=1');
    expect(index.coverage.reason).toContain('no-searchable-tokens=2');
    expect(JSON.stringify(index)).not.toContain('uniquebeta');
    expect(JSON.stringify(index)).not.toContain('Missing identity');
  });

  test('falls through to compact postings when the measured release is incompatible', () => {
    const release = compatibleRelease();
    (release.bm25 as { tokenizer: string }).tokenizer = 'english-porter';
    const index = prepareIndex({
      asOf: AS_OF,
      countryIr: release,
      jurisdictionId: 'place:example',
      documents: [{ entry_cid: 'entry-local', title: `aaaa ${BODY_SENTINEL}`, body: 'zzzz rules' }],
    });
    expect(index.decision).toBe('emit-compact');
    expect(index.compatibility.reasons).toContain('tokenizer-mismatch');
    expect(index.compatibility.notes).toContain('country-ir-rejected');
    expect(index.shards.some((shard) => shard.sha256 === SHA_A)).toBe(false);
    expect(index.offline.postings.map((row) => row.term)).toContain(BODY_SENTINEL);
    const bundle = JSON.stringify(pagesBundleDocument(index));
    const routed = pagesBundleDocument(index);
    expect(bundle).not.toContain(BODY_SENTINEL);
    expect(bundle).not.toContain(CORPUS_SENTINEL);
    expect(routed.excluded_corpus_paths).toEqual([CORPUS_PATH]);
    expect(routed.shards.map((shard) => shard.relative_path)).not.toContain(CORPUS_PATH);
    expect(index.excluded_corpus_paths).toEqual([CORPUS_PATH]);
    expect(index.pages.full_corpus_bundled).toBe(false);
  });

  test('rejects a pages routing manifest that would carry the corpus or an unknown summary field', () => {
    const index = compactPair();
    const schema = loadIndexSchema();
    const bundled = cloneJson(index);
    (bundled.pages as { full_corpus_bundled: boolean }).full_corpus_bundled = true;
    expect(schemaProblems(schema, bundled).length).toBeGreaterThan(0);

    const extra = cloneJson(index);
    (extra.offline.document_summaries[0] as DocumentSummary & { body?: string }).body = 'secret body';
    expect(schemaProblems(schema, extra).some((problem) => problem.includes('body'))).toBe(true);

    const unmeasured = cloneJson(index);
    delete (unmeasured.shards[0] as { size_bytes?: number }).size_bytes;
    expect(schemaProblems(schema, unmeasured).some((problem) => problem.includes('size_bytes'))).toBe(true);

    const uncovered = cloneJson(index) as unknown as { coverage?: unknown };
    delete uncovered.coverage;
    expect(schemaProblems(schema, uncovered).some((problem) => problem.includes('coverage'))).toBe(true);
  });
});

describe('index preparation failures', () => {
  test('fails closed without an IR release, searchable rows, a date, or a budget', () => {
    expect(() => prepareIndex({ asOf: AS_OF })).toThrow(/no-index-input/);
    expect(() => prepareIndex({ asOf: AS_OF, documents: [{ title: 'Привет', body: '' }] })).toThrow(/no-searchable-documents/);
    expect(() => prepareIndex({ asOf: 'yesterday', documents: [{ entry_cid: 'e', title: 'Act', body: 'rules' }] })).toThrow(/invalid-as-of/);
    expect(() => prepareIndex({
      asOf: AS_OF,
      pagesBudgetBytes: 32,
      documents: [{ entry_cid: 'e', title: 'Act', body: 'rules' }],
    })).toThrow(/routing-exceeds-pages-budget/);
    expect(() => prepareIndex({ asOf: '2026-11-03T00:00:00Z', documents: [{ entry_cid: 'e', title: 'Act', body: 'rules' }] })).not.toThrow();
  });
});

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function samePairInput() {
  return {
    asOf: AS_OF,
    jurisdictionId: 'place:example',
    datasetId: 'endomorphosis/ipfs_example_laws',
    sourceRevision: REVISION,
    collectionId: 'example',
    documents: [
      { entry_cid: 'entry-act', title: 'Act', body: 'Act act rules', record_type: 'law' as const, jurisdiction_id: 'place:example' },
      { entry_cid: 'entry-rules', title: 'Rules', body: 'Other', record_type: 'article' as const, law_id: 'act-1', article_number: '2' },
    ],
  };
}


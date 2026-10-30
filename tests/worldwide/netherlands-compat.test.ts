import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  CURRENT_RECORD_STATUS,
  REMOTE_PROVIDER_LABEL,
  RETRIEVAL_CONTRACT_ID,
  SAMPLE_PROVIDER_LABEL,
  buildLawDeepLink,
  normalizeRecordStatus,
  readVersionMetadata,
  type CorpusManifest,
  type RetrievalProvider,
} from '../../src/lib/worldwide/contracts';
import {
  LEGACY_NETHERLANDS_PROFILE,
  NETHERLANDS_BUNDLED_SAMPLE_COUNTS,
  NETHERLANDS_CURRENT_SAMPLE,
  NETHERLANDS_DECLARED_SOURCE_IDS,
  NETHERLANDS_PROVIDER_STORAGE_KEY,
  NETHERLANDS_PUBLISHED_PARTIAL_CORPUS,
  NETHERLANDS_ROUTE_MIGRATION,
  NETHERLANDS_SAMPLE_PROVIDER,
  NETHERLANDS_UNIFIED_DATASET_ID,
  UNIFIED_NETHERLANDS_PROFILE,
  buildNetherlandsLegislationJsonLd,
  netherlandsSampleCoverage,
  preserveNetherlandsDeepLink,
  publisherDeepLinkRemains,
  readNetherlandsProviderMode,
  resolvePublisherDeepLink,
} from '../../src/lib/worldwide/adapters/netherlands';
import {
  __resetWetWijzerCorpusCacheForTests,
  buildGraphRagEvidence,
  buildSectionGraphRagEvidence,
  fetchCorpusJson,
  getRelatedGraph,
  getSection,
  getWetWijzerCorpusAssetUrl,
  loadWetWijzerCorpus,
  loadWetWijzerCorpusManifest,
  loadWetWijzerEmbeddings,
  searchCorpus,
  type SearchMode,
} from '../../src/lib/netherlandsCorpus';

const CORPUS_ROOT = join(process.cwd(), 'public/corpus/netherlands/current');
const CONTRACTS_PATH = join(process.cwd(), 'src/lib/worldwide/contracts.ts');
const ADAPTER_PATH = join(process.cwd(), 'src/lib/worldwide/adapters/netherlands.ts');
const CORPUS_PATH = join(process.cwd(), 'src/lib/netherlandsCorpus.ts');
const LOGIC_PATH = join(process.cwd(), 'src/lib/netherlandsLogic.ts');

const FORBIDDEN_CONTRACT_TOKENS = [
  'netherlands',
  'wetwijzer',
  'bwbr',
  'bwb',
  'wetten.overheid',
  'justicedao',
  'strafrecht',
  'burgerlijk',
  'rechtsvordering',
  'nederland',
  'dutch',
];

const RANKINGS: Array<{ query: string; hits: Array<[string, number]> }> = [
  {
    query: 'Wetboek van Strafrecht artikel 1',
    hits: [
      ['BWBR0001854', 1.46651306219146],
      ['BWBR0001827', 0.5569356301483368],
      ['BWBR0002656', 0.4849521052776313],
    ],
  },
  {
    query: 'Burgerlijk Wetboek',
    hits: [
      ['BWBR0002656', 4.138239802328455],
      ['BWBR0001827', 0.13494691975481787],
      ['BWBR0001854', 0.12945755352750327],
    ],
  },
  {
    query: 'rechtsvordering',
    hits: [['BWBR0001827', 3.9912267362592004]],
  },
  {
    query: 'BWBR0001854',
    hits: [['BWBR0001854', 2.9509056486825553]],
  },
  {
    query: 'strafbaar',
    hits: [['BWBR0001854', 0.9509056486825552]],
  },
  {
    query: 'Artikel 1',
    hits: [
      ['BWBR0002656', 3.2121665460589637],
      ['BWBR0001827', 3.2109943551967595],
      ['BWBR0001854', 3.206432315084397],
    ],
  },
];

function installStaticCorpusFetch(): () => void {
  const original = globalThis.fetch;
  const replacement = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes('huggingface.co') || url.includes('datasets-server.huggingface.co')) {
      throw new Error(`remote fetch refused: ${url}`);
    }
    const marker = '/corpus/netherlands/current/';
    const pathOnly = url.split('?')[0];
    const index = pathOnly.indexOf(marker);
    if (index === -1) {
      throw new Error(`unexpected fetch: ${url}`);
    }
    const relative = decodeURIComponent(pathOnly.slice(index + marker.length));
    const body = readFileSync(join(CORPUS_ROOT, relative));
    return {
      ok: true,
      status: 200,
      json: async () => JSON.parse(body.toString('utf8')),
      arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
      text: async () => body.toString('utf8'),
    } as Response;
  }) as typeof fetch;
  globalThis.fetch = replacement;
  return () => {
    globalThis.fetch = original;
  };
}

function useStaticSampleProvider(): void {
  window.localStorage.setItem(NETHERLANDS_PROVIDER_STORAGE_KEY, 'static');
  __resetWetWijzerCorpusCacheForTests();
}

function expectRanking(
  actual: Array<{ lawId?: string; score: number }>,
  expected: Array<[string, number]>,
): void {
  expect(actual.map((item) => item.lawId)).toEqual(expected.map(([lawId]) => lawId));
  actual.forEach((item, index) => {
    expect(item.score).toBeCloseTo(expected[index][1], 8);
  });
}

describe('worldwide retrieval contracts', () => {
  test('keeps generic contracts free of Dutch catalog names', () => {
    const source = readFileSync(CONTRACTS_PATH, 'utf8').toLowerCase();
    for (const token of FORBIDDEN_CONTRACT_TOKENS) {
      expect(source).not.toContain(token);
    }
    expect(RETRIEVAL_CONTRACT_ID).toBe('worldwide-legal-search.retrieval-contract@1');
    expect(SAMPLE_PROVIDER_LABEL).toBe('static-sample');
    expect(REMOTE_PROVIDER_LABEL).toBe('huggingface');
    expect(CURRENT_RECORD_STATUS).toBe('current');
    expect(normalizeRecordStatus('current')).toBe('current');
    expect(normalizeRecordStatus('not-a-status')).toBe('unknown');
  });

  test('accepts a provider that does not use Dutch names', async () => {
    const manifest: CorpusManifest = {
      schemaVersion: 2,
      generatedAt: '2026-01-02T03:04:05Z',
      datasetId: 'example/source',
      datasetPath: 'example/source',
      provider: SAMPLE_PROVIDER_LABEL,
      corpus: {
        jurisdiction: 'example-jurisdiction',
        name: 'Example corpus',
        source: 'example publisher',
        publishedCorpus: { articles: 100 },
        sourceIds: { primary: 'example/source' },
      },
      artifacts: [],
      generatedFiles: [],
      counts: { articles: 1 },
      backend: { baseCorpus: 'example/source', vectorIndex: 'example/source', bm25Index: 'example/source', knowledgeGraph: 'example/source', release: 'abc123' },
    };
    const provider: RetrievalProvider = {
      async loadManifest() {
        return manifest;
      },
      async loadInitialCorpus() {
        return { sections: [], sectionByCid: new Map(), manifest };
      },
      async getSection() {
        return null;
      },
      async search() {
        return [];
      },
      async getRelatedGraph() {
        return { entities: [], relationships: [] };
      },
    };
    const loaded = await provider.loadManifest();
    const version = readVersionMetadata(loaded);
    expect(version.schemaVersion).toBe(2);
    expect(version.release).toBe('abc123');
    expect(version.datasetId).toBe('example/source');
    expect(version.sourceIds.primary).toBe('example/source');
    const link = buildLawDeepLink({
      publisherUrl: 'https://example.test/record',
      recordId: 'record-1',
      sourceRevision: version.release,
      sectionId: 'section-1',
    });
    expect(link.publisherUrl).toBe('https://example.test/record');
    expect(link.applicationRoute).toBe('/#/law/record-1?revision=abc123&section=section-1');
    expect(link.replacesPublisherUrl).toBe(false);
    expect(link.target).toBe('_blank');
    expect(link.rel).toBe('noreferrer');
    expect(await provider.search('parking')).toEqual([]);
  });
});

describe('Netherlands compatibility adapter', () => {
  test('pins source ids, published counts, and publisher-link fallbacks', () => {
    const adapterSource = readFileSync(ADAPTER_PATH, 'utf8');
    const corpusSource = readFileSync(CORPUS_PATH, 'utf8');
    expect(adapterSource).toContain(NETHERLANDS_UNIFIED_DATASET_ID);
    expect(corpusSource).not.toContain('justicedao/');
    expect(corpusSource).not.toContain('wetten.overheid.nl');
    expect(NETHERLANDS_DECLARED_SOURCE_IDS).toEqual({
      unified: NETHERLANDS_UNIFIED_DATASET_ID,
      compatBase: 'justicedao/ipfs_netherlands_laws',
      compatVectorIndex: 'justicedao/ipfs_netherlands_laws_vector_index',
      compatBm25Index: 'justicedao/ipfs_netherlands_laws_bm25_index',
      compatKnowledgeGraph: 'justicedao/ipfs_netherlands_laws_knowledge_graph',
    });
    expect(UNIFIED_NETHERLANDS_PROFILE.datasetId).toBe(NETHERLANDS_UNIFIED_DATASET_ID);
    expect(UNIFIED_NETHERLANDS_PROFILE.datasets.logic).toBe(NETHERLANDS_UNIFIED_DATASET_ID);
    expect(LEGACY_NETHERLANDS_PROFILE.datasets).toMatchObject({
      base: NETHERLANDS_DECLARED_SOURCE_IDS.compatBase,
      vector: NETHERLANDS_DECLARED_SOURCE_IDS.compatVectorIndex,
      bm25: NETHERLANDS_DECLARED_SOURCE_IDS.compatBm25Index,
      graph: NETHERLANDS_DECLARED_SOURCE_IDS.compatKnowledgeGraph,
    });
    expect(LEGACY_NETHERLANDS_PROFILE.configs.vectorIndex).toBe('mapping');
    expect(NETHERLANDS_PUBLISHED_PARTIAL_CORPUS).toMatchObject({
      laws: 4999,
      articles: 89737,
      cidRows: 94736,
      relationshipRows: 261720,
    });
    expect(NETHERLANDS_BUNDLED_SAMPLE_COUNTS).toEqual({ articles: 3, laws: 3, cidRows: 3 });
    expect(resolvePublisherDeepLink({ lawIdentifier: 'BWBR0001854' })).toBe('https://wetten.overheid.nl/BWBR0001854/');
    expect(resolvePublisherDeepLink({ sourceUrl: 'https://wetten.overheid.nl/BWBR0001854' })).toBe('https://wetten.overheid.nl/BWBR0001854');
    expect(resolvePublisherDeepLink({})).toBe('https://wetten.overheid.nl/');
    expect(buildNetherlandsLegislationJsonLd('Title', 'Cite', 'https://wetten.overheid.nl/BWBR0001854', 'current')).toBe(
      '{"@context":"https://schema.org","@type":"Legislation","name":"Title","identifier":"Cite","legislationJurisdiction":"Netherlands","url":"https://wetten.overheid.nl/BWBR0001854","lawStatus":"current"}',
    );
    expect(readNetherlandsProviderMode('static-sample')).toBe('static');
    expect(readNetherlandsProviderMode('hf')).toBe('huggingface');
    expect(readNetherlandsProviderMode('other')).toBeNull();
    expect(NETHERLANDS_ROUTE_MIGRATION.some((row) => row.surface === 'section.source_url')).toBe(true);
  });
});

describe('bundled Netherlands sample', () => {
  let restoreFetch: () => void;

  beforeAll(() => {
    restoreFetch = installStaticCorpusFetch();
  });

  afterAll(() => {
    restoreFetch();
  });

  beforeEach(() => {
    useStaticSampleProvider();
  });

  test('preserves version metadata, source ids, current sample labels, and publisher deep links', async () => {
    const manifest = await loadWetWijzerCorpusManifest();
    const state = await loadWetWijzerCorpus();
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.generatedAt).toBe('2026-06-27T00:00:00Z');
    expect(manifest.datasetId).toBe(NETHERLANDS_UNIFIED_DATASET_ID);
    expect(manifest.datasetPath).toBe('netherlands_laws_quality_audited_partial');
    expect(manifest.provider).toBe(NETHERLANDS_SAMPLE_PROVIDER);
    expect(manifest.counts).toEqual({ articles: 3, laws: 3, cidRows: 3 });
    expect(manifest.corpus.hfDatasets).toEqual(NETHERLANDS_DECLARED_SOURCE_IDS);
    expect(manifest.corpus.publishedCorpus).toMatchObject(NETHERLANDS_PUBLISHED_PARTIAL_CORPUS);
    expect(manifest.corpus.note).toContain('Browser sample cache');
    expect(getWetWijzerCorpusAssetUrl('generated/sections.json', manifest)).toBe(
      '/corpus/netherlands/current/generated/sections.json?v=2026-06-27T00%3A00%3A00Z',
    );

    expect(state.sections).toHaveLength(3);
    expect(state.manifest.provider).toBe('static-sample');
    expect(state.manifest.schemaVersion).toBe(1);
    expect(state.manifest.generatedAt).toBe(manifest.generatedAt);
    expect(state.manifest.counts).toEqual({ laws: 3, articles: 3, cidRows: 3 });
    const version = readVersionMetadata(state.manifest);
    expect(version.datasetId).toBe(NETHERLANDS_UNIFIED_DATASET_ID);
    expect(version.generatedAt).toBe('2026-06-27T00:00:00Z');
    expect(version.provider).toBe('static-sample');

    const coverage = netherlandsSampleCoverage(state.manifest);
    expect(coverage.state).toBe('partial');
    expect(coverage.indexedRecords).toBe(3);
    expect(coverage.eligibleRecords).toBe(NETHERLANDS_PUBLISHED_PARTIAL_CORPUS.articles);
    expect(coverage.jurisdictionId).toBe('netherlands');
    expect(coverage.reason).toContain('static-sample');
    expect(coverage.sourceIds).toEqual(expect.arrayContaining(Object.values(NETHERLANDS_DECLARED_SOURCE_IDS)));
    expect(coverage.indexedRecords).not.toBe(coverage.eligibleRecords);

    for (const expected of NETHERLANDS_CURRENT_SAMPLE) {
      const section = state.sectionByCid.get(expected.ipfsCid);
      expect(section).toBeDefined();
      expect(section?.law_id).toBe(expected.lawId);
      expect(section?.identifier).toBe(expected.identifier);
      expect(section?.title).toBe(expected.title);
      expect(section?.source_url).toBe(expected.publisherUrl);
      expect(section?.law_status).toBe('current');
      expect(section?.is_current).toBe(true);
      expect(section?.provider).toBe('static-sample');
      expect(section?.cid).toBe(expected.ipfsCid);
      expect(section?.content_address).toBe(`ipfs://${expected.ipfsCid}`);
      const link = preserveNetherlandsDeepLink(section!, state.manifest);
      expect(publisherDeepLinkRemains(link)).toBe(true);
      expect(link.publisherUrl).toBe(section?.source_url);
      expect(link.applicationRoute).toBe(
        `/#/law/${expected.lawId}?revision=2026-06-27T00%3A00%3A00Z&section=${expected.ipfsCid}`,
      );
      expect(link.applicationRoute).not.toBe(link.publisherUrl);
    }

    const first = NETHERLANDS_CURRENT_SAMPLE[0];
    const loaded = await getSection(first.ipfsCid);
    expect(loaded?.source_url).toBe(first.publisherUrl);
    expect(loaded?.law_status).toBe('current');
    expect(await getSection('missing-cid')).toBeNull();

    const graph = await getRelatedGraph(first.ipfsCid, 1);
    const sourceEdge = graph.relationships.find((relationship) => relationship.type === 'sourced_from');
    expect(sourceEdge?.properties?.url).toBe(first.publisherUrl);
    const statusEdge = graph.relationships.find((relationship) => relationship.type === 'has_law_status');
    expect(statusEdge?.target).toBe('netherlands_status:current');
  });

  test('keeps the recorded static keyword and hybrid rankings', async () => {
    for (const ranking of RANKINGS) {
      for (const mode of ['keyword', 'hybrid'] as SearchMode[]) {
        const results = await searchCorpus(ranking.query, {}, mode);
        expectRanking(
          results.map((result) => ({
            lawId: result.section.law_id,
            score: result.score,
          })),
          ranking.hits,
        );
        for (const result of results) {
          expect(result.section.provider).toBe('static-sample');
          expect(result.section.law_status).toBe('current');
          expect(result.section.source_url.startsWith('https://wetten.overheid.nl/')).toBe(true);
        }
      }
    }
    expect(await searchCorpus('legaliteitsbeginsel', {}, 'keyword')).toEqual([]);
    const filtered = await searchCorpus('Artikel 1', { titleNumber: 'BWBR0001854' }, 'keyword');
    expect(filtered.map((result) => result.section.law_id)).toEqual(['BWBR0001854']);
  });

  test('keeps corpus and logic exports usable', async () => {
    expect(typeof loadWetWijzerCorpus).toBe('function');
    expect(typeof loadWetWijzerCorpusManifest).toBe('function');
    expect(typeof loadWetWijzerEmbeddings).toBe('function');
    expect(typeof fetchCorpusJson).toBe('function');
    expect(typeof searchCorpus).toBe('function');
    expect(typeof getSection).toBe('function');
    expect(typeof getRelatedGraph).toBe('function');
    expect(typeof buildGraphRagEvidence).toBe('function');
    expect(typeof buildSectionGraphRagEvidence).toBe('function');
    expect(typeof getWetWijzerCorpusAssetUrl).toBe('function');
    expect(typeof __resetWetWijzerCorpusCacheForTests).toBe('function');

    const logicSource = readFileSync(LOGIC_PATH, 'utf8');
    const logicExportNames = [
      'validateLogicProofSummary',
      'normalizeLogicProofSummary',
      'loadLogicProofSummaries',
      'buildLogicProofIndexes',
      'loadLogicProofIndexes',
      'getLogicProofForSection',
      'getLogicProofForIdentifier',
      'searchCorpusWithLogic',
      'filterLogicProofSummaries',
      'parseLogicProofTdfol',
      'explainLogicProofSummary',
      'buildLogicEvidenceItem',
      'buildLogicEvidenceForSearchResults',
      'getSimulatedCertificateWarning',
      '__resetWetWijzerLogicCacheForTests',
    ];
    for (const name of logicExportNames) {
      const exported = logicSource.includes(`export async function ${name}`) || logicSource.includes(`export function ${name}`);
      expect(exported).toBe(true);
    }
    expect(logicSource).toContain('export interface LogicProofSummary');
    expect(logicSource).toContain('export interface LogicAwareSearchResult');
    expect(logicSource).toContain('from \'./netherlandsCorpus\'');

    const logic = await import('../../src/lib/netherlandsLogic');
    logic.__resetWetWijzerLogicCacheForTests();
    window.localStorage.setItem(NETHERLANDS_PROVIDER_STORAGE_KEY, 'static-sample');
    for (const name of logicExportNames) {
      expect(typeof logic[name as keyof typeof logic]).toBe('function');
    }
    const proofs = await logic.loadLogicProofSummaries();
    expect(proofs.map((proof) => [proof.ipfs_cid, proof.norm_operator, proof.norm_type])).toEqual([
      [NETHERLANDS_CURRENT_SAMPLE[0].ipfsCid, 'O', 'obligation'],
      [NETHERLANDS_CURRENT_SAMPLE[1].ipfsCid, 'P', 'permission'],
      [NETHERLANDS_CURRENT_SAMPLE[2].ipfsCid, 'F', 'prohibition'],
    ]);
    const explained = logic.explainLogicProofSummary(proofs[0]);
    expect(explained.normLabel).toBe('obligation');
    expect(explained.caveats.length).toBeGreaterThan(0);
    const evidence = await logic.buildLogicEvidenceForSearchResults(await searchCorpus('strafbaar', {}, 'keyword'));
    expect(evidence.map((item) => item.normOperator)).toEqual(['O']);
    const logicResults = await logic.searchCorpusWithLogic('strafbaar', {}, 'keyword');
    expect(logicResults.map((result) => result.section.law_id)).toEqual(['BWBR0001854']);
    expect(logicResults[0].logic?.normOperator).toBe('O');
    expect(logicResults[0].section.source_url).toBe(NETHERLANDS_CURRENT_SAMPLE[0].publisherUrl);
  });
});

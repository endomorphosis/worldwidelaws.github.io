/**
 * Netherlands catalog, sample labels, version metadata, and publisher links.
 * Generic retrieval types stay in ../contracts.
 */

import {
  CURRENT_RECORD_STATUS,
  SAMPLE_PROVIDER_LABEL,
  buildLawDeepLink,
  labelBundledSampleManifest,
  labelBundledSampleSection,
  readVersionMetadata,
  sourceRevisionOf,
  type CorpusManifest,
  type CoverageCell,
  type DeepLink,
  type RetrievalDatasetProfile,
  type RetrievalOrigin,
  type SampleSectionLabel,
} from '../contracts';

export const NETHERLANDS_JURISDICTION_ID = 'netherlands';
export const NETHERLANDS_JURISDICTION_LABEL = 'Netherlands';
export const NETHERLANDS_SAMPLE_PROVIDER: RetrievalOrigin = SAMPLE_PROVIDER_LABEL;
export const NETHERLANDS_CURRENT_SAMPLE_STATUS = CURRENT_RECORD_STATUS;

export const NETHERLANDS_CORPUS_BASE_URL = '/corpus/netherlands/current';
export const NETHERLANDS_DATASET_VIEWER_API = 'https://datasets-server.huggingface.co';
export const NETHERLANDS_HUB_DATASETS_API = 'https://huggingface.co/api/datasets';
export const NETHERLANDS_REQUEST_TIMEOUT_MS = 9000;
export const NETHERLANDS_INITIAL_REMOTE_LIMIT = 80;
export const NETHERLANDS_PUBLISHER_ORIGIN = 'https://wetten.overheid.nl';
export const NETHERLANDS_PROVIDER_STORAGE_KEY = 'WETWIJZER_DATA_PROVIDER';
export const NETHERLANDS_PROVIDER_ENV_KEY = 'VITE_WETWIJZER_DATA_PROVIDER';

export const NETHERLANDS_UNIFIED_DATASET_ID = 'justicedao/wetwijzer_netherlands_legal_corpus';
export const NETHERLANDS_LEGACY_DATASETS = {
  base: 'justicedao/ipfs_netherlands_laws',
  vector: 'justicedao/ipfs_netherlands_laws_vector_index',
  bm25: 'justicedao/ipfs_netherlands_laws_bm25_index',
  graph: 'justicedao/ipfs_netherlands_laws_knowledge_graph',
} as const;

export const NETHERLANDS_DECLARED_SOURCE_IDS: Record<string, string> = {
  unified: NETHERLANDS_UNIFIED_DATASET_ID,
  compatBase: NETHERLANDS_LEGACY_DATASETS.base,
  compatVectorIndex: NETHERLANDS_LEGACY_DATASETS.vector,
  compatBm25Index: NETHERLANDS_LEGACY_DATASETS.bm25,
  compatKnowledgeGraph: NETHERLANDS_LEGACY_DATASETS.graph,
};

export const NETHERLANDS_PUBLISHED_PARTIAL_CORPUS = {
  laws: 4999,
  articles: 89737,
  cidRows: 94736,
  relationshipRows: 261720,
  coverage: 'quality-audited partial corpus, not full Dutch corpus coverage',
} as const;

export const NETHERLANDS_BUNDLED_SAMPLE_COUNTS = {
  articles: 3,
  laws: 3,
  cidRows: 3,
} as const;

export interface NetherlandsDatasetProfile extends RetrievalDatasetProfile {
  id: 'unified' | 'legacy-four-repo';
}

export const UNIFIED_NETHERLANDS_PROFILE: NetherlandsDatasetProfile = {
  id: 'unified',
  datasetId: NETHERLANDS_UNIFIED_DATASET_ID,
  datasets: {
    base: NETHERLANDS_UNIFIED_DATASET_ID,
    vector: NETHERLANDS_UNIFIED_DATASET_ID,
    bm25: NETHERLANDS_UNIFIED_DATASET_ID,
    graph: NETHERLANDS_UNIFIED_DATASET_ID,
    logic: NETHERLANDS_UNIFIED_DATASET_ID,
  },
  configs: {
    laws: 'laws',
    articles: 'articles',
    cidIndex: 'cid_index',
    vectorIndex: 'vector_index',
    bm25Documents: 'bm25_documents',
    graphNodes: 'knowledge_graph_nodes',
    graphEdges: 'knowledge_graph_edges',
    logicRelationships: 'logic_relationships',
  },
};

export const LEGACY_NETHERLANDS_PROFILE: NetherlandsDatasetProfile = {
  id: 'legacy-four-repo',
  datasetId: NETHERLANDS_LEGACY_DATASETS.base,
  datasets: { ...NETHERLANDS_LEGACY_DATASETS },
  configs: {
    laws: 'laws',
    articles: 'articles',
    cidIndex: 'cid_index',
    vectorIndex: 'mapping',
    bm25Documents: 'documents',
    graphNodes: 'nodes',
    graphEdges: 'edges',
  },
};

export interface NetherlandsSampleArticle {
  ipfsCid: string;
  lawId: string;
  identifier: string;
  title: string;
  publisherUrl: string;
  lawStatus: typeof NETHERLANDS_CURRENT_SAMPLE_STATUS;
  provider: typeof NETHERLANDS_SAMPLE_PROVIDER;
}

export const NETHERLANDS_CURRENT_SAMPLE: readonly NetherlandsSampleArticle[] = [
  {
    ipfsCid: 'bafywetwijzer000000000000000000000000000000000000000000000001',
    lawId: 'BWBR0001854',
    identifier: 'BWBR0001854 Artikel 1',
    title: 'Wetboek van Strafrecht - Artikel 1',
    publisherUrl: 'https://wetten.overheid.nl/BWBR0001854',
    lawStatus: NETHERLANDS_CURRENT_SAMPLE_STATUS,
    provider: NETHERLANDS_SAMPLE_PROVIDER,
  },
  {
    ipfsCid: 'bafywetwijzer000000000000000000000000000000000000000000000002',
    lawId: 'BWBR0002656',
    identifier: 'BWBR0002656 Artikel 1',
    title: 'Burgerlijk Wetboek Boek 1 - Artikel 1',
    publisherUrl: 'https://wetten.overheid.nl/BWBR0002656',
    lawStatus: NETHERLANDS_CURRENT_SAMPLE_STATUS,
    provider: NETHERLANDS_SAMPLE_PROVIDER,
  },
  {
    ipfsCid: 'bafywetwijzer000000000000000000000000000000000000000000000003',
    lawId: 'BWBR0001827',
    identifier: 'BWBR0001827 Artikel 1',
    title: 'Wetboek van Burgerlijke Rechtsvordering - Artikel 1',
    publisherUrl: 'https://wetten.overheid.nl/BWBR0001827',
    lawStatus: NETHERLANDS_CURRENT_SAMPLE_STATUS,
    provider: NETHERLANDS_SAMPLE_PROVIDER,
  },
];

export interface NetherlandsRouteMigration {
  surface: string;
  preservation: string;
  applicationRoute: string;
}

export const NETHERLANDS_ROUTE_MIGRATION: readonly NetherlandsRouteMigration[] = [
  {
    surface: 'section.source_url',
    preservation: 'Publisher link stays on wetten.overheid.nl and opens in a new tab with rel=noreferrer.',
    applicationRoute: '/#/law/<record-id>?revision=<source-revision>&section=<section-id>',
  },
  {
    surface: 'graph relationship properties.url',
    preservation: 'Bundled graph edges keep the same publisher URL as the article.',
    applicationRoute: '/#/law/<record-id>?revision=<source-revision>&section=<section-id>',
  },
];

export type NetherlandsProviderMode = 'huggingface' | 'static';

export function readNetherlandsProviderMode(value?: string | null): NetherlandsProviderMode | null {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'static' || normalized === 'static-sample') return 'static';
  if (normalized === 'hf' || normalized === 'huggingface') return 'huggingface';
  return null;
}

export function readConfiguredNetherlandsProviderMode(
  storageValue?: string | null,
  envValue?: string | null,
): NetherlandsProviderMode {
  return readNetherlandsProviderMode(storageValue) || readNetherlandsProviderMode(envValue) || 'huggingface';
}

export function netherlandsRemoteCorpusDescriptor(): CorpusManifest['corpus'] {
  return {
    jurisdiction: NETHERLANDS_JURISDICTION_LABEL,
    name: 'WetWijzer Netherlands legal corpus',
    source: 'Hugging Face Dataset Viewer backed by wetten.overheid.nl and official BWB/SRU metadata',
  };
}

export function resolvePublisherDeepLink(input: {
  sourceUrl?: string;
  canonicalDocumentUrl?: string;
  canonicalLawUrl?: string;
  lawIdentifier?: string;
}): string {
  const explicit = input.sourceUrl || input.canonicalDocumentUrl || input.canonicalLawUrl;
  if (explicit) return explicit;
  if (input.lawIdentifier) return `${NETHERLANDS_PUBLISHER_ORIGIN}/${input.lawIdentifier}/`;
  return `${NETHERLANDS_PUBLISHER_ORIGIN}/`;
}

export function preserveNetherlandsDeepLink(
  section: { source_url: string; law_id?: string; identifier?: string; ipfs_cid?: string },
  manifest: CorpusManifest,
): DeepLink {
  const version = readVersionMetadata(manifest);
  return buildLawDeepLink({
    publisherUrl: section.source_url,
    recordId: section.law_id || section.identifier || section.ipfs_cid || null,
    sourceRevision: sourceRevisionOf(version),
    sectionId: section.ipfs_cid || null,
  });
}

export function publisherDeepLinkRemains(link: DeepLink): boolean {
  return link.replacesPublisherUrl === false
    && link.target === '_blank'
    && link.rel === 'noreferrer'
    && Boolean(link.publisherUrl)
    && link.publisherUrl !== link.applicationRoute;
}

export function labelNetherlandsSampleSection<T extends SampleSectionLabel>(section: T): T {
  return labelBundledSampleSection(section);
}

export function labelNetherlandsSampleManifest<T extends CorpusManifest>(
  manifest: T,
  fallbackCounts: NonNullable<CorpusManifest['counts']> = NETHERLANDS_BUNDLED_SAMPLE_COUNTS,
): T {
  return labelBundledSampleManifest(manifest, fallbackCounts);
}

export function netherlandsSampleCoverage(manifest: CorpusManifest): CoverageCell {
  const version = readVersionMetadata(manifest);
  const indexed = manifest.counts?.articles ?? null;
  const eligible = manifest.corpus.publishedCorpus?.articles ?? null;
  const labelledSample = manifest.provider === NETHERLANDS_SAMPLE_PROVIDER;
  const sourceIds = [...new Set(Object.values(version.sourceIds).filter((value) => Boolean(value)))];
  let state: CoverageCell['state'] = 'unknown';
  if (labelledSample) state = 'partial';
  else if (indexed !== null && eligible !== null && indexed > 0 && indexed >= eligible) state = 'verified';
  else if (indexed !== null && indexed > 0) state = 'partial';
  else if (indexed === 0) state = 'missing';
  const reason = labelledSample
    ? 'Bundled records use the static-sample label and current sample status. Those counts are not the published partial corpus.'
    : 'Retrieved record counts are not a claim of legal completeness.';
  return {
    jurisdictionId: NETHERLANDS_JURISDICTION_ID,
    level: 'national',
    sourceIds,
    state,
    indexedRecords: indexed,
    eligibleRecords: eligible,
    retrievedAt: version.generatedAt,
    verifiedAt: null,
    reason,
  };
}

export function buildNetherlandsLegislationJsonLd(
  title: string,
  citation: string,
  sourceUrl: string,
  status: string,
): string {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Legislation',
    name: title,
    identifier: citation,
    legislationJurisdiction: NETHERLANDS_JURISDICTION_LABEL,
    url: sourceUrl,
    lawStatus: status,
  });
}

/**
 * Jurisdiction-neutral retrieval boundary.
 * Source catalogs, publisher hosts, and sample articles live in adapters.
 */

export const RETRIEVAL_CONTRACT_ID = 'worldwide-legal-search.retrieval-contract@1';

export const SAMPLE_PROVIDER_LABEL = 'static-sample' as const;
export const REMOTE_PROVIDER_LABEL = 'huggingface' as const;
export const CURRENT_RECORD_STATUS = 'current' as const;

export type SearchMode = 'keyword' | 'vector' | 'hybrid';
export type LegalRecordStatus = 'current' | 'historical' | 'repealed' | 'superseded' | 'unknown';
export type RetrievalOrigin = typeof REMOTE_PROVIDER_LABEL | typeof SAMPLE_PROVIDER_LABEL;
export type CoverageState = 'verified' | 'partial' | 'missing' | 'unknown' | 'unavailable';
export type DatePrecision = 'day' | 'month' | 'year';

const RECORD_STATUSES: readonly LegalRecordStatus[] = [
  'current',
  'historical',
  'repealed',
  'superseded',
  'unknown',
];

export interface DateKnowledge {
  value: string;
  precision: DatePrecision;
  source: string;
}

export interface JurisdictionScope {
  placeId: string;
  asOf: string;
  issuerIds: string[];
  territorialIds: string[];
  uncertainty: string[];
  relationshipEvidence: string[];
}

export interface LawIdentity {
  sourceId: string;
  sourceRecordId: string;
  sourceRevision: string;
}

export interface CoverageCell {
  jurisdictionId: string;
  level: string;
  sourceIds: string[];
  state: CoverageState;
  indexedRecords: number | null;
  eligibleRecords: number | null;
  retrievedAt: string | null;
  verifiedAt: string | null;
  reason: string;
}

export interface CorpusHierarchyItem {
  kind: string;
  label: string;
  number?: string | null;
}

export interface CorpusSection {
  ipfs_cid: string;
  cid?: string;
  law_cid?: string | null;
  content_address?: string;
  identifier: string;
  law_id?: string;
  law_identifier?: string;
  article_identifier?: string | null;
  article_number?: string | null;
  article_heading?: string | null;
  title: string;
  text: string;
  source_url: string;
  official_cite: string;
  bluebook_citation: string;
  citation?: string;
  document_citation?: string;
  chapter: string;
  title_number: string;
  hierarchy_path?: CorpusHierarchyItem[];
  hierarchy_path_text?: string;
  hierarchy_labels?: string[];
  book_label?: string | null;
  title_label?: string | null;
  chapter_label?: string | null;
  division_label?: string | null;
  paragraph_label?: string | null;
  article_label?: string | null;
  book_number?: string | null;
  chapter_number?: string | null;
  division_number?: string | null;
  paragraph_number?: string | null;
  version_start_date?: string | null;
  version_end_date?: string | null;
  scraped_at?: string | null;
  jsonld: string;
  law_status?: LegalRecordStatus;
  is_current?: boolean | null;
  valid_from?: string | null;
  valid_to?: string | null;
  effective_date?: string | null;
  retrieved_at?: string | null;
  status_source?: string | null;
  status_confidence?: string | number | null;
  status_note?: string | null;
  provider?: RetrievalOrigin;
  jurisdiction?: string;
}

export interface CorpusEntity {
  id: string;
  type: string;
  label: string;
  properties: Record<string, unknown>;
}

export interface CorpusRelationship {
  id: string;
  source: string;
  target: string;
  type: string;
  properties?: Record<string, unknown>;
}

export interface SearchFilters {
  titleNumber?: string;
  entityTypes?: string[];
  limit?: number;
}

export interface SearchResult {
  ipfs_cid: string;
  section: CorpusSection;
  score: number;
  scoreParts: {
    keyword: number;
    vector: number;
    title: number;
    citation: number;
    bm25?: number;
    graph?: number;
  };
  snippet: string;
  citation: string;
}

export interface GraphRagEvidence {
  sections: SearchResult[];
  entities: CorpusEntity[];
  relationships: CorpusRelationship[];
}

export interface RetrievalDatasetProfile {
  id: string;
  datasetId: string;
  datasets: {
    base: string;
    vector: string;
    bm25: string;
    graph: string;
    logic?: string;
  };
  configs: {
    laws: string;
    articles: string;
    cidIndex: string;
    vectorIndex: string;
    bm25Documents: string;
    graphNodes: string;
    graphEdges: string;
    logicRelationships?: string;
  };
}

export interface CorpusArtifact {
  id: string;
  path: string;
  bytes: number;
  role: string;
  sourceUrl?: string;
}

export interface PublishedCorpusMetadata {
  laws?: number;
  articles?: number;
  cidRows?: number;
  relationshipRows?: number;
  coverage?: string;
}

export interface CorpusManifest {
  schemaVersion: number;
  generatedAt: string;
  datasetId: string;
  datasetPath: string;
  corpus: {
    jurisdiction: string;
    name: string;
    source: string;
    note?: string;
    publishedCorpus?: PublishedCorpusMetadata;
    hfDatasets?: Record<string, string>;
    sourceIds?: Record<string, string>;
  };
  artifacts: CorpusArtifact[];
  generatedFiles: string[];
  provider?: RetrievalOrigin;
  backend?: {
    baseCorpus: string;
    vectorIndex: string;
    bm25Index: string;
    knowledgeGraph: string;
    release?: string;
    lastModified?: string;
  };
  counts?: {
    laws?: number;
    articles?: number;
    cidRows?: number;
    vectorRows?: number;
    bm25Documents?: number;
    graphNodes?: number;
    graphEdges?: number;
  };
}

export interface CorpusState {
  sections: CorpusSection[];
  sectionByCid: Map<string, CorpusSection>;
  manifest: CorpusManifest;
}

export interface CorpusProvider {
  loadManifest(): Promise<CorpusManifest>;
  loadInitialCorpus(limit?: number): Promise<CorpusState>;
  getSection(ipfsCid: string): Promise<CorpusSection | null>;
}

export interface SearchProvider {
  search(
    query: string,
    filters?: SearchFilters,
    mode?: SearchMode,
    queryEmbedding?: Float32Array | number[],
  ): Promise<SearchResult[]>;
}

export interface GraphProvider {
  getRelatedGraph(ipfsCid: string, depth?: number): Promise<{
    entities: CorpusEntity[];
    relationships: CorpusRelationship[];
  }>;
}

export type RetrievalProvider = CorpusProvider & SearchProvider & GraphProvider;

export interface VersionMetadata {
  schemaVersion: number | null;
  generatedAt: string | null;
  datasetId: string | null;
  datasetPath: string | null;
  release: string | null;
  lastModified: string | null;
  provider: RetrievalOrigin | null;
  sourceIds: Record<string, string>;
}

export interface DeepLink {
  publisherUrl: string;
  applicationRoute: string | null;
  target: '_blank';
  rel: 'noreferrer';
  replacesPublisherUrl: false;
}

export interface SampleSectionLabel {
  ipfs_cid: string;
  cid?: string;
  content_address?: string;
  provider?: RetrievalOrigin;
}

export function normalizeContentId(value: string): string {
  return value.replace(/^ipfs:\/\//i, '').trim();
}

export function toIpfsUri(cid: string): string {
  const normalized = normalizeContentId(cid);
  return normalized ? `ipfs://${normalized}` : '';
}

export function normalizeRecordStatus(value: string): LegalRecordStatus {
  if ((RECORD_STATUSES as readonly string[]).includes(value)) {
    return value as LegalRecordStatus;
  }
  return 'unknown';
}

export function readVersionMetadata(manifest: CorpusManifest): VersionMetadata {
  const sourceIds: Record<string, string> = {};
  if (manifest.datasetId) sourceIds.dataset = manifest.datasetId;
  const declared = manifest.corpus.sourceIds;
  if (declared) {
    for (const [key, value] of Object.entries(declared)) {
      if (value) sourceIds[key] = value;
    }
  }
  const legacySourceIds = manifest.corpus.hfDatasets;
  if (legacySourceIds) {
    for (const [key, value] of Object.entries(legacySourceIds)) {
      if (value) sourceIds[key] = value;
    }
  }
  const backend = manifest.backend;
  if (backend?.baseCorpus) sourceIds.baseCorpus = backend.baseCorpus;
  if (backend?.vectorIndex) sourceIds.vectorIndex = backend.vectorIndex;
  if (backend?.bm25Index) sourceIds.bm25Index = backend.bm25Index;
  if (backend?.knowledgeGraph) sourceIds.knowledgeGraph = backend.knowledgeGraph;
  return {
    schemaVersion: typeof manifest.schemaVersion === 'number' ? manifest.schemaVersion : null,
    generatedAt: manifest.generatedAt || null,
    datasetId: manifest.datasetId || null,
    datasetPath: manifest.datasetPath || null,
    release: backend?.release || null,
    lastModified: backend?.lastModified || null,
    provider: manifest.provider ?? null,
    sourceIds,
  };
}

export function sourceRevisionOf(version: VersionMetadata): string | null {
  return version.release || version.lastModified || version.generatedAt;
}

export function buildLawDeepLink(input: {
  publisherUrl: string;
  recordId?: string | null;
  sourceRevision?: string | null;
  sectionId?: string | null;
}): DeepLink {
  const recordId = input.recordId?.trim() ?? '';
  let applicationRoute: string | null = null;
  if (recordId) {
    const params = new URLSearchParams();
    const revision = input.sourceRevision?.trim();
    const sectionId = input.sectionId?.trim();
    if (revision) params.set('revision', revision);
    if (sectionId) params.set('section', sectionId);
    const query = params.toString();
    applicationRoute = `/#/law/${encodeURIComponent(recordId)}${query ? `?${query}` : ''}`;
  }
  return {
    publisherUrl: input.publisherUrl,
    applicationRoute,
    target: '_blank',
    rel: 'noreferrer',
    replacesPublisherUrl: false,
  };
}

export function labelBundledSampleSection<T extends SampleSectionLabel>(section: T): T {
  return {
    ...section,
    cid: section.cid || section.ipfs_cid,
    content_address: section.content_address || toIpfsUri(section.ipfs_cid),
    provider: SAMPLE_PROVIDER_LABEL,
  } as T;
}

export function labelBundledSampleManifest<T extends CorpusManifest>(
  manifest: T,
  fallbackCounts: NonNullable<CorpusManifest['counts']>,
): T {
  return {
    ...manifest,
    provider: SAMPLE_PROVIDER_LABEL,
    counts: manifest.counts || fallbackCounts,
  } as T;
}

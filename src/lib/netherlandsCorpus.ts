import {
  LEGACY_NETHERLANDS_PROFILE,
  NETHERLANDS_CORPUS_BASE_URL,
  NETHERLANDS_DATASET_VIEWER_API,
  NETHERLANDS_HUB_DATASETS_API,
  NETHERLANDS_INITIAL_REMOTE_LIMIT,
  NETHERLANDS_JURISDICTION_LABEL,
  NETHERLANDS_PROVIDER_ENV_KEY,
  NETHERLANDS_PROVIDER_STORAGE_KEY,
  NETHERLANDS_REQUEST_TIMEOUT_MS,
  UNIFIED_NETHERLANDS_PROFILE,
  buildNetherlandsLegislationJsonLd,
  labelNetherlandsSampleManifest,
  labelNetherlandsSampleSection,
  netherlandsRemoteCorpusDescriptor,
  readConfiguredNetherlandsProviderMode,
  readNetherlandsProviderMode,
  resolvePublisherDeepLink,
  type NetherlandsDatasetProfile,
  type NetherlandsProviderMode,
} from './worldwide/adapters/netherlands';
import {
  REMOTE_PROVIDER_LABEL,
  normalizeContentId,
  normalizeRecordStatus,
  toIpfsUri,
  type CorpusArtifact,
  type CorpusEntity,
  type CorpusHierarchyItem,
  type CorpusManifest,
  type CorpusProvider,
  type CorpusRelationship,
  type CorpusSection,
  type CorpusState,
  type GraphProvider,
  type GraphRagEvidence,
  type LegalRecordStatus,
  type RetrievalProvider,
  type SearchFilters,
  type SearchMode,
  type SearchProvider,
  type SearchResult,
} from './worldwide/contracts';

export type {
  CorpusArtifact,
  CorpusEntity,
  CorpusHierarchyItem,
  CorpusProvider,
  CorpusRelationship,
  CorpusSection,
  CorpusState,
  GraphProvider,
  GraphRagEvidence,
  LegalRecordStatus,
  RetrievalProvider,
  SearchFilters,
  SearchMode,
  SearchProvider,
  SearchResult,
};
export type WetWijzerCorpusManifest = CorpusManifest;

const CORPUS_BASE_URL = NETHERLANDS_CORPUS_BASE_URL;
const DATASET_VIEWER_API = NETHERLANDS_DATASET_VIEWER_API;
const HUGGING_FACE_API = NETHERLANDS_HUB_DATASETS_API;
const REQUEST_TIMEOUT_MS = NETHERLANDS_REQUEST_TIMEOUT_MS;
const INITIAL_REMOTE_ARTICLE_LIMIT = NETHERLANDS_INITIAL_REMOTE_LIMIT;
const UNIFIED_PROFILE = UNIFIED_NETHERLANDS_PROFILE;
const LEGACY_PROFILE = LEGACY_NETHERLANDS_PROFILE;

interface EmbeddingIndex {
  count: number;
  dimension: number;
  embeddingModel: string;
  browserEmbeddingModel: string;
  binary: string;
  ipfs_cids: string[];
}

interface Bm25Document {
  id: string;
  document_id: string;
  title: string;
  document_length: number;
  terms: Record<string, number>;
}

interface Bm25Payload {
  documents: Bm25Document[];
  documentFrequency: Record<string, number>;
  k1: number;
  b: number;
  avgdl: number;
  documentCount: number;
}

interface GraphAdjacency {
  outgoing: Record<string, CorpusRelationship[]>;
  incoming: Record<string, CorpusRelationship[]>;
}

interface ViewerRow<T> {
  row: T;
  row_idx?: number;
  truncated_cells?: string[];
}

interface ViewerRowsResponse<T> {
  rows?: Array<ViewerRow<T>>;
  num_rows_total?: number;
  error?: string;
}

interface ViewerSizeResponse {
  size?: {
    dataset?: {
      num_rows?: number;
      num_bytes_parquet_files?: number;
    };
    configs?: Array<{
      config: string;
      num_rows: number;
      num_bytes_parquet_files?: number;
    }>;
    splits?: Array<{
      config: string;
      split: string;
      num_rows: number;
      num_bytes_parquet_files?: number;
    }>;
  };
  error?: string;
}

type DatasetRow = Record<string, unknown>;

let staticManifestPromise: Promise<WetWijzerCorpusManifest> | null = null;
let activeManifestPromise: Promise<WetWijzerCorpusManifest> | null = null;
let staticCorpusPromise: Promise<CorpusState> | null = null;
let activeCorpusPromise: Promise<CorpusState> | null = null;
let staticBm25Promise: Promise<Bm25Payload> | null = null;
let staticEmbeddingPromise: Promise<{ index: EmbeddingIndex; vectors: Float32Array }> | null = null;
let staticGraphPromise: Promise<{
  entities: CorpusEntity[];
  entityById: Map<string, CorpusEntity>;
  relationships: CorpusRelationship[];
  adjacency: GraphAdjacency;
}> | null = null;
let provider: RetrievalProvider | null = null;

class ResilientCorpusProvider implements RetrievalProvider {
  constructor(
    private readonly primary: RetrievalProvider,
    private readonly fallback: RetrievalProvider,
  ) {}

  async loadManifest(): Promise<WetWijzerCorpusManifest> {
    try {
      return await this.primary.loadManifest();
    } catch (error) {
      console.warn('WetWijzer remote manifest unavailable; using bundled sample manifest', error);
      return this.fallback.loadManifest();
    }
  }

  async loadInitialCorpus(limit = INITIAL_REMOTE_ARTICLE_LIMIT): Promise<CorpusState> {
    try {
      const state = await this.primary.loadInitialCorpus(limit);
      if (state.sections.length > 0) {
        return state;
      }
    } catch (error) {
      console.warn('WetWijzer remote corpus unavailable; using bundled sample corpus', error);
    }
    return this.fallback.loadInitialCorpus(limit);
  }

  async getSection(ipfsCid: string): Promise<CorpusSection | null> {
    try {
      const section = await this.primary.getSection(ipfsCid);
      if (section) return section;
    } catch (error) {
      console.warn('WetWijzer remote CID lookup unavailable; checking bundled sample corpus', error);
    }
    return this.fallback.getSection(ipfsCid);
  }

  async search(
    query: string,
    filters: SearchFilters = {},
    mode: SearchMode = 'hybrid',
    queryEmbedding?: Float32Array | number[],
  ): Promise<SearchResult[]> {
    try {
      const results = await this.primary.search(query, filters, mode, queryEmbedding);
      if (results.length > 0) {
        return results;
      }
    } catch (error) {
      console.warn('WetWijzer remote search unavailable; using bundled sample corpus', error);
    }
    return this.fallback.search(query, filters, mode, queryEmbedding);
  }

  async getRelatedGraph(ipfsCid: string, depth = 1): Promise<{
    entities: CorpusEntity[];
    relationships: CorpusRelationship[];
  }> {
    try {
      const graph = await this.primary.getRelatedGraph(ipfsCid, depth);
      if (graph.entities.length > 0 || graph.relationships.length > 0) {
        return graph;
      }
    } catch (error) {
      console.warn('WetWijzer remote graph unavailable; using bundled sample graph', error);
    }
    return this.fallback.getRelatedGraph(ipfsCid, depth);
  }
}

class HuggingFaceCorpusProvider implements RetrievalProvider {
  private manifestCache: Promise<WetWijzerCorpusManifest> | null = null;
  private sectionCache = new Map<string, CorpusSection>();

  constructor(private readonly profile: NetherlandsDatasetProfile = UNIFIED_PROFILE) {}

  async loadManifest(): Promise<WetWijzerCorpusManifest> {
    if (!this.manifestCache) {
      this.manifestCache = this.fetchManifest();
    }
    return this.manifestCache;
  }

  async loadInitialCorpus(limit = INITIAL_REMOTE_ARTICLE_LIMIT): Promise<CorpusState> {
    const [manifest, rows] = await Promise.all([
      this.loadManifest(),
      viewerRows<DatasetRow>({
        dataset: this.profile.datasets.base,
        config: this.profile.configs.articles,
        split: 'train',
        offset: 0,
        length: limit,
      }),
    ]);
    const sections = rows.map((row) => this.cacheSection(mapDatasetRowToSection(row, 'huggingface')));
    return {
      sections,
      sectionByCid: new Map(sections.map((section) => [section.ipfs_cid, section])),
      manifest,
    };
  }

  async getSection(ipfsCid: string): Promise<CorpusSection | null> {
    const normalizedCid = normalizeCid(ipfsCid);
    const cached = this.sectionCache.get(normalizedCid);
    if (cached) return cached;

    const exactRows = await filterViewerRows<DatasetRow>({
      dataset: this.profile.datasets.base,
      config: this.profile.configs.articles,
      split: 'train',
      where: equalsPredicate('cid', normalizedCid),
      offset: 0,
      length: 3,
    }).catch(() => []);
    const rows = exactRows.length > 0 ? exactRows : await this.searchArticleRows(normalizedCid, 8);
    const exactRow = rows.find((row) => normalizeCid(readString(row, 'cid')) === normalizedCid)
      || rows.find((row) => normalizeCid(readString(row, 'content_address')) === normalizedCid)
      || rows[0];
    if (!exactRow) {
      const cidRows = await filterViewerRows<DatasetRow>({
        dataset: this.profile.datasets.base,
        config: this.profile.configs.cidIndex,
        split: 'train',
        where: equalsPredicate('cid', normalizedCid),
        offset: 0,
        length: 5,
      }).catch(() => searchViewerRows<DatasetRow>({
        dataset: this.profile.datasets.base,
        config: this.profile.configs.cidIndex,
        split: 'train',
        query: normalizedCid,
        offset: 0,
        length: 5,
      }));
      const cidRow = cidRows.find((row) => normalizeCid(readString(row, 'cid')) === normalizedCid) || cidRows[0];
      return cidRow ? this.cacheSection(mapDatasetRowToSection(cidRow, 'huggingface')) : null;
    }

    return this.cacheSection(mapDatasetRowToSection(exactRow, 'huggingface'));
  }

  async search(
    query: string,
    filters: SearchFilters = {},
    mode: SearchMode = 'hybrid',
    queryEmbedding?: Float32Array | number[],
  ): Promise<SearchResult[]> {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      const state = await this.loadInitialCorpus(filters.limit || INITIAL_REMOTE_ARTICLE_LIMIT);
      return state.sections
        .filter((section) => matchesFilters(section, filters))
        .slice(0, filters.limit || 20)
        .map((section) => sectionToContextResult(section, '', 0));
    }

    const requestedLimit = Math.min(Math.max(filters.limit || 20, 20), 140);
    const [articleRows, bm25Rows, vectorRows] = await Promise.all([
      mode !== 'vector' ? this.searchArticleRows(trimmedQuery, requestedLimit) : Promise.resolve([]),
      mode !== 'vector' ? this.searchBm25Rows(trimmedQuery, Math.min(requestedLimit, 40)) : Promise.resolve([]),
      mode !== 'keyword' ? this.searchVectorRows(trimmedQuery, Math.min(requestedLimit, 40)) : Promise.resolve([]),
    ]);

    const merged = new Map<string, SearchResult>();

    for (const row of articleRows) {
      const section = this.cacheSection(mapDatasetRowToSection(row, 'huggingface'));
      addMergedResult(merged, section, trimmedQuery, 2.2, {
        keyword: 1.2,
        citation: scoreCitation(section, trimmedQuery),
        title: scoreTitle(section, trimmedQuery),
      });
    }

    for (const row of bm25Rows) {
      const section = this.cacheSection(mapDatasetRowToSection(row, 'huggingface'));
      addMergedResult(merged, section, trimmedQuery, scoreNumber(row, 'bm25_score', 1.4), {
        keyword: 1,
        bm25: scoreNumber(row, 'bm25_score', 1),
        citation: scoreCitation(section, trimmedQuery),
        title: scoreTitle(section, trimmedQuery),
      });
    }

    for (const row of vectorRows) {
      const section = this.cacheSection(mapDatasetRowToSection(row, 'huggingface'));
      const vectorScore = scoreVectorRow(row, queryEmbedding);
      addMergedResult(merged, section, trimmedQuery, vectorScore * 3, {
        vector: vectorScore,
        citation: scoreCitation(section, trimmedQuery),
        title: scoreTitle(section, trimmedQuery),
      });
    }

    await addGraphExpansionScores([...merged.values()].slice(0, 8), (cid) => this.getRelatedGraph(cid, 1));

    return [...merged.values()]
      .filter((result) => matchesFilters(result.section, filters))
      .sort((left, right) => right.score - left.score)
      .slice(0, filters.limit || 20);
  }

  async getRelatedGraph(
    ipfsCid: string,
    depth = 1,
  ): Promise<{ entities: CorpusEntity[]; relationships: CorpusRelationship[] }> {
    const normalizedCid = normalizeCid(ipfsCid);
    const [
      nodeRowsByCid,
      nodeRowsBySource,
      edgeSourceRows,
      edgeTargetRows,
      logicSourceRows,
      logicTargetRows,
    ] = await Promise.all([
      filterViewerRows<DatasetRow>({
        dataset: this.profile.datasets.graph,
        config: this.profile.configs.graphNodes,
        split: 'train',
        where: equalsPredicate('cid', normalizedCid),
        offset: 0,
        length: 20,
      }).catch(() => []),
      filterViewerRows<DatasetRow>({
        dataset: this.profile.datasets.graph,
        config: this.profile.configs.graphNodes,
        split: 'train',
        where: equalsPredicate('source_cid', normalizedCid),
        offset: 0,
        length: 20,
      }).catch(() => []),
      filterViewerRows<DatasetRow>({
        dataset: this.profile.datasets.graph,
        config: this.profile.configs.graphEdges,
        split: 'train',
        where: equalsPredicate('source_cid', normalizedCid),
        offset: 0,
        length: depth > 1 ? 80 : 40,
      }).catch(() => []),
      filterViewerRows<DatasetRow>({
        dataset: this.profile.datasets.graph,
        config: this.profile.configs.graphEdges,
        split: 'train',
        where: equalsPredicate('target_cid', normalizedCid),
        offset: 0,
        length: depth > 1 ? 80 : 40,
      }).catch(() => []),
      this.profile.datasets.logic && this.profile.configs.logicRelationships
        ? filterViewerRows<DatasetRow>({
            dataset: this.profile.datasets.logic,
            config: this.profile.configs.logicRelationships,
            split: 'train',
            where: equalsPredicate('source_cid', normalizedCid),
            offset: 0,
            length: depth > 1 ? 80 : 40,
          }).catch(() => [])
        : Promise.resolve([]),
      this.profile.datasets.logic && this.profile.configs.logicRelationships
        ? filterViewerRows<DatasetRow>({
            dataset: this.profile.datasets.logic,
            config: this.profile.configs.logicRelationships,
            split: 'train',
            where: equalsPredicate('target_cid', normalizedCid),
            offset: 0,
            length: depth > 1 ? 80 : 40,
          }).catch(() => [])
        : Promise.resolve([]),
    ]);
    const nodeRows = [...nodeRowsByCid, ...nodeRowsBySource];
    const edgeRows = [...edgeSourceRows, ...edgeTargetRows];
    let logicRows = [...logicSourceRows, ...logicTargetRows];
    if (logicRows.length === 0 && this.profile.datasets.logic && this.profile.configs.logicRelationships) {
      logicRows = await searchViewerRows<DatasetRow>({
        dataset: this.profile.datasets.logic,
        config: this.profile.configs.logicRelationships,
        split: 'train',
        query: normalizedCid,
        offset: 0,
        length: depth > 1 ? 80 : 40,
      }).catch(() => []);
    }

    const entities = new Map<string, CorpusEntity>();
    const relationships = new Map<string, CorpusRelationship>();

    for (const row of nodeRows) {
      const entity = mapGraphNodeRow(row);
      entities.set(entity.id, entity);
    }

    for (const row of edgeRows) {
      const relationship = mapGraphEdgeRow(row);
      relationships.set(relationship.id, relationship);
      addRelationshipEntities(entities, relationship);
    }

    for (const row of logicRows) {
      const relationship = mapLogicRelationshipRow(row);
      relationships.set(relationship.id, relationship);
      addRelationshipEntities(entities, relationship);
    }

    return {
      entities: [...entities.values()],
      relationships: [...relationships.values()],
    };
  }

  private async fetchManifest(): Promise<WetWijzerCorpusManifest> {
    const [size, repo] = await Promise.all([
      fetchViewerJson<ViewerSizeResponse>('size', { dataset: this.profile.datasetId }),
      fetchHubDatasetInfo(this.profile.datasetId).catch(() => null),
    ]);
    const baseDatasetBytes = size.size?.dataset?.num_bytes_parquet_files || 0;
    const laws = getConfigCount(size, this.profile.configs.laws);
    const articles = getConfigCount(size, this.profile.configs.articles);
    const cidRows = getConfigCount(size, this.profile.configs.cidIndex);
    const vectorRows = getConfigCount(size, this.profile.configs.vectorIndex);
    const bm25Documents = getConfigCount(size, this.profile.configs.bm25Documents);
    const graphNodes = getConfigCount(size, this.profile.configs.graphNodes);
    const graphEdges = getConfigCount(size, this.profile.configs.graphEdges);
    const lastModified = readString(repo || {}, 'lastModified') || readString(repo || {}, 'last_modified');
    const release = readString(repo || {}, 'sha');

    return {
      schemaVersion: 2,
      generatedAt: lastModified || new Date().toISOString(),
      datasetId: this.profile.datasetId,
      datasetPath: `hf://datasets/${this.profile.datasetId}`,
      provider: REMOTE_PROVIDER_LABEL,
      corpus: netherlandsRemoteCorpusDescriptor(),
      backend: {
        baseCorpus: this.profile.datasetId,
        vectorIndex: this.profile.datasets.vector,
        bm25Index: this.profile.datasets.bm25,
        knowledgeGraph: this.profile.datasets.graph,
        release: release || undefined,
        lastModified: lastModified || undefined,
      },
      counts: {
        laws,
        articles,
        cidRows,
        vectorRows,
        bm25Documents,
        graphNodes,
        graphEdges,
      },
      artifacts: [
        {
          id: 'base-corpus',
          path: `hf://datasets/${this.profile.datasets.base}`,
          bytes: baseDatasetBytes,
          role: 'remote CID-indexed law and article corpus',
          sourceUrl: `https://huggingface.co/datasets/${this.profile.datasets.base}`,
        },
        {
          id: 'bm25-index',
          path: `hf://datasets/${this.profile.datasets.bm25}`,
          bytes: 0,
          role: 'remote BM25 retrieval index',
          sourceUrl: `https://huggingface.co/datasets/${this.profile.datasets.bm25}`,
        },
        {
          id: 'vector-index',
          path: `hf://datasets/${this.profile.datasets.vector}`,
          bytes: 0,
          role: 'remote vector reranking index',
          sourceUrl: `https://huggingface.co/datasets/${this.profile.datasets.vector}`,
        },
        {
          id: 'knowledge-graph',
          path: `hf://datasets/${this.profile.datasets.graph}`,
          bytes: 0,
          role: 'remote JSON-LD knowledge graph',
          sourceUrl: `https://huggingface.co/datasets/${this.profile.datasets.graph}`,
        },
      ],
      generatedFiles: [],
    };
  }

  private async searchArticleRows(query: string, limit: number): Promise<DatasetRow[]> {
    return searchViewerRows<DatasetRow>({
      dataset: this.profile.datasets.base,
      config: this.profile.configs.articles,
      split: 'train',
      query,
      offset: 0,
      length: limit,
    }).catch(() => []);
  }

  private async searchBm25Rows(query: string, limit: number): Promise<DatasetRow[]> {
    return searchViewerRows<DatasetRow>({
      dataset: this.profile.datasets.bm25,
      config: this.profile.configs.bm25Documents,
      split: 'train',
      query,
      offset: 0,
      length: limit,
    }).catch(() => []);
  }

  private async searchVectorRows(query: string, limit: number): Promise<DatasetRow[]> {
    return searchViewerRows<DatasetRow>({
      dataset: this.profile.datasets.vector,
      config: this.profile.configs.vectorIndex,
      split: 'train',
      query,
      offset: 0,
      length: limit,
    }).catch(() => []);
  }

  private cacheSection(section: CorpusSection): CorpusSection {
    this.sectionCache.set(section.ipfs_cid, section);
    return section;
  }
}

class StaticCorpusProvider implements RetrievalProvider {
  async loadManifest(): Promise<WetWijzerCorpusManifest> {
    const manifest = await loadStaticWetWijzerCorpusManifest();
    return labelNetherlandsSampleManifest(manifest);
  }

  async loadInitialCorpus(): Promise<CorpusState> {
    return loadStaticWetWijzerCorpus();
  }

  async getSection(ipfsCid: string): Promise<CorpusSection | null> {
    const { sectionByCid } = await loadStaticWetWijzerCorpus();
    return sectionByCid.get(normalizeCid(ipfsCid)) || null;
  }

  async search(
    query: string,
    filters: SearchFilters = {},
    mode: SearchMode = 'hybrid',
    queryEmbedding?: Float32Array | number[],
  ): Promise<SearchResult[]> {
    return searchStaticCorpus(query, filters, mode, queryEmbedding);
  }

  async getRelatedGraph(
    ipfsCid: string,
    depth = 1,
  ): Promise<{ entities: CorpusEntity[]; relationships: CorpusRelationship[] }> {
    return getStaticRelatedGraph(ipfsCid, depth);
  }
}

function getProvider(): RetrievalProvider {
  if (!provider) {
    const staticProvider = new StaticCorpusProvider();
    const legacyProvider = new ResilientCorpusProvider(new HuggingFaceCorpusProvider(LEGACY_PROFILE), staticProvider);
    provider = getConfiguredProviderMode() === 'static'
      ? new StaticCorpusProvider()
      : new ResilientCorpusProvider(new HuggingFaceCorpusProvider(UNIFIED_PROFILE), legacyProvider);
  }
  return provider;
}

function getConfiguredProviderMode(): NetherlandsProviderMode {
  const storageValue = typeof window !== 'undefined'
    ? window.localStorage.getItem(NETHERLANDS_PROVIDER_STORAGE_KEY)
    : null;
  const storageMode = readNetherlandsProviderMode(storageValue);
  if (storageMode) return storageMode;
  const viteEnv = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  return readConfiguredNetherlandsProviderMode(null, viteEnv?.[NETHERLANDS_PROVIDER_ENV_KEY]);
}

export async function loadWetWijzerCorpusManifest(): Promise<WetWijzerCorpusManifest> {
  if (!activeManifestPromise) {
    activeManifestPromise = getProvider().loadManifest();
  }
  return activeManifestPromise;
}

async function loadStaticWetWijzerCorpusManifest(): Promise<WetWijzerCorpusManifest> {
  if (!staticManifestPromise) {
    staticManifestPromise = fetch(`${CORPUS_BASE_URL}/artifacts.manifest.json`, { cache: 'no-store' }).then(
      async (response) => {
        if (!response.ok) {
          throw new Error(`Failed to load corpus manifest: ${response.status}`);
        }
        return response.json() as Promise<WetWijzerCorpusManifest>;
      },
    );
  }
  return staticManifestPromise;
}

export function getWetWijzerCorpusAssetUrl(relativePath: string, manifest: WetWijzerCorpusManifest): string {
  const params = new URLSearchParams({ v: manifest.generatedAt });
  return `${CORPUS_BASE_URL}/${relativePath}?${params.toString()}`;
}

export async function fetchCorpusJson<T>(relativePath: string): Promise<T> {
  const manifest = await loadStaticWetWijzerCorpusManifest();
  const response = await fetch(getWetWijzerCorpusAssetUrl(relativePath, manifest));
  if (!response.ok) {
    throw new Error(`Failed to load corpus asset ${relativePath}: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export async function fetchCorpusArrayBuffer(relativePath: string): Promise<ArrayBuffer> {
  const manifest = await loadStaticWetWijzerCorpusManifest();
  const response = await fetch(getWetWijzerCorpusAssetUrl(relativePath, manifest));
  if (!response.ok) {
    throw new Error(`Failed to load corpus asset ${relativePath}: ${response.status}`);
  }
  return response.arrayBuffer();
}

export async function loadWetWijzerCorpus(): Promise<CorpusState> {
  if (!activeCorpusPromise) {
    activeCorpusPromise = getProvider().loadInitialCorpus();
  }
  return activeCorpusPromise;
}

async function loadStaticWetWijzerCorpus(): Promise<CorpusState> {
  if (!staticCorpusPromise) {
    staticCorpusPromise = Promise.all([
      loadStaticWetWijzerCorpusManifest(),
      fetchCorpusJson<CorpusSection[]>('generated/sections.json'),
    ]).then(([manifest, sections]) => {
      const normalizedSections = sections.map((section) => labelNetherlandsSampleSection(section));
      return {
        sections: normalizedSections,
        sectionByCid: new Map(normalizedSections.map((section) => [section.ipfs_cid, section])),
        manifest: labelNetherlandsSampleManifest(manifest, {
          laws: new Set(normalizedSections.map((section) => section.law_id || section.title_number)).size,
          articles: normalizedSections.length,
          cidRows: normalizedSections.length,
        }),
      };
    });
  }
  return staticCorpusPromise;
}

async function loadStaticBm25(): Promise<Bm25Payload> {
  if (!staticBm25Promise) {
    staticBm25Promise = fetchCorpusJson<Bm25Payload>('generated/bm25-documents.json');
  }
  return staticBm25Promise;
}

export async function loadWetWijzerEmbeddings(): Promise<{
  index: EmbeddingIndex;
  vectors: Float32Array;
}> {
  if (!staticEmbeddingPromise) {
    staticEmbeddingPromise = Promise.all([
      fetchCorpusJson<EmbeddingIndex>('generated/embedding-index.json'),
      fetchCorpusArrayBuffer('generated/embeddings.f32'),
    ]).then(([index, buffer]) => {
      const vectors = new Float32Array(buffer);
      const expectedLength = index.count * index.dimension;
      if (vectors.length !== expectedLength) {
        throw new Error(`Embedding vector length ${vectors.length} did not match ${expectedLength}`);
      }
      return { index, vectors };
    });
  }
  return staticEmbeddingPromise;
}

async function loadStaticGraph() {
  if (!staticGraphPromise) {
    staticGraphPromise = Promise.all([
      fetchCorpusJson<CorpusEntity[]>('generated/entities.json'),
      fetchCorpusJson<CorpusRelationship[]>('generated/relationships.json'),
      fetchCorpusJson<GraphAdjacency>('generated/graph-adjacency.json'),
    ]).then(([entities, relationships, adjacency]) => ({
      entities,
      entityById: new Map(entities.map((entity) => [entity.id, entity])),
      relationships,
      adjacency,
    }));
  }
  return staticGraphPromise;
}

export async function getSection(ipfsCid: string): Promise<CorpusSection | null> {
  return getProvider().getSection(ipfsCid);
}

export async function getRelatedGraph(
  ipfsCid: string,
  depth = 1,
): Promise<{ entities: CorpusEntity[]; relationships: CorpusRelationship[] }> {
  return getProvider().getRelatedGraph(ipfsCid, depth);
}

async function getStaticRelatedGraph(
  ipfsCid: string,
  depth = 1,
): Promise<{ entities: CorpusEntity[]; relationships: CorpusRelationship[] }> {
  const graph = await loadStaticGraph();
  const normalizedCid = normalizeCid(ipfsCid);
  const seenEntities = new Set<string>([normalizedCid]);
  const seenRelationships = new Set<string>();
  let frontier = [normalizedCid];

  for (let level = 0; level < depth; level += 1) {
    const nextFrontier: string[] = [];
    for (const entityId of frontier) {
      const edges = [
        ...(graph.adjacency.outgoing[entityId] || []),
        ...(graph.adjacency.incoming[entityId] || []),
      ];
      for (const edge of edges) {
        seenRelationships.add(edge.id);
        for (const candidate of [edge.source, edge.target]) {
          if (!seenEntities.has(candidate)) {
            seenEntities.add(candidate);
            nextFrontier.push(candidate);
          }
        }
      }
    }
    frontier = nextFrontier;
  }

  return {
    entities: [...seenEntities]
      .map((id) => graph.entityById.get(id))
      .filter((entity): entity is CorpusEntity => Boolean(entity)),
    relationships: graph.relationships.filter((relationship) => seenRelationships.has(relationship.id)),
  };
}

export async function searchCorpus(
  query: string,
  filters: SearchFilters = {},
  mode: SearchMode = 'hybrid',
  queryEmbedding?: Float32Array | number[],
): Promise<SearchResult[]> {
  return getProvider().search(query, filters, mode, queryEmbedding);
}

async function searchStaticCorpus(
  query: string,
  filters: SearchFilters = {},
  mode: SearchMode = 'hybrid',
  queryEmbedding?: Float32Array | number[],
): Promise<SearchResult[]> {
  const limit = filters.limit || 20;
  const [{ sections, sectionByCid }, keywordScores, vectorScores] = await Promise.all([
    loadStaticWetWijzerCorpus(),
    mode !== 'vector' ? keywordSearchStatic(query) : Promise.resolve(new Map<string, number>()),
    mode !== 'keyword' && queryEmbedding
      ? vectorSearchStatic(queryEmbedding)
      : Promise.resolve(new Map<string, number>()),
  ]);

  const normalizedQuery = query.trim().toLowerCase();
  const candidateIds = new Set<string>([...keywordScores.keys(), ...vectorScores.keys()]);

  if (candidateIds.size === 0 && normalizedQuery) {
    for (const section of sections) {
      if (matchesTitleOrCitation(section, normalizedQuery)) {
        candidateIds.add(section.ipfs_cid);
      }
    }
  }

  const results: SearchResult[] = [];
  for (const cid of candidateIds) {
    const section = sectionByCid.get(cid);
    if (!section || !matchesFilters(section, filters)) {
      continue;
    }

    const keyword = keywordScores.get(cid) || 0;
    const vector = vectorScores.get(cid) || 0;
    const title = normalizedQuery && section.title.toLowerCase().includes(normalizedQuery) ? 1 : 0;
    const citation = normalizedQuery && matchesTitleOrCitation(section, normalizedQuery) ? 1 : 0;
    const score =
      mode === 'keyword'
        ? keyword + citation * 2 + title
        : mode === 'vector'
          ? vector + citation * 0.25 + title * 0.1
          : keyword + vector * 3 + citation * 2 + title;

    results.push({
      ipfs_cid: cid,
      section,
      score,
      scoreParts: { keyword, vector, title, citation, bm25: keyword, graph: 0 },
      snippet: buildSnippet(section.text, query),
      citation: section.bluebook_citation || section.official_cite || section.identifier,
    });
  }

  return results.sort((left, right) => right.score - left.score).slice(0, limit);
}

export async function buildGraphRagEvidence(
  query: string,
  queryEmbedding?: Float32Array | number[],
  limit = 6,
): Promise<GraphRagEvidence> {
  const sections = await searchCorpus(query, { limit }, 'hybrid', queryEmbedding);
  const entityById = new Map<string, CorpusEntity>();
  const relationshipById = new Map<string, CorpusRelationship>();

  for (const result of sections) {
    const related = await getRelatedGraph(result.ipfs_cid, 1);
    for (const entity of related.entities) {
      entityById.set(entity.id, entity);
    }
    for (const relationship of related.relationships) {
      relationshipById.set(relationship.id, relationship);
    }
  }

  return {
    sections,
    entities: [...entityById.values()],
    relationships: [...relationshipById.values()],
  };
}

export async function buildSectionGraphRagEvidence(
  ipfsCid: string,
  query: string,
  queryEmbedding?: Float32Array | number[],
  limit = 6,
): Promise<GraphRagEvidence> {
  const [primarySection, related, retrieved] = await Promise.all([
    getSection(ipfsCid),
    getRelatedGraph(ipfsCid, 1),
    query.trim() ? searchCorpus(query, { limit }, 'hybrid', queryEmbedding) : Promise.resolve([]),
  ]);
  if (!primarySection) {
    return { sections: [], entities: related.entities, relationships: related.relationships };
  }

  const sectionResults = new Map<string, SearchResult>();
  sectionResults.set(primarySection.ipfs_cid, sectionToContextResult(primarySection, query, 100));

  for (const entity of related.entities) {
    const relatedSection = await getSection(entity.id).catch(() => null);
    if (relatedSection && relatedSection.ipfs_cid !== primarySection.ipfs_cid) {
      sectionResults.set(relatedSection.ipfs_cid, sectionToContextResult(relatedSection, query, 25));
    }
  }

  for (const result of retrieved) {
    if (sectionResults.size >= limit) break;
    sectionResults.set(result.ipfs_cid, result);
  }

  return {
    sections: [...sectionResults.values()].slice(0, limit),
    entities: related.entities,
    relationships: related.relationships,
  };
}

function sectionToContextResult(section: CorpusSection, query: string, score: number): SearchResult {
  return {
    ipfs_cid: section.ipfs_cid,
    section,
    score,
    scoreParts: {
      keyword: score,
      vector: 0,
      title: 0,
      citation: 0,
      bm25: score,
      graph: 0,
    },
    snippet: buildSnippet(section.text, query) || section.text.slice(0, 900),
    citation: section.bluebook_citation || section.official_cite || section.identifier,
  };
}

async function keywordSearchStatic(query: string): Promise<Map<string, number>> {
  const tokens = tokenize(query);
  const scores = new Map<string, number>();
  if (tokens.length === 0) {
    return scores;
  }

  const bm25 = await loadStaticBm25();
  for (const doc of bm25.documents) {
    let score = 0;
    for (const token of tokens) {
      const tf = doc.terms[token] || 0;
      if (!tf) {
        continue;
      }
      const df = bm25.documentFrequency[token] || 0;
      const idf = Math.log(1 + (bm25.documentCount - df + 0.5) / (df + 0.5));
      const denominator =
        tf + bm25.k1 * (1 - bm25.b + bm25.b * (doc.document_length / bm25.avgdl));
      score += idf * ((tf * (bm25.k1 + 1)) / denominator);
    }
    if (score > 0) {
      scores.set(doc.document_id, score);
    }
  }
  return scores;
}

async function vectorSearchStatic(queryEmbedding: Float32Array | number[]): Promise<Map<string, number>> {
  const { index, vectors } = await loadWetWijzerEmbeddings();
  const query = queryEmbedding instanceof Float32Array ? queryEmbedding : new Float32Array(queryEmbedding);
  if (query.length !== index.dimension) {
    throw new Error(`Query embedding dimension ${query.length} did not match ${index.dimension}`);
  }

  const queryNorm = vectorNorm(query);
  const scores = new Map<string, number>();
  for (let row = 0; row < index.count; row += 1) {
    const offset = row * index.dimension;
    let dot = 0;
    let norm = 0;
    for (let col = 0; col < index.dimension; col += 1) {
      const value = vectors[offset + col];
      dot += query[col] * value;
      norm += value * value;
    }
    const similarity = dot / (queryNorm * Math.sqrt(norm) || 1);
    if (Number.isFinite(similarity)) {
      scores.set(index.ipfs_cids[row], similarity);
    }
  }
  return scores;
}

function mapDatasetRowToSection(row: DatasetRow, providerName: CorpusSection['provider']): CorpusSection {
  const cid = normalizeCid(readString(row, 'cid') || readString(row, 'source_cid') || readString(row, 'content_address'));
  const lawCid = normalizeCid(readString(row, 'law_cid'));
  const lawIdentifier = readString(row, 'law_identifier') || readString(row, 'identifier');
  const articleIdentifier = readString(row, 'article_identifier');
  const articleNumber = readString(row, 'article_number');
  const documentCitation = readString(row, 'document_citation') || readString(row, 'title');
  const citation = readString(row, 'citation') || articleIdentifier || lawIdentifier || cid;
  const articleLabel = readString(row, 'article_label') || (articleNumber ? `Artikel ${articleNumber}` : '');
  const title = readString(row, 'title')
    || [documentCitation, articleLabel].filter(Boolean).join(' - ')
    || citation
    || lawIdentifier
    || cid;
  const text = readString(row, 'text') || readString(row, 'text_preview') || readString(row, 'search_text_preview') || title;
  const sourceUrl = resolvePublisherDeepLink({
    sourceUrl: readString(row, 'source_url'),
    canonicalDocumentUrl: readString(row, 'canonical_document_url'),
    canonicalLawUrl: readString(row, 'canonical_law_url'),
    lawIdentifier,
  });
  const hierarchyPath = readHierarchy(row.hierarchy_path);
  const hierarchyLabels = readStringArray(row.hierarchy_labels);
  const lawStatus = normalizeLawStatus(readString(row, 'law_status'));

  return {
    ipfs_cid: cid,
    cid,
    law_cid: lawCid || null,
    content_address: readString(row, 'content_address') || asIpfsUri(cid),
    identifier: articleIdentifier || readString(row, 'version_specific_identifier') || lawIdentifier || cid,
    law_id: lawIdentifier,
    law_identifier: lawIdentifier,
    article_identifier: articleIdentifier || null,
    article_number: articleNumber || null,
    article_heading: readString(row, 'article_heading') || null,
    title,
    text,
    source_url: sourceUrl,
    official_cite: citation,
    bluebook_citation: citation,
    citation,
    document_citation: documentCitation,
    chapter: readString(row, 'chapter_number') || readString(row, 'chapter_label') || readString(row, 'title_number') || '',
    title_number: lawIdentifier || readString(row, 'title_number') || '',
    hierarchy_path: hierarchyPath,
    hierarchy_path_text: readString(row, 'hierarchy_path_text') || hierarchyLabels.join(' > '),
    hierarchy_labels: hierarchyLabels,
    book_label: readString(row, 'book_label') || null,
    title_label: readString(row, 'title_label') || null,
    chapter_label: readString(row, 'chapter_label') || null,
    division_label: readString(row, 'division_label') || null,
    paragraph_label: readString(row, 'paragraph_label') || null,
    article_label: articleLabel || null,
    book_number: readString(row, 'book_number') || null,
    chapter_number: readString(row, 'chapter_number') || null,
    division_number: readString(row, 'division_number') || null,
    paragraph_number: readString(row, 'paragraph_number') || null,
    version_start_date: readString(row, 'version_start_date') || null,
    version_end_date: readString(row, 'version_end_date') || null,
    scraped_at: readString(row, 'scraped_at') || null,
    jsonld: readString(row, 'jsonld') || buildNetherlandsLegislationJsonLd(title, citation, sourceUrl, lawStatus),
    law_status: lawStatus,
    is_current: readNullableBoolean(row, 'is_current'),
    valid_from: readString(row, 'valid_from') || null,
    valid_to: readString(row, 'valid_to') || null,
    effective_date: readString(row, 'effective_date') || null,
    retrieved_at: readString(row, 'retrieved_at') || null,
    status_source: readString(row, 'status_source') || null,
    status_confidence: readString(row, 'status_confidence') || null,
    status_note: readString(row, 'status_note') || null,
    provider: providerName,
    jurisdiction: readString(row, 'jurisdiction') || NETHERLANDS_JURISDICTION_LABEL,
  };
}

function mapGraphNodeRow(row: DatasetRow): CorpusEntity {
  const cid = normalizeCid(readString(row, 'cid') || readString(row, 'source_cid') || readString(row, 'node_cid'));
  const id = normalizeGraphId(readString(row, 'jsonld_id')) || cid;
  return {
    id,
    type: readString(row, 'record_type') || 'node',
    label: readString(row, 'label') || readString(row, 'law_identifier') || readString(row, 'article_identifier') || formatCidForDisplay(id),
    properties: {
      cid,
      node_cid: readString(row, 'node_cid'),
      law_identifier: readString(row, 'law_identifier'),
      article_identifier: readString(row, 'article_identifier'),
      law_status: readString(row, 'law_status'),
      valid_from: readString(row, 'valid_from'),
      valid_to: readString(row, 'valid_to'),
    },
  };
}

function mapGraphEdgeRow(row: DatasetRow): CorpusRelationship {
  const sourceCid = normalizeCid(readString(row, 'source_cid'));
  const targetCid = normalizeCid(readString(row, 'target_cid'));
  const source = normalizeGraphId(readString(row, 'source_id')) || sourceCid;
  const target = normalizeGraphId(readString(row, 'target_id')) || targetCid;
  const id = readString(row, 'edge_cid') || readString(row, 'cid') || `${source}:${readString(row, 'edge_type')}:${target}`;
  const edgeType = readString(row, 'edge_type') || 'relatedTo';
  return {
    id,
    source,
    target,
    type: edgeType,
    properties: {
      cid: readString(row, 'cid'),
      source_cid: sourceCid,
      target_cid: targetCid,
      law_identifier: readString(row, 'law_identifier'),
      article_identifier: readString(row, 'article_identifier'),
      source_identifier: readString(row, 'article_identifier'),
      target_identifier: readString(row, 'law_identifier'),
      source_record_type: edgeType === 'isPartOf' ? 'article' : 'cid',
      target_record_type: edgeType === 'isPartOf' ? 'law' : 'cid',
    },
  };
}

function mapLogicRelationshipRow(row: DatasetRow): CorpusRelationship {
  const source = normalizeCid(readString(row, 'source_cid'));
  const target = normalizeCid(readString(row, 'target_cid'));
  const type = readString(row, 'relationship_type') || 'relatedTo';
  const id = readString(row, 'relationship_cid') || `${source}:${type}:${target}`;
  return {
    id,
    source,
    target,
    type,
    properties: {
      law_cid: readString(row, 'law_cid'),
      law_identifier: readString(row, 'law_identifier'),
      source_identifier: readString(row, 'source_identifier'),
      target_identifier: readString(row, 'target_identifier'),
      source_label: readString(row, 'source_label'),
      target_label: readString(row, 'target_label'),
      source_record_type: readString(row, 'source_record_type'),
      target_record_type: readString(row, 'target_record_type'),
      source_url: readString(row, 'source_url'),
      confidence: readString(row, 'confidence'),
      derivation_note: readString(row, 'derivation_note'),
    },
  };
}

function addRelationshipEntities(entities: Map<string, CorpusEntity>, relationship: CorpusRelationship) {
  const sourceLabel = typeof relationship.properties?.source_label === 'string'
    ? relationship.properties.source_label
    : formatCidForDisplay(relationship.source);
  const targetLabel = typeof relationship.properties?.target_label === 'string'
    ? relationship.properties.target_label
    : formatCidForDisplay(relationship.target);
  const sourceType = typeof relationship.properties?.source_record_type === 'string'
    ? relationship.properties.source_record_type
    : 'cid';
  const targetType = typeof relationship.properties?.target_record_type === 'string'
    ? relationship.properties.target_record_type
    : 'cid';

  if (!entities.has(relationship.source)) {
    entities.set(relationship.source, {
      id: relationship.source,
      type: sourceType || 'cid',
      label: sourceLabel || formatCidForDisplay(relationship.source),
      properties: {},
    });
  }
  if (!entities.has(relationship.target)) {
    entities.set(relationship.target, {
      id: relationship.target,
      type: targetType || 'cid',
      label: targetLabel || formatCidForDisplay(relationship.target),
      properties: {},
    });
  }
}

function addMergedResult(
  merged: Map<string, SearchResult>,
  section: CorpusSection,
  query: string,
  score: number,
  parts: Partial<SearchResult['scoreParts']>,
) {
  if (!section.ipfs_cid) return;
  const current = merged.get(section.ipfs_cid);
  const scoreParts = {
    keyword: parts.keyword || 0,
    vector: parts.vector || 0,
    title: parts.title || 0,
    citation: parts.citation || 0,
    bm25: parts.bm25 || 0,
    graph: parts.graph || 0,
  };
  if (!current) {
    merged.set(section.ipfs_cid, {
      ipfs_cid: section.ipfs_cid,
      section,
      score,
      scoreParts,
      snippet: buildSnippet(section.text, query),
      citation: section.bluebook_citation || section.official_cite || section.identifier,
    });
    return;
  }

  current.score += score;
  current.scoreParts.keyword += scoreParts.keyword;
  current.scoreParts.vector += scoreParts.vector;
  current.scoreParts.title += scoreParts.title;
  current.scoreParts.citation += scoreParts.citation;
  current.scoreParts.bm25 = (current.scoreParts.bm25 || 0) + (scoreParts.bm25 || 0);
  current.scoreParts.graph = (current.scoreParts.graph || 0) + (scoreParts.graph || 0);
  if (section.text.length > current.section.text.length) {
    current.section = section;
    current.snippet = buildSnippet(section.text, query);
  }
}

async function addGraphExpansionScores(
  results: SearchResult[],
  loadGraph: (cid: string) => Promise<{ entities: CorpusEntity[]; relationships: CorpusRelationship[] }>,
) {
  await Promise.all(results.map(async (result) => {
    try {
      const graph = await loadGraph(result.ipfs_cid);
      const graphScore = Math.min(1.5, graph.relationships.length * 0.08 + graph.entities.length * 0.03);
      result.score += graphScore;
      result.scoreParts.graph = graphScore;
    } catch {
      result.scoreParts.graph = 0;
    }
  }));
}

function matchesFilters(section: CorpusSection, filters: SearchFilters): boolean {
  if (filters.titleNumber && section.title_number !== filters.titleNumber && section.law_id !== filters.titleNumber) {
    return false;
  }
  return true;
}

function matchesTitleOrCitation(section: CorpusSection, normalizedQuery: string): boolean {
  return [
    section.identifier,
    section.official_cite,
    section.bluebook_citation,
    section.title,
    section.law_id || '',
    section.law_identifier || '',
    section.article_identifier || '',
    section.ipfs_cid,
    section.law_cid || '',
  ].some((value) => value.toLowerCase().includes(normalizedQuery));
}

function scoreCitation(section: CorpusSection, query: string): number {
  const normalizedQuery = query.toLowerCase();
  return matchesTitleOrCitation(section, normalizedQuery) ? 2 : 0;
}

function scoreTitle(section: CorpusSection, query: string): number {
  const normalizedQuery = query.toLowerCase();
  return section.title.toLowerCase().includes(normalizedQuery) ? 1 : 0;
}

function scoreVectorRow(row: DatasetRow, queryEmbedding?: Float32Array | number[]): number {
  const rawEmbedding = row.embedding;
  if (!queryEmbedding || !Array.isArray(rawEmbedding)) {
    return 0.35;
  }
  const query = queryEmbedding instanceof Float32Array ? queryEmbedding : new Float32Array(queryEmbedding);
  if (query.length !== rawEmbedding.length) {
    return 0.35;
  }
  const vector = new Float32Array(rawEmbedding.map((value) => Number(value) || 0));
  return cosineSimilarity(query, vector);
}

function scoreNumber(row: DatasetRow, field: string, fallback: number): number {
  const value = row[field];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function buildSnippet(text: string, query: string): string {
  const compactText = text.replace(/\s+/g, ' ').trim();
  if (!compactText) {
    return '';
  }

  const firstToken = tokenize(query)[0];
  const matchIndex = firstToken ? compactText.toLowerCase().indexOf(firstToken) : -1;
  const start = Math.max(0, matchIndex > -1 ? matchIndex - 80 : 0);
  const end = Math.min(compactText.length, start + 320);
  const prefix = start > 0 ? '...' : '';
  const suffix = end < compactText.length ? '...' : '';
  return `${prefix}${compactText.slice(start, end)}${suffix}`;
}

function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length > 1);
}

function vectorNorm(vector: Float32Array): number {
  let sum = 0;
  for (const value of vector) {
    sum += value * value;
  }
  return Math.sqrt(sum) || 1;
}

function cosineSimilarity(left: Float32Array, right: Float32Array): number {
  const leftNorm = vectorNorm(left);
  const rightNorm = vectorNorm(right);
  let dot = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
  }
  const similarity = dot / (leftNorm * rightNorm || 1);
  return Number.isFinite(similarity) ? similarity : 0;
}

async function viewerRows<T extends DatasetRow>({
  dataset,
  config,
  split,
  offset,
  length,
}: {
  dataset: string;
  config: string;
  split: string;
  offset: number;
  length: number;
}): Promise<T[]> {
  const data = await fetchViewerJson<ViewerRowsResponse<T>>('rows', {
    dataset,
    config,
    split,
    offset: String(offset),
    length: String(Math.min(length, 100)),
  });
  return (data.rows || []).map((item) => item.row);
}

async function searchViewerRows<T extends DatasetRow>({
  dataset,
  config,
  split,
  query,
  offset,
  length,
}: {
  dataset: string;
  config: string;
  split: string;
  query: string;
  offset: number;
  length: number;
}): Promise<T[]> {
  const data = await fetchViewerJson<ViewerRowsResponse<T>>('search', {
    dataset,
    config,
    split,
    query,
    offset: String(offset),
    length: String(Math.min(length, 100)),
  });
  return (data.rows || []).map((item) => item.row);
}

async function filterViewerRows<T extends DatasetRow>({
  dataset,
  config,
  split,
  where,
  orderby,
  offset,
  length,
}: {
  dataset: string;
  config: string;
  split: string;
  where: string;
  orderby?: string;
  offset: number;
  length: number;
}): Promise<T[]> {
  const params: Record<string, string> = {
    dataset,
    config,
    split,
    where,
    offset: String(offset),
    length: String(Math.min(length, 100)),
  };
  if (orderby) params.orderby = orderby;
  const data = await fetchViewerJson<ViewerRowsResponse<T>>('filter', params);
  return (data.rows || []).map((item) => item.row);
}

async function fetchViewerJson<T>(endpoint: string, params: Record<string, string>): Promise<T> {
  const url = `${DATASET_VIEWER_API}/${endpoint}?${new URLSearchParams(params).toString()}`;
  const data = await fetchJsonWithTimeout<T>(url);
  if (isRecord(data) && typeof data.error === 'string') {
    throw new Error(data.error);
  }
  return data;
}

function equalsPredicate(column: string, value: string): string {
  return `"${column.replace(/"/g, '""')}" = '${value.replace(/'/g, "''")}'`;
}

async function fetchHubDatasetInfo(dataset: string): Promise<DatasetRow> {
  return fetchJsonWithTimeout<DatasetRow>(`${HUGGING_FACE_API}/${dataset}`);
}

async function fetchJsonWithTimeout<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      throw new Error(`Request failed ${response.status}: ${url}`);
    }
    return response.json() as Promise<T>;
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

function getConfigCount(size: ViewerSizeResponse, config: string): number | undefined {
  return size.size?.configs?.find((item) => item.config === config)?.num_rows
    || size.size?.splits?.find((item) => item.config === config)?.num_rows;
}

function readString(row: DatasetRow, field: string): string {
  const value = row[field];
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function readNullableBoolean(row: DatasetRow, field: string): boolean | null {
  const value = row[field];
  if (typeof value === 'boolean') return value;
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
  }
  return null;
}

function readStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => (typeof item === 'string' ? item : '')).filter(Boolean);
  }
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return readStringArray(parsed);
    } catch {
      return value.split('>').map((item) => item.trim()).filter(Boolean);
    }
  }
  return [];
}

function readHierarchy(value: unknown): CorpusHierarchyItem[] {
  if (Array.isArray(value)) {
    return value
      .map((item): CorpusHierarchyItem | null => {
        if (!isRecord(item)) return null;
        return {
          kind: readString(item, 'kind'),
          label: readString(item, 'label'),
          number: readString(item, 'number') || null,
        };
      })
      .filter((item): item is CorpusHierarchyItem => Boolean(item?.label || item?.kind));
  }
  if (typeof value === 'string' && value.trim()) {
    try {
      return readHierarchy(JSON.parse(value));
    } catch {
      return [];
    }
  }
  return [];
}

function normalizeLawStatus(value: string): LegalRecordStatus {
  return normalizeRecordStatus(value);
}

function normalizeCid(value: string): string {
  return normalizeContentId(value);
}

function asIpfsUri(cid: string): string {
  return toIpfsUri(cid);
}

function normalizeGraphId(value: string): string {
  if (!value) return '';
  return value.replace(/^ipfs:\/\//i, '').trim();
}

function formatCidForDisplay(value: string): string {
  const cid = normalizeCid(value);
  return cid.length > 18 ? `${cid.slice(0, 10)}...${cid.slice(-6)}` : cid;
}

function isRecord(value: unknown): value is DatasetRow {
  return typeof value === 'object' && value !== null;
}

export function __resetWetWijzerCorpusCacheForTests(): void {
  staticManifestPromise = null;
  activeManifestPromise = null;
  staticCorpusPromise = null;
  activeCorpusPromise = null;
  staticBm25Promise = null;
  staticEmbeddingPromise = null;
  staticGraphPromise = null;
  provider = null;
}

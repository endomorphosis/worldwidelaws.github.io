/**
 * Bounded citation and structure navigation for the law reader.
 *
 * Graph construction follows country_laws_ir/graph.py at the pinned commit:
 * entry nodes, facet nodes, ARTICLE_OF, HAS_INSTRUMENT, identifier links,
 * and BM25_NEIGHBOR_OF. Adjacency pages use the same score order and the
 * 4096-pointer row cap. CIDs are cidutil payloads via cidOfJson.
 *
 * Expansion starts from a selected source record or an exact citation.
 * Structure links are the catalog parent and children of that record.
 * They are used when no graph is present. A present graph is walked from
 * its own adjacency pages and is not filled in with extra links.
 *
 * Node, depth, and network budgets stop before the next node, hop, or
 * adjacency page. The selected source stays in the result. reader.blocked
 * is always false. Every relationship keeps applicability "not-asserted".
 * A recorded link is not a conclusion that a law applies.
 */

import { canonicalJson, cidOfJson, utf8Bytes } from "../data/identity";
import {
  assignCitation,
  lookupCitations,
  type CitationLookupFormat,
  type CitationRecord,
  type CitationStatus,
} from "../search/citation";

export const GRAPH_SCHEMA = "worldwide-research-graph/v1";
export const GRAPH_APPLICABILITY = "not-asserted" as const;

export const FACET_IDENTITY_SCHEMA = "country-laws-facet/v1";
export const EDGE_IDENTITY_SCHEMA = "country-laws-edge/v1";
export const GRAPH_NODE_SCHEMA = "country-laws-ir-graphrag/v1";

export const ADJACENCY_POINTERS_PER_ROW = 4096;
export const ADJACENCY_POINTERS_PER_SHARD = 8192;
export const LABEL_MAX = 4096;

/** Reader defaults. Tighter than a batch query so one panel stays bounded. */
export const GRAPH_BUDGET = Object.freeze({
  maxNodes: 32,
  maxDepth: 2,
  maxNetworkBytes: 256 * 1024,
});

/**
 * Ceilings. Depth matches package.py max_remote_walk_depth. Nodes match the
 * query engine's default node cap. Network matches the BM25 default byte cap.
 */
export const GRAPH_BUDGET_CEILING = Object.freeze({
  maxNodes: 1024,
  maxDepth: 8,
  maxNetworkBytes: 8 * 1024 * 1024,
});

export const GRAPH_UPSTREAM = {
  repository: "/home/barberb/lift_coding/external/ipfs_datasets",
  commit: "2ea4ca6804b3c4cc44e43d0539f4c3fcae011747",
  license: "AGPL-3.0-only",
  files: {
    graph: {
      path: "ipfs_datasets_py/processors/legal_scrapers/country_laws_ir/graph.py",
      sha256: "db7ca5ee87406c2877d936be2b2f9dd4f42424d8a627791e0b01bc21b7c21acd",
    },
    structure: {
      path: "ipfs_datasets_py/processors/legal_scrapers/country_laws_ir/structure.py",
      sha256: "b1d62815c2d52738a1ab0d03ea3b0eeca1c7a2d71efd05b38333b963befa1d22",
    },
    citations: {
      path: "ipfs_datasets_py/processors/legal_scrapers/country_laws_ir/citations.py",
      sha256: "5b0b0d8d4083ddf9a186b8f27a1d8ad48b85cbe2584ec07119274455a7ea63d3",
    },
    query: {
      path: "ipfs_datasets_py/processors/legal_scrapers/country_laws_ir/query.py",
      sha256: "bca6bb94ff367d2758ce866065b6b9bcf1faa9ffd5102471d2c9cbbacc340eb3",
    },
    init: {
      path: "ipfs_datasets_py/processors/legal_scrapers/country_laws_ir/__init__.py",
      sha256: "024c968ed45252063aa8e3b3a006d464429d28591d4096d26b9377b7234df9cf",
    },
  },
} as const;

export const GRAPH_LIMITATIONS = [
  "Graph nodes, edges, labels, and adjacency order follow graph.py. A section record is stored as node_type article, and ARTICLE_OF still links it to the parent. That is the upstream else-branch.",
  "A missing identifier stays empty. graph.py can stringify a pandas NaN cell as the token nan. This port does not create that token.",
  "The multilingual heading segmenter in structure.py is not reimplemented. A parenthesized marker such as (1) or (a) stays inside the selected text and does not become a node.",
  "Catalog structure links are used only when no graph is present. A present graph is navigated as supplied, including when it does not mention the selected record.",
  "Node, depth, and network budgets stop before the next node, the next hop, or the next adjacency page. Pages already accepted stay. The selected source stays.",
  "Network bytes are the adjacency page size declared before the read. Catalog structure links do not spend the network budget. Depth 0 reads no page.",
  "Default budgets are 32 nodes, depth 2, and 256 KiB. The ceilings are 1024 nodes, depth 8, and 8 MiB. A request above a ceiling is refused. The selected source is still returned.",
  "reader.blocked is false on every result, including a missing graph, an empty graph, an unreadable graph, a refused budget, and an unknown citation.",
  "The result, every node, and every edge keeps claim status not-asserted. A BM25 score is a retrieval score. A jurisdiction facet is a recorded field. Neither is a conclusion about legal effect.",
  "Source evidence is copied from the selected row or from the graph node properties that were copied from that row. A neighbor that is not in the catalog does not inherit another row's URL.",
  "Assigned citation text is derived by the pinned citation rules and is marked assigned-citation. It does not replace the source URL, the source revision, or an identifier the source left empty.",
  "ADJACENCY_POINTERS_PER_SHARD is the package constant. Paging uses ADJACENCY_POINTERS_PER_ROW. This module does not download a remote corpus.",
] as const;

const PROMOTES = /\b(applies|applicable|applicability|governs|governing)\b/i;

const REASON = {
  structure: "Recorded structural link from the source catalog.",
  relationship: "Recorded graph relationship from the source graph.",
  neighbor: "Recorded BM25 neighbor from the source graph. The number is a retrieval score.",
  jurisdiction: "Recorded jurisdiction facet from the source row.",
  absent: "No graph was supplied. The selected source remains available to the reader.",
  empty: "The supplied graph has no nodes and no edges. The selected source remains available to the reader.",
  unreadable: "The graph could not be read. The selected source remains available to the reader.",
} as const;

const PROPERTY_KEYS = [
  "record_type",
  "instrument_id",
  "instrument_title",
  "law_cid",
  "article_number",
  "article_title",
  "jurisdiction",
  "language",
  "source_url",
  "snapshot_date",
  "coverage",
  "license",
  "collector",
  "source_id",
  "eli",
  "law_status",
  "source_type",
] as const;

const FACET_FIELDS = [
  ["jurisdiction", "HAS_JURISDICTION", "jurisdiction"],
  ["language", "HAS_LANGUAGE", "language"],
  ["instrument", "HAS_INSTRUMENT", "instrument_id"],
  ["source", "HAS_SOURCE", "source_type"],
  ["status", "HAS_STATUS", "law_status"],
] as const;

const FIELD_ALIASES: Record<string, readonly string[]> = {
  entry_cid: ["entry_cid", "entryCid", "cid", "ipfs_cid"],
  record_type: ["record_type", "recordType"],
  law_cid: ["law_cid", "lawCid"],
  instrument_id: ["instrument_id", "instrumentId", "law_id", "lawId"],
  instrument_title: ["instrument_title", "instrumentTitle"],
  title: ["title"],
  article_number: ["article_number", "articleNumber"],
  article_title: ["article_title", "articleTitle"],
  section_number: ["section_number", "sectionNumber"],
  jurisdiction: ["jurisdiction"],
  country: ["country"],
  slug: ["slug"],
  language: ["language"],
  source_url: ["source_url", "sourceUrl"],
  snapshot_date: ["snapshot_date", "snapshotDate"],
  coverage: ["coverage"],
  license: ["license"],
  collector: ["collector"],
  source_id: ["source_id", "sourceId"],
  source_revision: ["source_revision", "sourceRevision"],
  eli: ["eli"],
  law_status: ["law_status", "lawStatus", "status"],
  source_type: ["source_type", "sourceType"],
  official_identifier: ["official_identifier", "officialIdentifier", "official_cite", "officialCitation"],
  identifier: ["identifier"],
  year: ["year"],
  text: ["text", "body"],
};

export class GraphBuildError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = "GraphBuildError";
    this.code = code;
  }
}

export interface GraphRecord {
  [key: string]: unknown;
}

export type NeighborTuple =
  | readonly [number, number | null]
  | readonly [number, number | null, readonly string[]];

export interface GraphNode {
  node_cid: string;
  node_type: string;
  entry_cid: string;
  label: string;
  properties_json: string;
  schema_version: string;
}

export interface GraphEdge {
  edge_cid: string;
  edge_type: string;
  source_cid: string;
  target_cid: string;
  retrieval_method: string;
  score: number | null;
  query_terms_json: string;
  matched_terms: string[];
  properties_json: string;
  schema_version: string;
}

export interface AdjacencyPage {
  direction: "incoming" | "outgoing";
  node_cid: string;
  page_index: number;
  page_count: number;
  neighbor_count: number;
  total_neighbor_count: number;
  neighbor_cids: string[];
  neighbor_node_types: string[];
  edge_types: string[];
  edge_cids: string[];
  retrieval_methods: string[];
  scores: Array<number | null>;
  schema_version: string;
}

export interface PropertyGraphStats {
  n_nodes: number;
  n_edges: number;
  n_doc_nodes: number;
  n_facet_nodes: number;
  edge_types: string[];
}

export interface PropertyGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  incoming: AdjacencyPage[];
  outgoing: AdjacencyPage[];
  stats: PropertyGraphStats;
  warnings: string[];
}

export interface GraphBuildOptions {
  adjacencyPageSize?: number;
}

export interface GraphPageQuery {
  node_cid: string;
  direction: "incoming" | "outgoing";
  page_index: number;
}

export interface GraphNetworkSource {
  byteLength(query: GraphPageQuery): number | null;
  read(query: GraphPageQuery): AdjacencyPage;
}

export interface GraphBudgets {
  maxNodes: number;
  maxDepth: number;
  maxNetworkBytes: number;
}

export type GraphDirection = "both" | "outgoing" | "incoming";
export type GraphStopReason = "nodes" | "depth" | "network" | "rejected-budget" | "unreadable";
export type GraphAbsenceReason = "absent" | "empty" | "unreadable";

export interface SourceEvidence {
  origin: "source-record";
  entry_cid: string;
  source_url: string;
  source_revision: string;
  snapshot_date: string;
  license: string;
  collector: string;
  source_id: string;
  eli: string;
  official_identifier: string;
  identifier: string;
  instrument_id: string;
  instrument_title: string;
  jurisdiction: string;
  language: string;
  record_type: string;
  article_number: string;
  title: string;
  law_cid: string;
}

export interface GraphNodeEvidence {
  origin: "graph-node";
  node_cid: string;
  node_type: string;
  label: string;
  properties_json: string;
}

export interface DerivedCitation {
  origin: "assigned-citation";
  official_citation: string;
  bluebook_citation: string;
  cite_key: string;
  citation_status: CitationStatus;
  native_identifier: string;
  pinpoint: string;
}

export interface NavigationNode {
  node_cid: string;
  depth: number;
  role: "selected" | "structure" | "graph";
  applicability: typeof GRAPH_APPLICABILITY;
  promotes_applicability: false;
  label: string;
  evidence: SourceEvidence | GraphNodeEvidence | null;
  evidence_status: "source-record" | "graph-node" | "not-in-catalog";
  citation: DerivedCitation | null;
  reader_text: string;
}

export interface NavigationEdge {
  edge_cid: string;
  edge_type: string;
  source_cid: string;
  target_cid: string;
  depth: number;
  score: number | null;
  retrieval_score: number | null;
  applicability: typeof GRAPH_APPLICABILITY;
  promotes_applicability: false;
  reason: string;
  origin: "catalog-structure" | "graph";
}

export interface CitationGraphExpansion {
  schema: typeof GRAPH_SCHEMA;
  applicability: typeof GRAPH_APPLICABILITY;
  promotes_applicability: false;
  reader: {
    blocked: false;
    text: string;
    source_url: string;
    source_revision: string;
    entry_cid: string;
  };
  graph: {
    supplied: boolean;
    present: boolean;
    covers_selection: boolean;
    absence: { reason: GraphAbsenceReason; detail: string } | null;
  };
  complete: boolean;
  stop_reason: GraphStopReason | null;
  problem: string | null;
  problem_detail: string;
  budgets: {
    max_nodes: number;
    max_depth: number;
    max_network_bytes: number;
    nodes_used: number;
    depth_reached: number;
    network_bytes: number;
  };
  nodes: NavigationNode[];
  edges: NavigationEdge[];
  limitations: readonly string[];
}

export interface ExpansionRequest {
  selected?: GraphRecord | null;
  citation?: string | null;
  format?: CitationLookupFormat | string | null;
  catalog?: readonly GraphRecord[] | null;
  sourceRevision?: string | null;
  jurisdiction?: string | null;
  graph?: PropertyGraph | null;
  network?: GraphNetworkSource | null;
  budgets?: Partial<GraphBudgets> | null;
  direction?: GraphDirection | "out" | "in" | string | null;
  edgeTypes?: readonly string[] | null;
}

for (const text of Object.values(REASON)) assertSafeWording(text);

export function wordingPromotesApplicability(text: string): boolean {
  return PROMOTES.test(text);
}

export function graphLabel(text: string | null | undefined, fallback: string): string {
  const cleaned = pyStrip(String(text ?? "").replaceAll("\u0000", "")) || fallback;
  const chars = Array.from(cleaned);
  if (chars.length > LABEL_MAX) return `${chars.slice(0, LABEL_MAX - 3).join("")}...`;
  return cleaned;
}

export function facetCid(kind: string, value: string): string {
  return cidOfJson({ kind, schema: FACET_IDENTITY_SCHEMA, value });
}

export function edgeCid(source: string, edgeType: string, target: string): string {
  return cidOfJson({
    edge_type: edgeType,
    schema: EDGE_IDENTITY_SCHEMA,
    source,
    target,
  });
}

export function adjacencyPageBytes(page: AdjacencyPage): number {
  return utf8Bytes(canonicalJson(page)).length;
}

export function buildPropertyGraph(
  records: readonly GraphRecord[],
  neighbors: readonly (readonly NeighborTuple[])[] = [],
  options: GraphBuildOptions = {},
): PropertyGraph {
  const pageSize = options.adjacencyPageSize ?? ADJACENCY_POINTERS_PER_ROW;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > ADJACENCY_POINTERS_PER_ROW) {
    throw new GraphBuildError("page-size", "adjacency page size must be an integer from 1 to 4096");
  }
  if (neighbors.length !== 0 && neighbors.length !== records.length) {
    throw new GraphBuildError("neighbors", "neighbor rows must align with corpus records");
  }
  const warnings: string[] = [];
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const seenFacets = new Set<string>();
  const entryByInstrument = new Map<string, string>();
  const cids: string[] = [];

  records.forEach((record, index) => {
    const entryCid = pick(record, "entry_cid");
    cids.push(entryCid);
    const instrumentId = pick(record, "instrument_id");
    if (pick(record, "record_type") === "law" && instrumentId && entryCid) {
      if (!entryByInstrument.has(instrumentId)) entryByInstrument.set(instrumentId, entryCid);
    }
    const lawCid = pick(record, "law_cid");
    if (!lawCid || nodes.some((node) => node.node_cid === lawCid && node.node_type === "law")) return;
    nodes.push(lawNode(record, lawCid, instrumentId));
  });

  records.forEach((record, index) => {
    const entryCid = cids[index];
    if (!entryCid) {
      warnings.push(`skipped record ${index}: missing entry_cid`);
      return;
    }
    const recordType = pick(record, "record_type");
    const nodeType = recordType === "law" ? "law_entry" : recordType === "notice" ? "notice" : "article";
    const sourceId = pick(record, "source_id");
    const title = pick(record, "title") || pick(record, "instrument_title") || sourceId;
    nodes.push({
      node_cid: entryCid,
      node_type: nodeType,
      entry_cid: entryCid,
      label: graphLabel(title || sourceId, sourceId),
      properties_json: propertiesJson(propertyMap(record)),
      schema_version: GRAPH_NODE_SCHEMA,
    });

    for (const [kind, edgeType, column] of FACET_FIELDS) {
      const value = pyStrip(pick(record, column));
      if (!value) continue;
      const cid = facetCid(kind, value);
      if (!seenFacets.has(cid)) {
        seenFacets.add(cid);
        nodes.push(facetNode(kind, value, cid));
      }
      edges.push(makeEdge(entryCid, edgeType, cid, "facet", 1, { facet: kind, value }));
    }

    const eli = pyStrip(pick(record, "eli"));
    if (eli) {
      const cid = facetCid("eli", eli);
      if (!seenFacets.has(cid)) {
        seenFacets.add(cid);
        nodes.push(facetNode("eli", eli, cid));
      }
      edges.push(makeEdge(entryCid, "IDENTIFIED_BY_ELI", cid, "identifier", 1, { eli }));
    }
    const identifier = pyStrip(pick(record, "official_identifier")) || pyStrip(pick(record, "identifier"));
    if (identifier && identifier !== eli) {
      const cid = facetCid("identifier", identifier);
      if (!seenFacets.has(cid)) {
        seenFacets.add(cid);
        nodes.push(facetNode("identifier", identifier, cid));
      }
      edges.push(makeEdge(entryCid, "IDENTIFIED_BY", cid, "identifier", 1, { identifier }));
    }

    const lawCid = pick(record, "law_cid");
    const instrumentId = pick(record, "instrument_id");
    if (recordType === "article" || recordType === "section") {
      const parent = entryByInstrument.get(instrumentId) || lawCid;
      if (parent && parent !== entryCid) {
        const articleNumber = hasField(record, "article_number") ? pick(record, "article_number") : undefined;
        edges.push(makeEdge(entryCid, "ARTICLE_OF", parent, "structural", 1, {
          instrument_id: instrumentId,
          article_number: articleNumber,
        }));
      }
    } else if (lawCid && entryCid !== lawCid) {
      edges.push(makeEdge(entryCid, "HAS_INSTRUMENT", lawCid, "structural", 1, { instrument_id: instrumentId }));
    }
  });

  records.forEach((_record, index) => {
    const source = cids[index];
    if (!source) return;
    for (const item of neighbors[index] ?? []) {
      const pointer = readNeighbor(item, index);
      const target = cids[pointer.index];
      if (!target) throw new GraphBuildError("neighbor-index", `neighbor ${pointer.index} has no entry_cid`);
      edges.push(makeEdge(
        source,
        "BM25_NEIGHBOR_OF",
        target,
        "bm25-okapi",
        pointer.score,
        { k: 8, neighbor_index: pointer.index },
        pointer.terms,
      ));
    }
  });

  const uniqueNodes = dedupe(nodes, (node) => node.node_cid)
    .sort((left, right) => compareText(left.node_type, right.node_type) || compareText(left.node_cid, right.node_cid));
  const uniqueEdges = dedupe(edges, (edge) => edge.edge_cid)
    .sort((left, right) => compareText(left.edge_type, right.edge_type)
      || compareText(left.source_cid, right.source_cid)
      || compareText(left.target_cid, right.target_cid));
  const nodeType = new Map(uniqueNodes.map((node) => [node.node_cid, node.node_type]));
  const incoming = adjacencyPages(uniqueEdges, nodeType, "incoming", pageSize);
  const outgoing = adjacencyPages(uniqueEdges, nodeType, "outgoing", pageSize);
  return {
    nodes: uniqueNodes,
    edges: uniqueEdges,
    incoming,
    outgoing,
    stats: {
      n_nodes: uniqueNodes.length,
      n_edges: uniqueEdges.length,
      n_doc_nodes: uniqueNodes.filter((node) => node.node_type === "law_entry" || node.node_type === "article" || node.node_type === "law").length,
      n_facet_nodes: uniqueNodes.filter((node) => node.node_type.startsWith("facet_")).length,
      edge_types: [...new Set(uniqueEdges.map((edge) => edge.edge_type))].sort((left, right) => compareText(left, right)),
    },
    warnings,
  };
}

export function expandSelectedCitation(request: ExpansionRequest = {}): CitationGraphExpansion {
  const safe = request ?? {};
  try {
    return expandSelectedCitationUnchecked(safe);
  } catch {
    const selected = safe.selected ?? null;
    const base = blankExpansion(readerPayload(selected), {
      maxNodes: GRAPH_BUDGET.maxNodes,
      maxDepth: GRAPH_BUDGET.maxDepth,
      maxNetworkBytes: GRAPH_BUDGET.maxNetworkBytes,
    });
    base.problem = "unreadable";
    base.problem_detail = REASON.unreadable;
    base.stop_reason = "unreadable";
    base.graph.supplied = true;
    base.graph.absence = { reason: "unreadable", detail: REASON.unreadable };
    const catalog = Array.isArray(safe.catalog) ? safe.catalog : [];
    pushSelected(base, selected, catalog);
    return base;
  }
}

function expandSelectedCitationUnchecked(request: ExpansionRequest): CitationGraphExpansion {
  const catalog = [...(request.catalog ?? [])];
  const selected = request.selected ?? null;
  const reader = readerPayload(selected);
  const budgets = resolveBudgets(request.budgets);
  const direction = resolveDirection(request.direction);
  const base = blankExpansion(reader, budgets.normalized);

  if (!budgets.ok || !direction.ok) {
    base.problem = "rejected-budget";
    base.problem_detail = assertSafeWording(budgets.ok ? direction.detail : budgets.detail);
    base.stop_reason = "rejected-budget";
    base.budgets.max_nodes = budgets.normalized.maxNodes;
    base.budgets.max_depth = budgets.normalized.maxDepth;
    base.budgets.max_network_bytes = budgets.normalized.maxNetworkBytes;
    pushSelected(base, selected, catalog);
    return base;
  }

  let formatError = "";
  const seeds = resolveSeeds(selected, catalog, request, (detail) => {
    formatError = detail;
  });
  if (formatError) {
    base.problem = "rejected-budget";
    base.problem_detail = assertSafeWording(formatError);
    base.stop_reason = "rejected-budget";
    pushSelected(base, selected, catalog);
    return base;
  }
  if (seeds.length === 0) {
    base.problem = selected ? "missing-entry-cid" : "no-selection";
    base.problem_detail = selected
      ? "The selected source has no entry id. Its text is still on the reader payload."
      : "No citation matched a source record.";
    base.complete = base.problem === "no-selection";
    base.stop_reason = base.problem === "no-selection" ? null : "rejected-budget";
    return base;
  }

  const graph = request.graph ?? null;
  const supplied = graph != null || request.network != null;
  const present = request.network != null || (graph != null && (graph.nodes.length > 0 || graph.edges.length > 0));
  base.graph.supplied = supplied;
  base.graph.present = present;
  if (!supplied) base.graph.absence = { reason: "absent", detail: REASON.absent };
  else if (!present) base.graph.absence = { reason: "empty", detail: REASON.empty };

  const network = request.network ?? (present && graph ? networkFromGraph(graph) : null);
  const byCid = indexCatalog(catalog);
  for (const seed of seeds) byCid.set(pick(seed, "entry_cid"), seed);
  const parents = parentIndex(catalog.length > 0 ? catalog : seeds);
  const edgeFilter = request.edgeTypes == null ? null : new Set(request.edgeTypes.filter((item) => item.trim()));
  const nodeByCid = new Map((graph?.nodes ?? []).map((node) => [node.node_cid, node]));
  const edgeByCid = new Map((graph?.edges ?? []).map((edge) => [edge.edge_cid, edge]));
  const seen = new Map<string, NavigationNode>();
  const seenEdges = new Set<string>();
  const queue: string[] = [];
  let stop: GraphStopReason | null = null;
  let networkBytes = 0;

  const addNode = (cid: string, depth: number, role: NavigationNode["role"]): boolean => {
    if (seen.has(cid)) return true;
    if (seen.size >= budgets.normalized.maxNodes) {
      stop = stop ?? "nodes";
      return false;
    }
    const record = byCid.get(cid) ?? null;
    const graphNode = nodeByCid.get(cid) ?? null;
    const node = navigationNode(cid, depth, role, record, graphNode);
    seen.set(cid, node);
    base.nodes.push(node);
    base.budgets.nodes_used = seen.size;
    base.budgets.depth_reached = Math.max(base.budgets.depth_reached, depth);
    queue.push(cid);
    return true;
  };

  const addEdge = (edge: NavigationEdge) => {
    const key = `${edge.source_cid}\u0000${edge.edge_type}\u0000${edge.target_cid}`;
    if (seenEdges.has(key)) return;
    seenEdges.add(key);
    base.edges.push(edge);
  };

  for (const seed of seeds) {
    const cid = pick(seed, "entry_cid");
    if (!addNode(cid, 0, "selected")) break;
  }

  const useStructure = !present;
  while (queue.length > 0 && stop == null) {
    const cid = queue.shift() as string;
    const node = seen.get(cid);
    if (!node) continue;
    if (node.depth >= budgets.normalized.maxDepth) {
      stop = "depth";
      queue.unshift(cid);
      break;
    }
    const steps: Array<{ source: string; target: string; edgeType: string; score: number | null; origin: NavigationEdge["origin"]; edgeId: string; terms: boolean }> = [];
    if (useStructure) {
      for (const link of structureLinks(cid, byCid.get(cid) ?? null, parents, byCid)) {
        if (edgeFilter && !edgeFilter.has(link.edgeType)) continue;
        steps.push({ ...link, score: 1, origin: "catalog-structure", edgeId: edgeCid(link.source, link.edgeType, link.target), terms: false });
      }
    }
    let afterSteps: GraphStopReason | null = null;
    if (network && present) {
      const directions: Array<"outgoing" | "incoming"> = direction.value === "incoming"
        ? ["incoming"]
        : direction.value === "outgoing"
          ? ["outgoing"]
          : ["outgoing", "incoming"];
      let haltReads = false;
      for (const pageDirection of directions) {
        for (let pageIndex = 0; !haltReads; pageIndex += 1) {
          const query = { node_cid: cid, direction: pageDirection, page_index: pageIndex };
          let size: number | null;
          try {
            size = network.byteLength(query);
          } catch {
            afterSteps = "unreadable";
            base.graph.absence = { reason: "unreadable", detail: REASON.unreadable };
            haltReads = true;
            break;
          }
          if (size == null) break;
          if (!Number.isInteger(size) || size < 0) {
            afterSteps = "unreadable";
            base.graph.absence = { reason: "unreadable", detail: REASON.unreadable };
            haltReads = true;
            break;
          }
          if (networkBytes + size > budgets.normalized.maxNetworkBytes) {
            afterSteps = afterSteps ?? "network";
            haltReads = true;
            break;
          }
          let page: AdjacencyPage;
          try {
            page = network.read(query);
          } catch {
            afterSteps = "unreadable";
            base.graph.absence = { reason: "unreadable", detail: REASON.unreadable };
            haltReads = true;
            break;
          }
          if (!pageMatches(page, query)) {
            afterSteps = "unreadable";
            base.graph.absence = { reason: "unreadable", detail: REASON.unreadable };
            haltReads = true;
            break;
          }
          networkBytes += size;
          base.budgets.network_bytes = networkBytes;
          for (let slot = 0; slot < page.neighbor_cids.length; slot += 1) {
            const edgeType = page.edge_types[slot] ?? "";
            if (edgeFilter && !edgeFilter.has(edgeType)) continue;
            const neighbor = page.neighbor_cids[slot] ?? "";
            if (!neighbor) continue;
            const stored = edgeByCid.get(page.edge_cids[slot] ?? "");
            const source = pageDirection === "outgoing" ? cid : neighbor;
            const target = pageDirection === "outgoing" ? neighbor : cid;
            steps.push({
              source,
              target,
              edgeType,
              score: stored ? stored.score : page.scores[slot] ?? null,
              origin: "graph",
              edgeId: page.edge_cids[slot] || edgeCid(source, edgeType, target),
              terms: edgeType === "BM25_NEIGHBOR_OF",
            });
          }
        }
      }
    }
    for (const step of steps) {
      const other = step.source === cid ? step.target : step.source;
      const depth = node.depth + 1;
      const role: NavigationNode["role"] = step.origin === "catalog-structure" ? "structure" : "graph";
      const existing = seen.get(other);
      if (!existing && !addNode(other, depth, role)) break;
      const placed = seen.get(other);
      if (!placed) break;
      addEdge({
        edge_cid: step.edgeId,
        edge_type: step.edgeType,
        source_cid: step.source,
        target_cid: step.target,
        depth: placed.depth,
        score: finiteScore(step.score),
        retrieval_score: step.terms ? finiteScore(step.score) : null,
        applicability: GRAPH_APPLICABILITY,
        promotes_applicability: false,
        reason: reasonFor(step.edgeType),
        origin: step.origin,
      });
    }
    if (afterSteps) {
      stop = stop ?? afterSteps;
      break;
    }
  }

  if (queue.some((cid) => (seen.get(cid)?.depth ?? 0) >= budgets.normalized.maxDepth)) {
    stop = stop ?? "depth";
  }
  base.stop_reason = stop;
  base.complete = stop == null;
  base.graph.covers_selection = base.nodes.some((node) => node.role === "selected" && nodeByCid.has(node.node_cid));
  if (present && graph) {
    base.graph.covers_selection = base.nodes.some((node) => node.role === "selected" && graph.nodes.some((item) => item.node_cid === node.node_cid));
  }
  return base;
}

function assertSafeWording(text: string): string {
  if (PROMOTES.test(text)) throw new Error("relationship wording promotes a legal conclusion");
  return text;
}

function reasonFor(edgeType: string): string {
  if (edgeType === "BM25_NEIGHBOR_OF") return REASON.neighbor;
  if (edgeType === "HAS_JURISDICTION") return REASON.jurisdiction;
  if (edgeType === "ARTICLE_OF" || edgeType === "HAS_INSTRUMENT") return REASON.structure;
  return REASON.relationship;
}

function blankExpansion(reader: CitationGraphExpansion["reader"], budgets: GraphBudgets): CitationGraphExpansion {
  return {
    schema: GRAPH_SCHEMA,
    applicability: GRAPH_APPLICABILITY,
    promotes_applicability: false,
    reader,
    graph: { supplied: false, present: false, covers_selection: false, absence: null },
    complete: false,
    stop_reason: null,
    problem: null,
    problem_detail: "",
    budgets: {
      max_nodes: budgets.maxNodes,
      max_depth: budgets.maxDepth,
      max_network_bytes: budgets.maxNetworkBytes,
      nodes_used: 0,
      depth_reached: 0,
      network_bytes: 0,
    },
    nodes: [],
    edges: [],
    limitations: GRAPH_LIMITATIONS,
  };
}

function readerPayload(selected: GraphRecord | null): CitationGraphExpansion["reader"] {
  return {
    blocked: false,
    text: selected ? pick(selected, "text") : "",
    source_url: selected ? pick(selected, "source_url") : "",
    source_revision: selected ? pick(selected, "source_revision") : "",
    entry_cid: selected ? pick(selected, "entry_cid") : "",
  };
}

function pushSelected(result: CitationGraphExpansion, selected: GraphRecord | null, catalog: readonly GraphRecord[]): void {
  if (!selected) return;
  const cid = pick(selected, "entry_cid");
  if (!cid) return;
  const merged = indexCatalog(catalog);
  merged.set(cid, selected);
  result.nodes.push(navigationNode(cid, 0, "selected", selected, null));
  result.budgets.nodes_used = 1;
}

function resolveBudgets(input: Partial<GraphBudgets> | null | undefined): { ok: true; normalized: GraphBudgets } | { ok: false; normalized: GraphBudgets; detail: string } {
  const normalized: GraphBudgets = {
    maxNodes: input?.maxNodes ?? GRAPH_BUDGET.maxNodes,
    maxDepth: input?.maxDepth ?? GRAPH_BUDGET.maxDepth,
    maxNetworkBytes: input?.maxNetworkBytes ?? GRAPH_BUDGET.maxNetworkBytes,
  };
  const checks: Array<[number, number, string]> = [
    [normalized.maxNodes, GRAPH_BUDGET_CEILING.maxNodes, "maxNodes"],
    [normalized.maxDepth, GRAPH_BUDGET_CEILING.maxDepth, "maxDepth"],
    [normalized.maxNetworkBytes, GRAPH_BUDGET_CEILING.maxNetworkBytes, "maxNetworkBytes"],
  ];
  for (const [value, ceiling, name] of checks) {
    if (typeof value !== "number" || !Number.isInteger(value) || value < (name === "maxNodes" ? 1 : 0) || value > ceiling) {
      return { ok: false, normalized, detail: `${name} is outside the admitted budget.` };
    }
  }
  return { ok: true, normalized };
}

function resolveDirection(input: ExpansionRequest["direction"]): { ok: true; value: GraphDirection } | { ok: false; detail: string } {
  const text = String(input ?? "both").trim().toLowerCase();
  if (text === "both") return { ok: true, value: "both" };
  if (text === "out" || text === "outgoing") return { ok: true, value: "outgoing" };
  if (text === "in" || text === "incoming") return { ok: true, value: "incoming" };
  return { ok: false, detail: "direction is outside the admitted set." };
}

function resolveSeeds(
  selected: GraphRecord | null,
  catalog: readonly GraphRecord[],
  request: ExpansionRequest,
  onFormat: (detail: string) => void,
): GraphRecord[] {
  if (selected && pick(selected, "entry_cid")) return [selected];
  const citation = String(request.citation ?? "").trim();
  if (!citation) return [];
  const records = catalog.map(toCitationRecord);
  try {
    const hits = lookupCitations(records, citation, {
      format: request.format ?? "any",
      limit: GRAPH_BUDGET_CEILING.maxNodes,
      sourceRevision: request.sourceRevision,
      jurisdiction: request.jurisdiction,
    });
    const byKey = new Map(records.map((record, index) => [citationIdentity(record), catalog[index]]));
    return hits.map((hit) => byKey.get(citationIdentity(hit))).filter((record): record is GraphRecord => Boolean(record));
  } catch (error) {
    onFormat(error instanceof Error ? error.message : "citation format was refused");
    return [];
  }
}

function toCitationRecord(record: GraphRecord): CitationRecord {
  return assignCitation({
    eli: pick(record, "eli"),
    officialIdentifier: pick(record, "official_identifier"),
    identifier: pick(record, "identifier"),
    instrumentTitle: pick(record, "instrument_title"),
    articleNumber: pick(record, "article_number"),
    sectionNumber: pick(record, "section_number"),
    recordType: pick(record, "record_type") || "law",
    jurisdiction: pick(record, "jurisdiction"),
    country: pick(record, "country"),
    slug: pick(record, "slug"),
    year: pick(record, "year"),
    snapshotDate: pick(record, "snapshot_date"),
    lawId: pick(record, "instrument_id") || pick(record, "law_cid"),
    entryCid: pick(record, "entry_cid"),
    sourceRevision: pick(record, "source_revision"),
    title: pick(record, "title"),
    language: pick(record, "language"),
  });
}

function citationIdentity(record: CitationRecord): string {
  return [record.entryCid, record.lawId, record.officialCitation, record.citeKey].join("\u0000");
}

function navigationNode(
  cid: string,
  depth: number,
  role: NavigationNode["role"],
  record: GraphRecord | null,
  graphNode: GraphNode | null,
): NavigationNode {
  const evidence = record ? sourceEvidence(record) : graphNode ? graphEvidence(graphNode) : null;
  return {
    node_cid: cid,
    depth,
    role,
    applicability: GRAPH_APPLICABILITY,
    promotes_applicability: false,
    label: record ? graphLabel(pick(record, "title") || pick(record, "instrument_title") || pick(record, "source_id"), pick(record, "source_id") || cid) : graphNode?.label ?? cid,
    evidence,
    evidence_status: record ? "source-record" : graphNode ? "graph-node" : "not-in-catalog",
    citation: record ? derivedCitation(record) : null,
    reader_text: record ? pick(record, "text") : "",
  };
}

function sourceEvidence(record: GraphRecord): SourceEvidence {
  return {
    origin: "source-record",
    entry_cid: pick(record, "entry_cid"),
    source_url: pick(record, "source_url"),
    source_revision: pick(record, "source_revision"),
    snapshot_date: pick(record, "snapshot_date"),
    license: pick(record, "license"),
    collector: pick(record, "collector"),
    source_id: pick(record, "source_id"),
    eli: pick(record, "eli"),
    official_identifier: pick(record, "official_identifier"),
    identifier: pick(record, "identifier"),
    instrument_id: pick(record, "instrument_id"),
    instrument_title: pick(record, "instrument_title"),
    jurisdiction: pick(record, "jurisdiction"),
    language: pick(record, "language"),
    record_type: pick(record, "record_type"),
    article_number: pick(record, "article_number"),
    title: pick(record, "title"),
    law_cid: pick(record, "law_cid"),
  };
}

function graphEvidence(node: GraphNode): GraphNodeEvidence {
  return {
    origin: "graph-node",
    node_cid: node.node_cid,
    node_type: node.node_type,
    label: node.label,
    properties_json: node.properties_json,
  };
}

function derivedCitation(record: GraphRecord): DerivedCitation {
  const citation = toCitationRecord(record);
  return {
    origin: "assigned-citation",
    official_citation: citation.officialCitation,
    bluebook_citation: citation.bluebookCitation,
    cite_key: citation.citeKey,
    citation_status: citation.citationStatus,
    native_identifier: citation.nativeIdentifier,
    pinpoint: citation.pinpoint,
  };
}

function indexCatalog(records: readonly GraphRecord[]): Map<string, GraphRecord> {
  const map = new Map<string, GraphRecord>();
  for (const record of records) {
    const cid = pick(record, "entry_cid");
    if (cid && !map.has(cid)) map.set(cid, record);
  }
  return map;
}

function parentIndex(records: readonly GraphRecord[]): Map<string, string> {
  const entryByInstrument = new Map<string, string>();
  for (const record of records) {
    const instrumentId = pick(record, "instrument_id");
    const entryCid = pick(record, "entry_cid");
    if (pick(record, "record_type") === "law" && instrumentId && entryCid && !entryByInstrument.has(instrumentId)) {
      entryByInstrument.set(instrumentId, entryCid);
    }
  }
  const parentOf = new Map<string, string>();
  for (const record of records) {
    const entryCid = pick(record, "entry_cid");
    const recordType = pick(record, "record_type");
    if (!entryCid || (recordType !== "article" && recordType !== "section")) continue;
    const parent = entryByInstrument.get(pick(record, "instrument_id")) || pick(record, "law_cid");
    if (parent && parent !== entryCid) parentOf.set(entryCid, parent);
  }
  return parentOf;
}

function structureLinks(
  cid: string,
  record: GraphRecord | null,
  parents: Map<string, string>,
  byCid: Map<string, GraphRecord>,
): Array<{ source: string; target: string; edgeType: string }> {
  const links: Array<{ source: string; target: string; edgeType: string }> = [];
  const parent = parents.get(cid);
  if (parent && byCid.has(parent)) links.push({ source: cid, target: parent, edgeType: "ARTICLE_OF" });
  const children = [...parents.entries()]
    .filter(([child, value]) => value === cid && child !== cid && byCid.has(child))
    .map(([child]) => child)
    .sort(compareText);
  for (const child of children) links.push({ source: child, target: cid, edgeType: "ARTICLE_OF" });
  if (record && pick(record, "record_type") === "law") {
    const lawCid = pick(record, "law_cid");
    if (lawCid && lawCid !== cid && byCid.has(lawCid)) {
      links.push({ source: cid, target: lawCid, edgeType: "HAS_INSTRUMENT" });
    }
  }
  return links;
}

function networkFromGraph(graph: PropertyGraph): GraphNetworkSource {
  return {
    byteLength(query) {
      const page = findPage(graph, query);
      return page ? adjacencyPageBytes(page) : null;
    },
    read(query) {
      const page = findPage(graph, query);
      if (!page) throw new GraphBuildError("missing-page", "adjacency page is not in the graph");
      return page;
    },
  };
}

function findPage(graph: PropertyGraph, query: GraphPageQuery): AdjacencyPage | null {
  const pages = query.direction === "incoming" ? graph.incoming : graph.outgoing;
  return pages.find((page) => page.node_cid === query.node_cid && page.page_index === query.page_index) ?? null;
}

function pageMatches(page: AdjacencyPage, query: GraphPageQuery): boolean {
  if (!page || page.node_cid !== query.node_cid || page.direction !== query.direction || page.page_index !== query.page_index) return false;
  const count = page.neighbor_cids.length;
  return page.edge_types.length === count && page.edge_cids.length === count && page.scores.length === count;
}

function lawNode(record: GraphRecord, lawCid: string, instrumentId: string): GraphNode {
  const title = pick(record, "instrument_title");
  return {
    node_cid: lawCid,
    node_type: "law",
    entry_cid: "",
    label: graphLabel(title || instrumentId, instrumentId),
    properties_json: propertiesJson({
      instrument_id: instrumentId,
      instrument_title: title,
      jurisdiction: pick(record, "jurisdiction"),
      language: pick(record, "language"),
      law_cid: lawCid,
    }),
    schema_version: GRAPH_NODE_SCHEMA,
  };
}

function facetNode(kind: string, value: string, cid: string): GraphNode {
  return {
    node_cid: cid,
    node_type: `facet_${kind}`,
    entry_cid: "",
    label: graphLabel(`${kind}:${value}`, kind),
    properties_json: propertiesJson({ kind, value }),
    schema_version: GRAPH_NODE_SCHEMA,
  };
}

function makeEdge(
  source: string,
  edgeType: string,
  target: string,
  method: string,
  score: number | null,
  props: Record<string, string | number | undefined>,
  terms: readonly string[] = [],
): GraphEdge {
  const matched = [...terms];
  return {
    edge_cid: edgeCid(source, edgeType, target),
    edge_type: edgeType,
    source_cid: source,
    target_cid: target,
    retrieval_method: method,
    score: finiteScore(score),
    query_terms_json: canonicalJson(matched),
    matched_terms: matched,
    properties_json: propertiesJson(props),
    schema_version: GRAPH_NODE_SCHEMA,
  };
}

function propertyMap(record: GraphRecord): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of PROPERTY_KEYS) out[key] = pick(record, key);
  return out;
}

function propertiesJson(props: Record<string, string | number | undefined>): string {
  const out: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(props)) {
    if (value == null) continue;
    out[key] = value;
  }
  return canonicalJson(out);
}

function readNeighbor(item: NeighborTuple, row: number): { index: number; score: number | null; terms: string[] } {
  if (!Array.isArray(item) || item.length < 2 || item.length > 3) {
    throw new GraphBuildError("neighbor", `neighbor row ${row} has an unreadable tuple`);
  }
  const index = item[0];
  if (typeof index !== "number" || !Number.isInteger(index) || index < 0) {
    throw new GraphBuildError("neighbor-index", `neighbor row ${row} index is not a non-negative integer`);
  }
  const score = item[1];
  if (score != null && typeof score !== "number") {
    throw new GraphBuildError("neighbor-score", `neighbor row ${row} score is not a number`);
  }
  const terms = item.length === 3 ? item[2] : [];
  if (!Array.isArray(terms) || terms.some((term) => typeof term !== "string")) {
    throw new GraphBuildError("neighbor-terms", `neighbor row ${row} terms are not strings`);
  }
  return { index, score: finiteScore(score), terms: [...terms] };
}

function finiteScore(score: number | null | undefined): number | null {
  if (typeof score !== "number" || !Number.isFinite(score)) return null;
  return Object.is(score, -0) ? 0 : score;
}

function adjacencyPages(
  edges: readonly GraphEdge[],
  nodeType: Map<string, string>,
  direction: "incoming" | "outgoing",
  pageSize: number,
): AdjacencyPage[] {
  const grouped = new Map<string, Array<{ score: number | null; neighbor: string; edgeType: string; edgeCid: string }>>();
  for (const edge of edges) {
    const node = direction === "outgoing" ? edge.source_cid : edge.target_cid;
    const neighbor = direction === "outgoing" ? edge.target_cid : edge.source_cid;
    const list = grouped.get(node) ?? [];
    list.push({ score: edge.score, neighbor, edgeType: edge.edge_type, edgeCid: edge.edge_cid });
    grouped.set(node, list);
  }
  const pages: AdjacencyPage[] = [];
  for (const [node, items] of grouped) {
    const ordered = [...items].sort((left, right) => {
      const delta = scoreKey(left.score) - scoreKey(right.score);
      if (delta !== 0) return delta;
      return compareText(left.neighbor, right.neighbor);
    });
    const pageCount = Math.max(1, Math.ceil(ordered.length / pageSize));
    for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
      const chunk = ordered.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize);
      pages.push({
        direction,
        node_cid: node,
        page_index: pageIndex,
        page_count: pageCount,
        neighbor_count: chunk.length,
        total_neighbor_count: ordered.length,
        neighbor_cids: chunk.map((item) => item.neighbor),
        neighbor_node_types: chunk.map((item) => nodeType.get(item.neighbor) ?? ""),
        edge_types: chunk.map((item) => item.edgeType),
        edge_cids: chunk.map((item) => item.edgeCid),
        retrieval_methods: chunk.map(() => "graph"),
        scores: chunk.map((item) => item.score),
        schema_version: GRAPH_NODE_SCHEMA,
      });
    }
  }
  return pages.sort((left, right) => compareText(left.node_cid, right.node_cid) || left.page_index - right.page_index);
}

function scoreKey(score: number | null): number {
  if (score == null || !Number.isFinite(score)) return Number.POSITIVE_INFINITY;
  return -score;
}

function dedupe<T>(rows: readonly T[], key: (row: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    const id = key(row);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(row);
  }
  return out;
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function pick(record: GraphRecord | null | undefined, name: string): string {
  if (!record) return "";
  const aliases = FIELD_ALIASES[name] ?? [name];
  for (const key of aliases) {
    if (Object.prototype.hasOwnProperty.call(record, key)) return cell(record[key]);
  }
  return "";
}

function hasField(record: GraphRecord, name: string): boolean {
  const aliases = FIELD_ALIASES[name] ?? [name];
  return aliases.some((key) => Object.prototype.hasOwnProperty.call(record, key));
}

function cell(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "True" : "False";
  return String(value);
}

function pyStrip(value: string): string {
  const chars = Array.from(value);
  let start = 0;
  let end = chars.length;
  while (start < end && isPySpace(chars[start])) start += 1;
  while (end > start && isPySpace(chars[end - 1])) end -= 1;
  return chars.slice(start, end).join("");
}

function isPySpace(ch: string): boolean {
  const codePoint = ch.codePointAt(0) ?? 0;
  return /\s/u.test(ch) || codePoint === 0x85 || (codePoint >= 0x1c && codePoint <= 0x1f);
}

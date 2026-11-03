import { canonicalJson, sha256HexUtf8, utf8Bytes } from '../../src/lib/worldwide/data/identity';
import {
  ADJACENCY_POINTERS_PER_ROW,
  ADJACENCY_POINTERS_PER_SHARD,
  GRAPH_APPLICABILITY,
  GRAPH_BUDGET,
  GRAPH_BUDGET_CEILING,
  GRAPH_LIMITATIONS,
  GRAPH_NODE_SCHEMA,
  GRAPH_SCHEMA,
  GraphBuildError,
  adjacencyPageBytes,
  buildPropertyGraph,
  expandSelectedCitation,
  facetCid,
  graphLabel,
  wordingPromotesApplicability,
  type AdjacencyPage,
  type CitationGraphExpansion,
  type GraphRecord,
  type NeighborTuple,
  type PropertyGraph,
} from '../../src/lib/worldwide/research/graph';

/**
 * Projection captured from country_laws_ir graph.build_graph at commit
 * 2ea4ca6804b3c4cc44e43d0539f4c3fcae011747. schema_version is checked on
 * its own and is not part of this digest. Integer-valued scores are
 * whole numbers, matching json.dumps after that coercion.
 */
const PROJECTION_SHA256 = '8ed6b2cceded5da9f7766b44989dc03de1c0744b2d05b08614c9fbb4ea80c68e';
const PROJECTION_BYTES = 17795;

const STATUTE = 'https://wetten.overheid.nl/BWBR0001854';

const ROWS: GraphRecord[] = [
  {
    entry_cid: 'law-entry',
    record_type: 'law',
    law_cid: 'law-id',
    instrument_id: 'INST-1',
    instrument_title: 'Wet voorbeeld',
    title: 'Wet voorbeeld',
    article_number: '',
    article_title: '',
    jurisdiction: 'nl',
    language: 'nl',
    source_url: STATUTE,
    snapshot_date: '2024-01-02',
    coverage: 'national',
    license: 'CC0-1.0',
    collector: 'official',
    source_id: 'bwbr',
    eli: 'http://eli.example/bwbr',
    law_status: 'in-force',
    source_type: 'statute',
    official_identifier: 'BWBR0001854',
    identifier: '',
  },
  {
    entry_cid: 'art-1',
    record_type: 'article',
    law_cid: 'law-id',
    instrument_id: 'INST-1',
    instrument_title: 'Wet voorbeeld',
    title: 'Artikel 1',
    article_number: '1',
    article_title: 'Eerste',
    jurisdiction: 'nl',
    language: 'nl',
    source_url: `${STATUTE}/artikel1`,
    snapshot_date: '2024-01-02',
    coverage: 'national',
    license: 'CC0-1.0',
    collector: 'official',
    source_id: 'bwbr-1',
    eli: '',
    law_status: 'in-force',
    source_type: 'statute',
    official_identifier: '',
    identifier: '',
  },
  {
    entry_cid: 'art-2',
    record_type: 'section',
    law_cid: 'law-id',
    instrument_id: 'INST-1',
    instrument_title: 'Wet voorbeeld',
    title: 'A\u0000rtikel 2',
    article_number: '',
    article_title: '',
    jurisdiction: 'nl',
    language: 'nl',
    source_url: `${STATUTE}/artikel2`,
    snapshot_date: '2024-01-02',
    coverage: '',
    license: '',
    collector: '',
    source_id: 'bwbr-2',
    eli: '',
    law_status: '',
    source_type: '',
    official_identifier: '',
    identifier: '§ 2',
  },
  {
    entry_cid: 'other',
    record_type: 'notice',
    law_cid: '',
    instrument_id: '',
    instrument_title: '',
    title: 'L'.repeat(5000),
    article_number: '',
    article_title: '',
    jurisdiction: 'us',
    language: 'en',
    source_url: 'https://example.test/other',
    snapshot_date: '2020-05-01',
    coverage: '',
    license: 'public-domain',
    collector: 'example',
    source_id: 'notice-1',
    eli: '',
    law_status: '',
    source_type: 'notice',
    official_identifier: '',
    identifier: '',
  },
];

const NEIGHBORS: NeighborTuple[][] = [
  [[1, 0.5, ['wet']], [3, Number.NaN]],
  [[3, 0.25, []]],
  [[1, 0.25]],
  [],
];

const ARTICLE_OF_ART_1 = 'bafkreiaaan5x3vuahnfwtuwyq66ks7pnfydl535qg3hzkknm3veb7firmy';
const ARTICLE_OF_ART_2 = 'bafkreiavhco6wawmegrceidg7pdc3he5vtw45d7xdpmwhmzcurtpfycpq4';
const BM25_LAW_OTHER = 'bafkreibnrybhaeqycordpmmcsr26aovgghwo6jqwdcsogv2vbv6faudlhu';
const BM25_ART1_OTHER = 'bafkreifxgbdmicnpjuoeoe5whpyq2h7pyhuajibkid5moxzbeugnrpsjkm';
const BM25_ART2_ART1 = 'bafkreieix2osvose2xzapyx7j2wh3iwikywxayspw66k3gv3rzs72y6bhe';
const BM25_LAW_ART1 = 'bafkreibvc5tpfmbt4s7y44qikgwyonhqxeuyyjl7mjkace5vppouptmhhq';

function projection(graph: PropertyGraph): string {
  const scoreOf = (score: number | null): number | null => {
    if (score == null || !Number.isFinite(score)) return null;
    return Number.isInteger(score) ? score : score;
  };
  return canonicalJson({
    edges: graph.edges.map((edge) => ({
      edge_cid: edge.edge_cid,
      edge_type: edge.edge_type,
      matched_terms: edge.matched_terms,
      properties_json: edge.properties_json,
      query_terms_json: edge.query_terms_json,
      retrieval_method: edge.retrieval_method,
      score: scoreOf(edge.score),
      source_cid: edge.source_cid,
      target_cid: edge.target_cid,
    })),
    nodes: graph.nodes.map((node) => ({
      entry_cid: node.entry_cid,
      label: node.label,
      node_cid: node.node_cid,
      node_type: node.node_type,
      properties_json: node.properties_json,
    })),
    stats: graph.stats,
  });
}

function assertClosed(result: CitationGraphExpansion): void {
  expect(result.schema).toBe(GRAPH_SCHEMA);
  expect(result.applicability).toBe(GRAPH_APPLICABILITY);
  expect(result.promotes_applicability).toBe(false);
  expect(result.reader.blocked).toBe(false);
  const prose = [
    result.problem_detail,
    result.graph.absence?.detail ?? '',
    ...result.edges.map((edge) => edge.reason),
    ...result.limitations,
    ...GRAPH_LIMITATIONS,
  ];
  for (const text of prose) expect(wordingPromotesApplicability(text)).toBe(false);
  for (const node of result.nodes) {
    expect(node.applicability).toBe(GRAPH_APPLICABILITY);
    expect(node.promotes_applicability).toBe(false);
  }
  for (const edge of result.edges) {
    expect(edge.applicability).toBe(GRAPH_APPLICABILITY);
    expect(edge.promotes_applicability).toBe(false);
    expect(edge.reason.length).toBeGreaterThan(0);
  }
}

function selectedArticle(extra: GraphRecord = {}): GraphRecord {
  return {
    ...ROWS[1],
    text: 'Lid (1) geldt. Lid (2) ook.',
    source_revision: 'rev-1',
    ...extra,
  };
}

function emptyGraph(): PropertyGraph {
  return {
    nodes: [],
    edges: [],
    incoming: [],
    outgoing: [],
    stats: { n_nodes: 0, n_edges: 0, n_doc_nodes: 0, n_facet_nodes: 0, edge_types: [] },
    warnings: [],
  };
}

describe('property graph parity', () => {
  const graph = buildPropertyGraph(ROWS, NEIGHBORS);

  test('pinned projection matches graph.py at the recorded commit', () => {
    const raw = projection(graph);
    expect(utf8Bytes(raw).length).toBe(PROJECTION_BYTES);
    expect(sha256HexUtf8(raw)).toBe(PROJECTION_SHA256);
    for (const node of graph.nodes) expect(node.schema_version).toBe(GRAPH_NODE_SCHEMA);
    for (const edge of graph.edges) expect(edge.schema_version).toBe(GRAPH_NODE_SCHEMA);
    for (const page of [...graph.incoming, ...graph.outgoing]) {
      expect(page.schema_version).toBe(GRAPH_NODE_SCHEMA);
      expect(page.retrieval_methods.every((method) => method === 'graph')).toBe(true);
    }
  });

  test('extra reader fields do not change the graph projection', () => {
    const annotated = ROWS.map((row, index) => index === 1
      ? { ...row, text: 'Lid (1) geldt. Lid (2) ook.', source_revision: 'rev-1' }
      : row);
    expect(sha256HexUtf8(projection(buildPropertyGraph(annotated, NEIGHBORS)))).toBe(PROJECTION_SHA256);
  });

  test('section rows, labels, identifiers, and neighbor scores follow graph.py', () => {
    expect(graph.stats).toEqual({
      n_nodes: 16,
      n_edges: 26,
      n_doc_nodes: 4,
      n_facet_nodes: 11,
      edge_types: [
        'ARTICLE_OF',
        'BM25_NEIGHBOR_OF',
        'HAS_INSTRUMENT',
        'HAS_JURISDICTION',
        'HAS_LANGUAGE',
        'HAS_SOURCE',
        'HAS_STATUS',
        'IDENTIFIED_BY',
        'IDENTIFIED_BY_ELI',
      ],
    });
    const art2 = graph.nodes.find((node) => node.node_cid === 'art-2');
    expect(art2).toMatchObject({ node_type: 'article', label: 'Artikel 2' });
    const notice = graph.nodes.find((node) => node.node_cid === 'other');
    expect(notice?.label).toHaveLength(4096);
    expect(notice?.label.endsWith('LL...')).toBe(true);
    expect(notice?.node_type).toBe('notice');
    expect(graph.nodes.map((node) => node.node_cid)).toEqual(
      expect.arrayContaining([
        facetCid('eli', 'http://eli.example/bwbr'),
        facetCid('identifier', 'BWBR0001854'),
        facetCid('identifier', '§ 2'),
        facetCid('instrument', 'INST-1'),
        facetCid('jurisdiction', 'nl'),
        facetCid('jurisdiction', 'us'),
        facetCid('language', 'nl'),
        facetCid('language', 'en'),
        facetCid('source', 'statute'),
        facetCid('source', 'notice'),
        facetCid('status', 'in-force'),
      ]),
    );
    expect(graph.nodes.some((node) => node.label === 'identifier:nan')).toBe(false);

    const edge = (cid: string) => graph.edges.find((item) => item.edge_cid === cid);
    expect(edge(ARTICLE_OF_ART_2)).toMatchObject({
      edge_type: 'ARTICLE_OF',
      source_cid: 'art-2',
      target_cid: 'law-entry',
      score: 1,
      properties_json: '{"article_number":"","instrument_id":"INST-1"}',
    });
    expect(edge(ARTICLE_OF_ART_1)?.target_cid).toBe('law-entry');
    expect(edge(BM25_LAW_OTHER)).toMatchObject({
      score: null,
      retrieval_method: 'bm25-okapi',
      query_terms_json: '[]',
      properties_json: '{"k":8,"neighbor_index":3}',
    });
    expect(edge(BM25_LAW_ART1)).toMatchObject({
      score: 0.5,
      query_terms_json: '["wet"]',
      matched_terms: ['wet'],
      properties_json: '{"k":8,"neighbor_index":1}',
    });
    expect(edge(BM25_ART1_OTHER)?.score).toBe(0.25);
    expect(edge(BM25_ART2_ART1)).toMatchObject({ source_cid: 'art-2', target_cid: 'art-1', score: 0.25 });
    expect(graph.edges.filter((item) => item.edge_type === 'HAS_INSTRUMENT').map((item) => item.target_cid)).toEqual(
      expect.arrayContaining(['law-id', facetCid('instrument', 'INST-1')]),
    );

    const outgoing = graph.outgoing.find((page) => page.node_cid === 'art-1');
    expect(outgoing?.neighbor_cids).toEqual([
      facetCid('language', 'nl'),
      facetCid('instrument', 'INST-1'),
      facetCid('status', 'in-force'),
      facetCid('jurisdiction', 'nl'),
      facetCid('source', 'statute'),
      'law-entry',
      'other',
    ]);
    expect(outgoing?.edge_types).toEqual([
      'HAS_LANGUAGE',
      'HAS_INSTRUMENT',
      'HAS_STATUS',
      'HAS_JURISDICTION',
      'HAS_SOURCE',
      'ARTICLE_OF',
      'BM25_NEIGHBOR_OF',
    ]);
    expect(outgoing?.scores).toEqual([1, 1, 1, 1, 1, 1, 0.25]);
    const incoming = graph.incoming.find((page) => page.node_cid === 'art-1');
    expect(incoming?.neighbor_cids).toEqual(['law-entry', 'art-2']);
    expect(incoming?.scores).toEqual([0.5, 0.25]);

    const lawOut = graph.outgoing.find((page) => page.node_cid === 'law-entry');
    expect(lawOut?.scores.slice(-2)).toEqual([0.5, null]);
    expect(lawOut?.neighbor_cids.slice(-2)).toEqual(['art-1', 'other']);
    expect(ADJACENCY_POINTERS_PER_ROW).toBe(4096);
    expect(ADJACENCY_POINTERS_PER_SHARD).toBe(8192);
    expect(graph.outgoing.filter((page) => page.node_cid === 'art-1')).toHaveLength(1);
  });

  test('a literal nan identifier is kept and a null cell is not turned into one', () => {
    const built = buildPropertyGraph([
      {
        entry_cid: 'row',
        record_type: 'notice',
        source_id: 'n',
        identifier: 'nan',
        official_identifier: null,
        jurisdiction: undefined,
      },
    ]);
    expect(built.nodes.some((node) => node.label === 'identifier:nan')).toBe(true);
    expect(built.warnings).toEqual([]);
  });

  test('neighbor rows and page size are refused before a graph is returned', () => {
    expect(() => buildPropertyGraph(ROWS, NEIGHBORS.slice(0, 1))).toThrow(GraphBuildError);
    expect(() => buildPropertyGraph(ROWS, [[[9, 0.1]]])).toThrow(GraphBuildError);
    expect(() => buildPropertyGraph(ROWS, [[[0, 'bad' as unknown as number]]])).toThrow(GraphBuildError);
    expect(() => buildPropertyGraph(ROWS, [[[0, 1, [1 as unknown as string]]]])).toThrow(GraphBuildError);
    expect(() => buildPropertyGraph(ROWS, [], { adjacencyPageSize: 0 })).toThrow(GraphBuildError);
    expect(() => buildPropertyGraph(ROWS, [], { adjacencyPageSize: 4097 })).toThrow(GraphBuildError);
    const skipped = buildPropertyGraph([{ record_type: 'law', law_cid: 'only-law', instrument_id: 'I', instrument_title: 'T' }]);
    expect(skipped.warnings).toEqual(['skipped record 0: missing entry_cid']);
    expect(skipped.nodes.map((node) => node.node_cid)).toEqual(['only-law']);
  });

  test('page size 1 keeps score order and does not use the shard constant', () => {
    const paged = buildPropertyGraph(ROWS, NEIGHBORS, { adjacencyPageSize: 1 });
    const pages = paged.outgoing.filter((page) => page.node_cid === 'art-1');
    expect(pages).toHaveLength(7);
    expect(pages.map((page) => page.page_index)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(pages[0]?.neighbor_cids).toEqual([facetCid('language', 'nl')]);
    expect(pages[6]?.neighbor_cids).toEqual(['other']);
    expect(pages.every((page) => page.page_count === 7 && page.neighbor_count === 1)).toBe(true);
  });
});

describe('bounded citation and structure expansion', () => {
  const graph = buildPropertyGraph(ROWS, NEIGHBORS);
  const catalog = ROWS.map((row, index) => index === 1 ? selectedArticle() : row);

  test('a missing graph still returns the selected source and its parent chain', () => {
    const result = expandSelectedCitation({
      selected: selectedArticle(),
      catalog,
      budgets: { maxDepth: 2, maxNodes: 32, maxNetworkBytes: 0 },
    });
    assertClosed(result);
    expect(result.graph).toMatchObject({ supplied: false, present: false, covers_selection: false, absence: { reason: 'absent' } });
    expect(result.reader).toMatchObject({
      blocked: false,
      text: 'Lid (1) geldt. Lid (2) ook.',
      source_url: `${STATUTE}/artikel1`,
      source_revision: 'rev-1',
      entry_cid: 'art-1',
    });
    expect(result.complete).toBe(false);
    expect(result.stop_reason).toBe('depth');
    expect(result.budgets.network_bytes).toBe(0);
    expect(result.nodes.map((node) => [node.node_cid, node.depth, node.role])).toEqual([
      ['art-1', 0, 'selected'],
      ['law-entry', 1, 'structure'],
      ['art-2', 2, 'structure'],
    ]);
    expect(result.edges.map((edge) => [edge.source_cid, edge.edge_type, edge.target_cid, edge.origin])).toEqual([
      ['art-1', 'ARTICLE_OF', 'law-entry', 'catalog-structure'],
      ['art-2', 'ARTICLE_OF', 'law-entry', 'catalog-structure'],
    ]);
    expect(result.nodes.some((node) => node.node_cid.includes('(1)') || node.label === '(1)' || node.label === '(2)')).toBe(false);
    const selected = result.nodes[0];
    expect(selected?.evidence).toMatchObject({
      origin: 'source-record',
      source_url: `${STATUTE}/artikel1`,
      source_revision: 'rev-1',
      identifier: '',
    });
    expect(selected?.citation?.origin).toBe('assigned-citation');
    expect(selected?.evidence && 'source_url' in selected.evidence && selected.citation?.native_identifier).not.toBe(selected?.evidence && 'source_url' in selected.evidence ? selected.evidence.source_url : '');
  });

  test('depth 3 can finish and depth 1 stops before the sibling', () => {
    const finished = expandSelectedCitation({
      selected: selectedArticle(),
      catalog,
      budgets: { maxDepth: 3, maxNodes: 8, maxNetworkBytes: 0 },
    });
    expect(finished.complete).toBe(true);
    expect(finished.stop_reason).toBeNull();
    expect(finished.nodes.map((node) => node.node_cid).sort()).toEqual(['art-1', 'art-2', 'law-entry']);
    expect(finished.budgets.network_bytes).toBe(0);

    const shallow = expandSelectedCitation({
      selected: selectedArticle(),
      catalog,
      budgets: { maxDepth: 1, maxNodes: 8, maxNetworkBytes: 0 },
    });
    expect(shallow.stop_reason).toBe('depth');
    expect(shallow.complete).toBe(false);
    expect(shallow.nodes.map((node) => node.node_cid)).toEqual(['art-1', 'law-entry']);
    expect(shallow.edges).toHaveLength(1);

    const one = expandSelectedCitation({
      selected: selectedArticle(),
      catalog,
      budgets: { maxDepth: 2, maxNodes: 1, maxNetworkBytes: 0 },
    });
    expect(one.stop_reason).toBe('nodes');
    expect(one.nodes.map((node) => node.node_cid)).toEqual(['art-1']);
    expect(one.edges).toEqual([]);
    expect(one.reader.blocked).toBe(false);
  });

  test('depth 0 is admitted and reads no page', () => {
    const result = expandSelectedCitation({
      selected: selectedArticle(),
      catalog,
      graph,
      budgets: { maxDepth: 0, maxNodes: 4, maxNetworkBytes: GRAPH_BUDGET.maxNetworkBytes },
    });
    assertClosed(result);
    expect(result.stop_reason).toBe('depth');
    expect(result.complete).toBe(false);
    expect(result.nodes).toHaveLength(1);
    expect(result.edges).toEqual([]);
    expect(result.budgets.network_bytes).toBe(0);
    expect(result.graph.absence).toBeNull();
    expect(result.graph.covers_selection).toBe(true);
  });

  test('an empty graph uses catalog structure and spends no network', () => {
    const result = expandSelectedCitation({
      selected: selectedArticle(),
      catalog,
      graph: emptyGraph(),
      budgets: { maxDepth: 2, maxNodes: 8, maxNetworkBytes: 10 },
    });
    assertClosed(result);
    expect(result.graph.supplied).toBe(true);
    expect(result.graph.present).toBe(false);
    expect(result.graph.absence?.reason).toBe('empty');
    expect(result.budgets.network_bytes).toBe(0);
    expect(result.edges.every((edge) => edge.origin === 'catalog-structure')).toBe(true);
    expect(result.nodes.map((node) => node.node_cid)).toEqual(['art-1', 'law-entry', 'art-2']);
    expect(result.reader.text).toBe('Lid (1) geldt. Lid (2) ook.');
  });

  test('a present graph is walked as recorded and does not invent catalog links', () => {
    const result = expandSelectedCitation({
      selected: selectedArticle(),
      catalog,
      graph,
      budgets: { maxDepth: 2, maxNodes: 32, maxNetworkBytes: GRAPH_BUDGET_CEILING.maxNetworkBytes },
    });
    assertClosed(result);
    expect(result.graph).toMatchObject({ supplied: true, present: true, covers_selection: true, absence: null });
    expect(result.stop_reason).toBe('depth');
    expect(result.complete).toBe(false);
    expect(result.budgets.nodes_used).toBe(16);
    expect(result.edges.length).toBeGreaterThan(0);
    expect(result.edges.every((edge) => edge.origin === 'graph')).toBe(true);
    expect(result.nodes.find((node) => node.node_cid === 'art-2')?.depth).toBe(1);
    expect(result.nodes.find((node) => node.node_cid === 'law-id')?.depth).toBe(2);
    const facet = result.nodes.find((node) => node.node_cid === facetCid('language', 'nl'));
    expect(facet?.evidence_status).toBe('graph-node');
    expect(facet?.evidence).toMatchObject({ origin: 'graph-node' });
    expect(JSON.stringify(facet?.evidence)).not.toContain(STATUTE);
    expect(facet?.reader_text).toBe('');
    const notice = result.nodes.find((node) => node.node_cid === 'other');
    expect(notice?.evidence).toMatchObject({ origin: 'source-record', source_url: 'https://example.test/other' });
    const bm25 = result.edges.find((edge) => edge.edge_cid === BM25_ART1_OTHER);
    expect(bm25).toMatchObject({ score: 0.25, retrieval_score: 0.25 });
    expect(bm25?.reason.toLowerCase()).toContain('retrieval score');
    const structural = result.edges.find((edge) => edge.edge_cid === ARTICLE_OF_ART_1);
    expect(structural?.retrieval_score).toBeNull();
    expect(structural?.reason.toLowerCase()).not.toContain('retrieval score');

    const deeper = expandSelectedCitation({
      selected: selectedArticle(),
      catalog,
      graph,
      budgets: { maxDepth: 3, maxNodes: 32, maxNetworkBytes: GRAPH_BUDGET_CEILING.maxNetworkBytes },
    });
    expect(deeper.complete).toBe(true);
    expect(deeper.stop_reason).toBeNull();
    expect(deeper.budgets.nodes_used).toBe(16);
  });

  test('network budget stops before the next unread page and keeps pages already read', () => {
    const blocked = expandSelectedCitation({
      selected: selectedArticle(),
      catalog,
      graph,
      budgets: { maxDepth: 2, maxNodes: 32, maxNetworkBytes: 0 },
    });
    expect(blocked.stop_reason).toBe('network');
    expect(blocked.edges).toEqual([]);
    expect(blocked.nodes.map((node) => node.node_cid)).toEqual(['art-1']);
    expect(blocked.budgets.network_bytes).toBe(0);
    expect(blocked.reader.blocked).toBe(false);
    expect(blocked.reader.text).toContain('Lid (1)');

    const paged = buildPropertyGraph(ROWS, NEIGHBORS, { adjacencyPageSize: 1 });
    const first = paged.outgoing.find((page) => page.node_cid === 'art-1' && page.page_index === 0);
    expect(first).toBeDefined();
    const size = adjacencyPageBytes(first as AdjacencyPage);
    const exact = expandSelectedCitation({
      selected: selectedArticle(),
      catalog,
      graph: paged,
      direction: 'both',
      budgets: { maxDepth: 1, maxNodes: 32, maxNetworkBytes: size },
    });
    assertClosed(exact);
    expect(exact.stop_reason).toBe('network');
    expect(exact.budgets.network_bytes).toBe(size);
    expect(exact.edges.map((edge) => edge.edge_type)).toEqual(['HAS_LANGUAGE']);
    expect(exact.nodes.map((node) => node.node_cid)).toEqual(['art-1', facetCid('language', 'nl')]);
    expect(exact.nodes.some((node) => node.node_cid === 'law-entry')).toBe(false);
  });

  test('an empty edge filter reads no relationship', () => {
    const result = expandSelectedCitation({
      selected: selectedArticle(),
      catalog,
      graph,
      edgeTypes: [],
      budgets: { maxDepth: 2, maxNodes: 32, maxNetworkBytes: GRAPH_BUDGET.maxNetworkBytes },
    });
    expect(result.edges).toEqual([]);
    expect(result.nodes.map((node) => node.node_cid)).toEqual(['art-1']);
    expect(result.complete).toBe(true);
    expect(result.stop_reason).toBeNull();
    expect(result.budgets.network_bytes).toBeGreaterThan(0);
    expect(result.reader.blocked).toBe(false);
  });

  test('direction aliases keep one side of the adjacency', () => {
    const incoming = expandSelectedCitation({
      selected: selectedArticle(),
      catalog,
      graph,
      direction: 'in',
      budgets: { maxDepth: 1, maxNodes: 8, maxNetworkBytes: GRAPH_BUDGET.maxNetworkBytes },
    });
    expect(incoming.nodes.map((node) => node.node_cid)).toEqual(['art-1', 'law-entry', 'art-2']);
    expect(incoming.edges.every((edge) => edge.target_cid === 'art-1' && edge.edge_type === 'BM25_NEIGHBOR_OF')).toBe(true);

    const outgoing = expandSelectedCitation({
      selected: selectedArticle(),
      catalog,
      graph,
      direction: 'out',
      edgeTypes: ['BM25_NEIGHBOR_OF'],
      budgets: { maxDepth: 1, maxNodes: 8, maxNetworkBytes: GRAPH_BUDGET.maxNetworkBytes },
    });
    expect(outgoing.edges.map((edge) => [edge.source_cid, edge.target_cid])).toEqual([['art-1', 'other']]);
  });

  test('a graph that does not mention the selection stays off the reader', () => {
    const solo: GraphRecord = {
      entry_cid: 'solo',
      record_type: 'article',
      instrument_id: 'INST-1',
      law_cid: 'law-id',
      title: 'Solo',
      text: 'Solo text stays.',
      source_url: 'https://example.test/solo',
      source_revision: 'rev-solo',
    };
    const result = expandSelectedCitation({
      selected: solo,
      catalog: [...catalog, solo],
      graph,
      budgets: { maxDepth: 2, maxNodes: 8, maxNetworkBytes: GRAPH_BUDGET.maxNetworkBytes },
    });
    assertClosed(result);
    expect(result.graph).toMatchObject({ present: true, covers_selection: false, absence: null });
    expect(result.reader).toMatchObject({ blocked: false, text: 'Solo text stays.', source_url: 'https://example.test/solo' });
    expect(result.edges).toEqual([]);
    expect(result.nodes.map((node) => node.node_cid)).toEqual(['solo']);
    expect(result.complete).toBe(true);
  });

  test('an unreadable page keeps earlier neighbors and never blocks the reader', () => {
    let reads = 0;
    const result = expandSelectedCitation({
      selected: selectedArticle(),
      catalog,
      network: {
        byteLength(query) {
          if (query.page_index > 0) return null;
          if (query.direction === 'incoming') throw new Error('incoming store failed');
          return 20;
        },
        read() {
          reads += 1;
          return {
            direction: 'outgoing',
            node_cid: 'art-1',
            page_index: 0,
            page_count: 1,
            neighbor_count: 1,
            total_neighbor_count: 1,
            neighbor_cids: ['ghost'],
            neighbor_node_types: ['article'],
            edge_types: ['RELATED_TO'],
            edge_cids: ['edge-ghost'],
            retrieval_methods: ['graph'],
            scores: [1],
            schema_version: GRAPH_NODE_SCHEMA,
          };
        },
      },
      budgets: { maxDepth: 1, maxNodes: 4, maxNetworkBytes: 100 },
    });
    assertClosed(result);
    expect(reads).toBe(1);
    expect(result.stop_reason).toBe('unreadable');
    expect(result.graph.absence?.reason).toBe('unreadable');
    expect(result.budgets.network_bytes).toBe(20);
    expect(result.reader.blocked).toBe(false);
    expect(result.reader.text).toContain('Lid (1)');
    const ghost = result.nodes.find((node) => node.node_cid === 'ghost');
    expect(ghost).toMatchObject({ evidence: null, evidence_status: 'not-in-catalog', reader_text: '' });
    expect(result.edges).toEqual([
      expect.objectContaining({ edge_type: 'RELATED_TO', target_cid: 'ghost', origin: 'graph', retrieval_score: null }),
    ]);
  });

  test('a non-integer page size and a mismatched page are unreadable', () => {
    const fractional = expandSelectedCitation({
      selected: selectedArticle(),
      network: {
        byteLength: () => 1.5,
        read: () => { throw new Error('should not be read'); },
      },
      budgets: { maxDepth: 1, maxNodes: 2, maxNetworkBytes: 100 },
    });
    expect(fractional.stop_reason).toBe('unreadable');
    expect(fractional.reader.blocked).toBe(false);
    expect(fractional.edges).toEqual([]);
    expect(fractional.budgets.network_bytes).toBe(0);

    const mismatched = expandSelectedCitation({
      selected: selectedArticle(),
      network: {
        byteLength: () => 8,
        read: () => ({
          direction: 'incoming',
          node_cid: 'other',
          page_index: 0,
          page_count: 1,
          neighbor_count: 1,
          total_neighbor_count: 1,
          neighbor_cids: ['art-2'],
          neighbor_node_types: ['article'],
          edge_types: ['ARTICLE_OF'],
          edge_cids: ['nope'],
          retrieval_methods: ['graph'],
          scores: [1],
          schema_version: GRAPH_NODE_SCHEMA,
        }),
      },
    });
    expect(mismatched.stop_reason).toBe('unreadable');
    expect(mismatched.nodes.map((node) => node.node_cid)).toEqual(['art-1']);
    expect(mismatched.reader.source_revision).toBe('rev-1');
  });

  test('a provider that throws still returns the selected source', () => {
    const result = expandSelectedCitation({
      selected: selectedArticle(),
      graph: { nodes: null } as unknown as PropertyGraph,
    });
    expect(result.reader.blocked).toBe(false);
    expect(result.reader.text).toContain('Lid (1)');
    expect(result.stop_reason).toBe('unreadable');
    expect(result.graph.absence?.reason).toBe('unreadable');
    expect(() => expandSelectedCitation()).not.toThrow();
    const none = expandSelectedCitation();
    expect(none.problem).toBe('no-selection');
    expect(none.complete).toBe(true);
    expect(none.stop_reason).toBeNull();
    expect(none.reader.blocked).toBe(false);
  });

  test('the selected record wins over a citation and over the catalog copy', () => {
    const result = expandSelectedCitation({
      selected: {
        entryCid: 'art-1',
        text: 'Selected body',
        sourceUrl: 'https://example.test/selected',
        sourceRevision: 'rev-selected',
        recordType: 'article',
        instrumentId: 'INST-1',
        title: 'Artikel 1',
      },
      citation: 'http://eli.example/bwbr',
      catalog,
      budgets: { maxDepth: 0, maxNodes: 4, maxNetworkBytes: 0 },
    });
    expect(result.reader).toMatchObject({
      blocked: false,
      text: 'Selected body',
      source_url: 'https://example.test/selected',
      source_revision: 'rev-selected',
      entry_cid: 'art-1',
    });
    expect(result.nodes.map((node) => node.node_cid)).toEqual(['art-1']);
    expect(result.nodes[0]?.evidence).toMatchObject({
      origin: 'source-record',
      source_url: 'https://example.test/selected',
      identifier: '',
    });
    expect(result.nodes[0]?.citation?.origin).toBe('assigned-citation');
  });

  test('citation lookup keeps law id order and does not invent a source URL', () => {
    const shared = {
      record_type: 'law',
      instrument_title: 'Shared Act',
      title: 'Shared Act',
      jurisdiction: 'nl',
      language: 'nl',
      source_type: 'statute',
    };
    const later = { ...shared, entry_cid: 'later', instrument_id: 'm-b', source_url: 'https://example.test/later', source_revision: 'rev-2' };
    const earlier = { ...shared, entry_cid: 'earlier', instrument_id: 'm-a', source_url: 'https://example.test/earlier', source_revision: 'rev-1' };
    const result = expandSelectedCitation({
      citation: 'Shared Act',
      catalog: [later, earlier],
      budgets: { maxDepth: 0, maxNodes: 4, maxNetworkBytes: 0 },
    });
    expect(result.problem).toBeNull();
    expect(result.nodes.map((node) => node.node_cid)).toEqual(['earlier', 'later']);
    expect(result.nodes.every((node) => node.role === 'selected' && node.citation?.origin === 'assigned-citation')).toBe(true);
    expect(result.nodes[0]?.evidence).toMatchObject({ source_url: 'https://example.test/earlier' });
    expect(JSON.stringify(result.nodes[1]?.evidence)).not.toContain('https://example.test/earlier');

    const filtered = expandSelectedCitation({
      citation: 'Shared Act',
      sourceRevision: 'rev-2',
      catalog: [later, earlier],
      budgets: { maxDepth: 0, maxNodes: 4, maxNetworkBytes: 0 },
    });
    expect(filtered.nodes.map((node) => node.node_cid)).toEqual(['later']);

    const missing = expandSelectedCitation({
      citation: 'not a real citation',
      catalog,
    });
    expect(missing.problem).toBe('no-selection');
    expect(missing.reader.blocked).toBe(false);
    expect(missing.nodes).toEqual([]);
  });

  test('a selected row without an entry id keeps its text', () => {
    const result = expandSelectedCitation({
      selected: { text: 'Orphan paragraph', source_url: 'https://example.test/orphan' },
      catalog,
      graph,
    });
    expect(result.problem).toBe('missing-entry-cid');
    expect(result.reader).toMatchObject({ blocked: false, text: 'Orphan paragraph', source_url: 'https://example.test/orphan' });
    expect(result.nodes).toEqual([]);
    expect(result.stop_reason).toBe('rejected-budget');
  });

  test('budgets above the ceiling are refused and the selected source remains', () => {
    const cases: Array<Partial<{ maxNodes: number; maxDepth: number; maxNetworkBytes: number }>> = [
      { maxNodes: GRAPH_BUDGET_CEILING.maxNodes + 1 },
      { maxNodes: 0 },
      { maxDepth: GRAPH_BUDGET_CEILING.maxDepth + 1 },
      { maxDepth: -1 },
      { maxNetworkBytes: GRAPH_BUDGET_CEILING.maxNetworkBytes + 1 },
      { maxNetworkBytes: -1 },
    ];
    for (const budgets of cases) {
      const result = expandSelectedCitation({ selected: selectedArticle(), catalog, graph, budgets });
      assertClosed(result);
      expect(result.problem).toBe('rejected-budget');
      expect(result.stop_reason).toBe('rejected-budget');
      expect(result.reader.text).toContain('Lid (1)');
      expect(result.nodes.map((node) => node.node_cid)).toEqual(['art-1']);
      expect(result.edges).toEqual([]);
    }
    const fractional = expandSelectedCitation({
      selected: selectedArticle(),
      budgets: { maxNodes: 1.5 as unknown as number },
    });
    expect(fractional.problem).toBe('rejected-budget');
    expect(fractional.reader.blocked).toBe(false);
    const flag = expandSelectedCitation({
      selected: selectedArticle(),
      budgets: { maxDepth: true as unknown as number },
    });
    expect(flag.reader.blocked).toBe(false);
    expect(flag.problem).toBe('rejected-budget');
    const direction = expandSelectedCitation({
      selected: selectedArticle(),
      direction: 'sideways',
    });
    expect(direction.problem).toBe('rejected-budget');
    expect(direction.reader.text).toContain('Lid (1)');
    const format = expandSelectedCitation({
      citation: 'Shared Act',
      format: 'sideways',
      catalog,
    });
    expect(format.problem).toBe('rejected-budget');
    expect(format.reader.blocked).toBe(false);
  });

  test('an orphan marker in the text does not become a node', () => {
    const orphan: GraphRecord = {
      entry_cid: 'loose',
      record_type: 'article',
      title: 'Loose (1)',
      text: 'Lid (1) geldt. Lid (a) ook.',
      source_url: 'https://example.test/loose',
      instrument_id: 'MISSING',
      law_cid: 'missing-law',
    };
    const result = expandSelectedCitation({
      selected: orphan,
      catalog: [orphan],
      budgets: { maxDepth: 4, maxNodes: 16, maxNetworkBytes: 0 },
    });
    expect(result.complete).toBe(true);
    expect(result.stop_reason).toBeNull();
    expect(result.nodes.map((node) => node.node_cid)).toEqual(['loose']);
    expect(result.edges).toEqual([]);
    expect(result.reader.text).toBe('Lid (1) geldt. Lid (a) ook.');
    expect(result.reader.blocked).toBe(false);
  });

  test('relationship wording stays a recorded link', () => {
    expect(wordingPromotesApplicability('This statute applies to housing')).toBe(true);
    expect(wordingPromotesApplicability('The rule governs contracts')).toBe(true);
    expect(wordingPromotesApplicability('Recorded structural link from the source catalog.')).toBe(false);
    expect(graphLabel(`A${'\u0000'.repeat(3)}rtikel`, 'fallback')).toBe('Artikel');
    expect(graphLabel('   ', 'fallback')).toBe('fallback');
    expect(GRAPH_BUDGET).toEqual({ maxNodes: 32, maxDepth: 2, maxNetworkBytes: 256 * 1024 });
    expect(GRAPH_BUDGET_CEILING).toEqual({ maxNodes: 1024, maxDepth: 8, maxNetworkBytes: 8 * 1024 * 1024 });
    expect(GRAPH_LIMITATIONS.length).toBeGreaterThan(0);
    const statute = expandSelectedCitation({
      selected: { ...selectedArticle(), text: 'This article applies to ships.' },
      budgets: { maxDepth: 0 },
    });
    expect(statute.reader.text).toBe('This article applies to ships.');
    expect(statute.reader.blocked).toBe(false);
    expect(statute.applicability).toBe('not-asserted');
    expect(statute.promotes_applicability).toBe(false);
  });
});

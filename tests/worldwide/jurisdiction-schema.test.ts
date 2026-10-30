import {
  APPLICABILITY,
  CITY_REQUIRED,
  DISPUTED_VIEW_SCHEMA,
  JURISDICTION_EDGE_SCHEMA,
  JURISDICTION_GRAPH_SCHEMA,
  JURISDICTION_NODE_SCHEMA,
  QUARANTINE_SCHEMA,
  RECOGNIZED_LEVEL_KINDS,
  RELATION_DIRECTION,
  RELATION_KINDS,
  SCHEMA_VERSION,
  UNKNOWN_ABOUTS,
  UNKNOWN_RELATIONSHIP_SCHEMA,
  admitJurisdictionGraph,
  candidateEdges,
  intervalStatus,
  type AdmissionResult,
  JurisdictionSchemaError,
} from '../../src/lib/worldwide/jurisdiction/schema';

const REVISION = 'a'.repeat(40);
const OTHER_REVISION = 'b'.repeat(64);

function known(value: string, precision: 'day' | 'month' | 'year' = 'year') {
  return { knowledge: 'known' as const, value, precision, source: 'fixture' };
}

function openEnd() {
  return { knowledge: 'open' as const, value: null, precision: null, source: 'fixture' };
}

function unknownBound() {
  return { knowledge: 'unknown' as const, value: null, precision: null, source: null };
}

function openValid(start = '2000') {
  return { start: known(start), end: openEnd() };
}

function envelope(extra: Record<string, unknown> = {}) {
  return {
    graphId: 'graph:fixture',
    sourceId: 'registry:fixture',
    sourceRevision: REVISION,
    publisherId: 'publisher:fixture',
    observedAt: '2024-06',
    ...extra,
  };
}

function boundary(boundaryId: string, extra: Record<string, unknown> = {}) {
  return {
    boundaryId,
    role: 'primary',
    geometryKnowledge: 'known',
    geometryRef: `artifact:${boundaryId}`,
    provenance: {
      sourceId: 'registry:fixture',
      sourceRevision: REVISION,
      attribution: 'Fixture geometry',
      license: null,
    },
    valid: openValid(),
    flags: [],
    ...extra,
  };
}

function place(
  id: string,
  level: string,
  opts: {
    name?: string;
    names?: unknown[];
    nameKnowledge?: string;
    roles?: Array<'place' | 'issuer'>;
    aliases?: unknown[];
    externalIds?: unknown[];
    level?: unknown;
    parentKnowledge?: string;
    issuerKnowledge?: string;
    issuerIds?: string[];
    boundaries?: unknown[];
    valid?: unknown;
  } = {},
) {
  const roles = opts.roles ?? ['place'];
  const issuerIds = opts.issuerIds ?? (roles.includes('issuer') ? [id] : []);
  return {
    id,
    roles,
    names: opts.names ?? [{ text: opts.name ?? id, language: 'en', script: 'Latn' }],
    ...(opts.nameKnowledge ? { nameKnowledge: opts.nameKnowledge } : {}),
    aliases: opts.aliases ?? [],
    level: opts.level ?? { kind: level },
    externalIds: opts.externalIds ?? [],
    parentKnowledge: opts.parentKnowledge ?? 'none',
    issuerKnowledge: opts.issuerKnowledge ?? (issuerIds.length > 0 ? 'known' : 'none'),
    issuerIds,
    boundaries: opts.boundaries ?? (roles.includes('place') ? [boundary(`boundary:${id.slice(id.indexOf(':') + 1)}`)] : []),
    valid: opts.valid ?? openValid(),
  };
}

function edge(
  id: string,
  kind: string,
  fromId: string,
  toId: string,
  extra: Record<string, unknown> = {},
) {
  return {
    id,
    kind,
    fromId,
    toId,
    knowledge: 'known',
    evidence: [],
    valid: openValid(),
    ...extra,
  };
}

function reasons(result: AdmissionResult): string[] {
  return result.quarantined.map((item) => item.reason);
}

function nodeIds(result: AdmissionResult): string[] {
  return result.graph?.nodes.map((node) => node.id) ?? [];
}

describe('dated jurisdiction and issuer graph', () => {
  test('pins the graph contract and does not require a city', () => {
    expect(SCHEMA_VERSION).toBe(1);
    expect(CITY_REQUIRED).toBe(false);
    expect(APPLICABILITY).toBe('not-asserted');
    expect(JURISDICTION_GRAPH_SCHEMA).toBe('worldwide-legal-search.jurisdiction-graph@1');
    expect(JURISDICTION_NODE_SCHEMA).toBe('worldwide-legal-search.jurisdiction-node@1');
    expect(JURISDICTION_EDGE_SCHEMA).toBe('worldwide-legal-search.jurisdiction-edge@1');
    expect(DISPUTED_VIEW_SCHEMA).toBe('worldwide-legal-search.disputed-view@1');
    expect(UNKNOWN_RELATIONSHIP_SCHEMA).toBe('worldwide-legal-search.unknown-relationship@1');
    expect(QUARANTINE_SCHEMA).toBe('worldwide-legal-search.jurisdiction-quarantine@1');
    expect([...RELATION_KINDS]).toEqual([
      'administrative-containment',
      'territorial-coverage',
      'delegated-authority',
      'legal-relationship',
    ]);
    expect(RELATION_DIRECTION['administrative-containment']).toEqual({ from: 'child', to: 'parent' });
    expect(RELATION_DIRECTION['territorial-coverage'].to).toBe('covering-authority-or-territory');
    expect([...UNKNOWN_ABOUTS]).toEqual(expect.arrayContaining([
      'administrative-parent',
      'territorial-coverage',
      'issuer',
      'boundary',
      'level',
    ]));
    expect([...RECOGNIZED_LEVEL_KINDS]).toEqual(expect.arrayContaining(['country', 'city', 'municipality', 'unincorporated']));
    expect([...RECOGNIZED_LEVEL_KINDS]).not.toContain('water-board');
  });

  test('admits arbitrary levels, issuers, aliases, and boundaries without a city', () => {
    const result = admitJurisdictionGraph(envelope({
      observedAt: { knowledge: 'known', value: '2024-06', precision: 'month', source: 'registry pin' },
      nodes: [
        place('place:example-union', 'supranational', {
          name: 'Example Union',
          roles: ['place', 'issuer'],
          aliases: [{ text: 'XU', kind: 'code' }],
          externalIds: [{ scheme: 'custom', customScheme: 'fixture-gazetteer', value: 'example-union' }],
        }),
        place('place:north-country', 'country', {
          names: [
            { text: 'North Country', language: 'en', script: 'Latn' },
            { text: 'Noordland', language: 'nl', script: 'Latn' },
          ],
          roles: ['place', 'issuer'],
          issuerIds: ['place:north-country', 'issuer:north-ministry'],
          aliases: [
            { text: 'الشمال', language: 'ar', script: 'Arab', kind: 'exonym' },
            { text: 'NRC', kind: 'code' },
            {
              text: 'Northern Realm',
              language: 'en',
              script: 'Latn',
              kind: 'historical',
              valid: { start: known('1800'), end: known('1899') },
            },
          ],
          boundaries: [
            boundary('boundary:north-country', { flags: ['island'] }),
            boundary('boundary:north-country-hole', { role: 'hole', flags: ['hole', 'antimeridian'] }),
          ],
        }),
        place('place:north-province', 'province', {
          name: 'North Province',
          roles: ['place', 'issuer'],
          parentKnowledge: 'known',
        }),
        place('place:north-county', 'county', { name: 'North County', parentKnowledge: 'known' }),
        place('place:market-borough', 'borough', { name: 'Market Borough', parentKnowledge: 'known' }),
        place('place:old-quarter', 'neighborhood', { name: 'Old Quarter', parentKnowledge: 'known' }),
        place('place:canal-board', 'territory', {
          name: 'Canal Board',
          parentKnowledge: 'known',
          level: {
            kind: 'water-board',
            label: { text: 'Waterschap', language: 'nl', script: 'Latn' },
            rank: 40,
            knowledge: 'known',
            source: 'fixture',
          },
        }),
        place('place:unincorporated-tract', 'unincorporated', {
          name: 'Unincorporated Tract',
          parentKnowledge: 'known',
          issuerKnowledge: 'unknown',
          issuerIds: [],
          boundaries: [],
        }),
        place('issuer:north-ministry', 'national-authority', {
          name: 'North Ministry',
          roles: ['issuer'],
          issuerIds: [],
          issuerKnowledge: 'none',
          boundaries: [],
        }),
      ],
      edges: [
        edge('edge:country-coverage', 'territorial-coverage', 'place:north-country', 'place:example-union'),
        edge('edge:province-parent', 'administrative-containment', 'place:north-province', 'place:north-country'),
        edge('edge:county-parent', 'administrative-containment', 'place:north-county', 'place:north-province'),
        edge('edge:borough-parent', 'administrative-containment', 'place:market-borough', 'place:north-county'),
        edge('edge:quarter-parent', 'administrative-containment', 'place:old-quarter', 'place:market-borough'),
        edge('edge:board-parent', 'administrative-containment', 'place:canal-board', 'place:north-province'),
        edge('edge:tract-parent', 'administrative-containment', 'place:unincorporated-tract', 'place:north-province'),
      ],
      unknownRelationships: [
        {
          subjectId: 'place:unincorporated-tract',
          about: 'boundary',
          reason: 'No licensed polygon is in the fixture pin.',
        },
        {
          subjectId: 'place:unincorporated-tract',
          about: 'issuer',
          reason: 'No issuer is identified for this tract.',
        },
      ],
    }));

    expect(reasons(result)).toEqual([]);
    expect(result.graph).toMatchObject({
      schema: JURISDICTION_GRAPH_SCHEMA,
      schemaVersion: 1,
      cityRequired: false,
      graphId: 'graph:fixture',
      sourceId: 'registry:fixture',
      sourceRevision: REVISION,
      publisherId: 'publisher:fixture',
      observedAt: { knowledge: 'known', value: '2024-06', precision: 'month', source: 'registry pin' },
    });
    expect(nodeIds(result)).toEqual([
      'issuer:north-ministry',
      'place:canal-board',
      'place:example-union',
      'place:market-borough',
      'place:north-country',
      'place:north-county',
      'place:north-province',
      'place:old-quarter',
      'place:unincorporated-tract',
    ]);
    const graph = result.graph;
    if (!graph) throw new Error('graph missing');
    expect(graph.nodes.every((node) => !Object.prototype.hasOwnProperty.call(node, 'city'))).toBe(true);
    expect(graph.nodes.some((node) => node.level.kind === 'city' || node.level.kind === 'municipality')).toBe(false);
    expect(graph.nodes.map((node) => node.level.kind).sort()).toEqual([
      'borough',
      'country',
      'county',
      'national-authority',
      'neighborhood',
      'province',
      'supranational',
      'unincorporated',
      'water-board',
    ]);
    const board = graph.nodes.find((node) => node.id === 'place:canal-board');
    expect(board?.level).toMatchObject({
      kind: 'water-board',
      recognized: false,
      rank: 40,
      label: { text: 'Waterschap', language: 'nl', script: 'Latn' },
    });
    const country = graph.nodes.find((node) => node.id === 'place:north-country');
    expect(country?.issuerIds).toEqual(['place:north-country', 'issuer:north-ministry']);
    expect(country?.aliases).toEqual(expect.arrayContaining([
      expect.objectContaining({ text: 'الشمال', language: 'ar', script: 'Arab', kind: 'exonym' }),
      expect.objectContaining({ text: 'NRC', kind: 'code', language: null }),
      expect.objectContaining({ text: 'Northern Realm', kind: 'historical' }),
    ]));
    expect(country?.boundaries.map((item) => item.role)).toEqual(['primary', 'hole']);
    expect(country?.boundaries[1].flags).toEqual(['hole', 'antimeridian']);
    expect(country?.boundaries[0].provenance).toMatchObject({ sourceRevision: REVISION, attribution: 'Fixture geometry' });
    expect(country?.id).not.toBe('NRC');
    const ministry = graph.nodes.find((node) => node.id === 'issuer:north-ministry');
    expect(ministry).toMatchObject({ roles: ['issuer'], boundaries: [], parentKnowledge: 'none', issuerIds: [] });
    expect(ministry && 'city' in ministry).toBe(false);
    const tract = graph.nodes.find((node) => node.id === 'place:unincorporated-tract');
    expect(tract?.boundaries).toEqual([]);
    expect(tract?.level.kind).toBe('unincorporated');
    expect(graph.unknownRelationships).toEqual([
      expect.objectContaining({
        schema: UNKNOWN_RELATIONSHIP_SCHEMA,
        subjectId: 'place:unincorporated-tract',
        about: 'boundary',
        targetId: null,
      }),
      expect.objectContaining({
        subjectId: 'place:unincorporated-tract',
        about: 'issuer',
        targetId: null,
      }),
    ]);
    expect(graph.edges.every((item) => item.applicability === 'not-asserted' && item.schema === JURISDICTION_EDGE_SCHEMA)).toBe(true);
    expect(graph.edges.map((item) => item.kind).sort()).toEqual([
      'administrative-containment',
      'administrative-containment',
      'administrative-containment',
      'administrative-containment',
      'administrative-containment',
      'administrative-containment',
      'territorial-coverage',
    ]);
    const coverage = graph.edges.find((item) => item.kind === 'territorial-coverage');
    expect(coverage).toMatchObject({ fromId: 'place:north-country', toId: 'place:example-union', exclusive: null });
    const parents = graph.edges.filter((item) => item.kind === 'administrative-containment' && item.fromId === 'place:old-quarter');
    expect(parents.map((item) => item.toId)).toEqual(['place:market-borough']);
    const slice = candidateEdges(graph, { asOf: '2024-06-01' });
    expect(slice.applicability).toBe('not-asserted');
    expect(slice.edges).toHaveLength(7);
    expect(slice.undecided).toEqual([]);
    expect(slice.unknownRelationships).toHaveLength(2);
    expect(candidateEdges(graph, { asOf: '1990' }).edges).toEqual([]);
  });

  test('admits multiple parents and keeps coverage, delegation, and legal relations distinct', () => {
    const result = admitJurisdictionGraph(envelope({
      nodes: [
        place('place:north-country', 'country', { name: 'North Country', roles: ['place', 'issuer'] }),
        place('place:north-province', 'province', {
          name: 'North Province',
          roles: ['place', 'issuer'],
          parentKnowledge: 'known',
        }),
        place('place:river-district', 'special-district', { name: 'River District', parentKnowledge: 'known' }),
        place('place:harbor-town', 'municipality', {
          name: 'Harbor Town',
          roles: ['place', 'issuer'],
          parentKnowledge: 'known',
          issuerIds: ['place:harbor-town', 'place:north-province'],
        }),
        place('issuer:pilot-board', 'local-authority', {
          name: 'Pilot Board',
          roles: ['issuer'],
          issuerIds: [],
          issuerKnowledge: 'none',
          level: {
            kind: 'pilot-board',
            label: { text: 'Pilot board', language: 'en', script: 'Latn' },
          },
        }),
      ],
      edges: [
        edge('edge:province-parent', 'administrative-containment', 'place:north-province', 'place:north-country'),
        edge('edge:district-parent', 'administrative-containment', 'place:river-district', 'place:north-country'),
        edge('edge:town-province', 'administrative-containment', 'place:harbor-town', 'place:north-province', { exclusive: false }),
        edge('edge:town-district', 'administrative-containment', 'place:harbor-town', 'place:river-district', { exclusive: false }),
        edge('edge:town-coverage', 'territorial-coverage', 'place:harbor-town', 'place:north-country'),
        edge('edge:town-delegated', 'delegated-authority', 'place:harbor-town', 'place:north-province'),
        edge('edge:town-legal', 'legal-relationship', 'place:harbor-town', 'issuer:pilot-board', {
          evidence: ['Pilot board charter recorded in the fixture pin.'],
        }),
      ],
    }));

    expect(reasons(result)).toEqual([]);
    const graph = result.graph;
    if (!graph) throw new Error('graph missing');
    const parents = graph.edges.filter((item) => item.kind === 'administrative-containment' && item.fromId === 'place:harbor-town');
    expect(parents.map((item) => item.toId).sort()).toEqual(['place:north-province', 'place:river-district']);
    expect(parents.every((item) => item.exclusive === false)).toBe(true);
    expect(graph.edges.map((item) => item.kind).sort()).toEqual([
      'administrative-containment',
      'administrative-containment',
      'administrative-containment',
      'administrative-containment',
      'delegated-authority',
      'legal-relationship',
      'territorial-coverage',
    ]);
    expect(graph.edges.every((item) => item.applicability === APPLICABILITY)).toBe(true);
    const legal = graph.edges.find((item) => item.kind === 'legal-relationship');
    expect(legal?.evidence).toEqual(['Pilot board charter recorded in the fixture pin.']);
    expect(legal?.exclusive).toBeNull();
    const country = graph.nodes.find((item) => item.id === 'place:north-country');
    expect(country?.level.kind).toBe('country');
    expect(country && 'city' in country).toBe(false);
    const slice = candidateEdges(graph, { asOf: '2024-01-01' });
    expect(slice.edges.filter((item) => item.fromId === 'place:harbor-town')).toHaveLength(5);
    expect(slice.applicability).toBe('not-asserted');
  });

  test('keeps disputed views beside the base graph and rejects exclusive overlap in one view', () => {
    const admitted = admitJurisdictionGraph(envelope({
      nodes: [
        place('place:claim-north', 'country', { name: 'Claim North', roles: ['place', 'issuer'] }),
        place('place:claim-south', 'country', { name: 'Claim South', roles: ['place', 'issuer'] }),
        place('place:border-valley', 'territory', {
          name: 'Border Valley',
          parentKnowledge: 'disputed',
          issuerKnowledge: 'unknown',
          issuerIds: [],
          boundaries: [
            boundary('boundary:valley-north', { role: 'disputed', viewId: 'view:claim-north', flags: ['border-uncertain'] }),
            boundary('boundary:valley-south', { role: 'disputed', viewId: 'view:claim-south', flags: ['enclave'] }),
          ],
        }),
      ],
      disputedViews: [
        {
          id: 'view:claim-north',
          statement: 'Claim North records Border Valley as its administrative child.',
          claimantIds: ['place:claim-north'],
          valid: openValid('1900'),
        },
        {
          id: 'view:claim-south',
          statement: 'Claim South records Border Valley as its administrative child.',
          claimantIds: ['place:claim-south'],
          valid: openValid('1900'),
        },
      ],
      edges: [
        edge('edge:valley-north', 'administrative-containment', 'place:border-valley', 'place:claim-north', { viewId: 'view:claim-north' }),
        edge('edge:valley-south', 'administrative-containment', 'place:border-valley', 'place:claim-south', { viewId: 'view:claim-south' }),
      ],
      unknownRelationships: [
        {
          subjectId: 'place:border-valley',
          about: 'issuer',
          reason: 'No issuer is agreed for Border Valley.',
        },
      ],
    }));

    expect(reasons(admitted)).toEqual([]);
    const graph = admitted.graph;
    if (!graph) throw new Error('graph missing');
    expect(graph.disputedViews.map((view) => view.id)).toEqual(['view:claim-north', 'view:claim-south']);
    expect(graph.nodes.find((node) => node.id === 'place:border-valley')?.parentKnowledge).toBe('disputed');
    expect(graph.nodes.find((node) => node.id === 'place:border-valley')?.level.kind).not.toBe('city');
    const base = candidateEdges(graph, { asOf: '2024-01-01' });
    expect(base.edges).toEqual([]);
    const both = candidateEdges(graph, { asOf: '2024-01-01', viewIds: ['view:claim-north', 'view:claim-south'] });
    expect(both.edges.map((item) => item.toId).sort()).toEqual(['place:claim-north', 'place:claim-south']);
    expect(both.applicability).toBe('not-asserted');
    expect(both.unknownRelationships.map((item) => item.targetId)).toEqual([null]);

    const conflict = admitJurisdictionGraph(envelope({
      nodes: [
        place('place:claim-north', 'country', { name: 'Claim North', roles: ['place', 'issuer'] }),
        place('place:claim-south', 'country', { name: 'Claim South', roles: ['place', 'issuer'] }),
        place('place:border-valley', 'territory', { name: 'Border Valley', parentKnowledge: 'known' }),
      ],
      edges: [
        edge('edge:valley-north', 'administrative-containment', 'place:border-valley', 'place:claim-north'),
        edge('edge:valley-south', 'administrative-containment', 'place:border-valley', 'place:claim-south'),
      ],
    }));
    expect(reasons(conflict)).toEqual(expect.arrayContaining(['conflicting-containment', 'known-parent-missing']));
    expect(conflict.graph?.edges).toEqual([]);
    expect(nodeIds(conflict)).not.toContain('place:border-valley');
    expect(nodeIds(conflict)).toEqual(expect.arrayContaining(['place:claim-north', 'place:claim-south']));
    expect(conflict.quarantined.filter((item) => item.reason === 'conflicting-containment').map((item) => item.edgeId).sort()).toEqual([
      'edge:valley-north',
      'edge:valley-south',
    ]);
  });

  test('preserves explicit unknown relationships and does not invent a parent or a city', () => {
    const result = admitJurisdictionGraph(envelope({
      nodes: [
        place('place:north-country', 'country', { name: 'North Country', roles: ['place', 'issuer'] }),
        place('place:unnamed-tract', 'territory', {
          names: [],
          nameKnowledge: 'unknown',
          level: { knowledge: 'unknown' },
          parentKnowledge: 'unknown',
          issuerKnowledge: 'unknown',
          issuerIds: [],
          boundaries: [],
        }),
        place('place:guessed', 'territory', {
          name: 'Guessed Tract',
          parentKnowledge: 'unknown',
        }),
      ],
      unknownRelationships: [
        { subjectId: 'place:unnamed-tract', about: 'name', reason: 'The fixture pin records no name.' },
        { subjectId: 'place:unnamed-tract', about: 'level', reason: 'The fixture pin records no level.' },
        { subjectId: 'place:unnamed-tract', about: 'administrative-parent', reason: 'The fixture pin records no parent.' },
        { subjectId: 'place:unnamed-tract', about: 'issuer', reason: 'The fixture pin records no issuer.' },
        { subjectId: 'place:unnamed-tract', about: 'boundary', reason: 'The fixture pin records no boundary.' },
        {
          subjectId: 'place:guessed',
          about: 'administrative-parent',
          reason: 'A parent was not identified.',
          targetId: 'place:north-country',
        },
      ],
    }));

    expect(reasons(result)).toEqual(expect.arrayContaining([
      'unknown-relationship-has-target',
      'unknown-parent-missing-statement',
    ]));
    expect(nodeIds(result)).toEqual(['place:north-country', 'place:unnamed-tract']);
    const tract = result.graph?.nodes.find((node) => node.id === 'place:unnamed-tract');
    expect(tract?.level).toMatchObject({ kind: 'unknown', recognized: true, label: null });
    expect(tract?.names).toEqual([]);
    expect(tract?.level.kind).not.toBe('city');
    expect(result.graph?.edges).toEqual([]);
    expect(result.graph?.unknownRelationships.map((item) => item.about).sort()).toEqual([
      'administrative-parent',
      'boundary',
      'issuer',
      'level',
      'name',
    ]);
    expect(result.graph?.unknownRelationships.every((item) => item.targetId === null)).toBe(true);
    expect(JSON.stringify(result.graph?.unknownRelationships)).not.toContain('place:north-country');
  });

  test('rejects tuples, code identity, city fields, and unpinned revisions', () => {
    expect(() => admitJurisdictionGraph(null)).toThrow(JurisdictionSchemaError);
    expect(() => admitJurisdictionGraph([])).toThrow(JurisdictionSchemaError);

    const tuple = admitJurisdictionGraph({ country: 'NL', province: 'NH', city: null });
    expect(tuple.graph).toBeNull();
    expect(reasons(tuple)).toContain('tuple-is-not-graph');
    expect(tuple.quarantined[0].message).toMatch(/city is not required/i);
    expect(JSON.stringify(tuple)).not.toContain('place:');

    for (const sourceRevision of ['main', 'HEAD', 'latest', 'refs/heads/main']) {
      const unpinned = admitJurisdictionGraph(envelope({ sourceRevision, nodes: [] }));
      expect(unpinned.graph).toBeNull();
      expect(reasons(unpinned)).toContain('unpinned-source-revision');
    }

    const coded = admitJurisdictionGraph(envelope({
      sourceRevision: OTHER_REVISION,
      nodes: [
        place('place:netherlands', 'country', {
          name: 'Nederland',
          names: [{ text: 'Nederland', language: 'nl', script: 'Latn' }],
          roles: ['place', 'issuer'],
          aliases: [
            { text: 'Netherlands', language: 'en', script: 'Latn', kind: 'exonym' },
            { text: 'NL', kind: 'code' },
            { text: 'NLD', kind: 'code' },
          ],
          externalIds: [
            { scheme: 'iso-3166-1-alpha2', value: 'NL' },
            { scheme: 'iso-3166-1-alpha3', value: 'NLD' },
            { scheme: 'wikidata', value: 'Q55' },
          ],
        }),
        { id: 'NL', roles: ['place'], names: [{ text: 'NL', language: 'en' }] },
        place('place:nl', 'country', { name: 'Code Country' }),
        place('place:rotterdam-claim', 'municipality', { name: 'Should Not Become A City Field' }),
      ],
    }));
    const rotterdam = {
      ...place('place:rotterdam-claim', 'municipality', { name: 'Rotterdam' }),
      city: 'Rotterdam',
    };
    const withCity = admitJurisdictionGraph(envelope({
      nodes: [
        place('place:netherlands', 'country', {
          name: 'Nederland',
          names: [{ text: 'Nederland', language: 'nl', script: 'Latn' }],
          roles: ['place', 'issuer'],
          aliases: [
            { text: 'NL', kind: 'code' },
            { text: 'NLD', kind: 'code' },
          ],
          externalIds: [
            { scheme: 'iso-3166-1-alpha2', value: 'NL' },
            { scheme: 'iso-3166-1-alpha3', value: 'NLD' },
          ],
        }),
        rotterdam,
        place('place:nl', 'country', { name: 'Code Country' }),
      ],
    }));
    expect(withCity.graph?.sourceRevision).toBe(REVISION);
    expect(nodeIds(withCity)).toEqual(['place:netherlands']);
    expect(withCity.graph?.nodes[0].id).not.toBe('NL');
    expect(withCity.graph?.nodes[0].aliases.map((alias) => alias.text)).toEqual(expect.arrayContaining(['NL', 'NLD']));
    expect(reasons(withCity)).toEqual(expect.arrayContaining(['tuple-field-on-node', 'code-used-as-identity']));
    expect(JSON.stringify(withCity.graph)).not.toContain('Rotterdam');
    expect(coded.graph?.sourceRevision).toBe(OTHER_REVISION);
    expect(nodeIds(coded)).toContain('place:netherlands');
    expect(nodeIds(coded)).not.toContain('NL');
    expect(nodeIds(coded)).not.toContain('place:nl');
  });

  test('rejects cycles, self-parents, dangling issuers, and asserted applicability', () => {
    const cycle = admitJurisdictionGraph(envelope({
      nodes: [
        place('place:alpha', 'territory', { name: 'Alpha', parentKnowledge: 'known' }),
        place('place:beta', 'territory', { name: 'Beta', parentKnowledge: 'known' }),
      ],
      edges: [
        edge('edge:alpha-beta', 'administrative-containment', 'place:alpha', 'place:beta', { exclusive: false }),
        edge('edge:beta-alpha', 'administrative-containment', 'place:beta', 'place:alpha', { exclusive: false }),
      ],
    }));
    expect(reasons(cycle)).toEqual(expect.arrayContaining(['cyclic-containment', 'known-parent-missing']));
    expect(cycle.graph?.nodes).toEqual([]);
    expect(cycle.graph?.edges).toEqual([]);

    const selfParent = admitJurisdictionGraph(envelope({
      nodes: [
        place('place:north-country', 'country', { name: 'North Country', roles: ['place', 'issuer'] }),
        place('place:loop', 'territory', { name: 'Loop', parentKnowledge: 'known' }),
      ],
      edges: [edge('edge:loop', 'administrative-containment', 'place:loop', 'place:loop')],
    }));
    expect(reasons(selfParent)).toEqual(expect.arrayContaining(['endpoint-is-self', 'known-parent-missing']));
    expect(nodeIds(selfParent)).toEqual(['place:north-country']);

    const dangling = admitJurisdictionGraph(envelope({
      nodes: [
        place('place:north-country', 'country', {
          name: 'North Country',
          roles: ['place', 'issuer'],
          issuerIds: ['issuer:missing'],
        }),
      ],
    }));
    expect(reasons(dangling)).toContain('dangling-issuer');
    expect(dangling.graph?.nodes).toEqual([]);

    const asserted = admitJurisdictionGraph(envelope({
      nodes: [
        place('place:north-country', 'country', { name: 'North Country', roles: ['place', 'issuer'] }),
        place('issuer:pilot-board', 'local-authority', {
          name: 'Pilot Board',
          roles: ['issuer'],
          issuerIds: [],
          issuerKnowledge: 'none',
        }),
        place('place:river-district', 'special-district', { name: 'River District' }),
      ],
      edges: [
        edge('edge:applies', 'legal-relationship', 'place:north-country', 'issuer:pilot-board', {
          evidence: ['A charter exists in the fixture.'],
          applicability: 'governs',
        }),
        edge('edge:unsupported', 'legal-relationship', 'place:north-country', 'issuer:pilot-board'),
        edge('edge:inferred', 'territorial-coverage', 'place:north-country', 'issuer:pilot-board', { knowledge: 'inferred' }),
        edge('edge:delegate', 'delegated-authority', 'issuer:pilot-board', 'place:river-district'),
      ],
    }));
    expect(reasons(asserted)).toEqual(expect.arrayContaining([
      'applicability-asserted',
      'legal-relationship-without-evidence',
      'inferred-relation-without-evidence',
      'delegator-not-issuer',
    ]));
    expect(asserted.graph?.edges).toEqual([]);
    expect(nodeIds(asserted)).toEqual(['issuer:pilot-board', 'place:north-country', 'place:river-district']);
    expect(asserted.graph?.edges.some((item) => item.applicability !== 'not-asserted')).toBe(false);
  });

  test('uses validity intervals without treating an unknown bound as current', () => {
    expect(intervalStatus({ start: known('2000-01-01', 'day'), end: openEnd() }, '2024-05-01')).toBe('inside');
    expect(intervalStatus({ start: known('2000-01-01', 'day'), end: openEnd() }, '1999-12-31')).toBe('outside');
    expect(intervalStatus({ start: known('2000-01-01', 'day'), end: unknownBound() }, '2024-05-01')).toBe('unknown');
    expect(intervalStatus({ start: known('2000-01-01', 'day'), end: unknownBound() }, '1999')).toBe('outside');
    expect(intervalStatus({ start: unknownBound(), end: known('2020') }, '2021')).toBe('outside');
    expect(intervalStatus({ start: unknownBound(), end: known('2020') }, '2019')).toBe('unknown');
    expect(() => intervalStatus({ start: known('2000'), end: openEnd() }, '2024-13-01')).toThrow(JurisdictionSchemaError);

    const succession = admitJurisdictionGraph(envelope({
      nodes: [
        place('place:old-realm', 'country', { name: 'Old Realm', roles: ['place', 'issuer'] }),
        place('place:new-realm', 'country', { name: 'New Realm', roles: ['place', 'issuer'] }),
        place('place:moved-town', 'municipality', { name: 'Moved Town', parentKnowledge: 'known' }),
        place('place:open-town', 'locality', { name: 'Open Town', parentKnowledge: 'known' }),
        place('place:undated-town', 'locality', { name: 'Undated Town', parentKnowledge: 'known' }),
      ],
      edges: [
        edge('edge:old', 'administrative-containment', 'place:moved-town', 'place:old-realm', {
          valid: { start: known('1900'), end: known('1999') },
        }),
        edge('edge:new', 'administrative-containment', 'place:moved-town', 'place:new-realm', {
          valid: { start: known('2000'), end: openEnd() },
        }),
        edge('edge:open', 'administrative-containment', 'place:open-town', 'place:new-realm', {
          valid: { start: known('2000-01-01', 'day'), end: openEnd() },
        }),
        edge('edge:undated', 'administrative-containment', 'place:undated-town', 'place:new-realm', {
          valid: { start: known('2000-01-01', 'day'), end: unknownBound() },
        }),
      ],
    }));
    expect(reasons(succession)).toEqual([]);
    const graph = succession.graph;
    if (!graph) throw new Error('graph missing');
    expect(candidateEdges(graph, { asOf: '1950' }).edges.map((item) => item.id)).toEqual(['edge:old']);
    expect(candidateEdges(graph, { asOf: '2020-05-01' }).edges.map((item) => item.id).sort()).toEqual(['edge:new', 'edge:open']);
    const later = candidateEdges(graph, { asOf: '2020-05-01' });
    expect(later.undecided.map((item) => item.id)).toEqual(['edge:undated']);
    expect(later.edges.map((item) => item.id)).not.toContain('edge:undated');

    const ambiguous = admitJurisdictionGraph(envelope({
      nodes: [
        place('place:old-realm', 'country', { name: 'Old Realm', roles: ['place', 'issuer'] }),
        place('place:new-realm', 'country', { name: 'New Realm', roles: ['place', 'issuer'] }),
        place('place:moved-town', 'municipality', { name: 'Moved Town', parentKnowledge: 'known' }),
      ],
      edges: [
        edge('edge:old', 'administrative-containment', 'place:moved-town', 'place:old-realm', {
          valid: { start: known('1900'), end: unknownBound() },
        }),
        edge('edge:new', 'administrative-containment', 'place:moved-town', 'place:new-realm', {
          valid: { start: known('2000'), end: openEnd() },
        }),
      ],
    }));
    expect(reasons(ambiguous)).toEqual(expect.arrayContaining(['ambiguous-containment-interval', 'known-parent-missing']));
    expect(nodeIds(ambiguous)).not.toContain('place:moved-town');

    const backwards = admitJurisdictionGraph(envelope({
      nodes: [place('place:north-country', 'country', {
        name: 'North Country',
        valid: { start: known('2000-01-01', 'day'), end: known('1999') },
      })],
    }));
    expect(reasons(backwards)).toContain('interval-ends-before-start');
    expect(backwards.graph?.nodes).toEqual([]);

    const leap = admitJurisdictionGraph(envelope({
      nodes: [place('place:north-country', 'country', {
        name: 'North Country',
        valid: { start: { knowledge: 'known', value: '2021-02-29', precision: 'day', source: 'fixture' }, end: openEnd() },
      })],
    }));
    expect(reasons(leap)).toContain('invalid-interval');
  });

  test('requires labels, code aliases, view refs, and pinned boundary provenance', () => {
    const unlabeled = admitJurisdictionGraph(envelope({
      nodes: [place('place:canal-board', 'territory', {
        name: 'Canal Board',
        level: { kind: 'water-board' },
      })],
    }));
    expect(reasons(unlabeled)).toContain('arbitrary-level-without-label');
    expect(unlabeled.graph?.nodes).toEqual([]);

    const cityLevel = admitJurisdictionGraph(envelope({
      nodes: [place('place:somewhere', 'territory', {
        name: 'Somewhere',
        level: { knowledge: 'unknown', kind: 'city' },
      })],
    }));
    expect(reasons(cityLevel)).toContain('unknown-level-has-kind');
    expect(JSON.stringify(cityLevel.graph)).not.toContain('somewhere');

    const missingAlias = admitJurisdictionGraph(envelope({
      nodes: [place('place:netherlands', 'country', {
        name: 'Nederland',
        names: [{ text: 'Nederland', language: 'nl', script: 'Latn' }],
        externalIds: [{ scheme: 'iso-3166-1-alpha2', value: 'NL' }],
      })],
    }));
    expect(reasons(missingAlias)).toContain('code-not-recorded-as-alias');

    const languageOnCode = admitJurisdictionGraph(envelope({
      nodes: [place('place:netherlands', 'country', {
        name: 'Nederland',
        names: [{ text: 'Nederland', language: 'nl', script: 'Latn' }],
        aliases: [{ text: 'NL', kind: 'code', language: 'en' }],
        externalIds: [{ scheme: 'iso-3166-1-alpha2', value: 'NL' }],
      })],
    }));
    expect(reasons(languageOnCode)).toContain('code-alias-has-language');

    const missingView = admitJurisdictionGraph(envelope({
      nodes: [place('place:border-valley', 'territory', {
        name: 'Border Valley',
        boundaries: [boundary('boundary:valley', { role: 'disputed' })],
      })],
    }));
    expect(reasons(missingView)).toContain('disputed-boundary-without-view');

    const floatingBoundary = admitJurisdictionGraph(envelope({
      nodes: [place('place:north-country', 'country', {
        name: 'North Country',
        boundaries: [boundary('boundary:north-country', {
          provenance: {
            sourceId: 'registry:fixture',
            sourceRevision: 'main',
            attribution: 'Fixture geometry',
            license: null,
          },
        })],
      })],
    }));
    expect(reasons(floatingBoundary)).toContain('unpinned-boundary-revision');
    expect(floatingBoundary.graph?.nodes).toEqual([]);

    const duplicate = admitJurisdictionGraph(envelope({
      nodes: [
        place('place:north-country', 'country', { name: 'North Country', roles: ['place', 'issuer'] }),
        place('place:north-country', 'country', { name: 'Other North', roles: ['place', 'issuer'] }),
      ],
    }));
    expect(reasons(duplicate)).toContain('duplicate-node-id');
    expect(nodeIds(duplicate)).toEqual(['place:north-country']);
    expect(duplicate.graph?.nodes[0].names[0].text).toBe('North Country');
  });
});

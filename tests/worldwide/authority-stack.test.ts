import {
  APPLICABILITY,
  admitJurisdictionGraph,
  type AdmissionResult,
  type JurisdictionGraph,
} from '../../src/lib/worldwide/jurisdiction/schema';
import {
  AUTHORITY_BANDS,
  AUTHORITY_LIMITS,
  AUTHORITY_STACK_SCHEMA,
  INCLUSION_PREFIX,
  INCLUSION_REASONS,
  OMISSION_REASONS,
  STACK_HEADING,
  UNCERTAINTY,
  bandForLevel,
  inclusionLines,
  joinAuthorityStack,
  jurisdictionScopeOf,
  type AuthorityStack,
  type LawScopeInput,
} from '../../src/lib/worldwide/jurisdiction/authority';

const REVISION = 'a'.repeat(40);
const AS_OF = '2024-06-01';
const CHARTER = 'Pilot board charter recorded in the fixture pin.';
const TOWN_SCHEDULE = 'Section scope schedule.';

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
    level: opts.level ?? { kind: level },
    parentKnowledge: opts.parentKnowledge ?? 'none',
    issuerKnowledge: opts.issuerKnowledge ?? (issuerIds.length > 0 ? 'known' : 'none'),
    issuerIds,
    boundaries: opts.boundaries ?? (roles.includes('place') ? [boundary(`boundary:${id.slice(id.indexOf(':') + 1)}`)] : []),
    valid: opts.valid ?? openValid(),
  };
}

function edge(id: string, kind: string, fromId: string, toId: string, extra: Record<string, unknown> = {}) {
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

function mustAdmit(input: Record<string, unknown>): JurisdictionGraph {
  const result: AdmissionResult = admitJurisdictionGraph(envelope(input));
  if (!result.graph || result.quarantined.length > 0) {
    throw new Error(`fixture quarantined: ${result.quarantined.map((item) => item.reason).join(',')}`);
  }
  return result.graph;
}

function reasons(candidateId: string, stack: AuthorityStack, side: 'territory' | 'issuer'): string[] {
  const candidate = stack.candidates.find((item) => item.id === candidateId);
  return candidate?.[side]?.inclusions.map((inclusion) => inclusion.reason) ?? [];
}

function harborGraph(): JurisdictionGraph {
  return mustAdmit({
    nodes: [
      place('place:example-union', 'supranational', {
        name: 'Example Union',
        roles: ['place', 'issuer'],
      }),
      place('place:north-country', 'country', {
        name: 'North Country',
        roles: ['place', 'issuer'],
        parentKnowledge: 'known',
        issuerIds: ['place:north-country', 'issuer:north-ministry'],
      }),
      place('place:north-province', 'province', {
        name: 'North Province',
        roles: ['place', 'issuer'],
        parentKnowledge: 'known',
      }),
      place('place:river-district', 'special-district', {
        name: 'River District',
        parentKnowledge: 'known',
      }),
      place('place:harbor-town', 'municipality', {
        name: 'Harbor Town',
        roles: ['place', 'issuer'],
        parentKnowledge: 'known',
        issuerIds: ['place:harbor-town', 'place:north-province'],
      }),
      place('place:other-town', 'municipality', {
        name: 'Other Town',
        parentKnowledge: 'known',
      }),
      place('issuer:north-ministry', 'national-authority', {
        name: 'North Ministry',
        roles: ['issuer'],
        issuerIds: [],
        issuerKnowledge: 'none',
        boundaries: [],
      }),
      place('issuer:pilot-board', 'special-district', {
        name: 'Pilot Board',
        roles: ['issuer'],
        issuerIds: [],
        issuerKnowledge: 'none',
        boundaries: [],
      }),
    ],
    edges: [
      edge('edge:country-union', 'administrative-containment', 'place:north-country', 'place:example-union'),
      edge('edge:province-parent', 'administrative-containment', 'place:north-province', 'place:north-country'),
      edge('edge:river-parent', 'administrative-containment', 'place:river-district', 'place:north-country'),
      edge('edge:town-province', 'administrative-containment', 'place:harbor-town', 'place:north-province', { exclusive: false }),
      edge('edge:town-river', 'administrative-containment', 'place:harbor-town', 'place:river-district', { exclusive: false }),
      edge('edge:other-parent', 'administrative-containment', 'place:other-town', 'place:north-province'),
      edge('edge:town-coverage', 'territorial-coverage', 'place:harbor-town', 'place:north-country'),
      edge('edge:town-delegated', 'delegated-authority', 'place:harbor-town', 'place:north-province'),
      edge('edge:town-legal', 'legal-relationship', 'place:harbor-town', 'issuer:pilot-board', { evidence: [CHARTER] }),
    ],
  });
}

function harborLaws(): LawScopeInput[] {
  return [
    {
      sectionId: 'section:town-code',
      sourceId: 'src:harbor',
      sourceRevision: REVISION,
      evidence: [TOWN_SCHEDULE],
      scope: {
        issuerIds: ['place:harbor-town'],
        territorialIds: ['place:harbor-town'],
        territorialLabels: [],
        knowledge: 'known',
        uncertainty: [],
      },
    },
    {
      lawId: 'law:neighbor-code',
      issuerIds: ['place:other-town'],
      territorialIds: ['place:other-town'],
      knowledge: 'known',
    },
    {
      lawId: 'law:unknown-scope',
      issuerIds: ['issuer:should-not-appear'],
      territorialIds: ['place:harbor-town'],
      knowledge: 'unknown',
    },
    {
      lawId: 'law:label-only',
      issuerIds: ['issuer:label-ministry'],
      territorialLabels: ['North Country'],
      knowledge: 'known',
    },
  ];
}

function assertNoBindingClaim(stack: AuthorityStack): void {
  expect(stack.applicability).toBe('not-asserted');
  expect(stack.applicability).toBe(APPLICABILITY);
  expect(stack.heading).toBe('Laws and sources for this place');
  for (const candidate of stack.candidates) {
    expect(candidate.applicability).toBe('not-asserted');
    expect(candidate.territory === null || candidate.territory.distinction === 'territory').toBe(true);
    expect(candidate.issuer === null || candidate.issuer.distinction === 'issuer').toBe(true);
  }
  for (const line of inclusionLines(stack)) {
    expect(line.startsWith(`${INCLUSION_PREFIX} `)).toBe(true);
    expect(line).not.toMatch(/\b(applies|applicable|applicability|governs|governing)\b/i);
  }
  for (const link of stack.unknownLinks) expect(link.targetId).toBeNull();
}

describe('authority stack', () => {
  test('pins the stack contract and level bands', () => {
    expect(AUTHORITY_STACK_SCHEMA).toBe('worldwide-legal-search.authority-stack@1');
    expect(STACK_HEADING).toBe('Laws and sources for this place');
    expect(INCLUSION_PREFIX).toBe('Included because');
    expect([...AUTHORITY_BANDS]).toEqual(['national', 'regional', 'local', 'special', 'supranational', 'unclassified']);
    expect([...INCLUSION_REASONS]).toEqual([
      'selected-place',
      'administrative-parent',
      'territorial-coverage',
      'place-issuer',
      'delegated-authority',
      'legal-relationship',
      'law-territorial-scope',
      'law-issuer',
    ]);
    expect([...OMISSION_REASONS]).toEqual([
      'unevidenced-special',
      'unevidenced-supranational',
      'proximity',
      'validity-outside',
      'not-a-place',
      'territorial-scope-outside-stack',
    ]);
    expect(bandForLevel('country')).toBe('national');
    expect(bandForLevel('constituent-country')).toBe('national');
    expect(bandForLevel('province')).toBe('regional');
    expect(bandForLevel('state')).toBe('regional');
    expect(bandForLevel('municipality')).toBe('local');
    expect(bandForLevel('city')).toBe('local');
    expect(bandForLevel('special-district')).toBe('special');
    expect(bandForLevel('indigenous-territory')).toBe('special');
    expect(bandForLevel('water-board')).toBe('special');
    expect(bandForLevel('supranational')).toBe('supranational');
    expect(bandForLevel('unknown')).toBe('unclassified');
    expect(UNCERTAINTY.notDetermination).toMatch(/does not decide/i);
  });

  test('returns national, regional, and local candidates and keeps special or supranational parents out without evidence', () => {
    const graph = harborGraph();
    const stack = joinAuthorityStack(graph, {
      placeId: 'place:harbor-town',
      asOf: AS_OF,
      laws: harborLaws(),
      nearbyPlaceIds: ['place:other-town', 'place:north-province'],
    });

    expect(stack.status).toBe('resolved');
    expect(stack.graphId).toBe('graph:fixture');
    expect(stack.placeId).toBe('place:harbor-town');
    expect(stack.asOf).toBe(AS_OF);
    assertNoBindingClaim(stack);
    expect(stack.byBand.national).toEqual(['issuer:north-ministry', 'place:north-country']);
    expect(stack.byBand.regional).toEqual(['place:north-province']);
    expect(stack.byBand.local).toEqual(['place:harbor-town']);
    expect(stack.byBand.special).toEqual(['issuer:pilot-board']);
    expect(stack.byBand.supranational).toEqual([]);
    expect(stack.byBand.unclassified).toEqual([]);
    expect(stack.territorialIds).toEqual(['place:harbor-town', 'place:north-country', 'place:north-province']);
    expect(stack.issuerIds).toEqual([
      'issuer:north-ministry',
      'issuer:pilot-board',
      'place:harbor-town',
      'place:north-country',
      'place:north-province',
    ]);
    expect(stack.territorialIds).not.toContain('issuer:north-ministry');
    expect(stack.territorialIds).not.toContain('issuer:pilot-board');
    expect(stack.territorialIds).not.toContain('place:example-union');
    expect(stack.territorialIds).not.toContain('place:river-district');
    expect(stack.issuerIds).not.toContain('place:river-district');
    expect(stack.issuerIds).not.toContain('place:example-union');
    expect(stack.issuerIds).not.toContain('issuer:should-not-appear');
    expect(stack.issuerIds).not.toContain('issuer:label-ministry');
    expect(stack.candidates.map((candidate) => candidate.id)).not.toContain('place:other-town');

    expect(reasons('place:harbor-town', stack, 'territory')).toEqual(['selected-place', 'law-territorial-scope']);
    expect(reasons('place:harbor-town', stack, 'issuer')).toEqual(['place-issuer', 'law-issuer']);
    expect(reasons('place:north-province', stack, 'territory')).toEqual(['administrative-parent']);
    expect(reasons('place:north-province', stack, 'issuer')).toEqual(['place-issuer', 'place-issuer', 'delegated-authority']);
    expect(reasons('place:north-country', stack, 'territory')).toEqual(['administrative-parent', 'administrative-parent', 'territorial-coverage']);
    expect(reasons('issuer:north-ministry', stack, 'territory')).toEqual([]);
    expect(stack.candidates.find((candidate) => candidate.id === 'issuer:north-ministry')?.territory).toBeNull();
    expect(reasons('issuer:north-ministry', stack, 'issuer')).toEqual(['place-issuer']);
    expect(reasons('issuer:pilot-board', stack, 'issuer')).toEqual(['legal-relationship']);
    expect(stack.candidates.find((candidate) => candidate.id === 'issuer:pilot-board')?.territory).toBeNull();

    const ministryLine = stack.candidates.find((candidate) => candidate.id === 'issuer:north-ministry')?.issuer?.inclusions[0].because ?? '';
    expect(ministryLine).toContain('North Country');
    expect(ministryLine).toContain('North Ministry');
    expect(ministryLine).not.toContain('Harbor Town');
    const pilot = stack.candidates.find((candidate) => candidate.id === 'issuer:pilot-board');
    expect(pilot?.issuer?.inclusions[0].evidence).toEqual([CHARTER]);
    expect(pilot?.band).toBe('special');

    expect(stack.omitted).toEqual([
      {
        id: 'place:other-town',
        reason: 'proximity',
        detail: 'Nearby id place:other-town was not added. Proximity does not establish inclusion.',
      },
      {
        id: 'place:river-district',
        reason: 'unevidenced-special',
        detail: 'River District is a special, unrecognized, or unknown-level authority reached by administrative containment. No cited containment evidence included it.',
      },
      {
        id: 'place:example-union',
        reason: 'unevidenced-supranational',
        detail: 'Example Union is a supranational authority reached by administrative containment. Containment was not treated as territorial scope.',
      },
    ]);
    expect(stack.unmatchedLaws).toEqual([
      { lawId: 'law:label-only', reason: 'label-not-identity' },
      { lawId: 'law:neighbor-code', reason: 'territorial-scope-outside-stack' },
      { lawId: 'law:unknown-scope', reason: 'unknown-scope' },
    ]);
    expect(stack.relationshipEvidence).toEqual([CHARTER, TOWN_SCHEDULE]);
    expect(stack.uncertainty[0]).toBe(UNCERTAINTY.notDetermination);
    expect(stack.uncertainty).toContain(UNCERTAINTY.proximity);
    expect(stack.uncertainty).toContain(UNCERTAINTY.containment);
    expect(stack.uncertainty).toContain('Law law:label-only territorial labels are not place ids and were not used as identity.');
    expect(JSON.stringify(stack)).not.toContain('issuer:should-not-appear');
    expect(stack.unknownLinks).toContainEqual(expect.objectContaining({
      subjectId: 'law:unknown-scope',
      about: 'law-scope',
      targetId: null,
      lawId: 'law:unknown-scope',
    }));
    expect(stack.knownAbsences).toEqual([
      {
        subjectId: 'issuer:north-ministry',
        about: 'administrative-parent',
        statement: 'North Ministry has no administrative parent. No parent was invented.',
      },
      {
        subjectId: 'issuer:north-ministry',
        about: 'issuer',
        statement: 'North Ministry lists no issuer ids. No issuer was invented.',
      },
      {
        subjectId: 'issuer:pilot-board',
        about: 'administrative-parent',
        statement: 'Pilot Board has no administrative parent. No parent was invented.',
      },
      {
        subjectId: 'issuer:pilot-board',
        about: 'issuer',
        statement: 'Pilot Board lists no issuer ids. No issuer was invented.',
      },
    ]);
    const scope = jurisdictionScopeOf(stack);
    expect(scope.placeId).toBe('place:harbor-town');
    expect(scope.issuerIds).toEqual(stack.issuerIds);
    expect(scope.territorialIds).toEqual(stack.territorialIds);
    expect(scope.relationshipEvidence).toEqual(stack.relationshipEvidence);
    expect(scope.uncertainty).toEqual(stack.uncertainty);

    const withoutNearby = joinAuthorityStack(graph, { placeId: 'place:harbor-town', asOf: AS_OF });
    expect(withoutNearby.candidates.map((candidate) => candidate.id)).not.toContain('place:other-town');
    expect(withoutNearby.omitted.map((item) => item.id)).not.toContain('place:other-town');
    expect(withoutNearby.territorialIds).toEqual(stack.territorialIds);
  });

  test('keeps both routine administrative parents and does not pick one', () => {
    const graph = mustAdmit({
      nodes: [
        place('place:north-country', 'country', { name: 'North Country', roles: ['place', 'issuer'] }),
        place('place:north-province', 'province', {
          name: 'North Province',
          roles: ['place', 'issuer'],
          parentKnowledge: 'known',
        }),
        place('place:gulf-state', 'state', {
          name: 'Gulf State',
          roles: ['place', 'issuer'],
          parentKnowledge: 'known',
        }),
        place('place:harbor-town', 'municipality', {
          name: 'Harbor Town',
          parentKnowledge: 'known',
          issuerKnowledge: 'none',
          issuerIds: [],
        }),
      ],
      edges: [
        edge('edge:province-parent', 'administrative-containment', 'place:north-province', 'place:north-country'),
        edge('edge:state-parent', 'administrative-containment', 'place:gulf-state', 'place:north-country'),
        edge('edge:town-province', 'administrative-containment', 'place:harbor-town', 'place:north-province', { exclusive: false }),
        edge('edge:town-state', 'administrative-containment', 'place:harbor-town', 'place:gulf-state', { exclusive: false }),
      ],
    });
    const stack = joinAuthorityStack(graph, { placeId: 'place:harbor-town', asOf: AS_OF });
    expect(stack.byBand.regional).toEqual(['place:gulf-state', 'place:north-province']);
    expect(stack.byBand.national).toEqual(['place:north-country']);
    expect(stack.byBand.local).toEqual(['place:harbor-town']);
    expect(stack.candidates.find((candidate) => candidate.id === 'place:harbor-town')?.issuer).toBeNull();
    assertNoBindingClaim(stack);
  });

  test('includes supranational and special candidates from territorial coverage, not from containment alone', () => {
    const graph = mustAdmit({
      nodes: [
        place('place:example-union', 'supranational', { name: 'Example Union', roles: ['place', 'issuer'] }),
        place('place:indigenous-tract', 'indigenous-territory', { name: 'Indigenous Tract', parentKnowledge: 'known' }),
        place('place:north-country', 'country', {
          name: 'North Country',
          roles: ['place', 'issuer'],
          parentKnowledge: 'known',
        }),
        place('place:harbor-town', 'municipality', { name: 'Harbor Town', parentKnowledge: 'known' }),
        place('place:other-tract', 'indigenous-territory', { name: 'Other Tract', parentKnowledge: 'known' }),
      ],
      edges: [
        edge('edge:country-union', 'administrative-containment', 'place:north-country', 'place:example-union'),
        edge('edge:town-parent', 'administrative-containment', 'place:harbor-town', 'place:north-country'),
        edge('edge:tract-parent', 'administrative-containment', 'place:indigenous-tract', 'place:north-country'),
        edge('edge:other-parent', 'administrative-containment', 'place:other-tract', 'place:north-country'),
        edge('edge:country-coverage', 'territorial-coverage', 'place:north-country', 'place:example-union'),
        edge('edge:town-tract', 'territorial-coverage', 'place:harbor-town', 'place:indigenous-tract'),
      ],
    });
    const covered = joinAuthorityStack(graph, { placeId: 'place:harbor-town', asOf: AS_OF });
    assertNoBindingClaim(covered);
    expect(covered.byBand.supranational).toEqual(['place:example-union']);
    expect(covered.byBand.special).toEqual(['place:indigenous-tract']);
    expect(reasons('place:example-union', covered, 'territory')).toEqual(['territorial-coverage']);
    expect(reasons('place:example-union', covered, 'issuer')).toEqual(['place-issuer']);
    expect(reasons('place:indigenous-tract', covered, 'territory')).toEqual(['territorial-coverage']);
    expect(covered.candidates.map((candidate) => candidate.id)).not.toContain('place:other-tract');
    expect(covered.omitted.map((item) => item.id)).not.toContain('place:other-tract');
    expect(covered.territorialIds).not.toContain('place:other-tract');
    expect(covered.issuerIds).not.toContain('place:other-tract');
    expect(covered.omitted.find((item) => item.id === 'place:example-union')).toBeUndefined();

    const containmentOnly = mustAdmit({
      nodes: [
        place('place:example-union', 'supranational', { name: 'Example Union', roles: ['place', 'issuer'] }),
        place('place:north-country', 'country', {
          name: 'North Country',
          roles: ['place', 'issuer'],
          parentKnowledge: 'known',
        }),
        place('place:harbor-town', 'municipality', { name: 'Harbor Town', parentKnowledge: 'known' }),
      ],
      edges: [
        edge('edge:country-union', 'administrative-containment', 'place:north-country', 'place:example-union'),
        edge('edge:town-parent', 'administrative-containment', 'place:harbor-town', 'place:north-country'),
      ],
    });
    const bare = joinAuthorityStack(containmentOnly, { placeId: 'place:harbor-town', asOf: AS_OF });
    expect(bare.byBand.supranational).toEqual([]);
    expect(bare.omitted).toContainEqual(expect.objectContaining({ id: 'place:example-union', reason: 'unevidenced-supranational' }));
  });

  test('includes a special parent when the containment edge cites evidence', () => {
    const graph = mustAdmit({
      nodes: [
        place('place:north-country', 'country', { name: 'North Country', roles: ['place', 'issuer'] }),
        place('place:river-district', 'special-district', { name: 'River District', parentKnowledge: 'known' }),
        place('place:harbor-town', 'municipality', { name: 'Harbor Town', parentKnowledge: 'known' }),
      ],
      edges: [
        edge('edge:river-parent', 'administrative-containment', 'place:river-district', 'place:north-country'),
        edge('edge:town-river', 'administrative-containment', 'place:harbor-town', 'place:river-district', {
          evidence: ['River district charter lists Harbor Town.'],
        }),
      ],
    });
    const stack = joinAuthorityStack(graph, { placeId: 'place:harbor-town', asOf: AS_OF });
    expect(stack.byBand.special).toEqual(['place:river-district']);
    expect(reasons('place:river-district', stack, 'territory')).toEqual(['administrative-parent']);
    expect(stack.relationshipEvidence).toEqual(['River district charter lists Harbor Town.']);
    assertNoBindingClaim(stack);
  });

  test('selecting a special district includes that district and its routine parents, not its child or an unevidenced union', () => {
    const graph = mustAdmit({
      nodes: [
        place('place:example-union', 'supranational', { name: 'Example Union', roles: ['place', 'issuer'] }),
        place('place:north-country', 'country', {
          name: 'North Country',
          roles: ['place', 'issuer'],
          parentKnowledge: 'known',
        }),
        place('place:river-district', 'special-district', {
          name: 'River District',
          parentKnowledge: 'known',
          issuerKnowledge: 'none',
          issuerIds: [],
        }),
        place('place:harbor-town', 'municipality', { name: 'Harbor Town', parentKnowledge: 'known' }),
      ],
      edges: [
        edge('edge:country-union', 'administrative-containment', 'place:north-country', 'place:example-union'),
        edge('edge:river-parent', 'administrative-containment', 'place:river-district', 'place:north-country'),
        edge('edge:town-river', 'administrative-containment', 'place:harbor-town', 'place:river-district'),
      ],
    });
    const stack = joinAuthorityStack(graph, { placeId: 'place:river-district', asOf: AS_OF });
    expect(stack.territorialIds).toEqual(['place:north-country', 'place:river-district']);
    expect(stack.candidates.map((candidate) => candidate.id)).not.toContain('place:harbor-town');
    expect(stack.byBand.supranational).toEqual([]);
    expect(reasons('place:river-district', stack, 'territory')).toEqual(['selected-place']);
    expect(stack.omitted).toContainEqual(expect.objectContaining({ id: 'place:example-union', reason: 'unevidenced-supranational' }));
    assertNoBindingClaim(stack);
  });

  test('a law territorial scope can evidence a supranational issuer without turning it into the territory', () => {
    const graph = harborGraph();
    const stack = joinAuthorityStack(graph, {
      placeId: 'place:harbor-town',
      asOf: AS_OF,
      laws: [
        {
          lawId: 'law:union-regulation',
          issuerIds: ['place:example-union'],
          territorialIds: ['place:north-country'],
          knowledge: 'known',
          evidence: ['Regulation names North Country in its territorial schedule.'],
        },
      ],
    });
    const union = stack.candidates.find((candidate) => candidate.id === 'place:example-union');
    expect(union?.band).toBe('supranational');
    expect(union?.territory).toBeNull();
    expect(reasons('place:example-union', stack, 'issuer')).toEqual(['law-issuer']);
    expect(stack.issuerIds).toContain('place:example-union');
    expect(stack.territorialIds).not.toContain('place:example-union');
    expect(stack.relationshipEvidence).toEqual([
      CHARTER,
      'Regulation names North Country in its territorial schedule.',
    ]);
    expect(stack.omitted.find((item) => item.id === 'place:example-union')).toBeUndefined();
    assertNoBindingClaim(stack);

    const both = joinAuthorityStack(graph, {
      placeId: 'place:harbor-town',
      asOf: AS_OF,
      laws: [
        {
          lawId: 'law:union-area',
          issuerIds: ['place:example-union'],
          territorialIds: ['place:north-country', 'place:example-union'],
          knowledge: 'inferred',
          evidence: ['The schedule lists both the country and the union territory.'],
          uncertainty: ['The union territorial id was inferred from the schedule.'],
        },
      ],
    });
    expect(reasons('place:example-union', both, 'territory')).toEqual(['law-territorial-scope']);
    expect(reasons('place:example-union', both, 'issuer')).toEqual(['law-issuer']);
    expect(both.candidates.find((candidate) => candidate.id === 'place:example-union')?.issuer?.inclusions[0].knowledge).toBe('inferred');
    expect(both.uncertainty).toContain('The union territorial id was inferred from the schedule.');
    assertNoBindingClaim(both);
  });

  test('does not copy a parent issuer onto a place whose issuer is none or unknown', () => {
    const graph = mustAdmit({
      nodes: [
        place('place:north-country', 'country', {
          name: 'North Country',
          roles: ['place', 'issuer'],
          issuerIds: ['place:north-country', 'issuer:north-ministry'],
        }),
        place('place:quiet-town', 'municipality', {
          name: 'Quiet Town',
          parentKnowledge: 'known',
          issuerKnowledge: 'unknown',
          issuerIds: [],
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
        edge('edge:town-parent', 'administrative-containment', 'place:quiet-town', 'place:north-country'),
      ],
      unknownRelationships: [
        { subjectId: 'place:quiet-town', about: 'issuer', reason: 'No issuer is identified for Quiet Town.' },
      ],
    });
    const stack = joinAuthorityStack(graph, {
      placeId: 'place:quiet-town',
      asOf: AS_OF,
      nearbyPlaceIds: ['place:north-country'],
    });
    expect(stack.candidates.find((candidate) => candidate.id === 'place:quiet-town')?.issuer).toBeNull();
    expect(stack.issuerIds).toEqual(['issuer:north-ministry', 'place:north-country']);
    expect(stack.unknownLinks).toContainEqual(expect.objectContaining({
      subjectId: 'place:quiet-town',
      about: 'issuer',
      reason: 'No issuer is identified for Quiet Town.',
      targetId: null,
    }));
    for (const line of inclusionLines(stack)) {
      expect(line.includes('Quiet Town') && line.includes('North Ministry')).toBe(false);
    }
    expect(stack.omitted.find((item) => item.id === 'place:north-country')).toBeUndefined();
    assertNoBindingClaim(stack);
  });

  test('preserves unknown links and does not invent a parent, a city, or a current endpoint', () => {
    const graph = mustAdmit({
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
      ],
      unknownRelationships: [
        { subjectId: 'place:unnamed-tract', about: 'name', reason: 'The fixture pin records no name.' },
        { subjectId: 'place:unnamed-tract', about: 'level', reason: 'The fixture pin records no level.' },
        { subjectId: 'place:unnamed-tract', about: 'administrative-parent', reason: 'The fixture pin records no parent.' },
        { subjectId: 'place:unnamed-tract', about: 'issuer', reason: 'The fixture pin records no issuer.' },
        { subjectId: 'place:unnamed-tract', about: 'boundary', reason: 'The fixture pin records no boundary.' },
      ],
    });
    const stack = joinAuthorityStack(graph, {
      placeId: 'place:unnamed-tract',
      asOf: AS_OF,
      nearbyPlaceIds: ['place:north-country'],
    });
    expect(stack.status).toBe('resolved');
    expect(stack.territorialIds).toEqual(['place:unnamed-tract']);
    expect(stack.issuerIds).toEqual([]);
    expect(stack.byBand.unclassified).toEqual(['place:unnamed-tract']);
    expect(stack.byBand.local).toEqual([]);
    expect(stack.candidates[0].name).toBeNull();
    expect(stack.candidates[0].levelKind).toBe('unknown');
    expect(stack.unknownLinks.map((link) => link.about)).toEqual([
      'administrative-parent',
      'boundary',
      'issuer',
      'level',
      'name',
    ]);
    expect(stack.unknownLinks.every((link) => link.targetId === null)).toBe(true);
    expect(JSON.stringify(stack.unknownLinks)).not.toContain('place:north-country');
    expect(stack.omitted).toContainEqual(expect.objectContaining({ id: 'place:north-country', reason: 'proximity' }));
    assertNoBindingClaim(stack);
  });

  test('does not treat an undecided or expired administrative parent as current', () => {
    const undecided = mustAdmit({
      nodes: [
        place('place:north-country', 'country', { name: 'North Country', roles: ['place', 'issuer'] }),
        place('place:north-province', 'province', {
          name: 'North Province',
          roles: ['place', 'issuer'],
          parentKnowledge: 'known',
        }),
        place('place:harbor-town', 'municipality', { name: 'Harbor Town', parentKnowledge: 'known' }),
      ],
      edges: [
        edge('edge:undecided-parent', 'administrative-containment', 'place:north-province', 'place:north-country', {
          valid: { start: unknownBound(), end: openEnd() },
        }),
        edge('edge:town-parent', 'administrative-containment', 'place:harbor-town', 'place:north-province'),
      ],
    });
    const unknownStack = joinAuthorityStack(undecided, { placeId: 'place:harbor-town', asOf: AS_OF });
    expect(unknownStack.territorialIds).toEqual(['place:harbor-town', 'place:north-province']);
    expect(unknownStack.unknownLinks).toContainEqual(expect.objectContaining({
      subjectId: 'place:north-province',
      about: 'administrative-parent',
      targetId: null,
      edgeId: 'edge:undecided-parent',
    }));
    const unknownLink = unknownStack.unknownLinks.find((link) => link.edgeId === 'edge:undecided-parent');
    expect(unknownLink?.reason).not.toContain('place:north-country');
    expect(unknownStack.uncertainty.join(' ')).not.toContain('no parent edge is current');

    const expired = mustAdmit({
      nodes: [
        place('place:north-country', 'country', { name: 'North Country', roles: ['place', 'issuer'] }),
        place('place:north-province', 'province', {
          name: 'North Province',
          roles: ['place', 'issuer'],
          parentKnowledge: 'known',
        }),
        place('place:harbor-town', 'municipality', { name: 'Harbor Town', parentKnowledge: 'known' }),
      ],
      edges: [
        edge('edge:province-parent', 'administrative-containment', 'place:north-province', 'place:north-country', {
          valid: { start: known('2000'), end: known('2010') },
        }),
        edge('edge:town-parent', 'administrative-containment', 'place:harbor-town', 'place:north-province'),
      ],
    });
    const expiredStack = joinAuthorityStack(expired, { placeId: 'place:harbor-town', asOf: AS_OF });
    expect(expiredStack.territorialIds).not.toContain('place:north-country');
    expect(expiredStack.uncertainty).toContain(
      'North Province is marked as having an administrative parent, but no parent edge is current at this date.',
    );
    assertNoBindingClaim(expiredStack);
  });

  test('keeps disputed parents out until their views are selected and then keeps every selected parent', () => {
    const graph = mustAdmit({
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
        { subjectId: 'place:border-valley', about: 'issuer', reason: 'No issuer is agreed for Border Valley.' },
      ],
    });

    const base = joinAuthorityStack(graph, { placeId: 'place:border-valley', asOf: AS_OF });
    expect(base.territorialIds).toEqual(['place:border-valley']);
    expect(base.issuerIds).toEqual([]);
    expect(base.candidates.find((candidate) => candidate.id === 'place:border-valley')?.issuer).toBeNull();
    expect(base.disputedHolds).toEqual([
      {
        subjectId: 'place:border-valley',
        about: 'administrative-parent',
        viewIds: ['view:claim-north', 'view:claim-south'],
        statement: 'Disputed administrative parents are not in this stack until their views are selected. No parent was chosen.',
      },
    ]);
    expect(base.unknownLinks).toContainEqual(expect.objectContaining({
      subjectId: 'place:border-valley',
      about: 'issuer',
      targetId: null,
    }));
    assertNoBindingClaim(base);

    const north = joinAuthorityStack(graph, {
      placeId: 'place:border-valley',
      asOf: AS_OF,
      viewIds: ['view:claim-north'],
    });
    expect(north.territorialIds).toEqual(['place:border-valley', 'place:claim-north']);
    expect(north.candidates.map((candidate) => candidate.id)).not.toContain('place:claim-south');
    expect(north.disputedHolds).toEqual([]);
    expect(north.uncertainty).toContain(
      'Disputed views view:claim-south were not selected. Their administrative parents were not added, and no parent was treated as the only parent.',
    );
    expect(north.candidates.find((candidate) => candidate.id === 'place:border-valley')?.issuer).toBeNull();

    const both = joinAuthorityStack(graph, {
      placeId: 'place:border-valley',
      asOf: AS_OF,
      viewIds: ['view:claim-north', 'view:claim-south'],
    });
    expect(both.byBand.national).toEqual(['place:claim-north', 'place:claim-south']);
    expect(both.territorialIds).toEqual(['place:border-valley', 'place:claim-north', 'place:claim-south']);
    expect(both.disputedHolds).toEqual([]);
    assertNoBindingClaim(both);
  });

  test('records a known absence when the source says there is no parent and no issuer', () => {
    const graph = mustAdmit({
      nodes: [
        place('place:harbor-town', 'municipality', {
          name: 'Harbor Town',
          parentKnowledge: 'none',
          issuerKnowledge: 'none',
          issuerIds: [],
        }),
      ],
    });
    const stack = joinAuthorityStack(graph, { placeId: 'place:harbor-town', asOf: AS_OF });
    expect(stack.territorialIds).toEqual(['place:harbor-town']);
    expect(stack.issuerIds).toEqual([]);
    expect(stack.unknownLinks).toEqual([]);
    expect(stack.knownAbsences).toEqual([
      {
        subjectId: 'place:harbor-town',
        about: 'administrative-parent',
        statement: 'Harbor Town has no administrative parent. No parent was invented.',
      },
      {
        subjectId: 'place:harbor-town',
        about: 'issuer',
        statement: 'Harbor Town lists no issuer ids. No issuer was invented.',
      },
    ]);
    assertNoBindingClaim(stack);
  });

  test('ignores inferred coverage that has no evidence and marks evidenced inferred coverage as inferred', () => {
    const admitted = mustAdmit({
      nodes: [
        place('place:north-country', 'country', { name: 'North Country', roles: ['place', 'issuer'] }),
        place('place:river-district', 'special-district', { name: 'River District' }),
        place('place:harbor-town', 'municipality', { name: 'Harbor Town', parentKnowledge: 'known' }),
      ],
      edges: [
        edge('edge:town-parent', 'administrative-containment', 'place:harbor-town', 'place:north-country'),
        edge('edge:town-river', 'territorial-coverage', 'place:harbor-town', 'place:river-district', {
          knowledge: 'inferred',
          evidence: ['Coverage inferred from the fixture charter.'],
        }),
      ],
    });
    const inferred = joinAuthorityStack(admitted, { placeId: 'place:harbor-town', asOf: AS_OF });
    expect(reasons('place:river-district', inferred, 'territory')).toEqual(['territorial-coverage']);
    expect(inferred.candidates.find((candidate) => candidate.id === 'place:river-district')?.territory?.inclusions[0].knowledge).toBe('inferred');
    expect(inferred.relationshipEvidence).toEqual(['Coverage inferred from the fixture charter.']);

    const stripped = mustAdmit({
      nodes: [
        place('place:north-country', 'country', { name: 'North Country', roles: ['place', 'issuer'] }),
        place('place:river-district', 'special-district', { name: 'River District' }),
        place('place:harbor-town', 'municipality', { name: 'Harbor Town', parentKnowledge: 'known' }),
      ],
      edges: [
        edge('edge:town-parent', 'administrative-containment', 'place:harbor-town', 'place:north-country'),
        edge('edge:town-river', 'territorial-coverage', 'place:harbor-town', 'place:river-district', {
          knowledge: 'inferred',
          evidence: ['Coverage inferred from the fixture charter.'],
        }),
      ],
    });
    const edgeToStrip = stripped.edges.find((item) => item.id === 'edge:town-river');
    if (!edgeToStrip) throw new Error('coverage edge missing');
    edgeToStrip.evidence = [];
    const dropped = joinAuthorityStack(stripped, { placeId: 'place:harbor-town', asOf: AS_OF });
    expect(dropped.candidates.map((candidate) => candidate.id)).not.toContain('place:river-district');
    expect(dropped.uncertainty).toContain('Inferred territorial-coverage edge edge:town-river has no evidence and was not used.');
    assertNoBindingClaim(dropped);
  });

  test('rejects queries that are not a current place and ignores proximity overflow', () => {
    const graph = harborGraph();
    const missing = joinAuthorityStack(graph, { placeId: 'place:missing', asOf: AS_OF });
    expect(missing.status).toBe('unresolved');
    expect(missing.uncertainty).toContain(UNCERTAINTY.noPlace);
    expect(missing.candidates).toEqual([]);

    const issuerOnly = joinAuthorityStack(graph, { placeId: 'issuer:north-ministry', asOf: AS_OF });
    expect(issuerOnly.status).toBe('unresolved');
    expect(issuerOnly.territorialIds).toEqual([]);
    expect(issuerOnly.omitted).toContainEqual(expect.objectContaining({ id: 'issuer:north-ministry', reason: 'not-a-place' }));
    expect(issuerOnly.uncertainty).toContain(UNCERTAINTY.notAPlace);

    const expiredPlace = mustAdmit({
      nodes: [
        place('place:harbor-town', 'municipality', {
          name: 'Harbor Town',
          parentKnowledge: 'known',
          valid: { start: known('2000'), end: known('2010') },
        }),
        place('place:north-country', 'country', { name: 'North Country', roles: ['place', 'issuer'] }),
      ],
      edges: [
        edge('edge:town-parent', 'administrative-containment', 'place:harbor-town', 'place:north-country'),
      ],
    });
    const expired = joinAuthorityStack(expiredPlace, { placeId: 'place:harbor-town', asOf: AS_OF });
    expect(expired.status).toBe('unresolved');
    expect(expired.candidates).toEqual([]);
    expect(expired.omitted).toContainEqual(expect.objectContaining({ id: 'place:harbor-town', reason: 'validity-outside' }));

    const invalid = joinAuthorityStack(graph, { placeId: 'place:harbor-town', asOf: 'yesterday' });
    expect(invalid.status).toBe('invalid-query');
    expect(invalid.candidates).toEqual([]);
    const badView = joinAuthorityStack(graph, {
      placeId: 'place:harbor-town',
      asOf: AS_OF,
      viewIds: ['view:missing'],
    });
    expect(badView.status).toBe('invalid-query');

    const nearby = Array.from({ length: AUTHORITY_LIMITS.maxNearby + 1 }, (_, index) => `place:near-${index}`);
    const overflow = joinAuthorityStack(graph, {
      placeId: 'place:harbor-town',
      asOf: AS_OF,
      nearbyPlaceIds: nearby,
    });
    expect(overflow.truncated).toBe(true);
    expect(overflow.uncertainty).toContain(UNCERTAINTY.incomplete);
    expect(overflow.omitted.filter((item) => item.reason === 'proximity')).toHaveLength(AUTHORITY_LIMITS.maxNearby);
    expect(overflow.candidates.map((candidate) => candidate.id)).not.toContain('place:near-0');

    const laws = Array.from({ length: AUTHORITY_LIMITS.maxLaws + 1 }, (_, index) => ({
      lawId: `law:extra-${index}`,
      territorialIds: ['place:other-town'],
      knowledge: 'known' as const,
    }));
    const lawOverflow = joinAuthorityStack(graph, { placeId: 'place:harbor-town', asOf: AS_OF, laws });
    expect(lawOverflow.truncated).toBe(true);
    expect(lawOverflow.checks.lawsConsidered).toBe(AUTHORITY_LIMITS.maxLaws);
    expect(lawOverflow.unmatchedLaws).toHaveLength(AUTHORITY_LIMITS.maxLaws);
    expect(lawOverflow.issuerIds).not.toContain('place:other-town');
  });
});

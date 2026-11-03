import { canonicalJson } from '../../src/lib/worldwide/data/identity';
import { APPLICABILITY, admitJurisdictionGraph, type JurisdictionGraph } from '../../src/lib/worldwide/jurisdiction/schema';
import { INCLUSION_PREFIX, joinAuthorityStack, type LawScopeInput } from '../../src/lib/worldwide/jurisdiction/authority';
import {
  FUSION_K,
  FUSION_RULE,
  fuseCrossIndexResults,
  type IndexHitList,
  type RankedHitInput,
} from '../../src/lib/worldwide/search/fusion';
import {
  PLAN_LIMITATIONS,
  SEARCH_CONCURRENCY,
  SEARCH_PLAN_SCHEMA,
  planPlaceSearch,
  type SearchSourceInput,
} from '../../src/lib/worldwide/search/planner';

const REV = 'a'.repeat(40);
const AS_OF = '2024-06-01';
const CHARTER = 'Pilot board charter recorded in the fixture pin.';

function known(value: string, precision: 'day' | 'month' | 'year' = 'year') {
  return { knowledge: 'known' as const, value, precision, source: 'fixture' };
}

function openEnd() {
  return { knowledge: 'open' as const, value: null, precision: null, source: 'fixture' };
}

function openValid(start = '2000') {
  return { start: known(start), end: openEnd() };
}

function boundary(boundaryId: string, extra: Record<string, unknown> = {}) {
  return {
    boundaryId,
    role: 'primary',
    geometryKnowledge: 'known',
    geometryRef: `artifact:${boundaryId}`,
    provenance: {
      sourceId: 'registry:fixture',
      sourceRevision: REV,
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
    roles?: Array<'place' | 'issuer'>;
    parentKnowledge?: string;
    issuerKnowledge?: string;
    issuerIds?: string[];
    boundaries?: unknown[];
  } = {},
) {
  const roles = opts.roles ?? ['place'];
  const issuerIds = opts.issuerIds ?? (roles.includes('issuer') ? [id] : []);
  return {
    id,
    roles,
    names: [{ text: opts.name ?? id, language: 'en', script: 'Latn' }],
    level: { kind: level },
    parentKnowledge: opts.parentKnowledge ?? 'none',
    issuerKnowledge: opts.issuerKnowledge ?? (issuerIds.length > 0 ? 'known' : 'none'),
    issuerIds,
    boundaries: opts.boundaries ?? (roles.includes('place') ? [boundary(`boundary:${id.slice(id.indexOf(':') + 1)}`)] : []),
    valid: openValid(),
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

function harborGraph(): JurisdictionGraph {
  const result = admitJurisdictionGraph({
    graphId: 'graph:fixture',
    sourceId: 'registry:fixture',
    sourceRevision: REV,
    publisherId: 'publisher:fixture',
    observedAt: '2024-06',
    nodes: [
      place('place:example-union', 'supranational', { name: 'Example Union', roles: ['place', 'issuer'] }),
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
      place('place:river-district', 'special-district', { name: 'River District', parentKnowledge: 'known' }),
      place('place:harbor-town', 'municipality', {
        name: 'Harbor Town',
        roles: ['place', 'issuer'],
        parentKnowledge: 'known',
        issuerIds: ['place:harbor-town', 'place:north-province'],
      }),
      place('place:other-town', 'municipality', { name: 'Other Town', parentKnowledge: 'known' }),
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
  if (!result.graph || result.quarantined.length > 0) {
    throw new Error(`fixture quarantined: ${result.quarantined.map((item) => item.reason).join(',')}`);
  }
  return result.graph;
}

function harborLaws(): LawScopeInput[] {
  return [
    {
      sectionId: 'section:town-code',
      sourceId: 'src:harbor',
      sourceRevision: REV,
      evidence: ['Section scope schedule.'],
      scope: {
        issuerIds: ['place:harbor-town'],
        territorialIds: ['place:harbor-town'],
        territorialLabels: [],
        knowledge: 'known',
        uncertainty: [],
      },
    },
  ];
}

function source(sourceId: string, authorityIds: string[], extra: Partial<SearchSourceInput> = {}): SearchSourceInput {
  return {
    sourceId,
    sourceRevision: REV,
    authorityIds,
    coverageState: 'known',
    decision: 'include',
    indexedRecords: 1,
    ...extra,
  };
}

function shard(indexId: string, kind: string, shardId: string, extra: Record<string, unknown> = {}) {
  return { indexId, kind, shardId, ...extra };
}

function harborSources(): SearchSourceInput[] {
  return [
    source('src:country', ['place:north-country'], {
      indexedRecords: 10,
      eligibleRecords: 999,
      capabilities: ['bm25', 'citation'],
      shards: [
        shard('idx:country:bm25', 'bm25', 'country-bm25-0'),
        shard('idx:country:cite', 'citation', 'country-cite-0'),
        shard('idx:country:bm25', 'bm25', 'evil', { relativePath: '../secret' }),
      ],
    }),
    source('src:province', ['place:north-province'], {
      indexedRecords: 4,
      capabilities: ['bm25'],
      shards: [shard('idx:province:bm25', 'bm25', 'province-bm25-0')],
    }),
    source('src:town', ['place:harbor-town'], {
      coverageState: 'partial',
      indexedRecords: 2,
      capabilities: ['bm25'],
      shards: [shard('idx:town:bm25', 'bm25', 'town-bm25-0')],
    }),
    source('src:pilot', ['issuer:pilot-board'], {
      indexedRecords: 1,
      capabilities: ['citation'],
      shards: [shard('idx:pilot:cite', 'citation', 'pilot-cite-0')],
    }),
    source('src:missing-town', ['place:harbor-town'], { coverageState: 'missing', indexedRecords: 0, shards: [] }),
    source('src:unknown-county', ['place:harbor-town'], { coverageState: 'unknown', shards: [] }),
    source('src:unavailable', ['place:harbor-town'], { coverageState: 'unavailable', shards: [] }),
    source('src:blocked', ['place:north-country'], { decision: 'blocked', shards: [shard('idx:blocked', 'bm25', 'blocked')] }),
    source('src:excluded', ['place:north-country'], { decision: 'exclude', shards: [shard('idx:excluded', 'bm25', 'excluded')] }),
    source('src:unpinned', ['place:north-country'], { sourceRevision: 'main', shards: [shard('idx:floating', 'bm25', 'floating')] }),
    source('src:unindexed', ['place:north-country'], { capabilities: ['metadata'], indexedRecords: 3, shards: [] }),
    source('src:union', ['place:example-union'], {
      indexedRecords: 100,
      shards: [shard('idx:union:bm25', 'bm25', 'union-bm25-0')],
    }),
    source('src:river', ['place:river-district'], { indexedRecords: 50, shards: [shard('idx:river', 'bm25', 'river')] }),
    source('src:other', ['place:other-town'], { indexedRecords: 40, shards: [shard('idx:other', 'bm25', 'other')] }),
  ];
}

function baseInput(extra: Record<string, unknown> = {}) {
  return {
    graph: harborGraph(),
    placeId: 'place:harbor-town',
    asOf: AS_OF,
    laws: harborLaws(),
    nearbyPlaceIds: ['place:other-town', 'place:north-province'],
    sources: harborSources(),
    ...extra,
  };
}

function hit(partial: RankedHitInput): RankedHitInput {
  return partial;
}

function list(partial: IndexHitList): IndexHitList {
  return partial;
}

function shuffle<T>(items: readonly T[], seed: number): T[] {
  const copy = [...items];
  let state = seed >>> 0;
  for (let index = copy.length - 1; index > 0; index -= 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const swap = state % (index + 1);
    const current = copy[index];
    copy[index] = copy[swap];
    copy[swap] = current;
  }
  return copy;
}

describe('place-scoped search', () => {
  test('selects the complete supported authority stack before ranking', () => {
    const graph = harborGraph();
    const stack = joinAuthorityStack(graph, {
      placeId: 'place:harbor-town',
      asOf: AS_OF,
      laws: harborLaws(),
      nearbyPlaceIds: ['place:other-town'],
    });
    const plan = planPlaceSearch(baseInput());

    expect(plan.schema).toBe(SEARCH_PLAN_SCHEMA);
    expect(plan.ranking).toBe('deferred');
    expect(plan.phase).toBe('stack-selected');
    expect(plan.stackResolvedBeforeRanking).toBe(true);
    expect(plan.applicability).toBe(APPLICABILITY);
    expect(plan.steps[0]).toBe('authority-stack');
    expect(plan.steps).toContain('strict-filters');
    expect(plan.steps.indexOf('authority-stack')).toBeLessThan(plan.steps.indexOf('source-selection'));
    expect(plan.stackCandidateIds).toEqual(stack.candidates.map((candidate) => candidate.id));
    expect(plan.byBand.national).toEqual(expect.arrayContaining(['place:north-country', 'issuer:north-ministry']));
    expect(plan.byBand.regional).toEqual(['place:north-province']);
    expect(plan.byBand.local).toEqual(['place:harbor-town']);
    expect(plan.byBand.special).toEqual(['issuer:pilot-board']);
    expect(plan.byBand.supranational).toEqual([]);
    expect(plan.stackCandidateIds).not.toContain('place:example-union');
    expect(plan.stackCandidateIds).not.toContain('place:river-district');
    expect(plan.stackCandidateIds).not.toContain('place:other-town');
    expect(plan.searchedSourceIds).toEqual(['src:country', 'src:pilot', 'src:province', 'src:town']);
    expect(plan.searchedSourceIds).not.toContain('src:union');
    expect(plan.searchedSourceIds).not.toContain('src:other');
    expect(plan.searchedSourceIds).not.toContain('src:river');
    for (const id of plan.searchedSourceIds) {
      const row = plan.sources.find((item) => item.sourceId === id);
      expect(row?.matchedCandidateIds.every((candidate) => plan.stackCandidateIds.includes(candidate))).toBe(true);
    }
    expect(plan.limitations).toEqual(PLAN_LIMITATIONS);
  });

  test('counts searched and missing sources without treating partial coverage as complete', () => {
    const plan = planPlaceSearch(baseInput());
    expect(plan.counts.searchedSources).toBe(4);
    expect(plan.counts.searchedCollections).toBe(4);
    expect(plan.counts.missingSources).toBe(1);
    expect(plan.counts.missingCollections).toBe(1);
    expect(plan.missingSourceIds).toEqual(['src:missing-town']);
    expect(plan.counts.partialSources).toBe(1);
    expect(plan.counts.unknownSources).toBe(1);
    expect(plan.counts.unavailableSources).toBe(1);
    expect(plan.counts.blockedSources).toBe(1);
    expect(plan.counts.excludedSources).toBe(1);
    expect(plan.counts.unpinnedSources).toBe(1);
    expect(plan.counts.unindexedSources).toBe(1);
    expect(plan.counts.outOfStackSources).toBe(3);
    expect(plan.counts.knownRecords).toBe(17);
    expect(plan.counts.knownRecordsComplete).toBe(true);
    expect(plan.counts.stackCandidatesWithoutSource).toBe(1);
    expect(plan.counts.stackCandidatesNotSearched).toBe(1);
    expect(plan.sources.find((item) => item.sourceId === 'src:unpinned')?.disposition).toBe('unpinned');
    expect(plan.sources.find((item) => item.sourceId === 'src:union')?.disposition).toBe('out-of-stack');
    const withNearby = planPlaceSearch(baseInput());
    const withoutNearby = planPlaceSearch(baseInput({ nearbyPlaceIds: [] }));
    expect(withNearby.selectionKey).toBe(withoutNearby.selectionKey);
    expect(withNearby.searchedSourceIds).toEqual(withoutNearby.searchedSourceIds);
  });

  test('isolates strict filters from ranking signals and from the stack', () => {
    const ordinance: SearchSourceInput = source('src:ordinance', ['place:harbor-town'], {
      instrumentKinds: ['ordinance'],
      indexedRecords: 8,
      shards: [shard('idx:ordinance', 'bm25', 'ordinance')],
    });
    const sources = [...harborSources(), ordinance];
    const parking = planPlaceSearch(baseInput({
      sources,
      filters: { instrumentKinds: ['statute'], query: 'parking', scoreWeight: 10 },
    }));
    const noise = planPlaceSearch(baseInput({
      sources,
      filters: { instrumentKinds: ['statute'], query: 'noise', citation: 'Art. 1' },
    }));

    expect(parking.selectionKey).toBe(noise.selectionKey);
    expect(parking.rankingSignals.query).toBe('parking');
    expect(noise.rankingSignals.query).toBe('noise');
    expect(noise.rankingSignals.citation).toBe('Art. 1');
    expect(parking.rankingSignals.mode).toBeNull();
    expect(parking.strictFilters.instrumentKinds).toEqual(['statute']);
    expect(parking.problems.some((problem) => problem.includes('scoreWeight'))).toBe(true);
    expect(parking.filteredSourceIds).toContain('src:ordinance');
    expect(parking.searchedSourceIds).not.toContain('src:ordinance');
    expect(parking.searchedSourceIds).toContain('src:town');
    expect(parking.stackCandidateIds).toEqual(noise.stackCandidateIds);
    expect(parking.byBand.national.length).toBeGreaterThan(0);

    const local = planPlaceSearch(baseInput({ filters: { bands: ['local'] } }));
    expect(local.stackCandidateIds).toEqual(parking.stackCandidateIds);
    expect(local.byBand.national).toEqual(parking.byBand.national);
    expect(local.searchedSourceIds).toEqual(['src:town']);
    expect(local.filteredSourceIds).toEqual(expect.arrayContaining(['src:country', 'src:province', 'src:pilot']));

    const townOnly = planPlaceSearch(baseInput({ filters: { placeIds: ['place:harbor-town', 'place:other-town'] } }));
    expect(townOnly.searchedSourceIds).toEqual(['src:town']);
    expect(townOnly.searchedSourceIds).not.toContain('src:other');
    expect(townOnly.problems.some((problem) => problem.includes('place:other-town') && problem.includes('was not added'))).toBe(true);
    expect(townOnly.stackCandidateIds).not.toContain('place:other-town');

    const fatal = planPlaceSearch(baseInput({ filters: { bands: ['galaxy'] } }));
    expect(fatal.status).toBe('invalid-query');
    expect(fatal.ranking).toBe('deferred');
    expect(fatal.stackResolvedBeforeRanking).toBe(true);
    expect(fatal.stackCandidateIds.length).toBeGreaterThan(0);
    expect(fatal.searchedSourceIds).toEqual([]);
    expect(fatal.counts.searchedSources).toBe(0);
    expect(fatal.counts.stackCandidates).toBe(fatal.stackCandidateIds.length);
  });

  test('batches the planned shards at a fixed concurrency and ignores unsafe paths', () => {
    const plan = planPlaceSearch(baseInput());
    const shardIds = plan.batches.flatMap((batch) => batch.requests.map((request) => request.shardId));
    expect(shardIds).toEqual([
      'country-bm25-0',
      'country-cite-0',
      'pilot-cite-0',
      'province-bm25-0',
      'town-bm25-0',
    ]);
    expect(shardIds).not.toContain('evil');
    expect(plan.batches).toHaveLength(2);
    expect(plan.batches[0].requests).toHaveLength(SEARCH_CONCURRENCY);
    expect(plan.batches[0].concurrency).toBe(SEARCH_CONCURRENCY);
    expect(plan.batches[1].requests).toHaveLength(1);
    expect(plan.batches[0].requests.every((request) => request.coverageState === 'known' || request.coverageState === 'partial')).toBe(true);

    const synthesized = planPlaceSearch(baseInput({
      sources: [source('src:synth', ['place:harbor-town'], { capabilities: ['vector', 'bm25'], shards: [] })],
    }));
    expect(synthesized.batches.flatMap((batch) => batch.requests.map((request) => request.shardId))).toEqual([
      'src:synth/bm25',
      'src:synth/vector',
    ]);
    expect(synthesized.counts.missingSources).toBe(0);
    expect(synthesized.counts.stackCandidatesWithoutSource).toBe(synthesized.stackCandidateIds.length - 1);
  });

  test('does not search when the place or the query is not a resolved stack', () => {
    const missing = planPlaceSearch(baseInput({ placeId: 'place:not-a-place' }));
    expect(missing.status).toBe('unresolved');
    expect(missing.ranking).toBe('deferred');
    expect(missing.searchedSourceIds).toEqual([]);
    expect(missing.counts.searchedSources).toBe(0);
    expect(missing.batches).toEqual([]);

    const fused = fuseCrossIndexResults(missing, []);
    expect(fused.status).toBe('invalid-plan');
    expect(fused.hits).toEqual([]);
    expect(fused.partialReasons).toContain('ranking-before-stack');
  });

  test('fuses cross-index ranks reproducibly and does not add raw scores', () => {
    const plan = planPlaceSearch(baseInput());
    const country: RankedHitInput[] = [
      hit({
        instrumentId: 'inst:a',
        textVersionId: 'tv:a',
        title: 'Housing statute',
        instrumentKind: 'statute',
        status: 'current',
        authorityIds: ['place:north-country'],
        rank: 2,
        score: 50,
      }),
      hit({
        instrumentId: 'inst:a',
        textVersionId: 'tv:a',
        title: 'Housing statute',
        instrumentKind: 'statute',
        status: 'current',
        authorityIds: ['place:north-country'],
        rank: 9,
        score: 1,
      }),
      hit({
        instrumentId: 'inst:b',
        textVersionId: 'tv:b',
        title: 'Benefit statute',
        instrumentKind: 'statute',
        status: 'current',
        authorityIds: ['place:north-country'],
        rank: 1,
        score: 0.2,
      }),
      hit({
        instrumentId: 'inst:g',
        textVersionId: 'tv:g',
        title: 'Loud statute',
        instrumentKind: 'statute',
        status: 'current',
        authorityIds: ['place:north-country'],
        rank: 3,
        score: 999,
      }),
      hit({ instrumentId: '', sectionId: '', rank: 1, score: 5 }),
      hit({ instrumentId: 'inst:float', textVersionId: 'tv:float', sourceRevision: 'main', rank: 1, score: 8 }),
    ];
    const citation: RankedHitInput[] = [
      hit({
        instrumentId: 'inst:a',
        textVersionId: 'tv:a',
        title: 'Housing statute',
        instrumentKind: 'statute',
        status: 'current',
        authorityIds: ['place:north-country'],
        rank: 2,
        score: 9,
      }),
    ];
    const town: RankedHitInput[] = [
      hit({
        instrumentId: 'inst:c',
        textVersionId: 'tv:c',
        title: 'Town ordinance',
        instrumentKind: 'ordinance',
        status: 'current',
        authorityIds: ['place:harbor-town'],
        rank: 1,
        score: 100,
      }),
    ];
    const lists: IndexHitList[] = [
      list({
        indexId: 'idx:country:bm25',
        sourceId: 'src:country',
        sourceRevision: REV,
        kind: 'bm25',
        shardId: 'country-bm25-0',
        hits: country,
      }),
      list({
        indexId: 'idx:country:cite',
        sourceId: 'src:country',
        sourceRevision: REV,
        kind: 'citation',
        shardId: 'country-cite-0',
        hits: citation,
      }),
      list({
        indexId: 'idx:town:bm25',
        sourceId: 'src:town',
        sourceRevision: REV,
        kind: 'bm25',
        shardId: 'town-bm25-0',
        hits: town,
      }),
      list({
        indexId: 'idx:union:bm25',
        sourceId: 'src:union',
        sourceRevision: REV,
        kind: 'bm25',
        shardId: 'union-bm25-0',
        hits: [hit({ instrumentId: 'inst:union', rank: 1, score: 1000, authorityIds: ['place:example-union'] })],
      }),
    ];

    const fused = fuseCrossIndexResults(plan, lists);
    expect(fused.status).toBe('ranked');
    expect(fused.k).toBe(FUSION_K);
    expect(fused.k).toBe(60);
    expect(fused.rawScoresIgnored).toBe(true);
    expect(fused.rule).toBe(FUSION_RULE);
    expect(fused.rule).toMatch(/not added/i);
    expect(fused.rule).toMatch(/Strict filters/i);
    expect(fused.hits.map((item) => item.identity.instrumentId)).toEqual(['inst:a', 'inst:b', 'inst:c', 'inst:g']);
    expect(fused.hits.map((item) => item.score)).toEqual(['1/31', '1/61', '1/61', '1/63']);
    expect(fused.hits[0].duplicateCount).toBe(3);
    expect(fused.hits[0].explanation.parts).toHaveLength(2);
    expect(fused.hits[0].explanation.parts.map((part) => part.rank)).toEqual([2, 2]);
    expect(fused.hits[0].explanation.rawScoresIgnored).toBe(true);
    expect(fused.hits[3].explanation.parts[0].ignoredRawScore).toBe(999);
    expect(fused.hits[3].rank).toBeGreaterThan(fused.hits[1].rank);
    expect(fused.hits[0].includedBecause.some((line) => line.startsWith(`${INCLUSION_PREFIX} `))).toBe(true);
    expect(fused.hits.every((item) => item.applicability === 'not-asserted')).toBe(true);
    expect(fused.hits.every((item) => item.includedBecause.every((line) => !/\b(applies|governs)\b/i.test(line)))).toBe(true);
    expect(fused.sourceCounts).toEqual({ searched: 4, missing: 1 });
    expect(fused.counts.searchedSources).toBe(4);
    expect(fused.counts.missingSources).toBe(1);
    expect(fused.counts.returnedMatches).toBe(4);
    expect(fused.counts.knownRecords).toBe(17);
    expect(fused.counts.partialSearch).toBe(true);
    expect(fused.partialReasons).toEqual(expect.arrayContaining(['partial-source', 'missing-source', 'stack-candidate-without-source']));
    expect(fused.counts.sourcesWithHits).toBe(2);
    expect(fused.counts.sourcesSearchedEmpty).toBe(2);
    expect(fused.quarantined.map((item) => item.reason)).toEqual(expect.arrayContaining([
      'missing-identity',
      'unpinned-revision',
      'source-not-searched',
    ]));
    expect(fused.hits.some((item) => item.identity.instrumentId === 'inst:union')).toBe(false);
    expect(fused.hits.some((item) => item.identity.instrumentId === 'inst:float')).toBe(false);

    const filtered = fuseCrossIndexResults(planPlaceSearch(baseInput({
      filters: { instrumentKinds: ['statute'] },
    })), lists);
    expect(filtered.hits.map((item) => item.identity.instrumentId)).toEqual(['inst:a', 'inst:b', 'inst:g']);
    expect(filtered.hits.some((item) => item.identity.instrumentId === 'inst:c')).toBe(false);
    expect(filtered.filtered.some((item) => item.reason === 'strict-instrument' && item.identity.includes('inst:c'))).toBe(true);
    expect(filtered.counts.filteredOut).toBe(1);
    expect(filtered.hits.every((item) => item.explanation.parts.every((part) => part.ignoredRawScore !== 100))).toBe(true);

    const projection = (value: ReturnType<typeof fuseCrossIndexResults>) => canonicalJson({
      hits: value.hits.map((item) => ({
        instrumentId: item.identity.instrumentId,
        score: item.score,
        rank: item.rank,
        parts: item.explanation.parts,
        otherVersionKeys: item.otherVersionKeys,
      })),
      filtered: value.filtered,
      quarantined: value.quarantined,
      searched: value.counts.searchedSources,
      missing: value.counts.missingSources,
    });
    const shuffled = lists.map((item, index) => list({
      ...item,
      hits: shuffle((item.hits as RankedHitInput[]) ?? [], 20 + index),
    }));
    const again = fuseCrossIndexResults(plan, shuffle(shuffled, 7));
    expect(projection(again)).toBe(projection(fused));

    const refused = fuseCrossIndexResults({ ...plan, ranking: 'immediate' } as typeof plan, lists);
    expect(refused.status).toBe('invalid-plan');
    expect(refused.hits).toEqual([]);
  });

  test('reconciles duplicate versions and keeps conflicting versions apart', () => {
    const plan = planPlaceSearch(baseInput());
    const versions = fuseCrossIndexResults(plan, [
      list({
        indexId: 'idx:country:cite',
        sourceId: 'src:country',
        sourceRevision: REV,
        kind: 'citation',
        shardId: 'country-cite-0',
        hits: [
          hit({
            instrumentId: 'inst:d',
            textVersionId: 'tv:1',
            bodySha256: 'hash-d',
            instrumentKind: 'statute',
            status: 'current',
            authorityIds: ['place:north-country'],
            rank: 1,
            score: 80,
            relations: [{
              relation: 'conflicting-version',
              sourceId: 'src:country',
              sourceRevision: REV,
              instrumentId: 'inst:d',
              textVersionId: 'tv:2',
              bodySha256: 'hash-d',
            }],
          }),
          hit({
            instrumentId: 'inst:d',
            textVersionId: 'tv:2',
            bodySha256: 'hash-d',
            instrumentKind: 'statute',
            status: 'historical',
            authorityIds: ['place:north-country'],
            rank: 2,
            score: 70,
          }),
        ],
      }),
    ]);
    expect(versions.hits).toHaveLength(2);
    expect(versions.hits.map((item) => item.score)).toEqual(['1/61', '1/62']);
    expect(versions.hits[0].versionGroupId).toBe(versions.hits[1].versionGroupId);
    expect(versions.hits[0].versionsInGroup).toBe(2);
    expect(versions.hits[0].otherVersionKeys).toEqual([versions.hits[1].versionKey]);
    expect(versions.hits[0].mirrors).toEqual([]);
    expect(versions.hits[0].identity.textVersionId).toBe('tv:1');
    expect(versions.hits[1].identity.textVersionId).toBe('tv:2');
    expect(versions.hits[0].explanation.parts).toHaveLength(1);

    const mirrors = fuseCrossIndexResults(plan, [
      list({
        indexId: 'idx:country:bm25',
        sourceId: 'src:country',
        sourceRevision: REV,
        kind: 'bm25',
        shardId: 'country-bm25-0',
        hits: [
          hit({
            instrumentId: 'inst:m',
            textVersionId: 'tv:m1',
            bodySha256: 'hash-m',
            instrumentKind: 'statute',
            status: 'current',
            authorityIds: ['place:north-country'],
            rank: 1,
            score: 4,
            relations: [{
              relation: 'equivalent-text',
              sourceId: 'src:province',
              sourceRevision: REV,
              instrumentId: 'inst:m',
              textVersionId: 'tv:m2',
              bodySha256: 'hash-m',
            }],
          }),
          hit({
            sourceId: 'src:province',
            instrumentId: 'inst:m',
            textVersionId: 'tv:m2',
            bodySha256: 'hash-m',
            rank: 4,
            score: 3,
          }),
        ],
      }),
      list({
        indexId: 'idx:province:bm25',
        sourceId: 'src:province',
        sourceRevision: REV,
        kind: 'bm25',
        shardId: 'province-bm25-0',
        hits: [
          hit({
            instrumentId: 'inst:m',
            textVersionId: 'tv:m2',
            bodySha256: 'hash-m',
            instrumentKind: 'statute',
            status: 'current',
            authorityIds: ['place:north-province'],
            rank: 1,
            score: 2,
            relations: [{
              relation: 'equivalent-text',
              sourceId: 'src:country',
              sourceRevision: REV,
              instrumentId: 'inst:m',
              textVersionId: 'tv:m1',
              bodySha256: 'hash-m',
            }],
          }),
        ],
      }),
    ]);
    expect(mirrors.hits).toHaveLength(1);
    expect(mirrors.hits[0].score).toBe('2/61');
    expect(mirrors.hits[0].duplicateCount).toBe(2);
    expect(mirrors.hits[0].identity.sourceId).toBe('src:country');
    expect(mirrors.hits[0].mirrors.map((item) => item.sourceId)).toEqual(['src:province']);
    expect(mirrors.hits[0].versionsInGroup).toBe(1);
    expect(mirrors.hits[0].explanation.parts.map((part) => `${part.indexId}:${part.rank}`).sort()).toEqual([
      'idx:country:bm25:1',
      'idx:province:bm25:1',
    ]);
    expect(mirrors.quarantined.some((item) => item.reason === 'source-not-searched')).toBe(true);

    const blocked = fuseCrossIndexResults(plan, [
      list({
        indexId: 'idx:country:bm25',
        sourceId: 'src:country',
        sourceRevision: REV,
        kind: 'bm25',
        shardId: 'country-bm25-0',
        hits: [
          hit({
            instrumentId: 'inst:m',
            textVersionId: 'tv:m1',
            bodySha256: 'hash-m',
            instrumentKind: 'statute',
            status: 'current',
            rank: 1,
            score: 4,
            relations: [
              {
                relation: 'equivalent-text',
                sourceId: 'src:province',
                sourceRevision: REV,
                instrumentId: 'inst:m',
                textVersionId: 'tv:m2',
                bodySha256: 'hash-m',
              },
              {
                relation: 'conflicting-version',
                sourceId: 'src:province',
                sourceRevision: REV,
                instrumentId: 'inst:m',
                textVersionId: 'tv:m2',
                bodySha256: 'hash-m',
              },
            ],
          }),
        ],
      }),
      list({
        indexId: 'idx:province:bm25',
        sourceId: 'src:province',
        sourceRevision: REV,
        kind: 'bm25',
        shardId: 'province-bm25-0',
        hits: [
          hit({
            instrumentId: 'inst:m',
            textVersionId: 'tv:m2',
            bodySha256: 'hash-m',
            instrumentKind: 'statute',
            status: 'current',
            rank: 1,
            score: 9,
          }),
        ],
      }),
    ]);
    expect(blocked.hits).toHaveLength(2);
    expect(blocked.hits.map((item) => item.score)).toEqual(['1/61', '1/61']);
    expect(blocked.hits[0].versionGroupId).toBe(blocked.hits[1].versionGroupId);
    expect(blocked.hits[0].versionGroupId.startsWith('versions:')).toBe(true);
    expect(blocked.hits[0].mirrors).toEqual([]);
  });

  test('treats unknown status as not current and keeps a supplied temporal scope off the score', () => {
    const plan = planPlaceSearch(baseInput({
      filters: { statuses: ['current'] },
    }));
    const fused = fuseCrossIndexResults(plan, [
      list({
        indexId: 'idx:town:bm25',
        sourceId: 'src:town',
        sourceRevision: REV,
        kind: 'bm25',
        shardId: 'town-bm25-0',
        hits: [
          hit({
            instrumentId: 'inst:unknown',
            textVersionId: 'tv:unknown',
            instrumentKind: 'ordinance',
            status: 'unknown',
            authorityIds: ['place:harbor-town'],
            rank: 1,
            score: 500,
          }),
          hit({
            instrumentId: 'inst:current',
            textVersionId: 'tv:current',
            instrumentKind: 'ordinance',
            status: 'current',
            authorityIds: ['place:harbor-town'],
            rank: 2,
            score: 1,
          }),
        ],
      }),
    ]);
    expect(fused.hits.map((item) => item.identity.instrumentId)).toEqual(['inst:current']);
    expect(fused.hits[0].status).toBe('current');
    expect(fused.filtered.map((item) => item.reason)).toEqual(['strict-status']);
    expect(plan.stackCandidateIds).toContain('place:north-country');

    const temporal = planPlaceSearch(baseInput({
      filters: { statuses: ['in-force'] },
      temporal: {
        places: [{ placeId: 'place:harbor-town', timeZone: 'UTC' }],
        boundaries: [{ boundaryId: 'boundary:harbor-town', timeZone: 'UTC' }],
        laws: [
          {
            lawId: 'law:live',
            sourceId: 'src:town',
            sourceRevision: REV,
            timeZone: 'UTC',
            territorialIds: ['place:harbor-town'],
            commencement: '2000-01-01',
            repeal: { knowledge: 'open', value: null, precision: null, source: 'fixture' },
            status: 'current',
          },
          {
            lawId: 'law:undated',
            sourceId: 'src:town',
            sourceRevision: REV,
            timeZone: 'UTC',
            territorialIds: ['place:harbor-town'],
            status: 'unknown',
          },
        ],
      },
    }));
    expect(temporal.status).toBe('stack-selected');
    expect(temporal.steps).toContain('temporal-scope');
    expect(temporal.stackCandidateIds).toContain('issuer:pilot-board');
    expect(temporal.temporal.currentLawIds).toEqual(['law:live']);
    expect(temporal.temporal.unknownNotCurrent).toBe(true);
    const timed = fuseCrossIndexResults(temporal, [
      list({
        indexId: 'idx:town:bm25',
        sourceId: 'src:town',
        sourceRevision: REV,
        kind: 'bm25',
        shardId: 'town-bm25-0',
        hits: [
          hit({
            instrumentId: 'inst:undated',
            textVersionId: 'tv:undated',
            lawId: 'law:undated',
            instrumentKind: 'ordinance',
            status: 'current',
            authorityIds: ['place:harbor-town'],
            rank: 1,
            score: 400,
          }),
          hit({
            instrumentId: 'inst:live',
            textVersionId: 'tv:live',
            lawId: 'law:live',
            instrumentKind: 'ordinance',
            status: 'current',
            authorityIds: ['place:harbor-town'],
            rank: 4,
            score: 1,
          }),
        ],
      }),
    ]);
    expect(timed.hits.map((item) => item.identity.instrumentId)).toEqual(['inst:live']);
    expect(timed.filtered.some((item) => item.reason === 'strict-status' && item.identity.includes('inst:undated'))).toBe(true);
    expect(timed.hits[0].explanation.formula).toBe('sum 1/(60+rank)');
  });
});

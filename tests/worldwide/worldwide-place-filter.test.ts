/**
 * Worldwide jurisdiction filter for a place origin.
 * A suggestion drops place ids. A manual origin keeps them.
 * Absent origin and channel leave today's place-id filter.
 * The screen does not fetch.
 */

import { jest } from '@jest/globals';
import { buildGlobalRouting, type GlobalCollectionInput } from '../../scripts/worldwide/build-global-routing';
import {
  executeProductionRetrieval,
  type ProductionCorpus,
  type ProductionPage,
} from '../../src/components/worldwide/SearchResults';
import { admitJurisdictionGraph, type JurisdictionGraph } from '../../src/lib/worldwide/jurisdiction/schema';
import type { LawScopeInput } from '../../src/lib/worldwide/jurisdiction/authority';
import type { IndexHitList, RankedHitInput } from '../../src/lib/worldwide/search/fusion';
import type { SearchSourceInput } from '../../src/lib/worldwide/search/planner';

const REV = 'a'.repeat(40);
const AS_OF = '2024-06-01';
const PLACE = 'place:harbor-town';
const COUNTRY = 'place:north-country';
const OTHER = 'country:00';

const fetchHost = globalThis as { fetch?: typeof fetch };
let originalFetch: typeof fetch | undefined;
const fetchSpy = jest.fn(() => Promise.reject(new Error('worldwide place filter must not fetch')));

beforeEach(() => {
  originalFetch = fetchHost.fetch;
  fetchSpy.mockClear();
  fetchHost.fetch = fetchSpy;
});

afterEach(() => {
  fetchHost.fetch = originalFetch;
});

function known(value: string, precision: 'day' | 'month' | 'year' = 'year') {
  return { knowledge: 'known' as const, value, precision, source: 'fixture' };
}

function openEnd() {
  return { knowledge: 'open' as const, value: null, precision: null, source: 'fixture' };
}

function openValid(start = '2000') {
  return { start: known(start), end: openEnd() };
}

function boundary(boundaryId: string) {
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
      place(COUNTRY, 'country', {
        name: 'North Country',
        roles: ['place', 'issuer'],
        parentKnowledge: 'known',
        issuerIds: [COUNTRY, 'issuer:north-ministry'],
      }),
      place('place:north-province', 'province', {
        name: 'North Province',
        roles: ['place', 'issuer'],
        parentKnowledge: 'known',
      }),
      place('place:river-district', 'special-district', { name: 'River District', parentKnowledge: 'known' }),
      place(PLACE, 'municipality', {
        name: 'Harbor Town',
        roles: ['place', 'issuer'],
        parentKnowledge: 'known',
        issuerIds: [PLACE, 'place:north-province'],
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
      edge('edge:country-union', 'administrative-containment', COUNTRY, 'place:example-union'),
      edge('edge:province-parent', 'administrative-containment', 'place:north-province', COUNTRY),
      edge('edge:river-parent', 'administrative-containment', 'place:river-district', COUNTRY),
      edge('edge:town-province', 'administrative-containment', PLACE, 'place:north-province', { exclusive: false }),
      edge('edge:town-river', 'administrative-containment', PLACE, 'place:river-district', { exclusive: false }),
      edge('edge:other-parent', 'administrative-containment', 'place:other-town', 'place:north-province'),
      edge('edge:town-coverage', 'territorial-coverage', PLACE, COUNTRY),
      edge('edge:town-delegated', 'delegated-authority', PLACE, 'place:north-province'),
      edge('edge:town-legal', 'legal-relationship', PLACE, 'issuer:pilot-board', { evidence: ['Pilot board charter recorded in the fixture pin.'] }),
    ],
  });
  if (!result.graph || result.quarantined.length > 0) {
    throw new Error(`fixture quarantined: ${result.quarantined.map((item) => item.reason).join(',')}`);
  }
  return result.graph;
}

function harborLaws(): LawScopeInput[] {
  return [{
    sectionId: 'section:town-code',
    sourceId: 'src:harbor',
    sourceRevision: REV,
    evidence: ['Section scope schedule.'],
    scope: {
      issuerIds: [PLACE],
      territorialIds: [PLACE],
      territorialLabels: [],
      knowledge: 'known',
      uncertainty: [],
    },
  }];
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

function shard(indexId: string, kind: string, shardId: string) {
  return { indexId, kind, shardId };
}

function harborSources(): SearchSourceInput[] {
  return [
    source('src:country', [COUNTRY], {
      indexedRecords: 2,
      capabilities: ['bm25'],
      shards: [shard('idx:country:bm25', 'bm25', 'country-bm25-0')],
    }),
    source('src:province', ['place:north-province'], {
      indexedRecords: 1,
      capabilities: ['bm25'],
      shards: [shard('idx:province:bm25', 'bm25', 'province-bm25-0')],
    }),
    source('src:town', [PLACE], {
      indexedRecords: 1,
      capabilities: ['bm25'],
      shards: [shard('idx:town:bm25', 'bm25', 'town-bm25-0')],
    }),
  ];
}

function law(partial: RankedHitInput): RankedHitInput {
  return {
    sourceRevision: REV,
    rank: 1,
    score: 1,
    language: 'en',
    instrumentKind: 'statute',
    status: 'current',
    ...partial,
  };
}

function indexList(indexId: string, sourceId: string, kind: string, shardId: string, hits: RankedHitInput[]): IndexHitList {
  return { indexId, sourceId, sourceRevision: REV, kind, shardId, hits };
}

function harborLists(): IndexHitList[] {
  return [
    indexList('idx:country:bm25', 'src:country', 'bm25', 'country-bm25-0', [
      law({
        instrumentId: 'inst:housing',
        textVersionId: 'tv:housing',
        title: 'Housing statute',
        issuerIds: [COUNTRY],
        authorityIds: [COUNTRY],
        bands: ['national'],
      }),
    ]),
    indexList('idx:province:bm25', 'src:province', 'bm25', 'province-bm25-0', []),
    indexList('idx:town:bm25', 'src:town', 'bm25', 'town-bm25-0', []),
  ];
}

const GRAPH = harborGraph();
const LAWS = harborLaws();

function collection(collectionId: string, jurisdictionId: string, documentId: string, title: string): GlobalCollectionInput {
  return {
    collectionId,
    jurisdictionId,
    sourceRevision: REV,
    coverage: 'known',
    indexedRecords: 1,
    languages: ['en'],
    terms: [{
      term: 'statute',
      hits: [{ documentId, score: 10, title, language: 'en', citation: 'Art. 1' }],
    }],
  };
}

function routingIndex() {
  const collections: GlobalCollectionInput[] = [
    collection('north-country', COUNTRY, 'doc-north', 'North statute'),
    collection('other-country', OTHER, 'doc-other', 'Other statute'),
  ];
  return buildGlobalRouting({ catalogRevision: REV, asOf: AS_OF, collections });
}

function corpus(): ProductionCorpus {
  return {
    graph: GRAPH,
    sources: harborSources(),
    indexes: harborLists(),
    laws: LAWS,
    nearbyPlaceIds: ['place:other-town', 'place:north-province'],
    globalIndex: routingIndex(),
  };
}

function jurisdictionIds(page: ProductionPage): string[] {
  return (page.worldwide?.hits ?? []).map((hit) => hit.jurisdictionId);
}

async function worldwide(place: string, origin?: 'suggestion' | 'manual') {
  return executeProductionRetrieval({
    corpus: corpus(),
    placeId: PLACE,
    asOf: AS_OF,
    query: 'statute',
    scope: 'worldwide',
    filters: { place },
    ...(origin ? { placeOrigin: origin } : {}),
  });
}

describe('worldwide place jurisdiction filter', () => {
  test('a suggestion origin with place ids leaves the worldwide jurisdiction filter empty', async () => {
    const page = await worldwide(COUNTRY, 'suggestion');
    expect(page.production).toContain('searchWorldwide');
    expect(page.worldwide).not.toBeNull();
    expect(jurisdictionIds(page).sort()).toEqual([COUNTRY, OTHER].sort());
    expect(page.worldwide?.walk.filteredShards).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('a manual origin keeps those place ids on the worldwide jurisdiction filter', async () => {
    const page = await worldwide(COUNTRY, 'manual');
    expect(page.production).toContain('searchWorldwide');
    expect(jurisdictionIds(page)).toEqual([COUNTRY]);
    expect(page.worldwide?.hits.map((hit) => hit.documentId)).toEqual(['doc-north']);
    expect(page.worldwide?.walk.filteredShards).toBeGreaterThan(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('omitting place origin and place channel keeps today\'s place-id filter', async () => {
    const page = await worldwide(COUNTRY);
    expect(page.production).toContain('searchWorldwide');
    expect(jurisdictionIds(page)).toEqual([COUNTRY]);
    expect(page.worldwide?.hits.map((hit) => hit.documentId)).toEqual(['doc-north']);
    expect(page.worldwide?.walk.filteredShards).toBeGreaterThan(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('a city-only place still forces the worldwide jurisdiction filter empty', async () => {
    const page = await worldwide(PLACE, 'manual');
    expect(jurisdictionIds(page).sort()).toEqual([COUNTRY, OTHER].sort());
    expect(page.worldwide?.walk.filteredShards).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

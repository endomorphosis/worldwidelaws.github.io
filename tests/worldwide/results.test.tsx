/**
 * Results, filters, and authority context for one place.
 * Retrieval goes through planPlaceSearch, fuseCrossIndexResults, and
 * searchWorldwide. The screen is exercised in jsdom.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { jest } from '@jest/globals';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { buildGlobalRouting, type GlobalCollectionInput } from '../../scripts/worldwide/build-global-routing';
import {
  highlightExact,
  executeProductionRetrieval,
  SearchResults,
  type ProductionCorpus,
  type SearchResultsProps,
} from '../../src/components/worldwide/SearchResults';
import {
  localizeInclusion,
  resultCopy,
  RESULT_STATE_IDS,
} from '../../src/components/worldwide/SearchFilters';
import { admitJurisdictionGraph, type JurisdictionGraph } from '../../src/lib/worldwide/jurisdiction/schema';
import type { LawScopeInput } from '../../src/lib/worldwide/jurisdiction/authority';
import type { IndexHitList, RankedHitInput } from '../../src/lib/worldwide/search/fusion';
import type { SearchPlan, SearchSourceInput } from '../../src/lib/worldwide/search/planner';

const REV = 'a'.repeat(40);
const CATALOG = 'b'.repeat(40);
const SAVED = 'c'.repeat(40);
const AS_OF = '2024-06-01';
const PLACE = 'place:harbor-town';
const CHARTER = 'Pilot board charter recorded in the fixture pin.';

type DisplayHit = RankedHitInput & {
  date?: string;
  snippet?: string;
  issuerName?: string;
  translationKind?: 'machine' | 'official';
  translationTitle?: string;
  translationText?: string;
  cachedRevision?: string;
  sourceUrl?: string;
};

const fetchHost = globalThis as { fetch?: typeof fetch };
let originalFetch: typeof fetch | undefined;
const onlineDescriptor = Object.getOwnPropertyDescriptor(window.navigator, 'onLine')
  ?? Object.getOwnPropertyDescriptor(Navigator.prototype, 'onLine');

function setOnline(online: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => online });
}

beforeEach(() => {
  originalFetch = fetchHost.fetch;
  fetchHost.fetch = jest.fn(() => Promise.reject(new Error('results must not fetch')));
});

afterEach(() => {
  fetchHost.fetch = originalFetch;
  if (onlineDescriptor) Object.defineProperty(window.navigator, 'onLine', onlineDescriptor);
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
  return [{
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
    source('src:country', ['place:north-country'], {
      indexedRecords: 10,
      eligibleRecords: 999,
      capabilities: ['bm25', 'citation'],
      shards: [
        shard('idx:country:bm25', 'bm25', 'country-bm25-0'),
        shard('idx:country:cite', 'citation', 'country-cite-0'),
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

function searchedTrio(): SearchSourceInput[] {
  return [
    source('src:country', ['place:north-country'], {
      indexedRecords: 2,
      capabilities: ['bm25'],
      shards: [shard('idx:country:bm25', 'bm25', 'country-bm25-0')],
    }),
    source('src:province', ['place:north-province'], {
      indexedRecords: 1,
      capabilities: ['bm25'],
      shards: [shard('idx:province:bm25', 'bm25', 'province-bm25-0')],
    }),
    source('src:town', ['place:harbor-town'], {
      indexedRecords: 1,
      capabilities: ['bm25'],
      shards: [shard('idx:town:bm25', 'bm25', 'town-bm25-0')],
    }),
  ];
}

function law(partial: DisplayHit): DisplayHit {
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

const HOUSING = law({
  instrumentId: 'inst:housing',
  sectionId: 'section:housing',
  textVersionId: 'tv:housing',
  title: 'Housing statute',
  officialCitation: 'North Country Housing Act § 1',
  issuerIds: ['place:north-country'],
  issuerName: 'North Country',
  authorityIds: ['place:north-country'],
  bands: ['national'],
  topics: ['housing'],
  date: '2020-01-01',
  snippet: 'The Housing statute sets the rule.',
  translationKind: 'machine',
  translationTitle: 'Housing law',
  translationText: 'The housing law sets the rule.',
});

const STATUTES_ONLY = law({
  instrumentId: 'inst:statutes',
  textVersionId: 'tv:statutes',
  title: 'Statutes only',
  officialCitation: 'Notice 9',
  issuerName: 'North Country',
  issuerIds: ['place:north-country'],
  authorityIds: ['place:north-country'],
  bands: ['national'],
  topics: ['meta'],
  instrumentKind: 'notice',
  date: '2021-02-02',
  snippet: 'Statutes only are listed here.',
});

const REGIONAL = law({
  instrumentId: 'inst:noise',
  textVersionId: 'tv:noise',
  title: 'Regional noise regulation',
  officialCitation: 'North Province Noise Rule 2',
  issuerName: 'North Province',
  issuerIds: ['place:north-province'],
  authorityIds: ['place:north-province'],
  bands: ['regional'],
  topics: ['noise'],
  instrumentKind: 'regulation',
  date: '2019-03-03',
});

const LOCAL = law({
  instrumentId: 'inst:harbor',
  textVersionId: 'tv:harbor',
  title: 'Harbor ordinance',
  officialCitation: 'Harbor Town Ordinance 3',
  issuerName: 'Harbor Town',
  issuerIds: ['place:harbor-town'],
  authorityIds: ['place:harbor-town'],
  bands: ['local'],
  topics: ['streets'],
  instrumentKind: 'ordinance',
  date: '2018-04-04',
});

function indexList(indexId: string, sourceId: string, kind: string, shardId: string, hits: DisplayHit[]): IndexHitList {
  return { indexId, sourceId, sourceRevision: REV, kind, shardId, hits };
}

function harborLists(hits: { country?: DisplayHit[]; province?: DisplayHit[]; town?: DisplayHit[] } = {}): IndexHitList[] {
  return [
    indexList('idx:country:bm25', 'src:country', 'bm25', 'country-bm25-0', hits.country ?? [HOUSING, STATUTES_ONLY]),
    indexList('idx:province:bm25', 'src:province', 'bm25', 'province-bm25-0', hits.province ?? [REGIONAL]),
    indexList('idx:town:bm25', 'src:town', 'bm25', 'town-bm25-0', hits.town ?? [LOCAL]),
  ];
}

const GRAPH = harborGraph();
const LAWS = harborLaws();

function corpus(extra: Partial<ProductionCorpus> = {}): ProductionCorpus {
  return {
    graph: GRAPH,
    sources: harborSources(),
    indexes: harborLists(),
    laws: LAWS,
    nearbyPlaceIds: ['place:other-town', 'place:north-province'],
    ...extra,
  };
}

function mount(props: Partial<SearchResultsProps> = {}) {
  return render(
    <SearchResults
      corpus={corpus()}
      placeId={PLACE}
      asOf={AS_OF}
      query="Housing statute"
      {...props}
    />,
  );
}

function surface(): HTMLElement {
  const node = document.querySelector('.wwl-results-surface');
  if (!(node instanceof HTMLElement)) throw new Error('missing results surface');
  return node;
}

function main(): HTMLElement {
  const node = document.getElementById('wwl-main');
  if (!node) throw new Error('missing results main');
  return node;
}

async function openFilters(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Filters' }));
}

describe('production retrieval', () => {
  test('keeps national law when the filter names only the city', async () => {
    const page = await executeProductionRetrieval({
      corpus: corpus(),
      placeId: PLACE,
      asOf: AS_OF,
      query: 'Housing statute',
      filters: { level: 'municipal', place: PLACE },
    });
    expect(page.production).toEqual(['joinAuthorityStack', 'planPlaceSearch', 'fuseCrossIndexResults']);
    expect(page.plan.strictFilters.bands).toEqual([]);
    expect(page.plan.strictFilters.placeIds).toEqual(expect.arrayContaining(['place:north-country', 'place:north-province', PLACE]));
    expect(page.plan.searchedSourceIds).toEqual(expect.arrayContaining(['src:country', 'src:town']));
    expect(page.rows.map((row) => row.instrumentId)).toEqual(page.fusion.hits.map((hit) => hit.identity.instrumentId));
    expect(page.rows.map((row) => row.title)).toEqual(expect.arrayContaining(['Housing statute', 'Harbor ordinance']));
    expect(page.plan.rankingSignals.query).toBe('Housing statute');

    const national = await executeProductionRetrieval({
      corpus: corpus(),
      placeId: PLACE,
      asOf: AS_OF,
      query: 'Housing statute',
      filters: { level: 'national' },
    });
    expect(national.plan.strictFilters.bands).toEqual(['national']);
    expect(national.plan.searchedSourceIds).toEqual(['src:country']);
    expect(national.rows.map((row) => row.title)).toContain('Housing statute');
    expect(national.rows.map((row) => row.title)).not.toContain('Harbor ordinance');

    const open = await executeProductionRetrieval({
      corpus: corpus(),
      placeId: PLACE,
      asOf: AS_OF,
      query: 'Housing statute',
    });
    const partial = await executeProductionRetrieval({
      corpus: corpus(),
      placeId: PLACE,
      asOf: AS_OF,
      query: 'noise',
      filters: { place: 'place:har' },
    });
    expect(partial.plan.strictFilters.placeIds).toEqual([]);
    expect(partial.plan.searchedSourceIds).toContain('src:country');
    expect(partial.plan.selectionKey).toBe(open.plan.selectionKey);
    expect(partial.plan.rankingSignals.query).toBe('noise');
    expect(page.plan.selectionKey).not.toBe(open.plan.selectionKey);
  });

  test('passes a worldwide query through searchWorldwide without a city jurisdiction allow-list', async () => {
    const globalIndex = routingIndex();
    const kept = await executeProductionRetrieval({
      corpus: corpus({ globalIndex }),
      placeId: PLACE,
      asOf: AS_OF,
      query: 'statute',
      scope: 'worldwide',
      filters: { place: PLACE, language: 'en' },
    });
    expect(kept.production).toContain('searchWorldwide');
    expect(kept.production).toContain('planPlaceSearch');
    expect(kept.rows.map((row) => row.title)).toContain('National statute');
    expect(kept.worldwide?.hits.length).toBeGreaterThan(0);
    expect(kept.worldwide?.claimsAllWorldwideResults).toBe(false);

    const narrowed = await executeProductionRetrieval({
      corpus: corpus({ globalIndex }),
      placeId: PLACE,
      asOf: AS_OF,
      query: 'statute',
      scope: 'worldwide',
      filters: { place: 'place:north-country' },
    });
    expect(narrowed.worldwide).not.toBeNull();
    expect(narrowed.worldwide?.hits).toEqual([]);
    expect(narrowed.rows.map((row) => row.title)).not.toContain('National statute');

    const french = await executeProductionRetrieval({
      corpus: corpus({ globalIndex }),
      placeId: PLACE,
      asOf: AS_OF,
      query: 'statute',
      scope: 'worldwide',
      filters: { language: 'fr' },
    });
    expect(french.rows).toEqual([]);
  });
});

describe('search results', () => {
  test('shows national, regional, and local authority with the original record', async () => {
    mount();
    const housing = await screen.findByRole('link', { name: 'Housing statute' });
    const results = main();
    const stack = document.querySelector('aside.wwl-stack');
    if (!stack) throw new Error('missing stack');

    expect(within(stack).getByText('North Country')).toBeInTheDocument();
    expect(within(stack).getByText('North Province')).toBeInTheDocument();
    expect(within(stack).getByText('Harbor Town')).toBeInTheDocument();
    expect(within(stack).queryByText('Example Union')).not.toBeInTheDocument();
    expect(within(stack).queryByText('River District')).not.toBeInTheDocument();
    expect(within(stack).queryByText('Other Town')).not.toBeInTheDocument();
    expect(within(stack).getByRole('heading', { name: 'Laws and sources for this place' })).toBeInTheDocument();

    expect(results.querySelectorAll('ol')).toHaveLength(1);
    expect(results.querySelectorAll('h3')).toHaveLength(0);
    const list = results.querySelector('ol');
    expect(list?.contains(housing)).toBe(true);
    expect(list?.contains(within(results).getByRole('link', { name: 'Regional noise regulation' }))).toBe(true);
    expect(list?.contains(within(results).getByRole('link', { name: 'Harbor ordinance' }))).toBe(true);

    const item = housing.closest('.wwl-result');
    if (!(item instanceof HTMLElement)) throw new Error('missing housing result');
    expect(item).toHaveAttribute('data-band', 'national');
    expect(item).toHaveAttribute('data-translation', 'shown');
    expect(housing).toHaveAttribute('href', expect.stringContaining('/#/law/inst%3Ahousing'));
    expect(housing.getAttribute('href')).toContain(`revision=${REV}`);
    expect(housing.getAttribute('href')).toContain('section=section%3Ahousing');
    expect(housing).not.toHaveAttribute('target');
    expect(housing.textContent).toBe('Housing statute');
    expect(housing.textContent).not.toContain('Original title');
    expect(item.querySelector('[data-field="original-title"] .wwl-badge')).toHaveTextContent('Original title');
    expect([...item.querySelectorAll('mark.wwl-mark')].map((mark) => mark.textContent)).toEqual(['Housing statute', 'Housing statute']);
    expect(item.querySelector('[data-field="citation"]')).toHaveTextContent('North Country Housing Act § 1');
    expect(item.querySelector('[data-field="issuer"]')).toHaveTextContent('North Country');
    expect(item.querySelector('[data-field="date"]')).toHaveTextContent('2020-01-01');
    expect(item.querySelector('[data-field="status"]')).toHaveTextContent('current');
    expect(item.querySelector('[data-field="source"] .wwl-embed')).toHaveTextContent('src:country');
    expect(item.querySelector('[data-field="source"] .wwl-identifier')).toHaveTextContent(REV);
    expect(item.textContent).toMatch(/Included because/);
    expect(within(item).getByText('Machine translation')).toBeInTheDocument();
    expect(within(item).getByText('Housing law')).toBeInTheDocument();

    const statutes = screen.getByRole('link', { name: 'Statutes only' }).closest('.wwl-result');
    expect(statutes?.querySelector('mark')).toBeNull();

    expect(document.querySelector('.wwl-counts')).toHaveTextContent('Searched 4 · Remaining 4');
    expect(surface()).toHaveAttribute('data-state', 'partially-loaded');
    expect(surface()).toHaveAttribute('data-loading', 'false');
    expect(surface()).toHaveAttribute('data-production', 'joinAuthorityStack planPlaceSearch fuseCrossIndexResults');
    expect(surface()).toHaveAttribute('data-reader', 'closed');
    expect(surface()).toHaveAttribute('data-map', 'closed');
    expect(surface()).toHaveAttribute('data-model', 'idle');
    expect(surface()).toHaveAttribute('data-compare', 'closed');
    expect(surface()).toHaveAttribute('data-ranking-query', 'Housing statute');
    expect(surface()).toHaveAttribute('data-group', 'off');
    expect(screen.getAllByText('These are the results retrieved so far. This is not all worldwide results.').length).toBeGreaterThan(0);
    expect(screen.getByText('src:missing-town')).toBeInTheDocument();
    expect(document.querySelector('[data-applicability="not-asserted"]')).toHaveTextContent('This choice does not decide that a law applies.');
    expect(screen.getByText('This authority stack does not decide what binds conduct at this place.')).toBeInTheDocument();
    expect(screen.getByText(/As of 2024-06-01/)).toBeInTheDocument();

    const live = document.querySelector('.wwl-live');
    if (!(live instanceof HTMLElement)) throw new Error('missing live region');
    expect(live).toHaveAttribute('role', 'status');
    expect(live).toHaveAttribute('aria-live', 'polite');
    expect(live).toHaveAttribute('aria-atomic', 'true');
    expect(live.hasAttribute('hidden')).toBe(false);
    expect(live.textContent).toMatch(/Searched 4/);
    const css = readFileSync(join(process.cwd(), 'src/styles/worldwide.css'), 'utf8');
    const rule = css.slice(css.indexOf('.wwl-live'), css.indexOf('}', css.indexOf('.wwl-live')));
    expect(rule).not.toMatch(/display\s*:\s*none/);
    expect(fetchHost.fetch).not.toHaveBeenCalled();
  });

  test('a municipal or city filter still shows the national statute', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByRole('link', { name: 'Housing statute' });
    await openFilters(user);
    const level = screen.getByLabelText('Jurisdiction level');
    await user.selectOptions(level, 'municipal');
    await waitFor(() => {
      expect(surface()).toHaveAttribute('data-strict-bands', 'none');
      expect(surface().getAttribute('data-searched-sources')).toContain('src:country');
    });
    expect(screen.getByRole('link', { name: 'Housing statute' })).toBeInTheDocument();
    expect(document.activeElement).toBe(level);

    const placeField = screen.getByLabelText('Place');
    await user.type(placeField, PLACE);
    await waitFor(() => {
      expect(surface().getAttribute('data-strict-places')).toContain('place:north-country');
      expect(surface().getAttribute('data-strict-places')).toContain(PLACE);
    });
    expect(screen.getByRole('link', { name: 'Housing statute' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Harbor ordinance' })).toBeInTheDocument();
    expect(document.activeElement).toBe(placeField);
    expect(surface()).toHaveAttribute('data-strict-bands', 'none');
  });

  test('an explicit national filter narrows the searched sources', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByRole('link', { name: 'Harbor ordinance' });
    await openFilters(user);
    const level = screen.getByLabelText('Jurisdiction level');
    await user.selectOptions(level, 'national');
    await waitFor(() => {
      expect(surface()).toHaveAttribute('data-strict-bands', 'national');
      expect(surface()).toHaveAttribute('data-searched-sources', 'src:country');
    });
    expect(screen.getByRole('link', { name: 'Housing statute' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Harbor ordinance' })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(level);
  });

  test('a topic filter reruns retrieval and leaves focus on the field', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByRole('link', { name: 'Regional noise regulation' });
    await openFilters(user);
    const topic = screen.getByLabelText('Topic');
    await user.type(topic, 'housing');
    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Housing statute' })).toBeInTheDocument();
      expect(Number(surface().getAttribute('data-filtered'))).toBeGreaterThan(0);
    });
    expect(screen.queryByRole('link', { name: 'Regional noise regulation' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Harbor ordinance' })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(topic);
    expect(surface()).toHaveAttribute('data-strict-topics', 'housing');
  });

  test('date status is a strict retrieval filter', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByRole('link', { name: 'Housing statute' });
    await openFilters(user);
    const status = screen.getByLabelText('Date or status');
    await user.selectOptions(status, 'historical');
    await waitFor(() => {
      expect(surface()).toHaveAttribute('data-state', 'no-matches');
    });
    expect(screen.getByText('No matches in the collections that were searched.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Housing statute' })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(status);
  });

  test('group by level is display only', async () => {
    const user = userEvent.setup();
    const loadIndexes = jest.fn(async () => harborLists());
    mount({ loadIndexes, corpus: corpus({ indexes: [] }) });
    await screen.findByRole('link', { name: 'Housing statute' });
    const calls = loadIndexes.mock.calls.length;
    expect(main().querySelectorAll('h3')).toHaveLength(0);
    expect(main().querySelectorAll('ol')).toHaveLength(1);
    await openFilters(user);
    await user.click(screen.getByRole('checkbox', { name: 'Group by level' }));
    expect(surface()).toHaveAttribute('data-group', 'on');
    expect(within(main()).getByRole('heading', { level: 3, name: 'National' })).toBeInTheDocument();
    expect(within(main()).getByRole('heading', { level: 3, name: 'Municipal' })).toBeInTheDocument();
    expect(within(main()).getByRole('link', { name: 'Harbor ordinance' })).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole('checkbox', { name: 'Group by level' }));
    await waitFor(() => {
      expect(loadIndexes).toHaveBeenCalledTimes(calls);
    });
  });

  test('cancelling before a response settles leaves the list empty', async () => {
    const user = userEvent.setup();
    let release: (lists: readonly IndexHitList[]) => void = () => {};
    const pending = new Promise<readonly IndexHitList[]>((resolve) => {
      release = resolve;
    });
    const loadIndexes = jest.fn((_plan: SearchPlan, _signal: AbortSignal) => pending);
    mount({ loadIndexes, corpus: corpus({ indexes: [] }), query: 'late' });
    await user.click(await screen.findByRole('button', { name: 'Cancel search' }));
    expect(await screen.findByText('The search was cancelled.')).toBeInTheDocument();
    expect(screen.getByText('Start a new search. The cancelled results stay off the page.')).toBeInTheDocument();
    expect(surface()).toHaveAttribute('data-state', 'cancelled-query');
    release(harborLists({
      country: [law({
        instrumentId: 'inst:late',
        textVersionId: 'tv:late',
        title: 'Late statute',
        authorityIds: ['place:north-country'],
        bands: ['national'],
        issuerName: 'North Country',
        officialCitation: 'Late Act',
        date: '2022-01-01',
      })],
      province: [],
      town: [],
    }));
    await waitFor(() => {
      expect(Number(surface().getAttribute('data-stale-ignored'))).toBeGreaterThanOrEqual(1);
    });
    expect(screen.queryByRole('link', { name: 'Late statute' })).not.toBeInTheDocument();
    expect(main().querySelector('a')).toBeNull();
    expect(document.activeElement?.closest('.wwl-result')).toBeNull();
  });

  test('cancelling a later search keeps the settled list', async () => {
    const user = userEvent.setup();
    let release: (lists: readonly IndexHitList[]) => void = () => {};
    const pending = new Promise<readonly IndexHitList[]>((resolve) => {
      release = resolve;
    });
    const loadIndexes = jest.fn(() => pending);
    const view = mount();
    await screen.findByRole('link', { name: 'Housing statute' });
    view.rerender(
      <SearchResults
        corpus={corpus()}
        placeId={PLACE}
        asOf={AS_OF}
        query="second look"
        loadIndexes={loadIndexes}
      />,
    );
    await user.click(await screen.findByRole('button', { name: 'Cancel search' }));
    expect(surface()).toHaveAttribute('data-state', 'cancelled-query');
    release(harborLists({
      country: [law({
        instrumentId: 'inst:late',
        textVersionId: 'tv:late',
        title: 'Late statute',
        authorityIds: ['place:north-country'],
        bands: ['national'],
      })],
    }));
    await waitFor(() => {
      expect(Number(surface().getAttribute('data-stale-ignored'))).toBeGreaterThanOrEqual(1);
    });
    expect(screen.getByRole('link', { name: 'Housing statute' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Late statute' })).not.toBeInTheDocument();
    expect(document.activeElement?.closest('.wwl-result')).toBeNull();
  });

  test('an older response does not replace a newer one', async () => {
    let releaseFirst: (lists: readonly IndexHitList[]) => void = () => {};
    const first = new Promise<readonly IndexHitList[]>((resolve) => {
      releaseFirst = resolve;
    });
    const secondLists = harborLists({
      country: [law({
        instrumentId: 'inst:second',
        textVersionId: 'tv:second',
        title: 'Second statute',
        authorityIds: ['place:north-country'],
        bands: ['national'],
        issuerName: 'North Country',
        officialCitation: 'Second Act',
        date: '2021-01-01',
      })],
      province: [],
      town: [],
    });
    const loadIndexes = jest.fn((plan: SearchPlan) => {
      if (plan.rankingSignals.query === 'first statute') return first;
      return Promise.resolve(secondLists);
    });
    const view = mount({ loadIndexes, corpus: corpus({ indexes: [] }), query: 'first statute' });
    await screen.findByRole('button', { name: 'Cancel search' });
    view.rerender(
      <SearchResults
        corpus={corpus({ indexes: [] })}
        placeId={PLACE}
        asOf={AS_OF}
        query="second statute"
        loadIndexes={loadIndexes}
      />,
    );
    expect(await screen.findByRole('link', { name: 'Second statute' })).toBeInTheDocument();
    releaseFirst(harborLists({
      country: [law({
        instrumentId: 'inst:first',
        textVersionId: 'tv:first',
        title: 'First statute',
        authorityIds: ['place:north-country'],
        bands: ['national'],
      })],
      province: [],
      town: [],
    }));
    await waitFor(() => {
      expect(Number(surface().getAttribute('data-stale-ignored'))).toBeGreaterThanOrEqual(1);
    });
    expect(screen.getByRole('link', { name: 'Second statute' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'First statute' })).not.toBeInTheDocument();
  });

  test('an empty query does not retrieve', async () => {
    const loadIndexes = jest.fn(async () => harborLists());
    mount({ query: '', loadIndexes });
    expect(surface()).toHaveAttribute('data-state', 'no-query');
    expect(surface()).toHaveAttribute('data-production', 'idle');
    expect(surface()).toHaveAttribute('data-plan-status', 'idle');
    expect(screen.getAllByText('Enter a question, citation, or identifier. An empty search is not a result about the law.').length).toBeGreaterThan(0);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(document.querySelector('aside.wwl-stack')).toHaveTextContent('North Country');
    expect(document.querySelector('aside.wwl-stack')).toHaveTextContent('Harbor Town');
    expect(loadIndexes).not.toHaveBeenCalled();
  });

  test('a missing municipal collection stays visible beside national law', async () => {
    mount({
      corpus: corpus({
        sources: [
          source('src:country', ['place:north-country'], {
            indexedRecords: 2,
            capabilities: ['bm25'],
            shards: [shard('idx:country:bm25', 'bm25', 'country-bm25-0')],
          }),
          source('src:province', ['place:north-province'], {
            indexedRecords: 1,
            capabilities: ['bm25'],
            shards: [shard('idx:province:bm25', 'bm25', 'province-bm25-0')],
          }),
          source('src:missing-town', [PLACE], { coverageState: 'missing', indexedRecords: 0, shards: [] }),
        ],
        indexes: harborLists({ town: [] }),
      }),
    });
    expect(await screen.findByRole('link', { name: 'Housing statute' })).toBeInTheDocument();
    expect(surface()).toHaveAttribute('data-state', 'missing-municipal-coverage');
    const gap = 'No municipal collection is in the catalog for this place. That is a coverage gap, not a finding that no local law exists.';
    expect(screen.getAllByText(gap).length).toBeGreaterThan(0);
    const cell = document.getElementById('wwl-municipal-coverage');
    expect(cell).toHaveAttribute('data-level', 'municipal');
    expect(cell).toHaveAttribute('data-coverage', 'missing');
    expect(cell).toHaveClass('wwl-coverage');
  });

  test('unknown issuer, date, citation, and status stay on the row', async () => {
    mount({
      corpus: corpus({
        sources: searchedTrio(),
        indexes: harborLists({
          country: [law({
            instrumentId: 'inst:unknown',
            textVersionId: 'tv:unknown',
            title: 'Untitled measure',
            authorityIds: [],
            issuerIds: [],
            bands: ['national'],
            status: undefined,
            officialCitation: undefined,
          })],
          province: [],
          town: [],
        }),
      }),
    });
    const link = await screen.findByRole('link', { name: 'Untitled measure' });
    const item = link.closest('.wwl-result');
    if (!(item instanceof HTMLElement)) throw new Error('missing unknown result');
    expect(surface()).toHaveAttribute('data-state', 'source-or-status-unknown');
    expect(item.querySelector('[data-field="issuer"]')).toHaveTextContent('unknown');
    expect(item.querySelector('[data-field="date"]')).toHaveTextContent('unknown');
    expect(item.querySelector('[data-field="citation"]')).toHaveTextContent('unknown');
    expect(item.querySelector('[data-field="status"]')).toHaveTextContent('Status unknown');
  });

  test('historical text keeps its date', async () => {
    mount({
      corpus: corpus({
        sources: searchedTrio(),
        indexes: harborLists({
          country: [law({
            instrumentId: 'inst:old',
            textVersionId: 'tv:old',
            title: 'Former housing statute',
            officialCitation: 'Former Act § 2',
            issuerName: 'North Country',
            issuerIds: ['place:north-country'],
            authorityIds: ['place:north-country'],
            bands: ['national'],
            status: 'historical',
            date: '1990-05-01',
          })],
          province: [],
          town: [],
        }),
      }),
    });
    const link = await screen.findByRole('link', { name: 'Former housing statute' });
    const item = link.closest('.wwl-result');
    expect(surface()).toHaveAttribute('data-state', 'historical-or-future-law');
    expect(item?.querySelector('[data-field="status"]')).toHaveTextContent('Historical text');
    expect(item?.querySelector('[data-field="date"]')).toHaveTextContent('1990-05-01');
  });

  test('a saved copy shows both revisions and is not replaced', async () => {
    mount({
      corpus: corpus({
        sources: searchedTrio(),
        catalogRevision: CATALOG,
        indexes: harborLists({
          country: [law({
            instrumentId: 'inst:saved',
            textVersionId: 'tv:saved',
            title: 'Saved housing statute',
            officialCitation: 'Saved Act',
            issuerName: 'North Country',
            issuerIds: ['place:north-country'],
            authorityIds: ['place:north-country'],
            bands: ['national'],
            date: '2020-01-01',
            cachedRevision: SAVED,
          })],
          province: [],
          town: [],
        }),
      }),
    });
    const link = await screen.findByRole('link', { name: 'Saved housing statute' });
    const item = link.closest('.wwl-result');
    expect(surface()).toHaveAttribute('data-state', 'stale-cache');
    expect(item?.querySelector('[data-revision="saved"]')).toHaveTextContent(SAVED);
    expect(item?.querySelector('[data-revision="catalog"]')).toHaveTextContent(CATALOG);
    expect(screen.queryByRole('link', { name: 'Newer housing statute' })).not.toBeInTheDocument();
  });

  test('highlights the exact query and keeps letter boundaries', async () => {
    mount({ query: 'statute' });
    const housing = await screen.findByRole('link', { name: 'Housing statute' });
    const item = housing.closest('.wwl-result');
    expect([...item!.querySelectorAll('mark.wwl-mark')].map((mark) => mark.textContent)).toEqual(['statute', 'statute']);
    expect(screen.getByRole('link', { name: 'Statutes only' }).closest('.wwl-result')?.querySelector('mark')).toBeNull();

    const { container, unmount } = render(<p>{highlightExact('Housing statute', 'housing statute')}</p>);
    expect(container.querySelector('mark.wwl-mark')?.textContent).toBe('Housing statute');
    unmount();
    const bounded = render(<p>{highlightExact('Art. 1 and Art. 12', 'Art. 1')}</p>);
    expect([...bounded.container.querySelectorAll('mark.wwl-mark')].map((mark) => mark.textContent)).toEqual(['Art. 1']);
    bounded.unmount();
    const inside = render(<p>{highlightExact('Statutes only', 'statute')}</p>);
    expect(inside.container.querySelector('mark')).toBeNull();
  });

  test('arabic reads right to left and localizes the inclusion prefix', async () => {
    mount({ locale: 'ar' });
    await screen.findByRole('link', { name: 'Housing statute' });
    expect(surface()).toHaveAttribute('lang', 'ar');
    expect(surface()).toHaveAttribute('dir', 'rtl');
    expect(screen.getByRole('heading', { name: 'القوانين والمصادر لهذا المكان' })).toBeInTheDocument();
    expect(document.body.textContent).toMatch(/مُدرج لأن/);
    expect(localizeInclusion('Included because the place is listed.', resultCopy('ja'))).toBe('収録した理由：the place is listed.');
    expect(localizeInclusion('Included because the place is listed.', resultCopy('nl'))).toBe('Opgenomen omdat the place is listed.');
  });

  test('worldwide scope retrieves through the global index and still shows a city filter', async () => {
    const user = userEvent.setup();
    mount({
      scope: 'worldwide',
      query: 'statute',
      corpus: corpus({ globalIndex: routingIndex() }),
    });
    const link = await screen.findByRole('link', { name: 'National statute' });
    expect(surface().getAttribute('data-production')).toContain('searchWorldwide');
    expect(surface().getAttribute('data-production')).toContain('planPlaceSearch');
    expect(surface().getAttribute('data-production')).toContain('fuseCrossIndexResults');
    expect(screen.getAllByText(/This is not all worldwide results/).length).toBeGreaterThan(0);
    expect(link.closest('.wwl-result')?.textContent).toMatch(/Included because/);
    expect(link.closest('.wwl-result')?.textContent).toMatch(/matched/);
    expect(link.closest('.wwl-result')?.querySelector('[data-field="status"]')).toHaveTextContent('Status unknown');
    expect(surface()).toHaveAttribute('data-state', 'partially-loaded');
    expect(fetchHost.fetch).not.toHaveBeenCalled();

    await openFilters(user);
    await user.type(screen.getByLabelText('Place'), PLACE);
    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'National statute' })).toBeInTheDocument();
    });
    expect(surface().getAttribute('data-production')).toContain('searchWorldwide');
  });

  test('closing filters returns focus to the toggle', async () => {
    const user = userEvent.setup();
    mount({ query: '' });
    const toggle = screen.getByRole('button', { name: 'Filters' });
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(document.querySelector('.wwl-filters')).toHaveAttribute('data-open', 'true');
    await user.keyboard('{Escape}');
    expect(toggle).toHaveFocus();
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    await user.click(screen.getByRole('button', { name: 'Close filters' }));
    expect(toggle).toHaveFocus();
  });

  test('a failed load keeps the previous rows', async () => {
    const view = mount();
    await screen.findByRole('link', { name: 'Housing statute' });
    const loadIndexes = jest.fn(async () => {
      throw new Error('This source is unavailable right now.');
    });
    view.rerender(
      <SearchResults
        corpus={corpus()}
        placeId={PLACE}
        asOf={AS_OF}
        query="again"
        loadIndexes={loadIndexes}
      />,
    );
    await waitFor(() => {
      expect(surface()).toHaveAttribute('data-state', 'throttling-or-outage');
    });
    expect(screen.getByText('This source is unavailable right now.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Housing statute' })).toBeInTheDocument();
    expect(loadIndexes).toHaveBeenCalled();
  });

  test('offline search uses the saved indexes', async () => {
    setOnline(false);
    const loadIndexes = jest.fn(async () => {
      throw new Error('offline should not load');
    });
    mount({ loadIndexes });
    expect(await screen.findByRole('link', { name: 'Housing statute' })).toBeInTheDocument();
    expect(loadIndexes).not.toHaveBeenCalled();
    expect(surface()).toHaveAttribute('data-state', 'offline-saved');
    expect(screen.getByText('Offline. Showing saved material only.')).toBeInTheDocument();
  });

  test('names the interaction states used by the screen', () => {
    expect(RESULT_STATE_IDS).toEqual(expect.arrayContaining([
      'no-query',
      'no-matches',
      'unsearched-collection',
      'missing-municipal-coverage',
      'partially-loaded',
      'cancelled-query',
      'throttling-or-outage',
      'stale-cache',
      'offline-saved',
      'source-or-status-unknown',
      'translated-text',
      'historical-or-future-law',
      'screen-reader-scope-change',
    ]));
  });
});

function routingIndex() {
  const collections: GlobalCollectionInput[] = [
    {
      collectionId: 'country-00',
      jurisdictionId: 'country:00',
      sourceRevision: REV,
      coverage: 'known',
      indexedRecords: 1,
      languages: ['en'],
      terms: [{
        term: 'statute',
        hits: [{ documentId: 'doc-statute', score: 10, title: 'National statute', language: 'en', citation: 'Art. 1' }],
      }],
    },
    {
      collectionId: 'country-missing',
      jurisdictionId: 'country:missing',
      sourceRevision: REV,
      coverage: 'missing',
      indexedRecords: null,
      languages: ['en'],
    },
  ];
  return buildGlobalRouting({ catalogRevision: REV, asOf: AS_OF, collections });
}

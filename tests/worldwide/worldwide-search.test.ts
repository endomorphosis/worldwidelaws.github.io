import { buildGlobalRouting, pagesBundleDocument, type GlobalCollectionInput } from '../../scripts/worldwide/build-global-routing';
import {
  FORBIDDEN_TOTAL_LABEL,
  WorldwideSearchError,
  isDirectoryPayload,
  searchWorldwide,
  type GlobalRoutingIndex,
  type WorldwidePage,
  type WorldwideSearchRequest,
} from '../../src/lib/worldwide/search/global';

const REV = 'a'.repeat(40);
const REV_B = 'b'.repeat(40);

function hit(documentId: string, score: number, language = 'en') {
  return { documentId, score, title: documentId, language, citation: '' };
}

function country(
  index: number,
  coverage: GlobalCollectionInput['coverage'],
  extra: Partial<GlobalCollectionInput> = {},
): GlobalCollectionInput {
  const suffix = String(index).padStart(2, '0');
  return {
    collectionId: `country-${suffix}`,
    jurisdictionId: `country:${suffix}`,
    sourceRevision: REV,
    coverage,
    indexedRecords: coverage === 'known' || coverage === 'partial' ? 1 : null,
    languages: ['en'],
    ...extra,
  };
}

function numbersIn(value: unknown, found: number[] = []): number[] {
  if (typeof value === 'number') found.push(value);
  else if (Array.isArray(value)) value.forEach((item) => numbersIn(item, found));
  else if (value && typeof value === 'object') Object.values(value).forEach((item) => numbersIn(item, found));
  return found;
}

function directoryLoads(index: GlobalRoutingIndex, page: WorldwidePage): string[] {
  return page.walk.loadedPaths.filter((path) => {
    const payload = index.documents[path]?.envelope.payload;
    return Boolean(payload && isDirectoryPayload(payload));
  });
}

function follow(index: GlobalRoutingIndex, request: WorldwideSearchRequest): WorldwidePage[] {
  const pages: WorldwidePage[] = [];
  let cursor: string | null = null;
  const cursors = new Set<string>();
  for (let step = 0; step < 40; step += 1) {
    const page = searchWorldwide(index, { ...request, cursor });
    pages.push(page);
    expect(page.fanout).toBe('hierarchical');
    expect(page.perCountryFanout).toBe(false);
    expect(page.fullPostingsLoaded).toBe(false);
    expect(page.claimsAllWorldwideResults).toBe(false);
    expect(page.unsearchedTotalClaimed).toBe(false);
    expect(page.coverage.claimsAllWorldwideResults).toBe(false);
    expect(page.label.toLowerCase()).not.toContain(FORBIDDEN_TOTAL_LABEL);
    expect(page.budgets.withinRequestBound).toBe(true);
    expect(page.budgets.withinByteBound).toBe(true);
    expect(page.budgets.withinShardBound).toBe(true);
    expect(page.budgets.requests).toBeLessThanOrEqual(page.budgets.maxRequestsPerPage);
    expect(page.budgets.bytes).toBeLessThanOrEqual(page.budgets.maxBytesPerPage);
    expect(page.budgets.shardRequests).toBeLessThanOrEqual(page.budgets.maxShardRequestsPerPage);
    expect(page.budgets.maxConcurrentRequests).toBe(4);
    expect(page.budgets.batches).toBe(page.budgets.requests === 0 ? 0 : Math.ceil(page.budgets.requests / 4));
    if (!page.cursor) break;
    expect(cursors.has(page.cursor)).toBe(false);
    cursors.add(page.cursor);
    cursor = page.cursor;
  }
  expect(pages[pages.length - 1]?.continuation).toBe(false);
  return pages;
}

function wideIndex(): GlobalRoutingIndex {
  const collections: GlobalCollectionInput[] = [];
  for (let index = 0; index < 10; index += 1) {
    const suffix = String(index).padStart(2, '0');
    collections.push(country(index, 'known', {
      terms: [{ term: `term${suffix}`, hits: [hit(`doc-${suffix}`, 10 + index)] }],
      citations: [{ citation: `Notice ${suffix}`, documentId: `cite-${suffix}`, title: `Notice ${suffix}`, language: 'en' }],
    }));
  }
  collections.push(country(20, 'partial', {
    collectionId: 'country-partial',
    jurisdictionId: 'country:partial',
    terms: [{ term: 'partialterm', hits: [hit('doc-partial', 3)] }],
  }));
  collections.push(country(21, 'missing', {
    collectionId: 'country-missing',
    jurisdictionId: 'country:missing',
    indexedRecords: null,
  }));
  return buildGlobalRouting({
    catalogRevision: REV,
    asOf: '2024-06-01',
    collections,
    limits: { maxDirectoryBytes: 48 * 1024, maxShardRequestsPerPage: 2, maxRequestsPerPage: 8 },
  });
}

function commonIndex(): GlobalRoutingIndex {
  const collections: GlobalCollectionInput[] = [];
  for (let index = 0; index < 8; index += 1) {
    const suffix = String(index).padStart(2, '0');
    collections.push(country(index, 'known', {
      terms: [{ term: 'law', documentFrequency: 100000, hits: [hit(`law-${suffix}`, 80 - index)] }],
    }));
  }
  collections.push(country(30, 'partial', {
    collectionId: 'country-partial',
    jurisdictionId: 'country:partial',
    terms: [{ term: 'law', documentFrequency: 100000, hits: [hit('law-partial', 1, 'fr')] }],
  }));
  collections.push(country(31, 'missing', {
    collectionId: 'country-missing',
    jurisdictionId: 'country:missing',
    indexedRecords: null,
  }));
  return buildGlobalRouting({
    catalogRevision: REV,
    asOf: '2024-06-01',
    collections,
    limits: { maxShardRequestsPerPage: 2, maxRequestsPerPage: 8, commonDocumentFrequency: 3, pageSizeDefault: 10 },
  });
}

function completeIndex(): GlobalRoutingIndex {
  return buildGlobalRouting({
    catalogRevision: REV,
    asOf: '2024-06-01T00:00:00Z',
    limits: { maxShardRequestsPerPage: 2, maxRequestsPerPage: 8, pageSizeDefault: 10 },
    collections: [0, 1, 2].map((index) => country(index, 'known', {
      indexedRecords: 2,
      terms: [
        { term: 'statute', hits: [hit(`statute-${index}`, 30 - index)] },
        ...(index === 0 ? [{ term: 'zzrare', hits: [hit('rare-doc', 1)] }] : []),
      ],
      citations: index === 0 ? [{ citation: 'article 5', documentId: 'art-5', title: 'Article 5', language: 'en', score: 4 }] : [],
    })),
  });
}

describe('progressive worldwide search', () => {
  const wide = wideIndex();
  const common = commonIndex();
  const complete = completeIndex();

  test('hierarchical routing bounds directory and shard requests instead of fanning out by country', () => {
    expect(wide.perCountryFanout).toBe(false);
    expect(wide.fullCorpusBundled).toBe(false);
    expect(wide.stats.termLeaves).toBeGreaterThan(1);
    expect(wide.stats.directories).toBeGreaterThan(wide.stats.termLeaves);
    for (const stored of Object.values(wide.documents)) {
      const payload = stored.envelope.payload;
      if (isDirectoryPayload(payload)) {
        expect(stored.loadedBytes).toBeLessThanOrEqual(wide.limits.maxDirectoryBytes);
        expect(payload.perCountryFanout).toBe(false);
        expect(payload.routing).toBe('hierarchical-term-citation');
      } else {
        expect(stored.loadedBytes).toBeLessThanOrEqual(wide.limits.maxShardSummaryBytes);
        expect(payload.fullPostingsLoaded).toBe(false);
        expect(payload.perCountryFanout).toBe(false);
      }
    }
    const root = pagesBundleDocument(wide);
    expect(root.envelope.payload.entries).toEqual([]);
    expect(root.envelope.payload.perCountryFanout).toBe(false);
    expect(JSON.stringify(root.envelope)).not.toContain('doc-00');
    expect(wide.pages.fullCorpusBundled).toBe(false);
    expect(wide.pages.shardSummariesBundled).toBe(false);
    expect(wide.pages.bundledBytes).toBe(root.loadedBytes);

    const page = searchWorldwide(wide, { query: 'term00' });
    expect(page.budgets.shardRequests).toBe(1);
    expect(page.budgets.requests).toBeLessThan(10);
    expect(directoryLoads(wide, page).length).toBeLessThan(wide.stats.directories);
    expect(page.walk.siblingDirectoriesSkipped).toBeGreaterThan(0);
    expect(page.walk.loadedPaths.some((path) => path.includes('/cl'))).toBe(false);
    expect(page.hits.map((item) => item.documentId)).toEqual(['doc-00']);
    expect(page.partial).toBe(true);
    expect(page.coverage.state).toBe('partial');
    expect(page.coverage.partialCollectionIds).toContain('country-partial');
    expect(page.coverage.missingCollectionIds).toContain('country-missing');
    expect(page.matchTotal).toBeNull();
    expect(page.walk.openedShardPaths.some((path) => path.includes('country-missing'))).toBe(false);
  });

  test('common-term pages are stable, show partial coverage, and do not use routing frequency as a total', () => {
    const request = { query: 'Law', pageSize: 4 };
    const first = searchWorldwide(common, request);
    const repeat = searchWorldwide(common, request);
    expect(repeat).toEqual(first);
    expect(first.commonQuery).toBe(true);
    expect(first.normalized).toBe('law');
    expect(first.continuation).toBe(true);
    expect(first.cursor).toBeTruthy();
    expect(first.partial).toBe(true);
    expect(first.coverage.catalogState).toBe('partial');
    expect(first.coverage.searchState).toBe('partial');
    expect(first.coverage.missing).toBe(1);
    expect(first.coverage.partialCollections).toBe(1);
    expect(first.label).toContain('Partial coverage');
    expect(first.matchTotal).toBeNull();
    expect(first.budgets.shardRequests).toBeLessThanOrEqual(2);
    expect(first.budgets.shardRequests).toBeGreaterThan(0);
    expect(first.walk.openedShardPaths.length).toBeLessThan(8);
    expect(numbersIn(first)).not.toContain(900000);

    const second = searchWorldwide(common, { ...request, cursor: first.cursor });
    const secondRepeat = searchWorldwide(common, { ...request, cursor: first.cursor });
    expect(secondRepeat).toEqual(second);
    const firstIds = new Set(first.hits.map((item) => item.documentId));
    expect(second.hits.every((item) => !firstIds.has(item.documentId))).toBe(true);
    expect(second.matchTotal).toBeNull();

    const pages = follow(common, request);
    const opened: string[] = [];
    const documents: string[] = [];
    for (const page of pages) {
      expect(page.matchTotal).toBeNull();
      expect(page.unsearchedTotalClaimed).toBe(false);
      for (const path of page.walk.openedShardPaths) {
        expect(opened).not.toContain(path);
        opened.push(path);
      }
      documents.push(...page.hits.map((item) => `${item.collectionId}:${item.documentId}`));
    }
    expect(new Set(documents).size).toBe(documents.length);
    const lawShards = Object.values(common.documents).filter((stored) => {
      const payload = stored.envelope.payload;
      return !isDirectoryPayload(payload) && payload.key === 'law';
    }).map((stored) => stored.envelope.relativePath);
    expect(opened.sort()).toEqual([...lawShards].sort());
    expect(pages[pages.length - 1]?.observedHits).toBe(9);
    expect(pages[pages.length - 1]?.matchTotal).toBeNull();
    expect(pages[pages.length - 1]?.partialReasons).toEqual(expect.arrayContaining(['partial-collection', 'missing-collection', 'truncated-summaries']));
  });

  test('a tight byte budget stops before later shards and continuation uses the same budget', () => {
    const root = pagesBundleDocument(common);
    const termChild = root.envelope.payload.children.find((child) => child.kind === 'term');
    expect(termChild).toBeTruthy();
    const budget = root.loadedBytes + (termChild?.loadedBytes ?? 0);
    const request = { query: 'law', pageSize: 10, limits: { maxBytesPerPage: budget } };
    const first = searchWorldwide(common, request);
    expect(first.budgets.bytes).toBeLessThanOrEqual(budget);
    expect(first.budgets.shardRequests).toBe(0);
    expect(first.continuation).toBe(true);
    expect(first.matchTotal).toBeNull();
    const next = searchWorldwide(common, { ...request, cursor: first.cursor });
    expect(next.budgets.bytes).toBeLessThanOrEqual(budget);
    expect(next.walk.openedShardPaths.length + next.walk.loadedPaths.length).toBeGreaterThan(0);
    expect(next.walk.loadedPaths.some((path) => first.walk.loadedPaths.includes(path))).toBe(false);
  });

  test('continuation visits the remaining shards of a finished catalog without an early total', () => {
    const request = { query: 'statute', pageSize: 1 };
    const pages = follow(complete, request);
    expect(pages.length).toBeGreaterThan(2);
    const opened: string[] = [];
    pages.forEach((page, index) => {
      for (const path of page.walk.openedShardPaths) {
        expect(opened).not.toContain(path);
        opened.push(path);
      }
      if (index < pages.length - 1) expect(page.matchTotal).toBeNull();
    });
    expect(opened.length).toBe(3);
    expect(pages[0]?.walk.openedShardPaths.length).toBe(2);
    expect(pages[1]?.budgets.requests).toBe(0);
    expect(pages[1]?.walk.openedShardPaths).toEqual([]);
    expect(pages[1]?.hits).toHaveLength(1);
    expect(pages[pages.length - 1]?.matchTotal).toBe(3);
    expect(pages[pages.length - 1]?.observedHits).toBe(3);
    expect(pages[pages.length - 1]?.coverage.catalogState).toBe('known');
    expect(pages[pages.length - 1]?.coverage.searchState).toBe('complete');
    expect(pages[pages.length - 1]?.claimsAllWorldwideResults).toBe(false);
    expect(pages.map((page) => page.hits.map((hit) => hit.documentId)).flat()).toEqual(['statute-0', 'statute-1', 'statute-2']);
  });

  test('a rare query term is opened before the remaining common-term shards', () => {
    const request = { query: 'zzrare statute', pageSize: 10, limits: { maxShardRequestsPerPage: 1 } };
    const page = searchWorldwide(complete, request);
    expect(page.hits.map((item) => item.documentId)).toEqual(['rare-doc']);
    expect(page.walk.remainingShardPointers).toBeGreaterThan(0);
    expect(page.matchTotal).toBeNull();
    expect(page.continuation).toBe(true);
    const pages = follow(complete, request);
    expect(pages[pages.length - 1]?.matchTotal).toBe(4);
    expect(pages.flatMap((item) => item.hits.map((hit) => hit.documentId)).sort()).toEqual(['rare-doc', 'statute-0', 'statute-1', 'statute-2']);
  });

  test('citation routing stays on the citation tree and continuation visits its remaining shards', () => {
    const cited = buildGlobalRouting({
      catalogRevision: REV,
      asOf: '2024-06-01',
      limits: { maxShardRequestsPerPage: 2, maxRequestsPerPage: 8, maxDirectoryBytes: 48 * 1024 },
      collections: Array.from({ length: 6 }, (_, index) => country(index, 'known', {
        indexedRecords: 2,
        citations: [
          { citation: 'article 5', documentId: `art-${index}`, title: `Article ${index}`, language: 'en', score: 10 - index },
          { citation: `Notice ${index}`, documentId: `note-${index}`, title: `Notice ${index}`, language: 'en', score: 1 },
        ],
      })),
    });
    expect(cited.stats.citationLeaves).toBeGreaterThan(1);
    const page = searchWorldwide(cited, { citation: 'Art. 5', pageSize: 10 });
    expect(page.mode).toBe('citation');
    expect(page.normalized).toBe('art 5');
    expect(page.walk.loadedPaths.some((path) => /\/d\/tl/.test(path) || /\/d\/ti/.test(path))).toBe(false);
    expect(page.walk.siblingDirectoriesSkipped).toBeGreaterThan(0);
    expect(page.budgets.shardRequests).toBeLessThanOrEqual(2);
    expect(page.hits.every((item) => item.matchedKeys.includes('art 5'))).toBe(true);
    const pages = follow(cited, { citation: 'Art. 5', pageSize: 10 });
    const opened = pages.flatMap((item) => item.walk.openedShardPaths);
    expect(new Set(opened).size).toBe(6);
    expect(pages[pages.length - 1]?.matchTotal).toBe(6);
    const same = searchWorldwide(cited, { citation: 'article 5', pageSize: 10 });
    expect(same.hits).toEqual(page.hits);
    expect(same.cursor).toBe(page.cursor);
  });

  test('filters are part of the cursor binding and do not open excluded countries', () => {
    const unfiltered = searchWorldwide(complete, { query: 'statute', pageSize: 10 });
    expect(() => searchWorldwide(complete, {
      query: 'statute',
      pageSize: 10,
      cursor: unfiltered.cursor,
      filters: { jurisdictions: ['country:00'] },
    })).toThrow(WorldwideSearchError);
    try {
      searchWorldwide(complete, {
        query: 'statute',
        pageSize: 10,
        cursor: unfiltered.cursor,
        filters: { jurisdictions: ['country:00'] },
      });
    } catch (error) {
      expect(error).toMatchObject({ code: 'cursor-mismatch' });
    }
    const other = buildGlobalRouting({
      catalogRevision: REV_B,
      asOf: '2024-06-01T00:00:00Z',
      limits: { maxShardRequestsPerPage: 1, pageSizeDefault: 10 },
      collections: [0, 1, 2].map((index) => country(index, 'known', {
        indexedRecords: 2,
        terms: [{ term: 'statute', hits: [hit(`statute-${index}`, 30 - index)] }],
      })),
    });
    expect(() => searchWorldwide(other, { query: 'statute', pageSize: 1, cursor: unfiltered.cursor })).toThrow(/cursor-mismatch/);

    const filtered = follow(complete, { query: 'statute', pageSize: 10, filters: { jurisdictions: ['country:01'] } });
    expect(filtered.flatMap((page) => page.hits).map((hit) => hit.jurisdictionId)).toEqual(['country:01']);
    expect(filtered[0]?.walk.filteredShards).toBe(2);
    expect(filtered[filtered.length - 1]?.matchTotal).toBe(1);
    expect(filtered[0]?.label).toContain('outside the filters');
    expect(() => searchWorldwide(complete, { query: 'statute', cursor: 'wwg1.not-a-cursor' })).toThrow(/cursor-invalid/);
    expect(() => searchWorldwide(complete, { query: 'statute', citation: 'Art. 5' })).toThrow(/query-and-citation/);
    expect(() => searchWorldwide(complete, { query: '   ' })).toThrow(/query-empty/);
  });

  test('an absent term in a known catalog is a searched zero, not an unsearched worldwide total', () => {
    const page = searchWorldwide(complete, { query: 'notaterm' });
    expect(page.hits).toEqual([]);
    expect(page.matchTotal).toBe(0);
    expect(page.continuation).toBe(false);
    expect(page.walk.openedShardPaths).toEqual([]);
    expect(page.budgets.requests).toBeLessThan(complete.stats.directories);
    expect(page.claimsAllWorldwideResults).toBe(false);
  });

  test('the builder rejects unsearchable shards, bad revisions, and duplicate collections', () => {
    const base = { catalogRevision: REV, asOf: '2024-06-01', collections: [country(0, 'known')] };
    expect(buildGlobalRouting(base).stats.shardSummaries).toBe(0);
    expect(() => buildGlobalRouting({ ...base, collections: [] })).toThrow(/empty-input/);
    expect(() => buildGlobalRouting({ ...base, catalogRevision: 'main' })).toThrow(/invalid-revision/);
    expect(() => buildGlobalRouting({
      ...base,
      collections: [country(0, 'missing', { terms: [{ term: 'law', hits: [hit('x', 1)] }] })],
    })).toThrow(/unsearchable-collection/);
    expect(() => buildGlobalRouting({
      ...base,
      collections: [country(0, 'known'), country(0, 'known')],
    })).toThrow(/duplicate-collection/);
    const again = buildGlobalRouting(base);
    expect(again.pages.bundledSha256).toBe(buildGlobalRouting(base).pages.bundledSha256);
  });
});

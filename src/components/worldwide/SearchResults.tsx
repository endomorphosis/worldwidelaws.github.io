/**
 * Search results for one place, backed by the production planner and fusion.
 *
 * National, regional, and local hits stay in one ranked list unless the
 * visitor turns grouping on. A municipal filter does not become a local-only
 * band allow-list. A cancelled or older response does not replace the list
 * and does not move focus.
 */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { buildLawDeepLink } from '../../lib/worldwide/contracts';
import {
  joinAuthorityStack,
  type AuthorityStack,
  type LawScopeInput,
} from '../../lib/worldwide/jurisdiction/authority';
import type { JurisdictionGraph } from '../../lib/worldwide/jurisdiction/schema';
import {
  searchWorldwide,
  type GlobalRoutingIndex,
  type WorldwideHit,
  type WorldwidePage,
} from '../../lib/worldwide/search/global';
import {
  fuseCrossIndexResults,
  type FusionResult,
  type IndexHitList,
  type RankedHitInput,
} from '../../lib/worldwide/search/fusion';
import {
  planPlaceSearch,
  type SearchFilterInput,
  type SearchPlan,
  type SearchSourceInput,
  type StrictFilters,
  type TemporalPlanInput,
} from '../../lib/worldwide/search/planner';
import { JurisdictionStack, type StackCoverageCell } from './JurisdictionStack';
import {
  SearchFilters,
  bandLabel,
  coverageLabel,
  localizeInclusion,
  normalizeDisplayFilters,
  resultCopy,
  type DisplayFilters,
  type ResultCopy,
  type ResultLocale,
  type ResultStateId,
} from './SearchFilters';
import '../../styles/worldwide.css';

export const RESULTS_PAGE_SCHEMA = 'worldwide-legal-search.results-page@1';

const BAND_ORDER = ['national', 'regional', 'local', 'special', 'supranational', 'unclassified'] as const;
const ENGLISH_PREFIX = 'Included because';

export interface ProductionCorpus {
  graph: JurisdictionGraph | null;
  sources: readonly SearchSourceInput[];
  indexes: readonly IndexHitList[];
  laws?: readonly LawScopeInput[];
  nearbyPlaceIds?: readonly string[];
  viewIds?: readonly string[];
  temporal?: TemporalPlanInput | null;
  catalogRevision?: string | null;
  globalIndex?: GlobalRoutingIndex | null;
}

export interface ProductionRetrievalInput {
  corpus: ProductionCorpus;
  placeId: string;
  asOf: string;
  query: string;
  scope?: 'place' | 'worldwide';
  filters?: Partial<DisplayFilters> | null;
  signal?: AbortSignal;
  worldwideCursor?: string | null;
  loadIndexes?: (plan: SearchPlan, signal: AbortSignal) => Promise<readonly IndexHitList[]>;
}

export interface ResultRow {
  key: string;
  href: string | null;
  title: string | null;
  citation: string | null;
  issuer: string | null;
  bands: string[];
  primaryBand: string;
  status: string | null;
  date: string | null;
  sourceId: string | null;
  sourceRevision: string | null;
  savedRevision: string | null;
  catalogRevision: string | null;
  stale: boolean;
  inclusion: string[];
  snippet: string | null;
  translationKind: 'machine' | 'official' | null;
  translationTitle: string | null;
  translationText: string | null;
  instrumentId: string | null;
}

export interface ProductionPage {
  schema: typeof RESULTS_PAGE_SCHEMA;
  plan: SearchPlan;
  fusion: FusionResult;
  worldwide: WorldwidePage | null;
  worldwideError: string | null;
  stack: AuthorityStack;
  rows: ResultRow[];
  searched: number;
  remaining: number;
  municipalGap: boolean;
  coverage: StackCoverageCell[];
  unsearchedSourceIds: string[];
  production: string[];
}

interface HitExtra {
  officialCitation: string | null;
  issuerIds: string[];
  issuerName: string | null;
  date: string | null;
  snippet: string | null;
  translationKind: 'machine' | 'official' | null;
  translationTitle: string | null;
  translationText: string | null;
  cachedRevision: string | null;
  sourceUrl: string | null;
}

function abortError(): Error {
  const error = new Error('The search was cancelled.');
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw abortError();
}

function clean(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).trim();
  return text ? text : null;
}

function tokens(value: string): string[] {
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function offlineNow(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

export function highlightExact(text: string, query: string): ReactNode {
  const source = text ?? '';
  const needle = query.trim();
  if (!needle || !source) return source;
  const haystack = source.toLocaleLowerCase();
  const wanted = needle.toLocaleLowerCase();
  const letter = /[\p{L}\p{N}]/u;
  const bounded = letter.test(needle);
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let marks = 0;
  while (cursor < source.length) {
    const at = haystack.indexOf(wanted, cursor);
    if (at < 0) break;
    const end = at + needle.length;
    const before = at > 0 ? source.charAt(at - 1) : '';
    const after = end < source.length ? source.charAt(end) : '';
    const exact = !bounded || (!letter.test(before) && !letter.test(after));
    if (!exact) {
      cursor = at + 1;
      continue;
    }
    if (at > cursor) nodes.push(source.slice(cursor, at));
    nodes.push(<mark className="wwl-mark" key={`${at}:${marks}`}>{source.slice(at, end)}</mark>);
    marks += 1;
    cursor = end;
  }
  if (marks === 0) return source;
  if (cursor < source.length) nodes.push(source.slice(cursor));
  return nodes;
}

/**
 * Strict filters sent to planPlaceSearch.
 * A municipal level, or a place filter that names only local candidates,
 * keeps national and regional candidates in the allow-list.
 */
export function toProductionFilters(
  query: string,
  filters: DisplayFilters,
  stack: AuthorityStack | null,
): SearchFilterInput {
  const input: SearchFilterInput = {};
  const asked = query.trim();
  if (asked) input.query = asked;
  const topics = tokens(filters.topic);
  const instruments = tokens(filters.instrument);
  const languages = tokens(filters.language);
  const sources = tokens(filters.source);
  const statuses = tokens(filters.dateStatus);
  if (topics.length > 0) input.topics = topics;
  if (instruments.length > 0) input.instrumentKinds = instruments;
  if (languages.length > 0) input.languages = languages;
  if (sources.length > 0) input.sourceIds = sources;
  if (statuses.length > 0) input.statuses = statuses;

  if (filters.level === 'national') input.bands = ['national'];
  else if (filters.level === 'regional') input.bands = ['regional'];
  else if (filters.level === 'other') input.bands = ['special', 'supranational', 'unclassified'];

  const requested = tokens(filters.place);
  const known = new Set((stack?.candidates ?? []).map((candidate) => candidate.id));
  const recognized = requested.filter((id) => known.has(id));
  if (recognized.length > 0 && stack) {
    const local = new Set(stack.byBand.local ?? []);
    const cityOnly = recognized.every((id) => local.has(id));
    if (cityOnly || filters.level === 'municipal' || filters.level === 'local') {
      input.placeIds = [
        ...(stack.byBand.national ?? []),
        ...(stack.byBand.regional ?? []),
        ...(stack.byBand.local ?? []),
      ];
    } else {
      input.placeIds = recognized;
    }
  }
  return input;
}

function readExtra(hit: RankedHitInput): HitExtra {
  const record = hit as RankedHitInput & Record<string, unknown>;
  const kind = clean(record.translationKind);
  return {
    officialCitation: clean(hit.officialCitation),
    issuerIds: Array.isArray(hit.issuerIds) ? hit.issuerIds.map((item) => clean(item)).filter((item): item is string => Boolean(item)) : [],
    issuerName: clean(record.issuerName),
    date: clean(record.date),
    snippet: clean(record.snippet),
    translationKind: kind === 'machine' || kind === 'official' ? kind : null,
    translationTitle: clean(record.translationTitle),
    translationText: clean(record.translationText),
    cachedRevision: clean(record.cachedRevision),
    sourceUrl: clean(record.sourceUrl),
  };
}

function extraKey(sourceId: string, instrumentId: string, textVersionId: string, sectionId: string): string {
  return [sourceId, instrumentId, textVersionId, sectionId].join('\u001f');
}

function remember(map: Map<string, HitExtra>, sourceId: string, hit: RankedHitInput, extra: HitExtra) {
  const instrumentId = clean(hit.instrumentId) ?? '';
  const sectionId = clean(hit.sectionId) ?? '';
  const textVersionId = clean(hit.textVersionId) ?? '';
  const keys = [
    extraKey(sourceId, instrumentId, textVersionId, sectionId),
    extraKey(sourceId, instrumentId || sectionId, textVersionId, sectionId),
    extraKey(sourceId, instrumentId || sectionId, '', ''),
  ];
  for (const key of keys) {
    if (!map.has(key)) map.set(key, extra);
  }
}

function lookupExtra(map: Map<string, HitExtra>, sourceId: string, instrumentId: string, textVersionId: string | null, sectionId: string | null): HitExtra | null {
  return map.get(extraKey(sourceId, instrumentId, textVersionId ?? '', sectionId ?? ''))
    ?? map.get(extraKey(sourceId, instrumentId, '', ''))
    ?? null;
}

function nameFor(stack: AuthorityStack | null, id: string | null): string | null {
  if (!id || !stack) return null;
  return stack.candidates.find((candidate) => candidate.id === id)?.name ?? null;
}

function issuerFor(stack: AuthorityStack | null, authorityIds: readonly string[], extra: HitExtra | null): string | null {
  if (extra?.issuerName) return extra.issuerName;
  for (const id of extra?.issuerIds ?? []) {
    const name = nameFor(stack, id);
    if (name) return name;
  }
  for (const id of authorityIds) {
    const candidate = stack?.candidates.find((item) => item.id === id);
    if (candidate?.issuer) return candidate.name ?? candidate.id;
  }
  for (const id of authorityIds) {
    const name = nameFor(stack, id);
    if (name) return name;
  }
  return null;
}

function primaryBand(bands: readonly string[]): string {
  for (const band of BAND_ORDER) {
    if (bands.includes(band)) return band;
  }
  return 'unclassified';
}

function lawHref(instrumentId: string | null, sourceRevision: string | null, sectionId: string | null, sourceUrl: string | null): string | null {
  if (!instrumentId) return null;
  const link = buildLawDeepLink({
    publisherUrl: sourceUrl ?? '',
    recordId: instrumentId,
    sourceRevision,
    sectionId,
  });
  return link.applicationRoute;
}

function coverageStateFor(plan: SearchPlan, band: 'national' | 'regional' | 'local'): StackCoverageCell['coverage'] {
  const ids = new Set(plan.byBand[band] ?? []);
  if (ids.size === 0) return 'unknown';
  const rows = plan.sources.filter((source) => source.matchedCandidateIds.some((id) => ids.has(id)));
  if (rows.some((source) => source.disposition === 'searched' && (source.partial || source.coverageState === 'partial'))) return 'partial';
  if (rows.some((source) => source.disposition === 'searched')) return 'known';
  if (rows.some((source) => source.disposition === 'unavailable')) return 'unavailable';
  if (rows.some((source) => source.disposition === 'unknown')) return 'unknown';
  return 'missing';
}

function cellsFor(plan: SearchPlan | null): StackCoverageCell[] {
  const levels = [
    ['national', 'national'],
    ['regional', 'regional'],
    ['local', 'municipal'],
  ] as const;
  return levels.map(([band, level]) => {
    const coverage = plan ? coverageStateFor(plan, band) : 'unknown';
    return { level, coverage, label: '' };
  });
}

export function municipalCollectionMissing(plan: SearchPlan | null): boolean {
  if (!plan) return false;
  const local = new Set(plan.byBand.local ?? []);
  if (local.size === 0) return false;
  const rows = plan.sources.filter((source) => source.matchedCandidateIds.some((id) => local.has(id)));
  return !rows.some((source) => source.disposition === 'searched');
}

function unsearchedIds(plan: SearchPlan): string[] {
  return plan.sources
    .filter((source) => source.disposition === 'missing' || source.disposition === 'unknown' || source.disposition === 'unavailable' || source.disposition === 'unindexed')
    .map((source) => source.sourceId);
}

function counted(plan: SearchPlan, worldwide: WorldwidePage | null): { searched: number; remaining: number } {
  if (worldwide) {
    const searched = worldwide.coverage.known + worldwide.coverage.partialCollections;
    const remaining = worldwide.coverage.missing
      + worldwide.coverage.unknown
      + worldwide.coverage.unavailable
      + worldwide.walk.remainingShardPointers;
    return { searched, remaining };
  }
  return {
    searched: plan.counts.searchedSources,
    remaining: plan.counts.missingSources + plan.counts.unknownSources + plan.counts.unavailableSources + plan.counts.unindexedSources,
  };
}

function rowsFromFusion(plan: SearchPlan, fusion: FusionResult, lists: readonly IndexHitList[], catalogRevision: string | null): ResultRow[] {
  const extras = new Map<string, HitExtra>();
  for (const list of lists) {
    const sourceId = clean(list.sourceId) ?? '';
    const hits = Array.isArray(list.hits) ? list.hits as RankedHitInput[] : [];
    for (const hit of hits) remember(extras, sourceId, hit, readExtra(hit));
  }
  return fusion.hits.map((hit) => {
    const identity = hit.identity;
    const extra = lookupExtra(extras, identity.sourceId, identity.instrumentId, identity.textVersionId, identity.sectionId);
    const saved = extra?.cachedRevision ?? identity.sourceRevision;
    const stale = Boolean(saved && catalogRevision && saved !== catalogRevision);
    return {
      key: hit.versionKey,
      href: lawHref(identity.instrumentId, identity.sourceRevision, identity.sectionId, extra?.sourceUrl ?? null),
      title: hit.title,
      citation: extra?.officialCitation ?? null,
      issuer: issuerFor(plan.stack, hit.authorityIds, extra),
      bands: hit.bands.length > 0 ? hit.bands : [primaryBand([])],
      primaryBand: primaryBand(hit.bands),
      status: hit.status,
      date: extra?.date ?? null,
      sourceId: identity.sourceId,
      sourceRevision: identity.sourceRevision,
      savedRevision: saved,
      catalogRevision,
      stale,
      inclusion: hit.includedBecause,
      snippet: extra?.snippet ?? null,
      translationKind: extra?.translationKind ?? null,
      translationTitle: extra?.translationTitle ?? null,
      translationText: extra?.translationText ?? null,
      instrumentId: identity.instrumentId,
    };
  });
}

function rowsFromWorldwide(page: WorldwidePage, catalogRevision: string | null): ResultRow[] {
  return page.hits.map((hit: WorldwideHit) => {
    const keys = hit.matchedKeys.filter(Boolean);
    const because = keys.length > 0
      ? `${ENGLISH_PREFIX} the routed collection ${hit.collectionId} matched ${keys.join(', ')}. This does not determine what binds conduct here.`
      : `${ENGLISH_PREFIX} the routed collection ${hit.collectionId} returned this summary. This does not determine what binds conduct here.`;
    const stale = Boolean(hit.sourceRevision && catalogRevision && hit.sourceRevision !== catalogRevision);
    return {
      key: `${hit.collectionId}\u001f${hit.documentId}`,
      href: lawHref(hit.documentId, hit.sourceRevision, null, null),
      title: hit.title || null,
      citation: hit.citation || null,
      issuer: hit.jurisdictionId || null,
      bands: ['national'],
      primaryBand: 'national',
      status: null,
      date: null,
      sourceId: hit.collectionId,
      sourceRevision: hit.sourceRevision,
      savedRevision: hit.sourceRevision,
      catalogRevision,
      stale,
      inclusion: [because],
      snippet: null,
      translationKind: null,
      translationTitle: null,
      translationText: null,
      instrumentId: hit.documentId,
    };
  });
}

export async function executeProductionRetrieval(input: ProductionRetrievalInput): Promise<ProductionPage> {
  throwIfAborted(input.signal);
  const corpus = input.corpus;
  const graph = corpus.graph;
  const filters = normalizeDisplayFilters(input.filters);
  const stack = joinAuthorityStack(graph as JurisdictionGraph, {
    placeId: input.placeId,
    asOf: input.asOf,
    laws: corpus.laws ?? [],
    viewIds: corpus.viewIds ?? [],
    nearbyPlaceIds: corpus.nearbyPlaceIds ?? [],
  });
  const filterInput = toProductionFilters(input.query, filters, stack.status === 'resolved' ? stack : null);
  const plan = planPlaceSearch({
    graph,
    placeId: input.placeId,
    asOf: input.asOf,
    laws: corpus.laws ?? [],
    viewIds: corpus.viewIds ?? [],
    nearbyPlaceIds: corpus.nearbyPlaceIds ?? [],
    sources: corpus.sources,
    filters: filterInput,
    temporal: corpus.temporal ?? null,
  });
  throwIfAborted(input.signal);
  const lists = input.loadIndexes
    ? await input.loadIndexes(plan, input.signal ?? new AbortController().signal)
    : corpus.indexes;
  throwIfAborted(input.signal);
  const production = ['joinAuthorityStack', 'planPlaceSearch', 'fuseCrossIndexResults'];
  let worldwide: WorldwidePage | null = null;
  let worldwideError: string | null = null;
  if (input.scope === 'worldwide' && corpus.globalIndex) {
    try {
      const languages = filterInput.languages ?? [];
      const collectionIds = filterInput.sourceIds ?? [];
      const knownIds = new Set(stack.candidates.map((candidate) => candidate.id));
      const recognizedPlaces = tokens(filters.place).filter((id) => knownIds.has(id));
      const localIds = new Set(stack.byBand.local ?? []);
      const cityOnly = stack.status === 'resolved'
        && recognizedPlaces.length > 0
        && recognizedPlaces.every((id) => localIds.has(id));
      const cityKept = filters.level === 'municipal' || filters.level === 'local' || cityOnly;
      const jurisdictions = cityKept ? [] : (filterInput.placeIds ?? []);
      const worldwideFilters: { languages?: string[]; collectionIds?: string[]; jurisdictions?: string[] } = {};
      if (languages.length > 0) worldwideFilters.languages = languages;
      if (collectionIds.length > 0) worldwideFilters.collectionIds = collectionIds;
      if (jurisdictions.length > 0) worldwideFilters.jurisdictions = jurisdictions;
      worldwide = searchWorldwide(corpus.globalIndex, {
        query: input.query,
        cursor: input.worldwideCursor || null,
        filters: worldwideFilters,
      });
      production.push('searchWorldwide');
    } catch (error) {
      worldwideError = error instanceof Error ? error.message : 'Worldwide search failed.';
    }
  }
  throwIfAborted(input.signal);
  const fusion = fuseCrossIndexResults(plan, lists ?? []);
  throwIfAborted(input.signal);
  const catalogRevision = corpus.catalogRevision ?? null;
  const placeRows = rowsFromFusion(plan, fusion, lists ?? [], catalogRevision);
  const rows = worldwide ? rowsFromWorldwide(worldwide, catalogRevision) : placeRows;
  const counts = counted(plan, worldwide);
  return {
    schema: RESULTS_PAGE_SCHEMA,
    plan,
    fusion,
    worldwide,
    worldwideError,
    stack: plan.stack ?? stack,
    rows,
    searched: counts.searched,
    remaining: counts.remaining,
    municipalGap: municipalCollectionMissing(plan),
    coverage: cellsFor(plan),
    unsearchedSourceIds: unsearchedIds(plan),
    production,
  };
}

function shown(value: string | null | undefined, copy: ResultCopy): string {
  return value && value.trim() ? value : copy.unknown;
}

function statusText(status: string | null, copy: ResultCopy): string {
  const value = (status ?? '').toLowerCase();
  if (!value || value === 'unknown') return copy.unknown_status;
  if (value === 'historical') return copy.historical;
  if (value === 'not-yet-in-force') return copy.future;
  return value;
}

function rowIsHistorical(row: ResultRow): boolean {
  const status = (row.status ?? '').toLowerCase();
  return status === 'historical' || status === 'repealed' || status === 'superseded' || status === 'not-yet-in-force';
}

function rowIsUnknown(row: ResultRow): boolean {
  return !row.issuer || !row.date || !row.citation || !row.status || row.status === 'unknown' || !row.sourceId;
}

export function chooseResultState(input: {
  submitted: boolean;
  phase: 'idle' | 'loading' | 'settled' | 'cancelled' | 'failed';
  offline: boolean;
  page: ProductionPage | null;
  scope: 'place' | 'worldwide';
}): ResultStateId {
  if (!input.submitted) return 'no-query';
  if (input.phase === 'cancelled') return 'cancelled-query';
  if (input.offline) return 'offline-saved';
  if (input.phase === 'failed') return 'throttling-or-outage';
  if (input.phase === 'loading' && !input.page) return 'partially-loaded';
  const page = input.page;
  if (!page) return 'partially-loaded';
  if (page.worldwideError && page.rows.length === 0) return 'throttling-or-outage';
  if (page.rows.length === 0) return 'no-matches';
  if (page.rows.some((row) => row.stale)) return 'stale-cache';
  if (page.municipalGap) return 'missing-municipal-coverage';
  if (page.remaining > 0 || input.scope === 'worldwide' || page.worldwide?.partial) return 'partially-loaded';
  if (page.unsearchedSourceIds.length > 0) return 'unsearched-collection';
  if (page.rows.some(rowIsUnknown)) return 'source-or-status-unknown';
  if (page.rows.some(rowIsHistorical)) return 'historical-or-future-law';
  if (page.rows.some((row) => row.translationKind)) return 'translated-text';
  return 'screen-reader-scope-change';
}

function statusFor(state: ResultStateId, copy: ResultCopy, page: ProductionPage | null, loading: boolean): { status: string; next: string } {
  if (state === 'no-query') return { status: copy.empty_query, next: copy.next_query };
  if (state === 'cancelled-query') return { status: copy.cancelled, next: copy.next_cancel };
  if (state === 'offline-saved') return { status: copy.offline, next: copy.next_offline };
  if (state === 'throttling-or-outage') return { status: page?.worldwideError || copy.outage, next: copy.next_outage };
  if (loading && !page) return { status: copy.loading, next: copy.next_partial };
  if (state === 'no-matches') return { status: copy.no_matches, next: copy.next_nomatch };
  if (state === 'stale-cache') return { status: copy.stale, next: copy.next_stale };
  if (state === 'missing-municipal-coverage') return { status: copy.municipal_gap, next: copy.next_municipal };
  if (state === 'partially-loaded') return { status: copy.capped, next: copy.next_partial };
  if (state === 'unsearched-collection') return { status: copy.unsearched, next: copy.next_unsearched };
  if (state === 'source-or-status-unknown') return { status: copy.unknown_status, next: copy.next_unknown };
  if (state === 'historical-or-future-law') return { status: copy.historical, next: copy.next_historical };
  if (state === 'translated-text') return { status: copy.translation, next: copy.next_translation };
  return { status: copy.applicability, next: copy.next_ready };
}

function ResultItem({ row, query, copy }: { row: ResultRow; query: string; copy: ResultCopy }) {
  const title = shown(row.title, copy);
  const inclusion = row.inclusion.length > 0 ? row.inclusion : [''];
  const translationLabel = row.translationKind === 'official' ? copy.official_translation : copy.machine_translation;
  return (
    <li
      className="wwl-result"
      data-band={row.primaryBand}
      data-translation={row.translationKind ? 'shown' : 'hidden'}
      data-stale={row.stale ? 'true' : 'false'}
    >
      <p className="wwl-original" data-field="original-title">
        <span className="wwl-badge">{copy.original_title}</span>
        {row.href ? <a href={row.href}>{highlightExact(title, query)}</a> : <span>{highlightExact(title, query)}</span>}
      </p>
      {row.translationKind ? (
        <div className="wwl-translation">
          <p className="wwl-translation-label">{translationLabel}</p>
          {row.translationTitle ? <p className="wwl-translation-text">{highlightExact(row.translationTitle, query)}</p> : null}
          {row.translationText ? <p className="wwl-translation-text">{highlightExact(row.translationText, query)}</p> : null}
        </div>
      ) : null}
      <p className="wwl-meta">
        <span data-field="issuer">{shown(row.issuer, copy)}</span>
        {row.bands.map((band) => <span className="wwl-badge" data-band={band} key={band}>{bandLabel(band, copy)}</span>)}
        <span className="wwl-badge" data-field="status">{statusText(row.status, copy)}</span>
        <span className="wwl-date" data-field="date">{shown(row.date, copy)}</span>
      </p>
      <p className="wwl-citation" data-field="citation">{highlightExact(shown(row.citation, copy), query)}</p>
      {inclusion.map((line) => (
        <p className="wwl-inclusion" data-field="inclusion" key={line || 'unknown'}>{localizeInclusion(line, copy)}</p>
      ))}
      <p className="wwl-meta" data-field="source">
        <span>{copy.source}</span>
        {' '}
        <span className="wwl-embed">{shown(row.sourceId, copy)}</span>
        {' '}
        <span className="wwl-identifier">{shown(row.sourceRevision, copy)}</span>
      </p>
      {row.snippet ? <p>{highlightExact(row.snippet, query)}</p> : null}
      {row.stale ? (
        <p className="wwl-version">
          {copy.stale}
          {' '}
          <span className="wwl-identifier" data-revision="saved">{shown(row.savedRevision, copy)}</span>
          {' '}
          <span className="wwl-identifier" data-revision="catalog">{shown(row.catalogRevision, copy)}</span>
        </p>
      ) : null}
    </li>
  );
}

function ResultList({ rows, grouped, query, copy }: { rows: ResultRow[]; grouped: boolean; query: string; copy: ResultCopy }) {
  if (!grouped) {
    return (
      <ol aria-label={copy.results}>
        {rows.map((row) => <ResultItem key={row.key} row={row} query={query} copy={copy} />)}
      </ol>
    );
  }
  const bands = [...BAND_ORDER];
  return (
    <div>
      {bands.map((band) => {
        const items = rows.filter((row) => row.primaryBand === band);
        if (items.length === 0) return null;
        const label = bandLabel(band, copy);
        return (
          <section key={band}>
            <h3>{label}</h3>
            <ol aria-label={label}>
              {items.map((row) => <ResultItem key={row.key} row={row} query={query} copy={copy} />)}
            </ol>
          </section>
        );
      })}
    </div>
  );
}

export interface SearchResultsProps {
  corpus: ProductionCorpus;
  placeId: string;
  asOf: string;
  query?: string;
  scope?: 'place' | 'worldwide';
  filters?: Partial<DisplayFilters>;
  locale?: ResultLocale;
  sheet?: boolean;
  loadIndexes?: (plan: SearchPlan, signal: AbortSignal) => Promise<readonly IndexHitList[]>;
}

export function SearchResults({
  corpus,
  placeId,
  asOf,
  query: queryProp,
  scope = 'place',
  filters: filtersProp,
  locale = 'en',
  sheet = false,
  loadIndexes,
}: SearchResultsProps) {
  const copy = resultCopy(locale);
  const [draft, setDraft] = useState(queryProp ?? '');
  const [submitted, setSubmitted] = useState((queryProp ?? '').trim());
  const [filters, setFilters] = useState<DisplayFilters>(normalizeDisplayFilters(filtersProp));
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [page, setPage] = useState<ProductionPage | null>(null);
  const [phase, setPhase] = useState<'idle' | 'loading' | 'settled' | 'cancelled' | 'failed'>('idle');
  const [failure, setFailure] = useState<string | null>(null);
  const [staleIgnored, setStaleIgnored] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const generationRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const loadRef = useRef(loadIndexes);
  const corpusRef = useRef(corpus);
  loadRef.current = loadIndexes;
  corpusRef.current = corpus;
  const filterKey = JSON.stringify({ ...filters, groupByLevel: false });

  useEffect(() => {
    if (queryProp === undefined) return;
    setDraft(queryProp);
    setSubmitted(queryProp.trim());
    setCursor(null);
  }, [queryProp]);

  useEffect(() => {
    if (!filtersProp) return;
    setFilters(normalizeDisplayFilters(filtersProp));
    setCursor(null);
  }, [filtersProp]);

  useEffect(() => {
    const asked = submitted.trim();
    if (!asked) {
      setPhase('idle');
      return undefined;
    }
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    const controller = new AbortController();
    abortRef.current = controller;
    let active = true;
    setPhase('loading');
    setFailure(null);
    const offline = offlineNow();
    executeProductionRetrieval({
      corpus: corpusRef.current,
      placeId,
      asOf,
      query: asked,
      scope,
      filters,
      signal: controller.signal,
      worldwideCursor: cursor,
      loadIndexes: offline ? undefined : loadRef.current,
    }).then((result) => {
      if (generation !== generationRef.current) {
        setStaleIgnored((count) => count + 1);
        return;
      }
      if (controller.signal.aborted || !active) return;
      setPage((current) => {
        if (!cursor || !current) return result;
        const seen = new Set(current.rows.map((row) => row.key));
        return { ...result, rows: [...current.rows, ...result.rows.filter((row) => !seen.has(row.key))] };
      });
      setPhase('settled');
    }, (error: unknown) => {
      if (generation !== generationRef.current) {
        setStaleIgnored((count) => count + 1);
        return;
      }
      if (controller.signal.aborted || !active || isAbort(error)) return;
      setFailure(error instanceof Error ? error.message : copy.outage);
      setPhase('failed');
    });
    return () => {
      active = false;
      controller.abort();
    };
    // filterKey already drops groupByLevel. Depending on `filters` would
    // retrieve again when the visitor only changes that display toggle.
  }, [asOf, copy.outage, cursor, filterKey, placeId, scope, submitted]);

  function cancel() {
    abortRef.current?.abort();
    generationRef.current += 1;
    setPhase('cancelled');
  }

  const previewStack = useMemo(() => joinAuthorityStack(corpus.graph as JurisdictionGraph, {
    placeId,
    asOf,
    laws: corpus.laws ?? [],
    viewIds: corpus.viewIds ?? [],
    nearbyPlaceIds: corpus.nearbyPlaceIds ?? [],
  }), [asOf, corpus, placeId]);

  const stack = page?.stack ?? previewStack;
  const coverage = (page?.coverage ?? cellsFor(null)).map((cell) => ({
    ...cell,
    label: coverageLabel(cell.coverage, copy),
  }));
  const offline = offlineNow();
  const state = chooseResultState({
    submitted: submitted.trim().length > 0,
    phase,
    offline,
    page,
    scope,
  });
  const loading = phase === 'loading';
  const text = statusFor(state, copy, page, loading);
  const status = failure && state === 'throttling-or-outage' ? failure : text.status;
  const rows = page?.rows ?? [];
  const searched = page?.searched ?? 0;
  const remaining = page?.remaining ?? 0;
  const announcement = submitted.trim()
    ? `${copy.searched} ${searched}. ${copy.remaining} ${remaining}. ${status}`
    : copy.empty_query;

  function onNext() {
    if (state === 'partially-loaded' && page?.worldwide?.cursor) {
      setCursor(page.worldwide.cursor);
      return;
    }
    if (state === 'missing-municipal-coverage') {
      document.getElementById('wwl-municipal-coverage')?.focus();
      return;
    }
    if (state === 'no-query' || state === 'no-matches' || state === 'cancelled-query' || state === 'throttling-or-outage') {
      document.getElementById('wwl-result-query')?.focus();
      return;
    }
    document.getElementById('wwl-results')?.focus();
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setCursor(null);
    setSubmitted(draft.trim());
  }

  function onFilters(next: DisplayFilters) {
    setCursor(null);
    setFilters(next);
  }

  const showCapped = state === 'partially-loaded' || scope === 'worldwide';

  return (
    <div
      className="wwl wwl-results-surface"
      lang={copy.lang}
      dir={copy.dir}
      data-state={state}
      data-loading={loading ? 'true' : 'false'}
      data-scope={scope === 'worldwide' ? 'worldwide' : placeId ? 'place' : 'unselected'}
      data-map="closed"
      data-model="idle"
      data-reader="closed"
      data-compare="closed"
      data-results={RESULTS_PAGE_SCHEMA}
      data-production={page?.production.join(' ') || 'idle'}
      data-plan-status={page?.plan.status ?? 'idle'}
      data-ranking-query={page?.plan.rankingSignals.query ?? ''}
      data-strict-bands={page ? (page.plan.strictFilters.bands.join(' ') || 'none') : 'none'}
      data-strict-places={page ? (page.plan.strictFilters.placeIds.join(' ') || 'none') : 'none'}
      data-strict-topics={page ? (page.plan.strictFilters.topics.join(' ') || 'none') : 'none'}
      data-searched-sources={page ? page.plan.searchedSourceIds.join(' ') : ''}
      data-filtered={page?.fusion.counts.filteredOut ?? 0}
      data-stale-ignored={staleIgnored}
      data-group={filters.groupByLevel ? 'on' : 'off'}
    >
      <form className="wwl-search" role="search" onSubmit={onSubmit}>
        <label htmlFor="wwl-result-query">{copy.search_label}</label>
        <input
          id="wwl-result-query"
          className="wwl-search-input"
          type="search"
          value={draft}
          placeholder={copy.search_placeholder}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit">{copy.search_label}</button>
        {loading ? <button type="button" onClick={cancel}>{copy.cancel}</button> : null}
      </form>
      {asOf ? <p className="wwl-date">{copy.as_of} {asOf}</p> : null}
      <p className="wwl-counts">{copy.searched} {searched} · {copy.remaining} {remaining}</p>
      <div className="wwl-status">
        <p>{status}</p>
        {showCapped ? <p>{copy.capped}</p> : null}
        {page?.unsearchedSourceIds.map((sourceId) => (
          <p key={sourceId}>{copy.unsearched} <span className="wwl-embed">{sourceId}</span></p>
        ))}
        <p><button type="button" className="wwl-next" onClick={onNext}>{text.next}</button></p>
      </div>
      <div className="wwl-workspace">
        <JurisdictionStack
          copy={copy}
          stack={stack}
          coverage={coverage}
          municipalGap={page?.municipalGap ?? municipalCollectionMissing(null)}
        />
        <main className="wwl-results" id="wwl-main">
          <h2 id="wwl-results" tabIndex={-1}>{copy.results}</h2>
          <ResultList rows={rows} grouped={filters.groupByLevel} query={submitted} copy={copy} />
        </main>
        <SearchFilters
          filters={filters}
          onChange={onFilters}
          open={filtersOpen}
          onOpenChange={setFiltersOpen}
          copy={copy}
          sheet={sheet}
        />
      </div>
      <div className="wwl-live" role="status" aria-live="polite" aria-atomic="true">{announcement}</div>
    </div>
  );
}

export type { DisplayFilters, ResultLocale, StrictFilters };
export default SearchResults;

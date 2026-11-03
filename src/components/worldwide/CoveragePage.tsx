/**
 * Coverage register.
 *
 * Cells stay grouped by jurisdiction and level. Each cell shows its coverage
 * state, its as-of freshness, and a denominator only when one is known.
 * A missing municipal cell and an unknown municipal cell stay different
 * sentences. An empty search is not a result about the law, and no cell is
 * turned into a claim that no law exists. Legal completeness stays
 * not_claimed. Boundary files stay outside the law record denominator.
 */

import { useEffect, useId, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  COVERAGE_STATES,
  LAW_JURISDICTION_ID,
  LEVELS,
  CatalogError,
  validateBrowserCatalog,
  type BrowserCatalog,
  type CatalogSource,
  type CoverageCell,
  type CoverageState,
  type Level,
} from '../../lib/worldwide/data/catalog';
import { buildRoute, canonicalizePlaceId } from '../../lib/worldwide/routes';
import {
  bandLabel,
  coverageLabel,
  resultCopy,
  type ResultCopy,
  type ResultLocale,
} from './SearchFilters';
import '../../styles/worldwide.css';

export const COVERAGE_PAGE_SCHEMA = 'worldwide-legal-search.coverage-page@1';

export const NOT_A_FINDING = 'That is a coverage gap, not a finding that no local law exists.';
export const NO_MATCHES_NOT_A_FINDING = 'No matches is not a finding that no law exists.';
export const COUNTED_ZERO = 'A counted zero is not a finding that no law exists.';
export const NOT_A_LICENSE = 'Organization membership is not a license.';
export const NO_MUNICIPALITY_ADDED = 'No municipality was added for this place.';
export const COUNTRY_DOES_NOT_CHOOSE_CITY = 'A country row does not choose a city.';
export const REGION_DOES_NOT_INVENT = 'A region row does not invent a municipality.';
export const NOT_JOINED = 'No municipal collection was joined to this place.';
export const COVERAGE_NOT_A_RESULT = 'Coverage is not a result until a place or a worldwide search is chosen.';
export const NO_KNOWN_DENOMINATOR = 'No known denominator at this level.';
export const FRESHNESS_UNKNOWN = 'Freshness unknown.';
export const NOT_LEGAL_COMPLETENESS = 'Collection counts and record denominators are not legal completeness.';
export const DENOMINATOR_SEPARATION = 'boundary_record_denominator is not added to record_denominator.';
export const CATALOG_NOT_THIS_PLACE = 'A catalog cell is not a finding about this place.';
export const NO_SOURCE_JOINED = 'No source was joined to this place.';

const ALLOWED_NEGATIONS = [
  'No municipal collection is in the catalog for this place. That is a coverage gap, not a finding that no local law exists.',
  'Er is geen gemeentelijke verzameling in de catalogus voor deze plaats. Dit is een dekkingsgat, geen vaststelling dat er geen lokale wet bestaat.',
  NO_MATCHES_NOT_A_FINDING,
  COUNTED_ZERO,
  NOT_A_FINDING,
  'An empty search is not a result about the law.',
].sort((left, right) => right.length - left.length);

const LOCAL_LEVELS = new Set([
  'county',
  'district',
  'municipality',
  'city',
  'locality',
  'borough',
  'neighborhood',
  'unincorporated',
  'statistical-area',
  'postal-area',
  'local-authority',
  'local',
  'municipal',
]);

const COUNTRY_LEVELS = new Set([
  'country',
  'constituent-country',
  'dependency',
  'national-authority',
  'national',
]);

const REGION_LEVELS = new Set([
  'region',
  'state',
  'province',
  'territory',
  'regional-authority',
  'autonomous-area',
  'regional',
]);

const GAP_ORDER: readonly CoverageState[] = ['missing', 'unknown', 'unavailable', 'partial', 'known'];

export interface SearchReading {
  kind: 'empty' | 'unsearched' | 'no-matches' | 'matches';
  query: string | null;
  statement: string;
  matchCount: number | null;
  impliesNoLaw: false;
}

export interface KnownDenominator {
  viewerRows: number | null;
  metadataFiles: number | null;
  uncountedCollections: number;
  known: boolean;
}

export interface PlaceDescriptor {
  placeId: string;
  name?: string | null;
  levelKind?: string | null;
  parents?: readonly { placeId: string; name?: string | null; levelKind?: string | null }[];
}

export interface PlaceMunicipalReading {
  state: CoverageState;
  sentence: string;
  inventedMunicipality: false;
  joined: boolean;
}

export interface LineageStep {
  role: 'inventory' | 'disposition' | 'revision' | 'rights' | 'card' | 'geography' | 'license' | 'citation' | 'rollup' | 'decision';
  label: string;
  value: string;
  known: boolean;
}

export interface CoveragePageProps {
  catalog: BrowserCatalog | null;
  placeId?: string | null;
  query?: string | null;
  hits?: readonly unknown[] | null;
  locale?: ResultLocale | null;
}

export function textImpliesNoLaw(text: string): boolean {
  let rest = text;
  for (const sentence of ALLOWED_NEGATIONS) rest = rest.split(sentence).join(' ');
  return /\bno (?:local )?laws?\b/i.test(rest)
    || /\bthere (?:is|are) no\b/i.test(rest)
    || /\bdoes not exist\b/i.test(rest)
    || /\bno such law\b/i.test(rest);
}

export function readSearch(
  query: string | null | undefined,
  hits?: readonly unknown[] | null,
  copy: ResultCopy = resultCopy('en'),
): SearchReading {
  const text = typeof query === 'string' ? query.trim() : '';
  if (!text) {
    return {
      kind: 'empty',
      query: null,
      statement: copy.empty_query,
      matchCount: null,
      impliesNoLaw: false,
    };
  }
  if (hits == null) {
    return {
      kind: 'unsearched',
      query: text,
      statement: copy.unsearched,
      matchCount: null,
      impliesNoLaw: false,
    };
  }
  if (hits.length === 0) {
    return {
      kind: 'no-matches',
      query: text,
      statement: `${copy.no_matches} ${NO_MATCHES_NOT_A_FINDING}`,
      matchCount: 0,
      impliesNoLaw: false,
    };
  }
  return {
    kind: 'matches',
    query: text,
    statement: `${copy.searched} ${hits.length}. ${copy.not_all_results} ${NOT_LEGAL_COMPLETENESS}`,
    matchCount: hits.length,
    impliesNoLaw: false,
  };
}

export function municipalCopy(state: CoverageState, copy: ResultCopy): string {
  const label = coverageLabel(state, copy);
  if (state === 'missing') return `${label}. ${copy.municipal_gap}`;
  if (state === 'unknown' || state === 'unavailable') return `${label}. ${NOT_A_FINDING}`;
  if (state === 'partial') return `${label}. A partial collection is not legal completeness.`;
  return `${label}. A known collection is not legal completeness.`;
}

export function denominatorKnown(cell: CoverageCell): boolean {
  if (cell.denominator_kind === 'not-counted') return false;
  if (cell.uncounted_collections > 0 && cell.record_denominator === 0) return false;
  return true;
}

export function denominatorText(cell: CoverageCell): string {
  if (cell.denominator_kind === 'not-counted') {
    return 'Denominator not counted. This is not a known denominator.';
  }
  if (cell.denominator_kind === 'metadata-files') {
    return `${cell.record_denominator} metadata files. Boundary files stay outside the law record denominator. This is not legal completeness.`;
  }
  if (cell.uncounted_collections > 0 && cell.record_denominator === 0) {
    return `${COUNTED_ZERO} ${uncountedLabel(cell.uncounted_collections)} This is not legal completeness.`;
  }
  if (cell.record_denominator === 0) {
    return `${COUNTED_ZERO} This is not legal completeness.`;
  }
  const uncounted = cell.uncounted_collections > 0 ? ` ${uncountedLabel(cell.uncounted_collections)}` : '';
  return `${cell.record_denominator} viewer rows. This denominator is known. It is not legal completeness.${uncounted}`;
}

function uncountedLabel(count: number): string {
  return count === 1 ? '1 collection has no counted rows.' : `${count} collections have no counted rows.`;
}

export function knownDenominator(catalog: BrowserCatalog, jurisdictionId: string, level: Level): KnownDenominator {
  let viewerRows: number | null = null;
  let metadataFiles: number | null = null;
  let uncountedCollections = 0;
  for (const source of catalog.sources) {
    if (source.jurisdiction_id !== jurisdictionId) continue;
    if (source.decision !== 'include') continue;
    if (!source.counted_levels.includes(level)) continue;
    const value = source.level_denominators[level];
    if (source.denominator_kind === 'metadata-files') {
      if (typeof value === 'number') metadataFiles = (metadataFiles ?? 0) + value;
      else uncountedCollections += 1;
    } else if (typeof value === 'number') {
      viewerRows = (viewerRows ?? 0) + value;
    } else {
      uncountedCollections += 1;
    }
  }
  return {
    viewerRows,
    metadataFiles,
    uncountedCollections,
    known: viewerRows !== null || metadataFiles !== null,
  };
}

export function jurisdictionLabel(catalog: BrowserCatalog, jurisdictionId: string): string {
  if (jurisdictionId === LAW_JURISDICTION_ID) return 'Law collections, jurisdiction unstated';
  const boundary = catalog.sources.some((source) => source.dataset_id === jurisdictionId && source.denominator_kind === 'metadata-files');
  if (boundary) return `Boundary registry ${jurisdictionId}`;
  return jurisdictionId;
}

export function jurisdictionFreshness(catalog: BrowserCatalog, jurisdictionId: string): string[] {
  const dates: string[] = [];
  for (const cell of catalog.cells) {
    if (cell.jurisdiction_id === jurisdictionId && cell.as_of && !dates.includes(cell.as_of)) dates.push(cell.as_of);
  }
  return dates;
}

export function dominantMunicipal(states: readonly CoverageState[]): CoverageState | null {
  for (const state of GAP_ORDER) {
    if (states.includes(state)) return state;
  }
  return null;
}

export function catalogMunicipalStates(catalog: BrowserCatalog): CoverageState[] {
  return catalog.cells.filter((cell) => cell.level === 'municipal').map((cell) => cell.coverage_state);
}

export function cellKey(cell: CoverageCell): string {
  return `${cell.jurisdiction_id}\t${cell.level}\t${cell.capability}`;
}

export function municipalAnchorKey(catalog: BrowserCatalog): string | null {
  const municipal = catalog.cells.filter((cell) => cell.level === 'municipal');
  const chosen = GAP_ORDER
    .map((state) => municipal.find((cell) => cell.coverage_state === state))
    .find((cell) => cell !== undefined) ?? null;
  return chosen ? cellKey(chosen) : null;
}

export function findSource(catalog: BrowserCatalog, sourceId: string | null | undefined): CatalogSource | null {
  const id = typeof sourceId === 'string' ? sourceId.trim() : '';
  if (!id) return null;
  return catalog.sources.find((source) => source.dataset_id === id) ?? null;
}

export function cellsForSource(catalog: BrowserCatalog, source: CatalogSource): CoverageCell[] {
  if (source.decision === 'exclude') return [];
  return catalog.cells.filter((cell) => (
    source.jurisdiction_id === cell.jurisdiction_id
    && source.levels.includes(cell.level)
    && source.capabilities.includes(cell.capability)
  ));
}

export function sourceLineage(catalog: BrowserCatalog, source: CatalogSource | null): LineageStep[] {
  const steps: LineageStep[] = [
    { role: 'inventory', label: 'Inventory revision', value: catalog.inventory_revision, known: true },
    { role: 'disposition', label: 'Disposition revision', value: catalog.disposition_revision, known: true },
  ];
  if (!source) {
    steps.push({ role: 'revision', label: 'Resolved revision', value: 'unknown', known: false });
    steps.push({ role: 'rights', label: 'Rights', value: `unknown. ${NOT_A_LICENSE}`, known: false });
    return steps;
  }
  const rights = source.rights_status === 'resolved'
    ? 'resolved'
    : source.rights_status === 'absent'
      ? 'absent'
      : 'unresolved';
  steps.push({ role: 'revision', label: 'Resolved revision', value: source.resolved_revision, known: true });
  steps.push({ role: 'decision', label: 'Decision', value: source.decision, known: true });
  steps.push({ role: 'rights', label: 'Rights', value: `${rights}. ${NOT_A_LICENSE}`, known: source.rights_status === 'resolved' });
  steps.push({
    role: 'card',
    label: 'Card digest',
    value: source.card_sha256 ?? 'unknown',
    known: Boolean(source.card_sha256),
  });
  if (source.denominator_kind === 'metadata-files' || source.capabilities.includes('boundary')) {
    steps.push({ role: 'geography', label: 'Geography revision', value: catalog.geography_revision, known: true });
    steps.push({ role: 'license', label: 'License digest', value: source.license_sha256 ?? 'unknown', known: Boolean(source.license_sha256) });
    steps.push({ role: 'citation', label: 'Citation digest', value: source.citation_sha256 ?? 'unknown', known: Boolean(source.citation_sha256) });
    steps.push({ role: 'rollup', label: 'Rollup digest', value: source.rollup_sha256 ?? 'unknown', known: Boolean(source.rollup_sha256) });
  }
  return steps;
}

function levelName(levelKind: string | null | undefined): string {
  return (levelKind ?? '').trim().toLowerCase();
}

export function placeMunicipalReading(
  catalog: BrowserCatalog,
  place: PlaceDescriptor,
  joinedSourceIds?: readonly string[] | null,
  municipalState?: CoverageState | null,
  copy: ResultCopy = resultCopy('en'),
): PlaceMunicipalReading {
  const level = levelName(place.levelKind);
  const joined = joinedSourceIds != null;
  if (!level || level === 'unknown' || level === 'worldwide') {
    return {
      state: 'unknown',
      sentence: `${NO_MUNICIPALITY_ADDED} ${municipalCopy('unknown', copy)}`,
      inventedMunicipality: false,
      joined,
    };
  }
  if (!LOCAL_LEVELS.has(level)) {
    const prefix = COUNTRY_LEVELS.has(level) ? COUNTRY_DOES_NOT_CHOOSE_CITY : REGION_DOES_NOT_INVENT;
    const state = municipalState && (COVERAGE_STATES as readonly string[]).includes(municipalState) && municipalState !== 'missing'
      ? municipalState
      : 'unknown';
    return {
      state,
      sentence: `${prefix} ${municipalCopy(state, copy)}`,
      inventedMunicipality: false,
      joined,
    };
  }
  if (municipalState && (COVERAGE_STATES as readonly string[]).includes(municipalState)) {
    return {
      state: municipalState,
      sentence: municipalCopy(municipalState, copy),
      inventedMunicipality: false,
      joined,
    };
  }
  if (!joined) {
    return {
      state: 'unknown',
      sentence: `${NOT_JOINED} ${municipalCopy('unknown', copy)}`,
      inventedMunicipality: false,
      joined: false,
    };
  }
  const sources = joinedSourceIds
    .map((id) => findSource(catalog, id))
    .filter((source): source is CatalogSource => source !== null);
  const municipalSources = sources.filter((source) => source.levels.includes('municipal') || source.counted_levels.includes('municipal'));
  if (sources.length === 0 || municipalSources.length === 0) {
    const state: CoverageState = sources.length > 0 && municipalSources.length === 0 ? 'unknown' : 'missing';
    return {
      state,
      sentence: municipalCopy(state, copy),
      inventedMunicipality: false,
      joined: true,
    };
  }
  const included = municipalSources.filter((source) => source.decision === 'include' && source.counted_levels.includes('municipal'));
  const blocked = municipalSources.filter((source) => source.decision === 'blocked');
  let state: CoverageState;
  if (included.length === 0 && blocked.length > 0) state = 'unavailable';
  else if (included.length === 0) state = 'unknown';
  else if (blocked.length === 0 && included.every((source) => (
    source.files_complete
    && source.rights_status === 'resolved'
    && source.denominator_kind === 'viewer-rows'
    && typeof source.level_denominators.municipal === 'number'
    && (source.level_denominators.municipal ?? 0) > 0
  ))) state = 'known';
  else state = 'partial';
  return {
    state,
    sentence: municipalCopy(state, copy),
    inventedMunicipality: false,
    joined: true,
  };
}

export function pageState(search: SearchReading, municipal: CoverageState | null, catalogOk: boolean): string {
  if (search.kind === 'empty') return 'no-query';
  if (!catalogOk) return 'source-or-status-unknown';
  if (search.kind === 'no-matches') return 'no-matches';
  if (search.kind === 'unsearched') return 'unsearched-collection';
  if (municipal === 'missing') return 'missing-municipal-coverage';
  if (municipal === 'unknown' || municipal === 'unavailable') return 'source-or-status-unknown';
  return 'screen-reader-scope-change';
}

export function coverageHref(placeId?: string | null, query?: string | null): string {
  return buildRoute({ name: 'coverage', placeId: placeId || null, query: query || null }).href;
}

export function placeHref(placeId: string, query?: string | null): string {
  return buildRoute({ name: 'place', placeId, query: query || null }).href;
}

export function sourceHref(sourceId: string, placeId?: string | null): string {
  return buildRoute({ name: 'sources', sourceId, placeId: placeId || null }).href;
}

export function searchHref(placeId?: string | null, query?: string | null): string {
  return buildRoute({ name: 'search', placeId: placeId || null, query: query || null }).href;
}

export function catalogProblem(catalog: BrowserCatalog | null | undefined): CatalogError | null {
  if (!catalog || typeof catalog !== 'object') return new CatalogError('schema', 'catalog is missing');
  try {
    validateBrowserCatalog(catalog);
    return null;
  } catch (error) {
    if (error instanceof CatalogError) return error;
    return new CatalogError('coverage', 'catalog could not be read');
  }
}

export function usePageSearch(query: string | null | undefined, hits: readonly unknown[] | null | undefined, copy: ResultCopy) {
  const [draft, setDraft] = useState(query ?? '');
  const [submitted, setSubmitted] = useState(query ?? '');
  useEffect(() => {
    setDraft(query ?? '');
    setSubmitted(query ?? '');
  }, [query]);
  const activeHits = submitted.trim() === (query ?? '').trim() ? hits : null;
  const search = readSearch(submitted, activeHits, copy);
  return { draft, setDraft, submitted, setSubmitted, search };
}

function focusElement(id: string) {
  if (typeof document === 'undefined') return;
  document.getElementById(id)?.focus();
}

export function NextControl({
  search,
  municipal,
  copy,
  searchInputId,
}: {
  search: SearchReading;
  municipal: CoverageState | null;
  copy: ResultCopy;
  searchInputId: string;
}) {
  let text = copy.next_ready;
  let focus: 'search' | 'municipal' | 'coverage' = 'coverage';
  if (search.kind === 'empty') {
    text = copy.next_query;
    focus = 'search';
  } else if (search.kind === 'no-matches') {
    text = copy.next_nomatch;
    focus = 'coverage';
  } else if (search.kind === 'unsearched') {
    text = copy.next_unsearched;
    focus = 'coverage';
  } else if (municipal === 'missing' || municipal === 'unknown' || municipal === 'unavailable') {
    text = copy.next_municipal;
    focus = 'municipal';
  }
  return (
    <p className="wwl-status">
      <button
        type="button"
        className="wwl-next"
        onClick={() => focusElement(focus === 'search' ? searchInputId : focus === 'municipal' ? 'wwl-municipal-coverage' : 'wwl-coverage-matrix')}
      >
        {text}
      </button>
    </p>
  );
}

export function PageSearch({
  id,
  copy,
  draft,
  onDraft,
  onSubmit,
}: {
  id: string;
  copy: ResultCopy;
  draft: string;
  onDraft: (value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <form
      className="wwl-search"
      role="search"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <label htmlFor={id}>{copy.search_label}</label>
      <input
        id={id}
        className="wwl-search-input"
        type="search"
        value={draft}
        placeholder={copy.search_placeholder}
        onChange={(event) => onDraft(event.target.value)}
      />
      <button type="submit">{copy.search_label}</button>
    </form>
  );
}

export function SearchNotice({ search }: { search: SearchReading }) {
  return (
    <p data-field="search-statement" data-search={search.kind}>
      {search.statement}
    </p>
  );
}

function Freshness({
  dates,
  copy,
  level,
  jurisdictionId,
}: {
  dates: readonly string[];
  copy: ResultCopy;
  level: Level;
  jurisdictionId: string;
}) {
  return (
    <p data-field="freshness" data-level={level} data-jurisdiction={jurisdictionId}>
      {dates.length === 0 ? FRESHNESS_UNKNOWN : dates.map((date) => `${copy.as_of} ${date}`).join('. ')}
    </p>
  );
}

function DenominatorReading({
  value,
  level,
  jurisdictionId,
}: {
  value: KnownDenominator;
  level: Level;
  jurisdictionId: string;
}) {
  return (
    <p data-field="known-denominator" data-known={value.known ? 'true' : 'false'} data-level={level} data-jurisdiction={jurisdictionId}>
      {value.viewerRows !== null ? <span data-field="viewer-rows">{value.viewerRows} viewer rows. </span> : null}
      {value.viewerRows === 0 ? <span>{COUNTED_ZERO} </span> : null}
      {value.metadataFiles !== null ? (
        <span data-field="metadata-files">{value.metadataFiles} metadata files. Boundary files stay outside the law record denominator. </span>
      ) : null}
      {value.known ? null : <span>{NO_KNOWN_DENOMINATOR} </span>}
      {value.uncountedCollections > 0 ? <span data-field="uncounted">{uncountedLabel(value.uncountedCollections)} </span> : null}
      <span>{NOT_LEGAL_COMPLETENESS}</span>
    </p>
  );
}

export function CoverageCellView({
  cell,
  copy,
  anchor,
}: {
  cell: CoverageCell;
  copy: ResultCopy;
  anchor: boolean;
}) {
  const known = denominatorKnown(cell);
  return (
    <p
      className="wwl-coverage"
      data-scope="catalog"
      data-coverage={cell.coverage_state}
      data-level={cell.level}
      data-capability={cell.capability}
      data-jurisdiction={cell.jurisdiction_id}
      data-denominator-kind={cell.denominator_kind}
      data-denominator-known={known ? 'true' : 'false'}
      data-record-denominator={cell.record_denominator}
      data-as-of={cell.as_of}
      data-integrity={cell.integrity.sha256}
      id={anchor ? 'wwl-municipal-coverage' : undefined}
      tabIndex={anchor ? -1 : undefined}
    >
      <span>{bandLabel(cell.level, copy)}. </span>
      <span data-field="coverage-label">{coverageLabel(cell.coverage_state, copy)}. </span>
      <span data-field="capability">{cell.capability}. </span>
      <span data-field="cell-freshness">{copy.as_of} {cell.as_of}. </span>
      <span data-field="cell-denominator">{denominatorText(cell)} </span>
      <span data-field="collection-count">Pinned collections {cell.collection_count}. Blocked collections {cell.blocked_count}.</span>
      {cell.level === 'municipal' ? <span data-field="municipal-sentence"> {municipalCopy(cell.coverage_state, copy)}</span> : null}
    </p>
  );
}

export function CoverageMatrix({
  catalog,
  copy,
  anchor,
}: {
  catalog: BrowserCatalog;
  copy: ResultCopy;
  anchor: boolean;
}) {
  const anchorKey = anchor ? municipalAnchorKey(catalog) : null;
  return (
    <div data-field="coverage-matrix" id="wwl-coverage-matrix" tabIndex={-1}>
      {catalog.jurisdictions.map((jurisdictionId) => (
        <section key={jurisdictionId} data-jurisdiction={jurisdictionId} aria-label={jurisdictionLabel(catalog, jurisdictionId)}>
          <h2>{jurisdictionLabel(catalog, jurisdictionId)}</h2>
          {LEVELS.map((level) => {
            const cells = catalog.cells.filter((item) => item.jurisdiction_id === jurisdictionId && item.level === level);
            const dates = cells.map((cell) => cell.as_of).filter((date, index, all) => date && all.indexOf(date) === index);
            return (
              <section key={level} data-level={level} data-jurisdiction={jurisdictionId}>
                <h3>{bandLabel(level, copy)}</h3>
                <Freshness dates={dates} copy={copy} level={level} jurisdictionId={jurisdictionId} />
                <DenominatorReading value={knownDenominator(catalog, jurisdictionId, level)} level={level} jurisdictionId={jurisdictionId} />
                {cells.map((cell) => (
                  <CoverageCellView key={cell.capability} cell={cell} copy={copy} anchor={anchorKey === cellKey(cell)} />
                ))}
              </section>
            );
          })}
        </section>
      ))}
    </div>
  );
}

export function SourceIndex({ catalog, placeId }: { catalog: BrowserCatalog; placeId?: string | null }) {
  return (
    <ul data-field="source-index" aria-label="Source lineage">
      {catalog.sources.map((source) => (
        <li key={source.dataset_id} data-source={source.dataset_id} data-decision={source.decision}>
          <a href={sourceHref(source.dataset_id, placeId)}>{source.dataset_id}</a>
          {' '}
          <span className="wwl-identifier">{source.resolved_revision}</span>
          {' '}
          <span>{source.decision}</span>
          {' '}
          <span>{source.rights_status}. {NOT_A_LICENSE}</span>
        </li>
      ))}
    </ul>
  );
}

function MunicipalSummary({ catalog }: { catalog: BrowserCatalog }) {
  const states = catalogMunicipalStates(catalog);
  const missing = states.filter((state) => state === 'missing').length;
  const unknown = states.filter((state) => state === 'unknown').length;
  const unavailable = states.filter((state) => state === 'unavailable').length;
  return (
    <p data-field="municipal-summary">
      {missing > 0 ? <span data-field="municipal-missing-count">{missing} municipal cells are missing from the catalog. </span> : null}
      {unknown > 0 ? <span data-field="municipal-unknown-count">{unknown} municipal cells have unknown coverage. </span> : null}
      {unavailable > 0 ? <span data-field="municipal-unavailable-count">{unavailable} municipal cells are unavailable. </span> : null}
      {missing + unknown + unavailable > 0 ? <span>{NOT_A_FINDING}</span> : <span>{NOT_LEGAL_COMPLETENESS}</span>}
    </p>
  );
}

function CatalogTotals({ catalog, copy }: { catalog: BrowserCatalog; copy: ResultCopy }) {
  const boundaryDates = catalog.jurisdictions
    .filter((id) => id !== LAW_JURISDICTION_ID)
    .flatMap((id) => jurisdictionFreshness(catalog, id));
  return (
    <section data-field="totals" aria-label={copy.coverage}>
      <p data-field="legal-completeness" data-legal-completeness={catalog.legal_completeness}>
        legal_completeness {catalog.legal_completeness}. {NOT_LEGAL_COMPLETENESS}
      </p>
      <p data-field="law-freshness">{copy.as_of} {catalog.as_of}</p>
      <p data-field="boundary-freshness">
        {boundaryDates.length > 0 ? boundaryDates.map((date) => `${copy.as_of} ${date}`).join('. ') : FRESHNESS_UNKNOWN}
      </p>
      <p data-field="collection-count">Pinned law collections {catalog.collection_count}.</p>
      <p data-field="record-denominator">{catalog.record_denominator} viewer rows.</p>
      <p data-field="boundary-denominator">{catalog.boundary_record_denominator} metadata files. {DENOMINATOR_SEPARATION}</p>
      <p data-field="uncounted-collections">{uncountedLabel(catalog.uncounted_collections)}</p>
      <p data-field="denominator-note">{catalog.record_denominator_note}</p>
    </section>
  );
}

function UnavailableCoverage({
  problem,
  copy,
  search,
  searchInputId,
  draft,
  onDraft,
  onSubmit,
}: {
  problem: CatalogError;
  copy: ResultCopy;
  search: SearchReading;
  searchInputId: string;
  draft: string;
  onDraft: (value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <article className="wwl" lang={copy.lang} dir={copy.dir} data-page="coverage" data-state={pageState(search, 'unavailable', false)} data-search={search.kind} data-schema={COVERAGE_PAGE_SCHEMA}>
      <h1>{copy.coverage}</h1>
      <PageSearch id={searchInputId} copy={copy} draft={draft} onDraft={onDraft} onSubmit={onSubmit} />
      <SearchNotice search={search} />
      <p className="wwl-coverage" data-coverage="unavailable" data-field="catalog-error" data-error={problem.code}>
        {coverageLabel('unavailable', copy)}. {coverageLabel('unknown', copy)}. {NOT_A_FINDING}
      </p>
      <p className="wwl-applicability">{copy.applicability}</p>
      <div className="wwl-live" role="status" aria-live="polite" aria-atomic="true">{search.statement}</div>
    </article>
  );
}

export function CoveragePage({ catalog, placeId, query, hits, locale }: CoveragePageProps) {
  const copy = resultCopy(locale);
  const searchInputId = useId();
  const { draft, setDraft, setSubmitted, search } = usePageSearch(query, hits, copy);
  const problem = useMemo(() => catalogProblem(catalog), [catalog]);
  const place = typeof placeId === 'string' && placeId.trim() ? canonicalizePlaceId(placeId) : null;
  const municipal = catalog && !problem ? dominantMunicipal(catalogMunicipalStates(catalog)) : null;
  if (problem || !catalog) {
    return (
      <UnavailableCoverage
        problem={problem ?? new CatalogError('schema', 'catalog is missing')}
        copy={copy}
        search={search}
        searchInputId={searchInputId}
        draft={draft}
        onDraft={setDraft}
        onSubmit={() => setSubmitted(draft)}
      />
    );
  }
  const stablePlace = place && place.ok ? place.placeId : null;
  return (
    <article
      className="wwl"
      lang={copy.lang}
      dir={copy.dir}
      data-page="coverage"
      data-state={pageState(search, municipal, true)}
      data-search={search.kind}
      data-municipal={municipal ?? 'none'}
      data-legal-completeness={catalog.legal_completeness}
      data-schema={COVERAGE_PAGE_SCHEMA}
    >
      <h1>{copy.coverage}</h1>
      <PageSearch id={searchInputId} copy={copy} draft={draft} onDraft={setDraft} onSubmit={() => setSubmitted(draft)} />
      <SearchNotice search={search} />
      {stablePlace ? (
        <p data-field="place">
          <a href={placeHref(stablePlace, search.query)}>{stablePlace}</a>
        </p>
      ) : (
        <p data-field="coverage-not-a-result">{COVERAGE_NOT_A_RESULT}</p>
      )}
      {place && !place.ok ? <p data-field="place-issue">{place.message}</p> : null}
      <CatalogTotals catalog={catalog} copy={copy} />
      <MunicipalSummary catalog={catalog} />
      <CoverageMatrix catalog={catalog} copy={copy} anchor />
      <SourceIndex catalog={catalog} placeId={stablePlace} />
      <p className="wwl-applicability" data-applicability="not-asserted">{copy.applicability}</p>
      <NextControl search={search} municipal={municipal} copy={copy} searchInputId={searchInputId} />
      <div className="wwl-live" role="status" aria-live="polite" aria-atomic="true">
        {search.statement} {municipal ? municipalCopy(municipal, copy) : ''}
      </div>
    </article>
  );
}

export function renderLineage(steps: readonly LineageStep[]): ReactNode {
  return (
    <ol data-field="lineage">
      {steps.map((step) => (
        <li key={step.role} data-lineage={step.role} data-known={step.known ? 'true' : 'false'}>
          <span>{step.label}</span>
          {' '}
          <span className="wwl-identifier">{step.value}</span>
        </li>
      ))}
    </ol>
  );
}

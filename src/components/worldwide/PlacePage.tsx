/**
 * Place page.
 *
 * The place stays searchable when municipal coverage is missing or unknown.
 * A country or an unknown level does not invent a municipality. Catalog cells
 * stay labelled as catalog cells. An empty search is not a result about the law.
 */

import { useId, useMemo } from 'react';
import type { BrowserCatalog, CoverageState } from '../../lib/worldwide/data/catalog';
import { LAW_JURISDICTION_ID } from '../../lib/worldwide/data/catalog';
import { canonicalizePlaceId } from '../../lib/worldwide/routes';
import { resultCopy, type ResultLocale } from './SearchFilters';
import {
  CATALOG_NOT_THIS_PLACE,
  COVERAGE_PAGE_SCHEMA,
  CoverageMatrix,
  NextControl,
  NO_SOURCE_JOINED,
  NOT_A_FINDING,
  NOT_A_LICENSE,
  PageSearch,
  SearchNotice,
  SourceIndex,
  catalogProblem,
  coverageHref,
  findSource,
  pageState,
  placeMunicipalReading,
  searchHref,
  sourceHref,
  usePageSearch,
  type PlaceDescriptor,
} from './CoveragePage';
import '../../styles/worldwide.css';

export const PLACE_PAGE_SCHEMA = 'worldwide-legal-search.place-page@1';

export interface PlacePageProps {
  catalog: BrowserCatalog | null;
  place: PlaceDescriptor;
  query?: string | null;
  hits?: readonly unknown[] | null;
  locale?: ResultLocale | null;
  joinedSourceIds?: readonly string[] | null;
  municipalState?: CoverageState | null;
}

function clean(value: string | null | undefined): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || null;
}

export function PlacePage({
  catalog,
  place,
  query,
  hits,
  locale,
  joinedSourceIds,
  municipalState,
}: PlacePageProps) {
  const copy = resultCopy(locale);
  const searchInputId = useId();
  const { draft, setDraft, setSubmitted, search } = usePageSearch(query, hits, copy);
  const problem = useMemo(() => catalogProblem(catalog), [catalog]);
  const identity = canonicalizePlaceId(place.placeId);
  const reading = catalog && !problem
    ? placeMunicipalReading(catalog, place, joinedSourceIds, municipalState, copy)
    : {
      state: 'unknown' as const,
      sentence: `${copy.coverage_unknown}. ${NOT_A_FINDING}`,
      inventedMunicipality: false as const,
      joined: joinedSourceIds != null,
    };
  const name = clean(place.name);
  const level = clean(place.levelKind);
  const parents = place.parents ?? [];
  const placeId = identity.ok ? identity.placeId : place.placeId;
  const joined = joinedSourceIds ?? null;

  return (
    <article
      className="wwl"
      lang={copy.lang}
      dir={copy.dir}
      data-page="place"
      data-state={pageState(search, reading.state, !problem)}
      data-search={search.kind}
      data-municipal={reading.state}
      data-schema={PLACE_PAGE_SCHEMA}
      data-coverage-schema={COVERAGE_PAGE_SCHEMA}
      data-invented-municipality="false"
    >
      <header>
        <h1>{name ?? placeId}</h1>
        <p data-field="place-id" className="wwl-identifier">{identity.ok ? identity.placeId : place.placeId}</p>
        <p data-field="name">{name ?? 'Name unknown.'}</p>
        <p data-field="level">{level ?? copy.unknown}</p>
        {parents.length > 0 ? (
          <ol data-field="parents">
            {parents.map((parent) => (
              <li key={parent.placeId}>
                <span>{clean(parent.name) ?? parent.placeId}</span>
                {' '}
                <span>{clean(parent.levelKind) ?? copy.unknown}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p data-field="parents">Parent chain unknown.</p>
        )}
        {identity.ok ? null : <p data-field="place-issue">{identity.message}</p>}
      </header>
      <PageSearch id={searchInputId} copy={copy} draft={draft} onDraft={setDraft} onSubmit={() => setSubmitted(draft)} />
      <SearchNotice search={search} />
      <section aria-label={copy.laws_and_sources}>
        <h2>{copy.laws_and_sources}</h2>
        <p
          id="wwl-municipal-coverage"
          tabIndex={-1}
          className="wwl-coverage"
          data-scope="place"
          data-field="place-municipal"
          data-coverage={reading.state}
          data-level="municipal"
          data-joined={reading.joined ? 'true' : 'false'}
        >
          {copy.level_municipal}. {reading.sentence}
        </p>
        <p data-field="catalog-not-place">{CATALOG_NOT_THIS_PLACE}</p>
        {joined && joined.length === 0 ? <p data-field="joined-sources">{NO_SOURCE_JOINED}</p> : null}
        {joined && joined.length > 0 ? (
          <ul data-field="joined-sources">
            {joined.map((sourceId) => {
              const source = catalog && !problem ? findSource(catalog, sourceId) : null;
              return (
                <li key={sourceId} data-source={sourceId} data-known={source ? 'true' : 'false'}>
                  {source ? <a href={sourceHref(source.dataset_id, placeId)}>{source.dataset_id}</a> : <span>{sourceId}</span>}
                  {' '}
                  <span>{source ? `${source.resolved_revision} ${source.decision}` : copy.coverage_unknown}</span>
                  {' '}
                  <span>{copy.included_because} the search joined this source to the place.</span>
                </li>
              );
            })}
          </ul>
        ) : null}
      </section>
      {catalog && !problem ? (
        <>
          <p data-field="law-jurisdiction">{LAW_JURISDICTION_ID}</p>
          <CoverageMatrix catalog={catalog} copy={copy} anchor={false} />
          <SourceIndex catalog={catalog} placeId={identity.ok ? identity.placeId : null} />
        </>
      ) : (
        <p className="wwl-coverage" data-coverage="unavailable" data-field="catalog-error" data-error={problem?.code ?? 'schema'}>
          {copy.coverage_unavailable}. {copy.coverage_unknown}. {NOT_A_FINDING}
        </p>
      )}
      <p className="wwl-applicability" data-applicability="not-asserted">{copy.applicability}</p>
      <p>{copy.stack_limit}</p>
      <nav aria-label={copy.coverage}>
        <a href={coverageHref(identity.ok ? identity.placeId : null, search.query)}>{copy.coverage}</a>
        {' '}
        <a href={searchHref(identity.ok ? identity.placeId : null, search.query)}>{copy.search_label}</a>
      </nav>
      <p data-field="rights-note">{NOT_A_LICENSE}</p>
      <NextControl search={search} municipal={reading.state} copy={copy} searchInputId={searchInputId} />
      <div className="wwl-live" role="status" aria-live="polite" aria-atomic="true">
        {name ?? placeId}. {reading.sentence} {search.statement}
      </div>
    </article>
  );
}

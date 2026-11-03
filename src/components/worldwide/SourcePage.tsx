/**
 * Source page.
 *
 * Lineage is the inventory revision, the disposition revision, the pinned
 * source revision, and the rights record. Boundary sources also keep the
 * geography revision and the license, citation, and rollup digests.
 * Organization membership is not a license. An empty search is not a result
 * about the law, and a missing source stays unknown.
 */

import { useId, useMemo } from 'react';
import {
  LEVELS,
  type BrowserCatalog,
  type CatalogSource,
  type Level,
} from '../../lib/worldwide/data/catalog';
import { bandLabel, resultCopy, type ResultLocale } from './SearchFilters';
import {
  COVERAGE_PAGE_SCHEMA,
  CoverageCellView,
  FRESHNESS_UNKNOWN,
  NOT_A_FINDING,
  NOT_A_LICENSE,
  NOT_LEGAL_COMPLETENESS,
  NextControl,
  PageSearch,
  SearchNotice,
  catalogProblem,
  cellsForSource,
  coverageHref,
  dominantMunicipal,
  findSource,
  jurisdictionLabel,
  pageState,
  placeHref,
  renderLineage,
  sourceLineage,
  usePageSearch,
} from './CoveragePage';
import '../../styles/worldwide.css';

export const SOURCE_PAGE_SCHEMA = 'worldwide-legal-search.source-page@1';

export interface SourcePageProps {
  catalog: BrowserCatalog | null;
  sourceId: string;
  query?: string | null;
  hits?: readonly unknown[] | null;
  locale?: ResultLocale | null;
  placeId?: string | null;
}

function denominatorLine(source: CatalogSource, level: Level): string {
  const counted = source.counted_levels.includes(level);
  const value = source.level_denominators[level];
  if (!counted || typeof value !== 'number') return 'No known denominator.';
  const unit = source.denominator_kind === 'metadata-files' ? 'metadata files' : 'viewer rows';
  return `${value} ${unit}. This denominator is known. It is not legal completeness.`;
}

function sourceFreshness(catalog: BrowserCatalog, source: CatalogSource | null, copyAsOf: string): string {
  if (!source) return FRESHNESS_UNKNOWN;
  const dates: string[] = [];
  for (const cell of cellsForSource(catalog, source)) {
    if (cell.as_of && !dates.includes(cell.as_of)) dates.push(cell.as_of);
  }
  if (dates.length === 0) return FRESHNESS_UNKNOWN;
  return dates.map((date) => `${copyAsOf} ${date}`).join('. ');
}

export function SourcePage({ catalog, sourceId, query, hits, locale, placeId }: SourcePageProps) {
  const copy = resultCopy(locale);
  const searchInputId = useId();
  const { draft, setDraft, setSubmitted, search } = usePageSearch(query, hits, copy);
  const problem = useMemo(() => catalogProblem(catalog), [catalog]);
  const source = catalog && !problem ? findSource(catalog, sourceId) : null;
  const cells = catalog && !problem && source ? cellsForSource(catalog, source) : [];
  const municipal = dominantMunicipal(cells.filter((cell) => cell.level === 'municipal').map((cell) => cell.coverage_state));
  const steps = catalog && !problem ? sourceLineage(catalog, source) : [];
  const anchorId = cells.find((cell) => cell.level === 'municipal' && (cell.coverage_state === 'missing' || cell.coverage_state === 'unknown' || cell.coverage_state === 'unavailable'))
    ?? cells.find((cell) => cell.level === 'municipal')
    ?? null;

  return (
    <article
      className="wwl"
      lang={copy.lang}
      dir={copy.dir}
      data-page="source"
      data-state={pageState(search, source ? municipal : 'unknown', !problem)}
      data-search={search.kind}
      data-schema={SOURCE_PAGE_SCHEMA}
      data-coverage-schema={COVERAGE_PAGE_SCHEMA}
      data-source={sourceId}
      data-decision={source?.decision ?? 'unknown'}
    >
      <h1 className="wwl-identifier">{source?.dataset_id ?? sourceId}</h1>
      <PageSearch id={searchInputId} copy={copy} draft={draft} onDraft={setDraft} onSubmit={() => setSubmitted(draft)} />
      <SearchNotice search={search} />
      {problem || !catalog ? (
        <p className="wwl-coverage" data-coverage="unavailable" data-field="catalog-error" data-error={problem?.code ?? 'schema'}>
          {copy.coverage_unavailable}. {copy.coverage_unknown}. {NOT_A_FINDING}
        </p>
      ) : null}
      {catalog && !problem && !source ? (
        <p className="wwl-coverage" data-coverage="unknown" data-field="source-missing" data-level="municipal" id="wwl-municipal-coverage" tabIndex={-1}>
          {copy.coverage_unknown}. This source is not in the catalog. {NOT_A_FINDING}
        </p>
      ) : null}
      {source ? (
        <>
          <p data-field="decision">{source.decision}</p>
          <p data-field="revision" className="wwl-identifier">{source.resolved_revision}</p>
          <p data-field="jurisdiction">{jurisdictionLabel(catalog as BrowserCatalog, source.jurisdiction_id)}</p>
          <p data-field="rights">{source.rights_status}. {NOT_A_LICENSE}</p>
          <p data-field="capabilities">{source.capabilities.join(', ') || copy.unknown}</p>
          <p data-field="levels">{source.levels.map((level) => bandLabel(level, copy)).join(', ') || copy.unknown}</p>
          <p data-field="freshness">{sourceFreshness(catalog as BrowserCatalog, source, copy.as_of)}</p>
          <ul data-field="level-denominators">
            {LEVELS.map((level) => (
              <li
                key={level}
                data-level={level}
                data-counted={source.counted_levels.includes(level) ? 'true' : 'false'}
                data-known={typeof source.level_denominators[level] === 'number' && source.counted_levels.includes(level) ? 'true' : 'false'}
              >
                {bandLabel(level, copy)}. {denominatorLine(source, level)}
              </li>
            ))}
          </ul>
          {source.decision === 'exclude' ? (
            <p data-field="excluded">This source is excluded and is not counted in a coverage cell. {NOT_LEGAL_COMPLETENESS}</p>
          ) : null}
          {renderLineage(steps)}
          <div data-field="coverage-matrix" id="wwl-coverage-matrix" tabIndex={-1}>
            {cells.map((cell) => (
              <CoverageCellView
                key={`${cell.jurisdiction_id}:${cell.level}:${cell.capability}`}
                cell={cell}
                copy={copy}
                anchor={anchorId !== null && cell.jurisdiction_id === anchorId.jurisdiction_id && cell.level === anchorId.level && cell.capability === anchorId.capability}
              />
            ))}
          </div>
          {cells.length === 0 && source.decision !== 'exclude' ? (
            <p className="wwl-coverage" data-coverage="unknown" id="wwl-municipal-coverage" tabIndex={-1}>
              {copy.coverage_unknown}. This source has no coverage cell. {NOT_A_FINDING}
            </p>
          ) : null}
        </>
      ) : catalog && !problem ? renderLineage(steps) : null}
      <p className="wwl-applicability" data-applicability="not-asserted">{copy.applicability}</p>
      <nav aria-label={copy.coverage}>
        <a href={coverageHref(placeId, search.query)}>{copy.coverage}</a>
        {placeId ? <> <a href={placeHref(placeId, search.query)}>{copy.place}</a></> : null}
      </nav>
      <NextControl search={search} municipal={source ? municipal : 'unknown'} copy={copy} searchInputId={searchInputId} />
      <div className="wwl-live" role="status" aria-live="polite" aria-atomic="true">
        {source?.dataset_id ?? sourceId}. {search.statement} {NOT_A_LICENSE}
      </div>
    </article>
  );
}

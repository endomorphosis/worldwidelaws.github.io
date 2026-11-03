/**
 * Worldwide legal search shell.
 *
 * Place, as-of date, and language stay in the header. Search is the primary
 * act. The Netherlands research workspace stays behind the migration flag
 * and opens only after an explicit choice. Map, model, login, and proxy
 * stay off this screen. Nothing here decides that a law applies.
 */

import {
  Component,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { DUTCH_EXAMPLE_QUERIES, parseCivilDate, ROUTE_LIMITS, type RouteName } from '../../lib/worldwide/routes';
import '../../styles/worldwide.css';
import {
  SearchProvider,
  useSearchContext,
  type InterfaceLocale,
  type LoadLegacyNl,
  type SearchProviderProps,
} from './SearchContext';

const LOCALES: InterfaceLocale[] = ['en', 'nl', 'ar', 'ja'];

class LegacyBoundary extends Component<{ children: ReactNode; notice: string }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  render() {
    if (this.state.failed) return <p role="status">{this.props.notice}</p>;
    return this.props.children;
  }
}

function focusTarget(id: string) {
  const node = document.getElementById(id);
  if (node instanceof HTMLElement) node.focus();
}

function ShellView() {
  const shell = useSearchContext();
  const { copy, place } = shell;
  const placeInputId = useId();
  const placeListId = useId();
  const dateId = useId();
  const languageId = useId();
  const filterHeadingId = useId();
  const liveId = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const placeRef = useRef<HTMLInputElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [placeOpen, setPlaceOpen] = useState(false);
  const [placeDraft, setPlaceDraft] = useState('');
  const [activeOption, setActiveOption] = useState(0);
  const [dateDraft, setDateDraft] = useState<string | null>(null);
  const options = shell.placeOptions(placeDraft);
  const active = options[Math.min(activeOption, Math.max(options.length - 1, 0))] ?? null;
  const dateShown = dateDraft ?? place.asOf?.value ?? '';
  const page = place.route.name;

  useEffect(() => {
    document.title = copy.product;
    document.documentElement.lang = copy.lang;
    document.documentElement.dataset.wwlShell = 'worldwide';
  }, [copy.lang, copy.product]);

  useEffect(() => {
    if (shell.interaction === 'first-visit') searchRef.current?.focus();
  }, [shell.interaction]);

  useEffect(() => {
    if (shell.filtersOpen) headingRef.current?.focus();
  }, [shell.filtersOpen]);

  function commitPlace(option: { placeId: string | null; label: string } | null) {
    if (!option) return;
    if (option.placeId) shell.choosePlace(option.placeId, option.label === option.placeId ? null : option.label);
    setPlaceOpen(false);
    setPlaceDraft('');
    setActiveOption(0);
  }

  function onPlaceKey(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setPlaceOpen(true);
      setActiveOption((index) => Math.min(options.length - 1, index + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setPlaceOpen(true);
      setActiveOption((index) => Math.max(0, index - 1));
    } else if (event.key === 'Enter' && placeOpen) {
      event.preventDefault();
      commitPlace(active);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setPlaceOpen(false);
      setPlaceDraft('');
    }
  }

  function onSearch(event: FormEvent) {
    event.preventDefault();
    shell.submitQuery();
  }

  function onDate(value: string) {
    setDateDraft(value);
    if (value.trim() === '') shell.setAsOf(null);
    else if (parseCivilDate(value)) shell.setAsOf(value.trim());
  }

  function closeFilters() {
    shell.setFiltersOpen(false);
    toggleRef.current?.focus();
  }

  function trapFilters(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeFilters();
      return;
    }
    if (event.key !== 'Tab' || !dialogRef.current) return;
    const items = [...dialogRef.current.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href]')]
      .filter((node) => !node.hasAttribute('disabled'));
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function followNext() {
    if (shell.interaction === 'no-query') searchRef.current?.focus();
    else if (shell.interaction === 'changed-manual-location' || shell.interaction === 'approximate-suggestion') searchRef.current?.focus();
    else placeRef.current?.focus();
  }

  const dataScope = !place.placeId && place.origin === 'unselected' ? 'unselected' : place.scope;
  const Legacy = shell.legacy;

  return (
    <div
      className="wwl wwl-shell"
      lang={copy.lang}
      dir={copy.dir}
      data-state={shell.interaction}
      data-scope={dataScope}
      data-map="closed"
      data-model="idle"
      data-reader="closed"
      data-compare="closed"
      data-nl-migration={shell.nlMigration ? 'on' : 'off'}
      data-context="place as-of language"
    >
      <nav className="wwl-skip" aria-label={copy.pages}>
        <a href="#wwl-search" onClick={(event) => { event.preventDefault(); focusTarget('wwl-search'); }}>{copy.skip_to_search}</a>
        <a href="#wwl-results" onClick={(event) => { event.preventDefault(); focusTarget('wwl-results'); }}>{copy.skip_to_results}</a>
        <a href="#wwl-filters" onClick={(event) => { event.preventDefault(); focusTarget('wwl-filters'); }}>{copy.skip_to_filters}</a>
      </nav>
      <header className="wwl-sticky wwl-banner">
        <h1 className="wwl-product">{copy.product}</h1>
        <div className="wwl-context">
          <p className="wwl-place">{shell.placeLabel}</p>
          <p className="wwl-place-origin">{shell.originLabel}</p>
          <div className="wwl-field">
            <label htmlFor={placeInputId}>{copy.choose_place}</label>
            <input
              id={placeInputId}
              ref={placeRef}
              className="wwl-embed"
              role="combobox"
              type="text"
              aria-expanded={placeOpen}
              aria-controls={placeListId}
              aria-autocomplete="list"
              aria-activedescendant={placeOpen && active ? active.id : undefined}
              value={placeDraft}
              placeholder={copy.place_id_hint}
              onFocus={() => setPlaceOpen(true)}
              onChange={(event) => {
                setPlaceDraft(event.target.value);
                setPlaceOpen(true);
                setActiveOption(0);
              }}
              onKeyDown={onPlaceKey}
            />
            {placeOpen ? (
              <ul className="wwl-place-list" id={placeListId} role="listbox" aria-label={copy.place_list}>
                {options.length === 0 ? <li className="wwl-caption">{copy.place_id_hint}</li> : null}
                {options.map((option, index) => (
                  <li key={option.id} role="presentation">
                    <button
                      type="button"
                      role="option"
                      id={option.id}
                      aria-selected={index === activeOption}
                      data-active={index === activeOption ? 'true' : 'false'}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => commitPlace(option)}
                    >
                      <span>{option.label}</span>
                      <span className="wwl-caption">{option.detail}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <button
            type="button"
            className="wwl-change"
            onClick={() => {
              setPlaceOpen(true);
              placeRef.current?.focus();
            }}
          >
            {copy.change_place}
          </button>
          <div className="wwl-field wwl-date-field">
            <label htmlFor={dateId}>{copy.as_of}</label>
            <input
              id={dateId}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              spellCheck={false}
              value={dateShown}
              placeholder="YYYY-MM-DD"
              onFocus={() => setDateDraft(place.asOf?.value ?? '')}
              onChange={(event) => onDate(event.target.value)}
              onBlur={() => setDateDraft(null)}
            />
          </div>
          <div className="wwl-field wwl-language-field">
            <label htmlFor={languageId}>{copy.language}</label>
            <select
              id={languageId}
              value={shell.locale}
              onChange={(event) => shell.setLocale(event.target.value as InterfaceLocale)}
            >
              {LOCALES.map((locale) => (
                <option key={locale} value={locale}>{copy.language_name[locale]}</option>
              ))}
            </select>
          </div>
          <button type="button" className="wwl-save" onClick={() => shell.savePlace()}>{copy.save_place}</button>
        </div>
        <form className="wwl-search" role="search" onSubmit={onSearch}>
          <label htmlFor="wwl-search">{copy.search_label}</label>
          <input
            id="wwl-search"
            ref={searchRef}
            className="wwl-search-input"
            type="search"
            maxLength={ROUTE_LIMITS.query}
            placeholder={copy.search_placeholder}
            value={shell.query}
            onChange={(event) => shell.setQuery(event.target.value)}
          />
          <button type="submit">{copy.search_label}</button>
          {shell.nlMigration ? (
            <ul className="wwl-examples" aria-label={copy.examples}>
              {DUTCH_EXAMPLE_QUERIES.map((example) => (
                <li key={example}>
                  <button type="button" onClick={() => shell.applyExample(example)}>{example}</button>
                </li>
              ))}
            </ul>
          ) : null}
        </form>
        <div className="wwl-scope" role="radiogroup" aria-label={copy.scope_label}>
          <label>
            <input
              type="radio"
              name="wwl-scope"
              value="place"
              checked={place.scope === 'place' && Boolean(place.placeId)}
              onChange={() => shell.setScope('place')}
            />
            <span>{copy.this_place}</span>
          </label>
          <label>
            <input
              type="radio"
              name="wwl-scope"
              value="worldwide"
              checked={place.scope === 'worldwide' || !place.placeId}
              onChange={() => shell.setScope('worldwide')}
            />
            <span>{copy.search_worldwide}</span>
          </label>
        </div>
        <p className="wwl-counts">{copy.searched} {shell.searched} · {copy.remaining} {shell.remaining}</p>
        <div className="wwl-status">
          <p>{shell.status}</p>
          <p><button type="button" className="wwl-next" onClick={followNext}>{shell.nextAction}</button></p>
        </div>
        <nav className="wwl-nav" aria-label={copy.product}>
          <PageLink name="search" current={page} href={shell.href}>{copy.page_search}</PageLink>
          <PageLink name="place" current={page} href={shell.href} disabled={!place.placeId}>{copy.page_place}</PageLink>
          <PageLink name="coverage" current={page} href={shell.href}>{copy.page_coverage}</PageLink>
          <PageLink name="compare" current={page} href={shell.href}>{copy.page_compare}</PageLink>
          {place.route.recordId ? <PageLink name="law" current={page} href={shell.href}>{copy.page_law}</PageLink> : null}
          {place.route.sourceId ? <PageLink name="sources" current={page} href={shell.href}>{copy.page_sources}</PageLink> : null}
        </nav>
        {shell.nlMigration ? (
          <p>
            <button type="button" onClick={() => shell.openLegacy()}>{copy.open_legacy}</button>
          </p>
        ) : null}
      </header>
      <div className="wwl-body">
        <div className="wwl-workspace">
          <aside className="wwl-stack" aria-label={copy.laws_and_sources}>
            <h2>{copy.laws_and_sources}</h2>
            <ol>
              <li className="wwl-embed">{shell.placeLabel}</li>
            </ol>
            <p className="wwl-coverage" data-coverage={shell.coverage}>{copy.coverage}: {shell.coverageLabel}</p>
            <p className="wwl-applicability">{copy.applicability}</p>
          </aside>
          <main className="wwl-results" id="wwl-main">
            <h2 id="wwl-results" tabIndex={-1}>{pageHeading(page, copy)}</h2>
            {page === 'law' && place.route.recordId ? <p className="wwl-embed">{place.route.recordId}</p> : null}
            {page === 'sources' && place.route.sourceId ? <p className="wwl-embed">{place.route.sourceId}</p> : null}
            {shell.query.trim() && shell.interaction !== 'no-query' ? <p>{copy.unsearched}</p> : null}
            {shell.interaction === 'no-query' ? <p>{copy.empty_query}</p> : null}
            <ol aria-label={copy.results} />
            {Legacy ? (
              <LegacyBoundary notice={copy.legacy_unavailable}>
                <Legacy />
              </LegacyBoundary>
            ) : null}
            {shell.legacyNote ? <p role="status">{shell.legacyNote}</p> : null}
          </main>
          <div className="wwl-filters-slot">
            <button
              type="button"
              id="wwl-filters"
              ref={toggleRef}
              className="wwl-filters-toggle"
              aria-expanded={shell.filtersOpen}
              onClick={() => shell.setFiltersOpen(!shell.filtersOpen)}
            >
              {copy.filters}
            </button>
            <div
              className="wwl-filters"
              data-open={shell.filtersOpen ? 'true' : 'false'}
              role={shell.filtersOpen ? 'dialog' : undefined}
              aria-modal={shell.filtersOpen ? true : undefined}
              aria-labelledby={shell.filtersOpen ? filterHeadingId : undefined}
              ref={dialogRef}
              hidden={!shell.filtersOpen}
              onKeyDown={trapFilters}
            >
              <h2 id={filterHeadingId} tabIndex={-1} ref={headingRef}>{copy.filters}</h2>
              <div className="wwl-filter-grid">
                <label>
                  {copy.level}
                  <select value={shell.filters.level} onChange={(event) => shell.setFilters({ level: event.target.value as typeof shell.filters.level })}>
                    <option value="">{copy.any}</option>
                    <option value="national">{copy.level_national}</option>
                    <option value="regional">{copy.level_regional}</option>
                    <option value="municipal">{copy.level_municipal}</option>
                    <option value="other">{copy.level_other}</option>
                  </select>
                </label>
                <label>
                  {copy.topic}
                  <input type="text" value={shell.filters.topic} onChange={(event) => shell.setFilters({ topic: event.target.value })} />
                </label>
                <label>
                  {copy.instrument}
                  <input type="text" value={shell.filters.instrument} onChange={(event) => shell.setFilters({ instrument: event.target.value })} />
                </label>
                <label>
                  {copy.document_language}
                  <select value={shell.filters.language} onChange={(event) => shell.setFilters({ language: event.target.value })}>
                    <option value="">{copy.any}</option>
                    {LOCALES.map((locale) => (
                      <option key={locale} value={locale}>{copy.language_name[locale]}</option>
                    ))}
                  </select>
                </label>
                <label>
                  {copy.source}
                  <input type="text" value={shell.filters.source} onChange={(event) => shell.setFilters({ source: event.target.value })} />
                </label>
                <label>
                  {copy.date_status}
                  <input type="text" value={shell.filters.dateStatus} onChange={(event) => shell.setFilters({ dateStatus: event.target.value })} />
                </label>
              </div>
              <button type="button" onClick={closeFilters}>{copy.close_filters}</button>
            </div>
          </div>
        </div>
      </div>
      <div id={liveId} className="wwl-live" role="status" aria-live="polite" aria-atomic="true">{shell.announcement}</div>
    </div>
  );
}

function pageHeading(name: RouteName, copy: ReturnType<typeof useSearchContext>['copy']): string {
  if (name === 'place') return copy.page_place;
  if (name === 'coverage') return copy.page_coverage;
  if (name === 'compare') return copy.page_compare;
  if (name === 'law') return copy.page_law;
  if (name === 'sources') return copy.page_sources;
  return copy.results;
}

function PageLink({
  name,
  current,
  href,
  disabled,
  children,
}: {
  name: RouteName;
  current: RouteName;
  href: string;
  disabled?: boolean;
  children: string;
}) {
  const shell = useSearchContext();
  if (disabled) {
    return <span aria-disabled="true">{children}</span>;
  }
  return (
    <a
      href={href}
      aria-current={current === name ? 'page' : undefined}
      onClick={(event) => {
        event.preventDefault();
        shell.openRoute(name);
      }}
    >
      {children}
    </a>
  );
}

export interface WorldwideLegalSearchAppProps extends Omit<SearchProviderProps, 'children'> {
  loadLegacyNl?: LoadLegacyNl | null;
}

export default function WorldwideLegalSearchApp({
  loadLegacyNl = null,
  ...provider
}: WorldwideLegalSearchAppProps) {
  return (
    <SearchProvider {...provider} loadLegacyNl={loadLegacyNl}>
      <ShellView />
    </SearchProvider>
  );
}


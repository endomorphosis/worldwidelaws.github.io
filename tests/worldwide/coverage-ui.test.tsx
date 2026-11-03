/**
 * Place, source, and coverage pages.
 * Empty search stays a prompt. Missing and unknown municipal cells stay
 * different sentences. Denominators and freshness come from the catalog.
 */

import { readFileSync } from 'fs';
import { TextEncoder } from 'util';
import { jest } from '@jest/globals';

if (typeof globalThis.TextEncoder === 'undefined') {
  Object.assign(globalThis, { TextEncoder });
}
if (typeof globalThis.structuredClone !== 'function') {
  Object.assign(globalThis, {
    structuredClone: (value: unknown) => JSON.parse(JSON.stringify(value)),
  });
}
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { sha256HexUtf8 } from '../../src/lib/worldwide/data/identity';
import {
  LAW_JURISDICTION_ID,
  LEVELS,
  publishCatalog,
  type BrowserCatalog,
  type Decision,
} from '../../src/lib/worldwide/data/catalog';
import { resultCopy } from '../../src/components/worldwide/SearchFilters';
import {
  COUNTED_ZERO,
  COVERAGE_NOT_A_RESULT,
  COVERAGE_PAGE_SCHEMA,
  CoveragePage,
  DENOMINATOR_SEPARATION,
  NOT_A_FINDING,
  NOT_A_LICENSE,
  NO_MATCHES_NOT_A_FINDING,
  NO_MUNICIPALITY_ADDED,
  COUNTRY_DOES_NOT_CHOOSE_CITY,
  NOT_JOINED,
  knownDenominator,
  readSearch,
  textImpliesNoLaw,
} from '../../src/components/worldwide/CoveragePage';
import { PLACE_PAGE_SCHEMA, PlacePage } from '../../src/components/worldwide/PlacePage';
import { SOURCE_PAGE_SCHEMA, SourcePage } from '../../src/components/worldwide/SourcePage';

const LAW = 'endomorphosis/ipfs_fixture_laws';
const REGIONAL = 'endomorphosis/ipfs_fixture_regional';
const MUNICIPAL = 'endomorphosis/ipfs_fixture_municipal';
const EXCLUDED = 'endomorphosis/legal_scrapers';
const BOUNDARY = 'wmgeolab/geoBoundaries';
const COPY = resultCopy('en');

function dataset(id: string, revision: string, card: string, complete: boolean, rows: number | null): Record<string, unknown> {
  return {
    dataset_id: id,
    resolved_revision: revision,
    card: { sha256: card },
    files: [{ sha256: card }],
    file_record: { complete },
    sizes: rows === null ? undefined : { num_rows: rows },
    access_error: null,
    gated: false,
    private: false,
    disabled: false,
  };
}

function row(id: string, family: string | null, decision: Decision, reason: string, capabilities: string[], revision: string): Record<string, unknown> {
  const value: Record<string, unknown> = {
    dataset_id: id,
    decision,
    reason,
    schema_capabilities: capabilities,
    resolved_revision: revision,
  };
  if (family) value.family = family;
  return value;
}

function publishFixture(municipalBoundary: 'partial' | 'unknown'): BrowserCatalog {
  const inventory = {
    schema: 'worldwide-legal-search.source-inventory@1',
    retrieved_at: '2026-10-30T09:39:25.250Z',
    organizations: [
      {
        datasets: [
          dataset(LAW, 'a'.repeat(40), 'b'.repeat(64), true, 5),
          dataset(REGIONAL, 'c'.repeat(40), 'd'.repeat(64), false, null),
          dataset(MUNICIPAL, 'e'.repeat(40), 'f'.repeat(64), false, 2),
          dataset(EXCLUDED, '1'.repeat(40), '2'.repeat(64), true, null),
        ],
      },
    ],
  };
  const inventoryText = JSON.stringify(inventory);
  const inventoryHash = sha256HexUtf8(inventoryText);
  const dispositions = {
    schema: 'worldwide-legal-search.source-dispositions@1',
    inventory_revision: inventoryHash,
    dispositions: [
      row(LAW, 'national', 'include', 'Included as national law text. The repository id was not used.', ['laws', 'text'], 'a'.repeat(40)),
      row(REGIONAL, 'regional', 'include', 'Included as regional law text. The repository id was not used.', ['text'], 'c'.repeat(40)),
      row(EXCLUDED, 'national', 'exclude', 'Excluded as a code-only release for the national collector role.', ['code'], '1'.repeat(40)),
    ],
    unassigned: [
      row(MUNICIPAL, null, 'blocked', 'No administrative level was established.', ['laws'], 'e'.repeat(40)),
    ],
  };
  const dispositionText = JSON.stringify(dispositions);
  const dispositionHash = sha256HexUtf8(dispositionText);
  const rights = {
    schema: 'worldwide-legal-search.rights@1',
    inventory_revision: inventoryHash,
    disposition_revision: dispositionHash,
    records: [
      { dataset_id: LAW, artifact_revision: 'a'.repeat(40), card_sha256: 'b'.repeat(64), status: 'resolved', inferred_from_organization: false, rights: 'CC0-1.0' },
      { dataset_id: REGIONAL, artifact_revision: 'c'.repeat(40), card_sha256: 'd'.repeat(64), status: 'unresolved', inferred_from_organization: false, rights: null },
      { dataset_id: MUNICIPAL, artifact_revision: 'e'.repeat(40), card_sha256: 'f'.repeat(64), status: 'unresolved', inferred_from_organization: false, rights: null },
      { dataset_id: EXCLUDED, artifact_revision: '1'.repeat(40), card_sha256: '2'.repeat(64), status: 'resolved', inferred_from_organization: false, rights: 'AGPL-3.0' },
    ],
  };
  const unknownMunicipal = municipalBoundary === 'unknown';
  const geography = {
    dataset_id: BOUNDARY,
    revision: '9'.repeat(40),
    municipality_detail: unknownMunicipal ? 'unavailable' : 'partial',
    complete_world: false,
    hierarchical: true,
    source: {
      acquired_on: '2026-10-30',
      committed_at: '2023-09-13T20:20:48Z',
      license_file_sha256: 'a'.repeat(64),
      citation_file_sha256: 'b'.repeat(64),
    },
    census: {
      metadata_files: 4,
      country_directories: 3,
      by_level: { ADM0: 2, ADM1: 1, ADM2: 1, ADM3: 0, ADM4: 0, ADM5: 0 },
      municipal_files: unknownMunicipal ? 0 : 1,
      open_municipal_files: unknownMunicipal ? 0 : 1,
      missing_adm0: ['PRI'],
      metadata_rollup_sha256: 'c'.repeat(64),
    },
  };
  return publishCatalog({
    inventoryText,
    dispositionText,
    rightsText: JSON.stringify(rights),
    geographyText: JSON.stringify(geography),
  });
}

function catalogCell(jurisdiction: string, level: string, capability: string): HTMLElement {
  const node = document.querySelector(
    `[data-scope="catalog"][data-jurisdiction="${jurisdiction}"][data-level="${level}"][data-capability="${capability}"]`,
  );
  if (!node) throw new Error(`missing cell ${jurisdiction} ${level} ${capability}`);
  return node as HTMLElement;
}

function assertNoLawClaim(root: ParentNode = document.body) {
  expect(textImpliesNoLaw(root.textContent ?? '')).toBe(false);
}

const fetchHost = globalThis as { fetch?: typeof fetch };
let originalFetch: typeof fetch | undefined;

beforeEach(() => {
  originalFetch = fetchHost.fetch;
  fetchHost.fetch = jest.fn(() => Promise.reject(new Error('coverage pages must not fetch'))) as typeof fetch;
});

afterEach(() => {
  fetchHost.fetch = originalFetch;
});

describe('coverage register', () => {
  const catalog = publishFixture('unknown');

  test('groups every jurisdiction and level and keeps freshness with known denominators', () => {
    render(<CoveragePage catalog={catalog} />);
    expect(document.querySelector('[data-page="coverage"]')).toHaveAttribute('data-schema', COVERAGE_PAGE_SCHEMA);
    expect(document.querySelector('[data-legal-completeness="not_claimed"]')).toBeTruthy();
    expect(screen.getByText(catalog.record_denominator_note)).toBeInTheDocument();
    expect(document.querySelector('[data-field="record-denominator"]')).toHaveTextContent(`${catalog.record_denominator} viewer rows`);
    expect(document.querySelector('[data-field="boundary-denominator"]')).toHaveTextContent(`${catalog.boundary_record_denominator} metadata files`);
    expect(document.querySelector('[data-field="boundary-denominator"]')).toHaveTextContent(DENOMINATOR_SEPARATION);
    expect(document.querySelector('[data-field="law-freshness"]')).toHaveTextContent('2026-10-30T09:39:25.250Z');
    expect(document.querySelector('[data-field="boundary-freshness"]')).toHaveTextContent('2026-10-30');
    expect(screen.getByText(COVERAGE_NOT_A_RESULT)).toBeInTheDocument();
    for (const jurisdiction of catalog.jurisdictions) {
      const section = document.querySelector(`[data-field="coverage-matrix"] [data-jurisdiction="${jurisdiction}"]`);
      expect(section).toBeTruthy();
      for (const level of LEVELS) {
        expect(section?.querySelector(`[data-level="${level}"]`)).toBeTruthy();
        const rollup = document.querySelector(`[data-field="known-denominator"][data-jurisdiction="${jurisdiction}"][data-level="${level}"]`);
        const expected = knownDenominator(catalog, jurisdiction, level);
        expect(rollup).toHaveAttribute('data-known', expected.known ? 'true' : 'false');
        const freshness = document.querySelector(`[data-field="freshness"][data-jurisdiction="${jurisdiction}"][data-level="${level}"]`);
        expect(freshness?.textContent).toMatch(/As of|Freshness unknown/);
      }
    }
    const national = document.querySelector(`[data-field="known-denominator"][data-jurisdiction="${LAW_JURISDICTION_ID}"][data-level="national"]`);
    expect(national).toHaveTextContent('5 viewer rows');
    expect(national?.textContent).not.toContain('10 viewer rows');
    const boundaryNational = document.querySelector(`[data-field="known-denominator"][data-jurisdiction="${BOUNDARY}"][data-level="national"]`);
    expect(boundaryNational).toHaveTextContent('2 metadata files');
    expect(boundaryNational?.textContent).not.toContain('viewer rows');
    expect(fetchHost.fetch).not.toHaveBeenCalled();
    assertNoLawClaim();
  });

  test('states a missing municipal cell and an unknown municipal cell differently', () => {
    render(<CoveragePage catalog={catalog} />);
    const missing = catalogCell(LAW_JURISDICTION_ID, 'municipal', 'text');
    expect(missing).toHaveAttribute('data-coverage', 'missing');
    expect(missing).toHaveAttribute('data-denominator-known', 'false');
    expect(missing).toHaveTextContent(COPY.coverage_missing);
    expect(missing).toHaveTextContent(COPY.municipal_gap);
    expect(missing).toHaveTextContent('Denominator not counted');
    expect(missing.textContent).not.toContain('0 viewer rows');
    expect(missing.textContent).not.toContain(COPY.coverage_unknown);

    const unknown = catalogCell(BOUNDARY, 'municipal', 'boundary');
    expect(unknown).toHaveAttribute('data-coverage', 'unknown');
    expect(unknown).toHaveAttribute('data-denominator-known', 'false');
    expect(unknown).toHaveTextContent(COPY.coverage_unknown);
    expect(unknown).toHaveTextContent(NOT_A_FINDING);
    expect(unknown.textContent).not.toContain(COPY.coverage_missing);
    expect(unknown.textContent).not.toContain('No municipal collection is in the catalog');
    expect(document.querySelector('[data-field="municipal-missing-count"]')).toBeTruthy();
    expect(document.querySelector('[data-field="municipal-unknown-count"]')).toBeTruthy();
    expect(document.getElementById('wwl-municipal-coverage')).toHaveAttribute('data-coverage', 'missing');
    assertNoLawClaim();
  });

  test('shows the known law denominator and the partial uncounted cell without a second corpus', () => {
    render(<CoveragePage catalog={catalog} />);
    const laws = catalogCell(LAW_JURISDICTION_ID, 'national', 'laws');
    expect(laws).toHaveAttribute('data-coverage', 'known');
    expect(laws).toHaveAttribute('data-denominator-known', 'true');
    expect(laws).toHaveAttribute('data-as-of', '2026-10-30T09:39:25.250Z');
    expect(laws).toHaveTextContent('5 viewer rows');
    expect(laws).toHaveTextContent('This denominator is known');
    const text = catalogCell(LAW_JURISDICTION_ID, 'national', 'text');
    expect(text).toHaveTextContent('5 viewer rows');
    const regional = catalogCell(LAW_JURISDICTION_ID, 'regional', 'text');
    expect(regional).toHaveAttribute('data-coverage', 'partial');
    expect(regional).toHaveAttribute('data-denominator-known', 'false');
    expect(regional).toHaveTextContent(COUNTED_ZERO);
    const rollup = document.querySelector(`[data-field="known-denominator"][data-jurisdiction="${LAW_JURISDICTION_ID}"][data-level="regional"]`);
    expect(rollup).toHaveAttribute('data-known', 'false');
    expect(rollup).toHaveTextContent('No known denominator at this level.');
    assertNoLawClaim();
  });

  test('an empty search is not a result, including when a hit list is empty', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<CoveragePage catalog={catalog} query="   " hits={[]} />);
    expect(document.querySelector('[data-page="coverage"]')).toHaveAttribute('data-state', 'no-query');
    expect(document.querySelector('[data-page="coverage"]')).toHaveAttribute('data-search', 'empty');
    expect(document.querySelector('[data-field="search-statement"]')).toHaveTextContent(COPY.empty_query);
    expect(document.body.textContent).not.toContain('No matches in the collections');
    expect(readSearch('  ', [], COPY).kind).toBe('empty');
    await user.clear(screen.getByRole('searchbox'));
    await user.click(screen.getByRole('button', { name: COPY.search_label }));
    expect(document.querySelector('[data-search="empty"]')).toBeTruthy();
    expect(document.body.textContent).not.toContain('No matches in the collections');
    await user.click(screen.getByRole('button', { name: COPY.next_query }));
    expect(document.activeElement).toHaveAttribute('type', 'search');
    rerender(<CoveragePage catalog={catalog} query="tax" />);
    expect(document.querySelector('[data-search="unsearched"]')).toBeTruthy();
    expect(document.querySelector('[data-field="search-statement"]')).toHaveTextContent(COPY.unsearched);
    expect(document.body.textContent).not.toContain(NO_MATCHES_NOT_A_FINDING);
    rerender(<CoveragePage catalog={catalog} query="tax" hits={[]} />);
    expect(document.querySelector('[data-field="search-statement"]')).toHaveTextContent(COPY.no_matches);
    expect(document.querySelector('[data-field="search-statement"]')).toHaveTextContent(NO_MATCHES_NOT_A_FINDING);
    assertNoLawClaim();
  });

  test('a catalog that claims legal completeness is unavailable', () => {
    const broken = structuredClone(catalog);
    broken.legal_completeness = 'complete' as BrowserCatalog['legal_completeness'];
    render(<CoveragePage catalog={broken} />);
    expect(document.querySelector('[data-error="legal_completeness"]')).toHaveAttribute('data-coverage', 'unavailable');
    expect(document.querySelector('[data-field="coverage-matrix"]')).toBeNull();
    expect(document.querySelector('[data-field="search-statement"]')).toHaveTextContent(COPY.empty_query);
    assertNoLawClaim();
  });

  test('links each source without treating organization membership as a license', () => {
    render(<CoveragePage catalog={catalog} placeId="place:amsterdam" />);
    expect(screen.queryByText(COVERAGE_NOT_A_RESULT)).not.toBeInTheDocument();
    const link = screen.getByRole('link', { name: LAW });
    expect(link.getAttribute('href')).toContain('/#/sources/endomorphosis%2Fipfs_fixture_laws');
    expect(link.closest('li')).toHaveTextContent(NOT_A_LICENSE);
    expect(screen.getByRole('link', { name: 'place:amsterdam' })).toHaveAttribute('href', expect.stringContaining('/#/place/place%3Aamsterdam'));
    assertNoLawClaim();
  });
});

describe('place page', () => {
  const catalog = publishFixture('unknown');
  const amsterdam = {
    placeId: 'place:amsterdam',
    name: 'Amsterdam',
    levelKind: 'municipality',
    parents: [
      { placeId: 'place:north-holland', name: 'North Holland', levelKind: 'province' },
      { placeId: 'place:netherlands', name: 'Netherlands', levelKind: 'country' },
    ],
  };

  test('keeps an unjoined municipality unknown and a joined empty list missing', () => {
    const { rerender } = render(<PlacePage catalog={catalog} place={amsterdam} />);
    expect(document.querySelector('[data-page="place"]')).toHaveAttribute('data-schema', PLACE_PAGE_SCHEMA);
    const placeCell = document.querySelector('[data-scope="place"]') as HTMLElement;
    expect(placeCell).toHaveAttribute('data-coverage', 'unknown');
    expect(placeCell).toHaveAttribute('data-joined', 'false');
    expect(placeCell).toHaveTextContent(NOT_JOINED);
    expect(placeCell).toHaveTextContent(COPY.coverage_unknown);
    expect(placeCell).toHaveTextContent(NOT_A_FINDING);
    expect(placeCell.textContent).not.toContain(COPY.coverage_missing);
    expect(screen.getByRole('heading', { name: 'Amsterdam' })).toBeInTheDocument();
    expect(screen.getByText(COPY.laws_and_sources)).toBeInTheDocument();
    expect(screen.getByText('North Holland')).toBeInTheDocument();
    expect(document.querySelector(`[data-level="national"]`)).toBeTruthy();
    expect(document.querySelector(`[data-level="regional"]`)).toBeTruthy();
    rerender(<PlacePage catalog={catalog} place={amsterdam} joinedSourceIds={[]} />);
    const missing = document.querySelector('[data-scope="place"]') as HTMLElement;
    expect(missing).toHaveAttribute('data-coverage', 'missing');
    expect(missing).toHaveTextContent(COPY.municipal_gap);
    expect(screen.getByText('No source was joined to this place.')).toBeInTheDocument();
    assertNoLawClaim();
  });

  test('does not invent a municipality for an unknown level or a country code', () => {
    const { rerender } = render(
      <PlacePage catalog={catalog} place={{ placeId: 'place:border-point', name: null, levelKind: 'unknown' }} />,
    );
    const unknown = document.querySelector('[data-scope="place"]') as HTMLElement;
    expect(unknown).toHaveAttribute('data-coverage', 'unknown');
    expect(unknown).toHaveTextContent(NO_MUNICIPALITY_ADDED);
    expect(unknown.textContent).not.toContain(COPY.coverage_missing);
    expect(document.querySelector('[data-invented-municipality="false"]')).toBeTruthy();
    rerender(<PlacePage catalog={catalog} place={{ placeId: 'place:netherlands', name: 'Netherlands', levelKind: 'country' }} />);
    const country = document.querySelector('[data-scope="place"]') as HTMLElement;
    expect(country).toHaveTextContent(COUNTRY_DOES_NOT_CHOOSE_CITY);
    expect(country).toHaveAttribute('data-coverage', 'unknown');
    expect(country.textContent).not.toContain(COPY.coverage_missing);
    rerender(<PlacePage catalog={catalog} place={{ placeId: 'NL', levelKind: 'country' }} />);
    expect(screen.getByText(/No city was selected/)).toBeInTheDocument();
    expect(document.querySelector('[data-invented-municipality="false"]')).toBeTruthy();
    assertNoLawClaim();
  });

  test('an empty search does not become no matches, and the municipal gap can take focus', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<PlacePage catalog={catalog} place={amsterdam} query="" hits={[]} joinedSourceIds={[]} />);
    expect(document.querySelector('[data-page="place"]')).toHaveAttribute('data-search', 'empty');
    expect(document.querySelector('[data-page="place"]')).toHaveAttribute('data-state', 'no-query');
    expect(document.querySelector('[data-field="search-statement"]')).toHaveTextContent(COPY.empty_query);
    expect(document.body.textContent).not.toContain('No matches in the collections');
    rerender(<PlacePage catalog={catalog} place={amsterdam} query="tax" hits={[]} joinedSourceIds={[]} />);
    expect(document.querySelector('[data-field="search-statement"]')).toHaveTextContent(NO_MATCHES_NOT_A_FINDING);
    rerender(<PlacePage catalog={catalog} place={amsterdam} query="tax" hits={[{ id: 'row' }]} joinedSourceIds={[]} />);
    await user.click(screen.getByRole('button', { name: COPY.next_municipal }));
    expect(document.activeElement).toHaveAttribute('id', 'wwl-municipal-coverage');
    expect(document.activeElement).toHaveAttribute('data-coverage', 'missing');
    expect(screen.getByText(COPY.applicability)).toBeInTheDocument();
    expect(screen.getByText(COPY.stack_limit)).toBeInTheDocument();
    assertNoLawClaim();
  });
});

describe('source page', () => {
  const catalog = publishFixture('unknown');

  test('shows law lineage and keeps boundary lineage on its own digests', () => {
    const { rerender } = render(<SourcePage catalog={catalog} sourceId={LAW} />);
    expect(document.querySelector('[data-page="source"]')).toHaveAttribute('data-schema', SOURCE_PAGE_SCHEMA);
    const roles = [...document.querySelectorAll('[data-field="lineage"] [data-lineage]')].map((node) => node.getAttribute('data-lineage'));
    expect(roles).toEqual(['inventory', 'disposition', 'revision', 'decision', 'rights', 'card']);
    expect(document.querySelector('[data-lineage="revision"]')).toHaveTextContent('a'.repeat(40));
    expect(document.querySelector('[data-lineage="inventory"]')).toHaveTextContent(catalog.inventory_revision);
    expect(document.querySelector('[data-lineage="disposition"]')).toHaveTextContent(catalog.disposition_revision);
    expect(document.querySelector('[data-field="rights"]')).toHaveTextContent(`resolved. ${NOT_A_LICENSE}`);
    expect(document.querySelector('[data-lineage="geography"]')).toBeNull();
    expect(catalogCell(LAW_JURISDICTION_ID, 'national', 'laws')).toHaveTextContent('5 viewer rows');
    expect(document.querySelector('[data-field="level-denominators"] [data-level="national"]')).toHaveAttribute('data-known', 'true');
    expect(document.querySelector('[data-field="level-denominators"] [data-level="municipal"]')).toHaveAttribute('data-known', 'false');
    expect(document.querySelector('[data-field="freshness"]')).toHaveTextContent('2026-10-30T09:39:25.250Z');

    rerender(<SourcePage catalog={catalog} sourceId={BOUNDARY} placeId="place:amsterdam" />);
    const boundaryRoles = [...document.querySelectorAll('[data-field="lineage"] [data-lineage]')].map((node) => node.getAttribute('data-lineage'));
    expect(boundaryRoles).toEqual(['inventory', 'disposition', 'revision', 'decision', 'rights', 'card', 'geography', 'license', 'citation', 'rollup']);
    expect(document.querySelector('[data-lineage="geography"]')).toHaveTextContent('9'.repeat(40));
    expect(document.querySelector('[data-lineage="license"]')).toHaveTextContent('a'.repeat(64));
    expect(document.querySelector('[data-lineage="rights"]')).toHaveTextContent(`absent. ${NOT_A_LICENSE}`);
    expect(catalogCell(BOUNDARY, 'municipal', 'boundary')).toHaveAttribute('data-coverage', 'unknown');
    expect(screen.getByRole('link', { name: COPY.place }).getAttribute('href')).toContain('/#/place/place%3Aamsterdam');
    assertNoLawClaim();
  });

  test('an unknown source and an excluded source do not become absence of law', () => {
    const { rerender } = render(<SourcePage catalog={catalog} sourceId="endomorphosis/not_in_catalog" query="" hits={[]} />);
    const missing = document.querySelector('[data-field="source-missing"]') as HTMLElement;
    expect(missing).toHaveAttribute('data-coverage', 'unknown');
    expect(missing).toHaveTextContent('This source is not in the catalog.');
    expect(missing).toHaveTextContent(NOT_A_FINDING);
    expect(document.querySelector('[data-page="source"]')).toHaveAttribute('data-search', 'empty');
    expect(document.querySelector('[data-field="search-statement"]')).toHaveTextContent(COPY.empty_query);
    expect(document.body.textContent).not.toContain('No matches in the collections');
    expect(document.querySelector('[data-lineage="revision"]')).toHaveTextContent('unknown');
    rerender(<SourcePage catalog={catalog} sourceId={EXCLUDED} query="code" />);
    expect(screen.getByText(/This source is excluded/)).toBeInTheDocument();
    expect(document.querySelector('[data-decision="exclude"]')).toBeTruthy();
    expect(document.querySelector('[data-field="search-statement"]')).toHaveTextContent(COPY.unsearched);
    expect(document.querySelector('[data-field="coverage-matrix"]')?.querySelector('[data-coverage]')).toBeNull();
    assertNoLawClaim();
  });
});

describe('pinned catalog', () => {
  test('exposes the revision-pinned register by jurisdiction, level, freshness, and denominator', () => {
    const catalog = publishCatalog({
      inventoryText: readFileSync('data/worldwide/source-inventory.json', 'utf8'),
      dispositionText: readFileSync('data/worldwide/source-dispositions.json', 'utf8'),
      rightsText: readFileSync('data/worldwide/rights.json', 'utf8'),
      geographyText: readFileSync('data/worldwide/geography-manifest.json', 'utf8'),
    });
    render(<CoveragePage catalog={catalog} />);
    expect(document.querySelector('[data-field="record-denominator"]')).toHaveTextContent(`${catalog.record_denominator} viewer rows`);
    expect(document.querySelector('[data-field="boundary-denominator"]')).toHaveTextContent(`${catalog.boundary_record_denominator} metadata files`);
    expect(document.querySelector('[data-field="law-freshness"]')).toHaveTextContent(catalog.as_of);
    expect(document.querySelector('[data-legal-completeness="not_claimed"]')).toBeTruthy();
    const municipal = catalog.cells.filter((cell) => cell.level === 'municipal');
    expect(municipal.length).toBeGreaterThan(0);
    const states = new Set(municipal.map((cell) => cell.coverage_state));
    expect(states.has('missing') || states.has('unknown')).toBe(true);
    for (const cell of municipal) {
      const node = catalogCell(cell.jurisdiction_id, cell.level, cell.capability);
      expect(node).toHaveAttribute('data-coverage', cell.coverage_state);
      expect(node).toHaveAttribute('data-as-of', cell.as_of);
      expect(node).toHaveTextContent(cell.coverage_state === 'known' ? COPY.coverage_known : cell.coverage_state === 'partial' ? COPY.coverage_partial : cell.coverage_state === 'missing' ? COPY.coverage_missing : cell.coverage_state === 'unavailable' ? COPY.coverage_unavailable : COPY.coverage_unknown);
      if (cell.coverage_state === 'missing') expect(node).toHaveTextContent(COPY.municipal_gap);
      if (cell.coverage_state === 'unknown') {
        expect(node).toHaveTextContent(NOT_A_FINDING);
        expect(node.textContent).not.toContain('No municipal collection is in the catalog');
      }
      expect(node).toHaveAttribute('data-denominator-known', cell.denominator_kind === 'not-counted' || (cell.uncounted_collections > 0 && cell.record_denominator === 0) ? 'false' : 'true');
    }
    expect(document.querySelector('[data-field="search-statement"]')).toHaveTextContent(COPY.empty_query);
    assertNoLawClaim();
    const source = catalog.sources.find((item) => item.decision === 'include' && item.denominator_kind === 'viewer-rows');
    expect(source).toBeTruthy();
    cleanup();
    render(<SourcePage catalog={catalog} sourceId={source?.dataset_id ?? ''} />);
    expect(document.querySelector('[data-lineage="revision"]')).toHaveTextContent(source?.resolved_revision ?? '');
    expect(document.querySelector('[data-lineage="inventory"]')).toHaveTextContent(catalog.inventory_revision);
    expect(document.body.textContent).toContain(NOT_A_LICENSE);
    assertNoLawClaim();
  }, 60000);
});

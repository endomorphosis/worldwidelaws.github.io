/**
 * Optional catalog claims.
 * publishCatalog copies interface_id and source_schema_id only when the
 * inventory row already has both non-empty strings. One field, neither field,
 * a blank, the row's own dataset id, or country-laws-ir-graphrag/v1 leaves
 * both keys off the catalog source.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TextEncoder } from 'node:util';
import { jest } from '@jest/globals';

if (typeof globalThis.TextEncoder === 'undefined') {
  Object.assign(globalThis, { TextEncoder });
}
if (typeof globalThis.structuredClone !== 'function') {
  Object.assign(globalThis, {
    structuredClone: (value: unknown) => JSON.parse(JSON.stringify(value)) as unknown,
  });
}

import { sha256HexUtf8 } from '../../src/lib/worldwide/data/identity';
import {
  CATALOG_SCHEMA,
  CatalogError,
  assertCatalogInvariants,
  publishCatalog,
  validateBrowserCatalog,
  type BrowserCatalog,
  type CatalogSource,
  type Decision,
} from '../../src/lib/worldwide/data/catalog';

const FIXTURE = 'endomorphosis/ipfs_fixture_laws';
const BOTH = 'endomorphosis/ipfs_fixture_both';
const INTERFACE_ONLY = 'endomorphosis/ipfs_fixture_interface';
const SCHEMA_ONLY = 'endomorphosis/ipfs_fixture_schema';
const BLANK = 'endomorphosis/ipfs_fixture_blank';
const NON_STRING = 'endomorphosis/ipfs_fixture_nonstring';
const NATIONAL = 'endomorphosis/world_national_law';
const NETHERLANDS = 'justicedao/wetwijzer_netherlands_legal_corpus';
const FORBIDDEN_PAIR = 'endomorphosis/ipfs_fixture_statute';
const DATASET_AS_SCHEMA = 'endomorphosis/ipfs_fixture_self';
const MUNICIPAL = 'endomorphosis/ipfs_fixture_municipal_schema';
const BOUNDARY = 'wmgeolab/geoBoundaries';
const FORBIDDEN_SCHEMA = 'country-laws-ir-graphrag/v1';

interface Spec {
  id: string;
  revision: string;
  card: string;
  claim?: Record<string, unknown>;
}

const SPECS: Spec[] = [
  { id: FIXTURE, revision: 'a'.repeat(40), card: 'b'.repeat(64) },
  {
    id: BOTH,
    revision: 'c'.repeat(40),
    card: 'd'.repeat(64),
    claim: { interface_id: '  legal-corpus.court@1  ', source_schema_id: '  unversioned  ' },
  },
  {
    id: INTERFACE_ONLY,
    revision: 'e'.repeat(40),
    card: 'f'.repeat(64),
    claim: { interface_id: 'legal-corpus.regulation@1' },
  },
  {
    id: SCHEMA_ONLY,
    revision: '1'.repeat(40),
    card: '2'.repeat(64),
    claim: { source_schema_id: 'live-cfr-source-processor-v1' },
  },
  {
    id: BLANK,
    revision: '3'.repeat(40),
    card: '4'.repeat(64),
    claim: { interface_id: '   ', source_schema_id: '' },
  },
  {
    id: NON_STRING,
    revision: '5'.repeat(40),
    card: '6'.repeat(64),
    claim: { interface_id: 4, source_schema_id: 'unversioned' },
  },
  { id: NATIONAL, revision: '7'.repeat(40), card: '8'.repeat(64) },
  { id: NETHERLANDS, revision: '9'.repeat(40), card: '0'.repeat(64) },
  {
    id: FORBIDDEN_PAIR,
    revision: 'ab'.repeat(20),
    card: 'cd'.repeat(32),
    claim: { interface_id: 'legal-corpus.law@1', source_schema_id: FORBIDDEN_SCHEMA },
  },
  {
    id: DATASET_AS_SCHEMA,
    revision: 'ef'.repeat(20),
    card: '12'.repeat(32),
    claim: { interface_id: 'legal-corpus.court@1', source_schema_id: DATASET_AS_SCHEMA },
  },
  {
    id: MUNICIPAL,
    revision: '34'.repeat(20),
    card: '56'.repeat(32),
    claim: {
      interface_id: ' legal-corpus.municipal-instrument@1 ',
      source_schema_id: ' world_municipal/schema.py ',
    },
  },
];

function dataset(spec: Spec): Record<string, unknown> {
  return {
    dataset_id: spec.id,
    resolved_revision: spec.revision,
    card: { sha256: spec.card },
    files: [{ sha256: spec.card }],
    file_record: { complete: true },
    sizes: { num_rows: 4 },
    access_error: null,
    gated: false,
    private: false,
    disabled: false,
    ...(spec.claim ?? {}),
  };
}

function row(spec: Spec): Record<string, unknown> {
  const value: Record<string, unknown> = {
    dataset_id: spec.id,
    decision: 'include' as Decision,
    reason: 'Included as national law text. The repository id was not used.',
    schema_capabilities: ['laws'],
    resolved_revision: spec.revision,
    family: 'national',
  };
  return value;
}

function publishClaimCatalog(): BrowserCatalog {
  const inventory = {
    schema: 'worldwide-legal-search.source-inventory@1',
    retrieved_at: '2026-10-30T09:39:25.250Z',
    organizations: [{ datasets: SPECS.map(dataset) }],
  };
  const inventoryText = JSON.stringify(inventory);
  const inventoryHash = sha256HexUtf8(inventoryText);
  const dispositions = {
    schema: 'worldwide-legal-search.source-dispositions@1',
    inventory_revision: inventoryHash,
    dispositions: SPECS.map(row),
    unassigned: [],
  };
  const dispositionText = JSON.stringify(dispositions);
  const dispositionHash = sha256HexUtf8(dispositionText);
  const rights = {
    schema: 'worldwide-legal-search.rights@1',
    inventory_revision: inventoryHash,
    disposition_revision: dispositionHash,
    records: SPECS.map((spec) => ({
      dataset_id: spec.id,
      artifact_revision: spec.revision,
      card_sha256: spec.card,
      status: 'resolved',
      inferred_from_organization: false,
      rights: 'CC0-1.0',
    })),
  };
  const geography = {
    dataset_id: BOUNDARY,
    revision: '78'.repeat(20),
    municipality_detail: 'partial',
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
      municipal_files: 1,
      open_municipal_files: 1,
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

function sourceById(catalog: BrowserCatalog, id: string): CatalogSource {
  const source = catalog.sources.find((item) => item.dataset_id === id);
  if (!source) throw new Error('missing source ' + id);
  return source;
}

function unmarked(source: CatalogSource): void {
  expect(Object.keys(source)).not.toContain('interface_id');
  expect(Object.keys(source)).not.toContain('source_schema_id');
}

describe('optional catalog claim', () => {
  test('copies both claim fields only when the inventory row already has both', () => {
    expect(CATALOG_SCHEMA).toBe('worldwide-legal-search.catalog@1');
    const catalogSource = readFileSync(fileURLToPath(new URL('../../src/lib/worldwide/data/catalog.ts', import.meta.url)), 'utf8');
    expect(catalogSource).not.toContain('hub-bindings');
    expect(catalogSource).not.toMatch(/\bfetch\s*\(/);
    assertCatalogInvariants();

    const previous = globalThis.fetch;
    const fetchSpy = jest.fn();
    globalThis.fetch = fetchSpy as typeof fetch;
    let catalog: BrowserCatalog;
    try {
      catalog = publishClaimCatalog();
    } finally {
      globalThis.fetch = previous;
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(catalog.schema).toBe('worldwide-legal-search.catalog@1');

    expect(sourceById(catalog, BOTH)).toMatchObject({
      interface_id: 'legal-corpus.court@1',
      source_schema_id: 'unversioned',
    });
    expect(sourceById(catalog, MUNICIPAL)).toMatchObject({
      interface_id: 'legal-corpus.municipal-instrument@1',
      source_schema_id: 'world_municipal/schema.py',
    });

    unmarked(sourceById(catalog, FIXTURE));
    unmarked(sourceById(catalog, INTERFACE_ONLY));
    unmarked(sourceById(catalog, SCHEMA_ONLY));
    unmarked(sourceById(catalog, BLANK));
    unmarked(sourceById(catalog, NON_STRING));
    unmarked(sourceById(catalog, NATIONAL));
    unmarked(sourceById(catalog, NETHERLANDS));
    unmarked(sourceById(catalog, FORBIDDEN_PAIR));
    unmarked(sourceById(catalog, DATASET_AS_SCHEMA));
    unmarked(sourceById(catalog, BOUNDARY));

    const published = JSON.stringify(catalog);
    expect(published).not.toContain(FORBIDDEN_SCHEMA);
    expect(published).not.toContain('legal-corpus.regulation@1');
    expect(published).not.toContain('live-cfr-source-processor-v1');
    expect(published).not.toContain('legal-corpus.law@1');

    const tampered = structuredClone(catalog);
    const marked = sourceById(tampered, BOTH);
    marked.interface_id = 'legal-corpus.caselaw@1';
    expect(() => validateBrowserCatalog(tampered)).toThrow(CatalogError);
  });
});

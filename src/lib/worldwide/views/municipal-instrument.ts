/**
 * Site municipal instrument view.
 *
 * Exports `worldwide-legal-search.municipal-instrument-view@1` bound to
 * `legal-corpus.municipal-instrument@1`. The 19 canonical columns are
 * `EXPECTED_COLUMNS` in `world_municipal/schema.py`, in that order.
 * That file assigns no `SCHEMA_VERSION`. The source citation is
 * `SOURCE_SCHEMA_FILE` in `kinds/municipal_instrument_v1.py` and
 * `adapters/world_municipal_v1.py`: `world_municipal/schema.py`.
 *
 * Trailing provenance columns are accepted only after those 19. The schema
 * docstring names `tipo` as that column-20 example. A NULL is refused and
 * is not displayed as `""`. `validate_table` reports NULL as a failure and
 * says missing values serialize as `""`. `accept_municipal_row` rejects
 * `NULL in string column`. A missing canonical column is refused. This
 * module does not reorder columns and does not coerce NULL to `""`.
 * `doc_order` stays an integer.
 *
 * The view id and the kind version are the exports in `contract.ts`.
 * This module does not assign a second schema id.
 */

import { LAW_SOURCE_SCHEMA } from '../data/schema';
import { CORPUS_SCHEMA_VERSION } from '../data/identity';
import { KIND_VERSIONS, MUNICIPAL_INSTRUMENT_VIEW_ID } from './contract';

function pinned(actual: string, expected: string, label: string): string {
  if (actual !== expected) {
    throw new Error(`${label} is ${actual}, not ${expected}`);
  }
  return actual;
}

export const MUNICIPAL_INSTRUMENT_VIEW_SCHEMA = pinned(
  MUNICIPAL_INSTRUMENT_VIEW_ID,
  'worldwide-legal-search.municipal-instrument-view@1',
  'MUNICIPAL_INSTRUMENT_VIEW_ID',
);
export const MUNICIPAL_KIND_VERSION = pinned(
  KIND_VERSIONS.municipal_instrument,
  'legal-corpus.municipal-instrument@1',
  'KIND_VERSIONS.municipal_instrument',
);
/** `SOURCE_SCHEMA_FILE`. `world_municipal/schema.py` assigns no SCHEMA_VERSION. */
export const MUNICIPAL_SOURCE_SCHEMA_FILE = 'world_municipal/schema.py' as const;
export const REFUSED_LAW_KIND_VERSION = pinned(
  KIND_VERSIONS.law,
  'legal-corpus.law@1',
  'KIND_VERSIONS.law',
);
export const REFUSED_LAW_SOURCE_SCHEMA = pinned(
  LAW_SOURCE_SCHEMA,
  'worldwide-legal-search.law-source@1',
  'LAW_SOURCE_SCHEMA',
);
export const STATUTE_SCHEMA_ID = pinned(
  CORPUS_SCHEMA_VERSION,
  'country-laws-ir-graphrag/v1',
  'CORPUS_SCHEMA_VERSION',
);

/**
 * `EXPECTED_COLUMNS` in `world_municipal/schema.py`. Index 7 is `doc_order`.
 * The view model keeps this order. Trailing names follow it.
 */
export const MUNICIPAL_COLUMNS = [
  'cid',
  'jurisdiction_id',
  'jurisdiction_name',
  'country',
  'doc_id',
  'regeling_id',
  'regeling_work_id',
  'doc_order',
  'title',
  'structural_path',
  'node_label',
  'html_title',
  'html',
  'text',
  'source_url',
  'xml_url',
  'date_effective',
  'date_modified',
  'retrieved',
] as const;

/** Docstring example: Portugal appends `tipo` after column 19. */
export const TRAILING_PROVENANCE_EXAMPLE = 'tipo' as const;

export type MunicipalColumn = (typeof MUNICIPAL_COLUMNS)[number];

const CANONICAL_WIDTH = MUNICIPAL_COLUMNS.length;
const DOC_ORDER: MunicipalColumn = 'doc_order';

export const municipalInstrumentView = {
  renders: [MUNICIPAL_INSTRUMENT_VIEW_SCHEMA] as const,
  kindVersion: MUNICIPAL_KIND_VERSION,
  sourceSchemaFile: MUNICIPAL_SOURCE_SCHEMA_FILE,
  columns: MUNICIPAL_COLUMNS,
  trailingProvenanceExample: TRAILING_PROVENANCE_EXAMPLE,
  refuses: [REFUSED_LAW_KIND_VERSION, REFUSED_LAW_SOURCE_SCHEMA, STATUTE_SCHEMA_ID] as const,
} as const;

export class MunicipalInstrumentViewRefused extends Error {
  readonly version: string;

  constructor(version: string, message?: string) {
    super(message ?? `municipal instrument view refuses ${version}`);
    this.name = 'MunicipalInstrumentViewRefused';
    this.version = version;
  }
}

export interface MunicipalInstrumentViewInput {
  interfaceId?: unknown;
  interface_id?: unknown;
  kindVersion?: unknown;
  kind_version?: unknown;
  sourceSchemaId?: unknown;
  source_schema_id?: unknown;
  sourceSchemaVersion?: unknown;
  source_schema_version?: unknown;
  schema?: unknown;
  row?: unknown;
  sourceRow?: unknown;
  source_row?: unknown;
}

export interface MunicipalInstrumentViewModel {
  schema: typeof MUNICIPAL_INSTRUMENT_VIEW_SCHEMA;
  kindVersion: typeof MUNICIPAL_KIND_VERSION;
  sourceSchemaId: typeof MUNICIPAL_SOURCE_SCHEMA_FILE;
  row: Record<string, unknown>;
}

function textClaim(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function claims(input: MunicipalInstrumentViewInput): string[] {
  return [
    input.interfaceId,
    input.interface_id,
    input.kindVersion,
    input.kind_version,
    input.sourceSchemaId,
    input.source_schema_id,
    input.sourceSchemaVersion,
    input.source_schema_version,
    input.schema,
  ].map(textClaim).filter((item) => item.length > 0);
}

function mapping(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function refuseSurface(version: string): void {
  if (version === REFUSED_LAW_KIND_VERSION) {
    throw new MunicipalInstrumentViewRefused(REFUSED_LAW_KIND_VERSION, 'municipal view refuses a law row');
  }
  if (version === REFUSED_LAW_SOURCE_SCHEMA) {
    throw new MunicipalInstrumentViewRefused(
      REFUSED_LAW_SOURCE_SCHEMA,
      'municipal view does not render through law-source@1',
    );
  }
  if (version === STATUTE_SCHEMA_ID) {
    throw new MunicipalInstrumentViewRefused(STATUTE_SCHEMA_ID, 'statute schema id is rejected');
  }
}

function requireStringColumn(name: string, value: unknown): string {
  if (value === null) {
    throw new MunicipalInstrumentViewRefused(name, `NULL in string column ${name}`);
  }
  if (typeof value !== 'string') {
    throw new MunicipalInstrumentViewRefused(name, `${name} must be a string`);
  }
  return value;
}

function requireDocOrder(value: unknown): number {
  if (typeof value === 'boolean' || typeof value !== 'number' || !Number.isInteger(value)) {
    throw new MunicipalInstrumentViewRefused(DOC_ORDER, 'doc_order stays an integer');
  }
  return value;
}

/**
 * Render one municipal row.
 *
 * The first 19 keys must be `MUNICIPAL_COLUMNS`. A later key is provenance
 * and stays after those 19. NULL is not written as `""`. A missing
 * canonical name is refused before a model is built.
 */
export function renderMunicipalInstrumentView(
  input: MunicipalInstrumentViewInput,
): MunicipalInstrumentViewModel {
  const seen = claims(input);
  for (const version of seen) {
    refuseSurface(version);
  }
  const interfaceId = textClaim(input.interfaceId)
    || textClaim(input.interface_id)
    || textClaim(input.kindVersion)
    || textClaim(input.kind_version);
  if (interfaceId !== MUNICIPAL_KIND_VERSION) {
    throw new MunicipalInstrumentViewRefused(
      interfaceId,
      `municipal instrument view renders ${MUNICIPAL_KIND_VERSION}`,
    );
  }
  const claimedSchema = textClaim(input.sourceSchemaId)
    || textClaim(input.source_schema_id)
    || textClaim(input.sourceSchemaVersion)
    || textClaim(input.source_schema_version);
  if (claimedSchema !== MUNICIPAL_SOURCE_SCHEMA_FILE) {
    throw new MunicipalInstrumentViewRefused(
      claimedSchema,
      'source schema id does not cite world_municipal/schema.py',
    );
  }
  const row = mapping(input.row) ?? mapping(input.sourceRow) ?? mapping(input.source_row);
  if (row === null) {
    throw new MunicipalInstrumentViewRefused(
      MUNICIPAL_KIND_VERSION,
      'municipal row must be a mapping',
    );
  }
  for (const name of MUNICIPAL_COLUMNS) {
    if (!Object.prototype.hasOwnProperty.call(row, name)) {
      throw new MunicipalInstrumentViewRefused(name, `missing canonical column ${name}`);
    }
  }
  const keys = Object.keys(row);
  const prefix = keys.slice(0, CANONICAL_WIDTH);
  if (prefix.length !== CANONICAL_WIDTH || prefix.some((key, index) => key !== MUNICIPAL_COLUMNS[index])) {
    throw new MunicipalInstrumentViewRefused(
      prefix[0] ?? '',
      'canonical columns must be the first 19 in order; extra columns are only allowed after those 19',
    );
  }
  const copy: Record<string, unknown> = {};
  for (let index = 0; index < CANONICAL_WIDTH; index += 1) {
    const name = MUNICIPAL_COLUMNS[index];
    const value = row[name];
    copy[name] = name === DOC_ORDER ? requireDocOrder(value) : requireStringColumn(name, value);
  }
  for (const name of keys.slice(CANONICAL_WIDTH)) {
    copy[name] = requireStringColumn(name, row[name]);
  }
  return {
    schema: MUNICIPAL_INSTRUMENT_VIEW_SCHEMA,
    kindVersion: MUNICIPAL_KIND_VERSION,
    sourceSchemaId: MUNICIPAL_SOURCE_SCHEMA_FILE,
    row: copy,
  };
}

/**
 * Read a country-laws IR document row.
 *
 * The guide is ipfs_datasets_py/processors/legal_scrapers/country_laws_ir/__init__.py.
 * query.py Release.bm25 and document_shard_paths stay in Python.
 * A row is accepted only when schema_version is already
 * country-laws-ir-graphrag/v1. This module does not stamp that schema
 * onto a row and does not fetch a dataset.
 */

export const IR_ROW_SCHEMA = 'worldwide-legal-search.ir-row@1';

/** SCHEMA_VERSION from the guide. */
export const IR_SCHEMA_VERSION = 'country-laws-ir-graphrag/v1';

/** ENTRY_IDENTITY_SCHEMA from the guide. */
export const ENTRY_IDENTITY_SCHEMA = 'country-laws-entry/v1';

/** LAW_IDENTITY_SCHEMA from the guide. */
export const LAW_IDENTITY_SCHEMA = 'country-laws-law/v1';

/**
 * K1, B, TITLE_WEIGHT, and BODY_WEIGHT from the top of query.py.
 * Scoring stays in Release.bm25.
 */
export const IR_SEARCH_GUIDE = {
  k1: 1.2,
  b: 0.75,
  titleWeight: 5,
  bodyWeight: 1,
} as const;

export interface IrRow {
  instrument_id: string;
  title: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function entryIdentityMatches(row: Record<string, unknown>): boolean {
  if (!Object.prototype.hasOwnProperty.call(row, 'entry_identity_schema_version')) {
    return true;
  }
  return row.entry_identity_schema_version === ENTRY_IDENTITY_SCHEMA;
}

/** Return the instrument id and title. A missing schema_version returns null. */
export function readIrRow(row: unknown): IrRow | null {
  if (!isRecord(row)) return null;
  if (row.schema_version !== IR_SCHEMA_VERSION) return null;
  if (!nonEmptyString(row.instrument_id) || !nonEmptyString(row.title)) return null;
  if (!entryIdentityMatches(row)) return null;
  return {
    instrument_id: row.instrument_id,
    title: row.title,
  };
}

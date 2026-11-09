/**
 * Site regulation view.
 *
 * Exports `worldwide-legal-search.regulation-view@1` bound to
 * `legal-corpus.regulation@1`. A row is accepted only with a source schema
 * id assigned by a regulation-register source. The statute schema id
 * `country-laws-ir-graphrag/v1` is refused. CFR text stays on that source
 * schema id. It is not rendered as `worldwide-legal-search.law-source@1`
 * and it is not copied onto the statute columns.
 *
 * The five source schema ids are the `SCHEMA_VERSION` assignments in
 * `cfr_annual_processor.py`, `live_cfr_source_processor.py`,
 * `ecfr_crosscheck_processor.py`, `federal_register_change_processor.py`,
 * and `federal_register_release_schema.py`. `federal_register_scraper.py`,
 * `regulation_version_tracker.py`, and `state_admin_rules_scraper.py`
 * assign no `SCHEMA_VERSION`, so this module does not invent one.
 * `patent-authority-sources-v1` is the authority import, not a regulation
 * source id. Fixture schema ids are not register source ids.
 *
 * The view id and the kind version are the exports in `contract.ts`.
 * The statute schema id is `CORPUS_SCHEMA_VERSION` in `data/identity.ts`.
 * This module does not assign a second schema id.
 */

import { CORPUS_SCHEMA_VERSION } from '../data/identity';
import { LAW_SOURCE_SCHEMA } from '../data/schema';
import { KIND_VERSIONS, REGULATION_VIEW_ID } from './contract';

function pinned(actual: string, expected: string, label: string): string {
  if (actual !== expected) {
    throw new Error(`${label} is ${actual}, not ${expected}`);
  }
  return actual;
}

export const REGULATION_VIEW_SCHEMA = pinned(
  REGULATION_VIEW_ID,
  'worldwide-legal-search.regulation-view@1',
  'REGULATION_VIEW_ID',
);
export const REGULATION_KIND_VERSION = pinned(
  KIND_VERSIONS.regulation,
  'legal-corpus.regulation@1',
  'KIND_VERSIONS.regulation',
);
/** Statute schema id. A regulation row that claims it is refused. */
export const STATUTE_SCHEMA_ID = pinned(
  CORPUS_SCHEMA_VERSION,
  'country-laws-ir-graphrag/v1',
  'CORPUS_SCHEMA_VERSION',
);
export const REFUSED_LAW_SOURCE_SCHEMA = pinned(
  LAW_SOURCE_SCHEMA,
  'worldwide-legal-search.law-source@1',
  'LAW_SOURCE_SCHEMA',
);
export const REFUSED_LAW_KIND_VERSION = pinned(
  KIND_VERSIONS.law,
  'legal-corpus.law@1',
  'KIND_VERSIONS.law',
);

/**
 * `SCHEMA_VERSION` strings read from the five versioned regulation sources.
 * Order matches the regulation kind register.
 */
export const REGULATION_SOURCE_SCHEMA_IDS = [
  'cfr-annual-processor-v1',
  'live-cfr-source-processor-v1',
  'ecfr-crosscheck-processor-v1',
  'federal-register-change-processor-v1',
  'federal-register-sparse-graphrag-release-schema-v2',
] as const;

export type RegulationSourceSchemaId = (typeof REGULATION_SOURCE_SCHEMA_IDS)[number];

const REGISTERED: ReadonlySet<string> = new Set(REGULATION_SOURCE_SCHEMA_IDS);

export const regulationView = {
  renders: [REGULATION_VIEW_SCHEMA] as const,
  kindVersion: REGULATION_KIND_VERSION,
  sourceSchemaIds: REGULATION_SOURCE_SCHEMA_IDS,
  refuses: [STATUTE_SCHEMA_ID, REFUSED_LAW_SOURCE_SCHEMA, REFUSED_LAW_KIND_VERSION] as const,
} as const;

export class RegulationViewRefused extends Error {
  readonly version: string;

  constructor(version: string, message?: string) {
    super(message ?? `regulation view refuses ${version}`);
    this.name = 'RegulationViewRefused';
    this.version = version;
  }
}

export interface RegulationViewInput {
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

export interface RegulationViewModel {
  schema: typeof REGULATION_VIEW_SCHEMA;
  kindVersion: typeof REGULATION_KIND_VERSION;
  sourceSchemaId: RegulationSourceSchemaId;
  row: Record<string, unknown>;
}

function textClaim(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function claims(input: RegulationViewInput): string[] {
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

function refuseStatute(version: string): void {
  if (version === STATUTE_SCHEMA_ID) {
    throw new RegulationViewRefused(STATUTE_SCHEMA_ID, 'statute schema id is rejected');
  }
  if (version === REFUSED_LAW_SOURCE_SCHEMA) {
    throw new RegulationViewRefused(
      REFUSED_LAW_SOURCE_SCHEMA,
      'regulation view does not render CFR text as a consolidated statute',
    );
  }
  if (version === REFUSED_LAW_KIND_VERSION) {
    throw new RegulationViewRefused(REFUSED_LAW_KIND_VERSION);
  }
}

function rowSchemaClaims(row: Record<string, unknown>): string[] {
  const found = [
    textClaim(row.source_schema_id),
    textClaim(row.sourceSchemaId),
    textClaim(row.schema_version),
    textClaim(row.source_schema_version),
  ].filter((item) => item.length > 0);
  return found;
}

/**
 * Render one regulation row. The model schema is the regulation view id.
 * The statute schema and law-source are refused before a model is built.
 * Row keys are copied. CFR `text_excerpt` is not written to a statute `text`.
 */
export function renderRegulationView(input: RegulationViewInput): RegulationViewModel {
  const seen = claims(input);
  for (const version of seen) {
    refuseStatute(version);
  }
  const interfaceId = textClaim(input.interfaceId)
    || textClaim(input.interface_id)
    || textClaim(input.kindVersion)
    || textClaim(input.kind_version);
  if (interfaceId !== REGULATION_KIND_VERSION) {
    throw new RegulationViewRefused(
      interfaceId,
      `regulation view renders ${REGULATION_KIND_VERSION}`,
    );
  }
  const row = mapping(input.row) ?? mapping(input.sourceRow) ?? mapping(input.source_row);
  if (row === null) {
    throw new RegulationViewRefused(REGULATION_KIND_VERSION, 'regulation row must be a mapping');
  }
  const rowClaims = rowSchemaClaims(row);
  for (const version of rowClaims) {
    refuseStatute(version);
  }
  if (rowClaims.some((item) => item !== rowClaims[0])) {
    throw new RegulationViewRefused(rowClaims[0], 'regulation source schema id fields disagree');
  }
  const claimedSchema = textClaim(input.sourceSchemaId)
    || textClaim(input.source_schema_id)
    || textClaim(input.sourceSchemaVersion)
    || textClaim(input.source_schema_version);
  const rowSchema = rowClaims[0] ?? '';
  if (claimedSchema && rowSchema && claimedSchema !== rowSchema) {
    throw new RegulationViewRefused(claimedSchema, 'regulation source schema id does not match the row');
  }
  const sourceSchemaId = claimedSchema || rowSchema;
  if (!REGISTERED.has(sourceSchemaId)) {
    throw new RegulationViewRefused(
      sourceSchemaId,
      'source schema id is not in the regulation register',
    );
  }
  const copy: Record<string, unknown> = {};
  for (const key of Object.keys(row)) {
    copy[key] = row[key];
  }
  return {
    schema: REGULATION_VIEW_SCHEMA,
    kindVersion: REGULATION_KIND_VERSION,
    sourceSchemaId: sourceSchemaId as RegulationSourceSchemaId,
    row: copy,
  };
}

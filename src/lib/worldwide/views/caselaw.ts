/**
 * Site caselaw view.
 *
 * Exports `worldwide-legal-search.caselaw-view@1`. Accepts only
 * `legal-corpus.caselaw@1` together with source schema id `unversioned`,
 * the schema id the caselaw register lists for each source. The view model
 * shows that source schema id. A caselaw row is not rendered as
 * `worldwide-legal-search.law-source@1`.
 *
 * The view id and the kind version are the exports in `contract.ts`.
 * `unversioned` is the schema id in the caselaw register and
 * `UNVERSIONED_SCHEMA_ID` in `caselaw_v1.py`. This module does not assign
 * a second schema id. It does not add a query route and does not read
 * caller IP.
 */

import { LAW_SOURCE_SCHEMA } from '../data/schema';
import { CASELAW_VIEW_ID, KIND_VERSIONS } from './contract';

function pinned(actual: string, expected: string, label: string): string {
  if (actual !== expected) {
    throw new Error(`${label} is ${actual}, not ${expected}`);
  }
  return actual;
}

export const CASELAW_VIEW_SCHEMA = pinned(
  CASELAW_VIEW_ID,
  'worldwide-legal-search.caselaw-view@1',
  'CASELAW_VIEW_ID',
);
export const CASELAW_KIND_VERSION = pinned(
  KIND_VERSIONS.caselaw,
  'legal-corpus.caselaw@1',
  'KIND_VERSIONS.caselaw',
);
/** Schema id listed for every source in the caselaw register. */
export const CASELAW_SOURCE_SCHEMA_ID = 'unversioned' as const;
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

export const caselawView = {
  renders: [CASELAW_VIEW_SCHEMA] as const,
  kindVersion: CASELAW_KIND_VERSION,
  sourceSchemaId: CASELAW_SOURCE_SCHEMA_ID,
  refuses: [REFUSED_LAW_SOURCE_SCHEMA, REFUSED_LAW_KIND_VERSION] as const,
} as const;

export class CaselawViewRefused extends Error {
  readonly version: string;

  constructor(version: string, message?: string) {
    super(message ?? `caselaw view refuses ${version}`);
    this.name = 'CaselawViewRefused';
    this.version = version;
  }
}

export interface CaselawViewInput {
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

export interface CaselawViewModel {
  schema: typeof CASELAW_VIEW_SCHEMA;
  kindVersion: typeof CASELAW_KIND_VERSION;
  sourceSchemaId: typeof CASELAW_SOURCE_SCHEMA_ID;
  row: Record<string, unknown>;
}

function textClaim(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function claims(input: CaselawViewInput): string[] {
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

/**
 * Render one caselaw row. The model schema is the caselaw view id.
 * Law-source and the law kind are refused before a model is built.
 * The row keys are copied. They are not rewritten onto law columns.
 */
export function renderCaselawView(input: CaselawViewInput): CaselawViewModel {
  const seen = claims(input);
  if (seen.includes(REFUSED_LAW_SOURCE_SCHEMA)) {
    throw new CaselawViewRefused(
      REFUSED_LAW_SOURCE_SCHEMA,
      'caselaw view does not render through law-source@1',
    );
  }
  if (seen.includes(REFUSED_LAW_KIND_VERSION)) {
    throw new CaselawViewRefused(REFUSED_LAW_KIND_VERSION);
  }
  const interfaceId = textClaim(input.interfaceId)
    || textClaim(input.interface_id)
    || textClaim(input.kindVersion)
    || textClaim(input.kind_version);
  if (interfaceId !== CASELAW_KIND_VERSION) {
    throw new CaselawViewRefused(interfaceId, `caselaw view renders ${CASELAW_KIND_VERSION}`);
  }
  const row = mapping(input.row) ?? mapping(input.sourceRow) ?? mapping(input.source_row);
  if (row === null) {
    throw new CaselawViewRefused(CASELAW_KIND_VERSION, 'caselaw row must be a mapping');
  }
  const claimedSchema = textClaim(input.sourceSchemaId)
    || textClaim(input.source_schema_id)
    || textClaim(input.sourceSchemaVersion)
    || textClaim(input.source_schema_version);
  const rowSchema = textClaim(row.source_schema_id) || textClaim(row.sourceSchemaId);
  if (rowSchema === REFUSED_LAW_SOURCE_SCHEMA) {
    throw new CaselawViewRefused(
      REFUSED_LAW_SOURCE_SCHEMA,
      'caselaw view does not render through law-source@1',
    );
  }
  if (claimedSchema && rowSchema && claimedSchema !== rowSchema) {
    throw new CaselawViewRefused(claimedSchema, 'caselaw source schema id does not match the row');
  }
  const sourceSchemaId = claimedSchema || rowSchema;
  if (sourceSchemaId !== CASELAW_SOURCE_SCHEMA_ID) {
    throw new CaselawViewRefused(
      sourceSchemaId,
      `caselaw source schema id is ${CASELAW_SOURCE_SCHEMA_ID}`,
    );
  }
  const copy: Record<string, unknown> = {};
  for (const key of Object.keys(row)) {
    copy[key] = row[key];
  }
  return {
    schema: CASELAW_VIEW_SCHEMA,
    kindVersion: CASELAW_KIND_VERSION,
    sourceSchemaId: CASELAW_SOURCE_SCHEMA_ID,
    row: copy,
  };
}

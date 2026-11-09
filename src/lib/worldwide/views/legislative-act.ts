/**
 * Site legislative-act view.
 *
 * Exports `worldwide-legal-search.legislative-act-view@1` bound to
 * `legal-corpus.legislative-act@1`. A US Code law row is refused. US Code
 * consolidation stays `legal-corpus.law@1`. This module does not render
 * that row as `worldwide-legal-search.law-source@1` and does not edit the
 * law view.
 *
 * Act schema ids are `SCHEMA_VERSION` and `FIXTURE_SCHEMA_VERSION` in
 * `public_law_change_processor.py`. US Code schema ids are
 * `SCHEMA_VERSION` and `FIXTURE_SCHEMA_VERSION` in
 * `uscode_release_processor.py`, plus `SCHEMA_VERSION` and
 * `RELEASE_PROFILE` in `uscode_release_schema.py`. `us_code_scraper.py`
 * assigns no `SCHEMA_VERSION`. A package prefix written by that scraper
 * is still a US Code law row. The view id and the kind versions are the
 * exports in `contract.ts`. This module does not assign a second schema id.
 */

import { LAW_SOURCE_SCHEMA } from '../data/schema';
import { KIND_VERSIONS, LEGISLATIVE_ACT_VIEW_ID } from './contract';

function pinned(actual: string, expected: string, label: string): string {
  if (actual !== expected) {
    throw new Error(`${label} is ${actual}, not ${expected}`);
  }
  return actual;
}

export const LEGISLATIVE_ACT_VIEW_SCHEMA = pinned(
  LEGISLATIVE_ACT_VIEW_ID,
  'worldwide-legal-search.legislative-act-view@1',
  'LEGISLATIVE_ACT_VIEW_ID',
);
export const LEGISLATIVE_ACT_KIND_VERSION = pinned(
  KIND_VERSIONS.legislative_act,
  'legal-corpus.legislative-act@1',
  'KIND_VERSIONS.legislative_act',
);
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

/** `SCHEMA_VERSION` and `FIXTURE_SCHEMA_VERSION` from the public-law processor. */
export const ACT_SOURCE_SCHEMA_IDS = [
  'public-law-change-processor-v1',
  'public-law-change-fixture-v1',
] as const;

/**
 * Schema ids a US Code law row claims. The scraper itself assigns none.
 * Order matches the legislative-act kind register.
 */
export const USCODE_LAW_SCHEMA_IDS = [
  'uscode-release-processor-v1',
  'uscode-release-fixture-v1',
  'uscode-sparse-graphrag-release-schema-v2',
  'publicus-ir-graphrag/v2',
] as const;

/** Package prefixes written by `us_code_scraper.py`. */
export const USCODE_PACKAGE_PREFIXES = ['USHOUSE-USCODE-', 'USCODE-'] as const;

export type ActSourceSchemaId = (typeof ACT_SOURCE_SCHEMA_IDS)[number];

const ACT_REGISTERED: ReadonlySet<string> = new Set(ACT_SOURCE_SCHEMA_IDS);
const USCODE_REGISTERED: ReadonlySet<string> = new Set(USCODE_LAW_SCHEMA_IDS);

export const legislativeActView = {
  renders: [LEGISLATIVE_ACT_VIEW_SCHEMA] as const,
  kindVersion: LEGISLATIVE_ACT_KIND_VERSION,
  sourceSchemaIds: ACT_SOURCE_SCHEMA_IDS,
  refuses: [REFUSED_LAW_KIND_VERSION, ...USCODE_LAW_SCHEMA_IDS] as const,
} as const;

export class LegislativeActViewRefused extends Error {
  readonly version: string;

  constructor(version: string, message?: string) {
    super(message ?? `legislative-act view refuses ${version}`);
    this.name = 'LegislativeActViewRefused';
    this.version = version;
  }
}

export interface LegislativeActViewInput {
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

export interface LegislativeActViewModel {
  schema: typeof LEGISLATIVE_ACT_VIEW_SCHEMA;
  kindVersion: typeof LEGISLATIVE_ACT_KIND_VERSION;
  sourceSchemaId: ActSourceSchemaId;
  row: Record<string, unknown>;
}

function textClaim(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function claims(input: LegislativeActViewInput): string[] {
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

function usCodePackage(value: unknown): boolean {
  return typeof value === 'string'
    && USCODE_PACKAGE_PREFIXES.some((prefix) => value.startsWith(prefix));
}

function rowSchemaClaims(row: Record<string, unknown>): string[] {
  return [
    textClaim(row.source_schema_id),
    textClaim(row.sourceSchemaId),
    textClaim(row.schema_version),
    textClaim(row.source_schema_version),
  ].filter((item) => item.length > 0);
}

/** A US Code law row claims a US Code schema id or a scraper package prefix. */
export function usCodeLawSignal(
  versions: readonly string[],
  row: Record<string, unknown> | null,
): string {
  for (const version of versions) {
    if (USCODE_REGISTERED.has(version)) {
      return version;
    }
  }
  if (row !== null) {
    for (const version of rowSchemaClaims(row)) {
      if (USCODE_REGISTERED.has(version)) {
        return version;
      }
    }
    if (usCodePackage(row.package)) {
      return textClaim(row.package);
    }
    if (usCodePackage(row.package_id)) {
      return textClaim(row.package_id);
    }
  }
  return '';
}

function refuseUsCodeLaw(signal: string): void {
  if (signal) {
    throw new LegislativeActViewRefused(signal, 'US Code law row is rejected');
  }
}

function refuseLawSurface(version: string): void {
  if (version === REFUSED_LAW_SOURCE_SCHEMA) {
    throw new LegislativeActViewRefused(
      REFUSED_LAW_SOURCE_SCHEMA,
      'legislative-act view does not render through law-source@1',
    );
  }
}

/**
 * Render one public-law row. The model schema is the legislative-act view id.
 * A US Code law row is refused before a model is built. Row keys are copied.
 */
export function renderLegislativeActView(
  input: LegislativeActViewInput,
): LegislativeActViewModel {
  const seen = claims(input);
  const row = mapping(input.row) ?? mapping(input.sourceRow) ?? mapping(input.source_row);
  refuseUsCodeLaw(usCodeLawSignal(seen, row));
  for (const version of seen) {
    refuseLawSurface(version);
  }
  const interfaceId = textClaim(input.interfaceId)
    || textClaim(input.interface_id)
    || textClaim(input.kindVersion)
    || textClaim(input.kind_version);
  if (interfaceId === REFUSED_LAW_KIND_VERSION) {
    throw new LegislativeActViewRefused(
      REFUSED_LAW_KIND_VERSION,
      'legislative-act view refuses a law row that is not a public-law schema id',
    );
  }
  if (interfaceId !== LEGISLATIVE_ACT_KIND_VERSION) {
    throw new LegislativeActViewRefused(
      interfaceId,
      `legislative-act view renders ${LEGISLATIVE_ACT_KIND_VERSION}`,
    );
  }
  if (row === null) {
    throw new LegislativeActViewRefused(
      LEGISLATIVE_ACT_KIND_VERSION,
      'legislative-act row must be a mapping',
    );
  }
  const rowClaims = rowSchemaClaims(row);
  if (rowClaims.some((item) => item !== rowClaims[0])) {
    throw new LegislativeActViewRefused(rowClaims[0], 'legislative-act source schema id fields disagree');
  }
  const claimedSchema = textClaim(input.sourceSchemaId)
    || textClaim(input.source_schema_id)
    || textClaim(input.sourceSchemaVersion)
    || textClaim(input.source_schema_version);
  const rowSchema = rowClaims[0] ?? '';
  if (claimedSchema && rowSchema && claimedSchema !== rowSchema) {
    throw new LegislativeActViewRefused(
      claimedSchema,
      'legislative-act source schema id does not match the row',
    );
  }
  const sourceSchemaId = claimedSchema || rowSchema;
  if (!ACT_REGISTERED.has(sourceSchemaId)) {
    throw new LegislativeActViewRefused(
      sourceSchemaId,
      'source schema id is not in the legislative-act register',
    );
  }
  const copy: Record<string, unknown> = {};
  for (const key of Object.keys(row)) {
    copy[key] = row[key];
  }
  return {
    schema: LEGISLATIVE_ACT_VIEW_SCHEMA,
    kindVersion: LEGISLATIVE_ACT_KIND_VERSION,
    sourceSchemaId: sourceSchemaId as ActSourceSchemaId,
    row: copy,
  };
}

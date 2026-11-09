/**
 * Site law view.
 *
 * Renders `worldwide-legal-search.law-source@1` and
 * `worldwide-legal-search.law-section@1` for `legal-corpus.law@1` bound to
 * `country-laws-ir-graphrag/v1`. Refuses `legal-corpus.caselaw@1`.
 *
 * The schema ids, `SCHEMA_VERSION`, and the required law columns are the
 * exports in `data/schema.ts` and `data/identity.ts`. This module does not
 * assign a new schema version and does not replace those columns.
 * A statute row has one body. The section record uses that row's `id` as
 * `law_id`, which is the article column the schema already requires.
 */

import { CORPUS_SCHEMA_VERSION } from '../data/identity';
import {
  LAW_SECTION_SCHEMA,
  LAW_SOURCE_SCHEMA,
  REQUIRED_LAW_COLUMNS,
  SCHEMA_VERSION,
} from '../data/schema';
import { KIND_VERSIONS } from './contract';

function pinned(actual: string, expected: string, label: string): string {
  if (actual !== expected) {
    throw new Error(`${label} is ${actual}, not ${expected}`);
  }
  return actual;
}

export const LAW_VIEW_SOURCE_SCHEMA = pinned(
  LAW_SOURCE_SCHEMA,
  'worldwide-legal-search.law-source@1',
  'LAW_SOURCE_SCHEMA',
);
export const LAW_VIEW_SECTION_SCHEMA = pinned(
  LAW_SECTION_SCHEMA,
  'worldwide-legal-search.law-section@1',
  'LAW_SECTION_SCHEMA',
);
export const LAW_KIND_VERSION = pinned(
  KIND_VERSIONS.law,
  'legal-corpus.law@1',
  'KIND_VERSIONS.law',
);
export const LAW_SOURCE_SCHEMA_VERSION = pinned(
  CORPUS_SCHEMA_VERSION,
  'country-laws-ir-graphrag/v1',
  'CORPUS_SCHEMA_VERSION',
);
export const REFUSED_CASELAW_VERSION = pinned(
  KIND_VERSIONS.caselaw,
  'legal-corpus.caselaw@1',
  'KIND_VERSIONS.caselaw',
);

if (SCHEMA_VERSION !== 1) {
  throw new Error(`SCHEMA_VERSION is ${String(SCHEMA_VERSION)}, not 1`);
}
if (
  REQUIRED_LAW_COLUMNS.length !== 3
  || REQUIRED_LAW_COLUMNS[0] !== 'id'
  || REQUIRED_LAW_COLUMNS[1] !== 'title'
  || REQUIRED_LAW_COLUMNS[2] !== 'text'
) {
  throw new Error(`required law columns are ${REQUIRED_LAW_COLUMNS.join(',')}`);
}

export const lawView = {
  renders: [LAW_VIEW_SOURCE_SCHEMA, LAW_VIEW_SECTION_SCHEMA] as const,
  kindVersion: LAW_KIND_VERSION,
  sourceSchemaVersion: LAW_SOURCE_SCHEMA_VERSION,
  schemaVersion: SCHEMA_VERSION,
  requiredLawColumns: REQUIRED_LAW_COLUMNS,
  refuses: [REFUSED_CASELAW_VERSION] as const,
} as const;

export class LawViewRefused extends Error {
  readonly version: string;

  constructor(version: string, message?: string) {
    super(message ?? `law view refuses ${version}`);
    this.name = 'LawViewRefused';
    this.version = version;
  }
}

export interface LawViewInput {
  interfaceId?: unknown;
  interface_id?: unknown;
  kindVersion?: unknown;
  kind_version?: unknown;
  sourceSchemaVersion?: unknown;
  source_schema_version?: unknown;
  sourceSchemaId?: unknown;
  source_schema_id?: unknown;
  row?: unknown;
  sourceRow?: unknown;
  source_row?: unknown;
}

export interface LawSourceView {
  schema: typeof LAW_SOURCE_SCHEMA;
  schemaVersion: typeof SCHEMA_VERSION;
  kindVersion: typeof LAW_KIND_VERSION;
  sourceSchemaVersion: typeof LAW_SOURCE_SCHEMA_VERSION;
  id: string;
  title: string;
  text: string;
}

export interface LawSectionView {
  schema: typeof LAW_SECTION_SCHEMA;
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  law_id: string;
  title: string;
  text: string;
}

export interface LawViewModel {
  source: LawSourceView;
  section: LawSectionView;
  extra: Record<string, unknown>;
}

function textClaim(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function claims(input: LawViewInput): string[] {
  return [
    input.interfaceId,
    input.interface_id,
    input.kindVersion,
    input.kind_version,
    input.sourceSchemaVersion,
    input.source_schema_version,
    input.sourceSchemaId,
    input.source_schema_id,
  ].map(textClaim).filter((item) => item.length > 0);
}

function mapping(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function requiredText(row: Record<string, unknown>, column: string): string {
  if (!Object.prototype.hasOwnProperty.call(row, column)) {
    throw new LawViewRefused(LAW_KIND_VERSION, `missing required column ${column}`);
  }
  const value = row[column];
  if (typeof value !== 'string') {
    throw new LawViewRefused(LAW_KIND_VERSION, `required column ${column} is not a string`);
  }
  return value;
}

/**
 * Render one statute row. Caselaw is refused before a law-source model is built.
 * Extra keys on the row are copied. The required law columns stay on the source.
 */
export function renderLawView(input: LawViewInput): LawViewModel {
  const seen = claims(input);
  if (seen.includes(REFUSED_CASELAW_VERSION)) {
    throw new LawViewRefused(REFUSED_CASELAW_VERSION);
  }
  const interfaceId = textClaim(input.interfaceId)
    || textClaim(input.interface_id)
    || textClaim(input.kindVersion)
    || textClaim(input.kind_version);
  if (interfaceId !== LAW_KIND_VERSION) {
    throw new LawViewRefused(interfaceId, `law view renders ${LAW_KIND_VERSION}`);
  }
  const sourceSchemaVersion = textClaim(input.sourceSchemaVersion)
    || textClaim(input.source_schema_version)
    || textClaim(input.sourceSchemaId)
    || textClaim(input.source_schema_id);
  if (sourceSchemaVersion !== LAW_SOURCE_SCHEMA_VERSION) {
    throw new LawViewRefused(
      sourceSchemaVersion,
      `law view source schema is ${LAW_SOURCE_SCHEMA_VERSION}`,
    );
  }
  const row = mapping(input.row) ?? mapping(input.sourceRow) ?? mapping(input.source_row);
  if (row === null) {
    throw new LawViewRefused(LAW_KIND_VERSION, 'law row must be a mapping');
  }
  const id = requiredText(row, REQUIRED_LAW_COLUMNS[0]);
  const title = requiredText(row, REQUIRED_LAW_COLUMNS[1]);
  const text = requiredText(row, REQUIRED_LAW_COLUMNS[2]);
  const required = new Set<string>(REQUIRED_LAW_COLUMNS);
  const extra: Record<string, unknown> = {};
  for (const key of Object.keys(row)) {
    if (!required.has(key)) {
      extra[key] = row[key];
    }
  }
  return {
    source: {
      schema: LAW_VIEW_SOURCE_SCHEMA,
      schemaVersion: SCHEMA_VERSION,
      kindVersion: LAW_KIND_VERSION,
      sourceSchemaVersion: LAW_SOURCE_SCHEMA_VERSION,
      id,
      title,
      text,
    },
    section: {
      schema: LAW_VIEW_SECTION_SCHEMA,
      schemaVersion: SCHEMA_VERSION,
      id,
      law_id: id,
      title,
      text,
    },
    extra,
  };
}

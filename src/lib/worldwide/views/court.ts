/**
 * Site court view.
 *
 * Exports `worldwide-legal-search.court-view@1` bound to
 * `legal-corpus.court@1`. The view model has no opinion body field.
 * Caselaw text is not copied onto the model.
 *
 * The view id and the kind version are the exports in `contract.ts`.
 * `unversioned` is `UNVERSIONED_SCHEMA_ID` in `court_v1.py` and the schema
 * id the court register states. `endomorphosis/world_courts` is `DS` in
 * `upload_world_courts.py` and `WORLD_COURTS_REPO` in `court_v1.py`. It is
 * a repo id, not the schema id. Opinion body names are `_OPINION_BODY_NAMES`
 * in `court_v1.py`: `text`, `opinion_text`, and `case_text`. Those names
 * are also the start of `CAPVectorSearchConfig.text_field_candidates`.
 * The statute schema id is `CORPUS_SCHEMA_VERSION` in `data/identity.ts`.
 * This module does not assign a second schema id.
 */

import { CORPUS_SCHEMA_VERSION } from '../data/identity';
import { LAW_SOURCE_SCHEMA } from '../data/schema';
import { COURT_VIEW_ID, KIND_VERSIONS } from './contract';

function pinned(actual: string, expected: string, label: string): string {
  if (actual !== expected) {
    throw new Error(`${label} is ${actual}, not ${expected}`);
  }
  return actual;
}

export const COURT_VIEW_SCHEMA = pinned(
  COURT_VIEW_ID,
  'worldwide-legal-search.court-view@1',
  'COURT_VIEW_ID',
);
export const COURT_KIND_VERSION = pinned(
  KIND_VERSIONS.court,
  'legal-corpus.court@1',
  'KIND_VERSIONS.court',
);
/** Schema id in the court register and `UNVERSIONED_SCHEMA_ID` in `court_v1.py`. */
export const COURT_SOURCE_SCHEMA_ID = 'unversioned' as const;
/** `WORLD_COURTS_REPO` / upload `DS`. Not a schema id. */
export const WORLD_COURTS_REPO = 'endomorphosis/world_courts' as const;
/** Statute schema id. A court row that claims it is refused. */
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
export const REFUSED_CASELAW_KIND_VERSION = pinned(
  KIND_VERSIONS.caselaw,
  'legal-corpus.caselaw@1',
  'KIND_VERSIONS.caselaw',
);

/** `_OPINION_BODY_NAMES` in `court_v1.py`. These keys are not view fields. */
export const OPINION_BODY_FIELDS = ['text', 'opinion_text', 'case_text'] as const;

export type CourtSourceSchemaId = typeof COURT_SOURCE_SCHEMA_ID;

const OPINION_BODY_SET: ReadonlySet<string> = new Set(OPINION_BODY_FIELDS);

export const courtView = {
  renders: [COURT_VIEW_SCHEMA] as const,
  kindVersion: COURT_KIND_VERSION,
  sourceSchemaId: COURT_SOURCE_SCHEMA_ID,
  refuses: [
    REFUSED_CASELAW_KIND_VERSION,
    STATUTE_SCHEMA_ID,
    WORLD_COURTS_REPO,
    REFUSED_LAW_SOURCE_SCHEMA,
    REFUSED_LAW_KIND_VERSION,
  ] as const,
} as const;

export class CourtViewRefused extends Error {
  readonly version: string;

  constructor(version: string, message?: string) {
    super(message ?? `court view refuses ${version}`);
    this.name = 'CourtViewRefused';
    this.version = version;
  }
}

export interface CourtViewInput {
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

export interface CourtViewModel {
  schema: typeof COURT_VIEW_SCHEMA;
  kindVersion: typeof COURT_KIND_VERSION;
  sourceSchemaId: typeof COURT_SOURCE_SCHEMA_ID;
  row: Record<string, unknown>;
}

function textClaim(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function claims(input: CourtViewInput): string[] {
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

function rowSchemaClaims(row: Record<string, unknown>): string[] {
  return [
    textClaim(row.source_schema_id),
    textClaim(row.sourceSchemaId),
    textClaim(row.schema_version),
    textClaim(row.source_schema_version),
  ].filter((item) => item.length > 0);
}

/** Return the opinion-body key whose value is non-empty text, or ''. */
export function opinionBodyKey(row: Record<string, unknown>): string {
  for (const key of OPINION_BODY_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(row, key)) {
      continue;
    }
    const value = row[key];
    if (typeof value === 'string' && value.trim() !== '') {
      return key;
    }
  }
  return '';
}

function refuseSurface(version: string): void {
  if (version === REFUSED_CASELAW_KIND_VERSION) {
    throw new CourtViewRefused(
      REFUSED_CASELAW_KIND_VERSION,
      'court view does not embed caselaw text',
    );
  }
  if (version === WORLD_COURTS_REPO) {
    throw new CourtViewRefused(WORLD_COURTS_REPO, 'world courts repo id is not the schema id');
  }
  if (version === STATUTE_SCHEMA_ID) {
    throw new CourtViewRefused(STATUTE_SCHEMA_ID, 'statute schema id is rejected');
  }
  if (version === REFUSED_LAW_SOURCE_SCHEMA) {
    throw new CourtViewRefused(
      REFUSED_LAW_SOURCE_SCHEMA,
      'court view does not render through law-source@1',
    );
  }
  if (version === REFUSED_LAW_KIND_VERSION) {
    throw new CourtViewRefused(REFUSED_LAW_KIND_VERSION, 'court view refuses a law row');
  }
}

/**
 * Render one court institution row.
 *
 * The model schema is `worldwide-legal-search.court-view@1` and the kind
 * is `legal-corpus.court@1`. Opinion body keys are refused and are not
 * fields of the model. Caselaw text is not copied.
 */
export function renderCourtView(input: CourtViewInput): CourtViewModel {
  const seen = claims(input);
  for (const version of seen) {
    refuseSurface(version);
  }
  const interfaceId = textClaim(input.interfaceId)
    || textClaim(input.interface_id)
    || textClaim(input.kindVersion)
    || textClaim(input.kind_version);
  if (interfaceId !== COURT_KIND_VERSION) {
    throw new CourtViewRefused(interfaceId, `court view renders ${COURT_KIND_VERSION}`);
  }
  const row = mapping(input.row) ?? mapping(input.sourceRow) ?? mapping(input.source_row);
  if (row === null) {
    throw new CourtViewRefused(COURT_KIND_VERSION, 'court row must be a mapping');
  }
  const opinionKey = opinionBodyKey(row);
  if (opinionKey) {
    throw new CourtViewRefused(opinionKey, 'opinion text is refused');
  }
  const rowClaims = rowSchemaClaims(row);
  for (const version of rowClaims) {
    refuseSurface(version);
  }
  if (rowClaims.some((item) => item !== rowClaims[0])) {
    throw new CourtViewRefused(rowClaims[0], 'court source schema id fields disagree');
  }
  const claimedSchema = textClaim(input.sourceSchemaId)
    || textClaim(input.source_schema_id)
    || textClaim(input.sourceSchemaVersion)
    || textClaim(input.source_schema_version);
  const rowSchema = rowClaims[0] ?? '';
  if (claimedSchema && rowSchema && claimedSchema !== rowSchema) {
    throw new CourtViewRefused(claimedSchema, 'court source schema id does not match the row');
  }
  const sourceSchemaId = claimedSchema || rowSchema;
  if (sourceSchemaId !== COURT_SOURCE_SCHEMA_ID) {
    throw new CourtViewRefused(
      sourceSchemaId,
      'source schema id is not in the court register',
    );
  }
  const courtId = textClaim(row.court_id);
  if (!courtId) {
    throw new CourtViewRefused(COURT_SOURCE_SCHEMA_ID, 'court identifier is required');
  }
  if (row.court_id !== courtId && textClaim(row.court_id) !== courtId) {
    throw new CourtViewRefused(COURT_SOURCE_SCHEMA_ID, 'court identifier is required');
  }
  const copy: Record<string, unknown> = {};
  for (const key of Object.keys(row)) {
    if (OPINION_BODY_SET.has(key)) {
      continue;
    }
    copy[key] = row[key];
  }
  return {
    schema: COURT_VIEW_SCHEMA,
    kindVersion: COURT_KIND_VERSION,
    sourceSchemaId: COURT_SOURCE_SCHEMA_ID,
    row: copy,
  };
}

/**
 * Choose a landed instrument view only when the record already names
 * that interface and its source schema. A search filter token is not
 * an interface id. A refusal from the view module returns no model.
 */

import {
  renderCaselawView,
  CaselawViewRefused,
  type CaselawViewModel,
} from './caselaw';
import {
  renderCourtView,
  CourtViewRefused,
  type CourtViewModel,
} from './court';
import {
  renderLawView,
  LawViewRefused,
  LAW_KIND_VERSION,
  type LawViewModel,
} from './law';
import {
  renderLegislativeActView,
  LegislativeActViewRefused,
  LEGISLATIVE_ACT_KIND_VERSION,
  type LegislativeActViewModel,
} from './legislative-act';
import {
  renderMunicipalInstrumentView,
  MunicipalInstrumentViewRefused,
  MUNICIPAL_KIND_VERSION,
  type MunicipalInstrumentViewModel,
} from './municipal-instrument';
import {
  renderRegulationView,
  RegulationViewRefused,
  REGULATION_KIND_VERSION,
  type RegulationViewModel,
} from './regulation';
import { CASELAW_KIND_VERSION } from './caselaw';
import { COURT_KIND_VERSION } from './court';

export const FILTER_INSTRUMENT_TOKENS = [
  'constitution',
  'statute',
  'code',
  'regulation',
  'ordinance',
  'treaty',
  'decision',
  'notice',
  'amendment',
  'consolidation',
  'unknown',
] as const;

const FILTER_TOKENS = new Set<string>(FILTER_INSTRUMENT_TOKENS);

export interface InstrumentClaim {
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

export type InstrumentViewModel =
  | LawViewModel
  | CaselawViewModel
  | RegulationViewModel
  | LegislativeActViewModel
  | CourtViewModel
  | MunicipalInstrumentViewModel;

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function claimText(input: InstrumentClaim): string {
  return text(input.interfaceId)
    || text(input.interface_id)
    || text(input.kindVersion)
    || text(input.kind_version);
}

function isViewRefusal(error: unknown): boolean {
  return error instanceof LawViewRefused
    || error instanceof CaselawViewRefused
    || error instanceof RegulationViewRefused
    || error instanceof LegislativeActViewRefused
    || error instanceof CourtViewRefused
    || error instanceof MunicipalInstrumentViewRefused;
}

/** View id a result row may expose. Law keeps law-source on the source. */
export function instrumentViewId(model: InstrumentViewModel | null): string | null {
  if (!model) return null;
  if ('source' in model && model.source && typeof model.source.schema === 'string') {
    return model.source.schema;
  }
  if ('schema' in model && typeof model.schema === 'string') return model.schema;
  return null;
}

/**
 * Return the view model for a record that already names one accepted pair.
 * Missing ids, filter tokens, and crossed schemas return null.
 */
export function selectInstrumentView(input: InstrumentClaim): InstrumentViewModel | null {
  const interfaceId = claimText(input);
  if (!interfaceId || FILTER_TOKENS.has(interfaceId)) return null;
  try {
    if (interfaceId === LAW_KIND_VERSION) return renderLawView(input);
    if (interfaceId === CASELAW_KIND_VERSION) return renderCaselawView(input);
    if (interfaceId === REGULATION_KIND_VERSION) return renderRegulationView(input);
    if (interfaceId === LEGISLATIVE_ACT_KIND_VERSION) return renderLegislativeActView(input);
    if (interfaceId === COURT_KIND_VERSION) return renderCourtView(input);
    if (interfaceId === MUNICIPAL_KIND_VERSION) return renderMunicipalInstrumentView(input);
  } catch (error) {
    if (isViewRefusal(error)) return null;
    throw error;
  }
  return null;
}

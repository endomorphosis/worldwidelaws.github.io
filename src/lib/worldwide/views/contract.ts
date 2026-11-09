/**
 * Display contract `worldwide-legal-search.instrument-view-contract@1`.
 *
 * Reserved view ids come from the LCM-017 display register. `law-source@1`
 * stays the statute view. Each view maps to the kind `INTERFACE_ID` that
 * view can render. Those ids were read from the landed kind modules.
 * `legal-corpus.instrument@1` is the shared instrument interface. A view
 * renders a kind version, not that shared id.
 *
 * The query place is an argument, not caller IP. This module does not read
 * caller IP and does not define a geoip field. Jurisdiction applicability
 * stays `not-asserted`.
 */

import { LAW_SECTION_SCHEMA, LAW_SOURCE_SCHEMA } from '../data/schema';
import { APPLICABILITY } from '../jurisdiction/schema';

export const INSTRUMENT_VIEW_CONTRACT_ID =
  'worldwide-legal-search.instrument-view-contract@1' as const;

/** Shared instrument interface cited by this contract. Not a kind version. */
export const INSTRUMENT_INTERFACE_ID = 'legal-corpus.instrument@1' as const;

/** The query place is an argument supplied by the caller. */
export const QUERY_PLACE = 'argument' as const;

export const CASELAW_VIEW_ID = 'worldwide-legal-search.caselaw-view@1' as const;
export const REGULATION_VIEW_ID = 'worldwide-legal-search.regulation-view@1' as const;
export const LEGISLATIVE_ACT_VIEW_ID = 'worldwide-legal-search.legislative-act-view@1' as const;
export const COURT_VIEW_ID = 'worldwide-legal-search.court-view@1' as const;
export const MUNICIPAL_INSTRUMENT_VIEW_ID =
  'worldwide-legal-search.municipal-instrument-view@1' as const;

/** Kind names from `legal-corpus.instrument@1`, in that tuple's order. */
export const KIND_VERSIONS = {
  law: 'legal-corpus.law@1',
  regulation: 'legal-corpus.regulation@1',
  legislative_act: 'legal-corpus.legislative-act@1',
  caselaw: 'legal-corpus.caselaw@1',
  court: 'legal-corpus.court@1',
  municipal_instrument: 'legal-corpus.municipal-instrument@1',
} as const;

export type KindName = keyof typeof KIND_VERSIONS;
export type KindVersion = (typeof KIND_VERSIONS)[KindName];

const STATUTE_VIEW_PIN = 'worldwide-legal-search.law-source@1';
const SECTION_SCHEMA_PIN = 'worldwide-legal-search.law-section@1';
const APPLICABILITY_PIN = 'not-asserted';
const LAW_SOURCE_SCHEMA_PIN = 'country-laws-ir-graphrag/v1';
const LAW_VERIFY_SCHEMA_PIN = 'country-laws-normalize-verify/v1';

function pinned(actual: string, expected: string, label: string): string {
  if (actual !== expected) {
    throw new Error(`${label} is ${actual}, not ${expected}`);
  }
  return actual;
}

export const STATUTE_VIEW_ID = pinned(LAW_SOURCE_SCHEMA, STATUTE_VIEW_PIN, 'LAW_SOURCE_SCHEMA');
export const SECTION_SCHEMA_ID = pinned(LAW_SECTION_SCHEMA, SECTION_SCHEMA_PIN, 'LAW_SECTION_SCHEMA');
export const JURISDICTION_APPLICABILITY = pinned(APPLICABILITY, APPLICABILITY_PIN, 'APPLICABILITY');

export interface ViewBinding {
  viewId: string;
  kind: KindName;
  kindVersion: KindVersion;
  sectionSchema?: string;
  sourceSchemaVersion?: string;
  verifySchemaVersion?: string;
}

/**
 * Statute view, then the five reserved kind views in register order.
 * The statute binding also names the section record and the law kind's
 * source and verify schemas. Those source strings are not kind versions.
 */
export const VIEW_BINDINGS: readonly ViewBinding[] = [
  {
    viewId: STATUTE_VIEW_ID,
    kind: 'law',
    kindVersion: KIND_VERSIONS.law,
    sectionSchema: SECTION_SCHEMA_ID,
    sourceSchemaVersion: LAW_SOURCE_SCHEMA_PIN,
    verifySchemaVersion: LAW_VERIFY_SCHEMA_PIN,
  },
  {
    viewId: CASELAW_VIEW_ID,
    kind: 'caselaw',
    kindVersion: KIND_VERSIONS.caselaw,
  },
  {
    viewId: REGULATION_VIEW_ID,
    kind: 'regulation',
    kindVersion: KIND_VERSIONS.regulation,
  },
  {
    viewId: LEGISLATIVE_ACT_VIEW_ID,
    kind: 'legislative_act',
    kindVersion: KIND_VERSIONS.legislative_act,
  },
  {
    viewId: COURT_VIEW_ID,
    kind: 'court',
    kindVersion: KIND_VERSIONS.court,
  },
  {
    viewId: MUNICIPAL_INSTRUMENT_VIEW_ID,
    kind: 'municipal_instrument',
    kindVersion: KIND_VERSIONS.municipal_instrument,
  },
];

const ACCEPTED_KIND_VERSIONS: ReadonlySet<string> = new Set(
  Object.values(KIND_VERSIONS),
);

export class UnknownInstrumentVersionError extends Error {
  readonly version: string;

  constructor(version: string) {
    super(`unknown instrument version ${version}`);
    this.name = 'UnknownInstrumentVersionError';
    this.version = version;
  }
}

/** Accept a kind version this contract can render. Any other string is rejected. */
export function acceptInstrumentVersion(version: string): KindVersion {
  if (!ACCEPTED_KIND_VERSIONS.has(version)) {
    throw new UnknownInstrumentVersionError(version);
  }
  return version as KindVersion;
}

export function kindVersionForView(viewId: string): KindVersion {
  const binding = VIEW_BINDINGS.find((row) => row.viewId === viewId);
  if (binding === undefined) {
    throw new UnknownInstrumentVersionError(viewId);
  }
  return acceptInstrumentVersion(binding.kindVersion);
}

export const instrumentViewContract = {
  schema: INSTRUMENT_VIEW_CONTRACT_ID,
  instrument: INSTRUMENT_INTERFACE_ID,
  queryPlace: QUERY_PLACE,
  applicability: JURISDICTION_APPLICABILITY,
  views: VIEW_BINDINGS,
} as const;

export const CONTRACT_FIELD_NAMES = [
  'applicability',
  'instrument',
  'queryPlace',
  'schema',
  'views',
] as const;

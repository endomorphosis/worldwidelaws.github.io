/**
 * Date-aware candidate scope and law status.
 *
 * An as-of value is applied to boundary validity and to law validity
 * separately. Partial dates compare at the coarser shared precision, using the
 * same interval rule as the jurisdiction graph: the start is inclusive and the
 * end stays inside on its own year, month, or day. A zoned instant is first
 * turned into the civil day of that source's timezone. A civil as-of date is
 * compared as a calendar label and is not shifted, but the source timezone
 * still has to be usable.
 *
 * Unknown dates, an unknown declared status, and an unknown or invalid
 * timezone are not current. An open repeal is a sourced statement that the
 * instrument has no end. It is not an unknown end.
 *
 * Commencement, publication, amendment, and repeal stay separate fields.
 * Publication does not start validity. An amendment does not replace
 * commencement and does not repeal the instrument. Repeal is not recorded as
 * an amendment.
 *
 * In-force describes the instrument interval. It does not decide that the
 * instrument binds conduct. Geometry is not an input, and administrative
 * parents are not walked.
 */

import type { DatePrecision, LegalRecordStatus } from '../contracts';
import {
  APPLICABILITY,
  intervalStatus,
  type BoundaryRole,
  type DatedBound,
  type IntervalEnd,
  type IntervalStatus,
  type JurisdictionGraph,
  type ValidityInterval,
} from './schema';

export const TEMPORAL_SCOPE_SCHEMA = 'worldwide-legal-search.temporal-scope@1';
export const TEMPORAL_SCHEMA_VERSION = 1 as const;

export const LAW_DATE_FIELDS = ['commencement', 'publication', 'amendment', 'repeal'] as const;

export const LAW_STATUS_LABELS = [
  'in-force',
  'not-yet-in-force',
  'repealed',
  'historical',
  'superseded',
  'unknown',
] as const;

export const TEMPORAL_LIMITS = {
  maxPlaces: 20000,
  maxBoundaries: 20000,
  maxLaws: 5000,
  maxAmendments: 64,
  maxOmittedIds: 100,
} as const;

export const TEMPORAL_UNCERTAINTY = {
  notDetermination: 'This as-of scope does not decide what binds conduct at this place.',
  unknownNotCurrent: 'Unknown dates, status, and timezones are not treated as current.',
  approximate: 'An approximate boundary is dated coverage, not a surveyed primary boundary.',
  truncated: 'The as-of scope stopped at a bounded limit and is incomplete.',
} as const;

const FLOATING_REVISIONS = new Set([
  'head',
  'main',
  'master',
  'latest',
  'trunk',
  'current',
  'floating',
  'unpinned',
  'none',
  'null',
  'undefined',
  'tip',
  'dev',
  'develop',
]);

const RECORD_STATUSES = new Set<LegalRecordStatus>([
  'current',
  'historical',
  'repealed',
  'superseded',
  'unknown',
]);

const OFFSET_ZONE = /^([+-])(\d{2}):(\d{2})$/;
const IANA_ZONE = /^[A-Za-z][A-Za-z0-9_+/-]{0,63}$/;
const INSTANT_TEXT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/;

const OPEN_END: IntervalEnd = { knowledge: 'open', value: null, precision: null, source: 'temporal' };
const ANCIENT_START: DatedBound = { knowledge: 'known', value: '0001', precision: 'year', source: 'temporal' };

export type LawDateFieldName = (typeof LAW_DATE_FIELDS)[number];
export type LawStatusLabel = (typeof LAW_STATUS_LABELS)[number];
export type ZoneKnowledge = 'known' | 'inferred' | 'unknown' | 'invalid';
export type DateFieldKnowledge = 'known' | 'inferred' | 'unknown' | 'open' | 'invalid';
export type BoundaryTemporalStatus = 'inside' | 'outside' | 'unknown' | 'omitted';
export type PlaceTemporalStatus = 'inside' | 'outside' | 'unknown';
export type AmendmentEffect = 'effective' | 'not-yet-effective' | 'undecided';

export class TemporalScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TemporalScopeError';
  }
}

export interface ResolvedAsOf {
  input: string;
  kind: 'civil' | 'instant';
  precision: DatePrecision | null;
  civil: string | null;
  utc: string | null;
}

export interface ResolvedZone {
  knowledge: ZoneKnowledge;
  timeZone: string | null;
  source: string | null;
  usable: boolean;
  problem: 'unknown-timezone' | 'invalid-timezone' | 'duplicate-timezone' | null;
}

export interface LawDateField {
  field: 'commencement' | 'publication' | 'repeal';
  knowledge: DateFieldKnowledge;
  value: string | null;
  precision: DatePrecision | null;
  source: string | null;
}

export interface AmendmentEvent {
  amendmentId: string;
  knowledge: DateFieldKnowledge;
  value: string | null;
  precision: DatePrecision | null;
  source: string | null;
  effect: AmendmentEffect;
}

export interface AmendmentField {
  field: 'amendment';
  events: AmendmentEvent[];
  omitted: number;
}

export interface LawDateFields {
  commencement: LawDateField;
  publication: LawDateField;
  amendment: AmendmentField;
  repeal: LawDateField;
}

export interface TemporalReason {
  code: string;
  detail: string;
}

export interface BoundaryTemporalAssessment {
  placeId: string;
  boundaryId: string;
  role: BoundaryRole;
  viewId: string | null;
  selected: boolean;
  establishesScope: boolean;
  timeZone: ResolvedZone;
  civilAsOf: string | null;
  interval: IntervalStatus | null;
  status: BoundaryTemporalStatus;
  current: boolean;
  reasons: TemporalReason[];
}

export interface PlaceTemporalAssessment {
  placeId: string;
  timeZone: ResolvedZone;
  civilAsOf: string | null;
  nodeInterval: IntervalStatus | null;
  boundaryStatus: 'inside' | 'outside' | 'unknown';
  approximate: boolean;
  status: PlaceTemporalStatus;
  current: boolean;
  reasons: TemporalReason[];
}

export interface LawTemporalAssessment {
  lawId: string;
  sourceId: string | null;
  sourceRevision: string | null;
  timeZone: ResolvedZone;
  civilAsOf: string | null;
  dates: LawDateFields;
  declaredStatus: LegalRecordStatus | null;
  validity: IntervalStatus;
  lawStatus: LawStatusLabel;
  boundaryStatus: 'inside' | 'outside' | 'unknown' | 'mixed';
  territorialIds: string[];
  currentTerritorialIds: string[];
  inScope: boolean;
  current: boolean;
  reasons: TemporalReason[];
}

export interface TemporalScope {
  schema: typeof TEMPORAL_SCOPE_SCHEMA;
  schemaVersion: typeof TEMPORAL_SCHEMA_VERSION;
  applicability: typeof APPLICABILITY;
  graphId: string | null;
  asOf: ResolvedAsOf;
  viewIds: string[];
  places: PlaceTemporalAssessment[];
  boundaries: BoundaryTemporalAssessment[];
  laws: LawTemporalAssessment[];
  currentPlaceIds: string[];
  currentLawIds: string[];
  omittedLawIds: string[];
  uncertainty: string[];
  truncated: boolean;
  checks: {
    placesConsidered: number;
    boundariesConsidered: number;
    lawsConsidered: number;
  };
}

export interface ZoneInputObject {
  knowledge?: unknown;
  timeZone?: unknown;
  source?: unknown;
}

export type ZoneInput = string | ZoneInputObject | null;

export interface PlaceClockInput {
  placeId?: unknown;
  timeZone?: ZoneInput;
}

export interface BoundaryClockInput {
  boundaryId?: unknown;
  timeZone?: ZoneInput;
}

export interface TemporalDateInput {
  knowledge?: unknown;
  value?: unknown;
  precision?: unknown;
  source?: unknown;
}

export interface AmendmentInput {
  amendmentId?: unknown;
  date?: string | number | TemporalDateInput | null;
  knowledge?: unknown;
  value?: unknown;
  precision?: unknown;
  source?: unknown;
}

export interface LawTemporalInput {
  lawId?: unknown;
  sourceId?: unknown;
  sourceRevision?: unknown;
  timeZone?: ZoneInput;
  territorialIds?: readonly unknown[];
  publication?: string | number | TemporalDateInput | null;
  commencement?: string | number | TemporalDateInput | null;
  repeal?: string | number | TemporalDateInput | null;
  amendments?: readonly AmendmentInput[] | null;
  status?: unknown;
}

export interface TemporalScopeQuery {
  graph: JurisdictionGraph;
  asOf: string;
  viewIds?: readonly string[];
  places?: readonly PlaceClockInput[];
  boundaries?: readonly BoundaryClockInput[];
  laws?: readonly LawTemporalInput[];
}

interface ParsedInstant {
  utc: string;
  milliseconds: number;
}

interface ClockIndex {
  zones: Map<string, ResolvedZone>;
  duplicates: Set<string>;
}

function reason(code: string, detail: string): TemporalReason {
  return { code, detail };
}

function clean(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).trim();
  return text ? text : null;
}

function isPrecision(value: string): value is DatePrecision {
  return value === 'day' || value === 'month' || value === 'year';
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function calendarOk(value: string, precision: DatePrecision): boolean {
  const parts = value.split('-').map((part) => Number(part));
  const year = parts[0];
  if (!Number.isInteger(year) || year < 1 || year > 9999) return false;
  if (precision === 'year') return /^\d{4}$/.test(value);
  const month = parts[1];
  if (!Number.isInteger(month) || month < 1 || month > 12) return false;
  if (precision === 'month') return /^\d{4}-\d{2}$/.test(value);
  const day = parts[2];
  const lengths = [0, 31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isInteger(day) && day >= 1 && day <= lengths[month];
}

function precisionOf(value: string): DatePrecision | null {
  if (/^\d{4}$/.test(value) && calendarOk(value, 'year')) return 'year';
  if (/^\d{4}-\d{2}$/.test(value) && calendarOk(value, 'month')) return 'month';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value) && calendarOk(value, 'day')) return 'day';
  return null;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function offsetMinutes(zone: string): number | null {
  if (zone === 'Z' || zone === 'UTC' || zone === 'Etc/UTC' || zone === 'GMT') return 0;
  const match = OFFSET_ZONE.exec(zone);
  if (!match) return null;
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  if (hours > 14 || minutes > 59 || (hours === 14 && minutes !== 0)) return null;
  return (match[1] === '-' ? -1 : 1) * (hours * 60 + minutes);
}

function zoneAccepted(zone: string): boolean {
  if (offsetMinutes(zone) !== null) return true;
  if (!IANA_ZONE.test(zone)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone }).format(0);
    return true;
  } catch {
    return false;
  }
}

function civilFromMilliseconds(milliseconds: number, zone: string): string | null {
  const offset = offsetMinutes(zone);
  if (offset !== null) {
    const shifted = new Date(milliseconds + offset * 60_000);
    const year = shifted.getUTCFullYear();
    if (year < 1 || year > 9999) return null;
    return `${String(year).padStart(4, '0')}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
  }
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(milliseconds));
  } catch {
    return null;
  }
  const picked = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  const year = picked('year').padStart(4, '0');
  const month = picked('month').padStart(2, '0');
  const day = picked('day').padStart(2, '0');
  const civil = `${year}-${month}-${day}`;
  return calendarOk(civil, 'day') ? civil : null;
}

function parseInstant(value: string): ParsedInstant | null {
  const match = INSTANT_TEXT.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const civil = `${match[1]}-${match[2]}-${match[3]}`;
  if (!calendarOk(civil, 'day')) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  const fraction = match[7] ? match[7].slice(0, 3).padEnd(3, '0') : '000';
  const offset = match[8];
  const offsetValue = offsetMinutes(offset);
  if (offsetValue === null) return null;
  const utcWall = Date.UTC(year, month - 1, day, hour, minute, second, Number(fraction));
  const milliseconds = utcWall - offsetValue * 60_000;
  if (!Number.isFinite(milliseconds)) return null;
  return { milliseconds, utc: new Date(milliseconds).toISOString() };
}

export function resolveAsOf(asOf: string): ResolvedAsOf {
  const input = asOf.trim();
  const civilPrecision = precisionOf(input);
  if (civilPrecision) {
    return { input, kind: 'civil', precision: civilPrecision, civil: input, utc: null };
  }
  const instant = parseInstant(input);
  if (!instant) {
    throw new TemporalScopeError(
      `asOf ${JSON.stringify(asOf)} is not a real year, month, day, or zoned instant.`,
    );
  }
  return { input, kind: 'instant', precision: null, civil: null, utc: instant.utc };
}

function instantMilliseconds(asOf: ResolvedAsOf): number {
  const instant = parseInstant(asOf.input);
  if (!instant) throw new TemporalScopeError(`asOf ${JSON.stringify(asOf.input)} is not a zoned instant.`);
  return instant.milliseconds;
}

function resolveZone(input: ZoneInput | undefined, duplicate: boolean): ResolvedZone {
  if (duplicate) {
    return { knowledge: 'invalid', timeZone: null, source: null, usable: false, problem: 'duplicate-timezone' };
  }
  if (input === undefined || input === null || input === '') {
    return { knowledge: 'unknown', timeZone: null, source: null, usable: false, problem: 'unknown-timezone' };
  }
  if (typeof input === 'string' || typeof input === 'number') {
    const timeZone = String(input).trim();
    if (!timeZone || !zoneAccepted(timeZone)) {
      return { knowledge: 'invalid', timeZone: timeZone || null, source: null, usable: false, problem: 'invalid-timezone' };
    }
    return { knowledge: 'known', timeZone, source: 'input', usable: true, problem: null };
  }
  if (typeof input !== 'object' || Array.isArray(input)) {
    return { knowledge: 'invalid', timeZone: null, source: null, usable: false, problem: 'invalid-timezone' };
  }
  const knowledge = input.knowledge;
  const timeZone = clean(input.timeZone);
  const source = clean(input.source);
  const zonePresent = input.timeZone !== undefined && input.timeZone !== null && String(input.timeZone).trim() !== '';
  if (knowledge === 'unknown') {
    if (zonePresent) {
      return { knowledge: 'invalid', timeZone: null, source: source, usable: false, problem: 'invalid-timezone' };
    }
    return { knowledge: 'unknown', timeZone: null, source, usable: false, problem: 'unknown-timezone' };
  }
  if (knowledge !== 'known' && knowledge !== 'inferred') {
    return { knowledge: 'invalid', timeZone, source, usable: false, problem: 'invalid-timezone' };
  }
  if (!timeZone || !source || !zoneAccepted(timeZone)) {
    return { knowledge: 'invalid', timeZone, source, usable: false, problem: 'invalid-timezone' };
  }
  return { knowledge, timeZone, source, usable: true, problem: null };
}

function indexClocks(entries: readonly { id: string; timeZone?: ZoneInput }[]): ClockIndex {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.id)) duplicates.add(entry.id);
    seen.add(entry.id);
  }
  const zones = new Map<string, ResolvedZone>();
  for (const entry of entries) {
    if (duplicates.has(entry.id) || zones.has(entry.id)) continue;
    zones.set(entry.id, resolveZone(entry.timeZone, false));
  }
  for (const id of duplicates) zones.set(id, resolveZone(undefined, true));
  return { zones, duplicates };
}

function clockFor(index: ClockIndex, id: string): ResolvedZone {
  return index.zones.get(id) ?? resolveZone(undefined, false);
}

function civilFor(asOf: ResolvedAsOf, zone: ResolvedZone): string | null {
  if (asOf.kind === 'civil') return asOf.civil;
  if (!zone.usable || !zone.timeZone) return null;
  return civilFromMilliseconds(instantMilliseconds(asOf), zone.timeZone);
}

function invalidDate(field: 'commencement' | 'publication' | 'repeal'): LawDateField {
  return { field, knowledge: 'invalid', value: null, precision: null, source: null };
}

function parseDateField(
  field: 'commencement' | 'publication' | 'repeal',
  input: string | number | TemporalDateInput | null | undefined,
): LawDateField {
  if (input === undefined || input === null || input === '') {
    return { field, knowledge: 'unknown', value: null, precision: null, source: null };
  }
  if (typeof input === 'string' || typeof input === 'number') {
    const value = String(input).trim();
    const precision = precisionOf(value);
    if (!precision) return invalidDate(field);
    return { field, knowledge: 'known', value, precision, source: field };
  }
  if (typeof input !== 'object' || Array.isArray(input)) return invalidDate(field);
  const knowledge = input.knowledge;
  const source = clean(input.source);
  const rawValue = input.value;
  const hasValue = rawValue !== undefined && rawValue !== null && String(rawValue).trim() !== '';
  const precisionPresent = input.precision !== undefined && input.precision !== null && input.precision !== '';
  if (knowledge === 'open' || knowledge === 'none') {
    if (field !== 'repeal' || hasValue || precisionPresent || !source) return invalidDate(field);
    return { field, knowledge: 'open', value: null, precision: null, source };
  }
  if (knowledge === undefined || knowledge === null || knowledge === '') {
    if (!hasValue && !precisionPresent) {
      return { field, knowledge: 'unknown', value: null, precision: null, source };
    }
    return invalidDate(field);
  }
  if (knowledge === 'unknown') {
    if (hasValue || precisionPresent) return invalidDate(field);
    return { field, knowledge: 'unknown', value: null, precision: null, source };
  }
  if (knowledge !== 'known' && knowledge !== 'inferred') return invalidDate(field);
  if (!hasValue || typeof input.precision !== 'string' || !isPrecision(input.precision) || !source) return invalidDate(field);
  const value = String(rawValue).trim();
  if (precisionOf(value) !== input.precision) return invalidDate(field);
  return { field, knowledge, value, precision: input.precision, source };
}

function datedBound(field: LawDateField): DatedBound | null {
  if ((field.knowledge !== 'known' && field.knowledge !== 'inferred') || !field.value || !field.precision || !field.source) {
    return null;
  }
  return { knowledge: field.knowledge, value: field.value, precision: field.precision, source: field.source };
}

function intervalEnd(field: LawDateField): IntervalEnd | null {
  if (field.knowledge === 'open' && field.source) {
    return { knowledge: 'open', value: null, precision: null, source: field.source };
  }
  if (field.knowledge === 'unknown') return { knowledge: 'unknown', value: null, precision: null, source: field.source };
  return datedBound(field);
}

function comparable(bound: DatedBound | IntervalEnd): bound is DatedBound {
  return bound.knowledge === 'known' || bound.knowledge === 'inferred';
}

function outsideSide(civil: string, start: DatedBound | IntervalEnd, end: IntervalEnd): 'before' | 'after' | 'unknown' {
  if (comparable(start)) {
    const started = intervalStatus({ start, end: OPEN_END }, civil);
    if (started === 'outside') return 'before';
  }
  if (comparable(end)) {
    const covered = intervalStatus({ start: ANCIENT_START, end }, civil);
    if (covered === 'outside') return 'after';
  }
  return 'unknown';
}

function lawValidity(commencement: LawDateField, repeal: LawDateField, civil: string | null): {
  validity: IntervalStatus;
  side: 'before' | 'after' | 'within' | 'unknown';
} {
  if (!civil || commencement.knowledge === 'invalid' || repeal.knowledge === 'invalid') {
    return { validity: 'unknown', side: 'unknown' };
  }
  if (commencement.knowledge === 'open') return { validity: 'unknown', side: 'unknown' };
  const start = commencement.knowledge === 'unknown'
    ? { knowledge: 'unknown' as const, value: null, precision: null, source: commencement.source }
    : datedBound(commencement);
  const end = intervalEnd(repeal);
  if (!start || !end) return { validity: 'unknown', side: 'unknown' };
  const interval: ValidityInterval = { start, end };
  const validity = intervalStatus(interval, civil);
  if (validity !== 'outside') return { validity, side: validity === 'inside' ? 'within' : 'unknown' };
  return { validity, side: outsideSide(civil, start, end) };
}

function blankAmendment(amendmentId: string): AmendmentEvent {
  return {
    amendmentId,
    knowledge: 'invalid',
    value: null,
    precision: null,
    source: null,
    effect: 'undecided',
  };
}

function parseAmendment(input: AmendmentInput, civil: string | null): AmendmentEvent {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return blankAmendment('');
  const amendmentId = clean(input.amendmentId);
  if (!amendmentId) return blankAmendment('');
  const dateInput = input.date === undefined
    ? {
      knowledge: input.knowledge,
      value: input.value,
      precision: input.precision,
      source: input.source,
    }
    : input.date;
  const parsed = parseDateField('publication', dateInput as TemporalDateInput | string | number | null);
  const shorthand = typeof dateInput === 'string' || typeof dateInput === 'number';
  const event: AmendmentEvent = {
    amendmentId,
    knowledge: parsed.knowledge === 'open' ? 'invalid' : parsed.knowledge,
    value: parsed.knowledge === 'open' ? null : parsed.value,
    precision: parsed.knowledge === 'open' ? null : parsed.precision,
    source: shorthand ? 'amendment' : parsed.source,
    effect: 'undecided',
  };
  if (event.knowledge === 'invalid' || event.knowledge === 'unknown' || !civil) return event;
  const start = datedBound({
    field: 'publication',
    knowledge: event.knowledge,
    value: event.value,
    precision: event.precision,
    source: event.source,
  });
  if (!start) {
    event.effect = 'undecided';
    return event;
  }
  const status = intervalStatus({ start, end: OPEN_END }, civil);
  event.effect = status === 'inside' ? 'effective' : status === 'outside' ? 'not-yet-effective' : 'undecided';
  return event;
}

function declaredStatus(input: unknown): { status: LegalRecordStatus | null; invalid: boolean } {
  if (input === undefined || input === null || input === '') return { status: null, invalid: false };
  if (typeof input !== 'string' || !RECORD_STATUSES.has(input as LegalRecordStatus)) {
    return { status: null, invalid: true };
  }
  return { status: input as LegalRecordStatus, invalid: false };
}

function sourceProblem(sourceId: string | null, sourceRevision: string | null): 'missing-source' | 'unpinned-source' | null {
  if (!sourceId || !sourceRevision) return 'missing-source';
  if (FLOATING_REVISIONS.has(sourceRevision.toLowerCase())) return 'unpinned-source';
  return null;
}

function deriveLawStatus(
  validity: IntervalStatus,
  side: 'before' | 'after' | 'within' | 'unknown',
  declared: LegalRecordStatus | null,
): LawStatusLabel {
  if (validity === 'unknown') return 'unknown';
  if (validity === 'inside') {
    if (declared === 'historical') return 'historical';
    if (declared === 'superseded') return 'superseded';
    if (declared === 'repealed') return 'unknown';
    return 'in-force';
  }
  if (side === 'before') {
    if (declared === 'historical' || declared === 'superseded' || declared === 'repealed') return 'unknown';
    return 'not-yet-in-force';
  }
  if (side === 'after') {
    if (declared === 'current') return 'unknown';
    if (declared === 'superseded') return 'superseded';
    if (declared === 'historical') return 'historical';
    return 'repealed';
  }
  return 'unknown';
}

function zoneReason(zone: ResolvedZone, subject: string): TemporalReason | null {
  if (!zone.problem) return null;
  if (zone.problem === 'duplicate-timezone') {
    return reason('duplicate-timezone', `${subject} names more than one timezone. Neither zone was chosen.`);
  }
  if (zone.problem === 'invalid-timezone') {
    return reason('invalid-timezone', `${subject} timezone is not a usable IANA zone or fixed offset. It was not treated as UTC.`);
  }
  return reason('unknown-timezone', `${subject} timezone is unknown and was not treated as current.`);
}

function selectedView(viewId: string | null, viewIds: ReadonlySet<string>): boolean {
  return viewId === null || viewIds.has(viewId);
}

function boundaryInterval(interval: ValidityInterval, civil: string | null): IntervalStatus | null {
  if (!civil) return null;
  return intervalStatus(interval, civil);
}

function pushUnique(reasons: TemporalReason[], item: TemporalReason | null): void {
  if (!item) return;
  if (reasons.some((existing) => existing.code === item.code)) return;
  reasons.push(item);
}

function assessBoundaries(
  graph: JurisdictionGraph,
  asOf: ResolvedAsOf,
  clocks: ClockIndex,
  viewIds: ReadonlySet<string>,
): { boundaries: BoundaryTemporalAssessment[]; truncated: boolean; considered: number } {
  const rows: BoundaryAssessmentDraft[] = [];
  let seen = 0;
  let truncated = false;
  for (const node of graph.nodes) {
    if (!node.roles.includes('place')) continue;
    for (const boundary of node.boundaries) {
      seen += 1;
      if (rows.length >= TEMPORAL_LIMITS.maxBoundaries) {
        truncated = true;
        continue;
      }
      rows.push({ placeId: node.id, boundary });
    }
  }
  const byPlace = new Map<string, BoundaryTemporalAssessment[]>();
  const assessments: BoundaryTemporalAssessment[] = [];
  for (const row of rows) {
    const zone = clockFor(clocks, row.boundary.boundaryId);
    const selected = selectedView(row.boundary.viewId, viewIds);
    const civilAsOf = civilFor(asOf, zone);
    const interval = boundaryInterval(row.boundary.valid, asOf.kind === 'civil' ? asOf.civil : civilAsOf);
    const reasons: TemporalReason[] = [];
    let status: BoundaryTemporalStatus;
    if (!selected) {
      status = 'omitted';
      reasons.push(reason('view-not-selected', `${row.boundary.boundaryId} is held in a view that was not selected.`));
    } else if (!zone.usable) {
      status = 'unknown';
      pushUnique(reasons, zoneReason(zone, row.boundary.boundaryId));
    } else if (interval === 'inside') {
      status = 'inside';
    } else if (interval === 'outside') {
      status = 'outside';
      reasons.push(reason('boundary-outside', `${row.boundary.boundaryId} is outside its validity at this date and is not current.`));
    } else {
      status = 'unknown';
      reasons.push(reason('boundary-unknown', `${row.boundary.boundaryId} has unknown validity and was not treated as current.`));
    }
    const assessment: BoundaryTemporalAssessment = {
      placeId: row.placeId,
      boundaryId: row.boundary.boundaryId,
      role: row.boundary.role,
      viewId: row.boundary.viewId,
      selected,
      establishesScope: false,
      timeZone: zone,
      civilAsOf,
      interval,
      status,
      current: status === 'inside',
      reasons,
    };
    assessments.push(assessment);
    const list = byPlace.get(row.placeId) ?? [];
    list.push(assessment);
    byPlace.set(row.placeId, list);
  }
  for (const list of byPlace.values()) markEstablishing(list);
  assessments.sort((left, right) => left.placeId.localeCompare(right.placeId)
    || left.boundaryId.localeCompare(right.boundaryId)
    || left.role.localeCompare(right.role));
  return { boundaries: assessments, truncated, considered: Math.min(seen, TEMPORAL_LIMITS.maxBoundaries) };
}

interface BoundaryAssessmentDraft {
  placeId: string;
  boundary: JurisdictionGraph['nodes'][number]['boundaries'][number];
}

function markEstablishing(list: BoundaryTemporalAssessment[]): void {
  const primaries = list.filter((item) => item.role === 'primary');
  const disputed = list.filter((item) => item.role === 'disputed');
  const selectedPrimaries = primaries.filter((item) => item.selected);
  const selectedDisputed = disputed.filter((item) => item.selected);
  let pool: BoundaryTemporalAssessment[] = [];
  let approximateOnly = false;
  if (selectedPrimaries.length > 0 || selectedDisputed.length > 0) {
    pool = [...selectedPrimaries, ...selectedDisputed];
  } else if (primaries.length === 0 && disputed.length === 0) {
    pool = list.filter((item) => item.role === 'approximate' && item.selected);
    approximateOnly = pool.length > 0;
  }
  for (const item of pool) {
    item.establishesScope = true;
    if (approximateOnly && item.current) {
      pushUnique(item.reasons, reason('approximate-boundary', `${item.boundaryId} is an approximate boundary. It is not a primary boundary.`));
    }
  }
}

function assessPlaces(
  graph: JurisdictionGraph,
  asOf: ResolvedAsOf,
  clocks: ClockIndex,
  boundaries: BoundaryTemporalAssessment[],
): { places: PlaceTemporalAssessment[]; truncated: boolean; considered: number } {
  const grouped = new Map<string, BoundaryTemporalAssessment[]>();
  for (const boundary of boundaries) {
    const list = grouped.get(boundary.placeId) ?? [];
    list.push(boundary);
    grouped.set(boundary.placeId, list);
  }
  const places: PlaceTemporalAssessment[] = [];
  let seen = 0;
  let truncated = false;
  const nodes = [...graph.nodes].filter((node) => node.roles.includes('place'))
    .sort((left, right) => left.id.localeCompare(right.id));
  for (const node of nodes) {
    seen += 1;
    if (places.length >= TEMPORAL_LIMITS.maxPlaces) {
      truncated = true;
      continue;
    }
    const zone = clockFor(clocks, node.id);
    const civilAsOf = civilFor(asOf, zone);
    const comparedCivil = asOf.kind === 'civil' ? asOf.civil : civilAsOf;
    const nodeInterval = comparedCivil ? intervalStatus(node.valid, comparedCivil) : null;
    const own = grouped.get(node.id) ?? [];
    const pool = own.filter((item) => item.establishesScope);
    const approximate = pool.some((item) => item.role === 'approximate' && item.current);
    const reasons: TemporalReason[] = [];
    pushUnique(reasons, zoneReason(zone, node.id));
    let boundaryStatus: 'inside' | 'outside' | 'unknown';
    if (pool.some((item) => item.current)) boundaryStatus = 'inside';
    else if (pool.length === 0 || pool.some((item) => item.status === 'unknown' || item.status === 'omitted')) boundaryStatus = 'unknown';
    else boundaryStatus = 'outside';
    let status: PlaceTemporalStatus;
    if (!zone.usable || nodeInterval === null || nodeInterval === 'unknown') {
      status = 'unknown';
      if (nodeInterval === 'unknown') {
        pushUnique(reasons, reason('node-unknown', `${node.id} has unknown validity and was not treated as a current place.`));
      }
    } else if (nodeInterval === 'outside') {
      status = 'outside';
      reasons.push(reason('node-outside', `${node.id} is outside its validity at this date and is not current.`));
    } else if (boundaryStatus === 'inside') {
      status = 'inside';
      reasons.push(reason('boundary-inside', `${node.id} has a boundary whose validity contains this date.`));
      if (approximate) {
        pushUnique(reasons, reason('approximate-boundary', `${node.id} is current only through an approximate boundary.`));
      }
    } else if (boundaryStatus === 'outside') {
      status = 'outside';
      reasons.push(reason('boundary-outside', `${node.id} has no boundary that contains this date.`));
    } else {
      status = 'unknown';
      reasons.push(reason(
        pool.length === 0 ? 'no-boundary' : 'boundary-unknown',
        pool.length === 0
          ? `${node.id} has no selected boundary, so its boundary validity is unknown and is not current.`
          : `${node.id} has unknown boundary validity and was not treated as current.`,
      ));
    }
    places.push({
      placeId: node.id,
      timeZone: zone,
      civilAsOf,
      nodeInterval,
      boundaryStatus,
      approximate: status === 'inside' && approximate,
      status,
      current: status === 'inside',
      reasons,
    });
  }
  return { places, truncated, considered: Math.min(seen, TEMPORAL_LIMITS.maxPlaces) };
}

function readTerritories(input: readonly unknown[] | undefined): string[] {
  if (!input) return [];
  const ids: string[] = [];
  for (const item of input) {
    const id = clean(item);
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

function territoryPicture(
  territorialIds: string[],
  places: ReadonlyMap<string, PlaceTemporalAssessment>,
): { boundaryStatus: LawTemporalAssessment['boundaryStatus']; currentTerritorialIds: string[]; reasons: TemporalReason[] } {
  if (territorialIds.length === 0) {
    return {
      boundaryStatus: 'unknown',
      currentTerritorialIds: [],
      reasons: [reason('no-territory', 'The law names no territory, so it is not a current candidate.')],
    };
  }
  const currentTerritorialIds: string[] = [];
  let outside = 0;
  let unknown = 0;
  const reasons: TemporalReason[] = [];
  for (const id of territorialIds) {
    const place = places.get(id);
    if (!place) {
      unknown += 1;
      reasons.push(reason('territory-missing', `${id} is not a place in this graph. No territory was invented.`));
      continue;
    }
    if (place.current) {
      currentTerritorialIds.push(id);
      continue;
    }
    if (place.status === 'outside') {
      outside += 1;
      reasons.push(reason('territory-not-current', `${id} is outside boundary or place validity at this date.`));
    } else {
      unknown += 1;
      reasons.push(reason('territory-not-current', `${id} is not a current place at this date.`));
    }
  }
  let boundaryStatus: LawTemporalAssessment['boundaryStatus'];
  if (currentTerritorialIds.length === territorialIds.length) boundaryStatus = 'inside';
  else if (currentTerritorialIds.length > 0) boundaryStatus = 'mixed';
  else if (outside > 0 && unknown === 0) boundaryStatus = 'outside';
  else boundaryStatus = 'unknown';
  return { boundaryStatus, currentTerritorialIds, reasons };
}

function assessLaw(
  input: LawTemporalInput | null,
  asOf: ResolvedAsOf,
  zone: ResolvedZone,
  duplicate: boolean,
  places: ReadonlyMap<string, PlaceTemporalAssessment>,
): LawTemporalAssessment {
  if (!input || typeof input !== 'object' || Array.isArray(input)) input = {};
  const lawId = clean(input.lawId) ?? '';
  const sourceId = clean(input.sourceId);
  const sourceRevision = clean(input.sourceRevision);
  const civilAsOf = civilFor(asOf, zone);
  const comparedCivil = asOf.kind === 'civil' ? asOf.civil : civilAsOf;
  const commencement = parseDateField('commencement', input.commencement);
  const publication = parseDateField('publication', input.publication);
  const repeal = parseDateField('repeal', input.repeal);
  const rawAmendments = [...(input.amendments ?? [])].sort((left, right) => {
    const leftId = clean(left.amendmentId) ?? '';
    const rightId = clean(right.amendmentId) ?? '';
    return leftId.localeCompare(rightId);
  });
  const omitted = Math.max(0, rawAmendments.length - TEMPORAL_LIMITS.maxAmendments);
  const seenAmendment = new Set<string>();
  const events = rawAmendments.slice(0, TEMPORAL_LIMITS.maxAmendments).map((item) => {
    const event = parseAmendment(item, comparedCivil);
    if (!event.amendmentId || seenAmendment.has(event.amendmentId)) {
      return { ...event, knowledge: 'invalid' as const, effect: 'undecided' as const };
    }
    seenAmendment.add(event.amendmentId);
    return event;
  });
  const dates: LawDateFields = {
    commencement,
    publication,
    amendment: { field: 'amendment', events, omitted },
    repeal,
  };
  const declared = declaredStatus(input.status);
  const validityResult = lawValidity(commencement, repeal, comparedCivil);
  const territorialIds = readTerritories(input.territorialIds);
  const territory = territoryPicture(territorialIds, places);
  const reasons: TemporalReason[] = [];
  if (duplicate) reasons.push(reason('duplicate-law', `${lawId} is duplicated. Neither copy was treated as current.`));
  const pinning = sourceProblem(sourceId, sourceRevision);
  if (pinning === 'missing-source') {
    reasons.push(reason('missing-source', `${lawId || 'This law'} has no source id or pinned revision.`));
  } else if (pinning === 'unpinned-source') {
    reasons.push(reason('unpinned-source', `${lawId} source revision is a floating label. It was not treated as current.`));
  }
  pushUnique(reasons, zoneReason(zone, lawId || 'This law'));
  if (commencement.knowledge === 'invalid') {
    reasons.push(reason('invalid-date', 'Commencement is not a usable partial date. It was not copied from publication.'));
  }
  if (publication.knowledge === 'invalid') {
    reasons.push(reason('invalid-date', 'Publication is not a usable partial date.'));
  }
  if (repeal.knowledge === 'invalid') {
    reasons.push(reason('invalid-date', 'Repeal is not a usable partial date. It was not copied from an amendment.'));
  }
  if (omitted > 0) {
    reasons.push(reason('amendment-limit', `${omitted} amendments were past the limit and were not treated as absent.`));
  }
  if (events.some((event) => event.knowledge === 'invalid' || !event.amendmentId)) {
    reasons.push(reason('invalid-amendment', 'An amendment is missing an id or a usable date. It was not folded into repeal.'));
  }
  if (events.some((event) => event.knowledge === 'unknown')) {
    reasons.push(reason('unknown-amendment', 'An amendment date is unknown and was not treated as current text.'));
  }
  if (declared.invalid || declared.status === 'unknown') {
    reasons.push(reason('unknown-status', 'Declared status is unknown and was not treated as current.'));
  }
  const blocked = reasons.length > 0;
  let lawStatus = blocked
    ? 'unknown'
    : deriveLawStatus(validityResult.validity, validityResult.side, declared.status);
  if (!blocked && lawStatus === 'unknown' && validityResult.validity !== 'unknown') {
    reasons.push(reason('status-date-conflict', 'Declared status and the commencement or repeal date disagree. Neither was chosen.'));
  }
  if (!blocked && lawStatus === 'unknown' && validityResult.validity === 'unknown') {
    if (commencement.knowledge === 'unknown') {
      reasons.push(reason('unknown-commencement', 'Commencement is unknown and was not treated as current.'));
    }
    if (repeal.knowledge === 'unknown') {
      reasons.push(reason('unknown-repeal', 'Repeal is unknown and was not treated as an open end or as current.'));
    }
  }
  if (lawStatus === 'not-yet-in-force') {
    reasons.push(reason('not-yet-in-force', 'Commencement is after this date. Publication was not used as the start.'));
  } else if (lawStatus === 'repealed') {
    reasons.push(reason('repealed', 'This date is after the repeal date at the coarser shared precision. The repeal date itself stays inside.'));
  } else if (lawStatus === 'historical') {
    reasons.push(reason('historical', 'The source labels this instrument historical. That label is not repealed and is not current.'));
  } else if (lawStatus === 'superseded') {
    reasons.push(reason('superseded', 'The source labels this instrument superseded. That label is not repealed and is not current.'));
  } else if (lawStatus === 'in-force') {
    reasons.push(reason('in-force', 'Commencement contains this date and repeal has not ended it. Amendments stay on their own field.'));
  }
  reasons.push(...territory.reasons);
  const inScope = territory.currentTerritorialIds.length > 0;
  return {
    lawId,
    sourceId,
    sourceRevision,
    timeZone: zone,
    civilAsOf,
    dates,
    declaredStatus: declared.status,
    validity: validityResult.validity,
    lawStatus,
    boundaryStatus: territory.boundaryStatus,
    territorialIds,
    currentTerritorialIds: territory.currentTerritorialIds,
    inScope,
    current: lawStatus === 'in-force' && inScope,
    reasons,
  };
}

function requireGraph(graph: JurisdictionGraph): void {
  if (!graph || typeof graph !== 'object' || !Array.isArray(graph.nodes) || !Array.isArray(graph.disputedViews)) {
    throw new TemporalScopeError('A jurisdiction graph is required. No places were invented.');
  }
}

/**
 * Resolve which places and laws are current at an as-of date.
 * Current means the source timezone is usable, boundary validity contains the
 * date, and law validity is in force. Unknown is never current.
 */
export function scopeAsOf(query: TemporalScopeQuery): TemporalScope {
  requireGraph(query.graph);
  if (query.viewIds !== undefined && !Array.isArray(query.viewIds)) {
    throw new TemporalScopeError('viewIds must be an array. No view was selected.');
  }
  if (query.places !== undefined && !Array.isArray(query.places)) {
    throw new TemporalScopeError('places must be an array. No place clock was invented.');
  }
  if (query.boundaries !== undefined && !Array.isArray(query.boundaries)) {
    throw new TemporalScopeError('boundaries must be an array. No boundary clock was invented.');
  }
  if (query.laws !== undefined && !Array.isArray(query.laws)) {
    throw new TemporalScopeError('laws must be an array. No law was invented.');
  }
  const asOf = resolveAsOf(query.asOf);
  const knownViews = new Set(query.graph.disputedViews.map((view) => view.id));
  const viewIds = [...(query.viewIds ?? [])];
  for (const viewId of viewIds) {
    if (!knownViews.has(viewId)) {
      throw new TemporalScopeError(`Disputed view ${JSON.stringify(viewId)} is not in graph ${query.graph.graphId}.`);
    }
  }
  const viewSet = new Set(viewIds);
  const placeClocks = indexClocks((query.places ?? []).map((item) => ({
    id: clean(item.placeId) ?? '',
    timeZone: item.timeZone,
  })).filter((item) => item.id));
  const boundaryClocks = indexClocks((query.boundaries ?? []).map((item) => ({
    id: clean(item.boundaryId) ?? '',
    timeZone: item.timeZone,
  })).filter((item) => item.id));
  const boundaryResult = assessBoundaries(query.graph, asOf, boundaryClocks, viewSet);
  const placeResult = assessPlaces(query.graph, asOf, placeClocks, boundaryResult.boundaries);
  const placeMap = new Map(placeResult.places.map((place) => [place.placeId, place]));
  const lawInputs = [...(query.laws ?? [])];
  const ids = lawInputs.map((item) => clean(item.lawId) ?? '');
  const duplicateIds = new Set<string>();
  const seenIds = new Set<string>();
  for (const id of ids) {
    if (!id) continue;
    if (seenIds.has(id)) duplicateIds.add(id);
    seenIds.add(id);
  }
  const ordered = lawInputs
    .map((item, index) => ({ item, index, id: clean(item.lawId) ?? `\u0000${index}` }))
    .sort((left, right) => left.id.localeCompare(right.id) || left.index - right.index);
  const kept = ordered.slice(0, TEMPORAL_LIMITS.maxLaws);
  const omittedLawIds = ordered.slice(TEMPORAL_LIMITS.maxLaws, TEMPORAL_LIMITS.maxLaws + TEMPORAL_LIMITS.maxOmittedIds)
    .map((item) => item.id)
    .filter((id) => id && !id.startsWith('\u0000'));
  const lawTruncated = ordered.length > TEMPORAL_LIMITS.maxLaws;
  const laws = kept.map(({ item, id }) => assessLaw(
    item,
    asOf,
    resolveZone(item.timeZone, false),
    duplicateIds.has(id),
    placeMap,
  ));
  const uncertainty = [TEMPORAL_UNCERTAINTY.notDetermination, TEMPORAL_UNCERTAINTY.unknownNotCurrent];
  const truncated = boundaryResult.truncated || placeResult.truncated || lawTruncated || laws.some((law) => law.dates.amendment.omitted > 0);
  if (placeResult.places.some((place) => place.approximate)) uncertainty.push(TEMPORAL_UNCERTAINTY.approximate);
  if (truncated) uncertainty.push(TEMPORAL_UNCERTAINTY.truncated);
  if (lawTruncated) {
    uncertainty.push(`${ordered.length - kept.length} laws were past the limit and are not current candidates.`);
  }
  return {
    schema: TEMPORAL_SCOPE_SCHEMA,
    schemaVersion: TEMPORAL_SCHEMA_VERSION,
    applicability: APPLICABILITY,
    graphId: query.graph.graphId,
    asOf,
    viewIds,
    places: placeResult.places,
    boundaries: boundaryResult.boundaries,
    laws,
    currentPlaceIds: placeResult.places.filter((place) => place.current).map((place) => place.placeId),
    currentLawIds: laws.filter((law) => law.current).map((law) => law.lawId).sort((left, right) => left.localeCompare(right)),
    omittedLawIds,
    uncertainty,
    truncated,
    checks: {
      placesConsidered: placeResult.considered,
      boundariesConsidered: boundaryResult.considered,
      lawsConsidered: laws.length,
    },
  };
}

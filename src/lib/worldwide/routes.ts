/**
 * Stable hash routes for static hosting.
 *
 * Place identity is a stable place id. Country codes, street addresses, and
 * coordinates are not place identity. Default shared links omit precise
 * coordinates and addresses. Old WetWijzer links migrate through an explicit
 * table; a publisher URL on wetten.overheid.nl stays beside the application
 * route. This module does not decide which law applies.
 */

import { buildLawDeepLink, type DatePrecision } from './contracts';
import {
  NETHERLANDS_CURRENT_SAMPLE,
  NETHERLANDS_DECLARED_SOURCE_IDS,
  NETHERLANDS_JURISDICTION_ID,
  NETHERLANDS_PUBLISHER_ORIGIN,
} from './adapters/netherlands';

export const ROUTE_CONTRACT_ID = 'worldwide-legal-search.route-contract@1';
export const ROUTE_SCHEMA_VERSION = 1;

export const ROUTE_NAMES = ['search', 'place', 'law', 'coverage', 'sources', 'compare'] as const;
export type RouteName = (typeof ROUTE_NAMES)[number];
export type SearchScope = 'place' | 'worldwide';

export const ROUTE_LIMITS = {
  url: 4096,
  query: 500,
  id: 180,
  revision: 128,
  section: 220,
  comparePlaces: 8,
  parameters: 40,
  issues: 20,
  label: 200,
} as const;

export const DUTCH_HOME_ROUTE = '/#/search';
export const DUTCH_INITIAL_EXAMPLE_QUERY = 'Wetboek van Strafrecht artikel 1';
export const DUTCH_INITIAL_EXAMPLE_ROUTE =
  '/#/search?q=Wetboek+van+Strafrecht+artikel+1&place=netherlands';
export const DUTCH_EXAMPLE_QUERIES = [
  DUTCH_INITIAL_EXAMPLE_QUERY,
  'Burgerlijk Wetboek',
  'legaliteitsbeginsel',
  'rechtsvordering',
] as const;
export const STABLE_NETHERLANDS_PLACE_ID = `place:${NETHERLANDS_JURISDICTION_ID}`;
export const PRECISE_QUERY_KEYS = [
  'lat',
  'lon',
  'lng',
  'latitude',
  'longitude',
  'coordinates',
  'coordinate',
  'coords',
  'coord',
  'address',
  'geo',
  'geolocation',
  'accuracy',
  'altitude',
] as const;

const PRECISE_KEYS = new Set<string>(PRECISE_QUERY_KEYS);
const KNOWN_KEYS = new Set<string>([
  'q',
  'place',
  'date',
  'scope',
  'revision',
  'section',
  'places',
  ...PRECISE_QUERY_KEYS,
]);
const PLACE_ID = /^place:[a-z0-9][a-z0-9._:-]{1,120}$/;
const CODE_SEGMENT = /^[a-z]{2}$|^[a-z]{3}$|^[a-z]{2}-[a-z0-9]{1,3}$/;
const COORDINATE_PAIR = /^-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?$/;
const BWB_ID = /^BWB[A-Z0-9]{4,16}$/;
const RECORD_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,160}$/;
const SOURCE_ID = /^[A-Za-z0-9][A-Za-z0-9._:@+/-]{1,160}$/;
const REVISION_TOKEN = /^[A-Za-z0-9._:+/-]{1,128}$/;
const SECTION_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:+/@-]{0,219}$/;
const SAMPLE_CIDS = new Set(NETHERLANDS_CURRENT_SAMPLE.map((article) => article.ipfsCid));
const DATASET_IDS = new Set(Object.values(NETHERLANDS_DECLARED_SOURCE_IDS));
const LEGACY_PLACE_ALIASES: Record<string, string> = {
  [NETHERLANDS_JURISDICTION_ID]: STABLE_NETHERLANDS_PLACE_ID,
};

export interface CivilDate {
  value: string;
  precision: DatePrecision;
}

export interface RouteIssue {
  code: string;
  field: string | null;
  message: string;
  nextAction: string;
}

export interface PreciseLocation {
  latitude: number | null;
  longitude: number | null;
  address: string | null;
}

export interface AppRoute {
  name: RouteName;
  recognized: boolean;
  href: string | null;
  query: string | null;
  queryTokenPresent: boolean;
  placeId: string | null;
  placeToken: string | null;
  placeTokenPresent: boolean;
  legacyPlaceAlias: boolean;
  date: CivilDate | null;
  dateTokenPresent: boolean;
  scope: SearchScope | null;
  scopeTokenPresent: boolean;
  recordId: string | null;
  sourceRevision: string | null;
  sectionId: string | null;
  sourceId: string | null;
  comparePlaceIds: string[];
  precise: PreciseLocation | null;
  droppedPreciseKeys: string[];
  migrationId: string | null;
  publisherUrl: string | null;
  publisherRemains: boolean;
  coverageState: 'partial' | null;
  suggestionOnly: boolean;
  suggestionQuery: string | null;
  issues: RouteIssue[];
  nextAction: string;
}

export interface RouteDraft {
  name: RouteName;
  query?: string | null;
  placeId?: string | null;
  date?: CivilDate | string | null;
  scope?: SearchScope | null;
  recordId?: string | null;
  sourceRevision?: string | null;
  sectionId?: string | null;
  sourceId?: string | null;
  comparePlaceIds?: readonly string[];
  placeToken?: 'stable' | 'legacy-alias';
  precise?: PreciseLocation | null;
  includePreciseCoordinates?: boolean;
}

export interface DutchMigrationRow {
  id: string;
  surface: string;
  preservation: string;
  applicationRoute: string | null;
  publisherRemains: boolean;
  coverageState: 'partial' | null;
  changesPlace: boolean;
}

export interface PlaceIdResult {
  ok: true;
  placeId: string;
  token: string;
  legacyAlias: boolean;
}

export interface PlaceIdFailure {
  ok: false;
  code: string;
  message: string;
  nextAction: string;
}

function issue(code: string, field: string | null, message: string, nextAction: string): RouteIssue {
  return { code, field, message, nextAction };
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

export function parseCivilDate(value: string): CivilDate | null {
  const trimmed = value.trim();
  if (/^\d{4}$/.test(trimmed) && calendarOk(trimmed, 'year')) return { value: trimmed, precision: 'year' };
  if (/^\d{4}-\d{2}$/.test(trimmed) && calendarOk(trimmed, 'month')) return { value: trimmed, precision: 'month' };
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed) && calendarOk(trimmed, 'day')) return { value: trimmed, precision: 'day' };
  return null;
}

function bareCode(value: string): boolean {
  return CODE_SEGMENT.test(value.toLowerCase());
}

export function canonicalizePlaceId(token: string): PlaceIdResult | PlaceIdFailure {
  const trimmed = token.trim();
  if (!trimmed || trimmed.length > ROUTE_LIMITS.id) {
    return {
      ok: false,
      code: 'invalid-place-id',
      message: 'Place id is missing or too long. No place was invented.',
      nextAction: 'Choose a country, region, or municipality.',
    };
  }
  if (trimmed.includes('..') || /[\u0000-\u001F\u007F]/.test(trimmed) || COORDINATE_PAIR.test(trimmed)) {
    return {
      ok: false,
      code: COORDINATE_PAIR.test(trimmed) ? 'coordinates-are-not-a-place' : 'invalid-place-id',
      message: COORDINATE_PAIR.test(trimmed)
        ? 'Coordinates are not a place id and are left off the shared link.'
        : 'Place id is not a stable place token.',
      nextAction: 'Choose a stable place id such as place:netherlands.',
    };
  }
  const alias = LEGACY_PLACE_ALIASES[trimmed.toLowerCase()];
  if (alias) {
    return { ok: true, placeId: alias, token: trimmed.toLowerCase(), legacyAlias: true };
  }
  if (bareCode(trimmed)) {
    return {
      ok: false,
      code: 'code-used-as-identity',
      message: 'A country or region code is an alias, not a place id. No city was selected.',
      nextAction: 'Choose the stable place id instead of the code.',
    };
  }
  if (!PLACE_ID.test(trimmed)) {
    return {
      ok: false,
      code: 'invalid-place-id',
      message: 'Place id must be a stable place: token or the Netherlands migration alias.',
      nextAction: 'Choose a stable place id such as place:netherlands.',
    };
  }
  const segment = trimmed.slice('place:'.length);
  const finalSegment = segment.split(':').pop() ?? segment;
  if (bareCode(segment) || bareCode(finalSegment)) {
    return {
      ok: false,
      code: 'code-used-as-identity',
      message: 'The last segment of the place id is a code, not an internal id. No city was selected.',
      nextAction: 'Choose a stable place id that is not a country code.',
    };
  }
  return { ok: true, placeId: trimmed, token: trimmed, legacyAlias: false };
}

export function isStablePlaceId(value: string): boolean {
  return canonicalizePlaceId(value).ok;
}

function emptyRoute(overrides: Partial<AppRoute> = {}): AppRoute {
  return {
    name: 'search',
    recognized: false,
    href: null,
    query: null,
    queryTokenPresent: false,
    placeId: null,
    placeToken: null,
    placeTokenPresent: false,
    legacyPlaceAlias: false,
    date: null,
    dateTokenPresent: false,
    scope: null,
    scopeTokenPresent: false,
    recordId: null,
    sourceRevision: null,
    sectionId: null,
    sourceId: null,
    comparePlaceIds: [],
    precise: null,
    droppedPreciseKeys: [],
    migrationId: null,
    publisherUrl: null,
    publisherRemains: false,
    coverageState: null,
    suggestionOnly: false,
    suggestionQuery: null,
    issues: [],
    nextAction: 'Choose a place or search worldwide.',
    ...overrides,
  };
}

function defaultNextAction(route: AppRoute): string {
  if (route.suggestionOnly) return 'The example fills the search field and does not change the place.';
  if (route.coverageState === 'partial') {
    return 'The bundled Dutch sample is partial coverage, not the published corpus.';
  }
  if (route.publisherRemains) {
    return 'The publisher link stays on wetten.overheid.nl. The application route sits beside it.';
  }
  if (route.migrationId === 'dutch-source') {
    return 'Open the pinned source. Membership of an organization is not a license.';
  }
  if (route.migrationId === 'dutch-query' || route.migrationId === 'dutch-example') {
    return 'The old search text was kept. The place was not changed.';
  }
  if (route.placeId) return 'Search this place, or change it.';
  return 'Choose a place or search worldwide.';
}

function withNext(route: AppRoute): AppRoute {
  const nextAction = route.issues[0]?.nextAction ?? defaultNextAction(route);
  const href = route.suggestionOnly || !route.recognized
    ? null
    : buildRoute({
      name: route.name,
      query: route.query,
      placeId: route.placeId,
      date: route.date,
      scope: route.scope,
      recordId: route.recordId,
      sourceRevision: route.sourceRevision,
      sectionId: route.sectionId,
      sourceId: route.sourceId,
      comparePlaceIds: route.comparePlaceIds,
      placeToken: route.legacyPlaceAlias ? 'legacy-alias' : 'stable',
    }).href;
  return { ...route, nextAction, href: route.href ?? href };
}

function safeDecode(value: string, plusIsSpace: boolean): string | null {
  try {
    return decodeURIComponent(plusIsSpace ? value.replace(/\+/g, ' ') : value);
  } catch {
    return null;
  }
}

function stripControls(value: string): string {
  return value.replace(/[\u0000-\u001F\u007F]/g, '').trim();
}

function pushIssue(issues: RouteIssue[], entry: RouteIssue): void {
  if (issues.length < ROUTE_LIMITS.issues) issues.push(entry);
}

function formQuery(entries: ReadonlyArray<readonly [string, string]>): string {
  const params = new URLSearchParams();
  for (const [key, value] of entries) params.append(key, value);
  return params.toString();
}

function hashPrefix(pathAndQuery: string): string {
  return `/#${pathAndQuery.startsWith('/') ? pathAndQuery : `/${pathAndQuery}`}`;
}

function readBoundedToken(
  value: string,
  pattern: RegExp,
  max: number,
  field: string,
  issues: RouteIssue[],
): string | null {
  const text = stripControls(value);
  if (!text) return null;
  if (text.length > max || text.includes('..') || !pattern.test(text)) {
    pushIssue(issues, issue(
      'invalid-token',
      field,
      `${field} is not a bounded token and was dropped.`,
      'Open the record from its stable link.',
    ));
    return null;
  }
  return text;
}

function publicPlaceToken(placeId: string, mode: 'stable' | 'legacy-alias'): string {
  const canonical = canonicalizePlaceId(placeId);
  if (!canonical.ok) return placeId;
  if (mode === 'legacy-alias' && canonical.placeId === STABLE_NETHERLANDS_PLACE_ID) {
    return NETHERLANDS_JURISDICTION_ID;
  }
  return canonical.placeId;
}

function formatCoordinate(value: number): string | null {
  if (!Number.isFinite(value)) return null;
  const rounded = Math.round(value * 1e6) / 1e6;
  return String(rounded);
}

export function buildRoute(draft: RouteDraft): { href: string; issues: RouteIssue[] } {
  const issues: RouteIssue[] = [];
  const name = (ROUTE_NAMES as readonly string[]).includes(draft.name) ? draft.name : 'search';
  if (name !== draft.name) {
    pushIssue(issues, issue('unknown-route', 'name', 'Route name is not part of the stable contract.', 'Open search.'));
  }
  const entries: Array<[string, string]> = [];
  const query = typeof draft.query === 'string' ? stripControls(draft.query).slice(0, ROUTE_LIMITS.query) : '';
  if (typeof draft.query === 'string' && stripControls(draft.query).length > ROUTE_LIMITS.query) {
    pushIssue(issues, issue('query-too-long', 'q', 'The search text was shortened.', 'Shorten the search.'));
  }
  let placeToken: string | null = null;
  if (draft.placeId) {
    const place = canonicalizePlaceId(draft.placeId);
    if (place.ok) placeToken = publicPlaceToken(place.placeId, draft.placeToken ?? 'stable');
    else pushIssue(issues, issue(place.code, 'place', place.message, place.nextAction));
  }
  const date = typeof draft.date === 'string' ? parseCivilDate(draft.date) : draft.date ?? null;
  if (typeof draft.date === 'string' && draft.date.trim() && !date) {
    pushIssue(issues, issue(
      'invalid-date',
      'date',
      'The date is not a real year, month, or day. A timezone was not applied.',
      'Enter a year, month, or day.',
    ));
  }
  const scope = draft.scope === 'place' || draft.scope === 'worldwide' ? draft.scope : null;
  const recordId = draft.recordId ? readBoundedToken(draft.recordId, RECORD_ID, ROUTE_LIMITS.id, 'record', issues) : null;
  const sourceRevision = draft.sourceRevision
    ? readBoundedToken(draft.sourceRevision, REVISION_TOKEN, ROUTE_LIMITS.revision, 'revision', issues)
    : null;
  const sectionId = draft.sectionId
    ? readBoundedToken(draft.sectionId, SECTION_TOKEN, ROUTE_LIMITS.section, 'section', issues)
    : null;
  const sourceId = draft.sourceId ? readBoundedToken(draft.sourceId, SOURCE_ID, ROUTE_LIMITS.id, 'source', issues) : null;
  const compareIds: string[] = [];
  for (const candidate of draft.comparePlaceIds ?? []) {
    if (compareIds.length >= ROUTE_LIMITS.comparePlaces) {
      pushIssue(issues, issue('too-many-places', 'places', 'Compare keeps the first eight places.', 'Remove a place before adding another.'));
      break;
    }
    const place = canonicalizePlaceId(candidate);
    if (place.ok && !compareIds.includes(place.placeId)) compareIds.push(place.placeId);
    else if (!place.ok) pushIssue(issues, issue(place.code, 'places', place.message, place.nextAction));
  }

  const addContext = (includePlaceInQuery: boolean): void => {
    if (includePlaceInQuery && placeToken) entries.push(['place', placeToken]);
    if (date) entries.push(['date', date.value]);
    if (scope) entries.push(['scope', scope]);
  };

  let path = '/search';
  if (name === 'search') {
    if (query) entries.push(['q', query]);
    addContext(true);
    path = '/search';
  } else if (name === 'place') {
    if (!placeToken) {
      pushIssue(issues, issue('missing-place', 'place', 'A place route needs a stable place id.', 'Choose a place.'));
      if (query) entries.push(['q', query]);
      addContext(false);
      path = '/search';
    } else {
      path = `/place/${encodeURIComponent(placeToken)}`;
      addContext(false);
    }
  } else if (name === 'law') {
    if (!recordId) {
      pushIssue(issues, issue('missing-record', 'record', 'A law route needs a record id.', 'Open the record from search.'));
      if (query) entries.push(['q', query]);
      addContext(true);
      path = '/search';
    } else {
      const link = buildLawDeepLink({
        publisherUrl: NETHERLANDS_PUBLISHER_ORIGIN,
        recordId,
        sourceRevision,
        sectionId,
      });
      const application = link.applicationRoute ?? `/#/law/${encodeURIComponent(recordId)}`;
      const hashPath = application.startsWith('/#') ? application.slice(2) : application;
      const splitAt = hashPath.indexOf('?');
      path = splitAt === -1 ? hashPath : hashPath.slice(0, splitAt);
      if (splitAt !== -1) {
        const existing = new URLSearchParams(hashPath.slice(splitAt + 1));
        for (const key of ['revision', 'section']) {
          const value = existing.get(key);
          if (value) entries.push([key, value]);
        }
      }
      addContext(true);
    }
  } else if (name === 'coverage') {
    addContext(true);
    path = '/coverage';
  } else if (name === 'sources') {
    if (!sourceId) {
      pushIssue(issues, issue('missing-source', 'source', 'A source route needs a source id.', 'Open the source list from coverage.'));
      addContext(true);
      path = '/coverage';
    } else {
      path = `/sources/${encodeURIComponent(sourceId)}`;
      addContext(true);
    }
  } else {
    if (compareIds.length === 0) {
      pushIssue(issues, issue('missing-places', 'places', 'Compare needs at least one stable place id.', 'Choose places to compare.'));
    } else {
      entries.push(['places', compareIds.join(',')]);
    }
    if (query) entries.push(['q', query]);
    addContext(true);
    path = '/compare';
  }

  if (draft.includePreciseCoordinates === true && draft.precise) {
    const latitude = draft.precise.latitude === null ? null : formatCoordinate(draft.precise.latitude);
    const longitude = draft.precise.longitude === null ? null : formatCoordinate(draft.precise.longitude);
    if (latitude !== null && Number(latitude) >= -90 && Number(latitude) <= 90
      && longitude !== null && Number(longitude) >= -180 && Number(longitude) <= 180) {
      entries.push(['lat', latitude]);
      entries.push(['lon', longitude]);
    } else {
      pushIssue(issues, issue(
        'invalid-coordinate',
        'lat',
        'Precise coordinates were not added to the link.',
        'Share the stable place id.',
      ));
    }
  }

  const queryString = formQuery(entries);
  return { href: hashPrefix(queryString ? `${path}?${queryString}` : path), issues };
}

function parseQuery(query: string, issues: RouteIssue[]): Map<string, string> {
  const map = new Map<string, string>();
  if (!query) return map;
  const parts = query.split('&').filter((part) => part.length > 0);
  if (parts.length > ROUTE_LIMITS.parameters) {
    pushIssue(issues, issue(
      'too-many-parameters',
      null,
      'Extra parameters were dropped.',
      'Use the search, place, and date fields.',
    ));
  }
  for (const part of parts.slice(0, ROUTE_LIMITS.parameters)) {
    const eq = part.indexOf('=');
    const rawKey = eq === -1 ? part : part.slice(0, eq);
    const rawValue = eq === -1 ? '' : part.slice(eq + 1);
    const key = safeDecode(rawKey, true);
    const value = safeDecode(rawValue, true);
    if (key === null || value === null) {
      pushIssue(issues, issue(
        'malformed-encoding',
        null,
        'A parameter could not be decoded.',
        'Open the link again without edited percent escapes.',
      ));
      continue;
    }
    const folded = key.toLowerCase();
    if (!folded || folded.length > 40) continue;
    if (map.has(folded)) {
      pushIssue(issues, issue(
        'duplicate-parameter',
        folded,
        `Parameter ${folded} was repeated. The first value was kept.`,
        'Use one value for each parameter.',
      ));
      continue;
    }
    if (!KNOWN_KEYS.has(folded)) {
      pushIssue(issues, issue(
        'unknown-parameter',
        folded,
        `Parameter ${folded} is not part of the stable link and was dropped.`,
        'Share the place id, date, and search text.',
      ));
      continue;
    }
    map.set(folded, value);
  }
  return map;
}

function readPrecise(map: Map<string, string>, issues: RouteIssue[]): { precise: PreciseLocation | null; keys: string[] } {
  const keys = [...map.keys()].filter((key) => PRECISE_KEYS.has(key));
  if (keys.length === 0) return { precise: null, keys: [] };
  pushIssue(issues, issue(
    'precise-location-not-shared',
    keys[0] ?? 'lat',
    'An address or precise coordinates were removed from the shared link.',
    'Share the stable place id. Coordinates stay on this screen only.',
  ));
  const latitude = readAxis(map.get('lat') ?? map.get('latitude'), -90, 90, 'lat', issues);
  const longitude = readAxis(map.get('lon') ?? map.get('lng') ?? map.get('longitude'), -180, 180, 'lon', issues);
  const addressRaw = map.get('address');
  const address = addressRaw ? stripControls(addressRaw).slice(0, ROUTE_LIMITS.label) : null;
  const pair = map.get('coordinates') ?? map.get('coords') ?? map.get('coord') ?? map.get('geo');
  let pairLatitude = latitude;
  let pairLongitude = longitude;
  if (pair && COORDINATE_PAIR.test(pair.trim())) {
    const [latText, lonText] = pair.split(',');
    pairLatitude = pairLatitude ?? readAxis(latText, -90, 90, 'lat', issues);
    pairLongitude = pairLongitude ?? readAxis(lonText, -180, 180, 'lon', issues);
  }
  if (pairLatitude === null && pairLongitude === null && !address) return { precise: null, keys };
  return {
    precise: { latitude: pairLatitude, longitude: pairLongitude, address: address || null },
    keys,
  };
}

function readAxis(
  raw: string | undefined,
  min: number,
  max: number,
  field: string,
  issues: RouteIssue[],
): number | null {
  if (raw === undefined || raw.trim() === '') return null;
  const value = Number(raw.trim());
  if (!Number.isFinite(value) || value < min || value > max) {
    pushIssue(issues, issue(
      'invalid-coordinate',
      field,
      `${field} is outside the usable range and was not kept.`,
      'Choose a place by its stable id.',
    ));
    return null;
  }
  return value;
}

function applyCommonQuery(route: AppRoute, map: Map<string, string>, issues: RouteIssue[]): void {
  if (map.has('q')) {
    route.queryTokenPresent = true;
    const text = stripControls(map.get('q') ?? '');
    if (text.length > ROUTE_LIMITS.query) {
      pushIssue(issues, issue('query-too-long', 'q', 'The search text was shortened.', 'Shorten the search.'));
    }
    route.query = text ? text.slice(0, ROUTE_LIMITS.query) : null;
  }
  if (map.has('place')) {
    route.placeTokenPresent = true;
    const token = map.get('place') ?? '';
    route.placeToken = token;
    const place = canonicalizePlaceId(token);
    if (place.ok) {
      route.placeId = place.placeId;
      route.legacyPlaceAlias = place.legacyAlias;
      if (place.legacyAlias && !route.migrationId) route.migrationId = 'dutch-place-alias';
    } else {
      pushIssue(issues, issue(place.code, 'place', place.message, place.nextAction));
    }
  }
  if (map.has('date')) {
    route.dateTokenPresent = true;
    const date = parseCivilDate(map.get('date') ?? '');
    if (date) route.date = date;
    else {
      pushIssue(issues, issue(
        'invalid-date',
        'date',
        'The date is not a real year, month, or day. A timezone was not applied.',
        'Enter a year, month, or day.',
      ));
    }
  }
  if (map.has('scope')) {
    route.scopeTokenPresent = true;
    const scope = (map.get('scope') ?? '').trim().toLowerCase();
    if (scope === 'place' || scope === 'worldwide') route.scope = scope;
    else {
      pushIssue(issues, issue('invalid-scope', 'scope', 'Scope must be place or worldwide.', 'Choose place or worldwide search.'));
    }
  }
  if (map.has('places')) {
    const ids: string[] = [];
    for (const token of (map.get('places') ?? '').split(',')) {
      if (!token.trim()) continue;
      if (ids.length >= ROUTE_LIMITS.comparePlaces) {
        pushIssue(issues, issue('too-many-places', 'places', 'Compare keeps the first eight places.', 'Remove a place before adding another.'));
        break;
      }
      const place = canonicalizePlaceId(token);
      if (place.ok) {
        if (!ids.includes(place.placeId)) ids.push(place.placeId);
      } else {
        pushIssue(issues, issue(place.code, 'places', place.message, place.nextAction));
      }
    }
    route.comparePlaceIds = ids;
  }
  const precise = readPrecise(map, issues);
  route.precise = precise.precise;
  route.droppedPreciseKeys = precise.keys;
  if (map.has('revision')) {
    route.sourceRevision = readBoundedToken(map.get('revision') ?? '', REVISION_TOKEN, ROUTE_LIMITS.revision, 'revision', issues);
  }
  if (map.has('section')) {
    route.sectionId = readBoundedToken(map.get('section') ?? '', SECTION_TOKEN, ROUTE_LIMITS.section, 'section', issues);
  }
}

function parseHash(hashPath: string): AppRoute {
  const issues: RouteIssue[] = [];
  const splitAt = hashPath.indexOf('?');
  const path = splitAt === -1 ? hashPath : hashPath.slice(0, splitAt);
  const query = splitAt === -1 ? '' : hashPath.slice(splitAt + 1);
  const segments: string[] = [];
  for (const segment of path.split('/')) {
    if (!segment) continue;
    const decoded = safeDecode(segment, false);
    if (decoded === null) {
      pushIssue(issues, issue('malformed-encoding', 'path', 'The path could not be decoded.', 'Open search and choose a place.'));
      return withNext(emptyRoute({ recognized: false, issues, nextAction: 'Open search and choose a place.' }));
    }
    segments.push(decoded);
  }
  const route = emptyRoute({ recognized: true });
  const head = segments[0] ?? '';
  if (head === 'search' && segments.length <= 1) route.name = 'search';
  else if (head === 'place' && segments.length === 2) {
    route.name = 'place';
    route.placeTokenPresent = true;
    route.placeToken = segments[1] ?? null;
    const place = canonicalizePlaceId(segments[1] ?? '');
    if (place.ok) {
      route.placeId = place.placeId;
      route.legacyPlaceAlias = place.legacyAlias;
      if (place.legacyAlias) route.migrationId = 'dutch-place-alias';
    } else pushIssue(issues, issue(place.code, 'place', place.message, place.nextAction));
  } else if (head === 'law' && segments.length === 2) {
    route.name = 'law';
    route.recordId = readBoundedToken(segments[1] ?? '', RECORD_ID, ROUTE_LIMITS.id, 'record', issues);
  } else if (head === 'coverage' && segments.length <= 1) route.name = 'coverage';
  else if (head === 'sources' && segments.length === 2) {
    route.name = 'sources';
    route.sourceId = readBoundedToken(segments[1] ?? '', SOURCE_ID, ROUTE_LIMITS.id, 'source', issues);
  } else if (head === 'compare' && segments.length <= 1) route.name = 'compare';
  else {
    pushIssue(issues, issue('unknown-route', 'path', 'The link does not match a stable route.', 'Open search.'));
    route.recognized = false;
  }
  if (route.recognized && segments.length > 2) {
    pushIssue(issues, issue('unexpected-path', 'path', 'Extra path segments were ignored.', 'Use the stable route for this page.'));
  }
  const map = parseQuery(query, issues);
  const pathPlace = route.placeId;
  applyCommonQuery(route, map, issues);
  if (route.name === 'place' && pathPlace && route.placeId && map.has('place') && pathPlace !== route.placeId) {
    route.placeId = pathPlace;
    pushIssue(issues, issue(
      'conflicting-place',
      'place',
      'The path and the query name different places. The path place was kept.',
      'Use one stable place id.',
    ));
  } else if (route.name === 'place' && pathPlace) {
    route.placeId = pathPlace;
  }
  route.issues = issues;
  return withNext(route);
}

function extractHashRoute(input: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(input)) {
    let url: URL;
    try {
      url = new URL(input);
    } catch {
      return null;
    }
    if (url.hash.startsWith('#/')) return url.hash.slice(1);
    return null;
  }
  if (input.startsWith('#/')) return input.slice(1);
  if (input.startsWith('/#/')) return input.slice(2);
  if (/^\/(search|place|law|coverage|sources|compare)(\/|\?|$)/.test(input)) return input;
  return null;
}

export function dutchExampleSuggestion(label: string): {
  label: string;
  query: string;
  changesPlace: false;
  applicationRoute: null;
  nextAction: string;
} | null {
  const match = DUTCH_EXAMPLE_QUERIES.find((query) => query === label.trim());
  if (!match) return null;
  return {
    label: match,
    query: match,
    changesPlace: false,
    applicationRoute: null,
    nextAction: 'The example fills the search field and does not change the place.',
  };
}

export function dutchMigrationTable(): readonly DutchMigrationRow[] {
  return [
    {
      id: 'dutch-home',
      surface: 'https://wetwijzer.github.io/ and index.html',
      preservation: 'Keep the static shell available until a later screen switches to it.',
      applicationRoute: DUTCH_HOME_ROUTE,
      publisherRemains: false,
      coverageState: null,
      changesPlace: false,
    },
    {
      id: 'dutch-initial-example',
      surface: 'React state initial query Wetboek van Strafrecht artikel 1',
      preservation: 'Keep the labelled opening example.',
      applicationRoute: DUTCH_INITIAL_EXAMPLE_ROUTE,
      publisherRemains: false,
      coverageState: null,
      changesPlace: true,
    },
    {
      id: 'dutch-example',
      surface: 'Example buttons',
      preservation: 'Keep the four labelled examples as search suggestions.',
      applicationRoute: null,
      publisherRemains: false,
      coverageState: null,
      changesPlace: false,
    },
    {
      id: 'dutch-publisher',
      surface: 'section.source_url https://wetten.overheid.nl/<BWB-id>',
      preservation: 'The publisher link stays on wetten.overheid.nl and opens beside the application route.',
      applicationRoute: '/#/law/<record-id>?revision=<source-revision>&section=<section-id>',
      publisherRemains: true,
      coverageState: null,
      changesPlace: false,
    },
    {
      id: 'dutch-sample',
      surface: 'Sample CID bafywetwijzer…001 through 003',
      preservation: 'Label the bundled sample as partial coverage. Do not present it as the published corpus.',
      applicationRoute: '/#/coverage?place=netherlands',
      publisherRemains: false,
      coverageState: 'partial',
      changesPlace: true,
    },
    {
      id: 'dutch-source',
      surface: 'Dataset ids in artifacts.manifest.json',
      preservation: 'Preserve the unified and legacy dataset ids.',
      applicationRoute: '/#/sources/<source-id>',
      publisherRemains: false,
      coverageState: null,
      changesPlace: false,
    },
  ];
}

function suggestionRoute(query: string): AppRoute {
  return withNext(emptyRoute({
    recognized: true,
    suggestionOnly: true,
    suggestionQuery: query,
    query,
    queryTokenPresent: true,
    migrationId: 'dutch-example',
    nextAction: 'The example fills the search field and does not change the place.',
  }));
}

function coverageAliasRoute(): AppRoute {
  const built = buildRoute({
    name: 'coverage',
    placeId: STABLE_NETHERLANDS_PLACE_ID,
    placeToken: 'legacy-alias',
  });
  return withNext(emptyRoute({
    recognized: true,
    name: 'coverage',
    placeId: STABLE_NETHERLANDS_PLACE_ID,
    placeToken: NETHERLANDS_JURISDICTION_ID,
    placeTokenPresent: true,
    legacyPlaceAlias: true,
    migrationId: 'dutch-sample',
    coverageState: 'partial',
    href: built.href,
    nextAction: 'The bundled Dutch sample is partial coverage, not the published corpus.',
  }));
}

function sourceRoute(sourceId: string): AppRoute {
  const built = buildRoute({ name: 'sources', sourceId });
  return withNext(emptyRoute({
    recognized: true,
    name: 'sources',
    sourceId,
    migrationId: 'dutch-source',
    href: built.href,
    nextAction: 'Open the pinned source. Membership of an organization is not a license.',
  }));
}

function publisherRoute(url: URL): AppRoute | null {
  const recordId = url.pathname.split('/').filter(Boolean).find((part) => BWB_ID.test(part)) ?? null;
  if (!recordId) return null;
  const httpsUrl = `https://wetten.overheid.nl${url.pathname.replace(/\/+$/, '')}`;
  const link = buildLawDeepLink({
    publisherUrl: httpsUrl,
    recordId,
    sourceRevision: null,
    sectionId: null,
  });
  return withNext(emptyRoute({
    recognized: true,
    name: 'law',
    recordId,
    migrationId: 'dutch-publisher',
    publisherUrl: httpsUrl,
    publisherRemains: true,
    href: link.applicationRoute,
    nextAction: 'The publisher link stays on wetten.overheid.nl. The application route sits beside it.',
  }));
}

function dutchHomeRoute(url: URL | null, rawQuery: string | null): AppRoute {
  const params = url ? url.searchParams : new URLSearchParams(rawQuery ?? '');
  const query = params.get('q');
  const preciseKeys = [...params.keys()].filter((key) => PRECISE_KEYS.has(key.toLowerCase()));
  if (query && query.trim() === DUTCH_INITIAL_EXAMPLE_QUERY) {
    const parsed = parseHash(DUTCH_INITIAL_EXAMPLE_ROUTE.slice(2));
    return withNext({
      ...parsed,
      migrationId: 'dutch-initial-example',
      droppedPreciseKeys: preciseKeys,
      issues: preciseKeys.length > 0
        ? [issue(
          'precise-location-not-shared',
          preciseKeys[0] ?? 'lat',
          'Coordinates on the old Dutch link were not copied.',
          'Share the Netherlands place id.',
        )]
        : parsed.issues,
      href: DUTCH_INITIAL_EXAMPLE_ROUTE,
    });
  }
  if (query && query.trim()) {
    const example = dutchExampleSuggestion(query.trim());
    const built = buildRoute({ name: 'search', query: example?.query ?? query.trim() });
    return withNext(emptyRoute({
      recognized: true,
      name: 'search',
      query: (example?.query ?? stripControls(query)).slice(0, ROUTE_LIMITS.query),
      queryTokenPresent: true,
      migrationId: example ? 'dutch-example' : 'dutch-query',
      droppedPreciseKeys: preciseKeys,
      href: built.href,
      nextAction: 'The old search text was kept. The place was not changed.',
    }));
  }
  return withNext(emptyRoute({
    recognized: true,
    name: 'search',
    migrationId: 'dutch-home',
    droppedPreciseKeys: preciseKeys,
    issues: preciseKeys.length > 0
      ? [issue(
        'precise-location-not-shared',
        preciseKeys[0] ?? 'lat',
        'Coordinates on the old Dutch link were not copied.',
        'Choose a place or search worldwide.',
      )]
      : [],
    href: DUTCH_HOME_ROUTE,
  }));
}

function normalizeCid(value: string): string | null {
  const trimmed = value.trim();
  const bare = trimmed.replace(/^ipfs:\/\//i, '');
  return SAMPLE_CIDS.has(bare) ? bare : null;
}

export function migrateDutchLink(input: string): AppRoute | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > ROUTE_LIMITS.url || trimmed.includes('\0')) return null;
  const example = dutchExampleSuggestion(trimmed);
  if (example) return suggestionRoute(example.query);
  const cid = normalizeCid(trimmed);
  if (cid) return coverageAliasRoute();
  if (DATASET_IDS.has(trimmed)) return sourceRoute(trimmed);
  if (/^https?:\/\//i.test(trimmed)) {
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      return null;
    }
    if (url.hash.startsWith('#/')) return null;
    if (url.hostname === 'wetten.overheid.nl') return publisherRoute(url);
    if (url.hostname === 'huggingface.co') {
      const match = url.pathname.match(/^\/datasets\/([^/]+\/[^/]+)\/?$/);
      const datasetId = match?.[1] ? decodeURIComponent(match[1]) : '';
      if (DATASET_IDS.has(datasetId)) return sourceRoute(datasetId);
      return null;
    }
    if (url.hostname === 'wetwijzer.github.io' && (url.port === '' || url.port === '80' || url.port === '443')) {
      const path = url.pathname.replace(/\/+$/, '') || '/';
      if (path === '/' || path === '/index.html') return dutchHomeRoute(url, null);
    }
    return null;
  }
  const relative = trimmed.replace(/^\.\//, '');
  if (relative === '/' || relative === 'index.html' || relative === '/index.html') return dutchHomeRoute(null, null);
  return null;
}

export function parseRoute(input: string): AppRoute {
  if (typeof input !== 'string' || input.includes('\0')) {
    return withNext(emptyRoute({
      issues: [issue('malformed-url', null, 'The link is empty or unsafe.', 'Open search.')],
      nextAction: 'Open search.',
    }));
  }
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > ROUTE_LIMITS.url) {
    return withNext(emptyRoute({
      issues: [issue('malformed-url', null, 'The link is empty or longer than the route limit.', 'Open search.')],
      nextAction: 'Open search.',
    }));
  }
  const hashRoute = extractHashRoute(trimmed);
  if (hashRoute) return parseHash(hashRoute);
  const migrated = migrateDutchLink(trimmed);
  if (migrated) return migrated;
  return withNext(emptyRoute({
    issues: [issue('malformed-url', null, 'The link is not a stable route or a known Dutch link.', 'Open search.')],
    nextAction: 'Open search.',
  }));
}

/**
 * Place and time context for worldwide search.
 *
 * On first resolution a shared URL outranks a choice made in this session,
 * which outranks an intentionally saved place, which outranks an approximate
 * suggestion. With nothing explicit, the scope stays worldwide and unselected.
 * A late GeoIP or device response cannot replace a URL, manual, or saved
 * choice. Browser language and timezone can suggest the UI language only.
 * Search text may propose a place; it does not switch the place by itself.
 * Precise coordinates and addresses stay off the default shared link.
 * Nothing here decides that a law applies.
 */

import {
  buildRoute,
  canonicalizePlaceId,
  dutchExampleSuggestion,
  parseCivilDate,
  parseRoute,
  ROUTE_LIMITS,
  type AppRoute,
  type CivilDate,
  type PreciseLocation,
  type RouteIssue,
  type RouteName,
  type SearchScope,
} from '../routes';

export const PLACE_STATE_SCHEMA = 'worldwide-legal-search.place-state@1';
export const SAVED_PLACE_SCHEMA = 'worldwide-legal-search.saved-place@1';

export const PLACE_ORIGINS = ['url', 'manual', 'saved', 'suggestion', 'unselected'] as const;
export type PlaceOrigin = (typeof PLACE_ORIGINS)[number];

export const ORIGIN_RANK: Record<PlaceOrigin, number> = {
  url: 40,
  manual: 30,
  saved: 20,
  suggestion: 10,
  unselected: 0,
};

export type PlaceChannel = 'url' | 'manual' | 'saved' | 'geoip' | 'device' | 'none';
export type SuggestionKind = 'geoip' | 'device';
export type IgnoredReason =
  | 'unknown-request'
  | 'stale-request'
  | 'explicit-choice'
  | 'late-response'
  | 'country-only'
  | 'border-unresolved'
  | 'invalid-place';

export interface SavedPlace {
  schema: typeof SAVED_PLACE_SCHEMA;
  placeId: string;
  label: string | null;
  asOf: CivilDate | null;
  scope: SearchScope;
  savedAt: string;
}

export interface SavedPlaceInput {
  schema?: string;
  placeId?: string | null;
  label?: string | null;
  asOf?: CivilDate | string | null;
  scope?: SearchScope | null;
  savedAt?: string | null;
  latitude?: unknown;
  longitude?: unknown;
  address?: unknown;
  coordinates?: unknown;
}

export interface SessionChoice {
  placeId?: string | null;
  label?: string | null;
  scope?: SearchScope | null;
  asOf?: string | null;
  worldwide?: boolean;
}

export interface PlaceCandidate {
  placeId: string;
  label: string | null;
  uncertainty: string[];
}

export interface ScopeProposal {
  placeId: string;
  label: string | null;
  query: string;
  nextAction: string;
}

export interface IgnoredResponse {
  requestId: string;
  reason: IgnoredReason;
  keptPlaceId: string | null;
  keptOrigin: PlaceOrigin;
}

export interface PendingSuggestion {
  requestId: string;
  kind: SuggestionKind;
  generation: number;
}

export interface SuggestionResponse {
  requestId: string;
  kind: SuggestionKind;
  placeId?: string | null;
  label?: string | null;
  level?: 'country' | 'region' | 'city' | 'municipality' | 'unknown';
  countryOnly?: boolean;
  precision?: 'country' | 'region' | 'city' | 'approximate' | 'precise' | 'unknown';
  coordinates?: { latitude: number; longitude: number } | null;
  address?: string | null;
  candidates?: ReadonlyArray<{ placeId: string; label?: string | null; uncertainty?: readonly string[] }>;
  uncertainty?: readonly string[];
  query?: string | null;
  date?: string | null;
  timeZone?: string | null;
  language?: string | null;
}

export interface PlaceState {
  schema: typeof PLACE_STATE_SCHEMA;
  placeId: string | null;
  label: string | null;
  origin: PlaceOrigin;
  originLabel: string;
  channel: PlaceChannel;
  scope: SearchScope;
  asOf: CivilDate | null;
  asOfSource: 'url' | 'manual' | 'saved' | null;
  sessionCoordinates: PreciseLocation | null;
  uncertainty: string[];
  candidates: PlaceCandidate[];
  proposal: ScopeProposal | null;
  uiLanguageSuggestion: string | null;
  timeZoneNoted: string | null;
  generation: number;
  suggestionSettled: boolean;
  route: AppRoute;
  saved: SavedPlace | null;
  pending: PendingSuggestion[];
  handledRequestIds: string[];
  ignored: IgnoredResponse[];
  issues: RouteIssue[];
  nextAction: string;
}

export interface CreatePlaceStateInput {
  href?: string | null;
  saved?: SavedPlaceInput | null;
  session?: SessionChoice | null;
  language?: string | null;
  timeZone?: string | null;
}

export function originOutranks(left: PlaceOrigin, right: PlaceOrigin): boolean {
  return ORIGIN_RANK[left] > ORIGIN_RANK[right];
}

export function originLabel(origin: PlaceOrigin, channel: PlaceChannel): string {
  if (origin === 'url') return 'shared URL';
  if (origin === 'manual') return 'manually selected';
  if (origin === 'saved') return 'saved selection';
  if (channel === 'device') return 'device location';
  if (origin === 'suggestion') return 'approximate IP location';
  return 'unselected worldwide';
}

export function placeLockedAgainstSuggestions(state: PlaceState): boolean {
  return state.origin === 'url' || state.origin === 'manual' || state.origin === 'saved';
}

function issue(code: string, field: string | null, message: string, nextAction: string): RouteIssue {
  return { code, field, message, nextAction };
}

function capIssues(issues: readonly RouteIssue[]): RouteIssue[] {
  return issues.slice(0, ROUTE_LIMITS.issues);
}

function cleanText(value: string | null | undefined, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/[\u0000-\u001F\u007F]/g, '').trim();
  if (!text) return null;
  return text.slice(0, max);
}

function cleanList(values: readonly string[] | undefined): string[] {
  if (!values) return [];
  const cleaned: string[] = [];
  for (const value of values) {
    const text = cleanText(value, 300);
    if (text) cleaned.push(text);
    if (cleaned.length >= 12) break;
  }
  return cleaned;
}

function primaryLanguage(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(trimmed)) return null;
  return trimmed.split('-')[0]?.toLowerCase() ?? null;
}

function notedTimeZone(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed === 'UTC' || /^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+){1,2}$/.test(trimmed)) return trimmed;
  return null;
}

function validSavedAt(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\dZ$/.test(value)) return false;
  return parseCivilDate(value.slice(0, 10)) !== null;
}

function civilFrom(value: CivilDate | string | null | undefined): CivilDate | null {
  if (!value) return null;
  if (typeof value === 'string') return parseCivilDate(value);
  if (value.precision !== 'year' && value.precision !== 'month' && value.precision !== 'day') return null;
  return parseCivilDate(value.value);
}

export function encodeSavedPlace(saved: SavedPlace): string {
  return JSON.stringify({
    schema: SAVED_PLACE_SCHEMA,
    placeId: saved.placeId,
    label: saved.label,
    asOf: saved.asOf,
    scope: saved.scope,
    savedAt: saved.savedAt,
  });
}

export function normalizeSavedPlace(input: SavedPlaceInput | null | undefined): SavedPlace | null {
  if (!input || typeof input !== 'object') return null;
  if (input.schema !== undefined && input.schema !== SAVED_PLACE_SCHEMA) return null;
  if (!input.placeId || !input.savedAt || !validSavedAt(input.savedAt)) return null;
  const place = canonicalizePlaceId(input.placeId);
  if (!place.ok) return null;
  const asOf = input.asOf === undefined || input.asOf === null ? null : civilFrom(input.asOf);
  if (input.asOf && !asOf) return null;
  const scope: SearchScope = input.scope === 'worldwide' ? 'worldwide' : 'place';
  return {
    schema: SAVED_PLACE_SCHEMA,
    placeId: place.placeId,
    label: cleanText(input.label, ROUTE_LIMITS.label),
    asOf,
    scope,
    savedAt: input.savedAt,
  };
}

export function decodeSavedPlace(raw: string): SavedPlace | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  return normalizeSavedPlace(parsed as SavedPlaceInput);
}

function blankRoute(): AppRoute {
  return parseRoute('/#/search');
}

function syncRoute(route: AppRoute, placeId: string | null, asOf: CivilDate | null, scope: SearchScope): AppRoute {
  return {
    ...route,
    placeId,
    date: asOf,
    scope,
  };
}

function baseState(route: AppRoute, language: string | null, timeZone: string | null): PlaceState {
  return {
    schema: PLACE_STATE_SCHEMA,
    placeId: null,
    label: null,
    origin: 'unselected',
    originLabel: originLabel('unselected', 'none'),
    channel: 'none',
    scope: 'worldwide',
    asOf: null,
    asOfSource: null,
    sessionCoordinates: route.precise ? { ...route.precise } : null,
    uncertainty: [],
    candidates: [],
    proposal: null,
    uiLanguageSuggestion: language,
    timeZoneNoted: timeZone,
    generation: 0,
    suggestionSettled: false,
    route,
    saved: null,
    pending: [],
    handledRequestIds: [],
    ignored: [],
    issues: route.issues.slice(),
    nextAction: route.nextAction,
  };
}

function explicitSession(session: SessionChoice | null | undefined): {
  placeId: string | null;
  label: string | null;
  scope: SearchScope;
  asOf: string | null;
} | null {
  if (!session) return null;
  if (session.placeId) {
    const place = canonicalizePlaceId(session.placeId);
    if (!place.ok) return null;
    return {
      placeId: place.placeId,
      label: cleanText(session.label, ROUTE_LIMITS.label),
      scope: session.scope === 'worldwide' ? 'worldwide' : 'place',
      asOf: session.asOf ?? null,
    };
  }
  if (session.worldwide) {
    return { placeId: null, label: null, scope: 'worldwide', asOf: session.asOf ?? null };
  }
  return null;
}

function urlLocks(route: AppRoute): boolean {
  if (route.suggestionOnly) return false;
  if (route.placeId || route.placeTokenPresent) return true;
  return route.scopeTokenPresent && route.scope === 'worldwide';
}

function applyDate(
  state: PlaceState,
  route: AppRoute,
  sessionAsOf: string | null,
  saved: SavedPlace | null,
): PlaceState {
  if (route.dateTokenPresent) {
    return { ...state, asOf: route.date, asOfSource: route.date ? 'url' : null };
  }
  if (sessionAsOf) {
    const parsed = parseCivilDate(sessionAsOf);
    if (parsed) return { ...state, asOf: parsed, asOfSource: 'manual' };
    return {
      ...state,
      issues: capIssues([...state.issues, issue(
        'invalid-date',
        'date',
        'The session date is not a real year, month, or day. A timezone was not applied.',
        'Enter a year, month, or day.',
      )]),
    };
  }
  if (saved?.asOf) return { ...state, asOf: saved.asOf, asOfSource: 'saved' };
  return state;
}

export function createPlaceState(input: CreatePlaceStateInput = {}): PlaceState {
  const route = input.href ? parseRoute(input.href) : blankRoute();
  const language = primaryLanguage(input.language);
  const timeZone = notedTimeZone(input.timeZone);
  const saved = normalizeSavedPlace(input.saved);
  const session = explicitSession(input.session);
  let state = baseState(route, language, timeZone);
  state.saved = saved;
  if (route.suggestionOnly && route.suggestionQuery) {
    state = {
      ...state,
      route: { ...route, query: route.suggestionQuery },
    };
  }
  if (urlLocks(route)) {
    const placeId = route.placeId;
    const scope = route.scope ?? (placeId ? 'place' : 'worldwide');
    state = {
      ...state,
      placeId,
      label: null,
      origin: 'url',
      channel: 'url',
      originLabel: originLabel('url', 'url'),
      scope,
      generation: 1,
      route: syncRoute(state.route, placeId, state.asOf, scope),
    };
    state = applyDate(state, route, null, route.dateTokenPresent ? null : saved);
  } else if (session) {
    state = {
      ...state,
      placeId: session.placeId,
      label: session.label,
      origin: 'manual',
      channel: 'manual',
      originLabel: originLabel('manual', 'manual'),
      scope: session.scope,
      generation: 1,
    };
    state = applyDate(state, route, session.asOf, null);
  } else if (saved) {
    state = {
      ...state,
      placeId: saved.placeId,
      label: saved.label,
      origin: 'saved',
      channel: 'saved',
      originLabel: originLabel('saved', 'saved'),
      scope: saved.scope,
      generation: 1,
    };
    state = applyDate(state, route, null, saved);
  } else {
    state = applyDate(state, route, null, null);
  }
  state = {
    ...state,
    route: syncRoute(state.route, state.placeId, state.asOf, state.scope),
    nextAction: state.issues[0]?.nextAction ?? state.nextAction,
  };
  return state;
}

function fail(state: PlaceState, entry: RouteIssue): PlaceState {
  return { ...state, issues: [entry], nextAction: entry.nextAction };
}

export function selectPlace(
  state: PlaceState,
  input: { placeId: string; label?: string | null; asOf?: string | null; scope?: SearchScope; uncertainty?: readonly string[] },
): PlaceState {
  const place = canonicalizePlaceId(input.placeId);
  if (!place.ok) return fail(state, issue(place.code, 'place', place.message, place.nextAction));
  let asOf = state.asOf;
  let asOfSource = state.asOfSource;
  const issues: RouteIssue[] = [];
  if (input.asOf === null) {
    asOf = null;
    asOfSource = null;
  } else if (typeof input.asOf === 'string') {
    const parsed = parseCivilDate(input.asOf);
    if (parsed) {
      asOf = parsed;
      asOfSource = 'manual';
    } else {
      issues.push(issue(
        'invalid-date',
        'date',
        'The date is not a real year, month, or day. The previous date was kept.',
        'Enter a year, month, or day.',
      ));
    }
  }
  const scope: SearchScope = input.scope === 'worldwide' ? 'worldwide' : 'place';
  return {
    ...state,
    placeId: place.placeId,
    label: cleanText(input.label, ROUTE_LIMITS.label),
    origin: 'manual',
    channel: 'manual',
    originLabel: originLabel('manual', 'manual'),
    scope,
    asOf,
    asOfSource,
    uncertainty: cleanList(input.uncertainty),
    candidates: [],
    proposal: null,
    suggestionSettled: false,
    generation: state.generation + 1,
    route: syncRoute(state.route, place.placeId, asOf, scope),
    issues,
    nextAction: issues[0]?.nextAction ?? 'Change place if you want a different jurisdiction.',
  };
}

export function selectWorldwide(state: PlaceState): PlaceState {
  return {
    ...state,
    placeId: null,
    label: null,
    origin: 'manual',
    channel: 'manual',
    originLabel: originLabel('manual', 'manual'),
    scope: 'worldwide',
    uncertainty: [],
    candidates: [],
    proposal: null,
    suggestionSettled: false,
    generation: state.generation + 1,
    route: syncRoute({ ...state.route, name: 'search' }, null, state.asOf, 'worldwide'),
    issues: [],
    nextAction: 'Search worldwide, or choose a place.',
  };
}

export function setAsOf(state: PlaceState, value: string | null): PlaceState {
  if (value === null) {
    return {
      ...state,
      asOf: null,
      asOfSource: null,
      route: syncRoute(state.route, state.placeId, null, state.scope),
      issues: [],
      nextAction: 'The date was cleared. The place is unchanged.',
    };
  }
  const parsed = parseCivilDate(value);
  if (!parsed) {
    return fail(state, issue(
      'invalid-date',
      'date',
      'The date is not a real year, month, or day. The previous date was kept. A timezone was not applied.',
      'Enter a year, month, or day.',
    ));
  }
  return {
    ...state,
    asOf: parsed,
    asOfSource: 'manual',
    route: syncRoute(state.route, state.placeId, parsed, state.scope),
    issues: [],
    nextAction: 'The date was updated. The place is unchanged.',
  };
}

export function saveSelection(state: PlaceState, savedAt: string): PlaceState {
  if (!state.placeId) {
    return fail(state, issue(
      'missing-place',
      'place',
      'There is no place to save.',
      'Select a place before saving it.',
    ));
  }
  if (!validSavedAt(savedAt)) {
    return fail(state, issue(
      'invalid-saved-at',
      'savedAt',
      'The saved time is not a UTC timestamp. The place was not saved.',
      'Save the place again.',
    ));
  }
  const saved: SavedPlace = {
    schema: SAVED_PLACE_SCHEMA,
    placeId: state.placeId,
    label: state.label,
    asOf: state.asOf,
    scope: state.scope,
    savedAt,
  };
  const promote = state.origin === 'suggestion' || state.origin === 'unselected';
  return {
    ...state,
    saved,
    origin: promote ? 'saved' : state.origin,
    channel: promote ? 'saved' : state.channel,
    originLabel: originLabel(promote ? 'saved' : state.origin, promote ? 'saved' : state.channel),
    generation: promote ? state.generation + 1 : state.generation,
    suggestionSettled: false,
    issues: [],
    nextAction: 'The place is saved on this device without coordinates.',
  };
}

export function clearSavedSelection(state: PlaceState): PlaceState {
  if (state.origin !== 'saved') {
    return { ...state, saved: null, issues: [], nextAction: state.nextAction };
  }
  return {
    ...state,
    saved: null,
    placeId: null,
    label: null,
    origin: 'unselected',
    channel: 'none',
    originLabel: originLabel('unselected', 'none'),
    scope: 'worldwide',
    uncertainty: [],
    candidates: [],
    proposal: null,
    suggestionSettled: false,
    generation: state.generation + 1,
    route: syncRoute(state.route, null, state.asOf, 'worldwide'),
    issues: [],
    nextAction: 'The saved place was cleared. Choose a place or search worldwide.',
  };
}

export function applySavedSelection(state: PlaceState, input: SavedPlaceInput): PlaceState {
  const saved = normalizeSavedPlace({ ...input, schema: input.schema ?? SAVED_PLACE_SCHEMA });
  if (!saved) {
    return fail(state, issue(
      'invalid-saved-place',
      'place',
      'The saved place could not be read. Coordinates in that record were not used.',
      'Choose a place again.',
    ));
  }
  if (!originOutranks('saved', state.origin)) {
    return {
      ...state,
      saved: state.saved ?? saved,
      issues: state.origin === 'saved'
        ? [issue(
          'saved-already-active',
          'place',
          'A saved place is already active.',
          'Change the place manually if this is the wrong one.',
        )]
        : [],
      nextAction: state.nextAction,
    };
  }
  const keepDate = state.asOfSource === 'url' || state.asOfSource === 'manual';
  const asOf = keepDate ? state.asOf : saved.asOf;
  const asOfSource = keepDate ? state.asOfSource : saved.asOf ? 'saved' : null;
  return {
    ...state,
    saved,
    placeId: saved.placeId,
    label: saved.label,
    origin: 'saved',
    channel: 'saved',
    originLabel: originLabel('saved', 'saved'),
    scope: saved.scope,
    asOf,
    asOfSource,
    uncertainty: [],
    candidates: [],
    proposal: null,
    suggestionSettled: false,
    generation: state.generation + 1,
    route: syncRoute(state.route, saved.placeId, asOf, saved.scope),
    issues: [],
    nextAction: 'The saved place was restored.',
  };
}

export function requestSuggestion(state: PlaceState, input: { requestId: string; kind: SuggestionKind }): PlaceState {
  const requestId = input.requestId?.trim() ?? '';
  if (!requestId || requestId.length > 80 || /[\u0000-\u001F\u007F]/.test(requestId)) {
    return fail(state, issue('invalid-request', 'requestId', 'The suggestion request id is not usable.', 'Try the suggestion again.'));
  }
  if (input.kind !== 'geoip' && input.kind !== 'device') {
    return fail(state, issue('invalid-request', 'kind', 'The suggestion kind is not GeoIP or device location.', 'Choose a place manually.'));
  }
  if (state.pending.some((item) => item.requestId === requestId) || state.handledRequestIds.includes(requestId)) {
    return fail(state, issue('duplicate-request', 'requestId', 'That suggestion request is already open.', 'Wait for the current suggestion.'));
  }
  if (state.pending.length >= 4) {
    return fail(state, issue('too-many-requests', 'requestId', 'Too many location suggestions are waiting.', 'Choose a place manually.'));
  }
  return {
    ...state,
    pending: [...state.pending, { requestId, kind: input.kind, generation: state.generation }],
    issues: [],
  };
}

function rememberIgnore(state: PlaceState, requestId: string, reason: IgnoredReason): PlaceState {
  const ignored: IgnoredResponse = {
    requestId,
    reason,
    keptPlaceId: state.placeId,
    keptOrigin: state.origin,
  };
  return {
    ...state,
    pending: state.pending.filter((item) => item.requestId !== requestId),
    handledRequestIds: [...state.handledRequestIds, requestId].slice(-20),
    ignored: [...state.ignored, ignored].slice(-20),
  };
}

function scrub(value: string | null, secret: string): string | null {
  if (!value) return null;
  if (secret && value.includes(secret)) return null;
  return value;
}

export function receiveSuggestion(state: PlaceState, response: SuggestionResponse): PlaceState {
  const requestId = response.requestId?.trim() ?? '';
  const secret = cleanText(response.query, 500) ?? '';
  const extraIssues: RouteIssue[] = [];
  if (secret) {
    extraIssues.push(issue(
      'search-text-ignored',
      'query',
      'Search text on a location suggestion was ignored.',
      'Location suggestions do not receive the search text.',
    ));
  }
  if (response.date || response.timeZone || response.language) {
    extraIssues.push(issue(
      'suggestion-cannot-set-context',
      'date',
      'A suggestion cannot set the legal date, the timezone, or the jurisdiction from the browser language.',
      'Set the date and place yourself.',
    ));
  }
  if (response.address) {
    extraIssues.push(issue(
      'address-not-shared',
      'address',
      'An address on a location suggestion was ignored.',
      'Share the stable place id.',
    ));
  }
  const pending = state.pending.find((item) => item.requestId === requestId);
  if (requestId && state.handledRequestIds.includes(requestId)) {
    return { ...rememberIgnore(state, requestId, 'stale-request'), issues: capIssues(extraIssues) };
  }
  if (!pending) {
    return { ...rememberIgnore(state, requestId, 'unknown-request'), issues: capIssues(extraIssues) };
  }
  if (pending.kind !== response.kind) {
    const mismatch: IgnoredResponse = {
      requestId,
      reason: 'unknown-request',
      keptPlaceId: state.placeId,
      keptOrigin: state.origin,
    };
    return {
      ...state,
      ignored: [...state.ignored, mismatch].slice(-20),
      issues: capIssues(extraIssues),
      nextAction: state.nextAction,
    };
  }
  if (placeLockedAgainstSuggestions(state)) {
    return { ...rememberIgnore(state, requestId, 'explicit-choice'), issues: capIssues(extraIssues) };
  }
  if (pending.generation !== state.generation || state.suggestionSettled || state.origin === 'suggestion') {
    return { ...rememberIgnore(state, requestId, state.origin === 'suggestion' || state.suggestionSettled ? 'late-response' : 'stale-request'), issues: capIssues(extraIssues) };
  }

  const candidates: PlaceCandidate[] = [];
  for (const candidate of response.candidates ?? []) {
    const place = canonicalizePlaceId(candidate.placeId);
    if (!place.ok) continue;
    candidates.push({
      placeId: place.placeId,
      label: scrub(cleanText(candidate.label, ROUTE_LIMITS.label), secret),
      uncertainty: cleanList(candidate.uncertainty).filter((item) => !secret || !item.includes(secret)),
    });
    if (candidates.length >= 12) break;
  }
  const countryScoped = response.countryOnly === true || response.precision === 'country' || response.level === 'country';
  const cityScoped = response.level === 'city' || response.level === 'municipality';
  if (candidates.length > 1) {
    const next = rememberIgnore(state, requestId, 'border-unresolved');
    return {
      ...next,
      candidates,
      suggestionSettled: true,
      uncertainty: ['More than one jurisdiction matches. No place was selected.'],
      issues: capIssues(extraIssues),
      nextAction: 'Choose the jurisdiction that matches your question.',
    };
  }
  if (countryScoped && (cityScoped || (response.countryOnly === true && response.level !== 'country'))) {
    const next = rememberIgnore(state, requestId, 'country-only');
    return {
      ...next,
      suggestionSettled: true,
      uncertainty: ['A country-only guess did not choose a city.'],
      issues: capIssues(extraIssues),
      nextAction: 'Choose a country, region, or municipality.',
    };
  }
  const token = response.placeId || candidates[0]?.placeId || '';
  const place = token ? canonicalizePlaceId(token) : null;
  if (!place || !place.ok) {
    const next = rememberIgnore(state, requestId, 'invalid-place');
    return {
      ...next,
      suggestionSettled: true,
      issues: capIssues([...extraIssues, issue(
        'invalid-place-id',
        'place',
        'The suggestion did not include a stable place id. No city was invented.',
        'Choose a place manually.',
      )]),
      nextAction: 'Choose a place manually.',
    };
  }
  const coordinates = response.coordinates;
  const latitude = typeof coordinates?.latitude === 'number' ? coordinates.latitude : null;
  const longitude = typeof coordinates?.longitude === 'number' ? coordinates.longitude : null;
  const usableCoordinates = latitude !== null && longitude !== null
    && Number.isFinite(latitude) && latitude >= -90 && latitude <= 90
    && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180;
  const uncertainty = cleanList(response.uncertainty).filter((item) => !secret || !item.includes(secret));
  if (response.level === 'country' || response.precision === 'country') {
    uncertainty.push('A country was suggested. No city was selected.');
  }
  const channel: PlaceChannel = pending.kind === 'device' ? 'device' : 'geoip';
  const consumed = rememberIgnore(state, requestId, 'late-response');
  return {
    ...consumed,
    ignored: consumed.ignored.filter((item) => item.requestId !== requestId),
    placeId: place.placeId,
    label: scrub(cleanText(response.label, ROUTE_LIMITS.label), secret) ?? candidates[0]?.label ?? null,
    origin: 'suggestion',
    channel,
    originLabel: originLabel('suggestion', channel),
    scope: 'place',
    sessionCoordinates: usableCoordinates ? { latitude, longitude, address: null } : state.sessionCoordinates,
    uncertainty: uncertainty.slice(0, 12),
    candidates: [],
    suggestionSettled: true,
    route: syncRoute(state.route, place.placeId, state.asOf, 'place'),
    issues: capIssues(extraIssues),
    nextAction: channel === 'device'
      ? 'Device location is a suggestion. Change place if it is wrong.'
      : 'This approximate place is a suggestion. Change it if it is wrong.',
  };
}

export function proposeScopeChange(
  state: PlaceState,
  input: { placeId: string; label?: string | null; query: string },
): PlaceState {
  const place = canonicalizePlaceId(input.placeId);
  if (!place.ok) return fail(state, issue(place.code, 'place', place.message, place.nextAction));
  const query = cleanText(input.query, ROUTE_LIMITS.query);
  if (!query) {
    return fail(state, issue('missing-query', 'q', 'The search text did not name a place.', 'Keep the current place or choose one.'));
  }
  return {
    ...state,
    proposal: {
      placeId: place.placeId,
      label: cleanText(input.label, ROUTE_LIMITS.label),
      query,
      nextAction: 'Change place to this suggestion, or keep the current place.',
    },
    issues: [],
    nextAction: 'Change place to this suggestion, or keep the current place.',
  };
}

export function acceptScopeProposal(state: PlaceState): PlaceState {
  if (!state.proposal) {
    return fail(state, issue('missing-proposal', 'place', 'There is no place proposal to accept.', 'Keep the current place or choose one.'));
  }
  return selectPlace(state, { placeId: state.proposal.placeId, label: state.proposal.label });
}

export function noteEnvironment(
  state: PlaceState,
  input: { language?: string | null; timeZone?: string | null },
): PlaceState {
  let uiLanguageSuggestion = state.uiLanguageSuggestion;
  let timeZoneNoted = state.timeZoneNoted;
  if (input.language !== undefined) {
    const next = primaryLanguage(input.language);
    if (next) uiLanguageSuggestion = next;
  }
  if (input.timeZone !== undefined) {
    const next = notedTimeZone(input.timeZone);
    if (next) timeZoneNoted = next;
  }
  return { ...state, uiLanguageSuggestion, timeZoneNoted };
}

export function applyDutchExample(state: PlaceState, label: string): PlaceState {
  const example = dutchExampleSuggestion(label);
  if (!example) {
    return fail(state, issue(
      'unknown-example',
      'q',
      'That text is not one of the labelled Dutch examples.',
      'Choose one of the four examples or type a search.',
    ));
  }
  return {
    ...state,
    route: { ...state.route, name: 'search', query: example.query, queryTokenPresent: true },
    issues: [],
    nextAction: example.nextAction,
  };
}

export function navigate(state: PlaceState, href: string): PlaceState {
  const incoming = parseRoute(href);
  if (incoming.suggestionOnly && incoming.suggestionQuery) {
    return applyDutchExample(state, incoming.suggestionQuery);
  }
  if (!incoming.recognized) {
    return { ...state, issues: incoming.issues, nextAction: incoming.nextAction };
  }
  let placeId = state.placeId;
  let label = state.label;
  let origin = state.origin;
  let channel = state.channel;
  let scope = state.scope;
  let asOf = state.asOf;
  let asOfSource = state.asOfSource;
  let generation = state.generation;
  let suggestionSettled = state.suggestionSettled;
  let uncertainty = state.uncertainty;
  let candidates = state.candidates;
  let proposal = state.proposal;
  if (incoming.placeTokenPresent && incoming.placeId) {
    placeId = incoming.placeId;
    label = null;
    origin = 'url';
    channel = 'url';
    generation += 1;
    suggestionSettled = false;
    uncertainty = [];
    candidates = [];
    proposal = null;
    if (!incoming.scopeTokenPresent) scope = 'place';
  } else if (incoming.placeTokenPresent && !incoming.placeId) {
    placeId = null;
    label = null;
    origin = 'url';
    channel = 'url';
    generation += 1;
    suggestionSettled = false;
    uncertainty = [];
    candidates = [];
    proposal = null;
  }
  if (incoming.scopeTokenPresent && incoming.scope) scope = incoming.scope;
  if (incoming.dateTokenPresent && incoming.date) {
    asOf = incoming.date;
    asOfSource = 'url';
  }
  const query = incoming.queryTokenPresent ? incoming.query : state.route.query;
  const route = syncRoute({
    ...incoming,
    query,
    recordId: incoming.name === 'law' ? incoming.recordId : null,
    sourceRevision: incoming.name === 'law' ? incoming.sourceRevision : null,
    sectionId: incoming.name === 'law' ? incoming.sectionId : null,
    sourceId: incoming.name === 'sources' ? incoming.sourceId : null,
    comparePlaceIds: incoming.name === 'compare' ? incoming.comparePlaceIds : [],
    publisherUrl: incoming.publisherUrl ?? (incoming.name === state.route.name ? state.route.publisherUrl : null),
    publisherRemains: incoming.publisherRemains,
    migrationId: incoming.migrationId,
    coverageState: incoming.coverageState,
  }, placeId, asOf, scope);
  return {
    ...state,
    placeId,
    label,
    origin,
    channel,
    originLabel: originLabel(origin, channel),
    scope,
    asOf,
    asOfSource,
    generation,
    suggestionSettled,
    uncertainty,
    candidates,
    proposal,
    sessionCoordinates: incoming.droppedPreciseKeys.length > 0
      ? incoming.precise ?? state.sessionCoordinates
      : state.sessionCoordinates,
    route,
    issues: incoming.issues,
    nextAction: incoming.issues[0]?.nextAction ?? (placeId ? 'Search this place, or change it.' : 'Choose a place or search worldwide.'),
  };
}

export interface ShareOptions {
  includePreciseCoordinates?: boolean;
  name?: RouteName;
}

export function shareLink(state: PlaceState, options: ShareOptions = {}): string {
  const name = options.name ?? state.route.name;
  return buildRoute({
    name,
    query: name === 'search' || name === 'compare' ? state.route.query : null,
    placeId: state.placeId,
    date: state.asOf,
    scope: state.scope,
    recordId: name === 'law' ? state.route.recordId : null,
    sourceRevision: name === 'law' ? state.route.sourceRevision : null,
    sectionId: name === 'law' ? state.route.sectionId : null,
    sourceId: name === 'sources' ? state.route.sourceId : null,
    comparePlaceIds: name === 'compare' ? state.route.comparePlaceIds : [],
    precise: state.sessionCoordinates,
    includePreciseCoordinates: options.includePreciseCoordinates === true,
    placeToken: 'stable',
  }).href;
}

export function linkFor(
  state: PlaceState,
  name: RouteName,
  extra: {
    query?: string | null;
    recordId?: string | null;
    sourceRevision?: string | null;
    sectionId?: string | null;
    sourceId?: string | null;
    comparePlaceIds?: string[];
  } = {},
): string {
  const merged: PlaceState = {
    ...state,
    route: {
      ...state.route,
      query: extra.query === undefined ? state.route.query : extra.query,
      recordId: extra.recordId === undefined ? state.route.recordId : extra.recordId,
      sourceRevision: extra.sourceRevision === undefined ? state.route.sourceRevision : extra.sourceRevision,
      sectionId: extra.sectionId === undefined ? state.route.sectionId : extra.sectionId,
      sourceId: extra.sourceId === undefined ? state.route.sourceId : extra.sourceId,
      comparePlaceIds: extra.comparePlaceIds ?? state.route.comparePlaceIds,
    },
  };
  return shareLink(merged, { name });
}

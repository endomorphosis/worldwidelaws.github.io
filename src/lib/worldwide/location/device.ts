/**
 * Optional device location for worldwide search.
 *
 * Browser permission is requested only when request() is called with
 * userAction true. The component passes that only from the Use device
 * location control. The reading is matched with the local boundary pack
 * and then dropped. It is not written to storage, not kept as history,
 * and not sent to a reverse geocoder. watchPosition is never used.
 * No-third-party mode blocks approximate network location. Nothing here
 * decides that a law applies.
 */

import { APPLICABILITY } from '../jurisdiction/schema';
import {
  resolvePoint,
  type PlaceHit,
  type PlaceIndex,
  type PointResolution,
} from '../jurisdiction/resolve';
import {
  applySavedSelection,
  createPlaceState,
  originLabel,
  placeLockedAgainstSuggestions,
  receiveSuggestion,
  requestSuggestion,
  shareLink,
  type PlaceState,
} from './state';

export const DEVICE_LOCATION_SCHEMA = 'worldwide-legal-search.device-location@1';
export const DEVICE_OUTCOME_SCHEMA = 'worldwide-legal-search.device-outcome@1';
export const DEVICE_RESOLUTION_SCHEMA = 'worldwide-legal-search.device-resolution@1';
export const NO_THIRD_PARTY_SCHEMA = 'worldwide-legal-search.location.no-third-party@1';
export const NO_THIRD_PARTY_KEY = 'worldwide-legal-search.location.no-third-party';

export const DEVICE_LIMITS = {
  timeoutMs: 8000,
  maximumAgeMs: 0,
  enableHighAccuracy: true,
} as const;

export const DEVICE_COPY = {
  heading: 'Location and privacy',
  explanation:
    'Use device location asks this browser for permission and matches the reading on this device. The reading is not saved and is not put on a shared link.',
  applicability: 'This choice does not decide that a law applies.',
  useLabel: 'Use device location',
  clearLabel: 'Clear location',
  resetLabel: 'Reset privacy choices',
  thirdPartyLabel: 'Do not use third-party location services',
  suggestLabel: 'Suggest my approximate location',
  chooseLabel: 'Choose a place',
  thirdPartyOff: 'Third-party location services are off. Nothing was sent.',
  thirdPartyOn: 'Third-party location services can run only after you ask. Nothing was sent.',
  thirdPartyUnavailable: 'Approximate location is not offered from this screen. Nothing is sent.',
  idle: 'No location request has been made.',
  userAction: 'Browser location permission is requested only after you choose Use device location.',
  explicit: 'The current place stays as it is. Device permission was not requested.',
  missingPack:
    'Device location needs the local boundary pack. Choose a country, region, or municipality. Permission was not requested.',
  missingDate: 'Choose the date before matching device location. Permission was not requested.',
  insecure: 'Device location needs a secure page. Permission was not requested.',
  unavailable: 'Device location is unavailable. Choose a country, region, or municipality.',
  alreadyOpen: 'A location request is already waiting.',
  denied: 'Location permission was denied. Choose a country, region, or municipality.',
  timeout: 'The location request timed out. Choose a country, region, or municipality.',
  invalid: 'The device reading was not a usable point. Coordinates were not saved. Choose a place.',
  unresolved: 'No place in the local boundary pack contains this reading. Coordinates were not saved. Choose a place.',
  failed: 'The reading could not be matched locally. Coordinates were not saved. Choose a place.',
  choose: 'More than one place matches this device location. Choose one. Coordinates were not saved.',
  cleared: 'The device location was cleared. Coordinates were not kept.',
  clearedKept: 'Precise coordinates were cleared. The current place is unchanged.',
  clearedSaved: 'The device location was cleared. The saved place was restored. Coordinates were not kept.',
  reset: 'Privacy choices were reset. No location request was made.',
  resetKeptOff: 'Privacy choices could not be stored. Third-party location stays off. No location request was made.',
  suggestNeedsClick: 'Approximate location is sent only after you choose Suggest my approximate location.',
  localNote: 'Matched on this device from the local boundary pack. The coordinates were not saved.',
  noCity: 'No municipality was added for this point.',
  confirmBorder: 'This reading is on a boundary or an uncertain border. Choose the place yourself. Coordinates were not saved.',
} as const;

const MUNICIPAL = new Set([
  'municipality',
  'city',
  'locality',
  'borough',
  'neighborhood',
  'local-authority',
  'unincorporated',
  'postal-area',
]);
const REGIONAL = new Set([
  'region',
  'state',
  'province',
  'territory',
  'county',
  'district',
  'autonomous-area',
  'regional-authority',
  'special-district',
  'indigenous-territory',
]);
const COUNTRY = new Set(['country', 'constituent-country', 'dependency']);

export type DeviceReason =
  | 'applied'
  | 'choose'
  | 'user-action-required'
  | 'explicit-choice'
  | 'local-pack-missing'
  | 'missing-date'
  | 'geolocation-unavailable'
  | 'insecure-context'
  | 'already-open'
  | 'denied'
  | 'timeout'
  | 'unavailable'
  | 'invalid-reading'
  | 'unresolved'
  | 'local-resolution-failed'
  | 'cleared'
  | 'reset';

export type DeviceStatus =
  | 'applied'
  | 'choose'
  | 'unchanged'
  | 'denied'
  | 'timed-out'
  | 'unavailable'
  | 'blocked';

export type DeviceLevel = 'country' | 'region' | 'city' | 'municipality';

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface DevicePosition {
  coords: {
    latitude: number;
    longitude: number;
    accuracy?: number | null;
    altitude?: number | null;
    altitudeAccuracy?: number | null;
    heading?: number | null;
    speed?: number | null;
  };
  timestamp?: number;
}

export interface DevicePositionError {
  code?: number;
  message?: string;
}

export interface DevicePositionOptions {
  enableHighAccuracy: true;
  timeout: number;
  maximumAge: 0;
}

export interface DeviceGeolocation {
  getCurrentPosition: (
    success: (position: DevicePosition) => void,
    error?: (error: DevicePositionError) => void,
    options?: DevicePositionOptions,
  ) => void;
  watchPosition?: (
    success: (position: DevicePosition) => void,
    error?: (error: DevicePositionError) => void,
    options?: DevicePositionOptions,
  ) => number;
  clearWatch?: (id: number) => void;
}

export type ThirdPartyGeocoder = (reading: { latitude: number; longitude: number }) => Promise<unknown>;

export interface ThirdPartyLocationClient {
  suggest(input: {
    state: PlaceState | (() => PlaceState);
    consentRequired?: boolean;
    consented?: boolean;
  }): Promise<{ requestsSent: 0 | 1; state: PlaceState; nextAction: string; searchTextSent: false }>;
  setOptOut(optedOut: boolean): boolean;
  optedOut(): boolean;
}

export interface LocalPlaceChoice {
  placeId: string;
  label: string | null;
  levelKind: string;
  level: DeviceLevel;
}

export interface DeviceResolution {
  schema: typeof DEVICE_RESOLUTION_SCHEMA;
  status: 'selected' | 'choose' | 'unresolved' | 'invalid-point' | 'failed';
  choice: LocalPlaceChoice | null;
  candidates: LocalPlaceChoice[];
  uncertainty: string[];
  applicability: typeof APPLICABILITY;
}

export interface DeviceCandidate {
  placeId: string;
  label: string | null;
}

export interface DeviceOutcome {
  schema: typeof DEVICE_OUTCOME_SCHEMA;
  status: DeviceStatus;
  reason: DeviceReason;
  permissionRequested: boolean;
  watchRequested: false;
  thirdPartyRequested: false;
  deviceCoordinatesStored: false;
  placeChanged: boolean;
  manualFallback: true;
  applicability: typeof APPLICABILITY;
  nextAction: string;
  state: PlaceState;
  candidates: DeviceCandidate[];
}

export interface DeviceLocationRequest {
  state: PlaceState | (() => PlaceState);
  /** True only for a control the visitor activated. Any other call skips the browser prompt. */
  userAction?: boolean;
  asOf?: string | null;
  index?: PlaceIndex | null;
  viewIds?: readonly string[];
  requestId?: string;
  geolocation?: DeviceGeolocation | null;
  /** Accepted and never called. Coordinates are not sent to a reverse geocoder. */
  thirdPartyGeocoder?: ThirdPartyGeocoder | null;
}

export interface ThirdPartyAttempt {
  schema: typeof DEVICE_OUTCOME_SCHEMA;
  invoked: boolean;
  networkSent: boolean;
  reason: 'sent' | 'third-party-blocked' | 'user-action-required' | 'unavailable';
  nextAction: string;
  state: PlaceState;
}

export interface DeviceLocationClient {
  request(input: DeviceLocationRequest): Promise<DeviceOutcome>;
  clear(state: PlaceState): DeviceOutcome;
  reset(state: PlaceState, thirdParty?: Pick<ThirdPartyLocationClient, 'setOptOut'> | null): DeviceOutcome;
  setNoThirdParty(enabled: boolean): boolean;
  noThirdParty(): boolean;
  suggestApproximate(input: {
    state: PlaceState | (() => PlaceState);
    userAction?: boolean;
    geoIp?: ThirdPartyLocationClient | null;
  }): Promise<ThirdPartyAttempt>;
  permissionRequests(): number;
}

interface Gate {
  open: boolean;
  noThirdParty: boolean;
  permissionRequests: number;
  sequence: number;
  cancel: ((reason: 'cleared' | 'reset', state: PlaceState) => void) | null;
}

function rankOf(levelKind: string): number {
  if (levelKind === 'neighborhood') return 5;
  if (MUNICIPAL.has(levelKind)) return 4;
  if (levelKind === 'district' || levelKind === 'county') return 3;
  if (REGIONAL.has(levelKind)) return 2;
  if (COUNTRY.has(levelKind)) return 1;
  return 2;
}

function suggestionLevel(levelKind: string): DeviceLevel {
  if (COUNTRY.has(levelKind)) return 'country';
  if (levelKind === 'city') return 'city';
  if (REGIONAL.has(levelKind)) return 'region';
  return 'municipality';
}

function toChoice(hit: PlaceHit): LocalPlaceChoice {
  return {
    placeId: hit.placeId,
    label: hit.name,
    levelKind: hit.levelKind,
    level: suggestionLevel(hit.levelKind),
  };
}

function coordinateSamples(latitude: number, longitude: number): string[] {
  const samples: string[] = [];
  for (const value of [latitude, longitude]) {
    samples.push(String(value));
    for (let digits = 2; digits <= 6; digits += 1) samples.push(value.toFixed(digits));
  }
  return [...new Set(samples)].filter((sample) => sample.includes('.') && sample.length >= 4);
}

function mentions(value: string | null | undefined, samples: readonly string[]): boolean {
  if (!value) return false;
  return samples.some((sample) => value.includes(sample));
}

function cleanUncertainty(values: readonly string[], samples: readonly string[]): string[] {
  const cleaned: string[] = [];
  for (const value of values) {
    if (!value || mentions(value, samples)) continue;
    if (!cleaned.includes(value)) cleaned.push(value);
    if (cleaned.length >= 12) break;
  }
  return cleaned;
}

function blankResolution(
  status: DeviceResolution['status'],
  uncertainty: string[],
): DeviceResolution {
  return {
    schema: DEVICE_RESOLUTION_SCHEMA,
    status,
    choice: null,
    candidates: [],
    uncertainty,
    applicability: APPLICABILITY,
  };
}

function uncertainReading(resolution: PointResolution): boolean {
  if (resolution.status === 'border-uncertain' || resolution.truncated) return true;
  return resolution.candidates.some((candidate) =>
    candidate.reasons.includes('border-uncertain')
    || candidate.reasons.includes('on-boundary')
    || candidate.reasons.includes('disputed'));
}

export function resolveDevicePoint(
  index: PlaceIndex,
  input: { latitude: number; longitude: number; asOf: string; viewIds?: readonly string[] },
): DeviceResolution {
  const samples = coordinateSamples(input.latitude, input.longitude);
  if (
    !Number.isFinite(input.latitude)
    || !Number.isFinite(input.longitude)
    || input.latitude < -90
    || input.latitude > 90
    || input.longitude < -180
    || input.longitude > 180
  ) {
    return blankResolution('invalid-point', [DEVICE_COPY.invalid, DEVICE_COPY.applicability]);
  }
  let resolution: PointResolution;
  try {
    resolution = resolvePoint(index, {
      latitude: input.latitude,
      longitude: input.longitude,
      asOf: input.asOf,
      viewIds: input.viewIds,
      borderToleranceDegrees: 0,
    });
  } catch {
    return blankResolution('failed', [DEVICE_COPY.failed, DEVICE_COPY.applicability]);
  }
  const notes = cleanUncertainty(resolution.uncertainty, samples);
  if (!notes.includes(DEVICE_COPY.applicability)) notes.unshift(DEVICE_COPY.applicability);
  if (resolution.status === 'invalid-point') {
    return blankResolution('invalid-point', cleanUncertainty([DEVICE_COPY.invalid, ...notes], samples));
  }
  const choices = resolution.candidates.map(toChoice);
  if (choices.length === 0 || resolution.status === 'unresolved') {
    return {
      ...blankResolution('unresolved', cleanUncertainty([DEVICE_COPY.unresolved, ...notes], samples)),
    };
  }
  if (uncertainReading(resolution)) {
    const sentence = resolution.status === 'border-uncertain' || resolution.candidates.some((candidate) =>
      candidate.reasons.includes('border-uncertain') || candidate.reasons.includes('disputed') || candidate.reasons.includes('on-boundary'))
      ? DEVICE_COPY.confirmBorder
      : DEVICE_COPY.choose;
    return {
      schema: DEVICE_RESOLUTION_SCHEMA,
      status: 'choose',
      choice: null,
      candidates: choices.slice(0, 12),
      uncertainty: cleanUncertainty([sentence, ...notes], samples),
      applicability: APPLICABILITY,
    };
  }
  const ranked = [...choices].sort((left, right) =>
    rankOf(right.levelKind) - rankOf(left.levelKind) || left.placeId.localeCompare(right.placeId));
  const top = rankOf(ranked[0]?.levelKind ?? '');
  const peers = ranked.filter((choice) => rankOf(choice.levelKind) === top).slice(0, 12);
  if (peers.length !== 1) {
    return {
      schema: DEVICE_RESOLUTION_SCHEMA,
      status: 'choose',
      choice: null,
      candidates: peers,
      uncertainty: cleanUncertainty([DEVICE_COPY.choose, ...notes], samples),
      applicability: APPLICABILITY,
    };
  }
  const choice = peers[0];
  const extra = choice.level === 'country' ? DEVICE_COPY.noCity : DEVICE_COPY.localNote;
  return {
    schema: DEVICE_RESOLUTION_SCHEMA,
    status: 'selected',
    choice,
    candidates: [],
    uncertainty: cleanUncertainty([extra, ...notes], samples),
    applicability: APPLICABILITY,
  };
}

function statusFor(reason: DeviceReason): DeviceStatus {
  if (reason === 'applied') return 'applied';
  if (reason === 'choose') return 'choose';
  if (reason === 'denied') return 'denied';
  if (reason === 'timeout') return 'timed-out';
  if (
    reason === 'user-action-required'
    || reason === 'explicit-choice'
    || reason === 'local-pack-missing'
    || reason === 'missing-date'
    || reason === 'insecure-context'
    || reason === 'already-open'
  ) return 'blocked';
  if (reason === 'cleared' || reason === 'reset') return 'unchanged';
  return 'unavailable';
}

function sentenceFor(reason: DeviceReason, placeChanged: boolean, state: PlaceState): string {
  if (placeChanged && state.label) return `Device location suggests ${state.label}. Change the place if it is wrong. Coordinates were not saved.`;
  if (placeChanged && state.placeId) return `Device location suggests ${state.placeId}. Change the place if it is wrong. Coordinates were not saved.`;
  if (reason === 'choose') return DEVICE_COPY.choose;
  if (reason === 'user-action-required') return DEVICE_COPY.userAction;
  if (reason === 'explicit-choice') return DEVICE_COPY.explicit;
  if (reason === 'local-pack-missing') return DEVICE_COPY.missingPack;
  if (reason === 'missing-date') return DEVICE_COPY.missingDate;
  if (reason === 'insecure-context') return DEVICE_COPY.insecure;
  if (reason === 'already-open') return DEVICE_COPY.alreadyOpen;
  if (reason === 'denied') return DEVICE_COPY.denied;
  if (reason === 'timeout') return DEVICE_COPY.timeout;
  if (reason === 'invalid-reading') return DEVICE_COPY.invalid;
  if (reason === 'unresolved') return DEVICE_COPY.unresolved;
  if (reason === 'local-resolution-failed') return DEVICE_COPY.failed;
  if (reason === 'geolocation-unavailable' || reason === 'unavailable') return DEVICE_COPY.unavailable;
  if (reason === 'cleared') return state.nextAction || DEVICE_COPY.cleared;
  if (reason === 'reset') return state.nextAction || DEVICE_COPY.reset;
  return DEVICE_COPY.unavailable;
}

function forgetCoordinates(state: PlaceState, nextAction: string): PlaceState {
  const scrubbed: PlaceState = {
    ...state,
    sessionCoordinates: null,
    nextAction,
    route: { ...state.route, precise: null },
  };
  try {
    return {
      ...scrubbed,
      route: { ...scrubbed.route, href: shareLink(scrubbed), precise: null },
    };
  } catch {
    return scrubbed;
  }
}

function scrubApplied(state: PlaceState, samples: readonly string[], nextAction: string): PlaceState {
  const label = mentions(state.label, samples) ? null : state.label;
  const uncertainty = cleanUncertainty(state.uncertainty, samples);
  const candidates = state.candidates.map((candidate) => ({
    placeId: candidate.placeId,
    label: mentions(candidate.label, samples) ? null : candidate.label,
    uncertainty: cleanUncertainty(candidate.uncertainty, samples),
  }));
  const issues = state.issues.filter((item) => !mentions(item.message, samples) && !mentions(item.nextAction, samples));
  return forgetCoordinates({
    ...state,
    label,
    uncertainty,
    candidates,
    issues,
  }, mentions(nextAction, samples) ? DEVICE_COPY.failed : nextAction);
}

function outcome(input: {
  reason: DeviceReason;
  state: PlaceState;
  permissionRequested: boolean;
  placeChanged?: boolean;
  nextAction?: string;
}): DeviceOutcome {
  const placeChanged = input.placeChanged === true;
  const nextAction = input.nextAction ?? sentenceFor(input.reason, placeChanged, input.state);
  const state = input.nextAction
    ? { ...input.state, nextAction }
    : { ...input.state, nextAction };
  return {
    schema: DEVICE_OUTCOME_SCHEMA,
    status: statusFor(input.reason),
    reason: input.reason,
    permissionRequested: input.permissionRequested,
    watchRequested: false,
    thirdPartyRequested: false,
    deviceCoordinatesStored: false,
    placeChanged,
    manualFallback: true,
    applicability: APPLICABILITY,
    nextAction,
    state,
    candidates: state.candidates.map((candidate) => ({ placeId: candidate.placeId, label: candidate.label })),
  };
}

function currentState(input: PlaceState | (() => PlaceState)): PlaceState {
  return typeof input === 'function' ? input() : input;
}

function browserLocalStorage(): KeyValueStorage | null {
  if (typeof window === 'undefined') return null;
  try {
    const storage = window.localStorage;
    const probe = 'worldwide-legal-search.device.probe';
    storage.setItem(probe, '1');
    const seen = storage.getItem(probe);
    storage.removeItem(probe);
    return seen === '1' ? storage : null;
  } catch {
    return null;
  }
}

function readNoThirdParty(storage: KeyValueStorage | null): 'on' | 'off' | 'unreadable' {
  if (!storage) return 'off';
  let raw: string | null;
  try {
    raw = storage.getItem(NO_THIRD_PARTY_KEY);
  } catch {
    return 'unreadable';
  }
  if (raw === null) return 'off';
  try {
    const parsed = JSON.parse(raw) as { schema?: unknown; enabled?: unknown };
    if (parsed && parsed.schema === NO_THIRD_PARTY_SCHEMA && parsed.enabled === true) return 'on';
  } catch {
    return 'unreadable';
  }
  return 'unreadable';
}

function writeNoThirdParty(storage: KeyValueStorage | null, enabled: boolean): boolean {
  if (!storage) return false;
  try {
    if (!enabled) {
      storage.removeItem(NO_THIRD_PARTY_KEY);
      return storage.getItem(NO_THIRD_PARTY_KEY) === null;
    }
  } catch {
    return false;
  }
  const payload = JSON.stringify({ schema: NO_THIRD_PARTY_SCHEMA, enabled: true });
  if (payload.includes('latitude') || payload.includes('longitude') || payload.includes('coordinate')) return false;
  try {
    storage.setItem(NO_THIRD_PARTY_KEY, payload);
    return storage.getItem(NO_THIRD_PARTY_KEY) === payload;
  } catch {
    return false;
  }
}

function secureEnough(): boolean {
  if (typeof window === 'undefined') return true;
  return window.isSecureContext !== false;
}

function positionOptions(): DevicePositionOptions {
  return {
    enableHighAccuracy: DEVICE_LIMITS.enableHighAccuracy,
    timeout: DEVICE_LIMITS.timeoutMs,
    maximumAge: DEVICE_LIMITS.maximumAgeMs,
  };
}

function reasonFromError(error: DevicePositionError | null | undefined): DeviceReason {
  const code = error?.code;
  if (code === 1) return 'denied';
  if (code === 3) return 'timeout';
  return 'unavailable';
}

function readyForDevice(state: PlaceState): PlaceState {
  if (placeLockedAgainstSuggestions(state)) return state;
  const suggested = state.origin === 'suggestion';
  return {
    ...state,
    placeId: suggested ? null : state.placeId,
    label: suggested ? null : state.label,
    origin: suggested ? 'unselected' : state.origin,
    channel: suggested ? 'none' : state.channel,
    originLabel: suggested ? originLabel('unselected', 'none') : state.originLabel,
    scope: suggested ? 'worldwide' : state.scope,
    suggestionSettled: false,
    uncertainty: [],
    candidates: [],
    sessionCoordinates: null,
    route: {
      ...state.route,
      precise: null,
      placeId: suggested ? null : state.route.placeId,
      scope: suggested ? 'worldwide' : state.route.scope,
    },
  };
}

function applyResolution(state: PlaceState, resolution: DeviceResolution, requestId: string, samples: readonly string[]): DeviceOutcome {
  const prepared = readyForDevice(state);
  if (resolution.status === 'selected' && resolution.choice) {
    const requested = requestSuggestion(prepared, { requestId, kind: 'device' });
    if (!requested.pending.some((item) => item.requestId === requestId && item.kind === 'device')) {
      return outcome({ reason: 'local-resolution-failed', state, permissionRequested: true });
    }
    const received = receiveSuggestion(requested, {
      requestId,
      kind: 'device',
      placeId: resolution.choice.placeId,
      label: resolution.choice.label,
      level: resolution.choice.level,
      uncertainty: resolution.uncertainty,
    });
    const changed = received.channel === 'device' && received.placeId === resolution.choice.placeId;
    const nextAction = sentenceFor(changed ? 'applied' : 'unresolved', changed, received);
    return outcome({
      reason: changed ? 'applied' : 'unresolved',
      state: scrubApplied(received, samples, nextAction),
      permissionRequested: true,
      placeChanged: changed,
      nextAction,
    });
  }
  if (resolution.status === 'choose' && resolution.candidates.length > 0) {
    // One border candidate must stay unselected. receiveSuggestion would
    // accept a single candidate as the place, so the choice is stored directly.
    const sentence = resolution.uncertainty.find((item) => item === DEVICE_COPY.confirmBorder) ?? DEVICE_COPY.choose;
    const listed: PlaceState = {
      ...prepared,
      placeId: null,
      label: null,
      origin: 'unselected',
      channel: 'none',
      originLabel: originLabel('unselected', 'none'),
      scope: 'worldwide',
      candidates: resolution.candidates.map((choice) => ({
        placeId: choice.placeId,
        label: mentions(choice.label, samples) ? null : choice.label,
        uncertainty: cleanUncertainty(resolution.uncertainty, samples),
      })),
      uncertainty: cleanUncertainty(resolution.uncertainty, samples),
      suggestionSettled: true,
      sessionCoordinates: null,
      route: { ...prepared.route, placeId: null, scope: 'worldwide', precise: null },
    };
    return outcome({
      reason: 'choose',
      state: scrubApplied(listed, samples, sentence),
      permissionRequested: true,
      placeChanged: false,
      nextAction: sentence,
    });
  }
  const reason: DeviceReason = resolution.status === 'invalid-point'
    ? 'invalid-reading'
    : resolution.status === 'failed'
      ? 'local-resolution-failed'
      : 'unresolved';
  return outcome({ reason, state: forgetCoordinates(state, sentenceFor(reason, false, state)), permissionRequested: true });
}

function clearDevice(state: PlaceState): PlaceState {
  const drop = state.origin === 'suggestion' && state.channel === 'device';
  const pending = state.pending.filter((item) => item.kind !== 'device');
  if (drop) {
    let next: PlaceState = {
      ...state,
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
      pending,
      generation: state.generation + 1,
      issues: [],
      sessionCoordinates: null,
      route: { ...state.route, placeId: null, scope: 'worldwide', precise: null },
    };
    if (state.saved) {
      const restored = applySavedSelection(next, state.saved);
      if (restored.origin === 'saved') next = { ...restored, pending, sessionCoordinates: null };
    }
    return next;
  }
  const dropCandidates = state.origin === 'unselected' && state.candidates.length > 0;
  return {
    ...state,
    pending,
    sessionCoordinates: null,
    candidates: dropCandidates ? [] : state.candidates,
    suggestionSettled: dropCandidates ? false : state.suggestionSettled,
    uncertainty: dropCandidates ? [] : state.uncertainty,
    issues: [],
    route: { ...state.route, precise: null },
  };
}

function clearedSentence(before: PlaceState, after: PlaceState): string {
  if (before.origin === 'suggestion' && before.channel === 'device' && after.origin === 'saved') return DEVICE_COPY.clearedSaved;
  if (before.origin === 'suggestion' && before.channel === 'device') return DEVICE_COPY.cleared;
  if (before.origin === 'unselected' && before.candidates.length > 0) return DEVICE_COPY.cleared;
  return DEVICE_COPY.clearedKept;
}

export function createDeviceLocationClient(options: {
  geolocation?: DeviceGeolocation | null;
  storage?: KeyValueStorage | null;
  useBrowserStorage?: boolean;
} = {}): DeviceLocationClient {
  const storage = options.storage !== undefined
    ? options.storage
    : options.useBrowserStorage === false
      ? null
      : browserLocalStorage();
  const gate: Gate = {
    open: false,
    noThirdParty: readNoThirdParty(storage) !== 'off',
    permissionRequests: 0,
    sequence: 0,
    cancel: null,
  };
  const defaultGeolocation = options.geolocation === undefined ? undefined : options.geolocation;

  function thirdPartyBlocked(): boolean {
    if (gate.noThirdParty) return true;
    const read = readNoThirdParty(storage);
    if (read === 'on' || read === 'unreadable') {
      gate.noThirdParty = true;
      return true;
    }
    return false;
  }

  function setNoThirdParty(enabled: boolean): boolean {
    if (!storage) {
      gate.noThirdParty = enabled;
      return true;
    }
    const wrote = writeNoThirdParty(storage, enabled);
    if (!wrote) {
      gate.noThirdParty = true;
      return false;
    }
    gate.noThirdParty = enabled;
    return true;
  }

  function finishClear(state: PlaceState, reason: 'cleared' | 'reset', nextAction: string): DeviceOutcome {
    const next = forgetCoordinates(clearDevice(state), nextAction);
    const cancel = gate.cancel;
    gate.cancel = null;
    gate.open = false;
    if (cancel) cancel(reason, next);
    return outcome({ reason, state: next, permissionRequested: false, nextAction });
  }

  function request(input: DeviceLocationRequest): Promise<DeviceOutcome> {
    // The geocoder reference is intentionally unused. Calling it would send coordinates away.
    void input.thirdPartyGeocoder;
    let opened: PlaceState;
    try {
      opened = currentState(input.state);
    } catch {
      return Promise.resolve(outcome({
        reason: 'unavailable',
        state: createPlaceState(),
        permissionRequested: false,
        nextAction: DEVICE_COPY.unavailable,
      }));
    }
    if (input.userAction !== true) {
      return Promise.resolve(outcome({ reason: 'user-action-required', state: opened, permissionRequested: false }));
    }
    if (placeLockedAgainstSuggestions(opened)) {
      return Promise.resolve(outcome({ reason: 'explicit-choice', state: opened, permissionRequested: false }));
    }
    if (!input.index) {
      return Promise.resolve(outcome({ reason: 'local-pack-missing', state: opened, permissionRequested: false }));
    }
    const asOf = input.asOf ?? opened.asOf?.value ?? null;
    if (!asOf) {
      return Promise.resolve(outcome({ reason: 'missing-date', state: opened, permissionRequested: false }));
    }
    if (!secureEnough()) {
      return Promise.resolve(outcome({ reason: 'insecure-context', state: opened, permissionRequested: false }));
    }
    const geolocation = input.geolocation === undefined ? defaultGeolocation ?? readNavigatorGeolocation() : input.geolocation;
    if (!geolocation || typeof geolocation.getCurrentPosition !== 'function') {
      return Promise.resolve(outcome({ reason: 'geolocation-unavailable', state: opened, permissionRequested: false }));
    }
    if (gate.open) {
      return Promise.resolve(outcome({ reason: 'already-open', state: opened, permissionRequested: false }));
    }
    const index = input.index;
    const viewIds = input.viewIds;
    gate.open = true;
    gate.permissionRequests += 1;
    gate.sequence += 1;
    const requestId = usableRequestId(input.requestId) ?? `device-${gate.sequence}`;
    return new Promise((resolve) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const settle = (result: DeviceOutcome) => {
        if (settled) return;
        settled = true;
        if (timer !== undefined) clearTimeout(timer);
        gate.cancel = null;
        gate.open = false;
        resolve(result);
      };
      gate.cancel = (_reason, state) => {
        settle(outcome({
          reason: _reason,
          state,
          permissionRequested: true,
          nextAction: state.nextAction,
        }));
      };
      timer = setTimeout(() => {
        settle(outcome({ reason: 'timeout', state: readLatest(input.state, opened), permissionRequested: true }));
      }, DEVICE_LIMITS.timeoutMs);
      try {
        geolocation.getCurrentPosition(
          (position) => {
            if (settled) return;
            const latest = readLatest(input.state, opened);
            if (placeLockedAgainstSuggestions(latest)) {
              settle(outcome({ reason: 'explicit-choice', state: latest, permissionRequested: true }));
              return;
            }
            const latitude = position?.coords?.latitude;
            const longitude = position?.coords?.longitude;
            if (typeof latitude !== 'number' || typeof longitude !== 'number') {
              settle(outcome({ reason: 'invalid-reading', state: forgetCoordinates(latest, DEVICE_COPY.invalid), permissionRequested: true }));
              return;
            }
            try {
              const resolution = resolveDevicePoint(index, { latitude, longitude, asOf, viewIds });
              settle(applyResolution(latest, resolution, requestId, coordinateSamples(latitude, longitude)));
            } catch {
              settle(outcome({
                reason: 'local-resolution-failed',
                state: forgetCoordinates(latest, DEVICE_COPY.failed),
                permissionRequested: true,
              }));
            }
          },
          (error) => {
            if (settled) return;
            const reason = reasonFromError(error);
            settle(outcome({ reason, state: readLatest(input.state, opened), permissionRequested: true }));
          },
          positionOptions(),
        );
      } catch {
        settle(outcome({ reason: 'geolocation-unavailable', state: opened, permissionRequested: true }));
      }
    });
  }

  return {
    request,
    clear: (state) => finishClear(state, 'cleared', clearedSentence(state, clearDevice(state))),
    reset: (state, thirdParty) => {
      const wrote = setNoThirdParty(false);
      try {
        thirdParty?.setOptOut(false);
      } catch {
        gate.noThirdParty = true;
      }
      const nextAction = wrote && !gate.noThirdParty ? DEVICE_COPY.reset : DEVICE_COPY.resetKeptOff;
      if (!wrote) gate.noThirdParty = true;
      return finishClear(state, 'reset', nextAction);
    },
    setNoThirdParty,
    noThirdParty: () => thirdPartyBlocked(),
    suggestApproximate: async (input) => {
      let state: PlaceState;
      try {
        state = currentState(input.state);
      } catch {
        return {
          schema: DEVICE_OUTCOME_SCHEMA,
          invoked: false,
          networkSent: false,
          reason: 'unavailable',
          nextAction: DEVICE_COPY.unavailable,
          state: createPlaceState(),
        };
      }
      if (input.userAction !== true) {
        return {
          schema: DEVICE_OUTCOME_SCHEMA,
          invoked: false,
          networkSent: false,
          reason: 'user-action-required',
          nextAction: DEVICE_COPY.suggestNeedsClick,
          state,
        };
      }
      if (thirdPartyBlocked()) {
        return {
          schema: DEVICE_OUTCOME_SCHEMA,
          invoked: false,
          networkSent: false,
          reason: 'third-party-blocked',
          nextAction: DEVICE_COPY.thirdPartyOff,
          state,
        };
      }
      let optedOut = false;
      try {
        optedOut = input.geoIp?.optedOut() === true;
      } catch {
        optedOut = true;
      }
      if (optedOut) {
        gate.noThirdParty = true;
        return {
          schema: DEVICE_OUTCOME_SCHEMA,
          invoked: false,
          networkSent: false,
          reason: 'third-party-blocked',
          nextAction: DEVICE_COPY.thirdPartyOff,
          state,
        };
      }
      if (!input.geoIp) {
        return {
          schema: DEVICE_OUTCOME_SCHEMA,
          invoked: false,
          networkSent: false,
          reason: 'unavailable',
          nextAction: DEVICE_COPY.thirdPartyUnavailable,
          state,
        };
      }
      try {
        const result = await input.geoIp.suggest({
          state: input.state,
          consentRequired: true,
          consented: true,
        });
        return {
          schema: DEVICE_OUTCOME_SCHEMA,
          invoked: true,
          networkSent: result.requestsSent === 1,
          reason: 'sent',
          nextAction: result.nextAction,
          state: result.state,
        };
      } catch {
        return {
          schema: DEVICE_OUTCOME_SCHEMA,
          invoked: true,
          networkSent: false,
          reason: 'unavailable',
          nextAction: DEVICE_COPY.unavailable,
          state,
        };
      }
    },
    permissionRequests: () => gate.permissionRequests,
  };
}

function readLatest(input: PlaceState | (() => PlaceState), fallback: PlaceState): PlaceState {
  try {
    return currentState(input);
  } catch {
    return fallback;
  }
}

function readNavigatorGeolocation(): DeviceGeolocation | null {
  if (typeof navigator === 'undefined') return null;
  const geolocation = navigator.geolocation as DeviceGeolocation | undefined;
  if (!geolocation || typeof geolocation.getCurrentPosition !== 'function') return null;
  return geolocation;
}

function usableRequestId(value: string | undefined): string | null {
  const text = value?.trim() ?? '';
  if (!text || text.length > 80 || /[\u0000-\u001F\u007F]/.test(text)) return null;
  return text;
}

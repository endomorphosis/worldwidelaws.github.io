/**
 * Replaceable approximate GeoIP suggestion for a static Pages site.
 *
 * Pages cannot see the visitor IP. The selected provider is one HTTPS GET
 * to https://api.country.is/ with no query, no secret, and no Referer.
 * The body may contain an IP. This module drops it and keeps a country code.
 * A country code is not a place id, and it never selects a city. Search text,
 * addresses, and coordinates are not sent. Opt-out is local. Manual place
 * selection stays available on every path. Nothing here decides that a law
 * applies. The evaluation record is docs/worldwide/geoip-provider-decision.json.
 */

import { canonicalizePlaceId, ROUTE_LIMITS } from '../routes';
import {
  placeLockedAgainstSuggestions,
  receiveSuggestion,
  requestSuggestion,
  type PlaceState,
  type SuggestionResponse,
} from './state';

export const GEOIP_DECISION_SCHEMA = 'worldwide-legal-search.geoip-provider-decision@1';
export const GEOIP_HINT_SCHEMA = 'worldwide-legal-search.geoip-hint@1';
export const GEOIP_OUTCOME_SCHEMA = 'worldwide-legal-search.geoip-outcome@1';
export const GEOIP_OPT_OUT_SCHEMA = 'worldwide-legal-search.geoip-opt-out@1';
export const GEOIP_SESSION_SCHEMA = 'worldwide-legal-search.geoip-session@1';

export const GEOIP_OPT_OUT_KEY = 'worldwide-legal-search.geoip.opt-out';
export const GEOIP_SESSION_KEY = 'worldwide-legal-search.geoip.session';

export const GEOIP_COPY = {
  heading: 'Approximate location',
  explanation:
    'This site can ask api.country.is once, from your browser, for an approximate country based on your network address. The request does not include your search, an address, or coordinates. The answer can be wrong if you use a VPN or a mobile network, and it never chooses a city. Choosing a place yourself always works.',
  consentExplanation:
    'Nothing is sent until you choose Suggest my approximate location. That request asks api.country.is once for an approximate country. It does not include your search, an address, or coordinates, and it never chooses a city.',
  optOutLabel: 'Do not suggest a location',
  suggestLabel: 'Suggest my approximate location',
  manualLabel: 'Choose a place',
  thirdParty: 'api.country.is',
  attribution:
    'Country data includes GeoLite2 data created by MaxMind, available from https://www.maxmind.com.',
  precisionNote: 'Country only. No city is selected.',
} as const;

export const SELECTED_GEOIP = {
  providerId: 'country.is',
  method: 'GET',
  url: 'https://api.country.is/',
  requiresSecret: false,
  credentials: 'omit',
  mode: 'cors',
  redirect: 'error',
  referrerPolicy: 'no-referrer',
  cache: 'no-store',
  accept: 'application/json',
  timeoutMs: 2500,
  maxResponseBytes: 2048,
  maxRequestsPerSession: 1,
  retries: 0,
  precision: 'country',
  pagesOrigins: ['https://worldwidelaws.github.io', 'https://wetwijzer.github.io'],
} as const;

const TIMEOUT_MIN_MS = 500;
const TIMEOUT_MAX_MS = 4000;
const BODY_MIN_BYTES = 32;
const BODY_MAX_BYTES = 8192;

export type GeoIpPrecision = 'country' | 'region' | 'city';
export type ResolvedLevel = 'country' | 'region' | 'city' | 'municipality';
export type GeoIpStatus = 'applied' | 'approximate' | 'manual' | 'offered' | 'opted-out' | 'refused';

export type GeoIpReason =
  | 'applied'
  | 'approximate'
  | 'opt-out'
  | 'opt-out-unreadable'
  | 'consent-required'
  | 'explicit-choice'
  | 'already-suggested'
  | 'already-open'
  | 'session-bound'
  | 'storage-unavailable'
  | 'search-text-not-sent'
  | 'address-not-sent'
  | 'coordinates-not-sent'
  | 'unsafe-endpoint'
  | 'fetch-unavailable'
  | 'timeout'
  | 'network'
  | 'http-error'
  | 'oversize'
  | 'unreadable-body'
  | 'unusable-response'
  | 'country-only'
  | 'precision-mismatch'
  | 'no-stable-place'
  | 'invalid-place'
  | 'invalid-request'
  | 'discarded-after-opt-out'
  | 'late-explicit-choice';

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface ApproximateGeoHint {
  schema: typeof GEOIP_HINT_SCHEMA;
  providerId: string;
  precision: GeoIpPrecision;
  countryCode: string | null;
  regionLabel: string | null;
  localityLabel: string | null;
  uncertainty: string[];
  attribution: string;
}

export interface GeoIpDisclosure {
  heading: string;
  explanation: string;
  thirdParty: string;
  requestIncludesSearchText: false;
  optOutLabel: string;
  suggestLabel: string;
  manualLabel: string;
  attribution: string;
  precisionNote: string;
}

export interface GeoIpFetchInit {
  method: 'GET';
  credentials: 'omit';
  cache: 'no-store';
  redirect: 'error';
  referrerPolicy: 'no-referrer';
  mode: 'cors';
  headers: { Accept: 'application/json' };
  signal?: AbortSignal;
}

export interface GeoIpFetchResponse {
  ok: boolean;
  status: number;
  headers?: { get(name: string): string | null };
  body?: { getReader?: () => ReadableStreamDefaultReader<Uint8Array> } | null;
  text: () => Promise<string>;
}

export type GeoIpFetch = (url: string, init: GeoIpFetchInit) => Promise<GeoIpFetchResponse>;

export interface GeoIpProvider {
  id: string;
  requiresSecret: false;
  method: 'GET';
  url: string;
  credentials: 'omit';
  mode: 'cors';
  redirect: 'error';
  referrerPolicy: 'no-referrer';
  cache: 'no-store';
  timeoutMs: number;
  maxResponseBytes: number;
  precision: GeoIpPrecision;
  parse: (body: unknown) => ApproximateGeoHint | null;
}

export interface ResolvedGeoPlace {
  placeId: string;
  label?: string | null;
  level: ResolvedLevel;
}

export type GeoIpPlaceResolver = (hint: ApproximateGeoHint) => ResolvedGeoPlace | null;

export interface AttachedGeoPayload {
  searchText?: string | null;
  address?: string | null;
  coordinates?: unknown;
}

export interface GeoIpOutcome {
  schema: typeof GEOIP_OUTCOME_SCHEMA;
  status: GeoIpStatus;
  reason: GeoIpReason;
  providerId: string;
  placeChanged: false | true;
  manualFallback: true;
  searchTextSent: false;
  requestsSent: 0 | 1;
  hint: ApproximateGeoHint | null;
  disclosure: GeoIpDisclosure;
  nextAction: string;
  state: PlaceState;
  request: { sent: boolean; url: string | null; method: 'GET' | null };
}

export interface SuggestApproximateLocationInput {
  state: PlaceState | (() => PlaceState);
  consentRequired?: boolean;
  consented?: boolean;
  attached?: AttachedGeoPayload | null;
  resolver?: GeoIpPlaceResolver | null;
  requestId?: string;
  fetchImpl?: GeoIpFetch | null;
}

interface ClientGate {
  pending: boolean;
  memoryOptOut: boolean;
}

const COUNTRY_UNCERTAINTY = [
  'Approximate country from the network address. A VPN, mobile network, or carrier address can make this wrong.',
  'A country code is not a place id. No city was selected.',
];

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/[\u0000-\u001F\u007F]/g, '').trim();
  if (!text) return null;
  return text.slice(0, max);
}

function looksLikeNetworkAddress(value: string): boolean {
  return /\b\d{1,3}(?:\.\d{1,3}){3}\b/.test(value) || /[0-9a-f]{0,4}:[0-9a-f]{0,4}:/i.test(value);
}

function cleanLabel(value: unknown): string | null {
  const text = cleanText(value, ROUTE_LIMITS.label);
  if (!text || looksLikeNetworkAddress(text)) return null;
  return text;
}

function normalizeCountryCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return null;
  return code;
}

function cleanUncertainty(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const cleaned: string[] = [];
  for (const entry of value) {
    const text = cleanText(entry, 300);
    if (!text || looksLikeNetworkAddress(text)) continue;
    cleaned.push(text);
    if (cleaned.length >= 4) break;
  }
  return cleaned;
}

export function sealGeoIpHint(input: ApproximateGeoHint): ApproximateGeoHint | null {
  if (!input || input.schema !== GEOIP_HINT_SCHEMA) return null;
  if (input.precision !== 'country' && input.precision !== 'region' && input.precision !== 'city') return null;
  const countryCode = normalizeCountryCode(input.countryCode);
  if (input.precision === 'country' && !countryCode) return null;
  const providerId = cleanText(input.providerId, 80);
  if (!providerId) return null;
  const countryOnly = input.precision === 'country';
  return {
    schema: GEOIP_HINT_SCHEMA,
    providerId,
    precision: input.precision,
    countryCode,
    regionLabel: countryOnly ? null : cleanLabel(input.regionLabel),
    localityLabel: countryOnly ? null : cleanLabel(input.localityLabel),
    uncertainty: cleanUncertainty(input.uncertainty),
    attribution: cleanLabel(input.attribution) ?? '',
  };
}

export function parseCountryIsBody(body: unknown): ApproximateGeoHint | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const country = normalizeCountryCode((body as { country?: unknown }).country);
  if (!country) return null;
  return sealGeoIpHint({
    schema: GEOIP_HINT_SCHEMA,
    providerId: SELECTED_GEOIP.providerId,
    precision: 'country',
    countryCode: country,
    regionLabel: null,
    localityLabel: null,
    uncertainty: COUNTRY_UNCERTAINTY.slice(),
    attribution: GEOIP_COPY.attribution,
  });
}

export const countryIsProvider: GeoIpProvider = {
  id: SELECTED_GEOIP.providerId,
  requiresSecret: false,
  method: 'GET',
  url: SELECTED_GEOIP.url,
  credentials: 'omit',
  mode: 'cors',
  redirect: 'error',
  referrerPolicy: 'no-referrer',
  cache: 'no-store',
  timeoutMs: SELECTED_GEOIP.timeoutMs,
  maxResponseBytes: SELECTED_GEOIP.maxResponseBytes,
  precision: 'country',
  parse: parseCountryIsBody,
};

export function geoIpDisclosure(consentRequired = false): GeoIpDisclosure {
  return {
    heading: GEOIP_COPY.heading,
    explanation: consentRequired ? GEOIP_COPY.consentExplanation : GEOIP_COPY.explanation,
    thirdParty: GEOIP_COPY.thirdParty,
    requestIncludesSearchText: false,
    optOutLabel: GEOIP_COPY.optOutLabel,
    suggestLabel: GEOIP_COPY.suggestLabel,
    manualLabel: GEOIP_COPY.manualLabel,
    attribution: GEOIP_COPY.attribution,
    precisionNote: GEOIP_COPY.precisionNote,
  };
}

export function memoryStorage(): KeyValueStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => (values.has(key) ? values.get(key) ?? null : null),
    setItem: (key, value) => {
      values.set(key, String(value));
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

function canUseStorage(storage: KeyValueStorage | null | undefined): storage is KeyValueStorage {
  if (!storage) return false;
  const probe = 'worldwide-legal-search.geoip.probe';
  try {
    storage.setItem(probe, '1');
    const seen = storage.getItem(probe);
    storage.removeItem(probe);
    return seen === '1';
  } catch {
    return false;
  }
}

export function browserStorage(kind: 'local' | 'session'): KeyValueStorage | null {
  if (typeof window === 'undefined') return null;
  try {
    const storage = kind === 'local' ? window.localStorage : window.sessionStorage;
    return canUseStorage(storage) ? storage : null;
  } catch {
    return null;
  }
}

function readItem(storage: KeyValueStorage, key: string): { ok: true; value: string | null } | { ok: false } {
  try {
    return { ok: true, value: storage.getItem(key) };
  } catch {
    return { ok: false };
  }
}

function writeItem(storage: KeyValueStorage, key: string, value: string): boolean {
  try {
    storage.setItem(key, value);
    return storage.getItem(key) === value;
  } catch {
    return false;
  }
}

export function readGeoIpOptOut(storage: KeyValueStorage): 'out' | 'in' | 'unreadable' {
  const read = readItem(storage, GEOIP_OPT_OUT_KEY);
  if (!read.ok) return 'unreadable';
  if (read.value === null) return 'in';
  try {
    const parsed = JSON.parse(read.value) as { schema?: unknown; optedOut?: unknown };
    if (parsed && parsed.schema === GEOIP_OPT_OUT_SCHEMA && parsed.optedOut === true) return 'out';
  } catch {
    return 'unreadable';
  }
  return 'unreadable';
}

export function setGeoIpOptOut(storage: KeyValueStorage, optedOut: boolean): boolean {
  try {
    if (!optedOut) {
      storage.removeItem(GEOIP_OPT_OUT_KEY);
      return storage.getItem(GEOIP_OPT_OUT_KEY) === null;
    }
  } catch {
    return false;
  }
  return writeItem(
    storage,
    GEOIP_OPT_OUT_KEY,
    JSON.stringify({ schema: GEOIP_OPT_OUT_SCHEMA, optedOut: true }),
  );
}

function sessionUsed(storage: KeyValueStorage): 'free' | 'used' | 'unreadable' {
  const read = readItem(storage, GEOIP_SESSION_KEY);
  if (!read.ok) return 'unreadable';
  if (read.value === null) return 'free';
  try {
    const parsed = JSON.parse(read.value) as { schema?: unknown; requests?: unknown };
    if (parsed && parsed.schema === GEOIP_SESSION_SCHEMA && typeof parsed.requests === 'number' && parsed.requests >= 1) {
      return 'used';
    }
  } catch {
    return 'unreadable';
  }
  return 'unreadable';
}

function markSession(storage: KeyValueStorage): boolean {
  return writeItem(
    storage,
    GEOIP_SESSION_KEY,
    JSON.stringify({ schema: GEOIP_SESSION_SCHEMA, requests: 1 }),
  );
}

function presentText(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

export function refusalForAttached(attached: AttachedGeoPayload | null | undefined): GeoIpReason | null {
  if (!attached) return null;
  if (presentText(attached.searchText)) return 'search-text-not-sent';
  if (presentText(attached.address)) return 'address-not-sent';
  if (attached.coordinates !== undefined && attached.coordinates !== null) return 'coordinates-not-sent';
  return null;
}

export function endpointIsSendable(url: string, timeoutMs: number, maxResponseBytes: number): boolean {
  if (timeoutMs < TIMEOUT_MIN_MS || timeoutMs > TIMEOUT_MAX_MS) return false;
  if (maxResponseBytes < BODY_MIN_BYTES || maxResponseBytes > BODY_MAX_BYTES) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  if (parsed.username || parsed.password) return false;
  if (parsed.search || parsed.hash) return false;
  if (parsed.href !== url) return false;
  if (parsed.pathname.includes(':')) return false;
  if (/\d{1,3}(?:\.\d{1,3}){3}/.test(parsed.pathname)) return false;
  return true;
}

export function buildGeoIpRequest(
  provider: GeoIpProvider,
  attached?: AttachedGeoPayload | null,
): { ok: true; url: string; init: GeoIpFetchInit } | { ok: false; reason: GeoIpReason } {
  const refusal = refusalForAttached(attached);
  if (refusal) return { ok: false, reason: refusal };
  if (provider.requiresSecret !== false || provider.method !== 'GET') return { ok: false, reason: 'unsafe-endpoint' };
  if (provider.credentials !== 'omit' || provider.referrerPolicy !== 'no-referrer') return { ok: false, reason: 'unsafe-endpoint' };
  if (!endpointIsSendable(provider.url, provider.timeoutMs, provider.maxResponseBytes)) {
    return { ok: false, reason: 'unsafe-endpoint' };
  }
  return {
    ok: true,
    url: provider.url,
    init: {
      method: 'GET',
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      mode: 'cors',
      headers: { Accept: 'application/json' },
    },
  };
}

function currentState(input: PlaceState | (() => PlaceState)): PlaceState {
  return typeof input === 'function' ? input() : input;
}

function blockedReason(state: PlaceState): GeoIpReason | null {
  if (placeLockedAgainstSuggestions(state)) return 'explicit-choice';
  if (state.origin === 'suggestion' || state.suggestionSettled) return 'already-suggested';
  if (state.pending.some((item) => item.kind === 'geoip')) return 'already-open';
  return null;
}

function levelAllowed(precision: GeoIpPrecision, level: ResolvedLevel): boolean {
  if (precision === 'country') return level === 'country';
  if (precision === 'region') return level === 'country' || level === 'region';
  return level === 'country' || level === 'region' || level === 'city' || level === 'municipality';
}

function nextActionFor(reason: GeoIpReason, consentRequired: boolean): string {
  if (reason === 'consent-required') return 'Choose Suggest my approximate location, or choose a place yourself.';
  if (reason === 'opt-out' || reason === 'discarded-after-opt-out' || reason === 'opt-out-unreadable') {
    return 'Location suggestions are off. Choose a place yourself.';
  }
  if (reason === 'search-text-not-sent' || reason === 'address-not-sent' || reason === 'coordinates-not-sent') {
    return 'The location request was not sent. Choose a place yourself.';
  }
  if (
    reason === 'approximate'
    || reason === 'no-stable-place'
    || reason === 'country-only'
    || reason === 'precision-mismatch'
  ) {
    return 'This is an approximate country code, not a selected place. Choose a country, region, or municipality.';
  }
  if (reason === 'explicit-choice' || reason === 'late-explicit-choice' || reason === 'already-suggested') {
    return 'The current place stays as it is. Change it if it is wrong.';
  }
  if (consentRequired && reason === 'session-bound') {
    return 'A location suggestion was already requested in this session. Choose a place yourself.';
  }
  return 'Choose a country, region, or municipality.';
}

function statusFor(reason: GeoIpReason): GeoIpStatus {
  if (reason === 'applied') return 'applied';
  if (
    reason === 'approximate'
    || reason === 'no-stable-place'
    || reason === 'country-only'
    || reason === 'precision-mismatch'
  ) return 'approximate';
  if (reason === 'opt-out' || reason === 'discarded-after-opt-out' || reason === 'opt-out-unreadable') return 'opted-out';
  if (reason === 'consent-required') return 'offered';
  if (reason === 'search-text-not-sent' || reason === 'address-not-sent' || reason === 'coordinates-not-sent') return 'refused';
  return 'manual';
}

function outcome(input: {
  reason: GeoIpReason;
  providerId: string;
  state: PlaceState;
  hint?: ApproximateGeoHint | null;
  requestsSent?: 0 | 1;
  url?: string | null;
  consentRequired?: boolean;
  placeChanged?: boolean;
}): GeoIpOutcome {
  const reason = input.reason;
  const sent = input.requestsSent === 1;
  return {
    schema: GEOIP_OUTCOME_SCHEMA,
    status: statusFor(reason),
    reason,
    providerId: input.providerId,
    placeChanged: input.placeChanged === true,
    manualFallback: true,
    searchTextSent: false,
    requestsSent: sent ? 1 : 0,
    hint: input.hint ?? null,
    disclosure: geoIpDisclosure(input.consentRequired === true),
    nextAction: input.placeChanged ? input.state.nextAction : nextActionFor(reason, input.consentRequired === true),
    state: input.state,
    request: { sent, url: sent ? input.url ?? null : null, method: sent ? 'GET' : null },
  };
}

async function readBounded(response: GeoIpFetchResponse, max: number): Promise<string | null> {
  const declared = Number(response.headers?.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > max) return null;
  const reader = response.body?.getReader?.();
  if (!reader) {
    const text = await response.text();
    return text.length <= max ? text : null;
  }
  const decoder = new TextDecoder();
  let size = 0;
  let combined = '';
  while (true) {
    const step = await reader.read();
    if (step.done) break;
    size += step.value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    combined += decoder.decode(step.value, { stream: true });
  }
  combined += decoder.decode();
  return combined.length <= max ? combined : null;
}

function applyHint(
  state: PlaceState,
  hint: ApproximateGeoHint,
  resolver: GeoIpPlaceResolver | null | undefined,
  requestId: string,
): { state: PlaceState; reason: GeoIpReason; placeChanged: boolean } {
  if (!resolver) return { state, reason: 'approximate', placeChanged: false };
  let resolved: ResolvedGeoPlace | null = null;
  try {
    resolved = resolver(hint);
  } catch {
    resolved = null;
  }
  if (!resolved) return { state, reason: 'no-stable-place', placeChanged: false };
  if (!levelAllowed(hint.precision, resolved.level)) {
    return {
      state,
      reason: hint.precision === 'country' ? 'country-only' : 'precision-mismatch',
      placeChanged: false,
    };
  }
  const place = canonicalizePlaceId(resolved.placeId);
  if (!place.ok) return { state, reason: 'invalid-place', placeChanged: false };
  const request = requestSuggestion(state, { requestId, kind: 'geoip' });
  if (!request.pending.some((item) => item.requestId === requestId)) {
    return { state: request, reason: 'invalid-request', placeChanged: false };
  }
  const suggestion: SuggestionResponse = {
    requestId,
    kind: 'geoip',
    placeId: place.placeId,
    label: cleanLabel(resolved.label),
    level: resolved.level,
    precision: hint.precision === 'country' ? 'country' : 'approximate',
    countryOnly: hint.precision === 'country',
    uncertainty: hint.uncertainty,
  };
  const next = receiveSuggestion(request, suggestion);
  const changed = next.origin === 'suggestion' && next.placeId === place.placeId;
  return { state: next, reason: changed ? 'applied' : 'no-stable-place', placeChanged: changed };
}

export interface GeoIpClient {
  suggest(input: SuggestApproximateLocationInput): Promise<GeoIpOutcome>;
  setOptOut(optedOut: boolean): boolean;
  optedOut(): boolean;
  disclosure(consentRequired?: boolean): GeoIpDisclosure;
  provider: GeoIpProvider;
}

export interface GeoIpClientOptions {
  provider?: GeoIpProvider;
  local?: KeyValueStorage | null;
  session?: KeyValueStorage | null;
  fetchImpl?: GeoIpFetch | null;
  useBrowserStorage?: boolean;
}

function defaultFetch(url: string, init: GeoIpFetchInit): Promise<GeoIpFetchResponse> {
  return globalThis.fetch(url, init) as Promise<GeoIpFetchResponse>;
}

export function createGeoIpClient(options: GeoIpClientOptions = {}): GeoIpClient {
  const provider = options.provider ?? countryIsProvider;
  const gate: ClientGate = { pending: false, memoryOptOut: false };
  const local = options.local ?? (options.useBrowserStorage === false ? null : browserStorage('local'));
  const session = options.session ?? (options.useBrowserStorage === false ? null : browserStorage('session'));
  const clientFetch = options.fetchImpl;

  function suggest(input: SuggestApproximateLocationInput): Promise<GeoIpOutcome> {
    const consentRequired = input.consentRequired === true;
    const state = currentState(input.state);
    const base = {
      providerId: provider.id,
      state,
      consentRequired,
    };
    const refusal = refusalForAttached(input.attached);
    if (refusal) return Promise.resolve(outcome({ ...base, reason: refusal }));
    if (!local || !session || !canUseStorage(local) || !canUseStorage(session)) {
      return Promise.resolve(outcome({ ...base, reason: 'storage-unavailable' }));
    }
    if (gate.memoryOptOut) return Promise.resolve(outcome({ ...base, reason: 'opt-out' }));
    const opt = readGeoIpOptOut(local);
    if (opt === 'unreadable') return Promise.resolve(outcome({ ...base, reason: 'opt-out-unreadable' }));
    if (opt === 'out') return Promise.resolve(outcome({ ...base, reason: 'opt-out' }));
    if (consentRequired && input.consented !== true) {
      return Promise.resolve(outcome({ ...base, reason: 'consent-required' }));
    }
    const blocked = blockedReason(state);
    if (blocked) return Promise.resolve(outcome({ ...base, reason: blocked }));
    if (gate.pending) return Promise.resolve(outcome({ ...base, reason: 'session-bound' }));
    const used = sessionUsed(session);
    if (used === 'unreadable') return Promise.resolve(outcome({ ...base, reason: 'storage-unavailable' }));
    if (used === 'used') return Promise.resolve(outcome({ ...base, reason: 'session-bound' }));
    const requestId = input.requestId?.trim() || 'geoip-1';
    if (!requestId || requestId.length > 80 || /[\u0000-\u001F\u007F]/.test(requestId)) {
      return Promise.resolve(outcome({ ...base, reason: 'invalid-request' }));
    }
    const built = buildGeoIpRequest(provider, input.attached);
    if (!built.ok) return Promise.resolve(outcome({ ...base, reason: built.reason }));
    const fetchImpl = input.fetchImpl === undefined ? clientFetch ?? defaultFetch : input.fetchImpl;
    if (!fetchImpl) return Promise.resolve(outcome({ ...base, reason: 'fetch-unavailable' }));

    gate.pending = true;
    if (!markSession(session)) {
      gate.pending = false;
      return Promise.resolve(outcome({ ...base, reason: 'storage-unavailable' }));
    }
    return runRequest(fetchImpl, built.url, provider, input, requestId, local, gate, consentRequired);
  }

  return {
    suggest,
    setOptOut: (optedOut) => {
      gate.memoryOptOut = optedOut;
      if (!local) return false;
      const wrote = setGeoIpOptOut(local, optedOut);
      if (!wrote && optedOut) gate.memoryOptOut = true;
      if (!optedOut) gate.memoryOptOut = false;
      return wrote;
    },
    optedOut: () => gate.memoryOptOut || (local ? readGeoIpOptOut(local) === 'out' : false),
    disclosure: (consentRequired = false) => geoIpDisclosure(consentRequired),
    provider,
  };
}

async function runRequest(
  fetchImpl: GeoIpFetch,
  url: string,
  provider: GeoIpProvider,
  input: SuggestApproximateLocationInput,
  requestId: string,
  local: KeyValueStorage,
  gate: ClientGate,
  consentRequired: boolean,
): Promise<GeoIpOutcome> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let aborted = false;
  const init: GeoIpFetchInit = {
    method: 'GET',
    credentials: 'omit',
    cache: 'no-store',
    redirect: 'error',
    referrerPolicy: 'no-referrer',
    mode: 'cors',
    headers: { Accept: 'application/json' },
    signal: controller.signal,
  };
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      aborted = true;
      controller.abort();
      const error = new Error('timeout');
      error.name = 'TimeoutError';
      reject(error);
    }, provider.timeoutMs);
  });
  try {
    const response = await Promise.race([fetchImpl(url, init), timeout]);
    const latest = currentState(input.state);
    if (gate.memoryOptOut || readGeoIpOptOut(local) !== 'in') {
      return outcome({
        reason: 'discarded-after-opt-out',
        providerId: provider.id,
        state: latest,
        requestsSent: 1,
        url,
        consentRequired,
      });
    }
    const late = blockedReason(latest);
    if (late === 'explicit-choice') {
      return outcome({
        reason: 'late-explicit-choice',
        providerId: provider.id,
        state: latest,
        requestsSent: 1,
        url,
        consentRequired,
      });
    }
    if (!response.ok) {
      return outcome({
        reason: 'http-error',
        providerId: provider.id,
        state: latest,
        requestsSent: 1,
        url,
        consentRequired,
      });
    }
    const text = await readBounded(response, provider.maxResponseBytes);
    if (text === null) {
      return outcome({
        reason: 'oversize',
        providerId: provider.id,
        state: latest,
        requestsSent: 1,
        url,
        consentRequired,
      });
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return outcome({
        reason: 'unreadable-body',
        providerId: provider.id,
        state: latest,
        requestsSent: 1,
        url,
        consentRequired,
      });
    }
    let raw: ApproximateGeoHint | null = null;
    try {
      raw = provider.parse(parsed);
    } catch {
      raw = null;
    }
    const hint = raw ? sealGeoIpHint(raw) : null;
    if (!hint) {
      return outcome({
        reason: 'unusable-response',
        providerId: provider.id,
        state: latest,
        requestsSent: 1,
        url,
        consentRequired,
      });
    }
    const applied = applyHint(latest, hint, input.resolver, requestId);
    return outcome({
      reason: applied.reason,
      providerId: provider.id,
      state: applied.state,
      hint,
      requestsSent: 1,
      url,
      consentRequired,
      placeChanged: applied.placeChanged,
    });
  } catch (error) {
    const timedOut = aborted || (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError'));
    return outcome({
      reason: timedOut ? 'timeout' : 'network',
      providerId: provider.id,
      state: currentState(input.state),
      requestsSent: 1,
      url,
      consentRequired,
    });
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    gate.pending = false;
  }
}

export function createDefaultGeoIpClient(): GeoIpClient {
  return createGeoIpClient({ provider: countryIsProvider, useBrowserStorage: true });
}

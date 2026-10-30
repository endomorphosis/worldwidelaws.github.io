import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  GEOIP_COPY,
  GEOIP_DECISION_SCHEMA,
  GEOIP_HINT_SCHEMA,
  GEOIP_OPT_OUT_KEY,
  GEOIP_OPT_OUT_SCHEMA,
  GEOIP_OUTCOME_SCHEMA,
  GEOIP_SESSION_KEY,
  GEOIP_SESSION_SCHEMA,
  SELECTED_GEOIP,
  buildGeoIpRequest,
  countryIsProvider,
  createGeoIpClient,
  endpointIsSendable,
  memoryStorage,
  parseCountryIsBody,
  sealGeoIpHint,
  setGeoIpOptOut,
  type ApproximateGeoHint,
  type GeoIpFetch,
  type GeoIpFetchInit,
  type GeoIpFetchResponse,
  type GeoIpProvider,
} from '../../src/lib/worldwide/location/geoip';
import {
  createPlaceState,
  SAVED_PLACE_SCHEMA,
  selectPlace,
} from '../../src/lib/worldwide/location/state';

const DECISION_PATH = join(process.cwd(), 'docs/worldwide/geoip-provider-decision.json');
const SOURCE_PATH = join(process.cwd(), 'src/lib/worldwide/location/geoip.ts');
const SECRET_IP = '203.0.113.10';
const SECRET_CITY = 'SecretCity';
const SECRET_POSTAL = '1012AB';
const SEARCH = 'sentinel-search-text-9f3a';
const NL = 'place:netherlands';
const AMSTERDAM = 'place:amsterdam';

function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): GeoIpFetchResponse {
  const encoded = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    text: async () => encoded,
  };
}

function countryBody(extra: Record<string, unknown> = {}) {
  return {
    country: 'nl',
    ip: SECRET_IP,
    city: SECRET_CITY,
    latitude: 52.12,
    longitude: 4.34,
    postal: SECRET_POSTAL,
    location: { latitude: 52.12, longitude: 4.34 },
    ...extra,
  };
}

function harness(fetchImpl?: GeoIpFetch, provider?: GeoIpProvider) {
  const local = memoryStorage();
  const session = memoryStorage();
  const calls: { url: string; init: GeoIpFetchInit }[] = [];
  const client = createGeoIpClient({
    provider,
    local,
    session,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return fetchImpl ? fetchImpl(url, init) : jsonResponse(countryBody());
    },
  });
  return { client, local, session, calls };
}

function savedAmsterdam() {
  return createPlaceState({
    saved: {
      schema: SAVED_PLACE_SCHEMA,
      placeId: AMSTERDAM,
      label: 'Amsterdam',
      asOf: null,
      scope: 'place',
      savedAt: '2026-10-26T12:00:00Z',
    },
  });
}

describe('GeoIP provider decision', () => {
  const decision = JSON.parse(readFileSync(DECISION_PATH, 'utf8')) as {
    schema: string;
    task_id: string;
    probe_origin: string;
    pages_origins: string[];
    architecture: { pages_can_read_visitor_ip: boolean };
    selection: {
      provider_id: string;
      requires_secret: boolean;
      method: string;
      url: string;
      timeout_ms: number;
      max_response_bytes: number;
      max_requests_per_session: number;
      retries: number;
      precision: string;
      sends_search_text: boolean;
      sends_address: boolean;
      sends_coordinates: boolean;
      retains_ip: boolean;
      retains_coordinates: boolean;
      referrer_policy: string;
      credentials: string;
      query_string: boolean;
      fields_parameter: boolean;
    };
    runtime_policy: {
      manual_fallback_always_available: boolean;
      country_code_is_place_id: boolean;
      country_only_selects_city: boolean;
      opt_out_stores_location: boolean;
      consent_offer_label: string;
    };
    selected_evidence: {
      cors: { origins_probed: string[]; access_control_allow_origin: string; readable_from_pages: boolean };
      quota: { per: string; fits_one_session_request: boolean };
      precision: { level: string };
      retention: { provider_logs_requests: boolean; client_keeps_ip: boolean; client_keeps_coordinates: boolean };
    };
    candidates: Array<{
      id: string;
      selected: boolean;
      requires_secret: boolean;
      terms: { summary: string };
      cors: { readable_from_pages: boolean };
      quota: { summary: string; per: string; fits_one_session_request: boolean };
      precision: { level: string; summary: string };
      retention: { provider_summary: string; client_keeps_ip: boolean; client_keeps_coordinates: boolean };
      decision: string;
    }>;
  };

  test('records the Pages-origin check and the selected no-secret contract', () => {
    expect(decision.schema).toBe(GEOIP_DECISION_SCHEMA);
    expect(decision.task_id).toBe('WWL-032');
    expect(decision.architecture.pages_can_read_visitor_ip).toBe(false);
    expect(decision.probe_origin).toBe('https://worldwidelaws.github.io');
    expect(decision.pages_origins).toEqual([...SELECTED_GEOIP.pagesOrigins]);
    expect(decision.selection).toMatchObject({
      provider_id: SELECTED_GEOIP.providerId,
      requires_secret: false,
      method: 'GET',
      url: SELECTED_GEOIP.url,
      timeout_ms: SELECTED_GEOIP.timeoutMs,
      max_response_bytes: SELECTED_GEOIP.maxResponseBytes,
      max_requests_per_session: 1,
      retries: 0,
      precision: 'country',
      sends_search_text: false,
      sends_address: false,
      sends_coordinates: false,
      retains_ip: false,
      retains_coordinates: false,
      referrer_policy: 'no-referrer',
      credentials: 'omit',
      query_string: false,
      fields_parameter: false,
    });
    expect(decision.selected_evidence.cors.origins_probed).toEqual([...SELECTED_GEOIP.pagesOrigins]);
    expect(decision.selected_evidence.cors.access_control_allow_origin).toBe('*');
    expect(decision.selected_evidence.cors.readable_from_pages).toBe(true);
    expect(decision.selected_evidence.quota.per).toBe('visitor-ip');
    expect(decision.selected_evidence.quota.fits_one_session_request).toBe(true);
    expect(decision.selected_evidence.precision.level).toBe('country');
    expect(decision.selected_evidence.retention.provider_logs_requests).toBe(false);
    expect(decision.selected_evidence.retention.client_keeps_ip).toBe(false);
    expect(decision.selected_evidence.retention.client_keeps_coordinates).toBe(false);
    expect(decision.runtime_policy.manual_fallback_always_available).toBe(true);
    expect(decision.runtime_policy.country_code_is_place_id).toBe(false);
    expect(decision.runtime_policy.country_only_selects_city).toBe(false);
    expect(decision.runtime_policy.opt_out_stores_location).toBe(false);
    expect(decision.runtime_policy.consent_offer_label).toBe(GEOIP_COPY.suggestLabel);
    expect(JSON.stringify(decision)).not.toMatch(/\b(?:\d{1,3}\.){3}\d{1,3}\b/);
  });

  test('checks terms, CORS, quota, precision, and retention for every candidate', () => {
    const selected = decision.candidates.filter((candidate) => candidate.selected);
    expect(selected.map((candidate) => candidate.id)).toEqual(['country.is']);
    expect(selected[0]?.requires_secret).toBe(false);
    for (const candidate of decision.candidates) {
      expect(candidate.terms.summary.length).toBeGreaterThan(20);
      expect(candidate.quota.summary.length).toBeGreaterThan(8);
      expect(candidate.precision.summary.length).toBeGreaterThan(8);
      expect(candidate.retention.provider_summary.length).toBeGreaterThan(8);
      expect(candidate.retention.client_keeps_ip).toBe(false);
      expect(candidate.retention.client_keeps_coordinates).toBe(false);
      expect(typeof candidate.cors.readable_from_pages).toBe('boolean');
      expect(candidate.decision.length).toBeGreaterThan(20);
    }
    const shared = decision.candidates.find((candidate) => candidate.id === 'ipwho.is');
    expect(shared?.quota.per).toBe('pages-domain');
    expect(shared?.quota.fits_one_session_request).toBe(false);
    const httpOnly = decision.candidates.find((candidate) => candidate.id === 'ip-api.com');
    expect(httpOnly?.cors.readable_from_pages).toBe(false);
    const token = decision.candidates.find((candidate) => candidate.id === 'ipinfo.io');
    expect(token?.requires_secret).toBe(true);
    expect(token?.selected).toBe(false);
  });
});

describe('country.is response', () => {
  test('keeps a country code and drops ip, city, postal, and coordinates', () => {
    const hint = parseCountryIsBody(countryBody());
    expect(hint?.schema).toBe(GEOIP_HINT_SCHEMA);
    expect(hint?.providerId).toBe('country.is');
    expect(hint?.precision).toBe('country');
    expect(hint?.countryCode).toBe('NL');
    expect(hint?.regionLabel).toBeNull();
    expect(hint?.localityLabel).toBeNull();
    expect(hint?.uncertainty.join(' ')).toContain('VPN');
    expect(hint?.attribution).toContain('MaxMind');
    const encoded = JSON.stringify(hint);
    expect(encoded).not.toContain(SECRET_IP);
    expect(encoded).not.toContain(SECRET_CITY);
    expect(encoded).not.toContain(SECRET_POSTAL);
    expect(encoded).not.toContain('52.12');
    expect(encoded).not.toContain('latitude');
    expect(encoded).not.toContain('"ip"');
  });

  test('rejects a body that is not a two-letter country', () => {
    expect(parseCountryIsBody(null)).toBeNull();
    expect(parseCountryIsBody([])).toBeNull();
    expect(parseCountryIsBody({ ip: SECRET_IP })).toBeNull();
    expect(parseCountryIsBody({ country: 'NLD' })).toBeNull();
    expect(parseCountryIsBody({ country: 'Netherlands' })).toBeNull();
    expect(parseCountryIsBody('NL')).toBeNull();
  });

  test('strips a city from a country-precision hint', () => {
    const sealed = sealGeoIpHint({
      schema: GEOIP_HINT_SCHEMA,
      providerId: 'country.is',
      precision: 'country',
      countryCode: 'nl',
      regionLabel: 'North Holland',
      localityLabel: SECRET_CITY,
      uncertainty: [`near ${SECRET_IP}`],
      attribution: GEOIP_COPY.attribution,
    });
    expect(sealed?.countryCode).toBe('NL');
    expect(sealed?.regionLabel).toBeNull();
    expect(sealed?.localityLabel).toBeNull();
    expect(sealed?.uncertainty).toEqual([]);
  });
});

describe('request builder', () => {
  test('builds one queryless GET and refuses search text, addresses, and coordinates', () => {
    const built = buildGeoIpRequest(countryIsProvider);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.url).toBe('https://api.country.is/');
    expect(built.url.includes('?')).toBe(false);
    expect(built.url.includes('fields=')).toBe(false);
    expect(built.init).toEqual({
      method: 'GET',
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      mode: 'cors',
      headers: { Accept: 'application/json' },
    });
    expect(JSON.stringify(built)).not.toContain(SEARCH);

    for (const attached of [
      { searchText: SEARCH },
      { address: 'Damrak 1' },
      { coordinates: { latitude: 52.37, longitude: 4.89 } },
      { coordinates: {} },
    ]) {
      const refused = buildGeoIpRequest(countryIsProvider, attached);
      expect(refused.ok).toBe(false);
      if (refused.ok) return;
      expect(JSON.stringify(refused)).not.toContain(SEARCH);
      expect(JSON.stringify(refused)).not.toContain('Damrak');
    }
    const blank = buildGeoIpRequest(countryIsProvider, { searchText: '  ', address: '', coordinates: null });
    expect(blank.ok).toBe(true);
  });

  test('rejects secrets, queries, and mixed-content endpoints', () => {
    expect(endpointIsSendable('http://api.country.is/', 2500, 2048)).toBe(false);
    expect(endpointIsSendable('https://api.country.is/?q=parking', 2500, 2048)).toBe(false);
    expect(endpointIsSendable('https://user:pass@api.country.is/', 2500, 2048)).toBe(false);
    expect(endpointIsSendable('https://api.country.is/#place', 2500, 2048)).toBe(false);
    expect(endpointIsSendable('https://api.country.is/', 10, 2048)).toBe(false);
    expect(endpointIsSendable('https://api.country.is/', 2500, 20)).toBe(false);
    const secret = buildGeoIpRequest({ ...countryIsProvider, requiresSecret: true as false });
    expect(secret.ok).toBe(false);
  });

  test('the module does not assemble a query string or an Authorization header', () => {
    const source = readFileSync(SOURCE_PATH, 'utf8');
    expect(source).not.toContain('Authorization');
    expect(source).not.toContain('URLSearchParams');
    expect(source).not.toContain('searchParams');
    expect(source).toContain("referrerPolicy: 'no-referrer'");
    expect(source).toContain('https://api.country.is/');
  });
});

describe('approximate suggestion', () => {
  test('sends one bounded request and leaves manual search complete', async () => {
    const { client, calls, local, session } = harness();
    const state = createPlaceState({ href: '/#/search?q=parking&lat=52.37&lon=4.89' });
    const outcome = await client.suggest({ state });
    expect(outcome.schema).toBe(GEOIP_OUTCOME_SCHEMA);
    expect(outcome.status).toBe('approximate');
    expect(outcome.manualFallback).toBe(true);
    expect(outcome.searchTextSent).toBe(false);
    expect(outcome.requestsSent).toBe(1);
    expect(outcome.placeChanged).toBe(false);
    expect(outcome.state.placeId).toBeNull();
    expect(outcome.state.origin).toBe('unselected');
    expect(outcome.state.route.query).toBe('parking');
    expect(outcome.state.sessionCoordinates).toEqual({ latitude: 52.37, longitude: 4.89, address: null });
    expect(outcome.hint?.countryCode).toBe('NL');
    expect(outcome.hint?.localityLabel).toBeNull();
    expect(outcome.nextAction).toContain('Choose');
    expect(outcome.disclosure.requestIncludesSearchText).toBe(false);
    expect(outcome.disclosure.thirdParty).toBe('api.country.is');
    expect(outcome.disclosure.optOutLabel).toBe(GEOIP_COPY.optOutLabel);
    expect(outcome.disclosure.manualLabel).toBe(GEOIP_COPY.manualLabel);
    expect(outcome.disclosure.explanation).toContain('does not include your search');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://api.country.is/');
    expect(calls[0]?.url).not.toContain('parking');
    expect(calls[0]?.url).not.toContain('52.37');
    expect(calls[0]?.init.method).toBe('GET');
    expect(calls[0]?.init.credentials).toBe('omit');
    expect(calls[0]?.init.cache).toBe('no-store');
    expect(calls[0]?.init.redirect).toBe('error');
    expect(calls[0]?.init.referrerPolicy).toBe('no-referrer');
    expect(calls[0]?.init.mode).toBe('cors');
    expect(calls[0]?.init.headers).toEqual({ Accept: 'application/json' });
    expect('body' in (calls[0]?.init ?? {})).toBe(false);
    const stored = `${local.getItem(GEOIP_OPT_OUT_KEY) ?? ''}${session.getItem(GEOIP_SESSION_KEY) ?? ''}`;
    expect(stored).not.toContain(SECRET_IP);
    expect(stored).not.toContain('parking');
    expect(stored).not.toContain('NL');
    expect(JSON.parse(session.getItem(GEOIP_SESSION_KEY) ?? '{}')).toEqual({
      schema: GEOIP_SESSION_SCHEMA,
      requests: 1,
    });

    const again = await client.suggest({ state: createPlaceState() });
    expect(again.requestsSent).toBe(0);
    expect(again.reason).toBe('session-bound');
    expect(again.manualFallback).toBe(true);
    expect(calls).toHaveLength(1);
  });

  test('does not send a second request while the first is open', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { client, calls } = harness(async () => {
      await gate;
      return jsonResponse(countryBody());
    });
    const first = client.suggest({ state: createPlaceState() });
    const second = await client.suggest({ state: createPlaceState() });
    expect(second.requestsSent).toBe(0);
    expect(second.reason).toBe('session-bound');
    release?.();
    const done = await first;
    expect(done.requestsSent).toBe(1);
    expect(calls).toHaveLength(1);
  });

  test('refuses to send search text and still offers manual search', async () => {
    const { client, calls } = harness();
    const outcome = await client.suggest({
      state: createPlaceState(),
      attached: { searchText: SEARCH },
    });
    expect(outcome.status).toBe('refused');
    expect(outcome.reason).toBe('search-text-not-sent');
    expect(outcome.requestsSent).toBe(0);
    expect(outcome.request.url).toBeNull();
    expect(outcome.manualFallback).toBe(true);
    expect(outcome.hint).toBeNull();
    expect(outcome.state.placeId).toBeNull();
    expect(JSON.stringify(outcome)).not.toContain(SEARCH);
    expect(calls).toHaveLength(0);
  });

  test('opts out immediately and persists that choice without a location', async () => {
    const { client, local, calls } = harness();
    expect(client.setOptOut(true)).toBe(true);
    expect(client.optedOut()).toBe(true);
    const stored = local.getItem(GEOIP_OPT_OUT_KEY);
    expect(JSON.parse(stored ?? '{}')).toEqual({ schema: GEOIP_OPT_OUT_SCHEMA, optedOut: true });
    expect(stored).not.toContain(SECRET_IP);
    const blocked = await client.suggest({ state: createPlaceState() });
    expect(blocked.status).toBe('opted-out');
    expect(blocked.requestsSent).toBe(0);
    expect(blocked.manualFallback).toBe(true);
    expect(blocked.nextAction).toContain('Choose a place');
    expect(calls).toHaveLength(0);

    expect(client.setOptOut(false)).toBe(true);
    expect(local.getItem(GEOIP_OPT_OUT_KEY)).toBeNull();
    expect(calls).toHaveLength(0);
    const allowed = await client.suggest({ state: createPlaceState() });
    expect(allowed.requestsSent).toBe(1);
    expect(calls).toHaveLength(1);
  });

  test('discards an in-flight response after opt-out', async () => {
    const { client, calls } = harness(async () => {
      client.setOptOut(true);
      return jsonResponse(countryBody());
    });
    const outcome = await client.suggest({ state: createPlaceState() });
    expect(outcome.status).toBe('opted-out');
    expect(outcome.reason).toBe('discarded-after-opt-out');
    expect(outcome.requestsSent).toBe(1);
    expect(outcome.hint).toBeNull();
    expect(outcome.placeChanged).toBe(false);
    expect(JSON.stringify(outcome)).not.toContain(SECRET_IP);
    expect(calls).toHaveLength(1);
  });

  test('waits for an explicit suggestion when consent is required', async () => {
    const { client, calls } = harness();
    const offered = await client.suggest({ state: createPlaceState(), consentRequired: true });
    expect(offered.status).toBe('offered');
    expect(offered.reason).toBe('consent-required');
    expect(offered.requestsSent).toBe(0);
    expect(offered.disclosure.suggestLabel).toBe('Suggest my approximate location');
    expect(offered.disclosure.explanation).toContain('Suggest my approximate location');
    expect(offered.manualFallback).toBe(true);
    expect(calls).toHaveLength(0);

    const accepted = await client.suggest({
      state: createPlaceState(),
      consentRequired: true,
      consented: true,
    });
    expect(accepted.requestsSent).toBe(1);
    expect(accepted.hint?.countryCode).toBe('NL');
    expect(calls).toHaveLength(1);
  });

  test('does not call the provider when a place is already chosen', async () => {
    const { client, calls } = harness();
    const urlState = createPlaceState({ href: '/#/search?q=parking&place=place%3Aamsterdam' });
    const fromUrl = await client.suggest({ state: urlState });
    expect(fromUrl.reason).toBe('explicit-choice');
    expect(fromUrl.state.placeId).toBe(AMSTERDAM);
    expect(fromUrl.state.route.query).toBe('parking');
    const fromSaved = await client.suggest({ state: savedAmsterdam() });
    expect(fromSaved.reason).toBe('explicit-choice');
    expect(fromSaved.state.origin).toBe('saved');
    const manual = selectPlace(createPlaceState(), { placeId: AMSTERDAM, label: 'Amsterdam' });
    const fromManual = await client.suggest({ state: manual });
    expect(fromManual.reason).toBe('explicit-choice');
    expect(calls).toHaveLength(0);
  });

  test('a late manual choice beats the provider response', async () => {
    let current = createPlaceState();
    const { client } = harness(async () => {
      current = selectPlace(current, { placeId: AMSTERDAM, label: 'Amsterdam' });
      return jsonResponse(countryBody());
    });
    const outcome = await client.suggest({
      state: () => current,
      resolver: () => ({ placeId: NL, label: 'Netherlands', level: 'country' }),
    });
    expect(outcome.reason).toBe('late-explicit-choice');
    expect(outcome.placeChanged).toBe(false);
    expect(outcome.state.placeId).toBe(AMSTERDAM);
    expect(outcome.state.origin).toBe('manual');
    expect(outcome.hint).toBeNull();
  });

  test('applies a resolved country and does not apply a city or a country code', async () => {
    const { client, calls } = harness();
    const start = createPlaceState({ href: '/#/search?q=parking' });
    const applied = await client.suggest({
      state: start,
      resolver: () => ({ placeId: NL, label: 'Netherlands', level: 'country' }),
    });
    expect(applied.status).toBe('applied');
    expect(applied.placeChanged).toBe(true);
    expect(applied.state.placeId).toBe(NL);
    expect(applied.state.origin).toBe('suggestion');
    expect(applied.state.channel).toBe('geoip');
    expect(applied.state.originLabel).toBe('approximate IP location');
    expect(applied.state.sessionCoordinates).toBeNull();
    expect(applied.state.route.query).toBe('parking');
    expect(applied.state.uncertainty.join(' ')).toContain('No city was selected');
    expect(JSON.stringify(applied.state.sessionCoordinates)).not.toContain(SECRET_IP);
    expect(calls[0]?.url).not.toContain('parking');

    const { client: cityClient } = harness();
    const city = await cityClient.suggest({
      state: createPlaceState(),
      resolver: () => ({ placeId: AMSTERDAM, label: 'Amsterdam', level: 'city' }),
    });
    expect(city.status).toBe('approximate');
    expect(city.reason).toBe('country-only');
    expect(city.placeChanged).toBe(false);
    expect(city.state.placeId).toBeNull();
    expect(city.state.suggestionSettled).toBe(false);
    expect(city.hint?.countryCode).toBe('NL');
    expect(city.manualFallback).toBe(true);

    const { client: codeClient } = harness();
    const code = await codeClient.suggest({
      state: createPlaceState(),
      resolver: () => ({ placeId: 'NL', label: 'Netherlands', level: 'country' }),
    });
    expect(code.reason).toBe('invalid-place');
    expect(code.state.placeId).toBeNull();
    expect(code.state.suggestionSettled).toBe(false);
  });

  test('a replacement provider is called instead of the selected endpoint', async () => {
    const replacement: GeoIpProvider = {
      ...countryIsProvider,
      id: 'example.test',
      url: 'https://example.test/geo',
      parse: (body) => {
        const country = typeof body === 'object' && body && 'cc' in body ? String((body as { cc: unknown }).cc) : '';
        return sealGeoIpHint({
          schema: GEOIP_HINT_SCHEMA,
          providerId: 'example.test',
          precision: 'country',
          countryCode: country,
          regionLabel: null,
          localityLabel: SECRET_CITY,
          uncertainty: ['Approximate country from the network address. A VPN, mobile network, or carrier address can make this wrong.'],
          attribution: 'Example provider',
        });
      },
    };
    const { client, calls } = harness(async () => jsonResponse({ cc: 'fr', ip: SECRET_IP }), replacement);
    const outcome = await client.suggest({ state: createPlaceState() });
    expect(calls.map((call) => call.url)).toEqual(['https://example.test/geo']);
    expect(outcome.providerId).toBe('example.test');
    expect(outcome.hint?.countryCode).toBe('FR');
    expect(outcome.hint?.localityLabel).toBeNull();
    expect(JSON.stringify(outcome.hint)).not.toContain(SECRET_IP);
    expect(JSON.stringify(outcome.hint)).not.toContain(SECRET_CITY);
  });

  test('failures, coarse bodies, and storage problems keep manual search', async () => {
    const cases: Array<{ name: string; fetchImpl: GeoIpFetch; reason: string }> = [
      {
        name: 'http',
        fetchImpl: async () => jsonResponse({ country: 'NL' }, 429),
        reason: 'http-error',
      },
      {
        name: 'oversize',
        fetchImpl: async () => jsonResponse({ country: 'NL' }, 200, { 'content-length': '9000' }),
        reason: 'oversize',
      },
      {
        name: 'unreadable',
        fetchImpl: async () => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => 'not-json' }),
        reason: 'unreadable-body',
      },
      {
        name: 'empty',
        fetchImpl: async () => jsonResponse({}),
        reason: 'unusable-response',
      },
    ];
    for (const entry of cases) {
      const { client } = harness(entry.fetchImpl);
      const state = createPlaceState({ href: '/#/search?q=parking' });
      const outcome = await client.suggest({ state });
      expect(outcome.reason).toBe(entry.reason);
      expect(outcome.status).toBe('manual');
      expect(outcome.manualFallback).toBe(true);
      expect(outcome.placeChanged).toBe(false);
      expect(outcome.state.placeId).toBeNull();
      expect(outcome.state.route.query).toBe('parking');
      expect(outcome.hint).toBeNull();
      expect(outcome.nextAction.length).toBeGreaterThan(0);
    }
  });

  test('a timeout does not retry and does not change the place', async () => {
    const provider: GeoIpProvider = { ...countryIsProvider, timeoutMs: 500 };
    const { client, calls } = harness(
      (_url, init) => new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      }),
      provider,
    );
    const outcome = await client.suggest({ state: createPlaceState({ href: '/#/search?q=parking' }) });
    expect(outcome.reason).toBe('timeout');
    expect(outcome.requestsSent).toBe(1);
    expect(outcome.manualFallback).toBe(true);
    expect(outcome.state.route.query).toBe('parking');
    expect(outcome.state.placeId).toBeNull();
    const second = await client.suggest({ state: createPlaceState() });
    expect(second.requestsSent).toBe(0);
    expect(calls).toHaveLength(1);
  });

  test('unreadable opt-out storage fails closed', async () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    const client = createGeoIpClient({
      local: broken,
      session: memoryStorage(),
      fetchImpl: async () => jsonResponse(countryBody()),
    });
    const outcome = await client.suggest({ state: createPlaceState() });
    expect(outcome.reason).toBe('storage-unavailable');
    expect(outcome.requestsSent).toBe(0);
    expect(outcome.manualFallback).toBe(true);
  });

  test('a corrupt opt-out record blocks the request', async () => {
    const { client, local, calls } = harness();
    local.setItem(GEOIP_OPT_OUT_KEY, '{');
    const outcome = await client.suggest({ state: createPlaceState() });
    expect(outcome.status).toBe('opted-out');
    expect(outcome.reason).toBe('opt-out-unreadable');
    expect(calls).toHaveLength(0);
  });

  test('uses the browser stores without writing the suggestion', async () => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    const calls: string[] = [];
    const client = createGeoIpClient({
      fetchImpl: async (url) => {
        calls.push(url);
        return jsonResponse(countryBody());
      },
    });
    const outcome = await client.suggest({ state: createPlaceState() });
    expect(outcome.hint?.countryCode).toBe('NL');
    expect(calls).toEqual(['https://api.country.is/']);
    const saved = `${window.localStorage.getItem(GEOIP_OPT_OUT_KEY) ?? ''}${window.sessionStorage.getItem(GEOIP_SESSION_KEY) ?? ''}`;
    expect(saved).not.toContain(SECRET_IP);
    expect(saved).toContain(GEOIP_SESSION_SCHEMA);
    expect(setGeoIpOptOut(window.localStorage, true)).toBe(true);
    const opted = await client.suggest({ state: createPlaceState() });
    expect(opted.status).toBe('opted-out');
    expect(calls).toHaveLength(1);
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
});

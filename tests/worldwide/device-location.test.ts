/**
 * Optional device location and privacy controls.
 *
 * The boundary pack is a synthetic fixture. A device reading is matched
 * locally and then dropped. Nothing here decides that a law applies.
 */

import { jest } from '@jest/globals';
import React, { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { admitJurisdictionGraph, type JurisdictionGraph } from '../../src/lib/worldwide/jurisdiction/schema';
import { buildPlaceIndex, type GeometryRecord, type PlaceIndex } from '../../src/lib/worldwide/jurisdiction/resolve';
import LocationPrivacy from '../../src/components/worldwide/LocationPrivacy';
import {
  DEVICE_COPY,
  DEVICE_LIMITS,
  DEVICE_OUTCOME_SCHEMA,
  DEVICE_RESOLUTION_SCHEMA,
  NO_THIRD_PARTY_KEY,
  NO_THIRD_PARTY_SCHEMA,
  createDeviceLocationClient,
  resolveDevicePoint,
  type DeviceGeolocation,
  type DeviceLocationClient,
  type DevicePosition,
  type DevicePositionError,
  type DevicePositionOptions,
  type KeyValueStorage,
  type ThirdPartyGeocoder,
} from '../../src/lib/worldwide/location/device';
import {
  GEOIP_COPY,
  createGeoIpClient,
  memoryStorage,
  type GeoIpFetchResponse,
} from '../../src/lib/worldwide/location/geoip';
import {
  SAVED_PLACE_SCHEMA,
  createPlaceState,
  receiveSuggestion,
  requestSuggestion,
  saveSelection,
  selectPlace,
  shareLink,
  type PlaceState,
} from '../../src/lib/worldwide/location/state';

const REVISION = 'b'.repeat(40);
const AS_OF = '2026-10-26';
const AMSTERDAM = { latitude: 52.3219, longitude: 4.7513 };
const COUNTRY_ONLY = { latitude: 51.2345, longitude: 4.2567 };
const OVERLAP = { latitude: 52.4011, longitude: 4.9011 };
const BORDER = { latitude: 21.2345, longitude: 21.2345 };
const NOWHERE = { latitude: 10.101, longitude: 10.202 };
const SAMPLES = ['52.3219', '4.7513', '51.2345', '4.2567', '52.4011', '4.9011', '21.2345', '10.101', '10.202', '999'];

function known(value: string) {
  return { knowledge: 'known' as const, value, precision: 'year' as const, source: 'fixture' };
}

function openEnd() {
  return { knowledge: 'open' as const, value: null, precision: null, source: 'fixture' };
}

function openValid() {
  return { start: known('1000'), end: openEnd() };
}

function boundary(boundaryId: string, extra: Record<string, unknown> = {}) {
  return {
    boundaryId,
    role: 'primary',
    geometryKnowledge: 'known',
    geometryRef: `artifact:${boundaryId}`,
    provenance: {
      sourceId: 'registry:device-location-fixture',
      sourceRevision: REVISION,
      attribution: 'Synthetic fixture geometry',
      license: 'fixture',
    },
    valid: openValid(),
    flags: [],
    ...extra,
  };
}

function place(id: string, level: string, name: string, parentKnowledge = 'none', extraBoundary?: Record<string, unknown>) {
  const slug = id.slice(id.indexOf(':') + 1);
  return {
    id,
    roles: ['place'],
    names: [{ text: name, language: 'en', script: 'Latn' }],
    aliases: [],
    level: { kind: level },
    externalIds: [],
    parentKnowledge,
    issuerKnowledge: 'none',
    issuerIds: [],
    boundaries: [boundary(`boundary:${slug}`, extraBoundary)],
    valid: openValid(),
  };
}

function edge(id: string, fromId: string, toId: string) {
  return {
    id,
    kind: 'administrative-containment',
    fromId,
    toId,
    knowledge: 'known',
    evidence: [],
    valid: openValid(),
  };
}

function ring(west: number, south: number, east: number, north: number): Array<[number, number]> {
  return [[west, south], [east, south], [east, north], [west, north], [west, south]];
}

function rect(boundaryId: string, west: number, south: number, east: number, north: number): GeometryRecord {
  return { geometryRef: `artifact:${boundaryId}`, type: 'Polygon', coordinates: [ring(west, south, east, north)] };
}

function loadGraph(): JurisdictionGraph {
  const admitted = admitJurisdictionGraph({
    graphId: 'graph:device-location-fixture',
    sourceId: 'registry:device-location-fixture',
    sourceRevision: REVISION,
    publisherId: 'publisher:fixture',
    observedAt: '2026-10',
    nodes: [
      place('place:netherlands', 'country', 'Netherlands'),
      place('place:north-holland', 'region', 'North Holland', 'known'),
      place('place:amsterdam', 'municipality', 'Amsterdam', 'known'),
      place('place:rotterdam', 'municipality', 'Rotterdam', 'known'),
      place('place:border-town', 'municipality', 'Border Town', 'none', { flags: ['border-uncertain'] }),
    ],
    edges: [
      edge('edge:north-holland', 'place:north-holland', 'place:netherlands'),
      edge('edge:amsterdam', 'place:amsterdam', 'place:north-holland'),
      edge('edge:rotterdam', 'place:rotterdam', 'place:north-holland'),
    ],
  });
  if (!admitted.graph) {
    const detail = admitted.quarantined.map((item) => `${item.reason}: ${item.detail}`).join('\n');
    throw new Error(`device location fixture was quarantined:\n${detail}`);
  }
  return admitted.graph;
}

const graph = loadGraph();
const geometries: GeometryRecord[] = [
  rect('boundary:netherlands', 4, 51, 7, 54),
  rect('boundary:north-holland', 4.5, 52.2, 5.2, 53.2),
  rect('boundary:amsterdam', 4.7, 52.3, 5, 52.5),
  rect('boundary:rotterdam', 4.85, 52.35, 5.1, 52.55),
  rect('boundary:border-town', 20, 20, 22, 22),
];
const placeIndex: PlaceIndex = buildPlaceIndex({ graph, geometries, cellDegrees: 1, borderToleranceDegrees: 0 });

function recordedStorage() {
  const values = new Map<string, string>();
  const storage: KeyValueStorage & { dump: () => string } = {
    getItem: (key) => (values.has(key) ? values.get(key) ?? null : null),
    setItem: (key, value) => {
      values.set(key, String(value));
    },
    removeItem: (key) => {
      values.delete(key);
    },
    dump: () => [...values.entries()].map(([key, value]) => `${key}=${value}`).join('\n'),
  };
  return storage;
}

function browserDump(): string {
  const chunks: string[] = [];
  for (const store of [window.localStorage, window.sessionStorage]) {
    for (let index = 0; index < store.length; index += 1) {
      const key = store.key(index);
      if (!key) continue;
      chunks.push(`${key}=${store.getItem(key) ?? ''}`);
    }
  }
  return chunks.join('\n');
}

function expectNoCoordinates(value: unknown, extra: string[] = []): void {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  for (const sample of [...SAMPLES, ...extra]) expect(text).not.toContain(sample);
  expect(text).not.toMatch(/"(?:latitude|longitude|altitude|accuracy)"/);
}

interface ScriptedGeo extends DeviceGeolocation {
  getCurrentPosition: jest.Mock;
  watchPosition: jest.Mock;
  emit: (point?: { latitude: number; longitude: number }) => void;
}

function scripted(
  kind: 'ok' | 'deny' | 'timeout' | 'unavailable' | 'invalid' | 'hang',
  point: { latitude: number; longitude: number },
): ScriptedGeo {
  let success: ((position: DevicePosition) => void) | null = null;
  const geo = {
    getCurrentPosition: jest.fn((
      ok: (position: DevicePosition) => void,
      error?: (failure: DevicePositionError) => void,
      _options?: DevicePositionOptions,
    ) => {
      success = ok;
      if (kind === 'hang') return;
      if (kind === 'ok') ok({ coords: { ...point, accuracy: 4, altitude: 3 }, timestamp: 1 });
      else if (kind === 'invalid') ok({ coords: { latitude: 999, longitude: point.longitude, accuracy: 1 }, timestamp: 1 });
      else if (kind === 'deny') error?.({ code: 1, message: `denied near ${point.latitude},${point.longitude}` });
      else if (kind === 'timeout') error?.({ code: 3, message: `timed out at ${point.latitude}` });
      else error?.({ code: 2, message: `unavailable ${point.latitude}` });
    }),
    watchPosition: jest.fn(),
    clearWatch: jest.fn(),
    emit: (next = point) => {
      success?.({ coords: { latitude: next.latitude, longitude: next.longitude, accuracy: 9, altitude: 2 }, timestamp: 2 });
    },
  };
  return geo;
}

function clientWith(storage: KeyValueStorage = recordedStorage()): DeviceLocationClient {
  return createDeviceLocationClient({ storage, useBrowserStorage: false });
}

function jsonResponse(body: unknown, status = 200): GeoIpFetchResponse {
  const encoded = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => encoded,
  };
}

function expectNeverWatched(geo: ScriptedGeo): void {
  expect(geo.watchPosition).not.toHaveBeenCalled();
  expect(geo.clearWatch).not.toHaveBeenCalled();
}

describe('local device resolution', () => {
  test('selects the municipality inside nested boundaries and drops the point', () => {
    const resolution = resolveDevicePoint(placeIndex, { ...AMSTERDAM, asOf: AS_OF });
    expect(resolution.schema).toBe(DEVICE_RESOLUTION_SCHEMA);
    expect(resolution.status).toBe('selected');
    expect(resolution.choice).toMatchObject({ placeId: 'place:amsterdam', label: 'Amsterdam', level: 'municipality' });
    expect(resolution.candidates).toEqual([]);
    expect(resolution.uncertainty.join(' ')).toContain('does not decide that a law applies');
    expect(resolution.uncertainty.join(' ')).toContain('coordinates were not saved');
    expectNoCoordinates(resolution);
  });

  test('a country match does not invent a municipality', () => {
    const resolution = resolveDevicePoint(placeIndex, { ...COUNTRY_ONLY, asOf: AS_OF });
    expect(resolution.status).toBe('selected');
    expect(resolution.choice?.placeId).toBe('place:netherlands');
    expect(resolution.choice?.level).toBe('country');
    expect(resolution.uncertainty.join(' ')).toMatch(/No municipality was added|No city/);
    expect(resolution.candidates.map((candidate) => candidate.placeId)).not.toContain('place:amsterdam');
  });

  test('overlapping municipalities and an uncertain border stay unselected', () => {
    const overlap = resolveDevicePoint(placeIndex, { ...OVERLAP, asOf: AS_OF });
    expect(overlap.status).toBe('choose');
    expect(overlap.choice).toBeNull();
    expect(overlap.candidates.map((candidate) => candidate.placeId).sort()).toEqual(['place:amsterdam', 'place:rotterdam']);

    const border = resolveDevicePoint(placeIndex, { ...BORDER, asOf: AS_OF });
    expect(border.status).toBe('choose');
    expect(border.choice).toBeNull();
    expect(border.candidates.map((candidate) => candidate.placeId)).toEqual(['place:border-town']);
    expect(border.uncertainty.join(' ')).toContain('Choose the place yourself');
  });

  test('an unmatched or unusable point does not become a place', () => {
    expect(resolveDevicePoint(placeIndex, { ...NOWHERE, asOf: AS_OF }).status).toBe('unresolved');
    expect(resolveDevicePoint(placeIndex, { latitude: 999, longitude: 4.7513, asOf: AS_OF }).status).toBe('invalid-point');
    expect(resolveDevicePoint(placeIndex, { latitude: Number.NaN, longitude: 4.7513, asOf: AS_OF }).status).toBe('invalid-point');
  });
});

describe('browser permission', () => {
  test('only an explicit user action calls getCurrentPosition', async () => {
    const geo = scripted('ok', AMSTERDAM);
    const client = clientWith();
    const idle = createPlaceState();
    const omitted = await client.request({ state: idle, asOf: AS_OF, index: placeIndex, geolocation: geo });
    const refused = await client.request({ state: idle, userAction: false, asOf: AS_OF, index: placeIndex, geolocation: geo });
    expect(omitted.reason).toBe('user-action-required');
    expect(refused.reason).toBe('user-action-required');
    expect(omitted.permissionRequested).toBe(false);
    expect(geo.getCurrentPosition).not.toHaveBeenCalled();
    expect(client.permissionRequests()).toBe(0);

    const applied = await client.request({ state: idle, userAction: true, asOf: AS_OF, index: placeIndex, geolocation: geo });
    expect(applied.schema).toBe(DEVICE_OUTCOME_SCHEMA);
    expect(applied.reason).toBe('applied');
    expect(applied.permissionRequested).toBe(true);
    expect(applied.watchRequested).toBe(false);
    expect(applied.thirdPartyRequested).toBe(false);
    expect(applied.deviceCoordinatesStored).toBe(false);
    expect(applied.state.placeId).toBe('place:amsterdam');
    expect(applied.state.channel).toBe('device');
    expect(applied.state.origin).toBe('suggestion');
    expect(applied.state.originLabel).toBe('device location');
    expect(applied.state.sessionCoordinates).toBeNull();
    expect(geo.getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(geo.getCurrentPosition.mock.calls[0]?.[2]).toEqual({
      enableHighAccuracy: true,
      timeout: DEVICE_LIMITS.timeoutMs,
      maximumAge: 0,
    });
    expectNeverWatched(geo);
    expect(shareLink(applied.state)).toContain('amsterdam');
    expect(shareLink(applied.state)).not.toMatch(/[?&](?:lat|lon|latitude|longitude)=/);
    expectNoCoordinates(applied);
  });

  test('a URL, manual, or saved place does not request permission', async () => {
    const geo = scripted('ok', OVERLAP);
    const client = clientWith();
    const saved = {
      schema: SAVED_PLACE_SCHEMA,
      placeId: 'place:amsterdam',
      label: 'Amsterdam',
      asOf: null,
      scope: 'place' as const,
      savedAt: '2026-10-30T12:00:00Z',
    };
    const cases = [
      createPlaceState({ href: '/#/search?place=place%3Arotterdam' }),
      selectPlace(createPlaceState(), { placeId: 'place:rotterdam', label: 'Rotterdam' }),
      createPlaceState({ saved }),
    ];
    for (const state of cases) {
      const outcome = await client.request({ state, userAction: true, asOf: AS_OF, index: placeIndex, geolocation: geo });
      expect(outcome.reason).toBe('explicit-choice');
      expect(outcome.permissionRequested).toBe(false);
      expect(outcome.state.placeId).toBe(state.placeId);
      expect(outcome.state.origin).toBe(state.origin);
    }
    expect(geo.getCurrentPosition).not.toHaveBeenCalled();
    expectNeverWatched(geo);
  });

  test('a missing pack, a missing date, an insecure page, or a missing API does not prompt', async () => {
    const geo = scripted('ok', AMSTERDAM);
    const client = clientWith();
    const state = createPlaceState();
    const missingPack = await client.request({ state, userAction: true, asOf: AS_OF, index: null, geolocation: geo });
    const missingDate = await client.request({ state, userAction: true, index: placeIndex, geolocation: geo });
    const missingApi = await client.request({ state, userAction: true, asOf: AS_OF, index: placeIndex, geolocation: null });
    expect(missingPack.reason).toBe('local-pack-missing');
    expect(missingDate.reason).toBe('missing-date');
    expect(missingApi.reason).toBe('geolocation-unavailable');
    expect(geo.getCurrentPosition).not.toHaveBeenCalled();

    const descriptor = Object.getOwnPropertyDescriptor(window, 'isSecureContext');
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false });
    try {
      const insecure = await client.request({ state, userAction: true, asOf: AS_OF, index: placeIndex, geolocation: geo });
      expect(insecure.reason).toBe('insecure-context');
      expect(insecure.permissionRequested).toBe(false);
    } finally {
      if (descriptor) Object.defineProperty(window, 'isSecureContext', descriptor);
      else Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
    }
    expect(geo.getCurrentPosition).not.toHaveBeenCalled();
  });

  test('denial, timeout, an unusable reading, and a late callback leave the place unchanged', async () => {
    const state = createPlaceState();
    const deniedGeo = scripted('deny', AMSTERDAM);
    const denied = await clientWith().request({ state, userAction: true, asOf: AS_OF, index: placeIndex, geolocation: deniedGeo });
    expect(denied.reason).toBe('denied');
    expect(denied.state.placeId).toBeNull();
    expect(denied.state.origin).toBe('unselected');
    expectNoCoordinates(denied, [`denied near ${AMSTERDAM.latitude}`]);
    expectNeverWatched(deniedGeo);

    const timedGeo = scripted('timeout', AMSTERDAM);
    const timed = await clientWith().request({ state, userAction: true, asOf: AS_OF, index: placeIndex, geolocation: timedGeo });
    expect(timed.reason).toBe('timeout');
    expect(timed.state.placeId).toBeNull();
    expectNoCoordinates(timed);

    const invalid = await clientWith().request({
      state,
      userAction: true,
      asOf: AS_OF,
      index: placeIndex,
      geolocation: scripted('invalid', AMSTERDAM),
    });
    expect(invalid.reason).toBe('invalid-reading');
    expect(invalid.state.placeId).toBeNull();
    expectNoCoordinates(invalid);

    const unavailable = await clientWith().request({
      state,
      userAction: true,
      asOf: AS_OF,
      index: placeIndex,
      geolocation: scripted('unavailable', AMSTERDAM),
    });
    expect(unavailable.reason).toBe('unavailable');
    expect(unavailable.state.origin).toBe('unselected');

    jest.useFakeTimers();
    try {
      const hung = scripted('hang', AMSTERDAM);
      const client = clientWith();
      const pending = client.request({ state, userAction: true, asOf: AS_OF, index: placeIndex, geolocation: hung });
      const second = await client.request({ state, userAction: true, asOf: AS_OF, index: placeIndex, geolocation: hung });
      expect(second.reason).toBe('already-open');
      expect(hung.getCurrentPosition).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(DEVICE_LIMITS.timeoutMs);
      const outcome = await pending;
      expect(outcome.reason).toBe('timeout');
      expect(outcome.state.placeId).toBeNull();
      hung.emit(AMSTERDAM);
      await Promise.resolve();
      expect(outcome.state.placeId).toBeNull();
      expectNoCoordinates(outcome);
      expectNeverWatched(hung);
    } finally {
      jest.useRealTimers();
    }
  });

  test('a choice made while the prompt is open wins, and a second reading keeps no history', async () => {
    const storage = recordedStorage();
    const client = createDeviceLocationClient({ storage, useBrowserStorage: false });
    let latest = createPlaceState();
    const hung = scripted('hang', AMSTERDAM);
    const pending = client.request({
      state: () => latest,
      userAction: true,
      asOf: AS_OF,
      index: placeIndex,
      geolocation: hung,
    });
    latest = selectPlace(latest, { placeId: 'place:rotterdam', label: 'Rotterdam' });
    hung.emit(AMSTERDAM);
    const interrupted = await pending;
    expect(interrupted.reason).toBe('explicit-choice');
    expect(interrupted.state.placeId).toBe('place:rotterdam');
    expect(interrupted.state.origin).toBe('manual');
    expectNoCoordinates(interrupted);

    const firstGeo = scripted('ok', AMSTERDAM);
    const first = await client.request({ state: createPlaceState(), userAction: true, asOf: AS_OF, index: placeIndex, geolocation: firstGeo });
    expect(first.state.placeId).toBe('place:amsterdam');
    const secondGeo = scripted('ok', COUNTRY_ONLY);
    const geocoder: ThirdPartyGeocoder = jest.fn(async () => ({ placeId: 'place:amsterdam' }));
    const second = await client.request({
      state: first.state,
      userAction: true,
      asOf: AS_OF,
      index: placeIndex,
      geolocation: secondGeo,
      thirdPartyGeocoder: geocoder,
    });
    expect(second.state.placeId).toBe('place:netherlands');
    expect(second.state.channel).toBe('device');
    expect(second.state.sessionCoordinates).toBeNull();
    expect(second.state.route.precise).toBeNull();
    expect(geocoder).not.toHaveBeenCalled();
    expect(storage.dump()).not.toContain('52.3219');
    expectNoCoordinates(second);
    expectNoCoordinates(browserDump());
    expectNeverWatched(firstGeo);
    expectNeverWatched(secondGeo);

    const saved = saveSelection(second.state, '2026-10-30T12:00:00Z');
    expect(saved.origin).toBe('saved');
    const blockedGeo = scripted('ok', AMSTERDAM);
    const blocked = await client.request({ state: saved, userAction: true, asOf: AS_OF, index: placeIndex, geolocation: blockedGeo });
    expect(blocked.reason).toBe('explicit-choice');
    expect(blockedGeo.getCurrentPosition).not.toHaveBeenCalled();
  });

  test('an explicit device request can replace an approximate IP suggestion', async () => {
    let state = requestSuggestion(createPlaceState(), { requestId: 'geoip-open', kind: 'geoip' });
    state = receiveSuggestion(state, {
      requestId: 'geoip-open',
      kind: 'geoip',
      placeId: 'place:netherlands',
      level: 'country',
      label: 'Netherlands',
    });
    expect(state.channel).toBe('geoip');
    const geo = scripted('ok', AMSTERDAM);
    const outcome = await clientWith().request({ state, userAction: true, asOf: AS_OF, index: placeIndex, geolocation: geo });
    expect(outcome.placeChanged).toBe(true);
    expect(outcome.state.placeId).toBe('place:amsterdam');
    expect(outcome.state.channel).toBe('device');
    expect(outcome.state.sessionCoordinates).toBeNull();
    expectNoCoordinates(outcome);
  });

  test('clear and reset drop a device suggestion without another prompt', async () => {
    const storage = recordedStorage();
    const client = createDeviceLocationClient({ storage, useBrowserStorage: false });
    const geo = scripted('ok', AMSTERDAM);
    const applied = await client.request({
      state: createPlaceState(),
      userAction: true,
      asOf: AS_OF,
      index: placeIndex,
      geolocation: geo,
    });
    const requests = client.permissionRequests();
    const cleared = client.clear(applied.state);
    expect(cleared.reason).toBe('cleared');
    expect(cleared.permissionRequested).toBe(false);
    expect(cleared.state.placeId).toBeNull();
    expect(cleared.state.origin).toBe('unselected');
    expect(cleared.state.channel).toBe('none');
    expect(cleared.state.sessionCoordinates).toBeNull();
    expect(shareLink(cleared.state)).not.toContain('amsterdam');
    expectNoCoordinates(cleared);
    expect(client.permissionRequests()).toBe(requests);

    const manual = selectPlace(createPlaceState(), { placeId: 'place:rotterdam', label: 'Rotterdam' });
    const kept = client.clear(manual);
    expect(kept.state.placeId).toBe('place:rotterdam');
    expect(kept.state.origin).toBe('manual');
    expect(kept.nextAction).toBe(DEVICE_COPY.clearedKept);

    const overlap = await client.request({
      state: createPlaceState(),
      userAction: true,
      asOf: AS_OF,
      index: placeIndex,
      geolocation: scripted('ok', OVERLAP),
    });
    expect(overlap.reason).toBe('choose');
    expect(overlap.state.placeId).toBeNull();
    expect(overlap.state.candidates.map((candidate) => candidate.placeId).sort()).toEqual(['place:amsterdam', 'place:rotterdam']);
    const clearedChoice = client.clear(overlap.state);
    expect(clearedChoice.state.candidates).toEqual([]);
    expectNoCoordinates(clearedChoice);

    client.setNoThirdParty(true);
    expect(storage.dump()).toContain(NO_THIRD_PARTY_SCHEMA);
    expect(storage.dump()).not.toContain('latitude');
    const local = memoryStorage();
    const session = memoryStorage();
    const geoIp = createGeoIpClient({ local, session, fetchImpl: async () => jsonResponse({ country: 'NL' }), useBrowserStorage: false });
    expect(geoIp.setOptOut(true)).toBe(true);
    const reset = client.reset(applied.state, geoIp);
    expect(reset.reason).toBe('reset');
    expect(reset.nextAction).toBe(DEVICE_COPY.reset);
    expect(client.noThirdParty()).toBe(false);
    expect(geoIp.optedOut()).toBe(false);
    expect(reset.state.placeId).toBeNull();
    expect(storage.dump()).not.toContain(NO_THIRD_PARTY_KEY);
    expect(geo.getCurrentPosition).toHaveBeenCalledTimes(1);
    expectNeverWatched(geo);
  });

  test('a hung request is discarded when the visitor clears it', async () => {
    const client = clientWith();
    const geo = scripted('hang', AMSTERDAM);
    let latest = createPlaceState();
    const pending = client.request({
      state: () => latest,
      userAction: true,
      asOf: AS_OF,
      index: placeIndex,
      geolocation: geo,
    });
    const cleared = client.clear(latest);
    geo.emit(AMSTERDAM);
    const outcome = await pending;
    expect(cleared.state.placeId).toBeNull();
    expect(outcome.reason).toBe('cleared');
    expect(outcome.state.placeId).toBeNull();
    expectNoCoordinates(outcome);
    expectNoCoordinates(cleared);
    expectNeverWatched(geo);
  });
});

describe('no-third-party mode', () => {
  test('blocks approximate location, persists, and still matches a device reading locally', async () => {
    const storage = recordedStorage();
    const client = createDeviceLocationClient({ storage, useBrowserStorage: false });
    const calls: string[] = [];
    const local = memoryStorage();
    const session = memoryStorage();
    const geoIp = createGeoIpClient({
      local,
      session,
      useBrowserStorage: false,
      fetchImpl: async (url) => {
        calls.push(url);
        return jsonResponse({ country: 'NL', ip: '203.0.113.10', latitude: AMSTERDAM.latitude, longitude: AMSTERDAM.longitude });
      },
    });
    const geocoder: ThirdPartyGeocoder = jest.fn(async () => ({ city: 'Amsterdam' }));
    expect(client.setNoThirdParty(true)).toBe(true);
    expect(storage.dump()).toContain('"enabled":true');
    expectNoCoordinates(storage.dump());

    const blocked = await client.suggestApproximate({
      state: createPlaceState(),
      userAction: true,
      geoIp,
    });
    expect(blocked.reason).toBe('third-party-blocked');
    expect(blocked.invoked).toBe(false);
    expect(blocked.networkSent).toBe(false);
    expect(calls).toEqual([]);
    expect(geocoder).not.toHaveBeenCalled();

    const withoutClick = await client.suggestApproximate({ state: createPlaceState(), geoIp });
    expect(withoutClick.reason).toBe('user-action-required');
    expect(withoutClick.invoked).toBe(false);

    const geo = scripted('ok', AMSTERDAM);
    const located = await client.request({
      state: createPlaceState(),
      userAction: true,
      asOf: AS_OF,
      index: placeIndex,
      geolocation: geo,
      thirdPartyGeocoder: geocoder,
    });
    expect(located.state.placeId).toBe('place:amsterdam');
    expect(geocoder).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
    expectNoCoordinates(located);
    expectNoCoordinates(storage.dump());

    const revived = createDeviceLocationClient({ storage, useBrowserStorage: false });
    expect(revived.noThirdParty()).toBe(true);
    const stillBlocked = await revived.suggestApproximate({ state: createPlaceState(), userAction: true, geoIp });
    expect(stillBlocked.invoked).toBe(false);

    expect(client.setNoThirdParty(false)).toBe(true);
    expect(client.noThirdParty()).toBe(false);
    const sent = await client.suggestApproximate({ state: createPlaceState(), userAction: true, geoIp });
    expect(sent.invoked).toBe(true);
    expect(sent.networkSent).toBe(true);
    expect(calls).toEqual(['https://api.country.is/']);
    expectNoCoordinates(sent);

    const missed = await client.request({
      state: createPlaceState(),
      userAction: true,
      asOf: AS_OF,
      index: placeIndex,
      geolocation: scripted('ok', NOWHERE),
      thirdPartyGeocoder: geocoder,
    });
    expect(missed.reason).toBe('unresolved');
    expect(missed.state.placeId).toBeNull();
    expect(geocoder).not.toHaveBeenCalled();
    expect(calls).toEqual(['https://api.country.is/']);
  });

  test('an unreadable privacy flag fails closed for third-party requests', async () => {
    const storage: KeyValueStorage = {
      getItem: () => {
        throw new Error('storage blocked');
      },
      setItem: () => {
        throw new Error('storage blocked');
      },
      removeItem: () => {
        throw new Error('storage blocked');
      },
    };
    const client = createDeviceLocationClient({ storage, useBrowserStorage: false });
    const geoIp = createGeoIpClient({
      local: memoryStorage(),
      session: memoryStorage(),
      useBrowserStorage: false,
      fetchImpl: async () => jsonResponse({ country: 'NL' }),
    });
    expect(client.noThirdParty()).toBe(true);
    const attempt = await client.suggestApproximate({ state: createPlaceState(), userAction: true, geoIp });
    expect(attempt.reason).toBe('third-party-blocked');
    expect(attempt.invoked).toBe(false);
    const geo = scripted('ok', COUNTRY_ONLY);
    const located = await client.request({ state: createPlaceState(), userAction: true, asOf: AS_OF, index: placeIndex, geolocation: geo });
    expect(located.state.placeId).toBe('place:netherlands');
    expect(geo.getCurrentPosition).toHaveBeenCalledTimes(1);
  });
});

function Harness(props: {
  initial?: PlaceState;
  index?: PlaceIndex | null;
  geolocation?: DeviceGeolocation | null;
  geoIp?: ReturnType<typeof createGeoIpClient> | null;
  storage?: KeyValueStorage;
  onState?: (state: PlaceState) => void;
  onChoosePlace?: () => void;
  asOf?: string | null;
}) {
  const [state, setState] = useState(() => props.initial ?? createPlaceState());
  return React.createElement(LocationPrivacy, {
    state,
    onState: (next: PlaceState) => {
      props.onState?.(next);
      setState(next);
    },
    asOf: props.asOf === undefined ? AS_OF : props.asOf,
    index: props.index === undefined ? placeIndex : props.index,
    geolocation: props.geolocation,
    geoIp: props.geoIp,
    storage: props.storage,
    onChoosePlace: props.onChoosePlace,
  });
}

describe('location privacy screen', () => {
  const fetchMock = jest.fn(async () => {
    throw new Error('unexpected network');
  });

  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    fetchMock.mockClear();
    Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: fetchMock });
  });

  test('mounting the screen does not request permission or send a network request', async () => {
    const geo = scripted('ok', AMSTERDAM);
    const previous = Object.getOwnPropertyDescriptor(navigator, 'geolocation');
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: geo });
    const storage = recordedStorage();
    const calls: string[] = [];
    const geoIp = createGeoIpClient({
      local: memoryStorage(),
      session: memoryStorage(),
      useBrowserStorage: false,
      fetchImpl: async (url) => {
        calls.push(url);
        return jsonResponse({ country: 'NL' });
      },
    });
    try {
      render(React.createElement(Harness, { geolocation: undefined, geoIp, storage }));
      expect(screen.getByRole('heading', { name: DEVICE_COPY.heading })).toBeTruthy();
      expect(screen.getByText(DEVICE_COPY.applicability)).toBeTruthy();
      expect(screen.getByRole('status').textContent).toBe(DEVICE_COPY.idle);
      expect(screen.getByRole('button', { name: DEVICE_COPY.useLabel })).toBeEnabled();
      expect(screen.getByRole('button', { name: DEVICE_COPY.suggestLabel })).toBeTruthy();
      expect(geo.getCurrentPosition).not.toHaveBeenCalled();
      expectNeverWatched(geo);
      expect(calls).toEqual([]);
      expect(fetchMock).not.toHaveBeenCalled();
      expectNoCoordinates(document.body.textContent ?? '');
    } finally {
      if (previous) Object.defineProperty(navigator, 'geolocation', previous);
    }
  });

  test('Use device location is the action that asks the browser and keeps the reading off the page', async () => {
    const user = userEvent.setup();
    const geo = scripted('ok', AMSTERDAM);
    const previous = Object.getOwnPropertyDescriptor(navigator, 'geolocation');
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: geo });
    const seen: PlaceState[] = [];
    try {
      render(React.createElement(Harness, { onState: (next) => seen.push(next) }));
      await user.click(screen.getByRole('button', { name: DEVICE_COPY.useLabel }));
      expect(geo.getCurrentPosition).toHaveBeenCalledTimes(1);
      expect(geo.getCurrentPosition.mock.calls[0]?.[2]).toMatchObject({ maximumAge: 0, enableHighAccuracy: true });
      expectNeverWatched(geo);
      expect(screen.getByText(/Current place: Amsterdam\. device location\./)).toBeTruthy();
      expect(screen.getByRole('status').textContent).toContain('Device location suggests Amsterdam');
      expect(screen.getByRole('status').textContent).toContain('Coordinates were not saved');
      expect(seen.at(-1)?.placeId).toBe('place:amsterdam');
      expect(seen.at(-1)?.channel).toBe('device');
      expect(seen.at(-1)?.sessionCoordinates).toBeNull();
      expectNoCoordinates(document.body.textContent ?? '');
      expectNoCoordinates(seen.at(-1));
      expect(fetchMock).not.toHaveBeenCalled();
      expect(browserDump()).not.toContain('52.3219');
    } finally {
      if (previous) Object.defineProperty(navigator, 'geolocation', previous);
    }
  });

  test('the keyboard activates the same device action', async () => {
    const user = userEvent.setup();
    const geo = scripted('ok', AMSTERDAM);
    render(React.createElement(Harness, { geolocation: geo, storage: recordedStorage() }));
    await user.tab();
    expect(screen.getByRole('button', { name: DEVICE_COPY.useLabel })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(geo.getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Current place: Amsterdam\. device location\./)).toBeTruthy();
    expectNeverWatched(geo);
    expectNoCoordinates(document.body.textContent ?? '');
  });

  test('denial, a missing pack, and an explicit place do not change the screen into a located place', async () => {
    const user = userEvent.setup();
    const denied = scripted('deny', AMSTERDAM);
    const { unmount } = render(React.createElement(Harness, { geolocation: denied, storage: recordedStorage() }));
    await user.click(screen.getByRole('button', { name: DEVICE_COPY.useLabel }));
    expect(denied.getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status').textContent).toBe(DEVICE_COPY.denied);
    expect(screen.getByText(/Current place: None yet/)).toBeTruthy();
    expectNoCoordinates(document.body.textContent ?? '');
    unmount();

    const packed = scripted('ok', AMSTERDAM);
    const again = render(React.createElement(Harness, { index: null, geolocation: packed, storage: recordedStorage() }));
    await user.click(screen.getByRole('button', { name: DEVICE_COPY.useLabel }));
    expect(packed.getCurrentPosition).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toBe(DEVICE_COPY.missingPack);
    again.unmount();

    const manualGeo = scripted('ok', AMSTERDAM);
    render(React.createElement(Harness, {
      initial: selectPlace(createPlaceState(), { placeId: 'place:rotterdam', label: 'Rotterdam' }),
      geolocation: manualGeo,
      storage: recordedStorage(),
    }));
    await user.click(screen.getByRole('button', { name: DEVICE_COPY.useLabel }));
    expect(manualGeo.getCurrentPosition).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toBe(DEVICE_COPY.explicit);
    expect(screen.getByText(/Current place: Rotterdam\. manually selected\./)).toBeTruthy();
  });

  test('overlap offers a choice, and choosing it does not ask the browser again', async () => {
    const user = userEvent.setup();
    const geo = scripted('ok', OVERLAP);
    const choose = jest.fn();
    render(React.createElement(Harness, { geolocation: geo, storage: recordedStorage(), onChoosePlace: choose }));
    await user.click(screen.getByRole('button', { name: DEVICE_COPY.useLabel }));
    expect(screen.getByRole('status').textContent).toContain('Choose one');
    expect(screen.getByText(/Current place: None yet/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Rotterdam' }));
    expect(geo.getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Current place: Rotterdam\. manually selected\./)).toBeTruthy();
    expectNoCoordinates(document.body.textContent ?? '');
    await user.click(screen.getByRole('button', { name: DEVICE_COPY.chooseLabel }));
    expect(choose).toHaveBeenCalledTimes(1);
    expect(geo.getCurrentPosition).toHaveBeenCalledTimes(1);
    expectNeverWatched(geo);
  });

  test('no-third-party mode, clear, and reset are visitor actions and do not prompt', async () => {
    const user = userEvent.setup();
    const storage = recordedStorage();
    const calls: string[] = [];
    const geoIp = createGeoIpClient({
      local: memoryStorage(),
      session: memoryStorage(),
      useBrowserStorage: false,
      fetchImpl: async (url) => {
        calls.push(url);
        return jsonResponse({ country: 'NL', latitude: 52.3219, longitude: 4.7513 });
      },
    });
    const geo = scripted('ok', AMSTERDAM);
    render(React.createElement(Harness, { geolocation: geo, geoIp, storage }));
    expect(DEVICE_COPY.suggestLabel).toBe(GEOIP_COPY.suggestLabel);

    await user.click(screen.getByRole('checkbox', { name: DEVICE_COPY.thirdPartyLabel }));
    expect(screen.getByRole('checkbox', { name: DEVICE_COPY.thirdPartyLabel })).toBeChecked();
    expect(screen.queryByRole('button', { name: DEVICE_COPY.suggestLabel })).toBeNull();
    expect(screen.getAllByText(DEVICE_COPY.thirdPartyOff).length).toBeGreaterThan(0);
    expect(storage.dump()).toContain(NO_THIRD_PARTY_KEY);
    expect(geoIp.optedOut()).toBe(true);
    expect(calls).toEqual([]);

    await user.click(screen.getByRole('button', { name: DEVICE_COPY.useLabel }));
    expect(geo.getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Current place: Amsterdam\. device location\./)).toBeTruthy();
    expect(calls).toEqual([]);
    expectNoCoordinates(document.body.textContent ?? '');
    expectNoCoordinates(storage.dump());

    await user.click(screen.getByRole('button', { name: DEVICE_COPY.clearLabel }));
    expect(screen.getByText(/Current place: None yet/)).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe(DEVICE_COPY.cleared);
    expect(geo.getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('checkbox', { name: DEVICE_COPY.thirdPartyLabel })).toBeChecked();

    await user.click(screen.getByRole('button', { name: DEVICE_COPY.resetLabel }));
    expect(screen.getByRole('checkbox', { name: DEVICE_COPY.thirdPartyLabel })).not.toBeChecked();
    expect(screen.getByRole('button', { name: DEVICE_COPY.suggestLabel })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe(DEVICE_COPY.reset);
    expect(geoIp.optedOut()).toBe(false);
    expect(storage.dump()).not.toContain(NO_THIRD_PARTY_KEY);
    expect(calls).toEqual([]);
    expect(geo.getCurrentPosition).toHaveBeenCalledTimes(1);
    expectNeverWatched(geo);

    await user.click(screen.getByRole('button', { name: DEVICE_COPY.suggestLabel }));
    expect(calls).toEqual(['https://api.country.is/']);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(geo.getCurrentPosition).toHaveBeenCalledTimes(1);
    expectNoCoordinates(document.body.textContent ?? '');
    expectNoCoordinates(browserDump());
  });
});

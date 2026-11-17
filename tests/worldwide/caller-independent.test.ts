import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  CALLER_INDEPENDENT_SCHEMA,
  worldwideJurisdictionIds,
} from '../../src/lib/worldwide/search/caller-independent';

const SOURCE = path.join(process.cwd(), 'src/lib/worldwide/search/caller-independent.ts');
const PLACES = ['place:nl', '', '  ', 'place:amsterdam', null, undefined] as const;

describe('caller-independent jurisdiction filter', () => {
  test('pins the schema', () => {
    expect(CALLER_INDEPENDENT_SCHEMA).toBe('worldwide-legal-search.caller-independent-filter@1');
  });

  test.each(['url', 'manual', 'saved'] as const)('origin %s returns the non-empty place ids', (origin) => {
    expect(worldwideJurisdictionIds(origin, undefined, PLACES)).toEqual(['place:nl', 'place:amsterdam']);
    expect(worldwideJurisdictionIds(origin, null, ['place:nl'])).toEqual(['place:nl']);
    expect(worldwideJurisdictionIds(origin, 'geoip', PLACES)).toEqual(['place:nl', 'place:amsterdam']);
    expect(worldwideJurisdictionIds(origin, 'device', PLACES)).toEqual(['place:nl', 'place:amsterdam']);
    expect(worldwideJurisdictionIds(origin, 'none', [' place:saved '])).toEqual(['place:saved']);
  });

  test.each(['suggestion', 'unselected'] as const)('origin %s returns an empty array', (origin) => {
    expect(worldwideJurisdictionIds(origin, undefined, PLACES)).toEqual([]);
    expect(worldwideJurisdictionIds(origin, 'url', PLACES)).toEqual([]);
    expect(worldwideJurisdictionIds(origin, 'manual', ['place:nl'])).toEqual([]);
    expect(worldwideJurisdictionIds(origin, 'saved', ['place:nl'])).toEqual([]);
    expect(worldwideJurisdictionIds(origin, 'geoip', ['place:nl'])).toEqual([]);
  });

  test.each(['geoip', 'device', 'none'] as const)(
    'an absent origin and channel %s returns an empty array',
    (channel) => {
      expect(worldwideJurisdictionIds(undefined, channel, PLACES)).toEqual([]);
      expect(worldwideJurisdictionIds(null, channel, PLACES)).toEqual([]);
      expect(worldwideJurisdictionIds('', channel, ['place:nl'])).toEqual([]);
      expect(worldwideJurisdictionIds('   ', channel, ['place:nl'])).toEqual([]);
    },
  );

  test('returns the non-empty place ids when origin and channel are both absent', () => {
    expect(worldwideJurisdictionIds(undefined, undefined, PLACES)).toEqual(['place:nl', 'place:amsterdam']);
    expect(worldwideJurisdictionIds(null, null, PLACES)).toEqual(['place:nl', 'place:amsterdam']);
    expect(worldwideJurisdictionIds('', '', ['place:nl', ''])).toEqual(['place:nl']);
    expect(worldwideJurisdictionIds(undefined, undefined, [])).toEqual([]);
    expect(worldwideJurisdictionIds(undefined, undefined, null)).toEqual([]);
    expect(worldwideJurisdictionIds()).toEqual([]);
  });

  test('an explicit origin wins over a suggestion channel', () => {
    expect(worldwideJurisdictionIds('url', 'geoip', ['place:nl', 'place:be'])).toEqual(['place:nl', 'place:be']);
    expect(worldwideJurisdictionIds('manual', 'device', ['place:nl'])).toEqual(['place:nl']);
    expect(worldwideJurisdictionIds('saved', 'none', ['place:saved'])).toEqual(['place:saved']);
    expect(worldwideJurisdictionIds('suggestion', 'url', ['place:nl'])).toEqual([]);
  });

  test('an explicit channel keeps place ids when the origin is absent', () => {
    expect(worldwideJurisdictionIds(undefined, 'url', PLACES)).toEqual(['place:nl', 'place:amsterdam']);
    expect(worldwideJurisdictionIds(null, 'manual', ['place:nl'])).toEqual(['place:nl']);
    expect(worldwideJurisdictionIds('', 'saved', ['place:saved'])).toEqual(['place:saved']);
  });

  test('does not import geoip, read a caller address, or fetch', () => {
    const source = readFileSync(SOURCE, 'utf8');
    expect(source).not.toMatch(/from\s+['"][^'"]*geoip/);
    expect(source).not.toMatch(/\bimport\s*\(\s*['"][^'"]*geoip/);
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/callerIp|clientIp|remoteAddress|x-forwarded-for|x-real-ip|socket\.remote/i);
    expect(worldwideJurisdictionIds('manual', 'geoip', ['place:nl'])).toEqual(['place:nl']);
  });
});

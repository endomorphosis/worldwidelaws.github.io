/**
 * Level names on the retrieval filter.
 * Province and state use the regional band. City stays on the municipal path.
 * This test does not fetch.
 */

import { createElement } from 'react';
import { jest } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import {
  EMPTY_DISPLAY_FILTERS,
  SearchFilters,
  normalizeDisplayFilters,
  resultCopy,
  type DisplayFilters,
} from '../../src/components/worldwide/SearchFilters';
import { toProductionFilters } from '../../src/components/worldwide/SearchResults';

type Stack = NonNullable<Parameters<typeof toProductionFilters>[2]>;

const STACK = {
  candidates: [
    { id: 'place:north-country' },
    { id: 'place:north-province' },
    { id: 'place:harbor-town' },
  ],
  byBand: {
    national: ['place:north-country'],
    regional: ['place:north-province'],
    local: ['place:harbor-town'],
  },
} as unknown as Stack;

const EXPANDED = ['place:north-country', 'place:north-province', 'place:harbor-town'];

function filters(level: DisplayFilters['level'], place = ''): DisplayFilters {
  return { ...EMPTY_DISPLAY_FILTERS, level, place };
}

describe('government retrieval levels', () => {
  test('province yields regional bands and city stays on the municipal path', () => {
    const fetchCalls = jest.fn();
    const previousFetch = globalThis.fetch;
    globalThis.fetch = fetchCalls as typeof fetch;

    try {
      for (const level of ['province', 'state', 'municipality', 'city', 'neighborhood'] as const) {
        expect(normalizeDisplayFilters({ level }).level).toBe(level);
      }
      expect(normalizeDisplayFilters({ level: 'national' }).level).toBe('national');
      expect(normalizeDisplayFilters({ level: 'regional' }).level).toBe('regional');
      expect(normalizeDisplayFilters({ level: 'municipal' }).level).toBe('municipal');
      expect(normalizeDisplayFilters({ level: 'local' }).level).toBe('local');
      expect(normalizeDisplayFilters({ level: 'other' }).level).toBe('other');
      expect(normalizeDisplayFilters({ level: 'country' as DisplayFilters['level'] }).level).toBe('');

      const province = toProductionFilters('housing', filters('province', 'place:north-province'), STACK);
      const regional = toProductionFilters('housing', filters('regional', 'place:north-province'), STACK);
      expect(province.bands).toEqual(['regional']);
      expect(province).toEqual(regional);
      expect(toProductionFilters('housing', filters('state', 'place:north-province'), STACK).bands).toEqual(['regional']);

      const city = toProductionFilters('housing', filters('city', 'place:north-province'), STACK);
      const municipal = toProductionFilters('housing', filters('municipal', 'place:north-province'), STACK);
      expect(city).toEqual(municipal);
      expect(city.bands).toBeUndefined();
      expect(city.placeIds).toEqual(EXPANDED);

      const cityOnly = toProductionFilters('housing', filters('city', 'place:harbor-town'), STACK);
      const municipalOnly = toProductionFilters('housing', filters('municipal', 'place:harbor-town'), STACK);
      const localOnly = toProductionFilters('housing', filters('local', 'place:harbor-town'), STACK);
      expect(cityOnly).toEqual(municipalOnly);
      expect(cityOnly).toEqual(localOnly);
      expect(cityOnly.bands).toBeUndefined();
      expect(cityOnly.placeIds).toEqual(EXPANDED);
      expect(toProductionFilters('housing', filters('municipality', 'place:harbor-town'), STACK)).toEqual(municipalOnly);
      expect(toProductionFilters('housing', filters('neighborhood', 'place:harbor-town'), STACK)).toEqual(municipalOnly);

      expect(toProductionFilters('', filters('national'), STACK).bands).toEqual(['national']);
      expect(toProductionFilters('', filters('regional'), STACK).bands).toEqual(['regional']);
      expect(toProductionFilters('', filters('other'), STACK).bands).toEqual(['special', 'supranational', 'unclassified']);
      expect(toProductionFilters('', filters('municipal'), null).bands).toBeUndefined();
      expect(toProductionFilters('', filters('local'), null).bands).toBeUndefined();

      render(createElement(SearchFilters, {
        filters: EMPTY_DISPLAY_FILTERS,
        onChange: () => undefined,
        open: true,
        onOpenChange: () => undefined,
        copy: resultCopy('en'),
      }));
      const select = screen.getByLabelText('Jurisdiction level');
      expect(select).toHaveAttribute('data-schema', 'worldwide-legal-search.level-filter@1');
      expect([...select.querySelectorAll('option')].map((option) => option.value)).toEqual([
        '',
        'national',
        'regional',
        'province',
        'state',
        'municipal',
        'municipality',
        'city',
        'neighborhood',
        'other',
      ]);
      expect(fetchCalls).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
});

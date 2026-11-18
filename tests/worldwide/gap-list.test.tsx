/**
 * Versioned gap list on the coverage page.
 * One geography row and one corpus row. The schema id is
 * worldwide-legal-search.gap-list@1. No fetch.
 */

import { readFileSync } from 'fs';
import { jest } from '@jest/globals';
import { cleanup, render } from '@testing-library/react';
import { gapsFromCoverageCells } from '../../src/lib/worldwide/coverage/gaps';
import { GAP_LIST_SCHEMA, GapList } from '../../src/components/worldwide/GapList';

const fetchHost = globalThis as { fetch?: typeof fetch };
let originalFetch: typeof fetch | undefined;

beforeEach(() => {
  originalFetch = fetchHost.fetch;
  fetchHost.fetch = jest.fn(() => Promise.reject(new Error('gap list must not fetch'))) as typeof fetch;
});

afterEach(() => {
  cleanup();
  fetchHost.fetch = originalFetch;
});

describe('gap list', () => {
  test('renders one geography row and one corpus row and expects the schema id', () => {
    const placeId = 'place:fixture-province';
    const list = gapsFromCoverageCells(
      [
        { level: 'province', state: 'missing', placeId },
        { level: 'state', state: 'partial', placeId: 'place:fixture-state' },
      ],
      ['city', 'province', 'state'],
    );
    expect(list.geography).toHaveLength(1);
    expect(list.corpus).toHaveLength(1);

    const { container } = render(<GapList gaps={list} />);
    const root = container.querySelector('[data-field="gap-list"]');
    expect(root).toHaveAttribute('data-schema', 'worldwide-legal-search.gap-list@1');
    expect(root).toHaveAttribute('data-schema', GAP_LIST_SCHEMA);

    const geographyRows = container.querySelectorAll('[data-field="gap-row"][data-kind="geography"]');
    const corpusRows = container.querySelectorAll('[data-field="gap-row"][data-kind="corpus"]');
    expect(geographyRows).toHaveLength(1);
    expect(corpusRows).toHaveLength(1);

    const geography = geographyRows[0];
    expect(geography.querySelector('[data-field="level"]')?.textContent).toBe('city');
    expect(geography.querySelector('[data-field="place-id"]')?.textContent).toBe('');
    expect(geography.querySelector('[data-field="sentence"]')?.textContent).toContain('coverage gap');
    expect(geography.querySelector('[data-field="sentence"]')?.textContent).toContain('not a finding that no law exists');
    expect(geography.textContent).toContain('city');

    const corpus = corpusRows[0];
    expect(corpus.querySelector('[data-field="level"]')?.textContent).toBe('province');
    expect(corpus.querySelector('[data-field="place-id"]')?.textContent).toBe(placeId);
    expect(corpus.querySelector('[data-field="sentence"]')?.textContent).toContain('coverage gap');
    expect(corpus.querySelector('[data-field="sentence"]')?.textContent).toContain('not a finding that no law exists');
    expect(corpus.textContent).toContain('province');
    expect(corpus.textContent).toContain(placeId);

    expect(fetchHost.fetch).not.toHaveBeenCalled();

    const page = readFileSync('src/components/worldwide/CoveragePage.tsx', 'utf8');
    expect(page).toContain('gapsFromCoverageCells');
    expect(page).toContain('GapList');
    expect(page.match(/<GapList\b/g)).toHaveLength(1);
    const view = readFileSync('src/components/worldwide/GapList.tsx', 'utf8');
    expect(view).not.toMatch(/\bfetch\s*\(/);
    expect(view).not.toContain('geoip');
    expect(page).not.toMatch(/\bfetch\s*\(/);
  });
});

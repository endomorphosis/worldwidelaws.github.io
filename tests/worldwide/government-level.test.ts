import {
  GOVERNMENT_LEVEL_SCHEMA,
  GOVERNMENT_LEVELS,
  governmentBand,
} from '../../src/lib/worldwide/levels/government';

describe('government level names', () => {
  test('maps the six levels and returns null for an unknown string', () => {
    expect(GOVERNMENT_LEVEL_SCHEMA).toBe('worldwide-legal-search.government-level@1');
    expect([...GOVERNMENT_LEVELS]).toEqual([
      'national',
      'province',
      'state',
      'municipality',
      'city',
      'neighborhood',
    ]);
    expect(governmentBand('national')).toBe('national');
    expect(governmentBand('province')).toBe('regional');
    expect(governmentBand('state')).toBe('regional');
    expect(governmentBand('municipality')).toBe('local');
    expect(governmentBand('city')).toBe('local');
    expect(governmentBand('neighborhood')).toBe('local');
    expect(governmentBand('country')).toBeNull();
  });
});

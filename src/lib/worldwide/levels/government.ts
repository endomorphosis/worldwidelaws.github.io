/**
 * Filter vocabulary for the six government levels.
 *
 * These names are not the jurisdiction level kinds passed to bandForLevel.
 * Here `national` is the national band. Province and state are regional.
 * Municipality, city, and neighborhood are local. Any other string is null.
 * This module does not read a caller IP and does not fetch.
 */

export const GOVERNMENT_LEVEL_SCHEMA = 'worldwide-legal-search.government-level@1';

export const GOVERNMENT_LEVELS = [
  'national',
  'province',
  'state',
  'municipality',
  'city',
  'neighborhood',
] as const;

export type GovernmentLevel = (typeof GOVERNMENT_LEVELS)[number];
export type GovernmentBand = 'national' | 'regional' | 'local';

const BAND_FOR_LEVEL: { readonly [K in GovernmentLevel]: GovernmentBand } = {
  national: 'national',
  province: 'regional',
  state: 'regional',
  municipality: 'local',
  city: 'local',
  neighborhood: 'local',
};

const KNOWN_LEVELS = new Set<string>(GOVERNMENT_LEVELS);

export function governmentBand(level: string): GovernmentBand | null {
  if (!KNOWN_LEVELS.has(level)) return null;
  return BAND_FOR_LEVEL[level as GovernmentLevel];
}

/**
 * Jurisdiction allow-list for a worldwide query.
 *
 * A URL, manual, or saved place still narrows the allow-list. A suggestion
 * or an unselected scope does not. With no origin, a geoip, device, or none
 * channel does not narrow either. With neither an origin nor a channel, the
 * non-empty place ids stay. An explicit origin wins over a suggestion channel.
 *
 * Nothing here reads a caller address, imports a location provider, or fetches.
 */

export const CALLER_INDEPENDENT_SCHEMA = 'worldwide-legal-search.caller-independent-filter@1';

const EXPLICIT_ORIGINS = new Set(['url', 'manual', 'saved']);
const OPEN_ORIGINS = new Set(['suggestion', 'unselected']);
const OPEN_CHANNELS = new Set(['geoip', 'device', 'none']);
const EXPLICIT_CHANNELS = new Set(['url', 'manual', 'saved']);

function blankToNull(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text ? text : null;
}

function nonEmptyPlaceIds(placeIds: readonly (string | null | undefined)[] | null | undefined): string[] {
  if (!placeIds) return [];
  const kept: string[] = [];
  for (const value of placeIds) {
    if (typeof value !== 'string') continue;
    const text = value.trim();
    if (text) kept.push(text);
  }
  return kept;
}

/**
 * Place ids that may narrow a worldwide jurisdiction filter.
 * An explicit origin keeps the ids even when the channel is a suggestion.
 * A suggestion or unselected origin drops them. With no origin, geoip,
 * device, and none drop them. With neither field, the ids stay.
 */
export function worldwideJurisdictionIds(
  origin?: string | null,
  channel?: string | null,
  placeIds?: readonly (string | null | undefined)[] | null,
): string[] {
  const places = nonEmptyPlaceIds(placeIds);
  const originText = blankToNull(origin);
  const channelText = blankToNull(channel);

  if (originText) {
    if (EXPLICIT_ORIGINS.has(originText)) return places;
    if (OPEN_ORIGINS.has(originText)) return [];
    return [];
  }

  if (channelText) {
    if (OPEN_CHANNELS.has(channelText)) return [];
    if (EXPLICIT_CHANNELS.has(channelText)) return places;
    return [];
  }

  return places;
}

/**
 * Manual place search for worldwide legal search.
 *
 * Country, region, and municipality choices are keyboard lists. Name search
 * keeps native aliases and the full administrative parent chain on every
 * row. Duplicate names stay unselected until the visitor chooses a row.
 * Postal codes are offered only when a licensed record is supplied.
 * Coordinates are typed numbers resolved against the local boundary pack.
 * This control never asks for device location and never draws a map.
 * Nothing here decides that a law applies.
 */

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from 'react';
import {
  APPLICABILITY,
  candidateEdges,
  intervalStatus,
  type AliasKind,
  type JurisdictionGraph,
  type JurisdictionNode,
  type ParentKnowledge,
  type ValidityInterval,
} from '../../lib/worldwide/jurisdiction/schema';
import {
  buildPlaceIndex,
  resolvePoint,
  type GeometryRecord,
  type PlaceIndex,
  type PointResolution,
  type ResolutionReason,
} from '../../lib/worldwide/jurisdiction/resolve';
import {
  selectPlace,
  selectWorldwide,
  type PlaceState,
} from '../../lib/worldwide/location/state';

export const PLACE_PICKER_SCHEMA = 'worldwide-legal-search.place-picker@1';
export const PLACE_SELECTION_SCHEMA = 'worldwide-legal-search.place-selection@1';

export const PLACE_PICKER_LIMITS = {
  maxMatches: 32,
  maxParentDepth: 16,
} as const;

const COUNTRY_LEVELS = new Set(['country', 'constituent-country', 'dependency']);
const REGIONAL_LEVELS = new Set([
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
const MUNICIPAL_LEVELS = new Set([
  'municipality',
  'city',
  'locality',
  'borough',
  'neighborhood',
  'local-authority',
  'unincorporated',
  'postal-area',
]);

const UNLICENSED_POSTCODE = new Set([
  '',
  'unknown',
  'unlicensed',
  'none',
  'proprietary',
  'all-rights-reserved',
  'all rights reserved',
  'withheld',
  'missing',
  'unset',
]);

const NOT_APPLICABILITY = 'This choice does not decide that a law applies.';
const PARENT_UNKNOWN = 'Administrative parent is unknown.';
const NO_PARENT = 'No administrative parent.';
const CHOOSE_MATCH = 'Several places match. Choose one. Each line keeps the full parent context.';
const CHOOSE_POINT = 'Several places contain this point. Choose a country, region, or municipality. No place was selected automatically.';
const BORDER_POINT = 'This point is on a boundary or an uncertain border. Choose the place yourself.';
const NO_CITY_INVENTED = 'No municipality was added for this point.';
const OTHER_CONTAINS = 'Other listed places also contain this point. The place changes only when you choose one.';

const PROBE_INTERVAL: ValidityInterval = {
  start: { knowledge: 'known', value: '2000', precision: 'year', source: 'place-picker' },
  end: { knowledge: 'open', value: null, precision: null, source: 'place-picker' },
};

const STYLES = `
.place-picker { color: #17202a; background: #fff; max-width: 72rem; }
.place-picker * { box-sizing: border-box; }
.place-picker p, .place-picker h2 { margin: 0 0 0.75rem; }
.place-picker-columns { display: flex; flex-wrap: wrap; gap: 1rem; margin: 1rem 0; }
.place-picker-column { flex: 1 1 16rem; min-width: min(100%, 16rem); }
.place-picker-column h3 { margin: 0 0 0.35rem; font-size: 1rem; }
.place-picker-list { max-height: 18rem; overflow: auto; margin: 0.35rem 0 0; padding: 0; border: 1px solid #243140; }
.place-picker-option { min-height: 44px; padding: 0.45rem 0.65rem; display: grid; gap: 0.1rem; }
.place-picker-option[data-active="true"] { background: #e7f0f7; }
.place-picker-option[data-committed="true"] { box-shadow: inset 4px 0 0 #0b3a5b; }
.place-picker input, .place-picker button { min-height: 44px; font: inherit; }
.place-picker-field { display: grid; gap: 0.25rem; margin: 0.75rem 0; }
.place-picker-coordinates { display: flex; flex-wrap: wrap; gap: 0.75rem; align-items: end; }
.place-picker-alias { font-style: normal; }
.place-picker :focus-visible { outline: 3px solid #0b3a5b; outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) {
  .place-picker * { scroll-behavior: auto; }
}
`;

export interface PlaceCrumb {
  placeId: string;
  name: string | null;
  levelKind: string;
}

export interface PlaceRecord {
  placeId: string;
  name: string | null;
  language: string | null;
  levelKind: string;
  levelLabel: string;
  parentKnowledge: ParentKnowledge;
  parentIds: string[];
  names: readonly { text: string; language: string }[];
  aliases: readonly {
    text: string;
    language: string | null;
    kind: AliasKind;
    validity: 'current' | 'outside' | 'unknown';
  }[];
}

export interface PlaceCatalog {
  schema: typeof PLACE_PICKER_SCHEMA;
  asOf: string;
  viewIds: readonly string[];
  places: readonly PlaceRecord[];
  byId: ReadonlyMap<string, PlaceRecord>;
  childrenByParent: ReadonlyMap<string, readonly string[]>;
  countries: readonly string[];
  applicability: typeof APPLICABILITY;
  uncertainty: readonly string[];
  issue: string | null;
}

export interface PlaceMatch {
  placeId: string;
  name: string | null;
  levelKind: string;
  levelLabel: string;
  language: string | null;
  nativeAlias: string | null;
  nativeLanguage: string | null;
  parentKnowledge: ParentKnowledge;
  parents: PlaceCrumb[];
  contextLabel: string;
  parentLine: string;
  accessibleName: string;
  matchKind: 'name' | 'native-alias' | 'alias' | 'code' | 'postcode' | 'coordinates' | 'browse';
  matchedText: string | null;
  duplicateName: boolean;
  uncertainty: string[];
  postcode: { code: string; license: string; attribution: string | null } | null;
  pointReasons: ResolutionReason[];
}

export interface PlaceSelection extends PlaceMatch {
  schema: typeof PLACE_SELECTION_SCHEMA;
  scope: 'place' | 'worldwide';
  entry: 'browse' | 'search' | 'postcode' | 'coordinates' | 'worldwide';
  applicability: typeof APPLICABILITY;
  coordinates: { latitude: number; longitude: number } | null;
}

export interface PostcodeRecord {
  code: string;
  placeId: string;
  license: string | null;
  attribution?: string | null;
  licensed?: boolean;
}

export interface PlaceSearchResult {
  matches: PlaceMatch[];
  truncated: boolean;
  total: number;
}

export interface PostcodeSearchResult extends PlaceSearchResult {
  withheld: number;
  exactWithheld: boolean;
}

export interface PlacePickerProps {
  graph: JurisdictionGraph;
  asOf: string;
  geometries?: readonly GeometryRecord[] | null;
  index?: PlaceIndex | null;
  postcodes?: readonly PostcodeRecord[] | null;
  viewIds?: readonly string[];
  placeState?: PlaceState | null;
  onPlaceState?: (state: PlaceState) => void;
  onSelect?: (selection: PlaceSelection) => void;
}

export function foldPlaceText(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/['’`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizePostcode(value: string): string {
  return value.normalize('NFKC').toUpperCase().replace(/[^A-Z0-9]+/g, '');
}

export function postcodeLicense(record: PostcodeRecord): { ok: true; license: string; attribution: string | null } | { ok: false } {
  if (record.licensed === false) return { ok: false };
  const license = (record.license ?? '').trim();
  if (UNLICENSED_POSTCODE.has(license.toLowerCase())) return { ok: false };
  const attribution = record.attribution?.trim() || null;
  return { ok: true, license, attribution };
}

function emptyCatalog(asOf: string, viewIds: readonly string[], issue: string | null, uncertainty: string[]): PlaceCatalog {
  return {
    schema: PLACE_PICKER_SCHEMA,
    asOf,
    viewIds: [...viewIds],
    places: [],
    byId: new Map(),
    childrenByParent: new Map(),
    countries: [],
    applicability: APPLICABILITY,
    uncertainty,
    issue,
  };
}

function aliasValidity(alias: JurisdictionNode['aliases'][number], asOf: string): 'current' | 'outside' | 'unknown' {
  if (!alias.valid) return 'current';
  return intervalStatus(alias.valid, asOf);
}

function toRecord(node: JurisdictionNode, parentIds: readonly string[], asOf: string): PlaceRecord {
  const aliases = node.aliases.map((alias) => ({
    text: alias.text,
    language: alias.language,
    kind: alias.kind,
    validity: aliasValidity(alias, asOf),
  }));
  return {
    placeId: node.id,
    name: node.names[0]?.text ?? null,
    language: node.names[0]?.language ?? null,
    levelKind: node.level.kind,
    levelLabel: node.level.label?.text ?? node.level.kind,
    parentKnowledge: node.parentKnowledge,
    parentIds: [...parentIds],
    names: node.names.map((name) => ({ text: name.text, language: name.language })),
    aliases,
  };
}

export function buildPlaceCatalog(
  graph: JurisdictionGraph,
  asOf: string,
  viewIds: readonly string[] = [],
): PlaceCatalog {
  let probed: string;
  try {
    intervalStatus(PROBE_INTERVAL, asOf);
    probed = asOf;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The date is not usable.';
    return emptyCatalog(asOf, viewIds, message, [NOT_APPLICABILITY, message]);
  }
  let slice;
  try {
    slice = candidateEdges(graph, { asOf: probed, viewIds });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The place catalog could not be read.';
    return emptyCatalog(asOf, viewIds, message, [NOT_APPLICABILITY, message]);
  }
  const parentIds = new Map<string, string[]>();
  for (const edge of slice.edges) {
    if (edge.kind !== 'administrative-containment') continue;
    const list = parentIds.get(edge.fromId) ?? [];
    if (!list.includes(edge.toId)) list.push(edge.toId);
    parentIds.set(edge.fromId, list);
  }
  const uncertainty = [NOT_APPLICABILITY];
  if (slice.undecided.some((edge) => edge.kind === 'administrative-containment')) {
    uncertainty.push('Some administrative parents have unknown dates and were not used as parent context.');
  }
  let expired = 0;
  let unknownValidity = 0;
  const places: PlaceRecord[] = [];
  for (const node of graph.nodes) {
    if (!node.roles.includes('place')) continue;
    const validity = intervalStatus(node.valid, probed);
    if (validity === 'outside') {
      expired += 1;
      continue;
    }
    if (validity === 'unknown') {
      unknownValidity += 1;
      continue;
    }
    const ids = (parentIds.get(node.id) ?? []).slice().sort((left, right) => left.localeCompare(right));
    places.push(toRecord(node, ids, probed));
  }
  if (expired === 1) uncertainty.push('1 place is outside this date and is not listed.');
  else if (expired > 1) uncertainty.push(`${expired} places are outside this date and are not listed.`);
  if (unknownValidity === 1) uncertainty.push('1 place has unknown validity and is not listed.');
  else if (unknownValidity > 1) uncertainty.push(`${unknownValidity} places have unknown validity and are not listed.`);
  const byId = new Map(places.map((place) => [place.placeId, place]));
  const childrenByParent = new Map<string, string[]>();
  for (const place of places) {
    place.parentIds = place.parentIds.filter((id) => byId.has(id));
    for (const parentId of place.parentIds) {
      const children = childrenByParent.get(parentId) ?? [];
      children.push(place.placeId);
      childrenByParent.set(parentId, children);
    }
  }
  const countries = places
    .filter((place) => COUNTRY_LEVELS.has(place.levelKind))
    .map((place) => place.placeId)
    .sort((left, right) => comparePlaces(byId.get(left), byId.get(right)));
  return {
    schema: PLACE_PICKER_SCHEMA,
    asOf: probed,
    viewIds: [...viewIds],
    places,
    byId,
    childrenByParent,
    countries,
    applicability: APPLICABILITY,
    uncertainty,
    issue: null,
  };
}

function comparePlaces(left: PlaceRecord | undefined, right: PlaceRecord | undefined): number {
  const name = (left?.name ?? left?.placeId ?? '').localeCompare(right?.name ?? right?.placeId ?? '', undefined, { sensitivity: 'base' });
  if (name !== 0) return name;
  return (left?.placeId ?? '').localeCompare(right?.placeId ?? '');
}

export function parentChains(catalog: PlaceCatalog, placeId: string): PlaceCrumb[][] {
  function walk(id: string, seen: ReadonlySet<string>, depth: number): PlaceCrumb[][] {
    const place = catalog.byId.get(id);
    if (!place || depth >= PLACE_PICKER_LIMITS.maxParentDepth) return [[]];
    const parents = place.parentIds.filter((parentId) => !seen.has(parentId) && catalog.byId.has(parentId));
    if (parents.length === 0) return [[]];
    const chains: PlaceCrumb[][] = [];
    for (const parentId of parents) {
      const parent = catalog.byId.get(parentId);
      if (!parent) continue;
      const crumb: PlaceCrumb = { placeId: parent.placeId, name: parent.name, levelKind: parent.levelKind };
      const next = new Set(seen);
      next.add(parentId);
      for (const rest of walk(parentId, next, depth + 1)) chains.push([crumb, ...rest]);
    }
    return chains.length > 0 ? chains : [[]];
  }
  return walk(placeId, new Set([placeId]), 0);
}

function currentNative(place: PlaceRecord): { text: string; language: string | null } | null {
  const alias = place.aliases.find((item) => item.kind === 'native' && item.validity === 'current' && item.text !== place.name);
  return alias ? { text: alias.text, language: alias.language } : null;
}

function parentLine(place: PlaceRecord, parents: readonly PlaceCrumb[]): string {
  if (parents.length > 0) return parents.map((parent) => parent.name ?? parent.placeId).join(' · ');
  if (place.parentKnowledge === 'unknown') return PARENT_UNKNOWN;
  return NO_PARENT;
}

function contextFrom(name: string, chains: readonly PlaceCrumb[][]): string {
  const filled = chains.filter((chain) => chain.length > 0);
  if (filled.length === 0) return name;
  return filled
    .map((chain) => [name, ...chain.map((crumb) => crumb.name ?? crumb.placeId)].join(' · '))
    .join(' / ');
}

export function matchFromPlace(
  catalog: PlaceCatalog,
  place: PlaceRecord,
  matchKind: PlaceMatch['matchKind'],
  matchedText: string | null,
): PlaceMatch {
  const chains = parentChains(catalog, place.placeId);
  const parents = chains[0] ?? [];
  const native = currentNative(place);
  const name = place.name ?? place.placeId;
  const uncertainty = [NOT_APPLICABILITY];
  if (place.parentKnowledge === 'unknown') uncertainty.push(PARENT_UNKNOWN);
  if (chains.filter((chain) => chain.length > 0).length > 1) {
    uncertainty.push('More than one administrative parent is recorded. Every parent stays in the context.');
  }
  const nativeBit = native ? native.text : null;
  const parentBit = parents.length > 0
    ? parents.map((parent) => `${parent.name ?? parent.placeId}, ${parent.levelKind}`).join(', ')
    : place.parentKnowledge === 'unknown'
      ? 'administrative parent unknown'
      : 'no administrative parent';
  const matchBit = matchKind === 'native-alias' && matchedText
    ? `matched native name ${matchedText}`
    : matchKind === 'code' && matchedText
      ? `matched code ${matchedText}`
      : matchKind === 'alias' && matchedText
        ? `matched alias ${matchedText}`
        : matchKind === 'postcode' && matchedText
          ? `matched postal code ${matchedText}`
          : null;
  const accessibleName = [name, nativeBit, place.levelLabel, parentBit, matchBit].filter((part): part is string => Boolean(part)).join(', ');
  return {
    placeId: place.placeId,
    name: place.name,
    levelKind: place.levelKind,
    levelLabel: place.levelLabel,
    language: place.language,
    nativeAlias: native?.text ?? null,
    nativeLanguage: native?.language ?? null,
    parentKnowledge: place.parentKnowledge,
    parents,
    contextLabel: contextFrom(name, chains),
    parentLine: parentLine(place, parents),
    accessibleName,
    matchKind,
    matchedText,
    duplicateName: false,
    uncertainty,
    postcode: null,
    pointReasons: [],
  };
}

function markDuplicates(matches: PlaceMatch[]): void {
  const counts = new Map<string, number>();
  for (const match of matches) {
    const key = foldPlaceText(match.name ?? match.placeId);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const match of matches) {
    const key = foldPlaceText(match.name ?? match.placeId);
    match.duplicateName = (counts.get(key) ?? 0) > 1;
  }
}

function fieldScore(queryLoose: string, queryCompact: string, text: string, kindRank: number): number | null {
  const loose = foldPlaceText(text);
  if (!loose || !queryLoose) return null;
  const compact = loose.replace(/ /g, '');
  if (loose === queryLoose || compact === queryCompact) return kindRank;
  if (loose.startsWith(queryLoose) || compact.startsWith(queryCompact)) return 100 + kindRank;
  // A one- or two-character fragment matches a prefix or a code, not every name that contains those letters.
  if (queryLoose.length < 3) return null;
  if (loose.includes(queryLoose) || compact.includes(queryCompact)) return 200 + kindRank;
  return null;
}

export function searchPlaces(catalog: PlaceCatalog, query: string, limit = PLACE_PICKER_LIMITS.maxMatches): PlaceSearchResult {
  const queryLoose = foldPlaceText(query);
  const queryCompact = queryLoose.replace(/ /g, '');
  if (!queryLoose) return { matches: [], truncated: false, total: 0 };
  const found: { match: PlaceMatch; score: number }[] = [];
  for (const place of catalog.places) {
    let bestScore = Number.POSITIVE_INFINITY;
    let bestKind: PlaceMatch['matchKind'] = 'name';
    let bestText: string | null = null;
    const consider = (text: string, score: number | null, kind: PlaceMatch['matchKind']) => {
      if (score === null || score >= bestScore) return;
      bestScore = score;
      bestKind = kind;
      bestText = text;
    };
    for (const name of place.names) consider(name.text, fieldScore(queryLoose, queryCompact, name.text, 0), 'name');
    for (const alias of place.aliases) {
      if (alias.validity !== 'current') continue;
      const kindRank = alias.kind === 'native' ? 1 : alias.kind === 'code' ? 2 : 3;
      const kind: PlaceMatch['matchKind'] = alias.kind === 'native' ? 'native-alias' : alias.kind === 'code' ? 'code' : 'alias';
      consider(alias.text, fieldScore(queryLoose, queryCompact, alias.text, kindRank), kind);
    }
    if (bestText === null) continue;
    found.push({ match: matchFromPlace(catalog, place, bestKind, bestText), score: bestScore });
  }
  found.sort((left, right) => left.score - right.score || left.match.contextLabel.localeCompare(right.match.contextLabel) || left.match.placeId.localeCompare(right.match.placeId));
  const total = found.length;
  const matches = found.slice(0, limit).map((item) => item.match);
  markDuplicates(matches);
  return { matches, truncated: total > matches.length, total };
}

export function browseChildren(catalog: PlaceCatalog, parentId: string | null, group: 'regional' | 'municipal'): PlaceMatch[] {
  if (!parentId) return [];
  const childIds = catalog.childrenByParent.get(parentId) ?? [];
  const matches: PlaceMatch[] = [];
  for (const childId of childIds) {
    const place = catalog.byId.get(childId);
    if (!place) continue;
    const regional = REGIONAL_LEVELS.has(place.levelKind);
    const municipal = MUNICIPAL_LEVELS.has(place.levelKind);
    if (group === 'regional' && regional) matches.push(matchFromPlace(catalog, place, 'browse', place.name));
    if (group === 'municipal' && municipal) matches.push(matchFromPlace(catalog, place, 'browse', place.name));
    if (group === 'regional' && !regional && !municipal && !COUNTRY_LEVELS.has(place.levelKind)) {
      matches.push(matchFromPlace(catalog, place, 'browse', place.name));
    }
  }
  matches.sort((left, right) => left.contextLabel.localeCompare(right.contextLabel) || left.placeId.localeCompare(right.placeId));
  markDuplicates(matches);
  return matches;
}

export function searchPostcodes(
  catalog: PlaceCatalog,
  records: readonly PostcodeRecord[] | null | undefined,
  query: string,
  limit = PLACE_PICKER_LIMITS.maxMatches,
): PostcodeSearchResult {
  const folded = normalizePostcode(query);
  if (!folded || !records) return { matches: [], truncated: false, total: 0, withheld: 0, exactWithheld: false };
  const matches: PlaceMatch[] = [];
  let withheld = 0;
  let exactWithheld = false;
  const seen = new Set<string>();
  for (const record of records) {
    const code = normalizePostcode(record.code);
    if (!code.startsWith(folded)) continue;
    const license = postcodeLicense(record);
    if (!license.ok) {
      withheld += 1;
      if (code === folded) exactWithheld = true;
      continue;
    }
    const place = catalog.byId.get(record.placeId);
    if (!place) continue;
    const key = `${code}\u0000${place.placeId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const match = matchFromPlace(catalog, place, 'postcode', code);
    match.postcode = { code, license: license.license, attribution: license.attribution };
    match.accessibleName = `${match.accessibleName}, license ${license.license}`;
    match.uncertainty = [...match.uncertainty, `Postal code ${code} is included under ${license.license}.`];
    matches.push(match);
  }
  matches.sort((left, right) => (left.postcode?.code ?? '').localeCompare(right.postcode?.code ?? '') || left.contextLabel.localeCompare(right.contextLabel));
  markDuplicates(matches);
  const total = matches.length;
  return {
    matches: matches.slice(0, limit),
    truncated: total > limit,
    total,
    withheld,
    exactWithheld,
  };
}

function selectionFrom(match: PlaceMatch, entry: PlaceSelection['entry'], coordinates: PlaceSelection['coordinates']): PlaceSelection {
  return {
    ...match,
    schema: PLACE_SELECTION_SCHEMA,
    scope: 'place',
    entry,
    applicability: APPLICABILITY,
    coordinates,
    uncertainty: [...match.uncertainty],
  };
}

function worldwideSelection(): PlaceSelection {
  return {
    schema: PLACE_SELECTION_SCHEMA,
    scope: 'worldwide',
    entry: 'worldwide',
    applicability: APPLICABILITY,
    placeId: 'worldwide',
    name: 'Worldwide',
    levelKind: 'worldwide',
    levelLabel: 'worldwide',
    language: null,
    nativeAlias: null,
    nativeLanguage: null,
    parentKnowledge: 'none',
    parents: [],
    contextLabel: 'Worldwide',
    parentLine: NO_PARENT,
    accessibleName: 'Worldwide, no administrative parent',
    matchKind: 'browse',
    matchedText: null,
    duplicateName: false,
    uncertainty: [NOT_APPLICABILITY],
    postcode: null,
    pointReasons: [],
    coordinates: null,
  };
}

function moveIndex(current: number, count: number, key: string): number | null {
  if (count <= 0) return null;
  if (key === 'ArrowDown') return current < 0 ? 0 : Math.min(count - 1, current + 1);
  if (key === 'ArrowUp') return current <= 0 ? (current < 0 ? count - 1 : 0) : current - 1;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return null;
}

function typeAhead(matches: readonly PlaceMatch[], active: number, key: string): number | null {
  if (key.length !== 1 || !/[\p{L}\p{N}]/u.test(key)) return null;
  const needle = key.toLocaleLowerCase();
  const start = active < 0 ? 0 : active + 1;
  const order = [...matches.slice(start), ...matches.slice(0, Math.max(start, 0))];
  const found = order.find((match) => (match.name ?? match.placeId).toLocaleLowerCase().startsWith(needle));
  if (!found) return active;
  return matches.indexOf(found);
}

function OptionBody({ match, committed }: { match: PlaceMatch; committed: boolean }) {
  return (
    <>
      <span>{match.contextLabel}</span>
      {match.nativeAlias ? (
        <span className="place-picker-alias" lang={match.nativeLanguage ?? undefined}>
          {match.nativeAlias}
        </span>
      ) : null}
      <span>
        {match.levelLabel}
        {match.parentLine ? ` · ${match.parentLine}` : ''}
        {match.postcode ? ` · ${match.postcode.code} · ${match.postcode.license}` : ''}
        {match.pointReasons.length > 0 ? ` · ${match.pointReasons.join(', ')}` : ''}
      </span>
      {match.duplicateName ? <span>Another place uses this name.</span> : null}
      {committed ? <span>Selected</span> : null}
    </>
  );
}

function PlaceOptions({
  listId,
  label,
  hintId,
  hint,
  matches,
  active,
  committedId,
  onActive,
  onCommit,
  listRef,
  extraKeys,
  activateOnFocus = true,
}: {
  listId: string;
  label: string;
  hintId: string;
  hint: string;
  matches: readonly PlaceMatch[];
  active: number;
  committedId: string | null;
  onActive: (index: number) => void;
  onCommit: (match: PlaceMatch) => void;
  listRef?: RefObject<HTMLDivElement>;
  extraKeys?: (event: ReactKeyboardEvent<HTMLDivElement>, match: PlaceMatch | null) => boolean;
  activateOnFocus?: boolean;
}) {
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const typed = typeAhead(matches, active, event.key);
    if (typed !== null && event.key.length === 1) {
      event.preventDefault();
      onActive(typed);
      return;
    }
    const moved = moveIndex(active, matches.length, event.key);
    if (moved !== null) {
      event.preventDefault();
      onActive(moved);
      return;
    }
    const current = active >= 0 ? matches[active] ?? null : null;
    if (extraKeys?.(event, current)) return;
    if ((event.key === 'Enter' || event.key === ' ') && current) {
      event.preventDefault();
      onCommit(current);
    }
  };
  const activeId = active >= 0 && matches[active] ? `${listId}-option-${matches[active].placeId}` : undefined;
  return (
    <>
      <p id={hintId}>{hint}</p>
      <div
        id={listId}
        ref={listRef}
        role="listbox"
        aria-label={label}
        aria-describedby={hintId}
        aria-activedescendant={activeId}
        aria-orientation="vertical"
        tabIndex={0}
        className="place-picker-list"
        onKeyDown={onKeyDown}
        onFocus={() => {
          if (activateOnFocus && active < 0 && matches.length > 0) onActive(0);
        }}
      >
        {matches.map((match, index) => {
          const committed = match.placeId === committedId;
          const id = `${listId}-option-${match.placeId}`;
          return (
            <div
              id={id}
              key={match.placeId}
              role="option"
              aria-selected={committed}
              aria-label={committed ? `${match.accessibleName}, selected` : match.accessibleName}
              data-active={index === active ? 'true' : 'false'}
              data-committed={committed ? 'true' : 'false'}
              data-level={match.levelKind}
              className="place-picker-option"
              onMouseEnter={() => onActive(index)}
              onClick={() => onCommit(match)}
            >
              <OptionBody match={match} committed={committed} />
            </div>
          );
        })}
      </div>
    </>
  );
}

export default function PlacePicker({
  graph,
  asOf,
  geometries = null,
  index: indexProp = null,
  postcodes = null,
  viewIds = [],
  placeState = null,
  onPlaceState,
  onSelect,
}: PlacePickerProps) {
  const reactId = useId().replace(/:/g, '');
  const headingId = `${reactId}-heading`;
  const searchId = `${reactId}-search`;
  const searchListId = `${reactId}-search-list`;
  const postalId = `${reactId}-postal`;
  const postalListId = `${reactId}-postal-list`;
  const countryListId = `${reactId}-countries`;
  const regionListId = `${reactId}-regions`;
  const municipalListId = `${reactId}-municipalities`;
  const pointListId = `${reactId}-points`;
  const liveId = `${reactId}-live`;
  const countryRef = useRef<HTMLDivElement>(null);
  const regionRef = useRef<HTMLDivElement>(null);
  const municipalRef = useRef<HTMLDivElement>(null);
  const pointRef = useRef<HTMLDivElement>(null);
  const viewKey = viewIds.join('\u0000');
  const catalog = useMemo(() => buildPlaceCatalog(graph, asOf, viewIds), [graph, asOf, viewKey]);
  const geometryKey = geometries?.map((record) => record.geometryRef).join('\u0000') ?? '';
  const indexed = useMemo(() => {
    if (indexProp) return { index: indexProp, error: null as string | null };
    if (!geometries || geometries.length === 0) return { index: null, error: null as string | null };
    try {
      return {
        index: buildPlaceIndex({ graph, geometries, cellDegrees: 1, borderToleranceDegrees: 0 }),
        error: null as string | null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The boundary pack could not be indexed.';
      return { index: null, error: message };
    }
  }, [graph, geometries, geometryKey, indexProp]);
  const licenseSummary = useMemo(() => {
    const records = postcodes ?? [];
    let licensed = 0;
    let withheld = 0;
    for (const record of records) {
      if (postcodeLicense(record).ok) licensed += 1;
      else withheld += 1;
    }
    return { licensed, withheld, supplied: postcodes !== null && postcodes !== undefined };
  }, [postcodes]);

  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchActive, setSearchActive] = useState(-1);
  const [postalQuery, setPostalQuery] = useState('');
  const [postalOpen, setPostalOpen] = useState(false);
  const [postalActive, setPostalActive] = useState(-1);
  const [drillCountry, setDrillCountry] = useState<string | null>(null);
  const [drillRegion, setDrillRegion] = useState<string | null>(null);
  const [countryActive, setCountryActive] = useState(-1);
  const [regionActive, setRegionActive] = useState(-1);
  const [municipalActive, setMunicipalActive] = useState(-1);
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [pointMessage, setPointMessage] = useState('');
  const [pointMatches, setPointMatches] = useState<PlaceMatch[]>([]);
  const [pointActive, setPointActive] = useState(-1);
  const [pointFocus, setPointFocus] = useState(0);
  const [committed, setCommitted] = useState<PlaceSelection | null>(null);
  const [announcement, setAnnouncement] = useState('Place selection is manual. No location request was made.');

  const search = useMemo(() => searchPlaces(catalog, query), [catalog, query]);
  const postal = useMemo(() => searchPostcodes(catalog, postcodes, postalQuery), [catalog, postcodes, postalQuery]);
  const countries = useMemo(
    () => catalog.countries.flatMap((id) => {
      const place = catalog.byId.get(id);
      return place ? [matchFromPlace(catalog, place, 'browse', place.name)] : [];
    }),
    [catalog],
  );
  const regions = useMemo(() => browseChildren(catalog, drillCountry, 'regional'), [catalog, drillCountry]);
  const municipalities = useMemo(() => {
    if (drillRegion) return browseChildren(catalog, drillRegion, 'municipal');
    return browseChildren(catalog, drillCountry, 'municipal');
  }, [catalog, drillCountry, drillRegion]);

  useEffect(() => {
    setSearchActive(search.matches.length === 1 ? 0 : -1);
  }, [query, search.matches.length, search.matches.map((match) => match.placeId).join('|')]);
  useEffect(() => {
    setPostalActive(postal.matches.length === 1 ? 0 : -1);
  }, [postalQuery, postal.matches.length, postal.matches.map((match) => match.placeId).join('|')]);
  useEffect(() => {
    if (pointFocus === 0) return;
    pointRef.current?.focus();
  }, [pointFocus, pointMatches.length]);

  const countryName = drillCountry ? catalog.byId.get(drillCountry)?.name ?? drillCountry : null;
  const regionName = drillRegion ? catalog.byId.get(drillRegion)?.name ?? drillRegion : null;
  const displayedLabel = committed?.contextLabel ?? placeState?.label ?? (placeState?.placeId ? placeState.placeId : null);
  const displayedOrigin = committed
    ? placeState?.origin === 'manual' && placeState.placeId === committed.placeId
      ? placeState.originLabel
      : 'manually selected'
    : placeState?.originLabel ?? 'unselected worldwide';
  const committedId = committed?.scope === 'place' ? committed.placeId : placeState?.placeId ?? null;

  function announce(message: string) {
    setAnnouncement(message);
  }

  function commit(match: PlaceMatch, entry: PlaceSelection['entry'], coordinates: PlaceSelection['coordinates'] = null) {
    const selection = selectionFrom(match, entry, coordinates);
    if (entry === 'coordinates') selection.coordinates = coordinates;
    setCommitted(selection);
    announce(`Selected ${selection.contextLabel}. Manually selected. ${NOT_APPLICABILITY}`);
    onSelect?.(selection);
    if (placeState && onPlaceState && selection.scope === 'place') {
      onPlaceState(selectPlace(placeState, {
        placeId: selection.placeId,
        label: selection.contextLabel,
        uncertainty: selection.uncertainty,
      }));
    }
    if (entry === 'search') setSearchOpen(false);
    if (entry === 'postcode') setPostalOpen(false);
  }

  function commitWorldwide() {
    const selection = worldwideSelection();
    setCommitted(selection);
    announce(`Selected worldwide search. ${NOT_APPLICABILITY}`);
    onSelect?.(selection);
    if (placeState && onPlaceState) onPlaceState(selectWorldwide(placeState));
  }

  function chooseMatch(matches: readonly PlaceMatch[], active: number, entry: PlaceSelection['entry']) {
    if (active >= 0 && matches[active]) {
      commit(matches[active], entry);
      return;
    }
    if (matches.length === 1) {
      commit(matches[0], entry);
      return;
    }
    if (matches.length > 1) announce(CHOOSE_MATCH);
  }

  function onSearchKey(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      setSearchOpen(true);
      const moved = moveIndex(searchActive, search.matches.length, event.key);
      if (moved !== null) setSearchActive(moved);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      if (searchOpen) {
        setSearchOpen(false);
        setSearchActive(search.matches.length === 1 ? 0 : -1);
      } else {
        setQuery('');
      }
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      chooseMatch(search.matches, searchActive, 'search');
    }
  }

  function onPostalKey(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      setPostalOpen(true);
      const moved = moveIndex(postalActive, postal.matches.length, event.key);
      if (moved !== null) setPostalActive(moved);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      if (postalOpen) setPostalOpen(false);
      else setPostalQuery('');
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (postal.matches.length === 0 && postal.exactWithheld) {
        announce('This postal code is in an unlicensed dataset and was withheld.');
        return;
      }
      chooseMatch(postal.matches, postalActive, 'postcode');
    }
  }

  function drillFromCountry(match: PlaceMatch | null, focusNext: boolean) {
    if (!match) return;
    setDrillCountry(match.placeId);
    setDrillRegion(null);
    setRegionActive(0);
    setMunicipalActive(-1);
    if (focusNext) regionRef.current?.focus();
  }

  function drillFromRegion(match: PlaceMatch | null, focusNext: boolean) {
    if (!match) return;
    setDrillRegion(match.placeId);
    setMunicipalActive(0);
    if (focusNext) municipalRef.current?.focus();
  }

  function submitCoordinates(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPointMatches([]);
    setPointActive(-1);
    if (latitude.includes(',') || longitude.includes(',')) {
      const message = 'Use a dot for the decimal mark.';
      setPointMessage(message);
      announce(message);
      return;
    }
    const lat = /^[+-]?\d+(?:\.\d+)?$/.test(latitude.trim()) ? Number(latitude.trim()) : Number.NaN;
    const lon = /^[+-]?\d+(?:\.\d+)?$/.test(longitude.trim()) ? Number(longitude.trim()) : Number.NaN;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      const message = 'Enter a latitude and a longitude.';
      setPointMessage(message);
      announce(message);
      return;
    }
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      const message = 'Latitude must be from -90 through 90 and longitude from -180 through 180.';
      setPointMessage(message);
      announce(message);
      return;
    }
    if (!indexed.index) {
      const message = indexed.error
        ?? 'Coordinates need a local boundary pack. Choose a country, region, or municipality instead.';
      setPointMessage(message);
      announce(message);
      return;
    }
    let resolution: PointResolution;
    try {
      resolution = resolvePoint(indexed.index, {
        latitude: lat,
        longitude: lon,
        asOf: catalog.asOf,
        viewIds,
        borderToleranceDegrees: 0,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The point could not be resolved.';
      setPointMessage(message);
      announce(message);
      return;
    }
    const matches = resolution.candidates.flatMap((hit) => {
      const place = catalog.byId.get(hit.placeId);
      if (!place) return [];
      const match = matchFromPlace(catalog, place, 'coordinates', place.name);
      match.pointReasons = [...hit.reasons];
      return [match];
    });
    matches.sort((left, right) => right.parents.length - left.parents.length || left.contextLabel.localeCompare(right.contextLabel));
    const municipal = matches.some((match) => MUNICIPAL_LEVELS.has(match.levelKind));
    for (const match of matches) {
      if (resolution.status === 'border-uncertain') match.uncertainty = [...match.uncertainty, BORDER_POINT];
      if (matches.length > 1) match.uncertainty = [...match.uncertainty, OTHER_CONTAINS];
      if (!municipal) match.uncertainty = [...match.uncertainty, NO_CITY_INVENTED];
      for (const note of resolution.uncertainty) {
        if (!match.uncertainty.includes(note)) match.uncertainty.push(note);
      }
    }
    setPointMatches(matches);
    setPointActive(matches.length === 1 ? 0 : -1);
    let message: string;
    if (resolution.status === 'invalid-point') message = 'Those coordinates are not a usable point.';
    else if (matches.length === 0) message = 'No place contains this point. Choose a country, region, or municipality from the lists.';
    else if (resolution.status === 'border-uncertain') message = `${BORDER_POINT} ${matches.length} places are listed with their parent context.`;
    else if (!municipal) message = `${matches.length === 1 ? 'One place contains this point.' : `${matches.length} places contain this point.`} ${NO_CITY_INVENTED}`;
    else message = matches.length === 1
      ? 'One place contains this point. Press Enter to select it. The parent context stays on the line.'
      : CHOOSE_POINT;
    setPointMessage(message);
    announce(message);
    if (matches.length > 0) setPointFocus((ticket) => ticket + 1);
  }

  function commitPoint(match: PlaceMatch) {
    const lat = Number(latitude.trim());
    const lon = Number(longitude.trim());
    const coordinates = Number.isFinite(lat) && Number.isFinite(lon) ? { latitude: lat, longitude: lon } : null;
    commit(match, 'coordinates', coordinates);
  }

  const searchHint = !query.trim()
    ? 'Type a name, a native alias, or a code.'
    : search.matches.length === 0
      ? 'No place matches that name.'
      : search.truncated
        ? `Showing ${search.matches.length} of ${search.total} places.`
        : search.matches.some((match) => match.duplicateName)
          ? 'Duplicate names need a choice. The parent context is part of each line.'
          : `${search.matches.length} places match.`;
  const postalHint = !licenseSummary.supplied
    ? 'Postal codes stay unavailable until a licensed postal dataset is supplied.'
    : licenseSummary.licensed === 0
      ? licenseSummary.withheld === 1
        ? '1 postal code was withheld because it is not licensed.'
        : licenseSummary.withheld > 1
          ? `${licenseSummary.withheld} postal codes were withheld because they are not licensed.`
          : 'The postal dataset has no codes.'
      : licenseSummary.withheld === 1
        ? 'Licensed postal codes only. 1 unlicensed code was withheld.'
        : licenseSummary.withheld > 1
          ? `Licensed postal codes only. ${licenseSummary.withheld} unlicensed codes were withheld.`
          : 'Licensed postal codes only.';
  const postalQueryHint = postalQuery.trim()
    ? postal.matches.length === 0
      ? postal.exactWithheld
        ? 'This postal code is in an unlicensed dataset and was withheld.'
        : 'No licensed postal code matches.'
      : postal.matches.some((match) => match.duplicateName)
        ? 'This postal code matches more than one place. Choose the parent context you mean.'
        : `${postal.matches.length} licensed postal matches.`
    : postalHint;

  const regionLabel = countryName ? `Regions in ${countryName}` : 'Regions';
  const municipalLabel = regionName
    ? `Municipalities in ${regionName}`
    : countryName
      ? `Municipalities in ${countryName}`
      : 'Municipalities';
  const regionHint = countryName
    ? regions.length > 0
      ? `Regions in ${countryName}. Arrow right opens municipalities.`
      : `${countryName} has no regional places in this catalog.`
    : 'Choose a country to see its regions.';
  const municipalHint = municipalities.length > 0
    ? 'Municipalities keep their region and country on each line.'
    : regionName
      ? `${regionName} has no municipalities in this catalog.`
      : countryName
        ? `Choose a region in ${countryName} to see its municipalities.`
        : 'Choose a country, then a region, to see municipalities.';

  return (
    <section className="place-picker" aria-labelledby={headingId} data-place-picker="manual">
      <style>{STYLES}</style>
      <h2 id={headingId}>Change place</h2>
      <p>
        Choose a country, region, or municipality. Arrow keys move, Enter chooses, and Escape closes a list.
        This control does not use a map or request your location.
      </p>
      {catalog.issue ? <p role="alert">{catalog.issue}</p> : null}
      <p id={liveId} role="status" aria-live="polite">{announcement}</p>
      <p>
        Current place: {displayedLabel ?? 'None yet'}. {displayedOrigin}.
      </p>
      {committed?.postcode ? (
        <p>
          Chosen from postal code {committed.postcode.code}. License {committed.postcode.license}.
          {committed.postcode.attribution ? ` ${committed.postcode.attribution}.` : ''}
        </p>
      ) : null}
      {committed?.entry === 'coordinates' ? <p>Chosen from coordinates. The numbers stay off the shared link.</p> : null}
      {committed?.entry === 'search' && committed.nativeAlias ? <p>Native name {committed.nativeAlias}.</p> : null}
      {committed && committed.scope === 'place' ? (
        <ul>
          {committed.uncertainty.map((note) => <li key={note}>{note}</li>)}
        </ul>
      ) : (
        <ul>
          {catalog.uncertainty.map((note) => <li key={note}>{note}</li>)}
        </ul>
      )}

      <div className="place-picker-field">
        <label htmlFor={searchId}>Search places by name or native alias</label>
        <input
          id={searchId}
          role="combobox"
          type="text"
          value={query}
          aria-expanded={searchOpen && query.trim().length > 0}
          aria-controls={searchListId}
          aria-autocomplete="list"
          aria-activedescendant={searchOpen && searchActive >= 0 && search.matches[searchActive] ? `${searchListId}-option-${search.matches[searchActive].placeId}` : undefined}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          onChange={(event) => {
            setQuery(event.target.value);
            setSearchOpen(true);
          }}
          onKeyDown={onSearchKey}
        />
        <p id={`${searchId}-hint`}>{searchHint}</p>
        {searchOpen && query.trim() ? (
          <PlaceOptions
            listId={searchListId}
            label="Place name suggestions"
            hintId={`${searchId}-list-hint`}
            hint="Name suggestions keep native aliases and parent context."
            matches={search.matches}
            active={searchActive}
            committedId={committedId}
            onActive={setSearchActive}
            onCommit={(match) => commit(match, 'search')}
          />
        ) : null}
      </div>

      <div className="place-picker-columns">
        <div className="place-picker-column">
          <h3>Country</h3>
          <PlaceOptions
            listId={countryListId}
            label="Countries"
            hintId={`${countryListId}-hint`}
            hint={countries.length > 0 ? 'Countries. Arrow right shows regions.' : 'No countries are in this catalog.'}
            matches={countries}
            active={countryActive}
            committedId={committedId}
            listRef={countryRef}
            onActive={setCountryActive}
            onCommit={(match) => {
              commit(match, 'browse');
              drillFromCountry(match, false);
            }}
            extraKeys={(event, match) => {
              if (event.key !== 'ArrowRight') return false;
              event.preventDefault();
              drillFromCountry(match ?? countries[0] ?? null, true);
              return true;
            }}
          />
        </div>
        <div className="place-picker-column">
          <h3>Region</h3>
          <PlaceOptions
            listId={regionListId}
            label={regionLabel}
            hintId={`${regionListId}-hint`}
            hint={regionHint}
            matches={regions}
            active={regionActive}
            committedId={committedId}
            listRef={regionRef}
            onActive={setRegionActive}
            onCommit={(match) => {
              commit(match, 'browse');
              drillFromRegion(match, false);
            }}
            extraKeys={(event, match) => {
              if (event.key === 'ArrowLeft') {
                event.preventDefault();
                countryRef.current?.focus();
                return true;
              }
              if (event.key !== 'ArrowRight') return false;
              event.preventDefault();
              if (match) drillFromRegion(match, true);
              else municipalRef.current?.focus();
              return true;
            }}
          />
        </div>
        <div className="place-picker-column">
          <h3>Municipality</h3>
          <PlaceOptions
            listId={municipalListId}
            label={municipalLabel}
            hintId={`${municipalListId}-hint`}
            hint={municipalHint}
            matches={municipalities}
            active={municipalActive}
            committedId={committedId}
            listRef={municipalRef}
            onActive={setMunicipalActive}
            onCommit={(match) => commit(match, 'browse')}
            extraKeys={(event) => {
              if (event.key !== 'ArrowLeft') return false;
              event.preventDefault();
              regionRef.current?.focus();
              return true;
            }}
          />
        </div>
      </div>

      <div className="place-picker-field">
        <label htmlFor={postalId}>Postal code</label>
        <input
          id={postalId}
          role="combobox"
          type="text"
          value={postalQuery}
          disabled={licenseSummary.licensed === 0}
          aria-expanded={postalOpen && postalQuery.trim().length > 0}
          aria-controls={postalListId}
          aria-autocomplete="list"
          aria-describedby={`${postalId}-hint`}
          aria-activedescendant={postalOpen && postalActive >= 0 && postal.matches[postalActive] ? `${postalListId}-option-${postal.matches[postalActive].placeId}` : undefined}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => {
            setPostalQuery(event.target.value);
            setPostalOpen(true);
          }}
          onKeyDown={onPostalKey}
        />
        <p id={`${postalId}-hint`}>{postalQueryHint}</p>
        {postalOpen && postalQuery.trim() && licenseSummary.licensed > 0 ? (
          <PlaceOptions
            listId={postalListId}
            label="Postal code suggestions"
            hintId={`${postalId}-list-hint`}
            hint="Licensed postal matches keep the full parent context."
            matches={postal.matches}
            active={postalActive}
            committedId={committedId}
            onActive={setPostalActive}
            onCommit={(match) => commit(match, 'postcode')}
          />
        ) : null}
      </div>

      <form aria-label="Coordinates" onSubmit={submitCoordinates}>
        <div className="place-picker-coordinates">
          <div className="place-picker-field">
            <label htmlFor={`${reactId}-lat`}>Latitude</label>
            <input
              id={`${reactId}-lat`}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={latitude}
              onChange={(event) => setLatitude(event.target.value)}
            />
          </div>
          <div className="place-picker-field">
            <label htmlFor={`${reactId}-lon`}>Longitude</label>
            <input
              id={`${reactId}-lon`}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={longitude}
              onChange={(event) => setLongitude(event.target.value)}
            />
          </div>
          <button type="submit">Find places at these coordinates</button>
        </div>
      </form>
      {pointMessage ? <p role="status">{pointMessage}</p> : null}
      {pointMatches.length > 0 ? (
        <PlaceOptions
          listId={pointListId}
          label="Places at these coordinates"
          hintId={`${pointListId}-hint`}
          hint="Coordinate matches keep their parent context. Nothing is selected until you choose a row."
          matches={pointMatches}
          active={pointActive}
          committedId={committedId}
          listRef={pointRef}
          onActive={setPointActive}
          activateOnFocus={false}
          onCommit={commitPoint}
          extraKeys={(event, match) => {
            if (event.key !== 'Enter' && event.key !== ' ') return false;
            event.preventDefault();
            if (!match) {
              announce(CHOOSE_POINT);
              return true;
            }
            commitPoint(match);
            return true;
          }}
        />
      ) : null}

      <button type="button" onClick={commitWorldwide}>Search worldwide</button>
      <CatalogNotes catalog={catalog} />
    </section>
  );
}

function CatalogNotes({ catalog }: { catalog: PlaceCatalog }) {
  const notes = catalog.uncertainty.filter((note) => note !== NOT_APPLICABILITY);
  if (notes.length === 0) return null;
  return (
    <div>
      {notes.map((note) => <p key={note}>{note}</p>)}
    </div>
  );
}

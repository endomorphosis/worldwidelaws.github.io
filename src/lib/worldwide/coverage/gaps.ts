/**
 * Geography and corpus coverage gaps.
 *
 * A requested level with no coverage cell is one geography gap.
 * A cell whose state is missing, unknown, or unavailable is one corpus gap.
 * known, partial, and searched are not corpus gaps.
 * A coverage gap is not a finding that no law exists.
 *
 * Place ids are copied from the cell that already carries one.
 * A requested level with no cell has no place id to copy.
 */

export const COVERAGE_GAP_SCHEMA = 'worldwide-legal-search.coverage-gap-list@1';

export type CoverageGapKind = 'geography' | 'corpus';

export interface CoverageGap {
  kind: CoverageGapKind;
  level: string;
  placeId: string;
  sentence: string;
}

/** Cell fields this reader understands. Catalog cells use coverage_state and jurisdiction_id. */
export interface CoverageGapCell {
  level?: unknown;
  state?: unknown;
  coverage_state?: unknown;
  placeId?: unknown;
  place_id?: unknown;
  jurisdictionId?: unknown;
  jurisdiction_id?: unknown;
}

export interface CoverageGapList {
  geography: CoverageGap[];
  corpus: CoverageGap[];
}

const CORPUS_GAP_STATES = new Set(['missing', 'unknown', 'unavailable']);

function presentString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text.length > 0 ? text : null;
}

function cellLevel(cell: CoverageGapCell): string | null {
  return presentString(cell.level);
}

function cellState(cell: CoverageGapCell): string | null {
  if ('state' in cell && cell.state != null) return presentString(cell.state);
  return presentString(cell.coverage_state);
}

function cellPlaceId(cell: CoverageGapCell): string {
  for (const value of [cell.placeId, cell.place_id, cell.jurisdictionId, cell.jurisdiction_id]) {
    const id = presentString(value);
    if (id) return id;
  }
  return '';
}

function gapSentence(detail: string): string {
  return `${detail} That is a coverage gap, not a finding that no law exists.`;
}

export function gapsFromCoverageCells(
  cells: readonly CoverageGapCell[],
  requestedLevels: readonly string[],
): CoverageGapList {
  const list = Array.isArray(cells) ? cells : [];
  const levelsWithCells = new Set<string>();
  for (const cell of list) {
    const level = cellLevel(cell);
    if (level) levelsWithCells.add(level);
  }

  const geography: CoverageGap[] = [];
  const seenRequested = new Set<string>();
  const requested = Array.isArray(requestedLevels) ? requestedLevels : [];
  for (const requestedLevel of requested) {
    const level = presentString(requestedLevel);
    if (!level || seenRequested.has(level)) continue;
    seenRequested.add(level);
    if (levelsWithCells.has(level)) continue;
    geography.push({
      kind: 'geography',
      level,
      placeId: '',
      sentence: gapSentence(`No coverage cell exists for ${level}.`),
    });
  }

  const corpus: CoverageGap[] = [];
  for (const cell of list) {
    const level = cellLevel(cell);
    const state = cellState(cell);
    if (!level || !state || !CORPUS_GAP_STATES.has(state)) continue;
    corpus.push({
      kind: 'corpus',
      level,
      placeId: cellPlaceId(cell),
      sentence: gapSentence(`No searched collection is recorded for ${level}.`),
    });
  }

  return { geography, corpus };
}

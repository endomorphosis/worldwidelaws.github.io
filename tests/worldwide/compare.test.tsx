/**
 * Explicit cross-place comparison.
 * Two manually selected places keep aligned dates, sources, and coverage
 * gaps. Results keep the place they name. Contradictory local rules are
 * not merged into one answer.
 */

import { jest } from '@jest/globals';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { parseRoute } from '../../src/lib/worldwide/routes';
import { resultCopy } from '../../src/components/worldwide/SearchFilters';
import { NOT_A_FINDING, COUNTED_ZERO, textImpliesNoLaw } from '../../src/components/worldwide/CoveragePage';
import {
  COMPARE_APPLICABILITY,
  COMPARE_DEPENDENCY,
  COMPARE_LIMITATIONS,
  COMPARE_SCHEMA,
  ComparePlaces,
  assertedComparisonAnswer,
  compareCopy,
  composePlaceComparison,
  type ComparePlaceInput,
  type CompareResultInput,
  type CompareView,
} from '../../src/components/worldwide/ComparePlaces';

const AMSTERDAM = 'place:amsterdam';
const ROTTERDAM = 'place:rotterdam';
const NATIONAL = 'endomorphosis/national-laws';
const REGIONAL = 'endomorphosis/regional-laws';
const AMS_LOCAL = 'endomorphosis/amsterdam-ordinances';
const RTM_LOCAL = 'endomorphosis/rotterdam-ordinances';
const REV_A = 'a'.repeat(40);
const REV_B = 'b'.repeat(40);
const REV_C = 'c'.repeat(40);
const LEFT_RULE = 'Overnight parking is prohibited.';
const RIGHT_RULE = 'Overnight parking is permitted.';
const MERGED = 'Both cities prohibit overnight parking.';
const SNEAKY = 'Bicycles may use the quay.';
const CONFLICT = 'This record names Amsterdam and Rotterdam at once.';
const OUTSIDE = 'This rule belongs to Utrecht.';

const fetchHost = globalThis as { fetch?: typeof fetch };
let originalFetch: typeof fetch | undefined;

function column(side: 'left' | 'right'): HTMLElement {
  const element = document.querySelector(`[data-field="place-column"][data-side="${side}"]`);
  if (!element) throw new Error(`missing ${side} column`);
  return element as HTMLElement;
}

function values(name: string, root: ParentNode): string[] {
  return [...root.querySelectorAll(`[data-field="${name}"]`)].map((element) => element.getAttribute('data-source-id')
    ?? element.getAttribute('data-level')
    ?? element.getAttribute('data-value')
    ?? '');
}

function stringsOf(value: unknown, found: string[] = []): string[] {
  if (typeof value === 'string') found.push(value);
  else if (Array.isArray(value)) value.forEach((item) => stringsOf(item, found));
  else if (value && typeof value === 'object') Object.values(value).forEach((item) => stringsOf(item, found));
  return found;
}

function result(overrides: Partial<CompareResultInput> & Pick<CompareResultInput, 'recordId' | 'text'>): CompareResultInput {
  return {
    placeId: AMSTERDAM,
    jurisdictionId: AMSTERDAM,
    level: 'municipal',
    topic: 'overnight parking',
    norm: 'prohibit',
    sourceId: AMS_LOCAL,
    sourceRevision: REV_B,
    date: '2024-01-01',
    ...overrides,
  };
}

function amsterdam(overrides: Partial<ComparePlaceInput> = {}): ComparePlaceInput {
  return {
    placeId: AMSTERDAM,
    label: 'Amsterdam',
    origin: 'manual',
    levelKind: 'municipality',
    parents: [
      { placeId: 'place:north-holland', label: 'North Holland', levelKind: 'region' },
      { placeId: 'place:netherlands', label: 'Netherlands', levelKind: 'country' },
    ],
    asOf: '2026-10-26',
    sources: [
      { sourceId: NATIONAL, revision: REV_A, label: 'National laws', level: 'national', retrievedAt: '2026-01-15' },
      { sourceId: AMS_LOCAL, revision: REV_B, label: 'Amsterdam ordinances', level: 'municipal', retrievedAt: '2026-02-01' },
    ],
    coverage: [
      { jurisdictionId: AMSTERDAM, level: 'national', state: 'known', sourceIds: [NATIONAL], indexedRecords: 5 },
      { jurisdictionId: AMSTERDAM, level: 'regional', state: 'partial', sourceIds: [REGIONAL], indexedRecords: 1 },
      { jurisdictionId: AMSTERDAM, level: 'municipal', state: 'missing', sourceIds: [] },
    ],
    results: [
      result({ recordId: 'ams-park-1', title: 'Amsterdam overnight parking', text: LEFT_RULE }),
      result({
        recordId: 'nl-traffic-1',
        title: 'National traffic act',
        text: 'National traffic rules are issued by the state.',
        level: 'national',
        topic: 'traffic',
        norm: 'require',
        sourceId: NATIONAL,
        sourceRevision: REV_A,
        date: '2026-10-26',
      }),
    ],
    ...overrides,
  };
}

function rotterdam(overrides: Partial<ComparePlaceInput> = {}): ComparePlaceInput {
  return {
    placeId: ROTTERDAM,
    label: 'Rotterdam',
    origin: 'manual',
    levelKind: 'municipality',
    parents: [
      { placeId: 'place:south-holland', label: 'South Holland', levelKind: 'region' },
      { placeId: 'place:netherlands', label: 'Netherlands', levelKind: 'country' },
    ],
    asOf: '2026-10-26',
    sources: [
      { sourceId: NATIONAL, revision: REV_C, label: 'National laws', level: 'national', retrievedAt: '2026-06-01' },
      { sourceId: RTM_LOCAL, revision: REV_B, label: 'Rotterdam ordinances', level: 'municipal', retrievedAt: '2026-03-04' },
    ],
    coverage: [
      { jurisdictionId: ROTTERDAM, level: 'national', state: 'known', sourceIds: [NATIONAL], indexedRecords: 5 },
      { jurisdictionId: ROTTERDAM, level: 'regional', state: 'known', sourceIds: [REGIONAL], indexedRecords: 2 },
      { jurisdictionId: ROTTERDAM, level: 'municipal', state: 'known', sourceIds: [RTM_LOCAL], indexedRecords: 4 },
    ],
    results: [
      result({
        recordId: 'rtm-park-1',
        placeId: ROTTERDAM,
        jurisdictionId: ROTTERDAM,
        title: 'Rotterdam overnight parking',
        text: RIGHT_RULE,
        norm: 'permit',
        sourceId: RTM_LOCAL,
        sourceRevision: REV_B,
        date: '2025-05-01',
      }),
    ],
    ...overrides,
  };
}

function renderCompare(extra: Partial<Parameters<typeof ComparePlaces>[0]> = {}) {
  return render(
    <ComparePlaces
      left={amsterdam()}
      right={rotterdam()}
      alignedDate="2026-10-26"
      query="parking"
      assertedAnswer={MERGED}
      mergedRule="The merged rule is that overnight parking is prohibited everywhere."
      merge
      {...extra}
    />,
  );
}

beforeEach(() => {
  originalFetch = fetchHost.fetch;
  fetchHost.fetch = jest.fn(() => Promise.reject(new Error('compare must not fetch'))) as typeof fetch;
});

afterEach(() => {
  cleanup();
  fetchHost.fetch = originalFetch;
});

describe('manual place comparison', () => {
  test('lines up two chosen places and refuses a merged answer', () => {
    const view = composePlaceComparison({
      left: amsterdam({
        results: [
          ...(amsterdam().results ?? []),
          result({
            recordId: 'rot-sneaky',
            placeId: ROTTERDAM,
            jurisdictionId: ROTTERDAM,
            text: SNEAKY,
            topic: 'quay',
            norm: 'permit',
            sourceId: RTM_LOCAL,
          }),
          result({
            recordId: 'conflict-1',
            placeId: AMSTERDAM,
            jurisdictionId: ROTTERDAM,
            text: CONFLICT,
            topic: 'identity',
          }),
          result({
            recordId: 'utrecht-1',
            placeId: 'place:utrecht',
            jurisdictionId: 'place:utrecht',
            text: OUTSIDE,
            topic: 'canals',
          }),
        ],
      }),
      right: rotterdam(),
      alignedDate: '2026-10-26',
      query: 'parking',
      assertedAnswer: MERGED,
      mergedRule: 'The merged rule is that overnight parking is prohibited everywhere.',
      merge: true,
    });
    expect(view.schema).toBe(COMPARE_SCHEMA);
    expect(view.applicability).toBe(COMPARE_APPLICABILITY);
    expect(view.ready).toBe(true);
    expect(view.assertedAnswer).toBeNull();
    expect(view.mergedAnswer).toBeNull();
    expect(view.mergesContradictoryRules).toBe(false);
    expect(view.refusedAssertion).toBe(true);
    expect(assertedComparisonAnswer(view)).toBeNull();
    expect(view.alignedDate).toMatchObject({ value: '2026-10-26', precision: 'day', mode: 'shared', sameInBothColumns: true });
    expect(view.columns.map((item) => item.placeId)).toEqual([AMSTERDAM, ROTTERDAM]);
    expect(view.columns.every((item) => item.manual && item.alignedDate === '2026-10-26')).toBe(true);

    const sourceIds = view.sources.map((row) => row.sourceId);
    expect(sourceIds).toEqual([...sourceIds].sort());
    expect(view.columns[0].sources.map((row) => row.present)).toEqual(view.sources.map((row) => row.left.present));
    const national = view.sources.find((row) => row.sourceId === NATIONAL);
    expect(national?.left.revision).toBe(REV_A);
    expect(national?.right.revision).toBe(REV_C);
    expect(national?.revisionsMatch).toBe(false);
    expect(national?.left.retrievedAt).toBe('2026-01-15');
    expect(national?.right.retrievedAt).toBe('2026-06-01');
    expect(view.sources.find((row) => row.sourceId === AMS_LOCAL)?.right.present).toBe(false);
    expect(view.sources.find((row) => row.sourceId === RTM_LOCAL)?.left.present).toBe(false);

    expect(view.coverage.map((row) => row.level)).toEqual(['national', 'regional', 'municipal']);
    expect(view.coverage.map((row) => row.left.level)).toEqual(view.coverage.map((row) => row.right.level));
    const municipal = view.coverage.find((row) => row.level === 'municipal');
    expect(municipal?.left.state).toBe('missing');
    expect(municipal?.left.sentence).toBe(resultCopy('en').municipal_gap);
    expect(municipal?.left.sourceIds).toEqual([]);
    expect(municipal?.right.state).toBe('known');
    expect(municipal?.right.sourceIds).toEqual([RTM_LOCAL]);
    expect(municipal?.left.impliesNoLaw).toBe(false);
    expect(textImpliesNoLaw(municipal?.left.sentence ?? '')).toBe(false);
    expect(textImpliesNoLaw(municipal?.right.sentence ?? '')).toBe(false);

    const leftTexts = view.columns[0].results.map((item) => item.text);
    const rightTexts = view.columns[1].results.map((item) => item.text);
    expect(leftTexts).toContain(LEFT_RULE);
    expect(leftTexts).not.toContain(RIGHT_RULE);
    expect(leftTexts).not.toContain(SNEAKY);
    expect(rightTexts).toContain(RIGHT_RULE);
    expect(rightTexts).toContain(SNEAKY);
    expect(rightTexts).not.toContain(LEFT_RULE);
    expect(view.columns[0].results.every((item) => item.placeId === AMSTERDAM && item.jurisdictionId === AMSTERDAM)).toBe(true);
    expect(view.columns[1].results.every((item) => item.placeId === ROTTERDAM && item.jurisdictionId === ROTTERDAM)).toBe(true);
    expect(view.quarantined.map((item) => item.reason).sort()).toEqual(['identity-conflict', 'outside']);
    expect(view.contradictions).toEqual(['overnight parking']);
    const parking = view.topics.find((topic) => topic.key === 'overnight parking');
    expect(parking).toMatchObject({ contradiction: true, merged: false, assertedAnswer: null });
    expect(parking?.left.map((rule) => rule.text)).toEqual([LEFT_RULE]);
    expect(parking?.right.map((rule) => rule.text)).toEqual([RIGHT_RULE]);
    expect(parking?.note).toBe(compareCopy('en').contradiction);
    for (const text of stringsOf(view)) {
      expect(text.includes(LEFT_RULE) && text.includes(RIGHT_RULE)).toBe(false);
      expect(text).not.toContain(MERGED);
      expect(text).not.toContain('prohibited everywhere');
    }
    const route = parseRoute(view.href ?? '');
    expect(route.name).toBe('compare');
    expect(route.comparePlaceIds).toEqual([AMSTERDAM, ROTTERDAM]);
    expect(route.date?.value).toBe('2026-10-26');
    expect(route.query).toBe('parking');
    expect(route.precise).toBeNull();
    expect(view.href).not.toMatch(/lat|lon|address|coordinate/i);
    expect(COMPARE_DEPENDENCY.searchRequiresCompare).toBe(false);
    expect(COMPARE_DEPENDENCY.mergesContradictoryRules).toBe(false);
    expect(COMPARE_LIMITATIONS.some((line) => line.includes('does not merge'))).toBe(true);
  });

  test('uses the coarser shared calendar label and keeps unshared dates apart', () => {
    const coarser = composePlaceComparison({
      left: amsterdam({ asOf: '2026' }),
      right: rotterdam({ asOf: '2026-10-26' }),
    });
    expect(coarser.alignedDate).toMatchObject({ mode: 'coarser', value: '2026', precision: 'year', sameInBothColumns: true });
    expect(coarser.columns[0].recordedDate).toBe('2026');
    expect(coarser.columns[1].recordedDate).toBe('2026-10-26');
    const parking = coarser.columns[0].results.find((item) => item.recordId === 'ams-park-1');
    const nationalResult = coarser.columns[0].results.find((item) => item.recordId === 'nl-traffic-1');
    expect(parking?.dateRelation).toBe('before');
    expect(nationalResult?.dateRelation).toBe('matches');

    const apart = composePlaceComparison({
      left: amsterdam({ asOf: '2024' }),
      right: rotterdam({ asOf: '2026-01-02' }),
    });
    expect(apart.alignedDate.mode).toBe('unshared');
    expect(apart.alignedDate.value).toBeNull();
    expect(apart.columns[0].recordedDate).toBe('2024');
    expect(apart.columns[1].recordedDate).toBe('2026-01-02');
    expect(apart.href?.includes('date=')).toBe(false);
  });

  test('does not treat a floating revision as the same source pin', () => {
    const view = composePlaceComparison({
      left: amsterdam({
        sources: [{ sourceId: NATIONAL, revision: 'latest', level: 'national' }],
      }),
      right: rotterdam({
        sources: [{ sourceId: NATIONAL, revision: 'latest', level: 'national' }],
      }),
    });
    const national = view.sources.find((row) => row.sourceId === NATIONAL);
    expect(national?.left.unpinned).toBe(true);
    expect(national?.right.unpinned).toBe(true);
    expect(national?.revisionsMatch).toBe(false);
    expect(national?.left.revision).toBeNull();
  });

  test('keeps an unknown municipal cell distinct from a missing one', () => {
    const view = composePlaceComparison({
      left: amsterdam(),
      right: rotterdam({
        coverage: [
          { jurisdictionId: ROTTERDAM, level: 'national', state: 'known', sourceIds: [NATIONAL], indexedRecords: 5 },
          { jurisdictionId: ROTTERDAM, level: 'regional', state: 'unknown', sourceIds: [] },
          { jurisdictionId: ROTTERDAM, level: 'municipal', state: 'unknown', sourceIds: [] },
        ],
      }),
    });
    const municipal = view.coverage.find((row) => row.level === 'municipal');
    expect(municipal?.left.state).toBe('missing');
    expect(municipal?.right.state).toBe('unknown');
    expect(municipal?.left.sentence).toBe(resultCopy('en').municipal_gap);
    expect(municipal?.right.sentence).not.toBe(municipal?.left.sentence);
    expect(municipal?.right.sentence).toContain(resultCopy('en').coverage_unknown);
    expect(municipal?.right.sentence).toContain(NOT_A_FINDING);
    expect(textImpliesNoLaw(`${municipal?.left.sentence} ${municipal?.right.sentence}`)).toBe(false);
  });

  test('counts zero records without calling that the absence of law', () => {
    const view = composePlaceComparison({
      left: amsterdam({
        coverage: [
          { jurisdictionId: AMSTERDAM, level: 'national', state: 'known', sourceIds: [NATIONAL], indexedRecords: 0 },
          { jurisdictionId: AMSTERDAM, level: 'regional', state: 'partial', sourceIds: [], indexedRecords: 0 },
          { jurisdictionId: AMSTERDAM, level: 'municipal', state: 'known', sourceIds: [], indexedRecords: 0 },
        ],
      }),
      right: rotterdam(),
      alignedDate: '2026-10-26',
    });
    const municipal = view.coverage.find((row) => row.level === 'municipal');
    expect(municipal?.left.countedZero).toBe(true);
    expect(municipal?.left.indexedRecords).toBe(0);
    expect(textImpliesNoLaw(`${municipal?.left.sentence} ${COUNTED_ZERO}`)).toBe(false);
  });

  test('keeps the same wording as two place-scoped rules', () => {
    const view = composePlaceComparison({
      left: amsterdam(),
      right: rotterdam({
        results: [
          result({
            recordId: 'rtm-same',
            placeId: ROTTERDAM,
            jurisdictionId: ROTTERDAM,
            text: LEFT_RULE,
            norm: 'prohibit',
            sourceId: RTM_LOCAL,
          }),
        ],
      }),
    });
    const parking = view.topics.find((topic) => topic.key === 'overnight parking');
    expect(parking).toMatchObject({ contradiction: false, sameWording: true, merged: false, assertedAnswer: null });
    expect(parking?.left[0].placeId).toBe(AMSTERDAM);
    expect(parking?.right[0].placeId).toBe(ROTTERDAM);
    expect(view.assertedAnswer).toBeNull();
  });

  test('reads a contradiction from the rule text when no norm is supplied', () => {
    const view = composePlaceComparison({
      left: amsterdam({
        results: [result({ recordId: 'ams-text', text: 'Visitors must not park overnight.', norm: undefined })],
      }),
      right: rotterdam({
        results: [result({
          recordId: 'rtm-text',
          placeId: ROTTERDAM,
          jurisdictionId: ROTTERDAM,
          text: 'Visitors may park overnight.',
          norm: undefined,
          sourceId: RTM_LOCAL,
        })],
      }),
    });
    expect(view.topics.find((topic) => topic.key === 'overnight parking')).toMatchObject({
      contradiction: true,
      merged: false,
      assertedAnswer: null,
    });
  });

  test('does not compare a suggestion, a code, or one place alone', () => {
    const suggestion = composePlaceComparison({
      left: amsterdam({ origin: 'suggestion' }),
      right: rotterdam({ origin: 'device' }),
    });
    expect(suggestion.ready).toBe(false);
    expect(suggestion.issue).toBe(compareCopy('en').chooseTwo);
    expect(suggestion.columns[0].results).toEqual([]);
    expect(suggestion.sources).toEqual([]);
    expect(stringsOf(suggestion).join('\n')).not.toContain(LEFT_RULE);

    const one = composePlaceComparison({ left: amsterdam(), right: null });
    expect(one.ready).toBe(false);
    expect(one.issue).toBe(compareCopy('en').chooseSecond);

    const same = composePlaceComparison({ left: amsterdam(), right: amsterdam({ label: 'Amsterdam again' }) });
    expect(same.ready).toBe(false);
    expect(same.issue).toBe(compareCopy('en').samePlace);
    expect(same.columns[0].results).toEqual([]);

    const code = composePlaceComparison({
      left: amsterdam({ placeId: 'NL' }),
      right: rotterdam(),
    });
    expect(code.ready).toBe(false);
    expect(code.columns[0].placeId).toBeNull();
  });

  test('moves a coverage cell to the place it names', () => {
    const view = composePlaceComparison({
      left: amsterdam({
        coverage: [
          { jurisdictionId: ROTTERDAM, level: 'municipal', state: 'partial', sourceIds: [RTM_LOCAL], indexedRecords: 3 },
        ],
      }),
      right: rotterdam({ coverage: [] }),
    });
    const municipal = view.coverage.find((row) => row.level === 'municipal');
    expect(municipal?.left.state).toBe('missing');
    expect(municipal?.left.sourceIds).toEqual([]);
    expect(municipal?.right.state).toBe('partial');
    expect(municipal?.right.placeId).toBe(ROTTERDAM);
    expect(municipal?.right.sourceIds).toEqual([RTM_LOCAL]);
  });
});

describe('compare screen', () => {
  test('shows aligned columns and does not render the merged sentence', () => {
    renderCompare({
      left: amsterdam({
        results: [
          ...(amsterdam().results ?? []),
          result({
            recordId: 'rot-sneaky',
            placeId: ROTTERDAM,
            jurisdictionId: ROTTERDAM,
            text: SNEAKY,
            topic: 'quay',
            norm: 'permit',
            sourceId: RTM_LOCAL,
          }),
          result({
            recordId: 'conflict-1',
            placeId: AMSTERDAM,
            jurisdictionId: ROTTERDAM,
            text: CONFLICT,
          }),
        ],
      }),
    });
    const root = document.querySelector('.wwl');
    expect(root).toHaveAttribute('data-compare', 'open');
    expect(root).toHaveAttribute('data-asserted', 'false');
    expect(root).toHaveAttribute('data-merged', 'false');
    expect(root).toHaveAttribute('data-search-requires-compare', 'false');
    const grid = document.querySelector('[data-field="place-columns"]');
    expect(grid).toHaveClass('wwl-compare');
    expect(grid?.children).toHaveLength(2);

    const left = column('left');
    const right = column('right');
    expect(left).toHaveAttribute('data-place-id', AMSTERDAM);
    expect(left).toHaveAttribute('data-origin', 'manual');
    expect(right).toHaveAttribute('data-place-id', ROTTERDAM);
    expect(left.querySelector('[data-field="aligned-date"]')).toHaveAttribute('data-value', '2026-10-26');
    expect(right.querySelector('[data-field="aligned-date"]')).toHaveAttribute('data-value', '2026-10-26');
    expect(values('source', left)).toEqual(values('source', right));
    expect(values('coverage', left)).toEqual(['national', 'regional', 'municipal']);
    expect(values('coverage', right)).toEqual(['national', 'regional', 'municipal']);

    const leftMunicipal = left.querySelector('[data-field="coverage"][data-level="municipal"]');
    const rightMunicipal = right.querySelector('[data-field="coverage"][data-level="municipal"]');
    expect(leftMunicipal).toHaveAttribute('data-state', 'missing');
    expect(leftMunicipal).toHaveAttribute('data-place-id', AMSTERDAM);
    expect(leftMunicipal?.textContent).toContain(resultCopy('en').municipal_gap);
    expect(leftMunicipal?.textContent).not.toContain(RTM_LOCAL);
    expect(rightMunicipal).toHaveAttribute('data-state', 'known');
    expect(rightMunicipal?.querySelector('[data-source-id="endomorphosis/rotterdam-ordinances"]')).not.toBeNull();
    expect(textImpliesNoLaw(left.textContent ?? '')).toBe(false);
    expect(textImpliesNoLaw(right.textContent ?? '')).toBe(false);

    const national = left.querySelector(`[data-field="source"][data-source-id="${NATIONAL}"]`);
    const nationalRight = right.querySelector(`[data-field="source"][data-source-id="${NATIONAL}"]`);
    expect(national).toHaveAttribute('data-revision', REV_A);
    expect(nationalRight).toHaveAttribute('data-revision', REV_C);
    expect(national?.textContent).not.toContain(REV_C);
    expect(right.querySelector(`[data-field="source"][data-source-id="${AMS_LOCAL}"]`)).toHaveAttribute('data-present', 'false');

    for (const node of document.querySelectorAll('[data-field="result-text"], [data-field="topic-rule"]')) {
      const text = node.textContent ?? '';
      if (text.includes(LEFT_RULE)) {
        expect(node.closest('[data-place-id]')).toHaveAttribute('data-place-id', AMSTERDAM);
        expect(text).not.toContain(RIGHT_RULE);
      }
      if (text.includes(RIGHT_RULE)) {
        expect(node.closest('[data-place-id]')).toHaveAttribute('data-place-id', ROTTERDAM);
        expect(text).not.toContain(LEFT_RULE);
      }
      if (text.includes(SNEAKY)) expect(node.closest('[data-place-id]')).toHaveAttribute('data-place-id', ROTTERDAM);
    }
    expect(screen.queryByText(CONFLICT)).toBeNull();
    expect(screen.queryByText(MERGED)).toBeNull();
    expect(screen.queryByText(/prohibited everywhere/)).toBeNull();
    expect(document.querySelector('[data-field="asserted-answer"]')).toBeNull();
    expect(document.querySelector('[data-merged="true"]')).toBeNull();
    expect(screen.getByText(compareCopy('en').contradiction)).toBeInTheDocument();
    expect(screen.getByText(compareCopy('en').refused)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: compareCopy('en').share });
    expect(parseRoute(link.getAttribute('href') ?? '').comparePlaceIds).toEqual([AMSTERDAM, ROTTERDAM]);
    expect(link.getAttribute('href')).not.toMatch(/lat|lon|address/i);
    expect(fetchHost.fetch).not.toHaveBeenCalled();
  });

  test('aligns both columns when the visitor sets one date', async () => {
    const user = userEvent.setup();
    render(
      <ComparePlaces
        left={amsterdam({ asOf: '2024-01-01' })}
        right={rotterdam({ asOf: '2020' })}
      />,
    );
    expect(column('left').querySelector('[data-field="aligned-date"]')).toHaveAttribute('data-mode', 'unshared');
    expect(column('left').querySelector('[data-field="recorded-date"]')).toHaveAttribute('data-value', '2024-01-01');
    expect(column('right').querySelector('[data-field="recorded-date"]')).toHaveAttribute('data-value', '2020');
    const date = screen.getByLabelText(compareCopy('en').alignedDate);
    await user.clear(date);
    await user.type(date, '2026-13-40');
    expect(screen.getByText(compareCopy('en').dateInvalid)).toBeInTheDocument();
    expect(column('left').querySelector('[data-field="aligned-date"]')).toHaveAttribute('data-mode', 'unshared');
    await user.clear(date);
    await user.type(date, '2026-05-01');
    expect(column('left').querySelector('[data-field="aligned-date"]')).toHaveAttribute('data-value', '2026-05-01');
    expect(column('right').querySelector('[data-field="aligned-date"]')).toHaveAttribute('data-value', '2026-05-01');
    expect(column('left').querySelector('[data-field="recorded-date"]')).toHaveAttribute('data-value', '2024-01-01');
    const before = column('left').querySelector('[data-record-id="ams-park-1"]');
    expect(before).toHaveAttribute('data-date-relation', 'before');
    expect(before).toHaveAttribute('data-place-id', AMSTERDAM);
  });

  test('selects two places only after an explicit choice', async () => {
    const user = userEvent.setup();
    const illinois = 'place:springfield-illinois';
    const massachusetts = 'place:springfield-massachusetts';
    render(
      <ComparePlaces
        candidates={[
          {
            placeId: illinois,
            label: 'Springfield',
            origin: 'suggestion',
            parents: [{ placeId: 'place:illinois', label: 'Illinois' }],
            asOf: '2026-01-01',
            coverage: [{ jurisdictionId: illinois, level: 'municipal', state: 'missing', sourceIds: [] }],
            results: [result({
              recordId: 'il-1',
              placeId: illinois,
              jurisdictionId: illinois,
              text: 'Illinois keeps its own rule.',
              topic: 'noise',
              norm: 'prohibit',
            })],
          },
          {
            placeId: massachusetts,
            label: 'Springfield',
            parents: [{ placeId: 'place:massachusetts', label: 'Massachusetts' }],
            asOf: '2026-01-01',
            coverage: [{ jurisdictionId: massachusetts, level: 'municipal', state: 'unknown', sourceIds: [] }],
            results: [result({
              recordId: 'ma-1',
              placeId: massachusetts,
              jurisdictionId: massachusetts,
              text: 'Massachusetts keeps its own rule.',
              topic: 'noise',
              norm: 'permit',
            })],
          },
        ]}
      />,
    );
    expect(screen.queryByText('Illinois keeps its own rule.')).toBeNull();
    expect(screen.queryByText('Massachusetts keeps its own rule.')).toBeNull();
    const first = document.querySelector('[data-field="place-input"][data-side="left"]') as HTMLInputElement;
    await user.type(first, 'Springfield');
    expect(screen.queryByText('Illinois keeps its own rule.')).toBeNull();
    expect(screen.getAllByText(compareCopy('en').several).length).toBeGreaterThan(0);
    const leftChooser = document.querySelector('[data-field="chooser"][data-side="left"]') as HTMLElement;
    const rightChooser = document.querySelector('[data-field="chooser"][data-side="right"]') as HTMLElement;
    await user.click(within(leftChooser).getByRole('option', { name: /Choose Springfield, Illinois/ }));
    expect(screen.queryByText('Illinois keeps its own rule.')).toBeNull();
    await user.click(within(rightChooser).getByRole('option', { name: /Choose Springfield, Massachusetts/ }));
    expect(column('left')).toHaveAttribute('data-place-id', illinois);
    expect(column('left')).toHaveAttribute('data-origin', 'manual');
    expect(column('right')).toHaveAttribute('data-place-id', massachusetts);
    for (const node of screen.getAllByText('Illinois keeps its own rule.')) {
      expect(node.closest('[data-place-id]')).toHaveAttribute('data-place-id', illinois);
    }
    for (const node of screen.getAllByText('Massachusetts keeps its own rule.')) {
      expect(node.closest('[data-place-id]')).toHaveAttribute('data-place-id', massachusetts);
    }
    expect(screen.getByText(compareCopy('en').contradiction)).toBeInTheDocument();
    expect(document.querySelector('[data-merged="true"]')).toBeNull();
    expect(fetchHost.fetch).not.toHaveBeenCalled();
  });

  test('keeps a suggestion out until the visitor chooses that place', async () => {
    const user = userEvent.setup();
    render(
      <ComparePlaces
        left={amsterdam({ origin: 'url' })}
        right={rotterdam({ origin: 'saved' })}
      />,
    );
    expect(screen.queryByText(LEFT_RULE)).toBeNull();
    expect(screen.getAllByText(compareCopy('en').manualRequired).length).toBeGreaterThan(0);
    const confirms = document.querySelectorAll('[data-field="confirm-place"]');
    expect(confirms).toHaveLength(2);
    await user.click(confirms[0] as HTMLButtonElement);
    await user.click(confirms[1] as HTMLButtonElement);
    expect(column('left')).toHaveAttribute('data-origin', 'manual');
    expect(column('right')).toHaveAttribute('data-origin', 'manual');
    for (const node of screen.getAllByText(LEFT_RULE)) {
      expect(node.closest('[data-place-id]')).toHaveAttribute('data-place-id', AMSTERDAM);
    }
    for (const node of screen.getAllByText(RIGHT_RULE)) {
      expect(node.closest('[data-place-id]')).toHaveAttribute('data-place-id', ROTTERDAM);
    }
  });

  test('rejects a country code and does not invent a place', async () => {
    const user = userEvent.setup();
    render(<ComparePlaces />);
    const input = document.querySelector('[data-field="place-input"][data-side="left"]') as HTMLInputElement;
    await user.type(input, 'NL');
    await user.click(document.querySelector('[data-field="choose-id"][data-side="left"]') as HTMLButtonElement);
    expect(screen.getByText(/country or region code is an alias/i)).toBeInTheDocument();
    expect(column('left')).toHaveAttribute('data-place-id', '');
    expect(column('left')).toHaveAttribute('data-origin', 'not-manual');
  });

  test('uses an Arabic interface without merging the rules', () => {
    const copy = compareCopy('ar');
    renderCompare({ locale: 'ar', query: '' });
    const root = document.querySelector('.wwl');
    expect(root).toHaveAttribute('lang', 'ar');
    expect(root).toHaveAttribute('dir', 'rtl');
    expect(screen.getByText(copy.contradiction)).toBeInTheDocument();
    expect(screen.getByText(resultCopy('ar').municipal_gap)).toBeInTheDocument();
    expect(screen.getByText(resultCopy('ar').empty_query)).toBeInTheDocument();
    expect(screen.queryByText(MERGED)).toBeNull();
    expect(column('left').querySelector('[data-field="result"]')).toHaveAttribute('data-jurisdiction-id', AMSTERDAM);
  });

  test('leaves an empty question as a prompt', () => {
    renderCompare({ query: '   ', assertedAnswer: undefined, mergedRule: undefined, merge: undefined });
    expect(screen.getByText(resultCopy('en').empty_query)).toBeInTheDocument();
    expect(textImpliesNoLaw(document.querySelector('.wwl')?.textContent ?? '')).toBe(false);
    expect(screen.queryByText(compareCopy('en').refused)).toBeNull();
  });

  test('shows a counted zero beside the place that reported it', () => {
    renderCompare({
      left: amsterdam({
        coverage: [
          { jurisdictionId: AMSTERDAM, level: 'municipal', state: 'known', sourceIds: [], indexedRecords: 0 },
        ],
      }),
    });
    const cell = column('left').querySelector('[data-field="coverage"][data-level="municipal"]');
    expect(cell).toHaveAttribute('data-indexed-records', '0');
    expect(within(cell as HTMLElement).getByText(COUNTED_ZERO)).toBeInTheDocument();
    expect(column('right').textContent).not.toContain(COUNTED_ZERO);
    expect(textImpliesNoLaw(cell?.textContent ?? '')).toBe(false);
  });
});

function viewUsesIdentity(view: CompareView): boolean {
  return view.columns.every((item) => item.results.every((result) => result.placeId === item.placeId));
}

test('every compared result stays inside the place column that was selected', () => {
  const view = composePlaceComparison({
    left: amsterdam(),
    right: rotterdam(),
    alignedDate: '2026',
  });
  expect(viewUsesIdentity(view)).toBe(true);
  expect(view.alignedDate.value).toBe('2026');
  expect(view.columns[0].recordedDate).toBe('2026-10-26');
  expect(view.columns[1].recordedDate).toBe('2026-10-26');
});

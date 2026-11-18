/**
 * Versioned geography and corpus gap list.
 *
 * data-schema is worldwide-legal-search.gap-list@1.
 * Each row shows the level, place id, and sentence already on the gap.
 * This view does not fetch and does not read a caller IP.
 */

import type { CoverageGap, CoverageGapList } from '../../lib/worldwide/coverage/gaps';

export const GAP_LIST_SCHEMA = 'worldwide-legal-search.gap-list@1';

function GapRows({ gaps }: { gaps: readonly CoverageGap[] }) {
  return (
    <>
      {gaps.map((gap, index) => (
        <li
          key={`${gap.kind}:${gap.level}:${gap.placeId}:${index}`}
          data-field="gap-row"
          data-kind={gap.kind}
          data-level={gap.level}
          data-place-id={gap.placeId}
        >
          <span data-field="level">{gap.level}</span>
          {' '}
          <span data-field="place-id">{gap.placeId}</span>
          {' '}
          <span data-field="sentence">{gap.sentence}</span>
        </li>
      ))}
    </>
  );
}

export function GapList({ gaps }: { gaps: CoverageGapList }) {
  return (
    <section data-schema={GAP_LIST_SCHEMA} data-field="gap-list" aria-label="Coverage gaps">
      <h2>Coverage gaps</h2>
      <ul data-kind="geography" aria-label="Geography gaps">
        <GapRows gaps={gaps.geography} />
      </ul>
      <ul data-kind="corpus" aria-label="Corpus gaps">
        <GapRows gaps={gaps.corpus} />
      </ul>
    </section>
  );
}

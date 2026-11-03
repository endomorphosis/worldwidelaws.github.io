/**
 * Authority context for the selected place.
 *
 * National, regional, and local candidates stay in one list. Evidenced
 * special or supranational candidates stay in that same list. A missing
 * municipal collection is a coverage gap, not a finding that no local law exists.
 */

import type { AuthorityStack } from '../../lib/worldwide/jurisdiction/authority';
import { UNCERTAINTY } from '../../lib/worldwide/jurisdiction/authority';
import {
  bandLabel,
  coverageLabel,
  localizeInclusion,
  type ResultCopy,
} from './SearchFilters';

export interface StackCoverageCell {
  level: 'national' | 'regional' | 'municipal';
  coverage: 'known' | 'partial' | 'missing' | 'unknown' | 'unavailable';
  label: string;
}

export interface JurisdictionStackProps {
  copy: ResultCopy;
  stack: AuthorityStack | null;
  coverage: StackCoverageCell[];
  municipalGap: boolean;
}

function inclusionText(candidate: NonNullable<AuthorityStack>['candidates'][number]): string[] {
  const lines: string[] = [];
  for (const side of [candidate.territory, candidate.issuer]) {
    if (!side) continue;
    for (const inclusion of side.inclusions) lines.push(inclusion.because);
  }
  return lines;
}

export function JurisdictionStack({ copy, stack, coverage, municipalGap }: JurisdictionStackProps) {
  const candidates = stack?.candidates ?? [];
  return (
    <aside className="wwl-stack" aria-label={copy.laws_and_sources}>
      <h2>{copy.laws_and_sources}</h2>
      <ol>
        {candidates.map((candidate) => {
          const lines = inclusionText(candidate);
          return (
            <li key={candidate.id} data-band={candidate.band} data-level={candidate.levelKind}>
              <span className="wwl-embed">{candidate.name ?? candidate.id}</span>
              <span className="wwl-badge">{bandLabel(candidate.band, copy)}</span>
              {lines.length === 0 ? (
                <p className="wwl-inclusion" data-field="inclusion">{localizeInclusion('', copy)}</p>
              ) : lines.map((line) => (
                <p className="wwl-inclusion" data-field="inclusion" key={line}>{localizeInclusion(line, copy)}</p>
              ))}
            </li>
          );
        })}
      </ol>
      <h3>{copy.coverage}</h3>
      {coverage.map((cell) => (
        <p
          key={cell.level}
          id={cell.level === 'municipal' ? 'wwl-municipal-coverage' : undefined}
          className="wwl-coverage"
          data-coverage={cell.coverage}
          data-level={cell.level}
          tabIndex={cell.level === 'municipal' ? -1 : undefined}
        >
          {bandLabel(cell.level, copy)}
          {'. '}
          {cell.label || coverageLabel(cell.coverage, copy)}
        </p>
      ))}
      {municipalGap ? <p>{copy.municipal_gap}</p> : null}
      <p className="wwl-applicability" data-applicability="not-asserted">{copy.applicability}</p>
      <p>{copy.stack_limit || UNCERTAINTY.notDetermination}</p>
    </aside>
  );
}

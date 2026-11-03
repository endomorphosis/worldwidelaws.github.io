import { APPLICABILITY, admitJurisdictionGraph, type JurisdictionGraph } from '../../src/lib/worldwide/jurisdiction/schema';
import {
  LAW_DATE_FIELDS,
  LAW_STATUS_LABELS,
  TEMPORAL_LIMITS,
  TEMPORAL_SCOPE_SCHEMA,
  TemporalScopeError,
  scopeAsOf,
  type LawTemporalInput,
  type TemporalScope,
  type TemporalScopeQuery,
} from '../../src/lib/worldwide/jurisdiction/temporal';

const REVISION = 'a'.repeat(40);
const PLACE = 'place:harbor';
const BOUNDARY = 'boundary:harbor';
const SOURCE = 'source:harbor-gazette';

function known(value: string, precision: 'day' | 'month' | 'year' = 'year') {
  return { knowledge: 'known' as const, value, precision, source: 'fixture' };
}

function openEnd() {
  return { knowledge: 'open' as const, value: null, precision: null, source: 'fixture' };
}

function unknownBound() {
  return { knowledge: 'unknown' as const, value: null, precision: null, source: null };
}

function openValid(start = '2000') {
  return { start: known(start), end: openEnd() };
}

function zone(timeZone: string) {
  return { knowledge: 'known' as const, timeZone, source: 'fixture' };
}

function boundary(boundaryId: string, extra: Record<string, unknown> = {}) {
  return {
    boundaryId,
    role: 'primary',
    geometryKnowledge: 'known',
    geometryRef: `artifact:${boundaryId}`,
    provenance: {
      sourceId: 'registry:fixture',
      sourceRevision: REVISION,
      attribution: 'Fixture geometry',
      license: null,
    },
    valid: openValid(),
    flags: [],
    ...extra,
  };
}

function placeNode(id: string, extra: Record<string, unknown> = {}, boundaryExtra: Record<string, unknown> = {}) {
  const boundaryId = `boundary:${id.slice(id.indexOf(':') + 1)}`;
  return {
    id,
    roles: ['place'],
    names: [{ text: id, language: 'en', script: 'Latn' }],
    level: { kind: 'country' },
    parentKnowledge: 'none',
    issuerKnowledge: 'none',
    issuerIds: [],
    boundaries: [boundary(boundaryId, boundaryExtra)],
    valid: openValid(),
    ...extra,
  };
}

function mustAdmit(input: Record<string, unknown>): JurisdictionGraph {
  const result = admitJurisdictionGraph({
    graphId: 'graph:fixture',
    sourceId: 'registry:fixture',
    sourceRevision: REVISION,
    publisherId: 'publisher:fixture',
    observedAt: '2024-06',
    ...input,
  });
  if (!result.graph || result.quarantined.length > 0) {
    throw new Error(`fixture quarantined: ${result.quarantined.map((item) => `${item.reason}: ${item.detail}`).join(' | ')}`);
  }
  return result.graph;
}

function harborGraph(extra: Record<string, unknown> = {}): JurisdictionGraph {
  return mustAdmit({
    nodes: [placeNode(PLACE)],
    ...extra,
  });
}

function law(partial: LawTemporalInput = {}): LawTemporalInput {
  return {
    lawId: 'law:harbor',
    sourceId: SOURCE,
    sourceRevision: REVISION,
    timeZone: zone('Europe/Amsterdam'),
    territorialIds: [PLACE],
    publication: '2020-01-01',
    commencement: '2020-06-01',
    repeal: { knowledge: 'open', source: 'fixture says unrepealed' },
    amendments: [],
    ...partial,
  };
}

function clocks(placeZone = 'Europe/Amsterdam', boundaryZone = placeZone) {
  return {
    places: [{ placeId: PLACE, timeZone: zone(placeZone) }],
    boundaries: [{ boundaryId: BOUNDARY, timeZone: zone(boundaryZone) }],
  };
}

function scope(graph: JurisdictionGraph, partial: Partial<TemporalScopeQuery> = {}): TemporalScope {
  return scopeAsOf({
    graph,
    asOf: '2024-06-01',
    ...clocks(),
    laws: [law()],
    ...partial,
  });
}

function one(result: TemporalScope, lawId = 'law:harbor') {
  const found = result.laws.find((item) => item.lawId === lawId);
  if (!found) throw new Error(`missing ${lawId}`);
  return found;
}

function codes(result: { reasons: { code: string }[] }): string[] {
  return result.reasons.map((item) => item.code);
}

describe('temporal scope', () => {
  it('keeps commencement, publication, amendment, and repeal as separate fields', () => {
    const result = scope(harborGraph(), {
      laws: [law({
        publication: '2009-12-01',
        commencement: '2010-01-01',
        repeal: { knowledge: 'open', source: 'fixture says unrepealed' },
        amendments: [{ amendmentId: 'amendment:2024', date: '2024-01-15' }],
      })],
    });
    const item = one(result);
    expect(LAW_DATE_FIELDS).toEqual(['commencement', 'publication', 'amendment', 'repeal']);
    expect(Object.keys(item.dates).sort()).toEqual([...LAW_DATE_FIELDS].sort());
    expect(item.dates.commencement).not.toBe(item.dates.publication);
    expect(item.dates.repeal).not.toBe(item.dates.commencement);
    expect(item.dates.amendment).not.toBe(item.dates.repeal);
    expect(item.dates.publication).toMatchObject({ field: 'publication', value: '2009-12-01', precision: 'day' });
    expect(item.dates.commencement).toMatchObject({ field: 'commencement', value: '2010-01-01', precision: 'day' });
    expect(item.dates.repeal).toMatchObject({ field: 'repeal', knowledge: 'open', value: null });
    expect(item.dates.amendment.field).toBe('amendment');
    expect(item.dates.amendment.events).toEqual([
      expect.objectContaining({
        amendmentId: 'amendment:2024',
        value: '2024-01-15',
        source: 'amendment',
        effect: 'effective',
      }),
    ]);
    expect(item.lawStatus).toBe('in-force');
    expect(item.current).toBe(true);
    expect(item.dates.commencement.value).not.toBe(item.dates.amendment.events[0].value);
    expect(item.dates.repeal.value).toBeNull();
  });

  it('does not treat publication as commencement', () => {
    const item = one(scope(harborGraph(), {
      asOf: '2022-01-01',
      laws: [law({ publication: '2020-01-01', commencement: '2024-01-01' })],
    }));
    expect(item.dates.publication.value).toBe('2020-01-01');
    expect(item.dates.commencement.value).toBe('2024-01-01');
    expect(item.validity).toBe('outside');
    expect(item.lawStatus).toBe('not-yet-in-force');
    expect(item.current).toBe(false);
    expect(codes(item)).toContain('not-yet-in-force');
    expect(codes(item)).not.toContain('in-force');
  });

  it('does not treat an amendment as repeal or as a new commencement', () => {
    const future = one(scope(harborGraph(), {
      laws: [law({
        commencement: '2010-01-01',
        amendments: [{ amendmentId: 'amendment:later', date: '2026-01-01' }],
      })],
    }));
    expect(future.lawStatus).toBe('in-force');
    expect(future.current).toBe(true);
    expect(future.dates.commencement.value).toBe('2010-01-01');
    expect(future.dates.repeal.knowledge).toBe('open');
    expect(future.dates.amendment.events[0]).toMatchObject({
      value: '2026-01-01',
      effect: 'not-yet-effective',
    });

    const repealed = one(scope(harborGraph(), {
      laws: [law({
        commencement: '2010-01-01',
        repeal: '2024-01-01',
        amendments: [],
      })],
    }));
    expect(repealed.lawStatus).toBe('repealed');
    expect(repealed.current).toBe(false);
    expect(repealed.inScope).toBe(true);
    expect(repealed.dates.amendment.events).toEqual([]);
    expect(repealed.dates.repeal.value).toBe('2024-01-01');
    expect(repealed.dates.commencement.value).toBe('2010-01-01');
  });

  it('keeps an unknown amendment date off the current set', () => {
    const item = one(scope(harborGraph(), {
      laws: [law({
        amendments: [{ amendmentId: 'amendment:unknown', knowledge: 'unknown' }],
      })],
    }));
    expect(item.dates.amendment.events[0]).toMatchObject({ knowledge: 'unknown', effect: 'undecided' });
    expect(item.dates.commencement.value).toBe('2020-06-01');
    expect(item.dates.repeal.knowledge).toBe('open');
    expect(item.lawStatus).toBe('unknown');
    expect(item.current).toBe(false);
    expect(codes(item)).toContain('unknown-amendment');
  });

  it('compares partial dates at the coarser shared precision and keeps the end date inside', () => {
    const monthQuery = one(scope(harborGraph(), {
      asOf: '2024-06',
      laws: [law({ commencement: '2024-06-15', publication: '2024' })],
    }));
    expect(monthQuery.validity).toBe('inside');
    expect(monthQuery.lawStatus).toBe('in-force');
    expect(monthQuery.current).toBe(true);
    expect(monthQuery.dates.publication.precision).toBe('year');
    expect(monthQuery.dates.commencement.precision).toBe('day');

    const beforeMonth = one(scope(harborGraph(), {
      asOf: '2024-06-30',
      laws: [law({ commencement: { knowledge: 'known', value: '2024-07', precision: 'month', source: 'gazette' } })],
    }));
    expect(beforeMonth.lawStatus).toBe('not-yet-in-force');
    expect(beforeMonth.current).toBe(false);

    const yearQuery = one(scope(harborGraph(), {
      asOf: '2020',
      laws: [law({ commencement: '2020', publication: '2019-05' })],
    }));
    expect(yearQuery.lawStatus).toBe('in-force');
    expect(yearQuery.dates.commencement.precision).toBe('year');

    const onCommencement = one(scope(harborGraph(), {
      asOf: '2024-06-15',
      laws: [law({ commencement: '2024-06-15' })],
    }));
    const dayBefore = one(scope(harborGraph(), {
      asOf: '2024-06-14',
      laws: [law({ commencement: '2024-06-15' })],
    }));
    expect(onCommencement.lawStatus).toBe('in-force');
    expect(dayBefore.lawStatus).toBe('not-yet-in-force');

    const onRepeal = one(scope(harborGraph(), {
      asOf: '2024-06-15',
      laws: [law({ repeal: '2024-06-15' })],
    }));
    const afterRepeal = one(scope(harborGraph(), {
      asOf: '2024-06-16',
      laws: [law({ repeal: '2024-06-15' })],
    }));
    const insideRepealMonth = one(scope(harborGraph(), {
      asOf: '2024-06-30',
      laws: [law({ repeal: { knowledge: 'known', value: '2024-06', precision: 'month', source: 'repeal act' } })],
    }));
    const afterRepealMonth = one(scope(harborGraph(), {
      asOf: '2024-07-01',
      laws: [law({ repeal: { knowledge: 'known', value: '2024-06', precision: 'month', source: 'repeal act' } })],
    }));
    expect(onRepeal.validity).toBe('inside');
    expect(onRepeal.lawStatus).toBe('in-force');
    expect(afterRepeal.lawStatus).toBe('repealed');
    expect(afterRepeal.current).toBe(false);
    expect(insideRepealMonth.lawStatus).toBe('in-force');
    expect(afterRepealMonth.lawStatus).toBe('repealed');
  });

  it('converts one instant into each source timezone before applying partial dates', () => {
    const graph = harborGraph();
    const split = scope(graph, {
      asOf: '2024-01-01T00:30:00Z',
      ...clocks('UTC', 'UTC'),
      laws: [
        law({ lawId: 'law:auckland', timeZone: zone('Pacific/Auckland'), commencement: { knowledge: 'known', value: '2024', precision: 'year', source: 'nz-gazette' } }),
        law({ lawId: 'law:los-angeles', timeZone: zone('America/Los_Angeles'), commencement: { knowledge: 'known', value: '2024', precision: 'year', source: 'ca-statute' } }),
      ],
    });
    const auckland = one(split, 'law:auckland');
    const losAngeles = one(split, 'law:los-angeles');
    expect(auckland.civilAsOf).toBe('2024-01-01');
    expect(losAngeles.civilAsOf).toBe('2023-12-31');
    expect(auckland.lawStatus).toBe('in-force');
    expect(auckland.current).toBe(true);
    expect(losAngeles.lawStatus).toBe('not-yet-in-force');
    expect(losAngeles.current).toBe(false);
    expect(split.currentLawIds).toEqual(['law:auckland']);
    expect(split.asOf.kind).toBe('instant');
    expect(split.asOf.utc).toBe('2024-01-01T00:30:00.000Z');
  });

  it('uses boundary validity and law validity together, each in its source timezone', () => {
    const graph = mustAdmit({
      nodes: [placeNode(PLACE, { valid: openValid('2000') }, { valid: { start: known('2024-06', 'month'), end: openEnd() } })],
    });
    const blocked = scope(graph, {
      asOf: '2024-06-01T04:00:00Z',
      ...clocks('UTC', 'America/Los_Angeles'),
      laws: [law({
        timeZone: zone('Europe/Amsterdam'),
        commencement: { knowledge: 'known', value: '2024-06', precision: 'month', source: 'gazette' },
      })],
    });
    const place = blocked.places[0];
    const boundaryRow = blocked.boundaries[0];
    const item = one(blocked);
    expect(place.civilAsOf).toBe('2024-06-01');
    expect(place.nodeInterval).toBe('inside');
    expect(boundaryRow.civilAsOf).toBe('2024-05-31');
    expect(boundaryRow.interval).toBe('outside');
    expect(place.current).toBe(false);
    expect(item.civilAsOf).toBe('2024-06-01');
    expect(item.validity).toBe('inside');
    expect(item.lawStatus).toBe('in-force');
    expect(item.inScope).toBe(false);
    expect(item.current).toBe(false);
    expect(blocked.currentLawIds).toEqual([]);
    expect(codes(item)).toContain('territory-not-current');

    const open = scope(graph, {
      asOf: '2024-06-01T04:00:00Z',
      ...clocks('Europe/Amsterdam', 'Europe/Amsterdam'),
      laws: [law({
        timeZone: zone('Europe/Amsterdam'),
        commencement: { knowledge: 'known', value: '2024-06', precision: 'month', source: 'gazette' },
      })],
    });
    expect(one(open).civilAsOf).toBe('2024-06-01');
    expect(open.boundaries[0].civilAsOf).toBe('2024-06-01');
    expect(open.boundaries[0].interval).toBe('inside');
    expect(open.places[0].current).toBe(true);
    expect(one(open).current).toBe(true);
    expect(open.applicability).toBe(APPLICABILITY);
    expect(open.applicability).toBe('not-asserted');
    expect(open.schema).toBe(TEMPORAL_SCOPE_SCHEMA);
    expect(open.uncertainty[0]).toMatch(/does not decide what binds conduct/);
  });

  it('compares a civil as-of date as a calendar label in every source timezone', () => {
    const result = scope(harborGraph(), {
      asOf: '2024-03-10',
      ...clocks('UTC', 'UTC'),
      laws: [
        law({ lawId: 'law:la', timeZone: zone('America/Los_Angeles'), commencement: '2024-03-10' }),
        law({ lawId: 'law:nl', timeZone: zone('Europe/Amsterdam'), commencement: '2024-03-10' }),
        law({ lawId: 'law:next', timeZone: zone('America/Los_Angeles'), commencement: '2024-03-11' }),
      ],
    });
    expect(one(result, 'law:la').civilAsOf).toBe('2024-03-10');
    expect(one(result, 'law:nl').civilAsOf).toBe('2024-03-10');
    expect(one(result, 'law:la').lawStatus).toBe('in-force');
    expect(one(result, 'law:nl').lawStatus).toBe('in-force');
    expect(one(result, 'law:next').lawStatus).toBe('not-yet-in-force');
    expect(result.currentLawIds).toEqual(['law:la', 'law:nl']);
  });

  it('does not treat unknown dates, status, or timezones as current', () => {
    const graph = harborGraph();
    const unknownStart = one(scope(graph, {
      laws: [law({ lawId: 'law:unknown-start', commencement: { knowledge: 'unknown' } })],
    }), 'law:unknown-start');
    const unknownEnd = one(scope(graph, {
      laws: [law({ lawId: 'law:unknown-end', repeal: { knowledge: 'unknown' } })],
    }), 'law:unknown-end');
    const openEndLaw = one(scope(graph, {
      laws: [law({ lawId: 'law:open-end' })],
    }), 'law:open-end');
    const declaredUnknown = one(scope(graph, {
      laws: [law({ lawId: 'law:declared-unknown', status: 'unknown' })],
    }), 'law:declared-unknown');
    const unknownZone = one(scope(graph, {
      laws: [law({ lawId: 'law:no-zone', timeZone: { knowledge: 'unknown', source: 'fixture' } })],
    }), 'law:no-zone');
    const invalidZone = one(scope(graph, {
      laws: [law({ lawId: 'law:bad-zone', timeZone: 'Not/AZone' })],
    }), 'law:bad-zone');
    expect(unknownStart.validity).toBe('unknown');
    expect(unknownStart.lawStatus).toBe('unknown');
    expect(unknownStart.current).toBe(false);
    expect(codes(unknownStart)).toContain('unknown-commencement');
    expect(unknownEnd.lawStatus).toBe('unknown');
    expect(unknownEnd.current).toBe(false);
    expect(codes(unknownEnd)).toContain('unknown-repeal');
    expect(openEndLaw.lawStatus).toBe('in-force');
    expect(openEndLaw.current).toBe(true);
    expect(declaredUnknown.lawStatus).toBe('unknown');
    expect(declaredUnknown.current).toBe(false);
    expect(codes(declaredUnknown)).toContain('unknown-status');
    expect(unknownZone.validity).toBe('inside');
    expect(unknownZone.lawStatus).toBe('unknown');
    expect(unknownZone.current).toBe(false);
    expect(codes(unknownZone)).toContain('unknown-timezone');
    expect(invalidZone.lawStatus).toBe('unknown');
    expect(invalidZone.current).toBe(false);
    expect(invalidZone.timeZone.timeZone).toBe('Not/AZone');
    expect(codes(invalidZone)).toContain('invalid-timezone');
    expect(LAW_STATUS_LABELS).toContain('unknown');
  });

  it('keeps historical and superseded labels distinct from repeal and from current', () => {
    const graph = harborGraph();
    const historical = one(scope(graph, { laws: [law({ status: 'historical' })] }));
    const superseded = one(scope(graph, { laws: [law({ status: 'superseded' })] }));
    const repealed = one(scope(graph, { laws: [law({ status: 'repealed', repeal: '2020-01-01' })] }));
    const conflict = one(scope(graph, { laws: [law({ status: 'repealed' })] }));
    const wordCurrent = one(scope(graph, {
      asOf: '2022-01-01',
      laws: [law({ status: 'current', commencement: '2024-01-01' })],
    }));
    const currentOverRepeal = one(scope(graph, {
      laws: [law({ status: 'current', repeal: '2020-01-01' })],
    }));
    expect(historical.lawStatus).toBe('historical');
    expect(historical.current).toBe(false);
    expect(superseded.lawStatus).toBe('superseded');
    expect(superseded.current).toBe(false);
    expect(repealed.lawStatus).toBe('repealed');
    expect(repealed.current).toBe(false);
    expect(conflict.lawStatus).toBe('unknown');
    expect(codes(conflict)).toContain('status-date-conflict');
    expect(wordCurrent.lawStatus).toBe('not-yet-in-force');
    expect(wordCurrent.current).toBe(false);
    expect(currentOverRepeal.lawStatus).toBe('unknown');
    expect(codes(currentOverRepeal)).toContain('status-date-conflict');
    expect(historical.dates.repeal.knowledge).toBe('open');
    expect(superseded.dates.repeal.knowledge).toBe('open');
  });

  it('requires both the place interval and a selected boundary interval', () => {
    const expiredPlace = mustAdmit({
      nodes: [placeNode(PLACE, { valid: { start: known('1990'), end: known('2020') } })],
    });
    const expired = scope(expiredPlace);
    expect(expired.places[0].nodeInterval).toBe('outside');
    expect(expired.boundaries[0].interval).toBe('inside');
    expect(expired.places[0].current).toBe(false);
    expect(one(expired).lawStatus).toBe('in-force');
    expect(one(expired).current).toBe(false);

    const expiredBoundary = mustAdmit({
      nodes: [placeNode(PLACE, {}, { valid: { start: known('2030'), end: openEnd() } })],
    });
    const later = scope(expiredBoundary);
    expect(later.places[0].nodeInterval).toBe('inside');
    expect(later.boundaries[0].status).toBe('outside');
    expect(later.places[0].current).toBe(false);
    expect(one(later).current).toBe(false);

    const unknownPlace = mustAdmit({
      nodes: [placeNode(PLACE, { valid: { start: unknownBound(), end: openEnd() } })],
    });
    const unknown = scope(unknownPlace);
    expect(unknown.places[0].nodeInterval).toBe('unknown');
    expect(unknown.places[0].status).toBe('unknown');
    expect(unknown.places[0].current).toBe(false);
    expect(one(unknown).current).toBe(false);

    const missingClock = scope(harborGraph(), { places: [], boundaries: clocks().boundaries });
    expect(missingClock.places[0].nodeInterval).toBe('inside');
    expect(missingClock.places[0].current).toBe(false);
    expect(codes(missingClock.places[0])).toContain('unknown-timezone');
  });

  it('uses a disputed boundary only when its view is selected', () => {
    const graph = mustAdmit({
      disputedViews: [{
        id: 'view:line',
        statement: 'The harbor line is disputed.',
        claimantIds: [PLACE],
        claimantKnowledge: 'known',
        valid: openValid(),
      }],
      nodes: [placeNode(PLACE, {
        boundaries: [boundary(BOUNDARY, { role: 'disputed', viewId: 'view:line' })],
      })],
    });
    const held = scope(graph);
    expect(held.boundaries[0].status).toBe('omitted');
    expect(held.boundaries[0].current).toBe(false);
    expect(held.places[0].current).toBe(false);
    expect(one(held).current).toBe(false);

    const selected = scope(graph, { viewIds: ['view:line'] });
    expect(selected.boundaries[0].status).toBe('inside');
    expect(selected.boundaries[0].establishesScope).toBe(true);
    expect(selected.places[0].current).toBe(true);
    expect(one(selected).current).toBe(true);
    expect(() => scope(graph, { viewIds: ['view:missing'] })).toThrow(TemporalScopeError);
  });

  it('does not let an approximate or exclusion boundary replace a primary answer', () => {
    const approximateOnly = mustAdmit({
      nodes: [placeNode(PLACE, {
        boundaries: [boundary(BOUNDARY, { role: 'approximate' })],
      })],
    });
    const approximate = scope(approximateOnly);
    expect(approximate.places[0].current).toBe(true);
    expect(approximate.places[0].approximate).toBe(true);
    expect(approximate.uncertainty.join(' ')).toMatch(/approximate/i);
    expect(one(approximate).current).toBe(true);

    const blocked = mustAdmit({
      nodes: [placeNode(PLACE, {
        boundaries: [
          boundary(BOUNDARY, { valid: { start: unknownBound(), end: openEnd() } }),
          boundary('boundary:approx', { role: 'approximate' }),
        ],
      })],
    });
    const refused = scope(blocked, {
      boundaries: [
        { boundaryId: BOUNDARY, timeZone: zone('Europe/Amsterdam') },
        { boundaryId: 'boundary:approx', timeZone: zone('Europe/Amsterdam') },
      ],
    });
    const approx = refused.boundaries.find((item) => item.boundaryId === 'boundary:approx');
    expect(approx?.interval).toBe('inside');
    expect(approx?.establishesScope).toBe(false);
    expect(refused.places[0].current).toBe(false);
    expect(one(refused).current).toBe(false);

    const exclusionOnly = mustAdmit({
      nodes: [placeNode(PLACE, {
        boundaries: [boundary(BOUNDARY, { role: 'exclusion' })],
      })],
    });
    expect(scope(exclusionOnly).places[0].current).toBe(false);
  });

  it('accepts an inferred commencement and rejects an unpinned or duplicate law', () => {
    const inferred = one(scope(harborGraph(), {
      laws: [law({
        commencement: { knowledge: 'inferred', value: '2020-01-01', precision: 'day', source: 'citation note' },
      })],
    }));
    expect(inferred.dates.commencement.knowledge).toBe('inferred');
    expect(inferred.lawStatus).toBe('in-force');
    expect(inferred.current).toBe(true);

    const unpinned = one(scope(harborGraph(), {
      laws: [law({ sourceRevision: 'latest' })],
    }));
    expect(unpinned.current).toBe(false);
    expect(codes(unpinned)).toContain('unpinned-source');

    const duplicate = scope(harborGraph(), {
      laws: [
        law({ lawId: 'law:same', commencement: '2020-01-01' }),
        law({ lawId: 'law:same', commencement: '2024-01-01' }),
      ],
    });
    expect(duplicate.laws).toHaveLength(2);
    expect(duplicate.laws.every((item) => item.current === false)).toBe(true);
    expect(duplicate.laws.map((item) => item.dates.commencement.value).sort()).toEqual(['2020-01-01', '2024-01-01']);
    expect(duplicate.currentLawIds).toEqual([]);

    const nowhere = one(scope(harborGraph(), { laws: [law({ territorialIds: [] })] }));
    expect(nowhere.lawStatus).toBe('in-force');
    expect(nowhere.inScope).toBe(false);
    expect(nowhere.current).toBe(false);
    expect(codes(nowhere)).toContain('no-territory');
  });

  it('stops at the amendment and law limits without calling the omitted rows current', () => {
    const amendments = Array.from({ length: TEMPORAL_LIMITS.maxAmendments + 1 }, (_, index) => ({
      amendmentId: `amendment:${String(index).padStart(2, '0')}`,
      date: '2020-01-01',
    }));
    const crowded = one(scope(harborGraph(), { laws: [law({ amendments })] }));
    expect(crowded.dates.amendment.events).toHaveLength(TEMPORAL_LIMITS.maxAmendments);
    expect(crowded.dates.amendment.omitted).toBe(1);
    expect(crowded.current).toBe(false);
    expect(crowded.lawStatus).toBe('unknown');
    expect(codes(crowded)).toContain('amendment-limit');

    const laws = Array.from({ length: TEMPORAL_LIMITS.maxLaws + 1 }, (_, index) => law({
      lawId: `law:${String(index).padStart(4, '0')}`,
    }));
    const overflow = scope(harborGraph(), { laws });
    expect(overflow.truncated).toBe(true);
    expect(overflow.checks.lawsConsidered).toBe(TEMPORAL_LIMITS.maxLaws);
    expect(overflow.omittedLawIds).toEqual(['law:5000']);
    expect(overflow.currentLawIds).toHaveLength(TEMPORAL_LIMITS.maxLaws);
    expect(overflow.currentLawIds).not.toContain('law:5000');
  });

  it('rejects an as-of value that is not a civil date or a zoned instant', () => {
    const graph = harborGraph();
    expect(() => scope(graph, { asOf: '2024-02-31' })).toThrow(TemporalScopeError);
    expect(() => scope(graph, { asOf: '2024-06-01T00:00:00' })).toThrow(TemporalScopeError);
    expect(() => scope(graph, { asOf: '' })).toThrow(TemporalScopeError);
    expect(scope(graph, { asOf: '2024-06-01T00:00:00Z' }).asOf.kind).toBe('instant');
    expect(scope(graph, { asOf: '2024-06-01T02:00:00+02:00' }).asOf.utc).toBe('2024-06-01T00:00:00.000Z');
  });
});

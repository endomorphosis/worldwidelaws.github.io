import { COVERAGE_GAP_SCHEMA, gapsFromCoverageCells } from '../../src/lib/worldwide/coverage/gaps';

const SENTENCE_GAP = 'coverage gap';
const SENTENCE_NOT_A_FINDING = 'not a finding that no law exists';

describe('coverage gaps', () => {
  test('shows one geography gap and one corpus gap, and partial is not a corpus gap', () => {
    expect(COVERAGE_GAP_SCHEMA).toBe('worldwide-legal-search.coverage-gap-list@1');

    const provinceId = 'place:fixture-province';
    const result = gapsFromCoverageCells(
      [
        { level: 'province', state: 'missing', placeId: provinceId },
        { level: 'state', state: 'partial', placeId: 'place:fixture-state' },
        { level: 'national', state: 'known', placeId: 'place:fixture-national' },
        { level: 'municipality', state: 'searched', placeId: 'place:fixture-municipality' },
      ],
      ['city', 'province', 'state', 'national', 'municipality'],
    );

    expect(result.geography).toHaveLength(1);
    expect(result.corpus).toHaveLength(1);

    const geography = result.geography[0];
    expect(geography.kind).toBe('geography');
    expect(geography.level).toBe('city');
    expect(geography.placeId).toBe('');
    expect(geography.sentence).toContain(SENTENCE_GAP);
    expect(geography.sentence).toContain(SENTENCE_NOT_A_FINDING);

    const corpus = result.corpus[0];
    expect(corpus.kind).toBe('corpus');
    expect(corpus.level).toBe('province');
    expect(corpus.placeId).toBe(provinceId);
    expect(corpus.sentence).toContain(SENTENCE_GAP);
    expect(corpus.sentence).toContain(SENTENCE_NOT_A_FINDING);

    expect(result.corpus.map((gap) => gap.level)).not.toContain('state');
    expect(result.corpus.map((gap) => gap.level)).not.toContain('national');
    expect(result.corpus.map((gap) => gap.level)).not.toContain('municipality');
    expect(result.geography.map((gap) => gap.level)).not.toContain('state');
  });

  test('treats unknown and unavailable as corpus gaps and copies the cell place id', () => {
    const result = gapsFromCoverageCells(
      [
        { level: 'neighborhood', coverage_state: 'unknown', jurisdiction_id: 'place:fixture-neighborhood' },
        { level: 'city', coverage_state: 'unavailable', jurisdiction_id: 'place:fixture-city' },
        { level: 'national', coverage_state: 'partial', jurisdiction_id: 'place:fixture-national' },
      ],
      ['province', 'neighborhood', 'city', 'national'],
    );

    expect(result.geography).toEqual([
      expect.objectContaining({
        kind: 'geography',
        level: 'province',
        placeId: '',
      }),
    ]);
    expect(result.corpus).toEqual([
      expect.objectContaining({
        kind: 'corpus',
        level: 'neighborhood',
        placeId: 'place:fixture-neighborhood',
      }),
      expect.objectContaining({
        kind: 'corpus',
        level: 'city',
        placeId: 'place:fixture-city',
      }),
    ]);
    for (const gap of [...result.geography, ...result.corpus]) {
      expect(gap.sentence).toContain(SENTENCE_GAP);
      expect(gap.sentence).toContain(SENTENCE_NOT_A_FINDING);
    }
  });
});

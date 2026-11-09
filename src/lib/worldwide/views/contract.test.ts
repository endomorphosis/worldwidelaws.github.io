import {
  CASELAW_VIEW_ID,
  CONTRACT_FIELD_NAMES,
  COURT_VIEW_ID,
  INSTRUMENT_INTERFACE_ID,
  INSTRUMENT_VIEW_CONTRACT_ID,
  JURISDICTION_APPLICABILITY,
  KIND_VERSIONS,
  LEGISLATIVE_ACT_VIEW_ID,
  MUNICIPAL_INSTRUMENT_VIEW_ID,
  QUERY_PLACE,
  REGULATION_VIEW_ID,
  SECTION_SCHEMA_ID,
  STATUTE_VIEW_ID,
  UnknownInstrumentVersionError,
  VIEW_BINDINGS,
  acceptInstrumentVersion,
  instrumentViewContract,
  kindVersionForView,
} from './contract';

describe('instrument view contract', () => {
  test('rejects an unknown instrument version', () => {
    const refused = [
      'legal-corpus.not-landed@1',
      'legal-corpus.status@1',
      'legal-corpus.instrument@1',
      'country-laws-ir-graphrag/v1',
      'country-laws-normalize-verify/v1',
      '',
      '   ',
    ];
    for (const version of refused) {
      expect(() => acceptInstrumentVersion(version)).toThrow(UnknownInstrumentVersionError);
      try {
        acceptInstrumentVersion(version);
      } catch (error) {
        expect(error).toBeInstanceOf(UnknownInstrumentVersionError);
        expect((error as UnknownInstrumentVersionError).version).toBe(version);
        expect((error as Error).message).toContain('unknown instrument version');
      }
    }
    for (const version of Object.values(KIND_VERSIONS)) {
      expect(acceptInstrumentVersion(version)).toBe(version);
    }
  });

  test('has no geoip field and keeps place as an argument', () => {
    expect(Object.keys(instrumentViewContract).sort()).toEqual([...CONTRACT_FIELD_NAMES].sort());
    expect(Object.prototype.hasOwnProperty.call(instrumentViewContract, 'geoip')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(instrumentViewContract, 'callerIp')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(instrumentViewContract, 'caller_ip')).toBe(false);
    for (const binding of instrumentViewContract.views) {
      expect(Object.prototype.hasOwnProperty.call(binding, 'geoip')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(binding, 'callerIp')).toBe(false);
    }
    expect(JSON.stringify(instrumentViewContract).toLowerCase()).not.toContain('geoip');
    expect(instrumentViewContract.queryPlace).toBe('argument');
    expect(instrumentViewContract.queryPlace).toBe(QUERY_PLACE);
    expect(instrumentViewContract.applicability).toBe('not-asserted');
    expect(instrumentViewContract.applicability).toBe(JURISDICTION_APPLICABILITY);
    expect(instrumentViewContract.schema).toBe(INSTRUMENT_VIEW_CONTRACT_ID);
    expect(instrumentViewContract.schema).toBe('worldwide-legal-search.instrument-view-contract@1');
    expect(instrumentViewContract.instrument).toBe(INSTRUMENT_INTERFACE_ID);
    expect(instrumentViewContract.instrument).toBe('legal-corpus.instrument@1');
  });

  test('maps each reserved view id to the kind version it can render', () => {
    expect(VIEW_BINDINGS.map((row) => [row.viewId, row.kindVersion])).toEqual([
      [STATUTE_VIEW_ID, 'legal-corpus.law@1'],
      [CASELAW_VIEW_ID, 'legal-corpus.caselaw@1'],
      [REGULATION_VIEW_ID, 'legal-corpus.regulation@1'],
      [LEGISLATIVE_ACT_VIEW_ID, 'legal-corpus.legislative-act@1'],
      [COURT_VIEW_ID, 'legal-corpus.court@1'],
      [MUNICIPAL_INSTRUMENT_VIEW_ID, 'legal-corpus.municipal-instrument@1'],
    ]);
    expect(STATUTE_VIEW_ID).toBe('worldwide-legal-search.law-source@1');
    expect(SECTION_SCHEMA_ID).toBe('worldwide-legal-search.law-section@1');
    expect(VIEW_BINDINGS[0]?.sectionSchema).toBe('worldwide-legal-search.law-section@1');
    expect(VIEW_BINDINGS[0]?.sourceSchemaVersion).toBe('country-laws-ir-graphrag/v1');
    expect(VIEW_BINDINGS[0]?.verifySchemaVersion).toBe('country-laws-normalize-verify/v1');
    expect(kindVersionForView(STATUTE_VIEW_ID)).toBe('legal-corpus.law@1');
    expect(kindVersionForView(CASELAW_VIEW_ID)).toBe('legal-corpus.caselaw@1');
    expect(() => kindVersionForView('worldwide-legal-search.not-a-view@1')).toThrow(
      UnknownInstrumentVersionError,
    );
  });
});

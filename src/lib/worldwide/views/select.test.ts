import { MUNICIPAL_COLUMNS } from './municipal-instrument';
import {
  FILTER_INSTRUMENT_TOKENS,
  instrumentViewId,
  selectInstrumentView,
} from './select';

function municipalRow(): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const name of MUNICIPAL_COLUMNS) {
    row[name] = name === 'doc_order' ? 0 : name;
  }
  return row;
}

describe('instrument view selector', () => {
  test('accepts each landed interface and source schema pair', () => {
    const law = selectInstrumentView({
      interfaceId: 'legal-corpus.law@1',
      sourceSchemaVersion: 'country-laws-ir-graphrag/v1',
      row: { id: 'law-1', title: 'Statute', text: 'Body' },
    });
    expect(instrumentViewId(law)).toBe('worldwide-legal-search.law-source@1');

    const caselaw = selectInstrumentView({
      interfaceId: 'legal-corpus.caselaw@1',
      sourceSchemaId: 'unversioned',
      row: { source_schema_id: 'unversioned', ecli: 'ECLI:FR:CCASS:2020:FIXTURE', text: 'Body' },
    });
    expect(instrumentViewId(caselaw)).toBe('worldwide-legal-search.caselaw-view@1');
    expect(instrumentViewId(caselaw)).not.toBe('worldwide-legal-search.law-source@1');

    const regulation = selectInstrumentView({
      interfaceId: 'legal-corpus.regulation@1',
      sourceSchemaId: 'cfr-annual-processor-v1',
      row: { schema_version: 'cfr-annual-processor-v1', citation: '37 CFR 1.1', text_excerpt: 'excerpt' },
    });
    expect(instrumentViewId(regulation)).toBe('worldwide-legal-search.regulation-view@1');

    const act = selectInstrumentView({
      interfaceId: 'legal-corpus.legislative-act@1',
      sourceSchemaId: 'public-law-change-processor-v1',
      row: { schema_version: 'public-law-change-processor-v1', package_id: 'PLAW-118publ47', text_excerpt: 'excerpt' },
    });
    expect(instrumentViewId(act)).toBe('worldwide-legal-search.legislative-act-view@1');

    const court = selectInstrumentView({
      interfaceId: 'legal-corpus.court@1',
      sourceSchemaId: 'unversioned',
      row: { source_schema_id: 'unversioned', court_id: 'example-court', name: 'Example Courthouse' },
    });
    expect(instrumentViewId(court)).toBe('worldwide-legal-search.court-view@1');
    expect(court && 'row' in court ? Object.prototype.hasOwnProperty.call(court, 'opinionBody') : false).toBe(false);

    const municipal = selectInstrumentView({
      interfaceId: 'legal-corpus.municipal-instrument@1',
      sourceSchemaId: 'world_municipal/schema.py',
      row: municipalRow(),
    });
    expect(instrumentViewId(municipal)).toBe('worldwide-legal-search.municipal-instrument-view@1');
  });

  test('refuses a missing id, a crossed pair, a null municipal column, and filter tokens', () => {
    expect(selectInstrumentView({})).toBeNull();
    expect(selectInstrumentView({
      interfaceId: 'legal-corpus.caselaw@1',
      sourceSchemaId: 'country-laws-ir-graphrag/v1',
      row: { source_schema_id: 'country-laws-ir-graphrag/v1', text: 'Body' },
    })).toBeNull();
    const municipal = municipalRow();
    municipal.title = null;
    expect(selectInstrumentView({
      interfaceId: 'legal-corpus.municipal-instrument@1',
      sourceSchemaId: 'worldwide-legal-search.law-source@1',
      row: municipal,
    })).toBeNull();
    expect(selectInstrumentView({
      interfaceId: 'legal-corpus.municipal-instrument@1',
      sourceSchemaId: 'world_municipal/schema.py',
      row: municipal,
    })).toBeNull();
    for (const token of ['decision', 'regulation', ...FILTER_INSTRUMENT_TOKENS]) {
      expect(selectInstrumentView({
        interfaceId: token,
        sourceSchemaId: 'cfr-annual-processor-v1',
        row: { schema_version: 'cfr-annual-processor-v1' },
      })).toBeNull();
    }
  });
});

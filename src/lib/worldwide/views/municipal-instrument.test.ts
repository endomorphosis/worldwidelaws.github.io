import { LAW_SOURCE_SCHEMA, SCHEMA_VERSION } from '../data/schema';
import { CORPUS_SCHEMA_VERSION } from '../data/identity';
import { SCHEMA_VERSION as JURISDICTION_SCHEMA_VERSION } from '../jurisdiction/schema';
import { KIND_VERSIONS, MUNICIPAL_INSTRUMENT_VIEW_ID } from './contract';
import {
  MUNICIPAL_COLUMNS,
  MUNICIPAL_INSTRUMENT_VIEW_SCHEMA,
  MUNICIPAL_KIND_VERSION,
  MUNICIPAL_SOURCE_SCHEMA_FILE,
  MunicipalInstrumentViewRefused,
  REFUSED_LAW_KIND_VERSION,
  REFUSED_LAW_SOURCE_SCHEMA,
  STATUTE_SCHEMA_ID,
  TRAILING_PROVENANCE_EXAMPLE,
  municipalInstrumentView,
  renderMunicipalInstrumentView,
} from './municipal-instrument';

const COLUMNS = [
  'cid',
  'jurisdiction_id',
  'jurisdiction_name',
  'country',
  'doc_id',
  'regeling_id',
  'regeling_work_id',
  'doc_order',
  'title',
  'structural_path',
  'node_label',
  'html_title',
  'html',
  'text',
  'source_url',
  'xml_url',
  'date_effective',
  'date_modified',
  'retrieved',
] as const;

function fixture(): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const name of COLUMNS) {
    row[name] = name === 'doc_order' ? 0 : name;
  }
  return row;
}

describe('site municipal instrument view', () => {
  test('exports municipal-instrument-view@1 and the 19 columns in order', () => {
    expect(MUNICIPAL_INSTRUMENT_VIEW_ID).toBe('worldwide-legal-search.municipal-instrument-view@1');
    expect(MUNICIPAL_INSTRUMENT_VIEW_SCHEMA).toBe('worldwide-legal-search.municipal-instrument-view@1');
    expect(MUNICIPAL_INSTRUMENT_VIEW_SCHEMA).toBe(MUNICIPAL_INSTRUMENT_VIEW_ID);
    expect(KIND_VERSIONS.municipal_instrument).toBe('legal-corpus.municipal-instrument@1');
    expect(MUNICIPAL_KIND_VERSION).toBe('legal-corpus.municipal-instrument@1');
    expect(MUNICIPAL_SOURCE_SCHEMA_FILE).toBe('world_municipal/schema.py');
    expect(TRAILING_PROVENANCE_EXAMPLE).toBe('tipo');
    expect(COLUMNS).toHaveLength(19);
    expect([...MUNICIPAL_COLUMNS]).toEqual([...COLUMNS]);
    expect(MUNICIPAL_COLUMNS[7]).toBe('doc_order');
    expect([...MUNICIPAL_COLUMNS].sort()).not.toEqual([...MUNICIPAL_COLUMNS]);
    expect(CORPUS_SCHEMA_VERSION).toBe('country-laws-ir-graphrag/v1');
    expect(STATUTE_SCHEMA_ID).toBe('country-laws-ir-graphrag/v1');
    expect(LAW_SOURCE_SCHEMA).toBe('worldwide-legal-search.law-source@1');
    expect(REFUSED_LAW_SOURCE_SCHEMA).toBe('worldwide-legal-search.law-source@1');
    expect(REFUSED_LAW_KIND_VERSION).toBe('legal-corpus.law@1');
    expect(SCHEMA_VERSION).toBe(1);
    expect(JURISDICTION_SCHEMA_VERSION).toBe(1);

    expect(municipalInstrumentView.renders).toEqual([
      'worldwide-legal-search.municipal-instrument-view@1',
    ]);
    expect(municipalInstrumentView.kindVersion).toBe('legal-corpus.municipal-instrument@1');
    expect(municipalInstrumentView.sourceSchemaFile).toBe('world_municipal/schema.py');
    expect([...municipalInstrumentView.columns]).toEqual([...COLUMNS]);
    expect(municipalInstrumentView.trailingProvenanceExample).toBe('tipo');
    expect(Object.prototype.hasOwnProperty.call(municipalInstrumentView, 'geoip')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(municipalInstrumentView, 'callerIp')).toBe(false);
  });

  test('keeps the 19 columns in order and accepts a trailing provenance field', () => {
    const row = fixture();
    row.title = '';
    row[TRAILING_PROVENANCE_EXAMPLE] = 'Aviso';
    const model = renderMunicipalInstrumentView({
      interfaceId: 'legal-corpus.municipal-instrument@1',
      sourceSchemaId: 'world_municipal/schema.py',
      row,
    });
    expect(model.schema).toBe('worldwide-legal-search.municipal-instrument-view@1');
    expect(model.kindVersion).toBe('legal-corpus.municipal-instrument@1');
    expect(model.sourceSchemaId).toBe('world_municipal/schema.py');
    expect(Object.keys(model.row)).toEqual([...COLUMNS, 'tipo']);
    expect(Object.keys(model.row)).not.toEqual([...Object.keys(model.row)].sort());
    expect(model.row.title).toBe('');
    expect(model.row.tipo).toBe('Aviso');
    expect(model.row.doc_order).toBe(0);
    expect(typeof model.row.doc_order).toBe('number');
    expect(Object.prototype.hasOwnProperty.call(model, 'geoip')).toBe(false);
  });

  test('refuses NULL instead of displaying it as an empty string', () => {
    const row = fixture();
    row.title = null;
    expect(() => renderMunicipalInstrumentView({
      interfaceId: 'legal-corpus.municipal-instrument@1',
      sourceSchemaId: 'world_municipal/schema.py',
      row,
    })).toThrow(/NULL in string column title/);
    try {
      renderMunicipalInstrumentView({
        interfaceId: 'legal-corpus.municipal-instrument@1',
        sourceSchemaId: 'world_municipal/schema.py',
        row,
      });
    } catch (error) {
      expect(error).toBeInstanceOf(MunicipalInstrumentViewRefused);
      expect((error as Error).message).toBe('NULL in string column title');
      expect((error as Error).message).not.toContain('""');
    }

    const extra = fixture();
    extra.tipo = null;
    expect(() => renderMunicipalInstrumentView({
      interfaceId: 'legal-corpus.municipal-instrument@1',
      source_schema_id: 'world_municipal/schema.py',
      row: extra,
    })).toThrow(/NULL in string column tipo/);
  });

  test('rejects a missing canonical column', () => {
    const row = fixture();
    delete row.html_title;
    expect(() => renderMunicipalInstrumentView({
      interfaceId: 'legal-corpus.municipal-instrument@1',
      sourceSchemaId: 'world_municipal/schema.py',
      row,
    })).toThrow(/missing canonical column html_title/);
  });

  test('rejects a reordered column and a provenance field inserted before column 19', () => {
    const swapped = fixture();
    const cid = swapped.cid;
    swapped.cid = swapped.jurisdiction_id;
    swapped.jurisdiction_id = cid;
    const reordered: Record<string, unknown> = {};
    reordered.jurisdiction_id = swapped.jurisdiction_id;
    reordered.cid = swapped.cid;
    for (const name of COLUMNS.slice(2)) {
      reordered[name] = swapped[name];
    }
    expect(() => renderMunicipalInstrumentView({
      interfaceId: 'legal-corpus.municipal-instrument@1',
      sourceSchemaId: 'world_municipal/schema.py',
      row: reordered,
    })).toThrow(/only allowed after those 19/);

    const inserted = fixture();
    const middle: Record<string, unknown> = {};
    for (const name of COLUMNS) {
      if (name === 'country') {
        middle.tipo = 'kept extra';
      }
      middle[name] = inserted[name];
    }
    expect(Object.keys(middle)[3]).toBe('tipo');
    expect(() => renderMunicipalInstrumentView({
      kindVersion: 'legal-corpus.municipal-instrument@1',
      sourceSchemaVersion: 'world_municipal/schema.py',
      row: middle,
    })).toThrow(/only allowed after those 19/);
  });

  test('rejects a NULL or non-integer doc_order without coercing it', () => {
    for (const value of [null, '0', true, 1.5]) {
      const row = fixture();
      row.doc_order = value;
      expect(() => renderMunicipalInstrumentView({
        interfaceId: 'legal-corpus.municipal-instrument@1',
        sourceSchemaId: 'world_municipal/schema.py',
        row,
      })).toThrow(/doc_order stays an integer/);
    }
  });

  test('refuses a law row and a source schema the municipal kind does not cite', () => {
    expect(() => renderMunicipalInstrumentView({
      interfaceId: 'legal-corpus.law@1',
      sourceSchemaId: 'world_municipal/schema.py',
      row: fixture(),
    })).toThrow(MunicipalInstrumentViewRefused);

    expect(() => renderMunicipalInstrumentView({
      interfaceId: 'legal-corpus.municipal-instrument@1',
      schema: 'worldwide-legal-search.law-source@1',
      sourceSchemaId: 'world_municipal/schema.py',
      row: fixture(),
    })).toThrow(/law-source@1/);

    expect(() => renderMunicipalInstrumentView({
      interfaceId: 'legal-corpus.municipal-instrument@1',
      sourceSchemaId: 'country-laws-ir-graphrag/v1',
      row: fixture(),
    })).toThrow(/statute schema id is rejected/);
  });
});

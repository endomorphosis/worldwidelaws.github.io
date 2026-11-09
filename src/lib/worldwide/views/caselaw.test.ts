import { LAW_SOURCE_SCHEMA } from '../data/schema';
import { CASELAW_VIEW_ID, KIND_VERSIONS } from './contract';
import {
  CASELAW_KIND_VERSION,
  CASELAW_SOURCE_SCHEMA_ID,
  CASELAW_VIEW_SCHEMA,
  CaselawViewRefused,
  caselawView,
  renderCaselawView,
} from './caselaw';

describe('site caselaw view', () => {
  test('exports caselaw-view@1 and shows the registered source schema id', () => {
    expect(CASELAW_VIEW_ID).toBe('worldwide-legal-search.caselaw-view@1');
    expect(CASELAW_VIEW_SCHEMA).toBe('worldwide-legal-search.caselaw-view@1');
    expect(CASELAW_VIEW_SCHEMA).toBe(CASELAW_VIEW_ID);
    expect(KIND_VERSIONS.caselaw).toBe('legal-corpus.caselaw@1');
    expect(CASELAW_KIND_VERSION).toBe('legal-corpus.caselaw@1');
    expect(CASELAW_SOURCE_SCHEMA_ID).toBe('unversioned');
    expect(LAW_SOURCE_SCHEMA).toBe('worldwide-legal-search.law-source@1');

    expect(caselawView.renders).toEqual(['worldwide-legal-search.caselaw-view@1']);
    expect(caselawView.kindVersion).toBe('legal-corpus.caselaw@1');
    expect(caselawView.sourceSchemaId).toBe('unversioned');
    expect(caselawView.refuses).toEqual([
      'worldwide-legal-search.law-source@1',
      'legal-corpus.law@1',
    ]);
    expect(Object.prototype.hasOwnProperty.call(caselawView, 'geoip')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(caselawView, 'route')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(caselawView, 'callerIp')).toBe(false);

    const model = renderCaselawView({
      interfaceId: 'legal-corpus.caselaw@1',
      sourceSchemaId: 'unversioned',
      row: {
        source_schema_id: 'unversioned',
        ecli: 'ECLI:FR:CCASS:2020:FIXTURE',
        dila_id: 'CASS-fixture',
        text: 'The fixture decision body.',
        config: 'fr_cass',
      },
    });
    expect(model.schema).toBe('worldwide-legal-search.caselaw-view@1');
    expect(model.schema).not.toBe(LAW_SOURCE_SCHEMA);
    expect(model.kindVersion).toBe('legal-corpus.caselaw@1');
    expect(model.sourceSchemaId).toBe('unversioned');
    expect(model.row).toEqual({
      source_schema_id: 'unversioned',
      ecli: 'ECLI:FR:CCASS:2020:FIXTURE',
      dila_id: 'CASS-fixture',
      text: 'The fixture decision body.',
      config: 'fr_cass',
    });
    expect(Object.prototype.hasOwnProperty.call(model, 'source')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(model, 'section')).toBe(false);
    expect(JSON.stringify(model)).not.toContain('worldwide-legal-search.law-source@1');
    expect(JSON.stringify(model)).toContain('unversioned');
  });

  test('keeps a CAP-shaped row on the registered schema id', () => {
    const model = renderCaselawView({
      interface_id: 'legal-corpus.caselaw@1',
      source_schema_id: 'unversioned',
      source_row: {
        source_schema_id: 'unversioned',
        opinion_text: 'The fixture opinion.',
        case_id: 'cap-fixture-1',
        citation: '1 F. Cas. 1',
      },
    });
    expect(model.schema).toBe(CASELAW_VIEW_SCHEMA);
    expect(model.sourceSchemaId).toBe(CASELAW_SOURCE_SCHEMA_ID);
    expect(model.row.opinion_text).toBe('The fixture opinion.');
    expect(model.row.case_id).toBe('cap-fixture-1');
    expect(model.row.citation).toBe('1 F. Cas. 1');
    expect(Object.prototype.hasOwnProperty.call(model.row, 'dila_id')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(model.row, 'ecli')).toBe(false);
    expect(model.schema).not.toBe('worldwide-legal-search.law-source@1');
  });

  test('accepts the source schema id from the row alone', () => {
    const model = renderCaselawView({
      kindVersion: 'legal-corpus.caselaw@1',
      row: {
        source_schema_id: 'unversioned',
        rii_doknr: 'dok-1',
        config: 'de_bund',
        text: 'Leitsatz',
      },
    });
    expect(model.sourceSchemaId).toBe('unversioned');
    expect(model.schema).toBe('worldwide-legal-search.caselaw-view@1');
    expect(model.row.rii_doknr).toBe('dok-1');
    expect(model.row.config).toBe('de_bund');
  });

  test('does not render a statute-shaped caselaw row through law-source@1', () => {
    const model = renderCaselawView({
      interfaceId: 'legal-corpus.caselaw@1',
      sourceSchemaId: 'unversioned',
      row: {
        id: 'case-1',
        title: 'Opinion',
        text: 'Held',
        source_schema_id: 'unversioned',
      },
    });
    expect(model.schema).toBe('worldwide-legal-search.caselaw-view@1');
    expect(model.schema).not.toBe('worldwide-legal-search.law-source@1');
    expect(model.sourceSchemaId).toBe('unversioned');
    expect(Object.prototype.hasOwnProperty.call(model, 'source')).toBe(false);
    expect(model.row).toEqual({
      id: 'case-1',
      title: 'Opinion',
      text: 'Held',
      source_schema_id: 'unversioned',
    });
  });

  test('refuses the law kind and law-source@1', () => {
    const lawKind = {
      interfaceId: 'legal-corpus.law@1',
      sourceSchemaId: 'unversioned',
      row: { id: 'law-1', title: 'Statute', text: 'Body' },
    };
    expect(() => renderCaselawView(lawKind)).toThrow(CaselawViewRefused);
    try {
      renderCaselawView(lawKind);
    } catch (error) {
      expect(error).toBeInstanceOf(CaselawViewRefused);
      expect((error as CaselawViewRefused).version).toBe('legal-corpus.law@1');
    }

    expect(() => renderCaselawView({
      interfaceId: 'legal-corpus.caselaw@1',
      sourceSchemaId: 'worldwide-legal-search.law-source@1',
      row: { source_schema_id: 'unversioned', text: 'Held' },
    })).toThrow(CaselawViewRefused);

    expect(() => renderCaselawView({
      interfaceId: 'legal-corpus.caselaw@1',
      schema: 'worldwide-legal-search.law-source@1',
      sourceSchemaId: 'unversioned',
      row: { text: 'Held', source_schema_id: 'unversioned' },
    })).toThrow(/law-source@1/);
  });

  test('refuses a source schema id the caselaw register does not list', () => {
    expect(() => renderCaselawView({
      interfaceId: 'legal-corpus.caselaw@1',
      sourceSchemaVersion: 'country-laws-ir-graphrag/v1',
      row: { text: 'Held' },
    })).toThrow(CaselawViewRefused);
    expect(() => renderCaselawView({
      interfaceId: 'legal-corpus.caselaw@1',
      sourceSchemaId: 'justicedao/Caselaw_Access_Project_embeddings',
      row: { opinion_text: 'x', case_id: '1' },
    })).toThrow(CaselawViewRefused);
    expect(() => renderCaselawView({
      interfaceId: 'legal-corpus.caselaw@1',
      sourceSchemaId: 'endomorphosis/world_caselaw',
      row: { id: 'pj-1', text: 'Held' },
    })).toThrow(CaselawViewRefused);
    expect(() => renderCaselawView({
      interfaceId: 'legal-corpus.caselaw@1',
      row: { text: 'Held' },
    })).toThrow(CaselawViewRefused);
  });
});

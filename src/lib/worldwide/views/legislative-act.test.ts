import { LAW_SOURCE_SCHEMA } from '../data/schema';
import { KIND_VERSIONS, LEGISLATIVE_ACT_VIEW_ID } from './contract';
import { LAW_VIEW_SOURCE_SCHEMA, lawView } from './law';
import {
  ACT_SOURCE_SCHEMA_IDS,
  LEGISLATIVE_ACT_KIND_VERSION,
  LEGISLATIVE_ACT_VIEW_SCHEMA,
  LegislativeActViewRefused,
  REFUSED_LAW_KIND_VERSION,
  REFUSED_LAW_SOURCE_SCHEMA,
  USCODE_LAW_SCHEMA_IDS,
  USCODE_PACKAGE_PREFIXES,
  legislativeActView,
  renderLegislativeActView,
} from './legislative-act';

const ACT_ROW = {
  schema_version: 'public-law-change-processor-v1',
  citation: 'Pub. L. 118-47',
  congress: '118',
  law_number: '47',
  package_id: 'PLAW-118publ47',
  title: 'Further Consolidated Appropriations Act, 2024 (fixture)',
  text_excerpt: 'Making further consolidated appropriations for the fiscal year ending September 30, 2024.',
};

describe('site legislative-act view', () => {
  test('exports legislative-act-view@1 bound to legal-corpus.legislative-act@1', () => {
    expect(LEGISLATIVE_ACT_VIEW_ID).toBe('worldwide-legal-search.legislative-act-view@1');
    expect(LEGISLATIVE_ACT_VIEW_SCHEMA).toBe('worldwide-legal-search.legislative-act-view@1');
    expect(LEGISLATIVE_ACT_VIEW_SCHEMA).toBe(LEGISLATIVE_ACT_VIEW_ID);
    expect(KIND_VERSIONS.legislative_act).toBe('legal-corpus.legislative-act@1');
    expect(LEGISLATIVE_ACT_KIND_VERSION).toBe('legal-corpus.legislative-act@1');
    expect(REFUSED_LAW_KIND_VERSION).toBe('legal-corpus.law@1');
    expect(LAW_SOURCE_SCHEMA).toBe('worldwide-legal-search.law-source@1');
    expect(REFUSED_LAW_SOURCE_SCHEMA).toBe('worldwide-legal-search.law-source@1');
    expect([...ACT_SOURCE_SCHEMA_IDS]).toEqual([
      'public-law-change-processor-v1',
      'public-law-change-fixture-v1',
    ]);
    expect([...USCODE_LAW_SCHEMA_IDS]).toEqual([
      'uscode-release-processor-v1',
      'uscode-release-fixture-v1',
      'uscode-sparse-graphrag-release-schema-v2',
      'publicus-ir-graphrag/v2',
    ]);
    expect([...USCODE_PACKAGE_PREFIXES]).toEqual(['USHOUSE-USCODE-', 'USCODE-']);

    expect(legislativeActView.renders).toEqual([
      'worldwide-legal-search.legislative-act-view@1',
    ]);
    expect(legislativeActView.kindVersion).toBe('legal-corpus.legislative-act@1');
    expect([...legislativeActView.sourceSchemaIds]).toEqual([...ACT_SOURCE_SCHEMA_IDS]);
    expect(legislativeActView.refuses).toEqual([
      'legal-corpus.law@1',
      'uscode-release-processor-v1',
      'uscode-release-fixture-v1',
      'uscode-sparse-graphrag-release-schema-v2',
      'publicus-ir-graphrag/v2',
    ]);
    expect(Object.prototype.hasOwnProperty.call(legislativeActView, 'geoip')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(legislativeActView, 'route')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(legislativeActView, 'callerIp')).toBe(false);
  });

  test('leaves the law view on law-source@1', () => {
    expect(lawView.renders).toEqual([
      'worldwide-legal-search.law-source@1',
      'worldwide-legal-search.law-section@1',
    ]);
    expect(lawView.kindVersion).toBe('legal-corpus.law@1');
    expect(LAW_VIEW_SOURCE_SCHEMA).toBe('worldwide-legal-search.law-source@1');
    expect(lawView.renders).not.toContain('worldwide-legal-search.legislative-act-view@1');
  });

  test('renders a public-law row on legislative-act-view@1', () => {
    const model = renderLegislativeActView({
      interfaceId: 'legal-corpus.legislative-act@1',
      sourceSchemaId: 'public-law-change-processor-v1',
      row: ACT_ROW,
    });
    expect(model.schema).toBe('worldwide-legal-search.legislative-act-view@1');
    expect(model.schema).not.toBe(LAW_SOURCE_SCHEMA);
    expect(model.kindVersion).toBe('legal-corpus.legislative-act@1');
    expect(model.sourceSchemaId).toBe('public-law-change-processor-v1');
    expect(model.row).toEqual(ACT_ROW);
    expect(model.row.package_id).toBe('PLAW-118publ47');
    expect(model.row.text_excerpt).toBe(ACT_ROW.text_excerpt);
    expect(Object.prototype.hasOwnProperty.call(model, 'source')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(model, 'text')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(model.row, 'text')).toBe(false);
    expect(JSON.stringify(model)).not.toContain('worldwide-legal-search.law-source@1');
    expect(JSON.stringify(model)).not.toContain('legal-corpus.law@1');
    expect(JSON.stringify(model)).toContain('public-law-change-processor-v1');
  });

  test('accepts the public-law fixture schema id', () => {
    const model = renderLegislativeActView({
      interface_id: 'legal-corpus.legislative-act@1',
      source_schema_id: 'public-law-change-fixture-v1',
      source_row: {
        schema_version: 'public-law-change-fixture-v1',
        citation: 'Pub. L. 118-47',
        congress: '118',
        law_number: '47',
        package_id: 'PLAW-118publ47',
        title: 'Further Consolidated Appropriations Act, 2024 (fixture)',
        text_excerpt: ACT_ROW.text_excerpt,
      },
    });
    expect(model.schema).toBe(LEGISLATIVE_ACT_VIEW_SCHEMA);
    expect(model.sourceSchemaId).toBe('public-law-change-fixture-v1');
    expect(model.sourceSchemaId).not.toBe('public-law-change-processor-v1');
    expect(model.row.package_id).toBe('PLAW-118publ47');
    expect(model.schema).not.toBe('worldwide-legal-search.law-source@1');
  });

  test('refuses a US Code law row for each US Code schema id', () => {
    for (const schemaId of USCODE_LAW_SCHEMA_IDS) {
      const claimed = {
        interfaceId: 'legal-corpus.law@1',
        sourceSchemaId: schemaId,
        row: {
          schema_version: schemaId,
          section_number: '122',
          heading: 'fixture heading',
          text: 'consolidated section body',
          body_text: 'consolidated section body',
          package: 'USCODE-2024-title35',
        },
      };
      expect(() => renderLegislativeActView(claimed)).toThrow(LegislativeActViewRefused);
      try {
        renderLegislativeActView(claimed);
      } catch (error) {
        expect(error).toBeInstanceOf(LegislativeActViewRefused);
        expect((error as LegislativeActViewRefused).message).toBe('US Code law row is rejected');
        expect((error as LegislativeActViewRefused).version).toBe(schemaId);
      }
    }
  });

  test('refuses a US Code scraper law row that assigns no schema id', () => {
    const scraper = {
      interfaceId: 'legal-corpus.law@1',
      row: {
        section_number: '122',
        heading: 'fixture heading',
        text: 'consolidated section body',
        body_text: 'consolidated section body',
        citations: [],
        package: 'USCODE-2024-title35',
      },
    };
    expect(() => renderLegislativeActView(scraper)).toThrow(/US Code law row is rejected/);

    const house = {
      interfaceId: 'legal-corpus.law@1',
      kindVersion: 'legal-corpus.law@1',
      row: {
        section_number: '122',
        heading: 'fixture heading',
        text: 'consolidated section body',
        package: 'USHOUSE-USCODE-118-2024-title35',
      },
    };
    expect(() => renderLegislativeActView(house)).toThrow(LegislativeActViewRefused);
    try {
      renderLegislativeActView(house);
    } catch (error) {
      expect((error as LegislativeActViewRefused).version).toBe('USHOUSE-USCODE-118-2024-title35');
      expect((error as LegislativeActViewRefused).message).toBe('US Code law row is rejected');
    }
  });

  test('refuses a US Code schema id claimed as a legislative act', () => {
    expect(() => renderLegislativeActView({
      interfaceId: 'legal-corpus.legislative-act@1',
      sourceSchemaId: 'uscode-sparse-graphrag-release-schema-v2',
      row: {
        schema_version: 'uscode-sparse-graphrag-release-schema-v2',
        section_number: '122',
        heading: 'fixture heading',
        text: 'consolidated section body',
      },
    })).toThrow(/US Code law row is rejected/);

    expect(() => renderLegislativeActView({
      interfaceId: 'legal-corpus.legislative-act@1',
      sourceSchemaId: 'public-law-change-processor-v1',
      schema: 'worldwide-legal-search.law-source@1',
      row: ACT_ROW,
    })).toThrow(/law-source@1/);

    expect(() => renderLegislativeActView({
      interfaceId: 'legal-corpus.legislative-act@1',
      sourceSchemaId: 'public-law-change-processor-v1',
      row: {
        ...ACT_ROW,
        package: 'USCODE-2024-title35',
      },
    })).toThrow(/US Code law row is rejected/);
  });

  test('refuses a source schema id the legislative-act register does not list', () => {
    expect(() => renderLegislativeActView({
      interfaceId: 'legal-corpus.legislative-act@1',
      sourceSchemaId: 'country-laws-ir-graphrag/v1',
      row: {
        schema_version: 'country-laws-ir-graphrag/v1',
        id: 'law-1',
        title: 'Statute',
        text: 'Body',
      },
    })).toThrow(/not in the legislative-act register/);
    expect(() => renderLegislativeActView({
      interfaceId: 'legal-corpus.legislative-act@1',
      row: {
        citation: 'Pub. L. 118-47',
        text_excerpt: ACT_ROW.text_excerpt,
      },
    })).toThrow(LegislativeActViewRefused);
    expect(() => renderLegislativeActView({
      interfaceId: 'legal-corpus.legislative-act@1',
      sourceSchemaId: 'public-law-change-processor-v1',
      row: {
        schema_version: 'public-law-change-fixture-v1',
        citation: 'Pub. L. 118-47',
        text_excerpt: ACT_ROW.text_excerpt,
      },
    })).toThrow(/does not match the row/);
  });
});

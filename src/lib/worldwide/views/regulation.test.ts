import { CORPUS_SCHEMA_VERSION } from '../data/identity';
import { LAW_SOURCE_SCHEMA } from '../data/schema';
import { KIND_VERSIONS, REGULATION_VIEW_ID } from './contract';
import {
  REFUSED_LAW_KIND_VERSION,
  REFUSED_LAW_SOURCE_SCHEMA,
  REGULATION_KIND_VERSION,
  REGULATION_SOURCE_SCHEMA_IDS,
  REGULATION_VIEW_SCHEMA,
  RegulationViewRefused,
  STATUTE_SCHEMA_ID,
  regulationView,
  renderRegulationView,
} from './regulation';

describe('site regulation view', () => {
  test('exports regulation-view@1 bound to legal-corpus.regulation@1', () => {
    expect(REGULATION_VIEW_ID).toBe('worldwide-legal-search.regulation-view@1');
    expect(REGULATION_VIEW_SCHEMA).toBe('worldwide-legal-search.regulation-view@1');
    expect(REGULATION_VIEW_SCHEMA).toBe(REGULATION_VIEW_ID);
    expect(KIND_VERSIONS.regulation).toBe('legal-corpus.regulation@1');
    expect(REGULATION_KIND_VERSION).toBe('legal-corpus.regulation@1');
    expect(CORPUS_SCHEMA_VERSION).toBe('country-laws-ir-graphrag/v1');
    expect(STATUTE_SCHEMA_ID).toBe('country-laws-ir-graphrag/v1');
    expect(LAW_SOURCE_SCHEMA).toBe('worldwide-legal-search.law-source@1');
    expect(REFUSED_LAW_SOURCE_SCHEMA).toBe('worldwide-legal-search.law-source@1');
    expect(REFUSED_LAW_KIND_VERSION).toBe('legal-corpus.law@1');
    expect([...REGULATION_SOURCE_SCHEMA_IDS]).toEqual([
      'cfr-annual-processor-v1',
      'live-cfr-source-processor-v1',
      'ecfr-crosscheck-processor-v1',
      'federal-register-change-processor-v1',
      'federal-register-sparse-graphrag-release-schema-v2',
    ]);

    expect(regulationView.renders).toEqual(['worldwide-legal-search.regulation-view@1']);
    expect(regulationView.kindVersion).toBe('legal-corpus.regulation@1');
    expect([...regulationView.sourceSchemaIds]).toEqual([...REGULATION_SOURCE_SCHEMA_IDS]);
    expect(regulationView.refuses).toEqual([
      'country-laws-ir-graphrag/v1',
      'worldwide-legal-search.law-source@1',
      'legal-corpus.law@1',
    ]);
    expect(Object.prototype.hasOwnProperty.call(regulationView, 'geoip')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(regulationView, 'route')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(regulationView, 'callerIp')).toBe(false);
  });

  test('keeps CFR text on cfr-annual-processor-v1', () => {
    const model = renderRegulationView({
      interfaceId: 'legal-corpus.regulation@1',
      sourceSchemaId: 'cfr-annual-processor-v1',
      row: {
        schema_version: 'cfr-annual-processor-v1',
        citation: '37 CFR 1.1',
        text_excerpt: 'fixture CFR excerpt',
        title: '37',
        section: '1.1',
        stable_id: 'cfr-fixture-1',
        part: '1',
        year: 2024,
      },
    });
    expect(model.schema).toBe('worldwide-legal-search.regulation-view@1');
    expect(model.schema).not.toBe(LAW_SOURCE_SCHEMA);
    expect(model.schema).not.toBe(STATUTE_SCHEMA_ID);
    expect(model.kindVersion).toBe('legal-corpus.regulation@1');
    expect(model.sourceSchemaId).toBe('cfr-annual-processor-v1');
    expect(model.row).toEqual({
      schema_version: 'cfr-annual-processor-v1',
      citation: '37 CFR 1.1',
      text_excerpt: 'fixture CFR excerpt',
      title: '37',
      section: '1.1',
      stable_id: 'cfr-fixture-1',
      part: '1',
      year: 2024,
    });
    expect(model.row.text_excerpt).toBe('fixture CFR excerpt');
    expect(model.row.title).toBe('37');
    expect(Object.prototype.hasOwnProperty.call(model, 'source')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(model, 'section')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(model, 'text')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(model.row, 'text')).toBe(false);
    expect(JSON.stringify(model)).not.toContain('worldwide-legal-search.law-source@1');
    expect(JSON.stringify(model)).not.toContain('country-laws-ir-graphrag/v1');
    expect(JSON.stringify(model)).toContain('cfr-annual-processor-v1');
    expect(JSON.stringify(model)).toContain('fixture CFR excerpt');
  });

  test('keeps a live CFR row on its own source schema id', () => {
    const model = renderRegulationView({
      interface_id: 'legal-corpus.regulation@1',
      source_schema_id: 'live-cfr-source-processor-v1',
      source_row: {
        schema_version: 'live-cfr-source-processor-v1',
        citation: '37 CFR 1.2',
        text_excerpt: 'fixture live CFR excerpt',
        title: '37',
        section: '1.2',
        stable_id: 'live-cfr-fixture-1',
        part: '1',
      },
    });
    expect(model.schema).toBe(REGULATION_VIEW_SCHEMA);
    expect(model.sourceSchemaId).toBe('live-cfr-source-processor-v1');
    expect(model.sourceSchemaId).not.toBe('cfr-annual-processor-v1');
    expect(model.sourceSchemaId).not.toBe(STATUTE_SCHEMA_ID);
    expect(model.row.text_excerpt).toBe('fixture live CFR excerpt');
    expect(model.row.title).toBe('37');
    expect(Object.prototype.hasOwnProperty.call(model, 'text')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(model.row, 'text')).toBe(false);
    expect(model.schema).not.toBe('worldwide-legal-search.law-source@1');
  });

  test('accepts each other registered source schema id', () => {
    const ecfr = renderRegulationView({
      kindVersion: 'legal-corpus.regulation@1',
      row: {
        schema_version: 'ecfr-crosscheck-processor-v1',
        citation: '37 CFR 1.3',
        text_excerpt: 'fixture eCFR excerpt',
        heading: 'Section 1.3',
        section: '1.3',
        stable_id: 'ecfr-fixture-1',
      },
    });
    expect(ecfr.sourceSchemaId).toBe('ecfr-crosscheck-processor-v1');
    expect(ecfr.schema).toBe('worldwide-legal-search.regulation-view@1');
    expect(ecfr.row.text_excerpt).toBe('fixture eCFR excerpt');
    expect(ecfr.schema).not.toBe(STATUTE_SCHEMA_ID);

    const change = renderRegulationView({
      interfaceId: 'legal-corpus.regulation@1',
      sourceSchemaVersion: 'federal-register-change-processor-v1',
      row: {
        schema_version: 'federal-register-change-processor-v1',
        document_number: '2024-00001',
        citation: '89 FR 1',
        text_excerpt: 'fixture change excerpt',
        title: 'Fixture rule',
      },
    });
    expect(change.sourceSchemaId).toBe('federal-register-change-processor-v1');
    expect(change.row.document_number).toBe('2024-00001');
    expect(change.row.text_excerpt).toBe('fixture change excerpt');
    expect(Object.prototype.hasOwnProperty.call(change, 'source')).toBe(false);

    const release = renderRegulationView({
      interfaceId: 'legal-corpus.regulation@1',
      row: {
        schema_version: 'federal-register-sparse-graphrag-release-schema-v2',
        document_number: '2024-00002',
        title: 'Fixture release title',
        text: 'Fixture Federal Register release text.',
        abstract: 'Fixture abstract',
      },
    });
    expect(release.schema).toBe('worldwide-legal-search.regulation-view@1');
    expect(release.schema).not.toBe('worldwide-legal-search.law-source@1');
    expect(release.sourceSchemaId).toBe('federal-register-sparse-graphrag-release-schema-v2');
    expect(release.sourceSchemaId).not.toBe('country-laws-ir-graphrag/v1');
    expect(release.row.text).toBe('Fixture Federal Register release text.');
    expect(release.row.title).toBe('Fixture release title');
    expect(Object.prototype.hasOwnProperty.call(release, 'source')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(release, 'section')).toBe(false);
    expect(JSON.stringify(release)).not.toContain('worldwide-legal-search.law-source@1');
    expect(JSON.stringify(release)).not.toContain('country-laws-ir-graphrag/v1');
  });

  test('refuses the statute schema id for CFR-shaped text', () => {
    const claimed = {
      interfaceId: 'legal-corpus.regulation@1',
      sourceSchemaId: 'country-laws-ir-graphrag/v1',
      row: {
        citation: '37 CFR 1.1',
        text_excerpt: 'fixture CFR excerpt',
        title: '37',
        schema_version: 'country-laws-ir-graphrag/v1',
      },
    };
    expect(() => renderRegulationView(claimed)).toThrow(RegulationViewRefused);
    try {
      renderRegulationView(claimed);
    } catch (error) {
      expect(error).toBeInstanceOf(RegulationViewRefused);
      expect((error as RegulationViewRefused).version).toBe('country-laws-ir-graphrag/v1');
    }

    expect(() => renderRegulationView({
      interfaceId: 'legal-corpus.regulation@1',
      sourceSchemaId: 'cfr-annual-processor-v1',
      row: {
        schema_version: 'country-laws-ir-graphrag/v1',
        text_excerpt: 'fixture CFR excerpt',
        title: '37',
      },
    })).toThrow(/statute schema id is rejected/);
  });

  test('refuses law-source@1 and the law kind', () => {
    expect(() => renderRegulationView({
      interfaceId: 'legal-corpus.law@1',
      sourceSchemaId: 'cfr-annual-processor-v1',
      row: {
        id: 'law-1',
        title: 'Statute',
        text: 'Body',
        schema_version: 'cfr-annual-processor-v1',
      },
    })).toThrow(RegulationViewRefused);

    expect(() => renderRegulationView({
      interfaceId: 'legal-corpus.regulation@1',
      schema: 'worldwide-legal-search.law-source@1',
      sourceSchemaId: 'cfr-annual-processor-v1',
      row: {
        schema_version: 'cfr-annual-processor-v1',
        text_excerpt: 'fixture CFR excerpt',
      },
    })).toThrow(/consolidated statute/);

    expect(() => renderRegulationView({
      interfaceId: 'legal-corpus.regulation@1',
      sourceSchemaId: 'worldwide-legal-search.law-source@1',
      row: {
        text_excerpt: 'fixture CFR excerpt',
        title: '37',
      },
    })).toThrow(RegulationViewRefused);
  });

  test('refuses a source schema id the regulation register does not list', () => {
    expect(() => renderRegulationView({
      interfaceId: 'legal-corpus.regulation@1',
      sourceSchemaVersion: 'cfr-annual-fixture-v1',
      row: { text_excerpt: 'fixture CFR excerpt' },
    })).toThrow(RegulationViewRefused);
    expect(() => renderRegulationView({
      interfaceId: 'legal-corpus.regulation@1',
      sourceSchemaId: 'patent-authority-sources-v1',
      row: { citation: '37 CFR 1.1', text_excerpt: 'fixture CFR excerpt' },
    })).toThrow(RegulationViewRefused);
    expect(() => renderRegulationView({
      interfaceId: 'legal-corpus.regulation@1',
      row: { text_excerpt: 'fixture CFR excerpt', title: '37' },
    })).toThrow(RegulationViewRefused);
    expect(() => renderRegulationView({
      interfaceId: 'legal-corpus.regulation@1',
      sourceSchemaId: 'cfr-annual-processor-v1',
      row: {
        schema_version: 'live-cfr-source-processor-v1',
        text_excerpt: 'fixture CFR excerpt',
      },
    })).toThrow(/does not match the row/);
  });
});

import { CORPUS_SCHEMA_VERSION } from '../data/identity';
import {
  LAW_SECTION_SCHEMA,
  LAW_SOURCE_SCHEMA,
  REQUIRED_LAW_COLUMNS,
  SCHEMA_VERSION,
} from '../data/schema';
import { KIND_VERSIONS } from './contract';
import { LawViewRefused, lawView, renderLawView } from './law';

describe('site law view', () => {
  test('renders law-source@1 and law-section@1 for legal-corpus.law@1', () => {
    expect(SCHEMA_VERSION).toBe(1);
    expect([...REQUIRED_LAW_COLUMNS]).toEqual(['id', 'title', 'text']);
    expect(LAW_SOURCE_SCHEMA).toBe('worldwide-legal-search.law-source@1');
    expect(LAW_SECTION_SCHEMA).toBe('worldwide-legal-search.law-section@1');
    expect(CORPUS_SCHEMA_VERSION).toBe('country-laws-ir-graphrag/v1');
    expect(KIND_VERSIONS.law).toBe('legal-corpus.law@1');
    expect(KIND_VERSIONS.caselaw).toBe('legal-corpus.caselaw@1');

    expect(lawView.renders).toEqual([
      'worldwide-legal-search.law-source@1',
      'worldwide-legal-search.law-section@1',
    ]);
    expect(lawView.kindVersion).toBe('legal-corpus.law@1');
    expect(lawView.sourceSchemaVersion).toBe('country-laws-ir-graphrag/v1');
    expect(lawView.schemaVersion).toBe(SCHEMA_VERSION);
    expect(lawView.requiredLawColumns).toBe(REQUIRED_LAW_COLUMNS);
    expect(lawView.refuses).toEqual(['legal-corpus.caselaw@1']);

    const model = renderLawView({
      interfaceId: 'legal-corpus.law@1',
      sourceSchemaVersion: 'country-laws-ir-graphrag/v1',
      row: { id: 'law-1', title: 'Statute', text: 'Body', eli: 'eli:kept' },
    });
    expect(model.source.schema).toBe('worldwide-legal-search.law-source@1');
    expect(model.source.schemaVersion).toBe(1);
    expect(model.source.kindVersion).toBe('legal-corpus.law@1');
    expect(model.source.sourceSchemaVersion).toBe('country-laws-ir-graphrag/v1');
    expect(model.source).toMatchObject({ id: 'law-1', title: 'Statute', text: 'Body' });
    expect(model.section.schema).toBe('worldwide-legal-search.law-section@1');
    expect(model.section.schemaVersion).toBe(1);
    expect(model.section).toMatchObject({
      id: 'law-1',
      law_id: 'law-1',
      title: 'Statute',
      text: 'Body',
    });
    expect(model.extra).toEqual({ eli: 'eli:kept' });
    expect(JSON.stringify(model)).not.toContain('legal-corpus.caselaw@1');
    expect(SCHEMA_VERSION).toBe(1);
    expect([...REQUIRED_LAW_COLUMNS]).toEqual(['id', 'title', 'text']);
  });

  test('accepts the law-kind record field names', () => {
    const model = renderLawView({
      interface_id: 'legal-corpus.law@1',
      source_schema_version: 'country-laws-ir-graphrag/v1',
      source_row: { id: 'law-2', title: 'Code', text: 'Text' },
    });
    expect(model.source.schema).toBe(LAW_SOURCE_SCHEMA);
    expect(model.section.schema).toBe(LAW_SECTION_SCHEMA);
    expect(model.source.id).toBe('law-2');
    expect(model.section.law_id).toBe('law-2');
  });

  test('refuses legal-corpus.caselaw@1', () => {
    const input = {
      interfaceId: 'legal-corpus.caselaw@1',
      sourceSchemaVersion: 'country-laws-ir-graphrag/v1',
      row: { id: 'case-1', title: 'Opinion', text: 'Held' },
    };
    expect(() => renderLawView(input)).toThrow(LawViewRefused);
    try {
      renderLawView(input);
    } catch (error) {
      expect(error).toBeInstanceOf(LawViewRefused);
      expect((error as LawViewRefused).version).toBe('legal-corpus.caselaw@1');
      expect((error as Error).message).toContain('legal-corpus.caselaw@1');
    }
  });

  test('refuses a caselaw claim on the source schema field', () => {
    expect(() => renderLawView({
      interfaceId: 'legal-corpus.law@1',
      sourceSchemaVersion: 'legal-corpus.caselaw@1',
      row: { id: 'law-1', title: 'Statute', text: 'Body' },
    })).toThrow(LawViewRefused);
  });

  test('refuses a row missing text and does not change the required columns', () => {
    expect(() => renderLawView({
      interface_id: 'legal-corpus.law@1',
      source_schema_version: 'country-laws-ir-graphrag/v1',
      source_row: { id: 'law-3', title: 'Untitled' },
    })).toThrow(/missing required column text/);
    expect([...REQUIRED_LAW_COLUMNS]).toEqual(['id', 'title', 'text']);
    expect(SCHEMA_VERSION).toBe(1);
  });
});

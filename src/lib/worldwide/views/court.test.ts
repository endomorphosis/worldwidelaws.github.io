import { LAW_SOURCE_SCHEMA } from '../data/schema';
import { COURT_VIEW_ID, KIND_VERSIONS } from './contract';
import {
  COURT_KIND_VERSION,
  COURT_SOURCE_SCHEMA_ID,
  COURT_VIEW_SCHEMA,
  CourtViewRefused,
  OPINION_BODY_FIELDS,
  REFUSED_CASELAW_KIND_VERSION,
  STATUTE_SCHEMA_ID,
  WORLD_COURTS_REPO,
  courtView,
  renderCourtView,
} from './court';

const COURT_ROW = {
  source_schema_id: 'unversioned',
  court_id: 'example-court',
  record_type: 'courthouse',
  name: 'Example Courthouse',
  country_code: 'US',
  level: 'other',
  court_system: 'state',
  note: 'kept extra',
};

const OPINION_BODIES = [
  ['text', 'The fixture decision body.'],
  ['opinion_text', 'The fixture opinion.'],
  ['case_text', 'The fixture case text.'],
] as const;

describe('site court view', () => {
  test('exports court-view@1 bound to legal-corpus.court@1', () => {
    expect(COURT_VIEW_ID).toBe('worldwide-legal-search.court-view@1');
    expect(COURT_VIEW_SCHEMA).toBe('worldwide-legal-search.court-view@1');
    expect(COURT_VIEW_SCHEMA).toBe(COURT_VIEW_ID);
    expect(KIND_VERSIONS.court).toBe('legal-corpus.court@1');
    expect(COURT_KIND_VERSION).toBe('legal-corpus.court@1');
    expect(COURT_SOURCE_SCHEMA_ID).toBe('unversioned');
    expect(WORLD_COURTS_REPO).toBe('endomorphosis/world_courts');
    expect(STATUTE_SCHEMA_ID).toBe('country-laws-ir-graphrag/v1');
    expect(REFUSED_CASELAW_KIND_VERSION).toBe('legal-corpus.caselaw@1');
    expect(LAW_SOURCE_SCHEMA).toBe('worldwide-legal-search.law-source@1');
    expect([...OPINION_BODY_FIELDS]).toEqual(['text', 'opinion_text', 'case_text']);

    expect(courtView.renders).toEqual(['worldwide-legal-search.court-view@1']);
    expect(courtView.kindVersion).toBe('legal-corpus.court@1');
    expect(courtView.sourceSchemaId).toBe('unversioned');
    expect(courtView.refuses).toEqual([
      'legal-corpus.caselaw@1',
      'country-laws-ir-graphrag/v1',
      'endomorphosis/world_courts',
      'worldwide-legal-search.law-source@1',
      'legal-corpus.law@1',
    ]);
    expect(Object.prototype.hasOwnProperty.call(courtView, 'text')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(courtView, 'opinion_text')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(courtView, 'case_text')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(courtView, 'opinionBody')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(courtView, 'geoip')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(courtView, 'route')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(courtView, 'callerIp')).toBe(false);
  });

  test('renders an institution row with no opinion body field', () => {
    const model = renderCourtView({
      interfaceId: 'legal-corpus.court@1',
      sourceSchemaId: 'unversioned',
      row: { ...COURT_ROW, text: '' },
    });
    expect(model.schema).toBe('worldwide-legal-search.court-view@1');
    expect(model.kindVersion).toBe('legal-corpus.court@1');
    expect(model.sourceSchemaId).toBe('unversioned');
    expect(Object.keys(model).sort()).toEqual(['kindVersion', 'row', 'schema', 'sourceSchemaId']);
    expect(model.row).toEqual(COURT_ROW);
    expect(model.row.court_id).toBe('example-court');
    for (const key of ['text', 'opinion_text', 'case_text', 'opinionBody', 'body']) {
      expect(Object.prototype.hasOwnProperty.call(model, key)).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(model.row, key)).toBe(false);
    }
    const encoded = JSON.stringify(model);
    expect(encoded).not.toContain('The fixture decision body.');
    expect(encoded).not.toContain('The fixture opinion.');
    expect(encoded).not.toContain('The fixture case text.');
    expect(encoded).not.toContain('legal-corpus.caselaw@1');
    expect(encoded).toContain('unversioned');
    expect(encoded).toContain('example-court');
  });

  test('accepts the snake_case court record', () => {
    const model = renderCourtView({
      interface_id: 'legal-corpus.court@1',
      source_schema_id: 'unversioned',
      source_row: COURT_ROW,
    });
    expect(model.schema).toBe(COURT_VIEW_SCHEMA);
    expect(model.kindVersion).toBe(COURT_KIND_VERSION);
    expect(model.sourceSchemaId).toBe(COURT_SOURCE_SCHEMA_ID);
    expect(model.row.record_type).toBe('courthouse');
    expect(model.row.name).toBe('Example Courthouse');
    expect(Object.prototype.hasOwnProperty.call(model.row, 'text')).toBe(false);
  });

  test('refuses opinion body text and does not embed it', () => {
    for (const [key, body] of OPINION_BODIES) {
      const claimed = {
        interfaceId: 'legal-corpus.court@1',
        sourceSchemaId: 'unversioned',
        row: { ...COURT_ROW, [key]: body },
      };
      expect(() => renderCourtView(claimed)).toThrow(CourtViewRefused);
      try {
        renderCourtView(claimed);
      } catch (error) {
        expect(error).toBeInstanceOf(CourtViewRefused);
        expect((error as CourtViewRefused).message).toBe('opinion text is refused');
        expect((error as CourtViewRefused).version).toBe(key);
        expect((error as CourtViewRefused).message).not.toContain(body);
      }
    }
  });

  test('refuses a caselaw row', () => {
    const caselaw = {
      interfaceId: 'legal-corpus.caselaw@1',
      sourceSchemaId: 'unversioned',
      row: {
        source_schema_id: 'unversioned',
        court: 'Cour de cassation',
        court_id: 'example-court',
        text: 'The fixture decision body.',
        docket_number: '19-12.345',
      },
    };
    expect(() => renderCourtView(caselaw)).toThrow(CourtViewRefused);
    try {
      renderCourtView(caselaw);
    } catch (error) {
      expect((error as CourtViewRefused).message).toBe('court view does not embed caselaw text');
      expect((error as CourtViewRefused).version).toBe('legal-corpus.caselaw@1');
      expect((error as CourtViewRefused).message).not.toContain('The fixture decision body.');
    }
  });

  test('refuses the world-courts repo id and the statute schema id', () => {
    expect(() => renderCourtView({
      interfaceId: 'legal-corpus.court@1',
      sourceSchemaId: 'endomorphosis/world_courts',
      row: { ...COURT_ROW, source_schema_id: 'endomorphosis/world_courts' },
    })).toThrow(/world courts repo id is not the schema id/);

    expect(() => renderCourtView({
      interfaceId: 'legal-corpus.court@1',
      sourceSchemaId: 'country-laws-ir-graphrag/v1',
      row: {
        source_schema_id: 'country-laws-ir-graphrag/v1',
        court_id: 'example-court',
        id: 'law-1',
        title: 'Statute',
        text: 'Body',
      },
    })).toThrow(/statute schema id is rejected|opinion text is refused/);

    expect(() => renderCourtView({
      interfaceId: 'legal-corpus.court@1',
      sourceSchemaId: 'unversioned',
      schema: 'worldwide-legal-search.law-source@1',
      row: COURT_ROW,
    })).toThrow(/law-source@1/);
  });

  test('refuses a missing court identifier and a schema id outside the register', () => {
    expect(() => renderCourtView({
      interfaceId: 'legal-corpus.court@1',
      sourceSchemaId: 'unversioned',
      row: { source_schema_id: 'unversioned', name: 'Example Courthouse' },
    })).toThrow(/court identifier is required/);

    expect(() => renderCourtView({
      interfaceId: 'legal-corpus.court@1',
      sourceSchemaId: 'unversioned',
      row: { ...COURT_ROW, court_id: '   ' },
    })).toThrow(/court identifier is required/);

    expect(() => renderCourtView({
      interfaceId: 'legal-corpus.court@1',
      row: { court_id: 'example-court', name: 'Example Courthouse' },
    })).toThrow(/not in the court register/);

    expect(() => renderCourtView({
      interfaceId: 'legal-corpus.court@1',
      sourceSchemaId: 'unversioned',
      row: { ...COURT_ROW, source_schema_id: 'public-law-change-processor-v1' },
    })).toThrow(/does not match the row/);
  });
});

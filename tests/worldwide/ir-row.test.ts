import {
  ENTRY_IDENTITY_SCHEMA,
  IR_ROW_SCHEMA,
  IR_SCHEMA_VERSION,
  IR_SEARCH_GUIDE,
  LAW_IDENTITY_SCHEMA,
  readIrRow,
} from '../../src/lib/worldwide/search/ir-row';

describe('IR row reader', () => {
  test('keeps a matching row and returns null when schema_version is missing', () => {
    expect(IR_ROW_SCHEMA).toBe('worldwide-legal-search.ir-row@1');
    expect(IR_SCHEMA_VERSION).toBe('country-laws-ir-graphrag/v1');
    expect(ENTRY_IDENTITY_SCHEMA).toBe('country-laws-entry/v1');
    expect(LAW_IDENTITY_SCHEMA).toBe('country-laws-law/v1');
    expect(IR_SEARCH_GUIDE).toEqual({
      k1: 1.2,
      b: 0.75,
      titleWeight: 5,
      bodyWeight: 1,
    });

    const matching = {
      schema_version: 'country-laws-ir-graphrag/v1',
      instrument_id: 'nl:bw',
      title: 'Burgerlijk Wetboek',
      entry_identity_schema_version: 'country-laws-entry/v1',
    };
    expect(readIrRow(matching)).toEqual({
      instrument_id: 'nl:bw',
      title: 'Burgerlijk Wetboek',
    });
    expect(matching.schema_version).toBe('country-laws-ir-graphrag/v1');

    const withoutEntrySchema = {
      schema_version: IR_SCHEMA_VERSION,
      instrument_id: 'fr:code-civil',
      title: 'Code civil',
    };
    expect(readIrRow(withoutEntrySchema)).toEqual({
      instrument_id: 'fr:code-civil',
      title: 'Code civil',
    });

    const missing = {
      instrument_id: 'nl:bw',
      title: 'Burgerlijk Wetboek',
    };
    expect(readIrRow(missing)).toBeNull();
    expect(missing).not.toHaveProperty('schema_version');
  });

  test('rejects a wrong schema, an empty identity, and a mismatched entry schema', () => {
    const wrongSchema = {
      schema_version: 'worldwide-legal-search.ir-row@1',
      instrument_id: 'nl:bw',
      title: 'Burgerlijk Wetboek',
    };
    expect(readIrRow(wrongSchema)).toBeNull();
    expect(wrongSchema.schema_version).toBe('worldwide-legal-search.ir-row@1');

    expect(readIrRow({
      schema_version: IR_SCHEMA_VERSION,
      instrument_id: '',
      title: 'Burgerlijk Wetboek',
    })).toBeNull();
    expect(readIrRow({
      schema_version: IR_SCHEMA_VERSION,
      instrument_id: 'nl:bw',
      title: '',
    })).toBeNull();
    expect(readIrRow({
      schema_version: IR_SCHEMA_VERSION,
      instrument_id: 'nl:bw',
      title: 'Burgerlijk Wetboek',
      entry_identity_schema_version: 'country-laws-law/v1',
    })).toBeNull();
    expect(readIrRow(null)).toBeNull();
  });
});

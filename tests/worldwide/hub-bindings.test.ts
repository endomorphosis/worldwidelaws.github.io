import { HUB_DATASET_BINDINGS, lookupHubDatasetBinding } from '../../src/lib/worldwide/data/hub-bindings';
import { CASELAW_KIND_VERSION, CASELAW_SOURCE_SCHEMA_ID } from '../../src/lib/worldwide/views/caselaw';
import { COURT_KIND_VERSION, COURT_SOURCE_SCHEMA_ID, WORLD_COURTS_REPO } from '../../src/lib/worldwide/views/court';
import { MUNICIPAL_KIND_VERSION, MUNICIPAL_SOURCE_SCHEMA_FILE } from '../../src/lib/worldwide/views/municipal-instrument';
import { REGULATION_SOURCE_SCHEMA_IDS } from '../../src/lib/worldwide/views/regulation';

const WORLD_CASELAW_REPO = 'endomorphosis/world_caselaw';
const CAP_EMBEDDINGS_DATASET_ID = 'justicedao/Caselaw_Access_Project_embeddings';
const WORLD_MUNICIPAL_REPO = 'endomorphosis/world_municipal_law';

describe('hub dataset id bindings', () => {
  test('binds dataset ids a landed constant still names to that module schema', () => {
    expect(WORLD_COURTS_REPO).toBe('endomorphosis/world_courts');
    expect(COURT_KIND_VERSION).toBe('legal-corpus.court@1');
    expect(COURT_SOURCE_SCHEMA_ID).toBe('unversioned');
    expect(CASELAW_KIND_VERSION).toBe('legal-corpus.caselaw@1');
    expect(CASELAW_SOURCE_SCHEMA_ID).toBe('unversioned');
    expect(MUNICIPAL_KIND_VERSION).toBe('legal-corpus.municipal-instrument@1');
    expect(MUNICIPAL_SOURCE_SCHEMA_FILE).toBe('world_municipal/schema.py');

    const courts = lookupHubDatasetBinding(WORLD_COURTS_REPO);
    const caselaw = lookupHubDatasetBinding(WORLD_CASELAW_REPO);
    const cap = lookupHubDatasetBinding(CAP_EMBEDDINGS_DATASET_ID);
    const municipal = lookupHubDatasetBinding(WORLD_MUNICIPAL_REPO);

    expect(courts).toEqual({
      interfaceId: 'legal-corpus.court@1',
      sourceSchemaId: 'unversioned',
    });
    expect(caselaw).toEqual({
      interfaceId: 'legal-corpus.caselaw@1',
      sourceSchemaId: 'unversioned',
    });
    expect(cap).toEqual({
      interfaceId: 'legal-corpus.caselaw@1',
      sourceSchemaId: 'unversioned',
    });
    expect(municipal).toEqual({
      interfaceId: 'legal-corpus.municipal-instrument@1',
      sourceSchemaId: 'world_municipal/schema.py',
    });

    expect(courts).toEqual({
      interfaceId: COURT_KIND_VERSION,
      sourceSchemaId: COURT_SOURCE_SCHEMA_ID,
    });
    expect(caselaw).toEqual({
      interfaceId: CASELAW_KIND_VERSION,
      sourceSchemaId: CASELAW_SOURCE_SCHEMA_ID,
    });
    expect(cap).toEqual({
      interfaceId: CASELAW_KIND_VERSION,
      sourceSchemaId: CASELAW_SOURCE_SCHEMA_ID,
    });
    expect(municipal).toEqual({
      interfaceId: MUNICIPAL_KIND_VERSION,
      sourceSchemaId: MUNICIPAL_SOURCE_SCHEMA_FILE,
    });

    for (const [datasetId, hit] of Object.entries(HUB_DATASET_BINDINGS)) {
      expect(Object.keys(hit).sort()).toEqual(['interfaceId', 'sourceSchemaId']);
      expect(hit.sourceSchemaId).not.toBe(datasetId);
      expect(hit.interfaceId).not.toBe(datasetId);
      expect(hit.sourceSchemaId).not.toBe('country-laws-ir-graphrag/v1');
    }
  });

  test('leaves unmarked dataset ids and regulation processor ids unbound', () => {
    expect(lookupHubDatasetBinding('endomorphosis/world_national_law')).toBeNull();
    expect(lookupHubDatasetBinding('justicedao/wetwijzer_netherlands_legal_corpus')).toBeNull();
    expect(lookupHubDatasetBinding('endomorphosis/ipfs_fixture_laws')).toBeNull();
    expect(lookupHubDatasetBinding('justicedao/ipfs_netherlands_laws')).toBeNull();
    expect(lookupHubDatasetBinding('')).toBeNull();
    expect(lookupHubDatasetBinding('unversioned')).toBeNull();
    expect(lookupHubDatasetBinding('legal-corpus.court@1')).toBeNull();
    expect(lookupHubDatasetBinding('world_municipal/schema.py')).toBeNull();

    const keys = Object.keys(HUB_DATASET_BINDINGS);
    expect(keys.sort()).toEqual([
      CAP_EMBEDDINGS_DATASET_ID,
      WORLD_CASELAW_REPO,
      WORLD_COURTS_REPO,
      WORLD_MUNICIPAL_REPO,
    ].sort());

    expect([...REGULATION_SOURCE_SCHEMA_IDS]).toEqual([
      'cfr-annual-processor-v1',
      'live-cfr-source-processor-v1',
      'ecfr-crosscheck-processor-v1',
      'federal-register-change-processor-v1',
      'federal-register-sparse-graphrag-release-schema-v2',
    ]);
    for (const processorId of REGULATION_SOURCE_SCHEMA_IDS) {
      expect(keys).not.toContain(processorId);
      expect(lookupHubDatasetBinding(processorId)).toBeNull();
    }
    expect(keys).not.toContain('endomorphosis/world_national_law');
    expect(keys).not.toContain('justicedao/wetwijzer_netherlands_legal_corpus');
  });
});

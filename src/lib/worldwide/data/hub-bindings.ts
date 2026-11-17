/**
 * Dataset-id binding for a catalog source.
 *
 * A hit exists only for a dataset id a landed constant already names.
 * `interfaceId` and `sourceSchemaId` are the ids that constant's module
 * assigns. A dataset id is not a source schema id. Regulation processor
 * ids are not keys. `endomorphosis/world_national_law` and
 * `justicedao/wetwijzer_netherlands_legal_corpus` stay unmarked.
 */

import {
  CASELAW_KIND_VERSION,
  CASELAW_SOURCE_SCHEMA_ID,
} from '../views/caselaw';
import {
  COURT_KIND_VERSION,
  COURT_SOURCE_SCHEMA_ID,
  WORLD_COURTS_REPO,
} from '../views/court';
import {
  MUNICIPAL_KIND_VERSION,
  MUNICIPAL_SOURCE_SCHEMA_FILE,
} from '../views/municipal-instrument';
import { REGULATION_SOURCE_SCHEMA_IDS } from '../views/regulation';

export interface HubDatasetBinding {
  interfaceId: string;
  sourceSchemaId: string;
}

/** `WORLD_REPO` in `caselaw_v1.py`. That module assigns `unversioned`. */
const WORLD_CASELAW_REPO = 'endomorphosis/world_caselaw';
/** `CAP_DATASET_ID` in `caselaw_v1.py`. That module assigns `unversioned`. */
const CAP_EMBEDDINGS_DATASET_ID = 'justicedao/Caselaw_Access_Project_embeddings';
/**
 * `REPO_ID` in the world-law pipeline schema. The municipal kind assigns
 * `world_municipal/schema.py`, not that pipeline `SCHEMA_VERSION`.
 */
const WORLD_MUNICIPAL_REPO = 'endomorphosis/world_municipal_law';

const PROCESSOR_IDS = new Set<string>(REGULATION_SOURCE_SCHEMA_IDS);

function claim(
  datasetId: string,
  interfaceId: string,
  sourceSchemaId: string,
): HubDatasetBinding | null {
  if (datasetId.length === 0 || interfaceId.length === 0 || sourceSchemaId.length === 0) {
    return null;
  }
  if (sourceSchemaId === datasetId || interfaceId === datasetId) return null;
  if (PROCESSOR_IDS.has(datasetId) || PROCESSOR_IDS.has(sourceSchemaId)) return null;
  return Object.freeze({ interfaceId, sourceSchemaId });
}

function bind(
  table: Record<string, HubDatasetBinding>,
  datasetId: string,
  interfaceId: string,
  sourceSchemaId: string,
): void {
  const row = claim(datasetId, interfaceId, sourceSchemaId);
  if (row) table[datasetId] = row;
}

const table: Record<string, HubDatasetBinding> = {};
bind(table, WORLD_COURTS_REPO, COURT_KIND_VERSION, COURT_SOURCE_SCHEMA_ID);
bind(table, WORLD_CASELAW_REPO, CASELAW_KIND_VERSION, CASELAW_SOURCE_SCHEMA_ID);
bind(table, CAP_EMBEDDINGS_DATASET_ID, CASELAW_KIND_VERSION, CASELAW_SOURCE_SCHEMA_ID);
bind(table, WORLD_MUNICIPAL_REPO, MUNICIPAL_KIND_VERSION, MUNICIPAL_SOURCE_SCHEMA_FILE);

export const HUB_DATASET_BINDINGS: Readonly<Record<string, HubDatasetBinding>> = Object.freeze(table);

/** Interface id and source schema id for a dataset id a landed constant names. */
export function lookupHubDatasetBinding(datasetId: string): HubDatasetBinding | null {
  if (typeof datasetId !== 'string') return null;
  if (!Object.prototype.hasOwnProperty.call(HUB_DATASET_BINDINGS, datasetId)) return null;
  return HUB_DATASET_BINDINGS[datasetId] ?? null;
}

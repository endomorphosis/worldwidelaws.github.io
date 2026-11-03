/**
 * Revision-pinned browser catalog and coverage matrix.
 *
 * Every jurisdiction, source capability, and level has a coverage state:
 * known, partial, missing, unknown, or unavailable. Each cell carries an
 * as-of date, a collection count, and a record denominator. Legal
 * completeness stays not_claimed. A count is never read as complete.
 * Integrity is the SHA-256 of the canonical cell, including member revisions.
 * Repository slugs are not jurisdiction ids.
 */

import { canonicalJson, sha256HexUtf8 } from './identity.ts';

export const CATALOG_SCHEMA = 'worldwide-legal-search.catalog@1';
export const COVERAGE_STATES = Object.freeze(['known', 'partial', 'missing', 'unknown', 'unavailable'] as const);
export const LEVELS = Object.freeze(['national', 'regional', 'municipal', 'other'] as const);
export const SOURCE_CAPABILITIES = Object.freeze([
  'articles',
  'bm25',
  'boundary',
  'cid',
  'code',
  'corpus',
  'graph',
  'index',
  'laws',
  'logic',
  'metadata',
  'text',
  'vector',
] as const);
export const LEGAL_COMPLETENESS = 'not_claimed' as const;
export const LAW_JURISDICTION_ID = 'unstated';
export const CATALOG_BYTE_BUDGET = 1024 * 1024;

export type CoverageState = (typeof COVERAGE_STATES)[number];
export type Level = (typeof LEVELS)[number];
export type LegalCompleteness = typeof LEGAL_COMPLETENESS;
export type Decision = 'include' | 'blocked' | 'exclude';
export type RightsStatus = 'resolved' | 'unresolved' | 'absent';
export type DenominatorKind = 'viewer-rows' | 'metadata-files' | 'not-counted';

export class CatalogError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'CatalogError';
    this.code = code;
  }
}

export interface CatalogSource {
  dataset_id: string;
  resolved_revision: string;
  jurisdiction_id: string;
  levels: Level[];
  counted_levels: Level[];
  capabilities: string[];
  decision: Decision;
  denominator_kind: 'viewer-rows' | 'metadata-files';
  viewer_rows: number | null;
  level_denominators: Partial<Record<Level, number | null>>;
  files_complete: boolean;
  rights_status: RightsStatus;
  card_sha256: string | null;
  census_files: number | null;
  license_sha256: string | null;
  citation_sha256: string | null;
  rollup_sha256: string | null;
}

export interface CoverageCell {
  jurisdiction_id: string;
  level: Level;
  capability: string;
  coverage_state: CoverageState;
  record_denominator: number;
  denominator_kind: DenominatorKind;
  collection_count: number;
  uncounted_collections: number;
  blocked_count: number;
  legal_completeness: LegalCompleteness;
  as_of: string;
  integrity: { sha256: string };
  reason: string;
}

export interface BrowserCatalog {
  schema: typeof CATALOG_SCHEMA;
  inventory_revision: string;
  disposition_revision: string;
  geography_revision: string;
  geography_manifest_sha256: string;
  as_of: string;
  legal_completeness: LegalCompleteness;
  collection_count: number;
  record_denominator: number;
  uncounted_collections: number;
  boundary_collection_count: number;
  boundary_record_denominator: number;
  counts_are_not_legal_completeness: true;
  record_denominator_note: string;
  jurisdictions: string[];
  levels: readonly Level[];
  capabilities: string[];
  by_state: Record<CoverageState, number>;
  sources: CatalogSource[];
  cells: CoverageCell[];
  integrity: { sha256: string };
}

export interface CatalogTexts {
  inventoryText: string;
  dispositionText: string;
  rightsText: string;
  geographyText: string;
}

const DATE_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}(?:T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?Z)?$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const GIT_REVISION = /^[0-9a-f]{40}$/;
const DATASET_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const CAPABILITY_NAME = /^[a-z][a-z0-9_-]{0,40}$/;
const FAMILIES = new Set(['national', 'regional', 'municipal', 'country-ir', 'unified-netherlands', 'legacy-index']);
const RECORD_NOTE =
  'record_denominator sums viewer row counts once per included law collection. A cell denominator repeats a collection that advertises more than one capability. boundary_record_denominator is place-registry metadata files and is not added to record_denominator. Collection counts and either denominator are not legal completeness.';

interface InventoryDataset {
  dataset_id: string;
  resolved_revision: string;
  card_sha256: string | null;
  files_complete: boolean;
  viewer_rows: number | null;
  access_error: unknown;
  gated: boolean;
  private: boolean;
  disabled: boolean;
}

interface DispositionRow {
  dataset_id: string;
  family: string | null;
  decision: Decision;
  reason: string;
  capabilities: string[];
  resolved_revision: string;
}

interface RightsRow {
  dataset_id: string;
  artifact_revision: string;
  card_sha256: string | null;
  status: string;
  inferred_from_organization: boolean;
  rights: string | null;
}

interface GeographyPin {
  dataset_id: string;
  revision: string;
  acquired_on: string;
  committed_at: string;
  municipality_detail: string;
  complete_world: boolean;
  hierarchical: boolean;
  metadata_files: number;
  country_directories: number;
  by_level: Record<string, number>;
  municipal_files: number;
  open_municipal_files: number;
  missing_adm0: string[];
  license_sha256: string;
  citation_sha256: string;
  rollup_sha256: string;
}

/** Legal completeness is never derived from a collection count or a record denominator. */
export function legalCompleteness(): LegalCompleteness {
  return LEGAL_COMPLETENESS;
}

export function publishCatalog(texts: CatalogTexts): BrowserCatalog {
  const inventoryHash = sha256HexUtf8(texts.inventoryText);
  const dispositionHash = sha256HexUtf8(texts.dispositionText);
  const geographyHash = sha256HexUtf8(texts.geographyText);
  const inventory = parseInventory(parseJson(texts.inventoryText, 'inventory'));
  const dispositions = parseDispositions(parseJson(texts.dispositionText, 'dispositions'));
  const rights = parseRights(parseJson(texts.rightsText, 'rights'));
  const geography = parseGeography(parseJson(texts.geographyText, 'geography'));
  if (dispositions.inventoryRevision !== inventoryHash) {
    throw new CatalogError('integrity', 'disposition inventory_revision does not match the inventory bytes');
  }
  if (rights.inventoryRevision !== inventoryHash || rights.dispositionRevision !== dispositionHash) {
    throw new CatalogError('integrity', 'rights revisions do not match the inventory and disposition bytes');
  }
  const sources = sourcesFromCorpus(inventory, dispositions.rows, rights.rows, geography);
  const catalog = buildCoverageMatrix({
    sources,
    inventoryRevision: inventoryHash,
    dispositionRevision: dispositionHash,
    geographyRevision: geography.revision,
    geographyManifestSha256: geographyHash,
    lawAsOf: inventory.retrievedAt,
    boundaryAsOf: geography.acquired_on,
    boundaryJurisdiction: geography.dataset_id,
  });
  validateBrowserCatalog(catalog);
  const bytes = utf8Length(JSON.stringify(catalog));
  if (bytes > CATALOG_BYTE_BUDGET) {
    throw new CatalogError('budget', 'browser catalog is ' + bytes + ' bytes and the budget is ' + CATALOG_BYTE_BUDGET);
  }
  return catalog;
}

export function validateBrowserCatalog(catalog: BrowserCatalog): void {
  if (catalog.schema !== CATALOG_SCHEMA) throw new CatalogError('schema', 'unexpected catalog schema');
  if (catalog.legal_completeness !== legalCompleteness() || catalog.counts_are_not_legal_completeness !== true) {
    throw new CatalogError('legal_completeness', 'the catalog must not claim legal completeness');
  }
  if (catalog.record_denominator_note !== RECORD_NOTE) throw new CatalogError('coverage', 'denominator note drifted');
  requireSha256(catalog.inventory_revision, 'inventory_revision');
  requireSha256(catalog.disposition_revision, 'disposition_revision');
  requireSha256(catalog.geography_manifest_sha256, 'geography_manifest_sha256');
  requireGitRevision(catalog.geography_revision, 'geography_revision');
  requireDate(catalog.as_of, 'as_of');
  if (catalog.jurisdictions.length < 2 || catalog.jurisdictions[0] !== LAW_JURISDICTION_ID) {
    throw new CatalogError('coverage', 'the matrix needs the unstated law jurisdiction and the boundary source');
  }
  if (catalog.levels.join(',') !== LEVELS.join(',')) throw new CatalogError('coverage', 'level axis drifted');
  for (const capability of SOURCE_CAPABILITIES) {
    if (!catalog.capabilities.includes(capability)) throw new CatalogError('coverage', 'capability axis is missing ' + capability);
  }
  const expectedCells = catalog.jurisdictions.length * LEVELS.length * catalog.capabilities.length;
  if (catalog.cells.length !== expectedCells) {
    throw new CatalogError('coverage', 'coverage matrix does not contain every jurisdiction, level, and capability');
  }
  const seen = new Set<string>();
  const byState = emptyStates();
  for (const cell of catalog.cells) {
    const key = cell.jurisdiction_id + '\t' + cell.level + '\t' + cell.capability;
    if (seen.has(key)) throw new CatalogError('coverage', 'duplicate coverage cell ' + key);
    seen.add(key);
    assertCell(cell, catalog);
    byState[cell.coverage_state] += 1;
  }
  for (const jurisdiction of catalog.jurisdictions) {
    for (const level of LEVELS) {
      for (const capability of catalog.capabilities) {
        if (!seen.has(jurisdiction + '\t' + level + '\t' + capability)) {
          throw new CatalogError('coverage', 'missing coverage cell ' + jurisdiction + ' ' + level + ' ' + capability);
        }
      }
    }
  }
  for (const state of COVERAGE_STATES) {
    if (catalog.by_state[state] !== byState[state]) throw new CatalogError('coverage', 'by_state does not match the cells');
  }
  const totals = totalsFromSources(catalog.sources);
  if (catalog.collection_count !== totals.collectionCount) throw new CatalogError('coverage', 'collection_count drifted from included law collections');
  if (catalog.record_denominator !== totals.recordDenominator) throw new CatalogError('coverage', 'record denominator drifted from viewer rows');
  if (catalog.uncounted_collections !== totals.uncounted) throw new CatalogError('coverage', 'uncounted collections drifted');
  if (catalog.boundary_collection_count !== totals.boundaryCollections) throw new CatalogError('coverage', 'boundary collection count drifted');
  if (catalog.boundary_record_denominator !== totals.boundaryFiles) throw new CatalogError('coverage', 'boundary record denominator drifted');
  if (catalog.record_denominator !== totals.recordDenominator || catalog.boundary_record_denominator === undefined) {
    throw new CatalogError('legal_completeness', 'boundary files must stay outside the law record denominator');
  }
  const digest = catalogDigest(catalog);
  if (catalog.integrity.sha256 !== digest) throw new CatalogError('integrity', 'catalog integrity digest does not match the pinned sources');
}

export function assertCatalogInvariants(): void {
  const inventory = {
    schema: 'worldwide-legal-search.source-inventory@1',
    retrieved_at: '2026-10-30T09:39:25.250Z',
    organizations: [
      {
        datasets: [
          dataset('endomorphosis/ipfs_fixture_laws', 'a'.repeat(40), 'b'.repeat(64), true, 5, null),
          dataset('endomorphosis/ipfs_fixture_regional', 'c'.repeat(40), 'd'.repeat(64), false, null, null),
          dataset('endomorphosis/ipfs_fixture_municipal', 'e'.repeat(40), 'f'.repeat(64), false, 2, null),
          dataset('endomorphosis/legal_scrapers', '1'.repeat(40), '2'.repeat(64), true, null, null),
        ],
      },
    ],
  };
  const inventoryText = JSON.stringify(inventory);
  const inventoryHash = sha256HexUtf8(inventoryText);
  const dispositions = {
    schema: 'worldwide-legal-search.source-dispositions@1',
    inventory_revision: inventoryHash,
    dispositions: [
      row('endomorphosis/ipfs_fixture_laws', 'national', 'include', 'Included as national law text. The repository id was not used.', ['laws', 'text'], 'a'.repeat(40)),
      row('endomorphosis/ipfs_fixture_regional', 'regional', 'include', 'Included as regional law text. The repository id was not used.', ['text'], 'c'.repeat(40)),
      row('endomorphosis/legal_scrapers', 'national', 'exclude', 'Excluded as a code-only release for the national collector role.', ['code'], '1'.repeat(40)),
    ],
    unassigned: [
      row('endomorphosis/ipfs_fixture_municipal', null, 'blocked', 'No administrative level was established.', ['laws'], 'e'.repeat(40)),
    ],
  };
  const dispositionText = JSON.stringify(dispositions);
  const dispositionHash = sha256HexUtf8(dispositionText);
  const rights = {
    schema: 'worldwide-legal-search.rights@1',
    inventory_revision: inventoryHash,
    disposition_revision: dispositionHash,
    records: [
      rightsRow('endomorphosis/ipfs_fixture_laws', 'a'.repeat(40), 'b'.repeat(64), 'resolved', false, 'CC0-1.0'),
      rightsRow('endomorphosis/ipfs_fixture_regional', 'c'.repeat(40), 'd'.repeat(64), 'unresolved', false, null),
      rightsRow('endomorphosis/ipfs_fixture_municipal', 'e'.repeat(40), 'f'.repeat(64), 'unresolved', false, null),
      rightsRow('endomorphosis/legal_scrapers', '1'.repeat(40), '2'.repeat(64), 'resolved', false, 'AGPL-3.0'),
    ],
  };
  const geography = fixtureGeography();
  const catalog = publishCatalog({
    inventoryText,
    dispositionText,
    rightsText: JSON.stringify(rights),
    geographyText: JSON.stringify(geography),
  });
  const known = findCell(catalog, LAW_JURISDICTION_ID, 'national', 'laws');
  if (known.coverage_state !== 'known' || known.collection_count !== 1 || known.record_denominator !== 5) {
    throw new CatalogError('coverage', 'fixture national laws cell was not known with its record denominator');
  }
  if (known.legal_completeness !== 'not_claimed' || known.collection_count === known.record_denominator && known.legal_completeness !== 'not_claimed') {
    throw new CatalogError('legal_completeness', 'equal collection and record counts were treated as legal completeness');
  }
  const partial = findCell(catalog, LAW_JURISDICTION_ID, 'regional', 'text');
  if (partial.coverage_state !== 'partial' || partial.record_denominator !== 0 || partial.uncounted_collections !== 1) {
    throw new CatalogError('coverage', 'a collection without a viewer row count must stay partial and uncounted');
  }
  const blocked = findCell(catalog, LAW_JURISDICTION_ID, 'other', 'laws');
  if (blocked.coverage_state !== 'unavailable' || blocked.collection_count !== 0 || blocked.blocked_count !== 1) {
    throw new CatalogError('coverage', 'a blocked collection must stay unavailable and outside collection_count');
  }
  const missing = findCell(catalog, LAW_JURISDICTION_ID, 'municipal', 'text');
  if (missing.coverage_state !== 'missing' || missing.record_denominator !== 0) {
    throw new CatalogError('coverage', 'an absent municipal text capability must stay missing');
  }
  const boundary = findCell(catalog, 'wmgeolab/geoBoundaries', 'municipal', 'boundary');
  if (boundary.coverage_state !== 'partial' || boundary.denominator_kind !== 'metadata-files' || boundary.legal_completeness !== 'not_claimed') {
    throw new CatalogError('coverage', 'municipal boundary files must stay partial metadata, not legal completeness');
  }
  if (boundary.record_denominator !== 1 || catalog.record_denominator === catalog.boundary_record_denominator) {
    throw new CatalogError('legal_completeness', 'boundary metadata files were mixed into the law record denominator');
  }
  const unknown = findCell(catalog, 'wmgeolab/geoBoundaries', 'other', 'boundary');
  if (unknown.coverage_state !== 'unknown' || unknown.denominator_kind !== 'not-counted') {
    throw new CatalogError('coverage', 'unassigned ADM files must stay unknown instead of a second count');
  }
  const tampered = structuredClone(catalog);
  tampered.cells[0].legal_completeness = 'complete' as LegalCompleteness;
  let rejected = false;
  try {
    validateBrowserCatalog(tampered);
  } catch (error) {
    rejected = error instanceof CatalogError && error.code === 'legal_completeness';
  }
  if (!rejected) throw new CatalogError('legal_completeness', 'a complete legal_completeness value was accepted');
}

function buildCoverageMatrix(input: {
  sources: CatalogSource[];
  inventoryRevision: string;
  dispositionRevision: string;
  geographyRevision: string;
  geographyManifestSha256: string;
  lawAsOf: string;
  boundaryAsOf: string;
  boundaryJurisdiction: string;
}): BrowserCatalog {
  const capabilities = [...SOURCE_CAPABILITIES];
  for (const source of input.sources) {
    for (const capability of source.capabilities) {
      if (!capabilities.includes(capability)) capabilities.push(capability);
    }
  }
  capabilities.sort((left, right) => left.localeCompare(right));
  const jurisdictions = [LAW_JURISDICTION_ID, input.boundaryJurisdiction];
  const cells: CoverageCell[] = [];
  for (const jurisdictionId of jurisdictions) {
    for (const level of LEVELS) {
      for (const capability of capabilities) {
        cells.push(buildCell(input, jurisdictionId, level, capability));
      }
    }
  }
  const totals = totalsFromSources(input.sources);
  const byState = emptyStates();
  for (const cell of cells) byState[cell.coverage_state] += 1;
  const catalog: BrowserCatalog = {
    schema: CATALOG_SCHEMA,
    inventory_revision: input.inventoryRevision,
    disposition_revision: input.dispositionRevision,
    geography_revision: input.geographyRevision,
    geography_manifest_sha256: input.geographyManifestSha256,
    as_of: input.lawAsOf,
    legal_completeness: legalCompleteness(),
    collection_count: totals.collectionCount,
    record_denominator: totals.recordDenominator,
    uncounted_collections: totals.uncounted,
    boundary_collection_count: totals.boundaryCollections,
    boundary_record_denominator: totals.boundaryFiles,
    counts_are_not_legal_completeness: true,
    record_denominator_note: RECORD_NOTE,
    jurisdictions,
    levels: LEVELS,
    capabilities,
    by_state: byState,
    sources: input.sources,
    cells,
    integrity: { sha256: '' },
  };
  catalog.integrity = { sha256: catalogDigest(catalog) };
  return catalog;
}

function buildCell(
  input: {
    sources: CatalogSource[];
    inventoryRevision: string;
    geographyRevision: string;
    lawAsOf: string;
    boundaryAsOf: string;
  },
  jurisdictionId: string,
  level: Level,
  capability: string,
): CoverageCell {
  const members = input.sources.filter((source) => memberOf(source, jurisdictionId, level, capability) && source.decision !== 'exclude');
  const included = members.filter((source) => source.decision === 'include' && source.counted_levels.includes(level));
  const blocked = members.filter((source) => source.decision === 'blocked');
  const consulted = members.filter((source) => source.decision === 'include' && !source.counted_levels.includes(level));
  let denominator = 0;
  let uncounted = 0;
  let kind: DenominatorKind = 'not-counted';
  for (const source of included) {
    const contribution = source.level_denominators[level];
    if (source.denominator_kind === 'metadata-files') kind = 'metadata-files';
    else if (kind !== 'metadata-files') kind = 'viewer-rows';
    if (typeof contribution === 'number') denominator += contribution;
    else uncounted += 1;
  }
  if (!Number.isSafeInteger(denominator)) throw new CatalogError('coverage', 'record denominator is outside the safe integer range');
  const asOf = jurisdictionId === LAW_JURISDICTION_ID ? input.lawAsOf : input.boundaryAsOf;
  let state: CoverageState;
  if (included.length === 0 && blocked.length === 0 && consulted.length > 0) state = 'unknown';
  else if (included.length === 0 && blocked.length === 0) state = 'missing';
  else if (included.length === 0) state = 'unavailable';
  else if (blocked.length === 0 && uncounted === 0 && included.every((source) => readyForKnown(source, level)) && capability !== 'boundary') state = 'known';
  else state = 'partial';
  if (state === 'missing' || state === 'unavailable' || state === 'unknown') {
    denominator = 0;
    kind = 'not-counted';
    uncounted = 0;
  }
  const cell: CoverageCell = {
    jurisdiction_id: jurisdictionId,
    level,
    capability,
    coverage_state: state,
    record_denominator: denominator,
    denominator_kind: kind,
    collection_count: included.length,
    uncounted_collections: uncounted,
    blocked_count: blocked.length,
    legal_completeness: legalCompleteness(),
    as_of: asOf,
    integrity: { sha256: '' },
    reason: cellReason(state, included.length, blocked.length, uncounted, denominator, kind, level, capability),
  };
  assertCountIsNotLegalCompleteness(cell);
  cell.integrity = {
    sha256: sha256HexUtf8(canonicalJson(cellIdentity(cell, members, input.inventoryRevision, input.geographyRevision))),
  };
  return cell;
}

function cellIdentity(cell: CoverageCell, members: CatalogSource[], inventoryRevision: string, geographyRevision: string): Record<string, unknown> {
  return {
    as_of: cell.as_of,
    blocked_count: cell.blocked_count,
    capability: cell.capability,
    collection_count: cell.collection_count,
    coverage_state: cell.coverage_state,
    denominator_kind: cell.denominator_kind,
    geography_revision: geographyRevision,
    inventory_revision: inventoryRevision,
    jurisdiction_id: cell.jurisdiction_id,
    legal_completeness: cell.legal_completeness,
    level: cell.level,
    record_denominator: cell.record_denominator,
    sources: members
      .map((source) => ({
        counted: source.counted_levels.includes(cell.level),
        dataset_id: source.dataset_id,
        decision: source.decision,
        files_complete: source.files_complete,
        resolved_revision: source.resolved_revision,
        rights_status: source.rights_status,
        row_count: source.level_denominators[cell.level] ?? null,
      }))
      .sort((left, right) => left.dataset_id.localeCompare(right.dataset_id)),
    uncounted_collections: cell.uncounted_collections,
  };
}

function cellReason(
  state: CoverageState,
  collections: number,
  blocked: number,
  uncounted: number,
  denominator: number,
  kind: DenominatorKind,
  level: Level,
  capability: string,
): string {
  const unit = kind === 'metadata-files' ? 'metadata files' : kind === 'viewer-rows' ? 'viewer rows' : 'no counted unit';
  const lead =
    state === 'known'
      ? 'Pinned collections have a revision, no omitted sibling paths, a positive viewer row count, and resolved rights that were not inferred from organization membership.'
      : state === 'partial'
        ? 'Some pinned collections are listed, and the cell is partial because rights, sibling paths, row counts, blocked siblings, or boundary limits are unresolved.'
        : state === 'missing'
          ? 'No included or blocked collection advertises this jurisdiction, level, and capability.'
          : state === 'unavailable'
            ? 'Collections exist for this cell and cannot be read. They are blocked, not included.'
            : level === 'other' && capability === 'boundary'
              ? 'ADM files above ADM1 are not given a jurisdiction level. An ADM number is not a municipality, so those files are not counted again.'
              : 'This cell was consulted and the record denominator was not assigned.';
  return (
    lead +
    ' collection_count is ' +
    collections +
    ' pinned collections. blocked_count is ' +
    blocked +
    '. The record denominator is ' +
    denominator +
    ' ' +
    unit +
    '. Uncounted collections: ' +
    uncounted +
    '. legal_completeness is not_claimed.'
  );
}

function readyForKnown(source: CatalogSource, level: Level): boolean {
  const rows = source.level_denominators[level];
  return source.files_complete && source.rights_status === 'resolved' && typeof rows === 'number' && rows > 0 && source.denominator_kind === 'viewer-rows';
}

function memberOf(source: CatalogSource, jurisdictionId: string, level: Level, capability: string): boolean {
  return source.jurisdiction_id === jurisdictionId && source.levels.includes(level) && source.capabilities.includes(capability);
}

function assertCountIsNotLegalCompleteness(cell: CoverageCell): void {
  if (cell.legal_completeness !== 'not_claimed') {
    throw new CatalogError('legal_completeness', 'collection counts and record denominators are not legal completeness');
  }
}

function assertCell(cell: CoverageCell, catalog: BrowserCatalog): void {
  if (!COVERAGE_STATES.includes(cell.coverage_state)) throw new CatalogError('coverage', 'coverage state is outside the closed set');
  if (!LEVELS.includes(cell.level)) throw new CatalogError('coverage', 'level is outside the closed set');
  if (!catalog.capabilities.includes(cell.capability)) throw new CatalogError('coverage', 'capability is outside the catalog axis');
  if (!catalog.jurisdictions.includes(cell.jurisdiction_id)) throw new CatalogError('coverage', 'jurisdiction is outside the catalog axis');
  requireDate(cell.as_of, 'cell.as_of');
  requireSha256(cell.integrity.sha256, 'cell.integrity');
  for (const value of [cell.record_denominator, cell.collection_count, cell.uncounted_collections, cell.blocked_count]) {
    if (!Number.isInteger(value) || value < 0) throw new CatalogError('coverage', 'a coverage count is not a non-negative integer');
  }
  assertCountIsNotLegalCompleteness(cell);
  if (cell.coverage_state === 'known') {
    if (cell.collection_count < 1 || cell.record_denominator < 1 || cell.denominator_kind !== 'viewer-rows' || cell.blocked_count !== 0 || cell.uncounted_collections !== 0) {
      throw new CatalogError('coverage', 'a known cell needs included collections and a positive viewer-row denominator');
    }
    if (cell.capability === 'boundary') throw new CatalogError('legal_completeness', 'boundary metadata cannot use the known state');
  }
  if ((cell.coverage_state === 'missing' || cell.coverage_state === 'unavailable' || cell.coverage_state === 'unknown') && (cell.record_denominator !== 0 || cell.denominator_kind !== 'not-counted')) {
    throw new CatalogError('coverage', 'an uncounted coverage state invented a record denominator');
  }
  if (cell.coverage_state === 'missing' && (cell.collection_count !== 0 || cell.blocked_count !== 0)) {
    throw new CatalogError('coverage', 'a missing cell still names a collection');
  }
  if (cell.coverage_state === 'unavailable' && (cell.collection_count !== 0 || cell.blocked_count < 1)) {
    throw new CatalogError('coverage', 'an unavailable cell must name blocked collections only');
  }
  const members = catalog.sources.filter((source) => memberOf(source, cell.jurisdiction_id, cell.level, cell.capability) && source.decision !== 'exclude');
  const digest = sha256HexUtf8(canonicalJson(cellIdentity(cell, members, catalog.inventory_revision, catalog.geography_revision)));
  if (digest !== cell.integrity.sha256) throw new CatalogError('integrity', 'cell integrity does not match ' + cell.jurisdiction_id + ' ' + cell.level + ' ' + cell.capability);
}

function catalogDigest(catalog: BrowserCatalog): string {
  return sha256HexUtf8(canonicalJson({
    as_of: catalog.as_of,
    boundary_collection_count: catalog.boundary_collection_count,
    boundary_record_denominator: catalog.boundary_record_denominator,
    cells: catalog.cells.map((cell) => ({
      capability: cell.capability,
      coverage_state: cell.coverage_state,
      jurisdiction_id: cell.jurisdiction_id,
      level: cell.level,
      sha256: cell.integrity.sha256,
    })),
    collection_count: catalog.collection_count,
    counts_are_not_legal_completeness: true,
    disposition_revision: catalog.disposition_revision,
    geography_manifest_sha256: catalog.geography_manifest_sha256,
    geography_revision: catalog.geography_revision,
    inventory_revision: catalog.inventory_revision,
    legal_completeness: catalog.legal_completeness,
    record_denominator: catalog.record_denominator,
    schema: catalog.schema,
    sources: catalog.sources.map((source) => ({
      capabilities: source.capabilities,
      card_sha256: source.card_sha256,
      citation_sha256: source.citation_sha256,
      dataset_id: source.dataset_id,
      decision: source.decision,
      levels: source.levels,
      license_sha256: source.license_sha256,
      resolved_revision: source.resolved_revision,
      rollup_sha256: source.rollup_sha256,
    })),
  }));
}

function totalsFromSources(sources: CatalogSource[]): { collectionCount: number; recordDenominator: number; uncounted: number; boundaryCollections: number; boundaryFiles: number } {
  let collectionCount = 0;
  let recordDenominator = 0;
  let uncounted = 0;
  let boundaryCollections = 0;
  let boundaryFiles = 0;
  for (const source of sources) {
    if (source.denominator_kind === 'metadata-files') {
      if (source.decision === 'include') boundaryCollections += 1;
      boundaryFiles += source.census_files ?? 0;
      continue;
    }
    if (source.decision !== 'include') continue;
    collectionCount += 1;
    if (source.viewer_rows === null) uncounted += 1;
    else recordDenominator += source.viewer_rows;
  }
  if (!Number.isSafeInteger(recordDenominator) || !Number.isSafeInteger(boundaryFiles)) {
    throw new CatalogError('coverage', 'a catalog denominator is outside the safe integer range');
  }
  return { collectionCount, recordDenominator, uncounted, boundaryCollections, boundaryFiles };
}

function sourcesFromCorpus(inventory: { retrievedAt: string; datasets: Map<string, InventoryDataset> }, rows: DispositionRow[], rightsRows: Map<string, RightsRow>, geography: GeographyPin): CatalogSource[] {
  const grouped = new Map<string, DispositionRow[]>();
  for (const row of rows) {
    const list = grouped.get(row.dataset_id) ?? [];
    list.push(row);
    grouped.set(row.dataset_id, list);
  }
  if (grouped.size !== inventory.datasets.size) {
    throw new CatalogError('coverage', 'disposition rows do not cover every inventory dataset');
  }
  const sources: CatalogSource[] = [];
  for (const [datasetId, dataset] of inventory.datasets) {
    const group = grouped.get(datasetId);
    if (!group) throw new CatalogError('coverage', 'inventory dataset has no disposition: ' + datasetId);
    const rights = rightsRows.get(datasetId);
    if (!rights) throw new CatalogError('integrity', 'inventory dataset has no rights record: ' + datasetId);
    sources.push(lawSource(dataset, group, rights));
  }
  sources.push(boundarySource(geography));
  sources.sort((left, right) => left.jurisdiction_id.localeCompare(right.jurisdiction_id) || left.dataset_id.localeCompare(right.dataset_id));
  return sources;
}

function lawSource(dataset: InventoryDataset, group: DispositionRow[], rights: RightsRow): CatalogSource {
  if (rights.artifact_revision !== dataset.resolved_revision) {
    throw new CatalogError('integrity', 'rights artifact_revision drifted for ' + dataset.dataset_id);
  }
  if (rights.card_sha256 !== dataset.card_sha256) {
    throw new CatalogError('integrity', 'rights card sha256 drifted for ' + dataset.dataset_id);
  }
  const decision = oneDecision(group, dataset.dataset_id);
  const revision = oneRevision(group, dataset);
  if (decision === 'include' && (dataset.access_error !== null || dataset.gated || dataset.private || dataset.disabled)) {
    throw new CatalogError('integrity', 'an included dataset is gated or has an access error: ' + dataset.dataset_id);
  }
  const levels = uniqueLevels(group.flatMap((row) => levelsFor(row.family, row.reason, row.decision)));
  const capabilities = uniqueCapabilities(group.flatMap((row) => row.capabilities));
  const counted = decision === 'include' ? levels : [];
  const levelDenominators: Partial<Record<Level, number | null>> = {};
  for (const level of counted) levelDenominators[level] = dataset.viewer_rows;
  const rightsStatus: RightsStatus = rights.status === 'resolved' && rights.inferred_from_organization === false && typeof rights.rights === 'string' && rights.rights.trim().length > 0
    ? 'resolved'
    : 'unresolved';
  return {
    dataset_id: dataset.dataset_id,
    resolved_revision: revision,
    jurisdiction_id: LAW_JURISDICTION_ID,
    levels,
    counted_levels: counted,
    capabilities,
    decision,
    denominator_kind: 'viewer-rows',
    viewer_rows: dataset.viewer_rows,
    level_denominators: levelDenominators,
    files_complete: dataset.files_complete,
    rights_status: rightsStatus,
    card_sha256: dataset.card_sha256,
    census_files: null,
    license_sha256: null,
    citation_sha256: null,
    rollup_sha256: null,
  };
}

function boundarySource(geography: GeographyPin): CatalogSource {
  if (geography.complete_world !== false) throw new CatalogError('legal_completeness', 'the place registry must not claim every place on earth');
  if (geography.hierarchical !== true) throw new CatalogError('coverage', 'the place registry layout is not hierarchical');
  if (geography.dataset_id === LAW_JURISDICTION_ID) throw new CatalogError('coverage', 'the boundary dataset id collides with the unstated jurisdiction');
  const adm0 = requiredCount(geography.by_level, 'ADM0');
  const adm1 = requiredCount(geography.by_level, 'ADM1');
  const sum = Object.values(geography.by_level).reduce((total, value) => total + value, 0);
  if (sum !== geography.metadata_files) throw new CatalogError('integrity', 'geography ADM counts do not add up to metadata_files');
  if (geography.country_directories !== adm0 + geography.missing_adm0.length) {
    throw new CatalogError('integrity', 'country directories do not match ADM0 plus missing ADM0');
  }
  if (geography.municipal_files < geography.open_municipal_files) {
    throw new CatalogError('integrity', 'open municipal files exceed the municipal file count');
  }
  const counted: Level[] = [];
  const denominators: Partial<Record<Level, number | null>> = {};
  if (adm0 > 0) {
    counted.push('national');
    denominators.national = adm0;
  }
  if (adm1 > 0) {
    counted.push('regional');
    denominators.regional = adm1;
  }
  if (geography.municipality_detail !== 'unavailable' && geography.municipal_files > 0) {
    counted.push('municipal');
    denominators.municipal = geography.municipal_files;
  }
  return {
    dataset_id: geography.dataset_id,
    resolved_revision: geography.revision,
    jurisdiction_id: geography.dataset_id,
    levels: [...LEVELS],
    counted_levels: counted,
    capabilities: ['boundary'],
    decision: 'include',
    denominator_kind: 'metadata-files',
    viewer_rows: null,
    level_denominators: denominators,
    files_complete: false,
    rights_status: 'absent',
    card_sha256: null,
    census_files: geography.metadata_files,
    license_sha256: geography.license_sha256,
    citation_sha256: geography.citation_sha256,
    rollup_sha256: geography.rollup_sha256,
  };
}

function levelsFor(family: string | null, reason: string, decision: Decision): Level[] {
  if (family === null) return ['other'];
  if (!FAMILIES.has(family)) throw new CatalogError('coverage', 'unknown source family ' + family);
  if (family === 'national' || family === 'regional' || family === 'municipal') return [family];
  if (family === 'unified-netherlands' || family === 'legacy-index') return ['other'];
  if (reason.includes('No administrative level was copied from the repository id.')) return ['other'];
  const match = /Card scope, after the repository id was removed: ([^.]+)\./.exec(reason);
  if (!match) {
    if (decision === 'exclude') return ['other'];
    throw new CatalogError('coverage', 'country IR disposition does not state an administrative level');
  }
  const levels: Level[] = [];
  for (const part of match[1].split(',')) {
    const token = part.trim();
    if (token !== 'national' && token !== 'regional' && token !== 'municipal') {
      throw new CatalogError('coverage', 'country IR scope is not an administrative level: ' + token);
    }
    levels.push(token);
  }
  if (levels.length === 0) throw new CatalogError('coverage', 'country IR scope is empty');
  return levels;
}

function oneDecision(group: DispositionRow[], datasetId: string): Decision {
  const decisions = new Set(group.map((row) => row.decision));
  if (decisions.size !== 1) throw new CatalogError('coverage', 'disposition decisions conflict for ' + datasetId);
  return group[0].decision;
}

function oneRevision(group: DispositionRow[], dataset: InventoryDataset): string {
  for (const row of group) {
    if (row.resolved_revision !== dataset.resolved_revision) {
      throw new CatalogError('integrity', 'disposition revision drifted for ' + dataset.dataset_id);
    }
  }
  return dataset.resolved_revision;
}

function uniqueLevels(levels: Level[]): Level[] {
  return LEVELS.filter((level) => levels.includes(level));
}

function uniqueCapabilities(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function parseInventory(value: unknown): { retrievedAt: string; datasets: Map<string, InventoryDataset> } {
  const record = objectAt(value, 'inventory');
  const retrievedAt = requireDate(stringField(record, 'retrieved_at', 'inventory'), 'inventory.retrieved_at');
  const organizations = arrayField(record, 'organizations', 'inventory');
  const datasets = new Map<string, InventoryDataset>();
  for (const organization of organizations) {
    const org = objectAt(organization, 'inventory.organizations');
    for (const entry of arrayField(org, 'datasets', 'inventory.organizations')) {
      const dataset = parseInventoryDataset(entry);
      if (datasets.has(dataset.dataset_id)) throw new CatalogError('integrity', 'duplicate inventory dataset ' + dataset.dataset_id);
      datasets.set(dataset.dataset_id, dataset);
    }
  }
  if (datasets.size === 0) throw new CatalogError('coverage', 'inventory has no datasets');
  return { retrievedAt, datasets };
}

function parseInventoryDataset(value: unknown): InventoryDataset {
  const record = objectAt(value, 'inventory.dataset');
  const datasetId = requireDatasetId(stringField(record, 'dataset_id', 'inventory.dataset'));
  const revision = requireGitRevision(stringField(record, 'resolved_revision', datasetId), datasetId);
  const card = objectAt(record.card, datasetId + '.card');
  const cardSha = card.sha256 === null ? null : requireSha256(stringField(card, 'sha256', datasetId + '.card'), datasetId + '.card');
  const fileRecord = objectAt(record.file_record, datasetId + '.file_record');
  if (typeof fileRecord.complete !== 'boolean') throw new CatalogError('integrity', datasetId + ' file_record.complete is not boolean');
  for (const file of arrayField(record, 'files', datasetId)) {
    const row = objectAt(file, datasetId + '.files');
    requireSha256(stringField(row, 'sha256', datasetId + '.files'), datasetId + '.files');
  }
  let viewerRows: number | null = null;
  if (record.sizes !== undefined && record.sizes !== null) {
    const sizes = objectAt(record.sizes, datasetId + '.sizes');
    if (sizes.num_rows !== undefined) viewerRows = requireCount(sizes.num_rows, datasetId + '.num_rows');
  }
  return {
    dataset_id: datasetId,
    resolved_revision: revision,
    card_sha256: cardSha,
    files_complete: fileRecord.complete,
    viewer_rows: viewerRows,
    access_error: record.access_error ?? null,
    gated: record.gated === true,
    private: record.private === true,
    disabled: record.disabled === true,
  };
}

function parseDispositions(value: unknown): { inventoryRevision: string; rows: DispositionRow[] } {
  const record = objectAt(value, 'dispositions');
  const inventoryRevision = requireSha256(stringField(record, 'inventory_revision', 'dispositions'), 'dispositions.inventory_revision');
  const rows = [...arrayField(record, 'dispositions', 'dispositions'), ...arrayField(record, 'unassigned', 'dispositions')].map((entry, index) => {
    const row = objectAt(entry, 'dispositions.rows[' + index + ']');
    const assigned = Object.prototype.hasOwnProperty.call(row, 'family');
    const family = assigned ? stringField(row, 'family', 'dispositions.family') : null;
    const decision = stringField(row, 'decision', 'dispositions.decision');
    if (decision !== 'include' && decision !== 'blocked' && decision !== 'exclude') {
      throw new CatalogError('coverage', 'disposition decision is not include, blocked, or exclude');
    }
    if (!assigned && decision === 'include') throw new CatalogError('coverage', 'an unassigned dataset cannot be included');
    return {
      dataset_id: requireDatasetId(stringField(row, 'dataset_id', 'dispositions')),
      family,
      decision,
      reason: stringField(row, 'reason', 'dispositions.reason'),
      capabilities: arrayField(row, 'schema_capabilities', 'dispositions').map((capability) => {
        if (typeof capability !== 'string' || !CAPABILITY_NAME.test(capability)) {
          throw new CatalogError('coverage', 'schema capability is not a closed token');
        }
        return capability;
      }),
      resolved_revision: requireGitRevision(stringField(row, 'resolved_revision', 'dispositions.revision'), 'dispositions.revision'),
    };
  });
  return { inventoryRevision, rows };
}

function parseRights(value: unknown): { inventoryRevision: string; dispositionRevision: string; rows: Map<string, RightsRow> } {
  const record = objectAt(value, 'rights');
  const rows = new Map<string, RightsRow>();
  for (const entry of arrayField(record, 'records', 'rights')) {
    const row = objectAt(entry, 'rights.records');
    const datasetId = requireDatasetId(stringField(row, 'dataset_id', 'rights'));
    if (rows.has(datasetId)) throw new CatalogError('integrity', 'duplicate rights record ' + datasetId);
    const card = row.card_sha256 === null ? null : requireSha256(stringField(row, 'card_sha256', datasetId), datasetId);
    const status = stringField(row, 'status', datasetId);
    if (status !== 'resolved' && status !== 'unresolved') throw new CatalogError('integrity', 'rights status is not resolved or unresolved');
    if (typeof row.inferred_from_organization !== 'boolean') throw new CatalogError('integrity', 'inferred_from_organization is not boolean');
    const grant = row.rights === null ? null : stringField(row, 'rights', datasetId);
    rows.set(datasetId, {
      dataset_id: datasetId,
      artifact_revision: requireGitRevision(stringField(row, 'artifact_revision', datasetId), datasetId),
      card_sha256: card,
      status,
      inferred_from_organization: row.inferred_from_organization,
      rights: grant,
    });
  }
  return {
    inventoryRevision: requireSha256(stringField(record, 'inventory_revision', 'rights'), 'rights.inventory_revision'),
    dispositionRevision: requireSha256(stringField(record, 'disposition_revision', 'rights'), 'rights.disposition_revision'),
    rows,
  };
}

function parseGeography(value: unknown): GeographyPin {
  const record = objectAt(value, 'geography');
  const source = objectAt(record.source, 'geography.source');
  const census = objectAt(record.census, 'geography.census');
  const byLevel = objectAt(census.by_level, 'geography.by_level');
  const levels: Record<string, number> = {};
  for (const key of Object.keys(byLevel)) levels[key] = requireCount(byLevel[key], 'geography.' + key);
  const datasetId = stringField(record, 'dataset_id', 'geography');
  if (!DATASET_ID.test(datasetId)) throw new CatalogError('coverage', 'geography dataset_id is not a dataset id');
  return {
    dataset_id: datasetId,
    revision: requireGitRevision(stringField(record, 'revision', 'geography'), 'geography.revision'),
    acquired_on: requireDate(stringField(source, 'acquired_on', 'geography'), 'geography.acquired_on'),
    committed_at: requireDate(stringField(source, 'committed_at', 'geography'), 'geography.committed_at'),
    municipality_detail: stringField(record, 'municipality_detail', 'geography'),
    complete_world: record.complete_world === true,
    hierarchical: record.hierarchical === true,
    metadata_files: requireCount(census.metadata_files, 'geography.metadata_files'),
    country_directories: requireCount(census.country_directories, 'geography.country_directories'),
    by_level: levels,
    municipal_files: requireCount(census.municipal_files, 'geography.municipal_files'),
    open_municipal_files: requireCount(census.open_municipal_files, 'geography.open_municipal_files'),
    missing_adm0: arrayField(census, 'missing_adm0', 'geography').map((item) => {
      if (typeof item !== 'string' || item.trim().length === 0) throw new CatalogError('coverage', 'missing_adm0 entry is empty');
      return item;
    }),
    license_sha256: requireSha256(stringField(source, 'license_file_sha256', 'geography'), 'geography.license'),
    citation_sha256: requireSha256(stringField(source, 'citation_file_sha256', 'geography'), 'geography.citation'),
    rollup_sha256: requireSha256(stringField(census, 'metadata_rollup_sha256', 'geography'), 'geography.rollup'),
  };
}

function dataset(id: string, revision: string, card: string, complete: boolean, rows: number | null, access: unknown): Record<string, unknown> {
  return {
    dataset_id: id,
    resolved_revision: revision,
    card: { sha256: card },
    files: [{ sha256: card }],
    file_record: { complete },
    sizes: rows === null ? undefined : { num_rows: rows },
    access_error: access,
    gated: false,
    private: false,
    disabled: false,
  };
}

function row(id: string, family: string | null, decision: Decision, reason: string, capabilities: string[], revision: string): Record<string, unknown> {
  const value: Record<string, unknown> = {
    dataset_id: id,
    decision,
    reason,
    schema_capabilities: capabilities,
    resolved_revision: revision,
  };
  if (family) value.family = family;
  return value;
}

function rightsRow(id: string, revision: string, card: string, status: string, inferred: boolean, grant: string | null): Record<string, unknown> {
  return {
    dataset_id: id,
    artifact_revision: revision,
    card_sha256: card,
    status,
    inferred_from_organization: inferred,
    rights: grant,
  };
}

function fixtureGeography(): Record<string, unknown> {
  return {
    dataset_id: 'wmgeolab/geoBoundaries',
    revision: '9'.repeat(40),
    municipality_detail: 'partial',
    complete_world: false,
    hierarchical: true,
    source: {
      acquired_on: '2026-10-30',
      committed_at: '2023-09-13T20:20:48Z',
      license_file_sha256: 'a'.repeat(64),
      citation_file_sha256: 'b'.repeat(64),
    },
    census: {
      metadata_files: 4,
      country_directories: 3,
      by_level: { ADM0: 2, ADM1: 1, ADM2: 1, ADM3: 0, ADM4: 0, ADM5: 0 },
      municipal_files: 1,
      open_municipal_files: 1,
      missing_adm0: ['PRI'],
      metadata_rollup_sha256: 'c'.repeat(64),
    },
  };
}

function findCell(catalog: BrowserCatalog, jurisdictionId: string, level: Level, capability: string): CoverageCell {
  const cell = catalog.cells.find((item) => item.jurisdiction_id === jurisdictionId && item.level === level && item.capability === capability);
  if (!cell) throw new CatalogError('coverage', 'fixture cell is absent');
  return cell;
}

function emptyStates(): Record<CoverageState, number> {
  return { known: 0, partial: 0, missing: 0, unknown: 0, unavailable: 0 };
}

function parseJson(text: string, label: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new CatalogError('schema', label + ' is not JSON: ' + (error instanceof Error ? error.message : 'parse error'));
  }
}

function objectAt(value: unknown, at: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CatalogError('schema', at + ' is not an object');
  return value as Record<string, unknown>;
}

function arrayField(record: Record<string, unknown>, key: string, at: string): unknown[] {
  const value = record[key];
  if (!Array.isArray(value)) throw new CatalogError('schema', at + '.' + key + ' is not an array');
  return value;
}

function stringField(record: Record<string, unknown>, key: string, at: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.trim().length === 0) throw new CatalogError('schema', at + '.' + key + ' is not a string');
  return value;
}

function requireCount(value: unknown, at: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) throw new CatalogError('coverage', at + ' is not a non-negative integer');
  return value;
}

function requiredCount(record: Record<string, number>, key: string): number {
  if (!Object.prototype.hasOwnProperty.call(record, key)) throw new CatalogError('coverage', 'geography census is missing ' + key);
  return record[key];
}

function requireSha256(value: string, at: string): string {
  if (!SHA256_PATTERN.test(value)) throw new CatalogError('integrity', at + ' is not a sha256 digest');
  return value;
}

function requireGitRevision(value: string, at: string): string {
  if (!GIT_REVISION.test(value)) throw new CatalogError('integrity', at + ' is not a pinned 40 hex revision');
  return value;
}

function requireDatasetId(value: string): string {
  if (!DATASET_ID.test(value)) throw new CatalogError('schema', 'dataset id is not org/name: ' + value);
  return value;
}

function requireDate(value: string, at: string): string {
  if (!DATE_PATTERN.test(value)) throw new CatalogError('coverage', at + ' is not a date');
  return value;
}

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).length;
}

#!/usr/bin/env node
/**
 * Publish the revision-pinned browser catalog and coverage matrix.
 *
 * The inventory, disposition, and rights files are hashed as bytes. Those
 * digests must match the revisions already pinned in the dispositions and
 * rights documents. The place registry keeps its own git revision. Collection
 * counts stay separate from record denominators, and neither becomes legal
 * completeness. The catalog is printed as a summary. It is not written back
 * over the pinned inputs.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  COVERAGE_STATES,
  LEVELS,
  SOURCE_CAPABILITIES,
  assertCatalogInvariants,
  publishCatalog,
  type BrowserCatalog,
} from '../../src/lib/worldwide/data/catalog.ts';

const ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));

function argument(argv: string[], name: string, fallback: string): string {
  const index = argv.indexOf(name);
  if (index < 0) return path.join(ROOT, fallback);
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(name + ' needs a path');
  return path.resolve(value);
}

function assertSchema(document: unknown): void {
  if (!document || typeof document !== 'object' || Array.isArray(document)) throw new Error('catalog schema is not an object');
  const schema = document as Record<string, unknown>;
  if (schema.$schema !== 'https://json-schema.org/draft/2020-12/schema') throw new Error('catalog schema is not JSON Schema 2020-12');
  if (schema.type !== 'object' || schema.additionalProperties !== false) throw new Error('catalog schema does not close the cell');
  const required = schema.required;
  for (const field of ['coverage_state', 'record_denominator', 'collection_count', 'legal_completeness', 'as_of', 'integrity']) {
    if (!Array.isArray(required) || !required.includes(field)) throw new Error('catalog schema does not require ' + field);
  }
  const properties = schema.properties as Record<string, Record<string, unknown>>;
  const coverage = properties.coverage_state.enum;
  if (!Array.isArray(coverage) || coverage.length !== COVERAGE_STATES.length || COVERAGE_STATES.some((state) => !coverage.includes(state))) {
    throw new Error('catalog schema coverage enum drifted');
  }
  const legal = properties.legal_completeness.enum;
  if (!Array.isArray(legal) || !legal.includes('not_claimed') || legal.includes('complete')) {
    throw new Error('catalog schema must not treat a count as legal completeness');
  }
  for (const field of ['record_denominator', 'collection_count']) {
    if (properties[field].type !== 'integer' || properties[field].minimum !== 0) throw new Error(field + ' is not a non-negative integer');
  }
  const integrity = properties.integrity;
  const digest = (integrity.properties as Record<string, Record<string, unknown>>).sha256;
  if (integrity.type !== 'object' || !Array.isArray(integrity.required) || !integrity.required.includes('sha256') || digest.pattern !== '^[0-9a-f]{64}$') {
    throw new Error('catalog schema integrity digest drifted');
  }
  const levels = properties.level.enum;
  if (!Array.isArray(levels) || levels.join(',') !== LEVELS.join(',')) throw new Error('catalog schema level enum drifted');
}

function summary(catalog: BrowserCatalog): Record<string, unknown> {
  const notable = catalog.cells
    .filter((cell) => cell.coverage_state === 'known' || cell.coverage_state === 'unknown' || cell.coverage_state === 'unavailable')
    .map((cell) => ({
      jurisdiction_id: cell.jurisdiction_id,
      level: cell.level,
      capability: cell.capability,
      coverage_state: cell.coverage_state,
      collection_count: cell.collection_count,
      blocked_count: cell.blocked_count,
      record_denominator: cell.record_denominator,
      denominator_kind: cell.denominator_kind,
    }));
  return {
    ok: true,
    schema: catalog.schema,
    catalog_bytes: Buffer.byteLength(JSON.stringify(catalog)),
    inventory_revision: catalog.inventory_revision,
    disposition_revision: catalog.disposition_revision,
    geography_revision: catalog.geography_revision,
    geography_manifest_sha256: catalog.geography_manifest_sha256,
    as_of: catalog.as_of,
    legal_completeness: catalog.legal_completeness,
    counts_are_not_legal_completeness: catalog.counts_are_not_legal_completeness,
    collection_count: catalog.collection_count,
    record_denominator: catalog.record_denominator,
    uncounted_collections: catalog.uncounted_collections,
    boundary_collection_count: catalog.boundary_collection_count,
    boundary_record_denominator: catalog.boundary_record_denominator,
    jurisdictions: catalog.jurisdictions,
    levels: catalog.levels,
    capabilities: catalog.capabilities,
    cells: catalog.cells.length,
    by_state: catalog.by_state,
    sources: catalog.sources.length,
    notable_cells: notable,
    integrity: catalog.integrity.sha256,
    capability_axis_covers: SOURCE_CAPABILITIES.length,
  };
}

export async function publishPinnedCatalog(argv = process.argv.slice(2)): Promise<BrowserCatalog> {
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag !== '--inventory' && flag !== '--dispositions' && flag !== '--rights' && flag !== '--geography' && flag !== '--schema') {
      throw new Error('unknown argument ' + flag);
    }
    index += 1;
  }
  assertCatalogInvariants();
  const schemaText = await readFile(argument(argv, '--schema', 'data/worldwide/catalog.schema.json'), 'utf8');
  assertSchema(JSON.parse(schemaText) as unknown);
  return publishCatalog({
    inventoryText: await readFile(argument(argv, '--inventory', 'data/worldwide/source-inventory.json'), 'utf8'),
    dispositionText: await readFile(argument(argv, '--dispositions', 'data/worldwide/source-dispositions.json'), 'utf8'),
    rightsText: await readFile(argument(argv, '--rights', 'data/worldwide/rights.json'), 'utf8'),
    geographyText: await readFile(argument(argv, '--geography', 'data/worldwide/geography-manifest.json'), 'utf8'),
  });
}

async function main(): Promise<void> {
  const catalog = await publishPinnedCatalog();
  process.stdout.write(JSON.stringify(summary(catalog), null, 2) + '\n');
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

if (isDirectRun()) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'catalog failed';
    process.stderr.write(message + '\n');
    process.exit(1);
  });
}

#!/usr/bin/env node
/**
 * Production contract checks for worldwide campaign evidence.
 *
 * A document that only names a path or says a file exists is rejected.
 * Source-job identity is SHA-256 of JSON.stringify of
 * [dataset_id, resolved_revision, config, split, jurisdiction_id, shard_id, phase],
 * and the job id uses the first 16 hex characters. WWL-114 must keep its own
 * receipt pending; this module never treats that future receipt as required.
 * Performance ceilings are the PLAN.md mid-range mobile figures and cannot be loosened.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FIXTURE_SCHEMA = 'worldwide-legal-search.fixture@1';
export const AUDIT_MODES = Object.freeze([
  'harness',
  'source-inventory',
  'source-dispositions',
  'rights',
  'catalog',
  'inventory-closure',
  'geography',
  'jurisdiction-fixtures',
  'retrieval-evaluation',
  'ux-contract',
  'performance',
  'ci-contract',
  'product-acceptance',
  'maintenance',
  'release-candidate',
  'deployment',
  'public-smoke',
  'campaign-closure',
  'source-job',
]);
export const SOURCE_ORGANIZATIONS = Object.freeze(['justicedao', 'endomorphosis']);
export const SOURCE_FAMILIES = Object.freeze([
  'national',
  'regional',
  'municipal',
  'country-ir',
  'unified-netherlands',
  'legacy-index',
]);
export const COVERAGE_STATES = Object.freeze(['known', 'partial', 'missing', 'unknown', 'unavailable']);
export const PLAN_PERFORMANCE_TARGETS = Object.freeze({
  shell_gzip_bytes: 350 * 1024,
  catalog_bytes: 1024 * 1024,
  first_place_search_bytes: 10 * 1024 * 1024,
  warm_p95_ms: 1000,
  cold_p95_ms: 5000,
  concurrent_requests: 4,
  heap_bytes: 256 * 1024 * 1024,
});
export const REQUIRED_INTERACTION_STATES = Object.freeze([
  'first-visit',
  'approximate-suggestion',
  'ip-unavailable',
  'location-denied',
  'ambiguous-place',
  'changed-manual-location',
  'border-uncertainty',
  'no-query',
  'no-matches',
  'unsearched-collection',
  'missing-municipal-coverage',
  'partially-loaded',
  'cancelled-query',
  'throttling-or-outage',
  'stale-cache',
  'offline-saved',
  'model-unavailable',
  'source-or-status-unknown',
  'translated-text',
  'historical-or-future-law',
  'malformed-url',
  'screen-reader-scope-change',
]);
export const PRODUCT_SCENARIOS = Object.freeze(['place', 'date', 'citation', 'coverage', 'rtl', 'mobile', 'no-backend']);
export const SMOKE_SCENARIOS = Object.freeze([
  'place-search',
  'source-reading',
  'manual-override',
  'deep-link',
  'no-backend',
  'coverage',
]);
export const JURISDICTION_CLASSES = Object.freeze([
  'nl',
  'federal',
  'multilingual',
  'rtl-or-non-latin',
  'special-or-overlapping',
  'absent-municipal',
]);
const SOURCE_PHASES = Object.freeze(['normalize', 'index', 'geo', 'publish', 'verify']);
const FIXTURE_KINDS = new Set([
  'jurisdiction-case',
  'retrieval-judgment',
  'parity',
  'adversarial',
  'transport',
  'geography',
  'normalization',
  'citation',
]);
const EXISTENCE_KEYS = new Set(['exists', 'file_exists', 'present', 'found', 'ok', 'path', 'paths', 'file', 'files']);
const PLACEHOLDER = /^(?:todo|exists|file exists|tbd|placeholder|n\/a|ok|true|false)$/i;
const SECRET_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bhf_[A-Za-z0-9]{20,}\b/,
  /\bsk-[A-Za-z0-9]{20,}\b/,
  /\b(?:api[_-]?key|secret|password|access[_-]?token)\s*[:=]\s*['"][^'"]{6,}['"]/i,
];
const SHA = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const REV = '0123456789abcdef';

export class ContractError extends Error {
  constructor(errors) {
    super(errors.map((entry) => entry.code + ': ' + entry.message).join('; '));
    this.name = 'ContractError';
    this.errors = errors;
  }
}

export function problem(code, message, at = '') {
  return { code, message, path: at };
}

class Collector {
  constructor() {
    this.errors = [];
  }

  add(code, message, at = '') {
    this.errors.push(problem(code, message, at));
  }

  require(condition, code, message, at = '') {
    if (!condition) this.add(code, message, at);
  }

  throwIfAny() {
    if (this.errors.length) throw new ContractError(this.errors);
  }
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isInteger(value) {
  return typeof value === 'number' && Number.isInteger(value);
}

function isSha256(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function isPrefixedDigest(value) {
  return typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test(value);
}

function isRevision(value) {
  return typeof value === 'string' && /^[0-9a-f]{7,64}$/.test(value);
}

function isDatasetId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(value);
}

function isHttps(value) {
  return typeof value === 'string' && /^https:\/\/[^\s]+$/.test(value) && !value.includes('..');
}

function isExistenceOnly(value) {
  if (!isObject(value)) return false;
  const keys = Object.keys(value).filter((key) => key !== 'schema' && key !== '$schema');
  return keys.length === 0 || keys.every((key) => EXISTENCE_KEYS.has(key));
}

function rejectSecrets(value, collector, label) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(text)) {
      collector.add('secret_material', 'credential material is not allowed in campaign evidence', label);
      return;
    }
  }
}

function isUnsafeRepoPath(value) {
  if (typeof value !== 'string' || value.length === 0) return true;
  if (value.startsWith('https://') || value.startsWith('http://')) return value.includes('..');
  if (value.startsWith('/') || value.startsWith('\\') || /^[A-Za-z]:[\\/]/.test(value)) return true;
  if (value.includes('\\') || value.includes('\0') || value.split(/[\\/]/).includes('..')) return true;
  return false;
}

function walkPaths(value, collector, label) {
  if (typeof value === 'string') {
    if (value.includes('\0')) collector.add('unsafe_path', 'null byte in string', label);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkPaths(item, collector, label + '[' + index + ']'));
    return;
  }
  if (!isObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    const at = label + '.' + key;
    if (key === 'url' && child !== null) {
      if (!isHttps(child)) collector.add('unsafe_path', 'url must be an https URL', at);
    } else if (typeof child === 'string' && (key === 'path' || key.endsWith('_path') || key === 'file')) {
      if (isUnsafeRepoPath(child)) collector.add('unsafe_path', 'path must stay inside the repository', at);
    } else if (Array.isArray(child) && (key === 'paths' || key === 'files')) {
      child.forEach((item, index) => {
        if (typeof item === 'string' && isUnsafeRepoPath(item)) {
          collector.add('unsafe_path', 'path must stay inside the repository', at + '[' + index + ']');
        }
      });
    }
    walkPaths(child, collector, at);
  }
}

function openDocument(doc, schema, label) {
  const collector = new Collector();
  if (!isObject(doc)) {
    collector.add('invalid_type', label + ' must be a JSON object', label);
    collector.throwIfAny();
  }
  if (isExistenceOnly(doc)) {
    collector.add('existence_only', label + ' only asserts that a file exists', label);
    collector.throwIfAny();
  }
  collector.require(doc.schema === schema, 'invalid_schema', 'schema must be ' + schema, label + '.schema');
  return collector;
}

function finish(doc, collector, label) {
  rejectSecrets(doc, collector, label);
  walkPaths(doc, collector, label);
  collector.throwIfAny();
  return { ok: true };
}

export function globToRegExp(pattern) {
  let expression = '';
  let index = 0;
  while (index < pattern.length) {
    const current = pattern[index];
    if (current === '*' && pattern[index + 1] === '*') {
      if (pattern[index + 2] === '/') {
        expression += '(?:.*/)?';
        index += 3;
      } else {
        expression += '.*';
        index += 2;
      }
      continue;
    }
    if (current === '*') {
      expression += '[^/]*';
      index += 1;
      continue;
    }
    if (current === '?') {
      expression += '[^/]';
      index += 1;
      continue;
    }
    if ('\\.^$+()|[]{}'.includes(current)) expression += '\\' + current;
    else expression += current;
    index += 1;
  }
  return new RegExp('^' + expression + '$');
}

export function braceExpand(pattern) {
  const match = /\{([^{}]+)\}/.exec(pattern);
  if (!match) return [pattern];
  const prefix = pattern.slice(0, match.index);
  const suffix = pattern.slice(match.index + match[0].length);
  const expanded = [];
  for (const part of match[1].split(',')) expanded.push(...braceExpand(prefix + part + suffix));
  return expanded;
}

export function globMatch(file, pattern) {
  return braceExpand(pattern).some((item) => globToRegExp(item).test(file));
}

export function canonicalFixture() {
  return {
    schema: FIXTURE_SCHEMA,
    fixture_id: 'nl-wetboek-van-strafrecht-artikel-1',
    kind: 'jurisdiction-case',
    purpose: 'Cited Dutch national article used as a jurisdiction fixture without a legal holding.',
    source: {
      citation: 'Wetboek van Strafrecht artikel 1',
      url: 'https://wetten.overheid.nl/BWBR0001854',
      revision: null,
      license: 'unknown',
      fabricated_legal_conclusion: false,
      quotation: null,
    },
    inputs: {
      coverage_class: 'nl',
      country: 'NL',
      place: 'Netherlands',
      as_of: '2026-10-26',
    },
    expected: {
      legal_conclusion: 'not_claimed',
      jurisdiction_level: 'national',
      source_url: 'https://wetten.overheid.nl/BWBR0001854',
    },
    uncertainty: ['This fixture does not decide applicability to a person or dispute.'],
    adversarial: false,
  };
}

export function validateFixture(doc, label = 'fixture') {
  const collector = openDocument(doc, FIXTURE_SCHEMA, label);
  collector.require(
    typeof doc.fixture_id === 'string' && /^[a-z0-9][a-z0-9-]{2,80}$/.test(doc.fixture_id),
    'invalid_field',
    'fixture_id must be a lowercase slug',
    label + '.fixture_id',
  );
  collector.require(FIXTURE_KINDS.has(doc.kind), 'unknown_kind', 'fixture kind is not in the convention', label + '.kind');
  collector.require(isNonEmptyString(doc.purpose) && doc.purpose.trim().length >= 12, 'missing_field', 'purpose must say what behavior is fixed', label + '.purpose');
  const source = doc.source;
  collector.require(isObject(source), 'missing_field', 'source is required', label + '.source');
  if (isObject(source)) {
    collector.require(
      isNonEmptyString(source.citation) && !PLACEHOLDER.test(source.citation.trim()),
      'invalid_field',
      'source.citation must name a real or explicitly synthetic-adversarial source',
      label + '.source.citation',
    );
    collector.require(source.url === null || isHttps(source.url), 'unsafe_path', 'source.url must be null or https', label + '.source.url');
    collector.require(source.revision === null || isRevision(source.revision), 'invalid_field', 'source.revision must be pinned or null', label + '.source.revision');
    collector.require(isNonEmptyString(source.license), 'missing_field', 'source.license is required', label + '.source.license');
    collector.require(typeof source.fabricated_legal_conclusion === 'boolean', 'invalid_type', 'fabricated_legal_conclusion must be boolean', label + '.source.fabricated_legal_conclusion');
    if (doc.adversarial === false && source.fabricated_legal_conclusion !== false) {
      collector.add('fabricated_conclusion', 'a non-adversarial fixture cannot carry a fabricated legal conclusion', label + '.source.fabricated_legal_conclusion');
    }
    if (doc.adversarial === true && source.citation !== 'synthetic-adversarial') {
      collector.add('invalid_field', 'adversarial fixtures must label citation synthetic-adversarial', label + '.source.citation');
    }
  }
  collector.require(isObject(doc.inputs) && Object.keys(doc.inputs).length > 0, 'missing_field', 'inputs must be a non-empty object', label + '.inputs');
  collector.require(isObject(doc.expected) && Object.keys(doc.expected).length > 0, 'missing_field', 'expected must be a non-empty object', label + '.expected');
  if (isObject(doc.expected) && isExistenceOnly(doc.expected)) {
    collector.add('existence_only', 'expected only asserts that a file exists', label + '.expected');
  }
  if (isObject(doc.expected) && doc.expected.legal_conclusion && doc.expected.legal_conclusion !== 'not_claimed') {
    const quoted = isObject(source) && isNonEmptyString(source.quotation);
    if (doc.adversarial !== true && !quoted) {
      collector.add('fabricated_conclusion', 'a legal conclusion needs a source quotation or must stay not_claimed', label + '.expected.legal_conclusion');
    }
  }
  collector.require(
    Array.isArray(doc.uncertainty) && doc.uncertainty.length > 0 && doc.uncertainty.every((item) => isNonEmptyString(item) && item.trim().length >= 8),
    'missing_field',
    'uncertainty must list explicit unknowns',
    label + '.uncertainty',
  );
  collector.require(typeof doc.adversarial === 'boolean', 'invalid_type', 'adversarial must be boolean', label + '.adversarial');
  return finish(doc, collector, label);
}

function requireBlocker(value, collector, label) {
  collector.require(isObject(value) && isNonEmptyString(value.kind) && isNonEmptyString(value.reason) && value.reason.trim().length >= 8, 'missing_blocker', 'blocker kind and reason are required', label);
}

function datasetRecord(org, name, overrides = {}) {
  return {
    dataset_id: org + '/' + name,
    resolved_revision: REV,
    card: { fetched: true, sha256: SHA },
    files: [{ path: 'data/' + name + '.parquet', size_bytes: 128, sha256: SHA_B }],
    configs: [{ name: 'default', splits: ['train'] }],
    access_error: null,
    ...overrides,
  };
}

function inventoryDocument(status) {
  const complete = status === 'complete';
  const datasets = complete ? [datasetRecord('justicedao', 'example-laws'), datasetRecord('endomorphosis', 'example-index')] : [];
  const organizations = SOURCE_ORGANIZATIONS.map((id) => ({
    id,
    pagination: { followed: true, pages: 1, exhausted: complete },
    dataset_count: complete ? 1 : 0,
    datasets: complete ? datasets.filter((item) => item.dataset_id.startsWith(id + '/')) : [],
    access_error: complete ? null : { class: 'http', message: 'listing stopped before the last page', retryable: true },
  }));
  return {
    schema: 'worldwide-legal-search.source-inventory@1',
    inventory_status: status,
    partial_reasons: complete ? [] : ['justicedao and endomorphosis listings were not exhausted'],
    organizations,
  };
}

function validateSourceInventory(doc) {
  const collector = openDocument(doc, 'worldwide-legal-search.source-inventory@1', 'source-inventory');
  collector.require(doc.inventory_status === 'complete' || doc.inventory_status === 'partial', 'invalid_field', 'inventory_status must be complete or partial', 'inventory_status');
  collector.require(Array.isArray(doc.partial_reasons), 'missing_field', 'partial_reasons is required', 'partial_reasons');
  if (doc.inventory_status === 'partial') {
    collector.require(Array.isArray(doc.partial_reasons) && doc.partial_reasons.length > 0 && doc.partial_reasons.every(isNonEmptyString), 'empty_reason', 'a partial inventory needs reasons', 'partial_reasons');
  }
  if (doc.inventory_status === 'complete') {
    collector.require(Array.isArray(doc.partial_reasons) && doc.partial_reasons.length === 0, 'inventory_status_conflict', 'a complete inventory cannot carry partial reasons', 'partial_reasons');
  }
  const organizations = Array.isArray(doc.organizations) ? doc.organizations : [];
  collector.require(Array.isArray(doc.organizations), 'missing_field', 'organizations is required', 'organizations');
  for (const id of SOURCE_ORGANIZATIONS) {
    if (!organizations.some((org) => org && org.id === id)) collector.add('missing_organization', 'missing organization ' + id, 'organizations');
  }
  organizations.forEach((org, index) => {
    const at = 'organizations[' + index + ']';
    if (!isObject(org)) {
      collector.add('invalid_type', 'organization must be an object', at);
      return;
    }
    const pagination = org.pagination;
    collector.require(isObject(pagination) && pagination.followed === true && isInteger(pagination.pages) && pagination.pages >= 1 && typeof pagination.exhausted === 'boolean', 'pagination_incomplete', 'pagination must be followed and counted', at + '.pagination');
    if (doc.inventory_status === 'complete' && isObject(pagination) && pagination.exhausted !== true) {
      collector.add('pagination_incomplete', 'complete inventory requires exhausted pagination', at + '.pagination.exhausted');
    }
    if (doc.inventory_status === 'complete' && org.access_error !== null) {
      collector.add('pagination_incomplete', 'complete inventory cannot hide an organization access error', at + '.access_error');
    }
    if (org.access_error !== null) {
      collector.require(isObject(org.access_error) && isNonEmptyString(org.access_error.class) && isNonEmptyString(org.access_error.message), 'missing_field', 'access_error needs class and message', at + '.access_error');
    }
    collector.require(Array.isArray(org.datasets), 'missing_field', 'datasets must be an array', at + '.datasets');
    collector.require(org.dataset_count === (Array.isArray(org.datasets) ? org.datasets.length : -1), 'count_mismatch', 'dataset_count must match datasets', at + '.dataset_count');
    if (!Array.isArray(org.datasets)) return;
    org.datasets.forEach((dataset, datasetIndex) => {
      const where = at + '.datasets[' + datasetIndex + ']';
      if (!isObject(dataset)) {
        collector.add('invalid_type', 'dataset must be an object', where);
        return;
      }
      collector.require(isDatasetId(dataset.dataset_id) && dataset.dataset_id.startsWith(org.id + '/'), 'invalid_field', 'dataset_id must belong to the organization', where + '.dataset_id');
      const failed = dataset.access_error !== null && dataset.access_error !== undefined;
      if (failed) {
        collector.require(isObject(dataset.access_error) && isNonEmptyString(dataset.access_error.class) && isNonEmptyString(dataset.access_error.message), 'missing_field', 'dataset access_error needs class and message', where + '.access_error');
      } else {
        collector.require(isRevision(dataset.resolved_revision), 'invalid_field', 'resolved_revision must be pinned', where + '.resolved_revision');
        collector.require(isObject(dataset.card) && dataset.card.fetched === true && isSha256(dataset.card.sha256), 'integrity', 'dataset card needs a sha256', where + '.card');
        collector.require(Array.isArray(dataset.files) && dataset.files.length > 0, 'missing_field', 'a reachable dataset needs files', where + '.files');
        collector.require(Array.isArray(dataset.configs) && dataset.configs.length > 0, 'missing_field', 'a reachable dataset needs configs and splits', where + '.configs');
      }
      (dataset.files || []).forEach((file, fileIndex) => {
        if (!isObject(file) || !isNonEmptyString(file.path) || isUnsafeRepoPath(file.path) || !isInteger(file.size_bytes) || file.size_bytes < 0 || !isSha256(file.sha256)) {
          collector.add('integrity', 'file needs a relative path, size and sha256', where + '.files[' + fileIndex + ']');
        }
      });
      (dataset.configs || []).forEach((config, configIndex) => {
        if (!isObject(config) || !isNonEmptyString(config.name) || !Array.isArray(config.splits) || config.splits.length === 0 || !config.splits.every(isNonEmptyString)) {
          collector.add('missing_field', 'config needs a name and splits', where + '.configs[' + configIndex + ']');
        }
      });
    });
  });
  return finish(doc, collector, 'source-inventory');
}

function validateDispositions(doc) {
  const collector = openDocument(doc, 'worldwide-legal-search.source-dispositions@1', 'source-dispositions');
  collector.require(isRevision(doc.inventory_revision), 'invalid_field', 'inventory_revision must be pinned', 'inventory_revision');
  collector.require(Array.isArray(doc.dispositions) && doc.dispositions.length > 0, 'missing_field', 'dispositions are required', 'dispositions');
  const seen = new Set();
  (doc.dispositions || []).forEach((row, index) => {
    const at = 'dispositions[' + index + ']';
    if (!isObject(row)) {
      collector.add('invalid_type', 'disposition must be an object', at);
      return;
    }
    collector.require(SOURCE_FAMILIES.includes(row.family), 'unknown_kind', 'unknown source family', at + '.family');
    collector.require(row.decision === 'include' || row.decision === 'exclude' || row.decision === 'blocked', 'invalid_field', 'decision must be include, exclude or blocked', at + '.decision');
    collector.require(isNonEmptyString(row.reason) && row.reason.trim().length >= 8, 'missing_field', 'every disposition needs a reason', at + '.reason');
    collector.require(isDatasetId(row.dataset_id), 'invalid_field', 'dataset_id is required', at + '.dataset_id');
    collector.require(Array.isArray(row.schema_capabilities) && row.schema_capabilities.length > 0 && row.schema_capabilities.every(isNonEmptyString), 'missing_field', 'schema_capabilities are required', at + '.schema_capabilities');
    collector.require(isNonEmptyString(row.source_lineage), 'missing_field', 'source_lineage is required', at + '.source_lineage');
    collector.require(typeof row.code_only_release === 'boolean', 'invalid_type', 'code_only_release must be boolean', at + '.code_only_release');
    if (row.code_only_release === true && row.decision === 'include') {
      const capabilities = Array.isArray(row.schema_capabilities) ? row.schema_capabilities : [];
      if (capabilities.includes('text') || capabilities.includes('law-text') || !capabilities.includes('code')) {
        collector.add('invalid_field', 'a code-only release cannot be included as law text', at + '.code_only_release');
      }
    }
    if (typeof row.family === 'string') seen.add(row.family);
  });
  for (const family of SOURCE_FAMILIES) {
    if (!seen.has(family)) collector.add('coverage_class_missing', 'missing source family ' + family, 'dispositions');
  }
  return finish(doc, collector, 'source-dispositions');
}

function validateRights(doc) {
  const collector = openDocument(doc, 'worldwide-legal-search.rights@1', 'rights');
  collector.require(Array.isArray(doc.records) && doc.records.length > 0, 'missing_field', 'rights records are required', 'records');
  const orgs = new Set();
  (doc.records || []).forEach((row, index) => {
    const at = 'records[' + index + ']';
    if (!isObject(row)) {
      collector.add('invalid_type', 'rights record must be an object', at);
      return;
    }
    collector.require(isDatasetId(row.dataset_id), 'invalid_field', 'dataset_id is required', at + '.dataset_id');
    collector.require(isRevision(row.artifact_revision), 'invalid_field', 'artifact_revision must be pinned', at + '.artifact_revision');
    collector.require(row.inferred_from_organization === false, 'inferred_rights', 'organization membership is not a redistribution license', at + '.inferred_from_organization');
    collector.require(row.status === 'resolved' || row.status === 'unresolved', 'invalid_field', 'status must be resolved or unresolved', at + '.status');
    collector.require(Array.isArray(row.restrictions), 'missing_field', 'restrictions must be an array', at + '.restrictions');
    if (row.status === 'resolved') {
      collector.require(isNonEmptyString(row.rights) && isNonEmptyString(row.attribution), 'missing_field', 'resolved rights need a license and attribution', at);
      collector.require(row.blocker === null, 'invalid_field', 'resolved rights cannot also be blocked', at + '.blocker');
    }
    if (row.status === 'unresolved') requireBlocker(row.blocker, collector, at + '.blocker');
    if (isDatasetId(row.dataset_id)) orgs.add(row.dataset_id.split('/')[0]);
  });
  for (const id of SOURCE_ORGANIZATIONS) {
    if (!orgs.has(id)) collector.add('missing_organization', 'rights do not cover ' + id, 'records');
  }
  return finish(doc, collector, 'rights');
}

function instanceErrors(schema, value, at = '$') {
  const errors = [];
  if (!isObject(schema)) return [problem('invalid_schema', 'schema node must be an object', at)];
  if (schema.type === 'object') {
    if (!isObject(value)) return [problem('invalid_type', 'expected object', at)];
    for (const key of schema.required || []) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) errors.push(problem('missing_field', 'missing ' + key, at + '.' + key));
    }
    const properties = schema.properties || {};
    for (const key of Object.keys(value)) {
      if (!Object.prototype.hasOwnProperty.call(properties, key)) {
        if (schema.additionalProperties === false) errors.push(problem('existence_only', 'unknown field ' + key, at + '.' + key));
        continue;
      }
      errors.push(...instanceErrors(properties[key], value[key], at + '.' + key));
    }
  } else if (schema.type === 'integer') {
    if (!isInteger(value)) errors.push(problem('invalid_type', 'expected integer', at));
    else if (schema.minimum !== undefined && value < schema.minimum) errors.push(problem('invalid_field', 'below minimum', at));
  } else if (schema.type === 'string') {
    if (typeof value !== 'string') errors.push(problem('invalid_type', 'expected string', at));
    else if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(problem('invalid_field', 'too short', at));
    else if (schema.pattern) {
      try {
        if (!new RegExp(schema.pattern).test(value)) errors.push(problem('invalid_field', 'pattern mismatch', at));
      } catch (error) {
        errors.push(problem('invalid_field', 'invalid pattern', at));
      }
    }
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) errors.push(problem('invalid_field', 'value is outside the enum', at));
  return errors;
}

export function catalogSchemaDocument() {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    additionalProperties: false,
    required: ['coverage_state', 'record_denominator', 'collection_count', 'legal_completeness', 'as_of', 'integrity'],
    properties: {
      coverage_state: { enum: [...COVERAGE_STATES] },
      record_denominator: { type: 'integer', minimum: 0 },
      collection_count: { type: 'integer', minimum: 0 },
      legal_completeness: { enum: ['not_claimed'] },
      as_of: { type: 'string', minLength: 10 },
      integrity: {
        type: 'object',
        additionalProperties: false,
        required: ['sha256'],
        properties: { sha256: { type: 'string', pattern: '^[0-9a-f]{64}$' } },
      },
    },
  };
}

function validateCatalogSchema(doc) {
  const collector = new Collector();
  if (!isObject(doc)) {
    collector.add('invalid_type', 'catalog schema must be an object', 'catalog');
    collector.throwIfAny();
  }
  if (isExistenceOnly(doc)) {
    collector.add('existence_only', 'catalog schema does not constrain coverage', 'catalog');
    collector.throwIfAny();
  }
  collector.require(doc.$schema === 'https://json-schema.org/draft/2020-12/schema', 'invalid_schema', 'catalog schema must use JSON Schema 2020-12', '$schema');
  collector.require(doc.type === 'object', 'invalid_type', 'catalog record type must be object', 'type');
  collector.require(doc.additionalProperties === false, 'schema_too_weak', 'catalog schema must reject unknown fields', 'additionalProperties');
  const required = new Set(Array.isArray(doc.required) ? doc.required : []);
  for (const field of ['coverage_state', 'record_denominator', 'collection_count', 'legal_completeness', 'as_of', 'integrity']) {
    collector.require(required.has(field), 'missing_field', 'catalog schema must require ' + field, 'required.' + field);
  }
  const properties = isObject(doc.properties) ? doc.properties : {};
  const coverage = properties.coverage_state;
  collector.require(
    isObject(coverage) && Array.isArray(coverage.enum) && coverage.enum.length === COVERAGE_STATES.length && COVERAGE_STATES.every((state) => coverage.enum.includes(state)),
    'schema_too_weak',
    'coverage_state enum must be exactly known, partial, missing, unknown and unavailable',
    'properties.coverage_state',
  );
  const legal = properties.legal_completeness;
  collector.require(
    isObject(legal) && Array.isArray(legal.enum) && legal.enum.includes('not_claimed') && !legal.enum.includes('complete'),
    'legal_completeness',
    'legal completeness must stay explicit and must not collapse to complete',
    'properties.legal_completeness',
  );
  for (const field of ['record_denominator', 'collection_count']) {
    const property = properties[field];
    collector.require(isObject(property) && property.type === 'integer' && property.minimum === 0, 'invalid_field', field + ' must be a non-negative integer', field);
  }
  collector.require(isObject(properties.as_of) && properties.as_of.type === 'string' && properties.as_of.minLength >= 10, 'invalid_field', 'as_of must be a date string', 'as_of');
  const integrity = properties.integrity;
  const digest = isObject(integrity) && isObject(integrity.properties) ? integrity.properties.sha256 : null;
  collector.require(
    isObject(integrity) && integrity.type === 'object' && Array.isArray(integrity.required) && integrity.required.includes('sha256') && isObject(digest) && digest.pattern === '^[0-9a-f]{64}$',
    'integrity',
    'integrity.sha256 must be a 64 digit hex digest',
    'integrity',
  );
  collector.throwIfAny();
  const valid = {
    coverage_state: 'partial',
    record_denominator: 3,
    collection_count: 1,
    legal_completeness: 'not_claimed',
    as_of: '2026-10-26',
    integrity: { sha256: SHA },
  };
  const accepted = instanceErrors(doc, valid);
  if (accepted.length) throw new ContractError([problem('schema_too_weak', 'catalog schema rejected a partial record: ' + accepted[0].message, 'probe.valid')]);
  const probes = [
    [{ exists: true }, 'existence'],
    [{ ...valid, legal_completeness: 'complete' }, 'legal_completeness'],
    [{ ...valid, coverage_state: 'everywhere' }, 'coverage_state'],
    [{ ...valid, integrity: undefined }, 'integrity'],
  ];
  probes[3][0] = { ...valid };
  delete probes[3][0].integrity;
  for (const [instance, code] of probes) {
    if (!instanceErrors(doc, instance).length) {
      throw new ContractError([problem('schema_too_weak', 'catalog schema accepted an invalid record (' + code + ')', 'probe.' + code)]);
    }
  }
  return { ok: true, probes: probes.length };
}

function ledgerEntry(datasetId, level, disposition, recordCount) {
  const ingested = disposition === 'ingested';
  return {
    dataset_id: datasetId,
    public: true,
    level,
    disposition,
    receipt_id: ingested ? 'receipt-' + datasetId.replace('/', '-') : null,
    blocker: ingested ? null : { kind: 'access', reason: 'The pinned collection could not be read in this snapshot.' },
    record_count: recordCount,
    count_source: ingested ? 'receipt-' + datasetId.replace('/', '-') + '#record_count' : 'not counted because the collection is blocked',
  };
}

function inventoryClosureSample() {
  const entries = [
    ledgerEntry('justicedao/national-laws', 'national', 'ingested', 4),
    ledgerEntry('endomorphosis/municipal-codes', 'municipal', 'blocked', null),
  ];
  const trace = entries.map((entry) => ({ dataset_id: entry.dataset_id, level: entry.level, record_count: entry.record_count }));
  return {
    ledger: {
      schema: 'worldwide-legal-search.ingestion-ledger@1',
      inventory_revision: REV,
      entries,
    },
    coverage: {
      schema: 'worldwide-legal-search.coverage-audit@1',
      inventory_revision: REV,
      national_count: 4,
      local_count: 0,
      entry_count: entries.length,
      trace,
    },
  };
}

function validateInventoryClosure(doc) {
  const collector = new Collector();
  if (!isObject(doc) || !isObject(doc.ledger) || !isObject(doc.coverage)) {
    collector.add('missing_field', 'inventory closure needs a ledger and a coverage audit', 'inventory-closure');
    collector.throwIfAny();
  }
  if (isExistenceOnly(doc) || isExistenceOnly(doc.ledger) || isExistenceOnly(doc.coverage)) {
    collector.add('existence_only', 'inventory closure only asserts that files exist', 'inventory-closure');
    collector.throwIfAny();
  }
  collector.require(doc.ledger.schema === 'worldwide-legal-search.ingestion-ledger@1', 'invalid_schema', 'unexpected ledger schema', 'ledger.schema');
  collector.require(doc.coverage.schema === 'worldwide-legal-search.coverage-audit@1', 'invalid_schema', 'unexpected coverage schema', 'coverage.schema');
  collector.require(isRevision(doc.ledger.inventory_revision) && doc.coverage.inventory_revision === doc.ledger.inventory_revision, 'integrity', 'coverage must bind the ledger revision', 'inventory_revision');
  const entries = Array.isArray(doc.ledger.entries) ? doc.ledger.entries : [];
  collector.require(entries.length > 0, 'missing_field', 'ledger entries are required', 'ledger.entries');
  let national = 0;
  let local = 0;
  const levels = new Set();
  entries.forEach((entry, index) => {
    const at = 'ledger.entries[' + index + ']';
    if (!isObject(entry)) {
      collector.add('invalid_type', 'ledger entry must be an object', at);
      return;
    }
    collector.require(entry.public === true, 'invalid_field', 'the ledger lists eligible public collections', at + '.public');
    collector.require(isDatasetId(entry.dataset_id), 'invalid_field', 'dataset_id is required', at + '.dataset_id');
    collector.require(entry.level === 'national' || entry.level === 'regional' || entry.level === 'municipal' || entry.level === 'other', 'invalid_field', 'level is not a known collection level', at + '.level');
    levels.add(entry.level);
    if (entry.disposition === 'ingested') {
      collector.require(isNonEmptyString(entry.receipt_id), 'missing_field', 'an ingested collection needs a receipt id', at + '.receipt_id');
      collector.require(isInteger(entry.record_count) && entry.record_count >= 0, 'count_mismatch', 'an ingested collection needs a record count', at + '.record_count');
      collector.require(isNonEmptyString(entry.count_source), 'missing_field', 'count_source must point at the receipt field', at + '.count_source');
      collector.require(entry.blocker === null, 'invalid_field', 'an ingested collection is not blocked', at + '.blocker');
    } else if (entry.disposition === 'blocked') {
      requireBlocker(entry.blocker, collector, at + '.blocker');
      collector.require(entry.record_count === null || (isInteger(entry.record_count) && entry.record_count >= 0), 'invalid_type', 'blocked record_count must be null or an integer', at + '.record_count');
    } else {
      collector.add('invalid_field', 'disposition must be ingested or blocked', at + '.disposition');
    }
    if (isInteger(entry.record_count)) {
      if (entry.level === 'national') national += entry.record_count;
      if (entry.level === 'municipal') local += entry.record_count;
    }
  });
  collector.require(levels.has('national') && levels.has('municipal'), 'coverage_class_missing', 'national and municipal collections must both be traceable', 'ledger.entries');
  collector.require(doc.coverage.national_count === national, 'count_mismatch', 'national_count does not match the ledger', 'coverage.national_count');
  collector.require(doc.coverage.local_count === local, 'count_mismatch', 'local_count does not match municipal ledger rows', 'coverage.local_count');
  collector.require(doc.coverage.entry_count === entries.length, 'count_mismatch', 'entry_count does not match the ledger', 'coverage.entry_count');
  const trace = Array.isArray(doc.coverage.trace) ? doc.coverage.trace : [];
  collector.require(trace.length === entries.length, 'count_mismatch', 'coverage trace must list every ledger entry', 'coverage.trace');
  entries.forEach((entry, index) => {
    const item = trace[index];
    if (!isObject(entry) || !isObject(item) || item.dataset_id !== entry.dataset_id || item.level !== entry.level || item.record_count !== entry.record_count) {
      collector.add('count_mismatch', 'coverage trace drifted from ledger entry ' + index, 'coverage.trace[' + index + ']');
    }
  });
  return finish(doc, collector, 'inventory-closure');
}

function validateGeography(doc) {
  const collector = openDocument(doc, 'worldwide-legal-search.geography-manifest@1', 'geography');
  collector.require(isDatasetId(doc.dataset_id), 'invalid_field', 'dataset_id is required', 'dataset_id');
  collector.require(isRevision(doc.revision), 'invalid_field', 'geography revision must be pinned', 'revision');
  collector.require(isNonEmptyString(doc.license), 'missing_field', 'license is required', 'license');
  collector.require(isNonEmptyString(doc.attribution) && doc.attribution.trim().length >= 3, 'missing_field', 'attribution is required', 'attribution');
  collector.require(['available', 'partial', 'unavailable'].includes(doc.municipality_detail), 'invalid_field', 'municipality_detail must be available, partial or unavailable', 'municipality_detail');
  collector.require(isNonEmptyString(doc.municipality_limit), 'missing_field', 'municipality_limit is required', 'municipality_limit');
  collector.require(Array.isArray(doc.native_alias_sample) && doc.native_alias_sample.length > 0, 'missing_field', 'native_alias_sample is required', 'native_alias_sample');
  (doc.native_alias_sample || []).forEach((alias, index) => {
    if (!isObject(alias) || !isNonEmptyString(alias.name) || typeof alias.lang !== 'string' || !/^[a-z]{2,3}$/.test(alias.lang)) {
      collector.add('invalid_field', 'alias needs a name and language code', 'native_alias_sample[' + index + ']');
    }
  });
  collector.require(Array.isArray(doc.coverage_limits) && doc.coverage_limits.length > 0 && doc.coverage_limits.every(isNonEmptyString), 'missing_field', 'coverage_limits are required', 'coverage_limits');
  collector.require(doc.hierarchical === true, 'invalid_field', 'layout must be hierarchical', 'hierarchical');
  collector.require(doc.complete_world === false, 'legal_completeness', 'a place pack is not every municipality on earth', 'complete_world');
  const levels = new Set();
  collector.require(Array.isArray(doc.layout), 'missing_field', 'layout is required', 'layout');
  (doc.layout || []).forEach((item, index) => {
    if (!isObject(item) || !['country', 'admin', 'place'].includes(item.level) || typeof item.path !== 'string' || isUnsafeRepoPath(item.path)) {
      collector.add('unsafe_path', 'layout entry needs a relative country, admin or place path', 'layout[' + index + ']');
      return;
    }
    levels.add(item.level);
  });
  for (const level of ['country', 'admin', 'place']) {
    if (!levels.has(level)) collector.add('coverage_class_missing', 'missing layout level ' + level, 'layout');
  }
  return finish(doc, collector, 'geography');
}

function jurisdictionCase(spec) {
  return {
    schema: FIXTURE_SCHEMA,
    fixture_id: 'jurisdiction-' + spec.coverageClass,
    kind: 'jurisdiction-case',
    purpose: 'Cited reference case for ' + spec.coverageClass + ' with no invented holding.',
    source: {
      citation: spec.citation,
      url: spec.url,
      revision: null,
      license: 'unknown',
      fabricated_legal_conclusion: false,
      quotation: null,
    },
    inputs: { coverage_class: spec.coverageClass, ...spec.inputs },
    expected: { legal_conclusion: 'not_claimed', ...spec.expected },
    uncertainty: spec.uncertainty,
    adversarial: false,
  };
}

function jurisdictionBundle() {
  return {
    schema: 'worldwide-legal-search.jurisdiction-cases@1',
    cases: [
      jurisdictionCase({
        coverageClass: 'nl',
        citation: 'Wetboek van Strafrecht artikel 1',
        url: 'https://wetten.overheid.nl/BWBR0001854',
        inputs: { country: 'NL', place: 'Netherlands' },
        expected: { jurisdiction_level: 'national' },
        uncertainty: ['The national article does not decide municipal applicability.'],
      }),
      jurisdictionCase({
        coverageClass: 'federal',
        citation: 'Constitution of the United States, Article VI',
        url: 'https://www.archives.gov/founding-docs/constitution',
        inputs: { country: 'US', system: 'federal', place: 'California' },
        expected: { jurisdiction_level: 'regional' },
        uncertainty: ['Federal structure does not by itself choose the governing state rule.'],
      }),
      jurisdictionCase({
        coverageClass: 'multilingual',
        citation: 'Constitution belge, article 4',
        url: 'https://www.ejustice.just.fgov.be/eli/constitution/1994/02/17/1994021048/justel',
        inputs: { country: 'BE', languages: ['fr', 'nl'] },
        expected: { jurisdiction_level: 'national' },
        uncertainty: ['Language of the text is not the search jurisdiction.'],
      }),
      jurisdictionCase({
        coverageClass: 'rtl-or-non-latin',
        citation: 'Constitution of the Arab Republic of Egypt',
        url: 'https://www.constituteproject.org/constitution/Egypt_2014',
        inputs: { country: 'EG', direction: 'rtl', script: 'non-latin' },
        expected: { jurisdiction_level: 'national' },
        uncertainty: ['Script direction does not determine territorial scope.'],
      }),
      jurisdictionCase({
        coverageClass: 'special-or-overlapping',
        citation: 'Treaty on European Union, Article 5',
        url: 'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:12012M005',
        inputs: { relationship: 'overlapping', place: 'Amsterdam' },
        expected: { applicability: 'not_claimed' },
        uncertainty: ['Overlap is recorded and applicability is not claimed.'],
      }),
      jurisdictionCase({
        coverageClass: 'absent-municipal',
        citation: 'Wetboek van Strafrecht artikel 1',
        url: 'https://wetten.overheid.nl/BWBR0001854',
        inputs: { country: 'NL', place: 'Amsterdam' },
        expected: { municipal_coverage: 'absent' },
        uncertainty: ['This national instrument does not establish municipal coverage for Amsterdam.'],
      }),
    ],
  };
}

function validateJurisdictionFixtures(doc) {
  const collector = openDocument(doc, 'worldwide-legal-search.jurisdiction-cases@1', 'jurisdiction-fixtures');
  collector.require(Array.isArray(doc.cases) && doc.cases.length >= JURISDICTION_CLASSES.length, 'missing_field', 'jurisdiction cases are required', 'cases');
  const seen = new Set();
  (doc.cases || []).forEach((item, index) => {
    const at = 'cases[' + index + ']';
    try {
      validateFixture(item, at);
    } catch (error) {
      if (error instanceof ContractError) collector.errors.push(...error.errors);
      else throw error;
    }
    if (!isObject(item) || !isObject(item.inputs)) return;
    const coverageClass = item.inputs.coverage_class;
    seen.add(coverageClass);
    if (coverageClass === 'nl') collector.require(item.inputs.country === 'NL', 'coverage_class_missing', 'NL case must name country NL', at);
    if (coverageClass === 'federal') collector.require(item.inputs.system === 'federal', 'coverage_class_missing', 'federal case must name a federal system', at);
    if (coverageClass === 'multilingual') collector.require(Array.isArray(item.inputs.languages) && item.inputs.languages.length >= 2, 'coverage_class_missing', 'multilingual case needs two languages', at);
    if (coverageClass === 'rtl-or-non-latin') {
      collector.require(item.inputs.direction === 'rtl' || item.inputs.script === 'non-latin', 'coverage_class_missing', 'RTL or non-Latin case is not marked', at);
    }
    if (coverageClass === 'special-or-overlapping') collector.require(isObject(item.expected) && item.expected.applicability === 'not_claimed', 'fabricated_conclusion', 'overlapping authority must not claim applicability', at);
    if (coverageClass === 'absent-municipal') collector.require(isObject(item.expected) && item.expected.municipal_coverage === 'absent', 'coverage_class_missing', 'absent municipal coverage must stay absent', at);
  });
  for (const coverageClass of JURISDICTION_CLASSES) {
    if (!seen.has(coverageClass)) collector.add('coverage_class_missing', 'missing jurisdiction class ' + coverageClass, 'cases');
  }
  return finish(doc, collector, 'jurisdiction-fixtures');
}

function judgment(spec) {
  return {
    query: spec.query,
    script: spec.script,
    level: spec.level,
    citation: spec.citation,
    source_url: spec.url,
    relevant_ids: spec.relevant,
    excluded_jurisdiction_ids: spec.excluded,
    recall_at_k: spec.recall,
    k: spec.k,
    unsupported_coverage: spec.unsupported,
  };
}

function retrievalSample() {
  return {
    schema: 'worldwide-legal-search.retrieval-evaluation@1',
    unsupported_sources: [{ source_id: 'example/missing-municipal', reason: 'No public municipal collection was pinned for this place.' }],
    judgments: [
      judgment({ query: 'Wetboek van Strafrecht artikel 1', script: 'Latin', level: 'national', citation: 'BWBR0001854 artikel 1', url: 'https://wetten.overheid.nl/BWBR0001854', relevant: ['nl:bwbr0001854:1'], excluded: ['us-ca'], recall: 1, k: 5, unsupported: null }),
      judgment({ query: 'North Holland provincial ordinance', script: 'Latin', level: 'regional', citation: 'Provincie Noord-Holland verordening', url: 'https://wetten.overheid.nl/', relevant: ['nl:nh:1'], excluded: ['nl-amsterdam'], recall: 1, k: 5, unsupported: null }),
      judgment({ query: 'Amsterdam local parking rule', script: 'Latin', level: 'municipal', citation: 'Amsterdam municipal regulation', url: 'https://www.amsterdam.nl/', relevant: [], excluded: ['nl-national'], recall: null, k: 5, unsupported: { reason: 'Municipal text for this query is not in the pinned snapshot.' } }),
      judgment({ query: 'قانون العقوبات', script: 'non-Latin', level: 'national', citation: 'Egyptian Penal Code', url: 'https://www.constituteproject.org/constitution/Egypt_2014', relevant: ['eg:penal:1'], excluded: ['nl'], recall: 1, k: 5, unsupported: null }),
    ],
  };
}

function validateRetrieval(doc) {
  const collector = openDocument(doc, 'worldwide-legal-search.retrieval-evaluation@1', 'retrieval-evaluation');
  collector.require(Array.isArray(doc.unsupported_sources) && doc.unsupported_sources.length > 0, 'missing_field', 'unsupported sources must stay explicit', 'unsupported_sources');
  (doc.unsupported_sources || []).forEach((item, index) => {
    if (!isObject(item) || !isNonEmptyString(item.source_id) || !isNonEmptyString(item.reason) || item.reason.trim().length < 8) {
      collector.add('empty_reason', 'unsupported source needs an id and reason', 'unsupported_sources[' + index + ']');
    }
  });
  const levels = new Set();
  let nonLatin = false;
  collector.require(Array.isArray(doc.judgments) && doc.judgments.length > 0, 'missing_field', 'labelled judgments are required', 'judgments');
  (doc.judgments || []).forEach((item, index) => {
    const at = 'judgments[' + index + ']';
    if (!isObject(item)) {
      collector.add('invalid_type', 'judgment must be an object', at);
      return;
    }
    collector.require(isNonEmptyString(item.query), 'missing_field', 'query is required', at + '.query');
    collector.require(item.script === 'Latin' || item.script === 'non-Latin', 'invalid_field', 'script must be Latin or non-Latin', at + '.script');
    collector.require(['national', 'regional', 'municipal'].includes(item.level), 'invalid_field', 'level must be national, regional or municipal', at + '.level');
    collector.require(isNonEmptyString(item.citation) && !PLACEHOLDER.test(item.citation.trim()), 'invalid_field', 'citation is required', at + '.citation');
    collector.require(isHttps(item.source_url), 'unsafe_path', 'source_url must be https', at + '.source_url');
    collector.require(Array.isArray(item.relevant_ids) && Array.isArray(item.excluded_jurisdiction_ids), 'missing_field', 'relevant and excluded ids are required', at);
    const relevant = new Set(item.relevant_ids || []);
    for (const excluded of item.excluded_jurisdiction_ids || []) {
      if (relevant.has(excluded)) collector.add('invalid_field', 'an excluded jurisdiction is also marked relevant', at + '.excluded_jurisdiction_ids');
    }
    collector.require(isInteger(item.k) && item.k >= 1, 'invalid_field', 'k must be a positive integer', at + '.k');
    if (item.unsupported_coverage === null) {
      collector.require(typeof item.recall_at_k === 'number' && item.recall_at_k >= 0 && item.recall_at_k <= 1, 'invalid_field', 'recall_at_k must be between 0 and 1', at + '.recall_at_k');
      collector.require(Array.isArray(item.relevant_ids) && item.relevant_ids.length > 0, 'missing_field', 'a supported judgment needs relevant ids', at + '.relevant_ids');
    } else {
      collector.require(isObject(item.unsupported_coverage) && isNonEmptyString(item.unsupported_coverage.reason), 'empty_reason', 'unsupported coverage needs a reason', at + '.unsupported_coverage');
      collector.require(item.recall_at_k === null, 'invalid_field', 'unsupported coverage cannot be reported as recall', at + '.recall_at_k');
    }
    if (typeof item.level === 'string') levels.add(item.level);
    if (item.script === 'non-Latin') nonLatin = true;
  });
  for (const level of ['national', 'regional', 'municipal']) {
    if (!levels.has(level)) collector.add('scenario_missing', 'missing retrieval level ' + level, 'judgments');
  }
  collector.require(nonLatin, 'scenario_missing', 'a non-Latin query is required', 'judgments');
  return finish(doc, collector, 'retrieval-evaluation');
}

function interactionDocument() {
  return {
    schema: 'worldwide-legal-search.interaction-states@1',
    states: REQUIRED_INTERACTION_STATES.map((id) => ({ id, next_action: 'Offer a concrete next action for ' + id + '.', keyboard: true })),
    tokens: { type: { body: 'source serif' }, spacing: { unit: 4 }, color: { text: '#172026', background: '#f7f4ef' } },
    viewports: ['desktop', 'mobile'],
    mandatory_map: false,
    mandatory_model: false,
  };
}

function designMarkdown() {
  return [
    '# Worldwide visual system',
    'Desktop layout keeps search and place visible. Mobile layout keeps search and place visible and opens filters in a sheet.',
    'RTL layout mirrors the reading order and keeps focus visible. Keyboard place selection and search never depend on a pointer.',
    'The map is not required to choose a place or read a result. WCAG 2.2 AA is the target, including contrast, focus, reduced motion and reflow.',
    'Every interaction state offers a next action. A model download is optional and search works without it.',
  ].join('\n');
}

function validateUx(doc) {
  const collector = new Collector();
  if (!isObject(doc) || !isObject(doc.states) || typeof doc.design !== 'string') {
    collector.add('missing_field', 'ux contract needs interaction states and design prose', 'ux-contract');
    collector.throwIfAny();
  }
  if (isExistenceOnly(doc.states)) collector.add('existence_only', 'interaction states only assert that a file exists', 'states');
  collector.require(doc.states.schema === 'worldwide-legal-search.interaction-states@1', 'invalid_schema', 'unexpected interaction schema', 'states.schema');
  collector.require(doc.states.mandatory_map === false, 'invalid_field', 'a map must not be mandatory', 'states.mandatory_map');
  collector.require(doc.states.mandatory_model === false, 'invalid_field', 'a model must not be mandatory', 'states.mandatory_model');
  collector.require(Array.isArray(doc.states.viewports) && doc.states.viewports.includes('desktop') && doc.states.viewports.includes('mobile'), 'scenario_missing', 'desktop and mobile viewports are required', 'states.viewports');
  const tokens = doc.states.tokens;
  collector.require(isObject(tokens) && ['type', 'spacing', 'color'].every((key) => isObject(tokens[key]) && Object.keys(tokens[key]).length > 0), 'missing_field', 'type, spacing and color tokens are required', 'states.tokens');
  const seen = new Set();
  collector.require(Array.isArray(doc.states.states), 'missing_field', 'states array is required', 'states.states');
  (doc.states.states || []).forEach((state, index) => {
    if (!isObject(state) || !isNonEmptyString(state.id) || !isNonEmptyString(state.next_action) || state.keyboard !== true) {
      collector.add('scenario_missing', 'state needs an id, next action and keyboard support', 'states[' + index + ']');
      return;
    }
    seen.add(state.id);
  });
  for (const id of REQUIRED_INTERACTION_STATES) {
    if (!seen.has(id)) collector.add('scenario_missing', 'missing interaction state ' + id, 'states');
  }
  collector.require(/\bDesktop\b/.test(doc.design) && /\bMobile\b/.test(doc.design), 'scenario_missing', 'design must cover desktop and mobile', 'design');
  collector.require(/\bRTL\b/.test(doc.design) && /keyboard/i.test(doc.design) && /WCAG/.test(doc.design), 'scenario_missing', 'design must cover RTL, keyboard and WCAG', 'design');
  collector.require(/map is not required|no mandatory map|map is optional/i.test(doc.design), 'invalid_field', 'design must say a map is not required', 'design');
  collector.require(doc.design.length >= 400, 'missing_field', 'design prose is too thin to specify the visual system', 'design');
  return finish(doc, collector, 'ux-contract');
}

function performanceSample(measurementOverrides = {}, targetOverrides = {}) {
  const measurements = {
    shell_gzip_bytes: 100000,
    catalog_bytes: 200000,
    first_place_search_bytes: 1000000,
    warm_p95_ms: 800,
    cold_p95_ms: 4000,
    concurrent_requests: 4,
    heap_bytes: 100000000,
    common_term_fanout_requests: 2,
    cancellation_observed: true,
    ...measurementOverrides,
  };
  return {
    schema: 'worldwide-legal-search.performance@1',
    profile: 'mid-range-mobile',
    measurements,
    targets: { ...PLAN_PERFORMANCE_TARGETS, ...targetOverrides },
    budgets_met: true,
    regressions: [],
  };
}

function validatePerformance(doc) {
  const collector = openDocument(doc, 'worldwide-legal-search.performance@1', 'performance');
  collector.require(doc.profile === 'mid-range-mobile', 'invalid_field', 'profile must be the PLAN.md mid-range mobile profile', 'profile');
  collector.require(isObject(doc.measurements), 'missing_field', 'measurements are required', 'measurements');
  const measurements = isObject(doc.measurements) ? doc.measurements : {};
  for (const [key, limit] of Object.entries(PLAN_PERFORMANCE_TARGETS)) {
    collector.require(isInteger(measurements[key]) && measurements[key] >= 0, 'missing_field', 'missing measurement ' + key, 'measurements.' + key);
    if (isInteger(measurements[key]) && measurements[key] > limit) collector.add('budget_miss', key + ' exceeds the PLAN.md target', 'measurements.' + key);
    if (isObject(doc.targets) && Object.prototype.hasOwnProperty.call(doc.targets, key) && !(typeof doc.targets[key] === 'number' && doc.targets[key] <= limit)) {
      collector.add('weakened_target', key + ' target is looser than PLAN.md', 'targets.' + key);
    }
  }
  collector.require(isInteger(measurements.common_term_fanout_requests) && measurements.common_term_fanout_requests >= 0, 'missing_field', 'common-term fanout must be recorded', 'measurements.common_term_fanout_requests');
  collector.require(measurements.cancellation_observed === true, 'budget_miss', 'cancellation was not observed', 'measurements.cancellation_observed');
  const withinBudget = Object.entries(PLAN_PERFORMANCE_TARGETS).every(([key, limit]) => isInteger(measurements[key]) && measurements[key] <= limit) && measurements.cancellation_observed === true;
  collector.require(doc.budgets_met === withinBudget, 'budget_miss', 'budgets_met does not match the measurements', 'budgets_met');
  collector.require(Array.isArray(doc.regressions) && doc.regressions.length === 0, 'budget_miss', 'recorded regressions must be fixed before this audit passes', 'regressions');
  return finish(doc, collector, 'performance');
}

function workflowSample(extra = '') {
  return [
    'name: worldwide-checks',
    'jobs:',
    '  typecheck:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - run: npx tsc --noEmit',
    '  build:',
    '    steps:',
    '      - run: npm run build',
    '  unit:',
    '    steps:',
    '      - run: npm test -- --runInBand --runTestsByPath tests/worldwide/schema.test.ts',
    '  browser:',
    '    steps:',
    '      - run: npm run test:playwright -- tests/worldwide/accessibility.spec.ts',
    '  corpus:',
    '    steps:',
    '      - run: npm run validate:netherlands-corpus',
    '  logic:',
    '    steps:',
    '      - run: npm run validate:logic',
    extra,
  ].join('\n');
}

function regressionSample(files) {
  return {
    schema: 'worldwide-legal-search.regression-selection@1',
    preserved: [
      { path: 'src/lib/netherlandsLogic.test.ts', reason: 'Preserve Netherlands behavior.' },
      { path: 'src/lib/logic/parity/parity.test.ts', reason: 'Preserve reused logic parity.' },
    ],
    preexisting_failures: [],
    files,
  };
}

function liveTest(name) {
  return 'describe("' + name + '", () => { it("keeps the production behavior", () => { expect(1).toBe(1); }); });\n';
}

function validateWorkflowText(workflow, collector, label) {
  collector.require(typeof workflow === 'string' && workflow.length > 40, 'missing_field', 'workflow text is required', label);
  if (typeof workflow !== 'string') return;
  collector.require(/\btsc\b|\btypecheck\b/.test(workflow), 'scenario_missing', 'workflow has no typecheck gate', label);
  collector.require(/\bbuild\b/.test(workflow), 'scenario_missing', 'workflow has no build gate', label);
  collector.require(/npm test|npx jest|jest --/.test(workflow), 'scenario_missing', 'workflow has no unit test gate', label);
  collector.require(/playwright/.test(workflow), 'scenario_missing', 'workflow has no browser gate', label);
  collector.require(/netherlands|corpus/.test(workflow), 'scenario_missing', 'workflow has no corpus gate', label);
  collector.require(/\blogic\b/.test(workflow), 'scenario_missing', 'workflow has no logic parity gate', label);
  collector.require(!/continue-on-error:\s*true/.test(workflow), 'continue_on_error', 'a required gate continues on error', label);
  collector.require(!/\|\|\s*true\b/.test(workflow), 'continue_on_error', 'a gate swallows failure', label);
}

function hasLiveTest(source) {
  return typeof source === 'string' && (source.match(/\bit\(/g) || []).length + (source.match(/\btest\(/g) || []).length > 0;
}

function validateCi(doc) {
  const collector = new Collector();
  if (!isObject(doc)) {
    collector.add('invalid_type', 'ci contract must be an object', 'ci-contract');
    collector.throwIfAny();
  }
  if (isExistenceOnly(doc)) {
    collector.add('existence_only', 'ci contract only asserts that files exist', 'ci-contract');
    collector.throwIfAny();
  }
  validateWorkflowText(doc.workflow, collector, 'workflow');
  const regressions = doc.regressions;
  collector.require(isObject(regressions) && regressions.schema === 'worldwide-legal-search.regression-selection@1', 'invalid_schema', 'unexpected regression schema', 'regressions.schema');
  const preserved = isObject(regressions) && Array.isArray(regressions.preserved) ? regressions.preserved : [];
  collector.require(preserved.length >= 2, 'scenario_missing', 'at least two preserved regressions are required', 'regressions.preserved');
  const paths = preserved.map((item) => (isObject(item) ? item.path : ''));
  collector.require(paths.some((item) => item.includes('netherlandsLogic.test.ts')), 'scenario_missing', 'Netherlands logic regression is not preserved', 'regressions.preserved');
  collector.require(paths.some((item) => item.includes('parity.test.ts')), 'scenario_missing', 'logic parity regression is not preserved', 'regressions.preserved');
  const files = isObject(doc.files) ? doc.files : {};
  preserved.forEach((item, index) => {
    const at = 'regressions.preserved[' + index + ']';
    if (!isObject(item) || isUnsafeRepoPath(item.path) || !isNonEmptyString(item.reason)) {
      collector.add('invalid_field', 'preserved regression needs a relative path and reason', at);
      return;
    }
    const source = files[item.path];
    if (typeof source !== 'string') collector.add('missing_regression', 'preserved test is not loaded: ' + item.path, at);
    else if (!hasLiveTest(source)) collector.add('missing_regression', 'preserved test has no live it() or test()', at);
  });
  collector.require(isObject(regressions) && Array.isArray(regressions.preexisting_failures), 'invalid_type', 'preexisting_failures must be an array', 'regressions.preexisting_failures');
  return finish(doc, collector, 'ci-contract');
}

function productSample(actor = 'independent-validator') {
  return {
    schema: 'worldwide-legal-search.product-acceptance@1',
    actor,
    actor_separated: actor !== 'implementer' && actor !== 'self',
    site_commit: 'c'.repeat(40),
    operational_revision: 'd'.repeat(40),
    scenarios: PRODUCT_SCENARIOS.map((id) => ({
      id,
      executed: true,
      result: 'pass',
      evidence: 'Executed ' + id + ' against the accepted production build.',
    })),
    unresolved_gaps: [],
  };
}

function validateProduct(doc) {
  const collector = openDocument(doc, 'worldwide-legal-search.product-acceptance@1', 'product-acceptance');
  collector.require(doc.actor_separated === true, 'actor_not_independent', 'product acceptance needs a separate actor', 'actor_separated');
  collector.require(typeof doc.actor === 'string' && !/^(?:implementer|self|author|worker)$/i.test(doc.actor), 'actor_not_independent', 'actor is not independent', 'actor');
  collector.require(/^[0-9a-f]{40}$/.test(doc.site_commit || ''), 'integrity', 'site_commit must be the accepted commit', 'site_commit');
  collector.require(doc.operational_revision === null || /^[0-9a-f]{40}$/.test(doc.operational_revision || ''), 'integrity', 'operational revision must be pinned or explicitly null', 'operational_revision');
  const seen = new Set();
  collector.require(Array.isArray(doc.scenarios), 'missing_field', 'scenarios are required', 'scenarios');
  (doc.scenarios || []).forEach((scenario, index) => {
    const at = 'scenarios[' + index + ']';
    if (!isObject(scenario)) {
      collector.add('invalid_type', 'scenario must be an object', at);
      return;
    }
    seen.add(scenario.id);
    collector.require(scenario.executed === true, 'scenario_missing', 'scenario was not executed', at);
    collector.require(scenario.result === 'pass', 'scenario_failed', 'scenario did not pass', at + '.result');
    collector.require(isNonEmptyString(scenario.evidence) && scenario.evidence.trim().length >= 12 && !PLACEHOLDER.test(scenario.evidence.trim()), 'existence_only', 'scenario evidence must describe the run', at + '.evidence');
  });
  for (const id of PRODUCT_SCENARIOS) {
    if (!seen.has(id)) collector.add('scenario_missing', 'missing product scenario ' + id, 'scenarios');
  }
  collector.require(Array.isArray(doc.unresolved_gaps), 'invalid_type', 'unresolved_gaps must be an array', 'unresolved_gaps');
  return finish(doc, collector, 'product-acceptance');
}

function maintenanceSample() {
  return {
    markdown: [
      '# Source refresh and operational maintenance',
      '## Refresh',
      'Pin the source revision before writing derived artifacts.',
      '## Rights',
      'Audit redistribution rights for text, boundaries, translations and embeddings.',
      '## Schema',
      'Quarantine incompatible schemas without poisoning the current snapshot.',
      '## Coverage',
      'Record known, partial, missing, unknown and unavailable coverage.',
      '## Rollback',
      'Restore the previous manifest atomically when audit fails.',
      '## Ownership',
      'Site maintainers own the refresh pipeline. The host supervisor owns process recovery.',
      '## Credentials',
      'Credentials never enter the site repository or the browser bundle.',
    ].join('\n'),
    source: [
      'export function pinRevision(revision) {',
      '  if (!revision) throw new Error("revision required");',
      '  return revision;',
      '}',
      'export function auditRefresh(snapshot) {',
      '  return { rights: snapshot.rights, schema: snapshot.schema, coverage: snapshot.coverage };',
      '}',
      'export function rollback(previous) {',
      '  if (!previous) throw new Error("rollback target required");',
      '  return previous;',
      '}',
    ].join('\n'),
  };
}

function sectionBody(markdown, heading) {
  const lines = markdown.split('\n');
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start < 0) return '';
  const body = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('## ')) break;
    body.push(line);
  }
  return body.join('\n');
}

function validateMaintenance(doc) {
  const collector = new Collector();
  if (!isObject(doc) || typeof doc.markdown !== 'string' || typeof doc.source !== 'string') {
    collector.add('missing_field', 'maintenance needs markdown and refresh source', 'maintenance');
    collector.throwIfAny();
  }
  for (const heading of ['# Source refresh and operational maintenance', '## Refresh', '## Rights', '## Schema', '## Coverage', '## Rollback', '## Ownership', '## Credentials']) {
    collector.require(doc.markdown.split('\n').some((line) => line.trim() === heading), 'missing_field', 'missing heading ' + heading, 'markdown');
  }
  const credentials = sectionBody(doc.markdown, '## Credentials');
  collector.require(/never|do not|must not/i.test(credentials) && /site/i.test(credentials), 'secret_material', 'credentials section must keep secrets out of the site', 'markdown');
  collector.require(/\bexport\b/.test(doc.source) && /\bfunction\b/.test(doc.source), 'missing_field', 'refresh.ts must export functions', 'source');
  for (const needle of ['rollback', 'rights', 'schema', 'coverage']) {
    collector.require(doc.source.includes(needle), 'missing_field', 'refresh.ts does not implement ' + needle, 'source');
  }
  collector.require(!/\bnot implemented\b|TODO:\s*implement/i.test(doc.source), 'existence_only', 'refresh.ts is a stub', 'source');
  rejectSecrets(doc.source, collector, 'source');
  rejectSecrets(doc.markdown, collector, 'markdown');
  collector.throwIfAny();
  return { ok: true };
}

function releaseSample(workflowExtra = '') {
  return {
    candidate: {
      schema: 'worldwide-legal-search.release-candidate@1',
      commit: 'c'.repeat(40),
      tree: 'd'.repeat(40),
      preview_commit: 'c'.repeat(40),
      shell_bytes: 1000,
      hash_routes: true,
      nojekyll: true,
      redirects_present: true,
      server_dependency: false,
      secrets_in_build: false,
      required_checks_block_deploy: true,
    },
    workflow: workflowSample('      - run: test -f dist/.nojekyll\n') + workflowExtra,
  };
}

function validateRelease(doc) {
  const collector = new Collector();
  if (!isObject(doc) || !isObject(doc.candidate) || typeof doc.workflow !== 'string') {
    collector.add('missing_field', 'release candidate needs a record and deploy workflow', 'release-candidate');
    collector.throwIfAny();
  }
  const candidate = doc.candidate;
  if (isExistenceOnly(candidate)) collector.add('existence_only', 'release candidate only asserts that a file exists', 'candidate');
  collector.require(candidate.schema === 'worldwide-legal-search.release-candidate@1', 'invalid_schema', 'unexpected release schema', 'candidate.schema');
  collector.require(/^[0-9a-f]{40}$/.test(candidate.commit || '') && candidate.tree && /^[0-9a-f]{40}$/.test(candidate.tree), 'integrity', 'commit and tree must be pinned', 'candidate.commit');
  collector.require(candidate.preview_commit === candidate.commit, 'integrity', 'preview evidence must bind the same commit', 'candidate.preview_commit');
  collector.require(isInteger(candidate.shell_bytes) && candidate.shell_bytes <= PLAN_PERFORMANCE_TARGETS.shell_gzip_bytes, 'budget_miss', 'shell is larger than the PLAN.md budget', 'candidate.shell_bytes');
  for (const field of ['hash_routes', 'nojekyll', 'redirects_present', 'required_checks_block_deploy']) {
    collector.require(candidate[field] === true, 'invalid_field', field + ' must be true', 'candidate.' + field);
  }
  collector.require(candidate.server_dependency === false && candidate.secrets_in_build === false, 'secret_material', 'release candidate must not depend on a server or secrets', 'candidate');
  validateWorkflowText(doc.workflow, collector, 'workflow');
  collector.require(doc.workflow.includes('.nojekyll'), 'missing_field', 'deploy workflow must publish .nojekyll', 'workflow');
  rejectSecrets(doc.workflow, collector, 'workflow');
  collector.throwIfAny();
  return { ok: true };
}

function deploymentSample(status = 'published') {
  if (status === 'blocked') {
    return {
      schema: 'worldwide-legal-search.deployment@1',
      status: 'blocked',
      actions_run: null,
      artifact_digest: null,
      url: null,
      blocker: { kind: 'external', reason: 'Release authority is not available to this campaign.' },
    };
  }
  return {
    schema: 'worldwide-legal-search.deployment@1',
    status: 'published',
    actions_run: 'https://github.com/worldwidelaws/worldwidelaws.github.io/actions/runs/1',
    artifact_digest: 'sha256:' + SHA,
    url: 'https://worldwidelaws.github.io/',
    blocker: null,
  };
}

function validateDeployment(doc) {
  const collector = openDocument(doc, 'worldwide-legal-search.deployment@1', 'deployment');
  collector.require(doc.status === 'published' || doc.status === 'blocked', 'invalid_field', 'status must be published or blocked', 'status');
  if (doc.status === 'published') {
    collector.require(isHttps(doc.actions_run), 'missing_field', 'published deployment needs an Actions URL', 'actions_run');
    collector.require(isPrefixedDigest(doc.artifact_digest), 'integrity', 'artifact_digest must be sha256-prefixed', 'artifact_digest');
    collector.require(isHttps(doc.url), 'missing_field', 'published deployment needs a public https URL', 'url');
    collector.require(doc.blocker === null, 'invalid_field', 'a published deployment cannot also be blocked', 'blocker');
  }
  if (doc.status === 'blocked') {
    collector.require(isObject(doc.blocker) && doc.blocker.kind === 'external' && isNonEmptyString(doc.blocker.reason), 'missing_blocker', 'a blocked deployment needs an external blocker', 'blocker');
  }
  return finish(doc, collector, 'deployment');
}

function smokeSample() {
  return {
    schema: 'worldwide-legal-search.public-smoke@1',
    url: 'https://worldwidelaws.github.io/',
    artifact_digest: 'sha256:' + SHA,
    scenarios: SMOKE_SCENARIOS,
    results: SMOKE_SCENARIOS.map((id) => ({ id, pass: true, evidence: 'Public page exercised ' + id + ' on the published URL.' })),
    rollback_tested: true,
    prior_release_preserved: true,
    prior_release_digest: 'sha256:' + SHA_B,
  };
}

function validateSmoke(doc) {
  const collector = openDocument(doc, 'worldwide-legal-search.public-smoke@1', 'public-smoke');
  collector.require(isHttps(doc.url), 'missing_field', 'public URL must be https', 'url');
  collector.require(isPrefixedDigest(doc.artifact_digest), 'integrity', 'artifact_digest must be sha256-prefixed', 'artifact_digest');
  collector.require(isPrefixedDigest(doc.prior_release_digest) && doc.prior_release_digest !== doc.artifact_digest, 'integrity', 'prior release digest must be distinct', 'prior_release_digest');
  collector.require(doc.rollback_tested === true, 'scenario_missing', 'rollback was not tested', 'rollback_tested');
  collector.require(doc.prior_release_preserved === true, 'scenario_missing', 'prior release was not preserved', 'prior_release_preserved');
  const ids = Array.isArray(doc.scenarios) ? doc.scenarios : [];
  for (const id of SMOKE_SCENARIOS) {
    if (!ids.includes(id)) collector.add('scenario_missing', 'missing smoke scenario ' + id, 'scenarios');
  }
  const results = new Map();
  collector.require(Array.isArray(doc.results), 'missing_field', 'results are required', 'results');
  (doc.results || []).forEach((result, index) => {
    if (!isObject(result) || result.pass !== true || !isNonEmptyString(result.evidence) || result.evidence.trim().length < 12) {
      collector.add('scenario_failed', 'smoke result must pass with evidence', 'results[' + index + ']');
      return;
    }
    results.set(result.id, result);
  });
  for (const id of SMOKE_SCENARIOS) {
    if (!results.has(id)) collector.add('scenario_missing', 'missing smoke result ' + id, 'results');
  }
  return finish(doc, collector, 'public-smoke');
}

function campaignClosureSample() {
  return {
    closure: {
      schema: 'worldwide-legal-search.campaign-closure@1',
      own_receipt: 'pending',
      completion_verified: false,
      root_completion_published: false,
      requires_own_receipt: false,
      prior_task_receipts_checked: ['WWL-017', 'WWL-106', 'WWL-113'],
      public_release_verified: true,
      future_coverage_path: 'docs/worldwide/future-coverage.json',
    },
    future: {
      schema: 'worldwide-legal-search.future-coverage@1',
      inventory_revision: REV,
      claims_global_legal_completeness: false,
      remaining: [{ place: 'uncovered-municipality', state: 'unknown', reason: 'No eligible public collection was in the pinned inventory.' }],
    },
  };
}

function validateClosure(doc) {
  const collector = new Collector();
  if (!isObject(doc) || !isObject(doc.closure) || !isObject(doc.future)) {
    collector.add('missing_field', 'campaign closure needs closure metadata and future coverage', 'campaign-closure');
    collector.throwIfAny();
  }
  if (isExistenceOnly(doc.closure)) collector.add('existence_only', 'closure metadata only asserts that a file exists', 'closure');
  const closure = doc.closure;
  collector.require(closure.schema === 'worldwide-legal-search.campaign-closure@1', 'invalid_schema', 'unexpected closure schema', 'closure.schema');
  // The closure task cannot require its own future receipt. Pending is the only legal value.
  collector.require(closure.own_receipt === 'pending', 'receipt_required', 'WWL-114 must keep its own receipt pending', 'closure.own_receipt');
  collector.require(closure.requires_own_receipt === false, 'receipt_required', 'closure must not require the WWL-114 receipt to exist', 'closure.requires_own_receipt');
  collector.require(closure.completion_verified === false, 'completion_claimed', 'this record cannot claim root completion', 'closure.completion_verified');
  collector.require(closure.root_completion_published === false, 'completion_claimed', 'root completion is published only after independent admission', 'closure.root_completion_published');
  collector.require(closure.public_release_verified === true, 'scenario_missing', 'public release evidence is not marked verified', 'closure.public_release_verified');
  const prior = Array.isArray(closure.prior_task_receipts_checked) ? closure.prior_task_receipts_checked : [];
  for (const id of ['WWL-017', 'WWL-106', 'WWL-113']) {
    if (!prior.includes(id)) collector.add('scenario_missing', 'prior receipt list omits ' + id, 'closure.prior_task_receipts_checked');
  }
  if (prior.includes('WWL-114')) collector.add('receipt_required', 'prior receipt list must not demand the WWL-114 receipt', 'closure.prior_task_receipts_checked');
  collector.require(closure.future_coverage_path === 'docs/worldwide/future-coverage.json', 'invalid_field', 'future coverage path is fixed', 'closure.future_coverage_path');
  const future = doc.future;
  collector.require(future.schema === 'worldwide-legal-search.future-coverage@1', 'invalid_schema', 'unexpected future coverage schema', 'future.schema');
  collector.require(isRevision(future.inventory_revision), 'invalid_field', 'future coverage must name the inventory revision', 'future.inventory_revision');
  collector.require(future.claims_global_legal_completeness === false, 'legal_completeness', 'future coverage cannot claim every law was collected', 'future.claims_global_legal_completeness');
  collector.require(Array.isArray(future.remaining), 'missing_field', 'remaining coverage must be an array', 'future.remaining');
  if (Array.isArray(future.remaining) && future.remaining.length === 0) {
    collector.require(isNonEmptyString(future.empty_reason) && !/complete|all laws/i.test(future.empty_reason), 'empty_reason', 'an empty remainder needs a non-completeness reason', 'future.empty_reason');
  }
  (future.remaining || []).forEach((item, index) => {
    if (!isObject(item) || !isNonEmptyString(item.place) || !['missing', 'unknown', 'unavailable'].includes(item.state) || !isNonEmptyString(item.reason)) {
      collector.add('missing_field', 'remaining coverage needs place, state and reason', 'future.remaining[' + index + ']');
    }
  });
  return finish(doc, collector, 'campaign-closure');
}

export function sourceJobIdentityHash(fields) {
  const tuple = [fields.dataset_id, fields.resolved_revision, fields.config, fields.split, fields.jurisdiction_id, fields.shard_id, fields.phase];
  return createHash('sha256').update(JSON.stringify(tuple)).digest('hex').slice(0, 16);
}

function sourceJobFields(phase) {
  return {
    dataset_id: 'justicedao/example-laws',
    resolved_revision: REV,
    config: 'default',
    split: 'train',
    jurisdiction_id: 'nl',
    shard_id: '0001',
    phase,
  };
}

function sourceJobSample(phase = 'normalize', suffix = '0001') {
  const fields = sourceJobFields(phase);
  const hash = sourceJobIdentityHash(fields);
  const doc = {
    schema: 'worldwide-legal-search.source-job@1',
    job_id: 'WWL-SRC-' + hash + '-' + phase + '-' + suffix,
    ...fields,
    source_key: 'justicedao-example-laws',
    integrity: { sha256: SHA, bytes: 128 },
  };
  if (phase === 'normalize') {
    doc.records = [{
      id: 'nl:bwbr0001854:1',
      original_text: 'Geen feit is strafbaar dan uit kracht van een daaraan voorafgegane wettelijke strafbepaling.',
      article_inheritance: { parent_id: 'nl:bwbr0001854', inherited: true },
      dates: { publication: '1881-03-03', precision: 'day' },
      status: 'unknown',
      rights: { status: 'resolved', name: 'unknown' },
      provenance: { dataset_id: fields.dataset_id, revision: REV },
    }];
  }
  if (phase === 'index') {
    doc.postings_revision = REV;
    doc.citation_lookup = true;
    doc.artifact_bytes = 1000;
    doc.artifact_byte_budget = 5000;
    doc.multilingual_fixtures = [{ script: 'Latin', query: 'artikel' }, { script: 'Arabic', query: 'قانون' }];
  }
  if (phase === 'geo') {
    doc.issuer_id = 'nl-state';
    doc.territorial_scope = 'NL';
    doc.geography_revision = REV;
    doc.levels = [{ level: 'national', coverage_state: 'known' }, { level: 'municipal', coverage_state: 'unknown' }];
    doc.unknown_relationships = [{ from: 'nl-state', to: 'eu', reason: 'Applicability is not inferred from membership.' }];
  }
  if (phase === 'publish') {
    doc.public_urls = ['https://huggingface.co/datasets/justicedao/example-laws/resolve/main/shard.json'];
    doc.rights_status = 'resolved';
    doc.attribution = 'Example publisher';
    doc.restrictions = ['no silent modification of legal text'];
    doc.host_credentials_in_document = false;
    doc.source_revision_mutated = false;
    doc.cors_or_range_probe = { kind: 'shard', observed_at: '2026-10-27T00:00:00Z', result: 'limited', limitation: 'Range was not advertised; shard fallback is required.' };
  }
  if (phase === 'verify') {
    doc.published_sha256 = SHA;
    doc.source_revision = REV;
    doc.independent = true;
    doc.verifier = 'independent';
    doc.publisher_receipt_id = 'pub-1';
    doc.receipt_id = 'ver-1';
  }
  return doc;
}

function validateSourceJob(doc, context) {
  const collector = openDocument(doc, 'worldwide-legal-search.source-job@1', 'source-job');
  const match = typeof doc.job_id === 'string' ? /^WWL-SRC-([0-9a-f]{16})-(normalize|index|geo|publish|verify)-([0-9]{4})$/.exec(doc.job_id) : null;
  collector.require(match !== null, 'integrity', 'job_id does not match the source-job pattern', 'job_id');
  collector.require(SOURCE_PHASES.includes(doc.phase), 'phase_mismatch', 'phase is not a source phase', 'phase');
  const fields = {
    dataset_id: doc.dataset_id,
    resolved_revision: doc.resolved_revision,
    config: doc.config,
    split: doc.split,
    jurisdiction_id: doc.jurisdiction_id,
    shard_id: doc.shard_id,
    phase: doc.phase,
  };
  if (match && SOURCE_PHASES.includes(doc.phase)) {
    const hash = sourceJobIdentityHash(fields);
    if (match[1] !== hash) collector.add('integrity', 'job_id hash does not match the identity tuple', 'job_id');
    if (match[2] !== doc.phase) collector.add('phase_mismatch', 'job_id phase does not match the manifest phase', 'job_id');
    if (match[3] !== '0001' && !isNonEmptyString(doc.collision_of)) collector.add('integrity', 'a non-initial suffix needs collision_of', 'job_id');
  }
  if (context.phase && context.phase !== doc.phase) collector.add('phase_mismatch', 'requested phase does not match the manifest', 'phase');
  if (context.jobId && context.jobId !== doc.job_id) collector.add('integrity', 'requested job id does not match the manifest', 'job_id');
  collector.require(isDatasetId(doc.dataset_id), 'invalid_field', 'dataset_id is required', 'dataset_id');
  collector.require(isRevision(doc.resolved_revision), 'invalid_field', 'resolved_revision must be pinned', 'resolved_revision');
  for (const field of ['config', 'split', 'jurisdiction_id', 'shard_id', 'source_key']) {
    collector.require(isNonEmptyString(doc[field]), 'missing_field', field + ' is required', field);
  }
  collector.require(isObject(doc.integrity) && isSha256(doc.integrity.sha256) && isInteger(doc.integrity.bytes) && doc.integrity.bytes >= 0, 'integrity', 'integrity sha256 and bytes are required', 'integrity');
  if (doc.phase === 'normalize') {
    collector.require(Array.isArray(doc.records) && doc.records.length > 0, 'missing_field', 'normalize manifest needs records', 'records');
    (doc.records || []).forEach((record, index) => {
      const at = 'records[' + index + ']';
      if (!isObject(record) || !isNonEmptyString(record.id) || !isNonEmptyString(record.original_text) || !isObject(record.article_inheritance) || !isObject(record.dates) || !isNonEmptyString(record.status) || !isObject(record.rights) || !isObject(record.provenance)) {
        collector.add('missing_field', 'normalize record needs id, text, inheritance, dates, status, rights and provenance', at);
      }
    });
  }
  if (doc.phase === 'index') {
    collector.require(isRevision(doc.postings_revision), 'invalid_field', 'postings_revision must be pinned', 'postings_revision');
    collector.require(doc.citation_lookup === true, 'missing_field', 'citation lookup must be exercised', 'citation_lookup');
    collector.require(isInteger(doc.artifact_bytes) && isInteger(doc.artifact_byte_budget) && doc.artifact_bytes <= doc.artifact_byte_budget, 'budget_miss', 'index artifact exceeds its byte budget', 'artifact_bytes');
    const scripts = new Set((doc.multilingual_fixtures || []).map((item) => (isObject(item) ? item.script : '')));
    collector.require(scripts.size >= 2, 'scenario_missing', 'index manifest needs two script fixtures', 'multilingual_fixtures');
  }
  if (doc.phase === 'geo') {
    collector.require(isNonEmptyString(doc.issuer_id) && isNonEmptyString(doc.territorial_scope) && isRevision(doc.geography_revision), 'missing_field', 'geo manifest needs issuer, scope and geography revision', 'issuer_id');
    collector.require(Array.isArray(doc.levels) && doc.levels.some((item) => isObject(item) && COVERAGE_STATES.includes(item.coverage_state)), 'coverage_class_missing', 'geo levels need a coverage state', 'levels');
    collector.require(Array.isArray(doc.unknown_relationships), 'missing_field', 'unknown_relationships must be explicit', 'unknown_relationships');
  }
  if (doc.phase === 'publish') {
    collector.require(Array.isArray(doc.public_urls) && doc.public_urls.length > 0 && doc.public_urls.every(isHttps), 'missing_field', 'publish manifest needs https URLs', 'public_urls');
    collector.require(doc.rights_status === 'resolved' && isNonEmptyString(doc.attribution) && Array.isArray(doc.restrictions), 'missing_field', 'publish manifest needs resolved rights and attribution', 'rights_status');
    collector.require(doc.host_credentials_in_document === false && doc.source_revision_mutated === false, 'secret_material', 'publish manifest must not carry credentials or mutate the source revision', 'host_credentials_in_document');
    const probe = doc.cors_or_range_probe;
    collector.require(isObject(probe) && ['cors', 'range', 'shard'].includes(probe.kind) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(probe.observed_at || '') && ['pass', 'fail', 'limited'].includes(probe.result), 'missing_field', 'CORS, Range or shard probe is required', 'cors_or_range_probe');
    if (isObject(probe) && probe.result !== 'pass') collector.require(isNonEmptyString(probe.limitation), 'empty_reason', 'a limited or failed probe needs a limitation', 'cors_or_range_probe.limitation');
  }
  if (doc.phase === 'verify') {
    collector.require(isSha256(doc.published_sha256) && isRevision(doc.source_revision), 'integrity', 'verify manifest must bind the published digest and source revision', 'published_sha256');
    collector.require(doc.independent === true && doc.verifier === 'independent', 'actor_not_independent', 'verification must be independent of publication', 'verifier');
    collector.require(isNonEmptyString(doc.receipt_id) && isNonEmptyString(doc.publisher_receipt_id) && doc.receipt_id !== doc.publisher_receipt_id, 'integrity', 'verify receipt must differ from the publisher receipt', 'receipt_id');
  }
  return finish(doc, collector, 'source-job');
}

function dispositionSample() {
  const rows = [
    ['national', 'include', false, ['text'], 'National law text with a pinned card.'],
    ['regional', 'include', false, ['text'], 'Regional law text with a pinned card.'],
    ['municipal', 'blocked', false, ['text'], 'Municipal collection is listed but not readable.'],
    ['country-ir', 'include', false, ['index'], 'Country information-retrieval index, separate from the law text.'],
    ['unified-netherlands', 'include', false, ['text', 'index'], 'Unified Netherlands corpus and index lineage.'],
    ['legacy-index', 'exclude', true, ['code'], 'Legacy release is code-only and is not law text.'],
  ];
  return {
    schema: 'worldwide-legal-search.source-dispositions@1',
    inventory_revision: REV,
    dispositions: rows.map(([family, decision, codeOnly, capabilities, reason], index) => ({
      dataset_id: (index % 2 === 0 ? 'justicedao' : 'endomorphosis') + '/' + family,
      family,
      decision,
      reason,
      schema_capabilities: capabilities,
      source_lineage: 'card:' + family,
      code_only_release: codeOnly,
    })),
  };
}

function rightsSample() {
  return {
    schema: 'worldwide-legal-search.rights@1',
    records: [
      {
        dataset_id: 'justicedao/example-laws',
        artifact_revision: REV,
        rights: 'CC-BY-4.0',
        attribution: 'Example publisher',
        restrictions: [],
        status: 'resolved',
        blocker: null,
        inferred_from_organization: false,
      },
      {
        dataset_id: 'endomorphosis/gated-laws',
        artifact_revision: REV,
        rights: null,
        attribution: null,
        restrictions: [],
        status: 'unresolved',
        blocker: { kind: 'rights', reason: 'Terms of use could not be read from the dataset card.' },
        inferred_from_organization: false,
      },
    ],
  };
}

function geographySample() {
  return {
    schema: 'worldwide-legal-search.geography-manifest@1',
    dataset_id: 'justicedao/places',
    revision: REV,
    license: 'ODbL-1.0',
    attribution: 'OpenStreetMap contributors',
    municipality_detail: 'partial',
    municipality_limit: 'Municipality geometry is not published for every country.',
    native_alias_sample: [{ name: 'Den Haag', lang: 'nl' }],
    coverage_limits: ['Antimeridian polygons are included only where the source publishes them.'],
    hierarchical: true,
    complete_world: false,
    layout: [
      { level: 'country', path: 'geography/country/' },
      { level: 'admin', path: 'geography/admin/' },
      { level: 'place', path: 'geography/place/' },
    ],
  };
}

function regressionFiles() {
  return {
    'src/lib/netherlandsLogic.test.ts': liveTest('netherlands'),
    'src/lib/logic/parity/parity.test.ts': liveTest('parity'),
  };
}

export function validSample(mode) {
  switch (mode) {
    case 'source-inventory':
      return inventoryDocument('complete');
    case 'source-dispositions':
      return dispositionSample();
    case 'rights':
      return rightsSample();
    case 'catalog':
      return catalogSchemaDocument();
    case 'inventory-closure':
      return inventoryClosureSample();
    case 'geography':
      return geographySample();
    case 'jurisdiction-fixtures':
      return jurisdictionBundle();
    case 'retrieval-evaluation':
      return retrievalSample();
    case 'ux-contract':
      return { states: interactionDocument(), design: designMarkdown() };
    case 'performance':
      return performanceSample();
    case 'ci-contract':
      return { workflow: workflowSample(), regressions: regressionSample(regressionFiles()), files: regressionFiles() };
    case 'product-acceptance':
      return productSample();
    case 'maintenance':
      return maintenanceSample();
    case 'release-candidate':
      return releaseSample();
    case 'deployment':
      return deploymentSample('published');
    case 'public-smoke':
      return smokeSample();
    case 'campaign-closure':
      return campaignClosureSample();
    case 'source-job':
      return sourceJobSample('normalize');
    default:
      throw new ContractError([problem('unknown_mode', 'no sample for ' + mode, mode)]);
  }
}

export function validateAuditDocument(mode, doc, context = {}) {
  if (!AUDIT_MODES.includes(mode) || mode === 'harness') {
    throw new ContractError([problem('unknown_mode', 'audit mode does not accept a document: ' + mode, 'mode')]);
  }
  if (!isObject(doc)) throw new ContractError([problem('invalid_type', 'audit document must be a JSON object', mode)]);
  if (isExistenceOnly(doc)) throw new ContractError([problem('existence_only', mode + ' only asserts that a file exists', mode)]);
  switch (mode) {
    case 'source-inventory':
      return validateSourceInventory(doc);
    case 'source-dispositions':
      return validateDispositions(doc);
    case 'rights':
      return validateRights(doc);
    case 'catalog':
      return validateCatalogSchema(doc);
    case 'inventory-closure':
      return validateInventoryClosure(doc);
    case 'geography':
      return validateGeography(doc);
    case 'jurisdiction-fixtures':
      return validateJurisdictionFixtures(doc);
    case 'retrieval-evaluation':
      return validateRetrieval(doc);
    case 'ux-contract':
      return validateUx(doc);
    case 'performance':
      return validatePerformance(doc);
    case 'ci-contract':
      return validateCi(doc);
    case 'product-acceptance':
      return validateProduct(doc);
    case 'maintenance':
      return validateMaintenance(doc);
    case 'release-candidate':
      return validateRelease(doc);
    case 'deployment':
      return validateDeployment(doc);
    case 'public-smoke':
      return validateSmoke(doc);
    case 'campaign-closure':
      return validateClosure(doc);
    case 'source-job':
      return validateSourceJob(doc, context);
    default:
      throw new ContractError([problem('unknown_mode', 'no validator for ' + mode, mode)]);
  }
}

const README_HEADINGS = [
  '# Worldwide fixture conventions',
  '## Purpose',
  '## Layout',
  '## Fixture schema',
  '## Valid fixture',
  '## Invalid fixtures',
  '## Validation commands',
  '## Campaign worktree',
  '## Rejection rules',
  '## Audit documents',
];

export function validateReadme(readme, modes = AUDIT_MODES) {
  const collector = new Collector();
  collector.require(typeof readme === 'string' && readme.length > 500, 'fixture_convention', 'fixture conventions are missing', 'tests/worldwide/README.md');
  if (typeof readme !== 'string') collector.throwIfAny();
  for (const heading of README_HEADINGS) {
    collector.require(readme.split('\n').some((line) => line.trim() === heading), 'fixture_convention', 'missing heading ' + heading, heading);
  }
  for (const phrase of ['implementation/wwl-', 'agent/worldwide-legal-search-v1', FIXTURE_SCHEMA, 'reject invalid inputs', 'PLAN.md', 'dataset_id, resolved_revision, config, split, jurisdiction_id, shard_id, phase']) {
    collector.require(readme.includes(phrase), 'fixture_convention', 'README is missing ' + phrase, 'tests/worldwide/README.md');
  }
  for (const mode of modes) collector.require(readme.includes(mode), 'fixture_convention', 'README omits audit mode ' + mode, mode);
  const fences = [...readme.matchAll(/```json[ \t]+(\S+)(?:[ \t]+(\S+))?[ \t]*\n([\s\S]*?)```/g)];
  const valid = fences.filter((match) => match[1] === 'valid-fixture');
  const invalid = fences.filter((match) => match[1] === 'invalid-fixture');
  collector.require(valid.length >= 1, 'fixture_convention', 'README needs a valid fixture example', 'valid-fixture');
  for (const code of ['existence_only', 'unsafe_path', 'fabricated_conclusion']) {
    collector.require(invalid.some((match) => match[2] === code), 'fixture_convention', 'README needs an invalid fixture for ' + code, code);
  }
  for (const match of valid) {
    let parsed;
    try {
      parsed = JSON.parse(match[3]);
    } catch (error) {
      collector.add('invalid_json', 'valid fixture example is not JSON: ' + error.message, 'valid-fixture');
      continue;
    }
    try {
      validateFixture(parsed, 'readme-valid-fixture');
    } catch (error) {
      collector.add('fixture_convention', 'README valid fixture was rejected: ' + error.message, 'valid-fixture');
    }
  }
  for (const match of invalid) {
    let parsed;
    try {
      parsed = JSON.parse(match[3]);
    } catch (error) {
      collector.add('invalid_json', 'invalid fixture example is not JSON: ' + error.message, 'invalid-fixture');
      continue;
    }
    try {
      validateFixture(parsed, 'readme-invalid-fixture');
      collector.add('fixture_convention', 'README invalid fixture was accepted for ' + match[2], match[2] || 'invalid-fixture');
    } catch (error) {
      const codes = error instanceof ContractError ? error.errors.map((entry) => entry.code) : [];
      if (!codes.includes(match[2])) collector.add('fixture_convention', 'README invalid fixture rejected ' + codes.join(',') + ' instead of ' + match[2], match[2] || 'invalid-fixture');
    }
  }
  collector.throwIfAny();
  return { ok: true, valid_examples: valid.length, invalid_examples: invalid.length };
}

export function validatePackageScripts(pkg) {
  const collector = new Collector();
  const scripts = isObject(pkg) && isObject(pkg.scripts) ? pkg.scripts : {};
  collector.require(scripts['worldwide:audit'] === 'node scripts/worldwide/audit.mjs', 'command_mismatch', 'worldwide:audit must invoke audit.mjs and forward arguments', 'scripts.worldwide:audit');
  collector.require(scripts['worldwide:harness'] === 'node scripts/worldwide/audit.mjs harness', 'command_mismatch', 'worldwide:harness must run the harness mode', 'scripts.worldwide:harness');
  collector.require(typeof scripts['worldwide:check-contracts'] === 'string' && scripts['worldwide:check-contracts'].startsWith('node scripts/worldwide/check-contracts.mjs'), 'command_mismatch', 'worldwide:check-contracts must invoke the contract checker', 'scripts.worldwide:check-contracts');
  collector.require(typeof scripts.test === 'string' && /\bjest\b/.test(scripts.test), 'command_mismatch', 'npm test must run jest so board paths can be appended', 'scripts.test');
  collector.require(typeof scripts['test:playwright'] === 'string' && /playwright\s+test/.test(scripts['test:playwright']), 'command_mismatch', 'test:playwright must run playwright test', 'scripts.test:playwright');
  collector.require(typeof scripts['test:worldwide'] === 'string' && /jest/.test(scripts['test:worldwide']) && /tests\/worldwide/.test(scripts['test:worldwide']) && /--runInBand/.test(scripts['test:worldwide']) && /--watchAll=false/.test(scripts['test:worldwide']), 'command_mismatch', 'test:worldwide must run worldwide jest tests once', 'scripts.test:worldwide');
  for (const name of ['test', 'test:playwright', 'test:worldwide', 'worldwide:audit', 'worldwide:harness', 'worldwide:check-contracts']) {
    collector.require(typeof scripts[name] !== 'string' || !/passWithNoTests|\|\|\s*true/.test(scripts[name]), 'command_mismatch', name + ' must not ignore missing or failed checks', 'scripts.' + name);
  }
  collector.throwIfAny();
  return { ok: true };
}

export function validateLockfile(pkg, lock) {
  const collector = new Collector();
  collector.require(isObject(lock) && lock.lockfileVersion === 3, 'integrity', 'package-lock.json must be lockfileVersion 3', 'package-lock.json');
  collector.require(isObject(pkg) && isObject(lock) && lock.name === pkg.name, 'integrity', 'lockfile name must match package.json', 'package-lock.json');
  const lockedRoot = isObject(lock) && isObject(lock.packages) ? lock.packages[''] : null;
  collector.require(isObject(lockedRoot) && lockedRoot.name === pkg.name, 'integrity', 'lockfile root package name drifted', 'packages.');
  const declared = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const locked = { ...(lockedRoot && lockedRoot.dependencies ? lockedRoot.dependencies : {}), ...(lockedRoot && lockedRoot.devDependencies ? lockedRoot.devDependencies : {}) };
  for (const [name, range] of Object.entries(declared)) {
    collector.require(locked[name] === range, 'integrity', 'lockfile range drifted for ' + name, name);
  }
  collector.throwIfAny();
  return { ok: true };
}

export function validateJestConfig(config) {
  const collector = new Collector();
  const patterns = Array.isArray(config && config.testMatch) ? config.testMatch : [];
  const hit = (file) => patterns.some((pattern) => globMatch(file, String(pattern).replace('<rootDir>/', '')));
  collector.require(hit('src/__tests__/basic.test.ts'), 'config_rejected', 'jest no longer matches existing src tests', 'testMatch');
  collector.require(hit('src/lib/netherlandsLogic.test.ts'), 'config_rejected', 'jest no longer matches Netherlands tests', 'testMatch');
  collector.require(hit('tests/worldwide/netherlands-compat.test.ts'), 'config_rejected', 'jest does not match worldwide unit tests', 'testMatch');
  collector.require(hit('tests/worldwide/place-picker.test.tsx'), 'config_rejected', 'jest does not match worldwide tsx tests', 'testMatch');
  collector.require(!hit('tests/worldwide/location.spec.ts'), 'config_rejected', 'playwright specs must not run under jest', 'testMatch');
  collector.require(!hit('tests/worldwide/fixtures/jurisdiction-cases.json'), 'config_rejected', 'fixture JSON must not be executed as a test', 'testMatch');
  const ignores = Array.isArray(config && config.testPathIgnorePatterns) ? config.testPathIgnorePatterns : [];
  collector.require(ignores.some((pattern) => String(pattern).includes('tests/worldwide/fixtures')), 'config_rejected', 'jest must ignore worldwide fixture files', 'testPathIgnorePatterns');
  collector.require(config && config.testEnvironment === 'jsdom', 'config_rejected', 'jest test environment must stay jsdom', 'testEnvironment');
  collector.require(!config || config.passWithNoTests !== true, 'command_mismatch', 'jest must not pass with no tests', 'passWithNoTests');
  collector.throwIfAny();
  return { ok: true };
}

export function validatePlaywrightConfig(config, source) {
  const collector = new Collector();
  collector.require(config && config.testDir === './tests', 'config_rejected', 'playwright testDir must be ./tests', 'testDir');
  collector.require(typeof source === 'string' && source.includes('forbidOnly: !!process.env.CI'), 'config_rejected', 'playwright must forbid test.only on CI', 'forbidOnly');
  collector.require(isInteger(config && config.timeout) && config.timeout >= 30000, 'config_rejected', 'playwright timeout is too small', 'timeout');
  collector.require(Array.isArray(config && config.projects) && config.projects.some((project) => project && project.name === 'chromium'), 'config_rejected', 'playwright needs the chromium project', 'projects');
  collector.require(config && config.use && typeof config.use.baseURL === 'string' && config.use.baseURL.startsWith('http://localhost'), 'config_rejected', 'playwright baseURL must be the local preview', 'use.baseURL');
  collector.require(config && config.webServer && typeof config.webServer.command === 'string' && /vite/.test(config.webServer.command), 'config_rejected', 'playwright must boot the vite preview', 'webServer');
  const ignores = Array.isArray(config && config.testIgnore) ? config.testIgnore : [];
  const ignored = (file) => ignores.some((pattern) => globMatch(file, pattern));
  collector.require(ignored('tests/worldwide/netherlands-compat.test.ts'), 'config_rejected', 'playwright must ignore jest unit tests', 'testIgnore');
  collector.require(ignored('tests/worldwide/fixtures/jurisdiction-cases.json'), 'config_rejected', 'playwright must ignore fixture files', 'testIgnore');
  collector.require(!ignored('tests/wetwijzer-ui.spec.ts'), 'config_rejected', 'playwright must keep existing browser specs', 'testIgnore');
  collector.require(!ignored('tests/worldwide/location.spec.ts'), 'config_rejected', 'playwright must run worldwide browser specs', 'testIgnore');
  collector.throwIfAny();
  return { ok: true };
}

export function validateTsconfig(tsconfig) {
  const collector = new Collector();
  collector.require(isObject(tsconfig) && isObject(tsconfig.compilerOptions) && tsconfig.compilerOptions.strict === true, 'config_rejected', 'tsconfig strict must stay on', 'compilerOptions.strict');
  const includes = Array.isArray(tsconfig && tsconfig.include) ? tsconfig.include : [];
  const excludes = Array.isArray(tsconfig && tsconfig.exclude) ? tsconfig.exclude : [];
  const included = (file) => includes.some((pattern) => globMatch(file, pattern));
  const excluded = (file) => excludes.some((pattern) => globMatch(file, pattern));
  collector.require(included('tests/worldwide/example.test.ts'), 'config_rejected', 'tsconfig does not include worldwide tests', 'include');
  collector.require(included('tests/worldwide/example.test.tsx'), 'config_rejected', 'tsconfig does not include worldwide tsx tests', 'include');
  collector.require(included('src/lib/netherlandsLogic.ts'), 'config_rejected', 'tsconfig no longer includes the application sources', 'include');
  collector.require(!excluded('tests/worldwide/example.test.ts'), 'config_rejected', 'tsconfig excludes worldwide tests', 'exclude');
  collector.throwIfAny();
  return { ok: true };
}

function assertRepoPath(value, collector, label) {
  if (typeof value !== 'string' || value.length === 0 || value.startsWith('/') || value.split(/[\\/]/).includes('..')) {
    collector.add('unsafe_path', 'unsafe repository path ' + value, label);
  }
}

export function validatePlanCommands(plan, options) {
  const collector = new Collector();
  const modes = new Set(options.modes || AUDIT_MODES);
  const scripts = options.scripts || {};
  const exists = options.exists || (() => false);
  collector.require(isObject(plan) && plan.schema === 'worldwide-legal-search.plan@1', 'invalid_schema', 'plan schema is not the worldwide campaign plan', 'plan.schema');
  collector.require(plan && plan.source_expansion && plan.source_expansion.id_pattern === 'WWL-SRC-[0-9a-f]{16}-(normalize|index|geo|publish|verify)-[0-9]{4}', 'command_mismatch', 'source-job id pattern drifted', 'source_expansion.id_pattern');
  const phases = (((plan || {}).source_expansion || {}).phases || []).map((item) => item.phase);
  collector.require(JSON.stringify(phases) === JSON.stringify(SOURCE_PHASES), 'phase_mismatch', 'source phases drifted', 'source_expansion.phases');
  const seen = new Set();
  const commands = [];
  for (const task of (plan && plan.tasks) || []) commands.push({ id: task.id, argv: task.validation_argv, outputs: new Set(task.outputs || []) });
  const template = plan && plan.source_expansion && plan.source_expansion.task_template;
  if (template) commands.push({ id: 'source-expansion', argv: template.validation_argv, outputs: new Set() });
  for (const command of commands) {
    collector.require(Array.isArray(command.argv) && command.argv.length > 0, 'command_mismatch', command.id + ' has no validation command', command.id);
    for (const argv of command.argv || []) {
      collector.require(Array.isArray(argv) && argv.length > 0 && argv.every((part) => typeof part === 'string' && part.length > 0), 'command_mismatch', command.id + ' validation argv must be a string array', command.id);
      if (!Array.isArray(argv) || argv.length === 0) continue;
      collector.require(['node', 'npm', 'python3'].includes(argv[0]), 'command_mismatch', command.id + ' uses an unsupported executable', command.id);
      if (argv[0] === 'node') {
        collector.require(argv[1] === 'scripts/worldwide/audit.mjs', 'command_mismatch', command.id + ' does not call scripts/worldwide/audit.mjs', command.id);
        collector.require(modes.has(argv[2]), 'unknown_mode', command.id + ' audit mode is not implemented: ' + argv[2], command.id);
        seen.add(argv[2]);
        if (argv[2] === 'source-job') collector.require(argv.includes('--job-id') && argv.includes('--phase'), 'missing_field', 'source-job command needs --job-id and --phase', command.id);
      }
      if (argv[0] === 'npm' && argv[1] === 'test') {
        collector.require(typeof scripts.test === 'string' && scripts.test.includes('jest'), 'command_mismatch', 'npm test script is not jest', 'scripts.test');
        collector.require(argv.includes('--runInBand') && argv.includes('--runTestsByPath'), 'command_mismatch', command.id + ' npm test must be bounded to one path', command.id);
        const testPath = argv.find((part) => part.startsWith('tests/') || part.startsWith('src/'));
        collector.require(testPath && command.outputs.has(testPath), 'command_mismatch', command.id + ' test path is not a declared output', command.id);
      } else if (argv[0] === 'npm' && argv[1] === 'run') {
        collector.require(argv[2] === 'test:playwright', 'command_mismatch', command.id + ' npm run command is not test:playwright', command.id);
        collector.require(typeof scripts['test:playwright'] === 'string' && /playwright\s+test/.test(scripts['test:playwright']), 'command_mismatch', 'test:playwright script is missing', 'scripts.test:playwright');
        for (const spec of argv.filter((part) => part.endsWith('.spec.ts'))) {
          collector.require(command.outputs.has(spec), 'command_mismatch', command.id + ' spec is not a declared output', spec);
        }
      } else if (argv[0] === 'npm') {
        collector.add('command_mismatch', command.id + ' npm command is not a board test command', command.id);
      }
      if (argv[0] === 'python3') {
        if (argv[1] === '-m') collector.require(argv[2] === 'pytest' || argv[2] === 'unittest', 'command_mismatch', command.id + ' python module is not a test runner', command.id);
        else {
          assertRepoPath(argv[1], collector, command.id);
          collector.require(exists(argv[1]), 'missing_evidence', command.id + ' python script is missing: ' + argv[1], argv[1]);
        }
      }
    }
  }
  for (const mode of modes) {
    if (!seen.has(mode)) collector.add('command_mismatch', 'implemented audit mode is not used by the board: ' + mode, mode);
  }
  collector.throwIfAny();
  return { ok: true, modes: seen.size };
}

export function validateWorktree(info) {
  const collector = new Collector();
  collector.require(info && info.inside === true, 'worktree_rejected', 'directory is not a git worktree', 'git');
  collector.require(info && /^[0-9a-f]{40}$/.test(info.head || ''), 'worktree_rejected', 'HEAD is not a commit', 'git.head');
  collector.require(info && /^(?:agent\/worldwide-legal-search-v1|implementation\/wwl-\d{3}-[0-9a-f]+-attempt-\d+-\d+)$/.test(info.branch || ''), 'worktree_rejected', 'branch is not a worldwide campaign branch', 'git.branch');
  collector.require(info && info.listed === true, 'worktree_rejected', 'checkout is not registered in git worktree list', 'git.worktree');
  if (info && typeof info.branch === 'string' && info.branch.startsWith('implementation/wwl-')) {
    collector.require(info.linked === true, 'worktree_rejected', 'implementation branch must be a linked campaign worktree', 'git.linked');
  }
  collector.throwIfAny();
  return { ok: true, branch: info.branch, head: info.head, linked: info.linked };
}

export function validateWorkspace(snapshot) {
  const errors = [];
  const steps = [
    () => validatePackageScripts(snapshot.packageJson),
    () => validateLockfile(snapshot.packageJson, snapshot.packageLock),
    () => validateJestConfig(snapshot.jestConfig),
    () => validatePlaywrightConfig(snapshot.playwrightConfig, snapshot.playwrightSource),
    () => validateTsconfig(snapshot.tsconfig),
    () => validatePlanCommands(snapshot.plan, { modes: AUDIT_MODES, scripts: snapshot.packageJson.scripts, exists: snapshot.exists }),
    () => validateReadme(snapshot.readme, AUDIT_MODES),
    () => validateWorktree(snapshot.worktree),
  ];
  for (const step of steps) {
    try {
      step();
    } catch (error) {
      if (error instanceof ContractError) errors.push(...error.errors);
      else throw error;
    }
  }
  if (errors.length) throw new ContractError(errors);
  return { ok: true };
}

export function runSelfTest() {
  const acceptCases = [];
  const rejectCases = [];
  for (const mode of AUDIT_MODES) {
    if (mode === 'harness') {
      rejectCases.push(['harness-document', () => validateAuditDocument('harness', { ok: true }), 'unknown_mode']);
      continue;
    }
    acceptCases.push([mode, () => validateAuditDocument(mode, validSample(mode))]);
    rejectCases.push(['existence:' + mode, () => validateAuditDocument(mode, { exists: true, path: mode + '.json' }), 'existence_only']);
  }
  acceptCases.push(['fixture', () => validateFixture(canonicalFixture())]);
  acceptCases.push(['partial-inventory', () => validateAuditDocument('source-inventory', inventoryDocument('partial'))]);
  acceptCases.push(['blocked-deployment', () => validateAuditDocument('deployment', deploymentSample('blocked'))]);
  acceptCases.push(['index-job', () => validateAuditDocument('source-job', sourceJobSample('index'))]);
  acceptCases.push(['geo-job', () => validateAuditDocument('source-job', sourceJobSample('geo'))]);
  acceptCases.push(['publish-job', () => validateAuditDocument('source-job', sourceJobSample('publish'))]);
  acceptCases.push(['verify-job', () => validateAuditDocument('source-job', sourceJobSample('verify'))]);
  const adversarial = canonicalFixture();
  adversarial.fixture_id = 'synthetic-adversarial-input';
  adversarial.kind = 'adversarial';
  adversarial.adversarial = true;
  adversarial.purpose = 'Synthetic adversarial input that production checks must reject.';
  adversarial.source = { ...adversarial.source, citation: 'synthetic-adversarial', url: null, fabricated_legal_conclusion: true };
  adversarial.inputs = { payload: '<script>alert(1)</script>' };
  adversarial.expected = { rejected: true, code: 'unsafe_path' };
  acceptCases.push(['adversarial-fixture', () => validateFixture(adversarial)]);

  const existenceExpected = canonicalFixture();
  existenceExpected.expected = { file_exists: true };
  const traversal = canonicalFixture();
  traversal.inputs = { ...traversal.inputs, path: '../secrets.env' };
  const fabricated = canonicalFixture();
  fabricated.source = { ...fabricated.source, fabricated_legal_conclusion: true };
  const holding = canonicalFixture();
  holding.expected = { ...holding.expected, legal_conclusion: 'The defendant is liable.' };
  rejectCases.push(['fixture-existence', () => validateFixture({ schema: FIXTURE_SCHEMA, exists: true, path: 'tests/worldwide/fixtures/example.json' }), 'existence_only']);
  rejectCases.push(['fixture-expected-exists', () => validateFixture(existenceExpected), 'existence_only']);
  rejectCases.push(['fixture-traversal', () => validateFixture(traversal), 'unsafe_path']);
  rejectCases.push(['fixture-fabricated', () => validateFixture(fabricated), 'fabricated_conclusion']);
  rejectCases.push(['fixture-holding', () => validateFixture(holding), 'fabricated_conclusion']);
  const inferred = rightsSample();
  inferred.records[0].inferred_from_organization = true;
  rejectCases.push(['rights-inferred', () => validateAuditDocument('rights', inferred), 'inferred_rights']);
  const unresolved = rightsSample();
  unresolved.records[1].blocker = null;
  rejectCases.push(['rights-unblocked', () => validateAuditDocument('rights', unresolved), 'missing_blocker']);
  const incomplete = inventoryDocument('complete');
  incomplete.organizations[0].pagination.exhausted = false;
  rejectCases.push(['inventory-open', () => validateAuditDocument('source-inventory', incomplete), 'pagination_incomplete']);
  const noReason = inventoryDocument('partial');
  noReason.partial_reasons = [];
  rejectCases.push(['inventory-no-reason', () => validateAuditDocument('source-inventory', noReason), 'empty_reason']);
  const codeOnly = dispositionSample();
  codeOnly.dispositions[5].decision = 'include';
  codeOnly.dispositions[5].schema_capabilities = ['text'];
  rejectCases.push(['code-only-text', () => validateAuditDocument('source-dispositions', codeOnly), 'invalid_field']);
  const world = geographySample();
  world.complete_world = true;
  rejectCases.push(['geography-complete', () => validateAuditDocument('geography', world), 'legal_completeness']);
  const missingClass = jurisdictionBundle();
  missingClass.cases = missingClass.cases.filter((item) => item.inputs.coverage_class !== 'rtl-or-non-latin');
  rejectCases.push(['jurisdiction-rtl', () => validateAuditDocument('jurisdiction-fixtures', missingClass), 'coverage_class_missing']);
  const overlap = retrievalSample();
  overlap.judgments[0].excluded_jurisdiction_ids = ['nl:bwbr0001854:1'];
  overlap.judgments[0].relevant_ids = ['nl:bwbr0001854:1'];
  rejectCases.push(['retrieval-overlap', () => validateAuditDocument('retrieval-evaluation', overlap), 'invalid_field']);
  const loose = performanceSample({}, { warm_p95_ms: PLAN_PERFORMANCE_TARGETS.warm_p95_ms + 1 });
  rejectCases.push(['performance-loose', () => validateAuditDocument('performance', loose), 'weakened_target']);
  const missed = performanceSample({ warm_p95_ms: PLAN_PERFORMANCE_TARGETS.warm_p95_ms + 50 });
  rejectCases.push(['performance-miss', () => validateAuditDocument('performance', missed), 'budget_miss']);
  const mapped = validSample('ux-contract');
  mapped.states.mandatory_map = true;
  rejectCases.push(['ux-map', () => validateAuditDocument('ux-contract', mapped), 'invalid_field']);
  const continued = validSample('ci-contract');
  continued.workflow += '\ncontinue-on-error: true\n';
  rejectCases.push(['ci-continue', () => validateAuditDocument('ci-contract', continued), 'continue_on_error']);
  rejectCases.push(['actor-self', () => validateAuditDocument('product-acceptance', productSample('self')), 'actor_not_independent']);
  const secretSource = maintenanceSample();
  secretSource.source += '\nconst api_key = "PUBLIC_NON_CREDENTIAL_TEST_CANARY";\n';
  rejectCases.push(['maintenance-secret', () => validateAuditDocument('maintenance', secretSource), 'secret_material']);
  rejectCases.push(['release-continue', () => validateAuditDocument('release-candidate', releaseSample('\ncontinue-on-error: true\n')), 'continue_on_error']);
  rejectCases.push(['deployment-empty', () => validateAuditDocument('deployment', { schema: 'worldwide-legal-search.deployment@1', status: 'done' }), 'invalid_field']);
  const sameDigest = smokeSample();
  sameDigest.prior_release_digest = sameDigest.artifact_digest;
  rejectCases.push(['smoke-same-digest', () => validateAuditDocument('public-smoke', sameDigest), 'integrity']);
  const claimed = campaignClosureSample();
  claimed.closure.completion_verified = true;
  rejectCases.push(['closure-claimed', () => validateAuditDocument('campaign-closure', claimed), 'completion_claimed']);
  const needsReceipt = campaignClosureSample();
  needsReceipt.closure.requires_own_receipt = true;
  rejectCases.push(['closure-receipt', () => validateAuditDocument('campaign-closure', needsReceipt), 'receipt_required']);
  const badJob = sourceJobSample('normalize');
  badJob.job_id = badJob.job_id.replace(/WWL-SRC-[0-9a-f]{16}/, 'WWL-SRC-' + 'f'.repeat(16));
  rejectCases.push(['job-hash', () => validateAuditDocument('source-job', badJob), 'integrity']);
  rejectCases.push(['job-phase', () => validateAuditDocument('source-job', sourceJobSample('normalize'), { phase: 'index' }), 'phase_mismatch']);
  const weakSchema = { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', additionalProperties: true };
  rejectCases.push(['catalog-weak', () => validateAuditDocument('catalog', weakSchema), 'missing_field']);
  const globCases = [
    ['tests/worldwide/netherlands-compat.test.ts', 'tests/worldwide/**/*.test.ts', true],
    ['tests/worldwide/location.spec.ts', 'tests/worldwide/**/*.test.ts', false],
    ['src/__tests__/basic.test.ts', 'src/**/__tests__/**/*.ts', true],
    ['src/lib/netherlandsLogic.test.ts', 'src/**/*.test.ts', true],
    ['tests/worldwide/fixtures/a.json', '**/fixtures/**', true],
    ['tests/wetwijzer-ui.spec.ts', '**/*.test.ts', false],
    ['tests/worldwide/place-picker.test.tsx', 'tests/worldwide/**/*.test.{ts,tsx}', true],
    ['src/lib/logic/parity/parity.test.ts', 'src/**/*.{test,spec}.{ts,tsx}', true],
  ];
  for (const [file, pattern, expected] of globCases) {
    acceptCases.push(['glob:' + file, () => {
      if (globMatch(file, pattern) !== expected) throw new ContractError([problem('config_rejected', 'glob mismatch for ' + pattern, file)]);
    }]);
  }

  const failures = [];
  let accepted = 0;
  let rejected = 0;
  for (const [name, fn] of acceptCases) {
    try {
      fn();
      accepted += 1;
    } catch (error) {
      failures.push(problem('self_test', name + ' should accept: ' + error.message, name));
    }
  }
  for (const [name, fn, code] of rejectCases) {
    try {
      fn();
      failures.push(problem('self_test', name + ' should reject ' + code, name));
    } catch (error) {
      const codes = error instanceof ContractError ? error.errors.map((entry) => entry.code) : [];
      if (!codes.includes(code)) failures.push(problem('self_test', name + ' rejected ' + codes.join(',') + ' instead of ' + code, name));
      else rejected += 1;
    }
  }
  if (accepted !== acceptCases.length || rejected !== rejectCases.length || failures.length) {
    throw new ContractError(failures.length ? failures : [problem('self_test', 'self-test counts did not match', 'self-test')]);
  }
  return { ok: true, schema: 'worldwide-legal-search.contract-self-test@1', accepted, rejected };
}

function parseJsonText(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new ContractError([problem('invalid_json', error.message, label)]);
  }
}

function main(argv) {
  const args = argv.slice(2);
  if (args.length === 0 || (args.length === 1 && args[0] === '--self-test')) return runSelfTest();
  if (args[0] === '--fixture' && args[1]) return validateFixture(parseJsonText(fs.readFileSync(args[1], 'utf8'), args[1]), args[1]);
  if (args[0] === '--fixture-stdin') return validateFixture(parseJsonText(fs.readFileSync(0, 'utf8'), 'stdin'), 'stdin');
  if (args[0] === '--document' && args[1]) return validateAuditDocument(args[1], parseJsonText(fs.readFileSync(0, 'utf8'), 'stdin'), {});
  throw new ContractError([problem('unknown_mode', 'unsupported check-contracts arguments', 'argv')]);
}

const calledDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (calledDirectly) {
  try {
    process.stdout.write(JSON.stringify(main(process.argv), null, 2) + '\n');
  } catch (error) {
    process.stderr.write(JSON.stringify({ ok: false, error_class: error.name || 'Error', error: error.message, errors: error.errors || [] }, null, 2) + '\n');
    process.exit(1);
  }
}

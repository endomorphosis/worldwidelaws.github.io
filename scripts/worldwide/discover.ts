#!/usr/bin/env node
/**
 * Enumerate the public Hugging Face datasets of justicedao and endomorphosis.
 * Pagination follows Link rel="next" until it is exhausted. A complete inventory
 * is that exhausted listing with every returned candidate recorded. A partial
 * probe stops early or hits an organization-level access error and must say why.
 * Each candidate is pinned to the commit from its listing page. File rows are
 * path, size, and sha256. Large sibling trees keep a count and an omission reason.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const SOURCE_ORGANIZATIONS: readonly string[] = ['justicedao', 'endomorphosis'];
export const INVENTORY_SCHEMA = 'worldwide-legal-search.source-inventory@1';
export const DEFAULT_PAGE_LIMIT = 100;
export const COMPLETE_FILE_SIBLING_LIMIT = 24;
export const PIN_VERSION = 1;
export const LISTING_VERSION = 1;

const HUB = 'https://huggingface.co';
const VIEWER = 'https://datasets-server.huggingface.co';
const USER_AGENT = 'worldwide-legal-search-discover/WWL-010';
const MAX_PAGES = 1000;
const MAX_ATTEMPTS = 6;
const REQUEST_TIMEOUT_MS = 120000;
const ANCHOR_PATHS = ['README.md', '.gitattributes'];
const SMALL_FILE_BYTES = 1024 * 1024;
const CARD_BYTES = 5 * 1024 * 1024;
const EVIDENCE_BYTE_BUDGET = 1048576;
const ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));

type AccessError = { class: string; message: string; retryable: boolean };
type InventoryFile = { path: string; size_bytes: number; sha256: string };
type InventoryConfig = { name: string; splits: string[] };
type CardRecord = { fetched: boolean; sha256: string | null; source: string | null };
type SizeRecord = { num_bytes_original_files: number; num_bytes_parquet_files: number; num_rows: number | null };
type FileRecord = {
  sibling_count: number | null;
  complete: boolean;
  omitted: number | null;
  extensions?: Record<string, number>;
  reason?: string;
};
type ListedDataset = {
  dataset_id: string;
  resolved_revision: string | null;
  gated: boolean;
  gate: string;
  private: boolean;
  disabled: boolean;
};
type ListingCheckpoint = {
  listing_version: number;
  organization: string;
  limit: number;
  pages: number;
  exhausted: boolean;
  next_url: string | null;
  datasets: ListedDataset[];
};
type PinRecord = {
  pin_version: number;
  dataset_id: string;
  resolved_revision: string | null;
  card: CardRecord;
  files: InventoryFile[];
  configs: InventoryConfig[];
  configs_source: string | null;
  access_error: AccessError | null;
  gated: boolean;
  private: boolean;
  disabled: boolean;
  sibling_count: number | null;
  sibling_paths: string[] | null;
  extensions: Record<string, number> | null;
  sizes: SizeRecord | null;
  full_files: InventoryFile[] | null;
};
type OrganizationInventory = {
  id: string;
  pagination: { followed: true; pages: number; exhausted: boolean; limit: number; continuation: string };
  dataset_count: number;
  listing_sha256: string;
  revision_set_sha256: string;
  datasets: Record<string, unknown>[];
  access_error: AccessError | null;
};

type Args = {
  output: string;
  checkpoint: string;
  maxPages: number | null;
  fileLimit: number;
  concurrency: number;
  assembleOnly: boolean;
};

class Gate {
  active = 0;
  waiters: Array<() => void> = [];
  limit: number;

  constructor(limit: number) {
    this.limit = limit;
  }

  async enter(): Promise<void> {
    if (this.active < this.limit) {
      this.active += 1;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.active += 1;
  }

  leave(): void {
    this.active -= 1;
    const next = this.waiters.shift();
    if (next) next();
  }
}

const gates = new Map<string, Gate>();
const pausedUntil = new Map<string, number>();

function gateFor(host: string): Gate {
  const limit = host === 'datasets-server.huggingface.co' ? 6 : 4;
  let gate = gates.get(host);
  if (!gate) {
    gate = new Gate(limit);
    gates.set(host, gate);
  }
  return gate;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sha256Bytes(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function isRevision(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{7,64}$/.test(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
}

function cleanMessage(value: string): string {
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > 0 ? text.slice(0, 500) : 'discovery request failed';
}

function accessError(kind: string, message: string, retryable: boolean): AccessError {
  return { class: kind, message: cleanMessage(message), retryable };
}

export function nextPageUrl(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(',')) {
    const match = /<([^>]+)>\s*;\s*rel="?([^";]+)"?/i.exec(part.trim());
    if (match && match[2].toLowerCase() === 'next') return match[1];
  }
  return null;
}

function canonicalJson(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return '[' + value.map((item) => canonicalJson(item)).join(',') + ']';
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).filter((key) => record[key] !== undefined).sort();
  return '{' + keys.map((key) => JSON.stringify(key) + ':' + canonicalJson(record[key])).join(',') + '}';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function textField(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text.length > 0 ? text : null;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function splitsFromConfig(config: unknown): string[] {
  const record = asRecord(config);
  if (!record) return [];
  const splits: string[] = [];
  const dataFiles = record.data_files;
  const consider = Array.isArray(dataFiles) ? dataFiles : dataFiles ? [dataFiles] : [];
  for (const entry of consider) {
    const row = asRecord(entry);
    const split = textField(row?.split);
    if (split) splits.push(split);
  }
  const declared = record.splits;
  if (Array.isArray(declared)) {
    for (const entry of declared) {
      const split = textField(entry) || textField(asRecord(entry)?.name);
      if (split) splits.push(split);
    }
  }
  return uniqueSorted(splits);
}

function configName(config: unknown): string | null {
  const record = asRecord(config);
  if (!record) return null;
  return textField(record.config_name) || textField(record.name);
}

export function configsFromCard(card: unknown): InventoryConfig[] {
  const record = asRecord(card);
  if (!record) return [];
  const collected = new Map<string, string[]>();
  const add = (name: string | null, splits: string[]) => {
    if (!name || splits.length === 0) return;
    const existing = collected.get(name) || [];
    collected.set(name, uniqueSorted(existing.concat(splits)));
  };
  if (Array.isArray(record.configs)) {
    for (const config of record.configs) add(configName(config), splitsFromConfig(config));
  }
  const info = record.dataset_info;
  const infos = Array.isArray(info) ? info : info ? [info] : [];
  for (const item of infos) add(configName(item) || 'default', splitsFromConfig(item));
  return [...collected.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([name, splits]) => ({ name, splits }));
}

export function configsFromViewer(payload: unknown): InventoryConfig[] {
  const record = asRecord(payload);
  const rows = record && Array.isArray(record.splits) ? record.splits : [];
  const collected = new Map<string, string[]>();
  for (const row of rows) {
    const item = asRecord(row);
    const name = textField(item?.config);
    const split = textField(item?.split);
    if (!name || !split) continue;
    collected.set(name, uniqueSorted((collected.get(name) || []).concat([split])));
  }
  return [...collected.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([name, splits]) => ({ name, splits }));
}

export function viewerPending(payload: unknown): boolean {
  const record = asRecord(payload);
  return Boolean(record && Array.isArray(record.pending) && record.pending.length > 0);
}

function cardConfigsAreExplicit(card: unknown): boolean {
  const record = asRecord(card);
  if (!record || !Array.isArray(record.configs) || record.configs.length === 0) return false;
  return record.configs.every((config) => splitsFromConfig(config).length > 0);
}

function normalizeRevision(value: unknown): string | null {
  const text = textField(value);
  if (!text) return null;
  const lowered = text.toLowerCase();
  return isRevision(lowered) ? lowered : null;
}

function normalizeGate(value: unknown): { gated: boolean; gate: string } {
  if (value === false || value === null || value === undefined) return { gated: false, gate: 'open' };
  if (value === true) return { gated: true, gate: 'gated' };
  if (typeof value === 'string' && value.trim()) return { gated: true, gate: value.trim() };
  return { gated: true, gate: 'unknown' };
}

function safeRepoPath(value: string): boolean {
  if (!value || value.startsWith('/') || value.startsWith('\\') || value.includes('\\') || value.includes('\0')) return false;
  return !value.split('/').includes('..');
}

function extensionOf(filePath: string): string {
  const base = filePath.split('/').pop() || filePath;
  if (base.startsWith('.') && base.indexOf('.', 1) < 0) return base.slice(1).toLowerCase();
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return '(none)';
  const extension = base.slice(dot + 1).toLowerCase();
  return /^[a-z0-9.+-]{1,24}$/.test(extension) ? extension : '(other)';
}

function extensionCounts(paths: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const filePath of paths) {
    const key = extensionOf(filePath);
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function quoteDataset(datasetId: string): string {
  const slash = datasetId.indexOf('/');
  return encodeURIComponent(datasetId.slice(0, slash)) + '/' + encodeURIComponent(datasetId.slice(slash + 1));
}

function quoteRepoPath(filePath: string): string {
  return filePath.split('/').map((part) => encodeURIComponent(part)).join('/');
}

function datasetIdAllowed(datasetId: string, organization: string): boolean {
  return datasetId.startsWith(organization + '/') && /^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(datasetId);
}

export function classifyInventory(organizations: Array<{ id: string; pagination: { exhausted: boolean }; access_error: AccessError | null }>, blockingIssues: string[]): { inventory_status: 'complete' | 'partial'; partial_reasons: string[] } {
  const partialReasons: string[] = [];
  for (const organization of organizations) {
    if (!organization.pagination.exhausted) partialReasons.push(organization.id + ' pagination was not exhausted');
    if (organization.access_error) partialReasons.push(organization.id + ' listing failed: ' + organization.access_error.message);
  }
  for (const issue of blockingIssues) partialReasons.push(issue);
  if (partialReasons.length > 0) return { inventory_status: 'partial', partial_reasons: partialReasons };
  return { inventory_status: 'complete', partial_reasons: [] };
}

function retryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function retryDelayMs(headers: Headers, attempt: number): number {
  const retryAfter = headers.get('retry-after');
  if (retryAfter && /^\d+$/.test(retryAfter)) return (Number(retryAfter) + 1) * 1000;
  return Math.min(30000, 1000 * 2 ** attempt);
}

function noteRateLimit(host: string, headers: Headers): void {
  const raw = headers.get('ratelimit') || headers.get('RateLimit') || '';
  for (const match of raw.matchAll(/r=(\d+)\s*;\s*t=(\d+)/g)) {
    const remaining = Number(match[1]);
    const resetSeconds = Number(match[2]);
    if (remaining <= 1) pausedUntil.set(host, Math.max(pausedUntil.get(host) || 0, Date.now() + (resetSeconds + 1) * 1000));
  }
}

async function pauseIfNeeded(host: string): Promise<void> {
  const until = pausedUntil.get(host) || 0;
  const delay = until - Date.now();
  if (delay > 0) {
    process.stderr.write('rate limit ' + host + ' pausing ' + Math.ceil(delay / 1000) + 's\n');
    await sleep(delay);
  }
}

type HttpResult = { status: number; headers: Headers; body: Buffer };

async function request(url: string, init: RequestInit, attempt = 0): Promise<HttpResult> {
  const host = new URL(url).host;
  await pauseIfNeeded(host);
  const gate = gateFor(host);
  await gate.enter();
  let waitMs: number | null = null;
  try {
    const headers = new Headers(init.headers);
    headers.set('User-Agent', USER_AGENT);
    headers.set('Accept', headers.get('Accept') || 'application/json');
    const response = await fetch(url, { ...init, headers, redirect: 'follow', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    const body = Buffer.from(await response.arrayBuffer());
    noteRateLimit(host, response.headers);
    if (retryableStatus(response.status) && attempt < MAX_ATTEMPTS - 1) waitMs = retryDelayMs(response.headers, attempt);
    else return { status: response.status, headers: response.headers, body };
  } catch (error) {
    if (attempt >= MAX_ATTEMPTS - 1) throw error;
    waitMs = Math.min(30000, 1000 * 2 ** attempt);
  } finally {
    gate.leave();
  }
  await sleep(waitMs || 0);
  return request(url, init, attempt + 1);
}

async function requestJson(url: string, init: RequestInit = {}): Promise<{ status: number; headers: Headers; value: unknown }> {
  const result = await request(url, init);
  let value: unknown = null;
  if (result.body.length > 0) {
    try {
      value = JSON.parse(result.body.toString('utf8'));
    } catch {
      value = null;
    }
  }
  return { status: result.status, headers: result.headers, value };
}

function firstPageUrl(organization: string, limit: number): string {
  const url = new URL(HUB + '/api/datasets');
  url.searchParams.set('author', organization);
  url.searchParams.set('limit', String(limit));
  return url.toString();
}

function listedFromRow(organization: string, row: unknown): ListedDataset | null {
  const record = asRecord(row);
  const datasetId = textField(record?.id);
  if (!datasetId || !datasetIdAllowed(datasetId, organization)) return null;
  const gate = normalizeGate(record?.gated);
  return {
    dataset_id: datasetId,
    resolved_revision: normalizeRevision(record?.sha),
    gated: gate.gated,
    gate: gate.gate,
    private: record?.private === true,
    disabled: record?.disabled === true,
  };
}

async function readJsonFile(file: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = file + '.tmp-' + process.pid + '-' + Math.random().toString(16).slice(2);
  await writeFile(temporary, JSON.stringify(value));
  await rename(temporary, file);
}

function listingPath(checkpoint: string, organization: string): string {
  return path.join(checkpoint, 'listing-' + organization + '.json');
}

function pinPath(checkpoint: string, datasetId: string): string {
  return path.join(checkpoint, 'pins', datasetId.replace('/', '__') + '.json');
}

function listingUsable(value: unknown, organization: string): ListingCheckpoint | null {
  const record = asRecord(value);
  if (!record || record.listing_version !== LISTING_VERSION || record.organization !== organization) return null;
  if (typeof record.exhausted !== 'boolean' || !isInteger(record.pages) || record.pages < 1) return null;
  if (!Array.isArray(record.datasets)) return null;
  const datasets: ListedDataset[] = [];
  for (const row of record.datasets) {
    const item = asRecord(row);
    const datasetId = textField(item?.dataset_id);
    if (!datasetId || !datasetIdAllowed(datasetId, organization)) return null;
    datasets.push({
      dataset_id: datasetId,
      resolved_revision: normalizeRevision(item?.resolved_revision),
      gated: item?.gated === true,
      gate: textField(item?.gate) || (item?.gated === true ? 'gated' : 'open'),
      private: item?.private === true,
      disabled: item?.disabled === true,
    });
  }
  return {
    listing_version: LISTING_VERSION,
    organization,
    limit: isInteger(record.limit) ? record.limit : DEFAULT_PAGE_LIMIT,
    pages: record.pages,
    exhausted: record.exhausted,
    next_url: textField(record.next_url),
    datasets,
  };
}

async function paginateOrganization(organization: string, args: Args): Promise<{ listing: ListingCheckpoint; access_error: AccessError | null; blocking: string[] }> {
  const file = listingPath(args.checkpoint, organization);
  const saved = listingUsable(await readJsonFile(file), organization);
  const blocking: string[] = [];
  let pages = saved ? saved.pages : 0;
  let url = saved && !saved.exhausted && saved.next_url ? saved.next_url : saved && saved.exhausted ? null : firstPageUrl(organization, DEFAULT_PAGE_LIMIT);
  const datasets = new Map<string, ListedDataset>();
  if (saved) for (const row of saved.datasets) datasets.set(row.dataset_id, row);
  if (saved && saved.exhausted) {
    process.stderr.write(organization + ' reused listing checkpoint pages=' + saved.pages + ' datasets=' + saved.datasets.length + '\n');
    return { listing: saved, access_error: null, blocking };
  }
  const seenUrls = new Set<string>();
  let access: AccessError | null = null;
  while (url) {
    if (args.maxPages !== null && pages >= args.maxPages) break;
    if (seenUrls.has(url) || pages >= MAX_PAGES) {
      blocking.push(organization + ' pagination cursor repeated before the listing ended');
      break;
    }
    seenUrls.add(url);
    let result: { status: number; headers: Headers; value: unknown };
    try {
      result = await requestJson(url);
    } catch (error) {
      access = accessError('network', organization + ' listing request failed: ' + (error instanceof Error ? error.message : 'unknown error'), true);
      break;
    }
    if (result.status !== 200 || !Array.isArray(result.value)) {
      access = accessError('http', organization + ' listing returned HTTP ' + result.status, retryableStatus(result.status));
      break;
    }
    pages += 1;
    let added = 0;
    for (const row of result.value) {
      const listed = listedFromRow(organization, row);
      if (!listed) {
        const record = asRecord(row);
        const rawId = textField(record?.id);
        if (rawId && !datasets.has(rawId)) blocking.push(organization + ' returned a dataset id that cannot be recorded: ' + rawId.slice(0, 120));
        continue;
      }
      if (!datasets.has(listed.dataset_id)) {
        datasets.set(listed.dataset_id, listed);
        added += 1;
      }
    }
    const next = nextPageUrl(result.headers.get('link') || result.headers.get('Link'));
    const listing: ListingCheckpoint = {
      listing_version: LISTING_VERSION,
      organization,
      limit: DEFAULT_PAGE_LIMIT,
      pages,
      exhausted: !next,
      next_url: next,
      datasets: [...datasets.values()],
    };
    await writeJsonAtomic(file, listing);
    process.stderr.write(organization + ' page ' + pages + ' rows=' + result.value.length + ' new=' + added + ' next=' + Boolean(next) + '\n');
    url = next;
  }
  const capped = args.maxPages !== null && url !== null && pages >= args.maxPages;
  const listing: ListingCheckpoint = {
    listing_version: LISTING_VERSION,
    organization,
    limit: DEFAULT_PAGE_LIMIT,
    pages: Math.max(pages, saved?.pages || 0),
    exhausted: access === null && url === null && !capped,
    next_url: url,
    datasets: [...datasets.values()],
  };
  if (pages < 1) {
    listing.pages = 1;
    listing.exhausted = false;
    if (!access) access = accessError('http', organization + ' listing produced no page', true);
  }
  await writeJsonAtomic(file, listing);
  return { listing, access_error: access, blocking };
}

function emptyCard(): CardRecord {
  return { fetched: false, sha256: null, source: null };
}

function pinShell(listed: ListedDataset): PinRecord {
  return {
    pin_version: PIN_VERSION,
    dataset_id: listed.dataset_id,
    resolved_revision: listed.resolved_revision,
    card: emptyCard(),
    files: [],
    configs: [],
    configs_source: null,
    access_error: null,
    gated: listed.gated,
    private: listed.private,
    disabled: listed.disabled,
    sibling_count: null,
    sibling_paths: null,
    extensions: null,
    sizes: null,
    full_files: null,
  };
}

function usablePin(value: unknown, listed: ListedDataset): PinRecord | null {
  const record = asRecord(value);
  if (!record || record.pin_version !== PIN_VERSION || record.dataset_id !== listed.dataset_id) return null;
  if (normalizeRevision(record.resolved_revision) !== listed.resolved_revision) return null;
  const card = asRecord(record.card);
  const files = Array.isArray(record.files) ? record.files.flatMap((item) => validFile(item)) : [];
  const fullFiles = Array.isArray(record.full_files) ? record.full_files.flatMap((item) => validFile(item)) : null;
  const configs = Array.isArray(record.configs) ? record.configs.flatMap((item) => validConfig(item)) : [];
  const access = asRecord(record.access_error);
  return {
    pin_version: PIN_VERSION,
    dataset_id: listed.dataset_id,
    resolved_revision: listed.resolved_revision,
    card: {
      fetched: card?.fetched === true && isSha256(card.sha256),
      sha256: isSha256(card?.sha256) ? card.sha256 : null,
      source: textField(card?.source),
    },
    files,
    configs,
    configs_source: textField(record.configs_source),
    access_error: access && textField(access.class) && textField(access.message)
      ? accessError(String(access.class), String(access.message), access.retryable === true)
      : null,
    gated: record.gated === true,
    private: record.private === true,
    disabled: record.disabled === true,
    sibling_count: isInteger(record.sibling_count) ? record.sibling_count : null,
    sibling_paths: Array.isArray(record.sibling_paths) ? record.sibling_paths.filter((item): item is string => typeof item === 'string' && safeRepoPath(item)) : null,
    extensions: asRecord(record.extensions) ? Object.fromEntries(Object.entries(record.extensions as Record<string, unknown>).filter((entry) => isInteger(entry[1])).map(([key, count]) => [key, count as number])) : null,
    sizes: sizeRecord(record.sizes),
    full_files: fullFiles,
  };
}

function validFile(value: unknown): InventoryFile[] {
  const record = asRecord(value);
  const filePath = textField(record?.path);
  if (!filePath || !safeRepoPath(filePath) || !isInteger(record?.size_bytes) || !isSha256(record?.sha256)) return [];
  return [{ path: filePath, size_bytes: record.size_bytes, sha256: record.sha256 }];
}

function validConfig(value: unknown): InventoryConfig[] {
  const record = asRecord(value);
  const name = textField(record?.name);
  const splits = Array.isArray(record?.splits) ? record.splits.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
  if (!name || splits.length === 0) return [];
  return [{ name, splits: uniqueSorted(splits) }];
}

function sizeRecord(value: unknown): SizeRecord | null {
  const record = asRecord(value);
  if (!record || !isInteger(record.num_bytes_original_files) || !isInteger(record.num_bytes_parquet_files)) return null;
  return {
    num_bytes_original_files: record.num_bytes_original_files,
    num_bytes_parquet_files: record.num_bytes_parquet_files,
    num_rows: isInteger(record.num_rows) ? record.num_rows : null,
  };
}

function sizesFromViewer(payload: unknown): SizeRecord | null {
  const size = asRecord(asRecord(payload)?.size);
  const dataset = asRecord(size?.dataset);
  if (!dataset || !isInteger(dataset.num_bytes_original_files) || !isInteger(dataset.num_bytes_parquet_files)) return null;
  return {
    num_bytes_original_files: dataset.num_bytes_original_files,
    num_bytes_parquet_files: dataset.num_bytes_parquet_files,
    num_rows: isInteger(dataset.num_rows) ? dataset.num_rows : null,
  };
}

function dedupeFiles(files: InventoryFile[]): InventoryFile[] {
  const byPath = new Map<string, InventoryFile>();
  for (const file of files) byPath.set(file.path, file);
  return [...byPath.values()].sort((left, right) => left.path.localeCompare(right.path));
}

async function downloadAtRevision(datasetId: string, revision: string, filePath: string, maxBytes: number): Promise<InventoryFile | null> {
  const url = HUB + '/datasets/' + quoteDataset(datasetId) + '/resolve/' + revision + '/' + quoteRepoPath(filePath);
  const result = await request(url, { headers: { Accept: '*/*' } });
  if (result.status !== 200) return null;
  if (result.body.length > maxBytes) return null;
  return { path: filePath, size_bytes: result.body.length, sha256: sha256Bytes(result.body) };
}

async function fetchPaths(datasetId: string, revision: string, paths: string[]): Promise<Map<string, { size: number | null; sha256: string | null }>> {
  const found = new Map<string, { size: number | null; sha256: string | null }>();
  for (let index = 0; index < paths.length; index += 50) {
    const batch = paths.slice(index, index + 50);
    const url = HUB + '/api/datasets/' + quoteDataset(datasetId) + '/paths-info/' + revision;
    const result = await requestJson(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paths: batch, expand: true }) });
    if (result.status !== 200 || !Array.isArray(result.value)) throw new Error('paths-info HTTP ' + result.status);
    for (const row of result.value) {
      const record = asRecord(row);
      const filePath = textField(record?.path);
      if (!filePath || record?.type !== 'file' || !safeRepoPath(filePath)) continue;
      const lfs = asRecord(record?.lfs);
      const lfsSha = textField(lfs?.oid)?.toLowerCase() || null;
      const size = isInteger(lfs?.size) ? lfs.size : isInteger(record?.size) ? record.size : null;
      found.set(filePath, { size, sha256: isSha256(lfsSha) ? lfsSha : null });
    }
  }
  return found;
}

function finalizePin(pin: PinRecord, listed: ListedDataset): PinRecord {
  const problems: string[] = [];
  if (!isRevision(pin.resolved_revision)) problems.push('resolved revision was not pinned');
  if (!pin.card.fetched || !isSha256(pin.card.sha256)) problems.push('dataset card was not fetched');
  if (pin.files.length === 0) problems.push('no file with size and sha256 was recorded');
  if (pin.configs.length === 0) problems.push('no configs and splits were recorded');
  if (problems.length === 0) {
    if (pin.access_error && pin.access_error.class === 'integrity') return pin;
    pin.access_error = null;
    return pin;
  }
  const kind = pin.private ? 'private' : pin.gated ? 'gated' : pin.disabled ? 'disabled' : 'metadata';
  const detail = problems.join('; ');
  if (!pin.access_error) pin.access_error = accessError(kind, listed.dataset_id + ' ' + detail, false);
  else if (!pin.access_error.message.includes(detail)) pin.access_error = accessError(pin.access_error.class, pin.access_error.message + '; ' + detail, pin.access_error.retryable);
  return pin;
}

async function pinDataset(listed: ListedDataset, args: Args): Promise<PinRecord> {
  const saved = usablePin(await readJsonFile(pinPath(args.checkpoint, listed.dataset_id)), listed);
  if (saved) return saved;
  const pin = pinShell(listed);
  const revision = listed.resolved_revision;
  if (!revision) {
    pin.access_error = accessError('metadata', listed.dataset_id + ' listing row did not include a commit sha', false);
    return finalizePin(pin, listed);
  }
  let info: Record<string, unknown> | null = null;
  try {
    const infoResponse = await requestJson(HUB + '/api/datasets/' + quoteDataset(listed.dataset_id) + '/revision/' + revision);
    if (infoResponse.status === 200) info = asRecord(infoResponse.value);
    else pin.access_error = accessError(statusClass(infoResponse.status, listed), listed.dataset_id + ' revision metadata returned HTTP ' + infoResponse.status, retryableStatus(infoResponse.status));
  } catch (error) {
    pin.access_error = accessError('network', listed.dataset_id + ' revision metadata failed: ' + (error instanceof Error ? error.message : 'unknown error'), true);
  }
  if (info) {
    const infoRevision = normalizeRevision(info.sha);
    if (infoRevision && infoRevision !== revision) {
      pin.access_error = accessError('integrity', listed.dataset_id + ' revision endpoint returned ' + infoRevision + ' instead of the listing pin', false);
      info = null;
    } else {
      const gate = normalizeGate(info.gated);
      pin.gated = gate.gated;
      pin.private = info.private === true;
      pin.disabled = info.disabled === true;
      const siblings = Array.isArray(info.siblings) ? info.siblings : null;
      if (siblings) {
        const paths = siblings.map((row) => textField(asRecord(row)?.rfilename)).filter((item): item is string => Boolean(item && safeRepoPath(item)));
        pin.sibling_count = paths.length;
        pin.extensions = extensionCounts(paths);
        if (paths.length <= args.fileLimit) pin.sibling_paths = paths;
      }
    }
  }
  const anchors: InventoryFile[] = [];
  for (const anchor of ANCHOR_PATHS) {
    try {
      const file = await downloadAtRevision(listed.dataset_id, revision, anchor, anchor === 'README.md' ? CARD_BYTES : SMALL_FILE_BYTES);
      if (file) anchors.push(file);
    } catch (error) {
      if (!pin.access_error) pin.access_error = accessError('network', listed.dataset_id + ' ' + anchor + ' download failed: ' + (error instanceof Error ? error.message : 'unknown error'), true);
    }
  }
  const readme = anchors.find((file) => file.path === 'README.md');
  if (readme) pin.card = { fetched: true, sha256: readme.sha256, source: 'README.md' };
  else if (info && cardObject(info.cardData)) pin.card = { fetched: true, sha256: sha256Bytes(canonicalJson(info.cardData)), source: 'cardData' };
  const card = info ? info.cardData : null;
  if (card && cardConfigsAreExplicit(card)) {
    pin.configs = configsFromCard(card);
    pin.configs_source = 'dataset-card';
  } else {
    try {
      const viewerUrl = new URL(VIEWER + '/splits');
      viewerUrl.searchParams.set('dataset', listed.dataset_id);
      viewerUrl.searchParams.set('revision', revision);
      const viewer = await requestJson(viewerUrl.toString());
      if (viewer.status === 200) {
        pin.configs = configsFromViewer(viewer.value);
        if (pin.configs.length > 0) pin.configs_source = 'dataset-viewer';
        else if (viewerPending(viewer.value) && !pin.access_error) pin.access_error = accessError('metadata', listed.dataset_id + ' dataset viewer splits are still pending', true);
      }
    } catch (error) {
      if (!pin.access_error) pin.access_error = accessError('network', listed.dataset_id + ' split lookup failed: ' + (error instanceof Error ? error.message : 'unknown error'), true);
    }
    if (pin.configs.length === 0 && card) {
      const fallback = configsFromCard(card);
      if (fallback.length > 0) {
        pin.configs = fallback;
        pin.configs_source = 'dataset-card';
      }
    }
  }
  try {
    const sizeUrl = new URL(VIEWER + '/size');
    sizeUrl.searchParams.set('dataset', listed.dataset_id);
    sizeUrl.searchParams.set('revision', revision);
    const sizeResponse = await requestJson(sizeUrl.toString());
    if (sizeResponse.status === 200) pin.sizes = sizesFromViewer(sizeResponse.value);
  } catch {
    pin.sizes = null;
  }
  let hashed = anchors.slice();
  if (pin.sibling_paths && pin.sibling_paths.length > 0) {
    try {
      const described = await fetchPaths(listed.dataset_id, revision, pin.sibling_paths);
      const downloads: InventoryFile[] = [];
      for (const filePath of pin.sibling_paths) {
        const describedFile = described.get(filePath);
        const existing = anchors.find((file) => file.path === filePath);
        if (describedFile?.sha256 && describedFile.size !== null && !(existing && existing.sha256 !== describedFile.sha256)) {
          downloads.push({ path: filePath, size_bytes: describedFile.size, sha256: describedFile.sha256 });
          continue;
        }
        if (existing) {
          downloads.push(existing);
          continue;
        }
        if (describedFile && describedFile.size !== null && describedFile.size <= SMALL_FILE_BYTES) {
          const downloaded = await downloadAtRevision(listed.dataset_id, revision, filePath, SMALL_FILE_BYTES);
          if (downloaded) downloads.push(downloaded);
        }
      }
      hashed = dedupeFiles(downloads);
    } catch (error) {
      if (!pin.access_error) pin.access_error = accessError('network', listed.dataset_id + ' file metadata failed: ' + (error instanceof Error ? error.message : 'unknown error'), true);
    }
  }
  const hashedFiles = dedupeFiles(hashed);
  pin.full_files = hashedFiles.length > 0 ? hashedFiles : null;
  const anchor = hashedFiles.find((file) => file.path === 'README.md') || hashedFiles[0] || null;
  pin.files = anchor ? [anchor] : [];
  return finalizePin(pin, listed);
}

function cardObject(value: unknown): boolean {
  const record = asRecord(value);
  return Boolean(record && Object.keys(record).length > 0);
}

function statusClass(status: number, listed: ListedDataset): string {
  if (status === 401 || status === 403) {
    if (listed.private) return 'private';
    if (listed.gated) return 'gated';
    if (listed.disabled) return 'disabled';
  }
  return 'http';
}

function fileListComplete(files: InventoryFile[], siblingPaths: string[] | null, siblingCount: number | null): boolean {
  if (!siblingPaths || siblingCount === null || files.length !== siblingCount) return false;
  const recorded = new Set(files.map((file) => file.path));
  return siblingPaths.every((filePath) => recorded.has(filePath));
}

function datasetOutput(pin: PinRecord, files: InventoryFile[], fileRecord: FileRecord): Record<string, unknown> {
  const output: Record<string, unknown> = {
    dataset_id: pin.dataset_id,
    resolved_revision: pin.resolved_revision,
    card: { fetched: pin.card.fetched, sha256: pin.card.sha256, source: pin.card.source },
    files,
    configs: pin.configs,
    access_error: pin.access_error,
    gated: pin.gated,
    private: pin.private,
    disabled: pin.disabled,
    file_record: fileRecord,
  };
  if (pin.configs_source) output.configs_source = pin.configs_source;
  if (pin.sizes) output.sizes = pin.sizes;
  return output;
}

function baseFileRecord(pin: PinRecord, files: InventoryFile[]): FileRecord {
  const complete = fileListComplete(files, pin.sibling_paths, pin.sibling_count);
  if (complete) return { sibling_count: pin.sibling_count, complete: true, omitted: 0 };
  const omitted = pin.sibling_count === null ? null : Math.max(0, pin.sibling_count - files.length);
  const hashesComplete = fileListComplete(pin.full_files || [], pin.sibling_paths, pin.sibling_count);
  const reason = pin.sibling_count === null
    ? 'The pinned revision did not return a sibling list. Recorded files are the bytes that were hashed.'
    : hashesComplete
      ? 'All ' + pin.sibling_count + ' sibling paths were hashed. This document keeps ' + files.length + ' hashed file rows so the inventory fits the evidence budget. The resolved revision pins the omitted paths.'
      : 'The sibling tree has ' + pin.sibling_count + ' paths. This document records ' + files.length + ' hashed ' + (files.length === 1 ? 'file' : 'files') + '. The remaining paths stay pinned by the resolved revision.';
  const record: FileRecord = { sibling_count: pin.sibling_count, complete: false, omitted, reason };
  if (pin.extensions && Object.keys(pin.extensions).length > 0) record.extensions = pin.extensions;
  return record;
}

function inventoryBody(organizations: OrganizationInventory[], status: { inventory_status: 'complete' | 'partial'; partial_reasons: string[] }, discovery: Record<string, unknown>): Record<string, unknown> {
  return { schema: INVENTORY_SCHEMA, inventory_status: status.inventory_status, partial_reasons: status.partial_reasons, retrieved_at: discovery.retrieved_at, discovery, organizations };
}

function encodeInventory(body: Record<string, unknown>, pretty: boolean): string {
  return (pretty ? JSON.stringify(body, null, 2) : JSON.stringify(body)) + '\n';
}

export function buildInventoryDocument(listings: Array<{ listing: ListingCheckpoint; access_error: AccessError | null; blocking: string[] }>, pins: Map<string, PinRecord>, retrievedAt: string): { document: Record<string, unknown>; text: string } {
  const blocking = listings.flatMap((entry) => entry.blocking);
  const organizations: OrganizationInventory[] = listings.map((entry) => {
    const datasets = entry.listing.datasets.slice().sort((left, right) => left.dataset_id.localeCompare(right.dataset_id));
    const rows = datasets.map((listed) => {
      const pin = pins.get(listed.dataset_id) || finalizePin(pinShell(listed), listed);
      const anchor = pin.files.length > 0 ? pin.files : [];
      const full = pin.full_files && fileListComplete(pin.full_files, pin.sibling_paths, pin.sibling_count) ? pin.full_files : null;
      return { pin, anchor, full };
    });
    const chosen = rows.map((row) => datasetOutput(row.pin, row.anchor, baseFileRecord(row.pin, row.anchor)));
    const revisionLines = datasets.map((listed) => listed.dataset_id + '\t' + (listed.resolved_revision || ''));
    return {
      entry,
      rows,
      chosen,
      organization: {
        id: entry.listing.organization,
        pagination: { followed: true, pages: entry.listing.pages, exhausted: entry.listing.exhausted, limit: entry.listing.limit, continuation: 'link-rel-next' },
        dataset_count: datasets.length,
        listing_sha256: sha256Bytes(datasets.map((listed) => listed.dataset_id).join('\n') + '\n'),
        revision_set_sha256: sha256Bytes(revisionLines.join('\n') + '\n'),
        datasets: chosen,
        access_error: entry.access_error,
      },
    };
  });
  const status = classifyInventory(organizations.map((item) => item.organization), blocking);
  const discovery: Record<string, unknown> = {
    method: 'huggingface-dataset-api',
    organizations: SOURCE_ORGANIZATIONS.slice(),
    pagination: 'link-rel-next',
    page_limit: DEFAULT_PAGE_LIMIT,
    credentials: 'none',
    complete_file_sibling_limit: COMPLETE_FILE_SIBLING_LIMIT,
    retrieved_at: retrievedAt,
    limitations: [
      'Anonymous pagination lists public datasets only. Private datasets are not visible and are not invented.',
      'Each candidate is pinned to the commit returned on the listing page that contained it.',
      'File rows are path, size, and sha256. Sibling trees above the complete-file limit keep an extension count and an omission reason; the resolved revision still pins those paths.',
      'Dataset viewer sizes are original and parquet byte counts at the pinned revision when that endpoint succeeds.',
      'Models and spaces are outside this dataset inventory.',
    ],
  };
  const materialize = () => {
    for (const organization of organizations) organization.organization.datasets = organization.chosen;
    discovery.file_lists_complete = organizations.reduce((sum, organization) => sum + organization.chosen.filter((row) => asRecord(row.file_record)?.complete === true).length, 0);
    discovery.file_lists_partial = organizations.reduce((sum, organization) => sum + organization.chosen.filter((row) => asRecord(row.file_record)?.complete !== true).length, 0);
    discovery.dataset_access_errors = organizations.reduce((sum, organization) => sum + organization.chosen.filter((row) => row.access_error !== null).length, 0);
    return inventoryBody(organizations.map((item) => item.organization), status, discovery);
  };
  const fits = (body: Record<string, unknown>) => Buffer.byteLength(encodeInventory(body, false)) <= EVIDENCE_BYTE_BUDGET;
  const savedSizes = organizations.map((organization) => organization.chosen.map((row) => row.sizes));
  const savedExtensions = organizations.map((organization) => organization.chosen.map((row) => asRecord(row.file_record)?.extensions || null));
  const dropSizes = () => {
    for (const organization of organizations) {
      organization.chosen = organization.chosen.map((row) => {
        if (!Object.prototype.hasOwnProperty.call(row, 'sizes')) return row;
        const copy = { ...row };
        delete copy.sizes;
        return copy;
      });
    }
  };
  const restoreSizes = () => {
    organizations.forEach((organization, orgIndex) => {
      organization.chosen = organization.chosen.map((row, rowIndex) => {
        const sizes = savedSizes[orgIndex][rowIndex];
        return sizes ? { ...row, sizes } : row;
      });
    });
  };
  const dropExtensions = () => {
    for (const organization of organizations) {
      organization.chosen = organization.chosen.map((row) => {
        const fileRecord = asRecord(row.file_record);
        if (!fileRecord || !fileRecord.extensions) return row;
        const trimmed = { ...fileRecord };
        delete trimmed.extensions;
        return { ...row, file_record: trimmed };
      });
    }
  };
  const restoreExtensions = () => {
    organizations.forEach((organization, orgIndex) => {
      organization.chosen = organization.chosen.map((row, rowIndex) => {
        const extensions = savedExtensions[orgIndex][rowIndex];
        const fileRecord = asRecord(row.file_record);
        if (!extensions || !fileRecord || fileRecord.complete === true) return row;
        return { ...row, file_record: { ...fileRecord, extensions } };
      });
    });
  };
  dropSizes();
  dropExtensions();
  const upgrades = organizations.flatMap((organization) => organization.rows.map((row, index) => ({ organization, index, row })))
    .filter((item) => item.row.full && item.row.full.length > item.row.anchor.length)
    .sort((left, right) => (left.row.full ? left.row.full.length : 0) - (right.row.full ? right.row.full.length : 0) || left.row.pin.dataset_id.localeCompare(right.row.pin.dataset_id));
  for (const upgrade of upgrades) {
    const fullFiles = upgrade.row.full;
    if (!fullFiles) continue;
    const previous = upgrade.organization.chosen[upgrade.index];
    const fullRecord: FileRecord = { sibling_count: upgrade.row.pin.sibling_count, complete: true, omitted: 0 };
    upgrade.organization.chosen[upgrade.index] = datasetOutput(upgrade.row.pin, fullFiles, fullRecord);
    delete upgrade.organization.chosen[upgrade.index].sizes;
    if (!fits(materialize())) upgrade.organization.chosen[upgrade.index] = previous;
  }
  if (fits(materialize())) {
    restoreSizes();
    if (!fits(materialize())) dropSizes();
  }
  if (!organizations.some((organization) => organization.chosen.some((row) => Object.prototype.hasOwnProperty.call(row, 'sizes')))) {
    (discovery.limitations as string[])[3] = 'Dataset viewer byte counts were measured at the pinned revision and omitted here so the hashed file rows fit the evidence budget.';
  }
  restoreExtensions();
  if (!fits(materialize())) dropExtensions();
  const body = materialize();
  const pretty = encodeInventory(body, true);
  const compact = encodeInventory(body, false);
  const text = Buffer.byteLength(pretty) <= EVIDENCE_BYTE_BUDGET ? pretty : compact;
  return { document: JSON.parse(text) as Record<string, unknown>, text };
}

async function mapPool<T>(items: T[], concurrency: number, worker: (item: T, index: number) => Promise<void>): Promise<void> {
  let cursor = 0;
  async function run(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index], index);
    }
  }
  const workers = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: workers }, () => run()));
}

async function discover(args: Args): Promise<Record<string, unknown>> {
  await mkdir(args.checkpoint, { recursive: true });
  const listings = [];
  for (const organization of SOURCE_ORGANIZATIONS) listings.push(await paginateOrganization(organization, args));
  const listed = listings.flatMap((entry) => entry.listing.datasets);
  const pins = new Map<string, PinRecord>();
  let finished = 0;
  await mapPool(listed, args.assembleOnly ? Math.min(32, listed.length || 1) : args.concurrency, async (row) => {
    let pin: PinRecord;
    if (args.assembleOnly) {
      pin = usablePin(await readJsonFile(pinPath(args.checkpoint, row.dataset_id)), row) || finalizePin(pinShell(row), row);
      if (!usablePin(pin, row) && !pin.access_error) pin = finalizePin(pin, row);
    } else {
      try {
        pin = await pinDataset(row, args);
      } catch (error) {
        pin = pinShell(row);
        pin.access_error = accessError('network', row.dataset_id + ' pin failed: ' + (error instanceof Error ? error.message : 'unknown error'), true);
        pin = finalizePin(pin, row);
      }
      await writeJsonAtomic(pinPath(args.checkpoint, row.dataset_id), pin);
    }
    pins.set(row.dataset_id, pin);
    finished += 1;
    if (finished % 25 === 0 || finished === listed.length) {
      process.stderr.write('pinned ' + finished + '/' + listed.length + '\n');
      try {
        await writeJsonAtomic(path.join(args.checkpoint, 'progress.json'), { finished, total: listed.length, at: new Date().toISOString() });
      } catch {
        // Progress is a resume hint. A concurrent writer must not discard pinned datasets.
      }
    }
  });
  const built = buildInventoryDocument(listings, pins, new Date().toISOString());
  if (Buffer.byteLength(built.text) > 1048576) throw new Error('source inventory exceeds the single-file evidence budget');
  await mkdir(path.dirname(args.output), { recursive: true });
  const temporary = args.output + '.tmp';
  await writeFile(temporary, built.text);
  await rename(temporary, args.output);
  const summary = {
    inventory_status: built.document.inventory_status,
    bytes: Buffer.byteLength(built.text),
    organizations: (built.document.organizations as OrganizationInventory[]).map((organization) => ({
      id: organization.id,
      pages: organization.pagination.pages,
      exhausted: organization.pagination.exhausted,
      datasets: organization.dataset_count,
      access_error: organization.access_error,
    })),
    discovery: built.document.discovery,
  };
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
  return summary;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    output: path.join(ROOT, 'data/worldwide/source-inventory.json'),
    checkpoint: process.env.IPFS_ACCELERATE_AGENT_TASK_CHECKPOINT_DIR || path.join(ROOT, '.discover-checkpoint'),
    maxPages: null,
    fileLimit: COMPLETE_FILE_SIBLING_LIMIT,
    concurrency: 4,
    assembleOnly: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === '--output' && value) {
      args.output = path.resolve(value);
      index += 1;
    } else if (flag === '--checkpoint' && value) {
      args.checkpoint = path.resolve(value);
      index += 1;
    } else if (flag === '--max-pages' && value) {
      args.maxPages = Number(value);
      index += 1;
    } else if (flag === '--file-limit' && value) {
      args.fileLimit = Number(value);
      index += 1;
    } else if (flag === '--concurrency' && value) {
      args.concurrency = Number(value);
      index += 1;
    } else if (flag === '--assemble-only') args.assembleOnly = true;
    else if (flag === '--help') {
      process.stdout.write('usage: node scripts/worldwide/discover.ts [--output file] [--checkpoint dir] [--max-pages n] [--assemble-only]\n');
      process.exit(0);
    } else throw new Error('unknown argument ' + flag);
  }
  if (args.maxPages !== null && (!Number.isInteger(args.maxPages) || args.maxPages < 1)) throw new Error('--max-pages must be a positive integer');
  if (!Number.isInteger(args.fileLimit) || args.fileLimit < 1) throw new Error('--file-limit must be a positive integer');
  if (!Number.isInteger(args.concurrency) || args.concurrency < 1) throw new Error('--concurrency must be a positive integer');
  return args;
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

export async function discoverSourceInventory(overrides: Partial<Args> = {}): Promise<Record<string, unknown>> {
  return discover({ ...parseArgs([]), ...overrides });
}

if (isDirectRun()) {
  discover(parseArgs(process.argv.slice(2))).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'discovery failed';
    process.stderr.write(message + '\n');
    process.exit(1);
  });
}

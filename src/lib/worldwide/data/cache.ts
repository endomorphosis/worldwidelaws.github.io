/**
 * Revision-keyed cache of public legal artifacts.
 *
 * IndexedDB holds the LRU catalog of public artifacts. CacheStorage holds
 * their bytes. The key is the dataset, the pinned source revision, the
 * artifact path, and the SHA-256 of the bytes. A saved source stays readable
 * after the catalog moves on, and the stale or offline state names both
 * revisions. Unsaved entries are an LRU bounded by count and bytes. They are
 * removed in the same IndexedDB transaction that installs a new catalog pin.
 *
 * The cache does not store a search query, a place, coordinates, or a
 * location history. Storage corruption and quota failure drop or refuse the
 * affected record and leave every other saved source readable.
 */

import { sha256Bytes } from './identity.ts';

export const CACHE_SCHEMA = 'worldwide-legal-search.public-cache@1';
export const CACHE_DATABASE = 'worldwide-legal-search.public-cache@1';
export const CACHE_STORAGE_NAME = 'worldwide-legal-search.public-artifacts@1';
export const CACHE_ORIGIN = 'https://cache.worldwide-legal-search.invalid';
export const DB_VERSION = 1;

const ENTRY_STORE = 'entries';
const CATALOG_STORE = 'catalog';
const CATALOG_ID = 'current';

export const CACHE_LIMITS = Object.freeze({
  maxEntries: 256,
  maxSavedEntries: 64,
  maxBytes: 32 * 1024 * 1024,
  maxEntryBytes: 2 * 1024 * 1024,
  absoluteEntryBytes: 10 * 1024 * 1024,
  absoluteQuotaBytes: 64 * 1024 * 1024,
  maxPathChars: 240,
  maxEntriesCeiling: 10000,
});

const ENTRY_FIELDS = [
  'token',
  'datasetId',
  'revision',
  'path',
  'sha256',
  'sizeBytes',
  'saved',
  'savedAt',
  'lastUsedAt',
  'admittedCatalogRevision',
  'mediaType',
  'generation',
] as const;

const PUT_FIELD_SET = new Set<string>(['datasetId', 'revision', 'path', 'sha256', 'bytes', 'mediaType', 'saved']);

const CATALOG_FIELDS = ['id', 'catalogRevision', 'sources', 'generation', 'installedAt'] as const;
const MEDIA_TYPES = new Set(['application/json', 'application/octet-stream', 'text/plain']);
const PERSONAL_FIELDS = new Set([
  'accuracy',
  'address',
  'altitude',
  'coordinates',
  'geolocation',
  'heading',
  'history',
  'lat',
  'latitude',
  'lng',
  'location',
  'lon',
  'longitude',
  'placehistory',
  'position',
  'queries',
  'query',
  'search',
  'searchquery',
  'speed',
]);

const DATASET_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const GIT_REVISION = /^[0-9a-f]{40}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;

const STALE_VISIBLE_COPY = 'This saved copy is older than the catalog revision.';
const STALE_ANNOUNCEMENT = 'Stale saved copy. The catalog has a newer revision.';
const STALE_NEXT_ACTION = 'Refresh this source, or keep reading the saved copy with its revision visible.';
const STALE_COVERAGE = 'Partial collection';
const OFFLINE_VISIBLE_COPY = 'Offline. Showing saved material only.';
const OFFLINE_ANNOUNCEMENT = 'Offline. Saved material is available. Other sources are not on this device.';
const OFFLINE_NEXT_ACTION = 'Read the saved material, or reconnect to search sources that are not on this device.';
const OFFLINE_COVERAGE = 'Sources that are not saved on this device are unavailable.';
const OFFLINE_EMPTY_VISIBLE = 'Offline. No saved material is on this device.';
const OFFLINE_EMPTY_ANNOUNCEMENT = 'Offline. No saved material is on this device.';
const OFFLINE_EMPTY_NEXT = 'Reconnect to search sources that are not on this device.';
const FRESH_VISIBLE = 'This saved copy matches the catalog revision.';
const FRESH_ANNOUNCEMENT = 'Saved copy matches the catalog revision.';
const FRESH_NEXT = 'Read the saved material.';
const FRESH_COVERAGE = 'The saved copy uses the catalog revision.';
const EMPTY_VISIBLE = 'No saved source is on this device.';
const EMPTY_ANNOUNCEMENT = 'No saved source is on this device.';
const EMPTY_NEXT = 'Search while online to save a public source.';
const EMPTY_COVERAGE = 'Nothing is saved on this device.';
const UNPINNED_VISIBLE = 'This saved copy has no catalog revision to compare.';
const UNPINNED_ANNOUNCEMENT = 'Saved copy. No catalog revision is installed.';
const UNPINNED_NEXT = 'Refresh the catalog, or keep reading the saved copy with its revision visible.';
const UNPINNED_COVERAGE = 'The saved copy is on this device. The catalog revision is not installed.';
const CORRUPT_RECOVERY = 'The stored copy failed its integrity check and was removed. The rest of the cache remains available.';

export type CacheCode =
  | 'personal-data'
  | 'integrity'
  | 'invalid'
  | 'entry-too-large'
  | 'storage-exhausted'
  | 'unavailable'
  | 'aborted'
  | 'miss'
  | 'corrupt-recovered'
  | 'not-saved-offline';

export type CacheState = 'fresh' | 'stale-cache' | 'offline-saved' | 'empty' | 'unpinned';
export type Freshness = 'fresh' | 'stale' | 'unpinned';

export class CacheError extends Error {
  readonly code: CacheCode;

  constructor(code: CacheCode, message: string) {
    super(message);
    this.name = 'CacheError';
    this.code = code;
  }
}

export interface CacheLimits {
  maxEntries: number;
  maxSavedEntries: number;
  maxBytes: number;
  maxEntryBytes: number;
  absoluteEntryBytes: number;
  absoluteQuotaBytes: number;
  maxPathChars: number;
  maxEntriesCeiling: number;
}

export interface IntegrityKey {
  schema: typeof CACHE_SCHEMA;
  datasetId: string;
  revision: string;
  path: string;
  sha256: string;
  token: string;
}

export interface PublicArtifactInput {
  datasetId: string;
  revision: string;
  path: string;
  sha256: string;
  bytes: Uint8Array;
  mediaType?: string | null;
  saved?: boolean;
}

export interface CatalogSourcePin {
  datasetId: string;
  revision: string;
}

export interface CatalogPin {
  catalogRevision: string;
  sources: readonly CatalogSourcePin[];
}

export interface RevisionDifference {
  datasetId: string;
  path: string;
  cachedRevision: string;
  catalogRevision: string | null;
}

export interface CacheVisibility {
  schema: typeof CACHE_SCHEMA;
  state: CacheState;
  stale: boolean;
  offline: boolean;
  visibleCopy: string;
  announcement: string;
  nextAction: string;
  coverageCopy: string;
  staleVisibleCopy: string | null;
  staleAnnouncement: string | null;
  cachedRevision: string | null;
  catalogRevision: string | null;
  catalogIntegrity: string | null;
  savedCount: number;
  differences: readonly RevisionDifference[];
}

export interface PublicCacheEntry {
  token: string;
  datasetId: string;
  revision: string;
  path: string;
  sha256: string;
  sizeBytes: number;
  saved: boolean;
  savedAt: number | null;
  lastUsedAt: number;
  mediaType: string;
  freshness: Freshness;
  cachedRevision: string;
  catalogRevision: string | null;
}

export interface CacheUsage {
  entries: number;
  savedEntries: number;
  bytes: number;
  maxEntries: number;
  maxBytes: number;
  maxEntryBytes: number;
  maxSavedEntries: number;
}

export interface PutResult {
  ok: boolean;
  code: 'stored' | 'storage-exhausted' | 'entry-too-large' | 'miss';
  token: string | null;
  evicted: number;
  recovered: boolean;
  usage: CacheUsage;
}

export interface ReadResult {
  ok: boolean;
  code: 'hit' | 'miss' | 'not-saved-offline' | 'corrupt-recovered';
  offered: boolean;
  bytes: Uint8Array | null;
  entry: PublicCacheEntry | null;
  visibility: CacheVisibility;
  recovered: boolean;
  recoveryCopy: string | null;
}

export interface InvalidationResult {
  ok: boolean;
  code: 'installed' | 'unchanged' | 'aborted';
  generation: number;
  dropped: number;
  retainedSaved: number;
  catalogRevision: string | null;
  recovered: boolean;
}

export interface ReconcileReport {
  ok: true;
  droppedEntries: number;
  droppedOrphans: number;
  catalogReset: boolean;
  recovered: true;
}

export interface CacheDump {
  schema: typeof CACHE_SCHEMA;
  entries: readonly unknown[];
  catalog: unknown;
  urls: readonly string[];
  headerNames: readonly (readonly string[])[];
}

export interface PublicCacheOptions {
  indexedDB?: IDBFactory;
  caches?: CacheStorage;
  online?: () => boolean;
  now?: () => number;
  limits?: Partial<CacheLimits>;
  databaseName?: string;
  cacheName?: string;
}

interface StoredEntry {
  token: string;
  datasetId: string;
  revision: string;
  path: string;
  sha256: string;
  sizeBytes: number;
  saved: boolean;
  savedAt: number | null;
  lastUsedAt: number;
  admittedCatalogRevision: string | null;
  mediaType: string;
  generation: number;
}

interface StoredCatalog {
  id: typeof CATALOG_ID;
  catalogRevision: string;
  sources: CatalogSourcePin[];
  generation: number;
  installedAt: number;
}

interface CachedBody {
  bytes: Uint8Array;
  digest: string;
  sha256Header: string | null;
  revisionHeader: string | null;
  datasetHeader: string | null;
  pathHeader: string | null;
  schemaHeader: string | null;
}

export function digestHex(bytes: Uint8Array): string {
  const digest = sha256Bytes(bytes);
  let out = '';
  for (let index = 0; index < digest.length; index += 1) out += digest[index].toString(16).padStart(2, '0');
  return out;
}

export function resolveCacheLimits(input?: Partial<CacheLimits>): CacheLimits {
  const maxBytes = clamp(input?.maxBytes, CACHE_LIMITS.maxBytes, 1, CACHE_LIMITS.absoluteQuotaBytes);
  let maxEntryBytes = clamp(input?.maxEntryBytes, CACHE_LIMITS.maxEntryBytes, 1, CACHE_LIMITS.absoluteEntryBytes);
  if (maxEntryBytes > maxBytes) maxEntryBytes = maxBytes;
  const maxEntries = clamp(input?.maxEntries, CACHE_LIMITS.maxEntries, 1, CACHE_LIMITS.maxEntriesCeiling);
  const maxSavedEntries = clamp(input?.maxSavedEntries, CACHE_LIMITS.maxSavedEntries, 1, maxEntries);
  return {
    maxEntries,
    maxSavedEntries,
    maxBytes,
    maxEntryBytes,
    absoluteEntryBytes: CACHE_LIMITS.absoluteEntryBytes,
    absoluteQuotaBytes: CACHE_LIMITS.absoluteQuotaBytes,
    maxPathChars: CACHE_LIMITS.maxPathChars,
    maxEntriesCeiling: CACHE_LIMITS.maxEntriesCeiling,
  };
}

export function buildIntegrityKey(input: {
  datasetId: string;
  revision: string;
  path: string;
  sha256: string;
}): IntegrityKey {
  const datasetId = requiredString(input.datasetId, 'datasetId');
  const revision = requiredString(input.revision, 'revision');
  const sha256 = requiredString(input.sha256, 'sha256');
  const path = normalizePath(input.path);
  if (!DATASET_ID.test(datasetId)) throw new CacheError('invalid', 'Dataset id is not a public repository id.');
  if (!GIT_REVISION.test(revision)) throw new CacheError('invalid', 'Source revision is not a pinned revision.');
  if (!SHA256_HEX.test(sha256)) throw new CacheError('invalid', 'Integrity hash is not a SHA-256 digest.');
  const token = `v1*${datasetId}*${revision}*${sha256}*${encodeURIComponent(path)}`;
  return { schema: CACHE_SCHEMA, datasetId, revision, path, sha256, token };
}

export function parseIntegrityToken(token: string): IntegrityKey | null {
  const parts = token.split('*');
  if (parts.length !== 5 || parts[0] !== 'v1') return null;
  let path = '';
  try {
    path = decodeURIComponent(parts[4]);
  } catch {
    return null;
  }
  try {
    const key = buildIntegrityKey({ datasetId: parts[1], revision: parts[2], sha256: parts[3], path });
    if (key.token !== token) return null;
    return key;
  } catch {
    return null;
  }
}

export function cacheRequestUrl(token: string): string {
  const key = parseIntegrityToken(token);
  if (!key) throw new CacheError('invalid', 'Integrity key is not valid.');
  return `${CACHE_ORIGIN}/artifact/${encodeToken(key.token)}`;
}

export function openPublicCache(options: PublicCacheOptions = {}): PublicCache {
  return new BrowserPublicCache(options);
}

export interface PublicCache {
  put(input: PublicArtifactInput): Promise<PutResult>;
  read(key: IntegrityKey | string): Promise<ReadResult>;
  pin(key: IntegrityKey | string): Promise<PutResult>;
  unpin(key: IntegrityKey | string): Promise<PutResult>;
  remove(key: IntegrityKey | string): Promise<{ ok: true; removed: boolean }>;
  listSaved(): Promise<readonly PublicCacheEntry[]>;
  visibility(): Promise<CacheVisibility>;
  installCatalog(pin: CatalogPin): Promise<InvalidationResult>;
  reconcile(): Promise<ReconcileReport>;
  usage(): Promise<CacheUsage>;
  dump(): Promise<CacheDump>;
  ready(): Promise<void>;
}

class BrowserPublicCache implements PublicCache {
  private readonly limits: CacheLimits;
  private readonly databaseName: string;
  private readonly cacheName: string;
  private db: IDBDatabase | null = null;
  private artifactCache: Cache | null = null;
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: PublicCacheOptions) {
    this.limits = resolveCacheLimits(options.limits);
    this.databaseName = options.databaseName ?? CACHE_DATABASE;
    this.cacheName = options.cacheName ?? CACHE_STORAGE_NAME;
  }

  async put(input: PublicArtifactInput): Promise<PutResult> {
    assertPublicRecord(input);
    const bytes = copyBytes(input.bytes);
    if (bytes.byteLength === 0) throw new CacheError('invalid', 'A public artifact has no bytes.');
    const sha256 = requiredString(input.sha256, 'sha256');
    const key = buildIntegrityKey({
      datasetId: input.datasetId,
      revision: input.revision,
      path: input.path,
      sha256,
    });
    if (bytes.byteLength <= CACHE_LIMITS.absoluteEntryBytes && digestHex(bytes) !== sha256) {
      throw new CacheError('integrity', 'Artifact bytes do not match the integrity key.');
    }
    const mediaType = normalizeMediaType(input.mediaType);
    const savedFlag = input.saved;
    if (bytes.byteLength > this.limits.maxEntryBytes) {
      return this.enqueue(async () => {
        await this.ensureOpen();
        return {
          ok: false as const,
          code: 'entry-too-large' as const,
          token: key.token,
          evicted: 0,
          recovered: true,
          usage: usageOf(await this.readValidEntries(), this.limits),
        };
      });
    }
    return this.enqueue(() => this.putUnlocked(key, bytes, mediaType, savedFlag));
  }

  async read(key: IntegrityKey | string): Promise<ReadResult> {
    const parsed = requireKey(key);
    return this.enqueue(() => this.readUnlocked(parsed));
  }

  async pin(key: IntegrityKey | string): Promise<PutResult> {
    const parsed = requireKey(key);
    return this.enqueue(() => this.setSavedUnlocked(parsed, true));
  }

  async unpin(key: IntegrityKey | string): Promise<PutResult> {
    const parsed = requireKey(key);
    return this.enqueue(() => this.setSavedUnlocked(parsed, false));
  }

  async remove(key: IntegrityKey | string): Promise<{ ok: true; removed: boolean }> {
    const parsed = requireKey(key);
    return this.enqueue(async () => {
      await this.ensureOpen();
      const existing = await this.readEntry(parsed.token);
      await this.dropToken(parsed.token);
      return { ok: true as const, removed: existing !== null };
    });
  }

  listSaved(): Promise<readonly PublicCacheEntry[]> {
    return this.enqueue(() => this.listSavedUnlocked());
  }

  visibility(): Promise<CacheVisibility> {
    return this.enqueue(() => this.visibilityUnlocked());
  }

  async installCatalog(pin: CatalogPin): Promise<InvalidationResult> {
    const normalized = normalizePin(pin);
    return this.enqueue(() => this.installUnlocked(normalized));
  }

  reconcile(): Promise<ReconcileReport> {
    return this.enqueue(() => this.reconcileUnlocked());
  }

  usage(): Promise<CacheUsage> {
    return this.enqueue(async () => {
      await this.ensureOpen();
      return usageOf(await this.readValidEntries(), this.limits);
    });
  }

  dump(): Promise<CacheDump> {
    return this.enqueue(() => this.dumpUnlocked());
  }

  ready(): Promise<void> {
    return this.enqueue(async () => {
      await this.ensureOpen();
    });
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const run = this.tail.then(work, work);
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async putUnlocked(
    key: IntegrityKey,
    bytes: Uint8Array,
    mediaType: string,
    savedFlag: boolean | undefined,
  ): Promise<PutResult> {
    await this.ensureOpen();
    let evicted = 0;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const entries = await this.readValidEntries();
      const existing = entries.find((entry) => entry.token === key.token);
      const saved = savedFlag === undefined ? existing?.saved === true : savedFlag === true;
      const decision = planInsertion(entries, key.token, bytes.byteLength, saved, this.limits);
      if (!decision.ok) {
        return {
          ok: false,
          code: decision.code,
          token: key.token,
          evicted,
          recovered: true,
          usage: usageOf(entries, this.limits),
        };
      }
      const wrote = await this.writeBytesOnce(key, bytes, mediaType);
      if (wrote === 'quota') {
        await this.deleteBytes(key.token);
        if (attempt === 1) {
          return this.exhausted(key.token, evicted, await this.readValidEntries());
        }
        evicted += await this.evictAllUnsaved();
        continue;
      }
      try {
        await this.commitInsertion(key, bytes.byteLength, mediaType, saved, decision.victims, existing ?? null);
      } catch (error) {
        await this.deleteBytes(key.token);
        if (!isQuota(error) && !isAbort(error)) throw error;
        if (attempt === 1 || !isQuota(error)) {
          return this.exhausted(key.token, evicted, await this.readValidEntries());
        }
        evicted += await this.evictAllUnsaved();
        continue;
      }
      for (const token of decision.victims) await this.deleteBytes(token);
      evicted += decision.victims.length;
      return {
        ok: true,
        code: 'stored',
        token: key.token,
        evicted,
        recovered: false,
        usage: usageOf(await this.readValidEntries(), this.limits),
      };
    }
    return this.exhausted(key.token, evicted, await this.readValidEntries());
  }

  private exhausted(token: string, evicted: number, entries: readonly StoredEntry[]): PutResult {
    return {
      ok: false,
      code: 'storage-exhausted',
      token,
      evicted,
      recovered: true,
      usage: usageOf(entries, this.limits),
    };
  }

  private async readUnlocked(key: IntegrityKey): Promise<ReadResult> {
    await this.ensureOpen();
    const catalog = await this.readCatalog();
    const offline = !this.isOnline();
    const entry = await this.readEntry(key.token);
    const savedEntries = (await this.readValidEntries()).filter((item) => item.saved);
    if (!entry) {
      const orphan = await this.readBody(key);
      if (orphan) await this.deleteBytes(key.token);
      return {
        ok: false,
        code: 'miss',
        offered: false,
        bytes: null,
        entry: null,
        visibility: aggregateVisibility(savedEntries, catalog, offline),
        recovered: orphan !== null,
        recoveryCopy: orphan ? CORRUPT_RECOVERY : null,
      };
    }
    if (offline && !entry.saved) {
      return {
        ok: false,
        code: 'not-saved-offline',
        offered: false,
        bytes: null,
        entry: toPublicEntry(entry, catalog),
        visibility: entryVisibility(entry, catalog, true, savedEntries.length),
        recovered: false,
        recoveryCopy: null,
      };
    }
    const body = await this.readBody(key);
    if (!body || !bodyMatches(body, key, entry)) {
      await this.dropToken(key.token);
      const remaining = (await this.readValidEntries()).filter((item) => item.saved);
      return {
        ok: false,
        code: 'corrupt-recovered',
        offered: false,
        bytes: null,
        entry: null,
        visibility: aggregateVisibility(remaining, catalog, offline),
        recovered: true,
        recoveryCopy: CORRUPT_RECOVERY,
      };
    }
    const touched = await this.touch(entry);
    const savedCount = savedEntries.filter((item) => item.token !== touched.token).length + (touched.saved ? 1 : 0);
    return {
      ok: true,
      code: 'hit',
      offered: true,
      bytes: body.bytes,
      entry: toPublicEntry(touched, catalog),
      visibility: entryVisibility(touched, catalog, offline, savedCount),
      recovered: false,
      recoveryCopy: null,
    };
  }

  private async setSavedUnlocked(key: IntegrityKey, saved: boolean): Promise<PutResult> {
    await this.ensureOpen();
    const entries = await this.readValidEntries();
    const existing = entries.find((entry) => entry.token === key.token);
    if (!existing) {
      return {
        ok: false,
        code: 'miss',
        token: key.token,
        evicted: 0,
        recovered: false,
        usage: usageOf(entries, this.limits),
      };
    }
    if (saved && !existing.saved) {
      const savedCount = entries.filter((entry) => entry.saved).length;
      if (savedCount + 1 > this.limits.maxSavedEntries) {
        return this.exhausted(key.token, 0, entries);
      }
    }
    await runTransaction(this.database(), [ENTRY_STORE], 'readwrite', async (tx) => {
      const store = tx.objectStore(ENTRY_STORE);
      const current = parseEntry(await readRequest(store.get(key.token)));
      if (!current) return;
      current.saved = saved;
      current.savedAt = saved ? current.savedAt ?? this.now() : null;
      current.lastUsedAt = this.now();
      await readRequest(store.put(current));
    });
    return {
      ok: true,
      code: 'stored',
      token: key.token,
      evicted: 0,
      recovered: false,
      usage: usageOf(await this.readValidEntries(), this.limits),
    };
  }

  private async listSavedUnlocked(): Promise<readonly PublicCacheEntry[]> {
    await this.ensureOpen();
    const catalog = await this.readCatalog();
    const saved = (await this.readValidEntries()).filter((entry) => entry.saved);
    saved.sort((left, right) => {
      if (left.datasetId !== right.datasetId) return left.datasetId < right.datasetId ? -1 : 1;
      if (left.path !== right.path) return left.path < right.path ? -1 : 1;
      return left.revision < right.revision ? -1 : left.revision > right.revision ? 1 : 0;
    });
    return saved.map((entry) => toPublicEntry(entry, catalog));
  }

  private async visibilityUnlocked(): Promise<CacheVisibility> {
    await this.ensureOpen();
    const catalog = await this.readCatalog();
    const saved = (await this.readValidEntries()).filter((entry) => entry.saved);
    return aggregateVisibility(saved, catalog, !this.isOnline());
  }

  private async installUnlocked(pin: StoredCatalogPin): Promise<InvalidationResult> {
    await this.ensureOpen();
    const dropped: string[] = [];
    let staged: InvalidationResult | null = null;
    try {
      await runTransaction(this.database(), [CATALOG_STORE, ENTRY_STORE], 'readwrite', async (tx) => {
        const catalogStore = tx.objectStore(CATALOG_STORE);
        const entryStore = tx.objectStore(ENTRY_STORE);
        const current = parseCatalog(await readRequest(catalogStore.get(CATALOG_ID)));
        if (current && current.catalogRevision === pin.catalogRevision) {
          if (!sameSources(current.sources, pin.sources)) {
            throw new CacheError('integrity', 'Catalog revision does not match the pinned sources.');
          }
          staged = {
            ok: true,
            code: 'unchanged',
            generation: current.generation,
            dropped: 0,
            retainedSaved: 0,
            catalogRevision: current.catalogRevision,
            recovered: false,
          };
          const raws = await readRequest<unknown[]>(entryStore.getAll());
          staged = { ...staged, retainedSaved: countSaved(raws) };
          return;
        }
        const raws = await readRequest<unknown[]>(entryStore.getAll());
        let retainedSaved = 0;
        for (const raw of raws) {
          const entry = parseEntry(raw);
          const token = entry?.token ?? rawToken(raw);
          if (!token) continue;
          if (entry?.saved) {
            retainedSaved += 1;
            continue;
          }
          dropped.push(token);
          await readRequest(entryStore.delete(token));
        }
        const generation = (current?.generation ?? 0) + 1;
        const record: StoredCatalog = {
          id: CATALOG_ID,
          catalogRevision: pin.catalogRevision,
          sources: pin.sources.map((source) => ({ datasetId: source.datasetId, revision: source.revision })),
          generation,
          installedAt: this.now(),
        };
        await readRequest(catalogStore.put(record));
        staged = {
          ok: true,
          code: 'installed',
          generation,
          dropped: dropped.length,
          retainedSaved,
          catalogRevision: record.catalogRevision,
          recovered: false,
        };
      });
    } catch (error) {
      if (error instanceof CacheError && error.code === 'integrity') throw error;
      const catalog = await this.readCatalog();
      const entries = await this.readValidEntries();
      return {
        ok: false,
        code: 'aborted',
        generation: catalog?.generation ?? 0,
        dropped: 0,
        retainedSaved: entries.filter((entry) => entry.saved).length,
        catalogRevision: catalog?.catalogRevision ?? null,
        recovered: true,
      };
    }
    for (const token of dropped) await this.deleteBytes(token);
    return staged ?? {
      ok: false,
      code: 'aborted',
      generation: 0,
      dropped: 0,
      retainedSaved: 0,
      catalogRevision: null,
      recovered: true,
    };
  }

  private async reconcileUnlocked(): Promise<ReconcileReport> {
    await this.ensureOpen();
    let droppedEntries = 0;
    let catalogReset = false;
    const keep = new Set<string>();
    await runTransaction(this.database(), [CATALOG_STORE, ENTRY_STORE], 'readwrite', async (tx) => {
      const entryStore = tx.objectStore(ENTRY_STORE);
      const catalogStore = tx.objectStore(CATALOG_STORE);
      const raws = await readRequest<unknown[]>(entryStore.getAll());
      for (const raw of raws) {
        const entry = parseEntry(raw);
        if (!entry || hasPersonalKey(raw)) {
          const token = entry?.token ?? rawToken(raw);
          if (token) await readRequest(entryStore.delete(token));
          droppedEntries += 1;
          continue;
        }
        keep.add(entry.token);
      }
      const rawCatalog = await readRequest(catalogStore.get(CATALOG_ID));
      if (rawCatalog != null && (!parseCatalog(rawCatalog) || hasPersonalKey(rawCatalog))) {
        await readRequest(catalogStore.delete(CATALOG_ID));
        catalogReset = true;
      }
    });
    let droppedOrphans = 0;
    const seen = await this.cacheTokens();
    for (const token of seen.orphans) {
      await this.deleteBytes(token);
      droppedOrphans += 1;
    }
    for (const token of seen.tokens) {
      if (!keep.has(token)) {
        await this.deleteBytes(token);
        droppedOrphans += 1;
      }
    }
    for (const token of [...keep]) {
      const key = parseIntegrityToken(token);
      const entry = await this.readEntry(token);
      const body = key ? await this.readBody(key) : null;
      if (!key || !entry || !body || !bodyMatches(body, key, entry)) {
        await this.dropToken(token);
        droppedEntries += 1;
        if (body || seen.tokens.includes(token)) droppedOrphans += 1;
      }
    }
    return { ok: true, droppedEntries, droppedOrphans, catalogReset, recovered: true };
  }

  private async dumpUnlocked(): Promise<CacheDump> {
    await this.ensureOpen();
    const entries = await this.readRawEntries();
    const catalog = await this.readRawCatalog();
    const requests = await this.artifactCacheOrThrow().keys();
    const urls: string[] = [];
    const headerNames: string[][] = [];
    for (const request of requests) {
      urls.push(request.url);
      const response = await this.artifactCacheOrThrow().match(request);
      const names: string[] = [];
      response?.headers.forEach((_value, name) => {
        names.push(name.toLowerCase());
      });
      names.sort();
      headerNames.push(names);
    }
    urls.sort();
    return { schema: CACHE_SCHEMA, entries, catalog, urls, headerNames };
  }

  private async commitInsertion(
    key: IntegrityKey,
    sizeBytes: number,
    mediaType: string,
    saved: boolean,
    victims: readonly string[],
    existing: StoredEntry | null,
  ): Promise<void> {
    const now = this.now();
    await runTransaction(this.database(), [ENTRY_STORE, CATALOG_STORE], 'readwrite', async (tx) => {
      const entries = tx.objectStore(ENTRY_STORE);
      const catalog = parseCatalog(await readRequest(tx.objectStore(CATALOG_STORE).get(CATALOG_ID)));
      for (const token of victims) {
        if (token !== key.token) await readRequest(entries.delete(token));
      }
      const record: StoredEntry = {
        token: key.token,
        datasetId: key.datasetId,
        revision: key.revision,
        path: key.path,
        sha256: key.sha256,
        sizeBytes,
        saved,
        savedAt: saved ? (existing?.saved ? existing.savedAt ?? now : now) : null,
        lastUsedAt: now,
        admittedCatalogRevision: catalog?.catalogRevision ?? null,
        mediaType,
        generation: catalog?.generation ?? 0,
      };
      await readRequest(entries.put(record));
    });
  }

  private async writeBytesOnce(key: IntegrityKey, bytes: Uint8Array, mediaType: string): Promise<'ok' | 'quota'> {
    const headers = new Headers();
    headers.set('content-type', mediaType);
    headers.set('content-length', String(bytes.byteLength));
    headers.set('x-worldwide-cache-schema', CACHE_SCHEMA);
    headers.set('x-worldwide-sha256', key.sha256);
    headers.set('x-worldwide-revision', key.revision);
    headers.set('x-worldwide-dataset', key.datasetId);
    headers.set('x-worldwide-path', encodeURIComponent(key.path));
    const response = makeResponse(bytes, headers);
    try {
      await this.artifactCacheOrThrow().put(makeRequest(cacheRequestUrl(key.token)), response);
      return 'ok';
    } catch (error) {
      if (isQuota(error)) return 'quota';
      throw error;
    }
  }

  private async evictAllUnsaved(): Promise<number> {
    const tokens: string[] = [];
    await runTransaction(this.database(), [ENTRY_STORE], 'readwrite', async (tx) => {
      const store = tx.objectStore(ENTRY_STORE);
      const raws = await readRequest<unknown[]>(store.getAll());
      for (const raw of raws) {
        const entry = parseEntry(raw);
        const token = entry?.token ?? rawToken(raw);
        if (!token) continue;
        if (!entry || !entry.saved) {
          tokens.push(token);
          await readRequest(store.delete(token));
        }
      }
    });
    for (const token of tokens) await this.deleteBytes(token);
    return tokens.length;
  }

  private async touch(entry: StoredEntry): Promise<StoredEntry> {
    const touched: StoredEntry = { ...entry, lastUsedAt: this.now() };
    try {
      await runTransaction(this.database(), [ENTRY_STORE], 'readwrite', async (tx) => {
        const store = tx.objectStore(ENTRY_STORE);
        const current = parseEntry(await readRequest(store.get(entry.token)));
        if (!current) return;
        current.lastUsedAt = touched.lastUsedAt;
        await readRequest(store.put(current));
      });
    } catch {
      return entry;
    }
    return touched;
  }

  private async readEntry(token: string): Promise<StoredEntry | null> {
    const raw = await runTransaction(this.database(), [ENTRY_STORE], 'readonly', async (tx) =>
      readRequest(tx.objectStore(ENTRY_STORE).get(token)),
    );
    const entry = parseEntry(raw);
    if (raw != null && !entry) {
      await this.dropToken(token);
      return null;
    }
    return entry;
  }

  private async readValidEntries(): Promise<StoredEntry[]> {
    const raws = await this.readRawEntries();
    const entries: StoredEntry[] = [];
    for (const raw of raws) {
      const entry = parseEntry(raw);
      if (entry && !hasPersonalKey(raw)) entries.push(entry);
    }
    return entries;
  }

  private async readRawEntries(): Promise<unknown[]> {
    const raws = await runTransaction(this.database(), [ENTRY_STORE], 'readonly', async (tx) =>
      readRequest<unknown[]>(tx.objectStore(ENTRY_STORE).getAll()),
    );
    return Array.isArray(raws) ? raws : [];
  }

  private async readCatalog(): Promise<StoredCatalog | null> {
    const raw = await this.readRawCatalog();
    if (raw == null) return null;
    const parsed = parseCatalog(raw);
    if (parsed && !hasPersonalKey(raw)) return parsed;
    await runTransaction(this.database(), [CATALOG_STORE], 'readwrite', async (tx) => {
      await readRequest(tx.objectStore(CATALOG_STORE).delete(CATALOG_ID));
    });
    return null;
  }

  private async readRawCatalog(): Promise<unknown> {
    return runTransaction(this.database(), [CATALOG_STORE], 'readonly', async (tx) =>
      readRequest(tx.objectStore(CATALOG_STORE).get(CATALOG_ID)),
    );
  }

  private async readBody(key: IntegrityKey): Promise<CachedBody | null> {
    const response = await this.artifactCacheOrThrow().match(makeRequest(cacheRequestUrl(key.token)));
    if (!response) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    return {
      bytes,
      digest: digestHex(bytes),
      sha256Header: response.headers.get('x-worldwide-sha256'),
      revisionHeader: response.headers.get('x-worldwide-revision'),
      datasetHeader: response.headers.get('x-worldwide-dataset'),
      pathHeader: decodeHeaderPath(response.headers.get('x-worldwide-path')),
      schemaHeader: response.headers.get('x-worldwide-cache-schema'),
    };
  }

  private async cacheTokens(): Promise<{ tokens: string[]; orphans: string[] }> {
    const requests = await this.artifactCacheOrThrow().keys();
    const tokens: string[] = [];
    const orphans: string[] = [];
    for (const request of requests) {
      const token = tokenFromUrl(request.url);
      if (!token) {
        await this.artifactCacheOrThrow().delete(request);
        orphans.push(request.url);
        continue;
      }
      tokens.push(token);
    }
    return { tokens, orphans };
  }

  private async dropToken(token: string): Promise<void> {
    try {
      await runTransaction(this.database(), [ENTRY_STORE], 'readwrite', async (tx) => {
        await readRequest(tx.objectStore(ENTRY_STORE).delete(token));
      });
    } catch {
      // A failed metadata delete is retried by reconcile.
    }
    await this.deleteBytes(token);
  }

  private async deleteBytes(token: string): Promise<void> {
    try {
      const key = parseIntegrityToken(token);
      if (!key) return;
      await this.artifactCacheOrThrow().delete(makeRequest(cacheRequestUrl(key.token)));
    } catch {
      // Orphan bytes stay unreadable until reconcile can delete them.
    }
  }

  private async ensureOpen(): Promise<void> {
    if (this.db && this.artifactCache) return;
    try {
      this.db = await openDatabaseRecovering(this.factory(), this.databaseName);
      this.artifactCache = await openCacheRecovering(this.cachesApi(), this.cacheName);
    } catch (error) {
      this.db = null;
      this.artifactCache = null;
      if (error instanceof CacheError) throw error;
      throw new CacheError('unavailable', 'Public cache storage could not be opened.');
    }
  }

  private database(): IDBDatabase {
    if (!this.db) throw new CacheError('unavailable', 'IndexedDB is not open.');
    return this.db;
  }

  private artifactCacheOrThrow(): Cache {
    if (!this.artifactCache) throw new CacheError('unavailable', 'CacheStorage is not open.');
    return this.artifactCache;
  }

  private factory(): IDBFactory {
    const candidate = this.options.indexedDB ?? globalIndexedDb();
    if (!candidate) throw new CacheError('unavailable', 'IndexedDB is not available.');
    return candidate;
  }

  private cachesApi(): CacheStorage {
    const candidate = this.options.caches ?? globalCaches();
    if (!candidate) throw new CacheError('unavailable', 'CacheStorage is not available.');
    return candidate;
  }

  private isOnline(): boolean {
    if (this.options.online) return this.options.online() !== false;
    if (typeof navigator === 'undefined') return true;
    return navigator.onLine !== false;
  }

  private now(): number {
    const value = this.options.now ? this.options.now() : Date.now();
    if (!Number.isFinite(value)) return Date.now();
    return Math.trunc(value);
  }
}

interface StoredCatalogPin {
  catalogRevision: string;
  sources: CatalogSourcePin[];
}

function planInsertion(
  entries: readonly StoredEntry[],
  token: string,
  sizeBytes: number,
  saved: boolean,
  limits: CacheLimits,
): { ok: true; victims: string[] } | { ok: false; code: 'storage-exhausted' | 'entry-too-large' } {
  if (sizeBytes <= 0 || sizeBytes > limits.maxEntryBytes) return { ok: false, code: 'entry-too-large' };
  const others = entries.filter((entry) => entry.token !== token);
  const savedTotal = others.filter((entry) => entry.saved).length + (saved ? 1 : 0);
  if (savedTotal > limits.maxSavedEntries) return { ok: false, code: 'storage-exhausted' };
  let bytes = others.reduce((sum, entry) => sum + entry.sizeBytes, 0) + sizeBytes;
  let count = others.length + 1;
  const victims: StoredEntry[] = [];
  const unsaved = others.filter((entry) => !entry.saved).sort(byLeastRecent);
  for (const candidate of unsaved) {
    if (bytes <= limits.maxBytes && count <= limits.maxEntries) break;
    victims.push(candidate);
    bytes -= candidate.sizeBytes;
    count -= 1;
  }
  if (bytes > limits.maxBytes || count > limits.maxEntries) return { ok: false, code: 'storage-exhausted' };
  return { ok: true, victims: victims.map((entry) => entry.token) };
}

function byLeastRecent(left: StoredEntry, right: StoredEntry): number {
  if (left.lastUsedAt !== right.lastUsedAt) return left.lastUsedAt - right.lastUsedAt;
  if (left.token < right.token) return -1;
  if (left.token > right.token) return 1;
  return 0;
}

function aggregateVisibility(
  saved: readonly StoredEntry[],
  catalog: StoredCatalog | null,
  offline: boolean,
): CacheVisibility {
  const differences = differencesOf(saved, catalog);
  const stale = differences.length > 0;
  const first = differences[0] ?? null;
  const base = visibilityShell(saved.length, catalog, offline, stale, first);
  const single = saved.length === 1 ? saved[0] : null;
  return {
    ...base,
    differences,
    cachedRevision: single ? single.revision : base.cachedRevision,
    catalogRevision: single ? sourceRevision(catalog, single.datasetId) : base.catalogRevision,
  };
}

function entryVisibility(
  entry: StoredEntry,
  catalog: StoredCatalog | null,
  offline: boolean,
  savedCount: number,
): CacheVisibility {
  const differences = differencesOf([entry], catalog);
  const stale = differences.length > 0;
  const shell = visibilityShell(savedCount, catalog, offline, stale, differences[0] ?? null);
  return {
    ...shell,
    cachedRevision: entry.revision,
    catalogRevision: sourceRevision(catalog, entry.datasetId),
    differences,
  };
}

function visibilityShell(
  savedCount: number,
  catalog: StoredCatalog | null,
  offline: boolean,
  stale: boolean,
  first: RevisionDifference | null,
): CacheVisibility {
  const catalogIntegrity = catalog?.catalogRevision ?? null;
  const cachedRevision = first?.cachedRevision ?? (savedCount === 1 ? null : null);
  const catalogRevision = first ? first.catalogRevision : null;
  if (offline) {
    const empty = savedCount === 0;
    return {
      schema: CACHE_SCHEMA,
      state: 'offline-saved',
      stale,
      offline: true,
      visibleCopy: empty ? OFFLINE_EMPTY_VISIBLE : OFFLINE_VISIBLE_COPY,
      announcement: empty ? OFFLINE_EMPTY_ANNOUNCEMENT : OFFLINE_ANNOUNCEMENT,
      nextAction: empty ? OFFLINE_EMPTY_NEXT : OFFLINE_NEXT_ACTION,
      coverageCopy: OFFLINE_COVERAGE,
      staleVisibleCopy: stale ? STALE_VISIBLE_COPY : null,
      staleAnnouncement: stale ? STALE_ANNOUNCEMENT : null,
      cachedRevision: first?.cachedRevision ?? null,
      catalogRevision,
      catalogIntegrity,
      savedCount,
      differences: [],
    };
  }
  if (stale) {
    return {
      schema: CACHE_SCHEMA,
      state: 'stale-cache',
      stale: true,
      offline: false,
      visibleCopy: STALE_VISIBLE_COPY,
      announcement: STALE_ANNOUNCEMENT,
      nextAction: STALE_NEXT_ACTION,
      coverageCopy: STALE_COVERAGE,
      staleVisibleCopy: STALE_VISIBLE_COPY,
      staleAnnouncement: STALE_ANNOUNCEMENT,
      cachedRevision: first?.cachedRevision ?? cachedRevision,
      catalogRevision,
      catalogIntegrity,
      savedCount,
      differences: [],
    };
  }
  if (savedCount === 0) {
    return {
      schema: CACHE_SCHEMA,
      state: 'empty',
      stale: false,
      offline: false,
      visibleCopy: EMPTY_VISIBLE,
      announcement: EMPTY_ANNOUNCEMENT,
      nextAction: EMPTY_NEXT,
      coverageCopy: EMPTY_COVERAGE,
      staleVisibleCopy: null,
      staleAnnouncement: null,
      cachedRevision: null,
      catalogRevision: null,
      catalogIntegrity,
      savedCount: 0,
      differences: [],
    };
  }
  if (!catalog) {
    return {
      schema: CACHE_SCHEMA,
      state: 'unpinned',
      stale: false,
      offline: false,
      visibleCopy: UNPINNED_VISIBLE,
      announcement: UNPINNED_ANNOUNCEMENT,
      nextAction: UNPINNED_NEXT,
      coverageCopy: UNPINNED_COVERAGE,
      staleVisibleCopy: null,
      staleAnnouncement: null,
      cachedRevision: null,
      catalogRevision: null,
      catalogIntegrity: null,
      savedCount,
      differences: [],
    };
  }
  return {
    schema: CACHE_SCHEMA,
    state: 'fresh',
    stale: false,
    offline: false,
    visibleCopy: FRESH_VISIBLE,
    announcement: FRESH_ANNOUNCEMENT,
    nextAction: FRESH_NEXT,
    coverageCopy: FRESH_COVERAGE,
    staleVisibleCopy: null,
    staleAnnouncement: null,
    cachedRevision: null,
    catalogRevision: null,
    catalogIntegrity,
    savedCount,
    differences: [],
  };
}

function differencesOf(saved: readonly StoredEntry[], catalog: StoredCatalog | null): RevisionDifference[] {
  if (!catalog) return [];
  const differences: RevisionDifference[] = [];
  for (const entry of saved) {
    const pinned = sourceRevision(catalog, entry.datasetId);
    if (pinned !== entry.revision) {
      differences.push({
        datasetId: entry.datasetId,
        path: entry.path,
        cachedRevision: entry.revision,
        catalogRevision: pinned,
      });
    }
  }
  return differences;
}

function sourceRevision(catalog: StoredCatalog | null, datasetId: string): string | null {
  if (!catalog) return null;
  const pin = catalog.sources.find((source) => source.datasetId === datasetId);
  return pin ? pin.revision : null;
}

function toPublicEntry(entry: StoredEntry, catalog: StoredCatalog | null): PublicCacheEntry {
  const catalogRevision = sourceRevision(catalog, entry.datasetId);
  let freshness: Freshness = 'unpinned';
  if (catalog) freshness = catalogRevision === entry.revision ? 'fresh' : 'stale';
  return {
    token: entry.token,
    datasetId: entry.datasetId,
    revision: entry.revision,
    path: entry.path,
    sha256: entry.sha256,
    sizeBytes: entry.sizeBytes,
    saved: entry.saved,
    savedAt: entry.savedAt,
    lastUsedAt: entry.lastUsedAt,
    mediaType: entry.mediaType,
    freshness,
    cachedRevision: entry.revision,
    catalogRevision,
  };
}

function bodyMatches(body: CachedBody, key: IntegrityKey, entry: StoredEntry): boolean {
  return (
    body.digest === key.sha256 &&
    body.digest === entry.sha256 &&
    body.sha256Header === key.sha256 &&
    body.revisionHeader === key.revision &&
    body.datasetHeader === key.datasetId &&
    body.pathHeader === key.path &&
    body.schemaHeader === CACHE_SCHEMA &&
    entry.revision === key.revision &&
    entry.datasetId === key.datasetId &&
    entry.path === key.path &&
    entry.sha256 === key.sha256
  );
}

function usageOf(entries: readonly StoredEntry[], limits: CacheLimits): CacheUsage {
  return {
    entries: entries.length,
    savedEntries: entries.filter((entry) => entry.saved).length,
    bytes: entries.reduce((sum, entry) => sum + entry.sizeBytes, 0),
    maxEntries: limits.maxEntries,
    maxBytes: limits.maxBytes,
    maxEntryBytes: limits.maxEntryBytes,
    maxSavedEntries: limits.maxSavedEntries,
  };
}

function countSaved(raws: readonly unknown[]): number {
  let saved = 0;
  for (const raw of raws) {
    const entry = parseEntry(raw);
    if (entry?.saved) saved += 1;
  }
  return saved;
}

function assertPublicRecord(value: object): void {
  walkPersonal(value, 0);
  for (const key of Object.keys(value)) {
    if (!PUT_FIELD_SET.has(key)) throw new CacheError('invalid', `Unexpected artifact field ${key}.`);
  }
}

function walkPersonal(value: unknown, depth: number): void {
  if (depth > 4 || !value || typeof value !== 'object') return;
  if (value instanceof Uint8Array) return;
  if (Array.isArray(value)) {
    for (const item of value) walkPersonal(item, depth + 1);
    return;
  }
  for (const key of Object.keys(value)) {
    if (PERSONAL_FIELDS.has(normalizeField(key))) {
      throw new CacheError('personal-data', `Refusing to store personal field ${key}.`);
    }
    walkPersonal((value as Record<string, unknown>)[key], depth + 1);
  }
}

function hasPersonalKey(value: unknown): boolean {
  try {
    walkPersonal(value, 0);
    return false;
  } catch (error) {
    return error instanceof CacheError && error.code === 'personal-data';
  }
}

function normalizeField(key: string): string {
  return key.toLowerCase().replace(/[_-]/g, '');
}

function normalizeMediaType(value: string | null | undefined): string {
  if (value == null || value === '') return 'application/octet-stream';
  const mediaType = value.split(';', 1)[0].trim().toLowerCase();
  if (!MEDIA_TYPES.has(mediaType)) throw new CacheError('invalid', 'Artifact media type is not a public cache type.');
  return mediaType;
}

function normalizePath(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > CACHE_LIMITS.maxPathChars) {
    throw new CacheError('invalid', 'Artifact path is empty or too long.');
  }
  if (value.includes('\\') || value.includes('?') || value.includes('#') || value.startsWith('/')) {
    throw new CacheError('invalid', 'Artifact path is not a relative public path.');
  }
  const segments = value.split('/');
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    throw new CacheError('invalid', 'Artifact path is not a relative public path.');
  }
  return segments.join('/');
}

function normalizePin(pin: CatalogPin): StoredCatalogPin {
  if (!pin || typeof pin !== 'object') throw new CacheError('invalid', 'Catalog pin is missing.');
  walkPersonal(pin, 0);
  if (typeof pin.catalogRevision !== 'string' || !SHA256_HEX.test(pin.catalogRevision)) {
    throw new CacheError('invalid', 'Catalog revision is not a SHA-256 digest.');
  }
  if (!Array.isArray(pin.sources)) throw new CacheError('invalid', 'Catalog sources are missing.');
  const sources: CatalogSourcePin[] = [];
  const seen = new Set<string>();
  for (const source of pin.sources) {
    if (!source || typeof source !== 'object') throw new CacheError('invalid', 'Catalog source is missing.');
    const datasetId = requiredString(source.datasetId, 'datasetId');
    const revision = requiredString(source.revision, 'revision');
    if (!DATASET_ID.test(datasetId) || !GIT_REVISION.test(revision)) {
      throw new CacheError('invalid', 'Catalog source is not a pinned public dataset.');
    }
    if (seen.has(datasetId)) throw new CacheError('invalid', 'Catalog source is repeated.');
    seen.add(datasetId);
    sources.push({ datasetId, revision });
  }
  sources.sort((left, right) => (left.datasetId < right.datasetId ? -1 : left.datasetId > right.datasetId ? 1 : 0));
  return { catalogRevision: pin.catalogRevision, sources };
}

function sameSources(left: readonly CatalogSourcePin[], right: readonly CatalogSourcePin[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index].datasetId !== right[index].datasetId || left[index].revision !== right[index].revision) return false;
  }
  return true;
}

function parseEntry(raw: unknown): StoredEntry | null {
  if (!isRecord(raw)) return null;
  if (!exactFields(raw, ENTRY_FIELDS)) return null;
  const token = raw.token;
  const datasetId = raw.datasetId;
  const revision = raw.revision;
  const path = raw.path;
  const sha256 = raw.sha256;
  const sizeBytes = raw.sizeBytes;
  const saved = raw.saved;
  const savedAt = raw.savedAt;
  const lastUsedAt = raw.lastUsedAt;
  const admittedCatalogRevision = raw.admittedCatalogRevision;
  const mediaType = raw.mediaType;
  const generation = raw.generation;
  if (typeof token !== 'string' || typeof datasetId !== 'string' || typeof revision !== 'string') return null;
  if (typeof path !== 'string' || typeof sha256 !== 'string' || typeof mediaType !== 'string') return null;
  if (typeof sizeBytes !== 'number' || !Number.isInteger(sizeBytes) || sizeBytes < 0) return null;
  if (typeof saved !== 'boolean') return null;
  if (!(savedAt === null || (typeof savedAt === 'number' && Number.isFinite(savedAt)))) return null;
  if (typeof lastUsedAt !== 'number' || !Number.isFinite(lastUsedAt)) return null;
  if (!(admittedCatalogRevision === null || (typeof admittedCatalogRevision === 'string' && SHA256_HEX.test(admittedCatalogRevision)))) {
    return null;
  }
  if (typeof generation !== 'number' || !Number.isInteger(generation) || generation < 0) return null;
  if (!MEDIA_TYPES.has(mediaType)) return null;
  const key = parseIntegrityToken(token);
  if (!key) return null;
  if (key.datasetId !== datasetId || key.revision !== revision || key.path !== path || key.sha256 !== sha256) return null;
  if (saved && savedAt === null) return null;
  if (!saved && savedAt !== null) return null;
  return {
    token,
    datasetId,
    revision,
    path,
    sha256,
    sizeBytes,
    saved,
    savedAt,
    lastUsedAt,
    admittedCatalogRevision,
    mediaType,
    generation,
  };
}

function parseCatalog(raw: unknown): StoredCatalog | null {
  if (!isRecord(raw)) return null;
  if (!exactFields(raw, CATALOG_FIELDS)) return null;
  if (raw.id !== CATALOG_ID) return null;
  if (typeof raw.catalogRevision !== 'string' || !SHA256_HEX.test(raw.catalogRevision)) return null;
  if (typeof raw.generation !== 'number' || !Number.isInteger(raw.generation) || raw.generation < 1) return null;
  if (typeof raw.installedAt !== 'number' || !Number.isFinite(raw.installedAt)) return null;
  if (!Array.isArray(raw.sources)) return null;
  const sources: CatalogSourcePin[] = [];
  for (const source of raw.sources) {
    if (!isRecord(source)) return null;
    if (!exactFields(source, ['datasetId', 'revision'])) return null;
    if (typeof source.datasetId !== 'string' || typeof source.revision !== 'string') return null;
    if (!DATASET_ID.test(source.datasetId) || !GIT_REVISION.test(source.revision)) return null;
    sources.push({ datasetId: source.datasetId, revision: source.revision });
  }
  const sorted = [...sources].sort((left, right) => (left.datasetId < right.datasetId ? -1 : 1));
  if (!sameSources(sources, sorted)) return null;
  const seen = new Set<string>();
  for (const source of sources) {
    if (seen.has(source.datasetId)) return null;
    seen.add(source.datasetId);
  }
  return {
    id: CATALOG_ID,
    catalogRevision: raw.catalogRevision,
    sources,
    generation: raw.generation,
    installedAt: raw.installedAt,
  };
}

function exactFields(raw: Record<string, unknown>, fields: readonly string[]): boolean {
  const keys = Object.keys(raw);
  if (keys.length !== fields.length) return false;
  return fields.every((field) => Object.prototype.hasOwnProperty.call(raw, field));
}

function rawToken(raw: unknown): string | null {
  if (!isRecord(raw)) return null;
  return typeof raw.token === 'string' ? raw.token : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new CacheError('invalid', `${label} is missing.`);
  return value;
}

function copyBytes(bytes: Uint8Array): Uint8Array {
  if (!(bytes instanceof Uint8Array)) throw new CacheError('invalid', 'Artifact bytes are missing.');
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

function decodeHeaderPath(value: string | null): string | null {
  if (value == null) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function encodeToken(token: string): string {
  return btoa(token).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeToken(encoded: string): string | null {
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) return null;
  const padLength = (4 - (encoded.length % 4)) % 4;
  const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(padLength);
  try {
    return atob(base64);
  } catch {
    return null;
  }
}

function tokenFromUrl(url: string): string | null {
  const prefix = `${CACHE_ORIGIN}/artifact/`;
  if (!url.startsWith(prefix)) return null;
  const encoded = url.slice(prefix.length);
  if (encoded.length === 0 || encoded.includes('/')) return null;
  const token = decodeToken(encoded);
  if (!token) return null;
  return parseIntegrityToken(token)?.token ?? null;
}

function requireKey(input: IntegrityKey | string): IntegrityKey {
  if (typeof input === 'string') {
    const parsed = parseIntegrityToken(input);
    if (!parsed) throw new CacheError('invalid', 'Integrity key is not valid.');
    return parsed;
  }
  const rebuilt = buildIntegrityKey(input);
  if (rebuilt.token !== input.token) throw new CacheError('integrity', 'Integrity key fields do not match its token.');
  return rebuilt;
}

function clamp(value: number | undefined, fallback: number, min: number, max: number): number {
  const candidate = value === undefined ? fallback : value;
  if (!Number.isInteger(candidate)) throw new CacheError('invalid', 'Cache limit is not an integer.');
  if (candidate < min) return min;
  if (candidate > max) return max;
  return candidate;
}

function isQuota(error: unknown): boolean {
  return hasName(error, 'QuotaExceededError');
}

function isAbort(error: unknown): boolean {
  return hasName(error, 'AbortError');
}

function hasName(error: unknown, name: string): boolean {
  return Boolean(error) && typeof error === 'object' && 'name' in error && (error as { name?: unknown }).name === name;
}

function globalIndexedDb(): IDBFactory | null {
  const scope = globalThis as { indexedDB?: IDBFactory };
  return scope.indexedDB ?? null;
}

function globalCaches(): CacheStorage | null {
  const scope = globalThis as { caches?: CacheStorage };
  return scope.caches ?? null;
}

function makeResponse(bytes: Uint8Array, headers: Headers): Response {
  const scope = globalThis as { Response?: new (body?: BodyInit | null, init?: ResponseInit) => Response };
  if (typeof scope.Response !== 'function') throw new CacheError('unavailable', 'Response is not available.');
  return new scope.Response(bytes, { status: 200, headers });
}

function makeRequest(url: string): Request {
  const scope = globalThis as { Request?: new (input: string, init?: RequestInit) => Request };
  if (typeof scope.Request !== 'function') throw new CacheError('unavailable', 'Request is not available.');
  return new scope.Request(url);
}

function readRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      reject(request.error ?? new DOMException('IndexedDB request failed.', 'UnknownError'));
    };
  });
}

async function runTransaction<T>(
  db: IDBDatabase,
  stores: string[],
  mode: IDBTransactionMode,
  body: (tx: IDBTransaction) => Promise<T>,
): Promise<T> {
  const tx = db.transaction(stores, mode);
  let settled = false;
  const done = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    tx.onabort = () => {
      if (settled) return;
      settled = true;
      reject(tx.error ?? new DOMException('The transaction was aborted.', 'AbortError'));
    };
    tx.onerror = () => {
      if (settled) return;
      settled = true;
      reject(tx.error ?? new DOMException('The transaction failed.', 'UnknownError'));
    };
  });
  let result: T;
  try {
    result = await body(tx);
    const committable = tx as IDBTransaction & { commit?: () => void };
    if (typeof committable.commit === 'function') committable.commit();
  } catch (error) {
    try {
      tx.abort();
    } catch {
      // The transaction may already be finished.
    }
    await done.catch(() => undefined);
    throw error;
  }
  await done;
  return result;
}

function openDatabase(factory: IDBFactory, name: string, version: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name, version);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(ENTRY_STORE)) {
        database.createObjectStore(ENTRY_STORE, { keyPath: 'token' });
      }
      if (!database.objectStoreNames.contains(CATALOG_STORE)) {
        database.createObjectStore(CATALOG_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => {
        database.close();
      };
      resolve(database);
    };
    request.onerror = () => {
      reject(request.error ?? new DOMException('IndexedDB open failed.', 'UnknownError'));
    };
    request.onblocked = () => {
      reject(new DOMException('IndexedDB open is blocked.', 'AbortError'));
    };
  });
}

async function openDatabaseRecovering(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  try {
    return await openDatabase(factory, name, DB_VERSION);
  } catch (error) {
    if (error instanceof CacheError) throw error;
    await deleteDatabase(factory, name);
    try {
      return await openDatabase(factory, name, DB_VERSION);
    } catch {
      throw new CacheError('unavailable', 'IndexedDB could not be opened after recovery.');
    }
  }
}

function deleteDatabase(factory: IDBFactory, name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = factory.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => {
      reject(request.error ?? new DOMException('IndexedDB delete failed.', 'UnknownError'));
    };
    request.onblocked = () => resolve();
  });
}

async function openCacheRecovering(caches: CacheStorage, name: string): Promise<Cache> {
  try {
    return await caches.open(name);
  } catch (error) {
    if (error instanceof CacheError) throw error;
    try {
      await caches.delete(name);
    } catch {
      throw new CacheError('unavailable', 'CacheStorage could not be cleared after a failed open.');
    }
    try {
      return await caches.open(name);
    } catch {
      throw new CacheError('unavailable', 'CacheStorage could not be opened after recovery.');
    }
  }
}

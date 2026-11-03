/**
 * IndexedDB and CacheStorage doubles for the public artifact cache.
 * The production module talks to these objects through the browser storage
 * interfaces: open, transactions, get/put/delete/getAll, and cache match/put.
 */

import { utf8Bytes } from '../../src/lib/worldwide/data/identity';
import {
  CACHE_DATABASE,
  CACHE_ORIGIN,
  CACHE_SCHEMA,
  CACHE_STORAGE_NAME,
  CacheError,
  buildIntegrityKey,
  cacheRequestUrl,
  digestHex,
  openPublicCache,
  type CacheLimits,
  type CatalogPin,
  type PublicArtifactInput,
  type PublicCache,
} from '../../src/lib/worldwide/data/cache';

const DATASET = 'endomorphosis/ipfs_example_laws';
const OTHER_DATASET = 'endomorphosis/ipfs_boundary_places';
const REV = 'a'.repeat(40);
const REV_B = 'b'.repeat(40);
const CATALOG_A = 'c'.repeat(64);
const CATALOG_B = 'd'.repeat(64);
const ENTRY_FIELDS = [
  'admittedCatalogRevision',
  'datasetId',
  'generation',
  'lastUsedAt',
  'mediaType',
  'path',
  'revision',
  'saved',
  'savedAt',
  'sha256',
  'sizeBytes',
  'token',
];
const STALE_VISIBLE = 'This saved copy is older than the catalog revision.';
const STALE_ANNOUNCEMENT = 'Stale saved copy. The catalog has a newer revision.';
const STALE_NEXT = 'Refresh this source, or keep reading the saved copy with its revision visible.';
const STALE_COVERAGE = 'Partial collection';
const OFFLINE_VISIBLE = 'Offline. Showing saved material only.';
const OFFLINE_ANNOUNCEMENT = 'Offline. Saved material is available. Other sources are not on this device.';
const OFFLINE_NEXT = 'Read the saved material, or reconnect to search sources that are not on this device.';
const OFFLINE_COVERAGE = 'Sources that are not saved on this device are unavailable.';
const CORRUPT_RECOVERY = 'The stored copy failed its integrity check and was removed. The rest of the cache remains available.';

/** jsdom provides Headers and not the Fetch Request/Response constructors. */
class FetchResponse {
  readonly status: number;
  readonly ok: boolean;
  readonly headers: Headers;
  private readonly body: Uint8Array;

  constructor(body?: Uint8Array | string | null, init?: { status?: number; headers?: HeadersInit }) {
    this.status = init?.status ?? 200;
    this.ok = this.status >= 200 && this.status < 300;
    this.headers = new Headers(init?.headers);
    if (body instanceof Uint8Array) this.body = new Uint8Array(body);
    else if (typeof body === 'string') this.body = utf8Bytes(body);
    else this.body = new Uint8Array();
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    const copy = new Uint8Array(this.body);
    return copy.buffer;
  }
}

class FetchRequest {
  readonly url: string;

  constructor(input: string) {
    this.url = input;
  }
}

const fetchScope = globalThis as { Response?: unknown; Request?: unknown };
if (typeof fetchScope.Response !== 'function') fetchScope.Response = FetchResponse;
if (typeof fetchScope.Request !== 'function') fetchScope.Request = FetchRequest;

interface StoredBody {
  body: Uint8Array;
  headers: [string, string][];
}

class MemoryTransaction {
  error: DOMException | null = null;
  oncomplete: (() => void) | null = null;
  onabort: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private finished = false;
  private readonly drafts = new Map<string, Map<string, unknown>>();

  constructor(
    private readonly database: MemoryDatabase,
    names: readonly string[],
  ) {
    for (const name of names) {
      const live = database.stores.get(name);
      if (!live) throw new DOMException(`Missing store ${name}.`, 'NotFoundError');
      this.drafts.set(name, cloneStore(live));
    }
  }

  objectStore(name: string) {
    const draft = this.drafts.get(name);
    const keyPath = this.database.keyPaths.get(name);
    if (!draft || !keyPath) throw new DOMException(`Missing store ${name}.`, 'NotFoundError');
    return {
      get: (key: IDBValidKey) => this.request(() => cloneValue(draft.get(String(key)))),
      getAll: () => this.request(() => [...draft.values()].map((value) => cloneValue(value))),
      put: (value: unknown) => this.request(() => {
        if (!value || typeof value !== 'object') throw new DOMException('The record is empty.', 'DataError');
        const record = value as Record<string, unknown>;
        const key = record[keyPath];
        if (typeof key !== 'string' || key.length === 0) throw new DOMException('The key is missing.', 'DataError');
        draft.set(key, cloneValue(value));
        return key;
      }),
      delete: (key: IDBValidKey) => this.request(() => {
        draft.delete(String(key));
        return undefined;
      }),
    };
  }

  commit(): void {
    if (this.finished) return;
    this.finished = true;
    if (this.database.owner.failNextCommit) {
      this.database.owner.failNextCommit = false;
      this.error = new DOMException('The transaction was aborted.', 'AbortError');
      queueMicrotask(() => this.onabort?.());
      return;
    }
    for (const [name, draft] of this.drafts) {
      const live = this.database.stores.get(name);
      if (!live) continue;
      live.clear();
      for (const [key, value] of draft) live.set(key, cloneValue(value));
    }
    queueMicrotask(() => this.oncomplete?.());
  }

  abort(): void {
    if (this.finished) return;
    this.finished = true;
    this.error = this.error ?? new DOMException('The transaction was aborted.', 'AbortError');
    queueMicrotask(() => this.onabort?.());
  }

  private request<T>(read: () => T): IDBRequest<T> {
    const request = {
      result: undefined as T,
      error: null as DOMException | null,
      onsuccess: null as ((event?: unknown) => void) | null,
      onerror: null as ((event?: unknown) => void) | null,
    };
    queueMicrotask(() => {
      if (this.finished) {
        request.error = new DOMException('The transaction is inactive.', 'TransactionInactiveError');
        request.onerror?.({});
        return;
      }
      try {
        request.result = read();
        request.onsuccess?.({});
      } catch (error) {
        request.error = error instanceof DOMException ? error : new DOMException(String(error), 'UnknownError');
        request.onerror?.({});
      }
    });
    return request as unknown as IDBRequest<T>;
  }
}

class MemoryDatabase {
  readonly stores = new Map<string, Map<string, unknown>>();
  readonly keyPaths = new Map<string, string>();
  onversionchange: (() => void) | null = null;

  constructor(
    readonly owner: MemoryIndexedDb,
    readonly name: string,
    public version: number,
  ) {}

  get objectStoreNames(): { contains(name: string): boolean } {
    return { contains: (name: string) => this.stores.has(name) };
  }

  createObjectStore(name: string, options: { keyPath?: string | string[] | null }): { name: string } {
    if (this.stores.has(name)) throw new DOMException(`Store ${name} already exists.`, 'ConstraintError');
    if (typeof options.keyPath !== 'string') throw new DOMException('The key path is missing.', 'DataError');
    this.stores.set(name, new Map());
    this.keyPaths.set(name, options.keyPath);
    return { name };
  }

  transaction(names: string | string[], _mode?: IDBTransactionMode): MemoryTransaction {
    const list = Array.isArray(names) ? names : [names];
    return new MemoryTransaction(this, list);
  }

  close(): void {
    this.owner.closed.push(this.name);
  }
}

class MemoryIndexedDb {
  readonly databases = new Map<string, MemoryDatabase>();
  readonly deleted: string[] = [];
  readonly closed: string[] = [];
  failOpens = 0;
  failNextCommit = false;
  opens = 0;

  open(name: string, version: number): IDBOpenDBRequest {
    this.opens += 1;
    const request = blankRequest();
    queueMicrotask(() => {
      if (this.failOpens > 0) {
        this.failOpens -= 1;
        request.error = new DOMException('Internal error opening database.', 'UnknownError');
        request.onerror?.({});
        return;
      }
      let database = this.databases.get(name);
      if (database && database.version > version) {
        request.error = new DOMException('The requested version is lower.', 'VersionError');
        request.onerror?.({});
        return;
      }
      const created = !database;
      if (!database) {
        database = new MemoryDatabase(this, name, version);
        this.databases.set(name, database);
      }
      const upgrade = created || database.version < version;
      database.version = version;
      request.result = database;
      if (upgrade) {
        try {
          request.onupgradeneeded?.({});
        } catch (error) {
          request.error = error instanceof DOMException ? error : new DOMException(String(error), 'AbortError');
          request.onerror?.({});
          return;
        }
      }
      queueMicrotask(() => request.onsuccess?.({}));
    });
    return request as unknown as IDBOpenDBRequest;
  }

  deleteDatabase(name: string): IDBOpenDBRequest {
    this.deleted.push(name);
    const database = this.databases.get(name);
    database?.onversionchange?.();
    this.databases.delete(name);
    const request = blankRequest();
    queueMicrotask(() => request.onsuccess?.({}));
    return request as unknown as IDBOpenDBRequest;
  }

  factory(): IDBFactory {
    return this as unknown as IDBFactory;
  }

  entryStore(): Map<string, unknown> | undefined {
    return this.databases.get(CACHE_DATABASE)?.stores.get('entries');
  }

  catalogStore(): Map<string, unknown> | undefined {
    return this.databases.get(CACHE_DATABASE)?.stores.get('catalog');
  }
}

class MemoryCacheBucket {
  readonly records = new Map<string, StoredBody>();

  constructor(private readonly owner: MemoryCacheStorage) {}

  async put(request: Request, response: Response): Promise<void> {
    if (this.owner.failPuts > 0 && this.owner.failMode === 'before') {
      this.owner.failPuts -= 1;
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    }
    const body = new Uint8Array(await response.arrayBuffer());
    const headers: [string, string][] = [];
    response.headers.forEach((value, key) => headers.push([key, value]));
    if (this.owner.failPuts > 0 && this.owner.failMode === 'after') {
      this.owner.failPuts -= 1;
      this.records.set(request.url, { body, headers });
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    }
    this.records.set(request.url, { body, headers });
  }

  async match(request: Request): Promise<Response | undefined> {
    const record = this.records.get(request.url);
    if (!record) return undefined;
    return new FetchResponse(record.body.slice(), { status: 200, headers: new Headers(record.headers) }) as unknown as Response;
  }

  async delete(request: Request): Promise<boolean> {
    return this.records.delete(request.url);
  }

  async keys(): Promise<readonly Request[]> {
    return [...this.records.keys()].map((url) => new FetchRequest(url) as unknown as Request);
  }
}

class MemoryCacheStorage {
  failPuts = 0;
  failMode: 'before' | 'after' = 'before';
  failOpens = 0;
  private readonly buckets = new Map<string, MemoryCacheBucket>();

  async open(name: string): Promise<MemoryCacheBucket> {
    if (this.failOpens > 0) {
      this.failOpens -= 1;
      throw new DOMException('CacheStorage open failed.', 'UnknownError');
    }
    let bucket = this.buckets.get(name);
    if (!bucket) {
      bucket = new MemoryCacheBucket(this);
      this.buckets.set(name, bucket);
    }
    return bucket;
  }

  async delete(name: string): Promise<boolean> {
    return this.buckets.delete(name);
  }

  api(): CacheStorage {
    return this as unknown as CacheStorage;
  }

  records(): Map<string, StoredBody> {
    const bucket = this.buckets.get(CACHE_STORAGE_NAME);
    if (!bucket) throw new Error('cache bucket was not opened');
    return bucket.records;
  }
}

function blankRequest(): {
  result: unknown;
  error: DOMException | null;
  onsuccess: ((event?: unknown) => void) | null;
  onerror: ((event?: unknown) => void) | null;
  onupgradeneeded: ((event?: unknown) => void) | null;
  onblocked: ((event?: unknown) => void) | null;
} {
  return {
    result: undefined,
    error: null,
    onsuccess: null,
    onerror: null,
    onupgradeneeded: null,
    onblocked: null,
  };
}

function cloneValue<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

function cloneStore(store: Map<string, unknown>): Map<string, unknown> {
  const copy = new Map<string, unknown>();
  for (const [key, value] of store) copy.set(key, cloneValue(value));
  return copy;
}

function artifact(revision: string, text: string, path = 'shards/article.json', saved = false): PublicArtifactInput {
  const bytes = utf8Bytes(text);
  return {
    datasetId: DATASET,
    revision,
    path,
    sha256: digestHex(bytes),
    bytes,
    mediaType: 'application/json; charset=utf-8',
    saved,
  };
}

function pin(revision: string, catalogRevision: string, datasetId = DATASET): CatalogPin {
  return { catalogRevision, sources: [{ datasetId, revision }] };
}

function harness(limits?: Partial<CacheLimits>): {
  cache: PublicCache;
  indexed: MemoryIndexedDb;
  storage: MemoryCacheStorage;
  network: { online: boolean };
} {
  const indexed = new MemoryIndexedDb();
  const storage = new MemoryCacheStorage();
  const network = { online: true };
  let tick = 0;
  const cache = openPublicCache({
    indexedDB: indexed.factory(),
    caches: storage.api(),
    limits,
    now: () => {
      tick += 1;
      return tick;
    },
    online: () => network.online,
  });
  return { cache, indexed, storage, network };
}

function bytesOf(result: Uint8Array | null): number[] {
  return Array.from(result ?? []);
}

describe('revision-keyed public cache', () => {
  it('stores public artifacts under an integrity key in CacheStorage and IndexedDB', async () => {
    const { cache, storage } = harness();
    const item = artifact(REV, 'The bounded article.');
    const key = buildIntegrityKey(item);
    expect(key.schema).toBe(CACHE_SCHEMA);
    expect(key.token).toContain(REV);
    expect(key.token).toContain(item.sha256);
    expect(key.token).toContain(DATASET);
    expect(cacheRequestUrl(key.token)).toMatch(new RegExp(`^${CACHE_ORIGIN.replace(/\./g, '\\.')}/artifact/[A-Za-z0-9_-]+$`));

    const other = artifact(REV_B, 'The bounded article.', 'shards/article.json');
    expect(other.sha256).toBe(item.sha256);
    expect(buildIntegrityKey(other).token).not.toBe(key.token);

    const stored = await cache.put(item);
    expect(stored).toMatchObject({ ok: true, code: 'stored', token: key.token, evicted: 0, recovered: false });
    const hit = await cache.read(key);
    expect(hit).toMatchObject({ ok: true, code: 'hit', offered: true, recovered: false });
    expect(bytesOf(hit.bytes)).toEqual(Array.from(item.bytes));
    expect(hit.entry).toMatchObject({
      datasetId: DATASET,
      revision: REV,
      path: 'shards/article.json',
      sha256: item.sha256,
      saved: false,
      mediaType: 'application/json',
      freshness: 'unpinned',
      cachedRevision: REV,
      catalogRevision: null,
    });

    const pinned = await cache.pin(key.token);
    expect(pinned.ok).toBe(true);
    expect(await cache.listSaved()).toHaveLength(1);
    const released = await cache.unpin(key);
    expect(released.ok).toBe(true);
    expect(await cache.listSaved()).toEqual([]);
    expect((await cache.read(key.token)).code).toBe('hit');
    expect((await cache.pin(buildIntegrityKey(other))).code).toBe('miss');

    const dump = await cache.dump();
    expect(dump.schema).toBe(CACHE_SCHEMA);
    expect(dump.entries).toHaveLength(1);
    expect(Object.keys(dump.entries[0] as object).sort()).toEqual([...ENTRY_FIELDS].sort());
    expect(dump.urls).toHaveLength(1);
    expect(dump.urls[0].startsWith(`${CACHE_ORIGIN}/artifact/`)).toBe(true);
    expect(dump.urls[0].includes('?')).toBe(false);
    const headers = dump.headerNames[0];
    for (const name of [
      'x-worldwide-cache-schema',
      'x-worldwide-sha256',
      'x-worldwide-revision',
      'x-worldwide-dataset',
      'x-worldwide-path',
    ]) {
      expect(headers).toContain(name);
    }
    expect(headers.some((name) => name === 'cookie' || name === 'authorization' || name === 'referer')).toBe(false);
    const record = storage.records().get(dump.urls[0]);
    expect(record?.headers.find((pair) => pair[0] === 'x-worldwide-sha256')?.[1]).toBe(item.sha256);
    expect(record?.headers.find((pair) => pair[0] === 'x-worldwide-revision')?.[1]).toBe(REV);
    expect(JSON.stringify(dump)).not.toContain('housing benefit');
  });

  it('refuses personal query and location fields and does not keep a history', async () => {
    const { cache } = harness();
    const item = artifact(REV, 'Public source text.');
    const personal = [
      { query: 'housing benefit' },
      { latitude: 52.37 },
      { longitude: 4.89 },
      { coordinates: { latitude: 52.37, longitude: 4.89 } },
      { address: 'Dam Square' },
      { location: 'Amsterdam' },
      { history: ['housing benefit'] },
      { searchQuery: 'article 6:162' },
    ];
    for (const extra of personal) {
      await expect(cache.put({ ...item, ...extra } as PublicArtifactInput)).rejects.toMatchObject({
        name: 'CacheError',
        code: 'personal-data',
      });
    }
    await expect(cache.put({ ...item, path: 'shards/article.json?q=housing+benefit' })).rejects.toBeInstanceOf(CacheError);
    await expect(cache.put({ ...item, path: '../secret.json' })).rejects.toMatchObject({ code: 'invalid' });
    await expect(cache.put({ ...item, path: '/etc/passwd' })).rejects.toMatchObject({ code: 'invalid' });
    await expect(cache.put({ ...item, sha256: 'ab'.repeat(32) })).rejects.toMatchObject({ code: 'integrity' });
    expect('saveQuery' in cache).toBe(false);
    expect('saveLocation' in cache).toBe(false);
    expect((await cache.dump()).entries).toEqual([]);
    expect((await cache.dump()).urls).toEqual([]);
    const stored = await cache.put(item);
    expect(stored.ok).toBe(true);
    const dump = await cache.dump();
    expect(JSON.stringify(dump)).not.toContain('housing benefit');
    expect(JSON.stringify(dump)).not.toContain('Dam Square');
    expect(JSON.stringify(dump)).not.toContain('latitude');
  });

  it('evicts the least recently used unsaved artifact and keeps saved sources', async () => {
    const { cache } = harness({ maxEntries: 2, maxSavedEntries: 2 });
    const first = artifact(REV, 'first', 'shards/first.json');
    const second = artifact(REV, 'second', 'shards/second.json');
    const third = artifact(REV, 'third', 'shards/third.json');
    const fourth = artifact(REV, 'fourth', 'shards/fourth.json');
    expect((await cache.put(first)).ok).toBe(true);
    expect((await cache.put(second)).ok).toBe(true);
    const evicted = await cache.put(third);
    expect(evicted).toMatchObject({ ok: true, code: 'stored', evicted: 1 });
    expect((await cache.read(buildIntegrityKey(first))).code).toBe('miss');
    expect((await cache.read(buildIntegrityKey(second))).code).toBe('hit');

    const displaced = await cache.put(fourth);
    expect(displaced.evicted).toBe(1);
    expect((await cache.read(buildIntegrityKey(second))).code).toBe('hit');
    expect((await cache.read(buildIntegrityKey(third))).code).toBe('miss');
    expect((await cache.read(buildIntegrityKey(fourth))).code).toBe('hit');

    const { cache: pinnedCache } = harness({ maxEntries: 2, maxSavedEntries: 2 });
    const saved = artifact(REV, 'saved source', 'shards/saved.json', true);
    const warm = artifact(REV, 'warm only', 'shards/warm.json');
    const incoming = artifact(REV, 'incoming', 'shards/incoming.json');
    expect((await pinnedCache.put(saved)).ok).toBe(true);
    expect((await pinnedCache.put(warm)).ok).toBe(true);
    expect((await pinnedCache.put(incoming)).evicted).toBe(1);
    expect((await pinnedCache.read(buildIntegrityKey(saved))).code).toBe('hit');
    expect((await pinnedCache.read(buildIntegrityKey(warm))).code).toBe('miss');
    expect((await pinnedCache.read(buildIntegrityKey(incoming))).code).toBe('hit');
    expect(await pinnedCache.listSaved()).toHaveLength(1);
  });

  it('enforces byte and saved quotas without deleting a saved source that does not fit', async () => {
    const { cache } = harness({ maxBytes: 10, maxEntryBytes: 10, maxEntries: 8, maxSavedEntries: 4 });
    const six = artifact(REV, '123456', 'shards/six.json');
    const also = artifact(REV, 'abcdef', 'shards/also.json');
    expect(six.bytes.byteLength).toBe(6);
    expect((await cache.put(six)).ok).toBe(true);
    const replaced = await cache.put(also);
    expect(replaced).toMatchObject({ ok: true, evicted: 1 });
    expect((await cache.read(buildIntegrityKey(six))).code).toBe('miss');
    expect((await cache.usage()).bytes).toBe(6);

    const saved = artifact(REV, '123456', 'shards/saved.json', true);
    const blocked = artifact(REV, 'abcdef', 'shards/blocked.json');
    const { cache: tight } = harness({ maxBytes: 10, maxEntryBytes: 10, maxEntries: 8, maxSavedEntries: 1 });
    expect((await tight.put(saved)).ok).toBe(true);
    const exhausted = await tight.put(blocked);
    expect(exhausted).toMatchObject({ ok: false, code: 'storage-exhausted', recovered: true, evicted: 0 });
    const kept = await tight.read(buildIntegrityKey(saved));
    expect(kept.code).toBe('hit');
    expect(bytesOf(kept.bytes)).toEqual(Array.from(saved.bytes));
    expect((await tight.read(buildIntegrityKey(blocked))).code).toBe('miss');

    const huge = artifact(REV, '0123456789', 'shards/huge.json');
    expect(huge.bytes.byteLength).toBe(10);
    const tooBig = await tight.put({ ...huge, bytes: utf8Bytes('0123456789X'), sha256: digestHex(utf8Bytes('0123456789X')) });
    expect(tooBig).toMatchObject({ ok: false, code: 'entry-too-large', recovered: true });
    expect((await tight.read(buildIntegrityKey(saved))).code).toBe('hit');

    const secondSaved = artifact(REV_B, 'saved-2', 'shards/saved-2.json', true);
    const overCap = await tight.put(secondSaved);
    expect(overCap.code).toBe('storage-exhausted');
    expect(await tight.listSaved()).toHaveLength(1);
  });

  it('recovers when CacheStorage raises QuotaExceededError', async () => {
    const { cache, storage } = harness();
    const saved = artifact(REV, 'keep this source', 'shards/saved.json', true);
    expect((await cache.put(saved)).ok).toBe(true);

    storage.failMode = 'before';
    storage.failPuts = 1;
    const retried = artifact(REV, 'retry me', 'shards/retry.json');
    const stored = await cache.put(retried);
    expect(stored).toMatchObject({ ok: true, code: 'stored', recovered: false });
    expect((await cache.read(buildIntegrityKey(retried))).code).toBe('hit');
    expect((await cache.read(buildIntegrityKey(saved))).code).toBe('hit');

    storage.failMode = 'after';
    storage.failPuts = 2;
    const partial = artifact(REV, 'partial write', 'shards/partial.json');
    const refused = await cache.put(partial);
    expect(refused).toMatchObject({ ok: false, code: 'storage-exhausted', recovered: true });
    expect((await cache.read(buildIntegrityKey(partial))).code).toBe('miss');
    const still = await cache.read(buildIntegrityKey(saved));
    expect(still.code).toBe('hit');
    expect(bytesOf(still.bytes)).toEqual(Array.from(saved.bytes));
    expect(await cache.listSaved()).toHaveLength(1);
    expect(await cache.usage()).toMatchObject({ entries: 1, savedEntries: 1 });
    const urls = (await cache.dump()).urls;
    expect(urls).toHaveLength(1);
    expect(urls[0].includes('?')).toBe(false);
  });

  it('shows a stale saved copy against the new catalog and drops unsaved entries atomically', async () => {
    const { cache, indexed } = harness();
    const saved = artifact(REV, 'saved statute', 'shards/statute.json', true);
    const warm = artifact(REV, 'warm shard', 'shards/warm.json');
    await cache.installCatalog(pin(REV, CATALOG_A));
    expect((await cache.put(saved)).ok).toBe(true);
    expect((await cache.put(warm)).ok).toBe(true);

    const fresh = await cache.read(buildIntegrityKey(saved));
    expect(fresh.visibility).toMatchObject({
      state: 'fresh',
      stale: false,
      offline: false,
      cachedRevision: REV,
      catalogRevision: REV,
      catalogIntegrity: CATALOG_A,
    });
    expect(fresh.visibility.visibleCopy).toBe('This saved copy matches the catalog revision.');

    const installed = await cache.installCatalog(pin(REV_B, CATALOG_B));
    expect(installed).toMatchObject({
      ok: true,
      code: 'installed',
      generation: 2,
      dropped: 1,
      retainedSaved: 1,
      catalogRevision: CATALOG_B,
      recovered: false,
    });
    expect((await cache.read(buildIntegrityKey(warm))).code).toBe('miss');
    const stale = await cache.read(buildIntegrityKey(saved));
    expect(stale).toMatchObject({ ok: true, code: 'hit', offered: true });
    expect(bytesOf(stale.bytes)).toEqual(Array.from(saved.bytes));
    expect(stale.visibility.state).toBe('stale-cache');
    expect(stale.visibility.stale).toBe(true);
    expect(stale.visibility.visibleCopy).toBe(STALE_VISIBLE);
    expect(stale.visibility.announcement).toBe(STALE_ANNOUNCEMENT);
    expect(stale.visibility.nextAction).toBe(STALE_NEXT);
    expect(stale.visibility.coverageCopy).toBe(STALE_COVERAGE);
    expect(stale.visibility.cachedRevision).toBe(REV);
    expect(stale.visibility.catalogRevision).toBe(REV_B);
    expect(stale.visibility.catalogIntegrity).toBe(CATALOG_B);
    expect(stale.visibility.differences).toEqual([
      { datasetId: DATASET, path: 'shards/statute.json', cachedRevision: REV, catalogRevision: REV_B },
    ]);
    expect(stale.entry?.freshness).toBe('stale');

    const raw = [...(indexed.entryStore()?.values() ?? [])][0] as { admittedCatalogRevision: string };
    expect(raw.admittedCatalogRevision).toBe(CATALOG_A);

    const removed = await cache.installCatalog({ catalogRevision: 'e'.repeat(64), sources: [{ datasetId: OTHER_DATASET, revision: REV_B }] });
    expect(removed.code).toBe('installed');
    const gone = await cache.read(buildIntegrityKey(saved));
    expect(gone.visibility.state).toBe('stale-cache');
    expect(gone.visibility.cachedRevision).toBe(REV);
    expect(gone.visibility.catalogRevision).toBeNull();
    expect(gone.visibility.catalogIntegrity).toBe('e'.repeat(64));
    expect(gone.offered).toBe(true);
  });

  it('offers only saved sources while offline', async () => {
    const { cache, network } = harness();
    const saved = artifact(REV, 'offline statute', 'shards/offline.json', true);
    const warm = artifact(REV, 'not saved', 'shards/warm.json');
    await cache.installCatalog(pin(REV, CATALOG_A));
    await cache.put(saved);
    await cache.put(warm);
    network.online = false;

    const offered = await cache.listSaved();
    expect(offered).toHaveLength(1);
    expect(offered[0]).toMatchObject({ path: 'shards/offline.json', saved: true, freshness: 'fresh' });
    const savedHit = await cache.read(buildIntegrityKey(saved));
    expect(savedHit).toMatchObject({ ok: true, offered: true, code: 'hit' });
    expect(bytesOf(savedHit.bytes)).toEqual(Array.from(saved.bytes));
    expect(savedHit.visibility.state).toBe('offline-saved');
    expect(savedHit.visibility.offline).toBe(true);
    expect(savedHit.visibility.visibleCopy).toBe(OFFLINE_VISIBLE);
    expect(savedHit.visibility.announcement).toBe(OFFLINE_ANNOUNCEMENT);
    expect(savedHit.visibility.nextAction).toBe(OFFLINE_NEXT);
    expect(savedHit.visibility.coverageCopy).toBe(OFFLINE_COVERAGE);
    expect(savedHit.visibility.cachedRevision).toBe(REV);
    expect(savedHit.visibility.catalogRevision).toBe(REV);

    const hidden = await cache.read(buildIntegrityKey(warm));
    expect(hidden).toMatchObject({ ok: false, code: 'not-saved-offline', offered: false, bytes: null });
    expect(hidden.visibility.visibleCopy).toBe(OFFLINE_VISIBLE);
    expect(hidden.visibility.coverageCopy).toBe(OFFLINE_COVERAGE);

    const page = await cache.visibility();
    expect(page.state).toBe('offline-saved');
    expect(page.savedCount).toBe(1);
    expect(page.visibleCopy).toBe(OFFLINE_VISIBLE);

    network.online = true;
    expect((await cache.read(buildIntegrityKey(warm))).code).toBe('hit');

    const { cache: empty, network: quiet } = harness();
    quiet.online = false;
    const none = await empty.visibility();
    expect(none.state).toBe('offline-saved');
    expect(none.visibleCopy).toBe('Offline. No saved material is on this device.');
    expect(none.coverageCopy).toBe(OFFLINE_COVERAGE);
    expect(none.savedCount).toBe(0);
  });

  it('keeps the stale revision visible while the device is offline', async () => {
    const { cache, network } = harness();
    const saved = artifact(REV, 'older statute', 'shards/older.json', true);
    await cache.installCatalog(pin(REV, CATALOG_A));
    await cache.put(saved);
    await cache.installCatalog(pin(REV_B, CATALOG_B));
    network.online = false;
    const hit = await cache.read(buildIntegrityKey(saved));
    expect(hit.offered).toBe(true);
    expect(bytesOf(hit.bytes)).toEqual(Array.from(saved.bytes));
    expect(hit.visibility.state).toBe('offline-saved');
    expect(hit.visibility.stale).toBe(true);
    expect(hit.visibility.visibleCopy).toBe(OFFLINE_VISIBLE);
    expect(hit.visibility.staleVisibleCopy).toBe(STALE_VISIBLE);
    expect(hit.visibility.staleAnnouncement).toBe(STALE_ANNOUNCEMENT);
    expect(hit.visibility.cachedRevision).toBe(REV);
    expect(hit.visibility.catalogRevision).toBe(REV_B);
    expect(hit.visibility.catalogIntegrity).toBe(CATALOG_B);
  });

  it('rolls a failed catalog install back and commits a later install once', async () => {
    const { cache, indexed } = harness();
    const saved = artifact(REV, 'pinned source', 'shards/pinned.json', true);
    const warm = artifact(REV, 'ephemeral shard', 'shards/ephemeral.json');
    expect((await cache.put(saved)).ok).toBe(true);
    expect((await cache.put(warm)).ok).toBe(true);

    indexed.failNextCommit = true;
    const aborted = await cache.installCatalog(pin(REV, CATALOG_A));
    expect(aborted).toMatchObject({ ok: false, code: 'aborted', recovered: true, dropped: 0, generation: 0 });
    expect((await cache.read(buildIntegrityKey(saved))).code).toBe('hit');
    expect((await cache.read(buildIntegrityKey(warm))).code).toBe('hit');
    expect(indexed.catalogStore()?.size ?? 0).toBe(0);
    expect((await cache.dump()).urls).toHaveLength(2);

    const first = await cache.installCatalog(pin(REV, CATALOG_A));
    expect(first).toMatchObject({ ok: true, code: 'installed', generation: 1, dropped: 1, retainedSaved: 1 });
    expect((await cache.read(buildIntegrityKey(warm))).code).toBe('miss');
    expect((await cache.read(buildIntegrityKey(saved))).code).toBe('hit');

    const againWarm = artifact(REV, 'still warm', 'shards/still-warm.json');
    expect((await cache.put(againWarm)).ok).toBe(true);
    const same = await cache.installCatalog(pin(REV, CATALOG_A));
    expect(same).toMatchObject({ ok: true, code: 'unchanged', generation: 1, dropped: 0 });
    expect((await cache.read(buildIntegrityKey(againWarm))).code).toBe('hit');

    indexed.failNextCommit = true;
    const abortedNext = await cache.installCatalog(pin(REV_B, CATALOG_B));
    expect(abortedNext).toMatchObject({ ok: false, code: 'aborted', recovered: true, generation: 1, catalogRevision: CATALOG_A });
    expect((await cache.read(buildIntegrityKey(againWarm))).code).toBe('hit');
    const snapshot = JSON.stringify([...(indexed.entryStore()?.values() ?? [])]);

    const next = await cache.installCatalog(pin(REV_B, CATALOG_B));
    expect(next).toMatchObject({ ok: true, code: 'installed', generation: 2, dropped: 1, retainedSaved: 1 });
    expect((await cache.read(buildIntegrityKey(againWarm))).code).toBe('miss');
    expect((await cache.read(buildIntegrityKey(saved))).code).toBe('hit');
    expect(snapshot).toContain('still-warm');
    expect(JSON.stringify([...(indexed.entryStore()?.values() ?? [])])).not.toContain('still-warm');
  });

  it('rejects a catalog revision that no longer matches its sources', async () => {
    const { cache } = harness();
    const saved = artifact(REV, 'stable source', 'shards/stable.json', true);
    await cache.installCatalog(pin(REV, CATALOG_A));
    await cache.put(saved);
    await expect(
      cache.installCatalog({ catalogRevision: CATALOG_A, sources: [{ datasetId: DATASET, revision: REV_B }] }),
    ).rejects.toMatchObject({ code: 'integrity' });
    const hit = await cache.read(buildIntegrityKey(saved));
    expect(hit.visibility.state).toBe('fresh');
    expect(hit.visibility.catalogIntegrity).toBe(CATALOG_A);
    expect(hit.visibility.catalogRevision).toBe(REV);
    expect((await cache.visibility()).catalogIntegrity).toBe(CATALOG_A);
  });

  it('recovers corrupt records, a bad catalog pin, and orphan bytes', async () => {
    const { cache, indexed, storage } = harness();
    const kept = artifact(REV, 'intact source', 'shards/intact.json', true);
    const broken = artifact(REV, 'broken source', 'shards/broken.json', true);
    await cache.installCatalog(pin(REV, CATALOG_A));
    await cache.put(kept);
    await cache.put(broken);

    let flipped = false;
    for (const record of storage.records().values()) {
      const text = String.fromCharCode(...record.body);
      if (text === 'broken source') {
        record.body[0] ^= 0xff;
        flipped = true;
      }
    }
    expect(flipped).toBe(true);
    const recovered = await cache.read(buildIntegrityKey(broken));
    expect(recovered).toMatchObject({
      ok: false,
      code: 'corrupt-recovered',
      offered: false,
      bytes: null,
      recovered: true,
      recoveryCopy: CORRUPT_RECOVERY,
    });
    expect((await cache.read(buildIntegrityKey(broken))).code).toBe('miss');
    const sibling = await cache.read(buildIntegrityKey(kept));
    expect(sibling.code).toBe('hit');
    expect(bytesOf(sibling.bytes)).toEqual(Array.from(kept.bytes));

    const orphan = artifact(REV, 'orphan bytes', 'shards/orphan.json');
    await cache.put(orphan);
    const orphanToken = buildIntegrityKey(orphan).token;
    expect(indexed.entryStore()?.delete(orphanToken)).toBe(true);
    await storage.api().open(CACHE_STORAGE_NAME).then((bucket) =>
      bucket.put(
        new FetchRequest('https://example.invalid/personal?q=secret') as unknown as Request,
        new FetchResponse('secret') as unknown as Response,
      ),
    );
    const entries = indexed.entryStore();
    const personalToken = buildIntegrityKey(kept).token;
    const personal = entries?.get(personalToken) as Record<string, unknown>;
    entries?.set(personalToken, { ...personal, query: 'housing benefit' });
    indexed.catalogStore()?.set('current', { id: 'current', query: 'secret', catalogRevision: 'nope' });

    const report = await cache.reconcile();
    expect(report).toMatchObject({ ok: true, catalogReset: true, recovered: true });
    expect(report.droppedEntries).toBeGreaterThanOrEqual(1);
    expect(report.droppedOrphans).toBeGreaterThanOrEqual(1);
    expect((await cache.read(buildIntegrityKey(orphan))).code).toBe('miss');
    expect((await cache.read(buildIntegrityKey(kept))).code).toBe('miss');
    const dump = await cache.dump();
    expect(JSON.stringify(dump)).not.toContain('housing benefit');
    expect(JSON.stringify(dump)).not.toContain('secret');
    expect(dump.catalog).toBeUndefined();
    expect((await cache.visibility()).state).toBe('empty');

    const restored = artifact(REV, 'restored source', 'shards/restored.json', true);
    expect((await cache.put(restored)).ok).toBe(true);
    expect((await cache.read(buildIntegrityKey(restored))).code).toBe('hit');
  });

  it('reopens IndexedDB and CacheStorage after a failed open', async () => {
    const { cache, indexed, storage } = harness();
    indexed.failOpens = 1;
    storage.failOpens = 1;
    await cache.ready();
    expect(indexed.opens).toBe(2);
    expect(indexed.deleted).toContain(CACHE_DATABASE);
    const item = artifact(REV, 'recovered after open failure', 'shards/recovered.json', true);
    expect((await cache.put(item)).ok).toBe(true);
    const hit = await cache.read(buildIntegrityKey(item));
    expect(hit.code).toBe('hit');
    expect(bytesOf(hit.bytes)).toEqual(Array.from(item.bytes));
    expect((await cache.visibility()).state).toBe('unpinned');
    expect((await cache.remove(buildIntegrityKey(item))).removed).toBe(true);
    expect((await cache.read(buildIntegrityKey(item))).code).toBe('miss');
  });
});

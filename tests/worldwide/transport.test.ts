import { utf8Bytes } from '../../src/lib/worldwide/data/identity';
import {
  ARTIFACT_SCHEMA,
  CAPABILITY_SCHEMA,
  TRANSPORT_LIMITS,
  VIEWER_COMPATIBILITY_SCHEMA,
  VIEWER_JOINS_SUPPORTED,
  VIEWER_REVISION_PIN_SUPPORTED,
  VIEWER_STEMMING,
  TransportError,
  buildArtifactUrl,
  buildViewerSplitsUrl,
  buildViewerUrl,
  chooseArtifactAccess,
  createArtifactTransport,
  interpretByteRangeResponse,
  parseViewerSplits,
  reconcileViewerPayload,
  sha256HexBytes,
  transportLimitations,
  type ArtifactTarget,
  type TransportCapability,
} from '../../src/lib/worldwide/data/transport';

const REV = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);
const DATASET = 'endomorphosis/ipfs_example_laws';
const PAGES = 'https://worldwidelaws.github.io';
const NOW = Date.parse('2026-11-03T00:00:00.000Z');

interface Call {
  url: string;
  init: RequestInit;
}

function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function bytesOf(text: string): Uint8Array {
  return utf8Bytes(text);
}

function responseFor(options: {
  url: string;
  status?: number;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  pulls?: { count: number };
}): Response {
  const body = typeof options.body === 'string' || options.body === undefined ? bytesOf(options.body ?? '') : options.body;
  const headers = new Headers(options.headers);
  if (!headers.has('content-length')) headers.set('content-length', String(body.byteLength));
  let read = false;
  const stream = {
    getReader() {
      return {
        async read(): Promise<{ done: boolean; value?: Uint8Array }> {
          if (read) return { done: true };
          read = true;
          if (options.pulls) options.pulls.count += 1;
          return { done: false, value: body };
        },
        async cancel(): Promise<void> {
          read = true;
        },
      };
    },
    async cancel(): Promise<void> {
      read = true;
    },
  };
  return {
    status: options.status ?? 200,
    ok: (options.status ?? 200) >= 200 && (options.status ?? 200) < 300,
    headers,
    url: options.url,
    body: stream,
    async arrayBuffer(): Promise<ArrayBuffer> {
      if (options.pulls) options.pulls.count += 1;
      return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer;
    },
  } as unknown as Response;
}

function probeOk(url: string, pulls?: { count: number }): Response {
  return responseFor({
    url,
    status: 206,
    pulls,
    headers: {
      'access-control-allow-origin': '*',
      'content-range': 'bytes 0-31/128',
      'accept-ranges': 'bytes',
    },
    body: '0123456789abcdef0123456789abcdef',
  });
}

function jsonArtifact(revision: string, text = 'The bounded article.'): { body: string; sha256: string; bytes: Uint8Array } {
  const body = JSON.stringify({ sourceRevision: revision, text });
  const bytes = bytesOf(body);
  return { body, sha256: sha256HexBytes(bytes), bytes };
}

function target(fields: Partial<ArtifactTarget> = {}): ArtifactTarget {
  const artifact = jsonArtifact(fields.revision ?? REV, 'The bounded article.');
  return {
    datasetId: DATASET,
    revision: REV,
    path: 'shards/example.json',
    sha256: artifact.sha256,
    sizeBytes: artifact.bytes.byteLength,
    mediaType: 'application/json',
    ...fields,
  };
}

function headerValue(init: RequestInit, name: string): string | null {
  const source = init.headers;
  if (!source) return null;
  const wanted = name.toLowerCase();
  // jsdom deletes Range inside the Headers constructor. Read a plain record
  // before copying so the probe header is still observable.
  if (Array.isArray(source)) {
    for (const [key, value] of source) {
      if (String(key).toLowerCase() === wanted) return String(value);
    }
    return null;
  }
  if (typeof source === 'object') {
    for (const [key, value] of Object.entries(source as Record<string, string>)) {
      if (key.toLowerCase() === wanted && typeof value === 'string') return value;
    }
    if (typeof (source as Headers).get === 'function') return (source as Headers).get(wanted);
  }
  return null;
}

function clientFor(
  fetchImpl: (url: string, init: RequestInit) => Promise<Response>,
  extras: { sleep?: (ms: number, signal: AbortSignal | undefined) => Promise<void>; maxAttempts?: number } = {},
) {
  return createArtifactTransport({
    fetch: fetchImpl,
    sleep: extras.sleep ?? (async () => undefined),
    now: () => NOW,
    pagesOrigin: PAGES,
    maxAttempts: extras.maxAttempts,
  });
}

function callsOf(records: Call[]): { fetch: (url: string, init: RequestInit) => Promise<Response>; full: () => Call[] } {
  return {
    fetch: async (url, init) => {
      records.push({ url, init });
      throw new Error(`unexpected fetch ${url}`);
    },
    full: () => records.filter((call) => !headerValue(call.init, 'range')),
  };
}

describe('immutable artifact transport', () => {
  test('keeps retries, concurrency, page length, and viewer assumptions bounded', () => {
    expect(TRANSPORT_LIMITS.maxAttempts).toBe(4);
    expect(TRANSPORT_LIMITS.defaultAttempts).toBe(3);
    expect(TRANSPORT_LIMITS.maxConcurrent).toBe(4);
    expect(TRANSPORT_LIMITS.maxBackoffMs).toBe(8000);
    expect(TRANSPORT_LIMITS.absoluteArtifactBytes).toBe(10 * 1024 * 1024);
    expect(TRANSPORT_LIMITS.viewerPageLength).toBe(100);
    expect(TRANSPORT_LIMITS.viewerMaxPages).toBe(4);
    expect(TRANSPORT_LIMITS.viewerSessionMaxRows).toBe(400);
    expect(VIEWER_JOINS_SUPPORTED).toBe(false);
    expect(VIEWER_REVISION_PIN_SUPPORTED).toBe(false);
    expect(transportLimitations().join('\n')).toContain('does not join');
    expect(transportLimitations().join('\n')).toContain('SharedArrayBuffer is not assumed');
    expect(() => createArtifactTransport({ maxAttempts: 100 })).toThrow(TransportError);
    expect(() => buildArtifactUrl(DATASET, 'main', 'shards/example.json')).toThrow(TransportError);
    expect(() => buildArtifactUrl(DATASET, REV, '../secrets.json')).toThrow(TransportError);
    expect(buildArtifactUrl(DATASET, REV, 'shards/example.json')).toBe(
      `https://huggingface.co/datasets/endomorphosis/ipfs_example_laws/resolve/${REV}/shards/example.json`,
    );
  });

  test('retries a transient status inside the attempt bound and sends no credential', async () => {
    const artifact = jsonArtifact(REV);
    const calls: Call[] = [];
    const sleeps: number[] = [];
    let full = 0;
    const client = clientFor(async (url, init) => {
      calls.push({ url, init });
      if (headerValue(init, 'range')) return probeOk(url);
      full += 1;
      if (full < 3) return responseFor({ url, status: 500, body: 'busy' });
      return responseFor({
        url,
        headers: { 'content-type': 'application/json', 'x-repo-commit': REV, 'access-control-allow-origin': '*' },
        body: artifact.body,
      });
    }, { sleep: async (ms) => { sleeps.push(ms); } });

    const result = await client.fetchArtifact(target({ sha256: artifact.sha256, sizeBytes: artifact.bytes.byteLength }));

    expect(result.schema).toBe(ARTIFACT_SCHEMA);
    expect(result.sha256).toBe(artifact.sha256);
    expect(result.revision).toBe(REV);
    expect(result.revisionConfirmed).toBe(true);
    expect(result.revisionEvidence).toBe('header');
    expect(result.attempts).toBe(3);
    expect(full).toBe(3);
    expect(sleeps).toEqual([200, 400]);
    for (const call of calls) {
      expect(call.init.method).toBe('GET');
      expect(call.init.credentials).toBe('omit');
      expect(call.init.referrerPolicy).toBe('no-referrer');
      expect(headerValue(call.init, 'authorization')).toBeNull();
    }
  });

  test('does not sleep again after the final retry and does not retry a 404 or a bad hash', async () => {
    const artifact = jsonArtifact(REV);
    const sleeps: number[] = [];
    let mode: 'exhaust' | 'missing' | 'bad-hash' = 'exhaust';
    let full = 0;
    const client = clientFor(async (url, init) => {
      if (headerValue(init, 'range')) return probeOk(url);
      full += 1;
      if (mode === 'missing') return responseFor({ url, status: 404, body: 'missing' });
      if (mode === 'bad-hash') {
        return responseFor({
          url,
          headers: { 'content-type': 'application/json', 'x-repo-commit': REV },
          body: '{"sourceRevision":"' + REV + '","text":"other"}',
        });
      }
      return responseFor({ url, status: 503, body: 'down' });
    }, { sleep: async (ms) => { sleeps.push(ms); } });

    const pinned = target({ sha256: artifact.sha256, sizeBytes: artifact.bytes.byteLength });
    await expect(client.fetchArtifact(pinned)).rejects.toMatchObject({ code: 'retry-exhausted', attempts: 3 });
    expect(sleeps).toHaveLength(2);
    expect(full).toBe(3);

    mode = 'missing';
    full = 0;
    sleeps.length = 0;
    const missing = createArtifactTransport({
      fetch: async (url, init) => {
        if (headerValue(init, 'range')) return probeOk(url);
        full += 1;
        return responseFor({ url, status: 404, body: 'missing' });
      },
      sleep: async (ms) => { sleeps.push(ms); },
      now: () => NOW,
      pagesOrigin: PAGES,
    });
    await expect(missing.fetchArtifact(target({ path: 'shards/missing.json', sha256: artifact.sha256 }))).rejects.toMatchObject({
      code: 'http',
      status: 404,
    });
    expect(full).toBe(1);
    expect(sleeps).toEqual([]);

    const corrupt = createArtifactTransport({
      fetch: async (url, init) => {
        if (headerValue(init, 'range')) return probeOk(url);
        full += 1;
        return responseFor({
          url,
          headers: { 'content-type': 'application/json', 'x-repo-commit': REV },
          body: '{"sourceRevision":"' + REV + '","text":"other"}',
        });
      },
      sleep: async () => { sleeps.push(1); },
      now: () => NOW,
      pagesOrigin: PAGES,
    });
    full = 0;
    await expect(corrupt.fetchArtifact(target({ path: 'shards/corrupt.json', sha256: artifact.sha256 }))).rejects.toMatchObject({
      code: 'integrity',
    });
    expect(full).toBe(1);
    expect(sleeps).toEqual([]);
  });

  test('honors a short Retry-After and refuses one outside the backoff bound', async () => {
    const artifact = jsonArtifact(REV);
    const sleeps: number[] = [];
    let full = 0;
    const limited = clientFor(async (url, init) => {
      if (headerValue(init, 'range')) return probeOk(url);
      full += 1;
      if (full === 1) return responseFor({ url, status: 429, headers: { 'retry-after': '1' }, body: 'slow' });
      return responseFor({
        url,
        headers: { 'content-type': 'application/json', 'x-repo-commit': REV },
        body: artifact.body,
      });
    }, { sleep: async (ms) => { sleeps.push(ms); } });
    await limited.fetchArtifact(target({ sha256: artifact.sha256, sizeBytes: artifact.bytes.byteLength }));
    expect(sleeps).toEqual([1000]);

    let distantSleeps = 0;
    let distantFull = 0;
    const distant = createArtifactTransport({
      fetch: async (url, init) => {
        if (headerValue(init, 'range')) return probeOk(url);
        distantFull += 1;
        return responseFor({
          url,
          status: 429,
          headers: { 'retry-after': 'Wed, 21 Oct 2037 07:28:00 GMT' },
          body: 'later',
        });
      },
      sleep: async () => { distantSleeps += 1; },
      now: () => NOW,
      pagesOrigin: PAGES,
    });
    await expect(distant.fetchArtifact(target({ path: 'shards/later.json', sha256: artifact.sha256 }))).rejects.toMatchObject({
      code: 'retry-after-exceeds-bound',
    });
    expect(distantFull).toBe(1);
    expect(distantSleeps).toBe(0);
  });

  test('cancellation skips the first fetch and stops a retry during backoff', async () => {
    const calls: Call[] = [];
    const aborted = new AbortController();
    aborted.abort();
    const idle = clientFor(async (url, init) => {
      calls.push({ url, init });
      return probeOk(url);
    });
    await expect(idle.fetchArtifact(target(), aborted.signal)).rejects.toMatchObject({ code: 'cancelled' });
    expect(calls).toEqual([]);

    const release = deferred<void>();
    let full = 0;
    const controller = new AbortController();
    const retrying = createArtifactTransport({
      fetch: async (url, init) => {
        if (headerValue(init, 'range')) return probeOk(url);
        full += 1;
        return responseFor({ url, status: 500, body: 'busy' });
      },
      sleep: async (_ms, signal) => {
        release.resolve();
        await new Promise<void>((_resolve, reject) => {
          const onAbort = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          if (signal?.aborted) onAbort();
          else signal?.addEventListener('abort', onAbort, { once: true });
        });
      },
      now: () => NOW,
      pagesOrigin: PAGES,
    });
    const pending = retrying.fetchArtifact(target({ path: 'shards/cancel.json' }), controller.signal);
    await release.promise;
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
    expect(full).toBe(1);
  });

  test('measures CORS and Range without treating COOP or COEP as isolation', async () => {
    const pulls = { count: 0 };
    const ranged = clientFor(async (url, init) => {
      expect(headerValue(init, 'range')).toBe('bytes=0-31');
      return responseFor({
        url,
        status: 206,
        headers: {
          'access-control-allow-origin': '*',
          'content-range': 'bytes 0-31/4096',
          'accept-ranges': 'bytes',
          'cross-origin-opener-policy': 'same-origin',
          'cross-origin-embedder-policy': 'require-corp',
        },
        body: '0123456789abcdef0123456789abcdef',
      });
    });
    const allowed = await ranged.discoverCapability({
      url: buildArtifactUrl(DATASET, REV, 'shards/example.json'),
      declaredResourceBytes: 4096,
    });
    expect(allowed.schema).toBe(CAPABILITY_SCHEMA);
    expect(allowed.cors).toBe(true);
    expect(allowed.range).toBe(true);
    expect(allowed.live).toBe(false);
    expect(allowed.originProof).toBe('unproven');
    expect(allowed.crossOriginIsolationAssumed).toBe(false);
    expect(allowed.sharedArrayBufferAssumed).toBe(false);
    expect(allowed.workerModel).toBe('single-thread');
    expect(allowed.ignoredIsolationHeaders).toEqual(['cross-origin-opener-policy', 'cross-origin-embedder-policy']);
    expect(allowed.credentials).toBe('omit');

    const refused = clientFor(async (url) => responseFor({
      url,
      status: 200,
      pulls,
      headers: {
        'access-control-allow-origin': PAGES,
        'accept-ranges': 'bytes',
        'content-length': '80000000',
        'cross-origin-embedder-policy': 'require-corp',
      },
      body: '',
    }));
    const blocked = await refused.discoverCapability({
      url: buildArtifactUrl(DATASET, REV, 'country/train.parquet'),
      declaredResourceBytes: 80_000_000,
    });
    expect(blocked.cors).toBe(true);
    expect(blocked.range).toBe(false);
    expect(blocked.bodyRefused).toBe(true);
    expect(blocked.shardFallbackRequired).toBe(true);
    expect(blocked.sharedArrayBufferAssumed).toBe(false);
    expect(pulls.count).toBe(0);

    const foreign = await clientFor(async (url) => responseFor({
      url,
      status: 200,
      headers: { 'access-control-allow-origin': 'https://example.test', 'content-length': '4' },
      body: 'nope',
    })).discoverCapability({ url: buildArtifactUrl(DATASET, REV, 'shards/foreign.json') });
    expect(foreign.cors).toBe(false);
    expect(foreign.range).toBe(false);

    const offline = await clientFor(async () => {
      throw new TypeError('Failed to fetch');
    }).discoverCapability({ url: buildArtifactUrl(DATASET, REV, 'shards/offline.json') });
    expect(offline.cors).toBe(false);
    expect(offline.range).toBe(false);
    expect(offline.failure).toBe('network');
    expect(offline.live).toBe(false);
  });

  test('refuses revision mixing, unpinned viewer rows, and country-sized downloads', async () => {
    const artifact = jsonArtifact(REV);
    let full = 0;
    const responses = new Map<string, () => Response>();
    const client = clientFor(async (url, init) => {
      if (headerValue(init, 'range')) return probeOk(url);
      full += 1;
      const made = responses.get(new URL(url).pathname);
      if (!made) throw new Error(`missing ${url}`);
      return made();
    });
    responses.set(`/datasets/endomorphosis/ipfs_example_laws/resolve/${REV}/shards/mismatch.json`, () => responseFor({
      url: `https://cdn-lfs.huggingface.co/datasets/example/resolve/${OTHER}/shards/mismatch.json`,
      headers: { 'content-type': 'application/json', 'x-repo-commit': OTHER },
      body: artifact.body,
    }));
    await expect(client.fetchArtifact(target({
      path: 'shards/mismatch.json',
      sha256: artifact.sha256,
      sizeBytes: artifact.bytes.byteLength,
    }))).rejects.toMatchObject({ code: 'revision-mismatch' });
    expect(full).toBe(1);

    const mixedBody = jsonArtifact(OTHER);
    responses.set(`/datasets/endomorphosis/ipfs_example_laws/resolve/${REV}/shards/embedded.json`, () => responseFor({
      url: buildArtifactUrl(DATASET, REV, 'shards/embedded.json'),
      headers: { 'content-type': 'application/json', 'x-repo-commit': REV },
      body: mixedBody.body,
    }));
    full = 0;
    await expect(client.fetchArtifact(target({
      path: 'shards/embedded.json',
      sha256: mixedBody.sha256,
      sizeBytes: mixedBody.bytes.byteLength,
    }))).rejects.toMatchObject({ code: 'revision-mix' });
    expect(full).toBe(1);

    const quiet = jsonArtifact(REV, 'cdn copy');
    responses.set(`/datasets/endomorphosis/ipfs_example_laws/resolve/${REV}/shards/cdn.json`, () => responseFor({
      url: 'https://cdn-lfs.huggingface.co/repos/example/cdn.json',
      headers: { 'content-type': 'application/json' },
      body: quiet.body,
    }));
    await expect(client.fetchArtifact(target({
      path: 'shards/cdn.json',
      sha256: quiet.sha256,
      sizeBytes: quiet.bytes.byteLength,
      requireConfirmedRevision: true,
    }))).rejects.toMatchObject({ code: 'revision-unconfirmed' });

    const confirmed = await client.fetchArtifact(target({
      path: 'shards/cdn.json',
      sha256: quiet.sha256,
      sizeBytes: quiet.bytes.byteLength,
    }));
    expect(confirmed.revisionConfirmed).toBe(false);
    expect(confirmed.revisionEvidence).toBe('sha256-only');
    expect(confirmed.bytes.byteLength).toBe(quiet.bytes.byteLength);

    const batchCalls: Call[] = [];
    const batch = clientFor(async (url, init) => {
      batchCalls.push({ url, init });
      return probeOk(url);
    });
    await expect(batch.fetchArtifactBatch([
      target({ path: 'shards/one.json' }),
      target({ path: 'shards/two.json', revision: OTHER }),
    ])).rejects.toMatchObject({ code: 'revision-mix' });
    expect(batchCalls).toEqual([]);

    let countryFull = 0;
    const country = clientFor(async (url, init) => {
      if (headerValue(init, 'range')) return probeOk(url);
      countryFull += 1;
      return responseFor({ url, body: 'should-not-download' });
    });
    await expect(country.fetchArtifact(target({
      path: 'country/train.parquet',
      mediaType: 'application/vnd.apache.parquet',
      sizeBytes: null,
      sha256: artifact.sha256,
    }))).rejects.toMatchObject({ code: 'unbounded-country-download' });
    await expect(country.fetchArtifact(target({
      path: 'country/train.parquet',
      sizeBytes: 80 * 1024 * 1024,
      maxBytes: 2 * 1024 * 1024,
      sha256: artifact.sha256,
    }))).rejects.toMatchObject({ code: 'unbounded-country-download' });
    await expect(country.fetchArtifact(target({
      path: 'country/medium.parquet',
      sizeBytes: 5 * 1024 * 1024,
      maxBytes: 8 * 1024 * 1024,
      sha256: artifact.sha256,
    }))).rejects.toMatchObject({ code: 'unbounded-country-download' });
    expect(countryFull).toBe(0);

    const slice = bytesOf('0123456789abcdef');
    const sliceSha = sha256HexBytes(slice);
    let sliceRange = '';
    const sliced = clientFor(async (url, init) => {
      const range = headerValue(init, 'range');
      if (range === 'bytes=0-31') return probeOk(url);
      sliceRange = range ?? '';
      return responseFor({
        url,
        status: 206,
        headers: {
          'content-type': 'application/octet-stream',
          'content-range': 'bytes 0-15/80000000',
          'x-repo-commit': REV,
        },
        body: slice,
      });
    });
    const partial = await sliced.fetchArtifact(target({
      path: 'country/train.parquet',
      mediaType: 'application/octet-stream',
      sizeBytes: 80_000_000,
      sha256: sliceSha,
      range: { start: 0, end: 15 },
      maxBytes: 64,
    }));
    expect(sliceRange).toBe('bytes=0-15');
    expect(partial.sizeBytes).toBe(16);
    expect(partial.sha256).toBe(sliceSha);

    const wholeSlice = clientFor(async (url, init) => {
      if (headerValue(init, 'range')) return probeOk(url);
      countryFull += 1;
      return responseFor({ url, body: 'nope' });
    });
    await expect(wholeSlice.fetchArtifact(target({
      path: 'country/train.parquet',
      sizeBytes: 80_000_000,
      sha256: artifact.sha256,
      range: { start: 0, end: 80_000_000 - 1 },
      maxBytes: 10 * 1024 * 1024,
    }))).rejects.toMatchObject({ code: 'unbounded-country-download' });
  });

  test('stops a second large shard when the session budget is already reserved', async () => {
    const artifact = jsonArtifact(REV);
    let full = 0;
    const hold = deferred<void>();
    const started = deferred<void>();
    const client = clientFor(async (url, init) => {
      if (headerValue(init, 'range')) return probeOk(url);
      full += 1;
      if (full === 1) started.resolve();
      await hold.promise;
      return responseFor({
        url,
        headers: { 'content-type': 'application/json', 'x-repo-commit': REV },
        body: artifact.body,
      });
    });
    const budget = 6 * 1024 * 1024;
    const first = client.fetchArtifact(target({
      path: 'shards/a.json',
      sha256: artifact.sha256,
      sizeBytes: budget,
      maxBytes: budget,
    }));
    await started.promise;
    await expect(client.fetchArtifact(target({
      path: 'shards/b.json',
      sha256: artifact.sha256,
      sizeBytes: budget,
      maxBytes: budget,
    }))).rejects.toMatchObject({ code: 'unbounded-country-download' });
    expect(full).toBe(1);
    hold.resolve();
    await first;
  });

  test('keeps at most four artifact requests in flight', async () => {
    const artifact = jsonArtifact(REV);
    let entered = 0;
    const sawFour = deferred<void>();
    const hold = deferred<void>();
    const client = clientFor(async (url, init) => {
      entered += 1;
      if (entered === 4) sawFour.resolve();
      await hold.promise;
      if (headerValue(init, 'range')) return probeOk(url);
      return responseFor({
        url,
        headers: { 'content-type': 'application/json', 'x-repo-commit': REV },
        body: artifact.body,
      });
    });
    const pending = Promise.all([0, 1, 2, 3, 4].map((index) => client.fetchArtifact(target({
      path: `shards/${index}.json`,
      sha256: artifact.sha256,
      sizeBytes: artifact.bytes.byteLength,
    }))));
    await sawFour.promise;
    await Promise.resolve();
    expect(entered).toBe(4);
    hold.resolve();
    const results = await pending;
    expect(results).toHaveLength(5);
    expect(entered).toBe(10);
  });
});

describe('measured dataset viewer compatibility', () => {
  test('pages configs and splits without a revision pin or a join', async () => {
    const layout = parseViewerSplits(DATASET, {
      splits: [
        { dataset: DATASET, config: 'laws', split: 'train', num_rows: 3, num_bytes: 30 },
        { dataset: 'other/corpus', config: 'laws', split: 'train', num_rows: 9 },
        { dataset: DATASET, config: 'articles', split: 'validation', num_rows: 2 },
        { dataset: DATASET, config: 'articles', split: 'train', num_rows: 8 },
      ],
      pending: [{ config: 'vectors' }],
      failed: [{ config: 'graph' }],
      joins_supported: true,
      revision_pin_supported: true,
    }, REV);
    expect(layout.configs.map((config) => config.name)).toEqual(['articles', 'laws']);
    expect(layout.configs[0]?.splits.map((split) => split.name)).toEqual(['train', 'validation']);
    expect(layout.foreignDatasetsDropped).toBe(1);
    expect(layout.pending).toEqual(['vectors']);
    expect(layout.failed).toEqual(['graph']);
    expect(layout.joinsSupported).toBe(false);
    expect(layout.revisionPinSupported).toBe(false);
    expect(layout.requestedRevision).toBe(REV);
    expect(buildViewerSplitsUrl(DATASET).includes('revision=')).toBe(false);

    const urls: string[] = [];
    const client = clientFor(async (url) => {
      urls.push(url);
      const parsed = new URL(url);
      if (parsed.pathname === '/splits') {
        return responseFor({
          url,
          body: JSON.stringify({
            splits: [
              { dataset: DATASET, config: 'articles', split: 'train', num_rows: 5000 },
            ],
            joins_supported: true,
          }),
        });
      }
      const offset = Number(parsed.searchParams.get('offset'));
      const rows = Array.from({ length: 100 }, (_, index) => ({ row_idx: offset + index, row: { text: 'law' } }));
      return responseFor({
        url,
        body: JSON.stringify({
          rows,
          num_rows_total: 5000,
          num_rows_per_page: 100,
          partial: false,
          joins_supported: true,
          revision_pin_supported: true,
        }),
      });
    });

    const walked = await client.paginateViewer({
      datasetId: DATASET,
      config: 'articles',
      split: 'train',
      offset: 0,
      length: 500,
      kind: 'rows',
    });
    expect(walked.complete).toBe(false);
    expect(walked.stoppedReason).toBe('page-budget');
    expect(walked.rows).toHaveLength(400);
    expect(walked.joinsSupported).toBe(false);
    expect(walked.revisionPinSupported).toBe(false);
    expect(walked.pages).toHaveLength(4);
    expect(urls).toHaveLength(4);
    expect(urls.every((url) => new URL(url).searchParams.get('length') === '100')).toBe(true);
    expect(urls.every((url) => !url.includes('revision='))).toBe(true);
    expect(new URL(buildViewerUrl({
      datasetId: DATASET,
      config: 'articles',
      split: 'train',
      offset: 0,
      length: 500,
      kind: 'rows',
      requestedRevision: REV,
    })).searchParams.get('length')).toBe('100');

    const partial = createArtifactTransport({
      fetch: async (url) => responseFor({
        url,
        body: JSON.stringify({
          rows: [{ row_idx: 0, row: { text: 'partial' } }],
          num_rows_total: 5000,
          partial: true,
        }),
      }),
      sleep: async () => undefined,
      now: () => NOW,
      pagesOrigin: PAGES,
    });
    const incomplete = await partial.paginateViewer({
      datasetId: DATASET,
      config: 'articles',
      split: 'train',
      length: 100,
      kind: 'rows',
    });
    expect(incomplete.complete).toBe(false);
    expect(incomplete.stoppedReason).toBe('partial-index');
    expect(incomplete.rows).toEqual([{ text: 'partial' }]);
    expect(incomplete.pages).toHaveLength(1);
  });

  test('withholds viewer rows that are not the pinned revision and never enables joins or pinning', async () => {
    const seen: string[] = [];
    const client = clientFor(async (url) => {
      seen.push(url);
      return responseFor({
        url,
        body: JSON.stringify({
          commit: OTHER,
          dataset: DATASET,
          joins_supported: true,
          revision_pin_supported: true,
          rows: [{ row_idx: 0, row: { text: 'current branch', sourceRevision: OTHER }, truncated_cells: [] }],
          num_rows_total: 10,
        }),
      });
    });
    const mixed = await client.readViewerPage({
      datasetId: DATASET,
      config: 'articles',
      split: 'train',
      length: 20,
      kind: 'rows',
      requestedRevision: REV,
    });
    expect(mixed.withheld).toBe(true);
    expect(mixed.withheldReason).toBe('revision-mix');
    expect(mixed.rows).toEqual([]);
    expect(mixed.observedRowCount).toBe(1);
    expect(mixed.joinsSupported).toBe(false);
    expect(mixed.revisionPinSupported).toBe(false);
    expect(mixed.reconciled).toBe(false);
    expect(mixed.multilingualComplete).toBe(false);
    expect(mixed.stemming).toBe(VIEWER_STEMMING);
    expect(seen[0]?.includes('revision=')).toBe(false);

    const unconfirmed = reconcileViewerPayload({
      dataset: DATASET,
      requestedRevision: REV,
      payload: {
        joins_supported: true,
        revision_pin_supported: true,
        rows: [{ row: { text: 'unpinned' } }],
      },
    });
    expect(unconfirmed.withheldReason).toBe('viewer-revision-unconfirmed');
    expect(unconfirmed.rows).toEqual([]);
    expect(unconfirmed.joinsSupported).toBe(false);
    expect(unconfirmed.revisionPinSupported).toBe(false);

    const matched = reconcileViewerPayload({
      dataset: DATASET,
      requestedRevision: REV,
      payload: {
        commit: REV,
        joins_supported: true,
        revision_pin_supported: true,
        rows: [{ row: { text: 'pinned', sourceRevision: REV } }],
        partial: false,
      },
    });
    expect(matched.reconciled).toBe(true);
    expect(matched.rows).toEqual([{ text: 'pinned', sourceRevision: REV }]);
    expect(matched.joinsSupported).toBe(false);
    expect(matched.revisionPinSupported).toBe(false);

    await expect(client.readViewerPage({
      datasetId: DATASET,
      config: 'articles',
      split: 'train',
      length: 10,
      kind: 'search',
      query: 'wet',
      where: 'title = law',
      requestedRevision: REV,
    })).rejects.toMatchObject({ code: 'viewer-join-unsupported' });
    await expect(client.readViewerPage({
      datasetId: DATASET,
      config: 'articles',
      split: 'train',
      length: 10,
      kind: 'filter',
      where: "title = 'join'",
    })).rejects.toMatchObject({ code: 'viewer-join-unsupported' });
    expect(seen).toHaveLength(1);

    let pages = 0;
    const capped = clientFor(async (url) => {
      pages += 1;
      const rows = Array.from({ length: 100 }, () => ({ row: { text: 'row' } }));
      return responseFor({ url, body: JSON.stringify({ rows, num_rows_total: 10000, commit: REV }) });
    });
    await capped.paginateViewer({
      datasetId: DATASET,
      config: 'articles',
      split: 'train',
      length: 100,
      kind: 'rows',
      requestedRevision: REV,
    });
    await expect(capped.readViewerPage({
      datasetId: DATASET,
      config: 'articles',
      split: 'train',
      offset: 400,
      length: 100,
      kind: 'rows',
      requestedRevision: REV,
    })).rejects.toMatchObject({ code: 'unbounded-country-download' });
    expect(pages).toBe(4);
  });

  test('records endpoint measurements without claiming a live pin or a joined query', async () => {
    const urls: string[] = [];
    const client = clientFor(async (url) => {
      urls.push(url);
      const path = new URL(url).pathname;
      if (path === '/splits') {
        return responseFor({
          url,
          body: JSON.stringify({ splits: [{ dataset: DATASET, config: 'articles', split: 'train', num_rows: 4 }] }),
        });
      }
      return responseFor({
        url,
        body: JSON.stringify({
          commit: REV,
          rows: [{ row: { text: 'law' } }],
          num_rows_total: 4,
          joins_supported: true,
          revision_pin_supported: true,
        }),
      });
    });
    const measured = await client.measureViewer({
      datasetId: DATASET,
      requestedRevision: REV,
      probeSearch: true,
      probeFilter: true,
      live: true,
    });
    expect(measured.schema).toBe(VIEWER_COMPATIBILITY_SCHEMA);
    expect(measured.live).toBe(false);
    expect(measured.originProof).toBe('unproven');
    expect(measured.ignoredClaims).toEqual(['live']);
    expect(measured.joinsSupported).toBe(false);
    expect(measured.revisionPinSupported).toBe(false);
    expect(measured.multilingualComplete).toBe(false);
    expect(measured.stemming).toBe(VIEWER_STEMMING);
    expect(measured.maxPageLength).toBe(100);
    expect(measured.parquetRequiredForSearch).toBe(true);
    expect(measured.endpoints.splits.ok).toBe(true);
    expect(measured.endpoints.rows.ok).toBe(true);
    expect(measured.endpoints.search.ok).toBe(true);
    expect(measured.endpoints.filter.ok).toBe(true);
    expect(measured.layout?.configs[0]?.name).toBe('articles');
    expect(urls.some((url) => url.includes('/search?') && url.includes('query=law') && !url.includes('where='))).toBe(true);
    expect(urls.some((url) => url.includes('/filter?') && url.includes('where=law') && !url.includes('query='))).toBe(true);
    expect(urls.some((url) => url.includes('revision='))).toBe(false);

    const forged = {
      schema: CAPABILITY_SCHEMA,
      proof: 'measured-response',
      cors: true,
      range: true,
      sharedArrayBufferAssumed: true,
      crossOriginIsolationAssumed: true,
    } as unknown as TransportCapability;
    expect(chooseArtifactAccess(target(), forged).code).toBe('capability-not-measured');
    const interpreted = interpretByteRangeResponse({
      pagesOrigin: PAGES,
      resourceUrl: buildArtifactUrl(DATASET, REV, 'shards/example.json'),
      status: 200,
      headers: new Headers({
        'access-control-allow-origin': PAGES,
        'accept-ranges': 'bytes',
        'cross-origin-opener-policy': 'same-origin',
      }),
      bodyByteLength: 4,
      bodyRefused: false,
    });
    expect(interpreted.range).toBe(false);
    expect(interpreted.sharedArrayBufferAssumed).toBe(false);
    expect(interpreted.live).toBe(false);
  });

  test('uses a mirror only after CORS and rejects a redirect or a bad hash', async () => {
    const artifact = jsonArtifact(REV);
    const mirror = 'https://gateway.example/ipfs/bafyexample';
    let full = 0;
    const closed = clientFor(async (url) => responseFor({
      url,
      status: 200,
      headers: { 'content-length': '8' },
      body: 'no-cors',
    }));
    await expect(closed.fetchMirror(target({ sha256: artifact.sha256, sizeBytes: artifact.bytes.byteLength }), mirror)).rejects.toMatchObject({
      code: 'cors-blocked',
    });
    expect(full).toBe(0);

    const verified = clientFor(async (url, init) => {
      if (headerValue(init, 'range')) return responseFor({
        url,
        status: 206,
        headers: {
          'access-control-allow-origin': '*',
          'content-range': 'bytes 0-31/128',
        },
        body: '0123456789abcdef0123456789abcdef',
      });
      full += 1;
      return responseFor({
        url,
        headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
        body: artifact.body,
      });
    });
    const copied = await verified.fetchMirror(target({
      sha256: artifact.sha256,
      sizeBytes: artifact.bytes.byteLength,
    }), mirror);
    expect(copied.sha256).toBe(artifact.sha256);
    expect(full).toBe(1);

    const redirected = clientFor(async (url, init) => {
      if (headerValue(init, 'range')) return responseFor({
        url,
        status: 206,
        headers: { 'access-control-allow-origin': '*', 'content-range': 'bytes 0-31/128' },
        body: '0123456789abcdef0123456789abcdef',
      });
      return responseFor({
        url: 'https://evil.example/steal',
        headers: { 'access-control-allow-origin': '*' },
        body: artifact.body,
      });
    });
    await expect(redirected.fetchMirror(target({
      path: 'shards/redirect.json',
      sha256: artifact.sha256,
      sizeBytes: artifact.bytes.byteLength,
    }), mirror)).rejects.toMatchObject({ code: 'unsafe-url' });
    await expect(redirected.fetchMirror(target(), 'http://gateway.example/ipfs/plain')).rejects.toMatchObject({
      code: 'unsafe-url',
    });
  });
});

/**
 * Source and transport failures from the static Pages origin.
 *
 * The dated hosted-transport record is reinterpreted by the production
 * capability function. A Chromium document at the Pages origin repeats the
 * Range probe. Deterministic 429, outage, corruption, missing Viewer, and
 * capped Viewer responses are fulfilled on that same origin so the browser
 * enforces CORS. Partial, sample, and offline states stay explicit.
 */

import { expect, test, type Page, type Request } from '@playwright/test';
import * as esbuild from 'esbuild';

// Validation HOME is a fresh directory, so the Playwright browser cache is
// absent. Launch the system Chrome that is installed outside that home.
test.use({
  launchOptions: {
    executablePath: '/opt/google/chrome/chrome',
    args: ['--disable-dev-shm-usage'],
  },
});
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PAGES = 'https://worldwidelaws.github.io';
const DATASET = 'endomorphosis/ipfs_example_laws';
const REV = 'a'.repeat(40);
const SAMPLE_CID = 'bafywetwijzer000000000000000000000000000000000000000000000001';
const RESOURCE = 'https://huggingface.co/datasets/google/fleurs/resolve/main/README.md';
const EXPOSE = [
  'Access-Control-Allow-Origin',
  'Content-Range',
  'Accept-Ranges',
  'Retry-After',
  'X-Repo-Commit',
  'Content-Length',
  'Content-Type',
].join(', ');
const CASES = [
  'rate-limit-429',
  'outage-503',
  'integrity-mismatch',
  'missing-viewer',
  'viewer-page-cap',
  'viewer-server-over-cap',
  'viewer-partial-index',
  'viewer-page-budget',
];

const ENTRY = `
export {
  createArtifactTransport,
  interpretByteRangeResponse,
  TransportError,
  sha256HexBytes,
  buildArtifactUrl,
  DEFAULT_PAGES_ORIGIN,
  TRANSPORT_LIMITS,
} from './src/lib/worldwide/data/transport.ts';
export { parseRoute } from './src/lib/worldwide/routes.ts';
export { shellBootHref } from './src/components/worldwide/SearchContext.tsx';
export { chooseResultState } from './src/components/worldwide/SearchResults.tsx';
export { resultCopy } from './src/components/worldwide/SearchFilters.tsx';
`;

const CACHE_ENTRY = `
import { openPublicCache, buildIntegrityKey, cacheRequestUrl, digestHex } from './src/lib/worldwide/data/cache.ts';
globalThis.__wwl082Cache = { openPublicCache, buildIntegrityKey, cacheRequestUrl, digestHex };
`;

interface HostedTransport {
  schema: string;
  task_id: string;
  probed_at: string;
  pages_origin: string;
  credentials: string;
  worker_model: string;
  cross_origin_isolation_assumed: boolean;
  shared_array_buffer_assumed: boolean;
  published_document: {
    url: string;
    status: number;
    content_security_policy: string;
    connects_to_huggingface: boolean;
    selected_access: string;
  };
  browser_probe: {
    resource: string;
    range: string;
    credentials: string;
    authorization_sent: boolean;
    cookie_sent: boolean;
    final: {
      status: number;
      body_bytes: number;
      body_prefix: string;
      body_sha256: string;
      content_range: string;
      declared_resource_bytes: number;
      etag: string;
    };
    network_headers: Record<string, string>;
    script_visible_headers: Record<string, string>;
    network_decision: string;
    script_visible_decision: string;
  };
  selected_access: string;
  deterministic_cases: string[];
  explicit_states: Record<string, string>;
}

interface Capability {
  cors: boolean;
  range: boolean;
  shardFallbackRequired: boolean;
  failure: string | null;
  crossOriginIsolationAssumed: boolean;
  sharedArrayBufferAssumed: boolean;
  workerModel: string;
  live: boolean;
  originProof: string;
  ignoredIsolationHeaders: string[];
  allowOrigin: string | null;
  status: number | null;
  contentRange: string | null;
  credentials: string;
  acceptRanges: string | null;
}

interface Production {
  interpretByteRangeResponse: (input: {
    pagesOrigin: string;
    resourceUrl: string;
    status: number | null;
    headers: Headers;
    bodyByteLength: number;
    bodyRefused: boolean;
    failure?: string | null;
    declaredResourceBytes?: number | null;
  }) => Capability;
  createArtifactTransport: (deps: {
    fetch?: (input: string, init: RequestInit) => Promise<Response>;
    sleep?: (ms: number, signal: AbortSignal | undefined) => Promise<void>;
    pagesOrigin?: string;
  }) => {
    discoverCapability: (input: { url: string; declaredResourceBytes?: number | null }) => Promise<Capability>;
    fetchArtifact: (target: {
      datasetId: string;
      revision: string;
      path: string;
      sha256: string;
      sizeBytes?: number | null;
    }) => Promise<{ attempts: number; sha256: string; sizeBytes: number }>;
    measureViewer: (input: { datasetId: string; live?: boolean }) => Promise<{
      live: boolean;
      originProof: string;
      layout: unknown;
      joinsSupported: boolean;
      revisionPinSupported: boolean;
      ignoredClaims: string[];
      endpoints: { splits: { called: boolean; ok: boolean; failure: string | null; status: number | null }; rows: { called: boolean } };
    }>;
    readViewerPage: (request: ViewerRequest) => Promise<ViewerPage>;
    paginateViewer: (request: ViewerRequest) => Promise<ViewerWalk>;
  };
  TransportError: abstract new (...args: never[]) => { code: string; attempts: number; status: number | null };
  sha256HexBytes: (data: Uint8Array) => string;
  buildArtifactUrl: (datasetId: string, revision: string, filePath: string) => string;
  DEFAULT_PAGES_ORIGIN: string;
  TRANSPORT_LIMITS: { viewerPageLength: number; viewerMaxPages: number; probeEnd: number };
  parseRoute: (input: string) => {
    coverageState: 'partial' | null;
    nextAction: string;
    migrationId: string | null;
    recognized: boolean;
    href: string | null;
  };
  shellBootHref: (href: string, nlMigration: boolean) => string;
  chooseResultState: (input: {
    submitted: boolean;
    phase: 'idle' | 'loading' | 'settled' | 'cancelled' | 'failed';
    offline: boolean;
    page: Record<string, unknown> | null;
    scope: 'place' | 'worldwide';
  }) => string;
  resultCopy: (locale: string) => Record<string, string>;
}

interface ViewerRequest {
  datasetId: string;
  config: string;
  split: string;
  offset: number;
  length: number;
  kind: 'rows';
}

interface ViewerPage {
  length: number;
  requestedLength: number;
  pageCapApplied: boolean;
  rows: unknown[];
  serverExceededCap: boolean;
  partialIndex: boolean;
  joinsSupported: boolean;
  revisionPinSupported: boolean;
  complete?: boolean;
}

interface ViewerWalk {
  rows: unknown[];
  complete: boolean;
  stoppedReason: string | null;
  joinsSupported: boolean;
  revisionPinSupported: boolean;
}

interface SeenRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
}

let production: Production;
let cacheBundle = '';

test.describe.configure({ mode: 'serial' });
test.setTimeout(120_000);

const cssEmpty: esbuild.Plugin = {
  name: 'css-empty',
  setup(build) {
    build.onResolve({ filter: /\.css$/ }, (args) => ({ path: args.path, namespace: 'css-empty' }));
    build.onLoad({ filter: /.*/, namespace: 'css-empty' }, () => ({ contents: 'export default {};', loader: 'js' }));
  },
};

function repoRoot(): string {
  const cwd = process.cwd();
  if (existsSync(join(cwd, 'package.json')) && existsSync(join(cwd, 'docs/worldwide'))) return cwd;
  return resolve(dirname(fileURLToPath(import.meta.url)), '../..');
}

function hostedDocument(): HostedTransport {
  const file = join(repoRoot(), 'docs/worldwide/hosted-transport.json');
  return JSON.parse(readFileSync(file, 'utf8')) as HostedTransport;
}

function accessLabel(capability: Capability): 'range' | 'shard-fallback' {
  if (capability.cors && capability.range && !capability.shardFallbackRequired && capability.failure == null) return 'range';
  return 'shard-fallback';
}

function interpret(headers: Record<string, string>, status: number | null, bodyByteLength: number, declared: number | null, failure?: string | null): Capability {
  return production.interpretByteRangeResponse({
    pagesOrigin: PAGES,
    resourceUrl: RESOURCE,
    status,
    headers: new Headers(headers),
    bodyByteLength,
    bodyRefused: failure != null,
    failure: failure ?? null,
    declaredResourceBytes: declared,
  });
}

function resultRow(): Record<string, unknown> {
  return {
    stale: false,
    issuer: 'issuer',
    date: '2020-01-01',
    citation: 'citation',
    status: 'in-force',
    sourceId: 'source',
    translationKind: null,
  };
}

function resultPage(extra: Record<string, unknown>): Record<string, unknown> {
  return {
    worldwideError: null,
    rows: [resultRow()],
    municipalGap: false,
    remaining: 0,
    worldwide: null,
    unsearchedSourceIds: [],
    ...extra,
  };
}

function directiveSources(csp: string, name: string): string[] | null {
  for (const part of csp.split(';')) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (tokens[0]?.toLowerCase() === name) return tokens.slice(1).map((token) => token.toLowerCase());
  }
  return null;
}

function connectAllowsHuggingFace(csp: string): boolean {
  const sources = directiveSources(csp, 'connect-src') ?? directiveSources(csp, 'default-src');
  if (!sources) return true;
  return sources.some((token) => token === '*' || token === 'https:' || token === 'https://*' || token.includes('huggingface.co') || token.includes('hf.co'));
}

function corsHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    'access-control-allow-origin': PAGES,
    'access-control-expose-headers': EXPOSE,
    'cache-control': 'no-store',
    ...extra,
  };
}

function assertNoCredentials(requests: readonly SeenRequest[]): void {
  expect(requests.length).toBeGreaterThan(0);
  for (const request of requests) {
    expect(request.headers.authorization ?? '').toBe('');
    expect(request.headers.cookie ?? '').toBe('');
    expect(request.headers.origin ?? request.headers.Origin).toBe(PAGES);
  }
}

async function openPagesDocument(page: Page): Promise<void> {
  await page.route(`${PAGES}/**`, async (route) => {
    if (route.request().resourceType() !== 'document') {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      headers: {
        'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; connect-src https://huggingface.co https://datasets-server.huggingface.co",
      },
      body: '<!doctype html><title>Pages origin probe</title><p>Static origin probe.</p>',
    });
  });
  await page.goto(`${PAGES}/`, { waitUntil: 'domcontentloaded' });
  expect(await page.evaluate(() => location.origin)).toBe(PAGES);
}

function watchRequests(page: Page, hosts: readonly string[]): SeenRequest[] {
  const seen: SeenRequest[] = [];
  page.on('request', (request: Request) => {
    const url = request.url();
    if (!hosts.some((host) => url.startsWith(host))) return;
    seen.push({ url, method: request.method(), headers: request.headers() });
  });
  return seen;
}

function pageFetch(page: Page): (input: string, init: RequestInit) => Promise<Response> {
  return async (input, init) => {
    const headers: Record<string, string> = {};
    const raw = init.headers;
    if (raw && typeof raw === 'object' && !Array.isArray(raw) && !(raw instanceof Headers)) {
      for (const [name, value] of Object.entries(raw)) {
        if (typeof value === 'string') headers[name] = value;
      }
    }
    if (init.credentials !== 'omit') throw new Error(`Transport credentials were ${String(init.credentials)}.`);
    if (init.redirect !== 'follow') throw new Error(`Transport redirect was ${String(init.redirect)}.`);
    if (init.referrerPolicy !== 'no-referrer') throw new Error(`Transport referrer was ${String(init.referrerPolicy)}.`);
    if (init.cache !== 'no-store') throw new Error(`Transport cache mode was ${String(init.cache)}.`);
    const payload = await page.evaluate(async ({ url, requestHeaders, method }) => {
      try {
        const response = await fetch(url, {
          method,
          headers: requestHeaders,
          credentials: 'omit',
          redirect: 'follow',
          referrerPolicy: 'no-referrer',
          cache: 'no-store',
          mode: 'cors',
        });
        const bytes = Array.from(new Uint8Array(await response.arrayBuffer()));
        const visible: Record<string, string> = {};
        response.headers.forEach((value, key) => {
          visible[key] = value;
        });
        return { ok: true as const, status: response.status, url: response.url, headers: visible, bytes };
      } catch (error) {
        return { ok: false as const, message: error instanceof Error ? error.message : String(error) };
      }
    }, { url: input, requestHeaders: headers, method: init.method ?? 'GET' });
    if (!payload.ok) throw new TypeError(payload.message);
    const response = new Response(Uint8Array.from(payload.bytes), { status: payload.status, headers: payload.headers });
    Object.defineProperty(response, 'url', { value: payload.url });
    return response;
  };
}

async function fulfillOptions(route: { fulfill: (options: { status: number; headers: Record<string, string>; body: string }) => Promise<void> }): Promise<void> {
  await route.fulfill({
    status: 204,
    headers: {
      'access-control-allow-origin': PAGES,
      'access-control-allow-methods': 'GET, OPTIONS',
      'access-control-allow-headers': 'accept, range, content-type',
      'access-control-max-age': '0',
    },
    body: '',
  });
}

function transportWith(page: Page, sleeps: number[]) {
  return production.createArtifactTransport({
    pagesOrigin: PAGES,
    fetch: pageFetch(page),
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });
}

test.beforeAll(async () => {
  const root = repoRoot();
  const directory = mkdtempSync(join(tmpdir(), 'wwl082-'));
  const outfile = join(directory, 'production.mjs');
  await esbuild.build({
    stdin: { contents: ENTRY, resolveDir: root, sourcefile: 'wwl082-entry.ts', loader: 'ts' },
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'es2022',
    outfile,
    plugins: [cssEmpty],
    jsx: 'automatic',
    logLevel: 'silent',
  });
  production = await import(pathToFileURL(outfile).href) as Production;
  const cache = await esbuild.build({
    stdin: { contents: CACHE_ENTRY, resolveDir: root, sourcefile: 'wwl082-cache.ts', loader: 'ts' },
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    write: false,
    logLevel: 'silent',
  });
  cacheBundle = cache.outputFiles?.[0]?.text ?? '';
  expect(cacheBundle.length).toBeGreaterThan(1000);
  expect(production.DEFAULT_PAGES_ORIGIN).toBe(PAGES);
});

test('dated Pages-origin headers select Range on the network and shard fallback in page script', async () => {
  const doc = hostedDocument();
  expect(doc.schema).toBe('worldwide-legal-search.hosted-transport@1');
  expect(doc.task_id).toBe('WWL-082');
  expect(doc.probed_at).toBe('2026-11-03T23:34:00.802Z');
  expect(Number.isNaN(Date.parse(doc.probed_at))).toBe(false);
  expect(doc.pages_origin).toBe(PAGES);
  expect(doc.credentials).toBe('omit');
  expect(doc.worker_model).toBe('single-thread');
  expect(doc.cross_origin_isolation_assumed).toBe(false);
  expect(doc.shared_array_buffer_assumed).toBe(false);
  expect(doc.published_document.status).toBe(404);
  expect(doc.published_document.connects_to_huggingface).toBe(false);
  expect(connectAllowsHuggingFace(doc.published_document.content_security_policy)).toBe(false);
  expect(doc.published_document.selected_access).toBe('shard-fallback');
  expect(doc.selected_access).toBe('shard-fallback');
  expect(doc.deterministic_cases).toEqual(CASES);
  expect(doc.browser_probe.resource).toBe(RESOURCE);
  expect(doc.browser_probe.range).toBe('bytes=0-31');
  expect(doc.browser_probe.authorization_sent).toBe(false);
  expect(doc.browser_probe.cookie_sent).toBe(false);
  expect(doc.browser_probe.network_headers['x-request-id']).toBeUndefined();

  const prefix = new TextEncoder().encode(doc.browser_probe.final.body_prefix);
  expect(prefix.byteLength).toBe(doc.browser_probe.final.body_bytes);
  expect(production.sha256HexBytes(prefix)).toBe(doc.browser_probe.final.body_sha256);

  const network = interpret(
    doc.browser_probe.network_headers,
    doc.browser_probe.final.status,
    doc.browser_probe.final.body_bytes,
    doc.browser_probe.final.declared_resource_bytes,
  );
  expect(accessLabel(network)).toBe(doc.browser_probe.network_decision);
  expect(network.cors).toBe(true);
  expect(network.range).toBe(true);
  expect(network.shardFallbackRequired).toBe(false);
  expect(network.allowOrigin).toBe(PAGES);
  expect(network.contentRange).toBe('bytes 0-31/385614');
  expect(network.live).toBe(false);
  expect(network.originProof).toBe('unproven');
  expect(network.credentials).toBe('omit');
  expect(network.crossOriginIsolationAssumed).toBe(false);
  expect(network.sharedArrayBufferAssumed).toBe(false);
  expect(network.workerModel).toBe('single-thread');
  expect(network.ignoredIsolationHeaders).toContain('cross-origin-opener-policy');
  expect(network.failure).toBeNull();

  const visible = interpret(
    doc.browser_probe.script_visible_headers,
    doc.browser_probe.final.status,
    doc.browser_probe.final.body_bytes,
    doc.browser_probe.final.declared_resource_bytes,
  );
  expect(accessLabel(visible)).toBe(doc.browser_probe.script_visible_decision);
  expect(visible.cors).toBe(false);
  expect(visible.range).toBe(false);
  expect(visible.shardFallbackRequired).toBe(true);
  expect(visible.allowOrigin).toBeNull();
  expect(visible.crossOriginIsolationAssumed).toBe(false);
  expect(visible.sharedArrayBufferAssumed).toBe(false);

  const redirect = interpret(
    { 'access-control-allow-origin': PAGES, 'content-range': 'bytes 0-31/385614' },
    307,
    239,
    385614,
  );
  expect(accessLabel(redirect)).toBe('shard-fallback');
  expect(redirect.range).toBe(false);
});

test('the published Pages document cannot connect to the artifact host', async ({ page }) => {
  const doc = hostedDocument();
  const response = await page.goto(doc.published_document.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  expect(response).toBeTruthy();
  const status = response?.status() ?? 0;
  const headers = response ? await response.allHeaders() : {};
  const csp = headers['content-security-policy'] ?? '';
  expect(await page.evaluate(() => location.origin)).toBe(PAGES);
  const probe = await page.evaluate(async (url) => {
    try {
      const outcome = await fetch(url, {
        method: 'GET',
        headers: { Range: 'bytes=0-31', Accept: '*/*' },
        credentials: 'omit',
        mode: 'cors',
        redirect: 'follow',
        referrerPolicy: 'no-referrer',
        cache: 'no-store',
      });
      const visible: Record<string, string> = {};
      outcome.headers.forEach((value, key) => {
        visible[key] = value;
      });
      const bytes = new Uint8Array(await outcome.arrayBuffer());
      return { blocked: false, status: outcome.status, headers: visible, bodyByteLength: bytes.byteLength };
    } catch (error) {
      return { blocked: true, message: error instanceof Error ? error.message : String(error), status: null, headers: {}, bodyByteLength: 0 };
    }
  }, RESOURCE);

  if (status === 404 || !connectAllowsHuggingFace(csp)) {
    expect(probe.blocked).toBe(true);
    expect(connectAllowsHuggingFace(csp)).toBe(false);
    const blocked = interpret({}, null, 0, null, 'network');
    expect(accessLabel(blocked)).toBe('shard-fallback');
    expect(blocked.shardFallbackRequired).toBe(true);
    expect(blocked.range).toBe(false);
    return;
  }

  expect(probe.blocked).toBe(false);
  const capability = interpret(probe.headers, probe.status, probe.bodyByteLength, null, probe.status === 206 ? null : 'http');
  if (accessLabel(capability) === 'range') {
    expect(probe.status).toBe(206);
    expect(capability.contentRange?.startsWith('bytes 0-31/')).toBe(true);
    expect(capability.allowOrigin === '*' || capability.allowOrigin === PAGES).toBe(true);
    expect(capability.crossOriginIsolationAssumed).toBe(false);
  } else {
    expect(capability.shardFallbackRequired).toBe(true);
    expect(capability.failure).toBeTruthy();
  }
});

test('a fresh Pages-origin document measures Range or records an explicit fallback', async ({ page }) => {
  const doc = hostedDocument();
  const seen = watchRequests(page, ['https://huggingface.co/']);
  const responses: Array<{ status: number; url: string; headers: Record<string, string> }> = [];
  const pending: Promise<void>[] = [];
  page.on('response', (response) => {
    if (!response.url().includes('huggingface.co')) return;
    pending.push((async () => {
      responses.push({ status: response.status(), url: response.url(), headers: await response.allHeaders() });
    })());
  });
  await openPagesDocument(page);
  const script = await page.evaluate(async (url) => {
    try {
      const outcome = await fetch(url, {
        method: 'GET',
        headers: { Range: 'bytes=0-31', Accept: '*/*' },
        credentials: 'omit',
        mode: 'cors',
        redirect: 'follow',
        referrerPolicy: 'no-referrer',
        cache: 'no-store',
      });
      const visible: Record<string, string> = {};
      outcome.headers.forEach((value, key) => {
        visible[key] = value;
      });
      const bytes = Array.from(new Uint8Array(await outcome.arrayBuffer()));
      return { ok: true as const, status: outcome.status, redirected: outcome.redirected, headers: visible, bytes };
    } catch (error) {
      return { ok: false as const, message: error instanceof Error ? error.message : String(error) };
    }
  }, RESOURCE);
  await Promise.all(pending);

  const gets = seen.filter((request) => request.method === 'GET');
  expect(gets.length).toBeGreaterThan(0);
  assertNoCredentials(gets);
  expect(gets.some((request) => request.headers.range === 'bytes=0-31')).toBe(true);
  expect(gets.every((request) => !request.headers.referer)).toBe(true);

  const finalNetwork = responses.find((item) => item.status === 206) ?? responses.at(-1) ?? null;
  if (!script.ok || !finalNetwork || finalNetwork.status !== 206) {
    const fallback = interpret(script.ok ? script.headers : {}, script.ok ? script.status : finalNetwork?.status ?? null, script.ok ? script.bytes.length : 0, null, 'network');
    expect(accessLabel(fallback)).toBe('shard-fallback');
    expect(fallback.range).toBe(false);
    expect(fallback.shardFallbackRequired).toBe(true);
    return;
  }

  const declared = Number(finalNetwork.headers['content-range']?.split('/')[1] ?? '');
  const network = interpret(
    finalNetwork.headers,
    finalNetwork.status,
    script.bytes.length,
    Number.isInteger(declared) ? declared : null,
  );
  expect(finalNetwork.headers['access-control-allow-origin'] === PAGES || finalNetwork.headers['access-control-allow-origin'] === '*').toBe(true);
  expect(finalNetwork.headers['content-range']?.startsWith('bytes 0-31/')).toBe(true);
  expect(accessLabel(network)).toBe('range');
  expect(network.crossOriginIsolationAssumed).toBe(false);
  expect(network.sharedArrayBufferAssumed).toBe(false);
  expect(network.workerModel).toBe('single-thread');
  if (finalNetwork.headers['cross-origin-opener-policy']) {
    expect(network.ignoredIsolationHeaders).toContain('cross-origin-opener-policy');
  }
  const visible = interpret(script.headers, script.status, script.bytes.length, Number.isInteger(declared) ? declared : null);
  if (!script.headers['access-control-allow-origin']) {
    expect(accessLabel(visible)).toBe('shard-fallback');
    expect(visible.cors).toBe(false);
    expect(visible.shardFallbackRequired).toBe(true);
  } else {
    expect(accessLabel(visible)).toBe(accessLabel(interpret(script.headers, script.status, script.bytes.length, Number.isInteger(declared) ? declared : null)));
  }
  if (script.bytes.length === doc.browser_probe.final.body_bytes && finalNetwork.headers.etag === doc.browser_probe.final.etag) {
    expect(production.sha256HexBytes(Uint8Array.from(script.bytes))).toBe(doc.browser_probe.final.body_sha256);
  }
});

test('a 429 with Retry-After retries and then accepts the ranged response', async ({ page }) => {
  const sleeps: number[] = [];
  const seen = watchRequests(page, ['https://huggingface.co/']);
  let hits = 0;
  await page.route('https://huggingface.co/**', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await fulfillOptions(route);
      return;
    }
    hits += 1;
    if (hits === 1) {
      await route.fulfill({
        status: 429,
        headers: corsHeaders({ 'retry-after': '1', 'content-type': 'text/plain', 'content-length': '4' }),
        body: 'slow',
      });
      return;
    }
    await route.fulfill({
      status: 206,
      headers: corsHeaders({
        'content-type': 'text/plain',
        'content-range': 'bytes 0-31/32',
        'content-length': '32',
        'accept-ranges': 'bytes',
        'x-repo-commit': REV,
      }),
      body: 'a'.repeat(32),
    });
  });
  await openPagesDocument(page);
  const capability = await transportWith(page, sleeps).discoverCapability({
    url: production.buildArtifactUrl(DATASET, REV, 'shards/rate.json'),
  });
  expect(hits).toBeGreaterThanOrEqual(2);
  expect(sleeps).toEqual([1000]);
  expect(capability.status).toBe(206);
  expect(capability.cors).toBe(true);
  expect(capability.range).toBe(true);
  expect(capability.failure).toBeNull();
  expect(capability.shardFallbackRequired).toBe(false);
  expect(capability.crossOriginIsolationAssumed).toBe(false);
  expect(capability.credentials).toBe('omit');
  assertNoCredentials(seen.filter((request) => request.method === 'GET'));
});

test('repeated 503 responses exhaust retries and stay shard fallback', async ({ page }) => {
  const sleeps: number[] = [];
  const seen = watchRequests(page, ['https://huggingface.co/']);
  let hits = 0;
  await page.route('https://huggingface.co/**', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await fulfillOptions(route);
      return;
    }
    hits += 1;
    await route.fulfill({
      status: 503,
      headers: corsHeaders({ 'content-type': 'text/plain', 'content-length': '4' }),
      body: 'down',
    });
  });
  await openPagesDocument(page);
  const capability = await transportWith(page, sleeps).discoverCapability({
    url: production.buildArtifactUrl(DATASET, REV, 'shards/outage.json'),
  });
  expect(hits).toBe(3);
  expect(sleeps).toEqual([200, 400]);
  expect(capability.failure).toBe('retry-exhausted');
  expect(capability.status).toBe(503);
  expect(capability.range).toBe(false);
  expect(capability.shardFallbackRequired).toBe(true);
  expect(capability.live).toBe(false);
  assertNoCredentials(seen.filter((request) => request.method === 'GET'));
});

test('a sha256 mismatch is an integrity failure', async ({ page }) => {
  const sleeps: number[] = [];
  const body = '{"note":"bytes"}';
  await page.route('https://huggingface.co/**', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await fulfillOptions(route);
      return;
    }
    await route.fulfill({
      status: 200,
      headers: corsHeaders({
        'content-type': 'application/json',
        'content-length': String(body.length),
      }),
      body,
    });
  });
  await openPagesDocument(page);
  const error = await transportWith(page, sleeps).fetchArtifact({
    datasetId: DATASET,
    revision: REV,
    path: 'shards/corrupt.json',
    sha256: 'b'.repeat(64),
    sizeBytes: body.length,
  }).then(() => null, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(production.TransportError);
  expect((error as { code: string }).code).toBe('integrity');
});

test('a missing Viewer splits response stays unproven', async ({ page }) => {
  await page.route('https://datasets-server.huggingface.co/**', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await fulfillOptions(route);
      return;
    }
    await route.fulfill({
      status: 404,
      headers: corsHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({ error: 'Not found' }),
    });
  });
  await openPagesDocument(page);
  const report = await transportWith(page, []).measureViewer({ datasetId: DATASET, live: true });
  expect(report.live).toBe(false);
  expect(report.originProof).toBe('unproven');
  expect(report.layout).toBeNull();
  expect(report.joinsSupported).toBe(false);
  expect(report.revisionPinSupported).toBe(false);
  expect(report.ignoredClaims).toEqual(['live']);
  expect(report.endpoints.splits.called).toBe(true);
  expect(report.endpoints.splits.ok).toBe(false);
  expect(report.endpoints.splits.failure).toBe('http');
  expect(report.endpoints.splits.status).toBe(404);
  expect(report.endpoints.rows.called).toBe(false);
});

test('viewer pages stay capped for length, server overflow, a partial index, and the page budget', async ({ page }) => {
  const doc = hostedDocument();
  let mode: 'cap' | 'over' | 'partial' | 'budget' = 'cap';
  await page.route('https://datasets-server.huggingface.co/**', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await fulfillOptions(route);
      return;
    }
    const url = new URL(route.request().url());
    const offset = Number(url.searchParams.get('offset') ?? '0');
    const count = mode === 'over' ? production.TRANSPORT_LIMITS.viewerPageLength + 25 : mode === 'budget' ? production.TRANSPORT_LIMITS.viewerPageLength : mode === 'partial' ? 10 : 3;
    const rows = Array.from({ length: count }, (_, index) => ({ row: { title: `law-${offset + index}` } }));
    await route.fulfill({
      status: 200,
      headers: corsHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify({
        dataset: DATASET,
        rows,
        num_rows_total: mode === 'budget' ? 10000 : rows.length,
        num_rows_per_page: production.TRANSPORT_LIMITS.viewerPageLength,
        partial: mode === 'partial',
        joins: true,
        pinning: true,
      }),
    });
  });
  await openPagesDocument(page);
  const transport = transportWith(page, []);
  const request = (length: number, offset = 0): ViewerRequest => ({
    datasetId: DATASET,
    config: 'default',
    split: 'train',
    offset,
    length,
    kind: 'rows',
  });

  mode = 'cap';
  const capped = await transport.readViewerPage(request(250));
  expect(capped.requestedLength).toBe(250);
  expect(capped.length).toBe(production.TRANSPORT_LIMITS.viewerPageLength);
  expect(capped.pageCapApplied).toBe(true);
  expect(capped.rows.length).toBe(3);
  expect(capped.joinsSupported).toBe(false);
  expect(capped.revisionPinSupported).toBe(false);

  mode = 'over';
  const overflow = await transport.readViewerPage(request(production.TRANSPORT_LIMITS.viewerPageLength));
  expect(overflow.serverExceededCap).toBe(true);
  expect(overflow.rows.length).toBe(production.TRANSPORT_LIMITS.viewerPageLength);
  expect(overflow.joinsSupported).toBe(false);

  mode = 'partial';
  const partial = await transport.paginateViewer(request(production.TRANSPORT_LIMITS.viewerPageLength));
  expect(partial.complete).toBe(false);
  expect(partial.stoppedReason).toBe('partial-index');
  expect(partial.rows.length).toBe(10);
  expect(partial.joinsSupported).toBe(false);
  expect(partial.revisionPinSupported).toBe(false);

  mode = 'budget';
  const budgetTransport = transportWith(page, []);
  const budget = await budgetTransport.paginateViewer(request(production.TRANSPORT_LIMITS.viewerPageLength));
  expect(budget.complete).toBe(false);
  expect(budget.stoppedReason).toBe('page-budget');
  expect(budget.rows.length).toBe(production.TRANSPORT_LIMITS.viewerPageLength * production.TRANSPORT_LIMITS.viewerMaxPages);
  expect(budget.stoppedReason).not.toBe('complete');
  expect(doc.explicit_states.capped).toContain('not all worldwide results');
});

test('the static shell keeps coverage, sample, empty search, and offline explicit', async ({ page }) => {
  const doc = hostedDocument();
  const copy = production.resultCopy('en');
  expect(copy.offline).toBe(doc.explicit_states.offline);
  expect(copy.capped).toBe(doc.explicit_states.capped);
  expect(copy.coverage_unknown).toBe(doc.explicit_states.coverage_unknown);
  expect(copy.coverage_partial).toBe(doc.explicit_states.coverage_partial);
  expect(copy.empty_query).toContain(doc.explicit_states.empty_query);
  expect(copy.outage).toBe(doc.explicit_states.outage);

  expect(production.chooseResultState({
    submitted: true,
    phase: 'settled',
    offline: true,
    page: resultPage({ remaining: 5 }),
    scope: 'worldwide',
  })).toBe('offline-saved');
  expect(production.chooseResultState({
    submitted: true,
    phase: 'settled',
    offline: false,
    page: resultPage({ remaining: 4 }),
    scope: 'place',
  })).toBe('partially-loaded');
  expect(production.chooseResultState({
    submitted: true,
    phase: 'settled',
    offline: false,
    page: resultPage({ remaining: 0, worldwide: { partial: true } }),
    scope: 'place',
  })).toBe('partially-loaded');
  expect(production.chooseResultState({
    submitted: true,
    phase: 'settled',
    offline: false,
    page: resultPage({ remaining: 0, worldwide: { partial: false } }),
    scope: 'worldwide',
  })).toBe('partially-loaded');
  expect(production.chooseResultState({
    submitted: true,
    phase: 'failed',
    offline: false,
    page: null,
    scope: 'place',
  })).toBe('throttling-or-outage');

  const sample = production.parseRoute(SAMPLE_CID);
  expect(sample.coverageState).toBe('partial');
  expect(sample.migrationId).toBe('dutch-sample');
  expect(sample.nextAction).toBe(doc.explicit_states.sample_partial);
  const booted = production.shellBootHref(SAMPLE_CID, true);
  expect(booted.includes('#/')).toBe(true);
  expect(production.parseRoute(booted).coverageState).toBeNull();
  expect(production.shellBootHref(SAMPLE_CID, false)).toBe('/#/search');
  const absolute = production.parseRoute(`http://127.0.0.1:5173/${SAMPLE_CID}`);
  expect(absolute.coverageState).toBeNull();
  expect(absolute.migrationId).toBeNull();

  await page.goto('/');
  await expect(page.locator('.wwl-shell')).toHaveAttribute('data-state', 'first-visit');
  await expect(page.locator('.wwl-coverage')).toHaveAttribute('data-coverage', 'unknown');
  await expect(page.locator('.wwl-coverage')).toContainText(doc.explicit_states.coverage_unknown);
  await expect(page.locator('.wwl-status')).toContainText(doc.explicit_states.first_visit);
  await expect(page.locator('.wwl-applicability')).toHaveText(doc.explicit_states.applicability);
  await expect(page.locator('ol[aria-label="Results"] li')).toHaveCount(0);

  await page.locator('form.wwl-search button[type="submit"]').click();
  await expect(page.locator('.wwl-shell')).toHaveAttribute('data-state', 'no-query');
  await expect(page.locator('main')).toContainText(doc.explicit_states.empty_query);
  await expect(page.locator('.wwl-coverage')).toHaveAttribute('data-coverage', 'unknown');
  await expect(page.locator('ol[aria-label="Results"] li')).toHaveCount(0);

  await page.goto('/?nl=1');
  await expect(page.locator('.wwl-shell')).toHaveAttribute('data-nl-migration', 'on');
  await expect(page.getByRole('list', { name: 'Netherlands examples' })).toBeVisible();
  await expect(page.locator('body')).not.toContainText('published corpus');
  await expect(page.locator('.wwl-coverage')).toContainText(doc.explicit_states.coverage_unknown);

  await page.goto(booted);
  await expect(page.locator('.wwl-coverage')).toHaveAttribute('data-coverage', 'unknown');
  await expect(page.locator('.wwl-coverage')).toContainText(doc.explicit_states.coverage_unknown);
  await expect(page.locator('body')).not.toContainText(doc.explicit_states.sample_partial);

  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
  });
  await page.goto('/?offline=1');
  expect(await page.evaluate(() => navigator.onLine)).toBe(false);
  await expect(page.locator('.wwl-coverage')).toHaveAttribute('data-coverage', 'unknown');
  await expect(page.locator('.wwl-coverage')).toContainText(doc.explicit_states.coverage_unknown);
  await expect(page.locator('.wwl-status')).toContainText(doc.explicit_states.first_visit);
  await expect(page.locator('ol[aria-label="Results"] li')).toHaveCount(0);
});

test('saved cache bytes stay explicit offline and after a corrupt copy is removed', async ({ page }) => {
  const doc = hostedDocument();
  await page.addInitScript({ content: cacheBundle });
  await openPagesDocument(page);
  const outcome = await page.evaluate(async ({ datasetId, revision, catalogRevision, offlineCopy, recoveryCopy }) => {
    const api = (globalThis as unknown as {
      __wwl082Cache: {
        openPublicCache: (options: { databaseName: string; cacheName: string; online: () => boolean; now: () => number }) => {
          installCatalog: (pin: { catalogRevision: string; sources: Array<{ datasetId: string; revision: string }> }) => Promise<{ code: string }>;
          put: (input: { datasetId: string; revision: string; path: string; sha256: string; bytes: Uint8Array; mediaType: string; saved: boolean }) => Promise<{ ok: boolean; code: string }>;
          read: (key: unknown) => Promise<{ code: string; ok: boolean; recoveryCopy: string | null; visibility: { state: string; visibleCopy: string; offline: boolean; coverageCopy: string } }>;
          visibility: () => Promise<{ state: string; visibleCopy: string; savedCount: number }>;
        };
        buildIntegrityKey: (input: { datasetId: string; revision: string; path: string; sha256: string }) => { token: string };
        cacheRequestUrl: (token: string) => string;
        digestHex: (bytes: Uint8Array) => string;
      };
    }).__wwl082Cache;
    let online = true;
    const stamp = String(Date.now());
    const databaseName = `wwl082-${stamp}`;
    const cacheName = `wwl082-cache-${stamp}`;
    const cache = api.openPublicCache({ databaseName, cacheName, online: () => online, now: () => 1_700_000_000_000 });
    const encode = (text: string) => new TextEncoder().encode(text);
    const keptBytes = encode('intact source');
    const brokenBytes = encode('broken source');
    const warmBytes = encode('warm source');
    const kept = { datasetId, revision, path: 'shards/intact.json', sha256: api.digestHex(keptBytes), bytes: keptBytes, mediaType: 'application/json', saved: true };
    const broken = { datasetId, revision, path: 'shards/broken.json', sha256: api.digestHex(brokenBytes), bytes: brokenBytes, mediaType: 'application/json', saved: true };
    const warm = { datasetId, revision, path: 'shards/warm.json', sha256: api.digestHex(warmBytes), bytes: warmBytes, mediaType: 'application/json', saved: false };
    const installed = await cache.installCatalog({ catalogRevision, sources: [{ datasetId, revision }] });
    const putKept = await cache.put(kept);
    const putBroken = await cache.put(broken);
    const putWarm = await cache.put(warm);
    const brokenKey = api.buildIntegrityKey(broken);
    const bucket = await caches.open(cacheName);
    const matched = await bucket.match(api.cacheRequestUrl(brokenKey.token));
    if (!matched) return { error: 'cached-body-missing', installed, putKept, putBroken, putWarm };
    const flipped = new Uint8Array(await matched.arrayBuffer());
    flipped[0] ^= 0xff;
    await bucket.put(api.cacheRequestUrl(brokenKey.token), new Response(flipped, { status: matched.status, headers: new Headers(matched.headers) }));
    const recovered = await cache.read(brokenKey);
    const sibling = await cache.read(api.buildIntegrityKey(kept));
    online = false;
    const offlineHit = await cache.read(api.buildIntegrityKey(kept));
    const hidden = await cache.read(api.buildIntegrityKey(warm));
    const visible = await cache.visibility();
    return {
      error: null,
      installed: installed.code,
      stored: [putKept.code, putBroken.code, putWarm.code],
      recovered: { code: recovered.code, ok: recovered.ok, recoveryCopy: recovered.recoveryCopy },
      sibling: sibling.code,
      offlineHit: { code: offlineHit.code, state: offlineHit.visibility.state, visibleCopy: offlineHit.visibility.visibleCopy, offline: offlineHit.visibility.offline },
      hidden: { code: hidden.code, state: hidden.visibility.state, visibleCopy: hidden.visibility.visibleCopy },
      visible: { state: visible.state, visibleCopy: visible.visibleCopy, savedCount: visible.savedCount },
    };
  }, {
    datasetId: DATASET,
    revision: REV,
    catalogRevision: 'c'.repeat(64),
    offlineCopy: doc.explicit_states.offline,
    recoveryCopy: doc.explicit_states.corrupt_recovery,
  });

  expect(outcome.error).toBeNull();
  expect(outcome.installed).toBe('installed');
  expect(outcome.stored).toEqual(['stored', 'stored', 'stored']);
  expect(outcome.recovered).toMatchObject({ ok: false, code: 'corrupt-recovered', recoveryCopy: doc.explicit_states.corrupt_recovery });
  expect(outcome.sibling).toBe('hit');
  expect(outcome.offlineHit).toMatchObject({ code: 'hit', state: 'offline-saved', visibleCopy: doc.explicit_states.offline, offline: true });
  expect(outcome.hidden).toMatchObject({ code: 'not-saved-offline', state: 'offline-saved', visibleCopy: doc.explicit_states.offline });
  expect(outcome.visible).toMatchObject({ state: 'offline-saved', visibleCopy: doc.explicit_states.offline, savedCount: 1 });
});

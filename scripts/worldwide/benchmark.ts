#!/usr/bin/env node
/**
 * Corpus-shard scale, memory, and network budget measurement.
 *
 * The scale below is the benchmark corpus. Place search scores one routed
 * shard of 50_000 posting entries, which is the production traversal budget.
 * Worldwide common-term search still has 36 jurisdiction shards and may open
 * only four of them. Those counts stay fixed when a sample misses a target;
 * the search, transport, or shell is what changes.
 *
 * Cold and warm percentiles use a recorded mid-range mobile profile: Chrome
 * DevTools 4x CPU throttle, and a responsive LTE trace of 70 ms RTT and
 * 12 Mbit/s. This file does not claim a handset or a live upstream.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import zlib from 'node:zlib';

import { publishCatalog } from '../../src/lib/worldwide/data/catalog';
import { canonicalJson, sha256HexUtf8, utf8Bytes } from '../../src/lib/worldwide/data/identity';
import {
  TRANSPORT_LIMITS,
  TransportError,
  createArtifactTransport,
  sha256HexBytes,
  type ArtifactTarget,
} from '../../src/lib/worldwide/data/transport';
import {
  GLOBAL_CONCURRENCY,
  readCommonTermFanout,
  searchWorldwide,
  type GlobalRoutingIndex,
} from '../../src/lib/worldwide/search/global';
import type { Bm25Parameters, CompactDocumentSummary, CompactPostingRecord, PostingShard, TermRoute } from '../../src/lib/worldwide/search/bm25';
import { buildGlobalRouting, type GlobalCollectionInput } from './build-global-routing';
import {
  SEARCH_WORKER_YIELD_EVERY,
  createWorldwideSearchClient,
  handleWorkerMessage,
  type SearchWorkerPort,
  type SearchWorkerResponse,
} from '../../src/workers/worldwideSearchWorker';

export const PERFORMANCE_SCHEMA = 'worldwide-legal-search.performance@1';
export const MOBILE_PROFILE = 'mid-range-mobile';

/** PLAN.md mid-range mobile ceilings. These are not raised to admit a sample. */
export const PLAN_PERFORMANCE_TARGETS = Object.freeze({
  shell_gzip_bytes: 350 * 1024,
  catalog_bytes: 1024 * 1024,
  first_place_search_bytes: 10 * 1024 * 1024,
  warm_p95_ms: 1000,
  cold_p95_ms: 5000,
  concurrent_requests: 4,
  heap_bytes: 256 * 1024 * 1024,
});

export const REPRESENTATIVE_SCALE = Object.freeze({
  jurisdictions: 36,
  unsearchableCollections: 2,
  commonTerm: 'statute',
  placeTerm: 'housing',
  placeJurisdiction: 'nl',
  hitsPerCommonShard: 2,
  commonDocumentFrequency: 48,
  postingEntries: 50_000,
  workerYieldEvery: SEARCH_WORKER_YIELD_EVERY,
  trials: 21,
  concurrencyBatch: 12,
});

/** Chrome DevTools mid-tier CPU throttle. */
export const CPU_SLOWDOWN = 4;
/** Recorded responsive LTE trace. Not Fast 3G and not a congested stall. */
export const TRACE_RTT_MS = 70;
export const TRACE_DOWNLINK_BPS = 12_000_000;

const ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const PIN = 'a'.repeat(40);
const PAGES_ORIGIN = 'https://worldwidelaws.github.io';
const DATASET = 'endomorphosis/worldwide-laws';

const JURISDICTIONS = [
  'nl', 'de', 'fr', 'be', 'lu', 'es', 'pt', 'it', 'ie', 'pl', 'se', 'no',
  'dk', 'fi', 'at', 'cz', 'sk', 'hu', 'ro', 'bg', 'gr', 'ee', 'lv', 'lt',
  'hr', 'si', 'mt', 'cy', 'us', 'ca', 'mx', 'br', 'jp', 'kr', 'au', 'nz',
] as const;

export class PerformanceBenchmarkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PerformanceBenchmarkError';
  }
}

export function p95(samples: readonly number[]): number {
  if (samples.length === 0) throw new PerformanceBenchmarkError('p95 needs at least one sample');
  const sorted = [...samples].sort((left, right) => left - right);
  const index = Math.ceil(0.95 * sorted.length) - 1;
  const sample = sorted[Math.min(sorted.length - 1, Math.max(0, index))];
  if (sample === undefined || !Number.isFinite(sample)) throw new PerformanceBenchmarkError('p95 sample was not finite');
  return sample;
}

interface PerformanceDocument {
  schema: typeof PERFORMANCE_SCHEMA;
  profile: typeof MOBILE_PROFILE;
  measurements: {
    shell_gzip_bytes: number;
    catalog_bytes: number;
    first_place_search_bytes: number;
    warm_p95_ms: number;
    cold_p95_ms: number;
    concurrent_requests: number;
    heap_bytes: number;
    common_term_fanout_requests: number;
    cancellation_observed: boolean;
  };
  targets: { [key: string]: number };
  budgets_met: boolean;
  regressions: string[];
  scale: {
    jurisdictions: number;
    posting_entries: number;
    worker_yield_every: number;
    trials: number;
    concurrency_batch: number;
    common_term: string;
    place_term: string;
    place_jurisdiction: string;
  };
  trace: {
    cpu_slowdown: number;
    rtt_ms: number;
    downlink_bits_per_second: number;
    source: string;
  };
  host: {
    warm_p95_ms: number;
    warm_samples_ms: number[];
  };
  transfers: {
    shell_gzip_bytes: number;
    shell_files: string[];
    catalog_json_bytes: number;
    gazetteer_bytes: number;
    routing_bytes: number;
    posting_bytes: number;
    directory_waves: number;
    shard_summary_bytes: number;
  };
  fanout: {
    requests: number;
    shard_requests: number;
    unopened_shards: number;
    searchable_collections: number;
    per_country_fanout: false;
  };
  cancellation: {
    worker_examined_entries: number;
    worker_cancelled: boolean;
    transport_cancelled: boolean;
  };
}

export interface BenchmarkRun {
  document: PerformanceDocument;
}

function noteHeap(peak: { bytes: number }): void {
  const used = process.memoryUsage().heapUsed;
  if (used > peak.bytes) peak.bytes = used;
}

function waveMs(bytes: number): number {
  return TRACE_RTT_MS + (bytes * 8 * 1000) / TRACE_DOWNLINK_BPS;
}

function gzipBytes(bytes: Buffer): number {
  return zlib.gzipSync(bytes).length;
}

function staticJsImports(source: string): string[] {
  const masked = source.replace(/\bimport\s*\(\s*['"][^'"]+['"]\s*\)/g, '""');
  const found = new Set<string>();
  const patterns = [
    /\bfrom\s*['"](\.[^'"]+\.js)['"]/g,
    /\bimport\s*['"](\.[^'"]+\.js)['"]/g,
  ];
  for (const pattern of patterns) {
    for (const match of masked.matchAll(pattern)) {
      if (match[1]) found.add(match[1]);
    }
  }
  return [...found];
}

export function measureShellGzip(distDir: string): { bytes: number; files: string[] } {
  const htmlPath = path.join(distDir, 'index.html');
  if (!fs.existsSync(htmlPath)) {
    throw new PerformanceBenchmarkError('shell measurement needs the production index.html from a vite build');
  }
  const html = fs.readFileSync(htmlPath, 'utf8');
  const queue: string[] = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(/<(?:script|link)\b[^>]*>/gi)) {
    const tag = match[0];
    const ref = /(?:src|href)\s*=\s*['"]([^'"]+)['"]/i.exec(tag);
    if (!ref?.[1]) continue;
    const module = /type\s*=\s*['"]module['"]/i.test(tag) || /rel\s*=\s*['"]modulepreload['"]/i.test(tag);
    if (!module || !ref[1].includes('.js')) continue;
    queue.push(ref[1]);
  }
  if (queue.length === 0) throw new PerformanceBenchmarkError('the production shell has no module script');
  while (queue.length > 0) {
    const href = queue.pop();
    if (!href) continue;
    const relative = href.replace(/^[A-Za-z]+:\/\/[^/]+/, '').replace(/^\//, '');
    if (!relative.endsWith('.js') || relative.split('/').includes('..')) {
      throw new PerformanceBenchmarkError('shell graph left the build directory');
    }
    if (seen.has(relative)) continue;
    seen.add(relative);
    const full = path.resolve(distDir, relative);
    if (full !== path.resolve(distDir) && !full.startsWith(path.resolve(distDir) + path.sep)) {
      throw new PerformanceBenchmarkError('shell asset escapes the build directory');
    }
    const source = fs.readFileSync(full, 'utf8');
    const directory = path.posix.dirname(relative);
    for (const specifier of staticJsImports(source)) {
      const next = path.posix.normalize(path.posix.join(directory, specifier));
      queue.push(next);
    }
  }
  const files = [...seen].sort();
  let bytes = 0;
  for (const relative of files) bytes += gzipBytes(fs.readFileSync(path.join(distDir, relative)));
  return { bytes, files };
}

function measureCatalog(): { catalogBytes: number; gazetteerBytes: number } {
  const read = (relative: string) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
  const geographyText = read('data/worldwide/geography-manifest.json');
  const catalog = publishCatalog({
    inventoryText: read('data/worldwide/source-inventory.json'),
    dispositionText: read('data/worldwide/source-dispositions.json'),
    rightsText: read('data/worldwide/rights.json'),
    geographyText,
  });
  return {
    catalogBytes: Buffer.byteLength(JSON.stringify(catalog)),
    gazetteerBytes: Buffer.byteLength(geographyText),
  };
}

function routingCollections(): GlobalCollectionInput[] {
  if (JURISDICTIONS.length !== REPRESENTATIVE_SCALE.jurisdictions) {
    throw new PerformanceBenchmarkError('jurisdiction list drifted from the representative scale');
  }
  const collections: GlobalCollectionInput[] = JURISDICTIONS.map((jurisdiction) => {
    const terms = [
      {
        term: REPRESENTATIVE_SCALE.commonTerm,
        documentFrequency: REPRESENTATIVE_SCALE.commonDocumentFrequency,
        hits: [0, 1].map((index) => ({
          documentId: `${jurisdiction}-doc-${index}`,
          score: 40 - index,
          title: `${jurisdiction} statute ${index}`,
          language: 'en',
          citation: '',
        })),
      },
    ];
    if (jurisdiction === REPRESENTATIVE_SCALE.placeJurisdiction) {
      terms.push({
        term: REPRESENTATIVE_SCALE.placeTerm,
        documentFrequency: REPRESENTATIVE_SCALE.postingEntries,
        hits: [0, 1, 2, 3].map((index) => ({
          documentId: `${jurisdiction}-housing-${index}`,
          score: 80 - index,
          title: index === 0 ? 'Housing Act' : `Housing provision ${index}`,
          language: 'nl',
          citation: '',
        })),
      });
    }
    return {
      collectionId: `c-${jurisdiction}`,
      jurisdictionId: jurisdiction,
      sourceRevision: PIN,
      coverage: 'known' as const,
      indexedRecords: jurisdiction === REPRESENTATIVE_SCALE.placeJurisdiction ? REPRESENTATIVE_SCALE.postingEntries : REPRESENTATIVE_SCALE.commonDocumentFrequency,
      languages: ['en'],
      terms,
    };
  });
  collections.push(
    {
      collectionId: 'c-missing',
      jurisdictionId: 'unmapped',
      sourceRevision: PIN,
      coverage: 'missing',
      indexedRecords: null,
      languages: [],
    },
    {
      collectionId: 'c-unknown',
      jurisdictionId: 'unstated',
      sourceRevision: PIN,
      coverage: 'unknown',
      indexedRecords: null,
      languages: [],
    },
  );
  return collections;
}

function buildRouting(): GlobalRoutingIndex {
  return buildGlobalRouting({
    catalogRevision: PIN,
    asOf: '2026-11-03',
    collections: routingCollections(),
  });
}

function buildPostings(): {
  record: CompactPostingRecord;
  shard: PostingShard;
  route: TermRoute;
  summaries: CompactDocumentSummary[];
  bytes: number;
  bm25: Bm25Parameters;
} {
  const count = REPRESENTATIVE_SCALE.postingEntries;
  const documentIndices: number[] = new Array(count);
  const titleFrequencies: number[] = new Array(count);
  const bodyFrequencies: number[] = new Array(count);
  const documentLengths: number[] = new Array(count);
  for (let index = 0; index < count; index += 1) {
    documentIndices[index] = index;
    titleFrequencies[index] = index % 17 === 0 ? 1 : 0;
    bodyFrequencies[index] = 1;
    documentLengths[index] = 24;
  }
  const record: CompactPostingRecord = {
    term: REPRESENTATIVE_SCALE.placeTerm,
    document_indices: documentIndices,
    title_frequencies: titleFrequencies,
    body_frequencies: bodyFrequencies,
    document_lengths: documentLengths,
    idf: 1.4,
  };
  const records = [record];
  const encoded = canonicalJson(records);
  const bytes = utf8Bytes(encoded).length;
  const sha256 = sha256HexUtf8(encoded);
  const relativePath = 'postings/nl-housing.json';
  return {
    record,
    bytes,
    bm25: { k1: 1.2, b: 0.75, titleWeight: 5, bodyWeight: 1, averageDocumentLength: 24 },
    shard: { relative_path: relativePath, sha256, records },
    route: { first_key: REPRESENTATIVE_SCALE.placeTerm, last_key: REPRESENTATIVE_SCALE.placeTerm, relative_path: relativePath, sha256 },
    summaries: [0, 1, 2, 3, 4].map((index) => ({
      document_index: index * 17,
      identity: `nl:housing:${index}`,
      title: index === 0 ? 'Housing Act' : `Housing provision ${index}`,
      record_type: 'statute',
    })),
  };
}

function artifactBody(label: string): { bytes: Uint8Array; sha256: string } {
  const bytes = new TextEncoder().encode(JSON.stringify({ sourceRevision: PIN, text: label }));
  return { bytes, sha256: sha256HexBytes(bytes) };
}

function headerRecord(init: RequestInit, name: string): string | null {
  const source = init.headers;
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
  for (const [key, value] of Object.entries(source as Record<string, string>)) {
    if (key.toLowerCase() === name && typeof value === 'string') return value;
  }
  return null;
}

async function measureConcurrency(): Promise<{ gate: number; observed: number }> {
  let inFlight = 0;
  let observed = 0;
  const bodies = new Map<string, Uint8Array>();
  const targets: ArtifactTarget[] = [];
  for (let index = 0; index < REPRESENTATIVE_SCALE.concurrencyBatch; index += 1) {
    const fileName = `batch-${index}.json`;
    const filePath = `shards/${fileName}`;
    const artifact = artifactBody(`batch-${index}`);
    bodies.set(fileName, artifact.bytes);
    targets.push({
      datasetId: DATASET,
      revision: PIN,
      path: filePath,
      sha256: artifact.sha256,
      sizeBytes: artifact.bytes.byteLength,
      mediaType: 'application/json',
    });
  }
  const transport = createArtifactTransport({
    pagesOrigin: PAGES_ORIGIN,
    sleep: async () => undefined,
    now: () => Date.parse('2026-11-03T00:00:00Z'),
    fetch: async (url, init) => {
      inFlight += 1;
      if (inFlight > observed) observed = inFlight;
      await new Promise((resolve) => setTimeout(resolve, 30));
      inFlight -= 1;
      const file = decodeURIComponent(url.split('/').pop() || '');
      const bytes = bodies.get(file);
      if (!bytes) throw new PerformanceBenchmarkError('concurrency fetch missed ' + file);
      const headers: Record<string, string> = {
        'access-control-allow-origin': '*',
        'content-type': 'application/json',
        'x-repo-commit': PIN,
      };
      if (headerRecord(init, 'range')) {
        const slice = bytes.slice(0, 32);
        headers['content-range'] = `bytes 0-${slice.byteLength - 1}/${bytes.byteLength}`;
        return new Response(slice, { status: 206, headers });
      }
      return new Response(bytes, { status: 200, headers });
    },
  });
  transport.resetConcurrencySample();
  const batch = await transport.fetchArtifactBatch(targets);
  if (batch.artifacts.length !== targets.length) {
    throw new PerformanceBenchmarkError('concurrency batch did not return every shard');
  }
  return { gate: transport.peakConcurrent(), observed };
}

async function measureTransportCancellation(): Promise<boolean> {
  const artifact = artifactBody('cancel-me');
  const transport = createArtifactTransport({
    pagesOrigin: PAGES_ORIGIN,
    sleep: async () => undefined,
    now: () => Date.parse('2026-11-03T00:00:00Z'),
    fetch: (_url, init) => new Promise((_resolve, reject) => {
      const abort = () => {
        const error = new Error('The operation was aborted');
        error.name = 'AbortError';
        reject(error);
      };
      if (init.signal?.aborted) {
        abort();
        return;
      }
      init.signal?.addEventListener('abort', abort, { once: true });
    }),
  });
  const controller = new AbortController();
  const pending = transport.fetchArtifact({
    datasetId: DATASET,
    revision: PIN,
    path: 'shards/cancel.json',
    sha256: artifact.sha256,
    sizeBytes: artifact.bytes.byteLength,
    mediaType: 'application/json',
  }, controller.signal);
  await new Promise((resolve) => setTimeout(resolve, 15));
  controller.abort();
  try {
    await pending;
    return false;
  } catch (error) {
    return error instanceof TransportError && error.code === 'cancelled';
  }
}

function measuredWorker(): SearchWorkerPort {
  const session = { cancelled: new Set<string>() };
  const port: SearchWorkerPort = {
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    postMessage(message) {
      setTimeout(() => {
        void handleWorkerMessage(message, session).then((response) => {
          port.onmessage?.({ data: response });
        });
      }, 0);
    },
    terminate() {
      // The benchmark port has no thread to stop.
    },
  };
  return port;
}

async function measureWorkerCancellation(posting: ReturnType<typeof buildPostings>): Promise<{ cancelled: boolean; examinedEntries: number }> {
  const client = createWorldwideSearchClient({ createWorker: () => measuredWorker(), timeoutMs: 5_000 });
  const pending = client.search({
    id: 'cancel-scale',
    query: REPRESENTATIVE_SCALE.placeTerm,
    bm25: posting.bm25,
    shards: [posting.shard],
    routes: [posting.route],
    summaries: posting.summaries,
  });
  client.cancel('cancel-scale');
  const response: SearchWorkerResponse = await pending;
  client.terminate();
  return {
    cancelled: response.ok === true && response.cancelled === true && response.result?.diagnostics.cancelReason === 'caller',
    examinedEntries: response.result?.diagnostics.examinedEntries ?? -1,
  };
}

function budgetsMet(measurements: PerformanceDocument['measurements']): boolean {
  const within = (Object.entries(PLAN_PERFORMANCE_TARGETS) as Array<[keyof typeof PLAN_PERFORMANCE_TARGETS, number]>).every(([key, limit]) => {
    const value = measurements[key];
    return Number.isInteger(value) && value >= 0 && value <= limit;
  });
  return within && measurements.cancellation_observed === true;
}

export async function runPerformanceBenchmark(input: { shellDist: string }): Promise<BenchmarkRun> {
  const regressions: string[] = [];
  const peak = { bytes: process.memoryUsage().heapUsed };
  const shell = measureShellGzip(input.shellDist);
  noteHeap(peak);
  const catalog = measureCatalog();
  noteHeap(peak);
  const catalogBytes = catalog.catalogBytes + catalog.gazetteerBytes;
  const index = buildRouting();
  const posting = buildPostings();
  noteHeap(peak);

  const searchable = REPRESENTATIVE_SCALE.jurisdictions;
  const fanoutPage = searchWorldwide(index, { query: REPRESENTATIVE_SCALE.commonTerm });
  const fanout = readCommonTermFanout(fanoutPage);
  if (!fanout.commonQuery) regressions.push('common term was not marked common');
  if (fanout.perCountryFanout !== false) regressions.push('common term used per-country fanout');
  if (fanout.shardRequests < 1 || fanout.shardRequests > GLOBAL_CONCURRENCY) {
    regressions.push('common-term shard fanout was ' + fanout.shardRequests);
  }
  if (fanout.unopenedShards < 1) regressions.push('common-term search opened every jurisdiction shard');
  if (fanout.requests >= searchable) regressions.push('common-term requests were not below the jurisdiction count');
  if (fanoutPage.hits.length < 1) regressions.push('common-term page had no useful hit');

  const placePage = searchWorldwide(index, {
    query: REPRESENTATIVE_SCALE.placeTerm,
    filters: { jurisdictions: [REPRESENTATIVE_SCALE.placeJurisdiction] },
  });
  if (placePage.hits.length < 1) regressions.push('place search summary had no useful hit');
  if (placePage.perCountryFanout !== false) regressions.push('place search used per-country fanout');
  const opened = new Set(placePage.walk.openedShardPaths);
  const directoryBytes = placePage.walk.loadedPaths
    .filter((item) => !opened.has(item))
    .map((item) => index.documents[item]?.loadedBytes ?? 0);
  const shardSummaryBytes = placePage.walk.openedShardPaths
    .reduce((sum, item) => sum + (index.documents[item]?.loadedBytes ?? 0), 0);
  const routingBytes = directoryBytes.reduce((sum, item) => sum + item, 0) + shardSummaryBytes;
  const firstPlaceBytes = routingBytes + posting.bytes;
  if (routingBytes !== placePage.budgets.bytes) regressions.push('place page byte account drifted from the routing budget');

  const concurrency = await measureConcurrency();
  noteHeap(peak);
  if (concurrency.gate !== TRANSPORT_LIMITS.maxConcurrent || concurrency.observed !== TRANSPORT_LIMITS.maxConcurrent) {
    regressions.push('four-request concurrency peaked at gate ' + concurrency.gate + ' and fetch ' + concurrency.observed);
  }
  const transportCancelled = await measureTransportCancellation();
  const workerCancellation = await measureWorkerCancellation(posting);
  if (!transportCancelled) regressions.push('transport cancellation was not observed');
  if (!workerCancellation.cancelled) regressions.push('worker cancellation was not observed');
  if (workerCancellation.examinedEntries <= 0 || workerCancellation.examinedEntries >= REPRESENTATIVE_SCALE.postingEntries) {
    regressions.push('worker cancellation examined ' + workerCancellation.examinedEntries + ' entries');
  }
  const cancellationObserved = transportCancelled
    && workerCancellation.cancelled
    && workerCancellation.examinedEntries > 0
    && workerCancellation.examinedEntries < REPRESENTATIVE_SCALE.postingEntries;

  const client = createWorldwideSearchClient({ createWorker: () => measuredWorker(), timeoutMs: 5_000 });
  const placeRequest = {
    query: REPRESENTATIVE_SCALE.placeTerm,
    filters: { jurisdictions: [REPRESENTATIVE_SCALE.placeJurisdiction] },
  };
  await client.search({
    id: 'warm-up',
    query: REPRESENTATIVE_SCALE.placeTerm,
    bm25: posting.bm25,
    shards: [posting.shard],
    routes: [posting.route],
    summaries: posting.summaries,
  });
  const samples: number[] = [];
  for (let trial = 0; trial < REPRESENTATIVE_SCALE.trials; trial += 1) {
    const started = performance.now();
    const page = searchWorldwide(index, placeRequest);
    const response = await client.search({
      id: `warm-${trial}`,
      query: REPRESENTATIVE_SCALE.placeTerm,
      bm25: posting.bm25,
      shards: [posting.shard],
      routes: [posting.route],
      summaries: posting.summaries,
    });
    const elapsed = performance.now() - started;
    if (page.hits.length < 1 || !response.ok || response.cancelled || (response.result?.hits.length ?? 0) < 1) {
      regressions.push('warm trial ' + trial + ' did not return a useful hit');
    }
    samples.push(elapsed);
    noteHeap(peak);
  }
  client.terminate();

  const hostP95 = p95(samples);
  const network = waveMs(catalogBytes)
    + directoryBytes.reduce((sum, bytes) => sum + waveMs(bytes), 0)
    + waveMs(shardSummaryBytes)
    + waveMs(posting.bytes);
  const measurements = {
    shell_gzip_bytes: shell.bytes,
    catalog_bytes: catalogBytes,
    first_place_search_bytes: firstPlaceBytes,
    warm_p95_ms: Math.ceil(hostP95 * CPU_SLOWDOWN),
    cold_p95_ms: Math.ceil(network + hostP95 * CPU_SLOWDOWN),
    concurrent_requests: concurrency.gate,
    heap_bytes: peak.bytes,
    common_term_fanout_requests: fanout.requests,
    cancellation_observed: cancellationObserved,
  };
  for (const [key, limit] of Object.entries(PLAN_PERFORMANCE_TARGETS)) {
    const value = measurements[key as keyof typeof measurements];
    if (typeof value === 'number' && value > limit) regressions.push(key + ' is ' + value + ' and the PLAN.md target is ' + limit);
  }
  if (!cancellationObserved) regressions.push('cancellation was not observed');

  const document: PerformanceDocument = {
    schema: PERFORMANCE_SCHEMA,
    profile: MOBILE_PROFILE,
    measurements,
    targets: { ...PLAN_PERFORMANCE_TARGETS },
    budgets_met: budgetsMet(measurements) && regressions.length === 0,
    regressions,
    scale: {
      jurisdictions: REPRESENTATIVE_SCALE.jurisdictions,
      posting_entries: REPRESENTATIVE_SCALE.postingEntries,
      worker_yield_every: REPRESENTATIVE_SCALE.workerYieldEvery,
      trials: REPRESENTATIVE_SCALE.trials,
      concurrency_batch: REPRESENTATIVE_SCALE.concurrencyBatch,
      common_term: REPRESENTATIVE_SCALE.commonTerm,
      place_term: REPRESENTATIVE_SCALE.placeTerm,
      place_jurisdiction: REPRESENTATIVE_SCALE.placeJurisdiction,
    },
    trace: {
      cpu_slowdown: CPU_SLOWDOWN,
      rtt_ms: TRACE_RTT_MS,
      downlink_bits_per_second: TRACE_DOWNLINK_BPS,
      source: 'Recorded mid-range mobile profile. CPU slowdown is the Chrome DevTools 4x throttle. Network is a responsive LTE trace of 70 ms RTT and 12 Mbit/s, applied to the measured catalog, directory, shard-summary, and posting bytes. Not a physical handset.',
    },
    host: {
      warm_p95_ms: Math.ceil(hostP95),
      warm_samples_ms: samples.map((sample) => Math.round(sample * 1000) / 1000),
    },
    transfers: {
      shell_gzip_bytes: shell.bytes,
      shell_files: shell.files,
      catalog_json_bytes: catalog.catalogBytes,
      gazetteer_bytes: catalog.gazetteerBytes,
      routing_bytes: routingBytes,
      posting_bytes: posting.bytes,
      directory_waves: directoryBytes.length,
      shard_summary_bytes: shardSummaryBytes,
    },
    fanout: {
      requests: fanout.requests,
      shard_requests: fanout.shardRequests,
      unopened_shards: fanout.unopenedShards,
      searchable_collections: searchable,
      per_country_fanout: false,
    },
    cancellation: {
      worker_examined_entries: workerCancellation.examinedEntries,
      worker_cancelled: workerCancellation.cancelled,
      transport_cancelled: transportCancelled,
    },
  };
  if (document.budgets_met !== (budgetsMet(measurements) && document.regressions.length === 0)) {
    throw new PerformanceBenchmarkError('budgets_met drifted');
  }
  return { document };
}

function option(name: string): string {
  const index = process.argv.indexOf(name);
  if (index < 0) return '';
  return process.argv[index + 1] ?? '';
}

function runningAsCli(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(entry).href;
  } catch {
    return false;
  }
}

if (runningAsCli()) {
  const shellDist = option('--shell-dist') || path.join(ROOT, 'dist');
  runPerformanceBenchmark({ shellDist }).then((result) => {
    const text = JSON.stringify(result.document, null, 2) + '\n';
    if (process.argv.includes('--write')) {
      const target = path.join(ROOT, 'docs/worldwide/performance.json');
      const temporary = target + '.tmp';
      fs.writeFileSync(temporary, text);
      fs.renameSync(temporary, target);
    }
    process.stdout.write(text);
    if (!result.document.budgets_met) process.exitCode = 1;
  }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'benchmark failed';
    process.stderr.write(message + '\n');
    process.exit(1);
  });
}

export function performanceDocumentSha256(document: PerformanceDocument): string {
  return createHash('sha256').update(JSON.stringify(document)).digest('hex');
}

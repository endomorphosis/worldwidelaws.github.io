import { readFileSync } from 'node:fs';
import path from 'node:path';

import { tokenize } from '../../src/lib/worldwide/search/tokenize';
import { searchCompactPostings } from '../../src/lib/worldwide/search/bm25';
import {
  chooseArtifactAccess,
  interpretByteRangeResponse,
  type TransportCapability,
} from '../../src/lib/worldwide/data/transport';
import {
  createWorldwideSearchClient,
  handleWorkerMessage,
  type SearchWorkerPort,
  type WorkerInbound,
} from '../../src/workers/worldwideSearchWorker';

const ROOT = process.cwd();
const BOUNDARY_PATH = path.join(ROOT, 'docs/worldwide/browser-boundary.json');
const VITE_PATH = path.join(ROOT, 'vite.config.ts');

interface BoundaryFile {
  path: string;
  role: string;
}

interface DynamicImport {
  from: string;
  specifier: string;
  resolved: string | null;
  reason: string;
}

interface BrowserBoundary {
  schema: string;
  task_id: string;
  roots: string[];
  closure: BoundaryFile[];
  allowed_bare_specifiers: Record<string, string[]>;
  dynamic_imports_excluded: DynamicImport[];
  excluded_paths: string[];
  forbidden_specifier_patterns: string[];
  forbidden_code_patterns: string[];
  forbidden_raw_patterns: string[];
  worker_constructor_files: string[];
  deployment: {
    development_only_headers_const: string;
    development_headers: Record<string, string>;
    server_headers_reference: string;
    preview_headers_empty: boolean;
    build_sends_isolation_headers: boolean;
    worker_format: string;
    search_worker_module_type: string;
    production_cross_origin_isolated: boolean;
    production_shared_array_buffer: boolean;
    production_wasm_threads: boolean;
    core_search_loads_wasm: boolean;
    onnx_alias_reachable_from_core_search: boolean;
    vite_config_is_build_tooling: boolean;
  };
  limitations: string[];
}

interface Walk {
  files: string[];
  bare: Map<string, string[]>;
  dynamic: Array<{ from: string; specifier: string; resolved: string | null }>;
}

function stripComments(source: string): string {
  let out = '';
  let index = 0;
  let state = 'code';
  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];
    if (state === 'code') {
      if (char === '/' && next === '/') {
        state = 'line';
        index += 2;
        continue;
      }
      if (char === '/' && next === '*') {
        state = 'block';
        index += 2;
        continue;
      }
      if (char === "'" || char === '"' || char === '`') {
        state = char;
        out += char;
        index += 1;
        continue;
      }
      out += char;
      index += 1;
      continue;
    }
    if (state === 'line') {
      if (char === '\n') {
        state = 'code';
        out += char;
      }
      index += 1;
      continue;
    }
    if (state === 'block') {
      if (char === '*' && next === '/') {
        state = 'code';
        index += 2;
        continue;
      }
      if (char === '\n') out += char;
      index += 1;
      continue;
    }
    out += char;
    if (char === '\\' && index + 1 < source.length) {
      out += source[index + 1];
      index += 2;
      continue;
    }
    if (char === state) state = 'code';
    index += 1;
  }
  return out;
}

function stripStrings(source: string): string {
  let out = '';
  let index = 0;
  let state = 'code';
  while (index < source.length) {
    const char = source[index];
    if (state === 'code') {
      if (char === "'" || char === '"' || char === '`') {
        state = char;
        out += ' ';
        index += 1;
        continue;
      }
      out += char;
      index += 1;
      continue;
    }
    if (char === '\\') {
      index += 2;
      continue;
    }
    if (char === state) {
      state = 'code';
      index += 1;
      continue;
    }
    if (char === '\n' && state !== '`') state = 'code';
    else if (char === '\n') out += '\n';
    index += 1;
  }
  return out;
}

function resolveRelative(fromAbsolute: string, specifier: string): string | null {
  const target = path.normalize(path.join(path.dirname(fromAbsolute), specifier));
  const candidates = path.extname(target)
    ? [target]
    : [
      `${target}.ts`,
      `${target}.tsx`,
      `${target}.js`,
      `${target}.mjs`,
      `${target}.css`,
      path.join(target, 'index.ts'),
      path.join(target, 'index.tsx'),
    ];
  for (const candidate of candidates) {
    try {
      readFileSync(candidate);
      return candidate;
    } catch {
      // Try the next extension. A missing import is reported by the walker.
    }
  }
  return null;
}

function relPath(absolute: string): string {
  return path.relative(ROOT, absolute).split(path.sep).join('/');
}

function walk(roots: readonly string[]): Walk {
  const seen = new Set<string>();
  const bare = new Map<string, string[]>();
  const dynamic: Walk['dynamic'] = [];
  const unresolved: string[] = [];
  const queue = roots.map((rel) => path.join(ROOT, rel));
  while (queue.length > 0) {
    const absolute = queue.pop() as string;
    const rel = relPath(absolute);
    if (seen.has(rel)) continue;
    seen.add(rel);
    const code = stripComments(readFileSync(absolute, 'utf8'));
    const staticSpecs = new Set<string>();
    const staticRe = /(?:\bfrom\s+|^\s*import\s+)['"]([^'"]+)['"]/gm;
    let match: RegExpExecArray | null;
    while ((match = staticRe.exec(code))) staticSpecs.add(match[1]);
    const dynamicRe = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    while ((match = dynamicRe.exec(code))) {
      const specifier = match[1];
      if (staticSpecs.has(specifier)) continue;
      const resolved = specifier.startsWith('.') ? resolveRelative(absolute, specifier) : null;
      dynamic.push({
        from: rel,
        specifier,
        resolved: resolved ? relPath(resolved) : null,
      });
    }
    for (const specifier of staticSpecs) {
      if (specifier.startsWith('.')) {
        const resolved = resolveRelative(absolute, specifier);
        if (!resolved) unresolved.push(`${rel} -> ${specifier}`);
        else queue.push(resolved);
      } else {
        const importers = bare.get(specifier) ?? [];
        importers.push(rel);
        bare.set(specifier, importers);
      }
    }
  }
  expect(unresolved).toEqual([]);
  for (const importers of bare.values()) importers.sort();
  dynamic.sort((left, right) => (left.from + left.specifier).localeCompare(right.from + right.specifier));
  return { files: [...seen].sort(), bare, dynamic };
}

function blockBody(source: string, key: string): string {
  const marker = new RegExp(`\\b${key}\\s*:\\s*\\{`);
  const found = marker.exec(source);
  if (!found) throw new Error(`vite config is missing ${key}`);
  const start = found.index + found[0].length - 1;
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start + 1, index);
    }
  }
  throw new Error(`vite config ${key} block is unbalanced`);
}

function codeOf(rel: string): string {
  return stripStrings(stripComments(readFileSync(path.join(ROOT, rel), 'utf8')));
}

function inProcessPort(): SearchWorkerPort {
  const port = {
    onmessage: null as SearchWorkerPort['onmessage'],
    onerror: null as SearchWorkerPort['onerror'],
    onmessageerror: null as SearchWorkerPort['onmessageerror'],
    postMessage(message: WorkerInbound) {
      void handleWorkerMessage(message).then((response) => {
        port.onmessage?.({ data: response });
      });
    },
    terminate() {
      // The in-process port has no dedicated thread to stop.
    },
  };
  return port;
}

function loadBoundary(): BrowserBoundary {
  return JSON.parse(readFileSync(BOUNDARY_PATH, 'utf8')) as BrowserBoundary;
}

describe('browser-only search boundary', () => {
  const boundary = loadBoundary();
  const walked = walk(boundary.roots);

  test('the audited closure is the static core-search graph', () => {
    expect(boundary.schema).toBe('worldwide-legal-search.browser-boundary@1');
    expect(boundary.task_id).toBe('WWL-080');
    expect(boundary.roots).toEqual([
      'src/main.tsx',
      'src/workers/worldwideSearchWorker.ts',
      'src/components/worldwide/SearchResults.tsx',
      'src/lib/worldwide/data/transport.ts',
    ]);
    expect(boundary.closure.map((file) => file.path)).toEqual(walked.files);
    expect(new Set(boundary.closure.map((file) => file.role)).size).toBeGreaterThan(3);
    const bare = Object.fromEntries([...walked.bare.entries()].sort((left, right) => left[0].localeCompare(right[0])));
    expect(bare).toEqual(boundary.allowed_bare_specifiers);
    expect(walked.dynamic).toEqual(boundary.dynamic_imports_excluded.map(({ from, specifier, resolved }) => ({
      from,
      specifier,
      resolved,
    })));
    for (const excluded of boundary.excluded_paths) {
      expect(walked.files).not.toContain(excluded);
    }
    for (const edge of boundary.dynamic_imports_excluded) {
      expect(edge.resolved).toBeTruthy();
      expect(walked.files).not.toContain(edge.resolved);
      const legacy = readFileSync(path.join(ROOT, edge.resolved as string), 'utf8');
      expect(legacy).toContain('clientLLMWorkerService');
      expect(legacy).toContain('clientEmbeddingWorkerService');
    }
  });

  test('core search does not import Node, Convex, proxies, Python, login, GPU, WASM threads, or secrets', () => {
    const specifierPatterns = boundary.forbidden_specifier_patterns.map((pattern) => new RegExp(pattern));
    const codePatterns = boundary.forbidden_code_patterns.map((pattern) => new RegExp(pattern));
    const rawPatterns = boundary.forbidden_raw_patterns.map((pattern) => new RegExp(pattern));
    const specifierHits: string[] = [];
    const codeHits: string[] = [];
    const rawHits: string[] = [];
    const workerHits: string[] = [];
    for (const [specifier, importers] of walked.bare) {
      for (const pattern of specifierPatterns) {
        if (pattern.test(specifier)) specifierHits.push(`${specifier} via ${importers.join(',')}`);
      }
    }
    for (const rel of walked.files) {
      const absolute = path.join(ROOT, rel);
      const raw = readFileSync(absolute, 'utf8');
      const code = stripComments(raw);
      const staticRe = /(?:\bfrom\s+|^\s*import\s+|import\s*\(\s*)['"]([^'"]+)['"]/gm;
      let match: RegExpExecArray | null;
      while ((match = staticRe.exec(code))) {
        for (const pattern of specifierPatterns) {
          if (pattern.test(match[1])) specifierHits.push(`${rel} ${match[1]}`);
        }
      }
      const executable = codeOf(rel);
      for (const pattern of codePatterns) {
        const found = executable.match(pattern);
        if (found) codeHits.push(`${rel} ${pattern.source} ${found[0]}`);
      }
      for (const pattern of rawPatterns) {
        const found = raw.match(pattern);
        if (found) rawHits.push(`${rel} ${pattern.source} ${found[0]}`);
      }
      if (executable.includes('new Worker') && !boundary.worker_constructor_files.includes(rel)) {
        workerHits.push(rel);
      }
    }
    expect(specifierHits).toEqual([]);
    expect(codeHits).toEqual([]);
    expect(rawHits).toEqual([]);
    expect(workerHits).toEqual([]);
    const worker = readFileSync(path.join(ROOT, 'src/workers/worldwideSearchWorker.ts'), 'utf8');
    expect(worker).toContain("new Worker(new URL('./worldwideSearchWorker.ts', import.meta.url), { type: 'module' })");
    expect(worker).not.toContain('SharedArrayBuffer');
    expect(worker).not.toContain('crossOriginIsolated');
    expect(worker).not.toContain('numThreads');
  });

  test('production search runs while isolation, GPU, WASM, and secrets are unavailable', async () => {
    const previousBuffer = Object.getOwnPropertyDescriptor(globalThis, 'SharedArrayBuffer');
    const previousIsolated = Object.getOwnPropertyDescriptor(globalThis, 'crossOriginIsolated');
    const navigatorGpu = Object.getOwnPropertyDescriptor(navigator, 'gpu');
    const wasm = globalThis.WebAssembly as {
      instantiate: (...args: unknown[]) => Promise<unknown>;
      instantiateStreaming: (...args: unknown[]) => Promise<unknown>;
    };
    const instantiate = wasm.instantiate;
    const instantiateStreaming = wasm.instantiateStreaming;
    let wasmCalls = 0;
    Object.defineProperty(globalThis, 'SharedArrayBuffer', {
      configurable: true,
      get() {
        throw new Error('core search touched SharedArrayBuffer');
      },
    });
    Object.defineProperty(globalThis, 'crossOriginIsolated', {
      configurable: true,
      value: false,
    });
    Object.defineProperty(navigator, 'gpu', {
      configurable: true,
      get() {
        throw new Error('core search read navigator.gpu');
      },
    });
    wasm.instantiate = () => {
      wasmCalls += 1;
      return Promise.reject(new Error('core search instantiated WASM'));
    };
    wasm.instantiateStreaming = () => {
      wasmCalls += 1;
      return Promise.reject(new Error('core search streamed WASM'));
    };
    const env = (globalThis as { import?: { meta?: { env?: unknown } } }).import?.meta;
    const previousEnv = env?.env;
    if (env) {
      env.env = new Proxy({}, {
        get() {
          throw new Error('core search read import.meta.env');
        },
      });
    }
    try {
      expect(tokenize('Café housing')).toEqual(['cafe', 'housing']);
      expect(globalThis.crossOriginIsolated).toBe(false);
      const postings = [{
        term: 'housing',
        document_indices: [0],
        title_frequencies: [1],
        body_frequencies: [1],
        document_lengths: [2],
        idf: 1.2,
      }];
      const summaries = [{
        document_index: 0,
        identity: 'doc-housing',
        title: 'Housing Act',
        record_type: 'law',
      }];
      const bm25 = { average_document_length: 2 };
      const direct = await searchCompactPostings({
        query: 'Housing',
        bm25,
        postings,
        summaries,
      });
      expect(direct.hits[0]).toMatchObject({
        documentIndex: 0,
        identity: 'doc-housing',
        title: 'Housing Act',
        recordType: 'law',
      });
      expect(direct.hits[0].score).toBeGreaterThan(0);
      expect(direct.diagnostics.cancelled).toBe(false);
      const client = createWorldwideSearchClient({ createWorker: inProcessPort, timeoutMs: 2000 });
      const response = await client.search({
        query: 'housing',
        bm25,
        postings,
        summaries,
      });
      expect(response.ok).toBe(true);
      expect(response.result?.hits[0].title).toBe('Housing Act');
      expect(wasmCalls).toBe(0);
      client.terminate();
    } finally {
      wasm.instantiate = instantiate;
      wasm.instantiateStreaming = instantiateStreaming;
      if (env) env.env = previousEnv;
      if (previousBuffer) Object.defineProperty(globalThis, 'SharedArrayBuffer', previousBuffer);
      else delete (globalThis as { SharedArrayBuffer?: unknown }).SharedArrayBuffer;
      if (previousIsolated) Object.defineProperty(globalThis, 'crossOriginIsolated', previousIsolated);
      else delete (globalThis as { crossOriginIsolated?: unknown }).crossOriginIsolated;
      if (navigatorGpu) Object.defineProperty(navigator, 'gpu', navigatorGpu);
      else delete (navigator as { gpu?: unknown }).gpu;
    }
  });

  test('production workers and WASM do not rely on development COOP or COEP headers', () => {
    const source = readFileSync(VITE_PATH, 'utf8');
    const deployment = boundary.deployment;
    expect(deployment.production_cross_origin_isolated).toBe(false);
    expect(deployment.production_shared_array_buffer).toBe(false);
    expect(deployment.production_wasm_threads).toBe(false);
    expect(deployment.core_search_loads_wasm).toBe(false);
    expect(deployment.onnx_alias_reachable_from_core_search).toBe(false);
    expect(deployment.vite_config_is_build_tooling).toBe(true);
    expect(deployment.build_sends_isolation_headers).toBe(false);
    expect(deployment.preview_headers_empty).toBe(true);
    expect(walked.files).not.toContain('vite.config.ts');
    expect(source).toContain("from 'node:path'");
    expect(source).toContain(deployment.development_only_headers_const);
    const headerNames = Object.keys(deployment.development_headers);
    expect(headerNames).toEqual(['Cross-Origin-Embedder-Policy', 'Cross-Origin-Opener-Policy']);
    for (const name of headerNames) {
      expect(source.split(name).length - 1).toBe(1);
      expect(source).toContain(`'${name}': '${deployment.development_headers[name]}'`);
    }
    const server = blockBody(source, 'server');
    const preview = blockBody(source, 'preview');
    const build = blockBody(source, 'build');
    const worker = blockBody(source, 'worker');
    expect(server).toContain(`headers: ${deployment.server_headers_reference}`);
    expect(server).not.toContain('Cross-Origin-Embedder-Policy');
    expect(server).not.toContain('Cross-Origin-Opener-Policy');
    expect(preview.replace(/\s+/g, '')).toContain('headers:{}');
    expect(preview).not.toContain('Cross-Origin');
    expect(preview).not.toContain('require-corp');
    expect(build).not.toContain('headers');
    expect(build).not.toContain('Cross-Origin');
    expect(build).not.toContain('require-corp');
    expect(worker).toContain(`format: '${deployment.worker_format}'`);
    expect(worker).not.toContain('Cross-Origin');
    expect(worker).not.toContain('SharedArrayBuffer');
    expect(worker).not.toContain('numThreads');
    for (const rel of walked.files) {
      expect(readFileSync(path.join(ROOT, rel), 'utf8')).not.toContain('onnxruntime-web');
    }
    expect(source).toContain('onnxruntime-web');

    const pagesOrigin = 'https://worldwidelaws.github.io';
    const measured = interpretByteRangeResponse({
      pagesOrigin,
      resourceUrl: 'https://huggingface.co/datasets/example/laws/resolve/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/shards/housing.json',
      status: 200,
      headers: new Headers({
        'access-control-allow-origin': pagesOrigin,
        'cross-origin-opener-policy': 'same-origin',
        'cross-origin-embedder-policy': 'require-corp',
      }),
      bodyByteLength: 0,
      bodyRefused: true,
    });
    expect(measured.crossOriginIsolationAssumed).toBe(false);
    expect(measured.sharedArrayBufferAssumed).toBe(false);
    expect(measured.workerModel).toBe('single-thread');
    expect(measured.credentials).toBe('omit');
    expect([...measured.ignoredIsolationHeaders].sort()).toEqual([
      'cross-origin-embedder-policy',
      'cross-origin-opener-policy',
    ]);
    const target = {
      datasetId: 'example/laws',
      revision: 'a'.repeat(40),
      path: 'shards/housing.json',
      sha256: 'b'.repeat(64),
      sizeBytes: 128,
    };
    expect(chooseArtifactAccess(target, measured).mode).toBe('whole');
    const isolated = {
      ...measured,
      sharedArrayBufferAssumed: true,
      crossOriginIsolationAssumed: true,
    } as TransportCapability;
    const refused = chooseArtifactAccess(target, isolated);
    expect(refused.mode).toBe('refuse');
    expect(refused.reason).toContain('Isolation flags cannot authorize');
    const notes = boundary.limitations.join('\n');
    expect(notes).toContain('GitHub Pages');
    expect(notes).toContain('developmentIsolationHeaders');
    expect(notes).toContain('WetWijzerLegalResearchApp');
    expect(notes).toContain('pythonJsonDumps');
    expect(notes).toContain('onnxruntime-web');
    expect(notes).toContain('SharedArrayBuffer');
  });
});

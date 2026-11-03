/**
 * BM25 search worker.
 *
 * The main thread posts compact postings and waits. Scoring runs in
 * handleWorkerMessage. A thrown search error is returned as ok:false.
 * A dead or silent port is terminated. The client never busy-waits and
 * never scores on the caller stack.
 */
import {
  Bm25SearchError,
  searchCompactPostings,
  type Bm25Parameters,
  type CompactDocumentSummary,
  type CompactPostingRecord,
  type PostingShard,
  type SearchBudget,
  type SearchResult,
  type TermRoute,
} from '../lib/worldwide/search/bm25';

export interface SearchWorkerRequest {
  id: string;
  type: 'search';
  query: string;
  bm25: Bm25Parameters;
  topK?: number;
  budget?: Partial<SearchBudget>;
  summaries?: readonly CompactDocumentSummary[];
  postings?: readonly CompactPostingRecord[];
  shards?: readonly PostingShard[];
  routes?: readonly TermRoute[];
  yieldEvery?: number;
}

export interface CancelWorkerRequest {
  id: string;
  type: 'cancel';
}

export type WorkerInbound = SearchWorkerRequest | CancelWorkerRequest;

export interface WorkerErrorBody {
  code: string;
  message: string;
}

export interface SearchWorkerResponse {
  id: string;
  type: 'search' | 'cancel';
  ok: boolean;
  cancelled?: boolean;
  result?: SearchResult;
  error?: WorkerErrorBody;
}

export interface WorkerSession {
  cancelled: Set<string>;
}

export function createWorkerSession(): WorkerSession {
  return { cancelled: new Set() };
}

export interface SearchWorkerPort {
  postMessage(message: WorkerInbound): void;
  terminate(): void;
  onmessage: ((event: { data: SearchWorkerResponse }) => void) | null;
  onerror: ((event: { message?: string; preventDefault?: () => void }) => void) | null;
  onmessageerror: ((event: { message?: string; preventDefault?: () => void }) => void) | null;
}

export class SearchWorkerFailure extends Error {
  readonly code: 'worker-failed' | 'worker-timeout' | 'worker-unavailable';

  constructor(code: SearchWorkerFailure['code'], message: string) {
    super(message);
    this.name = 'SearchWorkerFailure';
    this.code = code;
  }
}

const DEFAULT_TIMEOUT_MS = 5_000;

/**
 * Entries scored between returns to the event loop.
 *
 * A full place shard is the production traversal budget, 50_000 posting
 * entries. Yielding every 128 entries on that shard spends the warm-search
 * budget on timer turns. 1024 still returns often enough for a cancel
 * message to land before the shard is finished, and shouldCancel is still
 * read on every entry.
 */
export const SEARCH_WORKER_YIELD_EVERY = 1024;

function macrotask(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function errorBody(error: unknown): WorkerErrorBody {
  if (error instanceof Bm25SearchError) return { code: error.code, message: error.message };
  const message = error instanceof Error ? error.message : 'search worker failed';
  return { code: 'worker-failed', message };
}

function emptyCancelled(id: string, topK: number): SearchWorkerResponse {
  return {
    id,
    type: 'search',
    ok: true,
    cancelled: true,
    result: {
      hits: [],
      diagnostics: {
        cancelled: true,
        cancelReason: 'caller',
        examinedEntries: 0,
        examinedBytes: 0,
        examinedRecords: 0,
        queryTerms: [],
        missedTerms: [],
        absentTerms: [],
        topK,
        ranked: 0,
        truncated: false,
        budgetClamped: false,
        blockedRecordBytes: null,
      },
    },
  };
}

export async function handleWorkerMessage(message: WorkerInbound, session: WorkerSession = createWorkerSession()): Promise<SearchWorkerResponse> {
  if (!message || typeof message !== 'object' || typeof message.id !== 'string' || message.id.length === 0) {
    return { id: '', type: 'search', ok: false, error: { code: 'invalid-request', message: 'invalid-request: worker message needs an id' } };
  }
  if (message.type === 'cancel') {
    session.cancelled.add(message.id);
    return { id: message.id, type: 'cancel', ok: true, cancelled: true };
  }
  if (message.type !== 'search') {
    return { id: message.id, type: 'search', ok: false, error: { code: 'invalid-request', message: 'invalid-request: unknown worker message' } };
  }
  if (session.cancelled.has(message.id)) return emptyCancelled(message.id, message.topK ?? 10);
  const yieldEvery = message.yieldEvery ?? SEARCH_WORKER_YIELD_EVERY;
  try {
    const result = await searchCompactPostings({
      query: message.query,
      bm25: message.bm25,
      postings: message.postings,
      shards: message.shards,
      routes: message.routes,
      summaries: message.summaries,
      topK: message.topK,
      budget: message.budget,
      yieldEvery,
      yieldNow: () => macrotask(),
      shouldCancel: () => session.cancelled.has(message.id),
    });
    return {
      id: message.id,
      type: 'search',
      ok: true,
      cancelled: result.diagnostics.cancelled,
      result,
    };
  } catch (error) {
    return { id: message.id, type: 'search', ok: false, error: errorBody(error) };
  }
}

interface PendingSearch {
  resolve: (response: SearchWorkerResponse) => void;
  reject: (error: SearchWorkerFailure) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface WorldwideSearchClient {
  search(input: Omit<SearchWorkerRequest, 'type' | 'id'> & { id?: string }): Promise<SearchWorkerResponse>;
  cancel(id: string): void;
  terminate(): void;
}

export function createWorldwideSearchClient(options: {
  createWorker?: () => SearchWorkerPort;
  timeoutMs?: number;
} = {}): WorldwideSearchClient {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1) {
    throw new SearchWorkerFailure('worker-unavailable', 'timeoutMs must be a positive number');
  }
  let worker: SearchWorkerPort | null = null;
  let sequence = 0;
  let failing = false;
  const pending = new Map<string, PendingSearch>();

  function failWorker(error: SearchWorkerFailure) {
    if (failing) return;
    failing = true;
    const waiting = [...pending.values()];
    pending.clear();
    const current = worker;
    worker = null;
    try {
      current?.terminate();
    } catch {
      // The port is already dead. The caller still receives the failure.
    }
    failing = false;
    for (const item of waiting) {
      clearTimeout(item.timer);
      item.reject(error);
    }
  }

  function attach(port: SearchWorkerPort) {
    port.onmessage = (event) => {
      try {
        const data = event?.data;
        if (!data || data.type === 'cancel') return;
        const item = pending.get(data.id);
        if (!item) return;
        clearTimeout(item.timer);
        pending.delete(data.id);
        item.resolve(data);
      } catch {
        // A broken callback must not escape onto the main thread.
      }
    };
    port.onerror = (event) => {
      event?.preventDefault?.();
      failWorker(new SearchWorkerFailure('worker-failed', event?.message || 'search worker failed'));
    };
    port.onmessageerror = (event) => {
      event?.preventDefault?.();
      failWorker(new SearchWorkerFailure('worker-failed', event?.message || 'search worker message error'));
    };
  }

  function ensure(): SearchWorkerPort {
    if (worker) return worker;
    const factory = options.createWorker ?? defaultWorkerFactory;
    const created = factory();
    if (!created || typeof created.postMessage !== 'function' || typeof created.terminate !== 'function') {
      throw new SearchWorkerFailure('worker-unavailable', 'search worker port is incomplete');
    }
    worker = created;
    attach(worker);
    return worker;
  }

  return {
    search(input) {
      const id = input.id ?? `wwl-search-${sequence += 1}`;
      return new Promise((resolve, reject) => {
        let port: SearchWorkerPort;
        try {
          port = ensure();
        } catch (error) {
          reject(error instanceof SearchWorkerFailure ? error : new SearchWorkerFailure('worker-unavailable', 'search worker did not start'));
          return;
        }
        const timer = setTimeout(() => {
          if (!pending.has(id)) return;
          failWorker(new SearchWorkerFailure('worker-timeout', 'search worker timed out'));
        }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        try {
          port.postMessage({ ...input, id, type: 'search' });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'postMessage failed';
          failWorker(new SearchWorkerFailure('worker-failed', message));
        }
      });
    },
    cancel(id) {
      if (!id || !worker) return;
      try {
        worker.postMessage({ id, type: 'cancel' });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'postMessage failed';
        failWorker(new SearchWorkerFailure('worker-failed', message));
      }
    },
    terminate() {
      failWorker(new SearchWorkerFailure('worker-failed', 'search worker terminated'));
    },
  };
}

function defaultWorkerFactory(): SearchWorkerPort {
  if (typeof Worker === 'undefined') {
    throw new SearchWorkerFailure('worker-unavailable', 'Worker is not available in this runtime');
  }
  return new Worker(new URL('./worldwideSearchWorker.ts', import.meta.url), { type: 'module' }) as unknown as SearchWorkerPort;
}

function bindDedicatedWorker() {
  const scope = globalThis as typeof globalThis & {
    onmessage: ((event: MessageEvent<WorkerInbound>) => void) | null;
    postMessage: (message: SearchWorkerResponse) => void;
  };
  if (typeof WorkerGlobalScope === 'undefined' || !(scope instanceof WorkerGlobalScope)) return;
  const session = createWorkerSession();
  scope.onmessage = (event: MessageEvent<WorkerInbound>) => {
    void handleWorkerMessage(event.data, session)
      .then((response) => {
        scope.postMessage(response);
      })
      .catch((error: unknown) => {
        const body = errorBody(error);
        const id = event.data && typeof event.data === 'object' && 'id' in event.data ? String(event.data.id) : '';
        scope.postMessage({ id, type: 'search', ok: false, error: body });
      });
  };
}

bindDedicatedWorker();

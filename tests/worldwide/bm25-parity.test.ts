import { spawnSync } from 'node:child_process';

import { canonicalJson, sha256HexUtf8 } from '../../src/lib/worldwide/data/identity';
import {
  BM25_LIMITATIONS,
  BM25_UPSTREAM,
  Bm25SearchError,
  measurePostingBytes,
  searchCompactPostings,
  type CompactPostingRecord,
  type PostingShard,
  type SearchHit,
  type TermRoute,
} from '../../src/lib/worldwide/search/bm25';
import {
  createWorkerSession,
  createWorldwideSearchClient,
  handleWorkerMessage,
  type SearchWorkerPort,
  type SearchWorkerResponse,
} from '../../src/workers/worldwideSearchWorker';
import { prepareIndex, type PreparedIndex } from '../../scripts/worldwide/build-index';

const REVISION = 'a'.repeat(40);

/**
 * Scores captured from country_laws_ir bm25.score_query at commit
 * 2ea4ca6804b3c4cc44e43d0539f4c3fcae011747. The stdlib reference below
 * has to reproduce these values, and the TypeScript reader has to
 * reproduce the stdlib reference.
 */
const PINNED: Record<string, Array<[number, number]>> = {
  'housing benefit': [
    [4, 2.210966825965861],
    [1, 2.0935767479440193],
    [0, 2.036096126168482],
    [3, 0.93283609371235],
    [2, 0.7517617817866732],
  ],
  housing: [
    [1, 1.3995514114715566],
    [0, 1.3758747898489174],
    [4, 0.7959029230151764],
    [2, 0.7517617817866732],
  ],
  'alpha alpha': [
    [3, 4.712372673769715],
    [0, 4.578800736343622],
  ],
  alpha: [
    [3, 2.3561863368848575],
    [0, 2.289400368171811],
  ],
  café: [[4, 3.361953833249242]],
  'Article 6:162': [[4, 5.672794445563074]],
  'missing term xyzzy': [],
  '': [],
  '   ': [],
  'zeta eta': [
    [8, 3.4706492538824993],
    [7, 3.4706492538824993],
  ],
  'eta zeta': [
    [7, 3.4706492538824993],
    [8, 3.4706492538824993],
  ],
  statute: [
    [5, 2.5090887804921014],
    [6, 2.5090887804921014],
  ],
  the: [[0, 1.5685748522057048]],
  'benefit benefit': [
    [4, 2.830127805901369],
    [3, 1.8656721874247],
    [1, 1.3880506729449256],
    [0, 1.3204426726391294],
  ],
  benefit: [
    [4, 1.4150639029506844],
    [3, 0.93283609371235],
    [1, 0.6940253364724628],
    [0, 0.6602213363195647],
  ],
  'Νόμος housing': [
    [1, 1.3995514114715566],
    [0, 1.3758747898489174],
    [4, 0.7959029230151764],
    [2, 0.7517617817866732],
  ],
};

const QUERIES = Object.keys(PINNED);

const CORPUS = [
  { entry_cid: 'bafyrei-doc-0', source_id: 'src', title: 'Alpha Housing Act', body: 'The housing benefit shall be paid.', record_type: 'law' },
  { entry_cid: 'bafyrei-doc-1', source_id: 'src', title: 'Beta Housing Code', body: 'Housing benefit rules differ.', record_type: 'law' },
  { entry_cid: 'bafyrei-doc-2', source_id: 'src', title: 'Gamma Tax', body: 'No housing words here, only tax.', record_type: 'article' },
  { entry_cid: 'bafyrei-doc-3', source_id: 'src', title: 'Delta', body: 'alpha alpha alpha benefit', record_type: 'law' },
  { entry_cid: 'bafyrei-doc-4', source_id: 'src', title: 'Café Benefit', body: 'Article 6:162 housing.', record_type: 'law' },
  { entry_cid: 'bafyrei-doc-5', source_id: 'src', title: 'Statute One', body: 'plain words', record_type: 'law' },
  { entry_cid: 'bafyrei-doc-6', source_id: 'src', title: 'Statute Two', body: 'plain words', record_type: 'law' },
  { entry_cid: 'bafyrei-doc-7', source_id: 'src', title: 'Eta Marker', body: 'tail', record_type: 'law' },
  { entry_cid: 'bafyrei-doc-8', source_id: 'src', title: 'Zeta Marker', body: 'tail', record_type: 'law' },
];

const PYTHON_REFERENCE = `
import json, math, re, sys, unicodedata

K1 = 1.2
B = 0.75
TITLE_WEIGHT = 5.0
BODY_WEIGHT = 1.0
MAX_QUERY_TERMS = 64

def tokenize(text):
    if not text:
        return []
    nfkd = unicodedata.normalize("NFKD", text)
    folded = "".join(ch for ch in nfkd if not unicodedata.combining(ch)).lower()
    return re.findall(r"[0-9A-Za-z]+", folded)

def build(docs):
    title_toks = [tokenize(doc.get("title") or "") for doc in docs]
    body_toks = [tokenize(doc.get("body") or "") for doc in docs]
    doc_len = [len(title) * TITLE_WEIGHT + len(body) * BODY_WEIGHT for title, body in zip(title_toks, body_toks)]
    avgdl = (sum(doc_len) / len(doc_len)) if docs else 0.0
    postings = {}
    for index, (title, body) in enumerate(zip(title_toks, body_toks)):
        title_tf = {}
        body_tf = {}
        for tok in title:
            title_tf[tok] = title_tf.get(tok, 0) + 1
        for tok in body:
            body_tf[tok] = body_tf.get(tok, 0) + 1
        for tok in set(title_tf) | set(body_tf):
            postings.setdefault(tok, {})[index] = (title_tf.get(tok, 0), body_tf.get(tok, 0))
    n_docs = len(docs)
    idf = {}
    for term, plist in postings.items():
        df = len(plist)
        idf[term] = math.log((n_docs - df + 0.5) / (df + 0.5) + 1.0)
    return postings, idf, doc_len, avgdl

def score(query, index):
    postings, idf, doc_len, avgdl = index
    avgdl = avgdl or 1.0
    terms = tokenize(query)[:MAX_QUERY_TERMS]
    scores = {}
    order = []
    for term in terms:
        plist = postings.get(term)
        if not plist:
            continue
        weight = idf.get(term, 0.0)
        for doc in sorted(plist):
            title_tf, body_tf = plist[doc]
            tf = TITLE_WEIGHT * title_tf + BODY_WEIGHT * body_tf
            length = float(doc_len[doc])
            denom = tf + K1 * (1.0 - B + B * (length / avgdl if avgdl else 0.0))
            add = 0.0 if denom == 0 else weight * (tf * (K1 + 1.0)) / denom
            if doc not in scores:
                scores[doc] = 0.0
                order.append(doc)
            scores[doc] += add
    ranked = sorted(order, key=lambda doc: scores[doc], reverse=True)[:10]
    return {"terms": terms, "rank": [[doc, scores[doc]] for doc in ranked]}

payload = json.load(sys.stdin)
index = build(payload["documents"])
postings, idf, doc_len, avgdl = index
queries = []
for query in payload["queries"]:
    row = score(query, index)
    row["query"] = query
    queries.append(row)
json.dump({"avgdl": avgdl, "lengths": doc_len, "queries": queries}, sys.stdout)
`;

interface PythonQuery {
  query: string;
  terms: string[];
  rank: Array<[number, number]>;
}

interface PythonReference {
  avgdl: number;
  lengths: number[];
  queries: PythonQuery[];
}

function runPython(): PythonReference {
  const run = spawnSync('/usr/bin/python3.12', ['-I', '-c', PYTHON_REFERENCE], {
    input: JSON.stringify({ documents: CORPUS, queries: QUERIES }),
    encoding: 'utf8',
  });
  if (run.status !== 0) {
    throw new Error(`python reference exited ${run.status}: ${run.stderr || run.stdout}`);
  }
  return JSON.parse(run.stdout) as PythonReference;
}

function expectRank(hits: readonly SearchHit[], expected: Array<[number, number]>) {
  expect(hits.map((hit) => hit.documentIndex)).toEqual(expected.map(([index]) => index));
  hits.forEach((hit, index) => {
    expect(hit.score).toBeCloseTo(expected[index][1], 9);
  });
}

function build(postingRowsPerRecord?: number): PreparedIndex {
  return prepareIndex({
    asOf: '2026-11-03',
    sourceRevision: REVISION,
    jurisdictionId: 'place:example',
    level: 'national',
    datasetId: 'example/laws',
    collectionId: 'example.laws',
    documents: CORPUS,
    postingRowsPerRecord,
  });
}

function shardsOf(index: PreparedIndex): PostingShard[] {
  return index.offline.posting_shards.map((shard) => ({
    relative_path: shard.relative_path,
    sha256: shard.sha256,
    records: shard.records,
  }));
}

function routesOf(index: PreparedIndex): TermRoute[] {
  return index.term_routing.map((route) => ({
    first_key: route.first_key,
    last_key: route.last_key,
    relative_path: route.relative_path,
    sha256: route.sha256,
  }));
}

function port(handler: (message: Parameters<SearchWorkerPort['postMessage']>[0], worker: SearchWorkerPort) => void): SearchWorkerPort & { terminated: boolean } {
  const worker = {
    terminated: false,
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    postMessage(message: Parameters<SearchWorkerPort['postMessage']>[0]) {
      handler(message, worker);
    },
    terminate() {
      worker.terminated = true;
    },
  } as SearchWorkerPort & { terminated: boolean };
  return worker;
}

describe('bounded BM25 parity', () => {
  const python = runPython();
  const wide = build();
  const chunked = build(1);
  const byQuery = new Map(python.queries.map((row) => [row.query, row]));

  test('pins the upstream BM25 files and the known reader limits', () => {
    expect(BM25_UPSTREAM.commit).toBe('2ea4ca6804b3c4cc44e43d0539f4c3fcae011747');
    expect(BM25_UPSTREAM.files.bm25.sha256).toBe('f9393c3f58572e2db13c42d0e258e31384fae32f805539041bd32115c3812610');
    expect(BM25_UPSTREAM.files.query.sha256).toBe('bca6bb94ff367d2758ce866065b6b9bcf1faa9ffd5102471d2c9cbbacc340eb3');
    expect(BM25_LIMITATIONS.some((item) => item.includes('score_query'))).toBe(true);
    expect(BM25_LIMITATIONS.some((item) => item.includes('does not'))).toBe(true);
  });

  test('the stdlib Python reference matches score_query on the selected cases', () => {
    expect(python.lengths.reduce((sum, length) => sum + length, 0)).toBe(125);
    expect(python.avgdl).toBeCloseTo(13.88888888888889, 12);
    for (const query of QUERIES) {
      const row = byQuery.get(query);
      expect(row).toBeDefined();
      expect(row?.rank.map(([index]) => index)).toEqual(PINNED[query].map(([index]) => index));
      row?.rank.forEach(([, score], index) => {
        expect(score).toBeCloseTo(PINNED[query][index][1], 12);
      });
    }
    expect(byQuery.get('café')?.terms).toEqual(['cafe']);
    expect(byQuery.get('Νόμος housing')?.terms).toEqual(['housing']);
    expect(byQuery.get('alpha alpha')?.terms).toEqual(['alpha', 'alpha']);
  });

  test('compact postings keep the Python document lengths', () => {
    expect(wide.decision).toBe('emit-compact');
    expect(wide.offline.document_summaries.map((row) => row.document_length)).toEqual(python.lengths);
    expect(wide.bm25.average_document_length).toBeCloseTo(python.avgdl, 12);
    expect(wide.offline.postings.length).toBeGreaterThan(0);
    expect(wide.offline.posting_shards.length).toBeGreaterThan(0);
  });

  test.each([
    ['wide shards', wide],
    ['one row per posting chunk', chunked],
  ])('searches actual compact postings for %s', async (_label, index) => {
    for (const query of QUERIES) {
      const result = await searchCompactPostings({
        query,
        bm25: index.bm25,
        shards: shardsOf(index),
        routes: routesOf(index),
        summaries: index.offline.document_summaries,
        topK: 10,
      });
      expect(result.diagnostics.cancelReason).toBe('none');
      expectRank(result.hits, byQuery.get(query)?.rank ?? []);
      if (query === 'housing benefit') {
        expect(result.hits[0]).toMatchObject({
          documentIndex: 4,
          identity: 'bafyrei-doc-4',
          title: 'Café Benefit',
          recordType: 'law',
        });
        expect(result.hits[0].matchedTerms).toEqual(['housing', 'benefit']);
      }
    }
  });

  test('repeated searches and case folding stay on the same order', async () => {
    const first = await searchCompactPostings({
      query: 'Housing Benefit',
      bm25: wide.bm25,
      shards: shardsOf(wide),
      routes: routesOf(wide),
      summaries: wide.offline.document_summaries,
    });
    const second = await searchCompactPostings({
      query: 'housing benefit',
      bm25: wide.bm25,
      postings: wide.offline.postings,
      summaries: wide.offline.document_summaries,
    });
    expect(first.hits).toEqual(second.hits);
    expectRank(first.hits, PINNED['housing benefit']);
  });

  test('equal scores follow first-seen order, which flips with the query', async () => {
    const zeta = await searchCompactPostings({
      query: 'zeta eta',
      bm25: wide.bm25,
      shards: shardsOf(wide),
      routes: routesOf(wide),
    });
    const eta = await searchCompactPostings({
      query: 'eta zeta',
      bm25: wide.bm25,
      shards: shardsOf(wide),
      routes: routesOf(wide),
    });
    expect(zeta.hits.map((hit) => hit.documentIndex)).toEqual([8, 7]);
    expect(eta.hits.map((hit) => hit.documentIndex)).toEqual([7, 8]);
    expect(zeta.hits[0].score).toBe(zeta.hits[1].score);
    expect(zeta.hits[0].firstSeen).toBeLessThan(zeta.hits[1].firstSeen);
    const statute = await searchCompactPostings({
      query: 'statute',
      bm25: wide.bm25,
      shards: shardsOf(wide),
      routes: routesOf(wide),
    });
    expect(statute.hits.map((hit) => hit.documentIndex)).toEqual([5, 6]);
    expect(statute.hits[0].score).toBe(statute.hits[1].score);
  });

  test('a repeated query token is added again', async () => {
    const once = await searchCompactPostings({
      query: 'benefit',
      bm25: wide.bm25,
      shards: shardsOf(wide),
      routes: routesOf(wide),
    });
    const twice = await searchCompactPostings({
      query: 'benefit benefit',
      bm25: wide.bm25,
      shards: shardsOf(wide),
      routes: routesOf(wide),
    });
    expect(twice.hits.map((hit) => hit.documentIndex)).toEqual(once.hits.map((hit) => hit.documentIndex));
    twice.hits.forEach((hit, index) => {
      expect(hit.score).toBeCloseTo(once.hits[index].score * 2, 9);
    });
  });

  test('topK keeps the best hit and reports the rest', async () => {
    const result = await searchCompactPostings({
      query: 'housing benefit',
      bm25: wide.bm25,
      shards: shardsOf(wide),
      routes: routesOf(wide),
      topK: 1,
    });
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0].documentIndex).toBe(4);
    expect(result.diagnostics.ranked).toBe(5);
    expect(result.diagnostics.truncated).toBe(true);
  });

  test('a traversal budget stops before the next entry', async () => {
    const result = await searchCompactPostings({
      query: 'statute',
      bm25: wide.bm25,
      shards: shardsOf(wide),
      routes: routesOf(wide),
      budget: { maxPostingEntries: 1 },
    });
    expect(result.diagnostics.cancelReason).toBe('traversal-budget');
    expect(result.diagnostics.examinedEntries).toBe(1);
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0].documentIndex).toBe(5);
    expect(result.hits[0].score).toBeCloseTo(PINNED.statute[0][1], 9);
  });

  test('a repeated token stops on the traversal budget mid-pass', async () => {
    const result = await searchCompactPostings({
      query: 'alpha alpha',
      bm25: wide.bm25,
      shards: shardsOf(wide),
      routes: routesOf(wide),
      budget: { maxPostingEntries: 3 },
    });
    expect(result.diagnostics.cancelReason).toBe('traversal-budget');
    expect(result.diagnostics.examinedEntries).toBe(3);
    expect(result.hits.map((hit) => hit.documentIndex)).toEqual([0, 3]);
    expect(result.hits[0].score).toBeCloseTo(PINNED.alpha[1][1] * 2, 9);
    expect(result.hits[1].score).toBeCloseTo(PINNED.alpha[0][1], 9);
  });

  test('a memory budget stops before the next posting record', async () => {
    const housing = chunked.offline.postings
      .filter((record) => record.term === 'housing')
      .sort((left, right) => left.posting_chunk_index - right.posting_chunk_index);
    expect(housing.length).toBeGreaterThan(1);
    const firstBytes = measurePostingBytes(housing[0] as CompactPostingRecord);
    const secondBytes = measurePostingBytes(housing[1] as CompactPostingRecord);
    const result = await searchCompactPostings({
      query: 'housing',
      bm25: chunked.bm25,
      shards: shardsOf(chunked),
      routes: routesOf(chunked),
      budget: { maxBytes: firstBytes },
    });
    expect(result.diagnostics.cancelReason).toBe('memory-budget');
    expect(result.diagnostics.examinedRecords).toBe(1);
    expect(result.diagnostics.examinedBytes).toBe(firstBytes);
    expect(result.diagnostics.blockedRecordBytes).toBe(secondBytes);
    expect(result.hits.map((hit) => hit.documentIndex)).toEqual([0]);
    expect(result.hits[0].score).toBeCloseTo(PINNED.housing[1][1], 9);
  });

  test('caller cancellation leaves the entries already applied', async () => {
    let steps = 0;
    const result = await searchCompactPostings({
      query: 'statute',
      bm25: wide.bm25,
      shards: shardsOf(wide),
      routes: routesOf(wide),
      yieldEvery: 1,
      yieldNow() {
        steps += 1;
      },
      shouldCancel: () => steps >= 1,
    });
    expect(steps).toBe(1);
    expect(result.diagnostics.cancelReason).toBe('caller');
    expect(result.diagnostics.examinedEntries).toBe(1);
    expect(result.hits.map((hit) => hit.documentIndex)).toEqual([5]);
  });

  test('a term outside every route does not fall back to other shards', async () => {
    const hidden: CompactPostingRecord = {
      term: 'hidden',
      document_indices: [0],
      title_frequencies: [1],
      body_frequencies: [0],
      document_lengths: [5],
      idf: 1.5,
      posting_chunk_index: 0,
    };
    const shown: CompactPostingRecord = {
      term: 'shown',
      document_indices: [1],
      title_frequencies: [1],
      body_frequencies: [0],
      document_lengths: [5],
      idf: 1.5,
      posting_chunk_index: 0,
    };
    const hiddenRecords = [hidden];
    const shownRecords = [shown];
    const shards: PostingShard[] = [
      { relative_path: 'indexes/compact-postings/hidden.json', sha256: sha256HexUtf8(canonicalJson(hiddenRecords)), records: hiddenRecords },
      { relative_path: 'indexes/compact-postings/shown.json', sha256: sha256HexUtf8(canonicalJson(shownRecords)), records: shownRecords },
    ];
    const routes: TermRoute[] = [
      { first_key: 'shown', last_key: 'shown', relative_path: shards[1].relative_path },
    ];
    const missed = await searchCompactPostings({
      query: 'hidden',
      bm25: { average_document_length: 5 },
      shards,
      routes,
    });
    expect(missed.hits).toEqual([]);
    expect(missed.diagnostics.missedTerms).toEqual(['hidden']);
    expect(missed.diagnostics.cancelReason).toBe('none');
    const mixed = await searchCompactPostings({
      query: 'hidden shown',
      bm25: { average_document_length: 5 },
      shards,
      routes,
    });
    expect(mixed.hits.map((hit) => hit.documentIndex)).toEqual([1]);
    expect(mixed.diagnostics.missedTerms).toEqual(['hidden']);
    expect(mixed.hits[0].score).toBeCloseTo(2.661290322580645, 9);
  });

  test('ambiguous routes, bad checksums, and uneven postings fail closed', async () => {
    const records = shardsOf(wide)[0].records;
    const covered = routesOf(wide)[0];
    await expect(searchCompactPostings({
      query: covered.first_key,
      bm25: wide.bm25,
      shards: shardsOf(wide),
      routes: [
        covered,
        { ...covered, relative_path: 'indexes/compact-postings/other.json' },
      ],
    })).rejects.toMatchObject({ code: 'term-routing-ambiguous' });

    await expect(searchCompactPostings({
      query: 'housing',
      bm25: wide.bm25,
      shards: shardsOf(wide).map((shard) => ({ ...shard, sha256: '0'.repeat(64) })),
      routes: routesOf(wide),
    })).rejects.toBeInstanceOf(Bm25SearchError);

    await expect(searchCompactPostings({
      query: 'housing',
      bm25: wide.bm25,
      shards: shardsOf(wide).map((shard) => ({ ...shard, sha256: '0'.repeat(64) })),
      routes: routesOf(wide),
    })).rejects.toMatchObject({ code: 'checksum-mismatch' });

    await expect(searchCompactPostings({
      query: 'housing',
      bm25: wide.bm25,
      postings: [{
        term: 'housing',
        document_indices: [0],
        title_frequencies: [],
        body_frequencies: [1],
        document_lengths: [5],
        idf: 1,
        posting_chunk_index: 0,
      }],
    })).rejects.toMatchObject({ code: 'invalid-posting' });

    await expect(searchCompactPostings({
      query: 'housing',
      bm25: { ...wide.bm25, k1: 2 },
      postings: records,
    })).rejects.toMatchObject({ code: 'bm25-constants-mismatch' });

    expect(records.length).toBeGreaterThan(0);
  });

  test('the worker returns ranked hits and a handled failure', async () => {
    const session = createWorkerSession();
    const ranked = await handleWorkerMessage({
      id: 'ranked',
      type: 'search',
      query: 'statute',
      bm25: wide.bm25,
      shards: shardsOf(wide),
      routes: routesOf(wide),
      summaries: wide.offline.document_summaries,
    }, session);
    expect(ranked.ok).toBe(true);
    expect(ranked.result?.hits.map((hit) => hit.documentIndex)).toEqual([5, 6]);

    const failed = await handleWorkerMessage({
      id: 'bad-posting',
      type: 'search',
      query: 'housing',
      bm25: wide.bm25,
      postings: [{
        term: 'housing',
        document_indices: [0],
        title_frequencies: [],
        body_frequencies: [1],
        document_lengths: [5],
        idf: 1,
      }],
    }, session);
    expect(failed.ok).toBe(false);
    expect(failed.error?.code).toBe('invalid-posting');

    await handleWorkerMessage({ id: 'early', type: 'cancel' }, session);
    const cancelled = await handleWorkerMessage({
      id: 'early',
      type: 'search',
      query: 'statute',
      bm25: wide.bm25,
      shards: shardsOf(wide),
      routes: routesOf(wide),
    }, session);
    expect(cancelled.ok).toBe(true);
    expect(cancelled.cancelled).toBe(true);
    expect(cancelled.result?.hits).toEqual([]);
    expect(cancelled.result?.diagnostics.cancelReason).toBe('caller');
  });

  test('the client stays pending until the worker replies', async () => {
    let posted = false;
    let release: (response: SearchWorkerResponse) => void = () => undefined;
    const gate = new Promise<SearchWorkerResponse>((resolve) => {
      release = resolve;
    });
    const worker = port((_message, current) => {
      posted = true;
      void gate.then((response) => current.onmessage?.({ data: response }));
    });
    const client = createWorldwideSearchClient({ createWorker: () => worker, timeoutMs: 500 });
    let settled = false;
    const pending = client.search({
      id: 'wait',
      query: 'statute',
      bm25: wide.bm25,
      postings: [],
    }).then((response) => {
      settled = true;
      return response;
    });
    expect(posted).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(settled).toBe(false);
    release({
      id: 'wait',
      type: 'search',
      ok: true,
      result: {
        hits: [],
        diagnostics: {
          cancelled: false,
          cancelReason: 'none',
          examinedEntries: 0,
          examinedBytes: 0,
          examinedRecords: 0,
          queryTerms: ['statute'],
          missedTerms: [],
          absentTerms: ['statute'],
          topK: 10,
          ranked: 0,
          truncated: false,
          budgetClamped: false,
          blockedRecordBytes: null,
        },
      },
    });
    const response = await pending;
    expect(settled).toBe(true);
    expect(response.ok).toBe(true);
    expect(worker.terminated).toBe(false);
  });

  test('a worker error rejects while the main thread keeps running', async () => {
    let prevented = 0;
    const worker = port((_message, current) => {
      setTimeout(() => {
        current.onerror?.({
          message: 'boom',
          preventDefault() {
            prevented += 1;
          },
        });
      }, 20);
    });
    const client = createWorldwideSearchClient({ createWorker: () => worker, timeoutMs: 500 });
    let beats = 0;
    const heartbeat = setInterval(() => {
      beats += 1;
    }, 5);
    const started = Date.now();
    await expect(client.search({
      id: 'crash',
      query: 'housing',
      bm25: wide.bm25,
      postings: [],
    })).rejects.toMatchObject({ code: 'worker-failed', message: 'boom' });
    clearInterval(heartbeat);
    expect(Date.now() - started).toBeLessThan(400);
    expect(beats).toBeGreaterThan(0);
    expect(prevented).toBe(1);
    expect(worker.terminated).toBe(true);
  });

  test('a silent worker times out and the next search can start', async () => {
    let builds = 0;
    const client = createWorldwideSearchClient({
      timeoutMs: 40,
      createWorker: () => {
        builds += 1;
        if (builds === 1) return port(() => undefined);
        return port((_message, current) => {
          queueMicrotask(() => {
            current.onmessage?.({
              data: { id: 'again', type: 'search', ok: true, cancelled: false },
            });
          });
        });
      },
    });
    let beats = 0;
    const heartbeat = setInterval(() => {
      beats += 1;
    }, 5);
    const started = Date.now();
    await expect(client.search({
      id: 'hung',
      query: 'statute',
      bm25: wide.bm25,
      postings: [],
    })).rejects.toMatchObject({ code: 'worker-timeout' });
    clearInterval(heartbeat);
    expect(Date.now() - started).toBeLessThan(500);
    expect(beats).toBeGreaterThan(0);
    const again = await client.search({
      id: 'again',
      query: 'statute',
      bm25: wide.bm25,
      postings: [],
    });
    expect(again.ok).toBe(true);
    expect(builds).toBe(2);
  });

  test('a handled worker failure does not kill the port or freeze the caller', async () => {
    const worker = port((message, current) => {
      void handleWorkerMessage(message).then((response) => {
        current.onmessage?.({ data: response });
      });
    });
    const client = createWorldwideSearchClient({ createWorker: () => worker, timeoutMs: 500 });
    const failed = await client.search({
      id: 'bad',
      query: 'housing',
      bm25: wide.bm25,
      postings: [{
        term: 'housing',
        document_indices: [0],
        title_frequencies: [],
        body_frequencies: [1],
        document_lengths: [5],
        idf: 1,
      }],
    });
    expect(failed.ok).toBe(false);
    expect(failed.error?.code).toBe('invalid-posting');
    expect(worker.terminated).toBe(false);
    const ranked = await client.search({
      id: 'good',
      query: 'statute',
      bm25: wide.bm25,
      shards: shardsOf(wide),
      routes: routesOf(wide),
      summaries: wide.offline.document_summaries,
    });
    expect(ranked.ok).toBe(true);
    expect(ranked.result?.hits.map((hit) => hit.documentIndex)).toEqual([5, 6]);
    expect(worker.terminated).toBe(false);
  });
});

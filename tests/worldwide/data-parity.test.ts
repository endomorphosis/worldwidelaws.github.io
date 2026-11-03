import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { sha256Hex, SchemaError } from '../../src/lib/worldwide/data/schema';
import {
  CORPUS_SCHEMA_VERSION,
  ENTRY_IDENTITY_SCHEMA,
  INHERIT_VERSION,
  LAW_IDENTITY_SCHEMA,
  canonicalJson,
  cidOfJson,
  cidOfText,
  cidV1RawSha256,
  entryCid,
  foldIdentity,
  inheritancePlan,
  lawCid,
  normalizeLegalText,
  pythonJsonDumps,
  refineAtom,
  replacementTitle,
  sha256HexUtf8,
  sha256KeyToCidV1,
  type EntryIdentityInput,
  type HeadingKey,
  type InheritanceRow,
  type LawIdentityInput,
} from '../../src/lib/worldwide/data/identity';
import {
  normalizeCorpus,
  type MirrorLink,
  type NormalizeInput,
  type NormalizedRecord,
  type NormalizeResult,
} from '../../scripts/worldwide/normalize';

const REQUIRED_COVERS = [
  'nulls',
  'conflicting-status',
  'article-inheritance',
  'canonical-hashes-cids',
  'duplicated-mirrors',
] as const;

interface UpstreamFile {
  path: string;
  worktreeSha256: string;
  headBlob: string;
  dirty: boolean;
}

interface Vector {
  kind: string;
  name: string;
  covers: string[];
  input?: unknown;
  expected?: unknown;
  parts?: Array<string | null>;
  rows?: InheritanceRow[];
  title?: string;
  text?: string;
  lawCode?: string | null;
  record?: Record<string, unknown>;
  headings?: Partial<Record<HeadingKey, string>>;
}

interface CorpusCase {
  id: string;
  covers: string[];
  input: NormalizeInput;
  expected?: NormalizeResult;
  expect?: string;
  messageIncludes?: string[];
}

interface ParityManifest {
  schema: string;
  taskId: string;
  textLicense: string;
  upstream: {
    commit: string;
    license: string;
    licenseName: string;
    schemas: { corpus: string; entry: string; law: string; inherit: string };
    files: UpstreamFile[];
    notes: string[];
  };
  covers: string[];
  vectors: Vector[];
  cases: CorpusCase[];
}

const manifest = JSON.parse(
  readFileSync(join(process.cwd(), 'tests/worldwide/fixtures/parity-manifest.json'), 'utf8'),
) as ParityManifest;

function evaluateVector(vector: Vector): unknown {
  switch (vector.kind) {
    case 'sha256-text':
      return sha256HexUtf8(String(vector.input));
    case 'cid-bytes-empty':
      return cidV1RawSha256(new Uint8Array());
    case 'cid-text':
      return cidOfText(...(vector.parts ?? []));
    case 'canonical-json':
      return canonicalJson(vector.input);
    case 'cid-json':
      return cidOfJson(vector.input);
    case 'sha256-key':
      return sha256KeyToCidV1(String(vector.input));
    case 'python-json':
      return pythonJsonDumps(vector.input);
    case 'normalize-text':
      return normalizeLegalText(vector.input);
    case 'normalize-nan':
      return normalizeLegalText(Number.NaN);
    case 'fold':
      return foldIdentity(String(vector.input));
    case 'inheritance-plan':
      return inheritancePlan(vector.rows ?? []);
    case 'replacement-title':
      return replacementTitle(vector.title ?? '', vector.text ?? '', vector.lawCode ?? null);
    case 'refine-atom':
      return refineAtom(vector.record ?? {}, vector.lawCode ?? null, vector.headings ?? {});
    case 'law-cid':
      return lawCid(vector.input as LawIdentityInput);
    case 'entry-cid':
      return entryCid(vector.input as EntryIdentityInput);
    default:
      throw new Error(`Unknown parity vector ${vector.kind}`);
  }
}

function caseById(id: string): CorpusCase {
  const found = manifest.cases.find((item) => item.id === id);
  if (!found || !found.expected) throw new Error(`Missing corpus case ${id}`);
  return found;
}

function runCase(id: string): NormalizeResult {
  return normalizeCorpus(caseById(id).input);
}

describe('country-law parity fixtures', () => {
  test('binds the upstream commit, license, and source hashes', () => {
    expect(manifest.schema).toBe('worldwide-legal-search.parity-manifest@1');
    expect(manifest.taskId).toBe('WWL-014');
    expect(manifest.textLicense).toBe('fixture-synthetic');
    expect(manifest.upstream.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(manifest.upstream.license).toBe('AGPL-3.0-only');
    expect(manifest.upstream.licenseName).toContain('Affero');
    expect(manifest.upstream.schemas).toEqual({
      corpus: CORPUS_SCHEMA_VERSION,
      entry: ENTRY_IDENTITY_SCHEMA,
      law: LAW_IDENTITY_SCHEMA,
      inherit: INHERIT_VERSION,
    });
    expect(manifest.upstream.files.length).toBeGreaterThanOrEqual(6);
    for (const file of manifest.upstream.files) {
      expect(file.worktreeSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(file.headBlob).toMatch(/^[0-9a-f]{40}$/);
    }
    const directory = manifest.upstream.files.find((file) => file.path.endsWith('national_directory.py'));
    expect(directory?.dirty).toBe(true);
    expect(manifest.upstream.notes.join(' ')).toContain('_fold');
    for (const topic of REQUIRED_COVERS) {
      expect(manifest.covers).toContain(topic);
      const bound = [...manifest.vectors, ...manifest.cases].some((item) => item.covers.includes(topic));
      expect(bound).toBe(true);
    }
  });

  test('sha256 hex matches the schema hasher for the empty string and abc', () => {
    expect(sha256HexUtf8('')).toBe(sha256Hex(''));
    expect(sha256HexUtf8('abc')).toBe(sha256Hex('abc'));
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  test.each(manifest.vectors)('$kind $name matches the Python fixture', (vector) => {
    expect(evaluateVector(vector)).toEqual(vector.expected);
  });

  test.each(manifest.cases)('corpus $id matches the Python fixture', (item) => {
    if (item.expect === 'schema-error') {
      let thrown: unknown;
      try {
        normalizeCorpus(item.input);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(SchemaError);
      const message = thrown instanceof Error ? thrown.message : '';
      for (const part of item.messageIncludes ?? []) expect(message).toContain(part);
      return;
    }
    expect(normalizeCorpus(item.input)).toEqual(item.expected);
  });
});

describe('normalization acceptance', () => {
  test('null ids are quarantined per row and no official id is invented', () => {
    const result = runCase('nulls');
    const missing = result.quarantined.filter((row) => row.reason === 'missing-section-id' || row.reason === 'missing-instrument-id');
    expect(missing.length).toBeGreaterThanOrEqual(2);
    for (const row of missing) {
      expect(row.officialCitation).toBeNull();
      if (row.reason === 'missing-section-id') expect(row.sourceId).toBeNull();
    }
    expect(result.records.some((record) => record.title === 'Missing id')).toBe(false);
    expect(result.drops.emptyBody).toContain('mt-null-body');
    expect(result.drops.missingInstrument).toContain('mt-art-orphan');
    expect(result.records.map((record) => record.sourceId)).not.toContain('mt-null-body');
  });

  test('a status or date conflict chooses neither value', () => {
    const result = runCase('conflicting-status');
    expect(result.records.map((record) => record.sourceId)).not.toContain('mt-conflict');
    expect(result.records.map((record) => record.sourceId)).not.toContain('mt-date-conflict');
    const status = result.quarantined.find((row) => row.sourceId === 'mt-conflict');
    const date = result.quarantined.find((row) => row.sourceId === 'mt-date-conflict');
    expect(status?.reason).toBe('conflicting-status');
    expect(status?.detail).toContain('Neither value was chosen');
    expect(status?.detail).toContain('current');
    expect(status?.detail).toContain('repealed');
    expect(date?.reason).toBe('conflicting-date');
    expect(date?.detail).toContain('Neither value was chosen');
    const meta = result.records.find((record) => record.sourceId === 'mt-status-meta');
    const column = result.records.find((record) => record.sourceId === 'mt-status-col');
    expect(meta?.lawStatus).toBe('historical');
    expect(column?.lawStatus).toBe('repealed');
    const invalid = result.quarantined.find((row) => row.sourceId === 'mt-bad-status');
    expect(invalid?.reason).toBe('invalid-status');
  });

  test('article inheritance changes the display title and not the entry CID or body hash', () => {
    const item = caseById('article-inheritance');
    const result = runCase('article-inheritance');
    const inherited = result.records.filter((record) => record.inheritedTitle);
    expect(inherited.map((record) => record.sourceId).sort()).toEqual(
      expect.arrayContaining(['fr-code-1', 'fr-a1', 'fr-a3', 'fr-a5']),
    );
    for (const record of inherited) {
      expect(record.title).toBe('CODE CIVIL');
      expect(record.bodySha256).toBe(sha256HexUtf8(record.body));
      expect(record.entryCid).toBe(entryCid({
        recordType: record.recordType,
        sourceDataset: record.sourceDataset,
        instrumentId: record.instrumentId,
        articleNumber: record.articleNumber,
        articleTitle: record.articleTitle,
        bodySha256: record.bodySha256,
        language: record.language,
        jurisdiction: record.jurisdiction,
        sourceUrl: record.sourceUrl,
      }));
      expect(record.entryCid).not.toBe(entryCid({
        recordType: record.recordType,
        sourceDataset: record.sourceDataset,
        instrumentId: record.instrumentId,
        articleNumber: record.articleNumber,
        articleTitle: record.title,
        bodySha256: record.bodySha256,
        language: record.language,
        jurisdiction: record.jurisdiction,
        sourceUrl: record.sourceUrl,
      }));
    }
    const loi = result.records.find((record) => record.sourceId === 'fr-a2');
    expect(loi?.title).toBe('Article 4 de la loi du 1er mars 2024');
    expect(loi?.inheritedTitle).toBe(false);
    const twoCodes = result.records.find((record) => record.sourceId === 'fr-a6');
    expect(twoCodes?.title).toBe('Article 2');
    expect(twoCodes?.inheritedTitle).toBe(false);
    const inputArticle = (item.input.articles ?? []).find((row) => row.id === 'fr-a1');
    const article = result.records.find((record) => record.sourceId === 'fr-a1');
    expect(article?.body).toBe(inputArticle?.text);
    expect(article?.articleTitle).toBe('Article 1');
    expect(article?.inheritedHeadings).toEqual(expect.arrayContaining(['title', 'chapter']));
  });

  test('duplicate CIDs keep the first status and license, and later mirrors stay distinct', () => {
    const result = runCase('duplicated-mirrors');
    const primary = result.records.find((record) => record.sourceId === 'mt-act-1' && record.sourceRevision === 'a'.repeat(40));
    expect(primary?.lawStatus).toBe('current');
    expect(primary?.license).toBe('CC0-1.0');
    const revoked = result.mirrors.find((link) => link.relation === 'duplicate-cid' && link.otherStatus === 'repealed');
    expect(revoked).toMatchObject({
      keptStatus: 'current',
      keptLicense: 'CC0-1.0',
      otherLicense: 'CC-BY-4.0',
      otherStatus: 'repealed',
      provenancePreserved: true,
    } satisfies Partial<MirrorLink>);
    expect(revoked?.keptEntryCid).toBe(revoked?.otherEntryCid);
    expect(result.records.some((record) => record.sourceRevision === 'b'.repeat(40))).toBe(false);
    expect(result.records.filter((record) => record.entryCid === revoked?.keptEntryCid && record.recordType === 'law')).toHaveLength(1);
    const relations = new Set(result.mirrors.map((link) => link.relation));
    expect(relations.has('duplicate-cid')).toBe(true);
    expect(relations.has('equivalent-text')).toBe(true);
    expect(relations.has('conflicting-version')).toBe(true);
    const amended = result.records.find((record) => record.body.includes('amended') && record.recordType === 'law');
    expect(amended?.lawStatus).toBe('current');
    expect(amended?.bodySha256).not.toBe(primary?.bodySha256);
    const conflict = result.mirrors.find((link) => link.relation === 'conflicting-version' && link.otherSourceId === 'mt-act-1');
    expect(conflict?.keptStatus).toBe('current');
    expect(conflict?.otherStatus).toBe('current');
    expect(conflict?.keptSourceRevision).not.toBe(conflict?.otherSourceRevision);
    expect(conflict?.bodySha256).not.toBe(conflict?.otherBodySha256);
    const sameSnapshot = result.mirrors.filter((link) => (
      link.relation === 'duplicate-cid'
      && link.keptSourceRevision === link.otherSourceRevision
      && link.keptSourceId === 'mt-art-1'
    ));
    expect(sameSnapshot.length).toBeGreaterThan(0);
    expect(result.records.filter((record) => record.sourceId === 'mt-art-1' && record.sourceRevision === 'a'.repeat(40))).toHaveLength(1);
  });

  test('regional and municipal rows keep their own jurisdiction and admin level', () => {
    const regional = runCase('regional-ontario').records.find((record) => record.sourceId === 'ca-on-1');
    const municipal = runCase('municipal-amsterdam').records.find((record) => record.sourceId === 'nl-ams-1');
    expect(regional).toMatchObject({
      jurisdiction: 'Ontario',
      adminLevel: 'adm1',
      language: 'en',
      coverage: 'law-level (articles empty or unavailable in source snapshot)',
    } satisfies Partial<NormalizedRecord>);
    expect(municipal).toMatchObject({
      jurisdiction: 'Amsterdam',
      adminLevel: 'municipality',
      language: 'nl',
      lawStatus: 'current',
      coverage: 'law-level (articles empty or unavailable in source snapshot)',
    } satisfies Partial<NormalizedRecord>);
    expect(regional?.jurisdiction).not.toBe('CA');
    expect(municipal?.jurisdiction).not.toBe('NL');
    expect(regional?.lawCid).toBe(lawCid({
      sourceDataset: regional?.sourceDataset ?? '',
      instrumentId: 'ca-on-1',
      instrumentTitle: regional?.instrumentTitle ?? '',
      jurisdiction: 'Ontario',
      language: 'en',
    }));
  });
});

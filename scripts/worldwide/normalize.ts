#!/usr/bin/env node
/**
 * Normalize country-law rows into CID-keyed records.
 *
 * Required ids are not invented. Null text is dropped. A status or date that
 * disagrees with metadata quarantines the row and chooses neither value.
 * Article inheritance copies one same-law code name onto a blank or caption
 * title and fills empty hierarchy fields. It does not rewrite statute text,
 * body hashes, or entry CIDs. Duplicate entry CIDs keep the first row.
 * Later snapshots with the same bytes stay equivalent-text mirrors; a changed
 * body of the same source id stays a conflicting-version mirror. Both
 * revisions, licenses, and statuses remain on the link.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { SchemaError } from '../../src/lib/worldwide/data/schema';
import {
  entryCid,
  gainedHeadings,
  inheritancePlan,
  lawCid,
  normalizeLegalText,
  refineAtom,
  sha256HexUtf8,
  type HeadingKey,
  type InheritanceRow,
} from '../../src/lib/worldwide/data/identity';

export { SchemaError } from '../../src/lib/worldwide/data/schema';

const REQUIRED_LAW_COLUMNS = ['id', 'title', 'text'] as const;
const REQUIRED_ARTICLE_COLUMNS = ['id', 'law_id', 'title', 'text'] as const;
const STATUSES = new Set(['current', 'historical', 'repealed', 'superseded', 'unknown']);
const FLOATING_REVISIONS = new Set([
  'head', 'main', 'master', 'latest', 'trunk', 'current', 'floating', 'unpinned', 'none', 'null', 'undefined', 'tip', 'dev', 'develop',
]);

export interface SourceRow {
  [key: string]: unknown;
}

export interface NormalizeBatchInput {
  sourceDataset: string;
  sourceRevision: string;
  publisherId: string;
  laws: readonly SourceRow[];
  articles?: readonly SourceRow[];
}

export interface NormalizeInput extends NormalizeBatchInput {
  mirrors?: readonly NormalizeBatchInput[];
}

export interface NormalizedRecord {
  recordType: 'law' | 'article';
  sourceDataset: string;
  sourceRevision: string;
  publisherId: string;
  sourceId: string;
  instrumentId: string;
  instrumentTitle: string;
  lawCid: string;
  articleNumber: string;
  articleTitle: string;
  title: string;
  body: string;
  bodySha256: string;
  entryCid: string;
  jurisdiction: string;
  language: string;
  sourceUrl: string;
  snapshotDate: string;
  publication: string | null;
  enactment: string | null;
  license: string;
  lawStatus: string | null;
  statusKnowledge: 'known' | 'unknown';
  coverage: string;
  adminLevel: string | null;
  inheritedTitle: boolean;
  inheritedHeadings: HeadingKey[];
  provenance: Record<string, unknown> | string | null;
}

export interface QuarantineRow {
  reason:
    | 'missing-section-id'
    | 'missing-instrument-id'
    | 'conflicting-status'
    | 'conflicting-date'
    | 'invalid-status'
    | 'unreadable-provenance'
    | 'invalid-row'
    | 'duplicate-section-identity';
  detail: string;
  table: 'laws' | 'articles';
  rowIndex: number;
  sourceDataset: string;
  sourceRevision: string;
  sourceId: string | null;
  field: string | null;
  officialCitation: null;
}

export interface MirrorLink {
  relation: 'duplicate-cid' | 'equivalent-text' | 'conflicting-version';
  instrumentId: string;
  keptEntryCid: string;
  otherEntryCid: string;
  keptSourceId: string;
  otherSourceId: string;
  keptSourceDataset: string;
  otherSourceDataset: string;
  keptSourceRevision: string;
  otherSourceRevision: string;
  keptPublisherId: string;
  otherPublisherId: string;
  keptLicense: string;
  otherLicense: string;
  keptSourceUrl: string;
  otherSourceUrl: string;
  bodySha256: string;
  otherBodySha256: string;
  keptStatus: string | null;
  otherStatus: string | null;
  provenancePreserved: true;
}

export interface NormalizeResult {
  records: NormalizedRecord[];
  quarantined: QuarantineRow[];
  drops: { emptyBody: string[]; missingInstrument: string[] };
  mirrors: MirrorLink[];
}

interface BatchResult {
  records: NormalizedRecord[];
  quarantined: QuarantineRow[];
  drops: { emptyBody: string[]; missingInstrument: string[] };
}

function present(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'number' && !Number.isFinite(value)) return false;
  if (typeof value === 'string' && value.trim() === '') return false;
  return true;
}

function show(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return JSON.stringify(value);
}

function asRow(value: unknown): SourceRow | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as SourceRow;
}

function columnsOf(rows: readonly unknown[]): Set<string> {
  const columns = new Set<string>();
  for (const row of rows) {
    const record = asRow(row);
    if (record) Object.keys(record).forEach((key) => columns.add(key));
  }
  return columns;
}

function assertColumns(rows: readonly unknown[], table: 'laws' | 'articles', required: readonly string[]): void {
  if (!rows.length) return;
  const presentColumns = columnsOf(rows);
  const missing = required.filter((column) => !presentColumns.has(column));
  if (!missing.length) return;
  const listed = [...presentColumns].sort().join(', ') || '(none)';
  throw new SchemaError(
    `${table} table is missing required identifier/content columns ${missing.join(', ')}; present=${listed}. Fail closed — will not invent ids.`,
  );
}

function assertPinned(batch: NormalizeBatchInput): void {
  const dataset = typeof batch.sourceDataset === 'string' ? batch.sourceDataset.trim() : '';
  if (!dataset) throw new SchemaError('Source dataset id is absent. No source identity was invented.');
  const publisher = typeof batch.publisherId === 'string' ? batch.publisherId.trim() : '';
  if (!publisher) throw new SchemaError('Publisher id is absent. No publisher identity was invented.');
  if (typeof batch.sourceRevision !== 'string' || !batch.sourceRevision.trim()) {
    throw new SchemaError('Source revision is absent. An unpinned row cannot enter the catalog.');
  }
  const revision = batch.sourceRevision.trim();
  if (FLOATING_REVISIONS.has(revision.toLowerCase())) {
    throw new SchemaError(`Source revision ${revision} is a floating label rather than a pinned revision.`);
  }
}

function parseMetadata(raw: unknown): { ok: true; value: Record<string, unknown> } | { ok: false } {
  if (raw === undefined || raw === null || raw === '') return { ok: true, value: {} };
  if (typeof raw === 'object' && !Array.isArray(raw)) return { ok: true, value: raw as Record<string, unknown> };
  if (typeof raw !== 'string') return { ok: false };
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false };
    return { ok: true, value: parsed as Record<string, unknown> };
  } catch {
    return { ok: false };
  }
}

function statusToken(value: unknown): string | null {
  if (!present(value)) return null;
  const token = normalizeLegalText(value).toLowerCase();
  return token || null;
}

function snapshotDate(row: SourceRow, meta: Record<string, unknown>): string {
  for (const column of ['retrieved_at', 'date_issued', 'date']) {
    const value = normalizeLegalText(row[column]);
    if (!value) continue;
    return value.length >= 10 && value[4] === '-' ? value.slice(0, 10) : value;
  }
  const nested = meta.metadata && typeof meta.metadata === 'object' && !Array.isArray(meta.metadata)
    ? meta.metadata as Record<string, unknown>
    : {};
  for (const source of [meta, nested]) {
    for (const key of ['snapshot_date', 'retrieved_at']) {
      if (!source[key]) continue;
      const value = normalizeLegalText(source[key]);
      if (value) return value.slice(0, 10);
    }
  }
  return '';
}

function coverageFor(lawCount: number, articleCount: number): string {
  const articlesEmpty = articleCount === 0;
  const sparse = !articlesEmpty && lawCount > 0 && articleCount / lawCount < 0.1;
  if (sparse) return 'law-level (article coverage below 10% of laws; sparse articles table)';
  if (articlesEmpty) return 'law-level (articles empty or unavailable in source snapshot)';
  return 'article-level';
}

function planRows(laws: readonly SourceRow[], articles: readonly SourceRow[]): InheritanceRow[] {
  const rows: InheritanceRow[] = [];
  for (const row of laws) {
    const record = asRow(row);
    if (!record || typeof record.id !== 'string' || !record.id.trim()) continue;
    rows.push({ law_id: record.id, text: record.text, body: record.body });
  }
  for (const row of articles) {
    const record = asRow(row);
    if (!record) continue;
    rows.push({ law_id: record.law_id, text: record.text, body: record.body });
  }
  return rows;
}

function quarantine(
  batch: NormalizeBatchInput,
  table: 'laws' | 'articles',
  rowIndex: number,
  sourceId: string | null,
  reason: QuarantineRow['reason'],
  field: string | null,
  detail: string,
): QuarantineRow {
  return {
    reason,
    detail,
    table,
    rowIndex,
    sourceDataset: batch.sourceDataset.trim(),
    sourceRevision: batch.sourceRevision.trim(),
    sourceId,
    field,
    officialCitation: null,
  };
}

function buildRecord(input: {
  batch: NormalizeBatchInput;
  recordType: 'law' | 'article';
  sourceId: string;
  instrumentId: string;
  instrumentTitle: string;
  articleNumber: string;
  articleTitle: string;
  body: string;
  jurisdiction: string;
  language: string;
  sourceUrl: string;
  snapshotDate: string;
  publication: string | null;
  enactment: string | null;
  license: string;
  lawStatus: string | null;
  coverage: string;
  adminLevel: string | null;
  provenance: unknown;
}): NormalizedRecord {
  const bodySha256 = sha256HexUtf8(input.body);
  const jurisdiction = input.jurisdiction;
  const language = input.language;
  const articleTitle = input.articleTitle;
  const title = input.recordType === 'article' && articleTitle ? articleTitle : input.instrumentTitle;
  const base: NormalizedRecord = {
    recordType: input.recordType,
    sourceDataset: input.batch.sourceDataset.trim(),
    sourceRevision: input.batch.sourceRevision.trim(),
    publisherId: input.batch.publisherId.trim(),
    sourceId: input.sourceId,
    instrumentId: input.instrumentId,
    instrumentTitle: input.instrumentTitle,
    lawCid: lawCid({
      sourceDataset: input.batch.sourceDataset.trim(),
      instrumentId: input.instrumentId,
      instrumentTitle: input.instrumentTitle,
      jurisdiction,
      language,
    }),
    articleNumber: input.articleNumber,
    articleTitle,
    title,
    body: input.body,
    bodySha256,
    entryCid: '',
    jurisdiction,
    language,
    sourceUrl: input.sourceUrl,
    snapshotDate: input.snapshotDate,
    publication: input.publication,
    enactment: input.enactment,
    license: input.license,
    lawStatus: input.lawStatus,
    statusKnowledge: input.lawStatus && input.lawStatus !== 'unknown' ? 'known' : 'unknown',
    coverage: input.coverage,
    adminLevel: input.adminLevel,
    inheritedTitle: false,
    inheritedHeadings: [],
    provenance: input.provenance === undefined ? null : input.provenance as NormalizedRecord['provenance'],
  };
  base.entryCid = entryCid({
    recordType: base.recordType,
    sourceDataset: base.sourceDataset,
    instrumentId: base.instrumentId,
    articleNumber: base.articleNumber,
    articleTitle: base.articleTitle,
    bodySha256: base.bodySha256,
    language: base.language,
    jurisdiction: base.jurisdiction,
    sourceUrl: base.sourceUrl,
  });
  return base;
}

function inherit(record: NormalizedRecord, plan: ReturnType<typeof inheritancePlan>): NormalizedRecord {
  const planned = plan[record.instrumentId];
  const lawCode = planned?.code ?? null;
  const headings = lawCode ? planned.headings : {};
  const beforeTitle = record.title;
  const beforeProvenance = record.provenance;
  const refined = refineAtom(
    { ...record, text: record.body, title: record.title, provenance: record.provenance },
    lawCode,
    headings,
  );
  if (refined.text !== record.body) throw new Error('text');
  const title = typeof refined.title === 'string' ? refined.title : record.title;
  const provenance = (refined.provenance ?? null) as NormalizedRecord['provenance'];
  return {
    ...record,
    title,
    provenance,
    inheritedTitle: title !== beforeTitle,
    inheritedHeadings: gainedHeadings(beforeProvenance, provenance),
    entryCid: record.entryCid,
    bodySha256: record.bodySha256,
    body: record.body,
  };
}

interface ResolvedFacts {
  ok: true;
  publication: string | null;
  enactment: string | null;
  lawStatus: string | null;
  meta: Record<string, unknown>;
}

function resolveFacts(
  batch: NormalizeBatchInput,
  row: SourceRow,
  table: 'laws' | 'articles',
  rowIndex: number,
  sourceId: string,
): { ok: true; facts: ResolvedFacts } | { ok: false; quarantined: QuarantineRow[] } {
  const metadata = parseMetadata(row.metadata_json);
  if (!metadata.ok) {
    return {
      ok: false,
      quarantined: [quarantine(batch, table, rowIndex, sourceId, 'unreadable-provenance', 'metadata_json', 'metadata_json is not a JSON object.')],
    };
  }
  const meta = metadata.value;
  const problems: QuarantineRow[] = [];
  const columnStatus = row.law_status;
  const metaStatus = present(meta.law_status) ? meta.law_status : meta.status;
  if (present(columnStatus) && present(metaStatus) && show(columnStatus).toLowerCase() !== show(metaStatus).toLowerCase()) {
    problems.push(quarantine(
      batch,
      table,
      rowIndex,
      sourceId,
      'conflicting-status',
      'law_status',
      `Status ${show(columnStatus)} conflicts with ${show(metaStatus)}. Neither value was chosen.`,
    ));
  }
  const datePairs: Array<{ field: 'publication' | 'enactment'; column: unknown; meta: unknown; label: string }> = [
    { field: 'publication', column: row.date, meta: meta.publication_date, label: 'Publication' },
    { field: 'enactment', column: row.date_issued, meta: meta.enactment_date, label: 'Enactment' },
  ];
  const chosen: { publication: string | null; enactment: string | null } = { publication: null, enactment: null };
  for (const pair of datePairs) {
    if (present(pair.column) && present(pair.meta) && show(pair.column) !== show(pair.meta)) {
      problems.push(quarantine(
        batch,
        table,
        rowIndex,
        sourceId,
        'conflicting-date',
        pair.field,
        `${pair.label} ${show(pair.column)} conflicts with ${show(pair.meta)}. Neither value was chosen.`,
      ));
      continue;
    }
    const winner = present(pair.column) ? pair.column : present(pair.meta) ? pair.meta : null;
    chosen[pair.field] = winner === null ? null : normalizeLegalText(winner) || null;
  }
  if (problems.length) return { ok: false, quarantined: problems };
  const rawStatus = present(columnStatus) ? columnStatus : present(metaStatus) ? metaStatus : null;
  const token = statusToken(rawStatus);
  if (token && !STATUSES.has(token)) {
    return {
      ok: false,
      quarantined: [quarantine(
        batch,
        table,
        rowIndex,
        sourceId,
        'invalid-status',
        'law_status',
        `Status ${JSON.stringify(rawStatus)} is not current, historical, repealed, superseded, or unknown.`,
      )],
    };
  }
  return {
    ok: true,
    facts: {
      ok: true,
      publication: chosen.publication,
      enactment: chosen.enactment,
      lawStatus: token,
      meta,
    },
  };
}

function normalizeBatch(batch: NormalizeBatchInput): BatchResult {
  assertPinned(batch);
  const laws = batch.laws ?? [];
  const articles = batch.articles ?? [];
  if (!Array.isArray(laws) || !Array.isArray(articles)) {
    throw new SchemaError('laws and articles must be arrays. No rows were invented.');
  }
  assertColumns(laws, 'laws', REQUIRED_LAW_COLUMNS);
  assertColumns(articles, 'articles', REQUIRED_ARTICLE_COLUMNS);
  const quarantined: QuarantineRow[] = [];
  const drops = { emptyBody: [] as string[], missingInstrument: [] as string[] };
  const coverage = coverageFor(laws.length, articles.length);
  const parents = new Map<string, { title: string; jurisdiction: string; language: string; sourceUrl: string; license: string; adminLevel: string | null; row: SourceRow; facts: ResolvedFacts }>();
  const records: NormalizedRecord[] = [];

  laws.forEach((value, rowIndex) => {
    const row = asRow(value);
    if (!row) {
      quarantined.push(quarantine(batch, 'laws', rowIndex, null, 'invalid-row', null, 'The source row is not an object.'));
      return;
    }
    const sourceId = normalizeLegalText(row.id);
    if (!sourceId) {
      quarantined.push(quarantine(batch, 'laws', rowIndex, null, 'missing-section-id', 'id', 'Section id is absent. No official identifier was invented.'));
      return;
    }
    const resolved = resolveFacts(batch, row, 'laws', rowIndex, sourceId);
    if (!resolved.ok) {
      quarantined.push(...resolved.quarantined);
      return;
    }
    const body = normalizeLegalText(row.text);
    const jurisdiction = normalizeLegalText(row.jurisdiction) || normalizeLegalText(row.country);
    const language = normalizeLegalText(row.language);
    const adminLevel = normalizeLegalText(row.admin_level) || null;
    parents.set(sourceId, {
      title: normalizeLegalText(row.title),
      jurisdiction,
      language,
      sourceUrl: normalizeLegalText(row.source_url),
      license: normalizeLegalText(row.license),
      adminLevel,
      row,
      facts: resolved.facts,
    });
    if (!body) {
      drops.emptyBody.push(sourceId);
      return;
    }
    records.push(buildRecord({
      batch,
      recordType: 'law',
      sourceId,
      instrumentId: sourceId,
      instrumentTitle: normalizeLegalText(row.title),
      articleNumber: '',
      articleTitle: '',
      body,
      jurisdiction,
      language,
      sourceUrl: normalizeLegalText(row.source_url),
      snapshotDate: snapshotDate(row, resolved.facts.meta),
      publication: resolved.facts.publication,
      enactment: resolved.facts.enactment,
      license: normalizeLegalText(row.license),
      lawStatus: resolved.facts.lawStatus,
      coverage,
      adminLevel,
      provenance: row.provenance ?? null,
    }));
  });

  articles.forEach((value, rowIndex) => {
    const row = asRow(value);
    if (!row) {
      quarantined.push(quarantine(batch, 'articles', rowIndex, null, 'invalid-row', null, 'The source row is not an object.'));
      return;
    }
    const sourceId = normalizeLegalText(row.id);
    if (!sourceId) {
      quarantined.push(quarantine(batch, 'articles', rowIndex, null, 'missing-section-id', 'id', 'Section id is absent. No official identifier was invented.'));
      return;
    }
    const instrumentId = normalizeLegalText(row.law_id);
    if (!instrumentId) {
      quarantined.push(quarantine(batch, 'articles', rowIndex, sourceId, 'missing-instrument-id', 'law_id', 'Instrument id is absent. No official identifier was invented.'));
      return;
    }
    const resolved = resolveFacts(batch, row, 'articles', rowIndex, sourceId);
    if (!resolved.ok) {
      quarantined.push(...resolved.quarantined);
      return;
    }
    const parent = parents.get(instrumentId);
    if (!parent) {
      drops.missingInstrument.push(sourceId);
      return;
    }
    const body = normalizeLegalText(row.text);
    if (!body) {
      drops.emptyBody.push(sourceId);
      return;
    }
    const articleFacts = resolved.facts;
    const lawStatus = articleFacts.lawStatus ?? parent.facts.lawStatus;
    records.push(buildRecord({
      batch,
      recordType: 'article',
      sourceId,
      instrumentId,
      instrumentTitle: parent.title,
      articleNumber: normalizeLegalText(row.article_number),
      articleTitle: normalizeLegalText(row.title),
      body,
      jurisdiction: parent.jurisdiction,
      language: parent.language || normalizeLegalText(row.language),
      sourceUrl: normalizeLegalText(row.source_url) || parent.sourceUrl,
      snapshotDate: snapshotDate(parent.row, parent.facts.meta),
      publication: articleFacts.publication ?? parent.facts.publication,
      enactment: articleFacts.enactment ?? parent.facts.enactment,
      license: parent.license,
      lawStatus,
      coverage,
      adminLevel: parent.adminLevel,
      provenance: row.provenance ?? null,
    }));
  });

  const plan = inheritancePlan(planRows(laws, articles));
  return {
    records: records.map((record) => inherit(record, plan)),
    quarantined,
    drops,
  };
}

function mirrorFrom(relation: MirrorLink['relation'], kept: NormalizedRecord, other: NormalizedRecord): MirrorLink {
  return {
    relation,
    instrumentId: kept.instrumentId,
    keptEntryCid: kept.entryCid,
    otherEntryCid: other.entryCid,
    keptSourceId: kept.sourceId,
    otherSourceId: other.sourceId,
    keptSourceDataset: kept.sourceDataset,
    otherSourceDataset: other.sourceDataset,
    keptSourceRevision: kept.sourceRevision,
    otherSourceRevision: other.sourceRevision,
    keptPublisherId: kept.publisherId,
    otherPublisherId: other.publisherId,
    keptLicense: kept.license,
    otherLicense: other.license,
    keptSourceUrl: kept.sourceUrl,
    otherSourceUrl: other.sourceUrl,
    bodySha256: kept.bodySha256,
    otherBodySha256: other.bodySha256,
    keptStatus: kept.lawStatus,
    otherStatus: other.lawStatus,
    provenancePreserved: true,
  };
}

function linkRelation(earlier: NormalizedRecord, later: NormalizedRecord): MirrorLink['relation'] | null {
  if (earlier.sourceDataset === later.sourceDataset && earlier.sourceRevision === later.sourceRevision) return null;
  if (earlier.instrumentId !== later.instrumentId) return null;
  if (earlier.entryCid === later.entryCid) return null;
  if (earlier.bodySha256 === later.bodySha256) return 'equivalent-text';
  if (earlier.sourceId === later.sourceId) return 'conflicting-version';
  return null;
}

export function normalizeCorpus(input: NormalizeInput): NormalizeResult {
  const batches = [input, ...(input.mirrors ?? [])];
  for (const batch of batches) {
    assertPinned(batch);
    if (!Array.isArray(batch.laws) || !Array.isArray(batch.articles ?? [])) {
      throw new SchemaError('laws and articles must be arrays. No rows were invented.');
    }
    assertColumns(batch.laws, 'laws', REQUIRED_LAW_COLUMNS);
    assertColumns(batch.articles ?? [], 'articles', REQUIRED_ARTICLE_COLUMNS);
  }
  const parts = batches.map((batch) => normalizeBatch(batch));
  const quarantined = parts.flatMap((part) => part.quarantined);
  const drops = {
    emptyBody: parts.flatMap((part) => part.drops.emptyBody),
    missingInstrument: parts.flatMap((part) => part.drops.missingInstrument),
  };
  const incoming = parts.flatMap((part) => part.records);
  const mirrors: MirrorLink[] = [];
  const kept: NormalizedRecord[] = [];
  const seenCid = new Map<string, NormalizedRecord>();
  const seenSource = new Map<string, NormalizedRecord>();
  for (const record of incoming) {
    const sourceKey = `${record.sourceDataset}\u0000${record.sourceRevision}\u0000${record.sourceId}`;
    const priorSource = seenSource.get(sourceKey);
    if (priorSource && priorSource.entryCid !== record.entryCid) {
      quarantined.push({
        reason: 'duplicate-section-identity',
        detail: `Source id ${record.sourceId} already identifies a different text version in this revision.`,
        table: record.recordType === 'law' ? 'laws' : 'articles',
        rowIndex: -1,
        sourceDataset: record.sourceDataset,
        sourceRevision: record.sourceRevision,
        sourceId: record.sourceId,
        field: 'id',
        officialCitation: null,
      });
      continue;
    }
    const priorCid = seenCid.get(record.entryCid);
    if (priorCid) {
      mirrors.push(mirrorFrom('duplicate-cid', priorCid, record));
      continue;
    }
    seenCid.set(record.entryCid, record);
    seenSource.set(sourceKey, record);
    kept.push(record);
  }
  for (let laterIndex = 0; laterIndex < kept.length; laterIndex += 1) {
    for (let earlierIndex = 0; earlierIndex < laterIndex; earlierIndex += 1) {
      const relation = linkRelation(kept[earlierIndex], kept[laterIndex]);
      if (relation) mirrors.push(mirrorFrom(relation, kept[earlierIndex], kept[laterIndex]));
    }
  }
  return { records: kept, quarantined, drops, mirrors };
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

function main(): void {
  const source = process.argv[2];
  if (!source) throw new SchemaError('Usage: normalize.ts <input.json> [output.json]');
  const input = JSON.parse(readFileSync(source, 'utf8')) as NormalizeInput;
  const result = normalizeCorpus(input);
  const encoded = `${JSON.stringify(result, null, 2)}\n`;
  const destination = process.argv[3];
  if (destination) writeFileSync(destination, encoded);
  else process.stdout.write(encoded);
}

if (isDirectRun()) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'normalize failed'}\n`);
    process.exit(1);
  }
}

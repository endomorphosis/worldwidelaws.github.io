#!/usr/bin/env node
/**
 * Classify pinned Hugging Face datasets into corpus and index families.
 *
 * The repository id is an identity key. It is removed from card text before
 * scope matching, so a slug such as "municipal" or "laws_ir" is not coverage
 * and is not a usable index. Scope comes from card prose, YAML tags, published
 * config names, and sibling paths. The shared laws/articles schema is used by
 * national, regional, and municipal hubs; the level has to be stated elsewhere.
 * A regional corpus may sit inside a national hub. Code-only releases are
 * excluded instead of being admitted as law text.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const DISPOSITION_SCHEMA = 'worldwide-legal-search.source-dispositions@1';
export const SOURCE_FAMILIES = Object.freeze([
  'national',
  'regional',
  'municipal',
  'country-ir',
  'unified-netherlands',
  'legacy-index',
] as const);
export const INCLUDE = 'include';
export const EXCLUDE = 'exclude';
export const BLOCKED = 'blocked';

export type SourceFamily = (typeof SOURCE_FAMILIES)[number];
export type Decision = 'include' | 'exclude' | 'blocked';

export type Disposition = {
  dataset_id: string;
  family: SourceFamily;
  decision: Decision;
  reason: string;
  schema_capabilities: string[];
  source_lineage: string;
  code_only_release: boolean;
  resolved_revision: string | null;
};

export type Unassigned = {
  dataset_id: string;
  decision: Decision;
  reason: string;
  schema_capabilities: string[];
  source_lineage: string;
  code_only_release: boolean;
  resolved_revision: string | null;
};

export type DispositionDocument = {
  schema: typeof DISPOSITION_SCHEMA;
  inventory_revision: string;
  inventory_dataset_count: number;
  basis: string;
  summary: {
    dispositions: number;
    unassigned: number;
    by_family: Record<SourceFamily, Record<Decision, number>>;
  };
  dispositions: Disposition[];
  unassigned: Unassigned[];
};

type DatasetRecord = Record<string, unknown>;
type ScopeHit = { family: 'national' | 'regional' | 'municipal'; quote: string };

const ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const IR_CONFIGS = [
  'corpus',
  'bm25_documents',
  'bm25_postings',
  'bm25_keyword_index',
  'graph_nodes',
  'graph_edges',
  'graph_incoming_adjacency',
  'graph_outgoing_adjacency',
  'vectors',
  'vector_meta_index',
];
const UNIFIED_CONFIGS = [
  'laws',
  'articles',
  'cid_index',
  'vector_index',
  'bm25_documents',
  'knowledge_graph_nodes',
  'knowledge_graph_edges',
  'logic_relationships',
];
const LEVEL_PATTERNS: Record<'national' | 'regional' | 'municipal', RegExp[]> = {
  national: [
    /(?<!sub-)\bnational\b(?![- ]ids?\b)/i,
    /\bsupranational\b/i,
    /\bfederal laws?\b/i,
    /\bfederal register\b/i,
    /\bcentral-government\b/i,
    /\bofficial Dutch government\b/i,
    /\bBWBR\b/,
    /\bacts of parliament\b/i,
  ],
  regional: [
    /\bprovinces?\b/i,
    /\bprovincial\b/i,
    /\bprovincie\b/i,
    /\bregional\b/i,
    /\bgovernorates?\b/i,
    /\bsub-?national\b/i,
    /\bstate acts\b/i,
    /\bstate statutes\b/i,
    /\bstate laws\b/i,
    /\bunion-territor(?:y|ies)\b/i,
    /\bwaterschaps?\b/i,
    /\brégions?\b/i,
  ],
  municipal: [
    /\bmunicipal\w*/i,
    /\bgemeenten?\b/i,
    /\bcomuni\b/i,
    /\bcommunes?\b/i,
    /\bcommunal\b/i,
    /\blocal[- ]authorit/i,
    /\blocal government\b/i,
    /\bwater[- ]boards?\b/i,
    /\bcount(?:y|ies)\b(?!\s+courts?\b)/i,
    /\bconseil municipal\b/i,
  ],
};

function sha256Text(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function textField(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function datasetRows(inventory: Record<string, unknown>): DatasetRecord[] {
  const organizations = Array.isArray(inventory.organizations) ? inventory.organizations : [];
  const rows: DatasetRecord[] = [];
  for (const organization of organizations) {
    const record = asRecord(organization);
    const datasets = record && Array.isArray(record.datasets) ? record.datasets : [];
    for (const dataset of datasets) {
      const row = asRecord(dataset);
      if (row && textField(row.dataset_id)) rows.push(row);
    }
  }
  return rows;
}

function configNames(record: DatasetRecord): Set<string> {
  const configs = Array.isArray(record.configs) ? record.configs : [];
  const names = new Set<string>();
  for (const config of configs) {
    const row = asRecord(config);
    const name = row ? textField(row.name) : '';
    if (name) names.add(name);
  }
  return names;
}

function listedPaths(record: DatasetRecord): string[] {
  const files = Array.isArray(record.files) ? record.files : [];
  const paths: string[] = [];
  for (const file of files) {
    const row = asRecord(file);
    const filePath = row ? textField(row.path) : '';
    if (filePath) paths.push(filePath);
  }
  return paths;
}

function extensionCounts(record: DatasetRecord): Record<string, number> {
  const fileRecord = asRecord(record.file_record);
  const extensions = fileRecord ? asRecord(fileRecord.extensions) : null;
  const counts: Record<string, number> = {};
  if (extensions) {
    for (const [key, value] of Object.entries(extensions)) {
      if (typeof value === 'number' && Number.isInteger(value) && value > 0) counts[key] = value;
    }
  }
  if (Object.keys(counts).length > 0) return counts;
  for (const filePath of listedPaths(record)) {
    const dot = filePath.lastIndexOf('.');
    const extension = dot >= 0 ? filePath.slice(dot + 1).toLowerCase() : '';
    if (!extension) continue;
    counts[extension] = (counts[extension] || 0) + 1;
  }
  return counts;
}

function payloadCount(record: DatasetRecord): number {
  const counts = extensionCounts(record);
  let total = ['parquet', 'jsonl', 'jsonld', 'faiss', 'duckdb'].reduce((sum, key) => sum + (counts[key] || 0), 0);
  for (const filePath of listedPaths(record)) {
    if (/\.(parquet|jsonl|jsonld|faiss|duckdb)(\.gz)?$/i.test(filePath)) total += 1;
  }
  return total;
}

function codeCount(record: DatasetRecord): number {
  const counts = extensionCounts(record);
  return (counts.py || 0) + (counts.sh || 0) + (counts.toml || 0);
}

function revisionOf(record: DatasetRecord): string | null {
  const revision = textField(record.resolved_revision);
  return /^[0-9a-f]{7,64}$/.test(revision) ? revision : null;
}

function cardHash(record: DatasetRecord): string {
  const card = asRecord(record.card);
  const hash = card ? textField(card.sha256) : '';
  return /^[0-9a-f]{64}$/.test(hash) ? hash : '';
}

function accessMessage(record: DatasetRecord): string {
  const error = asRecord(record.access_error);
  if (!error) return '';
  const kind = textField(error.class) || 'access';
  const message = textField(error.message) || 'metadata access failed';
  return kind + ': ' + message;
}

function zeroRows(record: DatasetRecord): boolean {
  const sizes = asRecord(record.sizes);
  if (!sizes) return false;
  return sizes.num_rows === 0;
}

function slugOf(datasetId: string): string {
  const slash = datasetId.indexOf('/');
  return slash >= 0 ? datasetId.slice(slash + 1) : datasetId;
}

export function stripRepositoryIdentity(datasetId: string, card: string): string {
  const slug = slugOf(datasetId);
  return card.split(datasetId).join(' ').split(slug).join(' ');
}

function frontMatter(card: string): { tags: string[]; body: string } {
  if (!card.startsWith('---')) return { tags: [], body: card };
  const end = card.indexOf('\n---', 3);
  if (end < 0) return { tags: [], body: card };
  const yaml = card.slice(0, end);
  const body = card.slice(end + 4);
  const tags: string[] = [];
  const tagBlock = /\ntags:\s*\n((?:\s*-\s*.+\n)*)/.exec('\n' + yaml + '\n');
  if (tagBlock) {
    for (const line of tagBlock[1].split('\n')) {
      const tag = line.replace(/^\s*-\s*/, '').replace(/^['"]|['"]$/g, '').trim();
      if (tag) tags.push(tag);
    }
  }
  return { tags, body };
}

function withoutCodeSpans(value: string): string {
  return value.replace(/`[^`]*`/g, ' ');
}

function sentencesOf(value: string): string[] {
  const blocks: string[] = [];
  let current = '';
  const flush = () => {
    if (current.trim()) blocks.push(current.trim());
    current = '';
  };
  for (const raw of value.split('\n')) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    if (/^\s{2,}\S/.test(raw) && !/^\s*[-*#|]/.test(raw) && !current && blocks.length > 0) {
      blocks[blocks.length - 1] += ' ' + line;
      continue;
    }
    if (/^(#|\||[-*]\s)/.test(line)) {
      flush();
      blocks.push(line);
      continue;
    }
    current = current ? current + ' ' + line : line;
    if (/[.!?]$/.test(line)) flush();
  }
  flush();
  return blocks
    .flatMap((block) => {
      const masked = block.replace(/\b(?:i\.e|e\.g|etc)\./gi, (match) => match.replaceAll('.', '\u0000'));
      return masked.split(/(?<=\.)\s+/).map((part) => part.replaceAll('\u0000', '.'));
    })
    .map((sentence) => sentence.replace(/\s+/g, ' ').trim())
    .filter((sentence) => sentence.length >= 8);
}

function jurisdictionValue(card: string): string {
  for (const line of card.split('\n')) {
    const match = /^\|\s*Jurisdiction\s*\|\s*([^|]+?)\s*\|$/.exec(line.trim());
    if (!match) continue;
    const value = match[1].trim();
    if (!value || value.length > 80 || /filename|\bacts\b|\bfield\b|\bvalue\b/i.test(value)) continue;
    return value;
  }
  return '';
}

function explicitLevel(card: string): ScopeHit[] {
  const hits: ScopeHit[] = [];
  const pattern = /level\s+`?(national|state|municipal|province|provincial|regional|local)`?/gi;
  let match = pattern.exec(card);
  while (match) {
    const token = match[1].toLowerCase();
    const family = token === 'national' ? 'national' : token === 'municipal' || token === 'local' ? 'municipal' : 'regional';
    hits.push({ family, quote: 'schema level ' + token });
    match = pattern.exec(card);
  }
  return hits;
}

function tagHits(tags: string[]): ScopeHit[] {
  const hits: ScopeHit[] = [];
  for (const tag of tags) {
    if (tag === 'national-law') hits.push({ family: 'national', quote: 'tag national-law' });
    if (tag === 'subnational-law' || tag === 'state-statutes' || tag === 'state') hits.push({ family: 'regional', quote: 'tag ' + tag });
    if (tag === 'municipal-law' || tag === 'local-government') hits.push({ family: 'municipal', quote: 'tag ' + tag });
  }
  return hits;
}

function deniedFamilies(sentence: string): Set<'national' | 'regional' | 'municipal'> {
  const denied = new Set<'national' | 'regional' | 'municipal'>();
  const cleaned = withoutCodeSpans(sentence);
  const denial = /\b(no|not|without|excluding|excluded)\b|\bout of scope\b/i.test(cleaned);
  const redirect = /\b(lives in|published in|is published in|moved to|split out|not compared|unchanged|stay in|source national)\b/i.test(cleaned) || /\bis in\s+\[/i.test(cleaned) || /\bnational repo\b/i.test(cleaned);
  if (denial) {
    for (const family of ['national', 'regional', 'municipal'] as const) {
      if (LEVEL_PATTERNS[family].some((pattern) => pattern.test(cleaned))) denied.add(family);
    }
  }
  if (!redirect) return denied;
  if (/\bnational\b|\bfederal\b|\bsupranational\b/i.test(cleaned)) denied.add('national');
  if (/\bregional\b|\bsub-?national\b|\bprovinc|\bstate statutes\b|\bstate laws\b|\bstate acts\b|\bgovernorate/i.test(cleaned)) denied.add('regional');
  if (/\bmunicipal|\bgemeente|\bcommunal\b|\blocal government\b/i.test(cleaned)) denied.add('municipal');
  return denied;
}

function coverageText(sentence: string): string {
  return withoutCodeSpans(sentence.replace(/\bnational\s+`[^`]*`/gi, ' '))
    .replace(/national\s+(?:\S+\s+)?laws\/articles schema/gi, ' ')
    .replace(/\bnational\s+(?:rows?|columns?|article columns|law columns|schemas?|packs?|tables?|order\b|ipfs\b|law_status\b|identifiers?|registers?\b|aggregators?\b|forms?\b)/gi, ' ')
    .replace(/\bthe national\b(?!\s+(?:legislation|laws?|acts?|statutes?|regulations?|gazettes?|government|coverage|corpus|compilations?|registers?)\b)/gi, ' ')
    .replace(/\bNational (?:Law Information Center|Archives|Legal Information Centre|Legal Information Center)\b/gi, ' ')
    .replace(/\bProvincial (?:Gazettes?|bulletins?)\b/g, ' ')
    .replace(/\bprovince\s*\+\s*census\b/gi, ' ')
    .replace(/\bprovince\s+\d+\b/gi, ' ')
    .replace(/\bmunicipal packs?\b/gi, ' ')
    .replace(/\bsearching national titles\b/gi, ' ')
    .replace(/\bfollows the national corpus\b/gi, ' ');
}

function positiveHits(sentence: string): ScopeHit[] {
  if (/doc_type\b|code_section\s*\|/i.test(sentence)) return [];
  if (/\bPII sweep\b|\bnational[- ]IDs?\b|\bnational_id\b/i.test(sentence)) return [];
  if (/\bmight include\b|\bin the future\b|\bmay join later\b|\bhub check\b/i.test(sentence)) return [];
  if (/^Classification of all\b/i.test(sentence)) return [];
  if (/^\|/.test(sentence) && !/(?<!bye-)(?<!by-)\b(laws?|acts?|legislation|regulations?|ordinances?|statutes?|included|coverage|scope)\b/i.test(sentence)) return [];
  if (/\badmin_level\b|\badmin1\b|\bmunicipality_code\b/i.test(sentence) && !/\b(legislation|statutes?|acts?|bye-?laws?)\b/i.test(sentence)) return [];
  const cleaned = coverageText(sentence);
  const denied = deniedFamilies(sentence);
  const hits: ScopeHit[] = [];
  const quote = sentence.length > 220 ? sentence.slice(0, 217) + '...' : sentence;
  for (const family of ['national', 'regional', 'municipal'] as const) {
    if (denied.has(family)) continue;
    if (LEVEL_PATTERNS[family].some((pattern) => pattern.test(cleaned))) hits.push({ family, quote });
  }
  return hits;
}

export function collectScope(datasetId: string, card: string): ScopeHit[] {
  if (!card.trim()) return [];
  const matter = frontMatter(card);
  const stripped = stripRepositoryIdentity(datasetId, matter.body);
  const hits = [...explicitLevel(card), ...tagHits(matter.tags)];
  for (const sentence of sentencesOf(stripped)) hits.push(...positiveHits(sentence));
  const families = new Set(hits.map((hit) => hit.family));
  const jurisdiction = jurisdictionValue(stripped);
  if (jurisdiction && families.size === 0) {
    hits.push({ family: 'national', quote: 'Jurisdiction | ' + jurisdiction });
  }
  const seen = new Set<string>();
  const unique: ScopeHit[] = [];
  for (const hit of hits) {
    const key = hit.family + '\n' + hit.quote;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(hit);
  }
  return unique;
}

function isUnified(names: Set<string>): boolean {
  return UNIFIED_CONFIGS.every((name) => names.has(name));
}

function legacyKind(names: Set<string>, paths: string[]): '' | 'bm25' | 'graph' | 'vector' {
  if (names.has('laws') || names.has('corpus') || names.has('bm25_documents') || names.has('graph_nodes')) return '';
  if (names.has('documents') && names.has('terms')) return 'bm25';
  if (names.has('edges') && names.has('nodes')) return 'graph';
  if (names.has('mapping') && paths.some((filePath) => /faiss|\.pkl$/i.test(filePath))) return 'vector';
  return '';
}

function isCountryIrSchema(names: Set<string>): boolean {
  const hits = IR_CONFIGS.filter((name) => names.has(name));
  const textSide = names.has('corpus') || names.has('bm25_documents');
  const graphSide = names.has('graph_nodes') || names.has('graph_edges');
  return hits.length >= 4 && textSide && graphSide;
}

function isCourtMetadata(names: Set<string>): boolean {
  const joined = [...names].join(' ');
  if (/\blaws?\b|\barticles\b|\bstatuti\b|\bdeliberations?\b/.test(joined)) return false;
  return /\b(?:courts?|judges?|courthouses?)\b/.test(joined);
}

function isCountryIrLayout(paths: string[]): boolean {
  const normalized = paths.map((filePath) => filePath.toLowerCase());
  const has = (pattern: RegExp) => normalized.some((filePath) => pattern.test(filePath));
  const corpus = has(/(^|\/)corpus(\/|$)/);
  const bm25 = has(/bm25/);
  const graph = has(/(^|\/)graph(\/|$)/);
  const vectors = has(/(^|\/)vectors?(\/|$)/);
  return (corpus || bm25) && graph && (bm25 || vectors || corpus);
}

function codeRoles(datasetId: string, card: string): SourceFamily[] {
  const evidence = stripRepositoryIdentity(datasetId, card);
  const roles: SourceFamily[] = [];
  if (/national_collectors|\bnational gazettes?\b|\bcollect national\b|\bstate\/provincial and municipal\b/i.test(evidence)) roles.push('national');
  if (/(^|[^a-z])regions\/|state\/provincial|\bregional collectors?\b/i.test(evidence)) roles.push('regional');
  if (/municipal\/|municipal collectors?\b|\bcollect municipal\b/i.test(evidence)) roles.push('municipal');
  if (/country_laws_ir|\bGraphRAG IR builder\b/i.test(evidence)) roles.push('country-ir');
  return roles;
}

function capabilityList(record: DatasetRecord, paths: string[], names: Set<string>, extras: string[]): string[] {
  const capabilities = new Set<string>(extras);
  if (names.has('laws') || names.has('articles') || names.has('statuti') || names.has('deliberations')) capabilities.add('text');
  if (names.has('laws')) capabilities.add('laws');
  if (names.has('articles')) capabilities.add('articles');
  for (const name of names) {
    if (/bm25|vector|graph|posting|faiss|adjacency|centroid|mapping/.test(name)) capabilities.add('index');
    if (/bm25/.test(name)) capabilities.add('bm25');
    if (/vector|faiss|mapping/.test(name)) capabilities.add('vector');
    if (/graph|edges|nodes|adjacency/.test(name)) capabilities.add('graph');
    if (name === 'cid_index') capabilities.add('cid');
    if (name === 'logic_relationships') capabilities.add('logic');
    if (name === 'corpus') capabilities.add('corpus');
  }
  for (const filePath of paths) {
    const lowered = filePath.toLowerCase();
    if (/laws.*\.parquet|articles.*\.parquet|\/laws\.|\/articles\./.test(lowered)) capabilities.add('text');
    if (/bm25|faiss\.index|\/graph\/|\/vectors?\//.test(lowered)) capabilities.add('index');
    if (/bm25/.test(lowered)) capabilities.add('bm25');
    if (/\/graph\//.test(lowered)) capabilities.add('graph');
    if (/\/vectors?\//.test(lowered)) capabilities.add('vector');
    if (/(^|\/)corpus(\/|$)/.test(lowered)) capabilities.add('corpus');
  }
  if (codeCount(record) > 0) capabilities.add('code');
  if (capabilities.size === 0) capabilities.add('metadata');
  return [...capabilities].sort((left, right) => left.localeCompare(right));
}

function quoteFor(hits: ScopeHit[], family: 'national' | 'regional' | 'municipal'): string {
  const match = hits.find((hit) => hit.family === family);
  return match ? match.quote : '';
}

function lineage(record: DatasetRecord, detail: string): string {
  const revision = revisionOf(record) || 'unpinned';
  const hash = cardHash(record);
  const parts = ['revision:' + revision];
  if (hash) parts.push('card:' + hash.slice(0, 16));
  if (detail) parts.push(detail);
  return parts.join('; ');
}

function clip(value: string): string {
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > 420 ? text.slice(0, 417) + '...' : text;
}

function row(
  record: DatasetRecord,
  family: SourceFamily,
  decision: Decision,
  reason: string,
  capabilities: string[],
  detail: string,
  codeOnly: boolean,
): Disposition {
  return {
    dataset_id: textField(record.dataset_id),
    family,
    decision,
    reason: clip(reason),
    schema_capabilities: capabilities,
    source_lineage: lineage(record, detail),
    code_only_release: codeOnly,
    resolved_revision: revisionOf(record),
  };
}

function admit(record: DatasetRecord): { decision: Decision; because: string } | null {
  const message = accessMessage(record);
  if (message) return { decision: BLOCKED, because: 'Inventory access error (' + message + ').' };
  if (record.gated === true || record.private === true || record.disabled === true) {
    return { decision: BLOCKED, because: 'The dataset is gated, private, or disabled for anonymous readers.' };
  }
  if (zeroRows(record)) return { decision: BLOCKED, because: 'The pinned viewer size reports zero rows.' };
  if (payloadCount(record) <= 0) return { decision: BLOCKED, because: 'No parquet, JSONL, JSON-LD, FAISS, or DuckDB payload is recorded.' };
  return null;
}

function projectionSource(card: string): { datasetId: string; revision: string; rows: number } | null {
  const datasetId = /Source dataset:\s*`([^`]+)`/.exec(card);
  if (!datasetId) return null;
  const revision = /Source revision:\s*`([0-9a-f]{7,64})`/.exec(card);
  const rows = /Rows kept:\s*(\d+)/.exec(card);
  return {
    datasetId: datasetId[1],
    revision: revision ? revision[1] : '',
    rows: rows ? Number(rows[1]) : -1,
  };
}

function statedCountryCorpus(datasetId: string, card: string): string {
  const body = stripRepositoryIdentity(datasetId, frontMatter(card).body);
  if (/Legal corpus for \S+/i.test(body)) return 'The card calls this a legal corpus from official gazettes or legal portals.';
  const heading = /^#\s+(.+)$/m.exec(body);
  if (heading && /\bLaws\b/.test(heading[1]) && !/\bmunicipal\b|\bregional\b|\bprovincial\b|\bstate\b/i.test(heading[1])) {
    return 'The card heading names a jurisdiction law corpus.';
  }
  return '';
}

function deprecationNote(card: string): string {
  if (/\bthis dataset is deprecated\b/i.test(card) || /\bsuperseded by\b/i.test(card)) {
    return 'The card marks this release deprecated or superseded, so it is not admitted as current coverage.';
  }
  return '';
}

function familiesOf(hits: ScopeHit[]): Array<'national' | 'regional' | 'municipal'> {
  return (['national', 'regional', 'municipal'] as const).filter((family) => hits.some((hit) => hit.family === family));
}

function unrelatedReason(record: DatasetRecord, datasetId: string, card: string, paths: string[]): string {
  const evidence = (stripRepositoryIdentity(datasetId, card) + ' ' + paths.join(' ') + ' ' + [...configNames(record)].join(' ')).toLowerCase();
  if (/\bcaselaw\b|\bcase law\b|\bcourt opinion/.test(evidence)) return 'Excluded. Card or configs describe case law, which is not a statute family or a country IR package.';
  if (/\bcourthouses?\b|\bcourt rules\b|\bjudges\b/.test(evidence) && !/\blaws?\b|\barticles\b/.test([...configNames(record)].join(' '))) {
    return 'Excluded. Court-metadata configs are not a national, regional, municipal, country IR, unified, or legacy-index release.';
  }
  if (/\bautoencoder\b|\bspan cache\b|\bautoformal\b/.test(evidence)) return 'Excluded. The card describes a model or span cache rather than a law-text or retrieval-index release.';
  if (/\bpatent\b/.test(evidence) && !configNames(record).has('usc') && !configNames(record).has('cfr') && !configNames(record).has('public_law')) {
    return 'Excluded. Patent index artifacts are not the country IR law package and are not a legacy Netherlands split index.';
  }
  if (/\bembeddings?\b/.test(evidence) && payloadCount(record) > 0 && !isCountryIrSchema(configNames(record))) {
    return 'Excluded. Embedding artifacts without the country IR schema are not admitted as a legacy index or as law text.';
  }
  if (/pointers\.parquet|slice_indexes|common crawl meta/.test(evidence)) {
    return 'Blocked. Pointer or crawl-index files are present, the statute schema is absent, and the repository id is not used to assign municipal, regional, or national coverage.';
  }
  return '';
}

export function classifyRecord(
  record: DatasetRecord,
  card: string,
  layouts: readonly string[],
  sourceCard = '',
): { dispositions: Disposition[]; unassigned: Unassigned | null } {
  const datasetId = textField(record.dataset_id);
  const names = configNames(record);
  const paths = [...listedPaths(record), ...layouts];
  const projection = projectionSource(card);
  const scopeCard = projection && sourceCard ? sourceCard : card;
  const scopeId = projection && sourceCard ? projection.datasetId : datasetId;
  const hits = collectScope(scopeId, scopeCard);
  const scopeFamilies = familiesOf(hits);
  const legacy = legacyKind(names, paths);
  const countryIr = isCountryIrSchema(names) || isCountryIrLayout(paths);
  const codeOnly = payloadCount(record) <= 0 && codeCount(record) > 0 && names.size === 0;
  const roles = codeOnly ? codeRoles(datasetId, card) : [];
  const admission = admit(record);
  const dispositions: Disposition[] = [];

  if (isUnified(names)) {
    const blocked = admission;
    dispositions.push(row(
      record,
      'unified-netherlands',
      blocked ? blocked.decision : INCLUDE,
      (blocked ? blocked.because + ' ' : 'Included as the unified Netherlands bundle. ')
        + 'One schema publishes laws, articles, a CID index, BM25, a vector index, a knowledge graph, and logic relationships. The repository id was not the signal.',
      capabilityList(record, paths, names, ['text', 'index']),
      'schema:unified-bundle',
      false,
    ));
    return { dispositions, unassigned: null };
  }

  if (legacy) {
    const blocked = admission;
    dispositions.push(row(
      record,
      'legacy-index',
      blocked ? blocked.decision : INCLUDE,
      (blocked ? blocked.because + ' ' : 'Included as a legacy split index (' + legacy + '). ')
        + 'The configs are the pre-unified index layout and do not include the law-text schema or the country IR schema. Index payloads are present, so this is not a code-only release.',
      capabilityList(record, paths, names, ['index']),
      'schema:legacy-' + legacy,
      false,
    ));
    return { dispositions, unassigned: null };
  }

  if (countryIr && !codeOnly) {
    const blocked = admission;
    const scopeNote = scopeFamilies.length
      ? ' Card scope, after the repository id was removed: ' + scopeFamilies.join(', ') + '.'
      : ' No administrative level was copied from the repository id.';
    const layoutNote = isCountryIrSchema(names)
      ? 'Viewer configs expose the GraphRAG set (corpus or BM25, plus graph).'
      : 'Sibling paths expose data/corpus or data/bm25 together with data/graph. Viewer config names alone were not treated as proof.';
    dispositions.push(row(
      record,
      'country-ir',
      blocked ? blocked.decision : INCLUDE,
      (blocked ? blocked.because + ' ' : 'Included as a country IR release. ') + layoutNote + scopeNote,
      capabilityList(record, paths, names, ['index']),
      projection ? 'projection-of:' + projection.datasetId + '@' + (projection.revision || 'unpinned') : 'schema-or-layout:country-ir',
      false,
    ));
    return { dispositions, unassigned: null };
  }

  if (codeOnly) {
    const selected = roles.length > 0 ? roles : [];
    if (selected.length === 0) {
      return {
        dispositions: [],
        unassigned: {
          dataset_id: datasetId,
          decision: EXCLUDE,
          reason: 'Excluded as a code-only release. Source files are present and law-text or index payloads are absent. The card does not assign a national, regional, municipal, or country IR collector role.',
          schema_capabilities: ['code'],
          source_lineage: lineage(record, 'code-only:no-family-role'),
          code_only_release: true,
          resolved_revision: revisionOf(record),
        },
      };
    }
    for (const family of selected) {
      dispositions.push(row(
        record,
        family,
        EXCLUDE,
        'Excluded as a code-only release for the ' + family + ' collector role stated by the card or in-repo paths. No law-text or index payload is in the inventory, so it is not admitted as law text.',
        ['code'],
        'code-role:' + family,
        true,
      ));
    }
    return { dispositions, unassigned: null };
  }

  if (isCourtMetadata(names)) {
    const blocked = admission;
    const reason = blocked
      ? blocked.because + ' Court, judge, or courthouse configs are present, and no statute schema was established.'
      : 'Excluded. Court, judge, or courthouse configs are not a national, regional, municipal, country IR, unified, or legacy-index release.';
    return {
      dispositions: [],
      unassigned: {
        dataset_id: datasetId,
        decision: blocked ? blocked.decision : EXCLUDE,
        reason,
        schema_capabilities: capabilityList(record, paths, names, []),
        source_lineage: lineage(record, 'court-metadata'),
        code_only_release: false,
        resolved_revision: revisionOf(record),
      },
    };
  }

  const statuteSchema = names.has('laws') || names.has('articles') || names.has('statuti') || names.has('deliberations')
    || names.has('usc') || names.has('cfr') || names.has('public_law') || names.has('federal_register');
  const lawPath = paths.some((filePath) => /laws|articles|statuti|deliberation/i.test(filePath));
  const countryStatement = statedCountryCorpus(datasetId, scopeCard);
  const levels = scopeFamilies.length > 0
    ? scopeFamilies
    : countryStatement && (statuteSchema || lawPath)
      ? (['national'] as const)
      : [];
  const textLike = statuteSchema || lawPath || (levels.length > 0 && payloadCount(record) > 0);
  if (textLike && (levels.length > 0 || names.has('usc') || names.has('cfr') || names.has('public_law'))) {
    const selected = levels.length > 0 ? levels : (['national'] as const);
    const deprecated = deprecationNote(card);
    for (const family of selected) {
      const blocked = admission;
      const quote = quoteFor(hits, family) || (family === 'national' ? countryStatement : '');
      const statuteNote = names.has('usc') || names.has('cfr') || names.has('public_law')
        ? ' Published configs include statute or regulation slices (usc, cfr, public_law, or federal_register). Patent or other co-packaged configs are not a separate family.'
        : '';
      const decision = deprecated ? EXCLUDE : blocked ? blocked.decision : INCLUDE;
      const prefix = deprecated ? deprecated + ' ' : blocked ? blocked.because + ' ' : 'Included as ' + family + ' law text. ';
      dispositions.push(row(
        record,
        family,
        decision,
        prefix
          + (quote ? 'Evidence: ' + quote + '.' : 'The card states this administrative level.')
          + statuteNote
          + ' The repository id was not used.',
        capabilityList(record, paths, names, ['text']),
        projection
          ? 'projection-of:' + projection.datasetId + '@' + (projection.revision || 'unpinned')
          : 'card-scope:' + family,
        false,
      ));
    }
    return { dispositions, unassigned: null };
  }

  const other = unrelatedReason(record, datasetId, card, paths);
  const blocked = admission;
  const decision = other.startsWith('Excluded') ? EXCLUDE : blocked ? blocked.decision : BLOCKED;
  const schemaWithoutLevel = statuteSchema || lawPath;
  const reason = other
    || (blocked
      ? blocked.because + (schemaWithoutLevel
        ? ' Laws or articles are present, but no national, regional, or municipal coverage was established without using the repository id.'
        : ' No national, regional, municipal, country IR, unified, or legacy-index schema was established without using the repository id.')
      : schemaWithoutLevel
        ? 'Blocked. Laws or articles are published, but the card does not state national, regional, or municipal coverage. The repository id was not used to choose a family.'
        : 'Blocked. The inventory does not show a statute schema, a country IR layout, a unified Netherlands bundle, or a legacy split index. The repository id was not used to fill that gap.');
  return {
    dispositions: [],
    unassigned: {
      dataset_id: datasetId,
      decision,
      reason: clip(reason),
      schema_capabilities: capabilityList(record, paths, names, []),
      source_lineage: lineage(record, card.trim() ? 'card-present' : 'card-absent'),
      code_only_release: false,
      resolved_revision: revisionOf(record),
    },
  };
}

function emptyFamilyCounts(): Record<SourceFamily, Record<Decision, number>> {
  const counts = {} as Record<SourceFamily, Record<Decision, number>>;
  for (const family of SOURCE_FAMILIES) counts[family] = { include: 0, exclude: 0, blocked: 0 };
  return counts;
}

export function classifyInventory(
  inventory: Record<string, unknown>,
  cards: ReadonlyMap<string, string>,
  layouts: ReadonlyMap<string, readonly string[]>,
  inventoryRevision: string,
): DispositionDocument {
  const rows = datasetRows(inventory);
  const dispositions: Disposition[] = [];
  const unassigned: Unassigned[] = [];
  for (const record of rows) {
    const datasetId = textField(record.dataset_id);
    const card = cards.get(datasetId) || '';
    const projection = projectionSource(card);
    const sourceCard = projection ? cards.get(projection.datasetId) || '' : '';
    const result = classifyRecord(record, card, layouts.get(datasetId) || [], sourceCard);
    dispositions.push(...result.dispositions);
    if (result.unassigned) unassigned.push(result.unassigned);
  }
  dispositions.sort((left, right) => left.dataset_id.localeCompare(right.dataset_id) || left.family.localeCompare(right.family) || left.decision.localeCompare(right.decision));
  unassigned.sort((left, right) => left.dataset_id.localeCompare(right.dataset_id));
  const byFamily = emptyFamilyCounts();
  for (const disposition of dispositions) byFamily[disposition.family][disposition.decision] += 1;
  return {
    schema: DISPOSITION_SCHEMA,
    inventory_revision: inventoryRevision,
    inventory_dataset_count: rows.length,
    basis: 'Schema configs, sibling paths, extension counts, viewer sizes, YAML tags, and dataset-card prose. Repository ids are removed before scope matching. A code-only release is excluded and is not admitted as law text.',
    summary: { dispositions: dispositions.length, unassigned: unassigned.length, by_family: byFamily },
    dispositions,
    unassigned,
  };
}

export function needsLayout(record: DatasetRecord): boolean {
  const fileRecord = asRecord(record.file_record);
  if (fileRecord && fileRecord.complete === true) return false;
  const names = configNames(record);
  if (isUnified(names) || isCountryIrSchema(names) || legacyKind(names, listedPaths(record))) return false;
  if (names.has('laws') || names.has('articles')) return false;
  return payloadCount(record) > 0;
}

async function hfTree(datasetId: string, revision: string, prefix: string): Promise<string[]> {
  const url = 'https://huggingface.co/api/datasets/' + datasetId + '/tree/' + revision + (prefix ? '/' + prefix : '');
  const response = await fetch(url, { headers: { 'user-agent': 'worldwide-legal-search-classify/WWL-011' } });
  if (!response.ok) throw new Error(datasetId + ' tree HTTP ' + response.status);
  const body = await response.json() as Array<{ path?: string }>;
  return body.map((entry) => textField(entry.path)).filter((entry) => entry.length > 0);
}

export async function probeLayouts(records: DatasetRecord[], cache: Map<string, string[]>): Promise<void> {
  const pending = records.filter((record) => needsLayout(record) && revisionOf(record) && !cache.has(textField(record.dataset_id)));
  let cursor = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= pending.length) return;
      const record = pending[index];
      const datasetId = textField(record.dataset_id);
      const revision = revisionOf(record) || '';
      try {
        const paths = await hfTree(datasetId, revision, '');
        for (const directory of ['data', 'indexes']) {
          if (!paths.includes(directory)) continue;
          const children = await hfTree(datasetId, revision, directory);
          paths.push(...children);
        }
        cache.set(datasetId, paths);
      } catch (error) {
        cache.set(datasetId, []);
        process.stderr.write('layout probe failed for ' + datasetId + ': ' + (error instanceof Error ? error.message : 'unknown') + '\n');
      }
    }
  }
  await Promise.all(Array.from({ length: 4 }, () => worker()));
}

async function readCards(directory: string): Promise<Map<string, string>> {
  const cards = new Map<string, string>();
  const { readdir } = await import('node:fs/promises');
  const entries = await readdir(directory);
  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue;
    const datasetId = entry.slice(0, -3).replace('__', '/');
    cards.set(datasetId, await readFile(path.join(directory, entry), 'utf8'));
  }
  return cards;
}

function assertExpectations(document: DispositionDocument): void {
  const present = new Set(document.dispositions.map((row) => row.dataset_id + '|' + row.family + '|' + row.decision));
  const expectPresent: Array<[string, SourceFamily, Decision]> = [
    ['justicedao/wetwijzer_netherlands_legal_corpus', 'unified-netherlands', INCLUDE],
    ['justicedao/ipfs_netherlands_laws_bm25_index', 'legacy-index', INCLUDE],
    ['justicedao/ipfs_netherlands_laws_vector_index', 'legacy-index', INCLUDE],
    ['justicedao/ipfs_netherlands_laws_knowledge_graph', 'legacy-index', INCLUDE],
    ['endomorphosis/ipfs_albania_laws', 'national', INCLUDE],
    ['endomorphosis/ipfs_india_state_laws', 'regional', INCLUDE],
    ['justicedao/ipfs_us_local_laws', 'municipal', INCLUDE],
    ['endomorphosis/ipfs_egypt_governorate_laws', 'regional', INCLUDE],
    ['endomorphosis/ipfs_canada_state_laws', 'regional', INCLUDE],
    ['justicedao/ipfs_italy_regional_laws', 'regional', INCLUDE],
    ['endomorphosis/ipfs_belgium_municipal_laws', 'municipal', INCLUDE],
    ['justicedao/ipfs_netherlands_municipal_laws', 'municipal', INCLUDE],
    ['justicedao/ipfs_netherlands_municipal_laws', 'regional', INCLUDE],
    ['justicedao/world_law_scrapers', 'national', EXCLUDE],
    ['justicedao/world_law_scrapers', 'regional', EXCLUDE],
    ['justicedao/world_law_scrapers', 'municipal', EXCLUDE],
    ['justicedao/world_law_scrapers', 'country-ir', EXCLUDE],
    ['endomorphosis/world_national_law', 'national', INCLUDE],
    ['endomorphosis/world_national_law', 'regional', INCLUDE],
    ['endomorphosis/world_municipal_law', 'municipal', INCLUDE],
    ['justicedao/ipfs_germany_laws_ir', 'country-ir', INCLUDE],
    ['justicedao/ipfs_afghanistan_laws_ir', 'country-ir', INCLUDE],
    ['endomorphosis/ipfs_hongkong_laws', 'national', INCLUDE],
    ['endomorphosis/ipfs_dominican_republic_laws', 'national', EXCLUDE],
    ['endomorphosis/ipfs_namibia_laws', 'national', INCLUDE],
    ['justicedao/ipfs_luxembourg_laws_rc2', 'municipal', INCLUDE],
    ['justicedao/ipfs_spain_catalonia_municipal_laws', 'municipal', INCLUDE],
    ['justicedao/ipfs_ukraine_laws_supplement', 'national', INCLUDE],
  ];
  const expectAbsent: Array<[string, SourceFamily]> = [
    ['endomorphosis/ipfs_india_state_laws', 'national'],
    ['justicedao/ipfs_us_local_laws', 'national'],
    ['justicedao/ipfs_us_local_laws', 'regional'],
    ['endomorphosis/ipfs_egypt_governorate_laws', 'national'],
    ['endomorphosis/ipfs_canada_state_laws', 'municipal'],
    ['endomorphosis/world_national_law', 'municipal'],
    ['endomorphosis/world_municipal_law', 'national'],
    ['endomorphosis/ipfs_hongkong_laws', 'municipal'],
    ['endomorphosis/ipfs_algeria_laws', 'municipal'],
    ['justicedao/ipfs_italy_regional_laws', 'national'],
    ['endomorphosis/ipfs_greece_regional_laws', 'national'],
    ['endomorphosis/ipfs_greece_regional_laws', 'municipal'],
    ['endomorphosis/ipfs_pakistan_laws', 'regional'],
    ['endomorphosis/world_courts', 'municipal'],
    ['endomorphosis/world_courts', 'regional'],
    ['endomorphosis/ipfs_court_data', 'national'],
    ['endomorphosis/ipfs_court_data', 'regional'],
    ['endomorphosis/ipfs_court_data', 'municipal'],
    ['justicedao/american_municipal_law', 'national'],
  ];
  const failures: string[] = [];
  for (const [datasetId, family, decision] of expectPresent) {
    if (!present.has(datasetId + '|' + family + '|' + decision)) failures.push('missing ' + datasetId + ' ' + family + ' ' + decision);
  }
  for (const [datasetId, family] of expectAbsent) {
    if (document.dispositions.some((row) => row.dataset_id === datasetId && row.family === family)) {
      failures.push('unexpected ' + datasetId + ' ' + family);
    }
  }
  for (const family of SOURCE_FAMILIES) {
    if (!document.dispositions.some((row) => row.family === family)) failures.push('family missing ' + family);
  }
  for (const disposition of document.dispositions) {
    if (disposition.code_only_release && disposition.decision === INCLUDE) {
      const capabilities = disposition.schema_capabilities;
      if (capabilities.includes('text') || capabilities.includes('law-text') || !capabilities.includes('code')) {
        failures.push('code-only include ' + disposition.dataset_id);
      }
    }
    if (disposition.reason.trim().length < 8) failures.push('short reason ' + disposition.dataset_id);
  }
  const covered = new Set<string>();
  for (const disposition of document.dispositions) covered.add(disposition.dataset_id);
  for (const entry of document.unassigned) covered.add(entry.dataset_id);
  if (covered.size !== document.inventory_dataset_count) failures.push('coverage ' + covered.size + ' of ' + document.inventory_dataset_count);
  if (failures.length) throw new Error('classification expectations failed: ' + failures.join('; '));
}

async function main(): Promise<void> {
  const args = {
    inventory: path.join(ROOT, 'data/worldwide/source-inventory.json'),
    cards: '',
    output: path.join(ROOT, 'data/worldwide/source-dispositions.json'),
    layouts: '',
    probe: false,
  };
  const argv = process.argv.slice(2);
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === '--inventory' && value) {
      args.inventory = path.resolve(value);
      index += 1;
    } else if (flag === '--cards' && value) {
      args.cards = path.resolve(value);
      index += 1;
    } else if (flag === '--output' && value) {
      args.output = path.resolve(value);
      index += 1;
    } else if (flag === '--layouts' && value) {
      args.layouts = path.resolve(value);
      index += 1;
    } else if (flag === '--probe') args.probe = true;
    else throw new Error('unknown argument ' + flag);
  }
  const inventoryText = await readFile(args.inventory, 'utf8');
  const inventory = JSON.parse(inventoryText) as Record<string, unknown>;
  const inventoryRevision = sha256Text(inventoryText);
  const cards = args.cards ? await readCards(args.cards) : new Map<string, string>();
  const layouts = new Map<string, string[]>();
  if (args.layouts) {
    try {
      const saved = JSON.parse(await readFile(args.layouts, 'utf8')) as Record<string, string[]>;
      for (const [datasetId, paths] of Object.entries(saved)) layouts.set(datasetId, paths);
    } catch (error) {
      if (!args.probe) throw error;
    }
  }
  if (args.probe) {
    await probeLayouts(datasetRows(inventory), layouts);
    if (args.layouts) {
      await mkdir(path.dirname(args.layouts), { recursive: true });
      const encoded = Object.fromEntries([...layouts.entries()].sort((left, right) => left[0].localeCompare(right[0])));
      await writeFile(args.layouts, JSON.stringify(encoded));
    }
  }
  const document = classifyInventory(inventory, cards, layouts, inventoryRevision);
  if (args.cards) assertExpectations(document);
  const pretty = JSON.stringify(document, null, 2) + '\n';
  const compact = JSON.stringify(document) + '\n';
  const text = Buffer.byteLength(pretty) <= 1048576 ? pretty : compact;
  if (Buffer.byteLength(text) > 1048576) throw new Error('source dispositions exceed the single-file evidence budget');
  await mkdir(path.dirname(args.output), { recursive: true });
  const temporary = args.output + '.tmp';
  await writeFile(temporary, text);
  await rename(temporary, args.output);
  process.stdout.write(JSON.stringify({
    inventory_revision: inventoryRevision,
    bytes: Buffer.byteLength(text),
    dispositions: document.dispositions.length,
    unassigned: document.unassigned.length,
    by_family: document.summary.by_family,
  }, null, 2) + '\n');
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

if (isDirectRun()) {
  main().catch((error: unknown) => {
    process.stderr.write((error instanceof Error ? error.message : 'classification failed') + '\n');
    process.exit(1);
  });
}

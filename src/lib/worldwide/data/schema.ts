/**
 * Versioned law-source and law-section schema.
 *
 * Official identifiers come only from the source. A missing source id, record
 * id, instrument id, section id, publisher id, or pinned revision quarantines
 * the row. The quarantine ingestion key is local and is never an official
 * citation. Text-version identity stays distinct from the logical instrument
 * id. Unknown status, language, scope, and dates stay explicit. Jurisdiction
 * and country strings are territorial labels, not issuer ids.
 */

import type { DatePrecision, LegalRecordStatus } from '../contracts';

export const SCHEMA_VERSION = 1;
export const LAW_SOURCE_SCHEMA = 'worldwide-legal-search.law-source@1';
export const LAW_SECTION_SCHEMA = 'worldwide-legal-search.law-section@1';
export const QUARANTINE_SCHEMA = 'worldwide-legal-search.quarantine@1';
export const TEXT_VERSION_PREFIX = 'tv1';
export const INGESTION_KEY_PREFIX = 'qk1_';

/** Column contract pinned to country_laws_ir/schema.py. Values are not invented. */
export const REQUIRED_LAW_COLUMNS = ['id', 'title', 'text'] as const;
export const REQUIRED_ARTICLE_COLUMNS = ['id', 'law_id', 'title', 'text'] as const;
export const OPTIONAL_LAW_COLUMNS = [
  'source_url',
  'source_type',
  'jurisdiction',
  'country',
  'language',
  'eli',
  'date',
  'date_issued',
  'retrieved_at',
  'license',
  'law_status',
  'identifier',
  'official_identifier',
  'article_count',
  'json_path',
  'metadata_json',
] as const;
export const OPTIONAL_ARTICLE_COLUMNS = [
  'source_url',
  'document_number',
  'article_number',
  'record_type',
  'metadata_json',
] as const;

export const LAW_FIELD_MAP = {
  source_id: 'id',
  title: 'title',
  body: 'text',
  source_url: 'source_url',
  source_type: 'source_type',
  jurisdiction: 'jurisdiction',
  country: 'country',
  language: 'language',
  eli: 'eli',
  date: 'date',
  date_issued: 'date_issued',
  retrieved_at: 'retrieved_at',
  license_expression: 'license',
  law_status: 'law_status',
  identifier: 'identifier',
  official_identifier: 'official_identifier',
  article_count: 'article_count',
  metadata_json: 'metadata_json',
} as const;

export const ARTICLE_FIELD_MAP = {
  source_id: 'id',
  law_id: 'law_id',
  title: 'title',
  body: 'text',
  source_url: 'source_url',
  document_number: 'document_number',
  article_number: 'article_number',
  record_type_src: 'record_type',
  metadata_json: 'metadata_json',
} as const;

export const INSTRUMENT_KINDS = [
  'constitution',
  'statute',
  'code',
  'regulation',
  'ordinance',
  'treaty',
  'decision',
  'notice',
  'amendment',
  'consolidation',
  'unknown',
] as const;

export const SECTION_RECORD_TYPES = ['law', 'article', 'section', 'notice'] as const;
export const ASSOCIATION_KINDS = [
  'parent-section',
  'parent-instrument',
  'amendment-of',
  'translation-of',
  'mirror-of',
  'equivalent-text',
  'issued-by',
] as const;
export const MIRROR_RELATIONS = ['equivalent-text', 'conflicting-version'] as const;
export const KNOWLEDGE_STATES = ['known', 'unknown', 'inferred'] as const;
export const SECTION_STATUSES = ['current', 'historical', 'repealed', 'superseded', 'unknown'] as const;

const FLOATING_REVISIONS = new Set([
  'head',
  'main',
  'master',
  'latest',
  'trunk',
  'current',
  'floating',
  'unpinned',
  'none',
  'null',
  'undefined',
  'tip',
  'dev',
  'develop',
]);

const LANGUAGE_TAG = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;
const INGESTION_KEY_PATTERN = /^qk1_[0-9a-f]{64}$/;
const DERIVED_TEXT_VERSION_NOTE =
  'Derived from the pinned source revision and the SHA-256 of the source text. This is not an official citation.';

export const QUARANTINE_REASONS = {
  'missing-source-id': 'Source id is absent. No source identity was invented.',
  'missing-publisher-id': 'Publisher id is absent. No publisher identity was invented.',
  'missing-source-revision': 'Source revision is absent. An unpinned row cannot enter the catalog.',
  'unpinned-source-revision': 'Source revision is a floating label rather than a pinned revision.',
  'invalid-source-revision': 'Source revision is not a 40- or 64-character hex pin or a stable revision token.',
  'missing-section-id': 'Section id is absent. No official identifier was invented.',
  'missing-instrument-id': 'Logical instrument id is absent. No official identifier was invented.',
  'missing-text-version-id': 'Text version id is absent and cannot be derived without source text.',
  'text-version-collapsed-into-instrument':
    'Text version id equals the logical instrument id. Version identity stays separate.',
  'ingestion-key-used-as-citation': 'An ingestion key was supplied as an official citation. Ingestion keys are not citations.',
  'language-unspecified': 'Language is present without a tag or an explicit unknown status.',
  'invalid-language-tag': 'Language tag is not a BCP 47 tag. No language was substituted.',
  'unknown-language-has-tag': 'Language is marked unknown but a tag is present.',
  'date-precision-mismatch': 'Date value does not match a real date at the declared precision.',
  'date-knowledge-missing': 'A date value is present without known, inferred, or unknown status.',
  'unknown-date-has-value': 'A date marked unknown also carries a value or precision.',
  'known-date-missing-value': 'A known or inferred date has no value.',
  'inferred-date-without-source': 'An inferred date has no source for the inference.',
  'known-date-without-source': 'A known date has no source.',
  'invalid-status': 'Status is not current, historical, repealed, superseded, or unknown.',
  'parent-is-self': 'A record names itself as its parent.',
  'cyclic-parent': 'Parent links form a cycle. The cycle was not broken by dropping a record silently.',
  'dangling-parent': 'Parent section or instrument is not in this source revision and no external association was supplied.',
  'parent-instrument-mismatch':
    'Parent section belongs to a different instrument and no cross-instrument association was declared.',
  'cross-source-parent': 'Parent link crosses sources without a pinned target source id and revision.',
  'invalid-association-kind': 'Association kind is not supported.',
  'association-target-missing': 'Association target id is missing.',
  'amendment-targets-self': 'An amendment association points at the same section.',
  'translation-language-unchanged': 'A translation association uses the same language as the section it hangs on.',
  'translation-target-language-missing': 'A translation association does not name the other language.',
  'equivalent-text-hash-mismatch':
    'Records linked as equivalent text do not share a body hash. Mark the conflict instead of collapsing them.',
  'mirror-relation-missing': 'A mirror association does not say whether the text is equivalent or conflicting.',
  'mirror-drops-provenance': 'A mirror link omits the other source id or pinned revision.',
  'mirror-targets-self': 'A mirror link points at the same source revision.',
  'mirror-collapses-version': 'A mirror link reuses this text version id and hides the other version.',
  'inferred-field-without-reason': 'An inferred field has no provenance note.',
  'field-both-observed-and-unknown': 'A field is marked both observed and unknown.',
  'field-both-observed-and-inferred': 'A field is marked both observed and inferred.',
  'field-both-inferred-and-unknown': 'A field is marked both inferred and unknown.',
  'conflicting-provenance': 'Provenance notes for one field disagree.',
  'repeal-before-enactment': 'Repeal date is earlier than enactment at the coarser shared precision.',
  'issuer-scope-empty-unmarked': 'Scope is marked known or inferred but issuer, territory, and labels are empty.',
  'unknown-scope-has-ids': 'Scope is marked unknown but an issuer, territory, or label is present.',
  'invalid-scope': 'Scope lists or scope knowledge are not usable.',
  'duplicate-section-identity': 'This source revision already admitted this section id.',
  'required-column-missing': 'The source table is missing a required identity or content column. Identifiers were not invented.',
  'invalid-row': 'The source row is not an object.',
  'invalid-record-type': 'Record type is not law, article, section, or notice.',
  'invalid-instrument-kind': 'Instrument kind is not in the versioned vocabulary and was not rewritten as unknown.',
  'invalid-source-url': 'Source URL is not an absolute http, https, or ipfs URL.',
  'invalid-content-cid': 'Content CID is not a bare CID token.',
  'invalid-text': 'Text is not a string, number, empty value, or explicit unknown.',
  'unknown-text-has-value': 'Text is marked unknown but a value is present.',
  'invalid-article-count': 'Article count is not a non-negative integer.',
  'invalid-hierarchy': 'Hierarchy path is not a string or a list of strings.',
  'invalid-citation': 'Official citation is not a string.',
  'unreadable-provenance': 'metadata_json is present but is not a JSON object.',
  'conflicting-date': 'Two date fields for the same event disagree. Neither value was chosen.',
  'conflicting-status': 'Status fields disagree. Neither value was chosen.',
  'conflicting-language': 'Language fields disagree. Neither value was chosen.',
  'conflicting-publisher': 'Row publisher id does not match the source publisher id.',
  'conflicting-revision': 'Row source revision does not match the pinned source revision.',
  'unknown-license-has-expression': 'License is marked unknown but an expression or attribution is present.',
} as const;

export type QuarantineReason = keyof typeof QUARANTINE_REASONS;
export type InstrumentKind = (typeof INSTRUMENT_KINDS)[number];
export type SectionRecordType = (typeof SECTION_RECORD_TYPES)[number];
export type AssociationKind = (typeof ASSOCIATION_KINDS)[number];
export type MirrorRelation = (typeof MIRROR_RELATIONS)[number];
export type KnowledgeState = (typeof KNOWLEDGE_STATES)[number];
export type SourceTable = 'laws' | 'articles' | 'section';
export type QuarantineTable = 'source' | SourceTable | 'associations';

export interface KnownDate {
  knowledge: 'known' | 'inferred';
  value: string;
  precision: DatePrecision;
  source: string;
}

export interface UnknownDate {
  knowledge: 'unknown';
  value: null;
  precision: null;
  source: string | null;
}

export type KnowledgeDate = KnownDate | UnknownDate;

export interface LanguageKnowledge {
  tag: string | null;
  knowledge: KnowledgeState;
  source: string | null;
}

export interface ScopeKnowledge {
  issuerIds: string[];
  territorialIds: string[];
  territorialLabels: string[];
  knowledge: KnowledgeState;
  uncertainty: string[];
}

export interface LicenseKnowledge {
  expression: string | null;
  attribution: string | null;
  knowledge: KnowledgeState;
}

export interface Provenance {
  observedFields: string[];
  inferredFields: string[];
  unknownFields: string[];
  inferenceNotes: Record<string, string>;
  unmappedColumns: string[];
  collector: string | null;
  retrievedAt: string | null;
  sourceLineage: string | null;
}

export interface StoredAssociation {
  kind: AssociationKind;
  targetSectionId: string | null;
  targetInstrumentId: string | null;
  targetSourceId: string;
  targetSourceRevision: string;
  targetTextVersionId: string | null;
  targetLanguage: string | null;
  targetBodySha256: string | null;
  relation: MirrorRelation | null;
}

export interface SectionDates {
  publication: KnowledgeDate;
  enactment: KnowledgeDate;
  commencement: KnowledgeDate;
  repeal: KnowledgeDate;
}

export interface LawSource {
  schema: typeof LAW_SOURCE_SCHEMA;
  schemaVersion: typeof SCHEMA_VERSION;
  sourceId: string;
  publisherId: string;
  sourceRevision: string;
  sourceUrl: string | null;
  instrumentKind: InstrumentKind;
  scope: ScopeKnowledge;
  nativeLanguages: LanguageKnowledge[];
  license: LicenseKnowledge;
  retrievedAt: KnowledgeDate;
  provenance: Provenance;
  parentSourceId: string | null;
  mirrors: StoredAssociation[];
}

export interface LawSection {
  schema: typeof LAW_SECTION_SCHEMA;
  schemaVersion: typeof SCHEMA_VERSION;
  sectionId: string;
  instrumentId: string;
  textVersionId: string;
  textVersionDerived: boolean;
  sourceId: string;
  publisherId: string;
  sourceRevision: string;
  sourceUrl: string | null;
  sourceType: string | null;
  jsonPath: string | null;
  parentSectionId: string | null;
  parentInstrumentId: string | null;
  instrumentKind: InstrumentKind;
  recordType: SectionRecordType;
  language: LanguageKnowledge;
  title: string | null;
  text: string | null;
  textKnowledge: 'present' | 'empty' | 'unknown';
  bodySha256: string | null;
  contentCid: string | null;
  eli: string | null;
  identifier: string | null;
  officialIdentifier: string | null;
  officialCitation: string | null;
  articleCount: number | null;
  scope: ScopeKnowledge;
  status: LegalRecordStatus;
  statusKnowledge: KnowledgeState;
  dates: SectionDates;
  license: LicenseKnowledge;
  associations: StoredAssociation[];
  provenance: Provenance;
  hierarchy: {
    kind: string;
    number: string | null;
    label: string | null;
    path: string[];
  };
}

export interface QuarantineRecord {
  schema: typeof QUARANTINE_SCHEMA;
  schemaVersion: typeof SCHEMA_VERSION;
  ingestionKey: string;
  reason: QuarantineReason;
  message: string;
  detail: string;
  table: QuarantineTable | null;
  rowIndex: number | null;
  sourceId: string | null;
  sourceRevision: string | null;
  sourceRecordId: string | null;
  field: string | null;
  officialCitation: null;
}

export interface AdmissionResult {
  schemaVersion: typeof SCHEMA_VERSION;
  source: LawSource | null;
  sections: LawSection[];
  quarantined: QuarantineRecord[];
}

export interface ProvenanceInput {
  observedFields?: unknown;
  inferredFields?: unknown;
  unknownFields?: unknown;
  inferenceNotes?: unknown;
  collector?: unknown;
  retrievedAt?: unknown;
  sourceLineage?: unknown;
}

export interface DateInputObject {
  knowledge?: unknown;
  value?: unknown;
  precision?: unknown;
  source?: unknown;
}

export type DateInput = null | string | number | DateInputObject;

export interface AssociationInput {
  kind?: unknown;
  fromSectionId?: unknown;
  targetSectionId?: unknown;
  targetInstrumentId?: unknown;
  targetSourceId?: unknown;
  targetSourceRevision?: unknown;
  targetTextVersionId?: unknown;
  targetLanguage?: unknown;
  targetBodySha256?: unknown;
  relation?: unknown;
}

export interface SectionInput {
  sectionId?: unknown;
  instrumentId?: unknown;
  textVersionId?: unknown;
  sourceUrl?: unknown;
  sourceType?: unknown;
  jsonPath?: unknown;
  parentSectionId?: unknown;
  parentInstrumentId?: unknown;
  parentSourceId?: unknown;
  parentSourceRevision?: unknown;
  publisherId?: unknown;
  sourceRevision?: unknown;
  instrumentKind?: unknown;
  recordType?: unknown;
  language?: unknown;
  title?: unknown;
  text?: unknown;
  textKnowledge?: unknown;
  contentCid?: unknown;
  eli?: unknown;
  identifier?: unknown;
  officialIdentifier?: unknown;
  officialCitation?: unknown;
  articleCount?: unknown;
  issuerIds?: unknown;
  territorialIds?: unknown;
  territorialLabels?: unknown;
  scopeKnowledge?: unknown;
  scopeUncertainty?: unknown;
  status?: unknown;
  dates?: {
    publication?: DateInput;
    enactment?: DateInput;
    commencement?: DateInput;
    repeal?: DateInput;
  };
  license?: unknown;
  attribution?: unknown;
  licenseKnowledge?: unknown;
  amendments?: unknown;
  translations?: unknown;
  mirrors?: unknown;
  associations?: unknown;
  provenance?: ProvenanceInput;
  hierarchy?: {
    kind?: unknown;
    number?: unknown;
    label?: unknown;
    path?: unknown;
  };
  rowIndex?: number;
  table?: SourceTable;
  unmappedColumns?: readonly string[];
  dateConflict?: string | null;
  statusConflict?: string | null;
  languageConflict?: string | null;
}

export interface SourceInput {
  sourceId?: unknown;
  publisherId?: unknown;
  sourceRevision?: unknown;
  sourceUrl?: unknown;
  instrumentKind?: unknown;
  issuerIds?: unknown;
  territorialIds?: unknown;
  territorialLabels?: unknown;
  scopeKnowledge?: unknown;
  scopeUncertainty?: unknown;
  nativeLanguages?: unknown;
  license?: unknown;
  retrievedAt?: DateInput;
  provenance?: ProvenanceInput;
  parentSourceId?: unknown;
  mirrors?: unknown;
}

export interface CorpusInput {
  source?: SourceInput | null;
  laws?: readonly unknown[];
  articles?: readonly unknown[];
  lawColumns?: readonly string[];
  articleColumns?: readonly string[];
  sections?: readonly SectionInput[];
  associations?: readonly AssociationInput[];
}

export class SchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SchemaError';
  }
}

interface Problem {
  reason: QuarantineReason;
  detail: string;
  field: string | null;
}

interface AssocDraft {
  kind: AssociationKind;
  targetSectionId: string | null;
  targetInstrumentId: string | null;
  targetSourceId: string | null;
  targetSourceRevision: string | null;
  targetTextVersionId: string | null;
  targetLanguage: string | null;
  targetBodySha256: string | null;
  relation: MirrorRelation | null;
}

interface Candidate {
  section: LawSection;
  table: SourceTable;
  rowIndex: number | null;
  sourceRecordId: string;
  parentSectionId: string | null;
  parentSourceId: string | null;
  parentSourceRevision: string | null;
  drafts: AssocDraft[];
}

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

function utf8Bytes(text: string): Uint8Array {
  const bytes: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    let code = text.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        index += 1;
      }
    }
    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return Uint8Array.from(bytes);
}

export function sha256Hex(text: string): string {
  const data = utf8Bytes(text);
  const bitLength = data.length * 8;
  const paddedLength = Math.ceil((data.length + 9) / 64) * 64;
  const buffer = new Uint8Array(paddedLength);
  buffer.set(data);
  buffer[data.length] = 0x80;
  const view = new DataView(buffer.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000));
  view.setUint32(paddedLength - 4, bitLength >>> 0);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;
  const words = new Uint32Array(64);

  for (let offset = 0; offset < buffer.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) words[index] = view.getUint32(offset + index * 4);
    for (let index = 16; index < 64; index += 1) {
      const s0 = rotr(words[index - 15], 7) ^ rotr(words[index - 15], 18) ^ (words[index - 15] >>> 3);
      const s1 = rotr(words[index - 2], 17) ^ rotr(words[index - 2], 19) ^ (words[index - 2] >>> 10);
      words[index] = (words[index - 16] + s0 + words[index - 7] + s1) >>> 0;
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;
    for (let index = 0; index < 64; index += 1) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + choice + SHA256_K[index] + words[index]) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7].map((word) => word.toString(16).padStart(8, '0')).join('');
}

export function ingestionKey(material: Readonly<Record<string, string>>): string {
  const payload = Object.keys(material)
    .sort()
    .map((key) => `${key}=${material[key]}`)
    .join('\n');
  return `${INGESTION_KEY_PREFIX}${sha256Hex(payload)}`;
}

function clampDetail(detail: string): string {
  const text = detail.trim();
  return text.length > 500 ? `${text.slice(0, 497)}...` : text;
}

function cleanString(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function problem(reason: QuarantineReason, field: string | null, detail: string): Problem {
  return { reason, field, detail: clampDetail(detail) };
}

function unknownDate(): UnknownDate {
  return { knowledge: 'unknown', value: null, precision: null, source: null };
}

function unknownLanguage(): LanguageKnowledge {
  return { tag: null, knowledge: 'unknown', source: null };
}

function emptyProvenance(): Provenance {
  return {
    observedFields: [],
    inferredFields: [],
    unknownFields: [],
    inferenceNotes: {},
    unmappedColumns: [],
    collector: null,
    retrievedAt: null,
    sourceLineage: null,
  };
}

function revisionProblem(value: string | null): QuarantineReason | null {
  if (!value) return 'missing-source-revision';
  const folded = value.toLowerCase();
  if (FLOATING_REVISIONS.has(folded) || /(?:^|\/)(?:head|main|master|latest)$/i.test(value) || /^refs\//i.test(value)) {
    return 'unpinned-source-revision';
  }
  if (/^[A-Fa-f0-9]{40}$/.test(value) || /^[A-Fa-f0-9]{64}$/.test(value)) return null;
  if (/^[A-Za-z0-9._:+/-]{12,128}$/.test(value)) return null;
  return 'invalid-source-revision';
}

function readStringList(value: unknown, field: string): { ok: true; values: string[] } | { ok: false; detail: string } {
  if (value === undefined || value === null) return { ok: true, values: [] };
  if (typeof value === 'string' || typeof value === 'number') {
    const one = cleanString(value);
    return { ok: true, values: one ? [one] : [] };
  }
  if (!Array.isArray(value)) return { ok: false, detail: `${field} must be a list of strings.` };
  const values: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' && typeof item !== 'number') {
      return { ok: false, detail: `${field} contains a non-string entry.` };
    }
    const text = cleanString(item);
    if (text && !values.includes(text)) values.push(text);
  }
  return { ok: true, values };
}

function isPrecision(value: string): value is DatePrecision {
  return value === 'day' || value === 'month' || value === 'year';
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function calendarOk(value: string, precision: DatePrecision): boolean {
  const parts = value.split('-').map((part) => Number(part));
  const year = parts[0];
  if (!Number.isInteger(year) || year < 1 || year > 9999) return false;
  if (precision === 'year') return /^\d{4}$/.test(value);
  const month = parts[1];
  if (!Number.isInteger(month) || month < 1 || month > 12) return false;
  if (precision === 'month') return /^\d{4}-\d{2}$/.test(value);
  const day = parts[2];
  const lengths = [0, 31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isInteger(day) && day >= 1 && day <= lengths[month];
}

function precisionOf(value: string): DatePrecision | null {
  if (/^\d{4}$/.test(value)) return 'year';
  if (/^\d{4}-\d{2}$/.test(value)) return 'month';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'day';
  return null;
}

function parseDate(input: DateInput | undefined, field: string, observedSource: string | null):
  | { ok: true; date: KnowledgeDate }
  | { ok: false; reason: QuarantineReason; detail: string } {
  if (input === undefined || input === null || input === '') {
    return { ok: true, date: unknownDate() };
  }
  if (typeof input === 'string' || typeof input === 'number') {
    const value = String(input).trim();
    if (!value) return { ok: true, date: unknownDate() };
    const precision = precisionOf(value);
    if (!precision || !calendarOk(value, precision)) {
      return {
        ok: false,
        reason: 'date-precision-mismatch',
        detail: `${field} value ${JSON.stringify(value)} is not a real year, month, or day.`,
      };
    }
    return {
      ok: true,
      date: { knowledge: 'known', value, precision, source: observedSource ?? field },
    };
  }
  if (typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, reason: 'date-precision-mismatch', detail: `${field} is not a date string or date object.` };
  }
  const knowledge = input.knowledge;
  const source = typeof input.source === 'string' ? input.source.trim() : '';
  const rawValue = input.value;
  const hasValue = rawValue !== undefined && rawValue !== null && String(rawValue).trim() !== '';
  if (knowledge === undefined || knowledge === null || knowledge === '') {
    if (!hasValue) return { ok: true, date: unknownDate() };
    return {
      ok: false,
      reason: 'date-knowledge-missing',
      detail: `${field} has a value without known, inferred, or unknown status.`,
    };
  }
  if (knowledge === 'unknown') {
    const precisionPresent = input.precision !== undefined && input.precision !== null && input.precision !== '';
    if (hasValue || precisionPresent) {
      return {
        ok: false,
        reason: 'unknown-date-has-value',
        detail: `${field} is marked unknown but still carries a value or precision.`,
      };
    }
    return { ok: true, date: { knowledge: 'unknown', value: null, precision: null, source: source || null } };
  }
  if (knowledge !== 'known' && knowledge !== 'inferred') {
    return {
      ok: false,
      reason: 'date-knowledge-missing',
      detail: `${field} knowledge ${JSON.stringify(knowledge)} is not known, inferred, or unknown.`,
    };
  }
  if (!hasValue) {
    return { ok: false, reason: 'known-date-missing-value', detail: `${field} is ${knowledge} but has no value.` };
  }
  const value = String(rawValue).trim();
  if (typeof input.precision !== 'string' || !isPrecision(input.precision)) {
    return { ok: false, reason: 'date-precision-mismatch', detail: `${field} precision is missing or not day, month, or year.` };
  }
  if (precisionOf(value) !== input.precision || !calendarOk(value, input.precision)) {
    return {
      ok: false,
      reason: 'date-precision-mismatch',
      detail: `${field} value ${JSON.stringify(value)} does not match precision ${input.precision}.`,
    };
  }
  if (!source) {
    return {
      ok: false,
      reason: knowledge === 'inferred' ? 'inferred-date-without-source' : 'known-date-without-source',
      detail: `${field} is ${knowledge} without a source.`,
    };
  }
  return { ok: true, date: { knowledge, value, precision: input.precision, source } };
}

function parseLanguage(input: unknown, sourceLabel: string):
  | { ok: true; language: LanguageKnowledge }
  | { ok: false; reason: QuarantineReason; detail: string } {
  if (input === undefined || input === null || input === '') return { ok: true, language: unknownLanguage() };
  if (typeof input === 'string' || typeof input === 'number') {
    const tag = String(input).trim();
    if (!tag) return { ok: true, language: unknownLanguage() };
    if (!LANGUAGE_TAG.test(tag)) {
      return { ok: false, reason: 'invalid-language-tag', detail: `Language tag ${JSON.stringify(tag)} is not a BCP 47 tag.` };
    }
    return { ok: true, language: { tag, knowledge: 'known', source: sourceLabel } };
  }
  if (typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, reason: 'invalid-language-tag', detail: 'Language is not a string or language object.' };
  }
  const record = input as Record<string, unknown>;
  const knowledge = record.knowledge;
  const tagRaw = record.tag;
  const source = cleanString(record.source);
  if (knowledge === 'unknown') {
    if (tagRaw !== undefined && tagRaw !== null && String(tagRaw).trim() !== '') {
      return {
        ok: false,
        reason: 'unknown-language-has-tag',
        detail: `Unknown language also has tag ${JSON.stringify(tagRaw)}.`,
      };
    }
    return { ok: true, language: { tag: null, knowledge: 'unknown', source } };
  }
  if (knowledge !== undefined && knowledge !== 'known' && knowledge !== 'inferred') {
    return {
      ok: false,
      reason: 'invalid-language-tag',
      detail: `Language knowledge ${JSON.stringify(knowledge)} is not known, inferred, or unknown.`,
    };
  }
  if ((tagRaw === undefined || tagRaw === null || String(tagRaw).trim() === '') && knowledge === undefined) {
    return { ok: false, reason: 'language-unspecified', detail: 'Language object has neither a tag nor unknown status.' };
  }
  const tag = typeof tagRaw === 'string' ? tagRaw.trim() : '';
  if (!LANGUAGE_TAG.test(tag)) {
    return { ok: false, reason: 'invalid-language-tag', detail: `Language tag ${JSON.stringify(tagRaw)} is not a BCP 47 tag.` };
  }
  const resolved = knowledge === 'inferred' ? 'inferred' : 'known';
  if (resolved === 'inferred' && !source) {
    return { ok: false, reason: 'inferred-field-without-reason', detail: 'Inferred language has no source note.' };
  }
  return { ok: true, language: { tag, knowledge: resolved, source: source ?? sourceLabel } };
}

function parseStatus(input: unknown):
  | { ok: true; status: LegalRecordStatus; knowledge: KnowledgeState; note: string | null }
  | { ok: false; reason: QuarantineReason; detail: string } {
  if (input === undefined || input === null || input === '') {
    return { ok: true, status: 'unknown', knowledge: 'unknown', note: null };
  }
  if (typeof input === 'string' || typeof input === 'number') {
    const value = String(input).trim().toLowerCase();
    if ((SECTION_STATUSES as readonly string[]).includes(value)) {
      const status = value as LegalRecordStatus;
      return { ok: true, status, knowledge: status === 'unknown' ? 'unknown' : 'known', note: null };
    }
    return {
      ok: false,
      reason: 'invalid-status',
      detail: `Status ${JSON.stringify(input)} is not current, historical, repealed, superseded, or unknown.`,
    };
  }
  if (typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, reason: 'invalid-status', detail: 'Status is not a string or status object.' };
  }
  const record = input as Record<string, unknown>;
  const knowledge = record.knowledge;
  const rawValue = record.value;
  if (knowledge === 'unknown') {
    if (rawValue !== undefined && rawValue !== null && String(rawValue).trim() !== '' && String(rawValue).trim().toLowerCase() !== 'unknown') {
      return { ok: false, reason: 'invalid-status', detail: 'Status is marked unknown but carries another value.' };
    }
    return { ok: true, status: 'unknown', knowledge: 'unknown', note: null };
  }
  if (typeof rawValue !== 'string' || !(SECTION_STATUSES as readonly string[]).includes(rawValue.trim().toLowerCase())) {
    return { ok: false, reason: 'invalid-status', detail: `Status ${JSON.stringify(rawValue)} is not an allowed status.` };
  }
  const status = rawValue.trim().toLowerCase() as LegalRecordStatus;
  if (knowledge === 'inferred') {
    const note = cleanString(record.source);
    if (!note) return { ok: false, reason: 'inferred-field-without-reason', detail: 'Inferred status has no source note.' };
    return { ok: true, status, knowledge: 'inferred', note };
  }
  if (knowledge !== undefined && knowledge !== 'known') {
    return { ok: false, reason: 'invalid-status', detail: `Status knowledge ${JSON.stringify(knowledge)} is not known, inferred, or unknown.` };
  }
  return { ok: true, status, knowledge: status === 'unknown' ? 'unknown' : 'known', note: null };
}

function parseScope(input: {
  issuerIds?: unknown;
  territorialIds?: unknown;
  territorialLabels?: unknown;
  knowledge?: unknown;
  uncertainty?: unknown;
}): { ok: true; scope: ScopeKnowledge } | { ok: false; reason: QuarantineReason; detail: string } {
  const issuerIds = readStringList(input.issuerIds, 'issuerIds');
  const territorialIds = readStringList(input.territorialIds, 'territorialIds');
  const territorialLabels = readStringList(input.territorialLabels, 'territorialLabels');
  const uncertainty = readStringList(input.uncertainty, 'uncertainty');
  if (!issuerIds.ok || !territorialIds.ok || !territorialLabels.ok || !uncertainty.ok) {
    const detail = !issuerIds.ok
      ? issuerIds.detail
      : !territorialIds.ok
        ? territorialIds.detail
        : !territorialLabels.ok
          ? territorialLabels.detail
          : uncertainty.ok
            ? 'Scope is not usable.'
            : uncertainty.detail;
    return { ok: false, reason: 'invalid-scope', detail };
  }
  const populated = issuerIds.values.length + territorialIds.values.length + territorialLabels.values.length > 0;
  let knowledge = input.knowledge;
  if (knowledge === undefined || knowledge === null || knowledge === '') knowledge = populated ? 'known' : 'unknown';
  if (knowledge !== 'known' && knowledge !== 'unknown' && knowledge !== 'inferred') {
    return { ok: false, reason: 'invalid-scope', detail: `Scope knowledge ${JSON.stringify(knowledge)} is not known, inferred, or unknown.` };
  }
  if (knowledge === 'unknown' && populated) {
    return { ok: false, reason: 'unknown-scope-has-ids', detail: 'Scope is marked unknown but an issuer, territory, or label is present.' };
  }
  if ((knowledge === 'known' || knowledge === 'inferred') && !populated) {
    return { ok: false, reason: 'issuer-scope-empty-unmarked', detail: `Scope is marked ${knowledge} but issuer, territory, and labels are empty.` };
  }
  return {
    ok: true,
    scope: {
      issuerIds: issuerIds.values,
      territorialIds: territorialIds.values,
      territorialLabels: territorialLabels.values,
      knowledge,
      uncertainty: uncertainty.values,
    },
  };
}

function parseUrl(input: unknown): { ok: true; url: string | null } | { ok: false; detail: string } {
  const text = input === undefined || input === null ? '' : typeof input === 'string' ? input.trim() : null;
  if (text === null) return { ok: false, detail: 'Source URL is not a string.' };
  if (!text) return { ok: true, url: null };
  try {
    const url = new URL(text);
    if (url.protocol !== 'http:' && url.protocol !== 'https:' && url.protocol !== 'ipfs:') {
      return { ok: false, detail: `Source URL protocol ${url.protocol} is not http, https, or ipfs.` };
    }
    return { ok: true, url: text };
  } catch {
    return { ok: false, detail: `Source URL ${JSON.stringify(text)} is not absolute.` };
  }
}

function parseCid(input: unknown): { ok: true; cid: string | null } | { ok: false; detail: string } {
  if (input === undefined || input === null || input === '') return { ok: true, cid: null };
  if (typeof input !== 'string') return { ok: false, detail: 'Content CID is not a string.' };
  const cid = input.trim().replace(/^ipfs:\/\//i, '');
  if (!cid) return { ok: true, cid: null };
  if (!/^[A-Za-z0-9]{10,128}$/.test(cid)) return { ok: false, detail: `Content CID ${JSON.stringify(input)} is not a bare CID token.` };
  return { ok: true, cid };
}

function parseCitation(input: unknown): { ok: true; citation: string | null } | { ok: false; reason: QuarantineReason; detail: string } {
  if (input === undefined || input === null || input === '') return { ok: true, citation: null };
  if (typeof input !== 'string' && typeof input !== 'number') {
    return { ok: false, reason: 'invalid-citation', detail: 'Official citation is not a string.' };
  }
  const citation = String(input).trim();
  if (!citation) return { ok: true, citation: null };
  if (INGESTION_KEY_PATTERN.test(citation)) {
    return {
      ok: false,
      reason: 'ingestion-key-used-as-citation',
      detail: 'Official citation matches an ingestion key. The key was not accepted as a citation.',
    };
  }
  return { ok: true, citation };
}

function parseInstrumentKind(input: unknown): { ok: true; kind: InstrumentKind; explicit: boolean } | { ok: false; detail: string } {
  if (input === undefined || input === null || input === '') return { ok: true, kind: 'unknown', explicit: false };
  const kind = typeof input === 'string' ? input.trim().toLowerCase() : '';
  if ((INSTRUMENT_KINDS as readonly string[]).includes(kind)) return { ok: true, kind: kind as InstrumentKind, explicit: true };
  return { ok: false, detail: `Instrument kind ${JSON.stringify(input)} is outside the versioned vocabulary.` };
}

function parseRecordType(input: unknown, fallback: SectionRecordType): { ok: true; recordType: SectionRecordType; explicit: boolean } | { ok: false; detail: string } {
  if (input === undefined || input === null || input === '') return { ok: true, recordType: fallback, explicit: false };
  const recordType = typeof input === 'string' ? input.trim().toLowerCase() : '';
  if ((SECTION_RECORD_TYPES as readonly string[]).includes(recordType)) {
    return { ok: true, recordType: recordType as SectionRecordType, explicit: true };
  }
  return { ok: false, detail: `Record type ${JSON.stringify(input)} is not law, article, section, or notice.` };
}

function parseText(input: unknown, knowledge: unknown):
  | { ok: true; text: string | null; textKnowledge: 'present' | 'empty' | 'unknown'; hash: string | null }
  | { ok: false; reason: QuarantineReason; detail: string } {
  if (knowledge === 'unknown') {
    if (input !== undefined && input !== null && input !== '') {
      return { ok: false, reason: 'unknown-text-has-value', detail: 'Text is marked unknown but a value is present.' };
    }
    return { ok: true, text: null, textKnowledge: 'unknown', hash: null };
  }
  if (input === undefined || input === null) return { ok: true, text: null, textKnowledge: 'unknown', hash: null };
  if (typeof input !== 'string' && typeof input !== 'number') {
    return { ok: false, reason: 'invalid-text', detail: 'Text is not a string or number.' };
  }
  const text = String(input);
  if (knowledge === 'empty' && text !== '') {
    return { ok: false, reason: 'invalid-text', detail: 'Text is marked empty but a value is present.' };
  }
  if (knowledge === 'present' && text === '') {
    return { ok: false, reason: 'invalid-text', detail: 'Text is marked present but is empty.' };
  }
  if (knowledge !== undefined && knowledge !== 'present' && knowledge !== 'empty') {
    return { ok: false, reason: 'invalid-text', detail: `Text knowledge ${JSON.stringify(knowledge)} is not present, empty, or unknown.` };
  }
  if (text === '') return { ok: true, text: '', textKnowledge: 'empty', hash: sha256Hex('') };
  return { ok: true, text, textKnowledge: 'present', hash: sha256Hex(text) };
}

function parseArticleCount(input: unknown): { ok: true; count: number | null } | { ok: false; detail: string } {
  if (input === undefined || input === null || input === '') return { ok: true, count: null };
  const count = typeof input === 'number' ? input : typeof input === 'string' && /^-?\d+$/.test(input.trim()) ? Number(input.trim()) : Number.NaN;
  if (!Number.isInteger(count) || count < 0) return { ok: false, detail: `Article count ${JSON.stringify(input)} is not a non-negative integer.` };
  return { ok: true, count };
}

function parsePath(input: unknown): { ok: true; path: string[] } | { ok: false; detail: string } {
  if (input === undefined || input === null || input === '') return { ok: true, path: [] };
  if (typeof input === 'string') {
    const text = input.trim();
    return { ok: true, path: text ? [text] : [] };
  }
  if (!Array.isArray(input) || input.some((item) => typeof item !== 'string')) {
    return { ok: false, detail: 'Hierarchy path is not a string or a list of strings.' };
  }
  return { ok: true, path: input.map((item) => item.trim()).filter(Boolean) };
}

function parseLicense(expressionInput: unknown, attributionInput: unknown, knowledgeInput: unknown):
  | { ok: true; license: LicenseKnowledge; note: string | null }
  | { ok: false; reason: QuarantineReason; detail: string } {
  if (expressionInput && typeof expressionInput === 'object' && !Array.isArray(expressionInput) && attributionInput === undefined) {
    const record = expressionInput as Record<string, unknown>;
    return parseLicense(record.expression, record.attribution, record.knowledge ?? knowledgeInput);
  }
  const expression = cleanString(expressionInput);
  const attribution = cleanString(attributionInput);
  const populated = Boolean(expression || attribution);
  let knowledge = knowledgeInput;
  if (knowledge === undefined || knowledge === null || knowledge === '') knowledge = populated ? 'known' : 'unknown';
  if (knowledge !== 'known' && knowledge !== 'unknown' && knowledge !== 'inferred') {
    return { ok: false, reason: 'invalid-association-kind', detail: `License knowledge ${JSON.stringify(knowledge)} is not known, inferred, or unknown.` };
  }
  if (knowledge === 'unknown' && populated) {
    return { ok: false, reason: 'unknown-license-has-expression', detail: 'License is marked unknown but an expression or attribution is present.' };
  }
  if (knowledge === 'inferred' && !populated) {
    return { ok: false, reason: 'inferred-field-without-reason', detail: 'Inferred license has no expression or attribution.' };
  }
  return {
    ok: true,
    license: { expression, attribution, knowledge },
    note: knowledge === 'inferred' ? expression ?? attribution : null,
  };
}

function isBefore(left: KnowledgeDate, right: KnowledgeDate): boolean {
  if (left.knowledge === 'unknown' || right.knowledge === 'unknown') return false;
  const precision: DatePrecision = left.precision === 'year' || right.precision === 'year'
    ? 'year'
    : left.precision === 'month' || right.precision === 'month'
      ? 'month'
      : 'day';
  const width = precision === 'year' ? 4 : precision === 'month' ? 7 : 10;
  return left.value.slice(0, width) < right.value.slice(0, width);
}

function makeQuarantine(
  item: Problem,
  place: {
    table: QuarantineTable | null;
    rowIndex: number | null;
    sourceId: string | null;
    sourceRevision: string | null;
    sourceRecordId: string | null;
  },
): QuarantineRecord {
  return {
    schema: QUARANTINE_SCHEMA,
    schemaVersion: SCHEMA_VERSION,
    ingestionKey: ingestionKey({
      detail: item.detail,
      field: item.field ?? '',
      reason: item.reason,
      rowIndex: place.rowIndex === null ? '' : String(place.rowIndex),
      schema: QUARANTINE_SCHEMA,
      sourceId: place.sourceId ?? '',
      sourceRecordId: place.sourceRecordId ?? '',
      sourceRevision: place.sourceRevision ?? '',
      table: place.table ?? '',
    }),
    reason: item.reason,
    message: QUARANTINE_REASONS[item.reason],
    detail: item.detail,
    table: place.table,
    rowIndex: place.rowIndex,
    sourceId: place.sourceId,
    sourceRevision: place.sourceRevision,
    sourceRecordId: place.sourceRecordId,
    field: item.field,
    officialCitation: null,
  };
}

function tableRank(table: QuarantineTable | null): number {
  if (table === 'source') return 0;
  if (table === 'laws') return 1;
  if (table === 'articles') return 2;
  if (table === 'section') return 3;
  if (table === 'associations') return 4;
  return 5;
}

function sortQuarantines(records: QuarantineRecord[]): QuarantineRecord[] {
  return [...records].sort((left, right) => {
    const table = tableRank(left.table) - tableRank(right.table);
    if (table) return table;
    const row = (left.rowIndex ?? -1) - (right.rowIndex ?? -1);
    if (row) return row;
    if (left.reason !== right.reason) return left.reason < right.reason ? -1 : 1;
    return (left.field ?? '').localeCompare(right.field ?? '');
  });
}

function readNotes(value: unknown): { ok: true; notes: Record<string, string> } | { ok: false; detail: string } {
  if (value === undefined || value === null) return { ok: true, notes: {} };
  if (typeof value !== 'object' || Array.isArray(value)) return { ok: false, detail: 'inferenceNotes is not an object.' };
  const notes: Record<string, string> = {};
  for (const [key, note] of Object.entries(value)) {
    if (typeof note !== 'string' || !note.trim()) return { ok: false, detail: `inferenceNotes.${key} is empty.` };
    notes[key] = note.trim();
  }
  return { ok: true, notes };
}

function finishProvenance(
  input: ProvenanceInput | undefined,
  observed: string[],
  inferred: string[],
  unknown: string[],
  notes: Record<string, string>,
  unmappedColumns: readonly string[],
): { ok: true; provenance: Provenance } | { ok: false; problems: Problem[] } {
  const problems: Problem[] = [];
  const callerObserved = readStringList(input?.observedFields, 'observedFields');
  const callerInferred = readStringList(input?.inferredFields, 'inferredFields');
  const callerUnknown = readStringList(input?.unknownFields, 'unknownFields');
  const callerNotes = readNotes(input?.inferenceNotes);
  if (!callerObserved.ok) problems.push(problem('conflicting-provenance', 'observedFields', callerObserved.detail));
  if (!callerInferred.ok) problems.push(problem('conflicting-provenance', 'inferredFields', callerInferred.detail));
  if (!callerUnknown.ok) problems.push(problem('conflicting-provenance', 'unknownFields', callerUnknown.detail));
  if (!callerNotes.ok) problems.push(problem('conflicting-provenance', 'inferenceNotes', callerNotes.detail));
  if (problems.length) return { ok: false, problems };

  const observedFields = uniqueSorted([...observed, ...(callerObserved.ok ? callerObserved.values : [])]);
  const inferredFields = uniqueSorted([...inferred, ...(callerInferred.ok ? callerInferred.values : [])]);
  const unknownFields = uniqueSorted([...unknown, ...(callerUnknown.ok ? callerUnknown.values : [])]);
  const inferenceNotes = { ...(callerNotes.ok ? callerNotes.notes : {}), ...notes };
  for (const field of inferredFields) {
    const parserNote = notes[field];
    const callerNote = callerNotes.ok ? callerNotes.notes[field] : undefined;
    if (parserNote && callerNote && parserNote !== callerNote) {
      problems.push(problem('conflicting-provenance', field, `Provenance notes for ${field} disagree.`));
    }
    if (!inferenceNotes[field]) {
      problems.push(problem('inferred-field-without-reason', field, `Inferred field ${field} has no provenance note.`));
    }
  }
  for (const field of observedFields) {
    if (unknownFields.includes(field)) {
      problems.push(problem('field-both-observed-and-unknown', field, `Field ${field} is marked both observed and unknown.`));
    }
    if (inferredFields.includes(field)) {
      problems.push(problem('field-both-observed-and-inferred', field, `Field ${field} is marked both observed and inferred.`));
    }
  }
  for (const field of inferredFields) {
    if (unknownFields.includes(field)) {
      problems.push(problem('field-both-inferred-and-unknown', field, `Field ${field} is marked both inferred and unknown.`));
    }
  }
  if (problems.length) return { ok: false, problems };
  const keptNotes: Record<string, string> = {};
  for (const field of inferredFields) keptNotes[field] = inferenceNotes[field];
  return {
    ok: true,
    provenance: {
      observedFields,
      inferredFields,
      unknownFields,
      inferenceNotes: keptNotes,
      unmappedColumns: [...unmappedColumns],
      collector: cleanString(input?.collector),
      retrievedAt: cleanString(input?.retrievedAt),
      sourceLineage: cleanString(input?.sourceLineage),
    },
  };
}

function parseAssociation(raw: unknown, ownerSectionId: string | null): { ok: true; draft: AssocDraft } | { ok: false; problem: Problem } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, problem: problem('invalid-association-kind', 'association', 'Association is not an object.') };
  }
  const record = raw as AssociationInput;
  if (typeof record.kind !== 'string' || !(ASSOCIATION_KINDS as readonly string[]).includes(record.kind)) {
    return {
      ok: false,
      problem: problem('invalid-association-kind', 'kind', `Association kind ${JSON.stringify(record.kind)} is not supported.`),
    };
  }
  const kind = record.kind as AssociationKind;
  const targetSectionId = cleanString(record.targetSectionId);
  const targetInstrumentId = cleanString(record.targetInstrumentId);
  const targetSourceId = cleanString(record.targetSourceId);
  const targetSourceRevision = cleanString(record.targetSourceRevision);
  const targetTextVersionId = cleanString(record.targetTextVersionId);
  const targetLanguage = cleanString(record.targetLanguage);
  const targetBodySha256 = cleanString(record.targetBodySha256);
  const relationText = cleanString(record.relation);
  let relation: MirrorRelation | null = null;
  if (relationText) {
    if (!(MIRROR_RELATIONS as readonly string[]).includes(relationText)) {
      return { ok: false, problem: problem('mirror-relation-missing', 'relation', `Mirror relation ${JSON.stringify(relationText)} is not equivalent-text or conflicting-version.`) };
    }
    relation = relationText as MirrorRelation;
  }
  if (kind === 'amendment-of') {
    if (!targetSectionId) return { ok: false, problem: problem('association-target-missing', 'targetSectionId', 'Amendment association has no target section id.') };
    if (ownerSectionId && targetSectionId === ownerSectionId) {
      return { ok: false, problem: problem('amendment-targets-self', 'targetSectionId', `Amendment target ${targetSectionId} is the same section.`) };
    }
  }
  if (kind === 'parent-section') {
    if (!targetSectionId) return { ok: false, problem: problem('association-target-missing', 'targetSectionId', 'Parent section association has no target section id.') };
    if (ownerSectionId && targetSectionId === ownerSectionId) {
      return { ok: false, problem: problem('parent-is-self', 'parentSectionId', `Section ${ownerSectionId} names itself as its parent.`) };
    }
  }
  if (kind === 'parent-instrument' && !targetInstrumentId && !targetSectionId) {
    return { ok: false, problem: problem('association-target-missing', 'targetInstrumentId', 'Parent instrument association has no target.') };
  }
  if (kind === 'issued-by' && !targetSectionId && !targetInstrumentId) {
    return { ok: false, problem: problem('association-target-missing', 'targetSectionId', 'issued-by association has no issuer id.') };
  }
  if (kind === 'translation-of') {
    if (!targetSectionId && !targetInstrumentId) {
      return { ok: false, problem: problem('association-target-missing', 'targetSectionId', 'Translation association has no target.') };
    }
    if (!targetLanguage) {
      return { ok: false, problem: problem('translation-target-language-missing', 'targetLanguage', 'Translation association does not name the other language.') };
    }
    if (!LANGUAGE_TAG.test(targetLanguage)) {
      return { ok: false, problem: problem('invalid-language-tag', 'targetLanguage', `Translation target language ${JSON.stringify(targetLanguage)} is not a BCP 47 tag.`) };
    }
  }
  if (kind === 'equivalent-text') relation = 'equivalent-text';
  if (kind === 'mirror-of' && !relation) {
    return { ok: false, problem: problem('mirror-relation-missing', 'relation', 'Mirror association does not say whether the text is equivalent or conflicting.') };
  }
  if ((kind === 'mirror-of' || kind === 'equivalent-text') && (!targetSourceId || !targetSourceRevision)) {
    return { ok: false, problem: problem('mirror-drops-provenance', 'targetSourceId', 'Mirror link omits the other source id or pinned revision.') };
  }
  if (targetSourceRevision) {
    const revision = revisionProblem(targetSourceRevision);
    if (revision) return { ok: false, problem: problem(revision, 'targetSourceRevision', `Target revision ${JSON.stringify(targetSourceRevision)} is not pinned.`) };
  }
  return {
    ok: true,
    draft: {
      kind,
      targetSectionId,
      targetInstrumentId,
      targetSourceId,
      targetSourceRevision,
      targetTextVersionId,
      targetLanguage,
      targetBodySha256,
      relation,
    },
  };
}

function collectDrafts(rawLists: unknown[], ownerSectionId: string | null): { drafts: AssocDraft[]; problems: Problem[] } {
  const drafts: AssocDraft[] = [];
  const problems: Problem[] = [];
  for (const raw of rawLists) {
    if (raw === undefined || raw === null) continue;
    if (!Array.isArray(raw)) {
      problems.push(problem('invalid-association-kind', 'associations', 'Associations must be a list.'));
      continue;
    }
    for (const item of raw) {
      const parsed = parseAssociation(item, ownerSectionId);
      if (!parsed.ok) problems.push(parsed.problem);
      else drafts.push(parsed.draft);
    }
  }
  return { drafts, problems };
}

function parseSource(input: SourceInput | null | undefined): { ok: true; source: LawSource } | { ok: false; quarantined: QuarantineRecord[] } {
  const problems: Problem[] = [];
  const record = input && typeof input === 'object' && !Array.isArray(input) ? input : null;
  if (!record) {
    problems.push(problem('missing-source-id', 'source', 'Source envelope is missing. No source identity was invented.'));
  }
  const sourceId = cleanString(record?.sourceId);
  const publisherId = cleanString(record?.publisherId);
  const sourceRevision = cleanString(record?.sourceRevision);
  if (record && !sourceId) problems.push(problem('missing-source-id', 'sourceId', 'sourceId is blank. No source identity was invented.'));
  if (record && !publisherId) problems.push(problem('missing-publisher-id', 'publisherId', 'publisherId is blank. No publisher identity was invented.'));
  const revisionIssue = record ? revisionProblem(sourceRevision) : null;
  if (revisionIssue) {
    problems.push(problem(revisionIssue, 'sourceRevision', `sourceRevision ${JSON.stringify(record?.sourceRevision ?? null)} cannot pin the source.`));
  }
  const sourceUrl = parseUrl(record?.sourceUrl);
  if (!sourceUrl.ok) problems.push(problem('invalid-source-url', 'sourceUrl', sourceUrl.detail));
  const instrumentKind = parseInstrumentKind(record?.instrumentKind);
  if (!instrumentKind.ok) problems.push(problem('invalid-instrument-kind', 'instrumentKind', instrumentKind.detail));
  const scope = parseScope({
    issuerIds: record?.issuerIds,
    territorialIds: record?.territorialIds,
    territorialLabels: record?.territorialLabels,
    knowledge: record?.scopeKnowledge,
    uncertainty: record?.scopeUncertainty,
  });
  if (!scope.ok) problems.push(problem(scope.reason, 'scope', scope.detail));
  const languages: LanguageKnowledge[] = [];
  const languageInputs = record?.nativeLanguages;
  if (languageInputs === undefined || languageInputs === null) languages.push(unknownLanguage());
  else if (!Array.isArray(languageInputs)) {
    problems.push(problem('invalid-language-tag', 'nativeLanguages', 'nativeLanguages is not a list.'));
  } else if (languageInputs.length === 0) languages.push(unknownLanguage());
  else {
    languageInputs.forEach((item, index) => {
      const parsed = parseLanguage(item, 'source.nativeLanguages');
      if (!parsed.ok) problems.push(problem(parsed.reason, `nativeLanguages[${index}]`, parsed.detail));
      else languages.push(parsed.language);
    });
  }
  const license = parseLicense(record?.license, undefined, undefined);
  if (!license.ok) problems.push(problem(license.reason, 'license', license.detail));
  const retrievedAt = parseDate(record?.retrievedAt, 'retrievedAt', 'source.retrievedAt');
  if (!retrievedAt.ok) problems.push(problem(retrievedAt.reason, 'retrievedAt', retrievedAt.detail));
  const parentSourceId = cleanString(record?.parentSourceId);
  if (parentSourceId && sourceId && parentSourceId === sourceId) {
    problems.push(problem('parent-is-self', 'parentSourceId', `Source ${sourceId} names itself as its parent.`));
  }
  const mirrorDrafts = collectDrafts([record?.mirrors], null);
  problems.push(...mirrorDrafts.problems);
  const mirrors: StoredAssociation[] = [];
  if (sourceId && sourceRevision && !revisionIssue) {
    for (const draft of mirrorDrafts.drafts) {
      if (draft.kind !== 'mirror-of' && draft.kind !== 'equivalent-text') {
        problems.push(problem('invalid-association-kind', 'mirrors', `Source mirror kind ${draft.kind} is not a source mirror.`));
        continue;
      }
      if (!draft.targetSourceId || !draft.targetSourceRevision) {
        problems.push(problem('mirror-drops-provenance', 'mirrors', 'Source mirror omits the other source id or pinned revision.'));
        continue;
      }
      if (!draft.relation) {
        problems.push(problem('mirror-relation-missing', 'mirrors', 'Source mirror does not say whether it is a conflicting version.'));
        continue;
      }
      if (draft.targetSourceId === sourceId && draft.targetSourceRevision === sourceRevision) {
        problems.push(problem('mirror-targets-self', 'mirrors', `Source mirror points at ${sourceId}@${sourceRevision}.`));
        continue;
      }
      if (draft.relation === 'equivalent-text' || draft.kind === 'equivalent-text') {
        problems.push(problem('equivalent-text-hash-mismatch', 'mirrors', 'A source mirror cannot claim equivalent text without a section body hash.'));
        continue;
      }
      mirrors.push({
        kind: 'mirror-of',
        targetSectionId: draft.targetSectionId,
        targetInstrumentId: draft.targetInstrumentId,
        targetSourceId: draft.targetSourceId,
        targetSourceRevision: draft.targetSourceRevision,
        targetTextVersionId: draft.targetTextVersionId,
        targetLanguage: draft.targetLanguage,
        targetBodySha256: draft.targetBodySha256,
        relation: draft.relation,
      });
    }
  }

  const observed: string[] = [];
  const inferred: string[] = [];
  const unknown: string[] = [];
  const notes: Record<string, string> = {};
  if (sourceId) observed.push('sourceId');
  if (publisherId) observed.push('publisherId');
  if (sourceRevision && !revisionIssue) observed.push('sourceRevision');
  if (sourceUrl.ok && sourceUrl.url) observed.push('sourceUrl');
  if (instrumentKind.ok && instrumentKind.explicit) observed.push('instrumentKind');
  if (instrumentKind.ok && !instrumentKind.explicit) unknown.push('instrumentKind');
  if (scope.ok) {
    if (scope.scope.knowledge === 'unknown') unknown.push('scope');
    else if (scope.scope.knowledge === 'inferred') {
      inferred.push('scope');
      notes.scope = 'Caller marked issuer or territorial scope as inferred.';
    } else observed.push('scope');
  }
  if (languages.some((item) => item.knowledge === 'known')) observed.push('nativeLanguages');
  if (languages.every((item) => item.knowledge === 'unknown')) unknown.push('nativeLanguages');
  if (languages.some((item) => item.knowledge === 'inferred')) {
    inferred.push('nativeLanguages');
    notes.nativeLanguages = languages.find((item) => item.source)?.source ?? 'Inferred native language.';
  }
  if (license.ok) {
    if (license.license.knowledge === 'unknown') unknown.push('license');
    else if (license.license.knowledge === 'inferred') {
      inferred.push('license');
      notes.license = license.note ?? 'Inferred license.';
    } else observed.push('license');
  }
  if (retrievedAt.ok) {
    if (retrievedAt.date.knowledge === 'unknown') unknown.push('retrievedAt');
    else if (retrievedAt.date.knowledge === 'inferred') {
      inferred.push('retrievedAt');
      notes.retrievedAt = retrievedAt.date.source;
    } else observed.push('retrievedAt');
  }
  const provenance = finishProvenance(record?.provenance, observed, inferred, unknown, notes, []);
  if (!provenance.ok) problems.push(...provenance.problems);

  const place = {
    table: 'source' as const,
    rowIndex: null,
    sourceId,
    sourceRevision,
    sourceRecordId: null,
  };
  if (problems.length || !sourceId || !publisherId || !sourceRevision || revisionIssue || !sourceUrl.ok || !instrumentKind.ok || !scope.ok || !license.ok || !retrievedAt.ok || !provenance.ok) {
    return { ok: false, quarantined: problems.map((item) => makeQuarantine(item, place)) };
  }
  return {
    ok: true,
    source: {
      schema: LAW_SOURCE_SCHEMA,
      schemaVersion: SCHEMA_VERSION,
      sourceId,
      publisherId,
      sourceRevision,
      sourceUrl: sourceUrl.url,
      instrumentKind: instrumentKind.kind,
      scope: scope.scope,
      nativeLanguages: languages,
      license: license.license,
      retrievedAt: retrievedAt.date,
      provenance: provenance.provenance,
      parentSourceId,
      mirrors,
    },
  };
}

function asRow(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function parseMetadata(raw: unknown): { ok: true; value: Record<string, unknown> } | { ok: false; detail: string } {
  if (raw === undefined || raw === null || raw === '') return { ok: true, value: {} };
  if (typeof raw === 'object' && !Array.isArray(raw)) return { ok: true, value: raw as Record<string, unknown> };
  if (typeof raw !== 'string') return { ok: false, detail: 'metadata_json is not an object or JSON string.' };
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, detail: 'metadata_json is not a JSON object.' };
    return { ok: true, value: parsed as Record<string, unknown> };
  } catch {
    return { ok: false, detail: 'metadata_json is not valid JSON.' };
  }
}

function scalarConflict(column: unknown, meta: unknown): { value: unknown; conflict: string | null } {
  const present = (value: unknown) => !(value === undefined || value === null || (typeof value === 'string' && value.trim() === ''));
  const columnPresent = present(column);
  const metaPresent = present(meta);
  const show = (value: unknown) => (typeof value === 'string' || typeof value === 'number' ? String(value).trim() : JSON.stringify(value));
  if (columnPresent && metaPresent && show(column) !== show(meta)) {
    return { value: column, conflict: `${show(column)} conflicts with ${show(meta)}.` };
  }
  if (columnPresent) return { value: column, conflict: null };
  if (metaPresent) return { value: meta, conflict: null };
  return { value: undefined, conflict: null };
}

function firstText(...values: unknown[]): string | null {
  for (const value of values) {
    const text = cleanString(value);
    if (text) return text;
  }
  return null;
}

function knownColumns(table: SourceTable): Set<string> {
  if (table === 'laws') {
    return new Set<string>([...REQUIRED_LAW_COLUMNS, ...OPTIONAL_LAW_COLUMNS, 'text_version_id', 'content_cid', 'ipfs_cid', 'publisher_id', 'source_revision']);
  }
  if (table === 'articles') {
    return new Set<string>([...REQUIRED_ARTICLE_COLUMNS, ...OPTIONAL_ARTICLE_COLUMNS, 'text_version_id', 'content_cid', 'ipfs_cid', 'publisher_id', 'source_revision', 'language', 'law_status']);
  }
  return new Set<string>();
}

function sectionFromRow(row: Record<string, unknown>, table: 'laws' | 'articles', rowIndex: number): SectionInput | { error: string } {
  const metadata = parseMetadata(row.metadata_json);
  if (!metadata.ok) return { error: metadata.detail };
  const meta = metadata.value;
  const publication = scalarConflict(row.date, meta.publication_date);
  const enactment = scalarConflict(row.date_issued, meta.enactment_date);
  const status = scalarConflict(row.law_status, meta.law_status ?? meta.status);
  const language = scalarConflict(row.language, meta.language);
  const labels = [cleanString(row.jurisdiction), cleanString(row.country)].filter((item): item is string => Boolean(item));
  const unmapped = Object.keys(row).filter((key) => !knownColumns(table).has(key));
  return {
    table,
    rowIndex,
    sectionId: row.id,
    instrumentId: table === 'laws' ? row.id : row.law_id,
    textVersionId: row.text_version_id ?? meta.text_version_id,
    sourceUrl: row.source_url ?? meta.source_url,
    sourceType: row.source_type ?? meta.source_type,
    jsonPath: row.json_path,
    parentSectionId: meta.parent_section_id,
    parentInstrumentId: table === 'articles' ? row.law_id : meta.parent_instrument_id,
    parentSourceId: meta.parent_source_id,
    parentSourceRevision: meta.parent_source_revision,
    publisherId: row.publisher_id,
    sourceRevision: row.source_revision,
    instrumentKind: meta.instrument_kind ?? meta.document_type,
    recordType: table === 'articles' ? row.record_type ?? meta.record_type : meta.record_type,
    language: language.value,
    title: row.title,
    text: row.text,
    contentCid: row.content_cid ?? row.ipfs_cid ?? meta.content_cid ?? meta.ipfs_cid,
    eli: row.eli ?? meta.eli,
    identifier: row.identifier ?? meta.identifier,
    officialIdentifier: row.official_identifier ?? meta.official_identifier,
    officialCitation: firstText(row.official_identifier, row.eli, row.identifier, meta.official_identifier, meta.eli, meta.identifier),
    articleCount: table === 'laws' ? row.article_count : undefined,
    issuerIds: meta.issuer_ids,
    territorialIds: meta.territorial_ids,
    territorialLabels: labels,
    scopeKnowledge: meta.scope_knowledge,
    scopeUncertainty: meta.uncertainty,
    status: status.value,
    dates: {
      publication: publication.value as DateInput,
      enactment: enactment.value as DateInput,
      commencement: (meta.commencement ?? meta.commencement_date ?? meta.effective_date) as DateInput,
      repeal: (meta.repeal ?? meta.repeal_date) as DateInput,
    },
    license: row.license ?? meta.license,
    attribution: meta.attribution,
    associations: meta.associations,
    provenance: {
      collector: meta.collector ?? meta.collector_id ?? meta.harvester,
      sourceLineage: meta.source_lineage,
    },
    hierarchy: {
      kind: (table === 'articles' ? row.record_type ?? meta.record_type : meta.record_type) ?? (table === 'laws' ? 'law' : 'article'),
      number: row.article_number ?? meta.article_number,
      label: row.document_number ?? meta.document_number ?? null,
      path: meta.hierarchy_path as string | string[] | undefined,
    },
    unmappedColumns: unmapped,
    dateConflict: [publication.conflict ? `publication ${publication.conflict}` : null, enactment.conflict ? `enactment ${enactment.conflict}` : null]
      .filter(Boolean)
      .join(' ') || null,
    statusConflict: status.conflict,
    languageConflict: language.conflict,
  };
}

function parseCandidate(input: SectionInput, source: LawSource, fallbackType: SectionRecordType): { ok: true; candidate: Candidate } | { ok: false; quarantined: QuarantineRecord[] } {
  const problems: Problem[] = [];
  const table = input.table ?? 'section';
  const rowIndex = input.rowIndex ?? null;
  const sourceRecordId = cleanString(input.sectionId);
  if (input.dateConflict) problems.push(problem('conflicting-date', 'dates', input.dateConflict));
  if (input.statusConflict) problems.push(problem('conflicting-status', 'status', `Status ${input.statusConflict}`));
  if (input.languageConflict) problems.push(problem('conflicting-language', 'language', `Language ${input.languageConflict}`));
  const rowPublisher = cleanString(input.publisherId);
  if (rowPublisher && rowPublisher !== source.publisherId) {
    problems.push(problem('conflicting-publisher', 'publisherId', `Row publisher ${rowPublisher} does not match source publisher ${source.publisherId}.`));
  }
  const rowRevision = cleanString(input.sourceRevision);
  if (rowRevision && rowRevision !== source.sourceRevision) {
    problems.push(problem('conflicting-revision', 'sourceRevision', `Row revision ${rowRevision} does not match pinned revision ${source.sourceRevision}.`));
  }
  if (!sourceRecordId) problems.push(problem('missing-section-id', 'sectionId', 'sectionId is blank. No official identifier was invented.'));
  const instrumentId = cleanString(input.instrumentId);
  if (!instrumentId) problems.push(problem('missing-instrument-id', 'instrumentId', 'instrumentId is blank. No official identifier was invented.'));
  const parentSectionId = cleanString(input.parentSectionId);
  const parentInstrumentId = cleanString(input.parentInstrumentId);
  const parentSourceId = cleanString(input.parentSourceId);
  const parentSourceRevision = cleanString(input.parentSourceRevision);
  if (parentSectionId && sourceRecordId && parentSectionId === sourceRecordId && (!parentSourceId || parentSourceId === source.sourceId)) {
    problems.push(problem('parent-is-self', 'parentSectionId', `Section ${sourceRecordId} names itself as its parent.`));
  }
  if ((parentSourceId && parentSourceId !== source.sourceId) || (parentSourceRevision && parentSourceRevision !== source.sourceRevision)) {
    if (!parentSourceId || !parentSourceRevision || parentSourceId === source.sourceId) {
      problems.push(problem('cross-source-parent', 'parentSourceId', 'Cross-source parent is missing a distinct pinned source id and revision.'));
    } else {
      const revision = revisionProblem(parentSourceRevision);
      if (revision) problems.push(problem(revision, 'parentSourceRevision', `Parent revision ${JSON.stringify(parentSourceRevision)} is not pinned.`));
    }
  }
  const sourceUrl = parseUrl(input.sourceUrl);
  if (!sourceUrl.ok) problems.push(problem('invalid-source-url', 'sourceUrl', sourceUrl.detail));
  const contentCid = parseCid(input.contentCid);
  if (!contentCid.ok) problems.push(problem('invalid-content-cid', 'contentCid', contentCid.detail));
  const instrumentKind = parseInstrumentKind(input.instrumentKind);
  if (!instrumentKind.ok) problems.push(problem('invalid-instrument-kind', 'instrumentKind', instrumentKind.detail));
  const recordType = parseRecordType(input.recordType, fallbackType);
  if (!recordType.ok) problems.push(problem('invalid-record-type', 'recordType', recordType.detail));
  const language = parseLanguage(input.language, `${table}.language`);
  if (!language.ok) problems.push(problem(language.reason, 'language', language.detail));
  const status = parseStatus(input.status);
  if (!status.ok) problems.push(problem(status.reason, 'status', status.detail));
  const text = parseText(input.text, input.textKnowledge);
  if (!text.ok) problems.push(problem(text.reason, 'text', text.detail));
  const articleCount = parseArticleCount(input.articleCount);
  if (!articleCount.ok) problems.push(problem('invalid-article-count', 'articleCount', articleCount.detail));
  const hierarchyPath = parsePath(input.hierarchy?.path);
  if (!hierarchyPath.ok) problems.push(problem('invalid-hierarchy', 'hierarchy.path', hierarchyPath.detail));
  const scope = parseScope({
    issuerIds: input.issuerIds,
    territorialIds: input.territorialIds,
    territorialLabels: input.territorialLabels,
    knowledge: input.scopeKnowledge,
    uncertainty: input.scopeUncertainty,
  });
  if (!scope.ok) problems.push(problem(scope.reason, 'scope', scope.detail));
  const dates = {
    publication: parseDate(input.dates?.publication, 'publication', `${table}.date`),
    enactment: parseDate(input.dates?.enactment, 'enactment', `${table}.date_issued`),
    commencement: parseDate(input.dates?.commencement, 'commencement', `${table}.commencement`),
    repeal: parseDate(input.dates?.repeal, 'repeal', `${table}.repeal`),
  };
  (Object.keys(dates) as Array<keyof typeof dates>).forEach((field) => {
    const parsed = dates[field];
    if (!parsed.ok) problems.push(problem(parsed.reason, field, parsed.detail));
  });
  if (dates.repeal.ok && dates.enactment.ok && isBefore(dates.repeal.date, dates.enactment.date)) {
    problems.push(problem('repeal-before-enactment', 'repeal', `Repeal ${JSON.stringify(dates.repeal.date)} is earlier than enactment ${JSON.stringify(dates.enactment.date)}.`));
  }
  const citationSource = input.officialCitation !== undefined
    ? input.officialCitation
    : firstText(input.officialIdentifier, input.eli, input.identifier);
  const citation = parseCitation(citationSource);
  if (!citation.ok) problems.push(problem(citation.reason, 'officialCitation', citation.detail));
  const eli = cleanString(input.eli);
  const identifier = cleanString(input.identifier);
  const officialIdentifier = cleanString(input.officialIdentifier);
  const license = parseLicense(input.license, input.attribution, input.licenseKnowledge);
  if (!license.ok) problems.push(problem(license.reason, 'license', license.detail));
  let textVersionId = cleanString(input.textVersionId);
  let textVersionDerived = false;
  if (!textVersionId) {
    if (!text.ok || text.hash === null) {
      problems.push(problem('missing-text-version-id', 'textVersionId', 'Text version id is absent and the source text is unknown, so no version id was derived.'));
    } else {
      textVersionId = `${TEXT_VERSION_PREFIX}:${source.sourceRevision}:${text.hash}`;
      textVersionDerived = true;
    }
  }
  if (textVersionId && instrumentId && textVersionId === instrumentId) {
    problems.push(problem('text-version-collapsed-into-instrument', 'textVersionId', `Text version id ${textVersionId} equals instrument id ${instrumentId}.`));
  }
  const title = input.title === undefined || input.title === null
    ? null
    : typeof input.title === 'string' || typeof input.title === 'number'
      ? String(input.title)
      : undefined;
  if (title === undefined) problems.push(problem('invalid-text', 'title', 'Title is not a string, number, or empty value.'));
  const drafts = collectDrafts([input.associations, input.amendments, input.translations, input.mirrors], sourceRecordId);
  problems.push(...drafts.problems);
  if (language.ok) {
    for (const draft of drafts.drafts) {
      if (draft.kind === 'translation-of' && draft.targetLanguage && language.language.tag && draft.targetLanguage === language.language.tag) {
        problems.push(problem('translation-language-unchanged', 'targetLanguage', `Translation target language ${draft.targetLanguage} matches this section.`));
      }
    }
  }
  if (scope.ok) {
    for (const draft of drafts.drafts) {
      if (draft.kind === 'issued-by') {
        const issuer = draft.targetSectionId ?? draft.targetInstrumentId;
        if (issuer && !scope.scope.issuerIds.includes(issuer)) {
          problems.push(problem('invalid-scope', 'issued-by', `issued-by target ${issuer} is not an issuer id on this section.`));
        }
      }
    }
  }

  const observed: string[] = [];
  const inferred: string[] = [];
  const unknown: string[] = [];
  const notes: Record<string, string> = {};
  if (sourceRecordId) observed.push('sectionId');
  if (instrumentId) observed.push('instrumentId');
  if (textVersionDerived) {
    inferred.push('textVersionId');
    notes.textVersionId = DERIVED_TEXT_VERSION_NOTE;
  } else if (textVersionId) observed.push('textVersionId');
  if (typeof title === 'string') observed.push('title');
  else unknown.push('title');
  if (text.ok && text.textKnowledge === 'unknown') unknown.push('text');
  else if (text.ok) observed.push('text');
  if (language.ok && language.language.knowledge === 'unknown') unknown.push('language');
  else if (language.ok && language.language.knowledge === 'inferred') {
    inferred.push('language');
    notes.language = language.language.source ?? 'Inferred language.';
  } else if (language.ok) observed.push('language');
  if (status.ok && status.knowledge === 'unknown') unknown.push('status');
  else if (status.ok && status.knowledge === 'inferred') {
    inferred.push('status');
    notes.status = status.note ?? 'Inferred status.';
  } else if (status.ok) observed.push('status');
  if (scope.ok && scope.scope.knowledge === 'unknown') unknown.push('scope');
  else if (scope.ok && scope.scope.knowledge === 'inferred') {
    inferred.push('scope');
    notes.scope = 'Caller marked issuer or territorial scope as inferred.';
  } else if (scope.ok) observed.push('scope');
  if (license.ok && license.license.knowledge === 'unknown') unknown.push('license');
  else if (license.ok && license.license.knowledge === 'inferred') {
    inferred.push('license');
    notes.license = license.note ?? 'Inferred license.';
  } else if (license.ok) observed.push('license');
  if (instrumentKind.ok && !instrumentKind.explicit) unknown.push('instrumentKind');
  else if (instrumentKind.ok) observed.push('instrumentKind');
  (['publication', 'enactment', 'commencement', 'repeal'] as const).forEach((field) => {
    const parsed = dates[field];
    if (!parsed.ok) return;
    if (parsed.date.knowledge === 'unknown') unknown.push(field);
    else if (parsed.date.knowledge === 'inferred') {
      inferred.push(field);
      notes[field] = parsed.date.source;
    } else observed.push(field);
  });
  if (citation.ok && !citation.citation) unknown.push('officialCitation');
  else if (citation.ok) observed.push('officialCitation');
  const provenance = finishProvenance(input.provenance, observed, inferred, unknown, notes, input.unmappedColumns ?? []);
  if (!provenance.ok) problems.push(...provenance.problems);

  const place = {
    table,
    rowIndex,
    sourceId: source.sourceId,
    sourceRevision: source.sourceRevision,
    sourceRecordId,
  };
  if (
    problems.length
    || !sourceRecordId
    || !instrumentId
    || !textVersionId
    || !sourceUrl.ok
    || !contentCid.ok
    || !instrumentKind.ok
    || !recordType.ok
    || !language.ok
    || !status.ok
    || !text.ok
    || !articleCount.ok
    || !hierarchyPath.ok
    || !scope.ok
    || !dates.publication.ok
    || !dates.enactment.ok
    || !dates.commencement.ok
    || !dates.repeal.ok
    || !citation.ok
    || !license.ok
    || !provenance.ok
    || title === undefined
  ) {
    return { ok: false, quarantined: problems.map((item) => makeQuarantine(item, place)) };
  }

  const section: LawSection = {
    schema: LAW_SECTION_SCHEMA,
    schemaVersion: SCHEMA_VERSION,
    sectionId: sourceRecordId,
    instrumentId,
    textVersionId,
    textVersionDerived,
    sourceId: source.sourceId,
    publisherId: source.publisherId,
    sourceRevision: source.sourceRevision,
    sourceUrl: sourceUrl.url,
    sourceType: cleanString(input.sourceType),
    jsonPath: cleanString(input.jsonPath),
    parentSectionId,
    parentInstrumentId,
    instrumentKind: instrumentKind.kind,
    recordType: recordType.recordType,
    language: language.language,
    title,
    text: text.text,
    textKnowledge: text.textKnowledge,
    bodySha256: text.hash,
    contentCid: contentCid.cid,
    eli,
    identifier,
    officialIdentifier,
    officialCitation: citation.citation,
    articleCount: articleCount.count,
    scope: scope.scope,
    status: status.status,
    statusKnowledge: status.knowledge,
    dates: {
      publication: dates.publication.date,
      enactment: dates.enactment.date,
      commencement: dates.commencement.date,
      repeal: dates.repeal.date,
    },
    license: license.license,
    associations: [],
    provenance: provenance.provenance,
    hierarchy: {
      kind: cleanString(input.hierarchy?.kind) ?? recordType.recordType,
      number: cleanString(input.hierarchy?.number),
      label: input.hierarchy?.label === undefined || input.hierarchy?.label === null ? null : cleanString(input.hierarchy.label),
      path: hierarchyPath.path,
    },
  };
  return {
    ok: true,
    candidate: {
      section,
      table,
      rowIndex,
      sourceRecordId,
      parentSectionId,
      parentSourceId,
      parentSourceRevision,
      drafts: drafts.drafts,
    },
  };
}

function declareColumns(rows: readonly unknown[] | undefined, explicit: readonly string[] | undefined): string[] | null {
  if (explicit) return [...explicit];
  if (!rows) return null;
  const columns = new Set<string>();
  for (const row of rows) {
    const record = asRow(row);
    if (record) Object.keys(record).forEach((key) => columns.add(key));
  }
  return [...columns];
}

function missingRequired(present: readonly string[], required: readonly string[]): string[] {
  const have = new Set(present);
  return required.filter((column) => !have.has(column));
}

function columnQuarantine(table: 'laws' | 'articles', present: readonly string[], missing: readonly string[], source: LawSource): QuarantineRecord {
  return makeQuarantine(
    problem(
      'required-column-missing',
      missing.join(','),
      `${table} table is missing required columns ${missing.join(', ')}. Present columns: ${present.join(', ') || '(none)'}. No identifiers were invented.`,
    ),
    { table, rowIndex: null, sourceId: source.sourceId, sourceRevision: source.sourceRevision, sourceRecordId: null },
  );
}

function rowsToInputs(
  rows: readonly unknown[] | undefined,
  table: 'laws' | 'articles',
  source: LawSource,
  quarantined: QuarantineRecord[],
): SectionInput[] {
  if (!rows) return [];
  const inputs: SectionInput[] = [];
  rows.forEach((row, rowIndex) => {
    const record = asRow(row);
    if (!record) {
      quarantined.push(makeQuarantine(problem('invalid-row', 'row', `${table} row ${rowIndex} is not an object.`), {
        table,
        rowIndex,
        sourceId: source.sourceId,
        sourceRevision: source.sourceRevision,
        sourceRecordId: null,
      }));
      return;
    }
    const mapped = sectionFromRow(record, table, rowIndex);
    if ('error' in mapped) {
      quarantined.push(makeQuarantine(problem('unreadable-provenance', 'metadata_json', mapped.error), {
        table,
        rowIndex,
        sourceId: source.sourceId,
        sourceRevision: source.sourceRevision,
        sourceRecordId: cleanString(record.id),
      }));
      return;
    }
    inputs.push(mapped);
  });
  return inputs;
}

function storeDraft(draft: AssocDraft, source: LawSource): StoredAssociation {
  return {
    kind: draft.kind,
    targetSectionId: draft.targetSectionId,
    targetInstrumentId: draft.targetInstrumentId,
    targetSourceId: draft.targetSourceId ?? source.sourceId,
    targetSourceRevision: draft.targetSourceRevision ?? source.sourceRevision,
    targetTextVersionId: draft.targetTextVersionId,
    targetLanguage: draft.targetLanguage,
    targetBodySha256: draft.targetBodySha256,
    relation: draft.relation,
  };
}

function sameAssociation(left: StoredAssociation, right: StoredAssociation): boolean {
  return left.kind === right.kind
    && left.targetSectionId === right.targetSectionId
    && left.targetInstrumentId === right.targetInstrumentId
    && left.targetSourceId === right.targetSourceId
    && left.targetSourceRevision === right.targetSourceRevision
    && left.relation === right.relation;
}

function cyclicIds(parents: ReadonlyMap<string, string | null>): Set<string> {
  const cyclic = new Set<string>();
  const color = new Map<string, number>();
  const visit = (id: string, trail: string[]): void => {
    const state = color.get(id) ?? 0;
    if (state === 1) {
      const at = trail.indexOf(id);
      for (const member of at === -1 ? [id] : trail.slice(at)) cyclic.add(member);
      return;
    }
    if (state === 2) return;
    color.set(id, 1);
    const parent = parents.get(id);
    if (parent && parents.has(parent)) visit(parent, [...trail, id]);
    if (!cyclic.has(id)) color.set(id, 2);
  };
  for (const id of parents.keys()) visit(id, []);
  return cyclic;
}

function relate(candidates: Candidate[], source: LawSource, quarantined: QuarantineRecord[]): LawSection[] {
  const kept: Candidate[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (seen.has(candidate.section.sectionId)) {
      quarantined.push(makeQuarantine(
        problem('duplicate-section-identity', 'sectionId', `Section ${candidate.section.sectionId} is already admitted in revision ${source.sourceRevision}.`),
        {
          table: candidate.table,
          rowIndex: candidate.rowIndex,
          sourceId: source.sourceId,
          sourceRevision: source.sourceRevision,
          sourceRecordId: candidate.sourceRecordId,
        },
      ));
      continue;
    }
    seen.add(candidate.section.sectionId);
    kept.push(candidate);
  }

  const byId = new Map(kept.map((candidate) => [candidate.section.sectionId, candidate]));
  const parents = new Map<string, string | null>();
  for (const candidate of kept) {
    const external = candidate.parentSourceId !== null && candidate.parentSourceId !== source.sourceId;
    parents.set(candidate.section.sectionId, external ? null : candidate.parentSectionId);
  }
  const cyclic = cyclicIds(parents);
  const survivors: Candidate[] = [];
  for (const candidate of kept) {
    if (!cyclic.has(candidate.section.sectionId)) {
      survivors.push(candidate);
      continue;
    }
    quarantined.push(makeQuarantine(
      problem('cyclic-parent', 'parentSectionId', `Section ${candidate.section.sectionId} is part of a parent cycle.`),
      {
        table: candidate.table,
        rowIndex: candidate.rowIndex,
        sourceId: source.sourceId,
        sourceRevision: source.sourceRevision,
        sourceRecordId: candidate.sourceRecordId,
      },
    ));
    byId.delete(candidate.section.sectionId);
  }

  const admitted: LawSection[] = [];
  for (const candidate of survivors) {
    const problems: Problem[] = [];
    const externalParent = candidate.parentSourceId !== null && candidate.parentSourceId !== source.sourceId;
    if (candidate.parentSectionId && !externalParent) {
      const parent = byId.get(candidate.parentSectionId);
      if (!parent) {
        problems.push(problem('dangling-parent', 'parentSectionId', `Parent section ${candidate.parentSectionId} is not in source ${source.sourceId} revision ${source.sourceRevision}.`));
      } else if (parent.section.instrumentId !== candidate.section.instrumentId) {
        const linked = candidate.drafts.some((draft) => draft.kind === 'parent-instrument'
          && (draft.targetInstrumentId === parent.section.instrumentId || draft.targetSectionId === parent.section.sectionId));
        if (!linked) {
          problems.push(problem(
            'parent-instrument-mismatch',
            'parentSectionId',
            `Parent ${parent.section.sectionId} belongs to instrument ${parent.section.instrumentId}, not ${candidate.section.instrumentId}.`,
          ));
        }
      }
    }
    if (candidate.section.sectionId !== candidate.section.instrumentId) {
      const instrument = byId.get(candidate.section.instrumentId);
      const externalInstrument = candidate.drafts.find((draft) => draft.kind === 'parent-instrument' && draft.targetSourceId && draft.targetSourceId !== source.sourceId);
      if (!instrument && !externalInstrument) {
        problems.push(problem(
          'dangling-parent',
          'instrumentId',
          `Instrument ${candidate.section.instrumentId} is not in source ${source.sourceId} revision ${source.sourceRevision}.`,
        ));
      } else if (instrument && instrument.section.sectionId !== instrument.section.instrumentId) {
        problems.push(problem(
          'parent-instrument-mismatch',
          'instrumentId',
          `Section ${instrument.section.sectionId} is not the instrument record for ${candidate.section.instrumentId}.`,
        ));
      } else if (externalInstrument && (!externalInstrument.targetSourceRevision || revisionProblem(externalInstrument.targetSourceRevision))) {
        problems.push(problem('cross-source-parent', 'parentInstrumentId', 'External instrument association has no pinned target revision.'));
      }
    }
    for (const draft of candidate.drafts) {
      const targetSourceId = draft.targetSourceId ?? source.sourceId;
      const targetRevision = draft.targetSourceRevision ?? source.sourceRevision;
      if (draft.kind === 'translation-of') {
        if (!candidate.section.language.tag) {
          problems.push(problem('translation-target-language-missing', 'language', 'Translation association is on a section whose language is unknown.'));
        } else if (draft.targetLanguage === candidate.section.language.tag) {
          problems.push(problem('translation-language-unchanged', 'targetLanguage', `Translation target language ${draft.targetLanguage} matches this section.`));
        }
      }
      if (draft.kind === 'mirror-of' || draft.kind === 'equivalent-text') {
        if (targetSourceId === source.sourceId && targetRevision === source.sourceRevision && draft.targetTextVersionId === candidate.section.textVersionId) {
          problems.push(problem('mirror-collapses-version', 'textVersionId', 'Mirror link reuses this text version id.'));
        }
        if (draft.relation === 'equivalent-text') {
          if (!draft.targetBodySha256 || !candidate.section.bodySha256 || draft.targetBodySha256 !== candidate.section.bodySha256) {
            problems.push(problem('equivalent-text-hash-mismatch', 'targetBodySha256', 'Equivalent-text link does not share this section body hash.'));
          }
        }
        if (draft.relation === 'conflicting-version' && draft.targetTextVersionId && draft.targetTextVersionId === candidate.section.textVersionId) {
          problems.push(problem('mirror-collapses-version', 'targetTextVersionId', 'Conflicting mirror reuses this text version id.'));
        }
      }
      if (draft.kind === 'translation-of' && draft.targetSectionId && targetSourceId === source.sourceId) {
        const target = byId.get(draft.targetSectionId);
        if (!target) problems.push(problem('dangling-parent', 'translation-of', `Translation target ${draft.targetSectionId} is not in this source revision.`));
        else if (target.section.language.tag && draft.targetLanguage && target.section.language.tag !== draft.targetLanguage) {
          problems.push(problem('conflicting-language', 'targetLanguage', `Translation target language ${draft.targetLanguage} does not match section ${target.section.sectionId} language ${target.section.language.tag}.`));
        }
      }
      if ((draft.kind === 'amendment-of' || draft.kind === 'parent-section') && draft.targetSectionId && targetSourceId === source.sourceId && !byId.get(draft.targetSectionId)) {
        problems.push(problem('dangling-parent', draft.kind, `Association target ${draft.targetSectionId} is not in this source revision.`));
      }
    }
    if (problems.length) {
      problems.forEach((item) => quarantined.push(makeQuarantine(item, {
        table: candidate.table,
        rowIndex: candidate.rowIndex,
        sourceId: source.sourceId,
        sourceRevision: source.sourceRevision,
        sourceRecordId: candidate.sourceRecordId,
      })));
      byId.delete(candidate.section.sectionId);
      continue;
    }
    const associations: StoredAssociation[] = [];
    const push = (association: StoredAssociation) => {
      if (!associations.some((item) => sameAssociation(item, association))) associations.push(association);
    };
    if (candidate.parentSectionId) {
      push({
        kind: 'parent-section',
        targetSectionId: candidate.parentSectionId,
        targetInstrumentId: null,
        targetSourceId: candidate.parentSourceId ?? source.sourceId,
        targetSourceRevision: candidate.parentSourceRevision ?? source.sourceRevision,
        targetTextVersionId: null,
        targetLanguage: null,
        targetBodySha256: null,
        relation: null,
      });
    }
    if (candidate.section.parentInstrumentId && candidate.section.parentInstrumentId !== candidate.section.sectionId) {
      push({
        kind: 'parent-instrument',
        targetSectionId: null,
        targetInstrumentId: candidate.section.parentInstrumentId,
        targetSourceId: source.sourceId,
        targetSourceRevision: source.sourceRevision,
        targetTextVersionId: null,
        targetLanguage: null,
        targetBodySha256: null,
        relation: null,
      });
    }
    candidate.drafts.forEach((draft) => push(storeDraft(draft, source)));
    candidate.section.associations = associations;
    admitted.push(candidate.section);
  }
  return admitted;
}

export function admitCorpus(input: CorpusInput): AdmissionResult {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new SchemaError('admitCorpus requires a corpus object. No identifiers were invented.');
  }
  const parsedSource = parseSource(input.source);
  if (!parsedSource.ok) {
    return { schemaVersion: SCHEMA_VERSION, source: null, sections: [], quarantined: sortQuarantines(parsedSource.quarantined) };
  }
  const source = parsedSource.source;
  const quarantined: QuarantineRecord[] = [];
  const sectionInputs: SectionInput[] = [];

  const lawColumns = declareColumns(input.laws, input.lawColumns);
  if (lawColumns && (input.laws !== undefined || input.lawColumns !== undefined)) {
    const missing = missingRequired(lawColumns, REQUIRED_LAW_COLUMNS);
    if ((input.laws && input.laws.length > 0) || input.lawColumns) {
      if (missing.length) quarantined.push(columnQuarantine('laws', lawColumns, missing, source));
      else sectionInputs.push(...rowsToInputs(input.laws, 'laws', source, quarantined));
    }
  }
  const articleColumns = declareColumns(input.articles, input.articleColumns);
  if (articleColumns && (input.articles !== undefined || input.articleColumns !== undefined)) {
    const missing = missingRequired(articleColumns, REQUIRED_ARTICLE_COLUMNS);
    if ((input.articles && input.articles.length > 0) || input.articleColumns) {
      if (missing.length) quarantined.push(columnQuarantine('articles', articleColumns, missing, source));
      else sectionInputs.push(...rowsToInputs(input.articles, 'articles', source, quarantined));
    }
  }
  for (const [index, section] of (input.sections ?? []).entries()) {
    sectionInputs.push({ ...section, table: section.table ?? 'section', rowIndex: section.rowIndex ?? index });
  }

  const candidates: Candidate[] = [];
  for (const sectionInput of sectionInputs) {
    const fallback = sectionInput.table === 'articles' ? 'article' : sectionInput.table === 'laws' ? 'law' : 'section';
    const parsed = parseCandidate(sectionInput, source, fallback);
    if (!parsed.ok) quarantined.push(...parsed.quarantined);
    else candidates.push(parsed.candidate);
  }

  const byIncomingId = new Map(candidates.map((candidate) => [candidate.section.sectionId, candidate]));
  for (const [index, association] of (input.associations ?? []).entries()) {
    const fromSectionId = cleanString(association.fromSectionId);
    if (!fromSectionId) {
      quarantined.push(makeQuarantine(problem('association-target-missing', 'fromSectionId', 'Corpus association has no fromSectionId.'), {
        table: 'associations',
        rowIndex: index,
        sourceId: source.sourceId,
        sourceRevision: source.sourceRevision,
        sourceRecordId: null,
      }));
      continue;
    }
    const owner = byIncomingId.get(fromSectionId);
    const parsed = parseAssociation(association, fromSectionId);
    if (!parsed.ok) {
      quarantined.push(makeQuarantine(parsed.problem, {
        table: owner?.table ?? 'associations',
        rowIndex: owner?.rowIndex ?? index,
        sourceId: source.sourceId,
        sourceRevision: source.sourceRevision,
        sourceRecordId: fromSectionId,
      }));
      if (owner) {
        byIncomingId.delete(fromSectionId);
        const removeAt = candidates.findIndex((candidate) => candidate.section.sectionId === fromSectionId);
        if (removeAt >= 0) candidates.splice(removeAt, 1);
      }
      continue;
    }
    if (!owner) {
      quarantined.push(makeQuarantine(problem('dangling-parent', 'fromSectionId', `Association fromSectionId ${fromSectionId} does not match an admitted section.`), {
        table: 'associations',
        rowIndex: index,
        sourceId: source.sourceId,
        sourceRevision: source.sourceRevision,
        sourceRecordId: fromSectionId,
      }));
      continue;
    }
    owner.drafts.push(parsed.draft);
  }

  const sections = relate(candidates, source, quarantined);
  return { schemaVersion: SCHEMA_VERSION, source, sections, quarantined: sortQuarantines(quarantined) };
}

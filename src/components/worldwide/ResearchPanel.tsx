/**
 * Optional cited answers and existing proof summaries.
 *
 * Search has already retrieved the passages before this panel opens.
 * The answer quotes none of the document as instructions. It cites the
 * content id and the pinned source revision that were retrieved. Source
 * text, a translation, and generated text stay in separate blocks.
 *
 * A proof summary joins only that same content id. Simulated, unknown,
 * and incomplete proof output cannot establish applicability or current
 * law. No model, account, or server is called.
 */

import { useId, useState } from 'react';
import { buildLawDeepLink } from '../../lib/worldwide/contracts';
import { verifySimulatedCertificate, type SimulatedVerificationResult } from '../../lib/logic/zkp/simulatedVerifier';
import { resultCopy, type ResultCopy, type ResultLocale } from './SearchFilters';
import '../../styles/worldwide.css';

export const RESEARCH_SCHEMA = 'worldwide-legal-search.research-panel@1';
export const RESEARCH_APPLICABILITY = 'not-asserted' as const;

export const RESEARCH_DEPENDENCY = Object.freeze({
  schema: RESEARCH_SCHEMA,
  searchRequiresLlm: false as const,
  searchRequiresBackend: false as const,
  searchRequiresResearchPanel: false as const,
  answerRequiresLlm: false as const,
  answerRequiresBackend: false as const,
  answerRequiresNetwork: false as const,
  proofRequiresProver: false as const,
});

export const RESEARCH_LIMITATIONS = [
  'The optional answer is built from passages the caller already retrieved. This module does not search, embed, or call a model or a server.',
  'A citation is the passage content id plus its pinned source revision. A missing revision, or a floating name such as latest or head, is not cited.',
  'Source text, translated text, and generated text are separate. A translation is not a new source revision.',
  'A proof summary joins a passage only when its content id is that passage. A proof revision, when present, must be the same retrieved revision.',
  'Simulated, unknown, and incomplete proof output cannot establish legal applicability or current law. Any other proof backend stays unknown.',
  'Document text, translations, proof formulas, and a supplied answer are untrusted. Instruction-shaped text is not followed and cannot change the revision, the citation, or applicability.',
  'A supplied answer is shown only when every citation matches a retrieved content id and revision, the text repeats those values, and the text does not assert applicability.',
  'Passing a model, a backend, or a search function does not call it.',
] as const;

const MAX_PASSAGES = 20;
const MAX_PROOFS = 64;
const MAX_TEXT = 8000;
const MAX_SCAN = 100000;

const FLOATING_REVISIONS = new Set([
  'head', 'main', 'master', 'latest', 'trunk', 'current', 'floating',
  'unpinned', 'none', 'null', 'undefined', 'tip', 'dev', 'develop',
]);

const CID_PATTERN = /^[A-Za-z0-9]{8,128}$/;
const REVISION_PATTERN = /^[A-Za-z0-9._:@+/-]{1,128}$/;
const RECORD_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const LANGUAGE_PATTERN = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})?$/i;
const STATUS_VALUES = new Set(['current', 'historical', 'repealed', 'superseded', 'unknown']);
const RTL_LANGUAGES = new Set(['ar', 'he', 'fa', 'ur', 'ps', 'dv']);
const RUNTIME_KEYS = ['llm', 'backend', 'fetch', 'ask', 'complete', 'prove', 'model', 'embed', 'search'] as const;

const INVISIBLE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g;
const PROMOTES = /\b(applies|applicable|applicability|governs|governing)\b/i;
const REVISION_CLAIM = /\brevision\s*[:=]?\s*([A-Za-z0-9:._+/-]{1,200})/gi;

const INJECTION_PATTERNS: readonly RegExp[] = [
  /ignore\s+(?:all\s+|any\s+)?(?:previous|prior|above|earlier)\s+(?:instructions|prompts|rules)/i,
  /ignore\s+(?:all\s+|any\s+)?instructions/i,
  /disregard\s+(?:the\s+)?(?:above|previous|prior|instructions)/i,
  /forget\s+(?:everything|all)\b/i,
  /you\s+are\s+now\b/i,
  /new\s+(?:system\s+)?instructions?\b/i,
  /system\s+prompt/i,
  /(?:^|\n)\s*(?:system|assistant|developer)\s*:/i,
  /<\|system\|>/i,
  /\[\s*system\s*\]/i,
  /do\s+not\s+cite/i,
  /cite\s+revision/i,
  /reveal\s+(?:your|the)\s+prompt/i,
  /override\s+(?:the\s+)?(?:citation|revision|policy|instructions)/i,
  /<\s*\/?\s*script\b/i,
  /javascript\s*:/i,
  /data\s*:\s*text\/html/i,
  /\b(?:tool_call|function_call)\b/i,
  /"role"\s*:\s*"(?:system|assistant|developer)"/i,
  /from\s+now\s+on\b/i,
  /<\s*\/?\s*(?:iframe|object|embed)\b/i,
  /\bon(?:error|load|click)\s*=/i,
];

export type MaterialKind = 'source' | 'translated' | 'generated';
export type ProofOutputKind = 'simulated' | 'unknown' | 'incomplete';
export type TranslationKind = 'machine' | 'official' | 'unknown';
export type AnswerGrounding = 'supplied' | 'extracted' | 'none';

interface ResearchCopy {
  title: string;
  optional: string;
  generated: string;
  source: string;
  proof: string;
  simulated: string;
  unknown: string;
  incomplete: string;
  cannot: string;
  injection: string;
  noAnswer: string;
  hide: string;
  show: string;
  preface: string;
  nonePinned: string;
  notSource: string;
  translationNotRevision: string;
  statusNotProof: string;
  unpinned: string;
  openVersion: string;
  officialLink: string;
  question: string;
  limits: string;
  duplicate: string;
}

const RESEARCH_COPY: Record<ResultLocale, ResearchCopy> = {
  en: {
    title: 'Research',
    optional: 'Optional. Search does not use an answer model, an account, or a server.',
    generated: 'Generated answer',
    source: 'Source',
    proof: 'Proof summary',
    simulated: 'Simulated proof output',
    unknown: 'Unknown proof output',
    incomplete: 'Incomplete proof output',
    cannot: 'This proof output cannot establish legal applicability or current law.',
    injection: 'Untrusted text asked for a different instruction. It was not followed.',
    noAnswer: 'Search first. An answer waits for a retrieved version.',
    hide: 'Hide optional answer',
    show: 'Show optional answer',
    preface: 'Optional generated note. Each retrieved version is cited on its own and is not merged into one rule. This note is generated. It is not source text and it is not a translation.',
    nonePinned: 'Optional generated note. No retrieved item had a pinned version, so nothing is cited.',
    notSource: 'This note is generated. It is not source text and it is not a translation.',
    translationNotRevision: 'This translation is not a new source revision.',
    statusNotProof: 'Recorded source status is not proof that the text is current law.',
    unpinned: 'This item has no pinned version, so it is not cited.',
    openVersion: 'Open this version',
    officialLink: 'Official text',
    question: 'Question',
    limits: 'Limits',
    duplicate: 'A repeated content id and revision was kept once.',
  },
  nl: {
    title: 'Onderzoek',
    optional: 'Optioneel. Zoeken gebruikt geen antwoordmodel, account of server.',
    generated: 'Gegenereerd antwoord',
    source: 'Bron',
    proof: 'Bewijssoverzicht',
    simulated: 'Gesimuleerde bewijsuitvoer',
    unknown: 'Onbekende bewijsuitvoer',
    incomplete: 'Onvolledige bewijsuitvoer',
    cannot: 'Deze bewijsuitvoer stelt niet vast dat een regel van toepassing is of dat de tekst geldend recht is.',
    injection: 'Onbetrouwbare tekst vroeg om een andere instructie. Die is niet gevolgd.',
    noAnswer: 'Zoek eerst. Een antwoord wacht op een opgehaalde versie.',
    hide: 'Verberg optioneel antwoord',
    show: 'Toon optioneel antwoord',
    preface: 'Optionele gegenereerde notitie. Elke opgehaalde versie wordt apart aangehaald en niet samengevoegd tot één regel. Deze notitie is gegenereerd. Het is geen brontekst en geen vertaling.',
    nonePinned: 'Optionele gegenereerde notitie. Geen opgehaald item had een vastgezette versie, dus er is niets aangehaald.',
    notSource: 'Deze notitie is gegenereerd. Het is geen brontekst en geen vertaling.',
    translationNotRevision: 'Deze vertaling is geen nieuwe bronrevisie.',
    statusNotProof: 'De vastgelegde bronstatus bewijst niet dat de tekst geldend recht is.',
    unpinned: 'Dit item heeft geen vastgezette versie en wordt niet aangehaald.',
    openVersion: 'Open deze versie',
    officialLink: 'Officiële tekst',
    question: 'Vraag',
    limits: 'Grenzen',
    duplicate: 'Een herhaalde inhouds-id en revisie is één keer gehouden.',
  },
  ar: {
    title: 'البحث',
    optional: 'اختياري. لا يستخدم البحث نموذج إجابة ولا حسابًا ولا خادمًا.',
    generated: 'إجابة مولَّدة',
    source: 'المصدر',
    proof: 'ملخص الإثبات',
    simulated: 'مخرج إثبات محاكى',
    unknown: 'مخرج إثبات غير معروف',
    incomplete: 'مخرج إثبات غير مكتمل',
    cannot: 'لا يثبت هذا المخرج سريان القاعدة ولا أن النص هو القانون الساري.',
    injection: 'طلب نص غير موثوق تعليمات مختلفة. لم تُتَّبع.',
    noAnswer: 'ابحث أولًا. ينتظر الجواب إصدارًا مسترجعًا.',
    hide: 'إخفاء الجواب الاختياري',
    show: 'إظهار الجواب الاختياري',
    preface: 'ملاحظة مولَّدة اختيارية. يُستشهد بكل إصدار مسترجع على حدة ولا تُدمج الإصدارات في قاعدة واحدة. هذه الملاحظة مولَّدة. ليست نص المصدر وليست ترجمة.',
    nonePinned: 'ملاحظة مولَّدة اختيارية. لا عنصر مسترجع له إصدار مثبّت، لذلك لا استشهاد.',
    notSource: 'هذه الملاحظة مولَّدة. ليست نص المصدر وليست ترجمة.',
    translationNotRevision: 'هذه الترجمة ليست إصدارًا جديدًا للمصدر.',
    statusNotProof: 'حالة المصدر المسجَّلة ليست إثباتًا أن النص هو القانون الساري.',
    unpinned: 'هذا العنصر بلا إصدار مثبّت، لذلك لا يُستشهد به.',
    openVersion: 'افتح هذا الإصدار',
    officialLink: 'النص الرسمي',
    question: 'السؤال',
    limits: 'الحدود',
    duplicate: 'أُبقي على معرّف المحتوى والإصدار المكررين مرة واحدة.',
  },
  ja: {
    title: '調査',
    optional: '任意です。検索は回答モデル、アカウント、サーバーを使いません。',
    generated: '生成された回答',
    source: '原文',
    proof: '証明の要約',
    simulated: '模擬の証明出力',
    unknown: '不明な証明出力',
    incomplete: '不完全な証明出力',
    cannot: 'この証明出力は、規則が当てはまることも、本文が現行の法であることも確定しません。',
    injection: '信頼できないテキストが別の指示を求めました。その指示には従いません。',
    noAnswer: '先に検索してください。回答は取得した版を待ちます。',
    hide: '任意の回答を隠す',
    show: '任意の回答を表示',
    preface: '任意の生成ノートです。取得した各版は別に引用し、一つの規則にはまとめません。このノートは生成されたものです。原文でも翻訳でもありません。',
    nonePinned: '任意の生成ノートです。固定した版のある取得項目がないため、引用はありません。',
    notSource: 'このノートは生成されたものです。原文でも翻訳でもありません。',
    translationNotRevision: 'この翻訳は新しい情報源の版ではありません。',
    statusNotProof: '記録された情報源の状態は、本文が現行の法である証明ではありません。',
    unpinned: 'この項目には固定した版がないため、引用しません。',
    openVersion: 'この版を開く',
    officialLink: '公式の本文',
    question: '質問',
    limits: '制限',
    duplicate: '同じ内容IDと版は一度だけ残しました。',
  },
};

export interface ResearchPassageInput {
  ipfs_cid?: unknown;
  cid?: unknown;
  contentId?: unknown;
  recordId?: unknown;
  law_id?: unknown;
  identifier?: unknown;
  title?: unknown;
  text?: unknown;
  sourceUrl?: unknown;
  source_url?: unknown;
  officialCitation?: unknown;
  official_cite?: unknown;
  citation?: unknown;
  sourceRevision?: unknown;
  source_revision?: unknown;
  retrievedAt?: unknown;
  retrieved_at?: unknown;
  language?: unknown;
  status?: unknown;
  law_status?: unknown;
  translation?: {
    kind?: unknown;
    language?: unknown;
    title?: unknown;
    text?: unknown;
  } | null;
  jsonld?: unknown;
  status_note?: unknown;
  statusNote?: unknown;
}

export interface ProofSummaryInput {
  ipfs_cid?: unknown;
  identifier?: unknown;
  title?: unknown;
  formalization_scope?: unknown;
  fol_status?: unknown;
  deontic_status?: unknown;
  deontic_temporal_fol?: unknown;
  deontic_cognitive_event_calculus?: unknown;
  frame_logic_ergo?: unknown;
  norm_operator?: unknown;
  norm_type?: unknown;
  zkp_backend?: unknown;
  zkp_security_note?: unknown;
  zkp_verified?: unknown;
  source_revision?: unknown;
  sourceRevision?: unknown;
}

export interface SuppliedCitationInput {
  cid?: unknown;
  contentId?: unknown;
  ipfs_cid?: unknown;
  sourceRevision?: unknown;
  source_revision?: unknown;
  recordId?: unknown;
}

export interface SuppliedAnswerInput {
  text?: unknown;
  citations?: readonly SuppliedCitationInput[] | null;
}

export interface ResearchInput {
  passages?: readonly ResearchPassageInput[] | null;
  proofs?: readonly ProofSummaryInput[] | null;
  suppliedAnswer?: SuppliedAnswerInput | null;
  query?: unknown;
  locale?: unknown;
  llm?: unknown;
  backend?: unknown;
  fetch?: unknown;
  ask?: unknown;
  complete?: unknown;
  prove?: unknown;
  model?: unknown;
  embed?: unknown;
  search?: unknown;
}

export interface ResearchCitation {
  contentId: string;
  sourceRevision: string;
  recordId: string | null;
  label: string | null;
  href: string | null;
  retrievedAt: string | null;
}

export interface ResearchProofView {
  kind: ProofOutputKind;
  incomplete: boolean;
  establishesApplicability: false;
  establishesCurrentLaw: false;
  cryptographic: false;
  certificateStatus: SimulatedVerificationResult['status'] | 'absent';
  certificate: string;
  contentId: string | null;
  injection: boolean;
  formula: string | null;
  normType: string | null;
  normOperator: string | null;
}

export interface ResearchTranslationView {
  kind: TranslationKind;
  language: string | null;
  title: string | null;
  text: string;
  truncated: boolean;
  injection: boolean;
  sourceRevision: string | null;
  isSourceRevision: false;
}

export interface ResearchPassageView {
  contentId: string | null;
  recordId: string | null;
  sourceRevision: string | null;
  citable: boolean;
  version: 'pinned' | 'unpinned';
  citedInAnswer: boolean;
  title: string;
  text: string;
  textTruncated: boolean;
  language: string | null;
  direction: 'ltr' | 'rtl' | null;
  officialUrl: string | null;
  citationLabel: string | null;
  retrievedAt: string | null;
  recordedStatus: string;
  injection: boolean;
  translation: ResearchTranslationView | null;
  proof: ResearchProofView;
}

export interface ResearchAnswerView {
  optional: true;
  material: 'generated';
  grounding: Exclude<AnswerGrounding, 'none'>;
  text: string;
  citations: ResearchCitation[];
  rejectedReasons: string[];
}

export interface ResearchView {
  schema: typeof RESEARCH_SCHEMA;
  applicability: typeof RESEARCH_APPLICABILITY;
  establishesApplicability: false;
  establishesCurrentLaw: false;
  dependency: typeof RESEARCH_DEPENDENCY;
  limitations: readonly string[];
  ignoredRuntimes: string[];
  droppedPassages: number;
  droppedProofs: number;
  duplicatePassages: number;
  injectionResisted: boolean;
  queryFollowed: false;
  question: { text: string; injection: boolean } | null;
  suppliedAnswer: { status: 'accepted' | 'rejected' | 'absent'; reasons: string[] };
  answer: ResearchAnswerView | null;
  passages: ResearchPassageView[];
}

interface HeldText {
  text: string;
  truncated: boolean;
  injection: boolean;
}

interface HeldPassage {
  contentId: string | null;
  recordId: string | null;
  sourceRevision: string | null;
  citable: boolean;
  title: HeldText;
  body: HeldText;
  language: string | null;
  officialUrl: string | null;
  citationLabel: string | null;
  safeLabel: string | null;
  retrievedAt: string | null;
  recordedStatus: string;
  translation: ResearchTranslationView | null;
  injection: boolean;
}

interface HeldProof {
  contentId: string | null;
  sourceRevision: string | null;
  formula: HeldText;
  backend: string;
  verified: boolean;
  folStatus: string;
  deonticStatus: string;
  normType: string | null;
  normOperator: string | null;
  injection: boolean;
}

function researchCopy(locale: ResultLocale): ResearchCopy {
  return RESEARCH_COPY[locale];
}

function localeOf(value: unknown): ResultLocale {
  return value === 'nl' || value === 'ar' || value === 'ja' ? value : 'en';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function scanText(value: string): boolean {
  const sample = value.length > MAX_SCAN ? `${value.slice(0, MAX_SCAN)}\n${value.slice(-MAX_TEXT)}` : value;
  const folded = sample.normalize('NFKC').replace(INVISIBLE, ' ');
  if (value.length > MAX_SCAN) return true;
  return INJECTION_PATTERNS.some((pattern) => pattern.test(folded));
}

function holdText(value: unknown): HeldText {
  if (typeof value !== 'string') return { text: '', truncated: false, injection: false };
  const cleaned = value.replace(/\u0000/g, '');
  const injection = scanText(cleaned);
  const chars = Array.from(cleaned);
  if (chars.length <= MAX_TEXT) return { text: cleaned, truncated: false, injection };
  return { text: chars.slice(0, MAX_TEXT).join(''), truncated: true, injection };
}

function pinnedRevision(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!REVISION_PATTERN.test(text)) return null;
  if (FLOATING_REVISIONS.has(text.toLowerCase())) return null;
  return text;
}

function safeCid(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return CID_PATTERN.test(text) ? text : null;
}

function safeRecordId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return RECORD_PATTERN.test(text) ? text : null;
}

function safeLanguage(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return LANGUAGE_PATTERN.test(text) ? text : null;
}

function safeHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text || scanText(text)) return null;
  try {
    const url = new URL(text);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function textDirection(language: string | null): 'ltr' | 'rtl' | null {
  if (!language) return null;
  const base = language.toLowerCase().split('-')[0] ?? '';
  return RTL_LANGUAGES.has(base) ? 'rtl' : 'ltr';
}

function recordedStatus(value: unknown): string {
  if (typeof value !== 'string') return 'unknown';
  const text = value.trim().toLowerCase();
  return STATUS_VALUES.has(text) ? text : 'unknown';
}

function enumToken(value: unknown, allowed: readonly string[]): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim().toLowerCase();
  return allowed.includes(text) ? text : null;
}

function firstString(record: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) {
    if (key in record) return record[key];
  }
  return undefined;
}

function ignoredRuntimes(input: ResearchInput): string[] {
  const record = input as unknown as Record<string, unknown>;
  return RUNTIME_KEYS.filter((key) => record[key] !== undefined && record[key] !== null);
}

function translationKind(value: unknown): TranslationKind {
  return value === 'machine' || value === 'official' ? value : 'unknown';
}

function holdPassage(value: unknown): HeldPassage | null {
  const record = asRecord(value);
  if (!record) return null;
  const contentId = safeCid(firstString(record, ['ipfs_cid', 'cid', 'contentId']));
  const sourceRevision = pinnedRevision(firstString(record, ['sourceRevision', 'source_revision']));
  const title = holdText(record.title);
  const body = holdText(record.text);
  const translationRecord = asRecord(record.translation);
  const translationBody = translationRecord ? holdText(translationRecord.text) : null;
  const translation = translationBody && translationBody.text
    ? {
      kind: translationKind(translationRecord?.kind),
      language: safeLanguage(translationRecord?.language),
      title: translationRecord ? holdText(translationRecord.title).text || null : null,
      text: translationBody.text,
      truncated: translationBody.truncated,
      injection: translationBody.injection || (translationRecord ? holdText(translationRecord.title).injection : false),
      sourceRevision,
      isSourceRevision: false as const,
    }
    : null;
  const label = holdText(firstString(record, ['officialCitation', 'official_cite', 'citation']));
  const note = holdText(firstString(record, ['statusNote', 'status_note']));
  const embedded = holdText(record.jsonld);
  const safeLabel = label.text && !label.injection && !PROMOTES.test(label.text) && label.text.trim().length <= 300
    ? label.text.trim()
    : null;
  const injection = title.injection || body.injection || label.injection || note.injection || embedded.injection || Boolean(translation?.injection);
  return {
    contentId,
    recordId: safeRecordId(firstString(record, ['recordId', 'law_id'])),
    sourceRevision,
    citable: Boolean(contentId && sourceRevision),
    title,
    body,
    language: safeLanguage(record.language),
    officialUrl: safeHttpUrl(firstString(record, ['sourceUrl', 'source_url'])),
    citationLabel: label.text || null,
    safeLabel,
    retrievedAt: typeof record.retrievedAt === 'string' ? record.retrievedAt.trim().slice(0, 80)
      : typeof record.retrieved_at === 'string' ? record.retrieved_at.trim().slice(0, 80) : null,
    recordedStatus: recordedStatus(firstString(record, ['status', 'law_status'])),
    translation,
    injection,
  };
}

function holdProof(value: unknown): HeldProof | null {
  const record = asRecord(value);
  if (!record) return null;
  const formula = holdText(record.deontic_temporal_fol);
  const note = holdText(record.zkp_security_note);
  const calculus = holdText(record.deontic_cognitive_event_calculus);
  const frame = holdText(record.frame_logic_ergo);
  const title = holdText(record.title);
  const backend = typeof record.zkp_backend === 'string' ? record.zkp_backend.trim().toLowerCase() : '';
  return {
    contentId: safeCid(record.ipfs_cid),
    sourceRevision: pinnedRevision(firstString(record, ['sourceRevision', 'source_revision'])),
    formula,
    backend,
    verified: record.zkp_verified === true,
    folStatus: typeof record.fol_status === 'string' ? record.fol_status.trim().toLowerCase() : '',
    deonticStatus: typeof record.deontic_status === 'string' ? record.deontic_status.trim().toLowerCase() : '',
    normType: enumToken(record.norm_type, ['obligation', 'permission', 'prohibition', 'unknown']),
    normOperator: enumToken(record.norm_operator, ['o', 'p', 'f', 'unknown']),
    injection: formula.injection || note.injection || calculus.injection || frame.injection || title.injection || scanText(backend),
  };
}

function certificateCopy(status: SimulatedVerificationResult['status'] | 'absent', copy: ResearchCopy): string {
  if (status === 'simulated_certificate_present') {
    return 'Simulated certificate metadata is present. This is not cryptographic verification.';
  }
  if (status === 'missing') return 'Simulated certificate metadata is absent or marked unverified.';
  if (status === 'unsupported_backend') return 'No simulated certificate metadata was verified.';
  return copy.unknown;
}

function emptyProof(copy: ResearchCopy): ResearchProofView {
  return {
    kind: 'unknown',
    incomplete: false,
    establishesApplicability: false,
    establishesCurrentLaw: false,
    cryptographic: false,
    certificateStatus: 'absent',
    certificate: copy.unknown,
    contentId: null,
    injection: false,
    formula: null,
    normType: null,
    normOperator: null,
  };
}

function formalizationIncomplete(proof: HeldProof): boolean {
  return !proof.formula.text.trim() || proof.folStatus !== 'success' || proof.deonticStatus !== 'success';
}

function classifyProof(proof: HeldProof | null, passage: HeldPassage, copy: ResearchCopy): ResearchProofView {
  if (!passage.citable || !proof || proof.contentId !== passage.contentId) return emptyProof(copy);
  if (proof.sourceRevision && proof.sourceRevision !== passage.sourceRevision) return emptyProof(copy);
  const checked = verifySimulatedCertificate({
    zkp_backend: proof.backend || undefined,
    zkp_verified: proof.verified,
  });
  const incomplete = formalizationIncomplete(proof);
  let kind: ProofOutputKind = 'unknown';
  if (proof.backend === 'simulated') kind = 'simulated';
  else if (incomplete) kind = 'incomplete';
  const formula = proof.formula.text.trim() ? proof.formula.text : null;
  return {
    kind,
    incomplete,
    establishesApplicability: false,
    establishesCurrentLaw: false,
    cryptographic: false,
    certificateStatus: checked.status,
    certificate: certificateCopy(checked.status, copy),
    contentId: proof.contentId,
    injection: proof.injection,
    formula,
    normType: proof.normType,
    normOperator: proof.normOperator,
  };
}

function readSuppliedCitation(value: unknown): { contentId: string; sourceRevision: string } | null {
  const record = asRecord(value);
  if (!record) return null;
  const contentId = safeCid(firstString(record, ['cid', 'contentId', 'ipfs_cid']));
  const sourceRevision = pinnedRevision(firstString(record, ['sourceRevision', 'source_revision']));
  if (!contentId || !sourceRevision) return null;
  return { contentId, sourceRevision };
}

function foreignRevision(text: string, cited: readonly { sourceRevision: string }[]): boolean {
  const allowed = new Set(cited.map((item) => item.sourceRevision));
  REVISION_CLAIM.lastIndex = 0;
  let match = REVISION_CLAIM.exec(text);
  while (match) {
    const claim = match[1] ?? '';
    if (!allowed.has(claim)) return true;
    match = REVISION_CLAIM.exec(text);
  }
  return false;
}

function answerLine(passage: HeldPassage): string {
  const record = passage.recordId ? ` Record ${passage.recordId}.` : '';
  return `Retrieved version ${passage.sourceRevision}. Content ${passage.contentId}.${record}`;
}

interface SuppliedDecision {
  status: 'accepted' | 'rejected' | 'absent';
  reasons: string[];
  text: string;
  citations: HeldPassage[];
  injection: boolean;
}

function decideSupplied(answer: SuppliedAnswerInput | null | undefined, passages: readonly HeldPassage[]): SuppliedDecision {
  if (!answer) return { status: 'absent', reasons: [], text: '', citations: [], injection: false };
  const text = typeof answer.text === 'string' ? answer.text.replace(/\u0000/g, '').trim() : '';
  const listed = Array.isArray(answer.citations) ? answer.citations : [];
  const reasons: string[] = [];
  const injection = text ? scanText(text) : false;
  if (text.length > MAX_TEXT) reasons.push('oversized');
  if (!text || listed.length === 0) reasons.push('missing-citation');
  const parsed = listed.map(readSuppliedCitation);
  const citable = passages.filter((passage) => passage.citable && passage.contentId && passage.sourceRevision);
  const matched: HeldPassage[] = [];
  if (listed.length > 0 && parsed.some((item) => !item)) reasons.push('version-mismatch');
  for (const item of parsed) {
    if (!item) continue;
    const found = citable.find((passage) => passage.contentId === item.contentId && passage.sourceRevision === item.sourceRevision);
    if (!found) reasons.push('version-mismatch');
    else if (!matched.some((passage) => passage.contentId === found.contentId && passage.sourceRevision === found.sourceRevision)) matched.push(found);
  }
  if (text && matched.length > 0) {
    for (const passage of matched) {
      if (!text.includes(passage.sourceRevision ?? '') || !text.includes(passage.contentId ?? '')) reasons.push('version-not-referenced');
    }
    if (foreignRevision(text, matched.map((passage) => ({ sourceRevision: passage.sourceRevision ?? '' })))) reasons.push('foreign-revision');
  }
  if (injection) reasons.push('instruction');
  if (text && PROMOTES.test(text)) reasons.push('applicability-claim');
  const unique = [...new Set(reasons)];
  if (unique.length > 0 || matched.length === 0) {
    return { status: 'rejected', reasons: unique.length > 0 ? unique : ['missing-citation'], text: '', citations: [], injection };
  }
  return { status: 'accepted', reasons: [], text, citations: matched, injection: false };
}

function extractedText(passages: readonly HeldPassage[], copy: ResearchCopy): string {
  const cited = passages.filter((passage) => passage.citable);
  if (cited.length === 0) return copy.nonePinned;
  return [copy.preface, ...cited.map(answerLine)].join('\n');
}

export function composeCitedResearch(input?: ResearchInput | null): ResearchView {
  const source = input && typeof input === 'object' ? input : {};
  const locale = localeOf(source.locale);
  const copy = researchCopy(locale);
  const passageInput = Array.isArray(source.passages) ? source.passages : [];
  const proofInput = Array.isArray(source.proofs) ? source.proofs : [];
  const droppedPassages = Math.max(0, passageInput.length - MAX_PASSAGES);
  const droppedProofs = Math.max(0, proofInput.length - MAX_PROOFS);
  const held: HeldPassage[] = [];
  let duplicatePassages = 0;
  for (const value of passageInput.slice(0, MAX_PASSAGES)) {
    const passage = holdPassage(value);
    if (!passage) continue;
    const duplicate = passage.citable && held.some((item) => item.contentId === passage.contentId && item.sourceRevision === passage.sourceRevision);
    if (duplicate) {
      duplicatePassages += 1;
      continue;
    }
    held.push(passage);
  }
  const proofs: HeldProof[] = [];
  for (const value of proofInput.slice(0, MAX_PROOFS)) {
    const proof = holdProof(value);
    if (!proof?.contentId) continue;
    if (proofs.some((item) => item.contentId === proof.contentId && item.sourceRevision === proof.sourceRevision)) continue;
    proofs.push(proof);
  }
  const questionHeld = holdText(source.query);
  const question = questionHeld.text.trim()
    ? { text: questionHeld.text.trim().slice(0, MAX_TEXT), injection: questionHeld.injection }
    : null;
  const supplied = decideSupplied(asRecord(source.suppliedAnswer) ? source.suppliedAnswer ?? null : source.suppliedAnswer ?? null, held);
  const citedKeys = new Set(
    (supplied.status === 'accepted' ? supplied.citations : held.filter((passage) => passage.citable))
      .map((passage) => `${passage.contentId}\u0000${passage.sourceRevision}`),
  );
  const passages = held.map((passage) => {
    const proof = proofs.find((item) => item.contentId === passage.contentId && (!item.sourceRevision || item.sourceRevision === passage.sourceRevision)) ?? null;
    const viewProof = classifyProof(passage.citable ? proof : null, passage, copy);
    return {
      contentId: passage.contentId,
      recordId: passage.recordId,
      sourceRevision: passage.sourceRevision,
      citable: passage.citable,
      version: passage.citable ? 'pinned' as const : 'unpinned' as const,
      citedInAnswer: citedKeys.has(`${passage.contentId}\u0000${passage.sourceRevision}`),
      title: passage.title.text,
      text: passage.body.text,
      textTruncated: passage.body.truncated,
      language: passage.language,
      direction: textDirection(passage.language),
      officialUrl: passage.officialUrl,
      citationLabel: passage.citationLabel,
      retrievedAt: passage.retrievedAt,
      recordedStatus: passage.recordedStatus,
      injection: passage.injection,
      translation: passage.translation,
      proof: viewProof,
    };
  });
  const answerPassages = supplied.status === 'accepted'
    ? supplied.citations
    : held.filter((passage) => passage.citable);
  const citations: ResearchCitation[] = answerPassages.map((passage) => {
    const route = passage.recordId
      ? buildLawDeepLink({
        publisherUrl: passage.officialUrl ?? '',
        recordId: passage.recordId,
        sourceRevision: passage.sourceRevision,
        sectionId: passage.contentId,
      }).applicationRoute
      : null;
    return {
      contentId: passage.contentId ?? '',
      sourceRevision: passage.sourceRevision ?? '',
      recordId: passage.recordId,
      label: passage.safeLabel,
      href: route,
      retrievedAt: passage.retrievedAt,
    };
  });
  const answer: ResearchAnswerView | null = held.length === 0 ? null : {
    optional: true,
    material: 'generated',
    grounding: supplied.status === 'accepted' ? 'supplied' : 'extracted',
    text: supplied.status === 'accepted' ? supplied.text : extractedText(held, copy),
    citations,
    rejectedReasons: supplied.status === 'rejected' ? supplied.reasons : [],
  };
  const injectionResisted = Boolean(question?.injection || supplied.injection || supplied.reasons.includes('instruction')
    || passages.some((passage) => passage.injection || passage.proof.injection || passage.translation?.injection));
  return {
    schema: RESEARCH_SCHEMA,
    applicability: RESEARCH_APPLICABILITY,
    establishesApplicability: false,
    establishesCurrentLaw: false,
    dependency: RESEARCH_DEPENDENCY,
    limitations: RESEARCH_LIMITATIONS,
    ignoredRuntimes: ignoredRuntimes(source),
    droppedPassages,
    droppedProofs,
    duplicatePassages,
    injectionResisted,
    queryFollowed: false,
    question,
    suppliedAnswer: { status: supplied.status, reasons: supplied.reasons },
    answer,
    passages,
  };
}

function translationLabel(kind: TranslationKind, copy: ResultCopy): string {
  if (kind === 'machine') return copy.machine_translation;
  if (kind === 'official') return copy.official_translation;
  return copy.translation;
}

function proofLabel(kind: ProofOutputKind, copy: ResearchCopy): string {
  if (kind === 'simulated') return copy.simulated;
  if (kind === 'incomplete') return copy.incomplete;
  return copy.unknown;
}

export interface ResearchPanelProps {
  passages?: readonly ResearchPassageInput[] | null;
  proofs?: readonly ProofSummaryInput[] | null;
  suppliedAnswer?: SuppliedAnswerInput | null;
  query?: string | null;
  locale?: ResultLocale | null;
  llm?: unknown;
  backend?: unknown;
  fetch?: unknown;
  ask?: unknown;
  complete?: unknown;
  prove?: unknown;
  model?: unknown;
  embed?: unknown;
  search?: unknown;
}

export function ResearchPanel(props: ResearchPanelProps) {
  const titleId = useId();
  const [open, setOpen] = useState(true);
  const locale = localeOf(props.locale);
  const ui = resultCopy(locale);
  const copy = researchCopy(locale);
  const view = composeCitedResearch({ ...props, locale });
  return (
    <section
      className="wwl"
      lang={ui.lang}
      dir={ui.dir}
      data-schema={RESEARCH_SCHEMA}
      data-applicability={RESEARCH_APPLICABILITY}
      data-establishes-applicability="false"
      data-establishes-current-law="false"
      data-search-requires-llm="false"
      data-search-requires-backend="false"
      data-query-followed="false"
      aria-labelledby={titleId}
    >
      <h2 id={titleId}>{copy.title}</h2>
      <p className="wwl-applicability" data-field="applicability">{ui.applicability}</p>
      <p data-field="optional">{copy.optional}</p>
      {view.question ? (
        <p data-field="question" data-query-followed="false" data-injection={view.question.injection ? 'true' : 'false'}>
          <span className="wwl-badge">{copy.question}</span>
          {' '}
          {view.question.text}
        </p>
      ) : null}
      {view.injectionResisted ? <p role="status" data-field="injection">{copy.injection}</p> : null}
      {view.answer ? (
        <div data-field="answer-slot">
          <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
            {open ? copy.hide : copy.show}
          </button>
          {open ? (
            <article data-material="generated" data-role="answer" data-grounding={view.answer.grounding} data-optional="true" data-untrusted={view.answer.grounding === 'supplied' ? 'true' : 'false'} aria-label={copy.generated}>
              <h3>{copy.generated}</h3>
              <p data-field="answer-text">{view.answer.text}</p>
              <ol>
                {view.answer.citations.map((citation) => (
                  <li key={`${citation.contentId}:${citation.sourceRevision}`} data-field="citation" data-revision={citation.sourceRevision} data-cid={citation.contentId}>
                    <span className="wwl-identifier" data-field="answer-revision">{citation.sourceRevision}</span>
                    <span className="wwl-identifier" data-field="answer-cid">{citation.contentId}</span>
                    {citation.label ? <span data-field="citation-label">{citation.label}</span> : null}
                    {citation.href ? <a href={citation.href} data-field="version-link">{copy.openVersion}</a> : null}
                  </li>
                ))}
              </ol>
            </article>
          ) : null}
        </div>
      ) : <p data-field="no-answer">{copy.noAnswer}</p>}
      <ol>
        {view.passages.map((passage, index) => (
          <li
            key={`${passage.contentId ?? 'none'}:${passage.sourceRevision ?? 'none'}:${index}`}
            data-cid={passage.contentId ?? ''}
            data-revision={passage.sourceRevision ?? ''}
            data-citable={passage.citable ? 'true' : 'false'}
            data-version={passage.version}
            data-cited={passage.citedInAnswer ? 'true' : 'false'}
          >
            <article data-material="source" data-untrusted="true" lang={passage.language ?? undefined} dir={passage.direction ?? undefined}>
              <h3>{copy.source}</h3>
              <p className="wwl-badge" data-field="source-title">{passage.title}</p>
              <p data-field="source-text" data-role="source-text">{passage.text}</p>
              {passage.citationLabel ? <p className="wwl-citation" data-field="source-citation">{passage.citationLabel}</p> : null}
              <p data-field="recorded-status" data-recorded-status={passage.recordedStatus}>
                {passage.recordedStatus}
                {' '}
                {copy.statusNotProof}
              </p>
              {passage.sourceRevision ? <p className="wwl-identifier" data-field="source-revision">{passage.sourceRevision}</p> : <p data-field="unpinned">{copy.unpinned}</p>}
              {passage.officialUrl ? <a href={passage.officialUrl} data-field="official-link" target="_blank" rel="noreferrer">{copy.officialLink}</a> : null}
            </article>
            {passage.translation ? (
              <article data-material="translated" data-untrusted="true" data-translation-kind={passage.translation.kind} data-translation-is-revision="false" lang={passage.translation.language ?? undefined} dir={textDirection(passage.translation.language) ?? undefined}>
                <h3 data-field="translation-label">{translationLabel(passage.translation.kind, ui)}</h3>
                {passage.translation.title ? <p data-field="translation-title">{passage.translation.title}</p> : null}
                <p data-field="translation-text" data-role="translation-text">{passage.translation.text}</p>
                <p data-field="translation-revision">{copy.translationNotRevision} <span className="wwl-identifier">{passage.sourceRevision}</span></p>
              </article>
            ) : null}
            <article
              data-proof={passage.proof.kind}
              data-proof-incomplete={passage.proof.incomplete ? 'true' : 'false'}
              data-establishes-applicability="false"
              data-establishes-current-law="false"
              data-cryptographic="false"
              data-untrusted="true"
            >
              <h3>{copy.proof}</h3>
              <p data-field="proof-label" data-role="proof-label">{proofLabel(passage.proof.kind, copy)}</p>
              <p data-field="proof-cannot">{copy.cannot}</p>
              {passage.proof.incomplete && passage.proof.kind !== 'incomplete' ? <p data-field="proof-also-incomplete">{copy.incomplete}</p> : null}
              {passage.proof.normType ? <p data-field="norm-type" data-material="generated">{passage.proof.normType}</p> : null}
              {passage.proof.normOperator ? <p data-field="norm-operator" data-material="generated">{passage.proof.normOperator}</p> : null}
              <p data-field="certificate">{passage.proof.certificate}</p>
              {passage.proof.formula ? (
                <p data-material="generated" data-role="proof-formalization" data-field="proof-formula" data-injection={passage.proof.injection ? 'true' : 'false'}>{passage.proof.formula}</p>
              ) : null}
            </article>
          </li>
        ))}
      </ol>
      <details>
        <summary>{copy.limits}</summary>
        <ul>
          {view.limitations.map((item) => <li key={item} data-field="limitation">{item}</li>)}
        </ul>
      </details>
    </section>
  );
}

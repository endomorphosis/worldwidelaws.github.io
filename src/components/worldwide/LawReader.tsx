/**
 * Versioned law reader.
 *
 * The text on screen is the source section that was requested. A missing or
 * floating revision does not fall through to a different revision. Copy and
 * share use that same revision. Back to results keeps the query and scroll
 * that opened the reader.
 *
 * An as-of value uses the source date precision. A civil date is not shifted.
 * A zoned instant is converted only in a timezone the source itself states.
 * The browser timezone is not a source timezone. Unknown dates stay unknown.
 * Rights come from the pinned record. Organization membership is not a license,
 * and an unresolved grant does not become a download.
 */

import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import {
  buildLawDeepLink,
  readVersionMetadata,
  sourceRevisionOf,
  toIpfsUri,
  type CorpusManifest,
  type CorpusSection,
  type DatePrecision,
} from '../../lib/worldwide/contracts';
import {
  labelNetherlandsSampleManifest,
  labelNetherlandsSampleSection,
} from '../../lib/worldwide/adapters/netherlands';
import { intervalStatus, type ValidityInterval } from '../../lib/worldwide/jurisdiction/schema';
import { resultCopy, type ResultCopy, type ResultLocale } from './SearchFilters';
import '../../styles/worldwide.css';

export const READER_SCHEMA = 'worldwide-legal-search.law-reader@1';
export const BUNDLED_MANIFEST_URL = '/corpus/netherlands/current/artifacts.manifest.json';
export const BUNDLED_SECTIONS_PREFIX = '/corpus/netherlands/current/generated/sections.json';

/** Pinned rights row for justicedao/wetwijzer_netherlands_legal_corpus. Download stays closed. */
export const BUNDLED_NETHERLANDS_RIGHTS = {
  datasetId: 'justicedao/wetwijzer_netherlands_legal_corpus',
  artifactRevision: '34449a893dbf4e77c64c036626873c452be11580',
  cardSha256: '59a1b0e07e350e88cc0f092594cb60c0e8b2bf9f5ab2e67d906ede08113a0aa8',
  status: 'unresolved' as const,
  rights: null,
  attribution: null,
  inferredFromOrganization: false,
  grantSource: 'no-grant',
  blocker: 'The pinned card does not state a dataset-wide redistribution grant (card license text: other). Organization membership was not used.',
  restrictions: [] as string[],
};

const FLOATING_REVISIONS = new Set([
  'head', 'main', 'master', 'latest', 'trunk', 'current', 'floating', 'unpinned',
  'none', 'null', 'undefined', 'tip', 'dev', 'develop',
]);

const RTL_LANGUAGES = new Set(['ar', 'he', 'fa', 'ur', 'ps', 'dv']);

export interface ReaderTranslation {
  kind: 'machine' | 'official';
  language: string | null;
  title: string | null;
  text: string;
}

export interface ReaderRights {
  status: 'resolved' | 'unresolved' | 'absent';
  rights: string | null;
  attribution: string | null;
  inferredFromOrganization: boolean;
  blocker: string | null;
  grantSource: string | null;
  downloadPermitted: boolean;
  restrictions: string[];
  artifactRevision: string | null;
  datasetId: string | null;
  cardSha256: string | null;
}

export interface ReaderRightsInput {
  status?: string | null;
  rights?: string | null;
  attribution?: string | null;
  inferredFromOrganization?: boolean | null;
  inferred_from_organization?: boolean | null;
  blocker?: string | null;
  grantSource?: string | null;
  grant_source?: string | null;
  downloadPermitted?: boolean | null;
  restrictions?: readonly string[] | null;
  artifactRevision?: string | null;
  artifact_revision?: string | null;
  datasetId?: string | null;
  dataset_id?: string | null;
  cardSha256?: string | null;
  card_sha256?: string | null;
}

export type ReaderSectionInput = CorpusSection & {
  translation?: { kind?: string | null; language?: string | null; title?: string | null; text?: string | null } | null;
  source_revision?: string | null;
  text_version_id?: string | null;
  issuer?: string | null;
  language?: string | null;
  time_zone?: string | null;
  version_end_open?: boolean | null;
  download_url?: string | null;
  rights?: ReaderRightsInput | null;
};

export interface ReaderSection {
  cid: string;
  recordId: string;
  identifier: string;
  title: string;
  text: string;
  sourceUrl: string;
  officialCitation: string;
  bluebook: string | null;
  status: string | null;
  language: string | null;
  articleNumber: string | null;
  articleLabel: string;
  instrumentTitle: string;
  issuer: string | null;
  retrievedAt: string | null;
  effectiveDate: string | null;
  versionStart: string | null;
  versionEnd: string | null;
  versionEndOpen: boolean;
  sourceRevision: string;
  textVersionId: string;
  translation: ReaderTranslation | null;
  timeZone: string | null;
  breadcrumbs: string[];
  downloadUrl: string | null;
  rights: ReaderRights | null;
  statusSource: string | null;
  statusNote: string | null;
  contentAddress: string;
  isCurrent: boolean | null;
}

export interface ReaderCorpus {
  schema: typeof READER_SCHEMA;
  sourceRevision: string;
  datasetId: string | null;
  datasetPath: string | null;
  jurisdiction: string | null;
  sourceName: string | null;
  sourceLabel: string | null;
  coverageNote: string | null;
  corpusNote: string | null;
  provider: string | null;
  generatedAt: string | null;
  sections: ReaderSection[];
  rights: ReaderRights;
  timeZone: string | null;
}

export interface ReaderClock {
  input: string;
  kind: 'empty' | 'civil' | 'instant' | 'invalid';
  precision: DatePrecision | 'instant' | null;
  civil: string | null;
  timeZone: string | null;
  timeZoneApplied: boolean;
  problem: 'none' | 'invalid-date' | 'unknown-timezone' | 'invalid-timezone';
}

export interface ReaderVersionReading {
  kind: 'current' | 'historical' | 'future' | 'unknown';
  interval: 'inside' | 'outside' | 'unknown' | null;
  civilAsOf: string | null;
  precision: ReaderClock['precision'];
  timeZone: string | null;
  timeZoneApplied: boolean;
  disagreement: boolean;
  datesDoNotDecide: boolean;
  problem: ReaderClock['problem'];
}

export interface ReaderReturn {
  href: string;
  query: string;
  scroll: number;
  resultId: string | null;
  placeId: string | null;
  asOf: string | null;
}

export type ReaderSelection =
  | {
    kind: 'section';
    section: ReaderSection;
    reading: ReaderVersionReading;
    matches: ReaderSection[];
    alsoMatches: ReaderSection[];
  }
  | { kind: 'choose'; candidates: ReaderSection[]; reason: 'ambiguous' | 'timezone' | 'invalid' | 'several'; clock: ReaderClock }
  | { kind: 'none'; candidates: ReaderSection[]; reason: 'no-containment'; clock: ReaderClock }
  | { kind: 'floating'; revision: string }
  | { kind: 'missing-revision'; revision: string; available: ReaderSection[] }
  | { kind: 'missing-section' }
  | { kind: 'loading' }
  | { kind: 'outage' };

export interface ReaderCopy extends ResultCopy {
  back_to_results: string;
  copy_citation: string;
  copy_link: string;
  share: string;
  download: string;
  download_blocked: string;
  download_unpublished: string;
  source_outage: string;
  official_text: string;
  articles: string;
  versions: string;
  other_instruments: string;
  previous: string;
  next_provision: string;
  no_adjacent: string;
  rights_heading: string;
  text_revision: string;
  rights_revision: string;
  law_language: string;
  interface_language: string;
  version: string;
  effective: string;
  retrieved: string;
  issuer: string;
  not_a_revision: string;
  copied_citation: string;
  copied_link: string;
  shared: string;
  open_matching: string;
  floating: string;
  missing_revision: string;
  missing_section: string;
  choose_version: string;
  no_version_contains: string;
  timezone_unknown: string;
  invalid_date: string;
  dates_do_not_decide: string;
  status_disagreement: string;
  organization_not_license: string;
  current: string;
  breadcrumb: string;
  loading_source: string;
  retry: string;
  end_inclusive: string;
  also_matches: string;
  rights_card: string;
  grant_source: string;
  license: string;
  attribution: string;
  rights_status: string;
  blocker: string;
  status_source: string;
  provider: string;
  dataset: string;
  as_of_hint: string;
  publisher_record: string;
}

const READER_EXTRA: Record<ResultLocale, Omit<ReaderCopy, keyof ResultCopy>> = {
  en: {
    back_to_results: 'Back to results',
    copy_citation: 'Copy citation',
    copy_link: 'Copy link',
    share: 'Share',
    download: 'Download',
    download_blocked: 'Download is not permitted for this revision.',
    download_unpublished: 'No download is published for this revision.',
    source_outage: 'Source outage',
    official_text: 'Official text',
    articles: 'Articles',
    versions: 'Versions',
    other_instruments: 'Other instruments in this source revision',
    previous: 'Previous provision',
    next_provision: 'Next provision',
    no_adjacent: 'No adjacent provision is in this source revision.',
    rights_heading: 'Rights and provenance',
    text_revision: 'Text revision',
    rights_revision: 'Rights record revision',
    law_language: 'Law language',
    interface_language: 'Interface language',
    version: 'Version',
    effective: 'Effective date',
    retrieved: 'Retrieved',
    issuer: 'Issuer',
    not_a_revision: 'This translation is not a new source revision.',
    copied_citation: 'Copied the citation for revision',
    copied_link: 'Copied the link for revision',
    shared: 'Shared the link for revision',
    open_matching: 'Open the version that matches this date',
    floating: 'This revision is not pinned. The text is not shown under a floating label.',
    missing_revision: 'This source does not contain the requested revision.',
    missing_section: 'This source does not contain that section.',
    choose_version: 'More than one version contains this date at the source precision. Choose a version. None was selected for you.',
    no_version_contains: 'No version in this source contains this date.',
    timezone_unknown: 'The source timezone is unknown. This instant was not converted, and no version was selected from it.',
    invalid_date: 'This as-of value is not a year, month, day, or zoned instant.',
    dates_do_not_decide: 'The version dates do not decide the status.',
    status_disagreement: 'The source status and the version dates disagree.',
    organization_not_license: 'Organization membership is not a redistribution license.',
    current: 'Current',
    breadcrumb: 'Breadcrumb',
    loading_source: 'The source text is loading.',
    retry: 'Retry',
    end_inclusive: 'The end date stays inside at the source precision.',
    also_matches: 'Other versions also contain this date at the source precision.',
    rights_card: 'Rights card',
    grant_source: 'Grant source',
    license: 'License',
    attribution: 'Attribution',
    rights_status: 'Rights status',
    blocker: 'Rights blocker',
    status_source: 'Status source',
    provider: 'Provider',
    dataset: 'Dataset',
    as_of_hint: 'Year, month, day, or zoned instant',
    publisher_record: 'Publisher record',
  },
  nl: {
    back_to_results: 'Terug naar resultaten',
    copy_citation: 'Citaat kopiëren',
    copy_link: 'Link kopiëren',
    share: 'Delen',
    download: 'Downloaden',
    download_blocked: 'Downloaden is niet toegestaan voor deze revisie.',
    download_unpublished: 'Er is geen download gepubliceerd voor deze revisie.',
    source_outage: 'Bronstoring',
    official_text: 'Officiële tekst',
    articles: 'Artikelen',
    versions: 'Versies',
    other_instruments: 'Andere instrumenten in deze bronrevisie',
    previous: 'Vorige bepaling',
    next_provision: 'Volgende bepaling',
    no_adjacent: 'Er is geen aangrenzende bepaling in deze bronrevisie.',
    rights_heading: 'Rechten en herkomst',
    text_revision: 'Tekstrevisie',
    rights_revision: 'Revisie van het rechtenrecord',
    law_language: 'Taal van de wet',
    interface_language: 'Taal van de interface',
    version: 'Versie',
    effective: 'Datum van inwerkingtreding',
    retrieved: 'Opgehaald',
    issuer: 'Uitgever',
    not_a_revision: 'Deze vertaling is geen nieuwe bronrevisie.',
    copied_citation: 'Citaat gekopieerd voor revisie',
    copied_link: 'Link gekopieerd voor revisie',
    shared: 'Link gedeeld voor revisie',
    open_matching: 'Open de versie die bij deze datum hoort',
    floating: 'Deze revisie is niet vastgepind. De tekst wordt niet onder een zwevend label getoond.',
    missing_revision: 'Deze bron bevat de gevraagde revisie niet.',
    missing_section: 'Deze bron bevat die sectie niet.',
    choose_version: 'Meer dan één versie bevat deze datum op de precisie van de bron. Kies een versie. Er is er geen voor u gekozen.',
    no_version_contains: 'Geen versie in deze bron bevat deze datum.',
    timezone_unknown: 'De tijdzone van de bron is onbekend. Dit tijdstip is niet omgerekend en er is geen versie uit gekozen.',
    invalid_date: 'Deze peildatum is geen jaar, maand, dag of tijdstip met tijdzone.',
    dates_do_not_decide: 'De versiedata bepalen de status niet.',
    status_disagreement: 'De bronstatus en de versiedata spreken elkaar tegen.',
    organization_not_license: 'Lidmaatschap van een organisatie is geen licentie om te herdistribueren.',
    current: 'Huidig',
    breadcrumb: 'Kruimelpad',
    loading_source: 'De brontekst wordt geladen.',
    retry: 'Opnieuw proberen',
    end_inclusive: 'De einddatum valt er nog binnen op de precisie van de bron.',
    also_matches: 'Andere versies bevatten deze datum ook op de precisie van de bron.',
    rights_card: 'Rechtenkaart',
    grant_source: 'Bron van de rechten',
    license: 'Licentie',
    attribution: 'Naamsvermelding',
    rights_status: 'Rechtenstatus',
    blocker: 'Rechtenblokkade',
    status_source: 'Bron van de status',
    provider: 'Aanbieder',
    dataset: 'Dataset',
    as_of_hint: 'Jaar, maand, dag of tijdstip met tijdzone',
    publisher_record: 'Uitgeversrecord',
  },
  ar: {
    back_to_results: 'العودة إلى النتائج',
    copy_citation: 'نسخ الاستشهاد',
    copy_link: 'نسخ الرابط',
    share: 'مشاركة',
    download: 'تنزيل',
    download_blocked: 'التنزيل غير مسموح به لهذه المراجعة.',
    download_unpublished: 'لا تنزيل منشورًا لهذه المراجعة.',
    source_outage: 'تعطل المصدر',
    official_text: 'النص الرسمي',
    articles: 'المواد',
    versions: 'النسخ',
    other_instruments: 'صكوك أخرى في مراجعة المصدر هذه',
    previous: 'الحكم السابق',
    next_provision: 'الحكم التالي',
    no_adjacent: 'لا حكم مجاور في مراجعة المصدر هذه.',
    rights_heading: 'الحقوق والمصدر',
    text_revision: 'مراجعة النص',
    rights_revision: 'مراجعة سجل الحقوق',
    law_language: 'لغة القانون',
    interface_language: 'لغة الواجهة',
    version: 'النسخة',
    effective: 'تاريخ النفاذ',
    retrieved: 'تاريخ الجلب',
    issuer: 'جهة الإصدار',
    not_a_revision: 'هذه الترجمة ليست مراجعة مصدر جديدة.',
    copied_citation: 'نُسخ الاستشهاد للمراجعة',
    copied_link: 'نُسخ الرابط للمراجعة',
    shared: 'تمت مشاركة الرابط للمراجعة',
    open_matching: 'افتح النسخة التي تطابق هذا التاريخ',
    floating: 'هذه المراجعة غير مثبتة. لا يُعرض النص تحت تسمية عائمة.',
    missing_revision: 'هذا المصدر لا يحتوي على المراجعة المطلوبة.',
    missing_section: 'هذا المصدر لا يحتوي على ذلك القسم.',
    choose_version: 'أكثر من نسخة تحتوي هذا التاريخ بدقة المصدر. اختر نسخة. لم تُختر واحدة لك.',
    no_version_contains: 'لا نسخة في هذا المصدر تحتوي هذا التاريخ.',
    timezone_unknown: 'المنطقة الزمنية للمصدر غير معروفة. لم يُحوَّل هذا الوقت ولم تُختر نسخة منه.',
    invalid_date: 'قيمة التاريخ هذه ليست سنة أو شهرًا أو يومًا أو وقتًا بنطاق زمني.',
    dates_do_not_decide: 'تواريخ النسخة لا تقرر الحالة.',
    status_disagreement: 'حالة المصدر وتواريخ النسخة مختلفتان.',
    organization_not_license: 'الانتماء إلى منظمة ليس ترخيصًا لإعادة التوزيع.',
    current: 'سارية',
    breadcrumb: 'مسار التنقل',
    loading_source: 'يجري تحميل نص المصدر.',
    retry: 'إعادة المحاولة',
    end_inclusive: 'يبقى تاريخ النهاية داخل المدة على دقة المصدر.',
    also_matches: 'نسخ أخرى تحتوي هذا التاريخ أيضًا على دقة المصدر.',
    rights_card: 'بطاقة الحقوق',
    grant_source: 'مصدر الترخيص',
    license: 'الترخيص',
    attribution: 'النسبة',
    rights_status: 'حالة الحقوق',
    blocker: 'مانع الحقوق',
    status_source: 'مصدر الحالة',
    provider: 'المزوّد',
    dataset: 'مجموعة البيانات',
    as_of_hint: 'سنة أو شهر أو يوم أو وقت بنطاق زمني',
    publisher_record: 'سجل الناشر',
  },
  ja: {
    back_to_results: '結果に戻る',
    copy_citation: '引用をコピー',
    copy_link: 'リンクをコピー',
    share: '共有',
    download: 'ダウンロード',
    download_blocked: 'この版のダウンロードは許可されていません。',
    download_unpublished: 'この版のダウンロードは公開されていません。',
    source_outage: '情報源の障害',
    official_text: '公式テキスト',
    articles: '条',
    versions: '版',
    other_instruments: 'この情報源の版にある他の法令',
    previous: '前の規定',
    next_provision: '次の規定',
    no_adjacent: 'この情報源の版に隣接する規定はありません。',
    rights_heading: '権利と来歴',
    text_revision: '本文の版',
    rights_revision: '権利記録の版',
    law_language: '法令の言語',
    interface_language: '画面の言語',
    version: '版',
    effective: '施行日',
    retrieved: '取得日',
    issuer: '発行者',
    not_a_revision: 'この翻訳は新しい情報源の版ではありません。',
    copied_citation: '引用をコピーしました。版',
    copied_link: 'リンクをコピーしました。版',
    shared: 'リンクを共有しました。版',
    open_matching: 'この日付に合う版を開く',
    floating: 'この版は固定されていません。浮動するラベルの下に本文は表示しません。',
    missing_revision: 'この情報源に、指定された版はありません。',
    missing_section: 'この情報源に、その条文はありません。',
    choose_version: '情報源の精度では、この日付を含む版が複数あります。版を選んでください。こちらでは選んでいません。',
    no_version_contains: 'この情報源に、この日付を含む版はありません。',
    timezone_unknown: '情報源のタイムゾーンが不明です。この瞬間は変換せず、版も選んでいません。',
    invalid_date: 'この時点は、年、月、日、またはタイムゾーン付きの瞬間ではありません。',
    dates_do_not_decide: '版の日付は状態を決めません。',
    status_disagreement: '情報源の状態と版の日付が食い違っています。',
    organization_not_license: '組織への所属は再配布のライセンスではありません。',
    current: '現行',
    breadcrumb: 'パンくず',
    loading_source: '情報源の本文を読み込んでいます。',
    retry: '再試行',
    end_inclusive: '終了日は情報源の精度では期間に含まれます。',
    also_matches: 'この日付は、情報源の精度では他の版にも含まれます。',
    rights_card: '権利カード',
    grant_source: '許諾の出典',
    license: 'ライセンス',
    attribution: '帰属',
    rights_status: '権利の状態',
    blocker: '権利上の障害',
    status_source: '状態の出典',
    provider: '提供者',
    dataset: 'データセット',
    as_of_hint: '年、月、日、またはタイムゾーン付きの瞬間',
    publisher_record: '発行者の記録',
  },
};

export function readerCopy(locale: ResultLocale | null | undefined): ReaderCopy {
  const base = resultCopy(locale);
  return { ...base, ...READER_EXTRA[base.lang] };
}

function clean(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).trim();
  return text ? text : null;
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
  if (/^\d{4}$/.test(value) && calendarOk(value, 'year')) return 'year';
  if (/^\d{4}-\d{2}$/.test(value) && calendarOk(value, 'month')) return 'month';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value) && calendarOk(value, 'day')) return 'day';
  return null;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function offsetMinutes(zone: string): number | null {
  if (zone === 'Z' || zone === 'UTC' || zone === 'Etc/UTC' || zone === 'GMT') return 0;
  const match = /^([+-])(\d{2}):(\d{2})$/.exec(zone);
  if (!match) return null;
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  if (hours > 14 || minutes > 59 || (hours === 14 && minutes !== 0)) return null;
  return (match[1] === '-' ? -1 : 1) * (hours * 60 + minutes);
}

function zoneAccepted(zone: string): boolean {
  if (offsetMinutes(zone) !== null) return true;
  if (!/^[A-Za-z][A-Za-z0-9_+/-]{0,63}$/.test(zone)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone }).format(0);
    return true;
  } catch {
    return false;
  }
}

function civilFromMilliseconds(milliseconds: number, zone: string): string | null {
  const offset = offsetMinutes(zone);
  if (offset !== null) {
    const shifted = new Date(milliseconds + offset * 60_000);
    const year = shifted.getUTCFullYear();
    if (year < 1 || year > 9999) return null;
    return `${String(year).padStart(4, '0')}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
  }
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(milliseconds));
  } catch {
    return null;
  }
  const picked = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  const civil = `${picked('year').padStart(4, '0')}-${picked('month').padStart(2, '0')}-${picked('day').padStart(2, '0')}`;
  return calendarOk(civil, 'day') ? civil : null;
}

function parseInstant(value: string): { milliseconds: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return null;
  const civil = `${match[1]}-${match[2]}-${match[3]}`;
  if (!calendarOk(civil, 'day')) return null;
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (hour > 23 || minute > 59 || second > 59) return null;
  const fraction = match[7] ? match[7].slice(0, 3).padEnd(3, '0') : '000';
  const offset = offsetMinutes(match[8]);
  if (offset === null) return null;
  const utcWall = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), hour, minute, second, Number(fraction));
  return { milliseconds: utcWall - offset * 60_000 };
}

export function isFloatingRevision(value: string | null | undefined): boolean {
  const text = clean(value);
  if (!text) return false;
  if (FLOATING_REVISIONS.has(text.toLowerCase())) return true;
  return /(?:^|\/)(?:head|main|master|latest)$/i.test(text) || /^refs\//i.test(text);
}

export function textDirection(language: string | null | undefined): 'rtl' | 'ltr' | 'auto' {
  const base = clean(language)?.toLowerCase().split('-')[0];
  if (!base) return 'auto';
  return RTL_LANGUAGES.has(base) ? 'rtl' : 'ltr';
}

function bundledRights(): ReaderRights {
  return {
    status: BUNDLED_NETHERLANDS_RIGHTS.status,
    rights: BUNDLED_NETHERLANDS_RIGHTS.rights,
    attribution: BUNDLED_NETHERLANDS_RIGHTS.attribution,
    inferredFromOrganization: BUNDLED_NETHERLANDS_RIGHTS.inferredFromOrganization,
    blocker: BUNDLED_NETHERLANDS_RIGHTS.blocker,
    grantSource: BUNDLED_NETHERLANDS_RIGHTS.grantSource,
    downloadPermitted: false,
    restrictions: [...BUNDLED_NETHERLANDS_RIGHTS.restrictions],
    artifactRevision: BUNDLED_NETHERLANDS_RIGHTS.artifactRevision,
    datasetId: BUNDLED_NETHERLANDS_RIGHTS.datasetId,
    cardSha256: BUNDLED_NETHERLANDS_RIGHTS.cardSha256,
  };
}

export function normalizeRights(input: ReaderRightsInput | null | undefined, fallback?: ReaderRights | null): ReaderRights {
  const base = fallback ?? bundledRights();
  if (!input) return base;
  const statusText = clean(input.status);
  const status = statusText === 'resolved' || statusText === 'absent' ? statusText : statusText === 'unresolved' || statusText ? 'unresolved' : base.status;
  const rights = clean(input.rights);
  const inferred = input.inferredFromOrganization === true || input.inferred_from_organization === true;
  const blocker = clean(input.blocker);
  const resolved = status === 'resolved' && Boolean(rights) && !inferred && !blocker;
  const permitted = resolved && input.downloadPermitted !== false;
  return {
    status,
    rights,
    attribution: clean(input.attribution),
    inferredFromOrganization: inferred,
    blocker,
    grantSource: clean(input.grantSource) || clean(input.grant_source),
    downloadPermitted: permitted,
    restrictions: [...(input.restrictions ?? [])].map((item) => String(item)).filter(Boolean),
    artifactRevision: clean(input.artifactRevision) || clean(input.artifact_revision),
    datasetId: clean(input.datasetId) || clean(input.dataset_id),
    cardSha256: clean(input.cardSha256) || clean(input.card_sha256),
  };
}

function splitTitle(title: string, chapter: string | null): { instrument: string; article: string } {
  const parts = title.split(' - ');
  if (parts.length > 1) {
    return { instrument: parts.slice(0, -1).join(' - '), article: parts[parts.length - 1] };
  }
  return { instrument: title, article: chapter || title };
}

function articleRank(label: string): [number, string] {
  const match = /(\d+)/.exec(label);
  return [match ? Number(match[1]) : Number.MAX_SAFE_INTEGER, label];
}

function translationOf(input: ReaderSectionInput['translation']): ReaderTranslation | null {
  if (!input || typeof input !== 'object') return null;
  const text = clean(input.text);
  const kind = input.kind === 'official' ? 'official' : input.kind === 'machine' ? 'machine' : null;
  if (!text || !kind) return null;
  return { kind, language: clean(input.language), title: clean(input.title), text };
}

function toReaderSection(section: ReaderSectionInput, corpusRevision: string, jurisdiction: string | null): ReaderSection {
  const title = clean(section.title) ?? '';
  const chapter = clean(section.chapter);
  const split = splitTitle(title, chapter);
  const articleLabel = clean(section.article_heading) || clean(section.article_label) || chapter || split.article;
  const recordId = clean(section.law_id) || clean(section.title_number) || clean(section.identifier) || clean(section.ipfs_cid) || '';
  const hierarchy = (section.hierarchy_labels ?? []).map((item) => clean(item)).filter((item): item is string => Boolean(item));
  const breadcrumbs = hierarchy.length > 0
    ? [jurisdiction, ...hierarchy].filter((item): item is string => Boolean(item))
    : [jurisdiction, split.instrument, articleLabel].filter((item): item is string => Boolean(item));
  return {
    cid: section.ipfs_cid,
    recordId,
    identifier: clean(section.identifier) ?? section.ipfs_cid,
    title,
    text: typeof section.text === 'string' ? section.text : '',
    sourceUrl: clean(section.source_url) ?? '',
    officialCitation: clean(section.official_cite) || clean(section.citation) || clean(section.document_citation) || '',
    bluebook: clean(section.bluebook_citation),
    status: clean(section.law_status),
    language: clean(section.language),
    articleNumber: clean(section.article_number),
    articleLabel,
    instrumentTitle: split.instrument,
    issuer: clean(section.issuer),
    retrievedAt: clean(section.retrieved_at) || clean(section.scraped_at),
    effectiveDate: clean(section.effective_date),
    versionStart: clean(section.version_start_date) || clean(section.valid_from),
    versionEnd: clean(section.version_end_date) || clean(section.valid_to),
    versionEndOpen: section.version_end_open === true,
    sourceRevision: clean(section.source_revision) || corpusRevision,
    textVersionId: clean(section.text_version_id) || section.ipfs_cid,
    translation: translationOf(section.translation),
    timeZone: clean(section.time_zone),
    breadcrumbs,
    downloadUrl: clean(section.download_url),
    rights: section.rights ? normalizeRights(section.rights, null) : null,
    statusSource: clean(section.status_source),
    statusNote: clean(section.status_note),
    contentAddress: clean(section.content_address) || toIpfsUri(section.ipfs_cid),
    isCurrent: typeof section.is_current === 'boolean' ? section.is_current : null,
  };
}

export function assembleReaderCorpus(input: {
  manifest: CorpusManifest;
  sections: readonly ReaderSectionInput[];
  rights?: ReaderRightsInput | null;
  labelSample?: boolean;
  timeZone?: string | null;
}): ReaderCorpus {
  const labelSample = input.labelSample !== false;
  const manifest = labelSample
    ? labelNetherlandsSampleManifest(input.manifest, {
      laws: new Set(input.sections.map((section) => section.law_id || section.title_number || section.identifier)).size,
      articles: input.sections.length,
      cidRows: input.sections.length,
    })
    : input.manifest;
  const labelled = labelSample
    ? input.sections.map((section) => labelNetherlandsSampleSection(section))
    : input.sections.map((section) => ({
      ...section,
      content_address: section.content_address || toIpfsUri(section.ipfs_cid),
    }));
  const version = readVersionMetadata(manifest);
  const sourceRevision = sourceRevisionOf(version) || manifest.generatedAt;
  const jurisdiction = clean(manifest.corpus.jurisdiction);
  return {
    schema: READER_SCHEMA,
    sourceRevision,
    datasetId: version.datasetId,
    datasetPath: version.datasetPath,
    jurisdiction,
    sourceName: clean(manifest.corpus.name),
    sourceLabel: clean(manifest.corpus.source),
    coverageNote: clean(manifest.corpus.publishedCorpus?.coverage),
    corpusNote: clean(manifest.corpus.note),
    provider: version.provider,
    generatedAt: version.generatedAt,
    sections: labelled.map((section) => toReaderSection(section, sourceRevision, jurisdiction)),
    rights: normalizeRights(input.rights, bundledRights()),
    timeZone: clean(input.timeZone),
  };
}

export async function fetchBundledReaderCorpus(fetcher: typeof fetch = fetch): Promise<ReaderCorpus> {
  const manifestResponse = await fetcher(BUNDLED_MANIFEST_URL, { cache: 'no-store' });
  if (!manifestResponse.ok) throw new Error(`Source outage: manifest HTTP ${manifestResponse.status}`);
  const manifest = await manifestResponse.json() as CorpusManifest;
  const stamp = encodeURIComponent(manifest.generatedAt || '');
  const sectionsResponse = await fetcher(`${BUNDLED_SECTIONS_PREFIX}?v=${stamp}`, { cache: 'no-store' });
  if (!sectionsResponse.ok) throw new Error(`Source outage: sections HTTP ${sectionsResponse.status}`);
  const sections = await sectionsResponse.json() as ReaderSectionInput[];
  if (!Array.isArray(sections) || sections.length === 0) throw new Error('Source outage: the source returned no sections.');
  return assembleReaderCorpus({ manifest, sections, labelSample: true });
}

function compareAtPrecision(left: string, right: string): number {
  const leftPrecision = precisionOf(left);
  const rightPrecision = precisionOf(right);
  if (!leftPrecision || !rightPrecision) return 0;
  const rank: Record<DatePrecision, number> = { year: 0, month: 1, day: 2 };
  const precision = rank[leftPrecision] <= rank[rightPrecision] ? leftPrecision : rightPrecision;
  const width = precision === 'year' ? 4 : precision === 'month' ? 7 : 10;
  const l = left.slice(0, width);
  const r = right.slice(0, width);
  if (l < r) return -1;
  if (l > r) return 1;
  return 0;
}

export function readerInterval(section: ReaderSection): ValidityInterval | null {
  const startPrecision = section.versionStart ? precisionOf(section.versionStart) : null;
  const endPrecision = section.versionEnd ? precisionOf(section.versionEnd) : null;
  const start = startPrecision
    ? { knowledge: 'known' as const, value: section.versionStart as string, precision: startPrecision, source: 'section' }
    : { knowledge: 'unknown' as const, value: null, precision: null, source: 'section' };
  const end = section.versionEndOpen
    ? { knowledge: 'open' as const, value: null, precision: null, source: 'section' }
    : endPrecision
      ? { knowledge: 'known' as const, value: section.versionEnd as string, precision: endPrecision, source: 'section' }
      : { knowledge: 'unknown' as const, value: null, precision: null, source: null };
  if (start.knowledge === 'unknown' && end.knowledge === 'unknown') return null;
  return { start, end };
}

export function resolveReaderClock(asOf: string | null | undefined, timeZone: string | null | undefined): ReaderClock {
  const input = clean(asOf) ?? '';
  if (!input) {
    return { input, kind: 'empty', precision: null, civil: null, timeZone: timeZone ?? null, timeZoneApplied: false, problem: 'none' };
  }
  const precision = precisionOf(input);
  if (precision) {
    return { input, kind: 'civil', precision, civil: input, timeZone: timeZone ?? null, timeZoneApplied: false, problem: 'none' };
  }
  const instant = parseInstant(input);
  if (!instant) {
    return { input, kind: 'invalid', precision: null, civil: null, timeZone: timeZone ?? null, timeZoneApplied: false, problem: 'invalid-date' };
  }
  const zone = clean(timeZone);
  if (!zone) {
    return { input, kind: 'instant', precision: 'instant', civil: null, timeZone: null, timeZoneApplied: false, problem: 'unknown-timezone' };
  }
  if (!zoneAccepted(zone)) {
    return { input, kind: 'instant', precision: 'instant', civil: null, timeZone: zone, timeZoneApplied: false, problem: 'invalid-timezone' };
  }
  const civil = civilFromMilliseconds(instant.milliseconds, zone);
  if (!civil) {
    return { input, kind: 'instant', precision: 'instant', civil: null, timeZone: zone, timeZoneApplied: false, problem: 'invalid-timezone' };
  }
  return { input, kind: 'instant', precision: 'instant', civil, timeZone: zone, timeZoneApplied: true, problem: 'none' };
}

function sourceKind(status: string | null): ReaderVersionReading['kind'] {
  const value = (status ?? '').toLowerCase();
  if (!value || value === 'unknown') return 'unknown';
  if (value === 'historical' || value === 'repealed' || value === 'superseded') return 'historical';
  if (value === 'not-yet-in-force' || value === 'future') return 'future';
  if (value === 'current' || value === 'in-force') return 'current';
  return 'unknown';
}

export function readVersion(section: ReaderSection, asOf: string | null | undefined, timeZone?: string | null): ReaderVersionReading {
  const zone = section.timeZone || clean(timeZone);
  const clock = resolveReaderClock(asOf, zone);
  const base = sourceKind(section.status);
  const window = readerInterval(section);
  let interval: ReaderVersionReading['interval'] = null;
  if (clock.civil && window) {
    try {
      interval = intervalStatus(window, clock.civil);
    } catch {
      interval = null;
    }
  }
  let kind = base;
  let disagreement = false;
  if (interval === 'outside' && clock.civil) {
    const before = Boolean(section.versionStart) && compareAtPrecision(clock.civil, section.versionStart as string) < 0;
    const dated: ReaderVersionReading['kind'] = before ? 'future' : 'historical';
    if (base !== 'unknown' && base !== dated) disagreement = true;
    kind = dated;
  }
  const datesDoNotDecide = Boolean(clock.input) && interval !== 'inside' && interval !== 'outside' && (base === 'current' || base === 'unknown');
  return {
    kind,
    interval,
    civilAsOf: clock.civil,
    precision: clock.precision,
    timeZone: zone,
    timeZoneApplied: clock.timeZoneApplied,
    disagreement,
    datesDoNotDecide,
    problem: clock.problem,
  };
}

function sameArticle(left: ReaderSection, right: ReaderSection): boolean {
  return (left.articleNumber || left.articleLabel) === (right.articleNumber || right.articleLabel);
}

function sameRecord(section: ReaderSection, recordId: string | null): boolean {
  if (!recordId) return true;
  return section.recordId === recordId || section.identifier === recordId || section.cid === recordId;
}

function containsCivil(section: ReaderSection, civil: string): boolean {
  const window = readerInterval(section);
  if (!window) return false;
  try {
    return intervalStatus(window, civil) === 'inside';
  } catch {
    return false;
  }
}

export function selectReaderView(corpus: ReaderCorpus, request: {
  recordId?: string | null;
  sectionId?: string | null;
  sourceRevision?: string | null;
  asOf?: string | null;
  timeZone?: string | null;
}): ReaderSelection {
  const revision = clean(request.sourceRevision);
  if (isFloatingRevision(revision)) return { kind: 'floating', revision: revision as string };
  const zone = clean(request.timeZone) || corpus.timeZone;
  const clock = resolveReaderClock(request.asOf, zone);
  const pinned = revision
    ? corpus.sections.filter((section) => section.sourceRevision === revision)
    : corpus.sections;
  if (revision && pinned.length === 0) return { kind: 'missing-revision', revision, available: corpus.sections };
  const recordId = clean(request.recordId);
  const sectionId = clean(request.sectionId);
  const recordPool = pinned.filter((section) => sameRecord(section, recordId));
  if (sectionId) {
    const found = corpus.sections.find((section) => section.cid === sectionId || section.textVersionId === sectionId);
    if (!found || (recordId && !sameRecord(found, recordId))) return { kind: 'missing-section' };
    if (revision && found.sourceRevision !== revision) return { kind: 'missing-revision', revision, available: corpus.sections };
    return finishSection(corpus, found, request.asOf, zone);
  }
  if (recordId && recordPool.length === 0) return { kind: 'missing-section' };
  const pool = recordId ? recordPool : pinned;
  if (clean(request.asOf)) {
    const clocks = pool.map((section) => ({
      section,
      clock: resolveReaderClock(request.asOf, section.timeZone || zone),
    }));
    const sample = clocks[0]?.clock ?? clock;
    const allInvalid = clocks.length > 0 && clocks.every((item) => item.clock.problem === 'invalid-date');
    if (allInvalid) {
      if (pool.length === 1) return finishSection(corpus, pool[0], request.asOf, pool[0].timeZone || zone);
      return { kind: 'choose', candidates: pool, reason: 'invalid', clock: sample };
    }
    const instantBlocked = clocks.length > 0 && clocks.every((item) => item.clock.kind === 'instant' && !item.clock.civil);
    if (instantBlocked) {
      if (pool.length === 1) return finishSection(corpus, pool[0], request.asOf, pool[0].timeZone || zone);
      return { kind: 'choose', candidates: pool, reason: 'timezone', clock: sample };
    }
    const inside = clocks
      .filter((item) => Boolean(item.clock.civil) && containsCivil(item.section, item.clock.civil as string))
      .map((item) => item.section);
    if (inside.length === 1) return finishSection(corpus, inside[0], request.asOf, inside[0].timeZone || zone);
    if (inside.length > 1) return { kind: 'choose', candidates: inside, reason: 'ambiguous', clock: sample };
    if (pool.length === 1 && !readerInterval(pool[0])) return finishSection(corpus, pool[0], request.asOf, pool[0].timeZone || zone);
    if (clocks.some((item) => item.clock.civil)) return { kind: 'none', candidates: pool, reason: 'no-containment', clock: sample };
  }
  if (pool.length === 1) return finishSection(corpus, pool[0], request.asOf, pool[0].timeZone || zone);
  const current = pool.filter((section) => section.isCurrent === true);
  if (current.length === 1) return finishSection(corpus, current[0], request.asOf, zone);
  return { kind: 'choose', candidates: pool, reason: 'several', clock };
}

function finishSection(corpus: ReaderCorpus, section: ReaderSection, asOf: string | null | undefined, timeZone: string | null): ReaderSelection {
  const reading = readVersion(section, asOf, section.timeZone || timeZone);
  const siblings = corpus.sections.filter((item) => item.recordId === section.recordId && item.textVersionId !== section.textVersionId && sameArticle(item, section));
  const matches = siblings.filter((item) => {
    const sibling = resolveReaderClock(asOf, item.timeZone || section.timeZone || timeZone);
    return Boolean(sibling.civil) && containsCivil(item, sibling.civil as string);
  });
  const alsoMatches = reading.interval === 'inside' ? matches : [];
  const outsideMatches = reading.interval === 'inside' ? [] : matches;
  return { kind: 'section', section, reading, matches: outsideMatches, alsoMatches };
}

export function articleSequence(corpus: ReaderCorpus, section: ReaderSection): ReaderSection[] {
  return corpus.sections
    .filter((item) => item.recordId === section.recordId && item.sourceRevision === section.sourceRevision)
    .slice()
    .sort((left, right) => {
      const a = articleRank(left.articleNumber || left.articleLabel);
      const b = articleRank(right.articleNumber || right.articleLabel);
      return a[0] - b[0] || a[1].localeCompare(b[1]) || left.cid.localeCompare(right.cid);
    });
}

export function adjacentProvisions(corpus: ReaderCorpus, section: ReaderSection): { previous: ReaderSection | null; next: ReaderSection | null } {
  const articles = articleSequence(corpus, section);
  const index = articles.findIndex((item) => item.cid === section.cid);
  if (index < 0) return { previous: null, next: null };
  return {
    previous: index > 0 ? articles[index - 1] : null,
    next: index < articles.length - 1 ? articles[index + 1] : null,
  };
}

export function otherInstruments(corpus: ReaderCorpus, section: ReaderSection): ReaderSection[] {
  const seen = new Set<string>();
  const rows: ReaderSection[] = [];
  for (const item of corpus.sections) {
    if (item.sourceRevision !== section.sourceRevision || item.recordId === section.recordId || seen.has(item.recordId)) continue;
    seen.add(item.recordId);
    rows.push(item);
  }
  return rows;
}

export function stableLawLink(section: ReaderSection): string {
  return buildLawDeepLink({
    publisherUrl: section.sourceUrl,
    recordId: section.recordId,
    sourceRevision: section.sourceRevision,
    sectionId: section.cid,
  }).applicationRoute ?? '';
}

export function citationText(section: ReaderSection): string {
  return [
    section.officialCitation,
    section.bluebook,
    `Revision ${section.sourceRevision}`,
    section.sourceUrl,
  ].filter((line): line is string => Boolean(line)).join('\n');
}

export function readerReturnHref(input: {
  query: string;
  scroll: number;
  placeId?: string | null;
  asOf?: string | null;
  scope?: 'place' | 'worldwide' | null;
}): string {
  const params = new URLSearchParams();
  params.set('q', input.query);
  params.set('scroll', String(input.scroll));
  if (input.placeId) params.set('place', input.placeId);
  if (input.asOf) params.set('date', input.asOf);
  if (input.scope) params.set('scope', input.scope);
  return `/#/search?${params.toString()}`;
}

export function downloadHref(url: string, revision: string): string {
  try {
    const parsed = new URL(url);
    parsed.searchParams.set('revision', revision);
    return parsed.toString();
  } catch {
    const join = url.includes('?') ? '&' : '?';
    return `${url}${join}revision=${encodeURIComponent(revision)}`;
  }
}

export function statusLabel(kind: ReaderVersionReading['kind'] | 'outage', copy: ReaderCopy): string {
  if (kind === 'outage') return copy.source_outage;
  if (kind === 'historical') return copy.historical;
  if (kind === 'future') return copy.future;
  if (kind === 'unknown') return copy.unknown_status;
  return copy.current;
}

function pageState(kind: ReaderVersionReading['kind'] | 'outage' | 'choose', translation: boolean, stale: boolean): string {
  if (kind === 'outage') return 'throttling-or-outage';
  if (kind === 'unknown' || kind === 'choose') return 'source-or-status-unknown';
  if (kind === 'historical' || kind === 'future') return 'historical-or-future-law';
  if (stale) return 'stale-cache';
  if (translation) return 'translated-text';
  return 'screen-reader-scope-change';
}

export function highlightExact(text: string, query: string): ReactNode {
  const source = text ?? '';
  const needle = query.trim();
  if (!needle || !source) return source;
  const haystack = source.toLocaleLowerCase();
  const wanted = needle.toLocaleLowerCase();
  const letter = /[\p{L}\p{N}]/u;
  const bounded = letter.test(needle);
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let marks = 0;
  while (cursor < source.length) {
    const at = haystack.indexOf(wanted, cursor);
    if (at < 0) break;
    const end = at + needle.length;
    const before = at > 0 ? source.charAt(at - 1) : '';
    const after = end < source.length ? source.charAt(end) : '';
    if (bounded && (letter.test(before) || letter.test(after))) {
      cursor = at + 1;
      continue;
    }
    if (at > cursor) nodes.push(source.slice(cursor, at));
    nodes.push(<mark className="wwl-mark" key={`${at}:${marks}`}>{source.slice(at, end)}</mark>);
    marks += 1;
    cursor = end;
  }
  if (marks === 0) return source;
  if (cursor < source.length) nodes.push(source.slice(cursor));
  return nodes;
}

function shown(value: string | null | undefined, copy: ReaderCopy): string {
  return value && value.trim() ? value : copy.unknown;
}

function effectiveRights(section: ReaderSection, corpus: ReaderCorpus): ReaderRights {
  return section.rights ?? corpus.rights;
}

async function writeText(value: string): Promise<boolean> {
  const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
  if (!clipboard?.writeText) return false;
  await clipboard.writeText(value);
  return true;
}

export interface LawReaderProps {
  recordId?: string | null;
  sectionId?: string | null;
  sourceRevision?: string | null;
  asOf?: string | null;
  timeZone?: string | null;
  locale?: ResultLocale;
  query?: string;
  scroll?: number;
  placeId?: string | null;
  scope?: 'place' | 'worldwide' | null;
  resultId?: string | null;
  catalogRevision?: string | null;
  viewport?: 'mobile' | 'desktop';
  corpus?: ReaderCorpus | null;
  loadCorpus?: () => Promise<ReaderCorpus>;
  onReturn?: (nav: ReaderReturn) => void;
  onOpenSection?: (target: { recordId: string; sectionId: string; sourceRevision: string }) => void;
}

export function LawReader({
  recordId: recordProp = null,
  sectionId: sectionProp = null,
  sourceRevision: revisionProp = null,
  asOf: asOfProp = null,
  timeZone = null,
  locale = 'en',
  query = '',
  scroll = 0,
  placeId = null,
  scope = null,
  resultId = null,
  catalogRevision = null,
  viewport,
  corpus: corpusProp = null,
  loadCorpus = fetchBundledReaderCorpus,
  onReturn,
  onOpenSection,
}: LawReaderProps) {
  const copy = readerCopy(locale);
  const [corpus, setCorpus] = useState<ReaderCorpus | null>(corpusProp);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'outage'>(corpusProp ? 'ready' : 'loading');
  const [attempt, setAttempt] = useState(0);
  const [recordId, setRecordId] = useState(recordProp);
  const [sectionId, setSectionId] = useState(sectionProp);
  const [pin, setPin] = useState(revisionProp);
  const [asOf, setAsOf] = useState(asOfProp ?? '');
  const [announcement, setAnnouncement] = useState('');
  const [fallback, setFallback] = useState<string | null>(null);
  const loadRef = useRef(loadCorpus);
  const backRef = useRef<HTMLAnchorElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const opened = useRef(false);
  loadRef.current = loadCorpus;

  useEffect(() => { setRecordId(recordProp); }, [recordProp]);
  useEffect(() => { setSectionId(sectionProp); }, [sectionProp]);
  useEffect(() => { setPin(revisionProp); }, [revisionProp]);
  useEffect(() => { setAsOf(asOfProp ?? ''); }, [asOfProp]);

  useEffect(() => {
    if (corpusProp) {
      setCorpus(corpusProp);
      setPhase('ready');
      return undefined;
    }
    let active = true;
    setPhase('loading');
    loadRef.current().then((next) => {
      if (!active) return;
      setCorpus(next);
      setPhase('ready');
    }, () => {
      if (!active) return;
      setCorpus(null);
      setPhase('outage');
    });
    return () => { active = false; };
  }, [attempt, corpusProp]);

  const view = useMemo<ReaderSelection>(() => {
    if (phase === 'outage') return { kind: 'outage' };
    if (phase === 'loading' || !corpus) return { kind: 'loading' };
    return selectReaderView(corpus, { recordId, sectionId, sourceRevision: pin, asOf, timeZone });
  }, [asOf, corpus, phase, pin, recordId, sectionId, timeZone]);

  const section = view.kind === 'section' ? view.section : null;
  const mobile = viewport === 'mobile';

  useEffect(() => {
    if (phase === 'loading') return undefined;
    const first = !opened.current;
    opened.current = true;
    if (first && mobile) backRef.current?.focus();
    else if (first) titleRef.current?.focus();
    return undefined;
  }, [mobile, phase, section?.cid]);

  function openSection(target: ReaderSection) {
    setRecordId(target.recordId);
    setSectionId(target.cid);
    setPin(target.sourceRevision);
    onOpenSection?.({ recordId: target.recordId, sectionId: target.cid, sourceRevision: target.sourceRevision });
    titleRef.current?.focus();
  }

  const returnHref = readerReturnHref({ query, scroll, placeId, asOf: asOf || null, scope });
  const returnPayload: ReaderReturn = { href: returnHref, query, scroll, resultId, placeId, asOf: asOf || null };

  function onBack(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    window.scrollTo({ left: 0, top: scroll, behavior: 'auto' });
    if (resultId) document.getElementById(resultId)?.focus();
    onReturn?.(returnPayload);
  }

  async function copyValue(value: string, label: string) {
    try {
      const wrote = await writeText(value);
      if (!wrote) throw new Error('clipboard unavailable');
      setFallback(null);
      setAnnouncement(`${label} ${section?.sourceRevision ?? pin ?? ''}.`);
    } catch {
      setFallback(value);
      setAnnouncement(`${label} ${section?.sourceRevision ?? pin ?? ''}.`);
    }
  }

  async function onShare() {
    if (!section) return;
    const url = stableLawLink(section);
    const payload = { title: section.title, url, text: `${section.title}\nRevision ${section.sourceRevision}` };
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share(payload);
        setAnnouncement(`${copy.shared} ${section.sourceRevision}.`);
      } catch {
        setAnnouncement(`${copy.text_revision} ${section.sourceRevision}.`);
      }
      return;
    }
    await copyValue(url, copy.copied_link);
  }

  function retry() {
    if (corpusProp) return;
    setAttempt((value) => value + 1);
  }

  const kind = view.kind === 'section' ? view.reading.kind : view.kind === 'outage' ? 'outage' : view.kind === 'loading' ? 'current' : 'unknown';
  const label = view.kind === 'loading' ? copy.loading_source : statusLabel(kind === 'current' && view.kind !== 'section' ? 'unknown' : kind, copy);
  const translation = section?.translation ?? null;
  const stale = Boolean(section && catalogRevision && catalogRevision !== section.sourceRevision);
  const state = pageState(view.kind === 'section' ? view.reading.kind : view.kind === 'outage' ? 'outage' : 'choose', Boolean(translation), stale);
  const rights = section && corpus ? effectiveRights(section, corpus) : corpus?.rights ?? null;
  const link = section ? stableLawLink(section) : '';
  const articles = section && corpus ? articleSequence(corpus, section) : [];
  const adjacent = section && corpus ? adjacentProvisions(corpus, section) : { previous: null, next: null };
  const instruments = section && corpus ? otherInstruments(corpus, section) : [];
  const versions = section && corpus
    ? corpus.sections.filter((item) => item.recordId === section.recordId && item.textVersionId !== section.textVersionId && (item.articleNumber || item.articleLabel) === (section.articleNumber || section.articleLabel))
    : [];
  const live = view.kind === 'section'
    ? `${view.section.title}. ${statusLabel(view.reading.kind, copy)}. ${copy.text_revision} ${view.section.sourceRevision}.`
    : view.kind === 'choose'
      ? (view.reason === 'invalid' ? copy.invalid_date : view.reason === 'timezone' ? copy.timezone_unknown : copy.choose_version)
      : view.kind === 'outage'
        ? copy.source_outage
        : label;

  function onNext() {
    if (view.kind === 'outage') {
      retry();
      return;
    }
    if (state === 'historical-or-future-law') {
      document.getElementById('wwl-reader-as-of')?.focus();
      return;
    }
    if (state === 'translated-text') {
      document.getElementById('wwl-reader-text')?.focus();
      return;
    }
    (titleRef.current ?? backRef.current)?.focus();
  }

  const nextText = state === 'throttling-or-outage'
    ? copy.next_outage
    : state === 'historical-or-future-law'
      ? copy.next_historical
      : state === 'translated-text'
        ? copy.next_translation
        : state === 'source-or-status-unknown'
          ? copy.next_unknown
          : state === 'stale-cache'
            ? copy.next_stale
            : copy.next_ready;

  return (
    <div
      className="wwl"
      lang={copy.lang}
      dir={copy.dir}
      data-reader="open"
      data-state={state}
      data-viewport={mobile ? 'mobile' : 'desktop'}
      data-schema={READER_SCHEMA}
      data-revision={section?.sourceRevision ?? ''}
      data-status-kind={view.kind === 'section' ? view.reading.kind : view.kind}
    >
      <article className="wwl-reader" aria-labelledby="wwl-reader-title">
        <a
          ref={backRef}
          id="wwl-back-to-results"
          className="wwl-hit"
          href={returnHref}
          onClick={onBack}
        >
          <span className="wwl-back-icon" aria-hidden="true">←</span>
          {' '}
          {copy.back_to_results}
        </a>
        <h2 id="wwl-reader-title" ref={titleRef} tabIndex={-1}>
          {section ? section.instrumentTitle : view.kind === 'outage' ? copy.source_outage : copy.version}
        </h2>
        <p className="wwl-applicability">{copy.applicability}</p>
        <p>
          <label htmlFor="wwl-reader-as-of">{copy.as_of}</label>
          <input
            id="wwl-reader-as-of"
            type="text"
            value={asOf}
            aria-describedby="wwl-reader-as-of-hint"
            onChange={(event) => setAsOf(event.target.value)}
          />
        </p>
        <p id="wwl-reader-as-of-hint">{copy.as_of_hint}</p>
        {view.kind === 'loading' ? <p data-field="loading">{copy.loading_source}</p> : null}
        {view.kind === 'outage' ? (
          <div className="wwl-status">
            <p className="wwl-badge" data-field="status">{copy.source_outage}</p>
            <p>{copy.outage}</p>
            <p><button type="button" onClick={retry}>{copy.retry}</button></p>
          </div>
        ) : null}
        {view.kind === 'floating' ? <p data-field="floating">{copy.floating} <span className="wwl-identifier">{view.revision}</span></p> : null}
        {view.kind === 'missing-revision' ? (
          <div>
            <p data-field="missing-revision">{copy.missing_revision} <span className="wwl-identifier">{view.revision}</span></p>
            <VersionChoices copy={copy} sections={view.available} onOpen={openSection} />
          </div>
        ) : null}
        {view.kind === 'missing-section' ? <p data-field="missing-section">{copy.missing_section}</p> : null}
        {view.kind === 'choose' ? (
          <div>
            <p data-field="choose">{view.reason === 'timezone' ? copy.timezone_unknown : view.reason === 'invalid' ? copy.invalid_date : copy.choose_version}</p>
            <VersionChoices copy={copy} sections={view.candidates} onOpen={openSection} />
          </div>
        ) : null}
        {view.kind === 'none' ? (
          <div>
            <p data-field="no-version">{copy.no_version_contains}</p>
            <VersionChoices copy={copy} sections={view.candidates} onOpen={openSection} />
          </div>
        ) : null}
        {section && corpus && view.kind === 'section' ? (
          <SectionBody
            corpus={corpus}
            section={section}
            view={view}
            copy={copy}
            query={query}
            rights={rights as ReaderRights}
            link={link}
            articles={articles}
            adjacent={adjacent}
            instruments={instruments}
            versions={versions}
            catalogRevision={catalogRevision}
            stale={stale}
            label={statusLabel(view.reading.kind, copy)}
            onOpen={openSection}
            onCopyCitation={() => copyValue(citationText(section), copy.copied_citation)}
            onCopyLink={() => copyValue(link, copy.copied_link)}
            onShare={onShare}
          />
        ) : null}
        {fallback ? (
          <p>
            <label htmlFor="wwl-reader-fallback">{copy.copy_citation}</label>
            <textarea id="wwl-reader-fallback" readOnly value={fallback} />
          </p>
        ) : null}
        <div className="wwl-status">
          <p><button type="button" className="wwl-next" onClick={onNext}>{nextText}</button></p>
        </div>
      </article>
      <div className="wwl-live" role="status" aria-live="polite" aria-atomic="true">{announcement || live}</div>
    </div>
  );
}

function VersionChoices({ copy, sections, onOpen }: { copy: ReaderCopy; sections: readonly ReaderSection[]; onOpen: (section: ReaderSection) => void }) {
  const seen = new Set<string>();
  const rows = sections.filter((section) => {
    if (seen.has(section.textVersionId)) return false;
    seen.add(section.textVersionId);
    return true;
  });
  if (rows.length === 0) return null;
  return (
    <ul>
      {rows.map((section) => (
        <li key={section.textVersionId}>
          <a
            className="wwl-hit"
            href={stableLawLink(section)}
            onClick={(event) => { event.preventDefault(); onOpen(section); }}
          >
            {section.title || section.identifier}
            {' '}
            <span className="wwl-identifier">{section.sourceRevision}</span>
          </a>
        </li>
      ))}
      <li className="wwl-applicability">{copy.end_inclusive}</li>
    </ul>
  );
}

function SectionBody({
  corpus,
  section,
  view,
  copy,
  query,
  rights,
  link,
  articles,
  adjacent,
  instruments,
  versions,
  catalogRevision,
  stale,
  label,
  onOpen,
  onCopyCitation,
  onCopyLink,
  onShare,
}: {
  corpus: ReaderCorpus;
  section: ReaderSection;
  view: Extract<ReaderSelection, { kind: 'section' }>;
  copy: ReaderCopy;
  query: string;
  rights: ReaderRights;
  link: string;
  articles: ReaderSection[];
  adjacent: { previous: ReaderSection | null; next: ReaderSection | null };
  instruments: ReaderSection[];
  versions: ReaderSection[];
  catalogRevision: string | null;
  stale: boolean;
  label: string;
  onOpen: (section: ReaderSection) => void;
  onCopyCitation: () => void;
  onCopyLink: () => void;
  onShare: () => void;
}) {
  const reading = view.reading;
  const translationLabel = section.translation?.kind === 'official' ? copy.official_translation : copy.machine_translation;
  const download = rights.downloadPermitted && section.downloadUrl
    ? downloadHref(section.downloadUrl, section.sourceRevision)
    : null;
  const match = view.matches.length === 1 ? view.matches[0] : null;
  return (
    <>
      <nav aria-label={copy.breadcrumb}>
        <ol>
          {section.breadcrumbs.map((crumb, index) => (
            <li key={`${crumb}:${index}`} aria-current={index === section.breadcrumbs.length - 1 ? 'page' : undefined}>{crumb}</li>
          ))}
        </ol>
      </nav>
      <p className="wwl-original" data-field="original-title">
        <span className="wwl-badge">{copy.original_title}</span>
        {' '}
        <span className="wwl-embed" dir={textDirection(section.language)}>{highlightExact(section.title, query)}</span>
      </p>
      <p className="wwl-citation" data-field="citation">{section.officialCitation || copy.unknown}</p>
      {section.bluebook ? <p className="wwl-citation" data-field="bluebook">{section.bluebook}</p> : null}
      <p>
        <span>{copy.issuer}</span>
        {' '}
        <span data-field="issuer">{shown(section.issuer, copy)}</span>
      </p>
      <p>
        <span className="wwl-badge" data-field="status">{label}</span>
        {' '}
        <span data-field="source-status">{shown(section.status, copy)}</span>
      </p>
      {reading.disagreement ? <p data-field="disagreement">{copy.status_disagreement}</p> : null}
      {reading.datesDoNotDecide ? <p data-field="dates">{copy.dates_do_not_decide}</p> : null}
      {reading.problem === 'invalid-date' ? <p data-field="as-of-invalid">{copy.invalid_date}</p> : null}
      {reading.problem === 'unknown-timezone' || reading.problem === 'invalid-timezone' ? <p data-field="timezone">{copy.timezone_unknown}</p> : null}
      <p className="wwl-date" data-field="as-of-civil">{reading.civilAsOf ?? copy.unknown}</p>
      <p data-field="precision">{reading.precision ?? copy.unknown}</p>
      <p>
        <span>{copy.version}</span>
        {' '}
        <span className="wwl-date" data-field="version-start">{shown(section.versionStart, copy)}</span>
        {' '}
        <span className="wwl-date" data-field="version-end">{section.versionEndOpen ? copy.end_inclusive : shown(section.versionEnd, copy)}</span>
      </p>
      <p>
        <span>{copy.effective}</span>
        {' '}
        <span className="wwl-date" data-field="effective">{shown(section.effectiveDate, copy)}</span>
      </p>
      <p>
        <span>{copy.retrieved}</span>
        {' '}
        <span className="wwl-date" data-field="retrieved">{shown(section.retrievedAt, copy)}</span>
      </p>
      <p>
        <span>{copy.text_revision}</span>
        {' '}
        <span className="wwl-identifier" data-field="revision">{section.sourceRevision}</span>
      </p>
      <p>
        <span>{copy.law_language}</span>
        {' '}
        <span data-field="law-language">{shown(section.language, copy)}</span>
      </p>
      <p>
        <span>{copy.interface_language}</span>
        {' '}
        <span data-field="interface-language">{copy.lang}</span>
      </p>
      {section.sourceUrl ? (
        <p>
          <a className="wwl-hit" data-field="official-link" href={section.sourceUrl} target="_blank" rel="noreferrer">{copy.official_text}</a>
        </p>
      ) : null}
      {stale ? (
        <p className="wwl-version" data-field="stale">
          {copy.stale}
          {' '}
          <span className="wwl-identifier" data-revision="saved">{section.sourceRevision}</span>
          {' '}
          <span className="wwl-identifier" data-revision="catalog">{catalogRevision}</span>
        </p>
      ) : null}
      <div
        id="wwl-reader-text"
        className="wwl-reader-text"
        data-field="original-text"
        lang={section.language ?? undefined}
        dir={textDirection(section.language)}
        tabIndex={-1}
        style={{ whiteSpace: 'pre-wrap' }}
      >
        {section.text ? highlightExact(section.text, query) : copy.unknown}
      </div>
      {section.translation ? (
        <div className="wwl-result" data-translation="shown">
          <div className="wwl-translation">
            <p className="wwl-translation-label" data-field="translation-label">{translationLabel}</p>
            {section.translation.title ? (
              <p className="wwl-translation-text" dir={textDirection(section.translation.language)}>{highlightExact(section.translation.title, query)}</p>
            ) : null}
            <p className="wwl-translation-text" lang={section.translation.language ?? undefined} dir={textDirection(section.translation.language)} data-field="translation-text">
              {highlightExact(section.translation.text, query)}
            </p>
            <p data-field="translation-revision">{copy.not_a_revision} <span className="wwl-identifier">{section.sourceRevision}</span></p>
          </div>
        </div>
      ) : null}
      <nav aria-label={copy.articles}>
        <ol>
          {articles.map((article) => (
            <li key={article.cid}>
              <a
                className="wwl-hit"
                href={stableLawLink(article)}
                aria-current={article.cid === section.cid ? 'page' : undefined}
                onClick={(event) => { event.preventDefault(); onOpen(article); }}
              >
                {article.articleLabel}
              </a>
            </li>
          ))}
        </ol>
        {adjacent.previous ? (
          <a className="wwl-hit" href={stableLawLink(adjacent.previous)} data-nav="previous" onClick={(event) => { event.preventDefault(); onOpen(adjacent.previous as ReaderSection); }}>{copy.previous}</a>
        ) : null}
        {adjacent.next ? (
          <a className="wwl-hit" href={stableLawLink(adjacent.next)} data-nav="next" onClick={(event) => { event.preventDefault(); onOpen(adjacent.next as ReaderSection); }}>{copy.next_provision}</a>
        ) : null}
        {!adjacent.previous && !adjacent.next ? <p data-field="adjacent">{copy.no_adjacent}</p> : null}
      </nav>
      {versions.length > 0 ? (
        <nav aria-label={copy.versions}>
          <ul>
            {versions.map((item) => (
              <li key={item.textVersionId}>
                <a className="wwl-hit" href={stableLawLink(item)} onClick={(event) => { event.preventDefault(); onOpen(item); }}>
                  {item.articleLabel} <span className="wwl-identifier">{item.sourceRevision}</span>
                </a>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
      {match ? (
        <p>
          <a className="wwl-hit" href={stableLawLink(match)} data-field="matching-version" onClick={(event) => { event.preventDefault(); onOpen(match); }}>
            {copy.open_matching}
          </a>
        </p>
      ) : null}
      {view.alsoMatches.length > 0 ? <p data-field="also-matches">{copy.also_matches}</p> : null}
      {instruments.length > 0 ? (
        <nav aria-label={copy.other_instruments}>
          <ul>
            {instruments.map((item) => (
              <li key={item.recordId}>
                <a className="wwl-hit" href={stableLawLink(item)} onClick={(event) => { event.preventDefault(); onOpen(item); }}>{item.instrumentTitle}</a>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
      <section aria-label={copy.rights_heading}>
        <h3>{copy.rights_heading}</h3>
        <dl>
          <dt>{copy.dataset}</dt>
          <dd className="wwl-embed" data-field="dataset">{shown(corpus.datasetId, copy)}</dd>
          <dt>{copy.provider}</dt>
          <dd data-field="provider">{shown(corpus.provider, copy)}</dd>
          <dt>{copy.text_revision}</dt>
          <dd className="wwl-identifier" data-field="provenance-revision">{section.sourceRevision}</dd>
          <dt>{copy.rights_revision}</dt>
          <dd className="wwl-identifier" data-field="rights-revision">{shown(rights.artifactRevision, copy)}</dd>
          <dt>{copy.rights_card}</dt>
          <dd className="wwl-identifier" data-field="rights-card">{shown(rights.cardSha256, copy)}</dd>
          <dt>{copy.rights_status}</dt>
          <dd data-field="rights-status">{rights.status}</dd>
          <dt>{copy.license}</dt>
          <dd data-field="license">{shown(rights.rights, copy)}</dd>
          <dt>{copy.attribution}</dt>
          <dd data-field="attribution">{shown(rights.attribution, copy)}</dd>
          <dt>{copy.grant_source}</dt>
          <dd data-field="grant-source">{shown(rights.grantSource, copy)}</dd>
          <dt>{copy.blocker}</dt>
          <dd data-field="blocker">{shown(rights.blocker, copy)}</dd>
          <dt>{copy.retrieved}</dt>
          <dd data-field="provenance-retrieved">{shown(section.retrievedAt, copy)}</dd>
          <dt>{contentAddressLabel(copy)}</dt>
          <dd className="wwl-identifier" data-field="content-address">{section.contentAddress}</dd>
          <dt>{copy.status_source}</dt>
          <dd data-field="status-source">{shown(section.statusSource, copy)}</dd>
          <dt>{copy.coverage}</dt>
          <dd data-field="coverage">{shown(corpus.coverageNote, copy)}</dd>
        </dl>
        {section.statusNote ? <p data-field="status-note">{section.statusNote}</p> : null}
        {corpus.corpusNote ? <p data-field="corpus-note">{corpus.corpusNote}</p> : null}
        <p data-field="organization">{copy.organization_not_license}</p>
        {section.sourceUrl ? (
          <p>
            <a href={section.sourceUrl} target="_blank" rel="noreferrer">{copy.publisher_record}</a>
          </p>
        ) : null}
        {download ? (
          <p>
            <a href={download} download={`${section.recordId}-${section.sourceRevision}.txt`}>{copy.download}</a>
          </p>
        ) : (
          <p data-field="download">{rights.downloadPermitted ? copy.download_unpublished : copy.download_blocked}</p>
        )}
      </section>
      <p>
        <button type="button" onClick={onCopyCitation}>{copy.copy_citation}</button>
        {' '}
        <button type="button" onClick={onCopyLink}>{copy.copy_link}</button>
        {' '}
        <button type="button" onClick={onShare}>{copy.share}</button>
      </p>
      <p className="wwl-identifier" data-field="stable-link">{link}</p>
    </>
  );
}

function contentAddressLabel(copy: ReaderCopy): string {
  return copy.lang === 'nl' ? 'Inhoudsadres' : copy.lang === 'ar' ? 'عنوان المحتوى' : copy.lang === 'ja' ? '内容アドレス' : 'Content address';
}

/**
 * Explicit comparison of two places.
 *
 * The visitor chooses both places. One date lines up the columns when the
 * visitor supplies a date or when both recorded dates share a calendar
 * label. Sources line up by source id. Coverage lines up by level. A gap
 * in one place is not filled from the other. Each result keeps the place
 * it names. Contradictory local rules stay apart and are not turned into
 * one answer. Nothing here searches or decides that a law applies.
 */

import { useId, useMemo, useState } from 'react';
import { buildRoute, canonicalizePlaceId, parseCivilDate } from '../../lib/worldwide/routes';
import {
  coverageLabel,
  resultCopy,
  type ResultCopy,
  type ResultLocale,
} from './SearchFilters';
import { COUNTED_ZERO, NOT_A_FINDING, textImpliesNoLaw } from './CoveragePage';
import '../../styles/worldwide.css';

export const COMPARE_SCHEMA = 'worldwide-legal-search.compare-places@1';
export const COMPARE_APPLICABILITY = 'not-asserted' as const;

export const COMPARE_DEPENDENCY = Object.freeze({
  schema: COMPARE_SCHEMA,
  searchRequiresCompare: false as const,
  compareRequiresLlm: false as const,
  compareRequiresBackend: false as const,
  compareRequiresNetwork: false as const,
  mergesContradictoryRules: false as const,
  assertedAnswer: null,
});

export const COMPARE_LIMITATIONS = [
  'Comparison reads places, sources, coverage, and results the caller already has. It does not search, fetch, or call a model.',
  'A place is compared only after a manual choice. A suggestion, a saved place, a shared link, or a device location is not a selection until the visitor chooses it.',
  'One aligned date is used when the visitor supplies a date or when both recorded dates share a calendar label. Dates are not averaged. Unshared dates stay in their own columns.',
  'Sources line up by source id. A source that exists in one place is not copied into the other. Different revisions stay different. A floating name such as latest is not a pinned revision.',
  'Coverage lines up by level. A missing or unknown municipal cell stays a coverage gap. The gap is not filled from the other place and is not a finding that no local law exists.',
  'Each result keeps the place id it names. A record that names two places, or no place, is not assigned to either column.',
  'Contradictory local rules stay with their own places. Comparison does not merge them into one asserted answer and does not decide that a law applies.',
] as const;

const LIMITS = {
  sources: 64,
  coverage: 32,
  results: 64,
  parents: 8,
  candidates: 8,
  text: 8000,
  label: 200,
} as const;

const FLOATING_REVISIONS = new Set([
  'head', 'main', 'master', 'latest', 'trunk', 'current', 'floating',
  'unpinned', 'none', 'null', 'undefined', 'tip', 'dev', 'develop',
]);

const LOCAL_LEVELS = new Set([
  'municipal', 'municipality', 'city', 'locality', 'borough', 'neighborhood',
  'local', 'local-authority', 'unincorporated', 'postal-area', 'town', 'village',
  'county',
]);

const BASE_LEVELS = ['national', 'regional', 'municipal'] as const;

const SOURCE_ID = /^[A-Za-z0-9][A-Za-z0-9._:@+/-]{0,160}$/;
const REVISION_ID = /^[A-Za-z0-9._:@+/-]{1,128}$/;
const RECORD_ID = /^[A-Za-z0-9][A-Za-z0-9._:@+/-]{0,160}$/;

type Precision = 'day' | 'month' | 'year';
type CoverageWord = 'known' | 'partial' | 'missing' | 'unknown' | 'unavailable';
type Norm = 'permit' | 'prohibit' | 'require' | 'unknown';
type DateMode = 'shared' | 'coarser' | 'unshared' | 'missing';
type DateRelation = 'matches' | 'before' | 'after' | 'unknown' | 'not-aligned';
type Side = 'left' | 'right';

interface Civil {
  value: string;
  precision: Precision;
}

interface CompareCopy {
  title: string;
  intro: string;
  applicability: string;
  notAveraged: string;
  notFilled: string;
  sourceDates: string;
  choose: string;
  chooseThis: string;
  clear: string;
  left: string;
  right: string;
  placeField: string;
  alignedDate: string;
  recordedDate: string;
  noSharedDate: string;
  dateInvalid: string;
  dateMissing: string;
  sources: string;
  absentSource: string;
  unpinned: string;
  revisionsDiffer: string;
  coverage: string;
  noRetrieved: string;
  contradiction: string;
  sameWording: string;
  wordingDiffers: string;
  notOneAnswer: string;
  chooseTwo: string;
  chooseSecond: string;
  samePlace: string;
  manualRequired: string;
  identityConflict: string;
  unassigned: string;
  noRecord: string;
  outsideComparison: string;
  results: string;
  topics: string;
  share: string;
  query: string;
  noMatch: string;
  several: string;
  countedZero: string;
  before: string;
  after: string;
  matchesDate: string;
  dateUnknown: string;
  notAligned: string;
  limits: string;
  refused: string;
  quarantine: string;
  nationalSeparate: string;
  coverageNotSupplied: string;
  notCompleteness: string;
  incomplete: string;
  originManual: string;
  notAFinding: string;
}

const COPY: Record<ResultLocale, CompareCopy> = {
  en: {
    title: 'Compare places',
    intro: 'Compare two places you choose. Dates, sources, and coverage gaps line up. Each result keeps its place.',
    applicability: 'This comparison does not decide that a law applies.',
    notAveraged: 'Dates and source revisions are not averaged.',
    notFilled: 'A coverage gap in one place is not filled from the other place.',
    sourceDates: 'Source dates stay on their own sources.',
    choose: 'Choose',
    chooseThis: 'Choose this place',
    clear: 'Clear place',
    left: 'First place',
    right: 'Second place',
    placeField: 'Place',
    alignedDate: 'Aligned date',
    recordedDate: 'Recorded date',
    noSharedDate: 'These dates do not share a calendar label. Each column keeps its own date.',
    dateInvalid: 'The date is not a real year, month, or day. A timezone was not applied.',
    dateMissing: 'Enter a year, month, or day to align both places. No date was invented.',
    sources: 'Sources',
    absentSource: 'This source is not in this place.',
    unpinned: 'This source has no pinned revision.',
    revisionsDiffer: 'The revisions differ. Neither revision replaces the other.',
    coverage: 'Coverage',
    noRetrieved: `No retrieved local rule on this topic for this place. ${NOT_A_FINDING}`,
    contradiction: 'These local rules contradict. Each rule stays with its place. Comparison does not merge them into one answer.',
    sameWording: 'The same wording appears in both places. Each place keeps its own rule. This is not one answer.',
    wordingDiffers: 'The wording differs. The rules stay with their places and were not merged.',
    notOneAnswer: 'Comparison does not merge rules into one answer.',
    chooseTwo: 'Choose two different places. Nothing was compared.',
    chooseSecond: 'Choose the second place. One place is not a comparison.',
    samePlace: 'Choose two different places. The same place is not compared with itself.',
    manualRequired: 'Choose this place yourself. A suggestion, a saved place, or a shared link is not compared until you choose it.',
    identityConflict: 'This record names two different places. It was not assigned to either column.',
    unassigned: 'This record has no place id. It was not assigned to either column.',
    noRecord: 'This record has no record id. It was not shown as a result.',
    outsideComparison: 'This record belongs to a place that is not in this comparison.',
    results: 'Results',
    topics: 'Local rules by topic',
    share: 'Share this comparison',
    query: 'Question',
    noMatch: 'No place matched. No place was selected.',
    several: 'Several places match. Choose one. Each line keeps its parent context.',
    countedZero: COUNTED_ZERO,
    before: 'This date is before the aligned date. The result stays with its place.',
    after: 'This date is after the aligned date. The result stays with its place.',
    matchesDate: 'This date matches the aligned date.',
    dateUnknown: 'Date unknown. It was not treated as the aligned date.',
    notAligned: 'This result has no aligned date to compare. It stays with its place.',
    limits: 'Limits',
    refused: 'A requested single answer was not shown.',
    quarantine: 'Held back',
    nationalSeparate: 'National and regional rules stay with their own places.',
    coverageNotSupplied: `Coverage was not supplied. ${NOT_A_FINDING}`,
    notCompleteness: 'Collection counts are not legal completeness.',
    incomplete: 'The comparison stopped at a bounded limit and is incomplete.',
    originManual: 'manually selected',
    notAFinding: NOT_A_FINDING,
  },
  nl: {
    title: 'Plaatsen vergelijken',
    intro: 'Vergelijk twee plaatsen die u zelf kiest. Datums, bronnen en dekkingsgaten staan naast elkaar. Elk resultaat houdt zijn plaats.',
    applicability: 'Deze vergelijking stelt niet vast dat een wet van toepassing is.',
    notAveraged: 'Datums en bronrevisies worden niet gemiddeld.',
    notFilled: 'Een dekkingsgat van de ene plaats wordt niet gevuld vanuit de andere plaats.',
    sourceDates: 'Brondatums blijven bij hun eigen bron.',
    choose: 'Kies',
    chooseThis: 'Kies deze plaats',
    clear: 'Plaats wissen',
    left: 'Eerste plaats',
    right: 'Tweede plaats',
    placeField: 'Plaats',
    alignedDate: 'Afgestemde datum',
    recordedDate: 'Vastgelegde datum',
    noSharedDate: 'Deze datums delen geen kalenderlabel. Elke kolom houdt de eigen datum.',
    dateInvalid: 'De datum is geen bestaand jaar, maand of dag. Er is geen tijdzone toegepast.',
    dateMissing: 'Vul een jaar, maand of dag in om beide plaatsen af te stemmen. Er is geen datum verzonnen.',
    sources: 'Bronnen',
    absentSource: 'Deze bron hoort niet bij deze plaats.',
    unpinned: 'Deze bron heeft geen vastgezette revisie.',
    revisionsDiffer: 'De revisies verschillen. Geen van beide vervangt de andere.',
    coverage: 'Dekking',
    noRetrieved: 'Geen opgehaalde lokale regel over dit onderwerp voor deze plaats. Dit is een dekkingsgat, geen vaststelling dat er geen lokale wet bestaat.',
    contradiction: 'Deze lokale regels spreken elkaar tegen. Elke regel blijft bij de eigen plaats. Vergelijken voegt ze niet samen tot één antwoord.',
    sameWording: 'Dezelfde bewoording staat in beide plaatsen. Elke plaats houdt de eigen regel. Dit is geen enkel antwoord.',
    wordingDiffers: 'De bewoording verschilt. De regels blijven bij hun plaatsen en zijn niet samengevoegd.',
    notOneAnswer: 'Vergelijken voegt regels niet samen tot één antwoord.',
    chooseTwo: 'Kies twee verschillende plaatsen. Er is niets vergeleken.',
    chooseSecond: 'Kies de tweede plaats. Eén plaats is geen vergelijking.',
    samePlace: 'Kies twee verschillende plaatsen. Dezelfde plaats wordt niet met zichzelf vergeleken.',
    manualRequired: 'Kies deze plaats zelf. Een suggestie, een bewaarde plaats of een gedeelde link wordt pas vergeleken als u die kiest.',
    identityConflict: 'Dit record noemt twee verschillende plaatsen. Het is aan geen van beide kolommen toegewezen.',
    unassigned: 'Dit record heeft geen plaats-id. Het is aan geen van beide kolommen toegewezen.',
    noRecord: 'Dit record heeft geen record-id. Het is niet als resultaat getoond.',
    outsideComparison: 'Dit record hoort bij een plaats die niet in deze vergelijking staat.',
    results: 'Resultaten',
    topics: 'Lokale regels per onderwerp',
    share: 'Deel deze vergelijking',
    query: 'Vraag',
    noMatch: 'Geen plaats gevonden. Er is geen plaats gekozen.',
    several: 'Meerdere plaatsen komen overeen. Kies er één. Elke regel houdt de bovenliggende context.',
    countedZero: 'Een getelde nul is geen vaststelling dat er geen wet bestaat.',
    before: 'Deze datum ligt vóór de afgestemde datum. Het resultaat blijft bij zijn plaats.',
    after: 'Deze datum ligt ná de afgestemde datum. Het resultaat blijft bij zijn plaats.',
    matchesDate: 'Deze datum komt overeen met de afgestemde datum.',
    dateUnknown: 'Datum onbekend. Die is niet als afgestemde datum gebruikt.',
    notAligned: 'Dit resultaat heeft geen afgestemde datum. Het blijft bij zijn plaats.',
    limits: 'Grenzen',
    refused: 'Een gevraagd enkel antwoord is niet getoond.',
    quarantine: 'Achtergehouden',
    nationalSeparate: 'Nationale en regionale regels blijven bij hun eigen plaatsen.',
    coverageNotSupplied: 'Dekking is niet aangeleverd. Dit is een dekkingsgat, geen vaststelling dat er geen lokale wet bestaat.',
    notCompleteness: 'Verzamelingsaantallen zijn geen juridische volledigheid.',
    incomplete: 'De vergelijking stopte bij een grens en is onvolledig.',
    originManual: 'handmatig gekozen',
    notAFinding: 'Dit is een dekkingsgat, geen vaststelling dat er geen lokale wet bestaat.',
  },
  ar: {
    title: 'مقارنة الأماكن',
    intro: 'قارن مكانين تختارهما بنفسك. تتوازى التواريخ والمصادر وفجوات التغطية. يحتفظ كل نتيجة بمكانها.',
    applicability: 'هذه المقارنة لا تقرر أن قانونًا يسري.',
    notAveraged: 'لا يُحسب متوسط التواريخ ولا إصدارات المصادر.',
    notFilled: 'فجوة التغطية في مكان لا تُملأ من المكان الآخر.',
    sourceDates: 'تبقى تواريخ المصادر عند مصادرها.',
    choose: 'اختر',
    chooseThis: 'اختر هذا المكان',
    clear: 'امسح المكان',
    left: 'المكان الأول',
    right: 'المكان الثاني',
    placeField: 'المكان',
    alignedDate: 'التاريخ المتوافق',
    recordedDate: 'التاريخ المسجَّل',
    noSharedDate: 'هذان التاريخان لا يشتركان في تسمية تقويم واحدة. يحتفظ كل عمود بتاريخه.',
    dateInvalid: 'التاريخ ليس سنة أو شهرًا أو يومًا حقيقيًا. لم تُطبَّق منطقة زمنية.',
    dateMissing: 'أدخل سنة أو شهرًا أو يومًا لمواءمة المكانين. لم يُختلق تاريخ.',
    sources: 'المصادر',
    absentSource: 'هذا المصدر ليس في هذا المكان.',
    unpinned: 'هذا المصدر بلا إصدار مثبّت.',
    revisionsDiffer: 'الإصداران مختلفان. لا يحل أحدهما محل الآخر.',
    coverage: 'التغطية',
    noRetrieved: 'لا قاعدة محلية مسترجعة في هذا الموضوع لهذا المكان. هذه فجوة في التغطية، وليست نتيجة بأن لا قانون محليًا.',
    contradiction: 'هذه القواعد المحلية متعارضة. تبقى كل قاعدة مع مكانها. لا تدمج المقارنة بينها في جواب واحد.',
    sameWording: 'الصياغة نفسها تظهر في المكانين. يحتفظ كل مكان بقاعدته. هذا ليس جوابًا واحدًا.',
    wordingDiffers: 'الصياغة مختلفة. تبقى القواعد مع أماكنها ولم تُدمج.',
    notOneAnswer: 'لا تدمج المقارنة القواعد في جواب واحد.',
    chooseTwo: 'اختر مكانين مختلفين. لم تُجرَ مقارنة.',
    chooseSecond: 'اختر المكان الثاني. مكان واحد ليس مقارنة.',
    samePlace: 'اختر مكانين مختلفين. لا يُقارن المكان بنفسه.',
    manualRequired: 'اختر هذا المكان بنفسك. الاقتراح أو المكان المحفوظ أو الرابط المشترك لا يُقارن حتى تختاره.',
    identityConflict: 'هذا السجل يسمّي مكانين مختلفين. لم يُسنَد إلى أي عمود.',
    unassigned: 'هذا السجل بلا معرّف مكان. لم يُسنَد إلى أي عمود.',
    noRecord: 'هذا السجل بلا معرّف سجل. لم يُعرض كنتيجة.',
    outsideComparison: 'هذا السجل لمكان ليس في هذه المقارنة.',
    results: 'النتائج',
    topics: 'القواعد المحلية حسب الموضوع',
    share: 'شارك هذه المقارنة',
    query: 'السؤال',
    noMatch: 'لا مكان مطابق. لم يُختر مكان.',
    several: 'عدة أماكن تطابق. اختر واحدًا. كل سطر يحتفظ بالسياق الأعلى.',
    countedZero: 'الصفر المحسوب ليس نتيجة بأن لا قانون.',
    before: 'هذا التاريخ قبل التاريخ المتوافق. تبقى النتيجة مع مكانها.',
    after: 'هذا التاريخ بعد التاريخ المتوافق. تبقى النتيجة مع مكانها.',
    matchesDate: 'هذا التاريخ يطابق التاريخ المتوافق.',
    dateUnknown: 'التاريخ غير معروف. لم يُعامل كالتاريخ المتوافق.',
    notAligned: 'هذه النتيجة بلا تاريخ متوافق للمقارنة. تبقى مع مكانها.',
    limits: 'الحدود',
    refused: 'لم يُعرض جواب واحد طُلب.',
    quarantine: 'معلَّق',
    nationalSeparate: 'تبقى القواعد الوطنية والإقليمية مع أماكنها.',
    coverageNotSupplied: 'لم تُقدَّم التغطية. هذه فجوة في التغطية، وليست نتيجة بأن لا قانون محليًا.',
    notCompleteness: 'أعداد المجموعات ليست اكتمالًا قانونيًا.',
    incomplete: 'توقفت المقارنة عند حد وهي غير مكتملة.',
    originManual: 'مختار يدويًا',
    notAFinding: 'هذه فجوة في التغطية، وليست نتيجة بأن لا قانون محليًا.',
  },
  ja: {
    title: '場所を比較',
    intro: '自分で選んだ二つの場所を比べます。日付、情報源、収録の欠落を揃えます。各結果は自分の場所を保ちます。',
    applicability: 'この比較は、法令が適用されるとは決めません。',
    notAveraged: '日付と情報源の版は平均しません。',
    notFilled: '一方の場所の収録の欠落を、もう一方の場所から埋めません。',
    sourceDates: '情報源の日付は、その情報源に残します。',
    choose: '選ぶ',
    chooseThis: 'この場所を選ぶ',
    clear: '場所を消す',
    left: '一つ目の場所',
    right: '二つ目の場所',
    placeField: '場所',
    alignedDate: '揃えた日付',
    recordedDate: '記録された日付',
    noSharedDate: 'これらの日付は同じ暦の表記を共有しません。各列は自分の日付を保ちます。',
    dateInvalid: '日付は実在する年、月、または日ではありません。タイムゾーンは適用していません。',
    dateMissing: '両方の場所を揃える年、月、または日を入力してください。日付は作っていません。',
    sources: '情報源',
    absentSource: 'この情報源はこの場所にありません。',
    unpinned: 'この情報源には固定した版がありません。',
    revisionsDiffer: '版が違います。どちらの版も他方を置き換えません。',
    coverage: '収録',
    noRetrieved: 'この場所のこの題目について、取得した地域の規則はありません。これは収録の欠落であり、現地に法令がないという結論ではありません。',
    contradiction: 'これらの地域の規則は互いに矛盾します。各規則はそれぞれの場所に残します。比較はそれらを一つの答えにまとめません。',
    sameWording: '同じ文言が両方の場所にあります。各場所は自分の規則を保ちます。これは一つの答えではありません。',
    wordingDiffers: '文言が違います。規則はそれぞれの場所に残り、まとめていません。',
    notOneAnswer: '比較は規則を一つの答えにまとめません。',
    chooseTwo: '別々の場所を二つ選んでください。比較はしていません。',
    chooseSecond: '二つ目の場所を選んでください。一つの場所は比較ではありません。',
    samePlace: '別々の場所を二つ選んでください。同じ場所を自分と比べません。',
    manualRequired: 'この場所は自分で選んでください。候補、保存した場所、共有リンクは、選ぶまで比較しません。',
    identityConflict: 'この記録は二つの場所を名指ししています。どちらの列にも割り当てていません。',
    unassigned: 'この記録には場所IDがありません。どちらの列にも割り当てていません。',
    noRecord: 'この記録には記録IDがありません。結果として示していません。',
    outsideComparison: 'この記録は、この比較にない場所のものです。',
    results: '結果',
    topics: '題目ごとの地域の規則',
    share: 'この比較を共有',
    query: '質問',
    noMatch: '一致する場所はありません。場所は選んでいません。',
    several: '複数の場所が一致します。一つ選んでください。各行は上位の文脈を保ちます。',
    countedZero: '数えたゼロは、法令がないという結論ではありません。',
    before: 'この日付は揃えた日付より前です。結果は自分の場所に残します。',
    after: 'この日付は揃えた日付より後です。結果は自分の場所に残します。',
    matchesDate: 'この日付は揃えた日付と一致します。',
    dateUnknown: '日付は不明です。揃えた日付としては扱っていません。',
    notAligned: 'この結果には比べる揃えた日付がありません。自分の場所に残します。',
    limits: '制限',
    refused: '求められた単一の答えは示していません。',
    quarantine: '保留',
    nationalSeparate: '国と地域の規則は、それぞれの場所に残します。',
    coverageNotSupplied: '収録状況は渡されていません。これは収録の欠落であり、現地に法令がないという結論ではありません。',
    notCompleteness: 'コレクションの件数は、法的な完全性ではありません。',
    incomplete: '比較は上限で止まり、不完全です。',
    originManual: '手動で選択',
    notAFinding: 'これは収録の欠落であり、現地に法令がないという結論ではありません。',
  },
};

export interface CompareParentInput {
  placeId?: unknown;
  label?: unknown;
  levelKind?: unknown;
}

export interface CompareSourceInput {
  sourceId?: unknown;
  revision?: unknown;
  label?: unknown;
  level?: unknown;
  retrievedAt?: unknown;
}

export interface CompareCoverageInput {
  jurisdictionId?: unknown;
  level?: unknown;
  state?: unknown;
  sourceIds?: unknown;
  reason?: unknown;
  indexedRecords?: unknown;
}

export interface CompareResultInput {
  recordId?: unknown;
  placeId?: unknown;
  jurisdictionId?: unknown;
  title?: unknown;
  text?: unknown;
  level?: unknown;
  topic?: unknown;
  norm?: unknown;
  sourceId?: unknown;
  sourceRevision?: unknown;
  date?: unknown;
  issuerId?: unknown;
}

export interface ComparePlaceInput {
  placeId?: unknown;
  label?: unknown;
  origin?: unknown;
  levelKind?: unknown;
  parents?: readonly CompareParentInput[] | null;
  asOf?: unknown;
  sources?: readonly CompareSourceInput[] | null;
  coverage?: readonly CompareCoverageInput[] | null;
  results?: readonly CompareResultInput[] | null;
}

export interface CompareInput {
  left?: ComparePlaceInput | null;
  right?: ComparePlaceInput | null;
  query?: unknown;
  alignedDate?: unknown;
  locale?: ResultLocale | string | null;
  assertedAnswer?: unknown;
  mergedRule?: unknown;
  merge?: unknown;
  combine?: unknown;
}

export interface SourceCell {
  present: boolean;
  revision: string | null;
  unpinned: boolean;
  label: string | null;
  level: string | null;
  retrievedAt: string | null;
}

export interface AlignedSource {
  sourceId: string;
  left: SourceCell;
  right: SourceCell;
  revisionsMatch: boolean;
}

export interface CoverageCellView {
  placeId: string;
  jurisdictionId: string;
  level: string;
  state: CoverageWord;
  sentence: string;
  sourceIds: string[];
  indexedRecords: number | null;
  countedZero: boolean;
  impliesNoLaw: false;
}

export interface AlignedCoverage {
  level: string;
  left: CoverageCellView;
  right: CoverageCellView;
}

export interface ColumnResult {
  placeId: string;
  jurisdictionId: string;
  recordId: string;
  title: string | null;
  text: string | null;
  level: string | null;
  topic: string | null;
  norm: Norm;
  sourceId: string | null;
  sourceRevision: string | null;
  date: string | null;
  dateRelation: DateRelation;
  issuerId: string | null;
  local: boolean;
}

export interface CompareColumn {
  side: Side;
  selected: boolean;
  manual: boolean;
  placeId: string | null;
  label: string | null;
  parents: string;
  recordedDate: string | null;
  alignedDate: string | null;
  sources: SourceCell[];
  coverage: CoverageCellView[];
  results: ColumnResult[];
  issue: string | null;
}

export interface TopicRule {
  placeId: string;
  recordId: string;
  text: string | null;
  title: string | null;
  norm: Norm;
  sourceId: string | null;
  sourceRevision: string | null;
}

export interface TopicAlignment {
  key: string;
  label: string;
  contradiction: boolean;
  sameWording: boolean;
  merged: false;
  assertedAnswer: null;
  left: TopicRule[];
  right: TopicRule[];
  note: string;
}

export interface QuarantinedResult {
  recordId: string | null;
  reason: 'identity-conflict' | 'unassigned' | 'outside' | 'no-record';
  message: string;
}

export interface CompareView {
  schema: typeof COMPARE_SCHEMA;
  applicability: typeof COMPARE_APPLICABILITY;
  assertedAnswer: null;
  mergedAnswer: null;
  mergesContradictoryRules: false;
  refusedAssertion: boolean;
  ready: boolean;
  incomplete: boolean;
  issue: string | null;
  locale: ResultLocale;
  query: string | null;
  alignedDate: {
    value: string | null;
    precision: Precision | null;
    mode: DateMode;
    label: string;
    sameInBothColumns: boolean;
  };
  sources: AlignedSource[];
  coverage: AlignedCoverage[];
  columns: [CompareColumn, CompareColumn];
  topics: TopicAlignment[];
  contradictions: string[];
  quarantined: QuarantinedResult[];
  href: string | null;
  limitations: readonly string[];
}

interface ParsedParent {
  placeId: string;
  label: string | null;
}

interface ParsedSource {
  sourceId: string;
  revision: string | null;
  unpinned: boolean;
  label: string | null;
  level: string | null;
  retrievedAt: string | null;
}

interface ParsedCoverage {
  jurisdictionId: string | null;
  level: string;
  state: CoverageWord;
  sourceIds: string[];
  indexedRecords: number | null;
}

interface ParsedResult {
  recordId: string | null;
  placeId: string | null;
  jurisdictionId: string | null;
  title: string | null;
  text: string | null;
  level: string | null;
  topic: string | null;
  topicKey: string | null;
  norm: Norm;
  sourceId: string | null;
  sourceRevision: string | null;
  date: Civil | null;
  issuerId: string | null;
}

interface ParsedPlace {
  manual: boolean;
  placeId: string | null;
  label: string | null;
  parents: ParsedParent[];
  parentLine: string;
  asOf: Civil | null;
  sources: ParsedSource[];
  coverage: ParsedCoverage[];
  coverageSupplied: boolean;
  results: ParsedResult[];
  incomplete: boolean;
  issue: string | null;
}

interface ScopeBundle {
  place: ParsedPlace;
  coverage: ParsedCoverage[];
  foreignCoverage: ParsedCoverage[];
  results: ParsedResult[];
}

export function compareCopy(locale: ResultLocale | string | null | undefined): CompareCopy {
  const resolved = resolveLocale(locale);
  return COPY[resolved];
}

export function assertedComparisonAnswer(_view?: CompareView | null): null {
  return null;
}

export function composePlaceComparison(input?: CompareInput | null): CompareView {
  const locale = resolveLocale(input?.locale);
  const copy = COPY[locale];
  const shell = resultCopy(locale);
  const refusedAssertion = refused(input);
  const query = cleanQuery(input?.query);
  const shared = parseDate(input?.alignedDate);
  const leftBundle = parsePlace(input?.left, copy);
  const rightBundle = parsePlace(input?.right, copy);
  const left = leftBundle.place;
  const right = rightBundle.place;
  const manualCount = [left, right].filter((place) => place.manual && place.placeId).length;
  const distinct = Boolean(left.placeId && right.placeId && left.placeId !== right.placeId);
  let issue: string | null = null;
  if (manualCount === 0) issue = copy.chooseTwo;
  else if (manualCount === 1) issue = copy.chooseSecond;
  else if (!distinct) issue = copy.samePlace;
  const ready = manualCount === 2 && distinct;
  const alignment = alignDates(shared, left.asOf, right.asOf);
  const incomplete = left.incomplete || right.incomplete;
  const emptySources: AlignedSource[] = [];
  const emptyCoverage: AlignedCoverage[] = [];
  let sources = emptySources;
  let coverage = emptyCoverage;
  let quarantined: QuarantinedResult[] = [];
  let leftResults: ColumnResult[] = [];
  let rightResults: ColumnResult[] = [];
  let topics: TopicAlignment[] = [];
  if (ready && left.placeId && right.placeId) {
    const built = buildAlignment(leftBundle, rightBundle, alignment.date, copy, shell, locale);
    sources = built.sources;
    coverage = built.coverage;
    quarantined = built.quarantined;
    leftResults = built.leftResults;
    rightResults = built.rightResults;
    topics = built.topics;
  }
  const alignedLabel = alignmentLabel(alignment, copy);
  const columns: [CompareColumn, CompareColumn] = [
    columnOf('left', left, ready, alignment, alignedLabel, sources, coverage, leftResults, copy),
    columnOf('right', right, ready, alignment, alignedLabel, sources, coverage, rightResults, copy),
  ];
  const href = ready && left.placeId && right.placeId
    ? buildRoute({
      name: 'compare',
      comparePlaceIds: [left.placeId, right.placeId],
      query,
      date: alignment.date?.value ?? null,
    }).href
    : null;
  return {
    schema: COMPARE_SCHEMA,
    applicability: COMPARE_APPLICABILITY,
    assertedAnswer: null,
    mergedAnswer: null,
    mergesContradictoryRules: false,
    refusedAssertion,
    ready,
    incomplete,
    issue,
    locale,
    query,
    alignedDate: {
      value: alignment.date?.value ?? null,
      precision: alignment.date?.precision ?? null,
      mode: ready ? alignment.mode : 'missing',
      label: ready ? alignedLabel : copy.dateMissing,
      sameInBothColumns: ready && alignment.mode !== 'unshared',
    },
    sources,
    coverage,
    columns,
    topics,
    contradictions: topics.filter((topic) => topic.contradiction).map((topic) => topic.key),
    quarantined,
    href,
    limitations: COMPARE_LIMITATIONS,
  };
}

export interface ComparePlacesProps {
  candidates?: readonly ComparePlaceInput[] | null;
  left?: ComparePlaceInput | null;
  right?: ComparePlaceInput | null;
  query?: string | null;
  alignedDate?: string | null;
  locale?: ResultLocale | string | null;
  assertedAnswer?: unknown;
  mergedRule?: unknown;
  merge?: unknown;
  combine?: unknown;
}

export function ComparePlaces({
  candidates,
  left,
  right,
  query,
  alignedDate,
  locale,
  assertedAnswer,
  mergedRule,
  merge,
  combine,
}: ComparePlacesProps) {
  const headingId = useId();
  const [choice, setChoice] = useState<{ left?: ComparePlaceInput | null; right?: ComparePlaceInput | null }>({});
  const [dateText, setDateText] = useState<string | undefined>(undefined);
  const [queryText, setQueryText] = useState<string | undefined>(undefined);
  const resolvedLocale = resolveLocale(locale);
  const copy = COPY[resolvedLocale];
  const shell = resultCopy(resolvedLocale);
  const selectedLeft = choice.left !== undefined ? choice.left : left ?? null;
  const selectedRight = choice.right !== undefined ? choice.right : right ?? null;
  const parsedDate = dateText === undefined ? null : parseCivilDate(dateText);
  const dateInvalid = dateText !== undefined && dateText.trim() !== '' && !parsedDate;
  let resolvedDate: string | null;
  if (dateText === undefined) resolvedDate = alignedDate ?? null;
  else if (dateText.trim() === '') resolvedDate = null;
  else if (parsedDate) resolvedDate = parsedDate.value;
  else resolvedDate = alignedDate ?? null;
  const resolvedQuery = queryText === undefined ? (query ?? null) : queryText;
  const view = useMemo(() => composePlaceComparison({
    left: selectedLeft,
    right: selectedRight,
    query: resolvedQuery,
    alignedDate: resolvedDate,
    locale: resolvedLocale,
    assertedAnswer,
    mergedRule,
    merge,
    combine,
  }), [selectedLeft, selectedRight, resolvedQuery, resolvedDate, resolvedLocale, assertedAnswer, mergedRule, merge, combine]);
  const dateShown = dateText === undefined ? (alignedDate ?? '') : dateText;
  const queryShown = queryText === undefined ? (query ?? '') : queryText;
  const stateId = viewState(view);

  function onDate(value: string) {
    setDateText(value);
  }

  function chooseCandidate(side: Side, candidate: ComparePlaceInput) {
    setChoice((current) => ({ ...current, [side]: { ...candidate, origin: 'manual' } }));
  }

  function confirmSide(side: Side) {
    setChoice((current) => {
      const existing = current[side] !== undefined ? current[side] : (side === 'left' ? left ?? null : right ?? null);
      if (!existing) return current;
      return { ...current, [side]: { ...existing, origin: 'manual' } };
    });
  }

  function chooseRaw(side: Side, raw: string) {
    const canonical = canonicalizePlaceId(raw);
    if (!canonical.ok) return canonical;
    const pool = candidates ?? [];
    const match = pool.find((candidate) => {
      const id = typeof candidate.placeId === 'string' ? canonicalizePlaceId(candidate.placeId) : null;
      return Boolean(id && id.ok && id.placeId === canonical.placeId);
    });
    if (match) {
      chooseCandidate(side, match);
      return canonical;
    }
    const prop = side === 'left' ? left : right;
    const propId = prop && typeof prop.placeId === 'string' ? canonicalizePlaceId(prop.placeId) : null;
    if (prop && propId && propId.ok && propId.placeId === canonical.placeId) {
      setChoice((current) => ({ ...current, [side]: { ...prop, origin: 'manual' } }));
      return canonical;
    }
    setChoice((current) => ({
      ...current,
      [side]: { placeId: canonical.placeId, label: canonical.placeId, origin: 'manual' },
    }));
    return canonical;
  }

  function clearSide(side: Side) {
    setChoice((current) => ({ ...current, [side]: null }));
  }

  return (
    <section
      className="wwl"
      lang={shell.lang}
      dir={shell.dir}
      data-compare="open"
      data-schema={COMPARE_SCHEMA}
      data-asserted="false"
      data-merged="false"
      data-applicability={COMPARE_APPLICABILITY}
      data-ready={view.ready ? 'true' : 'false'}
      data-state={stateId}
      data-search-requires-compare="false"
      data-incomplete={view.incomplete ? 'true' : 'false'}
      aria-labelledby={headingId}
    >
      <h2 id={headingId}>{copy.title}</h2>
      <p>{copy.intro}</p>
      <p data-field="applicability">{copy.applicability}</p>
      <p data-field="not-averaged">{copy.notAveraged}</p>
      <p data-field="not-filled">{copy.notFilled}</p>
      {view.issue ? <p data-field="issue" role="status">{view.issue}</p> : null}
      {view.refusedAssertion ? <p data-field="refused">{copy.refused}</p> : null}
      {view.incomplete ? <p data-field="incomplete">{copy.incomplete}</p> : null}
      <div className="wwl-context">
        <PlaceChooser
          side="left"
          label={copy.left}
          copy={copy}
          candidates={candidates ?? []}
          onCandidate={chooseCandidate}
          onRaw={chooseRaw}
          onClear={clearSide}
        />
        <PlaceChooser
          side="right"
          label={copy.right}
          copy={copy}
          candidates={candidates ?? []}
          onCandidate={chooseCandidate}
          onRaw={chooseRaw}
          onClear={clearSide}
        />
        <div className="wwl-field wwl-date-field">
          <label htmlFor={`${headingId}-date`}>{copy.alignedDate}</label>
          <input
            id={`${headingId}-date`}
            data-field="aligned-date-input"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            spellCheck={false}
            value={dateShown}
            placeholder="YYYY-MM-DD"
            onChange={(event) => onDate(event.target.value)}
          />
          {dateInvalid ? <p data-field="date-error" role="status">{copy.dateInvalid}</p> : null}
        </div>
        <form
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const value = data.get('q');
            setQueryText(typeof value === 'string' ? value : '');
          }}
        >
          <label htmlFor={`${headingId}-query`}>{copy.query}</label>
          <input
            id={`${headingId}-query`}
            name="q"
            data-field="query-input"
            type="search"
            value={queryShown}
            onChange={(event) => setQueryText(event.target.value)}
          />
        </form>
        <p data-field="query-status">{view.query ? view.query : shell.empty_query}</p>
      </div>
      <div className="wwl-compare" data-field="place-columns">
        <PlaceColumn view={view} column={view.columns[0]} copy={copy} shell={shell} onConfirm={confirmSide} />
        <PlaceColumn view={view} column={view.columns[1]} copy={copy} shell={shell} onConfirm={confirmSide} />
      </div>
      {view.ready ? <p data-field="national-separate">{copy.nationalSeparate}</p> : null}
      {view.topics.length > 0 ? (
        <section data-field="topics" aria-label={copy.topics}>
          <h3>{copy.topics}</h3>
          {view.topics.map((topic) => (
            <section
              key={topic.key}
              data-field="topic"
              data-topic={topic.key}
              data-contradiction={topic.contradiction ? 'true' : 'false'}
              data-merged="false"
              data-same-wording={topic.sameWording ? 'true' : 'false'}
              data-asserted="false"
            >
              <h4>{topic.label}</h4>
              <p data-field={topic.contradiction ? 'contradiction' : 'topic-status'} data-merged="false">{topic.note}</p>
              <div className="wwl-compare" data-field="topic-columns">
                <TopicSide placeId={view.columns[0].placeId} rules={topic.left} empty={copy.noRetrieved} />
                <TopicSide placeId={view.columns[1].placeId} rules={topic.right} empty={copy.noRetrieved} />
              </div>
            </section>
          ))}
        </section>
      ) : null}
      {view.quarantined.length > 0 ? (
        <section data-field="quarantine" aria-label={copy.quarantine}>
          <h3>{copy.quarantine}</h3>
          {view.quarantined.map((item, index) => (
            <p
              key={`${item.reason}:${item.recordId ?? index}`}
              data-field="quarantined-record"
              data-record-id={item.recordId ?? ''}
              data-reason={item.reason}
            >
              {item.message}
            </p>
          ))}
        </section>
      ) : null}
      {view.href ? (
        <p>
          <a data-field="share-link" href={view.href}>{copy.share}</a>
        </p>
      ) : null}
      <details>
        <summary>{copy.limits}</summary>
        <p data-field="limits">{copy.notOneAnswer}</p>
      </details>
    </section>
  );
}

function PlaceChooser({
  side,
  label,
  copy,
  candidates,
  onCandidate,
  onRaw,
  onClear,
}: {
  side: Side;
  label: string;
  copy: CompareCopy;
  candidates: readonly ComparePlaceInput[];
  onCandidate: (side: Side, candidate: ComparePlaceInput) => void;
  onRaw: (side: Side, raw: string) => { ok: true; placeId: string } | { ok: false; message: string };
  onClear: (side: Side) => void;
}) {
  const inputId = useId();
  const listId = useId();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const matches = useMemo(() => filterCandidates(candidates, text), [candidates, text]);
  const names = matches.length > 1 && fold(text) !== '';

  function commitRaw() {
    const result = onRaw(side, text);
    if (!result.ok) setError(result.message);
    else setError(null);
  }

  return (
    <div className="wwl-field" data-field="chooser" data-side={side}>
      <label htmlFor={inputId}>{label}</label>
      <input
        id={inputId}
        data-field="place-input"
        data-side={side}
        type="text"
        role="combobox"
        aria-expanded="true"
        aria-controls={listId}
        aria-autocomplete="list"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setActive(0);
          setError(null);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActive((index) => Math.min(index + 1, Math.max(matches.length - 1, 0)));
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActive((index) => Math.max(index - 1, 0));
          } else if (event.key === 'Enter' && matches[active]) {
            event.preventDefault();
            onCandidate(side, matches[active]);
            setError(null);
          }
        }}
      />
      <button type="button" className="wwl-change" data-field="choose-id" data-side={side} onClick={commitRaw}>{copy.chooseThis}</button>
      <button type="button" onClick={() => { onClear(side); setText(''); setError(null); }}>{copy.clear}</button>
      {error ? <p data-field="place-error" data-side={side} role="status">{error}</p> : null}
      {names ? <p data-field="several" data-side={side}>{copy.several}</p> : null}
      {text.trim() !== '' && matches.length === 0 ? <p data-field="no-match" data-side={side}>{copy.noMatch}</p> : null}
      <ul id={listId} role="listbox" aria-label={label}>
        {matches.map((candidate, index) => {
          const placeId = typeof candidate.placeId === 'string' ? candidate.placeId : '';
          const name = typeof candidate.label === 'string' && candidate.label.trim() ? candidate.label.trim() : placeId;
          const parents = parentLabels(candidate.parents);
          const accessible = `${copy.choose} ${name}${parents ? `, ${parents}` : ''}, ${placeId}`;
          return (
            <li key={placeId || name} role="presentation">
              <button
                type="button"
                role="option"
                aria-selected={index === active}
                data-active={index === active ? 'true' : 'false'}
                data-place-id={placeId}
                aria-label={accessible}
                onClick={() => {
                  onCandidate(side, candidate);
                  setError(null);
                }}
              >
                <span>{name}</span>
                {parents ? <span className="wwl-caption">{parents}</span> : null}
                <span className="wwl-embed">{placeId}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function PlaceColumn({
  view,
  column,
  copy,
  shell,
  onConfirm,
}: {
  view: CompareView;
  column: CompareColumn;
  copy: CompareCopy;
  shell: ResultCopy;
  onConfirm: (side: Side) => void;
}) {
  const show = view.ready && column.manual && column.placeId;
  return (
    <article
      data-field="place-column"
      data-side={column.side}
      data-place-id={column.placeId ?? ''}
      data-origin={column.manual ? 'manual' : 'not-manual'}
      data-manual={column.manual ? 'true' : 'false'}
      aria-label={column.label ?? copy.placeField}
    >
      <h3 data-field="place-label">{column.label ?? copy.placeField}</h3>
      <p data-field="place-id">{column.placeId ?? ''}</p>
      {column.parents ? <p data-field="place-parents">{column.parents}</p> : null}
      <p data-field="origin">{column.manual ? copy.originManual : copy.manualRequired}</p>
      {!column.manual && column.placeId ? (
        <button type="button" data-field="confirm-place" data-side={column.side} onClick={() => onConfirm(column.side)}>
          {copy.chooseThis}
        </button>
      ) : null}
      {show ? (
        <>
          <p data-field="aligned-date" data-mode={view.alignedDate.mode} data-value={view.alignedDate.value ?? ''}>
            {copy.alignedDate}: {view.alignedDate.label}
          </p>
          <p data-field="recorded-date" data-value={column.recordedDate ?? ''}>
            {copy.recordedDate}: {column.recordedDate ?? copy.dateUnknown}
          </p>
          <p data-field="source-dates">{copy.sourceDates}</p>
          <h4>{copy.sources}</h4>
          <ol data-field="sources">
            {view.sources.map((row) => {
              const cell = column.side === 'left' ? row.left : row.right;
              return (
                <li
                  key={row.sourceId}
                  data-field="source"
                  data-source-id={row.sourceId}
                  data-present={cell.present ? 'true' : 'false'}
                  data-revision={cell.revision ?? ''}
                  data-retrieved-at={cell.retrievedAt ?? ''}
                  data-revisions-match={row.revisionsMatch ? 'true' : 'false'}
                  data-unpinned={cell.unpinned ? 'true' : 'false'}
                >
                  <span data-field="source-id">{row.sourceId}</span>
                  {cell.present && cell.revision ? <span data-field="source-revision">{cell.revision}</span> : null}
                  {cell.present && cell.label ? <span>{cell.label}</span> : null}
                  {cell.retrievedAt ? <span data-field="source-retrieved">{cell.retrievedAt}</span> : null}
                  {!cell.present ? <span>{copy.absentSource}</span> : null}
                  {cell.unpinned ? <span>{copy.unpinned}</span> : null}
                  {cell.present && row.left.present && row.right.present && !row.revisionsMatch ? <span>{copy.revisionsDiffer}</span> : null}
                </li>
              );
            })}
          </ol>
          <h4>{copy.coverage}</h4>
          <ol data-field="coverage-rows">
            {column.coverage.map((cell) => (
              <li
                key={cell.level}
                className="wwl-coverage"
                data-field="coverage"
                data-level={cell.level}
                data-state={cell.state}
                data-coverage={cell.state}
                data-place-id={cell.placeId}
                data-jurisdiction-id={cell.jurisdictionId}
                data-indexed-records={cell.indexedRecords === null ? '' : String(cell.indexedRecords)}
              >
                <span data-field="coverage-level">{levelName(cell.level, shell)}</span>
                <span data-field="coverage-state">{coverageLabel(cell.state, shell)}</span>
                <p data-field="coverage-sentence">{cell.sentence}</p>
                {cell.countedZero ? <p data-field="counted-zero">{copy.countedZero}</p> : null}
                {cell.indexedRecords !== null ? <p data-field="not-completeness">{copy.notCompleteness}</p> : null}
                <ul>
                  {cell.sourceIds.map((sourceId) => (
                    <li key={sourceId} data-field="coverage-source" data-source-id={sourceId}>{sourceId}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
          <h4>{copy.results}</h4>
          <ol data-field="results">
            {column.results.map((result) => (
              <li
                key={result.recordId}
                data-field="result"
                data-place-id={result.placeId}
                data-jurisdiction-id={result.jurisdictionId}
                data-record-id={result.recordId}
                data-level={result.level ?? ''}
                data-topic={result.topic ?? ''}
                data-norm={result.norm}
                data-source-id={result.sourceId ?? ''}
                data-revision={result.sourceRevision ?? ''}
                data-date-relation={result.dateRelation}
                data-result-date={result.date ?? ''}
                data-issuer-id={result.issuerId ?? ''}
              >
                {result.title ? <p data-field="result-title">{result.title}</p> : null}
                {result.text ? <p data-field="result-text">{result.text}</p> : null}
                <p data-field="result-identity">{result.placeId}</p>
                <p data-field="result-date-relation">{relationText(result.dateRelation, copy)}</p>
              </li>
            ))}
          </ol>
        </>
      ) : null}
    </article>
  );
}

function TopicSide({
  placeId,
  rules,
  empty,
}: {
  placeId: string | null;
  rules: readonly TopicRule[];
  empty: string;
}) {
  return (
    <article data-field="topic-place" data-place-id={placeId ?? ''} data-merged="false">
      {rules.length === 0 ? <p data-field="topic-gap">{empty}</p> : null}
      {rules.map((rule) => (
        <p
          key={rule.recordId}
          data-field="topic-rule"
          data-place-id={rule.placeId}
          data-jurisdiction-id={rule.placeId}
          data-record-id={rule.recordId}
          data-norm={rule.norm}
          data-revision={rule.sourceRevision ?? ''}
          data-merged="false"
        >
          {rule.text ?? rule.title ?? rule.recordId}
        </p>
      ))}
    </article>
  );
}

function viewState(view: CompareView): string {
  if (!view.ready) return 'first-visit';
  if (view.coverage.some((row) => row.left.state === 'missing' || row.right.state === 'missing')) {
    return 'missing-municipal-coverage';
  }
  if (!view.query) return 'no-query';
  return 'changed-manual-location';
}

function relationText(relation: DateRelation, copy: CompareCopy): string {
  if (relation === 'before') return copy.before;
  if (relation === 'after') return copy.after;
  if (relation === 'matches') return copy.matchesDate;
  if (relation === 'unknown') return copy.dateUnknown;
  return copy.notAligned;
}

function columnOf(
  side: Side,
  place: ParsedPlace,
  ready: boolean,
  alignment: { date: Civil | null; mode: DateMode },
  alignedLabel: string,
  sources: readonly AlignedSource[],
  coverage: readonly AlignedCoverage[],
  results: readonly ColumnResult[],
  copy: CompareCopy,
): CompareColumn {
  const selected = Boolean(place.manual && place.placeId);
  return {
    side,
    selected,
    manual: place.manual && Boolean(place.placeId),
    placeId: place.placeId,
    label: place.label,
    parents: place.parentLine,
    recordedDate: place.asOf?.value ?? null,
    alignedDate: ready ? alignment.date?.value ?? null : null,
    sources: sources.map((row) => (side === 'left' ? row.left : row.right)),
    coverage: coverage.map((row) => (side === 'left' ? row.left : row.right)),
    results: ready && selected ? [...results] : [],
    issue: place.manual ? null : copy.manualRequired,
  };
}

function buildAlignment(
  leftBundle: ScopeBundle,
  rightBundle: ScopeBundle,
  aligned: Civil | null,
  copy: CompareCopy,
  shell: ResultCopy,
  locale: ResultLocale,
): {
  sources: AlignedSource[];
  coverage: AlignedCoverage[];
  quarantined: QuarantinedResult[];
  leftResults: ColumnResult[];
  rightResults: ColumnResult[];
  topics: TopicAlignment[];
} {
  const leftId = leftBundle.place.placeId as string;
  const rightId = rightBundle.place.placeId as string;
  const leftCoverage = [
    ...leftBundle.coverage,
    ...rightBundle.foreignCoverage.filter((cell) => cell.jurisdictionId === leftId),
  ];
  const rightCoverage = [
    ...rightBundle.coverage,
    ...leftBundle.foreignCoverage.filter((cell) => cell.jurisdictionId === rightId),
  ];
  const sources = alignSources(leftBundle.place.sources, rightBundle.place.sources, leftCoverage, rightCoverage);
  const coverage = alignCoverage(
    { ...leftBundle, coverage: leftCoverage },
    { ...rightBundle, coverage: rightCoverage },
    copy,
    shell,
    locale,
  );
  const pooled = dedupeResults([...leftBundle.results, ...rightBundle.results]);
  const quarantined: QuarantinedResult[] = [];
  const leftResults: ColumnResult[] = [];
  const rightResults: ColumnResult[] = [];
  for (const result of pooled) {
    const slot = classifyResult(result, leftId, rightId, copy);
    if (slot.kind === 'quarantine') {
      quarantined.push(slot.item);
      continue;
    }
    const column = toColumnResult(result, slot.placeId, aligned);
    if (slot.placeId === leftId) leftResults.push(column);
    else rightResults.push(column);
  }
  const topics = alignTopics(leftResults, rightResults, copy);
  return { sources, coverage, quarantined, leftResults, rightResults, topics };
}

function alignSources(
  leftSources: readonly ParsedSource[],
  rightSources: readonly ParsedSource[],
  leftCoverage: readonly ParsedCoverage[],
  rightCoverage: readonly ParsedCoverage[],
): AlignedSource[] {
  const left = indexSources(leftSources);
  const right = indexSources(rightSources);
  const leftCovered = new Set(leftCoverage.flatMap((cell) => cell.sourceIds));
  const rightCovered = new Set(rightCoverage.flatMap((cell) => cell.sourceIds));
  const ids = new Set<string>([...left.keys(), ...right.keys(), ...leftCovered, ...rightCovered]);
  return [...ids].sort(compareText).map((sourceId) => {
    const leftCell = sourceCell(left.get(sourceId), leftCovered.has(sourceId));
    const rightCell = sourceCell(right.get(sourceId), rightCovered.has(sourceId));
    const revisionsMatch = Boolean(
      leftCell.present && rightCell.present && leftCell.revision && rightCell.revision
      && leftCell.revision === rightCell.revision && !leftCell.unpinned && !rightCell.unpinned,
    );
    return { sourceId, left: leftCell, right: rightCell, revisionsMatch };
  });
}

function sourceCell(cell: SourceCell | undefined, covered: boolean): SourceCell {
  if (cell) return cell;
  if (!covered) return absentSource();
  return { present: true, revision: null, unpinned: true, label: null, level: null, retrievedAt: null };
}

function alignCoverage(
  leftBundle: ScopeBundle,
  rightBundle: ScopeBundle,
  copy: CompareCopy,
  shell: ResultCopy,
  locale: ResultLocale,
): AlignedCoverage[] {
  const levels = new Set<string>(BASE_LEVELS);
  for (const cell of [...leftBundle.coverage, ...rightBundle.coverage]) levels.add(cell.level);
  const ordered = [
    ...BASE_LEVELS,
    ...[...levels].filter((level) => !BASE_LEVELS.includes(level as typeof BASE_LEVELS[number])).sort(compareText),
  ];
  const leftId = leftBundle.place.placeId as string;
  const rightId = rightBundle.place.placeId as string;
  return ordered.map((level) => ({
    level,
    left: coverageCell(leftBundle.coverage, level, leftBundle.place.coverageSupplied, leftId, copy, shell, locale),
    right: coverageCell(rightBundle.coverage, level, rightBundle.place.coverageSupplied, rightId, copy, shell, locale),
  }));
}

function coverageCell(
  cells: readonly ParsedCoverage[],
  level: string,
  supplied: boolean,
  placeId: string,
  copy: CompareCopy,
  shell: ResultCopy,
  locale: ResultLocale,
): CoverageCellView {
  const own = cells.filter((cell) => cell.level === level);
  const severity: Record<CoverageWord, number> = { missing: 0, unknown: 1, unavailable: 2, partial: 3, known: 4 };
  const first = own.slice().sort((left, right) => severity[left.state] - severity[right.state])[0] ?? null;
  let state: CoverageWord;
  if (!supplied) state = 'unknown';
  else if (!first && (level === 'municipal' || level === 'national' || level === 'regional')) state = 'missing';
  else if (!first) state = 'unknown';
  else state = first.state;
  const sourceIds = first ? [...first.sourceIds] : [];
  const indexedRecords = first ? first.indexedRecords : null;
  const countedZero = indexedRecords === 0 && (state === 'known' || state === 'partial');
  let sentence = coverageSentence(state, level, supplied, copy, shell);
  if (locale === 'en' && textImpliesNoLaw(sentence)) sentence = NOT_A_FINDING;
  return {
    placeId,
    jurisdictionId: placeId,
    level,
    state,
    sentence,
    sourceIds,
    indexedRecords,
    countedZero,
    impliesNoLaw: false,
  };
}

function coverageSentence(
  state: CoverageWord,
  level: string,
  supplied: boolean,
  copy: CompareCopy,
  shell: ResultCopy,
): string {
  if (!supplied) return copy.coverageNotSupplied;
  if (state === 'missing' && level === 'municipal') return shell.municipal_gap;
  if (state === 'missing') return `${shell.coverage_missing}. ${copy.notAFinding}`;
  if (state === 'unknown') return `${shell.coverage_unknown}. ${copy.notAFinding}`;
  if (state === 'unavailable') return `${shell.coverage_unavailable}. ${copy.notAFinding}`;
  if (state === 'partial') return shell.coverage_partial;
  return shell.coverage_known;
}

function alignTopics(left: readonly ColumnResult[], right: readonly ColumnResult[], copy: CompareCopy): TopicAlignment[] {
  const keys = new Set<string>();
  for (const result of [...left, ...right]) {
    if (result.local && result.topic) keys.add(topicKey(result.topic));
  }
  return [...keys].sort(compareText).map((key) => {
    const leftRules = left.filter((result) => result.local && result.topic && topicKey(result.topic) === key).map(topicRule);
    const rightRules = right.filter((result) => result.local && result.topic && topicKey(result.topic) === key).map(topicRule);
    const leftNorms = normSet(leftRules);
    const rightNorms = normSet(rightRules);
    const contradiction = leftNorms.size > 0 && rightNorms.size > 0 && !sameSet(leftNorms, rightNorms);
    const texts = [...leftRules, ...rightRules].map((rule) => foldRule(rule.text)).filter(Boolean);
    const sameWording = !contradiction
      && leftRules.length > 0
      && rightRules.length > 0
      && texts.length === leftRules.length + rightRules.length
      && texts.every((text) => text === texts[0])
      && sameSet(leftNorms, rightNorms);
    const label = leftRules[0]?.title || rightRules[0]?.title || left.find((result) => result.topic && topicKey(result.topic) === key)?.topic
      || right.find((result) => result.topic && topicKey(result.topic) === key)?.topic
      || key;
    let note = copy.notOneAnswer;
    if (contradiction) note = copy.contradiction;
    else if (sameWording) note = copy.sameWording;
    else if (leftRules.length > 0 && rightRules.length > 0) note = copy.wordingDiffers;
    note = safeNote(note, [...leftRules, ...rightRules], copy);
    return {
      key,
      label,
      contradiction,
      sameWording,
      merged: false as const,
      assertedAnswer: null,
      left: leftRules,
      right: rightRules,
      note,
    };
  });
}

function safeNote(note: string, rules: readonly TopicRule[], copy: CompareCopy): string {
  for (const rule of rules) {
    const text = rule.text?.trim() ?? '';
    if (text.length >= 12 && note.includes(text)) return copy.notOneAnswer;
  }
  return note;
}

function topicRule(result: ColumnResult): TopicRule {
  return {
    placeId: result.placeId,
    recordId: result.recordId,
    text: result.text,
    title: result.title,
    norm: result.norm,
    sourceId: result.sourceId,
    sourceRevision: result.sourceRevision,
  };
}

function classifyResult(
  result: ParsedResult,
  leftId: string,
  rightId: string,
  copy: CompareCopy,
): { kind: 'place'; placeId: string } | { kind: 'quarantine'; item: QuarantinedResult } {
  if (!result.recordId) {
    return { kind: 'quarantine', item: { recordId: null, reason: 'no-record', message: copy.noRecord } };
  }
  if (result.placeId && result.jurisdictionId && result.placeId !== result.jurisdictionId) {
    return { kind: 'quarantine', item: { recordId: result.recordId, reason: 'identity-conflict', message: copy.identityConflict } };
  }
  const id = result.placeId || result.jurisdictionId;
  if (!id) return { kind: 'quarantine', item: { recordId: result.recordId, reason: 'unassigned', message: copy.unassigned } };
  if (id === leftId || id === rightId) return { kind: 'place', placeId: id };
  return { kind: 'quarantine', item: { recordId: result.recordId, reason: 'outside', message: copy.outsideComparison } };
}

function toColumnResult(result: ParsedResult, placeId: string, aligned: Civil | null): ColumnResult {
  const level = result.level;
  return {
    placeId,
    jurisdictionId: placeId,
    recordId: result.recordId as string,
    title: result.title,
    text: result.text,
    level,
    topic: result.topic,
    norm: result.norm,
    sourceId: result.sourceId,
    sourceRevision: result.sourceRevision,
    date: result.date?.value ?? null,
    dateRelation: dateRelation(result.date, aligned),
    issuerId: result.issuerId,
    local: Boolean(level && LOCAL_LEVELS.has(level)),
  };
}

function dateRelation(date: Civil | null, aligned: Civil | null): DateRelation {
  if (!aligned) return 'not-aligned';
  if (!date) return 'unknown';
  const order = compareCivil(date, aligned);
  if (order === 0) return 'matches';
  if (order < 0) return 'before';
  return 'after';
}

function parsePlace(input: ComparePlaceInput | null | undefined, copy: CompareCopy): ScopeBundle {
  const incomplete = { flag: false };
  const identity = typeof input?.placeId === 'string' ? canonicalizePlaceId(input.placeId) : null;
  const placeId = identity && identity.ok ? identity.placeId : null;
  const manual = isManual(input?.origin) && Boolean(placeId);
  const label = cleanLabel(input?.label) ?? placeId;
  const parents = parseParents(input?.parents);
  const asOf = parseDate(input?.asOf);
  const coverageSupplied = Array.isArray(input?.coverage);
  const sources = manual ? parseSources(input?.sources, incomplete) : [];
  const split = manual ? splitCoverage(input?.coverage, placeId, incomplete) : { own: [], foreign: [] };
  const coverage = split.own;
  const results = manual ? parseResults(input?.results, incomplete) : [];
  const place: ParsedPlace = {
    manual,
    placeId,
    label,
    parents,
    parentLine: parents.map((parent) => parent.label ?? parent.placeId).join(' · '),
    asOf,
    sources,
    coverage,
    coverageSupplied: manual && coverageSupplied,
    results,
    incomplete: incomplete.flag,
    issue: manual || !placeId ? null : copy.manualRequired,
  };
  return { place, coverage, foreignCoverage: split.foreign, results };
}

function splitCoverage(
  value: unknown,
  placeId: string | null,
  incomplete: { flag: boolean },
): { own: ParsedCoverage[]; foreign: ParsedCoverage[] } {
  const own: ParsedCoverage[] = [];
  const foreign: ParsedCoverage[] = [];
  if (!Array.isArray(value) || !placeId) return { own, foreign };
  for (const item of value.slice(0, LIMITS.coverage)) {
    const cell = parseCoverage(item);
    if (!cell) continue;
    if (cell.jurisdictionId && cell.jurisdictionId !== placeId) foreign.push(cell);
    else own.push(cell);
  }
  if (value.length > LIMITS.coverage) incomplete.flag = true;
  return { own, foreign };
}

function parseSources(value: unknown, incomplete: { flag: boolean }): ParsedSource[] {
  if (!Array.isArray(value)) return [];
  const rows: ParsedSource[] = [];
  for (const item of value.slice(0, LIMITS.sources)) {
    const row = parseSource(item);
    if (row) rows.push(row);
  }
  if (value.length > LIMITS.sources) incomplete.flag = true;
  return rows;
}

function parseSource(value: unknown): ParsedSource | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as CompareSourceInput;
  const sourceId = cleanToken(record.sourceId, SOURCE_ID);
  if (!sourceId) return null;
  const revisionRaw = cleanLabel(record.revision);
  const floating = revisionRaw ? FLOATING_REVISIONS.has(revisionRaw.toLowerCase()) : false;
  const revision = revisionRaw && !floating && REVISION_ID.test(revisionRaw) ? revisionRaw : null;
  return {
    sourceId,
    revision,
    unpinned: !revision,
    label: cleanLabel(record.label),
    level: coverageLevel(record.level),
    retrievedAt: parseDate(record.retrievedAt)?.value ?? null,
  };
}

function parseCoverage(value: unknown): ParsedCoverage | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as CompareCoverageInput;
  const level = coverageLevel(record.level);
  if (!level) return null;
  const jurisdiction = typeof record.jurisdictionId === 'string' ? canonicalizePlaceId(record.jurisdictionId) : null;
  const sourceIds = Array.isArray(record.sourceIds)
    ? record.sourceIds.map((item) => cleanToken(item, SOURCE_ID)).filter((item): item is string => Boolean(item))
    : [];
  return {
    jurisdictionId: jurisdiction && jurisdiction.ok ? jurisdiction.placeId : null,
    level,
    state: coverageState(record.state),
    sourceIds: [...new Set(sourceIds)].sort(compareText),
    indexedRecords: countOf(record.indexedRecords),
  };
}

function parseResults(value: unknown, incomplete: { flag: boolean }): ParsedResult[] {
  if (!Array.isArray(value)) return [];
  const rows: ParsedResult[] = [];
  for (const item of value.slice(0, LIMITS.results)) {
    rows.push(parseResult(item));
  }
  if (value.length > LIMITS.results) incomplete.flag = true;
  return rows;
}

function parseResult(value: unknown): ParsedResult {
  const record = value && typeof value === 'object' ? value as CompareResultInput : {};
  const place = typeof record.placeId === 'string' ? canonicalizePlaceId(record.placeId) : null;
  const jurisdiction = typeof record.jurisdictionId === 'string' ? canonicalizePlaceId(record.jurisdictionId) : null;
  const topic = cleanLabel(record.topic);
  const explicit = normOf(record.norm);
  const text = clip(cleanText(record.text));
  return {
    recordId: cleanToken(record.recordId, RECORD_ID),
    placeId: place && place.ok ? place.placeId : null,
    jurisdictionId: jurisdiction && jurisdiction.ok ? jurisdiction.placeId : null,
    title: clip(cleanText(record.title)),
    text,
    level: ruleLevel(record.level),
    topic,
    topicKey: topic ? topicKey(topic) : null,
    norm: explicit !== 'unknown' ? explicit : normFromText(text ?? ''),
    sourceId: cleanToken(record.sourceId, SOURCE_ID),
    sourceRevision: pinnedRevision(record.sourceRevision),
    date: parseDate(record.date),
    issuerId: cleanToken(record.issuerId, RECORD_ID),
  };
}

function parseParents(value: unknown): ParsedParent[] {
  if (!Array.isArray(value)) return [];
  const parents: ParsedParent[] = [];
  for (const item of value.slice(0, LIMITS.parents)) {
    if (!item || typeof item !== 'object') continue;
    const record = item as CompareParentInput;
    const id = typeof record.placeId === 'string' ? canonicalizePlaceId(record.placeId) : null;
    if (!id || !id.ok) continue;
    parents.push({ placeId: id.placeId, label: cleanLabel(record.label) });
  }
  return parents;
}

function indexSources(rows: readonly ParsedSource[]): Map<string, SourceCell> {
  const map = new Map<string, SourceCell>();
  for (const row of rows) {
    if (map.has(row.sourceId)) continue;
    map.set(row.sourceId, {
      present: true,
      revision: row.revision,
      unpinned: row.unpinned,
      label: row.label,
      level: row.level,
      retrievedAt: row.retrievedAt,
    });
  }
  return map;
}

function absentSource(): SourceCell {
  return { present: false, revision: null, unpinned: false, label: null, level: null, retrievedAt: null };
}

function dedupeResults(rows: readonly ParsedResult[]): ParsedResult[] {
  const seen = new Set<string>();
  const kept: ParsedResult[] = [];
  for (const row of rows) {
    const key = `${row.placeId ?? ''}|${row.jurisdictionId ?? ''}|${row.recordId ?? ''}|${row.sourceRevision ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(row);
  }
  return kept;
}

function alignDates(shared: Civil | null, left: Civil | null, right: Civil | null): { mode: DateMode; date: Civil | null } {
  if (shared) return { mode: 'shared', date: shared };
  if (left && right && sharesLabel(left, right)) {
    const precision = coarser(left.precision, right.precision);
    return { mode: 'coarser', date: { value: truncate(left, precision), precision } };
  }
  if (left && right) return { mode: 'unshared', date: null };
  if (left || right) return { mode: 'unshared', date: null };
  return { mode: 'missing', date: null };
}

function alignmentLabel(alignment: { mode: DateMode; date: Civil | null }, copy: CompareCopy): string {
  if (alignment.date) return alignment.date.value;
  if (alignment.mode === 'unshared') return copy.noSharedDate;
  return copy.dateMissing;
}

function sharesLabel(left: Civil, right: Civil): boolean {
  const precision = coarser(left.precision, right.precision);
  return truncate(left, precision) === truncate(right, precision);
}

function compareCivil(left: Civil, right: Civil): -1 | 0 | 1 {
  const precision = coarser(left.precision, right.precision);
  const a = truncate(left, precision);
  const b = truncate(right, precision);
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function coarser(left: Precision, right: Precision): Precision {
  const rank = { year: 0, month: 1, day: 2 };
  return rank[left] <= rank[right] ? left : right;
}

function truncate(date: Civil, precision: Precision): string {
  if (precision === 'year') return date.value.slice(0, 4);
  if (precision === 'month') return date.value.slice(0, 7);
  return date.value;
}

function parseDate(value: unknown): Civil | null {
  if (typeof value === 'string') return parseCivilDate(value);
  if (value && typeof value === 'object' && 'value' in value) {
    const raw = (value as { value?: unknown }).value;
    if (typeof raw === 'string') return parseCivilDate(raw);
  }
  return null;
}

function isManual(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const folded = value.trim().toLowerCase().replace(/[_-]+/g, ' ');
  return folded === 'manual' || folded === 'manually selected';
}

function resolveLocale(value: unknown): ResultLocale {
  if (value === 'nl' || value === 'ar' || value === 'ja' || value === 'en') return value;
  return 'en';
}

function refused(input?: CompareInput | null): boolean {
  if (!input) return false;
  return nonempty(input.assertedAnswer) || nonempty(input.mergedRule) || input.merge === true || input.combine === true;
}

function nonempty(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function cleanQuery(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/[\u0000-\u001F]/g, '').trim();
  if (!text) return null;
  return text.slice(0, 500);
}

function cleanLabel(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).replace(/[\u0000-\u001F]/g, '').trim();
  if (!text) return null;
  return text.slice(0, LIMITS.label);
}

function cleanText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim();
  return text || null;
}

function clip(value: string | null): string | null {
  if (!value) return null;
  return value.length > LIMITS.text ? value.slice(0, LIMITS.text) : value;
}

function cleanToken(value: unknown, pattern: RegExp): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).trim();
  if (!text || text.length > 180 || !pattern.test(text)) return null;
  return text;
}

function pinnedRevision(value: unknown): string | null {
  const text = cleanLabel(value);
  if (!text || FLOATING_REVISIONS.has(text.toLowerCase())) return null;
  return REVISION_ID.test(text) ? text : null;
}

function coverageLevel(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const token = value.trim().toLowerCase();
  if (!token) return null;
  if (['country', 'national', 'constituent-country', 'dependency'].includes(token)) return 'national';
  if (['region', 'province', 'territory', 'regional'].includes(token)) return 'regional';
  if (token === 'state') return 'regional';
  if (LOCAL_LEVELS.has(token)) return 'municipal';
  if (token === 'other' || token === 'special' || token === 'supranational') return token === 'other' ? 'other' : token;
  if (/^[a-z0-9-]{1,40}$/.test(token)) return token;
  return 'other';
}

function ruleLevel(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const token = value.trim().toLowerCase();
  if (!/^[a-z0-9-]{1,40}$/.test(token)) return null;
  return token;
}

function coverageState(value: unknown): CoverageWord {
  if (typeof value !== 'string') return 'unknown';
  const token = value.trim().toLowerCase();
  if (token === 'known' || token === 'verified') return 'known';
  if (token === 'partial') return 'partial';
  if (token === 'missing' || token === 'gap') return 'missing';
  if (token === 'unavailable') return 'unavailable';
  return 'unknown';
}

function countOf(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return null;
  return value;
}

function normOf(value: unknown): Norm {
  if (typeof value !== 'string') return 'unknown';
  const token = value.trim().toLowerCase().replace(/[\s_]+/g, '-');
  if (['permit', 'permitted', 'allow', 'allowed', 'may', 'permission'].includes(token)) return 'permit';
  if (['prohibit', 'prohibited', 'forbid', 'forbidden', 'ban', 'banned', 'must-not'].includes(token)) return 'prohibit';
  if (['require', 'required', 'must', 'shall'].includes(token)) return 'require';
  return 'unknown';
}

function normFromText(text: string): Norm {
  const folded = text.toLocaleLowerCase('en');
  const hasProhibit = /\b(?:prohibited|forbidden|banned|unlawful|not permitted|must not|shall not)\b/.test(folded);
  const stripped = folded
    .replace(/\bmust not\b/g, ' ')
    .replace(/\bshall not\b/g, ' ')
    .replace(/\bnot permitted\b/g, ' ');
  const hasRequire = /\b(?:required|must|shall)\b/.test(stripped);
  const hasPermit = /\b(?:permitted|allowed)\b/.test(stripped) || /\bmay\b/.test(stripped);
  const hits = [hasProhibit, hasRequire, hasPermit].filter(Boolean).length;
  if (hits !== 1) return 'unknown';
  if (hasProhibit) return 'prohibit';
  if (hasRequire) return 'require';
  return 'permit';
}

function normSet(rules: readonly TopicRule[]): Set<Norm> {
  const norms = new Set<Norm>();
  for (const rule of rules) {
    if (rule.norm !== 'unknown') norms.add(rule.norm);
  }
  return norms;
}

function sameSet(left: Set<Norm>, right: Set<Norm>): boolean {
  if (left.size !== right.size) return false;
  for (const item of left) if (!right.has(item)) return false;
  return true;
}

function topicKey(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('en').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().slice(0, 120);
}

function foldRule(value: string | null): string {
  if (!value) return '';
  return value.normalize('NFKC').toLocaleLowerCase('en').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function fold(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('en').replace(/\s+/g, ' ').trim();
}

function parentLabels(value: readonly CompareParentInput[] | null | undefined): string {
  if (!value) return '';
  return value
    .map((parent) => (typeof parent.label === 'string' ? parent.label.trim() : ''))
    .filter(Boolean)
    .join(' · ');
}

function filterCandidates(candidates: readonly ComparePlaceInput[], query: string): ComparePlaceInput[] {
  const needle = fold(query);
  const rows = candidates.filter((candidate) => {
    const id = typeof candidate.placeId === 'string' ? candidate.placeId : '';
    if (!id || !canonicalizePlaceId(id).ok) return false;
    if (!needle) return true;
    const label = typeof candidate.label === 'string' ? candidate.label : '';
    const parents = parentLabels(candidate.parents);
    return fold(`${label} ${id} ${parents}`).includes(needle);
  });
  return rows
    .slice()
    .sort((left, right) => compareText(String(left.label ?? left.placeId), String(right.label ?? right.placeId)))
    .slice(0, LIMITS.candidates);
}

function levelName(level: string, copy: ResultCopy): string {
  if (level === 'national') return copy.level_national;
  if (level === 'regional') return copy.level_regional;
  if (level === 'municipal') return copy.level_municipal;
  if (level === 'special') return copy.level_special;
  if (level === 'supranational') return copy.level_supranational;
  return copy.level_other;
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export default ComparePlaces;

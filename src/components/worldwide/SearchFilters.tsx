/**
 * Filters for worldwide results.
 *
 * Jurisdiction level, place, topic, instrument, language, source, and
 * date/status are strict retrieval inputs. Group by level is display only
 * and starts off. A municipal or city place filter is not sent as a
 * local-only band allow-list: that would hide national law.
 */

import { useEffect, useId, useRef, type KeyboardEvent } from 'react';
import { INSTRUMENT_KINDS } from '../../lib/worldwide/data/schema';
import { STATUS_FILTERS } from '../../lib/worldwide/search/planner';
import '../../styles/worldwide.css';

export const RESULT_LOCALES = ['en', 'nl', 'ar', 'ja'] as const;
export type ResultLocale = (typeof RESULT_LOCALES)[number];

export const RESULT_STATE_IDS = [
  'first-visit',
  'approximate-suggestion',
  'ip-unavailable',
  'location-denied',
  'ambiguous-place',
  'changed-manual-location',
  'border-uncertainty',
  'no-query',
  'no-matches',
  'unsearched-collection',
  'missing-municipal-coverage',
  'partially-loaded',
  'cancelled-query',
  'throttling-or-outage',
  'stale-cache',
  'offline-saved',
  'model-unavailable',
  'source-or-status-unknown',
  'translated-text',
  'historical-or-future-law',
  'malformed-url',
  'screen-reader-scope-change',
] as const;
export type ResultStateId = (typeof RESULT_STATE_IDS)[number];

export interface DisplayFilters {
  level: '' | 'national' | 'regional' | 'municipal' | 'local' | 'other';
  place: string;
  topic: string;
  instrument: string;
  language: string;
  source: string;
  dateStatus: string;
  groupByLevel: boolean;
}

export const EMPTY_DISPLAY_FILTERS: DisplayFilters = {
  level: '',
  place: '',
  topic: '',
  instrument: '',
  language: '',
  source: '',
  dateStatus: '',
  groupByLevel: false,
};

export interface ResultCopy {
  dir: 'ltr' | 'rtl';
  lang: ResultLocale;
  search_label: string;
  search_placeholder: string;
  filters: string;
  close_filters: string;
  laws_and_sources: string;
  included_because: string;
  original_title: string;
  translation: string;
  machine_translation: string;
  official_translation: string;
  applicability: string;
  stack_limit: string;
  as_of: string;
  searched: string;
  remaining: string;
  results: string;
  cancel: string;
  any: string;
  level: string;
  level_national: string;
  level_regional: string;
  level_municipal: string;
  level_other: string;
  level_special: string;
  level_supranational: string;
  place: string;
  topic: string;
  instrument: string;
  document_language: string;
  source: string;
  date_status: string;
  group_by_level: string;
  unknown: string;
  unknown_status: string;
  historical: string;
  future: string;
  not_all_results: string;
  capped: string;
  no_matches: string;
  unsearched: string;
  empty_query: string;
  municipal_gap: string;
  coverage: string;
  coverage_known: string;
  coverage_partial: string;
  coverage_missing: string;
  coverage_unknown: string;
  coverage_unavailable: string;
  loading: string;
  cancelled: string;
  stale: string;
  offline: string;
  outage: string;
  next_partial: string;
  next_cancel: string;
  next_nomatch: string;
  next_query: string;
  next_municipal: string;
  next_stale: string;
  next_offline: string;
  next_outage: string;
  next_unknown: string;
  next_translation: string;
  next_historical: string;
  next_ready: string;
  next_unsearched: string;
}

const EN: ResultCopy = {
  dir: 'ltr',
  lang: 'en',
  search_label: 'Search laws and sources',
  search_placeholder: 'Question, citation, or identifier',
  filters: 'Filters',
  close_filters: 'Close filters',
  laws_and_sources: 'Laws and sources for this place',
  included_because: 'Included because',
  original_title: 'Original title',
  translation: 'Translation',
  machine_translation: 'Machine translation',
  official_translation: 'Official translation',
  applicability: 'This choice does not decide that a law applies.',
  stack_limit: 'This authority stack does not decide what binds conduct at this place.',
  as_of: 'As of',
  searched: 'Searched',
  remaining: 'Remaining',
  results: 'Results',
  cancel: 'Cancel search',
  any: 'Any',
  level: 'Jurisdiction level',
  level_national: 'National',
  level_regional: 'Regional',
  level_municipal: 'Municipal',
  level_other: 'Other',
  level_special: 'Special',
  level_supranational: 'Supranational',
  place: 'Place',
  topic: 'Topic',
  instrument: 'Instrument type',
  document_language: 'Document language',
  source: 'Source',
  date_status: 'Date or status',
  group_by_level: 'Group by level',
  unknown: 'unknown',
  unknown_status: 'Status unknown',
  historical: 'Historical text',
  future: 'Future commencement',
  not_all_results: 'This is not all worldwide results.',
  capped: 'These are the results retrieved so far. This is not all worldwide results.',
  no_matches: 'No matches in the collections that were searched.',
  unsearched: 'This collection was not searched.',
  empty_query: 'Enter a question, citation, or identifier. An empty search is not a result about the law.',
  municipal_gap: 'No municipal collection is in the catalog for this place. That is a coverage gap, not a finding that no local law exists.',
  coverage: 'Coverage',
  coverage_known: 'Known collection',
  coverage_partial: 'Partial collection',
  coverage_missing: 'No collection in the catalog',
  coverage_unknown: 'Coverage unknown',
  coverage_unavailable: 'Collection unavailable',
  loading: 'Results are still loading.',
  cancelled: 'The search was cancelled.',
  stale: 'This saved copy is older than the catalog revision.',
  offline: 'Offline. Showing saved material only.',
  outage: 'This source is unavailable right now.',
  next_partial: 'Read the results already shown, or continue loading the remaining shards.',
  next_cancel: 'Start a new search. The cancelled results stay off the page.',
  next_nomatch: 'Revise the query, clear a filter, or open coverage for this place.',
  next_query: 'Enter a question, citation, or identifier, then search.',
  next_municipal: 'Read the national and regional sources, and open the municipal coverage gap.',
  next_stale: 'Refresh this source, or keep reading the saved copy with its revision visible.',
  next_offline: 'Read the saved material, or reconnect to search sources that are not on this device.',
  next_outage: 'Retry the source, or read saved material when a copy is on this device.',
  next_unknown: 'Open the source record, or search a source whose status is known.',
  next_translation: 'Read the original text, or keep the labelled translation beside it.',
  next_historical: 'Set the as-of date, or open the version that matches it.',
  next_ready: 'Review the announced place, date, and coverage, then search or change place.',
  next_unsearched: 'Continue the search, or open the unsearched collection on the coverage page.',
};

const COPY: Record<ResultLocale, ResultCopy> = {
  en: EN,
  nl: {
    ...EN,
    lang: 'nl',
    search_label: 'Zoek in wetten en bronnen',
    search_placeholder: 'Vraag, vindplaats of kenmerk',
    filters: 'Filters',
    close_filters: 'Filters sluiten',
    laws_and_sources: 'Wetten en bronnen voor deze plaats',
    included_because: 'Opgenomen omdat',
    original_title: 'Oorspronkelijke titel',
    translation: 'Vertaling',
    machine_translation: 'Machinevertaling',
    official_translation: 'Officiële vertaling',
    applicability: 'Deze keuze bepaalt niet dat een wet van toepassing is.',
    stack_limit: 'Deze bevoegdhedenstapel bepaalt niet wat het gedrag op deze plaats bindt.',
    as_of: 'Per',
    searched: 'Doorzocht',
    remaining: 'Resterend',
    results: 'Resultaten',
    cancel: 'Zoeken annuleren',
    any: 'Alles',
    level: 'Jurisdictieniveau',
    level_national: 'Nationaal',
    level_regional: 'Regionaal',
    level_municipal: 'Gemeentelijk',
    level_other: 'Overig',
    level_special: 'Bijzonder',
    level_supranational: 'Supranationaal',
    place: 'Plaats',
    topic: 'Onderwerp',
    instrument: 'Soort instrument',
    document_language: 'Taal van het document',
    source: 'Bron',
    date_status: 'Datum of status',
    group_by_level: 'Groepeer op niveau',
    unknown: 'onbekend',
    unknown_status: 'Status onbekend',
    historical: 'Historische tekst',
    future: 'Toekomstige inwerkingtreding',
    not_all_results: 'Dit zijn niet alle wereldwijde resultaten.',
    capped: 'Dit zijn de tot nu toe opgehaalde resultaten. Dit zijn niet alle wereldwijde resultaten.',
    no_matches: 'Geen treffers in de doorzochte verzamelingen.',
    unsearched: 'Deze verzameling is niet doorzocht.',
    empty_query: 'Voer een vraag, vindplaats of kenmerk in. Een lege zoekactie is geen resultaat over het recht.',
    municipal_gap: 'Er is geen gemeentelijke verzameling in de catalogus voor deze plaats. Dit is een dekkingsgat, geen vaststelling dat er geen lokale wet bestaat.',
    coverage: 'Dekking',
    coverage_known: 'Bekende verzameling',
    coverage_partial: 'Gedeeltelijke verzameling',
    coverage_missing: 'Geen verzameling in de catalogus',
    coverage_unknown: 'Dekking onbekend',
    coverage_unavailable: 'Verzameling niet beschikbaar',
    loading: 'Resultaten worden nog geladen.',
    cancelled: 'De zoekactie is geannuleerd.',
    stale: 'Dit opgeslagen exemplaar is ouder dan de catalogusrevisie.',
    offline: 'Offline. Alleen opgeslagen materiaal wordt getoond.',
    outage: 'Deze bron is nu niet beschikbaar.',
    next_partial: 'Lees de al getoonde resultaten, of laad de resterende delen.',
    next_cancel: 'Start een nieuwe zoekactie. De geannuleerde resultaten blijven van de pagina.',
    next_nomatch: 'Wijzig de vraag, wis een filter, of open de dekking voor deze plaats.',
    next_query: 'Voer een vraag, vindplaats of kenmerk in en zoek daarna.',
    next_municipal: 'Lees de nationale en regionale bronnen en open het gemeentelijke dekkingsgat.',
    next_stale: 'Ververs deze bron, of blijf het opgeslagen exemplaar lezen met de revisie in beeld.',
    next_offline: 'Lees het opgeslagen materiaal, of maak opnieuw verbinding voor bronnen die niet op dit apparaat staan.',
    next_outage: 'Probeer de bron opnieuw, of lees opgeslagen materiaal als er een exemplaar op dit apparaat staat.',
    next_unknown: 'Open de bron, of zoek een bron waarvan de status bekend is.',
    next_translation: 'Lees de oorspronkelijke tekst, of houd de gelabelde vertaling ernaast.',
    next_historical: 'Stel de peildatum in, of open de versie die daarbij hoort.',
    next_ready: 'Controleer de aangekondigde plaats, datum en dekking, en zoek of wijzig de plaats.',
    next_unsearched: 'Ga verder met zoeken, of open de niet-doorzochte verzameling op de dekkingspagina.',
  },
  ar: {
    ...EN,
    dir: 'rtl',
    lang: 'ar',
    search_label: 'البحث في القوانين والمصادر',
    search_placeholder: 'سؤال أو استشهاد أو معرّف',
    filters: 'عوامل التصفية',
    close_filters: 'إغلاق عوامل التصفية',
    laws_and_sources: 'القوانين والمصادر لهذا المكان',
    included_because: 'مُدرج لأن',
    original_title: 'العنوان الأصلي',
    translation: 'ترجمة',
    machine_translation: 'ترجمة آلية',
    official_translation: 'ترجمة رسمية',
    applicability: 'هذا الاختيار لا يقرر أن قانونًا ينطبق.',
    stack_limit: 'هذا التسلسل لا يقرر ما الذي يُلزم السلوك في هذا المكان.',
    as_of: 'اعتبارًا من',
    searched: 'ما بُحث',
    remaining: 'المتبقي',
    results: 'النتائج',
    cancel: 'إلغاء البحث',
    any: 'أي',
    level: 'مستوى الولاية',
    level_national: 'وطني',
    level_regional: 'إقليمي',
    level_municipal: 'بلدي',
    level_other: 'أخرى',
    level_special: 'خاص',
    level_supranational: 'فوق وطني',
    place: 'المكان',
    topic: 'الموضوع',
    instrument: 'نوع الصك',
    document_language: 'لغة الوثيقة',
    source: 'المصدر',
    date_status: 'التاريخ أو الحالة',
    group_by_level: 'التجميع حسب المستوى',
    unknown: 'غير معروف',
    unknown_status: 'الحالة غير معروفة',
    historical: 'نص تاريخي',
    future: 'نفاذ مستقبلي',
    not_all_results: 'هذه ليست كل النتائج العالمية.',
    capped: 'هذه النتائج التي استُرجعت حتى الآن. هذه ليست كل النتائج العالمية.',
    no_matches: 'لا مطابقات في المجموعات التي بُحثت.',
    unsearched: 'لم يُبحث في هذه المجموعة.',
    empty_query: 'أدخل سؤالًا أو استشهادًا أو معرّفًا. البحث الفارغ ليس نتيجة عن القانون.',
    municipal_gap: 'لا مجموعة بلدية في الفهرس لهذا المكان. هذه فجوة في التغطية، وليست نتيجة بأن لا قانون محليًا.',
    coverage: 'التغطية',
    coverage_known: 'مجموعة معروفة',
    coverage_partial: 'مجموعة جزئية',
    coverage_missing: 'لا مجموعة في الفهرس',
    coverage_unknown: 'التغطية غير معروفة',
    coverage_unavailable: 'المجموعة غير متاحة',
    loading: 'النتائج ما زالت تُحمّل.',
    cancelled: 'أُلغي البحث.',
    stale: 'هذه النسخة المحفوظة أقدم من مراجعة الفهرس.',
    offline: 'دون اتصال. تُعرض المواد المحفوظة فقط.',
    outage: 'هذا المصدر غير متاح الآن.',
    next_partial: 'اقرأ النتائج المعروضة، أو تابع تحميل الأجزاء المتبقية.',
    next_cancel: 'ابدأ بحثًا جديدًا. تبقى النتائج الملغاة خارج الصفحة.',
    next_nomatch: 'عدّل السؤال، أو امسح عامل تصفية، أو افتح التغطية لهذا المكان.',
    next_query: 'أدخل سؤالًا أو استشهادًا أو معرّفًا، ثم ابحث.',
    next_municipal: 'اقرأ المصادر الوطنية والإقليمية، وافتح فجوة التغطية البلدية.',
    next_stale: 'حدّث هذا المصدر، أو واصل قراءة النسخة المحفوظة مع ظهور مراجعتها.',
    next_offline: 'اقرأ المادة المحفوظة، أو أعد الاتصال للبحث في مصادر ليست على هذا الجهاز.',
    next_outage: 'أعد المحاولة، أو اقرأ المادة المحفوظة إن وُجدت نسخة على هذا الجهاز.',
    next_unknown: 'افتح سجل المصدر، أو ابحث في مصدر حالته معروفة.',
    next_translation: 'اقرأ النص الأصلي، أو أبقِ الترجمة الموسومة إلى جانبه.',
    next_historical: 'حدّد تاريخ السريان، أو افتح النسخة التي تطابقه.',
    next_ready: 'راجع المكان والتاريخ والتغطية المعلنة، ثم ابحث أو غيّر المكان.',
    next_unsearched: 'تابع البحث، أو افتح المجموعة التي لم تُبحث في صفحة التغطية.',
  },
  ja: {
    ...EN,
    lang: 'ja',
    search_label: '法令と情報源を検索',
    search_placeholder: '質問、引用、または識別子',
    filters: '絞り込み',
    close_filters: '絞り込みを閉じる',
    laws_and_sources: 'この場所の法令と情報源',
    included_because: '収録した理由：',
    original_title: '原題',
    translation: '翻訳',
    machine_translation: '機械翻訳',
    official_translation: '公式訳',
    applicability: 'この選択は、法令が適用されることを決めるものではありません。',
    stack_limit: 'この権限の積み重ねは、この場所で行為を拘束する内容を決めるものではありません。',
    as_of: '時点',
    searched: '検索済み',
    remaining: '未検索',
    results: '結果',
    cancel: '検索を中止',
    any: '指定しない',
    level: '管轄の段階',
    level_national: '国',
    level_regional: '地域',
    level_municipal: '基礎自治体',
    level_other: 'その他',
    level_special: '特別',
    level_supranational: '超国家',
    place: '場所',
    topic: '主題',
    instrument: '文書の種類',
    document_language: '文書の言語',
    source: '情報源',
    date_status: '日付または状態',
    group_by_level: '段階で分ける',
    unknown: '不明',
    unknown_status: '状態不明',
    historical: '過去の条文',
    future: '将来の施行',
    not_all_results: 'これは世界全体の結果ではありません。',
    capped: 'これらはこれまでに取得した結果です。これは世界全体の結果ではありません。',
    no_matches: '検索したコレクションに一致はありません。',
    unsearched: 'このコレクションは検索していません。',
    empty_query: '質問、引用、または識別子を入力してください。空の検索は法令についての結果ではありません。',
    municipal_gap: 'この場所の基礎自治体のコレクションはカタログにありません。これは収録の欠落であり、現地に法令がないという結論ではありません。',
    coverage: '収録範囲',
    coverage_known: '収録済みのコレクション',
    coverage_partial: '一部のみ収録',
    coverage_missing: 'カタログにコレクションがない',
    coverage_unknown: '収録範囲は不明',
    coverage_unavailable: 'コレクションを利用できない',
    loading: '結果を読み込んでいます。',
    cancelled: '検索を中止しました。',
    stale: 'この保存コピーはカタログの版より古いです。',
    offline: 'オフラインです。この端末に保存された資料だけを表示しています。',
    outage: 'この情報源は今は利用できません。',
    next_partial: '表示済みの結果を読むか、残りのシャードを読み込んでください。',
    next_cancel: '新しい検索を始めてください。中止した結果はページに出ません。',
    next_query: '質問、引用、または識別子を入力して検索してください。',
    next_nomatch: '検索語を見直すか、絞り込みを消すか、この場所の収録範囲を開いてください。',
    next_municipal: '国と地域の情報源を読み、基礎自治体の収録の欠落を開いてください。',
    next_stale: 'この情報源を更新するか、版を表示したまま保存コピーを読み続けてください。',
    next_offline: '保存された資料を読むか、この端末にない情報源を検索するために再接続してください。',
    next_outage: '情報源を再試行するか、この端末にコピーがある場合は保存資料を読んでください。',
    next_unknown: '情報源の記録を開くか、状態が分かっている情報源を検索してください。',
    next_translation: '原文を読むか、ラベル付きの翻訳を並べたままにしてください。',
    next_historical: '時点を設定するか、その時点に合う版を開いてください。',
    next_ready: '読み上げられた場所、日付、収録範囲を確認してから、検索するか場所を変更してください。',
    next_unsearched: '検索を続けるか、未検索のコレクションを収録範囲のページで開いてください。',
  },
};

export function resultCopy(locale: ResultLocale | null | undefined): ResultCopy {
  if (locale === 'nl' || locale === 'ar' || locale === 'ja') return COPY[locale];
  return COPY.en;
}

export function normalizeDisplayFilters(input?: Partial<DisplayFilters> | null): DisplayFilters {
  const level = input?.level ?? '';
  const allowed = new Set(['', 'national', 'regional', 'municipal', 'local', 'other']);
  return {
    level: allowed.has(level) ? level : '',
    place: typeof input?.place === 'string' ? input.place : '',
    topic: typeof input?.topic === 'string' ? input.topic : '',
    instrument: typeof input?.instrument === 'string' ? input.instrument : '',
    language: typeof input?.language === 'string' ? input.language : '',
    source: typeof input?.source === 'string' ? input.source : '',
    dateStatus: typeof input?.dateStatus === 'string' ? input.dateStatus : '',
    groupByLevel: input?.groupByLevel === true,
  };
}

export function bandLabel(band: string, copy: ResultCopy): string {
  if (band === 'national') return copy.level_national;
  if (band === 'regional') return copy.level_regional;
  if (band === 'local' || band === 'municipal') return copy.level_municipal;
  if (band === 'special') return copy.level_special;
  if (band === 'supranational') return copy.level_supranational;
  return copy.level_other;
}

export function localizeInclusion(because: string, copy: ResultCopy): string {
  const text = because.trim();
  const english = 'Included because';
  const body = text.startsWith(`${english} `) ? text.slice(english.length).trim() : text;
  if (!body) {
    return copy.lang === 'ja' ? `${copy.included_because}${copy.unknown}` : `${copy.included_because} ${copy.unknown}`;
  }
  if (copy.included_because === english) {
    return text.startsWith(`${english} `) ? text : `${english} ${body}`;
  }
  if (copy.lang === 'ja') return `${copy.included_because}${body}`;
  return `${copy.included_because} ${body}`;
}

export function coverageLabel(state: string, copy: ResultCopy): string {
  if (state === 'known') return copy.coverage_known;
  if (state === 'partial') return copy.coverage_partial;
  if (state === 'missing') return copy.coverage_missing;
  if (state === 'unavailable') return copy.coverage_unavailable;
  return copy.coverage_unknown;
}

const LANGUAGE_CODES = ['en', 'nl', 'ar', 'ja', 'fr', 'de', 'es', 'zh'] as const;

export interface SearchFiltersProps {
  filters: DisplayFilters;
  onChange: (filters: DisplayFilters) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  copy: ResultCopy;
  sheet?: boolean;
  id?: string;
}

export function SearchFilters({
  filters,
  onChange,
  open,
  onOpenChange,
  copy,
  sheet = false,
  id = 'wwl-filters',
}: SearchFiltersProps) {
  const headingId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) headingRef.current?.focus();
  }, [open]);

  function close() {
    onOpenChange(false);
    toggleRef.current?.focus();
  }

  function patch(next: Partial<DisplayFilters>) {
    onChange({ ...filters, ...next });
  }

  function onPanelKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (!sheet || event.key !== 'Tab' || !panelRef.current) return;
    const items = [...panelRef.current.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href]')]
      .filter((node) => !node.hasAttribute('disabled'));
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="wwl-filters-slot">
      <button
        type="button"
        id={id}
        ref={toggleRef}
        className="wwl-filters-toggle"
        aria-expanded={open}
        onClick={() => (open ? close() : onOpenChange(true))}
      >
        {copy.filters}
      </button>
      <div
        ref={panelRef}
        className="wwl-filters"
        data-open={open ? 'true' : 'false'}
        hidden={!open}
        role={sheet && open ? 'dialog' : undefined}
        aria-modal={sheet && open ? true : undefined}
        aria-labelledby={open ? headingId : undefined}
        onKeyDown={onPanelKey}
      >
        <h2 id={headingId} tabIndex={-1} ref={headingRef}>{copy.filters}</h2>
        <div className="wwl-filter-grid">
          <label>
            {copy.level}
            <select
              value={filters.level === 'local' ? 'municipal' : filters.level}
              onChange={(event) => patch({ level: event.target.value as DisplayFilters['level'] })}
            >
              <option value="">{copy.any}</option>
              <option value="national">{copy.level_national}</option>
              <option value="regional">{copy.level_regional}</option>
              <option value="municipal">{copy.level_municipal}</option>
              <option value="other">{copy.level_other}</option>
            </select>
          </label>
          <label>
            {copy.place}
            <input
              type="text"
              value={filters.place}
              onChange={(event) => patch({ place: event.target.value })}
            />
          </label>
          <label>
            {copy.topic}
            <input
              type="text"
              value={filters.topic}
              onChange={(event) => patch({ topic: event.target.value })}
            />
          </label>
          <label>
            {copy.instrument}
            <select value={filters.instrument} onChange={(event) => patch({ instrument: event.target.value })}>
              <option value="">{copy.any}</option>
              {INSTRUMENT_KINDS.map((kind) => <option key={kind} value={kind}>{kind}</option>)}
            </select>
          </label>
          <label>
            {copy.document_language}
            <select value={filters.language} onChange={(event) => patch({ language: event.target.value })}>
              <option value="">{copy.any}</option>
              {LANGUAGE_CODES.map((code) => <option key={code} value={code}>{code}</option>)}
            </select>
          </label>
          <label>
            {copy.source}
            <input
              type="text"
              value={filters.source}
              onChange={(event) => patch({ source: event.target.value })}
            />
          </label>
          <label>
            {copy.date_status}
            <select value={filters.dateStatus} onChange={(event) => patch({ dateStatus: event.target.value })}>
              <option value="">{copy.any}</option>
              {STATUS_FILTERS.map((status) => (
                <option key={status} value={status}>
                  {status === 'historical' ? copy.historical : status === 'not-yet-in-force' ? copy.future : status === 'unknown' ? copy.unknown_status : status}
                </option>
              ))}
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              checked={filters.groupByLevel}
              onChange={(event) => patch({ groupByLevel: event.target.checked })}
            />
            {copy.group_by_level}
          </label>
        </div>
        <button type="button" onClick={close}>{copy.close_filters}</button>
      </div>
    </div>
  );
}

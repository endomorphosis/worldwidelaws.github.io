/**
 * Search context for the worldwide shell.
 *
 * Place, as-of date, and interface language stay in this context.
 * The first screen does not invent a Dutch query, and it does not call
 * login, a proxy, GeoIP, or a model. Netherlands links migrate only when
 * the NL migration flag is on. Nothing here decides that a law applies.
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react';
import {
  DUTCH_EXAMPLE_QUERIES,
  DUTCH_INITIAL_EXAMPLE_QUERY,
  STABLE_NETHERLANDS_PLACE_ID,
  buildRoute,
  canonicalizePlaceId,
  parseRoute,
  type RouteName,
  type SearchScope,
} from '../../lib/worldwide/routes';
import {
  applyDutchExample,
  createPlaceState,
  decodeSavedPlace,
  encodeSavedPlace,
  noteEnvironment,
  saveSelection,
  selectPlace,
  setAsOf as commitAsOf,
  type PlaceState,
  type SavedPlaceInput,
} from '../../lib/worldwide/location/state';

export const SHELL_SCHEMA = 'worldwide-legal-search.shell@1';
export const NL_MIGRATION_STORAGE_KEY = 'worldwide-legal-search.nl-migration';
export const UI_LANGUAGE_STORAGE_KEY = 'worldwide-legal-search.ui-language';
export const SAVED_PLACE_STORAGE_KEY = 'worldwide-legal-search.saved-place';

export const INTERFACE_LOCALES = ['en', 'nl', 'ar', 'ja'] as const;
export type InterfaceLocale = (typeof INTERFACE_LOCALES)[number];

export const SHELL_STATE_IDS = [
  'first-visit',
  'approximate-suggestion',
  'ambiguous-place',
  'changed-manual-location',
  'border-uncertainty',
  'no-query',
  'malformed-url',
  'screen-reader-scope-change',
] as const;
export type ShellStateId = (typeof SHELL_STATE_IDS)[number];

const LEGACY_MIGRATIONS = new Set([
  'dutch-initial-example',
  'dutch-example',
  'dutch-query',
  'dutch-home',
  'dutch-sample',
  'dutch-source',
  'dutch-publisher',
]);

const ROUTE_PROBLEMS = new Set([
  'malformed-url',
  'unknown-route',
  'malformed-encoding',
  'unknown-parameter',
  'unexpected-path',
]);

const FLAG_ON = new Set(['1', 'true', 'on', 'legacy']);

export interface ShellCopy {
  dir: 'ltr' | 'rtl';
  lang: InterfaceLocale;
  product: string;
  search_label: string;
  search_placeholder: string;
  skip_to_search: string;
  skip_to_results: string;
  skip_to_filters: string;
  change_place: string;
  choose_place: string;
  this_place: string;
  search_worldwide: string;
  as_of: string;
  language: string;
  filters: string;
  close_filters: string;
  coverage: string;
  laws_and_sources: string;
  applicability: string;
  unselected_worldwide: string;
  origin_url: string;
  origin_manual: string;
  origin_saved: string;
  origin_device: string;
  origin_ip: string;
  coverage_unknown: string;
  coverage_partial: string;
  searched: string;
  remaining: string;
  results: string;
  pages: string;
  page_search: string;
  page_place: string;
  page_coverage: string;
  page_compare: string;
  page_law: string;
  page_sources: string;
  examples: string;
  open_legacy: string;
  legacy_unavailable: string;
  save_place: string;
  scope_label: string;
  empty_query: string;
  unsearched: string;
  place_id_hint: string;
  place_list: string;
  country_row: string;
  keep_place: string;
  any: string;
  level: string;
  level_national: string;
  level_regional: string;
  level_municipal: string;
  level_other: string;
  topic: string;
  instrument: string;
  document_language: string;
  source: string;
  date_status: string;
  first_visit_next: string;
  first_visit_status: string;
  first_visit_live: string;
  no_query_next: string;
  no_query_status: string;
  manual_next: string;
  manual_status: string;
  malformed_next: string;
  malformed_status: string;
  scope_next: string;
  scope_status: string;
  approximate_next: string;
  approximate_status: string;
  ambiguous_next: string;
  ambiguous_status: string;
  border_next: string;
  border_status: string;
  language_name: Record<InterfaceLocale, string>;
}

const COPY: Record<InterfaceLocale, ShellCopy> = {
  en: {
    dir: 'ltr',
    lang: 'en',
    product: 'Worldwide laws',
    search_label: 'Search laws and sources',
    search_placeholder: 'Question, citation, or identifier',
    skip_to_search: 'Skip to search',
    skip_to_results: 'Skip to results',
    skip_to_filters: 'Skip to filters',
    change_place: 'Change place',
    choose_place: 'Choose a place',
    this_place: 'This place',
    search_worldwide: 'Search worldwide',
    as_of: 'As of',
    language: 'Language',
    filters: 'Filters',
    close_filters: 'Close filters',
    coverage: 'Coverage',
    laws_and_sources: 'Laws and sources for this place',
    applicability: 'This choice does not decide that a law applies.',
    unselected_worldwide: 'unselected worldwide',
    origin_url: 'shared URL',
    origin_manual: 'manually selected',
    origin_saved: 'saved selection',
    origin_device: 'device location',
    origin_ip: 'approximate IP location',
    coverage_unknown: 'Coverage unknown',
    coverage_partial: 'Partial collection',
    searched: 'Searched',
    remaining: 'Remaining',
    results: 'Results',
    pages: 'Pages',
    page_search: 'Search',
    page_place: 'Place',
    page_coverage: 'Coverage',
    page_compare: 'Compare',
    page_law: 'Law',
    page_sources: 'Sources',
    examples: 'Netherlands examples',
    open_legacy: 'Open the Netherlands research workspace',
    legacy_unavailable: 'The Netherlands research workspace did not open. Search on this page stays available.',
    save_place: 'Save place',
    scope_label: 'Scope',
    empty_query: 'Enter a question, citation, or identifier. An empty search is not a result about the law.',
    unsearched: 'This collection was not searched.',
    place_id_hint: 'Choose a stable place id such as place:netherlands.',
    place_list: 'Places',
    country_row: 'Country. No municipality was added.',
    keep_place: 'Keep the current place',
    any: 'Any',
    level: 'Jurisdiction level',
    level_national: 'National',
    level_regional: 'Regional',
    level_municipal: 'Municipal',
    level_other: 'Other',
    topic: 'Topic',
    instrument: 'Instrument type',
    document_language: 'Document language',
    source: 'Source',
    date_status: 'Date or status',
    first_visit_next: 'Choose a place or search worldwide.',
    first_visit_status: 'The place is unselected worldwide. Search is ready. No result is invented.',
    first_visit_live: 'Worldwide laws. No place is selected. Choose a place or search worldwide.',
    no_query_next: 'Enter a question, citation, or identifier, then search.',
    no_query_status: 'The query is empty. An empty search is not a result about the law.',
    manual_next: 'Search this place, or change it.',
    manual_status: 'The place was manually selected. A late suggestion cannot replace it.',
    malformed_next: 'Correct the link, or continue with the place and date already on the page.',
    malformed_status: 'This link has a parameter that could not be read.',
    scope_next: 'Review the announced place, date, and coverage, then search or change place.',
    scope_status: 'The place on this page came from the link.',
    approximate_next: 'Change place if this approximate suggestion is wrong, or search this place.',
    approximate_status: 'This place is a suggestion. Search text was not sent to a location provider.',
    ambiguous_next: 'Choose one place. Duplicate names stay unselected until you do.',
    ambiguous_status: 'More than one place has this name.',
    border_next: 'Choose the jurisdiction that matches your question.',
    border_status: 'More than one jurisdiction matches. No place was selected.',
    language_name: { en: 'English', nl: 'Nederlands', ar: 'العربية', ja: '日本語' },
  },
  nl: {
    dir: 'ltr',
    lang: 'nl',
    product: 'Wereldwijde wetten',
    search_label: 'Zoek in wetten en bronnen',
    search_placeholder: 'Vraag, vindplaats of kenmerk',
    skip_to_search: 'Naar zoeken',
    skip_to_results: 'Naar resultaten',
    skip_to_filters: 'Naar filters',
    change_place: 'Plaats wijzigen',
    choose_place: 'Kies een plaats',
    this_place: 'Deze plaats',
    search_worldwide: 'Zoek wereldwijd',
    as_of: 'Per',
    language: 'Taal',
    filters: 'Filters',
    close_filters: 'Filters sluiten',
    coverage: 'Dekking',
    laws_and_sources: 'Wetten en bronnen voor deze plaats',
    applicability: 'Deze keuze bepaalt niet dat een wet van toepassing is.',
    unselected_worldwide: 'wereldwijd, nog niet gekozen',
    origin_url: 'gedeelde URL',
    origin_manual: 'handmatig gekozen',
    origin_saved: 'opgeslagen keuze',
    origin_device: 'apparaatlocatie',
    origin_ip: 'benaderde IP-locatie',
    coverage_unknown: 'Dekking onbekend',
    coverage_partial: 'Gedeeltelijke verzameling',
    searched: 'Doorzocht',
    remaining: 'Resterend',
    results: 'Resultaten',
    pages: "Pagina's",
    page_search: 'Zoeken',
    page_place: 'Plaats',
    page_coverage: 'Dekking',
    page_compare: 'Vergelijken',
    page_law: 'Wet',
    page_sources: 'Bronnen',
    examples: 'Nederlandse voorbeelden',
    open_legacy: 'Open de Nederlandse onderzoeksomgeving',
    legacy_unavailable: 'De Nederlandse onderzoeksomgeving opende niet. Zoeken op deze pagina blijft beschikbaar.',
    save_place: 'Plaats opslaan',
    scope_label: 'Reikwijdte',
    empty_query: 'Voer een vraag, vindplaats of kenmerk in. Een lege zoekopdracht is geen uitspraak over het recht.',
    unsearched: 'Deze verzameling is niet doorzocht.',
    place_id_hint: 'Kies een stabiel plaats-id zoals place:netherlands.',
    place_list: 'Plaatsen',
    country_row: 'Land. Er is geen gemeente toegevoegd.',
    keep_place: 'Huidige plaats houden',
    any: 'Alle',
    level: 'Bestuursniveau',
    level_national: 'Nationaal',
    level_regional: 'Regionaal',
    level_municipal: 'Gemeentelijk',
    level_other: 'Overig',
    topic: 'Onderwerp',
    instrument: 'Type instrument',
    document_language: 'Taal van het document',
    source: 'Bron',
    date_status: 'Datum of status',
    first_visit_next: 'Kies een plaats of zoek wereldwijd.',
    first_visit_status: 'Er is nog geen plaats gekozen. Zoeken is gereed. Er is geen resultaat verzonnen.',
    first_visit_live: 'Wereldwijde wetten. Er is geen plaats gekozen. Kies een plaats of zoek wereldwijd.',
    no_query_next: 'Voer een vraag, vindplaats of kenmerk in en zoek daarna.',
    no_query_status: 'De zoekopdracht is leeg. Een lege zoekopdracht is geen uitspraak over het recht.',
    manual_next: 'Doorzoek deze plaats, of wijzig die.',
    manual_status: 'De plaats is handmatig gekozen. Een latere suggestie kan die niet vervangen.',
    malformed_next: 'Verbeter de link, of ga verder met de plaats en de datum die al op de pagina staan.',
    malformed_status: 'Een parameter in deze link kon niet worden gelezen.',
    scope_next: 'Lees de aangekondigde plaats, datum en dekking, en zoek of wijzig de plaats.',
    scope_status: 'De plaats op deze pagina komt uit de link.',
    approximate_next: 'Wijzig de plaats als deze benadering niet klopt, of doorzoek deze plaats.',
    approximate_status: 'Deze plaats is een suggestie. Zoektekst is niet naar een locatiedienst gestuurd.',
    ambiguous_next: 'Kies één plaats. Gelijke namen blijven ongekozen tot u dat doet.',
    ambiguous_status: 'Meer dan één plaats heeft deze naam.',
    border_next: 'Kies het rechtsgebied dat bij uw vraag past.',
    border_status: 'Meer dan één rechtsgebied komt overeen. Er is geen plaats gekozen.',
    language_name: { en: 'English', nl: 'Nederlands', ar: 'العربية', ja: '日本語' },
  },
  ar: {
    dir: 'rtl',
    lang: 'ar',
    product: 'قوانين العالم',
    search_label: 'البحث في القوانين والمصادر',
    search_placeholder: 'سؤال أو استشهاد أو معرّف',
    skip_to_search: 'انتقال إلى البحث',
    skip_to_results: 'انتقال إلى النتائج',
    skip_to_filters: 'انتقال إلى عوامل التصفية',
    change_place: 'تغيير المكان',
    choose_place: 'اختر مكانًا',
    this_place: 'هذا المكان',
    search_worldwide: 'بحث على مستوى العالم',
    as_of: 'اعتبارًا من',
    language: 'اللغة',
    filters: 'عوامل التصفية',
    close_filters: 'إغلاق عوامل التصفية',
    coverage: 'التغطية',
    laws_and_sources: 'القوانين والمصادر لهذا المكان',
    applicability: 'هذا الاختيار لا يقرر أن قانونًا ينطبق.',
    unselected_worldwide: 'النطاق العالمي دون اختيار مكان',
    origin_url: 'رابط مشترك',
    origin_manual: 'اختيار يدوي',
    origin_saved: 'اختيار محفوظ',
    origin_device: 'موقع الجهاز',
    origin_ip: 'موقع تقريبي من عنوان IP',
    coverage_unknown: 'التغطية غير معروفة',
    coverage_partial: 'مجموعة جزئية',
    searched: 'ما بُحث',
    remaining: 'المتبقي',
    results: 'النتائج',
    pages: 'الصفحات',
    page_search: 'بحث',
    page_place: 'مكان',
    page_coverage: 'التغطية',
    page_compare: 'مقارنة',
    page_law: 'قانون',
    page_sources: 'المصادر',
    examples: 'أمثلة هولندا',
    open_legacy: 'فتح مساحة البحث الهولندية',
    legacy_unavailable: 'لم تُفتح مساحة البحث الهولندية. يبقى البحث في هذه الصفحة متاحًا.',
    save_place: 'حفظ المكان',
    scope_label: 'النطاق',
    empty_query: 'أدخل سؤالًا أو استشهادًا أو معرّفًا. البحث الفارغ ليس نتيجة عن القانون.',
    unsearched: 'لم يُبحث في هذه المجموعة.',
    place_id_hint: 'اختر معرّف مكان ثابتًا مثل place:netherlands.',
    place_list: 'الأماكن',
    country_row: 'دولة. لم تُضف بلدية.',
    keep_place: 'الإبقاء على المكان الحالي',
    any: 'أي',
    level: 'مستوى الولاية',
    level_national: 'وطني',
    level_regional: 'إقليمي',
    level_municipal: 'بلدي',
    level_other: 'آخر',
    topic: 'الموضوع',
    instrument: 'نوع الصك',
    document_language: 'لغة الوثيقة',
    source: 'المصدر',
    date_status: 'التاريخ أو الحالة',
    first_visit_next: 'اختر مكانًا أو ابحث على مستوى العالم.',
    first_visit_status: 'لم يُختر مكان. البحث جاهز. لم تُختلق نتيجة.',
    first_visit_live: 'قوانين العالم. لم يُختر مكان. اختر مكانًا أو ابحث على مستوى العالم.',
    no_query_next: 'أدخل سؤالًا أو استشهادًا أو معرّفًا، ثم ابحث.',
    no_query_status: 'الاستعلام فارغ. البحث الفارغ ليس نتيجة عن القانون.',
    manual_next: 'ابحث في هذا المكان، أو غيّره.',
    manual_status: 'اختير المكان يدويًا. لا يستطيع اقتراح لاحق أن يبدله.',
    malformed_next: 'صحّح الرابط، أو تابع بالمكان والتاريخ الظاهرين في الصفحة.',
    malformed_status: 'تعذّر قراءة معامل في هذا الرابط.',
    scope_next: 'راجع المكان والتاريخ والتغطية التي أُعلنت، ثم ابحث أو غيّر المكان.',
    scope_status: 'المكان في هذه الصفحة أتى من الرابط.',
    approximate_next: 'غيّر المكان إذا كان هذا الاقتراح التقريبي غير صحيح، أو ابحث في هذا المكان.',
    approximate_status: 'هذا المكان اقتراح. لم يُرسل نص البحث إلى مزوّد موقع.',
    ambiguous_next: 'اختر مكانًا واحدًا. تبقى الأسماء المكررة دون اختيار إلى أن تفعل ذلك.',
    ambiguous_status: 'لأكثر من مكان هذا الاسم.',
    border_next: 'اختر الولاية القضائية التي تطابق سؤالك.',
    border_status: 'تطابق أكثر من ولاية قضائية. لم يُختر مكان.',
    language_name: { en: 'English', nl: 'Nederlands', ar: 'العربية', ja: '日本語' },
  },
  ja: {
    dir: 'ltr',
    lang: 'ja',
    product: '世界の法令',
    search_label: '法令と情報源を検索',
    search_placeholder: '質問、引用、または識別子',
    skip_to_search: '検索へ移動',
    skip_to_results: '結果へ移動',
    skip_to_filters: '絞り込みへ移動',
    change_place: '場所を変更',
    choose_place: '場所を選ぶ',
    this_place: 'この場所',
    search_worldwide: '世界全体を検索',
    as_of: '時点',
    language: '言語',
    filters: '絞り込み',
    close_filters: '絞り込みを閉じる',
    coverage: '収録範囲',
    laws_and_sources: 'この場所の法令と情報源',
    applicability: 'この選択は、法令が適用されることを決めるものではありません。',
    unselected_worldwide: '場所未選択の全世界',
    origin_url: '共有URL',
    origin_manual: '手入力で選択',
    origin_saved: '保存した選択',
    origin_device: '端末の位置情報',
    origin_ip: 'IPアドレスによる概算位置',
    coverage_unknown: '収録範囲は不明',
    coverage_partial: '一部のみ収録',
    searched: '検索済み',
    remaining: '未検索',
    results: '結果',
    pages: 'ページ',
    page_search: '検索',
    page_place: '場所',
    page_coverage: '収録範囲',
    page_compare: '比較',
    page_law: '法令',
    page_sources: '情報源',
    examples: 'オランダの例',
    open_legacy: 'オランダの調査画面を開く',
    legacy_unavailable: 'オランダの調査画面は開けませんでした。このページの検索はそのまま使えます。',
    save_place: '場所を保存',
    scope_label: '範囲',
    empty_query: '質問、引用、または識別子を入力してください。空の検索は法令についての結果ではありません。',
    unsearched: 'このコレクションは検索されていません。',
    place_id_hint: 'place:netherlands のような安定した場所IDを選んでください。',
    place_list: '場所',
    country_row: '国です。基礎自治体は追加していません。',
    keep_place: '現在の場所を維持',
    any: 'すべて',
    level: '管轄レベル',
    level_national: '国',
    level_regional: '地域',
    level_municipal: '基礎自治体',
    level_other: 'その他',
    topic: '主題',
    instrument: '文書の種類',
    document_language: '文書の言語',
    source: '情報源',
    date_status: '日付または状態',
    first_visit_next: '場所を選ぶか、世界全体を検索してください。',
    first_visit_status: '場所は未選択です。検索できます。結果は作られていません。',
    first_visit_live: '世界の法令。場所は選択されていません。場所を選ぶか、世界全体を検索してください。',
    no_query_next: '質問、引用、または識別子を入力して検索してください。',
    no_query_status: '検索語が空です。空の検索は法令についての結果ではありません。',
    manual_next: 'この場所を検索するか、場所を変更してください。',
    manual_status: '場所は手入力で選択されました。後からの候補では置き換わりません。',
    malformed_next: 'リンクを修正するか、ページに表示されている場所と日付のまま続けてください。',
    malformed_status: 'このリンクのパラメータを読めませんでした。',
    scope_next: '読み上げられた場所、日付、収録範囲を確認してから、検索するか場所を変更してください。',
    scope_status: 'このページの場所はリンクから来ています。',
    approximate_next: 'この概算が違う場合は場所を変更するか、この場所を検索してください。',
    approximate_status: 'この場所は候補です。検索文は位置情報の提供者へ送っていません。',
    ambiguous_next: '一つの場所を選んでください。同名の場所は選ぶまで未選択のままです。',
    ambiguous_status: '同じ名前の場所が複数あります。',
    border_next: '質問に合う管轄を選んでください。',
    border_status: '複数の管轄が一致しています。場所は選択されていません。',
    language_name: { en: 'English', nl: 'Nederlands', ar: 'العربية', ja: '日本語' },
  },
};

export interface ShellFilters {
  level: '' | 'national' | 'regional' | 'municipal' | 'other';
  place: string;
  topic: string;
  instrument: string;
  language: string;
  source: string;
  dateStatus: string;
}

export interface PlaceOption {
  id: string;
  placeId: string | null;
  label: string;
  detail: string;
}

export type LoadLegacyNl = () => Promise<{ default: ComponentType }>;

export interface ShellContextValue {
  schema: typeof SHELL_SCHEMA;
  place: PlaceState;
  locale: InterfaceLocale;
  copy: ShellCopy;
  query: string;
  interaction: ShellStateId;
  filtersOpen: boolean;
  filters: ShellFilters;
  nlMigration: boolean;
  searched: number;
  remaining: number;
  coverage: 'unknown' | 'partial';
  coverageLabel: string;
  announcement: string;
  status: string;
  nextAction: string;
  placeLabel: string;
  originLabel: string;
  scopeExplicit: boolean;
  legacy: ComponentType | null;
  legacyNote: string | null;
  setQuery: (value: string) => void;
  submitQuery: () => void;
  setLocale: (locale: InterfaceLocale) => void;
  setAsOf: (value: string | null) => void;
  setScope: (scope: SearchScope) => void;
  choosePlace: (placeId: string, label: string | null) => void;
  applyExample: (label: string) => void;
  openRoute: (name: RouteName) => void;
  savePlace: () => void;
  setFiltersOpen: (open: boolean) => void;
  setFilters: (patch: Partial<ShellFilters>) => void;
  openLegacy: () => void;
  placeOptions: (draft: string) => PlaceOption[];
  href: string;
}

const ShellContext = createContext<ShellContextValue | null>(null);

export function shellCopy(locale: InterfaceLocale): ShellCopy {
  return COPY[locale];
}

export function isInterfaceLocale(value: string | null | undefined): value is InterfaceLocale {
  return value === 'en' || value === 'nl' || value === 'ar' || value === 'ja';
}

export function readNlMigrationFlag(input: { href?: string | null; storage?: Storage | null } = {}): boolean {
  const href = input.href ?? (typeof window !== 'undefined' ? window.location.href : '');
  let search = '';
  try {
    const url = new URL(href, 'https://worldwidelaws.github.io');
    search = url.search;
  } catch {
    const mark = href.indexOf('?');
    const hash = href.indexOf('#');
    if (mark !== -1) search = href.slice(mark, hash === -1 || hash < mark ? undefined : hash);
  }
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const token = (params.get('nl') ?? params.get('wwl-nl') ?? '').trim().toLowerCase();
  if (FLAG_ON.has(token)) return true;
  const storage = input.storage === undefined ? browserStorage() : input.storage;
  try {
    const stored = storage?.getItem(NL_MIGRATION_STORAGE_KEY)?.trim().toLowerCase() ?? '';
    return FLAG_ON.has(stored);
  } catch {
    return false;
  }
}

export function shellBootHref(href: string, nlMigration: boolean): string {
  const route = parseRoute(href);
  if (!nlMigration && route.migrationId && LEGACY_MIGRATIONS.has(route.migrationId)) return '/#/search';
  if (!nlMigration && route.suggestionOnly) return '/#/search';
  if (nlMigration && route.suggestionOnly && route.suggestionQuery) {
    return `/#/search?q=${encodeURIComponent(route.suggestionQuery)}`;
  }
  if (route.recognized) {
    if (href.includes('#/')) return href;
    return route.href ?? '/#/search';
  }
  if (href.includes('#/')) return href;
  return '/#/search';
}

export function shellHref(place: PlaceState, scopeExplicit: boolean): string {
  const name = place.route.name;
  const includeScope = scopeExplicit || place.origin !== 'unselected';
  return buildRoute({
    name,
    query: place.route.query,
    placeId: place.placeId,
    date: place.asOf,
    scope: includeScope ? place.scope : null,
    recordId: name === 'law' ? place.route.recordId : null,
    sourceRevision: name === 'law' ? place.route.sourceRevision : null,
    sectionId: name === 'law' ? place.route.sectionId : null,
    sourceId: name === 'sources' ? place.route.sourceId : null,
    comparePlaceIds: name === 'compare' ? place.route.comparePlaceIds : [],
    placeToken: 'stable',
  }).href;
}

export function shellPlaceLabel(place: PlaceState, copy: ShellCopy): string {
  if (place.label) return place.label;
  if (place.placeId) return place.placeId;
  return copy.unselected_worldwide;
}

export function shellOriginLabel(place: PlaceState, copy: ShellCopy): string {
  if (!place.placeId && place.origin === 'unselected') return copy.unselected_worldwide;
  if (place.origin === 'url') return copy.origin_url;
  if (place.origin === 'manual') return copy.origin_manual;
  if (place.origin === 'saved') return copy.origin_saved;
  if (place.channel === 'device') return copy.origin_device;
  if (place.origin === 'suggestion') return copy.origin_ip;
  return copy.unselected_worldwide;
}

export function shellInteraction(place: PlaceState, submittedEmpty: boolean): ShellStateId {
  const code = place.issues[0]?.code ?? '';
  if (ROUTE_PROBLEMS.has(code)) return 'malformed-url';
  if (place.candidates.length > 1 && place.uncertainty.length > 0) return 'border-uncertainty';
  if (place.candidates.length > 1) return 'ambiguous-place';
  if (submittedEmpty) return 'no-query';
  if (place.origin === 'suggestion') return 'approximate-suggestion';
  if ((place.origin === 'manual' || place.origin === 'saved') && place.placeId) return 'changed-manual-location';
  if (place.origin === 'url' && (place.placeId || place.asOf)) return 'screen-reader-scope-change';
  return 'first-visit';
}

export function shellFacts(place: PlaceState, copy: ShellCopy, coverageLabel: string): string {
  const date = place.asOf ? `${copy.as_of} ${place.asOf.value}` : copy.as_of;
  const scope = place.scope === 'place' && place.placeId ? copy.this_place : copy.search_worldwide;
  return `${shellPlaceLabel(place, copy)}. ${shellOriginLabel(place, copy)}. ${date}. ${scope}. ${coverageLabel}.`;
}

function statusPair(interaction: ShellStateId, copy: ShellCopy): { status: string; nextAction: string } {
  switch (interaction) {
    case 'no-query':
      return { status: copy.no_query_status, nextAction: copy.no_query_next };
    case 'changed-manual-location':
      return { status: copy.manual_status, nextAction: copy.manual_next };
    case 'malformed-url':
      return { status: copy.malformed_status, nextAction: copy.malformed_next };
    case 'screen-reader-scope-change':
      return { status: copy.scope_status, nextAction: copy.scope_next };
    case 'approximate-suggestion':
      return { status: copy.approximate_status, nextAction: copy.approximate_next };
    case 'ambiguous-place':
      return { status: copy.ambiguous_status, nextAction: copy.ambiguous_next };
    case 'border-uncertainty':
      return { status: copy.border_status, nextAction: copy.border_next };
    default:
      return { status: copy.first_visit_status, nextAction: copy.first_visit_next };
  }
}

export function placeChoices(draft: string, nlMigration: boolean, place: PlaceState, copy: ShellCopy): PlaceOption[] {
  const options: PlaceOption[] = [];
  if (place.placeId) {
    options.push({
      id: `keep:${place.placeId}`,
      placeId: place.placeId,
      label: place.label ?? place.placeId,
      detail: copy.keep_place,
    });
  }
  if (nlMigration) {
    options.push({
      id: STABLE_NETHERLANDS_PLACE_ID,
      placeId: STABLE_NETHERLANDS_PLACE_ID,
      label: 'Netherlands',
      detail: `Nederland. ${copy.country_row}`,
    });
  }
  const typed = draft.trim();
  if (typed && typed !== DUTCH_INITIAL_EXAMPLE_QUERY) {
    const parsed = canonicalizePlaceId(typed);
    if (parsed.ok && !options.some((option) => option.placeId === parsed.placeId)) {
      options.push({
        id: parsed.placeId,
        placeId: parsed.placeId,
        label: parsed.placeId,
        detail: copy.place_id_hint,
      });
    }
  }
  if (!typed) return options;
  const folded = typed.toLowerCase();
  return options.filter((option) => {
    return option.label.toLowerCase().includes(folded)
      || option.detail.toLowerCase().includes(folded)
      || option.placeId?.toLowerCase() === folded;
  });
}

function browserStorage(): Storage | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    return localStorage;
  } catch {
    return null;
  }
}

function readSaved(storage: Storage | null): SavedPlaceInput | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(SAVED_PLACE_STORAGE_KEY);
    return raw ? decodeSavedPlace(raw) : null;
  } catch {
    return null;
  }
}

function readLocale(storage: Storage | null, suggestion: string | null, override?: InterfaceLocale): InterfaceLocale {
  if (override) return override;
  try {
    const stored = storage?.getItem(UI_LANGUAGE_STORAGE_KEY) ?? null;
    if (isInterfaceLocale(stored)) return stored;
  } catch {
    /* The interface stays in English when storage cannot be read. */
  }
  if (isInterfaceLocale(suggestion)) return suggestion;
  return 'en';
}

function utcStamp(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function languageSuggestion(): string | null {
  if (typeof navigator === 'undefined') return null;
  const value = navigator.language?.trim().toLowerCase() ?? '';
  const primary = value.split('-')[0] ?? '';
  return isInterfaceLocale(primary) ? primary : null;
}

function timeZoneSuggestion(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
  } catch {
    return null;
  }
}

function coverageOf(place: PlaceState): 'unknown' | 'partial' {
  return place.route.coverageState === 'partial' ? 'partial' : 'unknown';
}

const EMPTY_FILTERS: ShellFilters = {
  level: '',
  place: '',
  topic: '',
  instrument: '',
  language: '',
  source: '',
  dateStatus: '',
};

export interface SearchProviderProps {
  children: ReactNode;
  href?: string;
  nlMigration?: boolean;
  locale?: InterfaceLocale;
  storage?: Storage | null;
  loadLegacyNl?: LoadLegacyNl | null;
  now?: () => Date;
}

export function SearchProvider({
  children,
  href,
  nlMigration,
  locale,
  storage,
  loadLegacyNl = null,
  now = () => new Date(),
}: SearchProviderProps) {
  const resolvedStorage = storage === undefined ? browserStorage() : storage;
  const pageHref = href ?? (typeof window !== 'undefined' ? window.location.href : '/#/search');
  const migration = nlMigration ?? readNlMigrationFlag({ href: pageHref, storage: resolvedStorage });
  const boot = shellBootHref(pageHref, migration);
  const suggestion = languageSuggestion();
  const [place, setPlace] = useState<PlaceState>(() => noteEnvironment(
    createPlaceState({
      href: boot,
      saved: readSaved(resolvedStorage),
      language: suggestion,
      timeZone: timeZoneSuggestion(),
    }),
    { language: suggestion, timeZone: timeZoneSuggestion() },
  ));
  const [query, setQueryState] = useState(() => place.route.query ?? '');
  const [submittedEmpty, setSubmittedEmpty] = useState(false);
  const [uiLocale, setUiLocale] = useState<InterfaceLocale>(() => readLocale(resolvedStorage, suggestion, locale));
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilterState] = useState<ShellFilters>(EMPTY_FILTERS);
  const [scopeExplicit, setScopeExplicit] = useState(() => place.route.scopeTokenPresent);
  const [legacy, setLegacy] = useState<ComponentType | null>(null);
  const [legacyNote, setLegacyNote] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState(() => {
    const initialCopy = COPY[readLocale(resolvedStorage, suggestion, locale)];
    if (place.issues[0]?.message) return place.issues[0].message;
    if (place.placeId || place.asOf || place.origin !== 'unselected') {
      const label = coverageOf(place) === 'partial' ? initialCopy.coverage_partial : initialCopy.coverage_unknown;
      return shellFacts(place, initialCopy, label);
    }
    return initialCopy.first_visit_live;
  });
  const copy = COPY[uiLocale];
  const coverage = coverageOf(place);
  const coverageLabel = coverage === 'partial' ? copy.coverage_partial : copy.coverage_unknown;
  const interaction = shellInteraction(place, submittedEmpty);
  const pair = statusPair(interaction, copy);
  const issue = place.issues[0];
  const status = issue?.message || pair.status;
  const nextAction = pair.nextAction;

  const canonical = shellHref(place, scopeExplicit);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const hash = canonical.startsWith('/#') ? canonical.slice(1) : canonical;
    if (window.location.hash === hash) return;
    const next = `${window.location.pathname}${window.location.search}${hash}`;
    window.history.replaceState(null, '', next);
  }, [canonical]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onHash = () => {
      const nextHref = shellBootHref(window.location.href, migration);
      setPlace((current) => {
        const incoming = createPlaceState({
          href: nextHref,
          saved: current.saved,
          language: current.uiLanguageSuggestion,
          timeZone: current.timeZoneNoted,
        });
        if (!migration && incoming.route.query === DUTCH_INITIAL_EXAMPLE_QUERY && incoming.route.migrationId) {
          return current;
        }
        return incoming.route.href === shellHref(current, scopeExplicit) ? current : incoming;
      });
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [migration, scopeExplicit]);

  const value = useMemo<ShellContextValue>(() => {
    const announce = (next: PlaceState) => {
      setAnnouncement(shellFacts(next, COPY[uiLocale], coverageOf(next) === 'partial' ? COPY[uiLocale].coverage_partial : COPY[uiLocale].coverage_unknown));
    };
    return {
      schema: SHELL_SCHEMA,
      place,
      locale: uiLocale,
      copy,
      query,
      interaction,
      filtersOpen,
      filters,
      nlMigration: migration,
      searched: 0,
      remaining: 0,
      coverage,
      coverageLabel,
      announcement: announcement || copy.first_visit_live,
      status,
      nextAction,
      placeLabel: shellPlaceLabel(place, copy),
      originLabel: shellOriginLabel(place, copy),
      scopeExplicit,
      legacy,
      legacyNote,
      href: canonical,
      setQuery: (next) => {
        setQueryState(next.slice(0, 500));
        if (next.trim()) setSubmittedEmpty(false);
      },
      submitQuery: () => {
        const text = query.trim();
        if (!text) {
          setSubmittedEmpty(true);
          setPlace((current) => ({
            ...current,
            route: { ...current.route, name: 'search', query: null, queryTokenPresent: true },
          }));
          setAnnouncement(copy.no_query_status);
          return;
        }
        setSubmittedEmpty(false);
        setPlace((current) => ({
          ...current,
          route: { ...current.route, name: 'search', query: text, queryTokenPresent: true },
        }));
        setAnnouncement(`${copy.unsearched} ${copy.searched} 0. ${copy.remaining} 0.`);
      },
      setLocale: (next) => {
        setUiLocale(next);
        try {
          resolvedStorage?.setItem(UI_LANGUAGE_STORAGE_KEY, next);
        } catch {
          /* Language still changes on this screen when storage is blocked. */
        }
        setAnnouncement(`${COPY[next].language}. ${COPY[next].language_name[next]}. ${shellFacts(place, COPY[next], coverage === 'partial' ? COPY[next].coverage_partial : COPY[next].coverage_unknown)}`);
      },
      setAsOf: (next) => {
        setPlace((current) => {
          const updated = commitAsOf(current, next);
          announce(updated);
          return updated;
        });
      },
      setScope: (scope) => {
        setPlace((current) => {
          if (scope === 'place' && !current.placeId) return current;
          const updated = { ...current, scope, route: { ...current.route, scope } };
          announce(updated);
          return updated;
        });
        if (scope === 'worldwide' || place.placeId) setScopeExplicit(true);
      },
      choosePlace: (placeId, label) => {
        const parsed = canonicalizePlaceId(placeId);
        if (!parsed.ok) return;
        setSubmittedEmpty(false);
        setScopeExplicit(true);
        setPlace((current) => {
          const updated = selectPlace(current, { placeId: parsed.placeId, label, scope: 'place' });
          announce(updated);
          return updated;
        });
      },
      applyExample: (label) => {
        if (!(DUTCH_EXAMPLE_QUERIES as readonly string[]).includes(label)) return;
        setQueryState(label);
        setSubmittedEmpty(false);
        setPlace((current) => applyDutchExample(current, label));
      },
      openRoute: (name) => {
        setPlace((current) => ({ ...current, route: { ...current.route, name } }));
      },
      savePlace: () => {
        const stamp = utcStamp(now());
        setPlace((current) => {
          const updated = saveSelection(current, stamp);
          if (updated.saved) {
            try {
              resolvedStorage?.setItem(SAVED_PLACE_STORAGE_KEY, encodeSavedPlace(updated.saved));
            } catch {
              /* The place stays selected even when it cannot be stored. */
            }
          }
          return updated;
        });
      },
      setFiltersOpen,
      setFilters: (patch) => {
        setFilterState((current) => ({ ...current, ...patch }));
        setAnnouncement(`${copy.searched} 0. ${copy.remaining} 0.`);
      },
      openLegacy: () => {
        if (!migration || !loadLegacyNl || legacy) return;
        setLegacyNote(null);
        loadLegacyNl().then(
          (mod) => {
            if (mod?.default) setLegacy(() => mod.default);
            else setLegacyNote(COPY[uiLocale].legacy_unavailable);
          },
          () => setLegacyNote(COPY[uiLocale].legacy_unavailable),
        );
      },
      placeOptions: (draft) => placeChoices(draft, migration, place, copy),
    };
  }, [
    announcement,
    canonical,
    copy,
    coverage,
    coverageLabel,
    filters,
    filtersOpen,
    interaction,
    legacy,
    legacyNote,
    loadLegacyNl,
    migration,
    nextAction,
    now,
    place,
    query,
    resolvedStorage,
    scopeExplicit,
    status,
    uiLocale,
  ]);

  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

export function useSearchContext(): ShellContextValue {
  const value = useContext(ShellContext);
  if (!value) throw new Error('useSearchContext must be used within SearchProvider');
  return value;
}



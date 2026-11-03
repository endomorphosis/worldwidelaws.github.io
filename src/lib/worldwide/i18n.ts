/**
 * Interface locale, law language, and search jurisdiction.
 *
 * The interface locale is English, Dutch, Arabic, or Japanese. It chooses
 * labels, direction, and how a civil date is written. The language of a law
 * chooses the direction and script of that text. The search jurisdiction is
 * an explicit internal id. A browser language can suggest the interface
 * locale only. It never selects a place, a country, or a jurisdiction.
 *
 * A civil date keeps the precision the source stated. A year is not shown as
 * a day, and a missing day is not filled in. An instant becomes a civil day
 * only in a timezone the caller names. The browser timezone is not consulted.
 * Machine and official translations are labelled. The original title stays.
 */

import {
  createElement as h,
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type ReactNode,
} from 'react';
import {
  CATALOGS,
  UI_LOCALES,
  type MessageKey,
  type UiLocale,
} from '../../locales/worldwide';

export const I18N_SCHEMA = 'worldwide-legal-search.i18n@1';
export const UI_LANGUAGE_STORAGE_KEY = 'worldwide-legal-search.ui-language';

export const LANGUAGE_NAMES: { readonly [K in UiLocale]: string } = {
  en: 'English',
  nl: 'Nederlands',
  ar: 'العربية',
  ja: '日本語',
};

export type { MessageKey, UiLocale };
export type UiLocaleSource = 'explicit' | 'stored' | 'browser' | 'fallback';
export type DatePrecisionWord = 'day' | 'month' | 'year';
export type ShownPrecision = DatePrecisionWord | 'unknown';
export type VersionKind = 'historical' | 'future' | 'unknown';
export type CoverageWord = 'known' | 'partial' | 'missing' | 'unknown' | 'unavailable';
export type SearchScopeChoice = 'place' | 'worldwide';
export type TranslationKind = 'machine' | 'official';
export type TextDirection = 'ltr' | 'rtl' | 'auto';
export type TextScriptName = 'CJK' | 'Arab' | 'Hebr' | 'Latn' | 'mixed' | 'unknown';

export interface BrowserSnapshot {
  language?: string | null;
  languages?: readonly string[] | null;
}

export interface I18nIssue {
  code: 'browser-language-not-jurisdiction' | 'language-tag-not-jurisdiction' | 'code-not-jurisdiction' | 'invalid-jurisdiction';
  field: 'jurisdiction' | 'place';
  message: string;
}

export interface PresentationInput {
  uiLocale?: string | null;
  storedLocale?: string | null;
  browserLanguage?: string | null;
  browserLanguages?: readonly string[] | null;
  navigator?: BrowserSnapshot | null;
  lawLanguage?: string | null;
  jurisdictionId?: string | null;
  placeId?: string | null;
  readNavigator?: boolean;
}

export interface Presentation {
  schema: typeof I18N_SCHEMA;
  uiLocale: UiLocale;
  uiLocaleSource: UiLocaleSource;
  lawLanguage: string | null;
  jurisdictionId: string | null;
  placeId: string | null;
  browserLanguage: string | null;
  browserLanguages: readonly string[];
  jurisdictionInferredFromBrowser: false;
  issues: readonly I18nIssue[];
}

export interface CivilDateInput {
  value?: string | null;
  precision?: DatePrecisionWord | null;
  source?: string | null;
  instant?: string | null;
  timeZone?: string | null;
}

export interface FormattedDate {
  text: string;
  precision: ShownPrecision;
  value: string | null;
  known: boolean;
  source: string | null;
  timeZoneApplied: boolean;
}

export interface VersionStatusLabel {
  status: VersionKind;
  label: string;
  date: FormattedDate;
}

export interface TextScript {
  direction: TextDirection;
  script: TextScriptName;
  lang: string | null;
}

export interface TranslationInput {
  kind?: TranslationKind | null;
  language?: string | null;
  title?: string | null;
  text?: string | null;
}

export interface InternationalShellProps {
  presentation: Presentation;
  onUiLocale: (locale: UiLocale) => void;
  title: string;
  citation?: string | null;
  recordId?: string | null;
  translation?: TranslationInput | null;
  date?: CivilDateInput | null;
  status?: VersionKind | null;
  inclusionReason?: string | null;
  placeLabel?: string | null;
  scope?: SearchScopeChoice;
  coverage?: CoverageWord;
}

const ISOLATE: CSSProperties = { unicodeBidi: 'isolate' };
const ALIGN_START: CSSProperties = { textAlign: 'start' };
const MIRROR: CSSProperties = { transform: 'scaleX(-1)' };

const RTL_PRIMARY = new Set(['ar', 'fa', 'he', 'iw', 'ur', 'ps', 'dv', 'yi', 'ckb', 'sd', 'arc', 'syr']);
const CJK_PRIMARY = new Set(['ja', 'zh', 'ko', 'yue', 'wuu', 'cmn', 'lzh', 'jpn', 'zho', 'kor', 'chi']);
const CJK_SCRIPT = new Set(['Hani', 'Hira', 'Kana', 'Hang', 'Jpan', 'Hans', 'Hant']);
const ARAB_SCRIPT = new Set(['Arab', 'Aran']);
const HEBR_SCRIPT = new Set(['Hebr']);
const RTL_SCRIPT = new Set(['Arab', 'Aran', 'Hebr', 'Syrc', 'Thaa', 'Nkoo']);
const UNDETERMINED = new Set(['und', 'zxx', 'mul', 'mis']);

const PLACE_ID = /^place:[a-z0-9][a-z0-9._:-]{1,120}$/;
const INTERNAL_ID = /^[a-z][a-z0-9._:-]{2,120}$/;
const BARE_CODE = /^[a-z]{2}$|^[a-z]{3}$|^[a-z]{2}-[a-z0-9]{1,3}$/;
const LANGUAGE_TAG = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})+$/;
const LAW_TAG = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;
const INSTANT_TEXT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/;
const IANA_ZONE = /^[A-Za-z][A-Za-z0-9_+/-]{0,63}$/;
const LATIN_RUN = /[A-Za-z][A-Za-z0-9./:_-]*/g;

const RANK: Record<DatePrecisionWord, number> = { year: 1, month: 2, day: 3 };

const COVERAGE_KEY: Record<CoverageWord, MessageKey> = {
  known: 'coverage_known',
  partial: 'coverage_partial',
  missing: 'coverage_missing',
  unknown: 'coverage_unknown',
  unavailable: 'coverage_unavailable',
};

const PRECISION_KEY: Record<ShownPrecision, MessageKey> = {
  day: 'precision_day',
  month: 'precision_month',
  year: 'precision_year',
  unknown: 'precision_unknown',
};

interface CivilParts {
  precision: DatePrecisionWord;
  year: string;
  month: string | null;
  day: string | null;
}

export function catalog(locale: UiLocale) {
  return CATALOGS[locale];
}

export function message(locale: UiLocale, key: MessageKey): string {
  return CATALOGS[locale].messages[key];
}

export function toUiLocale(value: string | null | undefined): UiLocale | null {
  if (typeof value !== 'string') return null;
  const primary = value.trim().replace(/_/g, '-').toLowerCase().split('-')[0] ?? '';
  if (primary === 'en' || primary === 'nl' || primary === 'ar' || primary === 'ja') return primary;
  return null;
}

export function normalizeLawLanguage(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/_/g, '-');
  if (!LAW_TAG.test(trimmed)) return null;
  const parts = trimmed.split('-');
  const primary = parts[0].toLowerCase();
  const rest = parts.slice(1).map((part) => {
    if (part.length === 2) return part.toUpperCase();
    if (part.length === 4) return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    return part.toLowerCase();
  });
  return [primary, ...rest].join('-');
}

export function jurisdictionFromBrowserLanguage(_browserLanguage?: string | null): null {
  return null;
}

export function readBrowserLanguages(snapshot?: BrowserSnapshot | null): string[] {
  if (!snapshot) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (value: string | null | undefined) => {
    if (typeof value !== 'string') return;
    const text = value.trim();
    if (!text) return;
    const key = text.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(text);
  };
  const listed = snapshot.languages ?? null;
  if (listed && listed.length > 0) {
    for (const item of listed) push(item);
    return out;
  }
  push(snapshot.language);
  return out;
}

export function suggestUiLocale(languages: readonly string[]): UiLocale | null {
  for (const language of languages) {
    const locale = toUiLocale(language);
    if (locale) return locale;
  }
  return null;
}

export function readStoredLocale(storage: { getItem(key: string): string | null } | null | undefined): string | null {
  if (!storage) return null;
  try {
    return storage.getItem(UI_LANGUAGE_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function writeStoredLocale(
  storage: { setItem(key: string, value: string): void } | null | undefined,
  locale: UiLocale,
): void {
  if (!storage) return;
  storage.setItem(UI_LANGUAGE_STORAGE_KEY, locale);
}

function jurisdictionIssue(
  code: I18nIssue['code'],
  field: I18nIssue['field'],
  text: string,
): I18nIssue {
  return { code, field, message: text };
}

export function acceptJurisdictionId(
  value: string | null | undefined,
  browserLanguage?: string | null,
  field: I18nIssue['field'] = 'jurisdiction',
): { id: string | null; issue: I18nIssue | null } {
  if (typeof value !== 'string') return { id: null, issue: null };
  const trimmed = value.trim();
  if (!trimmed) return { id: null, issue: null };
  if (/[\u0000-\u001F\u007F]/.test(trimmed) || trimmed.includes('..') || trimmed.length > 121) {
    return {
      id: null,
      issue: jurisdictionIssue('invalid-jurisdiction', field, 'The jurisdiction id is not a stable internal id.'),
    };
  }
  const candidate = trimmed.toLowerCase();
  const browser = (browserLanguage ?? '').trim().toLowerCase().replace(/_/g, '-');
  const primary = browser.split('-')[0] ?? '';
  if (
    browser
    && (candidate === browser || candidate === primary || candidate === `place:${primary}` || candidate === `place:${browser}`)
  ) {
    return {
      id: null,
      issue: jurisdictionIssue('browser-language-not-jurisdiction', field, 'The browser language does not choose a jurisdiction.'),
    };
  }
  const body = candidate.startsWith('place:') ? candidate.slice('place:'.length) : candidate;
  const last = body.split(':').pop() ?? body;
  if (LANGUAGE_TAG.test(candidate) || LANGUAGE_TAG.test(last)) {
    return {
      id: null,
      issue: jurisdictionIssue('language-tag-not-jurisdiction', field, 'A language tag is not a search jurisdiction.'),
    };
  }
  if (BARE_CODE.test(candidate) || BARE_CODE.test(last)) {
    return {
      id: null,
      issue: jurisdictionIssue('code-not-jurisdiction', field, 'A country or language code is not a search jurisdiction.'),
    };
  }
  if (candidate.startsWith('place:')) {
    if (!PLACE_ID.test(candidate)) {
      return {
        id: null,
        issue: jurisdictionIssue('invalid-jurisdiction', field, 'The jurisdiction id is not a stable internal id.'),
      };
    }
    return { id: candidate, issue: null };
  }
  if (!INTERNAL_ID.test(candidate)) {
    return {
      id: null,
      issue: jurisdictionIssue('invalid-jurisdiction', field, 'The jurisdiction id is not a stable internal id.'),
    };
  }
  return { id: candidate, issue: null };
}

function browserSnapshot(input: PresentationInput): BrowserSnapshot {
  if (input.browserLanguages !== undefined || input.browserLanguage !== undefined) {
    const languages = input.browserLanguages ?? (input.browserLanguage ? [input.browserLanguage] : []);
    return { language: input.browserLanguage ?? null, languages };
  }
  if (input.navigator !== undefined) return input.navigator ?? {};
  if (input.readNavigator === false) return {};
  if (typeof navigator === 'undefined') return {};
  return { language: navigator.language, languages: navigator.languages };
}

export function resolvePresentation(input: PresentationInput = {}): Presentation {
  const languages = readBrowserLanguages(browserSnapshot(input));
  const browserLanguage = languages[0] ?? null;
  const explicit = toUiLocale(input.uiLocale);
  const stored = toUiLocale(input.storedLocale);
  let uiLocale: UiLocale = 'en';
  let uiLocaleSource: UiLocaleSource = 'fallback';
  if (input.uiLocale && input.uiLocale.trim() && explicit) {
    uiLocale = explicit;
    uiLocaleSource = 'explicit';
  } else if (input.storedLocale && input.storedLocale.trim() && stored) {
    uiLocale = stored;
    uiLocaleSource = 'stored';
  } else {
    const suggested = suggestUiLocale(languages);
    if (suggested) {
      uiLocale = suggested;
      uiLocaleSource = 'browser';
    }
  }
  const jurisdiction = acceptJurisdictionId(input.jurisdictionId, browserLanguage, 'jurisdiction');
  const place = acceptJurisdictionId(input.placeId, browserLanguage, 'place');
  const issues = [jurisdiction.issue, place.issue].filter((item): item is I18nIssue => item !== null);
  return {
    schema: I18N_SCHEMA,
    uiLocale,
    uiLocaleSource,
    lawLanguage: normalizeLawLanguage(input.lawLanguage),
    jurisdictionId: jurisdiction.id,
    placeId: place.id,
    browserLanguage,
    browserLanguages: languages,
    jurisdictionInferredFromBrowser: false,
    issues,
  };
}

export function applyUiLocale(presentation: Presentation, locale: UiLocale): Presentation {
  if (presentation.uiLocale === locale && presentation.uiLocaleSource === 'explicit') return presentation;
  return {
    ...presentation,
    uiLocale: locale,
    uiLocaleSource: 'explicit',
    jurisdictionInferredFromBrowser: false,
  };
}

function scriptSubtag(tag: string | null): string | null {
  if (!tag) return null;
  for (const part of tag.split('-').slice(1)) {
    if (part.length === 4) return part;
  }
  return null;
}

function scanSample(sample: string): { arab: boolean; hebr: boolean; cjk: boolean; latn: boolean } {
  let arab = false;
  let hebr = false;
  let cjk = false;
  let latn = false;
  for (const char of sample) {
    const code = char.codePointAt(0) ?? 0;
    if ((code >= 0x0590 && code <= 0x05ff) || (code >= 0xfb1d && code <= 0xfb4f)) hebr = true;
    else if (
      (code >= 0x0600 && code <= 0x06ff)
      || (code >= 0x0750 && code <= 0x077f)
      || (code >= 0x08a0 && code <= 0x08ff)
      || (code >= 0xfb50 && code <= 0xfdff)
      || (code >= 0xfe70 && code <= 0xfeff)
    ) arab = true;
    else if (
      (code >= 0x3040 && code <= 0x30ff)
      || (code >= 0x31f0 && code <= 0x31ff)
      || (code >= 0x3400 && code <= 0x9fff)
      || (code >= 0xac00 && code <= 0xd7af)
      || (code >= 0xf900 && code <= 0xfaff)
    ) cjk = true;
    else if ((code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) latn = true;
  }
  return { arab, hebr, cjk, latn };
}

export function describeText(language: string | null | undefined, sample = ''): TextScript {
  const lang = normalizeLawLanguage(language);
  const primary = lang?.split('-')[0] ?? '';
  const script = scriptSubtag(lang);
  const undetermined = !lang || UNDETERMINED.has(primary);
  if (!undetermined) {
    if (script && CJK_SCRIPT.has(script)) return { direction: 'ltr', script: 'CJK', lang };
    if (script && HEBR_SCRIPT.has(script)) return { direction: 'rtl', script: 'Hebr', lang };
    if (script && (ARAB_SCRIPT.has(script) || RTL_SCRIPT.has(script))) {
      return { direction: 'rtl', script: HEBR_SCRIPT.has(script) ? 'Hebr' : 'Arab', lang };
    }
    if (CJK_PRIMARY.has(primary)) return { direction: 'ltr', script: 'CJK', lang };
    if (primary === 'he' || primary === 'iw') return { direction: 'rtl', script: 'Hebr', lang };
    if (RTL_PRIMARY.has(primary)) return { direction: 'rtl', script: 'Arab', lang };
    if (script === 'Latn' || primary) return { direction: 'ltr', script: 'Latn', lang };
  }
  const seen = scanSample(sample);
  const families = Number(seen.arab) + Number(seen.hebr) + Number(seen.cjk);
  if (families > 1) return { direction: 'auto', script: 'mixed', lang: lang && !undetermined ? lang : null };
  if (seen.cjk) return { direction: 'ltr', script: 'CJK', lang: null };
  if (seen.hebr) return { direction: 'rtl', script: 'Hebr', lang: null };
  if (seen.arab) return { direction: 'rtl', script: 'Arab', lang: null };
  if (seen.latn) return { direction: 'ltr', script: 'Latn', lang: null };
  return { direction: 'auto', script: 'unknown', lang: null };
}

export function textDirection(language: string | null | undefined, sample = ''): TextDirection {
  return describeText(language, sample).direction;
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function validDay(year: number, month: number, day: number): boolean {
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1) return false;
  const lengths = [0, 31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= lengths[month];
}

function parseCivilParts(value: string): CivilParts | null {
  const trimmed = value.trim();
  const yearOnly = /^(\d{4})$/.exec(trimmed);
  if (yearOnly) {
    const year = Number(yearOnly[1]);
    if (year < 1 || year > 9999) return null;
    return { precision: 'year', year: yearOnly[1], month: null, day: null };
  }
  const monthOnly = /^(\d{4})-(\d{2})$/.exec(trimmed);
  if (monthOnly) {
    const year = Number(monthOnly[1]);
    const month = Number(monthOnly[2]);
    if (year < 1 || year > 9999 || month < 1 || month > 12) return null;
    return { precision: 'month', year: monthOnly[1], month: monthOnly[2], day: null };
  }
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!day) return null;
  const year = Number(day[1]);
  const month = Number(day[2]);
  const date = Number(day[3]);
  if (!validDay(year, month, date)) return null;
  return { precision: 'day', year: day[1], month: day[2], day: day[3] };
}

function narrow(parts: CivilParts, precision: DatePrecisionWord): CivilParts | null {
  if (RANK[precision] > RANK[parts.precision]) return null;
  if (precision === 'year') return { precision: 'year', year: parts.year, month: null, day: null };
  if (precision === 'month') return { precision: 'month', year: parts.year, month: parts.month, day: null };
  return parts;
}

function canonical(parts: CivilParts): string {
  if (parts.precision === 'year') return parts.year;
  if (parts.precision === 'month') return `${parts.year}-${parts.month}`;
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function display(locale: UiLocale, parts: CivilParts): string {
  if (locale === 'ja') {
    if (parts.precision === 'year') return `${parts.year}年`;
    const month = String(Number(parts.month));
    if (parts.precision === 'month') return `${parts.year}年${month}月`;
    return `${parts.year}年${month}月${String(Number(parts.day))}日`;
  }
  if (parts.precision === 'year') return parts.year;
  const monthName = catalog(locale).months[Number(parts.month) - 1] ?? '';
  if (parts.precision === 'month') return `${monthName} ${parts.year}`;
  return `${Number(parts.day)} ${monthName} ${parts.year}`;
}

function cleanSource(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text ? text : null;
}

function unknownDate(locale: UiLocale, source: string | null): FormattedDate {
  return {
    text: catalog(locale).messages.date_unknown,
    precision: 'unknown',
    value: null,
    known: false,
    source,
    timeZoneApplied: false,
  };
}

function knownDate(locale: UiLocale, parts: CivilParts, source: string | null, timeZoneApplied: boolean): FormattedDate {
  return {
    text: display(locale, parts),
    precision: parts.precision,
    value: canonical(parts),
    known: true,
    source,
    timeZoneApplied,
  };
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

function parseInstant(value: string): number | null {
  const match = INSTANT_TEXT.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (hour > 23 || minute > 59 || second > 59 || !validDay(year, month, day)) return null;
  const fraction = match[7] ? match[7].slice(0, 3).padEnd(3, '0') : '000';
  const offset = offsetMinutes(match[8]);
  if (offset === null) return null;
  const utcWall = Date.parse(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}.${fraction}Z`);
  if (Number.isNaN(utcWall)) return null;
  return utcWall - offset * 60_000;
}

function civilFromInstant(milliseconds: number, zone: string): CivilParts | null {
  const offset = offsetMinutes(zone);
  if (offset !== null) {
    const shifted = new Date(milliseconds + offset * 60_000);
    const yearNum = shifted.getUTCFullYear();
    const month = shifted.getUTCMonth() + 1;
    const day = shifted.getUTCDate();
    if (!validDay(yearNum, month, day)) return null;
    return {
      precision: 'day',
      year: String(yearNum).padStart(4, '0'),
      month: String(month).padStart(2, '0'),
      day: String(day).padStart(2, '0'),
    };
  }
  if (!IANA_ZONE.test(zone)) return null;
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
  const year = picked('year').padStart(4, '0');
  const month = picked('month').padStart(2, '0');
  const day = picked('day').padStart(2, '0');
  if (!validDay(Number(year), Number(month), Number(day))) return null;
  return { precision: 'day', year, month, day };
}

export function formatCivilDate(locale: UiLocale, input: CivilDateInput = {}): FormattedDate {
  const source = cleanSource(input.source);
  const explicit = input.precision === 'day' || input.precision === 'month' || input.precision === 'year'
    ? input.precision
    : null;
  const rawValue = typeof input.value === 'string' ? input.value.trim() : '';
  if (rawValue) {
    const parsed = parseCivilParts(rawValue);
    if (!parsed) return unknownDate(locale, source);
    const parts = explicit ? narrow(parsed, explicit) : parsed;
    if (!parts) return unknownDate(locale, source);
    return knownDate(locale, parts, source, false);
  }
  const instant = typeof input.instant === 'string' ? input.instant.trim() : '';
  if (!instant) return unknownDate(locale, source);
  const zone = typeof input.timeZone === 'string' ? input.timeZone.trim() : '';
  if (!zone) return unknownDate(locale, source);
  const milliseconds = parseInstant(instant);
  if (milliseconds === null) return unknownDate(locale, source);
  const parts = civilFromInstant(milliseconds, zone);
  if (!parts) return unknownDate(locale, source);
  const shown = explicit ? narrow(parts, explicit) : parts;
  if (!shown) return unknownDate(locale, source);
  return knownDate(locale, shown, source, true);
}

export function formatVersionStatus(
  locale: UiLocale,
  status: VersionKind | null | undefined,
  date: FormattedDate,
): VersionStatusLabel {
  const kind: VersionKind = status === 'historical' || status === 'future' ? status : 'unknown';
  const key: MessageKey = kind === 'historical' ? 'historical' : kind === 'future' ? 'future' : 'unknown_status';
  return { status: kind, label: catalog(locale).messages[key], date };
}

export function formatIncludedBecause(locale: UiLocale, reason: string | null | undefined): string {
  const label = catalog(locale).messages.included_because;
  const text = typeof reason === 'string' ? reason.trim() : '';
  if (!text) return label;
  if (locale === 'ja') return `${label}：${text}`;
  return `${label} ${text}`;
}

export function languageChangeAnnouncement(input: {
  locale: UiLocale;
  placeLabel: string | null;
  date: FormattedDate;
  scope: SearchScopeChoice;
  coverage: CoverageWord;
}): string {
  const copy = catalog(input.locale).messages;
  const place = input.placeLabel?.trim() || copy.unselected_worldwide;
  const scope = input.scope === 'place' ? copy.this_place : copy.search_worldwide;
  const dateText = input.date.known ? input.date.text : copy.date_unknown;
  return [
    copy.language,
    LANGUAGE_NAMES[input.locale],
    place,
    `${copy.as_of} ${dateText}`,
    scope,
    `${copy.coverage} ${copy[COVERAGE_KEY[input.coverage]]}`,
  ].join('. ') + '.';
}

function titleNodes(title: string, direction: TextDirection): ReactNode {
  if (direction !== 'rtl') return title;
  const nodes: ReactNode[] = [];
  const expression = new RegExp(LATIN_RUN.source, 'g');
  let last = 0;
  let index = 0;
  let match: RegExpExecArray | null;
  while ((match = expression.exec(title))) {
    const found = match[0];
    const at = match.index;
    if (at > last) nodes.push(title.slice(last, at));
    nodes.push(h('span', {
      key: `latin-${index}`,
      'data-isolate': 'latin-identifier',
      dir: 'ltr',
      style: ISOLATE,
    }, found));
    last = at + found.length;
    index += 1;
  }
  if (index === 0) return title;
  if (last < title.length) nodes.push(title.slice(last));
  return nodes;
}

export function WorldwideRoot({ locale, children }: { locale: UiLocale; children?: ReactNode }) {
  const copy = catalog(locale);
  return h('div', {
    className: 'wwl',
    lang: copy.lang,
    dir: copy.dir,
    'data-schema': I18N_SCHEMA,
    'data-ui-locale': copy.lang,
    'data-script': copy.script,
  }, children);
}

export function InterfaceLanguageControl({
  locale,
  onLocale,
}: {
  locale: UiLocale;
  onLocale: (locale: UiLocale) => void;
}) {
  const copy = catalog(locale);
  const id = useId();
  return h('div', { className: 'wwl-field wwl-language-field' },
    h('label', { htmlFor: id }, copy.messages.language),
    h('select', {
      id,
      'data-field': 'ui-locale-control',
      value: locale,
      onChange: (event: ChangeEvent<HTMLSelectElement>) => {
        const next = toUiLocale(event.target.value);
        if (next) onLocale(next);
      },
    }, UI_LOCALES.map((code) => h('option', { key: code, value: code }, LANGUAGE_NAMES[code]))),
  );
}

export function InterfaceSearchField({ locale }: { locale: UiLocale }) {
  const copy = catalog(locale);
  const id = useId();
  return h('div', { className: 'wwl-field' },
    h('label', { htmlFor: id }, copy.messages.search_label),
    h('input', {
      id,
      className: 'wwl-search-input',
      type: 'search',
      placeholder: copy.messages.search_placeholder,
      style: ALIGN_START,
    }),
  );
}

export function NativeTitle({
  title,
  language,
  label,
}: {
  title: string;
  language?: string | null;
  label: string;
}) {
  const text = title.trim();
  const described = describeText(language, text);
  return h('p', { className: 'wwl-original', 'data-field': 'original-title' },
    h('span', { className: 'wwl-badge' }, label),
    ' ',
    h('span', {
      className: 'wwl-embed',
      'data-field': 'native-title',
      'data-script': described.script,
      'data-title': text ? 'present' : 'missing',
      lang: described.lang ?? undefined,
      dir: described.direction,
      translate: 'no',
      style: ISOLATE,
    }, text ? titleNodes(text, described.direction) : null),
  );
}

export function TranslationBlock({
  locale,
  translation,
}: {
  locale: UiLocale;
  translation: TranslationInput | null | undefined;
}) {
  const copy = catalog(locale).messages;
  const text = translation?.text?.trim() ?? '';
  const translatedTitle = translation?.title?.trim() ?? '';
  if (!text && !translatedTitle) {
    return h('div', { 'data-translation': 'hidden', 'data-translation-kind': 'none' });
  }
  const kind = translation?.kind === 'machine' || translation?.kind === 'official' ? translation.kind : 'unlabelled';
  const label = kind === 'machine' ? copy.machine_translation : kind === 'official' ? copy.official_translation : copy.translation;
  const described = describeText(translation?.language, translatedTitle || text);
  const embed = {
    lang: described.lang ?? undefined,
    dir: described.direction,
    translate: 'no' as const,
    style: ISOLATE,
  };
  return h('div', {
    className: 'wwl-translation',
    'data-translation': 'shown',
    'data-translation-kind': kind,
  },
    h('p', { className: 'wwl-translation-label', 'data-field': 'translation-label' }, label),
    translatedTitle ? h('p', { className: 'wwl-translation-text', 'data-field': 'translation-title', ...embed }, translatedTitle) : null,
    text ? h('p', { className: 'wwl-translation-text', 'data-field': 'translation-text', ...embed }, text) : null,
    h('p', { 'data-field': 'translation-revision' }, copy.not_a_revision),
  );
}

export function CivilDateText({ locale, date }: { locale: UiLocale; date: FormattedDate }) {
  const copy = catalog(locale).messages;
  const precision = h('span', { 'data-field': 'precision' }, copy[PRECISION_KEY[date.precision]]);
  const body = date.known
    ? h('time', {
      className: 'wwl-date',
      'data-field': 'civil-date',
      'data-isolate': 'civil-date',
      'data-precision': date.precision,
      'data-value': date.value,
      'data-source': date.source ?? undefined,
      'data-timezone-applied': date.timeZoneApplied ? 'true' : 'false',
      dateTime: date.value ?? undefined,
      dir: 'ltr',
      style: ISOLATE,
    }, date.text)
    : h('span', {
      className: 'wwl-date',
      'data-field': 'civil-date',
      'data-isolate': 'civil-date',
      'data-precision': 'unknown',
      'data-value': '',
      'data-timezone-applied': 'false',
      dir: 'ltr',
      style: ISOLATE,
    }, date.text);
  return h('span', { 'data-field': 'dated' }, body, ' ', precision);
}

function isolatedValue(kind: 'citation' | 'record-id', value: string) {
  const described = describeText(null, value);
  return h('span', {
    className: kind === 'citation' ? 'wwl-citation' : 'wwl-identifier',
    'data-field': kind,
    'data-isolate': kind,
    dir: described.direction === 'auto' ? 'ltr' : described.direction,
    lang: described.lang ?? undefined,
    style: ISOLATE,
  }, value);
}

export function InternationalShell({
  presentation,
  onUiLocale,
  title,
  citation,
  recordId,
  translation,
  date,
  status,
  inclusionReason,
  placeLabel,
  scope = 'worldwide',
  coverage = 'unknown',
}: InternationalShellProps) {
  const copy = catalog(presentation.uiLocale);
  const formatted = formatCivilDate(presentation.uiLocale, date ?? {});
  const version = formatVersionStatus(presentation.uiLocale, status, formatted);
  const [announcement, setAnnouncement] = useState('');
  const skip = useRef(true);
  const facts = useRef({ placeLabel: placeLabel ?? null, formatted, scope, coverage });
  facts.current = { placeLabel: placeLabel ?? null, formatted, scope, coverage };
  useEffect(() => {
    if (skip.current) {
      skip.current = false;
      return;
    }
    const current = facts.current;
    setAnnouncement(languageChangeAnnouncement({
      locale: presentation.uiLocale,
      placeLabel: current.placeLabel,
      date: current.formatted,
      scope: current.scope,
      coverage: current.coverage,
    }));
  }, [presentation.uiLocale]);
  const citationText = citation?.trim() ?? '';
  const recordText = recordId?.trim() ?? '';
  const reason = inclusionReason?.trim() ?? '';
  return h(WorldwideRoot, { locale: presentation.uiLocale },
    h('h1', { className: 'wwl-product' }, copy.messages.product),
    h(InterfaceLanguageControl, { locale: presentation.uiLocale, onLocale: onUiLocale }),
    h(InterfaceSearchField, { locale: presentation.uiLocale }),
    h('p', { 'data-field': 'place', 'data-place': presentation.placeId ?? 'none' },
      h('span', { 'data-field': 'place-label' }, placeLabel?.trim() || copy.messages.unselected_worldwide),
    ),
    h('p', {
      'data-field': 'jurisdiction',
      'data-jurisdiction': presentation.jurisdictionId ?? 'none',
      'data-inferred': 'false',
    },
      h('span', null, copy.messages.search_jurisdiction),
      ' ',
      presentation.jurisdictionId
        ? h('span', { className: 'wwl-identifier', 'data-isolate': 'latin-identifier', dir: 'ltr', style: ISOLATE }, presentation.jurisdictionId)
        : h('span', null, copy.messages.unselected_worldwide),
    ),
    h('p', null,
      h('span', null, copy.messages.law_language),
      ' ',
      h('span', { 'data-field': 'law-language' }, presentation.lawLanguage ?? copy.messages.date_unknown),
    ),
    h('p', { 'data-field': 'ui-locale' }, presentation.uiLocale),
    h('p', {
      'data-field': 'browser-language',
      'data-browser': presentation.browserLanguage ?? 'absent',
      'data-effect': 'ui-locale-only',
    }, copy.messages.browser_not_jurisdiction),
    h('p', { 'data-field': 'scope' }, scope === 'place' ? copy.messages.this_place : copy.messages.search_worldwide),
    h('p', { 'data-field': 'coverage', 'data-coverage': coverage }, `${copy.messages.coverage} ${copy.messages[COVERAGE_KEY[coverage]]}`),
    h('p', { 'data-field': 'as-of' },
      h('span', null, copy.messages.as_of),
      ' ',
      h(CivilDateText, { locale: presentation.uiLocale, date: formatted }),
    ),
    h('p', { 'data-field': 'status', 'data-status': version.status }, version.label),
    h(NativeTitle, { title, language: presentation.lawLanguage, label: copy.messages.original_title }),
    citationText ? h('p', null, isolatedValue('citation', citationText)) : null,
    recordText ? h('p', null, isolatedValue('record-id', recordText)) : null,
    h(TranslationBlock, { locale: presentation.uiLocale, translation }),
    reason ? h('p', { 'data-field': 'inclusion' }, formatIncludedBecause(presentation.uiLocale, reason)) : null,
    h('button', { type: 'button', 'data-field': 'back' },
      h('span', {
        'aria-hidden': 'true',
        'data-mirror': copy.dir === 'rtl' ? 'inline' : 'none',
        style: copy.dir === 'rtl' ? MIRROR : undefined,
      }, '←'),
      ' ',
      copy.messages.back_to_results,
    ),
    presentation.issues.map((item) => h('p', { key: `${item.field}:${item.code}`, 'data-issue': item.code, 'data-issue-field': item.field }, copy.messages.browser_not_jurisdiction)),
    h('div', {
      role: 'status',
      'aria-live': 'polite',
      'aria-atomic': 'true',
      'data-field': 'announcement',
    }, announcement),
  );
}

/**
 * Interface locale, law language, and search jurisdiction stay separate.
 * Dates keep the precision the source stated. Native titles keep their own
 * direction. Machine translations are labelled.
 */

import { readFileSync } from 'fs';
import { useState } from 'react';
import { jest } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CATALOGS, MESSAGE_KEYS, UI_LOCALES } from '../../src/locales/worldwide';
import {
  I18N_SCHEMA,
  UI_LANGUAGE_STORAGE_KEY,
  acceptJurisdictionId,
  applyUiLocale,
  describeText,
  formatCivilDate,
  formatIncludedBecause,
  formatVersionStatus,
  jurisdictionFromBrowserLanguage,
  languageChangeAnnouncement,
  readStoredLocale,
  resolvePresentation,
  writeStoredLocale,
  InternationalShell,
  TranslationBlock,
} from '../../src/lib/worldwide/i18n';

const contract = JSON.parse(readFileSync('docs/worldwide/interaction-states.json', 'utf8')) as {
  labels: Record<string, Record<string, string>>;
  rtl: { locales: string[] };
};

function field(container: HTMLElement, name: string): HTMLElement {
  const element = container.querySelector(`[data-field="${name}"]`);
  if (!element) throw new Error(`missing field ${name}`);
  return element as HTMLElement;
}

function Harness() {
  const [locale, setLocale] = useState<string | null>(null);
  const presentation = resolvePresentation({
    uiLocale: locale,
    browserLanguage: 'ar-EG',
    lawLanguage: 'ja',
    jurisdictionId: 'netherlands',
    placeId: 'place:netherlands',
    readNavigator: false,
  });
  return (
    <InternationalShell
      presentation={presentation}
      onUiLocale={(next) => setLocale(next)}
      title="民法第1条"
      citation="BWBR0001854"
      recordId="record-1"
      translation={{ kind: 'machine', language: 'ar', title: 'المادة 1', text: 'نص مترجم' }}
      date={{ value: '2024-06', precision: 'month', source: 'fixture' }}
      status="historical"
      inclusionReason="the source lists this place"
      placeLabel="Amsterdam"
      scope="place"
      coverage="partial"
    />
  );
}

describe('interface catalogs', () => {
  test('matches the labelled English, Dutch, Arabic, and Japanese contract', () => {
    expect(UI_LOCALES).toEqual(['en', 'nl', 'ar', 'ja']);
    expect(contract.rtl.locales).toEqual(['ar']);
    for (const locale of UI_LOCALES) {
      const expected = contract.labels[locale];
      const copy = CATALOGS[locale];
      expect(copy.locale).toBe(locale);
      expect(copy.lang).toBe(expected.lang);
      expect(copy.dir).toBe(expected.dir);
      expect(copy.months).toHaveLength(12);
      expect(copy.months.every((month) => month.length > 0)).toBe(true);
      for (const key of MESSAGE_KEYS) {
        expect(copy.messages[key].length).toBeGreaterThan(0);
      }
      for (const [key, value] of Object.entries(expected)) {
        if (key === 'dir' || key === 'lang' || key === 'script') continue;
        expect(copy.messages[key as keyof typeof copy.messages]).toBe(value);
      }
    }
    expect(CATALOGS.ar.dir).toBe('rtl');
    expect(CATALOGS.ja.script).toBe('CJK');
    expect(CATALOGS.ja.dir).toBe('ltr');
    expect(CATALOGS.en.messages.browser_not_jurisdiction).not.toBe(CATALOGS.ar.messages.browser_not_jurisdiction);
    expect(CATALOGS.ja.messages.included_because).toBe('収録した理由');
  });
});

describe('locale, law language, and jurisdiction', () => {
  test('keeps an explicit choice, a stored locale, and a browser suggestion apart from the place', () => {
    const chosen = resolvePresentation({
      uiLocale: 'ja-JP',
      storedLocale: 'ar',
      browserLanguage: 'nl-NL',
      lawLanguage: 'ar-EG',
      jurisdictionId: 'netherlands',
      placeId: 'place:netherlands',
    });
    expect(chosen.uiLocale).toBe('ja');
    expect(chosen.uiLocaleSource).toBe('explicit');
    expect(chosen.lawLanguage).toBe('ar-EG');
    expect(chosen.jurisdictionId).toBe('netherlands');
    expect(chosen.placeId).toBe('place:netherlands');
    expect(chosen.jurisdictionInferredFromBrowser).toBe(false);
    expect(chosen.schema).toBe(I18N_SCHEMA);

    const stored = resolvePresentation({
      storedLocale: 'AR',
      browserLanguage: 'ja-JP',
      lawLanguage: 'nl-BE',
    });
    expect(stored.uiLocale).toBe('ar');
    expect(stored.uiLocaleSource).toBe('stored');
    expect(stored.lawLanguage).toBe('nl-BE');
    expect(stored.jurisdictionId).toBeNull();
    expect(stored.placeId).toBeNull();

    const suggested = resolvePresentation({
      browserLanguages: ['zh-CN', 'ja-JP'],
      lawLanguage: 'zh-Hant',
    });
    expect(suggested.browserLanguage).toBe('zh-CN');
    expect(suggested.uiLocale).toBe('ja');
    expect(suggested.uiLocaleSource).toBe('browser');
    expect(suggested.lawLanguage).toBe('zh-Hant');
    expect(suggested.jurisdictionId).toBeNull();
    expect(suggested.placeId).toBeNull();

    const fallback = resolvePresentation({
      browserLanguages: ['zh-CN', 'fr-FR'],
      storedLocale: 'place:japan',
      readNavigator: false,
    });
    expect(fallback.uiLocale).toBe('en');
    expect(fallback.uiLocaleSource).toBe('fallback');
    expect(fallback.jurisdictionId).toBeNull();
    expect(fallback.placeId).toBeNull();
  });

  test('does not turn a browser language, a language tag, or a country code into a jurisdiction', () => {
    const tags = ['ja-JP', 'ar-EG', 'nl-NL', 'en-US', 'zh-CN', 'he-IL', 'fa-IR'];
    for (const tag of tags) {
      expect(jurisdictionFromBrowserLanguage(tag)).toBeNull();
      const presentation = resolvePresentation({ browserLanguage: tag, lawLanguage: tag });
      expect(presentation.jurisdictionId).toBeNull();
      expect(presentation.placeId).toBeNull();
      expect(presentation.jurisdictionInferredFromBrowser).toBe(false);
      expect(presentation.lawLanguage).not.toBeNull();
    }
    expect(resolvePresentation({ browserLanguage: 'ja-JP' }).uiLocale).toBe('ja');
    expect(resolvePresentation({ browserLanguage: 'en-US' }).uiLocaleSource).toBe('browser');
    expect(resolvePresentation({ browserLanguage: 'zh-CN' }).uiLocaleSource).toBe('fallback');

    expect(acceptJurisdictionId('ja-JP', 'ja-JP').issue?.code).toBe('browser-language-not-jurisdiction');
    expect(acceptJurisdictionId('ja', null).issue?.code).toBe('code-not-jurisdiction');
    expect(acceptJurisdictionId('jp', 'ar-EG').issue?.code).toBe('code-not-jurisdiction');
    expect(acceptJurisdictionId('place:nl', null).issue?.code).toBe('code-not-jurisdiction');
    expect(acceptJurisdictionId('place:ja', 'ja-JP').issue?.code).toBe('browser-language-not-jurisdiction');
    expect(acceptJurisdictionId('japan', 'ja-JP')).toEqual({ id: 'japan', issue: null });
    expect(acceptJurisdictionId('place:netherlands', 'ar-EG')).toEqual({ id: 'place:netherlands', issue: null });
    expect(acceptJurisdictionId('unstated', null)).toEqual({ id: 'unstated', issue: null });

    const rejected = resolvePresentation({
      browserLanguage: null,
      lawLanguage: 'zh-Hant',
      jurisdictionId: 'zh-Hant',
      placeId: 'place:jp',
      readNavigator: false,
    });
    expect(rejected.uiLocaleSource).toBe('fallback');
    expect(rejected.lawLanguage).toBe('zh-Hant');
    expect(rejected.jurisdictionId).toBeNull();
    expect(rejected.placeId).toBeNull();
    expect(rejected.issues.map((item) => item.code)).toEqual(['language-tag-not-jurisdiction', 'code-not-jurisdiction']);
  });

  test('reads navigator.language as an interface suggestion and ignores it for the place', () => {
    const language = Object.getOwnPropertyDescriptor(window.navigator, 'language');
    const languages = Object.getOwnPropertyDescriptor(window.navigator, 'languages');
    Object.defineProperty(window.navigator, 'language', { configurable: true, value: 'ar-EG' });
    Object.defineProperty(window.navigator, 'languages', { configurable: true, value: ['ar-EG'] });
    try {
      const closed = resolvePresentation({ readNavigator: false });
      expect(closed.uiLocale).toBe('en');
      expect(closed.uiLocaleSource).toBe('fallback');
      expect(closed.jurisdictionId).toBeNull();
      const open = resolvePresentation({});
      expect(open.uiLocale).toBe('ar');
      expect(open.uiLocaleSource).toBe('browser');
      expect(open.browserLanguage).toBe('ar-EG');
      expect(open.jurisdictionId).toBeNull();
      expect(open.placeId).toBeNull();
      expect(open.lawLanguage).toBeNull();
      const absent = resolvePresentation({ browserLanguage: null });
      expect(absent.uiLocaleSource).toBe('fallback');
      expect(absent.jurisdictionId).toBeNull();
    } finally {
      if (language) Object.defineProperty(window.navigator, 'language', language);
      if (languages) Object.defineProperty(window.navigator, 'languages', languages);
    }
  });

  test('stores only the interface locale', () => {
    const saved = new Map<string, string>();
    const storage = {
      getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => { saved.set(key, value); },
    };
    writeStoredLocale(storage, 'ja');
    expect(saved.get(UI_LANGUAGE_STORAGE_KEY)).toBe('ja');
    expect(saved.size).toBe(1);
    expect(readStoredLocale(storage)).toBe('ja');
    const presentation = resolvePresentation({
      storedLocale: readStoredLocale(storage),
      browserLanguage: 'ar-EG',
    });
    expect(presentation.uiLocale).toBe('ja');
    expect(presentation.uiLocaleSource).toBe('stored');
    expect(presentation.jurisdictionId).toBeNull();
    const next = applyUiLocale(presentation, 'nl');
    expect(next.uiLocale).toBe('nl');
    expect(next.jurisdictionId).toBe(presentation.jurisdictionId);
    expect(next.placeId).toBe(presentation.placeId);
    expect(next.lawLanguage).toBe(presentation.lawLanguage);
    expect(next.jurisdictionInferredFromBrowser).toBe(false);
  });
});

describe('dates with precision', () => {
  test('formats a civil day, month, or year without inventing a finer part', () => {
    expect(formatCivilDate('en', { value: '2026-10-26', precision: 'day' })).toMatchObject({
      text: '26 Oct 2026',
      precision: 'day',
      value: '2026-10-26',
      known: true,
      timeZoneApplied: false,
    });
    expect(formatCivilDate('en', { value: '2026-10', precision: 'month' }).text).toBe('Oct 2026');
    expect(formatCivilDate('en', { value: '2026', precision: 'year' }).text).toBe('2026');
    expect(formatCivilDate('nl', { value: '2026-10-26', precision: 'day' }).text).toBe('26 okt 2026');
    expect(formatCivilDate('nl', { value: '2024-03', precision: 'month' }).text).toBe('mrt 2024');
    expect(formatCivilDate('ar', { value: '2026-10-26', precision: 'day' }).text).toBe('26 أكتوبر 2026');
    expect(formatCivilDate('ar', { value: '2024-06', precision: 'month' }).text).toBe('يونيو 2024');
    expect(formatCivilDate('ja', { value: '2026-10-26', precision: 'day' }).text).toBe('2026年10月26日');
    expect(formatCivilDate('ja', { value: '2024-06', precision: 'month' }).text).toBe('2024年6月');
    expect(formatCivilDate('ja', { value: '2024', precision: 'year' }).text).toBe('2024年');
    expect(formatCivilDate('en', { value: '2024-06-06', precision: 'day' })).toMatchObject({
      text: '6 Jun 2024',
      value: '2024-06-06',
    });

    const english = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    english.forEach((name, index) => {
      const month = String(index + 1).padStart(2, '0');
      const formatted = formatCivilDate('en', { value: `2024-${month}`, precision: 'month' });
      expect(formatted.text).toBe(`${name} 2024`);
      expect(formatted.text).not.toMatch(/(^| )\d{1,2}( |$)/);
    });

    const coarser = formatCivilDate('en', { value: '2024-06-15', precision: 'year', source: 'fixture' });
    expect(coarser).toMatchObject({ text: '2024', precision: 'year', value: '2024', source: 'fixture' });
    expect(coarser.text).not.toContain('Jun');
    expect(coarser.text).not.toContain('15');

    const widened = formatCivilDate('en', { value: '2024', precision: 'day' });
    expect(widened.known).toBe(false);
    expect(widened.value).toBeNull();
    expect(widened.text).toBe('unknown');
    expect(formatCivilDate('ja', { value: '2024-6', precision: 'month' }).known).toBe(false);
    expect(formatCivilDate('en', { value: '2023-02-29', precision: 'day' }).known).toBe(false);
    expect(formatCivilDate('en', { value: '1900-02-29', precision: 'day' }).known).toBe(false);
    expect(formatCivilDate('en', { value: '2000-02-29', precision: 'day' }).text).toBe('29 Feb 2000');
    expect(formatCivilDate('en', { value: '2024-02-29', precision: 'day' }).text).toBe('29 Feb 2024');
    expect(formatCivilDate('nl', {}).text).toBe('onbekend');
    expect(formatCivilDate('ar', {}).text).toBe('غير معروف');
    expect(formatCivilDate('ja', {}).text).toBe('不明');
  });

  test('uses an explicit source timezone for an instant and does not shift a civil date', () => {
    const parts = jest.spyOn(Intl.DateTimeFormat.prototype, 'formatToParts');
    const resolved = jest.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions');
    const partsBefore = parts.mock.calls.length;
    const resolvedBefore = resolved.mock.calls.length;
    const civil = formatCivilDate('en', { value: '2026-01-01', precision: 'day', timeZone: 'Pacific/Honolulu' });
    const offset = formatCivilDate('en', { instant: '2026-10-26T15:30:00Z', timeZone: '+09:00' });
    expect(parts.mock.calls.length).toBe(partsBefore);
    expect(resolved.mock.calls.length).toBe(resolvedBefore);
    expect(civil).toMatchObject({ text: '1 Jan 2026', value: '2026-01-01', timeZoneApplied: false });
    expect(offset).toMatchObject({ text: '27 Oct 2026', value: '2026-10-27', precision: 'day', timeZoneApplied: true });

    expect(formatCivilDate('en', { instant: '2026-10-26T15:30:00Z', timeZone: 'Asia/Tokyo' }).value).toBe('2026-10-27');
    expect(formatCivilDate('en', { instant: '2026-10-26T23:30:00Z', timeZone: 'Europe/Amsterdam' }).value).toBe('2026-10-27');
    expect(formatCivilDate('en', { instant: '2026-10-26T23:30:00Z', timeZone: 'America/Los_Angeles' }).text).toBe('26 Oct 2026');
    expect(formatCivilDate('en', { instant: '2026-01-01T00:30:00Z', timeZone: 'Pacific/Honolulu' }).text).toBe('31 Dec 2025');
    expect(formatCivilDate('en', { instant: '2024-02-29T12:00:00Z', timeZone: 'UTC' }).text).toBe('29 Feb 2024');
    expect(formatCivilDate('ja', {
      instant: '2026-10-26T15:30:00Z',
      timeZone: 'Asia/Tokyo',
      precision: 'year',
    })).toMatchObject({ text: '2026年', value: '2026', precision: 'year', timeZoneApplied: true });

    const missingZone = formatCivilDate('en', { instant: '2026-10-26T15:30:00Z' });
    expect(missingZone.known).toBe(false);
    expect(missingZone.text).toBe('unknown');
    expect(formatCivilDate('en', { instant: '2026-10-26T15:30:00Z', timeZone: 'Mars/Phobos' }).known).toBe(false);
    expect(formatCivilDate('en', { instant: '2026-02-31T00:00:00Z', timeZone: 'UTC' }).known).toBe(false);
    const stated = formatCivilDate('en', {
      value: '2026-10-26',
      precision: 'day',
      instant: '2026-10-26T15:30:00Z',
      timeZone: 'Asia/Tokyo',
    });
    expect(stated).toMatchObject({ text: '26 Oct 2026', value: '2026-10-26', timeZoneApplied: false });
    parts.mockRestore();
    resolved.mockRestore();

    expect(formatVersionStatus('en', 'historical', formatCivilDate('en', { value: '1990', precision: 'year' }))).toMatchObject({
      status: 'historical',
      label: 'Historical text',
    });
    expect(formatVersionStatus('ja', 'future', formatCivilDate('ja', { value: '2027-03', precision: 'month' })).label).toBe('将来の施行');
    expect(formatVersionStatus('ar', null, formatCivilDate('ar', {})).label).toBe('الحالة غير معروفة');
  });

  test('joins an inclusion reason without rewriting it', () => {
    expect(formatIncludedBecause('en', 'the source lists this place')).toBe('Included because the source lists this place');
    expect(formatIncludedBecause('nl', 'the source lists this place')).toBe('Opgenomen omdat the source lists this place');
    expect(formatIncludedBecause('ar', 'the source lists this place')).toBe('مُدرج لأن the source lists this place');
    expect(formatIncludedBecause('ja', 'the source lists this place')).toBe('収録した理由：the source lists this place');
    expect(formatIncludedBecause('ja', '  ')).toBe('収録した理由');
    expect(formatIncludedBecause('en', '日本')).toBe('Included because 日本');
    const announced = languageChangeAnnouncement({
      locale: 'en',
      placeLabel: 'Amsterdam',
      date: formatCivilDate('en', { value: '2024-06', precision: 'month' }),
      scope: 'place',
      coverage: 'partial',
    });
    expect(announced).toBe('Language. English. Amsterdam. As of Jun 2024. This place. Coverage Partial collection.');
    expect(announced).not.toContain('Japan');
  });
});

describe('native titles, direction, and translations', () => {
  test('describes CJK, Arabic, and Hebrew text without choosing a place', () => {
    expect(describeText('ja', '民法')).toMatchObject({ direction: 'ltr', script: 'CJK', lang: 'ja' });
    expect(describeText('ja-JP', '民法')).toMatchObject({ direction: 'ltr', script: 'CJK', lang: 'ja-JP' });
    expect(describeText('zh-Hant', '民法')).toMatchObject({ direction: 'ltr', script: 'CJK', lang: 'zh-Hant' });
    expect(describeText('ko', '민법')).toMatchObject({ direction: 'ltr', script: 'CJK', lang: 'ko' });
    expect(describeText('ar', 'قانون')).toMatchObject({ direction: 'rtl', script: 'Arab', lang: 'ar' });
    expect(describeText('ar-EG', 'قانون')).toMatchObject({ direction: 'rtl', script: 'Arab', lang: 'ar-EG' });
    expect(describeText('he', 'חוק')).toMatchObject({ direction: 'rtl', script: 'Hebr', lang: 'he' });
    expect(describeText('fa', 'قانون')).toMatchObject({ direction: 'rtl', script: 'Arab', lang: 'fa' });
    expect(describeText('nl', 'Wetboek van Strafrecht')).toMatchObject({ direction: 'ltr', script: 'Latn', lang: 'nl' });
    expect(describeText(null, '民法第1条')).toMatchObject({ direction: 'ltr', script: 'CJK', lang: null });
    expect(describeText(null, 'قانون')).toMatchObject({ direction: 'rtl', script: 'Arab', lang: null });
    expect(describeText(null, 'חוק')).toMatchObject({ direction: 'rtl', script: 'Hebr', lang: null });
    expect(describeText(null, '民法 قانون')).toMatchObject({ direction: 'auto', script: 'mixed' });
    expect(describeText(null, '')).toMatchObject({ direction: 'auto', script: 'unknown', lang: null });
  });

  test('labels machine and official translations in every interface locale', () => {
    for (const locale of UI_LOCALES) {
      const machine = render(<TranslationBlock locale={locale} translation={{ kind: 'machine', language: 'en', text: 'Hello' }} />);
      expect(machine.container.querySelector('[data-field="translation-label"]')?.textContent).toBe(CATALOGS[locale].messages.machine_translation);
      expect(machine.container.querySelector('[data-translation-kind]')?.getAttribute('data-translation-kind')).toBe('machine');
      expect(machine.container.querySelector('[data-field="translation-revision"]')?.textContent).toBe(CATALOGS[locale].messages.not_a_revision);
      machine.unmount();

      const official = render(<TranslationBlock locale={locale} translation={{ kind: 'official', language: 'en', text: 'Hello' }} />);
      expect(official.container.querySelector('[data-field="translation-label"]')?.textContent).toBe(CATALOGS[locale].messages.official_translation);
      expect(official.container.querySelector('[data-field="translation-label"]')?.textContent).not.toBe(CATALOGS[locale].messages.machine_translation);
      official.unmount();
    }
    const unlabelled = render(<TranslationBlock locale="en" translation={{ kind: null, language: 'en', text: 'Hello' }} />);
    expect(field(unlabelled.container, 'translation-label').textContent).toBe('Translation');
    expect(field(unlabelled.container, 'translation-label').textContent).not.toBe('Machine translation');
    expect(unlabelled.container.querySelector('[data-translation-kind]')?.getAttribute('data-translation-kind')).toBe('unlabelled');
    unlabelled.unmount();
    const hidden = render(<TranslationBlock locale="en" translation={null} />);
    expect(hidden.container.querySelector('[data-translation]')?.getAttribute('data-translation')).toBe('hidden');
    hidden.unmount();
  });
});

describe('interface language control', () => {
  test('changes the interface only, and keeps the Japanese title, Arabic translation, place, and month precision', async () => {
    const user = userEvent.setup();
    const writes: string[] = [];
    const originalSet = window.localStorage.setItem.bind(window.localStorage);
    window.localStorage.setItem = (key: string, value: string) => {
      writes.push(`${key}=${value}`);
      originalSet(key, value);
    };
    try {
      const view = render(<Harness />);
      const root = view.container.querySelector('.wwl') as HTMLElement;
      expect(root).toHaveAttribute('lang', 'ar');
      expect(root).toHaveAttribute('dir', 'rtl');
      expect(root).toHaveAttribute('data-schema', I18N_SCHEMA);
      expect(screen.getByRole('heading', { name: 'قوانين العالم' })).toBeInTheDocument();
      expect(field(view.container, 'ui-locale').textContent).toBe('ar');
      expect(field(view.container, 'law-language').textContent).toBe('ja');
      expect(field(view.container, 'jurisdiction')).toHaveAttribute('data-jurisdiction', 'netherlands');
      expect(field(view.container, 'jurisdiction')).toHaveAttribute('data-inferred', 'false');
      expect(field(view.container, 'place')).toHaveAttribute('data-place', 'place:netherlands');
      expect(field(view.container, 'place-label').textContent).toBe('Amsterdam');
      expect(field(view.container, 'browser-language')).toHaveAttribute('data-browser', 'ar-EG');
      expect(field(view.container, 'browser-language')).toHaveAttribute('data-effect', 'ui-locale-only');
      expect(field(view.container, 'browser-language').textContent).toBe('لغة المتصفح لا تختار اختصاصًا.');

      const native = field(view.container, 'native-title');
      expect(native).toHaveAttribute('lang', 'ja');
      expect(native).toHaveAttribute('dir', 'ltr');
      expect(native).toHaveAttribute('data-script', 'CJK');
      expect(native).toHaveAttribute('translate', 'no');
      expect(native.textContent).toBe('民法第1条');
      expect(native.style.unicodeBidi).toBe('isolate');
      expect(view.container.querySelector('.wwl-badge')?.textContent).toBe('العنوان الأصلي');
      expect(native.textContent).not.toContain('العنوان الأصلي');

      const translationLabel = field(view.container, 'translation-label');
      expect(translationLabel.textContent).toBe('ترجمة آلية');
      expect(translationLabel.textContent).not.toContain('民法');
      expect(field(view.container, 'translation-text')).toHaveAttribute('lang', 'ar');
      expect(field(view.container, 'translation-text')).toHaveAttribute('dir', 'rtl');
      expect(field(view.container, 'translation-text').textContent).toBe('نص مترجم');
      expect(field(view.container, 'translation-revision').textContent).toBe('الترجمة ليست مراجعة جديدة للمصدر.');
      expect(view.container.innerHTML.indexOf('data-field="native-title"')).toBeLessThan(view.container.innerHTML.indexOf('data-field="translation-label"'));
      expect(view.container.innerHTML.indexOf('data-field="ui-locale-control"')).toBeLessThan(view.container.innerHTML.indexOf('data-field="native-title"'));

      expect(field(view.container, 'civil-date')).toHaveAttribute('data-precision', 'month');
      expect(field(view.container, 'civil-date')).toHaveAttribute('data-value', '2024-06');
      expect(field(view.container, 'civil-date')).toHaveAttribute('data-source', 'fixture');
      expect(field(view.container, 'civil-date').textContent).toBe('يونيو 2024');
      expect(field(view.container, 'civil-date').textContent).not.toContain('يوم');
      expect(field(view.container, 'precision').textContent).toBe('شهر');
      expect(field(view.container, 'status').textContent).toBe('نص تاريخي');
      expect(field(view.container, 'inclusion').textContent).toBe('مُدرج لأن the source lists this place');
      expect(field(view.container, 'citation')).toHaveAttribute('data-isolate', 'citation');
      expect(field(view.container, 'citation').style.unicodeBidi).toBe('isolate');
      expect(field(view.container, 'record-id')).toHaveAttribute('data-isolate', 'record-id');
      expect(view.container.querySelector('[data-mirror]')).toHaveAttribute('data-mirror', 'inline');
      expect((view.container.querySelector('[data-mirror]') as HTMLElement).style.transform).toBe('scaleX(-1)');
      expect(view.container.innerHTML).not.toMatch(/\b(?:left|right)\s*:/);

      const search = screen.getByLabelText('البحث في القوانين والمصادر');
      expect(search).toHaveAttribute('placeholder', 'سؤال أو استشهاد أو معرّف');
      expect(search).not.toHaveAttribute('aria-label');
      expect((search as HTMLElement).style.textAlign).toBe('start');
      expect(field(view.container, 'announcement').textContent).toBe('');
      expect(field(view.container, 'announcement')).toHaveAttribute('aria-live', 'polite');
      expect(field(view.container, 'announcement')).toHaveAttribute('aria-atomic', 'true');

      await user.selectOptions(screen.getByLabelText('اللغة'), 'en');

      expect(root).toHaveAttribute('lang', 'en');
      expect(root).toHaveAttribute('dir', 'ltr');
      expect(screen.getByRole('heading', { name: 'Worldwide laws' })).toBeInTheDocument();
      expect(field(view.container, 'law-language').textContent).toBe('ja');
      expect(field(view.container, 'jurisdiction')).toHaveAttribute('data-jurisdiction', 'netherlands');
      expect(field(view.container, 'place')).toHaveAttribute('data-place', 'place:netherlands');
      expect(field(view.container, 'place-label').textContent).toBe('Amsterdam');
      expect(field(view.container, 'native-title').textContent).toBe('民法第1条');
      expect(field(view.container, 'native-title')).toHaveAttribute('lang', 'ja');
      expect(field(view.container, 'native-title')).toHaveAttribute('data-script', 'CJK');
      expect(field(view.container, 'translation-label').textContent).toBe('Machine translation');
      expect(field(view.container, 'translation-text')).toHaveAttribute('dir', 'rtl');
      expect(field(view.container, 'translation-text').textContent).toBe('نص مترجم');
      expect(field(view.container, 'civil-date').textContent).toBe('Jun 2024');
      expect(field(view.container, 'civil-date')).toHaveAttribute('data-value', '2024-06');
      expect(field(view.container, 'precision').textContent).toBe('month');
      expect(field(view.container, 'status').textContent).toBe('Historical text');
      expect(field(view.container, 'inclusion').textContent).toBe('Included because the source lists this place');
      expect(view.container.querySelector('[data-mirror]')).toHaveAttribute('data-mirror', 'none');
      expect(view.container.innerHTML.indexOf('data-field="native-title"')).toBeLessThan(view.container.innerHTML.indexOf('data-field="translation-label"'));
      expect(field(view.container, 'announcement').textContent).toBe('Language. English. Amsterdam. As of Jun 2024. This place. Coverage Partial collection.');
      expect(field(view.container, 'announcement').textContent).not.toContain('Japan');
      expect(field(view.container, 'announcement').textContent).not.toContain('Egypt');
      expect(field(view.container, 'browser-language').textContent).toBe('The browser language does not choose a jurisdiction.');
      expect(writes).toEqual([]);

      await user.selectOptions(screen.getByLabelText('Language'), 'ja');
      expect(root).toHaveAttribute('lang', 'ja');
      expect(root).toHaveAttribute('dir', 'ltr');
      expect(field(view.container, 'jurisdiction')).toHaveAttribute('data-jurisdiction', 'netherlands');
      expect(field(view.container, 'law-language').textContent).toBe('ja');
      expect(field(view.container, 'native-title')).toHaveAttribute('data-script', 'CJK');
      expect(field(view.container, 'civil-date').textContent).toBe('2024年6月');
      expect(field(view.container, 'civil-date').textContent).not.toContain('日');
      expect(field(view.container, 'translation-label').textContent).toBe('機械翻訳');
      expect(writes).toEqual([]);
    } finally {
      window.localStorage.setItem = originalSet;
    }
  });

  test('renders an Arabic title, a Hebrew title, and a Dutch title in their own direction', () => {
    const arabic = render(
      <InternationalShell
        presentation={resolvePresentation({ uiLocale: 'en', lawLanguage: 'ar', browserLanguage: null, readNavigator: false })}
        onUiLocale={() => undefined}
        title="مرسوم ABC-12 لسنة 2020"
        translation={{ kind: 'official', language: 'en', text: 'Decree ABC-12' }}
      />,
    );
    const root = arabic.container.querySelector('.wwl') as HTMLElement;
    expect(root).toHaveAttribute('dir', 'ltr');
    expect(root).toHaveAttribute('lang', 'en');
    const title = field(arabic.container, 'native-title');
    expect(title).toHaveAttribute('dir', 'rtl');
    expect(title).toHaveAttribute('lang', 'ar');
    expect(title).toHaveAttribute('data-script', 'Arab');
    expect(title.textContent).toBe('مرسوم ABC-12 لسنة 2020');
    expect(title.querySelector('[data-isolate="latin-identifier"]')?.textContent).toBe('ABC-12');
    expect(field(arabic.container, 'translation-label').textContent).toBe('Official translation');
    expect(field(arabic.container, 'jurisdiction')).toHaveAttribute('data-jurisdiction', 'none');
    arabic.unmount();

    const hebrew = render(
      <InternationalShell
        presentation={resolvePresentation({ uiLocale: 'en', lawLanguage: 'he', browserLanguage: null })}
        onUiLocale={() => undefined}
        title="חוק"
      />,
    );
    expect(field(hebrew.container, 'native-title')).toHaveAttribute('dir', 'rtl');
    expect(field(hebrew.container, 'native-title')).toHaveAttribute('data-script', 'Hebr');
    expect(hebrew.container.querySelector('.wwl')).toHaveAttribute('dir', 'ltr');
    hebrew.unmount();

    const dutch = render(
      <InternationalShell
        presentation={resolvePresentation({ uiLocale: 'ar', lawLanguage: 'nl', jurisdictionId: 'japan', browserLanguage: 'ar-EG' })}
        onUiLocale={() => undefined}
        title="Wetboek van Strafrecht"
        placeLabel="Amsterdam"
      />,
    );
    expect(dutch.container.querySelector('.wwl')).toHaveAttribute('dir', 'rtl');
    expect(field(dutch.container, 'native-title')).toHaveAttribute('lang', 'nl');
    expect(field(dutch.container, 'native-title')).toHaveAttribute('dir', 'ltr');
    expect(field(dutch.container, 'native-title')).toHaveAttribute('data-script', 'Latn');
    expect(field(dutch.container, 'native-title').textContent).toBe('Wetboek van Strafrecht');
    expect(field(dutch.container, 'jurisdiction')).toHaveAttribute('data-jurisdiction', 'japan');
    expect(field(dutch.container, 'place-label').textContent).toBe('Amsterdam');
    dutch.unmount();

    const scanned = render(
      <InternationalShell
        presentation={resolvePresentation({ uiLocale: 'en', lawLanguage: null, browserLanguage: null })}
        onUiLocale={() => undefined}
        title="قانون"
      />,
    );
    expect(field(scanned.container, 'native-title')).toHaveAttribute('dir', 'rtl');
    expect(field(scanned.container, 'native-title')).toHaveAttribute('data-script', 'Arab');
    expect(field(scanned.container, 'native-title')).not.toHaveAttribute('lang');
    expect(field(scanned.container, 'jurisdiction')).toHaveAttribute('data-jurisdiction', 'none');
    scanned.unmount();
  });
});

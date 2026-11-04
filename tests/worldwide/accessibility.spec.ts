/**
 * Keyboard, screen-reader, contrast, focus, and motion checks for the
 * mounted worldwide shell. The production entry renders that shell.
 * Screenshots are attached to the Playwright report and hashed on stdout.
 * axe-core is not a project dependency, so the audit runs in the page.
 */

import { createHash } from 'node:crypto';
import { expect, test, type Locator, type Page } from '@playwright/test';

test.use({
  locale: 'en-US',
  timezoneId: 'UTC',
  colorScheme: 'light',
  launchOptions: {
    executablePath: '/opt/google/chrome/chrome',
    args: ['--disable-dev-shm-usage'],
  },
});

const PLACE = 'place:amsterdam';
const RECORD = 'BWBR0001854';
const QUERY = 'harbor bylaw';
const LAW = `/#/law/${RECORD}?q=${encodeURIComponent(QUERY)}&place=${encodeURIComponent(PLACE)}&scope=place&date=2026-10-26`;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  await page.route(/^https:\/\/plausible\.io\//, (route) => route.abort());
  await page.route(/^https:\/\/api\.country\.is\/?/, (route) => route.abort());
});

function shell(page: Page): Locator {
  return page.locator('.wwl-shell');
}

async function openShell(page: Page, url = '/#/search') {
  await page.goto(url);
  await expect(shell(page)).toBeVisible();
  await expect(shell(page)).toHaveAttribute('lang', 'en');
  await expect(page).toHaveTitle('Worldwide laws');
  await expect(shell(page)).toHaveAttribute('data-map', 'closed');
  await expect(shell(page)).toHaveAttribute('data-model', 'idle');
}

async function blur(page: Page) {
  await page.evaluate(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
  });
}

async function focusByKeyboard(page: Page, target: Locator, key: 'Tab' | 'Shift+Tab' = 'Tab') {
  for (let step = 0; step < 40; step += 1) {
    if (await target.evaluate((node) => node === document.activeElement).catch(() => false)) return;
    await page.keyboard.press(key);
  }
  await expect(target).toBeFocused();
}

function cssDurationMs(value: string): number {
  const first = value.split(',')[0]?.trim() ?? '';
  const match = /^(-?(?:\d+|\d*\.\d+)(?:e[+-]?\d+)?)(ms|s)$/i.exec(first);
  if (!match) throw new Error(`unparsed duration ${value}`);
  const amount = Number(match[1]);
  return match[2].toLowerCase() === 'ms' ? amount : amount * 1000;
}

function pngSize(buffer: Buffer): { width: number; height: number } {
  expect(buffer.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

async function recordShot(page: Page, name: string, locator?: Locator) {
  const buffer = locator
    ? await locator.screenshot({ animations: 'disabled' })
    : await page.screenshot({ fullPage: true, animations: 'disabled' });
  const size = pngSize(buffer);
  const sha256 = createHash('sha256').update(buffer).digest('hex');
  expect(buffer.byteLength).toBeGreaterThan(2000);
  expect(size.width).toBeGreaterThan(40);
  expect(size.height).toBeGreaterThan(40);
  await test.info().attach(`${name}.png`, { body: buffer, contentType: 'image/png' });
  const shot = { name, sha256, bytes: buffer.byteLength, width: size.width, height: size.height };
  console.log(`WWL056_SHOT ${JSON.stringify(shot)}`);
  return shot;
}

test('keyboard search, place, scope, and filters never need a pointer', async ({ page }) => {
  await openShell(page);
  const search = page.getByRole('searchbox', { name: 'Search laws and sources' });
  await expect(search).toBeFocused();
  await expect(shell(page)).toHaveAttribute('data-state', 'first-visit');
  await expect(page.locator('.wwl-live')).toHaveText(
    'Worldwide laws. No place is selected. Choose a place or search worldwide.',
  );

  const skipSearch = page.getByRole('link', { name: 'Skip to search', exact: true });
  const skipBefore = await skipSearch.evaluate((el) => getComputedStyle(el).transform);
  expect(skipBefore).not.toBe('none');
  // First visit focuses the search field. Blur keeps Chrome's sequential start
  // there, so Tab moves to the next control. Shift+Tab walks back to the skip link.
  await focusByKeyboard(page, skipSearch, 'Shift+Tab');
  await expect(skipSearch).toBeFocused();
  await expect(skipSearch).toBeVisible();
  expect(await skipSearch.evaluate((el) => getComputedStyle(el).transform)).toBe('none');
  expect(await skipSearch.evaluate((el) => (el as HTMLElement).matches(':focus-visible'))).toBe(true);
  await page.keyboard.press('Enter');
  await expect(search).toBeFocused();

  await page.keyboard.type(QUERY);
  await page.keyboard.press('Enter');
  await expect(search).toHaveValue(QUERY);
  await expect(page.locator('.wwl-live')).toHaveText('This collection was not searched. Searched 0. Remaining 0.');
  await expect(page.getByRole('main')).toContainText('This collection was not searched.');
  await expect(page.getByRole('main').getByRole('list', { name: 'Results' }).locator('li')).toHaveCount(0);

  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Enter');
  await expect(shell(page)).toHaveAttribute('data-state', 'no-query');
  await expect(page.locator('.wwl-live')).toHaveText('The query is empty. An empty search is not a result about the law.');
  await expect(page.getByRole('main')).toContainText('An empty search is not a result about the law.');

  const combo = page.getByRole('combobox', { name: 'Choose a place' });
  await focusByKeyboard(page, combo, 'Shift+Tab');
  await page.keyboard.type(PLACE);
  await expect(page.getByRole('listbox', { name: 'Places' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('listbox', { name: 'Places' })).toHaveCount(0);
  await expect(page.locator('.wwl-place')).toHaveText('unselected worldwide');

  await page.keyboard.type(PLACE);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.locator('.wwl-place')).toHaveText(PLACE);
  await expect(page.locator('.wwl-place-origin')).toHaveText('manually selected');
  await expect(shell(page)).toHaveAttribute('data-state', 'changed-manual-location');
  await expect(shell(page)).toHaveAttribute('data-scope', 'place');
  await expect(page.getByRole('radio', { name: 'This place' })).toBeChecked();
  await expect(page.locator('.wwl-live')).toContainText(PLACE);
  await expect(page.locator('.wwl-live')).toContainText('manually selected');

  const worldwide = page.getByRole('radio', { name: 'Search worldwide' });
  await focusByKeyboard(page, page.getByRole('radio', { name: 'This place' }));
  await page.keyboard.press('ArrowDown');
  await expect(worldwide).toBeChecked();
  await expect(shell(page)).toHaveAttribute('data-scope', 'worldwide');
  await expect(page.locator('.wwl-place')).toHaveText(PLACE);
  await expect(page.locator('.wwl-live')).toContainText('Search worldwide');
  await page.keyboard.press('ArrowUp');
  await expect(page.getByRole('radio', { name: 'This place' })).toBeChecked();

  const filters = page.getByRole('button', { name: 'Filters', exact: true });
  await focusByKeyboard(page, filters);
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Filters' });
  await expect(dialog).toBeVisible();
  const heading = page.getByRole('heading', { name: 'Filters', exact: true });
  await expect(heading).toBeFocused();
  const level = dialog.getByRole('combobox', { name: 'Jurisdiction level' });
  const close = dialog.getByRole('button', { name: 'Close filters', exact: true });
  await page.keyboard.press('Tab');
  await expect(level).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(level).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(level).toHaveValue('national');
  await expect(page.locator('.wwl-live')).toHaveText('Searched 0. Remaining 0.');
  await expect(page.getByLabel('Language', { exact: true })).toHaveValue('en');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(filters).toBeFocused();

  await focusByKeyboard(page, search, 'Shift+Tab');
  expect(await search.evaluate((el) => (el as HTMLElement).matches(':focus-visible'))).toBe(true);
  await recordShot(page, 'keyboard-focus-search', search);
});

test('the law route stays on the keyboard and announces the linked scope', async ({ page }) => {
  await openShell(page, LAW);
  await expect(page.getByRole('heading', { level: 2, name: 'Law', exact: true })).toBeVisible();
  await expect(page.getByRole('main')).toContainText(RECORD);
  await expect(page.getByRole('searchbox', { name: 'Search laws and sources' })).toHaveValue(QUERY);
  await expect(page.getByLabel('As of')).toHaveValue('2026-10-26');
  await expect(page.locator('.wwl-place')).toHaveText(PLACE);
  await expect(page.locator('.wwl-place-origin')).toHaveText('shared URL');
  await expect(shell(page)).toHaveAttribute('data-state', 'screen-reader-scope-change');
  await expect(shell(page)).toHaveAttribute('data-reader', 'closed');
  await expect(shell(page)).toHaveAttribute('data-scope', 'place');
  await expect(page).toHaveURL(new RegExp(`/law/${RECORD}`));
  await expect(page.getByRole('link', { name: 'Law', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.wwl-live')).toContainText(PLACE);
  await expect(page.locator('.wwl-live')).toContainText('shared URL');
  await expect(page.locator('.wwl-live')).toContainText('2026-10-26');
  await expect(page.locator('.wwl-live')).toContainText('This place');
  await expect(page.getByRole('main')).toContainText('This collection was not searched.');
  await expect(page.getByText('This choice does not decide that a law applies.')).toBeVisible();

  await blur(page);
  await focusByKeyboard(page, page.getByRole('link', { name: 'Skip to results', exact: true }));
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 2, name: 'Law', exact: true })).toBeFocused();

  const date = page.getByLabel('As of');
  await focusByKeyboard(page, date, 'Shift+Tab');
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  await page.keyboard.type('2026-11-04');
  await page.keyboard.press('Tab');
  await expect(date).toHaveValue('2026-11-04');
  await expect(page.locator('.wwl-live')).toContainText('2026-11-04');
  await expect(page.locator('.wwl-live')).toContainText(PLACE);
  await expect(page.getByRole('main')).toContainText(RECORD);

  const next = page.getByRole('button', { name: 'Review the announced place, date, and coverage, then search or change place.' });
  await focusByKeyboard(page, next);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('combobox', { name: 'Choose a place' })).toBeFocused();

  const searchLink = page.getByRole('link', { name: 'Search', exact: true });
  await focusByKeyboard(page, searchLink);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 2, name: 'Results', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Search', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('main')).not.toContainText(RECORD);
  await expect(page.getByRole('searchbox')).toHaveValue(QUERY);
  await expect(page.locator('.wwl-place')).toHaveText(PLACE);
  await expect(page).not.toHaveURL(/\/law\//);
  await recordShot(page, 'law-route-return', shell(page));
});

function readAudit() {
  const PAPER = [247, 244, 239];
  const INK = [23, 32, 38];
  const SURFACE = [255, 253, 248];
  const ACCENT = [11, 58, 91];
  const ON_ACCENT = [255, 255, 255];
  const SECONDARY = [62, 74, 82];
  const UNKNOWN_TEXT = [30, 51, 72];
  const UNKNOWN_SURFACE = [231, 238, 243];

  function channel(value: number): number {
    const scaled = value / 255;
    return scaled <= 0.04045 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  }

  function parse(color: string): { rgb: number[]; alpha: number } | null {
    const match = color.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)/);
    if (!match) return null;
    const alphaRaw = match[4];
    const alpha = alphaRaw === undefined ? 1 : alphaRaw.endsWith('%') ? Number(alphaRaw.slice(0, -1)) / 100 : Number(alphaRaw);
    return { rgb: [Number(match[1]), Number(match[2]), Number(match[3])], alpha };
  }

  function composite(front: { rgb: number[]; alpha: number }, back: number[]): number[] {
    const alpha = front.alpha;
    return [0, 1, 2].map((index) => Math.round(front.rgb[index] * alpha + back[index] * (1 - alpha)));
  }

  function backgroundOf(element: Element): number[] {
    const layers: Array<{ rgb: number[]; alpha: number }> = [];
    let node: Element | null = element;
    while (node) {
      const parsed = parse(getComputedStyle(node).backgroundColor);
      if (parsed && parsed.alpha > 0) layers.push(parsed);
      if (parsed && parsed.alpha >= 0.999) break;
      node = node.parentElement;
    }
    let painted = [255, 255, 255];
    for (let index = layers.length - 1; index >= 0; index -= 1) painted = composite(layers[index], painted);
    return painted;
  }

  function ratio(fore: number[], back: number[]): number {
    const first = 0.2126 * channel(fore[0]) + 0.7152 * channel(fore[1]) + 0.0722 * channel(fore[2]);
    const second = 0.2126 * channel(back[0]) + 0.7152 * channel(back[1]) + 0.0722 * channel(back[2]);
    const lighter = Math.max(first, second);
    const darker = Math.min(first, second);
    return Math.round(((lighter + 0.05) / (darker + 0.05)) * 100) / 100;
  }

  function same(actual: number[], expected: number[]): boolean {
    return actual.length === 3 && actual.every((value, index) => Math.abs(value - expected[index]) <= 1);
  }

  function visible(element: Element): boolean {
    if (!(element instanceof HTMLElement)) return false;
    if (element.closest('[hidden]')) return false;
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const rect = element.getBoundingClientRect();
    return rect.width >= 1 && rect.height >= 1;
  }

  const root = document.querySelector('.wwl-shell');
  const violations: string[] = [];
  if (!(root instanceof HTMLElement)) {
    return { violations: ['missing shell'], samples: [], scan: [], focus: null, live: null, overflow: null, fonts: '' };
  }

  const samples: Array<{ name: string; fg: number[]; bg: number[]; ratio: number }> = [];
  function sample(name: string, element: Element | null, minimum: number, expectedFg?: number[], expectedBg?: number[]) {
    if (!(element instanceof HTMLElement)) {
      violations.push(`${name} missing`);
      return;
    }
    const parsed = parse(getComputedStyle(element).color);
    if (!parsed) {
      violations.push(`${name} unparsed foreground`);
      return;
    }
    const fg = parsed.alpha >= 0.999 ? parsed.rgb : composite(parsed, backgroundOf(element));
    const bg = backgroundOf(element);
    const value = ratio(fg, bg);
    samples.push({ name, fg, bg, ratio: value });
    if (value < minimum) violations.push(`${name} contrast ${value} < ${minimum}`);
    if (expectedFg && !same(fg, expectedFg)) violations.push(`${name} foreground ${fg.join(',')} != ${expectedFg.join(',')}`);
    if (expectedBg && !same(bg, expectedBg)) violations.push(`${name} background ${bg.join(',')} != ${expectedBg.join(',')}`);
  }

  sample('product', root.querySelector('.wwl-product'), 4.5, INK, PAPER);
  sample('origin', root.querySelector('.wwl-place-origin'), 4.5, SECONDARY, PAPER);
  sample('search field', root.querySelector('.wwl-search-input'), 4.5, INK, SURFACE);
  sample('search button', root.querySelector('.wwl-search button[type="submit"]'), 4.5, ON_ACCENT, ACCENT);
  sample('applicability', root.querySelector('.wwl-applicability'), 4.5, SECONDARY, PAPER);
  sample('coverage', root.querySelector('.wwl-coverage'), 4.5, UNKNOWN_TEXT, UNKNOWN_SURFACE);
  sample('checked scope', root.querySelector('.wwl-scope input:checked + span'), 4.5, ON_ACCENT, ACCENT);

  const search = root.querySelector('.wwl-search-input');
  if (search instanceof HTMLElement) {
    const placeholder = parse(getComputedStyle(search, '::placeholder').color);
    const field = backgroundOf(search);
    if (!placeholder) violations.push('placeholder unparsed');
    else {
      const value = ratio(placeholder.rgb, field);
      samples.push({ name: 'placeholder', fg: placeholder.rgb, bg: field, ratio: value });
      if (value < 4.5) violations.push(`placeholder contrast ${value} < 4.5`);
    }
    const border = parse(getComputedStyle(search).borderTopColor);
    const outside = backgroundOf(search.parentElement ?? root);
    if (!border) violations.push('search border unparsed');
    else {
      const value = ratio(border.rgb, outside);
      samples.push({ name: 'search border', fg: border.rgb, bg: outside, ratio: value });
      if (value < 3) violations.push(`search border contrast ${value} < 3`);
    }
  }

  const scan: Array<{ name: string; ratio: number }> = [];
  for (const element of root.querySelectorAll('p, h1, h2, h3, a, button, label, span, li')) {
    if (!visible(element) || !(element instanceof HTMLElement)) continue;
    let own = '';
    for (const node of element.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) own += node.textContent ?? '';
    }
    const text = own.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const parsed = parse(getComputedStyle(element).color);
    if (!parsed) continue;
    const fg = parsed.alpha >= 0.999 ? parsed.rgb : composite(parsed, backgroundOf(element));
    const value = ratio(fg, backgroundOf(element));
    if (value < 4.5) {
      scan.push({ name: `${element.tagName}.${element.className}`.slice(0, 80), ratio: value });
      violations.push(`text contrast ${value} on ${element.tagName}.${element.className}`.replace(/\s+/g, ' ').slice(0, 160));
    }
  }

  const active = document.activeElement;
  const focus = active instanceof HTMLElement
    ? {
      visible: active.matches(':focus-visible'),
      width: getComputedStyle(active).outlineWidth,
      style: getComputedStyle(active).outlineStyle,
      color: getComputedStyle(active).outlineColor,
      offset: getComputedStyle(active).outlineOffset,
      shadow: getComputedStyle(active).boxShadow,
    }
    : null;
  if (!focus?.visible) violations.push('keyboard focus is not :focus-visible');
  if (focus && (focus.width !== '3px' || focus.style !== 'solid')) violations.push(`focus ring ${focus.style} ${focus.width}`);
  const focusColor = focus ? parse(focus.color) : null;
  if (!focusColor || ratio(focusColor.rgb, PAPER) < 3) violations.push('focus ring contrast below 3');

  const liveEl = root.querySelector('.wwl-live');
  const liveStyle = liveEl instanceof HTMLElement ? getComputedStyle(liveEl) : null;
  const live = liveEl instanceof HTMLElement && liveStyle
    ? {
      text: liveEl.textContent ?? '',
      live: liveEl.getAttribute('aria-live'),
      atomic: liveEl.getAttribute('aria-atomic'),
      hidden: liveEl.getAttribute('aria-hidden'),
      display: liveStyle.display,
      visibility: liveStyle.visibility,
    }
    : null;
  if (!live) violations.push('missing live region');
  if (live && (live.live !== 'polite' || live.atomic !== 'true' || live.hidden === 'true')) violations.push('live region is not a polite atomic status');
  if (live && (live.display === 'none' || live.visibility === 'hidden' || !live.text.trim())) violations.push('live region is empty or removed from the accessibility tree');

  const width = document.documentElement.clientWidth;
  const offenders: string[] = [];
  for (const element of root.querySelectorAll('.wwl, .wwl *')) {
    if (!(element instanceof HTMLElement) || !visible(element)) continue;
    const rect = element.getBoundingClientRect();
    if (rect.right > width + 1 || rect.left < -1) {
      offenders.push(`${element.tagName}.${String(element.className)} ${rect.left.toFixed(0)}..${rect.right.toFixed(0)}`);
    }
  }
  if (document.documentElement.scrollWidth > width + 1) violations.push(`horizontal scroll ${document.documentElement.scrollWidth} > ${width}`);
  for (const offender of offenders.slice(0, 8)) violations.push(`overflow ${offender}`);

  const fonts = getComputedStyle(root).fontFamily;
  if (/upheaval|vcr/i.test(fonts)) violations.push('game font on the shell');
  if (getComputedStyle(root).colorScheme !== 'light') violations.push(`color scheme ${getComputedStyle(root).colorScheme}`);

  const ids = [...root.querySelectorAll('[id]')].map((element) => element.id);
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) violations.push(`duplicate id ${id}`);
    seen.add(id);
  }
  for (const element of root.querySelectorAll('[tabindex]')) {
    const value = Number(element.getAttribute('tabindex'));
    if (value > 0) violations.push(`positive tabindex on ${element.tagName}`);
  }

  const levels: number[] = [];
  for (const heading of root.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
    if (!visible(heading)) continue;
    levels.push(Number(heading.tagName.slice(1)));
  }
  if (levels[0] !== 1) violations.push(`first heading is h${levels[0] ?? 'none'}`);
  for (let index = 1; index < levels.length; index += 1) {
    if (levels[index] > levels[index - 1] + 1) violations.push(`heading jump h${levels[index - 1]} to h${levels[index]}`);
  }

  for (const element of root.querySelectorAll('button, a, input, select, textarea')) {
    if (!(element instanceof HTMLElement) || !visible(element)) continue;
    const labelled = element.getAttribute('aria-label')
      || element.getAttribute('aria-labelledby')
      || (element.id && document.querySelector(`label[for="${CSS.escape(element.id)}"]`))
      || element.closest('label')
      || element.textContent?.trim();
    if (!labelled) violations.push(`unnamed ${element.tagName}.${String(element.className)}`);
  }

  return {
    violations: violations.slice(0, 40),
    samples,
    scan: scan.slice(0, 12),
    focus,
    live,
    overflow: { scrollWidth: document.documentElement.scrollWidth, clientWidth: width, offenders: offenders.slice(0, 8) },
    fonts,
    headings: levels,
  };
}

test('text, focus, names, and target size meet the shell contract', async ({ page }) => {
  await openShell(page);
  const search = page.getByRole('searchbox', { name: 'Search laws and sources' });
  await blur(page);
  await focusByKeyboard(page, search);
  await expect(search).toBeFocused();

  await expect(page.getByRole('banner')).toHaveCount(1);
  await expect(page.getByRole('main')).toHaveCount(1);
  await expect(page.getByRole('search')).toHaveCount(1);
  await expect(page.getByRole('complementary', { name: 'Laws and sources for this place' })).toHaveCount(1);
  await expect(page.getByRole('status')).toHaveCount(1);
  await expect(page.getByRole('radiogroup', { name: 'Scope' })).toBeVisible();

  const audit = await page.evaluate(readAudit);
  console.log(`WWL056_AUDIT ${JSON.stringify({ violations: audit.violations, samples: audit.samples, focus: audit.focus })}`);
  await test.info().attach('audit-desktop.json', {
    body: Buffer.from(JSON.stringify(audit, null, 2)),
    contentType: 'application/json',
  });
  expect(audit.violations).toEqual([]);
  await recordShot(page, 'contrast-focus', shell(page));

  const targets = [
    page.getByRole('button', { name: 'Search laws and sources' }),
    page.getByRole('button', { name: 'Change place', exact: true }),
    page.getByRole('button', { name: 'Filters', exact: true }),
    page.getByRole('button', { name: 'Save place', exact: true }),
    page.getByLabel('As of'),
    page.getByLabel('Language', { exact: true }),
    page.getByLabel('Choose a place'),
    page.getByRole('link', { name: 'Search', exact: true }),
  ];
  for (const target of targets) {
    const box = await target.boundingBox();
    expect(box, await target.evaluate((el) => el.tagName + (el.textContent ?? ''))).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.width).toBeGreaterThanOrEqual(44);
  }
});

test.describe('320 CSS pixels', () => {
  test.use({ viewport: { width: 320, height: 640 }, hasTouch: true });

  test('a keyboard can search and open the filter sheet without horizontal scrolling', async ({ page }) => {
    await openShell(page);
    const audit = await page.evaluate(() => {
      const width = document.documentElement.clientWidth;
      const offenders: string[] = [];
      const root = document.querySelector('.wwl-shell');
      if (!root) return { scrollWidth: 0, clientWidth: width, offenders: ['missing shell'], targets: [] as Array<{ name: string; height: number }> };
      for (const element of root.querySelectorAll('button, input, select, a')) {
        if (!(element instanceof HTMLElement)) continue;
        if (element.closest('[hidden]')) continue;
        const style = getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden') continue;
        const rect = element.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1) continue;
        if (rect.left < -1 || rect.right > width + 1) offenders.push(`${element.tagName} ${rect.left.toFixed(0)}..${rect.right.toFixed(0)}`);
        if (!element.classList.contains('wwl-skip') && element.closest('.wwl-skip')) continue;
      }
      return {
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: width,
        offenders,
      };
    });
    expect(audit.scrollWidth).toBeLessThanOrEqual(audit.clientWidth + 1);
    expect(audit.offenders).toEqual([]);

    const search = page.getByRole('searchbox', { name: 'Search laws and sources' });
    await expect(search).toBeFocused();
    await page.keyboard.type('parking');
    await page.keyboard.press('Enter');
    await expect(page.locator('.wwl-live')).toContainText('This collection was not searched.');

    const filters = page.getByRole('button', { name: 'Filters', exact: true });
    await filters.scrollIntoViewIfNeeded();
    const filtersBox = await filters.boundingBox();
    expect(filtersBox).not.toBeNull();
    expect(filtersBox!.height).toBeGreaterThanOrEqual(44);
    expect(filtersBox!.width).toBeGreaterThanOrEqual(44);
    expect(filtersBox!.x).toBeGreaterThanOrEqual(0);
    expect(filtersBox!.x + filtersBox!.width).toBeLessThanOrEqual(321);
    await focusByKeyboard(page, filters);
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Filters' });
    await expect(dialog).toBeVisible();
    const sheet = await dialog.evaluate((el) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return { position: style.position, width: rect.width, right: rect.right, left: rect.left };
    });
    expect(sheet.position).toBe('fixed');
    expect(sheet.left).toBeGreaterThanOrEqual(-1);
    expect(sheet.right).toBeLessThanOrEqual(321);
    expect(sheet.width).toBeGreaterThan(280);
    await expect(page.getByRole('heading', { name: 'Filters', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(filters).toBeFocused();
    await recordShot(page, 'mobile-320-keyboard', shell(page));
  });
});

test('reduced motion, higher contrast, and a dark scheme keep the paper surface', async ({ page }) => {
  await openShell(page);
  const before = await page.evaluate(() => ({
    scroll: getComputedStyle(document.documentElement).scrollBehavior,
    transition: getComputedStyle(document.querySelector('.wwl-shell') as Element).transitionDuration,
    animation: getComputedStyle(document.querySelector('.wwl-shell') as Element).animationDuration,
  }));
  expect(before.scroll).toBe('smooth');
  expect(before.transition).toBe('0s');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  const reduced = await page.evaluate(() => ({
    scroll: getComputedStyle(document.documentElement).scrollBehavior,
    transition: getComputedStyle(document.querySelector('.wwl-shell') as Element).transitionDuration,
    animation: getComputedStyle(document.querySelector('.wwl-shell') as Element).animationDuration,
    text: getComputedStyle(document.querySelector('.wwl-shell') as Element).getPropertyValue('--wwl-color-text').trim(),
  }));
  expect(reduced.scroll).toBe('auto');
  expect(cssDurationMs(reduced.transition)).toBeCloseTo(0.01, 4);
  expect(cssDurationMs(reduced.animation)).toBeCloseTo(0.01, 4);
  expect(reduced.text).toBe('#172026');
  await recordShot(page, 'reduced-motion', shell(page));

  await page.emulateMedia({ reducedMotion: 'reduce', contrast: 'more' });
  const more = await page.evaluate(() => {
    const root = document.querySelector('.wwl-shell') as HTMLElement;
    const style = getComputedStyle(root);
    const origin = document.querySelector('.wwl-place-origin') as HTMLElement;
    const product = document.querySelector('.wwl-product') as HTMLElement;
    return {
      textToken: style.getPropertyValue('--wwl-color-text').trim(),
      backgroundToken: style.getPropertyValue('--wwl-color-background').trim(),
      secondaryToken: style.getPropertyValue('--wwl-color-secondary').trim(),
      color: style.color,
      background: style.backgroundColor,
      border: style.getPropertyValue('--wwl-color-border').trim(),
      origin: getComputedStyle(origin).color,
      product: getComputedStyle(product).color,
    };
  });
  console.log(`WWL056_CONTRAST ${JSON.stringify(more)}`);
  expect(more.textToken).toBe('#0b1216');
  expect(more.backgroundToken).toBe('#ffffff');
  expect(more.secondaryToken).toBe('#0b1216');
  expect(more.border).toBe('#0b1216');
  // The contrast query updates the tokens. The shell's used color and
  // background stay the paper pair in this browser.
  expect(more.background).toBe('rgb(247, 244, 239)');
  expect(more.color).toBe('rgb(23, 32, 38)');
  expect(more.origin).toBe('rgb(62, 74, 82)');
  expect(more.product).toBe('rgb(23, 32, 38)');
  await recordShot(page, 'more-contrast', shell(page));

  await page.emulateMedia({ colorScheme: 'dark', contrast: 'no-preference', reducedMotion: 'no-preference' });
  await expect(shell(page)).toHaveCSS('background-color', 'rgb(247, 244, 239)');
  await expect(shell(page)).toHaveCSS('color', 'rgb(23, 32, 38)');
  await recordShot(page, 'dark-scheme-paper', shell(page));

  await page.emulateMedia({ forcedColors: 'active' });
  const forced = await page.evaluate(() => {
    const root = document.querySelector('.wwl-shell') as HTMLElement;
    const button = root.querySelector('button') as HTMLElement;
    return {
      matches: window.matchMedia('(forced-colors: active)').matches,
      scheme: getComputedStyle(root).colorScheme,
      buttonBorder: getComputedStyle(button).borderTopColor,
      background: getComputedStyle(root).backgroundColor,
    };
  });
  expect(forced.matches).toBe(true);
  console.log(`WWL056_FORCED ${JSON.stringify(forced)}`);
  await recordShot(page, 'forced-colors', shell(page));
});

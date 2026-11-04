/**
 * Viewport, zoom, reflow, and writing-direction screenshots for the
 * mounted worldwide shell and its law route. Pixel baselines are not
 * stored. Each shot is attached and hashed on stdout.
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
}

function pngSize(buffer: Buffer): { width: number; height: number } {
  expect(buffer.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

async function recordShot(page: Page, name: string) {
  const viewport = page.viewportSize();
  const buffer = await page.screenshot({ fullPage: true, animations: 'disabled' });
  const size = pngSize(buffer);
  const sha256 = createHash('sha256').update(buffer).digest('hex');
  expect(buffer.byteLength).toBeGreaterThan(8000);
  expect(size.height).toBeGreaterThan(200);
  if (viewport) expect(Math.abs(size.width - viewport.width)).toBeLessThanOrEqual(16);
  await test.info().attach(`${name}.png`, { body: buffer, contentType: 'image/png' });
  const shot = { name, sha256, bytes: buffer.byteLength, width: size.width, height: size.height };
  console.log(`WWL056_SHOT ${JSON.stringify(shot)}`);
  return shot;
}

async function openFilters(page: Page) {
  const filters = page.getByRole('button', { name: 'Filters', exact: true });
  const hit = await filters.evaluate((el) => {
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    const rect = el.getBoundingClientRect();
    const x = Math.min(window.innerWidth - 1, Math.max(0, rect.left + rect.width / 2));
    const y = Math.min(window.innerHeight - 1, Math.max(0, rect.top + rect.height / 2));
    const top = document.elementFromPoint(x, y);
    const header = document.querySelector('.wwl-sticky');
    const covered = top !== el && !(top instanceof Node && el.contains(top));
    return {
      covered,
      hit: top instanceof Element ? `${top.tagName}.${String(top.className).slice(0, 80)}` : '',
      headerHeight: header?.getBoundingClientRect().height ?? 0,
      viewportHeight: window.innerHeight,
    };
  });
  console.log(`WWL056_POINTER ${JSON.stringify(hit)}`);
  if (hit.covered) {
    await filters.focus();
    await page.keyboard.press('Enter');
  } else {
    await filters.tap();
  }
}

async function expectNoHorizontalOverflow(page: Page) {
  const report = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const offenders: string[] = [];
    const root = document.querySelector('.wwl-shell');
    if (!root) return { scrollWidth: 0, clientWidth: width, offenders: ['missing shell'] };
    for (const element of root.querySelectorAll('*')) {
      if (!(element instanceof HTMLElement)) continue;
      if (element.closest('[hidden]')) continue;
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      const rect = element.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) continue;
      if (rect.left < -1 || rect.right > width + 1) {
        const label = (element.getAttribute('aria-label') || element.innerText || element.tagName).replace(/\s+/g, ' ').slice(0, 60);
        offenders.push(`${element.tagName}.${String(element.className)} ${rect.left.toFixed(0)}..${rect.right.toFixed(0)} ${label}`);
      }
    }
    return {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: width,
      offenders: offenders.slice(0, 10),
    };
  });
  expect(report.scrollWidth).toBeLessThanOrEqual(report.clientWidth + 1);
  expect(report.offenders).toEqual([]);
}

async function columnLayout(page: Page): Promise<{ stacked: boolean; sideBySide: boolean }> {
  return page.evaluate(() => {
    const stack = document.querySelector('.wwl-stack');
    const results = document.querySelector('.wwl-results');
    if (!(stack instanceof HTMLElement) || !(results instanceof HTMLElement)) return { stacked: false, sideBySide: false };
    const stackBox = stack.getBoundingClientRect();
    const resultsBox = results.getBoundingClientRect();
    const stacked = resultsBox.top >= stackBox.bottom - 2 && Math.abs(stackBox.left - resultsBox.left) < 8;
    const overlapY = Math.min(stackBox.bottom, resultsBox.bottom) - Math.max(stackBox.top, resultsBox.top);
    const separatedX = resultsBox.left >= stackBox.right - 2 || stackBox.left >= resultsBox.right - 2;
    const sideBySide = overlapY > 24 && separatedX;
    return { stacked, sideBySide };
  });
}

test.describe('desktop', () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  test('records search and the law route on a wide screen', async ({ page }) => {
    await openShell(page);
    await expect(shell(page)).toHaveAttribute('dir', 'ltr');
    await expect(page.locator('.wwl-search-input')).toHaveCSS('font-size', '20px');
    await expect(page.locator('.wwl-sticky')).toHaveCSS('position', 'sticky');
    expect(await columnLayout(page)).toMatchObject({ sideBySide: true, stacked: false });
    await expectNoHorizontalOverflow(page);
    await expect(page.locator('.wwl-map')).toHaveCount(0);
    await expect(page.locator('.wwl-model')).toHaveCount(0);
    await recordShot(page, 'desktop-search');

    await page.goto(LAW);
    await expect(page.getByRole('heading', { level: 2, name: 'Law', exact: true })).toBeVisible();
    await expect(page.getByRole('main')).toContainText(RECORD);
    await expect(shell(page)).toHaveAttribute('data-reader', 'closed');
    await expect(page.locator('.wwl-place')).toHaveText(PLACE);
    await expectNoHorizontalOverflow(page);
    expect(await columnLayout(page)).toMatchObject({ sideBySide: true });
    await recordShot(page, 'desktop-law');
  });
});

test.describe('mobile reflow', () => {
  test.use({ viewport: { width: 320, height: 640 }, hasTouch: true });

  test('reflows at 320 CSS pixels and records the filter sheet', async ({ page }) => {
    await openShell(page, `/#/search?q=${encodeURIComponent(QUERY)}&place=${encodeURIComponent(PLACE)}&scope=place`);
    await expect(page.locator('.wwl-search-input')).toHaveCSS('font-size', '18px');
    await expect(page.locator('.wwl-sticky')).toHaveCSS('position', 'sticky');
    expect(await columnLayout(page)).toMatchObject({ stacked: true, sideBySide: false });
    await expectNoHorizontalOverflow(page);

    const change = page.getByRole('button', { name: 'Change place', exact: true });
    await change.scrollIntoViewIfNeeded();
    const changeBox = await change.boundingBox();
    expect(changeBox).not.toBeNull();
    expect(changeBox!.height).toBeGreaterThanOrEqual(44);
    expect(changeBox!.x + changeBox!.width).toBeLessThanOrEqual(321);
    const searchBox = await page.getByRole('searchbox').boundingBox();
    expect(searchBox).not.toBeNull();
    expect(searchBox!.height).toBeGreaterThanOrEqual(44);
    expect(searchBox!.width).toBeGreaterThanOrEqual(44);
    await recordShot(page, 'mobile-320-search');

    const filters = page.getByRole('button', { name: 'Filters', exact: true });
    await openFilters(page);
    const dialog = page.getByRole('dialog', { name: 'Filters' });
    await expect(dialog).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Filters', exact: true })).toBeFocused();
    const sheet = await dialog.evaluate((el) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return { position: style.position, left: rect.left, right: rect.right, width: rect.width };
    });
    expect(sheet.position).toBe('fixed');
    expect(sheet.left).toBeGreaterThanOrEqual(-1);
    expect(sheet.right).toBeLessThanOrEqual(321);
    await expectNoHorizontalOverflow(page);
    await recordShot(page, 'mobile-320-filters');
    await page.keyboard.press('Escape');
    await expect(filters).toBeFocused();

    await page.setViewportSize({ width: 390, height: 844 });
    await expectNoHorizontalOverflow(page);
    expect(await columnLayout(page)).toMatchObject({ stacked: true, sideBySide: false });
    await recordShot(page, 'mobile-390-search');
  });
});

test('records 200 percent text and a short viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openShell(page, `/#/search?q=${encodeURIComponent(QUERY)}&place=${encodeURIComponent(PLACE)}&scope=place`);
  expect(await columnLayout(page)).toMatchObject({ sideBySide: true });

  await page.evaluate(() => {
    document.documentElement.style.fontSize = '32px';
  });
  // Media-query rem uses the 16px initial font, so 1440px stays the wide layout.
  // Element rem uses the 32px root, so 1.25rem search text is 40px.
  await expect(page.locator('.wwl-search-input')).toHaveCSS('font-size', '40px');
  const buttonHeight = await page.getByRole('button', { name: 'Change place', exact: true }).evaluate((el) => el.getBoundingClientRect().height);
  expect(buttonHeight).toBeGreaterThanOrEqual(88);
  const searchHeight = await page.getByRole('searchbox').evaluate((el) => el.getBoundingClientRect().height);
  expect(searchHeight).toBeGreaterThanOrEqual(112);
  expect(await columnLayout(page)).toMatchObject({ sideBySide: true, stacked: false });
  await expect(page.getByRole('searchbox')).toHaveValue(QUERY);
  await expect(page.locator('.wwl-place')).toHaveText(PLACE);
  await expect(page.getByRole('button', { name: 'Filters', exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await recordShot(page, 'zoom-200-search');

  await page.setViewportSize({ width: 640, height: 800 });
  await expect(page.locator('.wwl-search-input')).toHaveCSS('font-size', '36px');
  const narrowSearchHeight = await page.getByRole('searchbox').evaluate((el) => el.getBoundingClientRect().height);
  expect(narrowSearchHeight).toBeGreaterThanOrEqual(104);
  expect(await columnLayout(page)).toMatchObject({ stacked: true, sideBySide: false });
  await expectNoHorizontalOverflow(page);
  await recordShot(page, 'zoom-200-640');

  await page.evaluate(() => {
    document.documentElement.style.fontSize = '';
  });
  await page.setViewportSize({ width: 1280, height: 400 });
  await expect(page.locator('.wwl-sticky')).toHaveCSS('position', 'static');
  await expect(page.locator('.wwl-search-input')).toHaveCSS('font-size', '20px');
  expect(await columnLayout(page)).toMatchObject({ sideBySide: true });
  await expect(page.getByLabel('As of')).toBeVisible();
  await expect(page.getByLabel('Language', { exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await recordShot(page, 'short-viewport');
});

test('records Arabic right-to-left and Japanese layout', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openShell(page, LAW);

  await page.getByLabel('Language', { exact: true }).selectOption('ar');
  await expect(shell(page)).toHaveAttribute('dir', 'rtl');
  await expect(shell(page)).toHaveAttribute('lang', 'ar');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  await expect(page.locator('.wwl-product')).toHaveText('قوانين العالم');
  await expect(page.getByRole('heading', { level: 2, name: 'قانون', exact: true })).toBeVisible();
  await expect(page.locator('.wwl-place')).toHaveText(PLACE);
  await expect(page.getByRole('main')).toContainText(RECORD);
  await expect(page.getByLabel('اعتبارًا من')).toHaveValue('2026-10-26');
  await expect(page.locator('.wwl-live')).toContainText('العربية');
  await expect(page.locator('.wwl-live')).toContainText(PLACE);

  const skip = page.getByRole('link', { name: 'انتقال إلى البحث', exact: true });
  await skip.focus();
  const edges = await skip.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const frame = document.documentElement.getBoundingClientRect();
    return {
      rightGap: frame.right - rect.right,
      leftGap: rect.left - frame.left,
      transform: getComputedStyle(el).transform,
    };
  });
  expect(edges.transform).toBe('none');
  expect(edges.rightGap).toBeLessThan(24);
  expect(edges.leftGap).toBeGreaterThan(edges.rightGap);
  expect(await columnLayout(page)).toMatchObject({ sideBySide: true });
  await expectNoHorizontalOverflow(page);
  await recordShot(page, 'rtl-arabic-desktop');

  await page.setViewportSize({ width: 320, height: 640 });
  await expect(shell(page)).toHaveAttribute('dir', 'rtl');
  expect(await columnLayout(page)).toMatchObject({ stacked: true, sideBySide: false });
  const search = page.getByRole('searchbox', { name: 'البحث في القوانين والمصادر' });
  await expect(search).toBeVisible();
  const searchBox = await search.boundingBox();
  expect(searchBox).not.toBeNull();
  expect(searchBox!.height).toBeGreaterThanOrEqual(44);
  expect(searchBox!.x).toBeGreaterThanOrEqual(-1);
  expect(searchBox!.x + searchBox!.width).toBeLessThanOrEqual(321);
  await expectNoHorizontalOverflow(page);
  await recordShot(page, 'rtl-arabic-320');

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByLabel('اللغة', { exact: true }).selectOption('ja');
  await expect(shell(page)).toHaveAttribute('dir', 'ltr');
  await expect(shell(page)).toHaveAttribute('lang', 'ja');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
  await expect(page.locator('.wwl-product')).toHaveText('世界の法令');
  await expect(page.getByRole('heading', { level: 2, name: '法令', exact: true })).toBeVisible();
  await expect(page.locator('.wwl-place')).toHaveText(PLACE);
  await expect(page.getByRole('main')).toContainText(RECORD);
  await expect(page.locator('.wwl-live')).toContainText('日本語');
  await expect(page.locator('.wwl-live')).toContainText(PLACE);
  expect(await columnLayout(page)).toMatchObject({ sideBySide: true });
  await expectNoHorizontalOverflow(page);
  await recordShot(page, 'cjk-japanese-desktop');
});

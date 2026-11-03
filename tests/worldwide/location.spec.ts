/**
 * Location races on the mounted worldwide shell.
 *
 * A late country.is body or device reading, a hash change, a country-only
 * or coordinate link, and a newer manual choice must leave the place line,
 * the scope attribute, and the result list on the latest scope. The shell
 * result list is the list the page actually renders. Keyboard and a 320px
 * touch viewport must be able to change place.
 */

import { expect, test, type Locator, type Page } from '@playwright/test';

const AMSTERDAM = 'place:amsterdam';
const ROTTERDAM = 'place:rotterdam';
const UTRECHT = 'place:utrecht';
const QUERY = 'harbor bylaw';
const COARSE_IP = '203.0.113.50';
const DEVICE_LATITUDE = 51.9225;
const DEVICE_LONGITUDE = 4.47917;

interface IpHit {
  url: string;
  method: string;
  body: string | null;
}

interface LocationProbe {
  ipHits: IpHit[];
  releaseIp: () => Promise<number>;
}

interface DeviceProbe {
  calls: number;
  watches: number;
  released: boolean;
}

const probes = new WeakMap<Page, LocationProbe>();

test.beforeEach(async ({ page }) => {
  const ipHits: IpHit[] = [];
  const waiters: Array<() => void> = [];
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  await page.addInitScript(
    ({ latitude, longitude }) => {
      const pending: PositionCallback[] = [];
      const probe = {
        calls: 0,
        watches: 0,
        release(): boolean {
          const queued = pending.splice(0);
          const reading = {
            coords: {
              latitude,
              longitude,
              accuracy: 25000,
              altitude: null,
              altitudeAccuracy: null,
              heading: null,
              speed: null,
              toJSON() {
                return this;
              },
            },
            timestamp: Date.now(),
            toJSON() {
              return this;
            },
          } as GeolocationPosition;
          for (const success of queued) success(reading);
          return queued.length > 0;
        },
      };
      const geolocation = {
        getCurrentPosition(success: PositionCallback) {
          probe.calls += 1;
          pending.push(success);
        },
        watchPosition(success: PositionCallback) {
          probe.watches += 1;
          probe.calls += 1;
          pending.push(success);
          return probe.watches;
        },
        clearWatch() {
          pending.splice(0);
        },
      };
      Object.defineProperty(navigator, 'geolocation', { configurable: true, value: geolocation });
      Object.defineProperty(window, '__wwlLocationProbe', { configurable: true, value: probe });
    },
    { latitude: DEVICE_LATITUDE, longitude: DEVICE_LONGITUDE },
  );
  await page.route(/^https:\/\/plausible\.io\//, (route) => route.abort());
  await page.route(/^https:\/\/api\.country\.is\/?/, async (route) => {
    const request = route.request();
    ipHits.push({ url: request.url(), method: request.method(), body: request.postData() });
    await new Promise<void>((resolve) => {
      waiters.push(resolve);
    });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ip: COARSE_IP,
        country: 'US',
        city: 'Rotterdam',
        region: 'South Holland',
        latitude: DEVICE_LATITUDE,
        longitude: DEVICE_LONGITUDE,
        placeId: ROTTERDAM,
      }),
    }).catch(() => {
      /* The page can close while a delayed country response is still held. */
    });
  });
  probes.set(page, {
    ipHits,
    releaseIp: async () => {
      const pending = waiters.splice(0);
      for (const resolve of pending) resolve();
      return pending.length;
    },
  });
});

test.afterEach(async ({ page }) => {
  await probes.get(page)?.releaseIp().catch(() => 0);
  await page
    .evaluate(() => {
      const probe = (window as unknown as { __wwlLocationProbe?: { release?: () => boolean } }).__wwlLocationProbe;
      probe?.release?.();
    })
    .catch(() => undefined);
});

function probeOf(page: Page): LocationProbe {
  const probe = probes.get(page);
  if (!probe) throw new Error('location probe was not installed');
  return probe;
}

async function releaseDevice(page: Page): Promise<DeviceProbe> {
  return page.evaluate(() => {
    const probe = (window as unknown as {
      __wwlLocationProbe: { calls: number; watches: number; release: () => boolean };
    }).__wwlLocationProbe;
    return { calls: probe.calls, watches: probe.watches, released: probe.release() };
  });
}

async function releaseLateResponses(page: Page): Promise<{ ip: number; device: DeviceProbe }> {
  const device = await releaseDevice(page);
  const ip = await probeOf(page).releaseIp();
  if (device.released || ip > 0) await page.waitForTimeout(500);
  return { ip, device };
}

async function expectNoStaleScope(
  page: Page,
  expected: {
    place: string;
    origin: string;
    scope: 'place' | 'worldwide' | 'unselected';
    state?: string;
    absent?: readonly string[];
  },
) {
  const shell = page.locator('.wwl');
  await expect(shell).toHaveAttribute('data-scope', expected.scope);
  if (expected.state) await expect(shell).toHaveAttribute('data-state', expected.state);
  await expect(shell).toHaveAttribute('data-map', 'closed');
  await expect(shell).toHaveAttribute('data-model', 'idle');
  await expect(page.locator('.wwl-place')).toHaveText(expected.place);
  await expect(page.locator('.wwl-place-origin')).toHaveText(expected.origin);
  const results = page.getByRole('main').getByRole('list', { name: 'Results' });
  await expect(results.locator('li')).toHaveCount(0);
  await expect(page.locator('[data-stale="true"]')).toHaveCount(0);
  await expect(page.locator('.wwl-counts')).toHaveText('Searched 0 · Remaining 0');
  const stack = page.getByRole('complementary', { name: 'Laws and sources for this place' }).getByRole('list');
  await expect(stack.locator('li')).toHaveCount(1);
  await expect(stack).toHaveText(expected.place);
  const main = page.getByRole('main');
  for (const stale of expected.absent ?? []) {
    await expect(main).not.toContainText(stale);
    await expect(stack).not.toContainText(stale);
    await expect(page.locator('.wwl-place')).not.toContainText(stale);
  }
}

async function choosePlace(page: Page, placeId: string) {
  const combo = page.getByRole('combobox', { name: 'Choose a place' });
  await combo.click();
  await combo.fill(placeId);
  await page.getByRole('option', { name: new RegExp(placeId) }).click();
}

async function focusByKeyboard(page: Page, target: Locator, key: 'Tab' | 'Shift+Tab') {
  for (let step = 0; step < 12; step += 1) {
    if (await target.evaluate((node) => node === document.activeElement)) return;
    await page.keyboard.press(key);
  }
  await expect(target).toBeFocused();
}

async function setHash(page: Page, hash: string) {
  await page.evaluate((next) => {
    window.location.hash = next;
  }, hash);
}

function expectCoarseRequests(hits: readonly IpHit[]) {
  for (const hit of hits) {
    expect(hit.method).toBe('GET');
    expect(hit.body ?? '').toBe('');
    expect(hit.url).toBe('https://api.country.is/');
    expect(hit.url.toLowerCase()).not.toContain('harbor');
    expect(hit.url).not.toContain(AMSTERDAM);
    expect(hit.url).not.toContain(String(DEVICE_LATITUDE));
  }
}

test('a delayed IP or device response cannot replace a newer place or paint its results', async ({ page }) => {
  await page.goto(`/#/search?q=${encodeURIComponent(QUERY)}&place=${encodeURIComponent(AMSTERDAM)}&scope=place`);
  await expectNoStaleScope(page, {
    place: AMSTERDAM,
    origin: 'shared URL',
    scope: 'place',
    state: 'screen-reader-scope-change',
    absent: [ROTTERDAM, UTRECHT, COARSE_IP],
  });
  await expect(page.getByRole('searchbox', { name: 'Search laws and sources' })).toHaveValue(QUERY);
  await expect(page.getByRole('main')).toContainText('This collection was not searched.');

  await choosePlace(page, UTRECHT);
  await expectNoStaleScope(page, {
    place: UTRECHT,
    origin: 'manually selected',
    scope: 'place',
    state: 'changed-manual-location',
    absent: [AMSTERDAM, ROTTERDAM, COARSE_IP, 'Rotterdam'],
  });

  const late = await releaseLateResponses(page);
  await page.waitForTimeout(500);
  expectCoarseRequests(probeOf(page).ipHits);
  expect(late.device.watches).toBe(0);
  await expectNoStaleScope(page, {
    place: UTRECHT,
    origin: 'manually selected',
    scope: 'place',
    state: 'changed-manual-location',
    absent: [AMSTERDAM, ROTTERDAM, COARSE_IP, 'Rotterdam', String(DEVICE_LATITUDE)],
  });
  await expect(page.locator('.wwl-place-origin')).not.toHaveText(/device location|approximate IP location/);
  await expect(page.getByRole('searchbox', { name: 'Search laws and sources' })).toHaveValue(QUERY);
  await expect(page).toHaveURL(/utrecht/i);
  await expect(page).not.toHaveURL(/amsterdam|rotterdam|lat=|lon=/i);
  await expect(page.locator('.wwl-live')).toContainText(UTRECHT);
  await expect(page.locator('.wwl-live')).toContainText('manually selected');
});

test('URL navigation drops the previous place, including a saved place and a fast second hash', async ({ page }) => {
  await page.addInitScript((saved) => {
    window.localStorage.setItem('worldwide-legal-search.saved-place', saved);
  }, JSON.stringify({
    schema: 'worldwide-legal-search.saved-place@1',
    placeId: ROTTERDAM,
    label: 'Rotterdam',
    asOf: null,
    scope: 'place',
    savedAt: '2026-10-26T00:00:00Z',
  }));

  await page.goto(`/#/search?q=${encodeURIComponent(QUERY)}&place=${encodeURIComponent(AMSTERDAM)}&scope=place`);
  await expectNoStaleScope(page, {
    place: AMSTERDAM,
    origin: 'shared URL',
    scope: 'place',
    state: 'screen-reader-scope-change',
    absent: [ROTTERDAM, 'Rotterdam'],
  });

  await setHash(page, `#/search?q=${encodeURIComponent(QUERY)}&place=${encodeURIComponent(ROTTERDAM)}&scope=place`);
  await expectNoStaleScope(page, {
    place: ROTTERDAM,
    origin: 'shared URL',
    scope: 'place',
    state: 'screen-reader-scope-change',
    absent: [AMSTERDAM],
  });
  await expect(page).toHaveURL(/rotterdam/i);
  await expect(page).not.toHaveURL(/amsterdam/i);

  await setHash(page, `#/law/BWBR0001854?place=${encodeURIComponent(AMSTERDAM)}&scope=place`);
  await expect(page.getByRole('main').getByRole('heading', { level: 2 })).toHaveText('Law');
  await expect(page.getByRole('main')).toContainText('BWBR0001854');
  await expectNoStaleScope(page, {
    place: AMSTERDAM,
    origin: 'shared URL',
    scope: 'place',
    state: 'screen-reader-scope-change',
    absent: [ROTTERDAM],
  });

  await setHash(page, `#/search?q=${encodeURIComponent(QUERY)}&place=${encodeURIComponent(UTRECHT)}&scope=place`);
  await expect(page.getByRole('main').getByRole('heading', { level: 2 })).toHaveText('Results');
  await expect(page.getByRole('main')).not.toContainText('BWBR0001854');
  await expectNoStaleScope(page, {
    place: UTRECHT,
    origin: 'shared URL',
    scope: 'place',
    state: 'screen-reader-scope-change',
    absent: [AMSTERDAM, ROTTERDAM, 'BWBR0001854'],
  });

  await setHash(page, `#/search?q=${encodeURIComponent(QUERY)}&scope=worldwide`);
  await expectNoStaleScope(page, {
    place: 'unselected worldwide',
    origin: 'shared URL',
    scope: 'worldwide',
    absent: [AMSTERDAM, ROTTERDAM, UTRECHT, 'Rotterdam'],
  });
  await expect(page.getByRole('radio', { name: 'Search worldwide' })).toBeChecked();

  await page.evaluate(() => {
    window.location.hash = '#/search?place=place:amsterdam&scope=place&q=harbor%20bylaw';
    window.location.hash = '#/search?place=place:rotterdam&scope=place&q=harbor%20bylaw';
  });
  await expectNoStaleScope(page, {
    place: ROTTERDAM,
    origin: 'shared URL',
    scope: 'place',
    state: 'screen-reader-scope-change',
    absent: [AMSTERDAM, UTRECHT],
  });

  const late = await releaseLateResponses(page);
  await page.waitForTimeout(500);
  expect(late.device.watches).toBe(0);
  expectCoarseRequests(probeOf(page).ipHits);
  await expectNoStaleScope(page, {
    place: ROTTERDAM,
    origin: 'shared URL',
    scope: 'place',
    absent: [AMSTERDAM, UTRECHT, COARSE_IP],
  });
});

test('a coarse VPN country or country code never selects a city or keeps the previous results', async ({ page }) => {
  await page.goto('/#/search');
  await expectNoStaleScope(page, {
    place: 'unselected worldwide',
    origin: 'unselected worldwide',
    scope: 'unselected',
    state: 'first-visit',
    absent: [AMSTERDAM, ROTTERDAM, COARSE_IP, 'Rotterdam'],
  });

  await choosePlace(page, AMSTERDAM);
  const late = await releaseLateResponses(page);
  await page.waitForTimeout(500);
  expect(late.device.watches).toBe(0);
  expectCoarseRequests(probeOf(page).ipHits);
  await expectNoStaleScope(page, {
    place: AMSTERDAM,
    origin: 'manually selected',
    scope: 'place',
    state: 'changed-manual-location',
    absent: [ROTTERDAM, COARSE_IP, 'Rotterdam', 'United States'],
  });
  await expect(page.locator('.wwl-place-origin')).not.toHaveText('approximate IP location');

  await setHash(page, '#/search?place=nl');
  await expect(page.locator('.wwl-status')).toContainText('A country or region code is an alias, not a place id. No city was selected.');
  await expectNoStaleScope(page, {
    place: 'unselected worldwide',
    origin: 'shared URL',
    scope: 'worldwide',
    absent: [AMSTERDAM, ROTTERDAM, 'Rotterdam'],
  });
  await expect(page.getByRole('radio', { name: 'Search worldwide' })).toBeChecked();
  await expect(page.getByRole('radio', { name: 'This place' })).not.toBeChecked();
  await expect(page).not.toHaveURL(/amsterdam|rotterdam|lat=|lon=/i);
  await expect(page.locator('body')).not.toContainText(COARSE_IP);
});

test('a coordinate on a border selects neither city until the visitor chooses, and the next choice replaces it', async ({ page }) => {
  await page.goto(`/#/search?place=${encodeURIComponent('52.3702,4.8952')}&q=${encodeURIComponent(QUERY)}`);
  await expect(page.locator('.wwl-status')).toContainText('Coordinates are not a place id and are left off the shared link.');
  await expectNoStaleScope(page, {
    place: 'unselected worldwide',
    origin: 'shared URL',
    scope: 'worldwide',
    absent: [AMSTERDAM, ROTTERDAM, '52.3702', '4.8952'],
  });
  await expect(page.getByRole('radio', { name: 'Search worldwide' })).toBeChecked();
  await expect(page).not.toHaveURL(/52\.3702|4\.8952|lat=|lon=/);

  await choosePlace(page, AMSTERDAM);
  await expectNoStaleScope(page, {
    place: AMSTERDAM,
    origin: 'manually selected',
    scope: 'place',
    state: 'changed-manual-location',
    absent: [ROTTERDAM, '52.3702'],
  });
  await expect(page).not.toHaveURL(/52\.3702|lat=|lon=/);

  await choosePlace(page, ROTTERDAM);
  await expectNoStaleScope(page, {
    place: ROTTERDAM,
    origin: 'manually selected',
    scope: 'place',
    state: 'changed-manual-location',
    absent: [AMSTERDAM, '52.3702', '4.8952'],
  });
  await expect(page.locator('.wwl-live')).toContainText(ROTTERDAM);
  await expect(page.locator('.wwl-live')).not.toContainText(AMSTERDAM);
  await expect(page).toHaveURL(/rotterdam/i);
  await expect(page).not.toHaveURL(/amsterdam|52\.3702|lat=|lon=/i);

  await setHash(page, '#/search?place=place:us');
  await expect(page.locator('.wwl-status')).toContainText('No city was selected.');
  await expectNoStaleScope(page, {
    place: 'unselected worldwide',
    origin: 'shared URL',
    scope: 'worldwide',
    absent: [AMSTERDAM, ROTTERDAM],
  });
  await expect(page.getByRole('main').locator('li')).toHaveCount(0);

  const late = await releaseLateResponses(page);
  await page.waitForTimeout(500);
  expect(late.device.watches).toBe(0);
  expectCoarseRequests(probeOf(page).ipHits);
  await expectNoStaleScope(page, {
    place: 'unselected worldwide',
    origin: 'shared URL',
    scope: 'worldwide',
    absent: [AMSTERDAM, ROTTERDAM, COARSE_IP],
  });
});

test('keyboard place changes commit, cancel, and leave the previous scope', async ({ page }) => {
  await page.goto('/#/search');
  const search = page.getByRole('searchbox', { name: 'Search laws and sources' });
  const combo = page.getByRole('combobox', { name: 'Choose a place' });
  await expect(search).toBeFocused();
  await focusByKeyboard(page, combo, 'Shift+Tab');
  await expect(combo).toBeFocused();

  await page.keyboard.type(UTRECHT);
  await expect(page.getByRole('listbox', { name: 'Places' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('listbox', { name: 'Places' })).toHaveCount(0);
  await expect(combo).toHaveValue('');
  await expectNoStaleScope(page, {
    place: 'unselected worldwide',
    origin: 'unselected worldwide',
    scope: 'unselected',
    state: 'first-visit',
    absent: [UTRECHT],
  });

  await page.keyboard.type(AMSTERDAM);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expectNoStaleScope(page, {
    place: AMSTERDAM,
    origin: 'manually selected',
    scope: 'place',
    state: 'changed-manual-location',
    absent: [UTRECHT, ROTTERDAM],
  });
  await expect(page.getByRole('radio', { name: 'This place' })).toBeChecked();
  await expect(page.locator('.wwl-live')).toContainText(AMSTERDAM);

  const worldwide = page.getByRole('radio', { name: 'Search worldwide' });
  await focusByKeyboard(page, page.getByRole('radio', { name: 'This place' }), 'Tab');
  await page.keyboard.press('ArrowDown');
  await expect(worldwide).toBeChecked();
  await expect(page.locator('.wwl')).toHaveAttribute('data-scope', 'worldwide');
  await expect(page.locator('.wwl-place')).toHaveText(AMSTERDAM);
  await expect(page.getByRole('main').getByRole('list', { name: 'Results' }).locator('li')).toHaveCount(0);

  await page.keyboard.press('ArrowUp');
  await expect(page.getByRole('radio', { name: 'This place' })).toBeChecked();
  await focusByKeyboard(page, combo, 'Shift+Tab');
  await page.keyboard.type('NL');
  await expect(page.getByRole('listbox', { name: 'Places' }).getByRole('option')).toHaveCount(0);
  await page.keyboard.press('Enter');
  await expect(page.locator('.wwl-place')).toHaveText(AMSTERDAM);

  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  await page.keyboard.type(ROTTERDAM);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expectNoStaleScope(page, {
    place: ROTTERDAM,
    origin: 'manually selected',
    scope: 'place',
    state: 'changed-manual-location',
    absent: [AMSTERDAM, UTRECHT, 'NL'],
  });
  await expect(page.locator('.wwl-live')).toContainText(ROTTERDAM);
  await expect(page.locator('.wwl-live')).not.toContainText(AMSTERDAM);
  await expect(page).not.toHaveURL(/amsterdam/i);
});

test.describe('mobile place changes', () => {
  test.use({ viewport: { width: 320, height: 640 }, hasTouch: true });

  test('a 320px touch viewport can change place without keeping the previous scope', async ({ page }) => {
    await page.goto(`/#/search?q=${encodeURIComponent(QUERY)}&place=${encodeURIComponent(AMSTERDAM)}&scope=place`);
    await expectNoStaleScope(page, {
      place: AMSTERDAM,
      origin: 'shared URL',
      scope: 'place',
      state: 'screen-reader-scope-change',
      absent: [ROTTERDAM],
    });

    const change = page.getByRole('button', { name: 'Change place', exact: true });
    await change.scrollIntoViewIfNeeded();
    const changeBox = await change.boundingBox();
    expect(changeBox).not.toBeNull();
    expect(changeBox!.height).toBeGreaterThanOrEqual(44);
    expect(changeBox!.width).toBeGreaterThanOrEqual(44);
    expect(changeBox!.x).toBeGreaterThanOrEqual(0);
    expect(changeBox!.x + changeBox!.width).toBeLessThanOrEqual(321);

    const combo = page.getByRole('combobox', { name: 'Choose a place' });
    const comboBox = await combo.boundingBox();
    expect(comboBox).not.toBeNull();
    expect(comboBox!.height).toBeGreaterThanOrEqual(44);

    await change.tap();
    await expect(combo).toBeFocused();
    await page.keyboard.type(ROTTERDAM);
    const option = page.getByRole('option', { name: new RegExp(ROTTERDAM) });
    await option.scrollIntoViewIfNeeded();
    const optionBox = await option.boundingBox();
    expect(optionBox).not.toBeNull();
    expect(optionBox!.height).toBeGreaterThanOrEqual(44);
    await option.tap();

    await expectNoStaleScope(page, {
      place: ROTTERDAM,
      origin: 'manually selected',
      scope: 'place',
      state: 'changed-manual-location',
      absent: [AMSTERDAM],
    });
    await expect(page.locator('.wwl-live')).toContainText(ROTTERDAM);
    await expect(page.locator('.wwl-live')).not.toContainText(AMSTERDAM);
    await expect(page.getByRole('radio', { name: 'This place' })).toBeChecked();
    await expect(page).toHaveURL(/rotterdam/i);
    await expect(page).not.toHaveURL(/amsterdam/i);

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);

    const late = await releaseLateResponses(page);
    await page.waitForTimeout(500);
    expect(late.device.watches).toBe(0);
    expectCoarseRequests(probeOf(page).ipHits);
    await expectNoStaleScope(page, {
      place: ROTTERDAM,
      origin: 'manually selected',
      scope: 'place',
      absent: [AMSTERDAM, COARSE_IP],
    });
  });
});

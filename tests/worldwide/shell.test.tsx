/**
 * Worldwide shell: place, as-of date, and language stay visible.
 * The screen loads without the old Dutch initial query, login, a proxy,
 * or model warmup. Netherlands migration stays behind its flag.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { jest } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AppStatic from '../../src/AppStatic';
import WorldwideLegalSearchApp from '../../src/components/worldwide/WorldwideLegalSearchApp';
import {
  NL_MIGRATION_STORAGE_KEY,
  SAVED_PLACE_STORAGE_KEY,
  shellBootHref,
} from '../../src/components/worldwide/SearchContext';
import { encodeSavedPlace, SAVED_PLACE_SCHEMA } from '../../src/lib/worldwide/location/state';

jest.unstable_mockModule('../../src/components/WetWijzerLegalResearchApp', () => ({
  __esModule: true,
  default: function LegacyStub() {
    return <div>legacy stub mounted</div>;
  },
}));

const NICHE = 'Wetboek van Strafrecht artikel 1';
const ROOT = process.cwd();

function read(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8');
}

describe('worldwide shell', () => {
  const fetchHost = globalThis as unknown as { fetch?: (...args: unknown[]) => Promise<unknown> };
  const originalFetch = fetchHost.fetch;
  const fetchSpy = jest.fn((..._args: unknown[]) => Promise.reject(new Error('shell fetch')));
  fetchHost.fetch = fetchSpy;
  const geo = jest.fn();
  const workers: string[] = [];

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    window.history.replaceState(null, '', '/');
    fetchSpy.mockClear();
    geo.mockClear();
    workers.length = 0;
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition: geo, watchPosition: geo },
    });
    (global as unknown as { Worker: unknown }).Worker = class {
      constructor(url: string) {
        workers.push(String(url));
      }
      postMessage() {}
      terminate() {}
      addEventListener() {}
      removeEventListener() {}
      dispatchEvent() {
        return false;
      }
    };
  });

  afterAll(() => {
    fetchHost.fetch = originalFetch;
  });

  it('boots to search and keeps legacy Netherlands links behind the flag', () => {
    expect(shellBootHref('http://localhost:5173/', false)).toBe('/#/search');
    expect(shellBootHref(`https://wetwijzer.github.io/?q=${encodeURIComponent(NICHE)}`, false)).toBe('/#/search');
    expect(shellBootHref(`https://wetwijzer.github.io/?q=${encodeURIComponent(NICHE)}`, true)).toContain('place=netherlands');
    expect(shellBootHref('/#/search?q=parking&place=place:amsterdam', false)).toContain('q=parking');
    expect(shellBootHref('/#/not-a-route', false)).toBe('/#/not-a-route');
  });

  it('shows place, as-of date, and language without a niche query, login, proxy, or model', async () => {
    const user = userEvent.setup();
    render(<WorldwideLegalSearchApp href="/#/search" nlMigration={false} />);

    expect(screen.getByRole('banner')).toBeVisible();
    expect(screen.getByRole('search')).toBeVisible();
    expect(screen.getByRole('main')).toBeVisible();
    expect(screen.getByRole('complementary', { name: 'Laws and sources for this place' })).toBeVisible();
    const live = document.querySelector('.wwl-live');
    expect(live).toHaveAttribute('aria-live', 'polite');
    expect(live).toHaveAttribute('aria-atomic', 'true');
    expect(live?.getAttribute('hidden')).toBeNull();
    expect(document.querySelector('.wwl')).toHaveAttribute('data-state', 'first-visit');
    expect(document.querySelector('.wwl')).toHaveAttribute('data-map', 'closed');
    expect(document.querySelector('.wwl')).toHaveAttribute('data-model', 'idle');
    expect(document.querySelector('.wwl')).toHaveAttribute('data-nl-migration', 'off');
    expect(document.querySelector('.wwl-map')).toBeNull();
    expect(document.querySelector('.wwl-model')).toBeNull();
    expect(screen.getAllByText('unselected worldwide').length).toBeGreaterThan(0);
    expect(screen.getByLabelText('As of')).toBeVisible();
    expect(screen.getByLabelText('Language')).toBeVisible();
    expect(screen.getByLabelText('Choose a place')).toBeVisible();
    expect(screen.getByRole('searchbox', { name: 'Search laws and sources' })).toHaveValue('');
    expect(screen.queryByRole('button', { name: NICHE })).toBeNull();
    expect(screen.getByText('Searched 0 · Remaining 0')).toBeVisible();
    expect(screen.getByText('This choice does not decide that a law applies.')).toBeVisible();
    expect(document.body.innerHTML).not.toMatch(/clerk|openrouter|onnx|transformers|warmup|password/i);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(geo).not.toHaveBeenCalled();
    expect(workers).toEqual([]);

    await user.click(screen.getByRole('button', { name: 'Change place' }));
    await user.type(screen.getByLabelText('Choose a place'), 'place:amsterdam');
    await user.click(screen.getByRole('option', { name: /place:amsterdam/ }));
    expect(screen.getAllByText('place:amsterdam').length).toBeGreaterThan(0);
    expect(screen.getByText('manually selected')).toBeVisible();

    const date = screen.getByLabelText('As of');
    await user.clear(date);
    await user.type(date, '2026-10-26');
    expect(date).toHaveValue('2026-10-26');
    expect(screen.getAllByText('place:amsterdam').length).toBeGreaterThan(0);
    expect(screen.getByText('manually selected')).toBeVisible();

    await user.selectOptions(screen.getByLabelText('Language'), 'ar');
    expect(document.querySelector('.wwl')).toHaveAttribute('dir', 'rtl');
    expect(document.querySelector('.wwl')).toHaveAttribute('lang', 'ar');
    expect(screen.getByLabelText('اعتبارًا من')).toBeVisible();
    expect(screen.getByLabelText('اللغة')).toBeVisible();
    expect(screen.getAllByText('place:amsterdam').length).toBeGreaterThan(0);
    expect(screen.getByLabelText('اعتبارًا من')).toHaveValue('2026-10-26');

    await user.selectOptions(screen.getByLabelText('اللغة'), 'en');
    await user.click(screen.getByRole('radio', { name: 'Search worldwide' }));
    expect(screen.getAllByText('place:amsterdam').length).toBeGreaterThan(0);
    expect(screen.getByLabelText('As of')).toBeVisible();
    expect(screen.getByLabelText('Language')).toHaveValue('en');

    await user.clear(screen.getByRole('searchbox'));
    await user.click(screen.getByRole('button', { name: 'Search laws and sources' }));
    expect(screen.getByRole('searchbox')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Enter a question, citation, or identifier, then search.' })).toBeVisible();
    expect(screen.getByLabelText('As of')).toBeVisible();
    expect(screen.getByLabelText('Language')).toBeVisible();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(workers).toEqual([]);
  });

  it('keeps semantic landmarks usable for filters without moving the interface language', async () => {
    const user = userEvent.setup();
    render(<WorldwideLegalSearchApp href="/#/search" nlMigration={false} />);
    await user.click(screen.getByRole('link', { name: 'Skip to search' }));
    expect(screen.getByRole('searchbox')).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Filters' }));
    const dialog = screen.getByRole('dialog', { name: 'Filters' });
    expect(dialog).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Filters' })).toHaveFocus();
    await user.selectOptions(screen.getByLabelText('Document language'), 'nl');
    expect(screen.getByLabelText('Language')).toHaveValue('en');
    expect(screen.getByLabelText('As of')).toBeVisible();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Filters' })).toHaveFocus();
    expect(screen.getAllByText('unselected worldwide').length).toBeGreaterThan(0);
  });

  it('preserves feature-flagged Netherlands migration without using it as the initial query', async () => {
    const user = userEvent.setup();
    const load = jest.fn();
    load.mockResolvedValue({ default: () => <div>legacy workspace</div> });
    const flagged = render(
      <WorldwideLegalSearchApp href="/#/search" nlMigration loadLegacyNl={load} />,
    );
    expect(screen.getByRole('searchbox')).toHaveValue('');
    expect(document.querySelector('.wwl')).toHaveAttribute('data-nl-migration', 'on');
    expect(load).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: NICHE })).toBeVisible();
    await user.click(screen.getByRole('button', { name: NICHE }));
    expect(screen.getByRole('searchbox')).toHaveValue(NICHE);
    expect(screen.getAllByText('unselected worldwide').length).toBeGreaterThan(0);
    expect(screen.getByLabelText('As of')).toBeVisible();
    expect(screen.getByLabelText('Language')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Open the Netherlands research workspace' }));
    expect(load).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('legacy workspace')).toBeVisible();
    expect(screen.getByLabelText('As of')).toBeVisible();
    expect(screen.getByLabelText('Language')).toBeVisible();
    flagged.unmount();

    const blocked = render(
      <WorldwideLegalSearchApp
        href={`https://wetwijzer.github.io/?q=${encodeURIComponent(NICHE)}`}
        nlMigration={false}
      />,
    );
    expect(screen.getByRole('searchbox')).toHaveValue('');
    expect(screen.queryByRole('button', { name: NICHE })).toBeNull();
    blocked.unmount();

    render(
      <WorldwideLegalSearchApp
        href={`https://wetwijzer.github.io/?q=${encodeURIComponent(NICHE)}`}
        nlMigration
      />,
    );
    expect(screen.getByRole('searchbox')).toHaveValue(NICHE);
    expect(screen.getAllByText('place:netherlands').length).toBeGreaterThan(0);
    expect(screen.getByText('shared URL')).toBeVisible();
    expect(screen.getByLabelText('As of')).toBeVisible();
  });

  it('restores a saved place and lets a shared URL outrank it', () => {
    localStorage.setItem(SAVED_PLACE_STORAGE_KEY, encodeSavedPlace({
      schema: SAVED_PLACE_SCHEMA,
      placeId: 'place:netherlands',
      label: 'Netherlands',
      asOf: { value: '2026-10-26', precision: 'day' },
      scope: 'place',
      savedAt: '2026-10-26T00:00:00Z',
    }));
    const saved = render(<WorldwideLegalSearchApp href="/#/search" nlMigration={false} />);
    expect(screen.getAllByText('Netherlands').length).toBeGreaterThan(0);
    expect(screen.getByText('saved selection')).toBeVisible();
    expect(screen.getByLabelText('As of')).toHaveValue('2026-10-26');
    expect(screen.getByLabelText('Language')).toBeVisible();
    saved.unmount();

    render(
      <WorldwideLegalSearchApp
        href="/#/search?place=place:amsterdam&date=2026-01-02"
        nlMigration={false}
      />,
    );
    expect(screen.getAllByText('place:amsterdam').length).toBeGreaterThan(0);
    expect(screen.getByText('shared URL')).toBeVisible();
    expect(screen.getByLabelText('As of')).toHaveValue('2026-01-02');
    expect(screen.queryByText('saved selection')).toBeNull();
    expect(screen.queryByText('Netherlands')).toBeNull();
  });

  it('names a broken hash and keeps the place and date controls', () => {
    render(<WorldwideLegalSearchApp href="/#/not-a-route" nlMigration={false} />);
    expect(screen.getByRole('button', { name: 'Correct the link, or continue with the place and date already on the page.' })).toBeVisible();
    expect(screen.getByLabelText('As of')).toBeVisible();
    expect(screen.getByLabelText('Language')).toBeVisible();
    expect(screen.getAllByText('unselected worldwide').length).toBeGreaterThan(0);
    expect(document.querySelector('.wwl')).toHaveAttribute('data-state', 'malformed-url');
  });

  it('reads the Netherlands flag for the static entry without mounting the old workspace', async () => {
    const user = userEvent.setup();
    const plain = render(<AppStatic />);
    expect(screen.getByRole('searchbox')).toHaveValue('');
    expect(screen.queryByText('legacy stub mounted')).toBeNull();
    expect(screen.queryByRole('button', { name: NICHE })).toBeNull();
    plain.unmount();

    localStorage.setItem(NL_MIGRATION_STORAGE_KEY, '1');
    render(<AppStatic />);
    expect(screen.getByRole('searchbox')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Open the Netherlands research workspace' })).toBeVisible();
    expect(screen.queryByText('legacy stub mounted')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Open the Netherlands research workspace' }));
    expect(await screen.findByText('legacy stub mounted')).toBeVisible();
    expect(screen.getByLabelText('As of')).toBeVisible();
    expect(screen.getByLabelText('Language')).toBeVisible();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('keeps the entry files free of niche boot, login, proxy, and model warmup', () => {
    const main = read('src/main.tsx');
    const html = read('index.html');
    const app = read('src/AppStatic.tsx');
    const css = read('src/styles/worldwide.css');
    const live = css.match(/\.wwl-live\s*\{[^}]*\}/)?.[0] ?? '';
    expect(main).not.toMatch(/setupGlobalWarningSuppressions|StaticDataProvider|Clerk|openrouter|transformers|onnx|warmup|Wetboek/i);
    expect(main).toMatch(/AppStatic/);
    expect(html).toMatch(/lang="en"/);
    expect(html).toMatch(/Worldwide laws/);
    expect(html).toMatch(/data-wwl-shell="worldwide"/);
    expect(html).not.toMatch(/Wetboek|Cross-Origin-Embedder-Policy|Cross-Origin-Opener-Policy|require-corp/);
    expect(app).toMatch(/import\('\.\/components\/WetWijzerLegalResearchApp'\)/);
    expect(app).not.toMatch(/^import WetWijzer/m);
    expect(live).toMatch(/clip/);
    expect(live).not.toMatch(/display:\s*none/);
    expect(read('src/index.css')).toMatch(/data-wwl-shell="worldwide"/);
  });
});

/**
 * Versioned law reader.
 * The text, citation, and revision assertions use the bundled source files.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { jest } from '@jest/globals';
import type { ComponentProps } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  BUNDLED_NETHERLANDS_RIGHTS,
  LawReader,
  assembleReaderCorpus,
  fetchBundledReaderCorpus,
  isFloatingRevision,
  readerReturnHref,
  resolveReaderClock,
  selectReaderView,
  type ReaderCorpus,
  type ReaderSectionInput,
} from '../../src/components/worldwide/LawReader';
import type { CorpusManifest, CorpusSection } from '../../src/lib/worldwide/contracts';

const manifest = JSON.parse(readFileSync(join('public/corpus/netherlands/current/artifacts.manifest.json'), 'utf8')) as CorpusManifest;
const sections = JSON.parse(readFileSync(join('public/corpus/netherlands/current/generated/sections.json'), 'utf8')) as CorpusSection[];
const rightsDoc = JSON.parse(readFileSync(join('data/worldwide/rights.json'), 'utf8')) as {
  records: Array<{ dataset_id: string; artifact_revision: string; card_sha256: string | null; status: string; rights: string | null; attribution: string | null; inferred_from_organization: boolean; grant_source: string; blocker: { reason: string } | null }>;
};

const criminal = sections[0];
const civil = sections[1];
const procedure = sections[2];
const TEXT_REVISION = manifest.generatedAt;

function corpusFrom(rows: readonly ReaderSectionInput[] = sections, rights?: ReaderCorpus['rights'] | null): ReaderCorpus {
  return assembleReaderCorpus({
    manifest,
    sections: rows,
    rights: rights === undefined ? undefined : {
      status: rights.status,
      rights: rights.rights,
      attribution: rights.attribution,
      inferredFromOrganization: rights.inferredFromOrganization,
      blocker: rights.blocker,
      grantSource: rights.grantSource,
      downloadPermitted: rights.downloadPermitted,
      artifactRevision: rights.artifactRevision,
      datasetId: rights.datasetId,
      cardSha256: rights.cardSha256,
    },
  });
}

function realCorpus(): ReaderCorpus {
  return corpusFrom(sections);
}

function field(name: string): HTMLElement {
  const element = document.querySelector(`[data-field="${name}"]`);
  if (!element) throw new Error(`missing field ${name}`);
  return element as HTMLElement;
}

function open(overrides: Partial<ComponentProps<typeof LawReader>> = {}) {
  const corpus = overrides.corpus === undefined ? realCorpus() : overrides.corpus;
  return render(
    <LawReader
      corpus={corpus}
      recordId={criminal.law_id}
      sectionId={criminal.ipfs_cid}
      asOf="2026-06-27"
      {...overrides}
    />,
  );
}

const fetchHost = globalThis as { fetch?: typeof fetch };
let originalFetch: typeof fetch | undefined;

beforeEach(() => {
  originalFetch = fetchHost.fetch;
  fetchHost.fetch = jest.fn(() => Promise.reject(new Error('reader must not fetch'))) as typeof fetch;
});

afterEach(() => {
  fetchHost.fetch = originalFetch;
  Reflect.deleteProperty(navigator, 'share');
});

describe('real source sections', () => {
  test('keeps every bundled section text, citation, link, and status', () => {
    const corpus = realCorpus();
    expect(corpus.sourceRevision).toBe(TEXT_REVISION);
    expect(corpus.provider).toBe('static-sample');
    expect(corpus.sections).toHaveLength(sections.length);
    sections.forEach((source, index) => {
      const row = corpus.sections[index];
      expect(row.text).toBe(source.text);
      expect(row.officialCitation).toBe(source.official_cite);
      expect(row.sourceUrl).toBe(source.source_url);
      expect(row.status).toBe(source.law_status);
      expect(row.cid).toBe(source.ipfs_cid);
      expect(row.retrievedAt).toBe(source.retrieved_at);
      expect(row.sourceRevision).toBe(TEXT_REVISION);
      expect(row.contentAddress).toBe(`ipfs://${source.ipfs_cid}`);
    });
    const row = rightsDoc.records.find((item) => item.dataset_id === BUNDLED_NETHERLANDS_RIGHTS.datasetId);
    expect(row?.artifact_revision).toBe(BUNDLED_NETHERLANDS_RIGHTS.artifactRevision);
    expect(row?.card_sha256).toBe(BUNDLED_NETHERLANDS_RIGHTS.cardSha256);
    expect(row?.status).toBe('unresolved');
    expect(row?.rights).toBeNull();
    expect(row?.attribution).toBeNull();
    expect(row?.inferred_from_organization).toBe(false);
    expect(row?.grant_source).toBe(BUNDLED_NETHERLANDS_RIGHTS.grantSource);
    expect(row?.blocker?.reason).toBe(BUNDLED_NETHERLANDS_RIGHTS.blocker);
    expect(corpus.rights.downloadPermitted).toBe(false);
  });

  test('renders the criminal-code article from the source file', () => {
    open();
    expect(field('original-text')).toHaveTextContent(criminal.text);
    expect(field('original-text').textContent).toBe(criminal.text);
    expect(field('citation')).toHaveTextContent(criminal.official_cite);
    expect(field('bluebook')).toHaveTextContent(criminal.bluebook_citation);
    expect(field('revision')).toHaveTextContent(TEXT_REVISION);
    expect(field('provenance-revision')).toHaveTextContent(TEXT_REVISION);
    expect(field('source-status')).toHaveTextContent('current');
    expect(field('status')).toHaveTextContent('Current');
    expect(field('issuer')).toHaveTextContent('unknown');
    expect(field('effective')).toHaveTextContent('unknown');
    expect(field('law-language')).toHaveTextContent('unknown');
    expect(field('interface-language')).toHaveTextContent('en');
    expect(field('retrieved')).toHaveTextContent(criminal.retrieved_at ?? '');
    expect(field('dates')).toHaveTextContent('The version dates do not decide the status.');
    const official = screen.getByRole('link', { name: 'Official text' });
    expect(official).toHaveAttribute('href', criminal.source_url);
    expect(official).toHaveAttribute('target', '_blank');
    expect(official).toHaveAttribute('rel', 'noreferrer');
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent('Netherlands');
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent('Wetboek van Strafrecht');
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent('Artikel 1');
    expect(screen.getByText('This choice does not decide that a law applies.')).toBeInTheDocument();
    expect(field('coverage')).toHaveTextContent('quality-audited partial corpus, not full Dutch corpus coverage');
    expect(field('status-note')).toHaveTextContent(criminal.status_note ?? '');
    expect(fetchHost.fetch).not.toHaveBeenCalled();
  });

  test('loads the same bytes through the bundled source URLs', async () => {
    const fetcher = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('artifacts.manifest.json')) return { ok: true, status: 200, json: async () => manifest };
      if (url.includes('generated/sections.json')) {
        const body = sections.map((section) => section.ipfs_cid === criminal.ipfs_cid ? { ...section, text: `${section.text} FETCHED` } : section);
        return { ok: true, status: 200, json: async () => body };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });
    render(<LawReader recordId={criminal.law_id} sectionId={criminal.ipfs_cid} loadCorpus={() => fetchBundledReaderCorpus(fetcher as unknown as typeof fetch)} />);
    expect(await screen.findByText(`${criminal.text} FETCHED`)).toBeInTheDocument();
    expect(screen.queryByText(criminal.text)).not.toBeInTheDocument();
    const urls = fetcher.mock.calls.map((call) => String(call[0]));
    expect(urls.some((url) => url.includes('/corpus/netherlands/current/artifacts.manifest.json'))).toBe(true);
    expect(urls.some((url) => url.includes('/corpus/netherlands/current/generated/sections.json?v='))).toBe(true);
    expect(field('revision')).toHaveTextContent(TEXT_REVISION);
  });
});

describe('article navigation', () => {
  test('moves between the real instruments and keeps the source revision', async () => {
    const user = userEvent.setup();
    open();
    const articles = screen.getByRole('navigation', { name: 'Articles' });
    expect(within(articles).getByRole('link', { current: 'page' })).toHaveTextContent('Artikel 1');
    expect(within(articles).queryByRole('link', { name: 'Previous provision' })).not.toBeInTheDocument();
    expect(within(articles).queryByRole('link', { name: 'Next provision' })).not.toBeInTheDocument();
    expect(field('adjacent')).toHaveTextContent('No adjacent provision is in this source revision.');
    await user.click(screen.getByRole('link', { name: 'Burgerlijk Wetboek Boek 1' }));
    expect(field('original-text').textContent).toBe(civil.text);
    expect(field('citation')).toHaveTextContent(civil.official_cite);
    expect(screen.getByRole('link', { name: 'Official text' })).toHaveAttribute('href', civil.source_url);
    expect(field('revision')).toHaveTextContent(TEXT_REVISION);
    await user.click(screen.getByRole('link', { name: 'Wetboek van Burgerlijke Rechtsvordering' }));
    expect(field('original-text').textContent).toBe(procedure.text);
    expect(field('revision')).toHaveTextContent(TEXT_REVISION);
  });

  test('steps to the adjacent provision in the same instrument and revision', async () => {
    const user = userEvent.setup();
    const second: ReaderSectionInput = {
      ...criminal,
      ipfs_cid: `${criminal.ipfs_cid}art2`,
      identifier: 'BWBR0001854 Artikel 2',
      title: 'Wetboek van Strafrecht - Artikel 2',
      chapter: 'Artikel 2',
      article_number: '2',
      text: criminal.text,
    };
    open({ corpus: corpusFrom([criminal, second]) });
    await user.click(screen.getByRole('link', { name: 'Next provision' }));
    expect(screen.getByRole('link', { current: 'page' })).toHaveTextContent('Artikel 2');
    expect(field('original-text').textContent).toBe(criminal.text);
    expect(field('stable-link').textContent).toContain(encodeURIComponent(`${criminal.ipfs_cid}art2`));
    expect(field('revision')).toHaveTextContent(TEXT_REVISION);
    await user.click(screen.getByRole('link', { name: 'Previous provision' }));
    expect(screen.getByRole('link', { current: 'page' })).toHaveTextContent('Artikel 1');
  });
});

describe('translations, rights, and status labels', () => {
  test('labels a machine translation without changing the revision or the original text', () => {
    const row: ReaderSectionInput = {
      ...criminal,
      translation: { kind: 'machine', language: 'en', title: 'Criminal Code article 1', text: 'Machine wording beside the original.' },
    };
    open({ corpus: corpusFrom([row, civil, procedure]) });
    expect(field('original-title')).toHaveTextContent('Original title');
    expect(field('original-title')).toHaveTextContent(criminal.title);
    expect(field('original-text').textContent).toBe(criminal.text);
    expect(field('translation-label')).toHaveTextContent('Machine translation');
    expect(field('translation-label')).not.toHaveTextContent('Official translation');
    expect(field('translation-text')).toHaveTextContent('Machine wording beside the original.');
    expect(field('translation-revision')).toHaveTextContent(TEXT_REVISION);
    expect(field('translation-revision')).toHaveTextContent('This translation is not a new source revision.');
    expect(document.querySelector('.wwl')).toHaveAttribute('data-state', 'translated-text');
  });

  test('labels an official translation differently from a machine translation', () => {
    const row: ReaderSectionInput = {
      ...criminal,
      translation: { kind: 'official', language: 'en', text: 'Official wording beside the original.' },
    };
    open({ corpus: corpusFrom([row]) });
    expect(field('translation-label')).toHaveTextContent('Official translation');
    expect(screen.queryByText('Machine translation')).not.toBeInTheDocument();
    expect(field('revision')).toHaveTextContent(TEXT_REVISION);
  });

  test('shows unresolved rights and does not offer a download', () => {
    open();
    expect(field('rights-status')).toHaveTextContent('unresolved');
    expect(field('license')).toHaveTextContent('unknown');
    expect(field('blocker')).toHaveTextContent(BUNDLED_NETHERLANDS_RIGHTS.blocker);
    expect(field('rights-revision')).toHaveTextContent(BUNDLED_NETHERLANDS_RIGHTS.artifactRevision);
    expect(field('rights-card')).toHaveTextContent(BUNDLED_NETHERLANDS_RIGHTS.cardSha256);
    expect(field('grant-source')).toHaveTextContent('no-grant');
    expect(field('dataset')).toHaveTextContent(BUNDLED_NETHERLANDS_RIGHTS.datasetId);
    expect(field('provider')).toHaveTextContent('static-sample');
    expect(field('content-address')).toHaveTextContent(`ipfs://${criminal.ipfs_cid}`);
    expect(field('organization')).toHaveTextContent('Organization membership is not a redistribution license.');
    expect(field('download')).toHaveTextContent('Download is not permitted for this revision.');
    expect(screen.queryByRole('link', { name: /^Download$/ })).not.toBeInTheDocument();
    expect(field('rights-revision').textContent).not.toBe(field('revision').textContent);
  });

  test('downloads only a resolved grant, and only for that revision', () => {
    const granted: ReaderSectionInput = {
      ...criminal,
      download_url: 'https://example.test/law.txt',
      rights: {
        status: 'resolved',
        rights: 'CC0-1.0',
        attribution: 'Pinned card',
        inferred_from_organization: false,
        blocker: null,
        grant_source: 'pinned-card',
        downloadPermitted: true,
        artifact_revision: 'ab'.repeat(20),
      },
    };
    open({ corpus: corpusFrom([granted]) });
    const download = screen.getByRole('link', { name: /^Download$/ });
    const href = download.getAttribute('href') ?? '';
    expect(new URL(href).searchParams.get('revision')).toBe(TEXT_REVISION);
    expect(download).toHaveAttribute('download', `${criminal.law_id}-${TEXT_REVISION}.txt`);
    expect(field('license')).toHaveTextContent('CC0-1.0');
  });

  test('does not treat organization membership as a license', () => {
    const row: ReaderSectionInput = {
      ...criminal,
      download_url: 'https://example.test/law.txt',
      rights: {
        status: 'resolved',
        rights: 'CC0-1.0',
        inferred_from_organization: true,
        blocker: null,
        grant_source: 'organization',
      },
    };
    open({ corpus: corpusFrom([row]) });
    expect(screen.queryByRole('link', { name: /^Download$/ })).not.toBeInTheDocument();
    expect(field('download')).toHaveTextContent('Download is not permitted for this revision.');
  });

  test('uses distinct labels for historical text, future commencement, unknown status, and source outage', async () => {
    const labels = ['Historical text', 'Future commencement', 'Status unknown', 'Source outage', 'Machine translation', 'Official translation', 'Current'];
    expect(new Set(labels).size).toBe(labels.length);
    const historical = open({
      corpus: corpusFrom([{ ...criminal, law_status: 'historical', version_start_date: '1886-01-01', version_end_date: '1990-01-01' }]),
      asOf: null,
    });
    expect(field('status')).toHaveTextContent('Historical text');
    expect(field('status')).not.toHaveTextContent('Future commencement');
    historical.unmount();

    const future = open({
      corpus: corpusFrom([{ ...criminal, law_status: 'not-yet-in-force', version_start_date: '2099-01-01', version_end_open: true }]),
      asOf: null,
    });
    expect(field('status')).toHaveTextContent('Future commencement');
    expect(field('source-status')).toHaveTextContent('not-yet-in-force');
    future.unmount();

    const unknown = open({ corpus: corpusFrom([{ ...criminal, law_status: 'unknown' }]), asOf: null });
    expect(field('status')).toHaveTextContent('Status unknown');
    unknown.unmount();

    const loadCorpus = jest.fn(async () => {
      throw new Error('source down');
    });
    render(<LawReader loadCorpus={loadCorpus} />);
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(field('status')).toHaveTextContent('Source outage');
    expect(screen.getByText('This source is unavailable right now.')).toBeInTheDocument();
    expect(screen.queryByText(criminal.text)).not.toBeInTheDocument();
    expect(screen.queryByText('Status unknown')).not.toBeInTheDocument();
  });
});

describe('copy, share, and return', () => {
  test('copy and share keep the exact text revision', async () => {
    const user = userEvent.setup();
    const share = jest.fn(async () => true);
    Object.defineProperty(navigator, 'share', { configurable: true, value: share });
    open({ query: 'strafbaar' });
    expect(field('original-text').querySelector('mark')).toHaveTextContent('strafbaar');
    await user.click(screen.getByRole('button', { name: 'Copy citation' }));
    await waitFor(async () => {
      expect(await navigator.clipboard.readText()).toContain(criminal.official_cite);
    });
    const citation = await navigator.clipboard.readText();
    expect(citation).toContain(criminal.official_cite);
    expect(citation).toContain(`Revision ${TEXT_REVISION}`);
    expect(citation).toContain(criminal.source_url);
    expect(citation).not.toContain(BUNDLED_NETHERLANDS_RIGHTS.artifactRevision);
    expect(await screen.findByText(`Copied the citation for revision ${TEXT_REVISION}.`)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Copy link' }));
    await waitFor(async () => {
      expect(await navigator.clipboard.readText()).toContain(`/#/law/${criminal.law_id}`);
    });
    const link = await navigator.clipboard.readText();
    const params = new URLSearchParams(link.slice(link.indexOf('?') + 1));
    expect(params.get('revision')).toBe(TEXT_REVISION);
    expect(params.get('section')).toBe(criminal.ipfs_cid);
    expect(link).toContain(`/#/law/${criminal.law_id}`);
    expect(link).toBe(field('stable-link').textContent);

    await user.click(screen.getByRole('button', { name: 'Share' }));
    await waitFor(() => expect(share).toHaveBeenCalled());
    expect(share.mock.calls[0][0].url).toBe(link);
    expect(share.mock.calls[0][0].text).toContain(`Revision ${TEXT_REVISION}`);
  });

  test('back to results keeps the query and the scroll position', async () => {
    const user = userEvent.setup();
    const onReturn = jest.fn();
    const scrollTo = jest.spyOn(window, 'scrollTo').mockImplementation(() => {});
    const query = 'Wetboek van Strafrecht artikel 1 & legaliteitsbeginsel';
    render(
      <>
        <button id="opened-result" type="button">Opened result</button>
        <LawReader
          corpus={realCorpus()}
          recordId={criminal.law_id}
          sectionId={criminal.ipfs_cid}
          query={query}
          scroll={732}
          resultId="opened-result"
          placeId="place:netherlands"
          onReturn={onReturn}
        />
      </>,
    );
    const back = screen.getByRole('link', { name: /Back to results/ });
    const params = new URLSearchParams((back.getAttribute('href') ?? '').slice((back.getAttribute('href') ?? '').indexOf('?') + 1));
    expect(params.get('q')).toBe(query);
    expect(params.get('scroll')).toBe('732');
    expect(params.get('place')).toBe('place:netherlands');
    expect(readerReturnHref({ query, scroll: 732, placeId: 'place:netherlands' })).toBe(back.getAttribute('href'));
    await user.click(back);
    expect(onReturn).toHaveBeenCalledWith(expect.objectContaining({ query, scroll: 732, resultId: 'opened-result' }));
    expect(scrollTo).toHaveBeenCalledWith({ left: 0, top: 732, behavior: 'auto' });
    expect(document.activeElement).toBe(document.getElementById('opened-result'));
    scrollTo.mockRestore();
  });

  test('a floating or absent revision does not show another revision as the text', () => {
    expect(isFloatingRevision('latest')).toBe(true);
    expect(isFloatingRevision(TEXT_REVISION)).toBe(false);
    const { unmount } = open({ sourceRevision: 'latest' });
    expect(field('floating')).toHaveTextContent('latest');
    expect(screen.queryByText(criminal.text)).not.toBeInTheDocument();
    unmount();
    open({ sourceRevision: 'a'.repeat(40) });
    expect(field('missing-revision')).toHaveTextContent('a'.repeat(40));
    expect(screen.queryByText(criminal.text)).not.toBeInTheDocument();
    expect(field('missing-revision').textContent).toContain('This source does not contain the requested revision.');
  });
});

describe('as-of date, precision, and timezone', () => {
  function dated(start: string, end: string | null, revision: string, zone: string | null, openEnd = false): ReaderSectionInput {
    return {
      ...criminal,
      ipfs_cid: `${criminal.ipfs_cid}-${revision}`,
      text_version_id: revision,
      source_revision: revision,
      version_start_date: start,
      version_end_date: end,
      version_end_open: openEnd,
      time_zone: zone,
      law_status: 'current',
      text: criminal.text,
    };
  }

  test('a civil date is not shifted, and an instant uses the source timezone', () => {
    const amsterdam = dated('2010-01-01', '2020-01-01', 'rev-amsterdam-a', 'Europe/Amsterdam');
    const later = dated('2020-01-02', null, 'rev-amsterdam-b', 'Europe/Amsterdam', true);
    const corpus = corpusFrom([amsterdam, later]);
    const instant = '2020-01-01T23:30:00Z';
    const midday = '2020-01-01T15:30:00Z';
    expect(resolveReaderClock(instant, 'Europe/Amsterdam').civil).toBe('2020-01-02');
    expect(resolveReaderClock(instant, 'America/New_York').civil).toBe('2020-01-01');
    expect(resolveReaderClock(midday, 'Asia/Tokyo').civil).toBe('2020-01-02');
    expect(resolveReaderClock('2020-01-01', 'Asia/Tokyo')).toMatchObject({ kind: 'civil', civil: '2020-01-01', timeZoneApplied: false });
    const civilView = selectReaderView(corpus, { recordId: criminal.law_id, asOf: '2020-01-01', timeZone: 'Asia/Tokyo' });
    const nextDay = selectReaderView(corpus, { recordId: criminal.law_id, asOf: instant });
    const sourceWins = selectReaderView(corpus, { recordId: criminal.law_id, asOf: midday, timeZone: 'Asia/Tokyo' });
    const newYork = corpusFrom([
      dated('2010-01-01', '2020-01-01', 'rev-newyork-aaaa', 'America/New_York'),
      dated('2020-01-02', null, 'rev-newyork-bbbb', 'America/New_York', true),
    ]);
    const york = selectReaderView(newYork, { recordId: criminal.law_id, asOf: instant, timeZone: 'Asia/Tokyo' });
    expect(civilView.kind === 'section' && civilView.section.sourceRevision).toBe('rev-amsterdam-a');
    expect(nextDay.kind === 'section' && nextDay.section.sourceRevision).toBe('rev-amsterdam-b');
    expect(sourceWins.kind === 'section' && sourceWins.section.sourceRevision).toBe('rev-amsterdam-a');
    expect(york.kind === 'section' && york.section.sourceRevision).toBe('rev-newyork-aaaa');
    const blocked = selectReaderView(corpusFrom([
      dated('2010-01-01', '2020-01-01', 'rev-notzone-aaaa', null),
      dated('2020-01-02', null, 'rev-notzone-bbbb', null, true),
    ]), { recordId: criminal.law_id, asOf: instant });
    expect(blocked.kind).toBe('choose');
  });

  test('year precision does not pick one of two containing versions', () => {
    const early = dated('2010-01-01', '2020-06-01', 'rev-year-early01', 'Europe/Amsterdam');
    const late = dated('2020-08-01', null, 'rev-year-late0001', 'Europe/Amsterdam', true);
    const view = selectReaderView(corpusFrom([early, late]), { recordId: criminal.law_id, asOf: '2020' });
    expect(view.kind).toBe('choose');
    open({ corpus: corpusFrom([early, late]), sectionId: null, recordId: criminal.law_id, asOf: '2020' });
    expect(field('choose')).toHaveTextContent('More than one version contains this date at the source precision.');
    expect(screen.queryByText(criminal.text)).not.toBeInTheDocument();
    expect(screen.getByText('rev-year-early01')).toBeInTheDocument();
    expect(screen.getByText('rev-year-late0001')).toBeInTheDocument();
  });

  test('the end date stays inside, and copy keeps the opened revision when a later version matches', async () => {
    const user = userEvent.setup();
    const early = dated('1990-01-01', '2000-01-01', 'rev-historical-01', 'Europe/Amsterdam');
    const later = dated('2000-01-02', null, 'rev-current-00001', 'Europe/Amsterdam', true);
    open({
      corpus: corpusFrom([early, later]),
      sectionId: early.ipfs_cid,
      sourceRevision: 'rev-historical-01',
      asOf: '2000-01-01',
    });
    expect(field('status')).toHaveTextContent('Current');
    expect(field('revision')).toHaveTextContent('rev-historical-01');
    await user.clear(screen.getByLabelText('As of'));
    await user.type(screen.getByLabelText('As of'), '2024-06-01');
    expect(field('status')).toHaveTextContent('Historical text');
    expect(field('disagreement')).toBeInTheDocument();
    expect(field('revision')).toHaveTextContent('rev-historical-01');
    expect(screen.getByRole('link', { name: /Back to results/ }).getAttribute('href')).toContain('q=');
    await user.click(screen.getByRole('link', { name: 'Open the version that matches this date' }));
    expect(field('revision')).toHaveTextContent('rev-current-00001');
    expect(field('status')).toHaveTextContent('Current');
    expect(field('original-text').textContent).toBe(criminal.text);
    await user.click(screen.getByRole('button', { name: 'Copy link' }));
    await waitFor(async () => {
      expect(await navigator.clipboard.readText()).toContain('rev-current-00001');
    });
    const link = await navigator.clipboard.readText();
    expect(new URLSearchParams(link.slice(link.indexOf('?') + 1)).get('revision')).toBe('rev-current-00001');
    expect(link).not.toContain('rev-historical-01');
  });

  test('an unknown source timezone does not convert an instant into a version', () => {
    const early = dated('2010-01-01', '2020-01-01', 'rev-unknown-zonea', null);
    const later = dated('2020-01-02', null, 'rev-unknown-zoneb', null, true);
    open({ corpus: corpusFrom([early, later]), sectionId: null, recordId: criminal.law_id, asOf: '2020-01-01T23:30:00Z' });
    expect(field('choose')).toHaveTextContent('The source timezone is unknown.');
    expect(screen.queryByText(criminal.text)).not.toBeInTheDocument();
  });
});

describe('access and recovery', () => {
  test('back to results is the first control, and Arabic does not reorder the law text', () => {
    const { unmount } = open({ viewport: 'mobile' });
    const article = screen.getByRole('article');
    const first = article.querySelector('a, button, input, textarea, select');
    expect(first).toHaveAccessibleName(/Back to results/);
    expect(document.activeElement).toBe(document.getElementById('wwl-back-to-results'));
    unmount();
    const dutch: ReaderSectionInput = { ...criminal, language: 'nl' };
    open({ corpus: corpusFrom([dutch]), locale: 'ar', viewport: 'desktop' });
    expect(document.querySelector('.wwl')).toHaveAttribute('dir', 'rtl');
    expect(document.querySelector('.wwl')).toHaveAttribute('lang', 'ar');
    expect(screen.getByRole('link', { name: 'العودة إلى النتائج' })).toBeInTheDocument();
    expect(field('original-text')).toHaveAttribute('dir', 'ltr');
    expect(field('original-text')).toHaveAttribute('lang', 'nl');
    expect(field('interface-language')).toHaveTextContent('ar');
    expect(field('law-language')).toHaveTextContent('nl');
    expect(document.activeElement?.tagName).toBe('H2');
  });

  test('retry after a source outage reads the section', async () => {
    const user = userEvent.setup();
    let down = true;
    const loadCorpus = jest.fn(async () => {
      if (down) throw new Error('down');
      return realCorpus();
    });
    render(<LawReader recordId={criminal.law_id} sectionId={criminal.ipfs_cid} loadCorpus={loadCorpus} />);
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(field('status')).toHaveTextContent('Source outage');
    down = false;
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText(criminal.text)).toBeInTheDocument();
    expect(field('revision')).toHaveTextContent(TEXT_REVISION);
  });

  test('a stale catalog revision stays visible beside the saved revision', () => {
    open({ catalogRevision: 'f'.repeat(40) });
    expect(field('stale')).toHaveTextContent(TEXT_REVISION);
    expect(field('stale')).toHaveTextContent('f'.repeat(40));
    expect(document.querySelector('.wwl')).toHaveAttribute('data-state', 'stale-cache');
  });
});

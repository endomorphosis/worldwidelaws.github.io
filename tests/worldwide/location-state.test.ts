import { buildLawDeepLink } from '../../src/lib/worldwide/contracts';
import { NETHERLANDS_CURRENT_SAMPLE, NETHERLANDS_DECLARED_SOURCE_IDS } from '../../src/lib/worldwide/adapters/netherlands';
import {
  applySavedSelection,
  clearSavedSelection,
  createPlaceState,
  decodeSavedPlace,
  encodeSavedPlace,
  linkFor,
  navigate,
  noteEnvironment,
  originOutranks,
  placeLockedAgainstSuggestions,
  proposeScopeChange,
  acceptScopeProposal,
  receiveSuggestion,
  requestSuggestion,
  saveSelection,
  selectPlace,
  selectWorldwide,
  setAsOf,
  shareLink,
  applyDutchExample,
  PLACE_ORIGINS,
  PLACE_STATE_SCHEMA,
  SAVED_PLACE_SCHEMA,
} from '../../src/lib/worldwide/location/state';
import {
  DUTCH_EXAMPLE_QUERIES,
  DUTCH_HOME_ROUTE,
  DUTCH_INITIAL_EXAMPLE_ROUTE,
  ROUTE_CONTRACT_ID,
  ROUTE_NAMES,
  STABLE_NETHERLANDS_PLACE_ID,
  buildRoute,
  dutchExampleSuggestion,
  dutchMigrationTable,
  migrateDutchLink,
  parseCivilDate,
  parseRoute,
} from '../../src/lib/worldwide/routes';

const AMSTERDAM = 'place:amsterdam';
const ROTTERDAM = 'place:rotterdam';
const UTRECHT = 'place:utrecht';
const PLAN_HREF = '/#/search?q=parking&place=place%3Aamsterdam&date=2026-10-26&scope=place';
const SECRET = 'sentinel-search-text-9f3a';
const ADDRESS = 'Damrak 1';

function saved(placeId: string, asOf: string | null = null, savedAt = '2026-10-26T12:00:00Z') {
  return {
    schema: SAVED_PLACE_SCHEMA,
    placeId,
    label: placeId,
    asOf: asOf ? { value: asOf, precision: 'day' as const, source: 'saved' } : null,
    scope: 'place' as const,
    savedAt,
  };
}

describe('stable URL contract', () => {
  test('pins the route contract and the plan search link', () => {
    expect(ROUTE_CONTRACT_ID).toBe('worldwide-legal-search.route-contract@1');
    expect([...ROUTE_NAMES]).toEqual(['search', 'place', 'law', 'coverage', 'sources', 'compare']);
    const parsed = parseRoute(PLAN_HREF);
    expect(parsed.recognized).toBe(true);
    expect(parsed.placeId).toBe(AMSTERDAM);
    expect(parsed.date).toEqual({ value: '2026-10-26', precision: 'day' });
    expect(parsed.scope).toBe('place');
    expect(parsed.query).toBe('parking');
    expect(parsed.href).toBe(PLAN_HREF);
    expect(parsed.droppedPreciseKeys).toEqual([]);

    const state = createPlaceState({ href: PLAN_HREF });
    expect(state.schema).toBe(PLACE_STATE_SCHEMA);
    expect(state.placeId).toBe(AMSTERDAM);
    expect(state.origin).toBe('url');
    expect(state.originLabel).toBe('shared URL');
    expect(state.asOf).toEqual({ value: '2026-10-26', precision: 'day' });
    expect(shareLink(state)).toBe(PLAN_HREF);
  });

  test('keeps a law route beside the publisher link shape', () => {
    const built = buildRoute({
      name: 'law',
      recordId: 'record-1',
      sourceRevision: 'abc123',
      sectionId: 'section-1',
    });
    expect(built.href).toBe(buildLawDeepLink({
      publisherUrl: 'https://wetten.overheid.nl/BWBR0001854',
      recordId: 'record-1',
      sourceRevision: 'abc123',
      sectionId: 'section-1',
    }).applicationRoute);
    expect(built.issues).toEqual([]);
  });

  test('rejects codes, coordinate pairs, and impossible dates', () => {
    expect(parseCivilDate('2024-02-29')).toEqual({ value: '2024-02-29', precision: 'day' });
    expect(parseCivilDate('2025-02-29')).toBeNull();
    expect(parseCivilDate('2026-10')).toEqual({ value: '2026-10', precision: 'month' });
    expect(parseCivilDate('2026')).toEqual({ value: '2026', precision: 'year' });
    expect(parseCivilDate('2026-02-31')).toBeNull();
    expect(parseCivilDate('2026-10-26T00:00:00Z')).toBeNull();

    for (const token of ['NL', 'place:nl', 'place:us-ca', '52.3702,4.8952', 'issuer:amsterdam']) {
      const parsed = parseRoute(`/#/search?place=${encodeURIComponent(token)}`);
      expect(parsed.placeId).toBeNull();
      expect(parsed.placeTokenPresent).toBe(true);
      expect(parsed.issues.some((entry) => entry.code === 'code-used-as-identity' || entry.code === 'coordinates-are-not-a-place' || entry.code === 'invalid-place-id')).toBe(true);
    }
  });

  test('drops precise coordinates and addresses from the default shared link', () => {
    const href = `/#/search?place=${encodeURIComponent(AMSTERDAM)}&lat=52.3702&lon=4.8952&address=Damrak%201&date=2026-10-26`;
    const parsed = parseRoute(href);
    expect(parsed.placeId).toBe(AMSTERDAM);
    expect(parsed.precise).toEqual({ latitude: 52.3702, longitude: 4.8952, address: ADDRESS });
    expect(parsed.droppedPreciseKeys).toEqual(expect.arrayContaining(['lat', 'lon', 'address']));
    expect(parsed.href).not.toContain('lat');
    expect(parsed.href).not.toContain('52.3702');
    expect(parsed.href).not.toContain('Damrak');

    const state = createPlaceState({ href });
    expect(state.sessionCoordinates).toEqual({ latitude: 52.3702, longitude: 4.8952, address: ADDRESS });
    const shared = shareLink(state);
    expect(shared).toBe('/#/search?place=place%3Aamsterdam&date=2026-10-26&scope=place');
    expect(shared).not.toContain(ADDRESS);
    expect(shared).not.toContain('52.3702');

    const opted = shareLink(state, { includePreciseCoordinates: true });
    expect(opted).toContain('lat=52.3702');
    expect(opted).toContain('lon=4.8952');
    expect(opted).not.toContain('Damrak');
    const reloaded = createPlaceState({ href: opted });
    expect(reloaded.placeId).toBe(AMSTERDAM);
    expect(reloaded.sessionCoordinates?.latitude).toBe(52.3702);
    expect(shareLink(reloaded)).not.toContain('lat=');
    expect(shareLink(reloaded)).not.toContain(ADDRESS);
  });
});

describe('Dutch link migration', () => {
  test('follows the migration table for home, examples, publisher, sample, and source links', () => {
    const table = dutchMigrationTable();
    expect(table.map((row) => row.id)).toEqual([
      'dutch-home',
      'dutch-initial-example',
      'dutch-example',
      'dutch-publisher',
      'dutch-sample',
      'dutch-source',
    ]);
    expect(table.find((row) => row.id === 'dutch-home')?.applicationRoute).toBe(DUTCH_HOME_ROUTE);
    expect(table.find((row) => row.id === 'dutch-initial-example')?.applicationRoute).toBe(DUTCH_INITIAL_EXAMPLE_ROUTE);
    expect(table.find((row) => row.id === 'dutch-example')?.applicationRoute).toBeNull();
    expect(table.find((row) => row.id === 'dutch-example')?.changesPlace).toBe(false);
    expect(table.find((row) => row.id === 'dutch-publisher')?.publisherRemains).toBe(true);
    expect(table.find((row) => row.id === 'dutch-sample')?.coverageState).toBe('partial');

    expect(migrateDutchLink('https://wetwijzer.github.io/')?.href).toBe('/#/search');
    expect(migrateDutchLink('https://wetwijzer.github.io/index.html')?.href).toBe('/#/search');
    expect(migrateDutchLink('http://wetwijzer.github.io/')?.migrationId).toBe('dutch-home');
    expect(migrateDutchLink('index.html')?.href).toBe('/#/search');
    expect(migrateDutchLink('https://wetwijzer.github.io/?lat=52.37&lon=4.89')?.href).toBe('/#/search');
    expect(migrateDutchLink('https://wetwijzer.github.io/?lat=52.37&lon=4.89')?.href).not.toContain('52.37');

    const initial = migrateDutchLink(
      'https://wetwijzer.github.io/?q=Wetboek+van+Strafrecht+artikel+1&lat=52.37',
    );
    expect(initial?.href).toBe(DUTCH_INITIAL_EXAMPLE_ROUTE);
    expect(initial?.placeId).toBe(STABLE_NETHERLANDS_PLACE_ID);
    expect(initial?.legacyPlaceAlias).toBe(true);
    expect(initial?.href).not.toContain('52.37');

    const opened = createPlaceState({ href: DUTCH_INITIAL_EXAMPLE_ROUTE });
    expect(opened.placeId).toBe(STABLE_NETHERLANDS_PLACE_ID);
    expect(opened.origin).toBe('url');
    expect(opened.route.query).toBe('Wetboek van Strafrecht artikel 1');
    expect(parseRoute(DUTCH_INITIAL_EXAMPLE_ROUTE).href).toBe(DUTCH_INITIAL_EXAMPLE_ROUTE);

    for (const label of DUTCH_EXAMPLE_QUERIES) {
      const suggestion = dutchExampleSuggestion(label);
      expect(suggestion?.changesPlace).toBe(false);
      expect(suggestion?.applicationRoute).toBeNull();
      const migrated = migrateDutchLink(label);
      expect(migrated?.suggestionOnly).toBe(true);
      expect(migrated?.href).toBeNull();
    }

    const publisher = migrateDutchLink('http://wetten.overheid.nl/BWBR0001854/');
    expect(publisher?.publisherRemains).toBe(true);
    expect(publisher?.publisherUrl).toBe('https://wetten.overheid.nl/BWBR0001854');
    expect(publisher?.href).toBe('/#/law/BWBR0001854');
    expect(publisher?.href).not.toBe(publisher?.publisherUrl);
    expect(publisher?.placeId).toBeNull();
    expect(publisher?.date).toBeNull();

    const datedPublisher = migrateDutchLink('https://wetten.overheid.nl/BWBR0001854/2024-01-01');
    expect(datedPublisher?.recordId).toBe('BWBR0001854');
    expect(datedPublisher?.date).toBeNull();
    expect(datedPublisher?.publisherUrl).toBe('https://wetten.overheid.nl/BWBR0001854/2024-01-01');

    const sample = migrateDutchLink(NETHERLANDS_CURRENT_SAMPLE[0].ipfsCid);
    expect(sample?.migrationId).toBe('dutch-sample');
    expect(sample?.coverageState).toBe('partial');
    expect(sample?.href).toBe('/#/coverage?place=netherlands');
    expect(sample?.placeId).toBe(STABLE_NETHERLANDS_PLACE_ID);

    const sourceId = NETHERLANDS_DECLARED_SOURCE_IDS.unified;
    const source = migrateDutchLink(`https://huggingface.co/datasets/${sourceId}`);
    expect(source?.name).toBe('sources');
    expect(source?.sourceId).toBe(sourceId);
    expect(source?.href).toBe(`/#/sources/${encodeURIComponent(sourceId)}`);
    expect(source?.placeId).toBeNull();
  });
});

describe('place state precedence', () => {
  test('ranks URL above manual, saved, suggestion, and unselected', () => {
    expect([...PLACE_ORIGINS]).toEqual(['url', 'manual', 'saved', 'suggestion', 'unselected']);
    expect(originOutranks('url', 'manual')).toBe(true);
    expect(originOutranks('manual', 'saved')).toBe(true);
    expect(originOutranks('saved', 'suggestion')).toBe(true);
    expect(originOutranks('suggestion', 'unselected')).toBe(true);
    expect(originOutranks('suggestion', 'saved')).toBe(false);

    const fromUrl = createPlaceState({
      href: `/#/search?place=${encodeURIComponent(AMSTERDAM)}&date=2026-01-01`,
      session: { placeId: ROTTERDAM },
      saved: saved(UTRECHT, '2020-01-01'),
    });
    expect(fromUrl.placeId).toBe(AMSTERDAM);
    expect(fromUrl.origin).toBe('url');
    expect(fromUrl.asOf?.value).toBe('2026-01-01');
    expect(fromUrl.saved?.placeId).toBe(UTRECHT);
    expect(placeLockedAgainstSuggestions(fromUrl)).toBe(true);

    const fromSession = createPlaceState({
      session: { placeId: ROTTERDAM, label: 'Rotterdam' },
      saved: saved(UTRECHT),
    });
    expect(fromSession.placeId).toBe(ROTTERDAM);
    expect(fromSession.origin).toBe('manual');
    expect(fromSession.originLabel).toBe('manually selected');

    const fromSaved = createPlaceState({ saved: saved(UTRECHT, '2024-05-01') });
    expect(fromSaved.placeId).toBe(UTRECHT);
    expect(fromSaved.origin).toBe('saved');
    expect(fromSaved.originLabel).toBe('saved selection');
    expect(fromSaved.asOf?.value).toBe('2024-05-01');

    const worldwide = createPlaceState({
      session: { worldwide: true },
      saved: saved(UTRECHT),
    });
    expect(worldwide.placeId).toBeNull();
    expect(worldwide.origin).toBe('manual');
    expect(worldwide.scope).toBe('worldwide');

    const empty = createPlaceState({ language: 'nl-NL', timeZone: 'Europe/Amsterdam' });
    expect(empty.placeId).toBeNull();
    expect(empty.origin).toBe('unselected');
    expect(empty.originLabel).toBe('unselected worldwide');
    expect(empty.scope).toBe('worldwide');
    expect(empty.asOf).toBeNull();
    expect(empty.uiLanguageSuggestion).toBe('nl');
    expect(empty.timeZoneNoted).toBe('Europe/Amsterdam');
    expect(shareLink(empty)).toBe('/#/search?scope=worldwide');
  });

  test('keeps a URL date when the place comes from a saved selection', () => {
    const state = createPlaceState({
      href: '/#/search?date=2026-10-26',
      saved: saved(AMSTERDAM, '2020-01-01'),
    });
    expect(state.placeId).toBe(AMSTERDAM);
    expect(state.origin).toBe('saved');
    expect(state.asOf).toEqual({ value: '2026-10-26', precision: 'day' });
    expect(state.asOfSource).toBe('url');
  });

  test('does not let language, timezone, or a search proposal choose a jurisdiction', () => {
    let state = createPlaceState({ href: PLAN_HREF, language: 'nl-NL', timeZone: 'Europe/Amsterdam' });
    state = noteEnvironment(state, { language: 'fr-FR', timeZone: 'Asia/Tokyo' });
    expect(state.placeId).toBe(AMSTERDAM);
    expect(state.asOf?.value).toBe('2026-10-26');
    expect(state.uiLanguageSuggestion).toBe('fr');
    expect(state.timeZoneNoted).toBe('Asia/Tokyo');

    const proposed = proposeScopeChange(state, { placeId: ROTTERDAM, label: 'Rotterdam', query: 'parking' });
    expect(proposed.placeId).toBe(AMSTERDAM);
    expect(proposed.origin).toBe('url');
    expect(proposed.proposal?.placeId).toBe(ROTTERDAM);
    const accepted = acceptScopeProposal(proposed);
    expect(accepted.placeId).toBe(ROTTERDAM);
    expect(accepted.origin).toBe('manual');
    expect(accepted.asOf?.value).toBe('2026-10-26');
  });
});

describe('late location responses', () => {
  test.each(['geoip', 'device'] as const)(
    'a late %s response cannot override a URL, manual, or saved choice',
    (kind) => {
      const urlState = requestSuggestion(
        createPlaceState({ href: `/#/search?place=${encodeURIComponent(AMSTERDAM)}` }),
        { requestId: `${kind}-url`, kind },
      );
      const afterUrl = receiveSuggestion(urlState, {
        requestId: `${kind}-url`,
        kind,
        placeId: ROTTERDAM,
        level: 'city',
        coordinates: { latitude: 51.92, longitude: 4.48 },
        address: ADDRESS,
        query: SECRET,
      });
      expect(afterUrl.placeId).toBe(AMSTERDAM);
      expect(afterUrl.origin).toBe('url');
      expect(afterUrl.ignored.at(-1)?.reason).toBe('explicit-choice');
      expect(afterUrl.sessionCoordinates).toBeNull();
      expect(JSON.stringify(afterUrl)).not.toContain(SECRET);
      expect(JSON.stringify(afterUrl)).not.toContain(ADDRESS);

      let manual = requestSuggestion(createPlaceState(), { requestId: `${kind}-manual`, kind });
      manual = selectPlace(manual, { placeId: AMSTERDAM, label: 'Amsterdam' });
      manual = receiveSuggestion(manual, { requestId: `${kind}-manual`, kind, placeId: ROTTERDAM, level: 'city' });
      expect(manual.placeId).toBe(AMSTERDAM);
      expect(manual.origin).toBe('manual');
      expect(manual.ignored.at(-1)?.reason).toBe('explicit-choice');

      let stored = requestSuggestion(createPlaceState({ saved: saved(AMSTERDAM) }), { requestId: `${kind}-saved`, kind });
      stored = receiveSuggestion(stored, { requestId: `${kind}-saved`, kind, placeId: ROTTERDAM, level: 'city' });
      expect(stored.placeId).toBe(AMSTERDAM);
      expect(stored.origin).toBe('saved');
      expect(stored.ignored.at(-1)?.reason).toBe('explicit-choice');
    },
  );

  test('applies one suggestion only while the place is still unselected', () => {
    let state = setAsOf(createPlaceState(), '2026-10-26');
    state = requestSuggestion(state, { requestId: 'g1', kind: 'geoip' });
    state = receiveSuggestion(state, {
      requestId: 'g1',
      kind: 'geoip',
      placeId: STABLE_NETHERLANDS_PLACE_ID,
      level: 'country',
      label: 'Netherlands',
      coordinates: { latitude: 52.1, longitude: 5.1 },
      date: '1999-01-01',
      timeZone: 'Europe/Amsterdam',
      query: SECRET,
    });
    expect(state.placeId).toBe(STABLE_NETHERLANDS_PLACE_ID);
    expect(state.origin).toBe('suggestion');
    expect(state.originLabel).toBe('approximate IP location');
    expect(state.asOf?.value).toBe('2026-10-26');
    expect(state.uncertainty.join(' ')).toContain('No city was selected');
    expect(JSON.stringify(state)).not.toContain(SECRET);
    expect(shareLink(state)).not.toContain('52.1');
    expect(shareLink(state)).toContain('date=2026-10-26');

    const duplicate = receiveSuggestion(state, {
      requestId: 'g1',
      kind: 'geoip',
      placeId: ROTTERDAM,
      level: 'city',
    });
    expect(duplicate.placeId).toBe(STABLE_NETHERLANDS_PLACE_ID);
    expect(duplicate.ignored.at(-1)?.reason).toBe('stale-request');
  });

  test('a saved place loaded after the request outranks the response', () => {
    let state = requestSuggestion(createPlaceState(), { requestId: 'late-saved', kind: 'geoip' });
    state = applySavedSelection(state, saved(AMSTERDAM));
    state = receiveSuggestion(state, { requestId: 'late-saved', kind: 'geoip', placeId: ROTTERDAM, level: 'city' });
    expect(state.placeId).toBe(AMSTERDAM);
    expect(state.origin).toBe('saved');
    expect(state.ignored.at(-1)?.reason).toBe('explicit-choice');
  });

  test('a country-only guess does not choose a city and a border stays unresolved', () => {
    let country = requestSuggestion(createPlaceState(), { requestId: 'country', kind: 'geoip' });
    country = receiveSuggestion(country, {
      requestId: 'country',
      kind: 'geoip',
      countryOnly: true,
      level: 'city',
      placeId: AMSTERDAM,
      coordinates: { latitude: 52.37, longitude: 4.89 },
    });
    expect(country.placeId).toBeNull();
    expect(country.origin).toBe('unselected');
    expect(country.ignored.at(-1)?.reason).toBe('country-only');
    expect(country.sessionCoordinates).toBeNull();
    expect(country.uncertainty.join(' ')).toContain('did not choose a city');

    let border = requestSuggestion(createPlaceState(), { requestId: 'border', kind: 'device' });
    border = receiveSuggestion(border, {
      requestId: 'border',
      kind: 'device',
      placeId: AMSTERDAM,
      candidates: [
        { placeId: AMSTERDAM, label: 'Amsterdam' },
        { placeId: ROTTERDAM, label: 'Rotterdam' },
      ],
      coordinates: { latitude: 52.37, longitude: 4.89 },
    });
    expect(border.placeId).toBeNull();
    expect(border.candidates.map((candidate) => candidate.placeId)).toEqual([AMSTERDAM, ROTTERDAM]);
    expect(border.sessionCoordinates).toBeNull();
    expect(border.nextAction).toContain('Choose the jurisdiction');
    border = selectPlace(border, { placeId: ROTTERDAM, uncertainty: ['The visitor chose this border candidate.'] });
    expect(border.placeId).toBe(ROTTERDAM);
    expect(border.origin).toBe('manual');
    expect(border.uncertainty).toEqual(['The visitor chose this border candidate.']);

    let coordinateUrl = createPlaceState({ href: '/#/search?place=52.3702%2C4.8952' });
    expect(coordinateUrl.placeId).toBeNull();
    expect(coordinateUrl.origin).toBe('url');
    expect(shareLink(coordinateUrl)).not.toContain('52.3702');
    coordinateUrl = requestSuggestion(coordinateUrl, { requestId: 'after-coordinates', kind: 'geoip' });
    coordinateUrl = receiveSuggestion(coordinateUrl, {
      requestId: 'after-coordinates',
      kind: 'geoip',
      placeId: AMSTERDAM,
      level: 'city',
    });
    expect(coordinateUrl.placeId).toBeNull();
    expect(coordinateUrl.ignored.at(-1)?.reason).toBe('explicit-choice');
    coordinateUrl = selectPlace(coordinateUrl, { placeId: AMSTERDAM });
    expect(coordinateUrl.placeId).toBe(AMSTERDAM);
    expect(coordinateUrl.origin).toBe('manual');
  });

  test('an explicit worldwide choice blocks a late suggestion', () => {
    let state = requestSuggestion(createPlaceState(), { requestId: 'world', kind: 'geoip' });
    state = selectWorldwide(state);
    state = receiveSuggestion(state, { requestId: 'world', kind: 'geoip', placeId: AMSTERDAM, level: 'city' });
    expect(state.placeId).toBeNull();
    expect(state.scope).toBe('worldwide');
    expect(state.origin).toBe('manual');
    expect(state.ignored.at(-1)?.reason).toBe('explicit-choice');
  });
});

describe('navigation and saved places', () => {
  test('place and time survive navigation, including old Dutch links', () => {
    let state = createPlaceState({ href: PLAN_HREF });
    const lawHref = '/#/law/BWBR0001854?revision=2026-06-27T00%3A00%3A00Z&section=section-1';
    state = navigate(state, lawHref);
    expect(state.route.name).toBe('law');
    expect(state.route.recordId).toBe('BWBR0001854');
    expect(state.placeId).toBe(AMSTERDAM);
    expect(state.asOf).toEqual({ value: '2026-10-26', precision: 'day' });
    expect(state.origin).toBe('url');
    const sharedLaw = shareLink(state);
    expect(sharedLaw).toContain('/#/law/BWBR0001854');
    expect(sharedLaw).toContain('place=place%3Aamsterdam');
    expect(sharedLaw).toContain('date=2026-10-26');
    expect(sharedLaw).not.toContain('lat=');

    state = navigate(state, 'https://wetten.overheid.nl/BWBR0002656');
    expect(state.route.recordId).toBe('BWBR0002656');
    expect(state.route.publisherRemains).toBe(true);
    expect(state.placeId).toBe(AMSTERDAM);
    expect(state.asOf?.value).toBe('2026-10-26');

    state = navigate(state, 'https://wetwijzer.github.io/');
    expect(state.route.name).toBe('search');
    expect(state.placeId).toBe(AMSTERDAM);
    expect(state.asOf?.value).toBe('2026-10-26');

    state = navigate(state, '/#/search?q=other');
    expect(state.route.query).toBe('other');
    expect(state.placeId).toBe(AMSTERDAM);
    expect(state.asOf?.value).toBe('2026-10-26');

    const beforeMalformed = { placeId: state.placeId, asOf: state.asOf, name: state.route.name };
    state = navigate(state, '%%%');
    expect(state.placeId).toBe(beforeMalformed.placeId);
    expect(state.asOf).toEqual(beforeMalformed.asOf);
    expect(state.route.name).toBe(beforeMalformed.name);

    state = navigate(state, '/#/search?date=2026-02-31');
    expect(state.asOf?.value).toBe('2026-10-26');
    expect(state.placeId).toBe(AMSTERDAM);
    expect(state.issues.some((entry) => entry.code === 'invalid-date')).toBe(true);

    state = navigate(state, `/#/place/${encodeURIComponent(ROTTERDAM)}`);
    expect(state.placeId).toBe(ROTTERDAM);
    expect(state.origin).toBe('url');
    expect(state.asOf?.value).toBe('2026-10-26');

    state = applyDutchExample(state, 'Burgerlijk Wetboek');
    expect(state.route.query).toBe('Burgerlijk Wetboek');
    expect(state.placeId).toBe(ROTTERDAM);
    expect(state.asOf?.value).toBe('2026-10-26');

    const carried = createPlaceState({ href: PLAN_HREF });
    for (const name of ROUTE_NAMES) {
      const href = linkFor(carried, name, {
        recordId: 'BWBR0001854',
        sourceRevision: 'rev-1234567890ab',
        sectionId: 'section-1',
        sourceId: NETHERLANDS_DECLARED_SOURCE_IDS.unified,
        comparePlaceIds: [AMSTERDAM, ROTTERDAM],
        query: 'parking',
      });
      const parsed = parseRoute(href);
      expect(parsed.placeId).toBe(AMSTERDAM);
      expect(parsed.date).toEqual({ value: '2026-10-26', precision: 'day' });
      const moved = navigate(carried, href);
      expect(moved.placeId).toBe(AMSTERDAM);
      expect(moved.asOf).toEqual(carried.asOf);
      expect(moved.route.name).toBe(name);
      expect(href).not.toContain('52.3702');
    }
  });

  test('saves a place without coordinates and restores it below a URL', () => {
    let state = createPlaceState({
      href: `/#/search?place=${encodeURIComponent(AMSTERDAM)}&lat=52.3702&lon=4.8952&address=Damrak%201`,
    });
    state = saveSelection(state, '2026-10-26T12:00:00Z');
    expect(state.origin).toBe('url');
    const encoded = encodeSavedPlace(state.saved!);
    expect(encoded).not.toContain('52.3702');
    expect(encoded).not.toContain('Damrak');
    expect(encoded).not.toContain('latitude');
    const decoded = decodeSavedPlace(encoded);
    expect(decoded).toEqual({
      schema: SAVED_PLACE_SCHEMA,
      placeId: AMSTERDAM,
      label: null,
      asOf: null,
      scope: 'place',
      savedAt: '2026-10-26T12:00:00Z',
    });
    const leaked = decodeSavedPlace(JSON.stringify({
      schema: SAVED_PLACE_SCHEMA,
      placeId: ROTTERDAM,
      label: 'Rotterdam',
      asOf: null,
      scope: 'place',
      savedAt: '2026-10-26T12:00:00Z',
      latitude: 51.92,
      longitude: 4.48,
      address: ADDRESS,
    }));
    expect(leaked?.placeId).toBe(ROTTERDAM);
    expect(JSON.stringify(leaked)).not.toContain('51.92');
    expect(JSON.stringify(leaked)).not.toContain(ADDRESS);

    const restored = createPlaceState({ saved: decoded });
    expect(restored.origin).toBe('saved');
    expect(restored.placeId).toBe(AMSTERDAM);
    expect(restored.sessionCoordinates).toBeNull();
    expect(shareLink(restored)).not.toContain('lat');

    const cleared = clearSavedSelection(restored);
    expect(cleared.origin).toBe('unselected');
    expect(cleared.placeId).toBeNull();
    expect(cleared.saved).toBeNull();

    const manual = selectPlace(createPlaceState(), { placeId: ROTTERDAM });
    const kept = applySavedSelection(manual, saved(UTRECHT));
    expect(kept.placeId).toBe(ROTTERDAM);
    expect(kept.origin).toBe('manual');
    expect(kept.saved?.placeId).toBe(UTRECHT);
  });

  test('a manual date change does not drop the place', () => {
    let state = createPlaceState({ href: PLAN_HREF });
    state = setAsOf(state, '2024-02-29');
    expect(state.asOf).toEqual({ value: '2024-02-29', precision: 'day' });
    expect(state.placeId).toBe(AMSTERDAM);
    state = setAsOf(state, '2025-02-29');
    expect(state.asOf?.value).toBe('2024-02-29');
    expect(state.placeId).toBe(AMSTERDAM);
    state = setAsOf(state, '2026-10');
    expect(state.asOf).toEqual({ value: '2026-10', precision: 'month' });
    expect(shareLink(state)).toContain('date=2026-10');
    expect(shareLink(state)).toContain('place=place%3Aamsterdam');
  });
});

/**
 * Manual place search and disambiguation.
 *
 * The catalog is a synthetic jurisdiction fixture. Expected parents are the
 * administrative chain in that fixture. Nothing here decides that a law applies.
 */

import { jest } from '@jest/globals';
import { useState } from 'react';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { admitJurisdictionGraph, type JurisdictionGraph } from '../../src/lib/worldwide/jurisdiction/schema';
import type { GeoPosition, GeometryRecord } from '../../src/lib/worldwide/jurisdiction/resolve';
import { createPlaceState, shareLink, type PlaceState } from '../../src/lib/worldwide/location/state';
import PlacePicker, { type PostcodeRecord } from '../../src/components/worldwide/PlacePicker';

const REVISION = 'a'.repeat(40);
const AS_OF = '2026-10-26';

function known(value: string, precision: 'day' | 'month' | 'year' = 'year') {
  return { knowledge: 'known' as const, value, precision, source: 'fixture' };
}

function openEnd() {
  return { knowledge: 'open' as const, value: null, precision: null, source: 'fixture' };
}

function openValid(start = '1000') {
  return { start: known(start), end: openEnd() };
}

function closedValid(start: string, end: string) {
  return { start: known(start, 'day'), end: known(end, 'day') };
}

function boundary(boundaryId: string, extra: Record<string, unknown> = {}) {
  return {
    boundaryId,
    role: 'primary',
    geometryKnowledge: 'known',
    geometryRef: `artifact:${boundaryId}`,
    provenance: {
      sourceId: 'registry:place-picker-fixture',
      sourceRevision: REVISION,
      attribution: 'Synthetic fixture geometry',
      license: 'fixture',
    },
    valid: openValid(),
    flags: [],
    ...extra,
  };
}

function place(
  id: string,
  level: string,
  opts: {
    name?: string;
    aliases?: unknown[];
    parentKnowledge?: string;
    boundaries?: unknown[];
    valid?: unknown;
  } = {},
) {
  return {
    id,
    roles: ['place'],
    names: [{ text: opts.name ?? id, language: 'en', script: 'Latn' }],
    aliases: opts.aliases ?? [],
    level: { kind: level },
    externalIds: [],
    parentKnowledge: opts.parentKnowledge ?? 'none',
    issuerKnowledge: 'none',
    issuerIds: [],
    boundaries: opts.boundaries ?? [boundary(`boundary:${id.slice(id.indexOf(':') + 1)}`)],
    valid: opts.valid ?? openValid(),
  };
}

function edge(id: string, fromId: string, toId: string) {
  return {
    id,
    kind: 'administrative-containment',
    fromId,
    toId,
    knowledge: 'known',
    evidence: [],
    valid: openValid(),
  };
}

function ring(west: number, south: number, east: number, north: number): GeoPosition[] {
  return [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
    [west, south],
  ];
}

function rect(boundaryId: string, west: number, south: number, east: number, north: number): GeometryRecord {
  return {
    geometryRef: `artifact:${boundaryId}`,
    type: 'Polygon',
    coordinates: [ring(west, south, east, north)],
  };
}

function loadGraph(): JurisdictionGraph {
  const admitted = admitJurisdictionGraph({
    graphId: 'graph:place-picker-fixture',
    sourceId: 'registry:place-picker-fixture',
    sourceRevision: REVISION,
    publisherId: 'publisher:fixture',
    observedAt: '2026-10',
    nodes: [
      place('place:netherlands', 'country', {
        name: 'Netherlands',
        aliases: [
          { text: 'Nederland', language: 'nl', script: 'Latn', kind: 'native' },
          { text: 'NL', kind: 'code' },
        ],
      }),
      place('place:north-holland', 'region', {
        name: 'North Holland',
        parentKnowledge: 'known',
        aliases: [{ text: 'Noord-Holland', language: 'nl', script: 'Latn', kind: 'native' }],
      }),
      place('place:amsterdam', 'municipality', {
        name: 'Amsterdam',
        parentKnowledge: 'known',
      }),
      place('place:south-holland', 'region', {
        name: 'South Holland',
        parentKnowledge: 'known',
      }),
      place('place:the-hague', 'municipality', {
        name: 'The Hague',
        parentKnowledge: 'known',
        aliases: [
          { text: 'Den Haag', language: 'nl', script: 'Latn', kind: 'native' },
          { text: "'s-Gravenhage", language: 'nl', script: 'Latn', kind: 'official' },
        ],
      }),
      place('place:exampleland', 'country', {
        name: 'Exampleland',
        aliases: [{ text: 'EX', kind: 'code' }],
      }),
      place('place:north-example', 'region', {
        name: 'North Example',
        parentKnowledge: 'known',
      }),
      place('place:south-example', 'region', {
        name: 'South Example',
        parentKnowledge: 'known',
      }),
      place('place:springfield-north', 'municipality', {
        name: 'Springfield',
        parentKnowledge: 'known',
        aliases: [{
          text: 'Fort Spring',
          language: 'en',
          script: 'Latn',
          kind: 'historical',
          valid: closedValid('1800-01-01', '1899-12-31'),
        }],
      }),
      place('place:springfield-south', 'municipality', {
        name: 'Springfield',
        parentKnowledge: 'known',
      }),
      place('place:city-state', 'country', { name: 'City State' }),
      place('place:capital', 'municipality', {
        name: 'Capital',
        parentKnowledge: 'known',
      }),
      place('place:former-town', 'district', {
        name: 'Former Town',
        valid: closedValid('1800-01-01', '1899-12-31'),
        boundaries: [boundary('boundary:former-town', { valid: closedValid('1800-01-01', '1899-12-31') })],
      }),
      place('place:orphan-town', 'municipality', {
        name: 'Orphan Town',
        parentKnowledge: 'unknown',
        boundaries: [],
      }),
    ],
    edges: [
      edge('edge:north-holland', 'place:north-holland', 'place:netherlands'),
      edge('edge:south-holland', 'place:south-holland', 'place:netherlands'),
      edge('edge:amsterdam', 'place:amsterdam', 'place:north-holland'),
      edge('edge:the-hague', 'place:the-hague', 'place:south-holland'),
      edge('edge:north-example', 'place:north-example', 'place:exampleland'),
      edge('edge:south-example', 'place:south-example', 'place:exampleland'),
      edge('edge:springfield-north', 'place:springfield-north', 'place:north-example'),
      edge('edge:springfield-south', 'place:springfield-south', 'place:south-example'),
      edge('edge:capital', 'place:capital', 'place:city-state'),
    ],
    unknownRelationships: [
      {
        subjectId: 'place:orphan-town',
        about: 'administrative-parent',
        reason: 'No administrative parent was recorded for this municipality.',
      },
      {
        subjectId: 'place:orphan-town',
        about: 'boundary',
        reason: 'No polygon was admitted for this municipality.',
      },
    ],
  });
  if (!admitted.graph) {
    const detail = admitted.quarantined.map((item) => `${item.reason}: ${item.detail}`).join('\n');
    throw new Error(`place picker fixture was quarantined:\n${detail}`);
  }
  return admitted.graph;
}

const graph = loadGraph();

const GEOMETRIES: GeometryRecord[] = [
  rect('boundary:netherlands', 4, 51, 7, 54),
  rect('boundary:north-holland', 4.5, 52.2, 5.2, 53.2),
  rect('boundary:amsterdam', 4.7, 52.3, 5, 52.5),
  rect('boundary:south-holland', 4.1, 51.7, 4.6, 52.1),
  rect('boundary:the-hague', 4.25, 51.95, 4.4, 52.05),
  rect('boundary:exampleland', 10, 10, 20, 20),
  rect('boundary:north-example', 10, 15, 20, 20),
  rect('boundary:south-example', 10, 10, 20, 15),
  rect('boundary:springfield-north', 12, 15, 14, 18),
  rect('boundary:springfield-south', 12, 12, 14, 15),
  rect('boundary:city-state', 30, 30, 32, 32),
  rect('boundary:capital', 30.2, 30.2, 30.8, 30.8),
  rect('boundary:former-town', 40, 40, 40.4, 40.4),
];

const POSTCODES: PostcodeRecord[] = [
  { code: '1012 JS', placeId: 'place:amsterdam', license: 'CC0-1.0', attribution: 'Synthetic postal fixture' },
  { code: '2511 AA', placeId: 'place:the-hague', license: 'CC-BY-4.0', attribution: 'Synthetic postal fixture' },
  { code: '0110 AA', placeId: 'place:springfield-north', license: 'CC0-1.0', attribution: 'Synthetic postal fixture' },
  { code: '0110 AA', placeId: 'place:springfield-south', license: 'CC0-1.0', attribution: 'Synthetic postal fixture' },
  { code: '9999 XX', placeId: 'place:amsterdam', license: null, licensed: false },
  { code: '8888 XX', placeId: 'place:amsterdam', license: 'unlicensed' },
];

const geo = {
  getCurrentPosition: jest.fn(),
  watchPosition: jest.fn(),
  clearWatch: jest.fn(),
};

beforeAll(() => {
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    writable: true,
    value: geo,
  });
});

afterEach(() => {
  expect(geo.getCurrentPosition).not.toHaveBeenCalled();
  expect(geo.watchPosition).not.toHaveBeenCalled();
  geo.getCurrentPosition.mockClear();
  geo.watchPosition.mockClear();
});

function Harness({
  onSelect,
  onState,
  geometries,
  postcodes,
  asOf = AS_OF,
}: {
  onSelect: (selection: { placeId: string; scope: string }) => void;
  onState: (state: PlaceState) => void;
  geometries?: readonly GeometryRecord[] | null;
  postcodes?: readonly PostcodeRecord[] | null;
  asOf?: string;
}) {
  const [placeState, setPlaceState] = useState(() => createPlaceState());
  return (
    <PlacePicker
      graph={graph}
      asOf={asOf}
      geometries={geometries}
      postcodes={postcodes}
      placeState={placeState}
      onPlaceState={(next) => {
        onState(next);
        setPlaceState(next);
      }}
      onSelect={onSelect}
    />
  );
}

function renderPicker(options?: {
  geometries?: readonly GeometryRecord[] | null;
  postcodes?: readonly PostcodeRecord[] | null;
  asOf?: string;
}) {
  const onSelect = jest.fn();
  const states: PlaceState[] = [];
  const user = userEvent.setup({ delay: null });
  const view = render(
    <Harness
      onSelect={onSelect}
      onState={(state) => {
        states.push(state);
      }}
      geometries={options && 'geometries' in options ? options.geometries : GEOMETRIES}
      postcodes={options && 'postcodes' in options ? options.postcodes : POSTCODES}
      asOf={options?.asOf ?? AS_OF}
    />,
  );
  return { ...view, user, onSelect, states };
}

function expectManual(container: HTMLElement) {
  expect(container.querySelector('[data-place-picker="manual"]')).not.toBeNull();
  expect(container.querySelector('canvas, iframe, img, svg, [data-map], .leaflet-container')).toBeNull();
  expect(container).toHaveTextContent('does not use a map or request your location');
  expect(screen.queryByRole('alert')).toBeNull();
}

function focus(element: HTMLElement) {
  act(() => {
    element.focus();
  });
}

async function typeInto(user: ReturnType<typeof userEvent.setup>, label: RegExp | string, text: string) {
  const field = screen.getByRole('combobox', { name: label });
  focus(field);
  await user.keyboard(text);
  return field;
}

describe('manual place picker', () => {
  it('selects a country, region, and municipality from the keyboard with full parent context', async () => {
    const { user, onSelect, states, container } = renderPicker();
    expect(screen.getByRole('heading', { name: 'Change place' })).toBeInTheDocument();
    await user.tab();
    const search = screen.getByRole('combobox', { name: 'Search places by name or native alias' });
    expect(search).toHaveFocus();
    await user.tab();
    const countries = screen.getByRole('listbox', { name: 'Countries' });
    expect(countries).toHaveFocus();
    await user.keyboard('n');
    await user.keyboard('{Enter}');

    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({
      placeId: 'place:netherlands',
      entry: 'browse',
      levelKind: 'country',
      scope: 'place',
      nativeAlias: 'Nederland',
    }));
    expect(screen.getByText(/Current place: Netherlands\. manually selected\./)).toBeInTheDocument();
    expect(states.at(-1)).toMatchObject({
      placeId: 'place:netherlands',
      origin: 'manual',
      channel: 'manual',
      label: 'Netherlands',
    });

    await user.keyboard('{ArrowRight}');
    const regions = screen.getByRole('listbox', { name: 'Regions in Netherlands' });
    expect(regions).toHaveFocus();
    await user.keyboard('s');
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({
      placeId: 'place:south-holland',
      levelKind: 'region',
      contextLabel: 'South Holland · Netherlands',
      parents: [expect.objectContaining({ placeId: 'place:netherlands', name: 'Netherlands', levelKind: 'country' })],
    }));

    await user.keyboard('{ArrowRight}');
    const municipalities = screen.getByRole('listbox', { name: 'Municipalities in South Holland' });
    expect(municipalities).toHaveFocus();
    expect(within(municipalities).getByRole('option', { name: /The Hague/ })).toHaveAccessibleName(/Den Haag/);
    expect(within(municipalities).getByRole('option', { name: /The Hague/ })).toHaveAccessibleName(/South Holland/);
    expect(within(municipalities).getByRole('option', { name: /The Hague/ })).toHaveAccessibleName(/Netherlands/);
    expect(within(municipalities).queryByRole('option', { name: /Amsterdam/ })).toBeNull();
    await user.keyboard('{Enter}');

    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({
      placeId: 'place:the-hague',
      entry: 'browse',
      levelKind: 'municipality',
      nativeAlias: 'Den Haag',
      contextLabel: 'The Hague · South Holland · Netherlands',
      parents: [
        expect.objectContaining({ placeId: 'place:south-holland', name: 'South Holland' }),
        expect.objectContaining({ placeId: 'place:netherlands', name: 'Netherlands' }),
      ],
    }));
    expect(screen.getByText(/Current place: The Hague · South Holland · Netherlands\. manually selected\./)).toBeInTheDocument();
    expect(states.at(-1)).toMatchObject({
      placeId: 'place:the-hague',
      origin: 'manual',
      label: 'The Hague · South Holland · Netherlands',
    });
    expect(states.at(-1)?.uncertainty.join(' ')).toMatch(/does not decide that a law applies/);
    expect(shareLink(states.at(-1)!)).not.toMatch(/lat=|lon=|address=/);
    expectManual(container);
  });

  it('selects a municipality that sits directly under a country', async () => {
    const { user, onSelect, container } = renderPicker();
    focus(screen.getByRole('listbox', { name: 'Countries' }));
    await user.keyboard('c');
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ placeId: 'place:city-state', levelKind: 'country' }));
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('listbox', { name: 'Regions in City State' })).toHaveFocus();
    expect(screen.getByText('City State has no regional places in this catalog.')).toBeInTheDocument();
    await user.keyboard('{ArrowRight}');
    const municipalities = screen.getByRole('listbox', { name: 'Municipalities in City State' });
    expect(municipalities).toHaveFocus();
    expect(within(municipalities).getByRole('option', { name: /Capital/ })).toHaveAccessibleName(/City State/);
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({
      placeId: 'place:capital',
      levelKind: 'municipality',
      contextLabel: 'Capital · City State',
      parents: [expect.objectContaining({ placeId: 'place:city-state', name: 'City State' })],
    }));
    expectManual(container);
  });

  it('matches a native alias and keeps the parent chain', async () => {
    const { user, onSelect, container } = renderPicker();
    await typeInto(user, 'Search places by name or native alias', 'Den Haag');
    const suggestions = screen.getByRole('listbox', { name: 'Place name suggestions' });
    expect(within(suggestions).getAllByRole('option')).toHaveLength(1);
    expect(within(suggestions).getByRole('option', { name: /The Hague/ })).toHaveAccessibleName(/matched native name Den Haag/);
    expect(within(suggestions).getByRole('option', { name: /The Hague/ })).toHaveAccessibleName(/South Holland, region, Netherlands, country/);
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({
      placeId: 'place:the-hague',
      entry: 'search',
      matchKind: 'native-alias',
      matchedText: 'Den Haag',
      contextLabel: 'The Hague · South Holland · Netherlands',
    }));
    expect(screen.getByText(/Native name Den Haag/)).toBeInTheDocument();
    expectManual(container);
  });

  it('matches a regional native alias and a country code without dropping the parent', async () => {
    const { user, onSelect, container } = renderPicker();
    await typeInto(user, 'Search places by name or native alias', 'Noord-Holland');
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({
      placeId: 'place:north-holland',
      matchKind: 'native-alias',
      levelKind: 'region',
      nativeAlias: 'Noord-Holland',
      parents: [expect.objectContaining({ placeId: 'place:netherlands' })],
    }));

    const search = screen.getByRole('combobox', { name: 'Search places by name or native alias' });
    search.focus();
    await user.keyboard('{Escape}');
    await user.keyboard('Nederland');
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({
      placeId: 'place:netherlands',
      matchKind: 'native-alias',
      matchedText: 'Nederland',
    }));

    search.focus();
    await user.keyboard('{Escape}');
    await user.keyboard('NL');
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({
      placeId: 'place:netherlands',
      matchKind: 'code',
      matchedText: 'NL',
    }));

    search.focus();
    await user.keyboard('{Escape}');
    await user.keyboard('EX');
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({
      placeId: 'place:exampleland',
      matchKind: 'code',
      matchedText: 'EX',
    }));
    expectManual(container);
  });

  it('matches an official alias and does not revive an expired name or an expired place', async () => {
    const { user, onSelect, container } = renderPicker();
    await typeInto(user, 'Search places by name or native alias', "'s-Gravenhage");
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({
      placeId: 'place:the-hague',
      matchKind: 'alias',
      matchedText: "'s-Gravenhage",
      contextLabel: 'The Hague · South Holland · Netherlands',
    }));

    const search = screen.getByRole('combobox', { name: 'Search places by name or native alias' });
    search.focus();
    await user.keyboard('{Escape}');
    await user.keyboard('Fort Spring');
    expect(screen.getByText('No place matches that name.')).toBeInTheDocument();
    expect(onSelect).toHaveBeenCalledTimes(1);

    search.focus();
    await user.keyboard('{Escape}');
    await user.keyboard('Former Town');
    expect(screen.getByText('No place matches that name.')).toBeInTheDocument();
    expect(screen.getByText('1 place is outside this date and is not listed.')).toBeInTheDocument();
    expectManual(container);
  });

  it('does not invent a parent for a municipality whose parent is unknown', async () => {
    const { user, onSelect, container } = renderPicker();
    await typeInto(user, 'Search places by name or native alias', 'Orphan Town');
    const option = screen.getByRole('option', { name: /Orphan Town/ });
    expect(option).toHaveAccessibleName(/administrative parent unknown/);
    expect(option).not.toHaveAccessibleName(/Netherlands|Exampleland|City State/);
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({
      placeId: 'place:orphan-town',
      parents: [],
      parentKnowledge: 'unknown',
      contextLabel: 'Orphan Town',
    }));
    expect(screen.getByText(/Administrative parent is unknown/)).toBeInTheDocument();
    expectManual(container);
  });

  it('requires a keyboard choice between duplicate names and shows both parent chains', async () => {
    const { user, onSelect, container } = renderPicker();
    await typeInto(user, 'Search places by name or native alias', 'Springfield');
    const suggestions = screen.getByRole('listbox', { name: 'Place name suggestions' });
    const options = within(suggestions).getAllByRole('option', { name: /Springfield/ });
    expect(options).toHaveLength(2);
    expect(options[0]).toHaveAccessibleName(/North Example, region, Exampleland, country/);
    expect(options[1]).toHaveAccessibleName(/South Example, region, Exampleland, country/);
    expect(within(suggestions).getAllByText('Another place uses this name.')).toHaveLength(2);
    await user.keyboard('{Enter}');
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByText(/Several places match/)).toBeInTheDocument();
    await user.keyboard('{ArrowDown}');
    await user.keyboard('{ArrowDown}');
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({
      placeId: 'place:springfield-south',
      contextLabel: 'Springfield · South Example · Exampleland',
      duplicateName: true,
      parents: [
        expect.objectContaining({ placeId: 'place:south-example', name: 'South Example' }),
        expect.objectContaining({ placeId: 'place:exampleland', name: 'Exampleland' }),
      ],
    }));
    expectManual(container);
  });

  it('selects a licensed postal code, withholds an unlicensed code, and disambiguates a shared code', async () => {
    const { user, onSelect, states, container } = renderPicker();
    expect(screen.getByText(/2 unlicensed codes were withheld/)).toBeInTheDocument();
    const postal = screen.getByRole('combobox', { name: 'Postal code' });
    expect(postal).toBeEnabled();
    postal.focus();
    await user.keyboard('1012 js');
    const suggestions = screen.getByRole('listbox', { name: 'Postal code suggestions' });
    expect(within(suggestions).getByRole('option', { name: /Amsterdam/ })).toHaveAccessibleName(/North Holland, region, Netherlands, country/);
    expect(within(suggestions).getByRole('option', { name: /Amsterdam/ })).toHaveAccessibleName(/1012JS/);
    expect(within(suggestions).getByRole('option', { name: /Amsterdam/ })).toHaveAccessibleName(/CC0-1.0/);
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({
      placeId: 'place:amsterdam',
      entry: 'postcode',
      contextLabel: 'Amsterdam · North Holland · Netherlands',
      postcode: { code: '1012JS', license: 'CC0-1.0', attribution: 'Synthetic postal fixture' },
      parents: [
        expect.objectContaining({ placeId: 'place:north-holland' }),
        expect.objectContaining({ placeId: 'place:netherlands' }),
      ],
    }));
    expect(screen.getByText(/Chosen from postal code 1012JS\. License CC0-1\.0\. Synthetic postal fixture\./)).toBeInTheDocument();
    expect(states.at(-1)?.label).toBe('Amsterdam · North Holland · Netherlands');
    expect(shareLink(states.at(-1)!)).not.toMatch(/1012|lat=|lon=/);

    postal.focus();
    await user.keyboard('{Escape}');
    await user.keyboard('0110AA');
    expect(within(screen.getByRole('listbox', { name: 'Postal code suggestions' })).getAllByRole('option')).toHaveLength(2);
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledTimes(1);
    await user.keyboard('{ArrowDown}');
    await user.keyboard('{ArrowDown}');
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({
      placeId: 'place:springfield-south',
      entry: 'postcode',
      contextLabel: 'Springfield · South Example · Exampleland',
    }));

    postal.focus();
    await user.keyboard('{Escape}');
    await user.keyboard('9999XX');
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(screen.getAllByText('This postal code is in an unlicensed dataset and was withheld.').length).toBeGreaterThan(0);
    expect(screen.getByText(/Current place: Springfield · South Example · Exampleland/)).toBeInTheDocument();
    expectManual(container);
  });

  it('keeps postal entry closed when no code is licensed', async () => {
    const withheld = renderPicker({
      postcodes: [{ code: '9999 XX', placeId: 'place:amsterdam', license: 'unlicensed' }],
    });
    expect(screen.getByRole('combobox', { name: 'Postal code' })).toBeDisabled();
    expect(screen.getByText('1 postal code was withheld because it is not licensed.')).toBeInTheDocument();
    expectManual(withheld.container);
    withheld.unmount();

    const absent = renderPicker({ postcodes: null });
    expect(screen.getByRole('combobox', { name: 'Postal code' })).toBeDisabled();
    expect(screen.getByText('Postal codes stay unavailable until a licensed postal dataset is supplied.')).toBeInTheDocument();
    expectManual(absent.container);
  });

  it('turns a typed coordinate into an explicit choice and keeps every parent', async () => {
    const { user, onSelect, states, container } = renderPicker();
    screen.getByLabelText('Latitude').focus();
    await user.keyboard('52.4');
    screen.getByLabelText('Longitude').focus();
    await user.keyboard('4.85');
    await user.keyboard('{Enter}');
    const points = await screen.findByRole('listbox', { name: 'Places at these coordinates' });
    expect(points).toHaveFocus();
    const options = within(points).getAllByRole('option');
    expect(options.map((option) => option.getAttribute('data-level'))).toEqual(['municipality', 'region', 'country']);
    expect(options[0]).toHaveAccessibleName(/Amsterdam, municipality, North Holland, region, Netherlands, country/);
    expect(onSelect).not.toHaveBeenCalled();
    await user.keyboard('{Enter}');
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getAllByText(/No place was selected automatically/).length).toBeGreaterThan(0);
    await user.keyboard('{ArrowDown}');
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({
      placeId: 'place:amsterdam',
      entry: 'coordinates',
      contextLabel: 'Amsterdam · North Holland · Netherlands',
      coordinates: { latitude: 52.4, longitude: 4.85 },
      parents: [
        expect.objectContaining({ placeId: 'place:north-holland' }),
        expect.objectContaining({ placeId: 'place:netherlands' }),
      ],
    }));
    expect(screen.getByText('Chosen from coordinates. The numbers stay off the shared link.')).toBeInTheDocument();
    expect(states.at(-1)?.origin).toBe('manual');
    expect(states.at(-1)?.label).toBe('Amsterdam · North Holland · Netherlands');
    expect(shareLink(states.at(-1)!)).not.toMatch(/lat=|lon=|52\.4|4\.85/);
    expect(states.at(-1)?.sessionCoordinates).toBeNull();
    expectManual(container);
  });

  it('does not invent a municipality for a country-only coordinate', async () => {
    const { user, onSelect, container } = renderPicker();
    screen.getByLabelText('Latitude').focus();
    await user.keyboard('53.5');
    screen.getByLabelText('Longitude').focus();
    await user.keyboard('6.5');
    await user.keyboard('{Enter}');
    const points = await screen.findByRole('listbox', { name: 'Places at these coordinates' });
    const options = within(points).getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveAttribute('data-level', 'country');
    expect(options[0]).toHaveAccessibleName(/Netherlands/);
    expect(options[0]).toHaveAccessibleName(/no administrative parent/);
    expect(screen.getAllByText(/No municipality was added for this point/).length).toBeGreaterThan(0);
    expect(onSelect).not.toHaveBeenCalled();
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({
      placeId: 'place:netherlands',
      levelKind: 'country',
      parents: [],
      entry: 'coordinates',
    }));
    expect(onSelect.mock.calls.some((call) => call[0].levelKind === 'municipality' || call[0].levelKind === 'region')).toBe(false);
    expectManual(container);
  });

  it('keeps a border point unselected until a candidate and its parents are chosen', async () => {
    const { user, onSelect, states, container } = renderPicker();
    screen.getByLabelText('Latitude').focus();
    await user.keyboard('15');
    screen.getByLabelText('Longitude').focus();
    await user.keyboard('13');
    await user.keyboard('{Enter}');
    const points = await screen.findByRole('listbox', { name: 'Places at these coordinates' });
    expect(screen.getAllByText(/on a boundary or an uncertain border/).length).toBeGreaterThan(0);
    const options = within(points).getAllByRole('option');
    expect(options.length).toBeGreaterThan(1);
    const springfields = within(points).getAllByRole('option', { name: /Springfield/ });
    expect(springfields[0]).toHaveAccessibleName(/North Example/);
    expect(springfields[1]).toHaveAccessibleName(/South Example/);
    await user.keyboard('{Enter}');
    expect(onSelect).not.toHaveBeenCalled();
    await user.keyboard('{ArrowDown}');
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({
      placeId: 'place:springfield-north',
      entry: 'coordinates',
      contextLabel: 'Springfield · North Example · Exampleland',
      parents: [
        expect.objectContaining({ placeId: 'place:north-example' }),
        expect.objectContaining({ placeId: 'place:exampleland' }),
      ],
    }));
    expect(states.at(-1)?.uncertainty.join(' ')).toMatch(/boundary or an uncertain border/);
    expect(states.at(-1)?.uncertainty.join(' ')).toMatch(/does not decide that a law applies/);
    expectManual(container);
  });

  it('rejects unusable coordinates and refuses a point when no boundary pack is loaded', async () => {
    const missing = renderPicker({ geometries: null });
    screen.getByLabelText('Latitude').focus();
    await missing.user.keyboard('52.4');
    screen.getByLabelText('Longitude').focus();
    await missing.user.keyboard('4.85');
    await missing.user.keyboard('{Enter}');
    expect(screen.getAllByText('Coordinates need a local boundary pack. Choose a country, region, or municipality instead.').length).toBeGreaterThan(0);
    expect(missing.onSelect).not.toHaveBeenCalled();
    expect(screen.queryByRole('listbox', { name: 'Places at these coordinates' })).toBeNull();
    expectManual(missing.container);
    missing.unmount();

    const { user, onSelect, container } = renderPicker();
    screen.getByLabelText('Latitude').focus();
    await user.keyboard('abc');
    screen.getByLabelText('Longitude').focus();
    await user.keyboard('4');
    await user.keyboard('{Enter}');
    expect(screen.getAllByText('Enter a latitude and a longitude.').length).toBeGreaterThan(0);
    expect(onSelect).not.toHaveBeenCalled();

    const latitude = screen.getByLabelText('Latitude');
    latitude.focus();
    await user.keyboard('{Control>}a{/Control}{Backspace}95');
    await user.keyboard('{Enter}');
    expect(screen.getAllByText('Latitude must be from -90 through 90 and longitude from -180 through 180.').length).toBeGreaterThan(0);

    latitude.focus();
    await user.keyboard('{Control>}a{/Control}{Backspace}52,4');
    screen.getByLabelText('Longitude').focus();
    await user.keyboard('{Control>}a{/Control}{Backspace}4.8');
    await user.keyboard('{Enter}');
    expect(screen.getAllByText('Use a dot for the decimal mark.').length).toBeGreaterThan(0);
    expect(onSelect).not.toHaveBeenCalled();
    expectManual(container);
  });

  it('searches worldwide from the keyboard and records the manual origin', async () => {
    const { user, onSelect, states, container } = renderPicker();
    const worldwide = screen.getByRole('button', { name: 'Search worldwide' });
    worldwide.focus();
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({
      scope: 'worldwide',
      entry: 'worldwide',
      contextLabel: 'Worldwide',
    }));
    expect(states.at(-1)).toMatchObject({
      placeId: null,
      origin: 'manual',
      scope: 'worldwide',
    });
    expect(screen.getByText(/Current place: Worldwide\. manually selected\./)).toBeInTheDocument();
    expect(shareLink(states.at(-1)!)).not.toMatch(/lat=|lon=/);
    expectManual(container);
  });

  it('accepts a pointer choice on the country list without a location request', async () => {
    const { user, onSelect, container } = renderPicker();
    const countries = screen.getByRole('listbox', { name: 'Countries' });
    await user.click(within(countries).getByRole('option', { name: /Exampleland/ }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({
      placeId: 'place:exampleland',
      entry: 'browse',
      levelKind: 'country',
    }));
    expectManual(container);
  });

  it('reports an unusable date instead of listing places', async () => {
    const { container } = renderPicker({ asOf: 'not-a-date' });
    expect(screen.getByRole('alert')).toHaveTextContent(/not-a-date/);
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(container.querySelector('canvas, iframe, img, svg, [data-map]')).toBeNull();
    expect(container).toHaveTextContent('does not use a map or request your location');
  });
});

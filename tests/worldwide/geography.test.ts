/**
 * Curated point and place fixtures.
 *
 * Expected candidate sets are literals. `predictFixture` recomputes those
 * sets from rectangle, hole, and antimeridian inequalities. It does not call
 * the resolver. A bbox hit is not enough: ocean, notch, and hole cases must
 * name the precise rejection.
 */

import {
  APPLICABILITY,
  admitJurisdictionGraph,
  type JurisdictionGraph,
} from '../../src/lib/worldwide/jurisdiction/schema';
import { JurisdictionSchemaError } from '../../src/lib/worldwide/jurisdiction/schema';
import {
  PLACE_INDEX_LIMITS,
  PLACE_RESOLUTION_SCHEMA,
  POINT_RESOLUTION_SCHEMA,
  PlaceIndexError,
  UNCERTAINTY,
  buildPlaceIndex,
  resolvePlace,
  resolvePoint,
  type GeoPosition,
  type GeometryRecord,
  type PointStatus,
} from '../../src/lib/worldwide/jurisdiction/resolve';

const REVISION = 'a'.repeat(40);
const AS_OF = '2024-06-01';

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

function unknownValid() {
  return {
    start: { knowledge: 'unknown' as const, value: null, precision: null, source: null },
    end: { knowledge: 'unknown' as const, value: null, precision: null, source: null },
  };
}

function envelope(extra: Record<string, unknown> = {}) {
  return {
    graphId: 'graph:geography-fixture',
    sourceId: 'registry:geography-fixture',
    sourceRevision: REVISION,
    publisherId: 'publisher:fixture',
    observedAt: '2024-06',
    ...extra,
  };
}

function boundary(boundaryId: string, extra: Record<string, unknown> = {}) {
  return {
    boundaryId,
    role: 'primary',
    geometryKnowledge: 'known',
    geometryRef: `artifact:${boundaryId}`,
    provenance: {
      sourceId: 'registry:geography-fixture',
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
    names?: unknown[];
    roles?: Array<'place' | 'issuer'>;
    aliases?: unknown[];
    parentKnowledge?: string;
    issuerKnowledge?: string;
    issuerIds?: string[];
    boundaries?: unknown[];
    valid?: unknown;
  } = {},
) {
  const roles = opts.roles ?? ['place'];
  const issuerIds = opts.issuerIds ?? (roles.includes('issuer') ? [id] : []);
  return {
    id,
    roles,
    names: opts.names ?? [{ text: opts.name ?? id, language: 'en', script: 'Latn' }],
    aliases: opts.aliases ?? [],
    level: { kind: level },
    externalIds: [],
    parentKnowledge: opts.parentKnowledge ?? 'none',
    issuerKnowledge: opts.issuerKnowledge ?? (issuerIds.length > 0 ? 'known' : 'none'),
    issuerIds,
    boundaries: opts.boundaries ?? (roles.includes('place') ? [boundary(`boundary:${id.slice(id.indexOf(':') + 1)}`)] : []),
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

function ring(west: number, south: number, east: number, north: number, close = true): GeoPosition[] {
  const positions: GeoPosition[] = [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
  ];
  if (close) positions.push([west, south]);
  return positions;
}

function rect(boundaryId: string, west: number, south: number, east: number, north: number, hole?: [number, number, number, number], close = true): GeometryRecord {
  const rings = [ring(west, south, east, north, close)];
  if (hole) rings.push(ring(hole[0], hole[1], hole[2], hole[3], true));
  return { geometryRef: `artifact:${boundaryId}`, type: 'Polygon', coordinates: rings };
}

function geometries(): GeometryRecord[] {
  const dateline: GeometryRecord = {
    geometryRef: 'artifact:boundary:dateline-republic',
    type: 'Polygon',
    coordinates: [
      [
        [170, -15],
        [170, -5],
        [-170, -5],
        [-170, -15],
        [170, -15],
      ],
      [
        [175, -12],
        [176, -12],
        [176, -8],
        [175, -8],
        [175, -12],
      ],
    ],
  };
  const notch: GeometryRecord = {
    geometryRef: 'artifact:boundary:notch-district',
    type: 'Polygon',
    coordinates: [[
      [60, 20],
      [70, 20],
      [70, 24],
      [64, 24],
      [64, 30],
      [60, 30],
      [60, 20],
    ]],
  };
  const islands: GeometryRecord = {
    geometryRef: 'artifact:boundary:island-group',
    type: 'MultiPolygon',
    coordinates: [
      [ring(0, 40, 5, 45)],
      [ring(25, 55, 28, 58)],
    ],
  };
  return [
    rect('boundary:shell-country', 0, 0, 20, 20, [8, 8, 12, 12]),
    rect('boundary:shell-region', 1, 1, 7, 7),
    rect('boundary:inner-municipality', 2, 2, 6, 6),
    rect('boundary:enclave-state', 8, 8, 12, 12),
    rect('boundary:host-county', 30, 0, 50, 20),
    rect('boundary:incorporated-town', 30, 0, 40, 20),
    rect('boundary:open-tract', 40, 0, 50, 20),
    islands,
    rect('boundary:coastal-country', 0, 80, 10, 90),
    rect('boundary:coastal-island', 14, 84, 16, 86),
    dateline,
    rect('boundary:west-shire', 60, 0, 70, 10),
    rect('boundary:east-shire', 70, 0, 80, 10, undefined, false),
    notch,
    rect('boundary:approximate-march', 80, 20, 90, 30),
    rect('boundary:claimed-strip', 80, 40, 90, 50),
    rect('boundary:claim-holder', 100, 40, 110, 50),
    rect('boundary:punched-province', 0, 60, 10, 70),
    rect('boundary:punched-exclusion', 4, 64, 6, 66),
    rect('boundary:cutout-enclave', 4, 64, 6, 66),
    rect('boundary:hole-role-country', 110, 20, 120, 30),
    rect('boundary:hole-role-hole', 114, 24, 116, 26),
    rect('boundary:distant-country', 100, 0, 110, 10),
    rect('boundary:pocket-town', 90, 0, 92, 2),
    rect('boundary:former-district', 0, -40, 5, -36),
    rect('boundary:undated-district', 0, -34, 5, -30),
    rect('boundary:springfield-north', 120, 0, 121, 1),
    rect('boundary:springfield-south', 122, 0, 123, 1),
    rect('boundary:frisian-municipality', 124, 0, 125, 1),
    rect('boundary:hague-city', 126, 0, 127, 1),
    rect('boundary:exampleland', 120, 40, 122, 42),
  ];
}

function fixtureGraph(): JurisdictionGraph {
  const admitted = admitJurisdictionGraph(envelope({
    nodes: [
      place('place:shell-country', 'country', { name: 'Shell Country' }),
      place('place:shell-region', 'region', { name: 'Shell Region' }),
      place('place:inner-municipality', 'municipality', { name: 'Inner Municipality' }),
      place('place:enclave-state', 'state', {
        name: 'Enclave State',
        boundaries: [boundary('boundary:enclave-state', { flags: ['enclave'] })],
      }),
      place('place:host-county', 'county', { name: 'Host County' }),
      place('place:incorporated-town', 'municipality', { name: 'Incorporated Town' }),
      place('place:open-tract', 'unincorporated', {
        name: 'Open Tract',
        boundaries: [boundary('boundary:open-tract', { flags: ['unincorporated'] })],
      }),
      place('place:island-group', 'country', {
        name: 'Island Group',
        boundaries: [boundary('boundary:island-group', { flags: ['island'] })],
      }),
      place('place:coastal-country', 'country', {
        name: 'Coastal Country',
        boundaries: [
          boundary('boundary:coastal-country'),
          boundary('boundary:coastal-island', { flags: ['island'] }),
        ],
      }),
      place('place:dateline-republic', 'country', {
        name: 'Dateline Republic',
        boundaries: [boundary('boundary:dateline-republic', { flags: ['antimeridian'] })],
      }),
      place('place:west-shire', 'region', { name: 'West Shire' }),
      place('place:east-shire', 'region', { name: 'East Shire' }),
      place('place:notch-district', 'district', { name: 'Notch District' }),
      place('place:approximate-march', 'territory', {
        name: 'Approximate March',
        boundaries: [boundary('boundary:approximate-march', { role: 'approximate', flags: ['border-uncertain'] })],
      }),
      place('place:claim-holder', 'country', { name: 'Claim Holder', roles: ['place', 'issuer'] }),
      place('place:claimed-strip', 'territory', {
        name: 'Claimed Strip',
        boundaries: [boundary('boundary:claimed-strip', {
          role: 'disputed',
          viewId: 'view:claim-east',
          flags: ['border-uncertain'],
        })],
      }),
      place('place:punched-province', 'province', {
        name: 'Punched Province',
        boundaries: [
          boundary('boundary:punched-province'),
          boundary('boundary:punched-exclusion', { role: 'exclusion' }),
        ],
      }),
      place('place:cutout-enclave', 'territory', {
        name: 'Cutout Enclave',
        boundaries: [boundary('boundary:cutout-enclave', { flags: ['enclave'] })],
      }),
      place('place:hole-role-country', 'country', {
        name: 'Hole Role Country',
        boundaries: [
          boundary('boundary:hole-role-country'),
          boundary('boundary:hole-role-hole', { role: 'hole', flags: ['hole'] }),
        ],
      }),
      place('place:distant-country', 'country', { name: 'Distant Country' }),
      place('place:pocket-town', 'municipality', { name: 'Pocket Town', parentKnowledge: 'known' }),
      place('place:former-district', 'district', {
        name: 'Former District',
        valid: closedValid('1990-01-01', '2000-12-31'),
        boundaries: [boundary('boundary:former-district', { valid: closedValid('1990-01-01', '2000-12-31') })],
      }),
      place('place:undated-district', 'district', {
        name: 'Undated District',
        valid: unknownValid(),
        boundaries: [boundary('boundary:undated-district', { valid: unknownValid() })],
      }),
      place('place:springfield-north', 'city', {
        name: 'Springfield',
        aliases: [{
          text: 'Fort Spring',
          language: 'en',
          script: 'Latn',
          kind: 'historical',
          valid: closedValid('1800-01-01', '1899-12-31'),
        }],
      }),
      place('place:springfield-south', 'city', { name: 'Springfield' }),
      place('place:frisian-municipality', 'municipality', {
        names: [{ text: 'Noardeast-Fryslân', language: 'fy', script: 'Latn' }],
      }),
      place('place:hague-city', 'city', {
        names: [{ text: "'s-Gravenhage", language: 'nl', script: 'Latn' }],
        aliases: [{ text: 'Den Haag', language: 'en', script: 'Latn', kind: 'exonym' }],
      }),
      place('place:exampleland', 'country', {
        name: 'Exampleland',
        aliases: [{ text: 'EX', kind: 'code' }],
      }),
      place('place:lost-file', 'locality', { name: 'Lost File' }),
      place('place:unmapped-parish', 'locality', { name: 'Unmapped Parish', boundaries: [] }),
      place('issuer:coastal-ministry', 'national-authority', {
        name: 'Coastal Ministry',
        roles: ['issuer'],
        issuerIds: [],
        issuerKnowledge: 'none',
        boundaries: [],
      }),
    ],
    disputedViews: [{
      id: 'view:claim-east',
      statement: 'Claim Holder records the strip under its own boundary view.',
      claimantIds: ['place:claim-holder'],
      valid: openValid('1900'),
    }],
    edges: [edge('edge:pocket-parent', 'place:pocket-town', 'place:distant-country')],
    unknownRelationships: [{
      subjectId: 'place:unmapped-parish',
      about: 'boundary',
      reason: 'No licensed polygon was admitted for this parish.',
    }],
  }));
  if (!admitted.graph) {
    throw new Error(`geography fixture graph was quarantined: ${JSON.stringify(admitted.quarantined)}`);
  }
  return admitted.graph;
}

const graph = fixtureGraph();
const catalog = geometries();
const index = buildPlaceIndex({
  graph,
  geometries: catalog,
  cellDegrees: 1,
  borderToleranceDegrees: 0.5,
});

interface PointFixture {
  id: string;
  longitude: number;
  latitude: number;
  asOf?: string;
  viewIds?: string[];
  tolerance?: number;
  status: PointStatus;
  candidates: Record<string, string[]>;
  rejected?: Record<string, string>;
  undecided?: Record<string, string>;
}

function point(
  id: string,
  longitude: number,
  latitude: number,
  status: PointStatus,
  candidates: Record<string, string[]>,
  extra: Partial<PointFixture> = {},
): PointFixture {
  return { id, longitude, latitude, status, candidates, ...extra };
}

const POINT_FIXTURES: PointFixture[] = [
  point('nested-interiors', 4, 4, 'resolved', {
    'place:inner-municipality': ['interior'],
    'place:shell-country': ['interior'],
    'place:shell-region': ['interior'],
  }),
  point('enclave-in-hole', 10, 10, 'resolved', {
    'place:enclave-state': ['enclave', 'interior'],
  }, { rejected: { 'place:shell-country': 'inside-hole' } }),
  point('shell-beside-hole', 10, 7, 'resolved', {
    'place:shell-country': ['interior'],
  }),
  point('shell-far-corner', 18, 18, 'resolved', {
    'place:shell-country': ['interior'],
  }),
  point('hole-edge-shared-with-enclave', 8, 10, 'border-uncertain', {
    'place:enclave-state': ['border-uncertain', 'enclave', 'on-boundary'],
    'place:shell-country': ['border-uncertain', 'hole', 'on-boundary'],
  }),
  point('incorporated-town', 35, 10, 'resolved', {
    'place:host-county': ['interior'],
    'place:incorporated-town': ['interior'],
  }),
  point('unincorporated-tract', 45, 10, 'resolved', {
    'place:host-county': ['interior'],
    'place:open-tract': ['interior', 'unincorporated'],
  }),
  point('shared-town-tract-edge', 40, 10, 'border-uncertain', {
    'place:host-county': ['interior'],
    'place:incorporated-town': ['border-uncertain', 'on-boundary'],
    'place:open-tract': ['border-uncertain', 'on-boundary', 'unincorporated'],
  }),
  point('island-main-part', 2, 42, 'resolved', {
    'place:island-group': ['interior', 'island'],
  }),
  point('island-outlying-part', 26, 56, 'resolved', {
    'place:island-group': ['interior', 'island'],
  }),
  point('ocean-inside-island-bbox', 15, 50, 'unresolved', {}, {
    rejected: { 'place:island-group': 'outside-ring' },
  }),
  point('coastal-mainland', 5, 85, 'resolved', {
    'place:coastal-country': ['interior'],
  }),
  point('coastal-island', 15, 85, 'resolved', {
    'place:coastal-country': ['interior', 'island'],
  }),
  point('dateline-east', 172, -10, 'resolved', {
    'place:dateline-republic': ['antimeridian', 'interior'],
  }),
  point('dateline-west', -175, -10, 'resolved', {
    'place:dateline-republic': ['antimeridian', 'interior'],
  }),
  point('dateline-180', 180, -10, 'resolved', {
    'place:dateline-republic': ['antimeridian', 'interior'],
  }),
  point('dateline-minus-180', -180, -10, 'resolved', {
    'place:dateline-republic': ['antimeridian', 'interior'],
  }),
  point('dateline-hole', 175.5, -10, 'unresolved', {}, {
    rejected: { 'place:dateline-republic': 'inside-hole' },
  }),
  point('dateline-prime-meridian', 0, -10, 'unresolved', {}),
  point('west-interior', 65, 5, 'resolved', {
    'place:west-shire': ['interior'],
  }),
  point('east-interior', 75, 5, 'resolved', {
    'place:east-shire': ['interior'],
  }),
  point('shared-border', 70, 5, 'border-uncertain', {
    'place:east-shire': ['border-uncertain', 'on-boundary'],
    'place:west-shire': ['border-uncertain', 'on-boundary'],
  }),
  point('near-border-inside-tolerance', 69.5, 5, 'border-uncertain', {
    'place:east-shire': ['border-uncertain', 'on-boundary'],
    'place:west-shire': ['border-uncertain', 'on-boundary'],
  }, { tolerance: 0.5 }),
  point('near-border-without-tolerance', 69.5, 5, 'resolved', {
    'place:west-shire': ['interior'],
  }, { tolerance: 0 }),
  point('notch-outside-bbox-interior', 68, 28, 'unresolved', {}, {
    rejected: { 'place:notch-district': 'outside-ring' },
  }),
  point('notch-left-column', 62, 28, 'resolved', {
    'place:notch-district': ['interior'],
  }),
  point('notch-bottom-bar', 68, 22, 'resolved', {
    'place:notch-district': ['interior'],
  }),
  point('approximate-border', 85, 25, 'border-uncertain', {
    'place:approximate-march': ['approximate', 'border-uncertain', 'interior'],
  }),
  point('disputed-view-hidden', 85, 45, 'unresolved', {}),
  point('disputed-view-selected', 85, 45, 'border-uncertain', {
    'place:claimed-strip': ['border-uncertain', 'disputed', 'interior'],
  }, { viewIds: ['view:claim-east'] }),
  point('exclusion-enclave', 5, 65, 'resolved', {
    'place:cutout-enclave': ['enclave', 'interior'],
  }, { rejected: { 'place:punched-province': 'inside-exclusion' } }),
  point('punched-shell', 1, 61, 'resolved', {
    'place:punched-province': ['interior'],
  }),
  point('hole-role-interior', 115, 25, 'unresolved', {}, {
    rejected: { 'place:hole-role-country': 'inside-hole' },
  }),
  point('hole-role-shell', 111, 21, 'resolved', {
    'place:hole-role-country': ['interior'],
  }),
  point('pocket-ignores-parent-edge', 91, 1, 'resolved', {
    'place:pocket-town': ['interior'],
  }),
  point('former-boundary-during', 2, -38, 'resolved', {
    'place:former-district': ['interior'],
  }, { asOf: '1995-06-01' }),
  point('former-boundary-after', 2, -38, 'unresolved', {}, {
    asOf: '2020-01-01',
    rejected: { 'place:former-district': 'validity-outside' },
  }),
  point('undated-boundary-not-current', 2, -32, 'unresolved', {}, {
    undecided: { 'place:undated-district': 'validity-unknown' },
  }),
];

type ShapeClass = 'outside' | 'interior' | 'boundary';

function onRectEdge(x: number, y: number, west: number, south: number, east: number, north: number): boolean {
  const onVertical = (x === west || x === east) && y >= south && y <= north;
  const onHorizontal = (y === south || y === north) && x >= west && x <= east;
  return onVertical || onHorizontal;
}

function classRect(x: number, y: number, west: number, south: number, east: number, north: number, tolerance: number): ShapeClass {
  if (onRectEdge(x, y, west, south, east, north)) return 'boundary';
  const nearVertical = (Math.abs(x - west) <= tolerance || Math.abs(x - east) <= tolerance) && y >= south && y <= north;
  const nearHorizontal = (Math.abs(y - south) <= tolerance || Math.abs(y - north) <= tolerance) && x >= west && x <= east;
  if (nearVertical || nearHorizontal) return 'boundary';
  if (x > west && x < east && y > south && y < north) return 'interior';
  return 'outside';
}

interface Prediction {
  status: PointStatus;
  candidates: Record<string, string[]>;
  rejected: Record<string, string>;
  undecided: Record<string, string>;
}

function predictFixture(fixture: PointFixture): Prediction {
  const x = fixture.longitude;
  const y = fixture.latitude;
  const tolerance = fixture.tolerance ?? 0;
  const asOf = fixture.asOf ?? AS_OF;
  const views = fixture.viewIds ?? [];
  const accepted = new Map<string, Set<string>>();
  const rejected = new Map<string, string>();
  const undecided = new Map<string, string>();
  const accept = (id: string, reasons: string[]) => {
    if (rejected.has(id)) return;
    const bucket = accepted.get(id) ?? new Set<string>();
    for (const reason of reasons) bucket.add(reason);
    accepted.set(id, bucket);
  };
  const reject = (id: string, reason: string) => {
    accepted.delete(id);
    rejected.set(id, reason);
  };
  const consider = (id: string, klass: ShapeClass, interior: string[], boundary: string[]) => {
    if (klass === 'interior') accept(id, interior);
    else if (klass === 'boundary') accept(id, boundary);
  };

  const shellHole = classRect(x, y, 8, 8, 12, 12, tolerance);
  const shellOuter = classRect(x, y, 0, 0, 20, 20, tolerance);
  if (shellHole === 'interior') reject('place:shell-country', 'inside-hole');
  else if (shellHole === 'boundary') accept('place:shell-country', ['border-uncertain', 'hole', 'on-boundary']);
  else if (shellOuter === 'boundary') accept('place:shell-country', ['border-uncertain', 'on-boundary']);
  else if (shellOuter === 'interior') accept('place:shell-country', ['interior']);
  consider('place:enclave-state', shellHole, ['enclave', 'interior'], ['border-uncertain', 'enclave', 'on-boundary']);

  const simple: Array<[string, number, number, number, number, string[], string[]]> = [
    ['place:shell-region', 1, 1, 7, 7, ['interior'], ['border-uncertain', 'on-boundary']],
    ['place:inner-municipality', 2, 2, 6, 6, ['interior'], ['border-uncertain', 'on-boundary']],
    ['place:host-county', 30, 0, 50, 20, ['interior'], ['border-uncertain', 'on-boundary']],
    ['place:incorporated-town', 30, 0, 40, 20, ['interior'], ['border-uncertain', 'on-boundary']],
    ['place:open-tract', 40, 0, 50, 20, ['interior', 'unincorporated'], ['border-uncertain', 'on-boundary', 'unincorporated']],
    ['place:coastal-country', 0, 80, 10, 90, ['interior'], ['border-uncertain', 'on-boundary']],
    ['place:coastal-country', 14, 84, 16, 86, ['interior', 'island'], ['border-uncertain', 'island', 'on-boundary']],
    ['place:west-shire', 60, 0, 70, 10, ['interior'], ['border-uncertain', 'on-boundary']],
    ['place:east-shire', 70, 0, 80, 10, ['interior'], ['border-uncertain', 'on-boundary']],
    ['place:approximate-march', 80, 20, 90, 30, ['approximate', 'border-uncertain', 'interior'], ['approximate', 'border-uncertain', 'on-boundary']],
    ['place:claim-holder', 100, 40, 110, 50, ['interior'], ['border-uncertain', 'on-boundary']],
    ['place:distant-country', 100, 0, 110, 10, ['interior'], ['border-uncertain', 'on-boundary']],
    ['place:pocket-town', 90, 0, 92, 2, ['interior'], ['border-uncertain', 'on-boundary']],
    ['place:cutout-enclave', 4, 64, 6, 66, ['enclave', 'interior'], ['border-uncertain', 'enclave', 'on-boundary']],
    ['place:springfield-north', 120, 0, 121, 1, ['interior'], ['border-uncertain', 'on-boundary']],
    ['place:springfield-south', 122, 0, 123, 1, ['interior'], ['border-uncertain', 'on-boundary']],
    ['place:frisian-municipality', 124, 0, 125, 1, ['interior'], ['border-uncertain', 'on-boundary']],
    ['place:hague-city', 126, 0, 127, 1, ['interior'], ['border-uncertain', 'on-boundary']],
    ['place:exampleland', 120, 40, 122, 42, ['interior'], ['border-uncertain', 'on-boundary']],
  ];
  for (const [id, west, south, east, north, interior, boundaryReasons] of simple) {
    consider(id, classRect(x, y, west, south, east, north, tolerance), interior, boundaryReasons);
  }

  const mainIsland = classRect(x, y, 0, 40, 5, 45, tolerance);
  const outIsland = classRect(x, y, 25, 55, 28, 58, tolerance);
  if (mainIsland === 'interior' || outIsland === 'interior') accept('place:island-group', ['interior', 'island']);
  else if (mainIsland === 'boundary' || outIsland === 'boundary') accept('place:island-group', ['border-uncertain', 'island', 'on-boundary']);
  else if (x >= 0 && x <= 28 && y >= 40 && y <= 58) reject('place:island-group', 'outside-ring');

  const inNotch = (x > 60 && x < 70 && y > 20 && y < 24) || (x > 60 && x < 64 && y >= 24 && y < 30);
  if (inNotch) accept('place:notch-district', ['interior']);
  else if (x >= 60 && x <= 70 && y >= 20 && y <= 30) reject('place:notch-district', 'outside-ring');

  const unwrapped = x < 0 ? x + 360 : x;
  const inDateline = unwrapped > 170 && unwrapped < 190 && y > -15 && y < -5;
  const inDatelineHole = unwrapped > 175 && unwrapped < 176 && y > -12 && y < -8;
  if (inDatelineHole) reject('place:dateline-republic', 'inside-hole');
  else if (inDateline) accept('place:dateline-republic', ['antimeridian', 'interior']);

  const claimed = classRect(x, y, 80, 40, 90, 50, tolerance);
  if (claimed !== 'outside' && views.includes('view:claim-east')) {
    consider('place:claimed-strip', claimed, ['border-uncertain', 'disputed', 'interior'], ['border-uncertain', 'disputed', 'on-boundary']);
  }

  const punched = classRect(x, y, 0, 60, 10, 70, tolerance);
  const punchedHole = classRect(x, y, 4, 64, 6, 66, tolerance);
  if (punchedHole === 'interior') reject('place:punched-province', 'inside-exclusion');
  else consider('place:punched-province', punched, ['interior'], ['border-uncertain', 'on-boundary']);

  const holeRole = classRect(x, y, 114, 24, 116, 26, tolerance);
  const holeOuter = classRect(x, y, 110, 20, 120, 30, tolerance);
  if (holeRole === 'interior') reject('place:hole-role-country', 'inside-hole');
  else consider('place:hole-role-country', holeOuter, ['interior'], ['border-uncertain', 'on-boundary']);

  const former = classRect(x, y, 0, -40, 5, -36, tolerance);
  if (former !== 'outside') {
    if (asOf >= '1990-01-01' && asOf <= '2000-12-31') consider('place:former-district', former, ['interior'], ['border-uncertain', 'on-boundary']);
    else reject('place:former-district', 'validity-outside');
  }
  const undated = classRect(x, y, 0, -34, 5, -30, tolerance);
  if (undated !== 'outside') {
    accepted.delete('place:undated-district');
    undecided.set('place:undated-district', 'validity-unknown');
  }

  const candidates: Record<string, string[]> = {};
  for (const [id, reasons] of accepted) candidates[id] = [...reasons].sort((left, right) => left.localeCompare(right));
  const rejectedRecord: Record<string, string> = {};
  for (const [id, reason] of rejected) rejectedRecord[id] = reason;
  const undecidedRecord: Record<string, string> = {};
  for (const [id, reason] of undecided) undecidedRecord[id] = reason;
  const lists = Object.values(candidates);
  let status: PointStatus = 'unresolved';
  if (lists.length > 0) status = lists.some((reasons) => reasons.includes('border-uncertain')) ? 'border-uncertain' : 'resolved';
  return { status, candidates, rejected: rejectedRecord, undecided: undecidedRecord };
}

function reasonMap(result: ReturnType<typeof resolvePoint>, field: 'candidates' | 'rejected' | 'undecided'): Record<string, string | string[]> {
  if (field === 'candidates') {
    return Object.fromEntries(result.candidates.map((candidate) => [candidate.placeId, candidate.reasons]));
  }
  if (field === 'rejected') return Object.fromEntries(result.rejected.map((item) => [item.placeId, item.reason]));
  return Object.fromEntries(result.undecided.map((item) => [item.placeId, item.reason]));
}

describe('bounded point and place resolution', () => {
  test('indexes the curated catalog without borrowing administrative edges', () => {
    expect(index.schema).toBe('worldwide-legal-search.place-index@1');
    expect(index.featureCount).toBe(catalog.length);
    expect(index.missingGeometryRefs).toEqual(['artifact:boundary:lost-file']);
    expect(index.unknownGeometryCount).toBe(1);
    expect(index.borderToleranceDegrees).toBe(0.5);
    expect(graph.edges).toEqual([
      expect.objectContaining({
        id: 'edge:pocket-parent',
        kind: 'administrative-containment',
        fromId: 'place:pocket-town',
        toId: 'place:distant-country',
        applicability: APPLICABILITY,
      }),
    ]);
  });

  test.each(POINT_FIXTURES)('$id', (fixture) => {
    const predicted = predictFixture(fixture);
    expect({
      status: fixture.status,
      candidates: fixture.candidates,
      rejected: fixture.rejected ?? {},
      undecided: fixture.undecided ?? {},
    }).toEqual(predicted);
    const result = resolvePoint(index, {
      longitude: fixture.longitude,
      latitude: fixture.latitude,
      asOf: fixture.asOf ?? AS_OF,
      viewIds: fixture.viewIds,
      borderToleranceDegrees: fixture.tolerance,
    });
    expect(result.schema).toBe(POINT_RESOLUTION_SCHEMA);
    expect(result.applicability).toBe('not-asserted');
    expect(result.status).toBe(fixture.status);
    expect(result.asOf).toBe(fixture.asOf ?? AS_OF);
    expect(result.point).toEqual({ longitude: fixture.longitude, latitude: fixture.latitude });
    expect(result.truncated).toBe(false);
    expect(reasonMap(result, 'candidates')).toEqual(fixture.candidates);
    expect(reasonMap(result, 'rejected')).toEqual(fixture.rejected ?? {});
    expect(reasonMap(result, 'undecided')).toEqual(fixture.undecided ?? {});
    const accounted = [
      ...result.candidates.map((candidate) => candidate.placeId),
      ...result.rejected.map((item) => item.placeId),
      ...result.undecided.map((item) => item.placeId),
    ].sort((left, right) => left.localeCompare(right));
    expect(result.indexedPlaceIds).toEqual(accounted);
    expect(result.checks.catalogFeatures).toBe(catalog.length);
    expect(result.checks.preciseChecks).toBe(result.checks.indexFeatures);
    expect(result.checks.catalogFeatures).toBeGreaterThan(result.checks.indexFeatures);
    expect(result.uncertainty[0]).toBe(UNCERTAINTY.notApplicability);
    if (fixture.status === 'resolved') expect(result.uncertainty).toEqual([UNCERTAINTY.notApplicability]);
    if (fixture.status === 'border-uncertain') expect(result.uncertainty).toContain(UNCERTAINTY.border);
    if (fixture.status === 'unresolved') expect(result.uncertainty).toContain(UNCERTAINTY.noGeometry);
    expect(result.candidates.every((candidate) => !('city' in candidate))).toBe(true);
  });

  test('precise checks drop indexed ocean, notch, and hole hits', () => {
    const ocean = resolvePoint(index, { longitude: 15, latitude: 50, asOf: AS_OF });
    const notch = resolvePoint(index, { longitude: 68, latitude: 28, asOf: AS_OF });
    const hole = resolvePoint(index, { longitude: 10, latitude: 10, asOf: AS_OF });
    for (const result of [ocean, notch, hole]) {
      expect(result.checks.indexFeatures).toBeGreaterThan(0);
      expect(result.checks.gridFeatures).toBeGreaterThanOrEqual(result.checks.indexFeatures);
    }
    expect(ocean.indexedPlaceIds).toContain('place:island-group');
    expect(ocean.candidates).toEqual([]);
    expect(notch.rejected.map((item) => item.reason)).toEqual(['outside-ring']);
    expect(hole.candidates.map((candidate) => candidate.placeId)).toEqual(['place:enclave-state']);
    expect(hole.rejected).toEqual([{ placeId: 'place:shell-country', reason: 'inside-hole' }]);
    const near = resolvePoint(index, { longitude: 69.5, latitude: 5, asOf: AS_OF, borderToleranceDegrees: 0 });
    expect(near.checks.gridFeatures).toBeGreaterThan(near.checks.indexFeatures);
    expect(near.candidates.map((candidate) => candidate.placeId)).toEqual(['place:west-shire']);
  });

  test('keeps the prime meridian out of an antimeridian bbox and names the island boundary', () => {
    const meridian = resolvePoint(index, { longitude: 0, latitude: -10, asOf: AS_OF });
    expect(meridian.indexedPlaceIds).not.toContain('place:dateline-republic');
    expect(meridian.checks.indexFeatures).toBe(0);
    const mainland = resolvePoint(index, { longitude: 5, latitude: 85, asOf: AS_OF });
    const island = resolvePoint(index, { longitude: 15, latitude: 85, asOf: AS_OF });
    expect(mainland.candidates[0].boundaryIds).toEqual(['boundary:coastal-country']);
    expect(mainland.candidates[0].reasons).not.toContain('island');
    expect(island.candidates[0].boundaryIds).toEqual(['boundary:coastal-island']);
    expect(island.candidates[0].reasons).toEqual(['interior', 'island']);
    const tract = resolvePoint(index, { longitude: 45, latitude: 10, asOf: AS_OF });
    expect(tract.candidates.find((candidate) => candidate.placeId === 'place:open-tract')).toMatchObject({
      levelKind: 'unincorporated',
      name: 'Open Tract',
    });
    const shell = resolvePoint(index, { longitude: 4, latitude: 4, asOf: AS_OF });
    expect(shell.candidates.find((candidate) => candidate.placeId === 'place:shell-country')?.name).toBe('Shell Country');
    expect(shell.candidates.map((candidate) => candidate.placeId)).not.toContain('place:distant-country');
  });

  test('resolves place ids and names without inventing a winner or a code identity', () => {
    const springfields = resolvePlace(index, { asOf: AS_OF, text: ' Springfield ' });
    expect(springfields.schema).toBe(PLACE_RESOLUTION_SCHEMA);
    expect(springfields.status).toBe('ambiguous');
    expect(springfields.applicability).toBe('not-asserted');
    expect(springfields.query.text).toBe('Springfield');
    expect(springfields.candidates.map((candidate) => candidate.placeId)).toEqual([
      'place:springfield-north',
      'place:springfield-south',
    ]);
    expect(springfields.candidates.every((candidate) => candidate.reasons.join() === 'name')).toBe(true);
    expect(springfields.uncertainty).toContain(UNCERTAINTY.ambiguousName);
    const limited = resolvePlace(index, { asOf: AS_OF, text: 'Springfield', limit: 1 });
    expect(limited.status).toBe('ambiguous');
    expect(limited.truncated).toBe(true);
    expect(limited.candidates.map((candidate) => candidate.placeId)).toEqual(['place:springfield-north']);

    const frisian = resolvePlace(index, { asOf: AS_OF, text: 'NOARDEAST-FRYSLÂN' });
    expect(frisian.status).toBe('resolved');
    expect(frisian.candidates[0]).toMatchObject({ placeId: 'place:frisian-municipality', reasons: ['name'] });
    const decomposed = resolvePlace(index, { asOf: AS_OF, text: 'Noardeast-Fryslân'.normalize('NFD') });
    expect(decomposed.candidates[0].placeId).toBe('place:frisian-municipality');
    expect(resolvePlace(index, { asOf: AS_OF, text: 'Noardeast-Fryslan' }).candidates).toEqual([]);

    const alias = resolvePlace(index, { asOf: AS_OF, text: 'Den Haag' });
    expect(alias.candidates[0]).toMatchObject({ placeId: 'place:hague-city', reasons: ['alias'], name: "'s-Gravenhage" });
    const native = resolvePlace(index, { asOf: AS_OF, text: "'s-Gravenhage" });
    expect(native.candidates[0].reasons).toEqual(['name']);

    const code = resolvePlace(index, { asOf: AS_OF, text: 'ex' });
    expect(code.status).toBe('resolved');
    expect(code.candidates[0]).toMatchObject({ placeId: 'place:exampleland', reasons: ['code'], name: 'Exampleland' });
    expect(code.candidates[0].placeId).not.toBe('EX');
    const named = resolvePlace(index, { asOf: AS_OF, placeId: 'place:exampleland', text: 'Exampleland' });
    expect(named.candidates[0].reasons).toEqual(['name', 'place-id']);
    expect(resolvePlace(index, { asOf: AS_OF, placeId: 'place:exampleland', text: 'Springfield' }).status).toBe('unresolved');

    const historical = resolvePlace(index, { asOf: '1850-06-01', text: 'Fort Spring' });
    expect(historical.candidates[0]).toMatchObject({ placeId: 'place:springfield-north', reasons: ['alias'] });
    const expiredAlias = resolvePlace(index, { asOf: '2020-01-01', text: 'Fort Spring' });
    expect(expiredAlias.status).toBe('unresolved');
    expect(expiredAlias.rejected).toEqual([{ placeId: 'place:springfield-north', reason: 'validity-outside' }]);

    const during = resolvePlace(index, { asOf: '1995-06-01', text: 'Former District' });
    expect(during.status).toBe('resolved');
    expect(during.candidates[0].placeId).toBe('place:former-district');
    const after = resolvePlace(index, { asOf: '2020-01-01', placeId: 'place:former-district' });
    expect(after.status).toBe('unresolved');
    expect(after.rejected).toEqual([{ placeId: 'place:former-district', reason: 'validity-outside' }]);

    const pocket = resolvePlace(index, { asOf: AS_OF, placeId: 'place:pocket-town' });
    expect(pocket.status).toBe('resolved');
    expect(pocket.candidates[0].reasons).toEqual(['place-id']);
    expect(resolvePlace(index, { asOf: AS_OF, text: 'Atlantis' }).status).toBe('unresolved');
    const issuer = resolvePlace(index, { asOf: AS_OF, placeId: 'issuer:coastal-ministry' });
    expect(issuer.status).toBe('unresolved');
    expect(issuer.undecided).toEqual([{ placeId: 'issuer:coastal-ministry', reason: 'not-a-place' }]);
    expect(issuer.uncertainty).toContain(UNCERTAINTY.notAPlace);
    expect(resolvePlace(index, { asOf: AS_OF, text: 'Coastal Ministry' }).candidates).toEqual([]);
    expect(resolvePlace(index, { asOf: AS_OF, text: '   ' }).status).toBe('invalid-query');
  });

  test('rejects invalid coordinates, dates, views, and catalog bounds', () => {
    expect(resolvePoint(index, { longitude: 181, latitude: 0, asOf: AS_OF }).status).toBe('invalid-point');
    expect(resolvePoint(index, { longitude: 0, latitude: -91, asOf: AS_OF }).point).toBeNull();
    expect(resolvePoint(index, { longitude: Number.NaN, latitude: 0, asOf: AS_OF }).status).toBe('invalid-point');
    expect(() => resolvePoint(index, { longitude: 0, latitude: 0, asOf: 'yesterday' })).toThrow(JurisdictionSchemaError);
    expect(() => resolvePoint(index, { longitude: 85, latitude: 45, asOf: AS_OF, viewIds: ['view:missing'] })).toThrow(JurisdictionSchemaError);
    expect(() => resolvePoint(index, { longitude: 70, latitude: 5, asOf: AS_OF, borderToleranceDegrees: 0.6 })).toThrow(PlaceIndexError);
    expect(() => resolvePlace(index, { asOf: AS_OF, text: 'Springfield', limit: 0 })).toThrow(PlaceIndexError);
    expect(() => resolvePlace(index, { asOf: 'not-a-date', text: 'Springfield' })).toThrow(JurisdictionSchemaError);

    const triangle: GeometryRecord = {
      geometryRef: 'artifact:triangle',
      type: 'Polygon',
      coordinates: [[[0, 0], [1, 0], [0, 1]]],
    };
    expect(() => buildPlaceIndex({ graph, geometries: [triangle, triangle] })).toThrow(/Duplicate geometry ref/);
    expect(() => buildPlaceIndex({
      graph,
      geometries: [{ geometryRef: 'artifact:short', type: 'Polygon', coordinates: [[[0, 0], [1, 0]]] }],
    })).toThrow(/at least 3 distinct/);
    expect(() => buildPlaceIndex({
      graph,
      geometries: [{ geometryRef: 'artifact:high', type: 'Polygon', coordinates: [[[0, 0], [1, 0], [0, 95]]] }],
    })).toThrow(/latitude/);
    expect(() => buildPlaceIndex({
      graph,
      geometries: [{ geometryRef: 'artifact:wide', type: 'Polygon', coordinates: [[[0, 0], [190, 0], [0, 1]]] }],
    })).toThrow(/antimeridian/);
    const rings = [ring(0, 0, 10, 10)];
    for (let extra = 0; extra < PLACE_INDEX_LIMITS.maxRings; extra += 1) rings.push(ring(1, 1, 2, 2));
    expect(rings.length).toBe(PLACE_INDEX_LIMITS.maxRings + 1);
    expect(() => buildPlaceIndex({
      graph,
      geometries: [{ geometryRef: 'artifact:too-many-rings', type: 'Polygon', coordinates: rings }],
    })).toThrow(/ring limit/);
    expect(PLACE_INDEX_LIMITS.maxPreciseChecks).toBe(512);
    expect(PLACE_INDEX_LIMITS.maxFeatures).toBeGreaterThan(10);
  });
});

/**
 * Bounded point and place resolution.
 *
 * A caller supplies an admitted jurisdiction graph and the polygons those
 * boundaries reference. The graph stores geometry refs, not coordinates.
 * Resolution builds a grid index, then runs an even-odd point-in-polygon
 * test on the indexed candidates. A bounding-box hit is not membership.
 *
 * Rings that jump across the antimeridian are unwrapped before the test.
 * Holes and exclusion boundaries remove a place. Enclave, island, and
 * unincorporated flags are reported as reasons. A point on a shared edge,
 * or inside a boundary marked approximate, disputed, or border-uncertain,
 * stays a candidate set with no winner.
 *
 * Administrative edges are not treated as geometry. An unknown or expired
 * validity is not current. Nothing here decides that a law applies.
 */

import {
  APPLICABILITY,
  intervalStatus,
  JurisdictionSchemaError,
} from './schema';
import type {
  BoundaryFlag,
  BoundaryRole,
  JurisdictionGraph,
  JurisdictionNode,
  ValidityInterval,
} from './schema';

export const POINT_RESOLUTION_SCHEMA = 'worldwide-legal-search.point-resolution@1';
export const PLACE_RESOLUTION_SCHEMA = 'worldwide-legal-search.place-resolution@1';
export const PLACE_INDEX_SCHEMA = 'worldwide-legal-search.place-index@1';

export const PLACE_INDEX_LIMITS = {
  maxFeatures: 8000,
  maxParts: 64,
  maxRings: 32,
  maxVerticesPerRing: 5000,
  maxVertices: 200000,
  maxCellsPerFeature: 4096,
  maxPreciseChecks: 512,
  maxNameMatches: 32,
  maxTextLength: 300,
  maxCellDegrees: 60,
  maxBorderToleranceDegrees: 1,
} as const;

export const RESOLUTION_REASONS = [
  'antimeridian',
  'approximate',
  'border-uncertain',
  'disputed',
  'enclave',
  'hole',
  'interior',
  'island',
  'on-boundary',
  'unincorporated',
] as const;

export const REJECTION_REASONS = [
  'inside-exclusion',
  'inside-hole',
  'outside-ring',
  'validity-outside',
] as const;

export const UNDECIDED_REASONS = ['not-a-place', 'validity-unknown'] as const;

export const NAME_REASONS = ['alias', 'code', 'name', 'place-id'] as const;

export const UNCERTAINTY = {
  notApplicability: 'This resolution does not decide that a law applies.',
  border: 'The point is on a boundary or the matched boundary is marked uncertain.',
  noGeometry: 'No place geometry was accepted for this point.',
  incomplete: 'Precise checks stopped at the bounded limit. The candidate set is incomplete.',
  ambiguousName: 'More than one place matches this name. No place was selected.',
  noName: 'No place matched this id or name.',
  notAPlace: 'This id is not a place.',
} as const;

const GEOMETRY_REF = /^[a-z][a-z0-9:_./-]{2,200}$/;
const ON_EDGE_EPSILON = 1e-9;
const DATE_PROBE: ValidityInterval = {
  start: { knowledge: 'known', value: '2000', precision: 'year', source: 'resolver' },
  end: { knowledge: 'open', value: null, precision: null, source: 'resolver' },
};

export type ResolutionReason = (typeof RESOLUTION_REASONS)[number];
export type RejectionReason = (typeof REJECTION_REASONS)[number];
export type UndecidedReason = (typeof UNDECIDED_REASONS)[number];
export type NameReason = (typeof NAME_REASONS)[number];
export type PointStatus = 'resolved' | 'border-uncertain' | 'unresolved' | 'invalid-point';
export type PlaceStatus = 'resolved' | 'ambiguous' | 'unresolved' | 'invalid-query';

export type GeoPosition = readonly [number, number];
export type GeoRing = readonly GeoPosition[];
export type GeoPolygonCoordinates = readonly GeoRing[];
export type GeoMultiPolygonCoordinates = readonly GeoPolygonCoordinates[];

export type GeometryRecord =
  | { geometryRef: string; type: 'Polygon'; coordinates: GeoPolygonCoordinates }
  | { geometryRef: string; type: 'MultiPolygon'; coordinates: GeoMultiPolygonCoordinates };

export interface PlaceIndexSources {
  graph: JurisdictionGraph;
  geometries: readonly GeometryRecord[];
  cellDegrees?: number;
  borderToleranceDegrees?: number;
}

export interface PlaceIndex {
  schema: typeof PLACE_INDEX_SCHEMA;
  featureCount: number;
  placeCount: number;
  missingGeometryRefs: readonly string[];
  unknownGeometryCount: number;
  borderToleranceDegrees: number;
  cellDegrees: number;
}

export interface PlaceHit {
  placeId: string;
  name: string | null;
  levelKind: string;
  boundaryIds: string[];
  geometryRefs: string[];
  reasons: ResolutionReason[];
}

export interface RejectedPlace {
  placeId: string;
  reason: RejectionReason;
}

export interface UndecidedPlace {
  placeId: string;
  reason: UndecidedReason;
}

export interface ResolutionChecks {
  catalogFeatures: number;
  gridFeatures: number;
  indexFeatures: number;
  preciseChecks: number;
}

export interface PointQuery {
  longitude: number;
  latitude: number;
  asOf: string;
  viewIds?: readonly string[];
  borderToleranceDegrees?: number;
}

export interface PointResolution {
  schema: typeof POINT_RESOLUTION_SCHEMA;
  status: PointStatus;
  applicability: typeof APPLICABILITY;
  asOf: string;
  point: { longitude: number; latitude: number } | null;
  viewIds: string[];
  candidates: PlaceHit[];
  rejected: RejectedPlace[];
  undecided: UndecidedPlace[];
  indexedPlaceIds: string[];
  uncertainty: string[];
  truncated: boolean;
  missingGeometryRefs: readonly string[];
  unknownGeometryCount: number;
  checks: ResolutionChecks;
}

export interface PlaceQuery {
  asOf: string;
  placeId?: string | null;
  text?: string | null;
  limit?: number;
}

export interface PlaceNameHit {
  placeId: string;
  name: string | null;
  levelKind: string;
  reasons: NameReason[];
}

export interface PlaceNameResolution {
  schema: typeof PLACE_RESOLUTION_SCHEMA;
  status: PlaceStatus;
  applicability: typeof APPLICABILITY;
  asOf: string;
  query: { placeId: string | null; text: string | null };
  candidates: PlaceNameHit[];
  rejected: RejectedPlace[];
  undecided: UndecidedPlace[];
  uncertainty: string[];
  truncated: boolean;
}

interface XY {
  x: number;
  y: number;
}

interface PreparedRing {
  points: XY[];
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  crossesAntimeridian: boolean;
}

interface PreparedPart {
  rings: PreparedRing[];
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  crossesAntimeridian: boolean;
}

interface PreparedGeometry {
  parts: PreparedPart[];
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  crossesAntimeridian: boolean;
}

interface Feature {
  placeId: string;
  boundaryId: string;
  geometryRef: string;
  role: BoundaryRole;
  flags: BoundaryFlag[];
  viewId: string | null;
  boundaryValid: ValidityInterval;
  nodeValid: ValidityInterval;
  levelKind: string;
  unincorporatedLevel: boolean;
  name: string | null;
  prepared: PreparedGeometry;
}

interface NameEntry {
  placeId: string;
  kind: 'alias' | 'code' | 'name';
  valid: ValidityInterval | null;
  fold: string;
}

interface IndexState {
  features: Feature[];
  cells: Map<string, number[]>;
  broad: number[];
  namesByFold: Map<string, NameEntry[]>;
  namesByPlace: Map<string, NameEntry[]>;
  nodes: Map<string, JurisdictionNode>;
  viewIds: Set<string>;
  missingGeometryRefs: string[];
  unknownGeometryCount: number;
  borderToleranceDegrees: number;
  cellDegrees: number;
  placeCount: number;
}

type SpatialKind = 'outside' | 'in-hole' | 'on-boundary' | 'interior';

interface SpatialHit {
  kind: SpatialKind;
  holeEdge: boolean;
}

interface DatedSpatial {
  feature: Feature;
  spatial: SpatialHit;
  date: 'inside' | 'outside' | 'unknown';
}

export class PlaceIndexError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlaceIndexError';
  }
}

const STATES = new WeakMap<PlaceIndex, IndexState>();

function fail(message: string): never {
  throw new PlaceIndexError(message);
}

function assertFiniteNumber(value: number, label: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${label} must be a finite number.`);
}

function foldLon(lon: number): number {
  const wrapped = (((lon + 180) % 360) + 360) % 360 - 180;
  return wrapped === 180 ? -180 : wrapped;
}

function samePoint(left: GeoPosition, right: GeoPosition): boolean {
  return Math.abs(left[0] - right[0]) <= 1e-9 && Math.abs(left[1] - right[1]) <= 1e-9;
}

function cellOfAxis(value: number, origin: number, cell: number, maxIndex: number): number {
  const index = Math.floor((value - origin) / cell);
  if (index < 0) return 0;
  if (index > maxIndex) return maxIndex;
  return index;
}

function lonCell(lon: number, cell: number): number {
  const folded = foldLon(lon);
  const x = folded === 180 ? -180 : folded;
  return cellOfAxis(x, -180, cell, Math.ceil(360 / cell) - 1);
}

function latCell(lat: number, cell: number): number {
  const y = Math.min(90, Math.max(-90, lat));
  return cellOfAxis(y, -90, cell, Math.ceil(180 / cell) - 1);
}

function lonCellsForSpan(minX: number, maxX: number, cell: number): number[] {
  const found = new Set<number>();
  if (maxX - minX >= 360) {
    const count = Math.ceil(360 / cell);
    for (let index = 0; index < count; index += 1) found.add(index);
    return [...found];
  }
  const guard = Math.ceil((maxX - minX) / cell) + 2;
  let steps = 0;
  for (let x = minX; x < maxX && steps < guard; x += cell, steps += 1) found.add(lonCell(x, cell));
  found.add(lonCell(maxX, cell));
  return [...found];
}

function latCellsForSpan(minY: number, maxY: number, cell: number): number[] {
  const lo = Math.max(-90, minY);
  const hi = Math.min(90, maxY);
  const found = new Set<number>();
  const guard = Math.ceil(Math.max(0, hi - lo) / cell) + 2;
  let steps = 0;
  for (let y = lo; y < hi && steps < guard; y += cell, steps += 1) found.add(latCell(y, cell));
  found.add(latCell(hi, cell));
  return [...found];
}

function parseRing(ring: GeoRing, label: string, budget: { vertices: number }): PreparedRing {
  if (!Array.isArray(ring)) fail(`${label} must be an array of positions.`);
  if (ring.length > PLACE_INDEX_LIMITS.maxVerticesPerRing) {
    fail(`${label} exceeds the ${PLACE_INDEX_LIMITS.maxVerticesPerRing} vertex limit.`);
  }
  const positions: GeoPosition[] = [];
  for (let index = 0; index < ring.length; index += 1) {
    const position = ring[index];
    if (!Array.isArray(position) || position.length < 2) fail(`${label} position ${index} must be [longitude, latitude].`);
    const longitude = position[0];
    const latitude = position[1];
    assertFiniteNumber(longitude, `${label} longitude`);
    assertFiniteNumber(latitude, `${label} latitude`);
    if (longitude < -180 || longitude > 180) {
      fail(`${label} longitude ${longitude} is outside [-180, 180]. Cross the antimeridian with a jump inside that range.`);
    }
    if (latitude < -90 || latitude > 90) fail(`${label} latitude ${latitude} is outside [-90, 90].`);
    positions.push([longitude, latitude]);
  }
  if (positions.length >= 2 && samePoint(positions[0], positions[positions.length - 1])) positions.pop();
  const distinct = new Set(positions.map((position) => `${position[0].toFixed(7)},${position[1].toFixed(7)}`));
  if (distinct.size < 3) fail(`${label} needs at least 3 distinct positions.`);
  budget.vertices += positions.length;
  if (budget.vertices > PLACE_INDEX_LIMITS.maxVertices) {
    fail(`Geometry exceeds the ${PLACE_INDEX_LIMITS.maxVertices} vertex limit.`);
  }
  // Unwrap jumps greater than 180° so a short antimeridian crossing stays short.
  const points: XY[] = [{ x: positions[0][0], y: positions[0][1] }];
  let offset = 0;
  let crossesAntimeridian = false;
  for (let index = 1; index < positions.length; index += 1) {
    let x = positions[index][0] + offset;
    const delta = x - points[index - 1].x;
    if (delta > 180) {
      offset -= 360;
      x -= 360;
      crossesAntimeridian = true;
    } else if (delta < -180) {
      offset += 360;
      x += 360;
      crossesAntimeridian = true;
    }
    points.push({ x, y: positions[index][1] });
  }
  let minX = points[0].x;
  let maxX = points[0].x;
  let minY = points[0].y;
  let maxY = points[0].y;
  for (const point of points) {
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.y > maxY) maxY = point.y;
  }
  return { points, minX, maxX, minY, maxY, crossesAntimeridian };
}

function parsePolygon(coordinates: GeoPolygonCoordinates, label: string, budget: { vertices: number }): PreparedPart {
  if (!Array.isArray(coordinates) || coordinates.length === 0) fail(`${label} needs an exterior ring.`);
  if (coordinates.length > PLACE_INDEX_LIMITS.maxRings) {
    fail(`${label} exceeds the ${PLACE_INDEX_LIMITS.maxRings} ring limit.`);
  }
  const rings = coordinates.map((ring, index) => parseRing(ring, `${label} ring ${index}`, budget));
  return coverParts(rings);
}

function coverParts(rings: PreparedRing[]): PreparedPart {
  let minX = rings[0].minX;
  let maxX = rings[0].maxX;
  let minY = rings[0].minY;
  let maxY = rings[0].maxY;
  let crossesAntimeridian = false;
  for (const ring of rings) {
    if (ring.minX < minX) minX = ring.minX;
    if (ring.maxX > maxX) maxX = ring.maxX;
    if (ring.minY < minY) minY = ring.minY;
    if (ring.maxY > maxY) maxY = ring.maxY;
    if (ring.crossesAntimeridian) crossesAntimeridian = true;
  }
  return { rings, minX, maxX, minY, maxY, crossesAntimeridian };
}

function prepareGeometry(record: GeometryRecord, budget: { vertices: number }): PreparedGeometry {
  let parts: PreparedPart[];
  if (record.type === 'Polygon') {
    parts = [parsePolygon(record.coordinates, record.geometryRef, budget)];
  } else if (record.type === 'MultiPolygon') {
    if (!Array.isArray(record.coordinates) || record.coordinates.length === 0) {
      fail(`${record.geometryRef} needs at least one polygon.`);
    }
    if (record.coordinates.length > PLACE_INDEX_LIMITS.maxParts) {
      fail(`${record.geometryRef} exceeds the ${PLACE_INDEX_LIMITS.maxParts} part limit.`);
    }
    parts = record.coordinates.map((polygon, index) => parsePolygon(polygon, `${record.geometryRef} part ${index}`, budget));
  } else {
    fail(`${record.geometryRef} has an unsupported geometry type.`);
  }
  let minX = parts[0].minX;
  let maxX = parts[0].maxX;
  let minY = parts[0].minY;
  let maxY = parts[0].maxY;
  let crossesAntimeridian = false;
  for (const part of parts) {
    if (part.minX < minX) minX = part.minX;
    if (part.maxX > maxX) maxX = part.maxX;
    if (part.minY < minY) minY = part.minY;
    if (part.maxY > maxY) maxY = part.maxY;
    if (part.crossesAntimeridian) crossesAntimeridian = true;
  }
  return { parts, minX, maxX, minY, maxY, crossesAntimeridian };
}

function pointSegmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / lengthSquared;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function onRing(x: number, y: number, ring: PreparedRing, tolerance: number): boolean {
  const points = ring.points;
  for (let index = 0; index < points.length; index += 1) {
    const next = points[(index + 1) % points.length];
    const current = points[index];
    if (pointSegmentDistance(x, y, current.x, current.y, next.x, next.y) <= tolerance) return true;
  }
  return false;
}

/**
 * Even-odd ray cast toward +x. A vertex is counted only when one endpoint
 * is strictly above the point, so a ray through a vertex is not counted twice.
 */
function ringContains(x: number, y: number, ring: PreparedRing): boolean {
  const points = ring.points;
  let inside = false;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index, index += 1) {
    const current = points[index];
    const prior = points[previous];
    const crosses = (current.y > y) !== (prior.y > y);
    if (!crosses) continue;
    const xAtY = ((prior.x - current.x) * (y - current.y)) / (prior.y - current.y) + current.x;
    if (x < xAtY) inside = !inside;
  }
  return inside;
}

function classifyPart(x: number, y: number, part: PreparedPart, tolerance: number): SpatialHit {
  if (x < part.minX - tolerance || x > part.maxX + tolerance || y < part.minY - tolerance || y > part.maxY + tolerance) {
    return { kind: 'outside', holeEdge: false };
  }
  let holeEdge = false;
  for (let index = 0; index < part.rings.length; index += 1) {
    if (!onRing(x, y, part.rings[index], tolerance)) continue;
    if (index > 0) holeEdge = true;
    return { kind: 'on-boundary', holeEdge };
  }
  if (!ringContains(x, y, part.rings[0])) return { kind: 'outside', holeEdge: false };
  for (let index = 1; index < part.rings.length; index += 1) {
    if (ringContains(x, y, part.rings[index])) return { kind: 'in-hole', holeEdge: false };
  }
  return { kind: 'interior', holeEdge: false };
}

function candidateXs(lon: number, minX: number, maxX: number, tolerance: number): number[] {
  const xs: number[] = [];
  const push = (x: number) => {
    if (x < minX - tolerance || x > maxX + tolerance) return;
    if (xs.some((item) => Math.abs(item - x) <= 1e-9)) return;
    xs.push(x);
  };
  push(lon);
  push(lon + 360);
  push(lon - 360);
  const mid = (minX + maxX) / 2;
  push(lon + Math.round((mid - lon) / 360) * 360);
  return xs;
}

const SPATIAL_RANK: Record<SpatialKind, number> = {
  outside: 0,
  'in-hole': 1,
  'on-boundary': 2,
  interior: 3,
};

function preferSpatial(current: SpatialHit, next: SpatialHit): SpatialHit {
  if (SPATIAL_RANK[next.kind] > SPATIAL_RANK[current.kind]) return next;
  if (next.kind === current.kind && next.holeEdge) return next;
  return current;
}

function locate(lon: number, lat: number, geometry: PreparedGeometry, tolerance: number): SpatialHit {
  if (lat < geometry.minY - tolerance || lat > geometry.maxY + tolerance) return { kind: 'outside', holeEdge: false };
  const xs = candidateXs(lon, geometry.minX, geometry.maxX, tolerance);
  if (xs.length === 0) return { kind: 'outside', holeEdge: false };
  let best: SpatialHit = { kind: 'outside', holeEdge: false };
  for (const x of xs) {
    for (const part of geometry.parts) {
      best = preferSpatial(best, classifyPart(x, lat, part, tolerance));
    }
  }
  return best;
}

function bboxHit(lon: number, lat: number, geometry: PreparedGeometry, tolerance: number): boolean {
  if (lat < geometry.minY - tolerance || lat > geometry.maxY - 0 + tolerance) return false;
  return candidateXs(lon, geometry.minX, geometry.maxX, tolerance).length > 0;
}

function cellKey(x: number, y: number): string {
  return `${x}:${y}`;
}

function requireState(index: PlaceIndex): IndexState {
  const state = STATES.get(index);
  if (!state) fail('This place index was not built by buildPlaceIndex.');
  return state;
}

function placeName(node: JurisdictionNode): string | null {
  return node.names.length > 0 ? node.names[0].text : null;
}

function foldName(value: string): string {
  return value.normalize('NFC').toLowerCase();
}

function cleanQueryText(value: string): string {
  return value.replace(/[\u0000-\u001F\u007F]/g, '').trim();
}

function probeAsOf(asOf: string): void {
  intervalStatus(DATE_PROBE, asOf);
}

function dateOf(feature: Feature, asOf: string): 'inside' | 'outside' | 'unknown' {
  const node = intervalStatus(feature.nodeValid, asOf);
  if (node !== 'inside') return node;
  return intervalStatus(feature.boundaryValid, asOf);
}

function addReason(target: Set<ResolutionReason>, reason: ResolutionReason): void {
  target.add(reason);
}

function reasonsFromPositive(feature: Feature, spatial: SpatialHit): ResolutionReason[] {
  const reasons = new Set<ResolutionReason>();
  for (const flag of feature.flags) {
    if (flag === 'enclave' || flag === 'island' || flag === 'unincorporated' || flag === 'antimeridian') addReason(reasons, flag);
    if (flag === 'border-uncertain') addReason(reasons, 'border-uncertain');
  }
  if (feature.unincorporatedLevel) addReason(reasons, 'unincorporated');
  if (feature.prepared.crossesAntimeridian || feature.flags.includes('antimeridian')) addReason(reasons, 'antimeridian');
  if (spatial.kind === 'interior') addReason(reasons, 'interior');
  if (spatial.kind === 'on-boundary') {
    addReason(reasons, 'on-boundary');
    addReason(reasons, 'border-uncertain');
    if (spatial.holeEdge || feature.flags.includes('hole') || feature.role === 'hole') addReason(reasons, 'hole');
  }
  if (feature.role === 'approximate') {
    addReason(reasons, 'approximate');
    addReason(reasons, 'border-uncertain');
  }
  if (feature.role === 'disputed') {
    addReason(reasons, 'disputed');
    addReason(reasons, 'border-uncertain');
  }
  return [...reasons];
}

function sortedReasons(reasons: Iterable<ResolutionReason>): ResolutionReason[] {
  return [...new Set(reasons)].sort((left, right) => left.localeCompare(right));
}

function excludes(hit: DatedSpatial): boolean {
  if (hit.date !== 'inside') return false;
  if (hit.spatial.kind !== 'interior' && hit.spatial.kind !== 'in-hole') return false;
  if (hit.feature.role === 'exclusion' || hit.feature.role === 'hole') return hit.spatial.kind === 'interior';
  return hit.spatial.kind === 'in-hole';
}

function isPositiveRole(role: BoundaryRole): boolean {
  return role === 'primary' || role === 'approximate' || role === 'disputed';
}

function emptyChecks(catalogFeatures: number): ResolutionChecks {
  return { catalogFeatures, gridFeatures: 0, indexFeatures: 0, preciseChecks: 0 };
}

function invalidPoint(state: IndexState, asOf: string, viewIds: string[]): PointResolution {
  return {
    schema: POINT_RESOLUTION_SCHEMA,
    status: 'invalid-point',
    applicability: APPLICABILITY,
    asOf,
    point: null,
    viewIds,
    candidates: [],
    rejected: [],
    undecided: [],
    indexedPlaceIds: [],
    uncertainty: [UNCERTAINTY.notApplicability],
    truncated: false,
    missingGeometryRefs: state.missingGeometryRefs,
    unknownGeometryCount: state.unknownGeometryCount,
    checks: emptyChecks(state.features.length),
  };
}

export function buildPlaceIndex(sources: PlaceIndexSources): PlaceIndex {
  if (!sources || typeof sources !== 'object' || !sources.graph || !Array.isArray(sources.graph.nodes)) {
    fail('A place index needs an admitted jurisdiction graph.');
  }
  if (!Array.isArray(sources.geometries)) fail('A place index needs a geometry catalog.');
  const cellDegrees = sources.cellDegrees === undefined ? 1 : sources.cellDegrees;
  const borderToleranceDegrees = sources.borderToleranceDegrees === undefined ? 0 : sources.borderToleranceDegrees;
  assertFiniteNumber(cellDegrees, 'cellDegrees');
  assertFiniteNumber(borderToleranceDegrees, 'borderToleranceDegrees');
  if (cellDegrees <= 0 || cellDegrees > PLACE_INDEX_LIMITS.maxCellDegrees) {
    fail(`cellDegrees must be greater than 0 and at most ${PLACE_INDEX_LIMITS.maxCellDegrees}.`);
  }
  if (borderToleranceDegrees < 0 || borderToleranceDegrees > PLACE_INDEX_LIMITS.maxBorderToleranceDegrees) {
    fail(`borderToleranceDegrees must be from 0 through ${PLACE_INDEX_LIMITS.maxBorderToleranceDegrees}.`);
  }
  const geometries = new Map<string, PreparedGeometry>();
  const budget = { vertices: 0 };
  for (const record of sources.geometries) {
    if (!record || typeof record.geometryRef !== 'string' || !GEOMETRY_REF.test(record.geometryRef)) {
      fail('Each geometry needs a geometryRef artifact id.');
    }
    if (geometries.has(record.geometryRef)) fail(`Duplicate geometry ref ${record.geometryRef}.`);
    geometries.set(record.geometryRef, prepareGeometry(record, budget));
  }
  const features: Feature[] = [];
  const missing = new Set<string>();
  let unknownGeometryCount = 0;
  const placeIds = new Set<string>();
  const nodes = new Map<string, JurisdictionNode>();
  const namesByFold = new Map<string, NameEntry[]>();
  const namesByPlace = new Map<string, NameEntry[]>();
  const viewIds = new Set<string>();
  for (const view of sources.graph.disputedViews ?? []) viewIds.add(view.id);
  const addName = (entry: NameEntry) => {
    const byFold = namesByFold.get(entry.fold);
    if (byFold) byFold.push(entry);
    else namesByFold.set(entry.fold, [entry]);
    const byPlace = namesByPlace.get(entry.placeId);
    if (byPlace) byPlace.push(entry);
    else namesByPlace.set(entry.placeId, [entry]);
  };
  for (const node of sources.graph.nodes) {
    nodes.set(node.id, node);
    if (!node.roles.includes('place')) continue;
    placeIds.add(node.id);
    if (node.boundaries.length === 0) unknownGeometryCount += 1;
    for (const boundary of node.boundaries) {
      if (boundary.geometryKnowledge === 'unknown' || !boundary.geometryRef) {
        unknownGeometryCount += 1;
        continue;
      }
      const prepared = geometries.get(boundary.geometryRef);
      if (!prepared) {
        missing.add(boundary.geometryRef);
        continue;
      }
      features.push({
        placeId: node.id,
        boundaryId: boundary.boundaryId,
        geometryRef: boundary.geometryRef,
        role: boundary.role,
        flags: [...boundary.flags],
        viewId: boundary.viewId,
        boundaryValid: boundary.valid,
        nodeValid: node.valid,
        levelKind: node.level.kind,
        unincorporatedLevel: node.level.kind === 'unincorporated',
        name: placeName(node),
        prepared,
      });
    }
    for (const name of node.names) {
      const fold = foldName(name.text);
      if (fold) addName({ placeId: node.id, kind: 'name', valid: null, fold });
    }
    for (const alias of node.aliases) {
      const fold = foldName(alias.text);
      if (!fold) continue;
      addName({
        placeId: node.id,
        kind: alias.kind === 'code' ? 'code' : 'alias',
        valid: alias.valid,
        fold,
      });
    }
  }
  if (features.length > PLACE_INDEX_LIMITS.maxFeatures) {
    fail(`Geometry features exceed the ${PLACE_INDEX_LIMITS.maxFeatures} feature limit.`);
  }
  const cells = new Map<string, number[]>();
  const broad: number[] = [];
  const seenInCell = new Map<string, Set<number>>();
  for (let index = 0; index < features.length; index += 1) {
    const geometry = features[index].prepared;
    const xs = lonCellsForSpan(
      geometry.minX - borderToleranceDegrees,
      geometry.maxX + borderToleranceDegrees,
      cellDegrees,
    );
    const ys = latCellsForSpan(
      geometry.minY - borderToleranceDegrees,
      geometry.maxY + borderToleranceDegrees,
      cellDegrees,
    );
    if (xs.length * ys.length > PLACE_INDEX_LIMITS.maxCellsPerFeature) {
      broad.push(index);
      continue;
    }
    for (const x of xs) {
      for (const y of ys) {
        const key = cellKey(x, y);
        let bucket = seenInCell.get(key);
        if (!bucket) {
          bucket = new Set<number>();
          seenInCell.set(key, bucket);
          cells.set(key, []);
        }
        if (bucket.has(index)) continue;
        bucket.add(index);
        cells.get(key)?.push(index);
      }
    }
  }
  const index: PlaceIndex = {
    schema: PLACE_INDEX_SCHEMA,
    featureCount: features.length,
    placeCount: placeIds.size,
    missingGeometryRefs: [...missing].sort((left, right) => left.localeCompare(right)),
    unknownGeometryCount,
    borderToleranceDegrees,
    cellDegrees,
  };
  STATES.set(index, {
    features,
    cells,
    broad,
    namesByFold,
    namesByPlace,
    nodes,
    viewIds,
    missingGeometryRefs: index.missingGeometryRefs.slice(),
    unknownGeometryCount,
    borderToleranceDegrees,
    cellDegrees,
    placeCount: placeIds.size,
  });
  return index;
}

function gridFeatures(state: IndexState, longitude: number, latitude: number, tolerance: number): number[] {
  const xs = lonCellsForSpan(longitude - tolerance, longitude + tolerance, state.cellDegrees);
  const ys = latCellsForSpan(latitude - tolerance, latitude + tolerance, state.cellDegrees);
  const found = new Set<number>(state.broad);
  for (const x of xs) {
    for (const y of ys) {
      const bucket = state.cells.get(cellKey(x, y));
      if (!bucket) continue;
      for (const index of bucket) found.add(index);
    }
  }
  return [...found].sort((left, right) => left - right);
}

function pointUncertainty(status: PointStatus, truncated: boolean, candidateCount: number): string[] {
  const uncertainty = [UNCERTAINTY.notApplicability];
  if (truncated) uncertainty.push(UNCERTAINTY.incomplete);
  if (status === 'border-uncertain') uncertainty.push(UNCERTAINTY.border);
  if (candidateCount === 0 && status !== 'invalid-point') uncertainty.push(UNCERTAINTY.noGeometry);
  return uncertainty;
}

export function resolvePoint(index: PlaceIndex, query: PointQuery): PointResolution {
  const state = requireState(index);
  probeAsOf(query.asOf);
  const viewIds = [...(query.viewIds ?? [])];
  for (const viewId of viewIds) {
    if (!state.viewIds.has(viewId)) {
      throw new JurisdictionSchemaError(`Disputed view ${JSON.stringify(viewId)} is not in this place index.`);
    }
  }
  const tolerance = query.borderToleranceDegrees === undefined ? 0 : query.borderToleranceDegrees;
  assertFiniteNumber(tolerance, 'borderToleranceDegrees');
  if (tolerance < 0) fail('borderToleranceDegrees cannot be negative.');
  if (tolerance > state.borderToleranceDegrees) {
    fail(`Query border tolerance ${tolerance} exceeds the index tolerance ${state.borderToleranceDegrees}.`);
  }
  const edgeTolerance = Math.max(tolerance, ON_EDGE_EPSILON);
  if (!Number.isFinite(query.longitude) || !Number.isFinite(query.latitude)) {
    return invalidPoint(state, query.asOf, viewIds);
  }
  if (query.longitude < -180 || query.longitude > 180 || query.latitude < -90 || query.latitude > 90) {
    return invalidPoint(state, query.asOf, viewIds);
  }
  const selected = new Set(viewIds);
  const retrieved = gridFeatures(state, query.longitude, query.latitude, tolerance);
  const checks = emptyChecks(state.features.length);
  checks.gridFeatures = retrieved.length;
  let truncated = false;
  const byPlace = new Map<string, DatedSpatial[]>();
  for (const featureIndex of retrieved) {
    const feature = state.features[featureIndex];
    if (feature.viewId !== null && !selected.has(feature.viewId)) continue;
    if (!bboxHit(query.longitude, query.latitude, feature.prepared, tolerance)) continue;
    checks.indexFeatures += 1;
    if (checks.preciseChecks >= PLACE_INDEX_LIMITS.maxPreciseChecks) {
      truncated = true;
      continue;
    }
    checks.preciseChecks += 1;
    const spatial = locate(query.longitude, query.latitude, feature.prepared, edgeTolerance);
    const date = dateOf(feature, query.asOf);
    const list = byPlace.get(feature.placeId);
    const dated = { feature, spatial, date };
    if (list) list.push(dated);
    else byPlace.set(feature.placeId, [dated]);
  }
  const candidates: PlaceHit[] = [];
  const rejected: RejectedPlace[] = [];
  const undecided: UndecidedPlace[] = [];
  const indexedPlaceIds: string[] = [];
  for (const [placeId, hits] of byPlace) {
    indexedPlaceIds.push(placeId);
    const excluding = hits.filter(excludes);
    if (excluding.length > 0) {
      const reason = excluding.some((hit) => hit.feature.role === 'exclusion') ? 'inside-exclusion' : 'inside-hole';
      rejected.push({ placeId, reason });
      continue;
    }
    const positive = hits.filter(
      (hit) => hit.date === 'inside' && isPositiveRole(hit.feature.role) && (hit.spatial.kind === 'interior' || hit.spatial.kind === 'on-boundary'),
    );
    if (positive.length > 0) {
      const exclusionEdge = hits.some(
        (hit) =>
          hit.date === 'inside' &&
          (hit.feature.role === 'exclusion' || hit.feature.role === 'hole') &&
          hit.spatial.kind === 'on-boundary',
      );
      const reasons = new Set<ResolutionReason>();
      const boundaryIds = new Set<string>();
      const geometryRefs = new Set<string>();
      let name: string | null = null;
      let levelKind = 'unknown';
      for (const hit of positive) {
        if (name === null) name = hit.feature.name;
        levelKind = hit.feature.levelKind;
        boundaryIds.add(hit.feature.boundaryId);
        geometryRefs.add(hit.feature.geometryRef);
        for (const reason of reasonsFromPositive(hit.feature, hit.spatial)) reasons.add(reason);
      }
      if (exclusionEdge) {
        reasons.delete('interior');
        reasons.add('on-boundary');
        reasons.add('border-uncertain');
      }
      candidates.push({
        placeId,
        name,
        levelKind,
        boundaryIds: [...boundaryIds].sort((left, right) => left.localeCompare(right)),
        geometryRefs: [...geometryRefs].sort((left, right) => left.localeCompare(right)),
        reasons: sortedReasons(reasons),
      });
      continue;
    }
    const unknown = hits.some((hit) => hit.date === 'unknown' && hit.spatial.kind !== 'outside');
    const expired = hits.some((hit) => hit.date === 'outside' && hit.spatial.kind !== 'outside');
    if (unknown) undecided.push({ placeId, reason: 'validity-unknown' });
    else if (expired) rejected.push({ placeId, reason: 'validity-outside' });
    else rejected.push({ placeId, reason: 'outside-ring' });
  }
  candidates.sort((left, right) => left.placeId.localeCompare(right.placeId));
  rejected.sort((left, right) => left.placeId.localeCompare(right.placeId));
  undecided.sort((left, right) => left.placeId.localeCompare(right.placeId));
  indexedPlaceIds.sort((left, right) => left.localeCompare(right));
  const uncertain = candidates.some((candidate) => candidate.reasons.includes('border-uncertain'));
  let status: PointStatus;
  if (candidates.length === 0) status = 'unresolved';
  else if (uncertain) status = 'border-uncertain';
  else status = 'resolved';
  return {
    schema: POINT_RESOLUTION_SCHEMA,
    status,
    applicability: APPLICABILITY,
    asOf: query.asOf,
    point: { longitude: query.longitude, latitude: query.latitude },
    viewIds,
    candidates,
    rejected,
    undecided,
    indexedPlaceIds,
    uncertainty: pointUncertainty(status, truncated, candidates.length),
    truncated,
    missingGeometryRefs: state.missingGeometryRefs,
    unknownGeometryCount: state.unknownGeometryCount,
    checks,
  };
}

interface NameVerdict {
  placeId: string;
  name: string | null;
  levelKind: string;
  reasons: NameReason[];
  outcome: 'match' | 'outside' | 'unknown' | 'not-a-place';
}

function nodeOutcome(node: JurisdictionNode, asOf: string): 'inside' | 'outside' | 'unknown' {
  return intervalStatus(node.valid, asOf);
}

function entryOutcome(entry: NameEntry, asOf: string): 'inside' | 'outside' | 'unknown' {
  if (!entry.valid) return 'inside';
  return intervalStatus(entry.valid, asOf);
}

function verdictFor(
  state: IndexState,
  placeId: string,
  asOf: string,
  textFold: string | null,
  byId: boolean,
): NameVerdict | null {
  const node = state.nodes.get(placeId);
  if (!node) return null;
  const name = placeName(node);
  const levelKind = node.level.kind;
  if (!node.roles.includes('place')) {
    return { placeId, name, levelKind, reasons: [], outcome: 'not-a-place' };
  }
  const nodeDate = nodeOutcome(node, asOf);
  // A place-id lookup is not a name search. Name, alias, and code reasons
  // appear only when the caller also supplied text that folds onto an entry.
  const entries = textFold === null
    ? []
    : (state.namesByPlace.get(placeId) ?? []).filter((entry) => entry.fold === textFold);
  const reasons = new Set<NameReason>();
  if (byId) reasons.add('place-id');
  let sawUnknown = false;
  let sawOutside = false;
  let sawMatch = byId && textFold === null;
  for (const entry of entries) {
    const outcome = entryOutcome(entry, asOf);
    if (outcome === 'unknown') {
      sawUnknown = true;
      continue;
    }
    if (outcome === 'outside') {
      sawOutside = true;
      continue;
    }
    sawMatch = true;
    reasons.add(entry.kind);
  }
  if (textFold !== null && !sawMatch && !sawUnknown && !sawOutside && !byId) return null;
  if (nodeDate === 'unknown' || (sawUnknown && !sawMatch)) {
    return { placeId, name, levelKind, reasons: [], outcome: 'unknown' };
  }
  if (nodeDate === 'outside' || (!sawMatch && sawOutside)) {
    return { placeId, name, levelKind, reasons: [], outcome: 'outside' };
  }
  if (!sawMatch) return null;
  return {
    placeId,
    name,
    levelKind,
    reasons: [...reasons].sort((left, right) => left.localeCompare(right)),
    outcome: 'match',
  };
}

export function resolvePlace(index: PlaceIndex, query: PlaceQuery): PlaceNameResolution {
  const state = requireState(index);
  probeAsOf(query.asOf);
  const limit = query.limit === undefined ? PLACE_INDEX_LIMITS.maxNameMatches : query.limit;
  if (!Number.isInteger(limit) || limit < 1 || limit > PLACE_INDEX_LIMITS.maxNameMatches) {
    fail(`Place match limit must be an integer from 1 through ${PLACE_INDEX_LIMITS.maxNameMatches}.`);
  }
  const placeId = typeof query.placeId === 'string' && query.placeId.trim() ? query.placeId.trim() : null;
  const rawText = typeof query.text === 'string' ? cleanQueryText(query.text) : '';
  if (rawText.length > PLACE_INDEX_LIMITS.maxTextLength) {
    return nameResult(query.asOf, placeId, null, 'invalid-query', [], [], [], false);
  }
  const text = rawText ? foldName(rawText) : null;
  const echoed = rawText.length > 0 ? rawText : null;
  if (!placeId && !text) return nameResult(query.asOf, null, null, 'invalid-query', [], [], [], false);
  const verdicts: NameVerdict[] = [];
  if (placeId) {
    const verdict = verdictFor(state, placeId, query.asOf, text, true);
    if (verdict) verdicts.push(verdict);
  } else if (text) {
    const seen = new Set<string>();
    for (const entry of state.namesByFold.get(text) ?? []) {
      if (seen.has(entry.placeId)) continue;
      seen.add(entry.placeId);
      const verdict = verdictFor(state, entry.placeId, query.asOf, text, false);
      if (verdict) verdicts.push(verdict);
    }
  }
  const matches = verdicts.filter((verdict) => verdict.outcome === 'match');
  const rejected = verdicts
    .filter((verdict) => verdict.outcome === 'outside')
    .map((verdict) => ({ placeId: verdict.placeId, reason: 'validity-outside' as const }));
  const undecided = verdicts
    .filter((verdict) => verdict.outcome === 'unknown' || verdict.outcome === 'not-a-place')
    .map((verdict) => ({
      placeId: verdict.placeId,
      reason: verdict.outcome === 'not-a-place' ? ('not-a-place' as const) : ('validity-unknown' as const),
    }));
  matches.sort((left, right) => left.placeId.localeCompare(right.placeId));
  rejected.sort((left, right) => left.placeId.localeCompare(right.placeId));
  undecided.sort((left, right) => left.placeId.localeCompare(right.placeId));
  const truncated = matches.length > limit;
  const candidates = matches.slice(0, limit).map((verdict) => ({
    placeId: verdict.placeId,
    name: verdict.name,
    levelKind: verdict.levelKind,
    reasons: verdict.reasons,
  }));
  let status: PlaceStatus;
  if (candidates.length === 0) status = 'unresolved';
  else if (matches.length > 1) status = 'ambiguous';
  else status = 'resolved';
  return nameResult(query.asOf, placeId, echoed, status, candidates, rejected, undecided, truncated);
}

function nameResult(
  asOf: string,
  placeId: string | null,
  text: string | null,
  status: PlaceStatus,
  candidates: PlaceNameHit[],
  rejected: RejectedPlace[],
  undecided: UndecidedPlace[],
  truncated: boolean,
): PlaceNameResolution {
  const uncertainty = [UNCERTAINTY.notApplicability];
  if (status === 'invalid-query') uncertainty.push('The place query is empty or longer than the bounded text limit.');
  if (status === 'ambiguous') uncertainty.push(UNCERTAINTY.ambiguousName);
  if (status === 'unresolved') uncertainty.push(UNCERTAINTY.noName);
  if (undecided.some((item) => item.reason === 'not-a-place')) uncertainty.push(UNCERTAINTY.notAPlace);
  if (truncated) uncertainty.push(UNCERTAINTY.incomplete);
  return {
    schema: PLACE_RESOLUTION_SCHEMA,
    status,
    applicability: APPLICABILITY,
    asOf,
    query: { placeId, text },
    candidates,
    rejected,
    undecided,
    uncertainty,
    truncated,
  };
}

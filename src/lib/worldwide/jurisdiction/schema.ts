/**
 * Dated jurisdiction and issuer graph.
 *
 * A place is a node with a stable internal id. The graph is not a
 * country/province/city tuple, and a place does not need a city child or a
 * city field. Country and ISO codes are aliases or external ids, never the
 * node id.
 *
 * Edges are dated and directed. A node may have several parents. Administrative
 * containment, territorial coverage, delegated authority, and a supported legal
 * relationship stay distinct. None of them asserts that a law applies.
 * Disputed interpretations live in named views. A relationship the source
 * could not determine is an unknown-relationship statement with no endpoint,
 * not a guessed parent and not a silent omission.
 *
 * Omitted edges are not unknown statements and are not legal conclusions.
 * parentKnowledge "none" means the source says there is no administrative
 * parent. Validity dates are civil dates at year, month, or day precision.
 * An unknown bound is not treated as current. This module does not resolve
 * coordinates or rank disputed views.
 */

import type { DatePrecision } from '../contracts';

export const SCHEMA_VERSION = 1;
export const CITY_REQUIRED = false as const;
export const APPLICABILITY = 'not-asserted' as const;

export const JURISDICTION_GRAPH_SCHEMA = 'worldwide-legal-search.jurisdiction-graph@1';
export const JURISDICTION_NODE_SCHEMA = 'worldwide-legal-search.jurisdiction-node@1';
export const JURISDICTION_EDGE_SCHEMA = 'worldwide-legal-search.jurisdiction-edge@1';
export const DISPUTED_VIEW_SCHEMA = 'worldwide-legal-search.disputed-view@1';
export const UNKNOWN_RELATIONSHIP_SCHEMA = 'worldwide-legal-search.unknown-relationship@1';
export const QUARANTINE_SCHEMA = 'worldwide-legal-search.jurisdiction-quarantine@1';

export const MAX_NODES = 20000;
export const MAX_EDGES = 40000;
export const MAX_VIEWS = 2000;
export const MAX_UNKNOWN_RELATIONSHIPS = 20000;

export const RECOGNIZED_LEVEL_KINDS = [
  'supranational',
  'country',
  'dependency',
  'constituent-country',
  'region',
  'state',
  'province',
  'territory',
  'county',
  'district',
  'municipality',
  'city',
  'locality',
  'borough',
  'neighborhood',
  'special-district',
  'autonomous-area',
  'indigenous-territory',
  'unincorporated',
  'statistical-area',
  'postal-area',
  'national-authority',
  'regional-authority',
  'local-authority',
  'court',
  'unknown',
] as const;

export const RELATION_KINDS = [
  'administrative-containment',
  'territorial-coverage',
  'delegated-authority',
  'legal-relationship',
] as const;

export const RELATION_DIRECTION = {
  'administrative-containment': { from: 'child', to: 'parent' },
  'territorial-coverage': { from: 'covered-place', to: 'covering-authority-or-territory' },
  'delegated-authority': { from: 'delegate', to: 'delegator' },
  'legal-relationship': { from: 'party', to: 'counterparty' },
} as const;

export const UNKNOWN_ABOUTS = [
  'administrative-parent',
  'territorial-coverage',
  'delegated-authority',
  'legal-relationship',
  'issuer',
  'boundary',
  'level',
  'name',
] as const;

export const BOUNDARY_ROLES = ['primary', 'disputed', 'approximate', 'exclusion', 'hole'] as const;
export const BOUNDARY_FLAGS = [
  'enclave',
  'island',
  'unincorporated',
  'antimeridian',
  'hole',
  'border-uncertain',
] as const;
export const ALIAS_KINDS = ['native', 'official', 'exonym', 'historical', 'code', 'other'] as const;
export const EXTERNAL_ID_SCHEMES = [
  'iso-3166-1-alpha2',
  'iso-3166-1-alpha3',
  'iso-3166-2',
  'wikidata',
  'geonames',
  'publisher',
  'custom',
] as const;
export const PARENT_KNOWLEDGE = ['known', 'none', 'unknown', 'disputed'] as const;
export const ISSUER_KNOWLEDGE = ['known', 'none', 'unknown'] as const;
export const NODE_ROLES = ['place', 'issuer'] as const;

const FLOATING_REVISIONS = new Set([
  'head',
  'main',
  'master',
  'latest',
  'trunk',
  'current',
  'floating',
  'unpinned',
  'none',
  'null',
  'undefined',
  'tip',
  'dev',
  'develop',
]);

const TUPLE_FIELDS = ['city', 'country', 'province', 'state'] as const;
const UNKNOWN_TARGET_FIELDS = [
  'targetId',
  'parentId',
  'toId',
  'fromId',
  'city',
  'country',
  'province',
  'state',
  'guessed',
  'endpoint',
  'objectId',
] as const;

const LANGUAGE_TAG = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;
const SCRIPT_TAG = /^[A-Z][a-z]{3}$/;
const LEVEL_KIND = /^[a-z][a-z0-9-]{0,63}$/;
const NODE_ID = /^(?:place|issuer):[a-z0-9][a-z0-9._:-]{1,120}$/;
const CODE_SEGMENT = /^[a-z]{2}$|^[a-z]{3}$|^[a-z]{2}-[a-z0-9]{1,3}$/;
const GRAPH_ID = /^graph:[a-z0-9][a-z0-9._:-]{1,120}$/;
const EDGE_ID = /^edge:[a-z0-9][a-z0-9._:-]{1,120}$/;
const VIEW_ID = /^view:[a-z0-9][a-z0-9._:-]{1,120}$/;
const BOUNDARY_ID = /^boundary:[a-z0-9][a-z0-9._:-]{1,120}$/;
const SOURCE_ID = /^[A-Za-z0-9][A-Za-z0-9:._/@+-]{2,160}$/;
const GEOMETRY_REF = /^[a-z][a-z0-9:_./-]{2,200}$/;
const CUSTOM_SCHEME = /^[a-z][a-z0-9-]{1,40}$/;
const CODE_TEXT = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,31}$/;

export const QUARANTINE_REASONS = {
  'tuple-is-not-graph':
    'A country, province, state, or city field is not a jurisdiction graph. A city is not required, and no place was invented.',
  'missing-graph-id': 'Graph id is absent. No graph identity was invented.',
  'invalid-graph-id': 'Graph id must be a graph: token.',
  'missing-graph-source': 'Graph source id is absent. No registry identity was invented.',
  'missing-source-revision': 'Source revision is absent. An unpinned graph cannot be admitted.',
  'unpinned-source-revision': 'Source revision is a floating label rather than a pinned revision.',
  'invalid-source-revision': 'Source revision is not a 40- or 64-character hex pin or a stable revision token.',
  'invalid-publisher-id': 'Publisher id is empty or not a stable token.',
  'invalid-observed-at': 'observedAt is not a real year, month, or day with known, inferred, or unknown status.',
  'invalid-collection': 'nodes, edges, disputedViews, or unknownRelationships is not an array, or it exceeds the admission bound.',
  'invalid-node': 'A node is not an object.',
  'missing-node-id': 'Node id is absent. No place or issuer identity was invented.',
  'invalid-node-id': 'Node id must use the place: or issuer: namespace.',
  'code-used-as-identity': 'A country or ISO-like code is an alias, not a node id.',
  'duplicate-node-id': 'This graph already admitted this node id.',
  'missing-node-role': 'A node needs the place role, the issuer role, or both.',
  'invalid-node-role': 'Node role is not place or issuer.',
  'tuple-field-on-node':
    'A city, country, province, or state field is not place identity. Use a node, an alias, or a relation. A city is not required.',
  'missing-name': 'A known or inferred node needs a name. Unknown names must be stated explicitly.',
  'unknown-name-has-value': 'The name is marked unknown but a name is present.',
  'invalid-language-tag': 'Language tag is not a BCP 47 tag. No language was substituted.',
  'invalid-script': 'Script is not an ISO 15924 code. No script was substituted.',
  'invalid-name': 'A name needs text and a language tag.',
  'missing-name-source': 'An inferred name has no source.',
  'invalid-alias': 'An alias needs text and a supported kind.',
  'code-alias-has-language': 'A code alias is not a language name. Leave the language empty.',
  'historical-alias-without-validity': 'A historical alias needs a validity interval.',
  'invalid-level': 'Administrative level is missing or not a level token.',
  'arbitrary-level-without-label':
    'An unrecognized level is kept as given, but it needs an explicit label. It was not rewritten to city.',
  'unknown-level-has-kind': 'A level marked unknown cannot also carry a concrete kind.',
  'missing-level-source': 'An inferred level has no source.',
  'invalid-external-id': 'External id scheme or value is not usable.',
  'code-not-recorded-as-alias': 'An ISO code is stored as a code alias. It was not used as the node id.',
  'invalid-parent-knowledge': 'parentKnowledge must be known, none, unknown, or disputed.',
  'invalid-issuer-knowledge': 'issuerKnowledge must be known, none, or unknown.',
  'missing-validity': 'A validity interval is required. Unknown bounds must be stated explicitly.',
  'invalid-interval': 'A validity bound is not a real year, month, or day with an explicit knowledge status.',
  'open-bound-on-start': 'An open bound is only valid as the end of an interval.',
  'open-bound-has-value': 'An open end cannot also carry a date.',
  'open-bound-without-source': 'An open end needs a source that says the interval has no end.',
  'interval-ends-before-start': 'The interval end is earlier than the start at the coarser shared precision.',
  'invalid-boundary': 'A boundary reference is not an object with a boundary id and role.',
  'disputed-boundary-without-view': 'A disputed boundary must name a disputed view.',
  'unknown-geometry-has-ref': 'Geometry marked unknown cannot also name a geometry reference or provenance.',
  'known-geometry-missing-ref': 'Known geometry needs a geometry reference and pinned provenance.',
  'boundary-provenance-missing': 'Known geometry needs a source id and pinned revision.',
  'unpinned-boundary-revision': 'Boundary provenance revision is floating or not a pinned revision.',
  'invalid-geometry-ref': 'Geometry reference must be an artifact id, not a page URL.',
  'invalid-boundary-flag': 'Boundary flag is not a supported topology flag.',
  'self-issuer-without-role': 'A node lists itself as an issuer but does not have the issuer role.',
  'dangling-issuer': 'Issuer id does not name an admitted node.',
  'issuer-lacks-role': 'Issuer id names a node that is not an issuer.',
  'known-issuer-missing': 'issuerKnowledge is known but no issuer id is listed.',
  'none-issuer-has-id': 'issuerKnowledge is none but an issuer id is listed.',
  'unknown-issuer-missing-statement': 'issuerKnowledge is unknown but no unknown issuer statement is present.',
  'conflicting-issuer-knowledge': 'Issuer ids and an unknown issuer statement are both present.',
  'missing-boundary': 'A place needs a boundary reference or an explicit unknown boundary statement.',
  'boundary-both-known-and-unknown': 'A node has both a boundary reference and an unknown boundary statement.',
  'none-parent-has-edge': 'parentKnowledge is none but an administrative parent edge is present.',
  'unknown-parent-has-edge': 'parentKnowledge is unknown but an administrative parent edge is present.',
  'unknown-parent-missing-statement': 'parentKnowledge is unknown but no unknown parent statement is present.',
  'known-parent-missing': 'parentKnowledge is known but no base-graph administrative parent remains.',
  'disputed-parent-missing-view': 'parentKnowledge is disputed but no view-scoped administrative parent remains.',
  'disputed-parent-has-base': 'parentKnowledge is disputed but a base-graph administrative parent is present.',
  'conflicting-parent-knowledge': 'parentKnowledge disagrees with an unknown parent statement.',
  'unknown-name-missing-statement': 'The name is unknown but no unknown name statement is present.',
  'conflicting-name-knowledge': 'A name and an unknown name statement are both present.',
  'unknown-level-missing-statement': 'The level is unknown but no unknown level statement is present.',
  'conflicting-level-knowledge': 'A concrete level and an unknown level statement are both present.',
  'conflicting-unknown-relationship': 'An unknown relationship statement disagrees with an admitted edge of that kind.',
  'invalid-edge': 'An edge is not an object.',
  'missing-edge-id': 'Edge id is absent.',
  'invalid-edge-id': 'Edge id must be an edge: token.',
  'duplicate-edge-id': 'This graph already admitted this edge id.',
  'invalid-relation-kind':
    'Relation kind must be administrative containment, territorial coverage, delegated authority, or a legal relationship. Unknown relationships are statements, not edges.',
  'missing-endpoint': 'An edge needs a fromId and a toId. No endpoint was invented.',
  'dangling-endpoint': 'An edge endpoint is not an admitted node.',
  'endpoint-is-self': 'An edge names the same node at both ends.',
  'invalid-view-ref': 'An edge or boundary names a disputed view that is not in this graph.',
  'exclusive-not-applicable': 'exclusive is only meaningful on administrative containment.',
  'applicability-asserted': 'A graph relation cannot assert legal applicability.',
  'legal-relationship-without-evidence': 'A legal relationship needs source evidence. No applicability conclusion was added.',
  'inferred-relation-without-evidence': 'An inferred relation needs evidence.',
  'delegator-not-issuer': 'The target of delegated authority must be an issuer.',
  'cyclic-containment': 'Administrative containment forms a cycle. No edge in the cycle was dropped silently.',
  'conflicting-containment':
    'Exclusive administrative parents overlap in one view. Neither parent was chosen. Use exclusive false for real multiple parents, or separate disputed views.',
  'ambiguous-containment-interval':
    'Exclusive administrative parents have unknown bounds, so overlap cannot be decided. Neither parent was chosen.',
  'invalid-view': 'A disputed view is not an object.',
  'missing-view-id': 'Disputed view id is absent.',
  'invalid-view-id': 'Disputed view id must be a view: token.',
  'duplicate-view-id': 'This graph already admitted this disputed view id.',
  'empty-view-statement': 'A disputed view needs a statement. The view was not collapsed into the base graph.',
  'missing-claimant': 'A disputed view with known claimants needs at least one claimant id.',
  'dangling-claimant': 'A disputed view names a claimant that is not an admitted node.',
  'unknown-claimant-has-id': 'Claimants are marked unknown but a claimant id is present.',
  'invalid-unknown-relationship': 'An unknown relationship is not an object.',
  'unknown-relationship-has-target': 'An unknown relationship cannot name a target. No parent, city, or issuer was guessed.',
  'missing-unknown-reason': 'An unknown relationship needs a reason.',
  'duplicate-unknown-relationship': 'This subject already has an unknown statement for that relationship.',
  'dangling-unknown-subject': 'An unknown relationship names a subject that is not an admitted node.',
  'invalid-unknown-about': 'Unknown relationship about-value is not supported.',
} as const;

export type QuarantineReason = keyof typeof QUARANTINE_REASONS;
export type RecognizedLevelKind = (typeof RECOGNIZED_LEVEL_KINDS)[number];
export type RelationKind = (typeof RELATION_KINDS)[number];
export type UnknownAbout = (typeof UNKNOWN_ABOUTS)[number];
export type BoundaryRole = (typeof BOUNDARY_ROLES)[number];
export type BoundaryFlag = (typeof BOUNDARY_FLAGS)[number];
export type AliasKind = (typeof ALIAS_KINDS)[number];
export type ExternalIdScheme = (typeof EXTERNAL_ID_SCHEMES)[number];
export type ParentKnowledge = (typeof PARENT_KNOWLEDGE)[number];
export type IssuerKnowledge = (typeof ISSUER_KNOWLEDGE)[number];
export type NodeRole = (typeof NODE_ROLES)[number];
export type IntervalStatus = 'inside' | 'outside' | 'unknown';

export class JurisdictionSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JurisdictionSchemaError';
  }
}

export interface LevelLabel {
  text: string;
  language: string;
  script: string | null;
}

export interface AdministrativeLevel {
  kind: string;
  recognized: boolean;
  label: LevelLabel | null;
  rank: number | null;
  knowledge: 'known' | 'inferred' | 'unknown';
  source: string | null;
}

export interface NodeName {
  text: string;
  language: string;
  script: string | null;
}

export type DatedBound =
  | { knowledge: 'known' | 'inferred'; value: string; precision: DatePrecision; source: string }
  | { knowledge: 'unknown'; value: null; precision: null; source: string | null };

export type IntervalEnd =
  | DatedBound
  | { knowledge: 'open'; value: null; precision: null; source: string };

export interface ValidityInterval {
  start: DatedBound;
  end: IntervalEnd;
}

export interface NodeAlias {
  text: string;
  language: string | null;
  script: string | null;
  kind: AliasKind;
  valid: ValidityInterval | null;
}

export interface ExternalId {
  scheme: ExternalIdScheme;
  customScheme: string | null;
  value: string;
}

export interface BoundaryProvenance {
  sourceId: string;
  sourceRevision: string;
  attribution: string | null;
  license: string | null;
}

export interface BoundaryReference {
  boundaryId: string;
  role: BoundaryRole;
  geometryRef: string | null;
  geometryKnowledge: 'known' | 'unknown';
  provenance: BoundaryProvenance | null;
  valid: ValidityInterval;
  viewId: string | null;
  flags: BoundaryFlag[];
  note: string | null;
}

export interface JurisdictionNode {
  schema: typeof JURISDICTION_NODE_SCHEMA;
  id: string;
  roles: NodeRole[];
  names: NodeName[];
  nameKnowledge: 'known' | 'inferred' | 'unknown';
  nameSource: string | null;
  aliases: NodeAlias[];
  level: AdministrativeLevel;
  externalIds: ExternalId[];
  parentKnowledge: ParentKnowledge;
  issuerKnowledge: IssuerKnowledge;
  issuerIds: string[];
  boundaries: BoundaryReference[];
  valid: ValidityInterval;
  note: string | null;
}

export interface JurisdictionEdge {
  schema: typeof JURISDICTION_EDGE_SCHEMA;
  id: string;
  kind: RelationKind;
  fromId: string;
  toId: string;
  knowledge: 'known' | 'inferred';
  exclusive: boolean | null;
  evidence: string[];
  valid: ValidityInterval;
  viewId: string | null;
  applicability: typeof APPLICABILITY;
  note: string | null;
}

export interface DisputedView {
  schema: typeof DISPUTED_VIEW_SCHEMA;
  id: string;
  statement: string;
  claimantIds: string[];
  claimantKnowledge: 'known' | 'unknown';
  valid: ValidityInterval;
}

export interface UnknownRelationship {
  schema: typeof UNKNOWN_RELATIONSHIP_SCHEMA;
  subjectId: string;
  about: UnknownAbout;
  reason: string;
  targetId: null;
}

export interface ObservedDate {
  knowledge: 'known' | 'inferred';
  value: string;
  precision: DatePrecision;
  source: string;
}

export interface JurisdictionGraph {
  schema: typeof JURISDICTION_GRAPH_SCHEMA;
  schemaVersion: typeof SCHEMA_VERSION;
  cityRequired: typeof CITY_REQUIRED;
  graphId: string;
  sourceId: string;
  sourceRevision: string;
  publisherId: string | null;
  observedAt: ObservedDate | null;
  nodes: JurisdictionNode[];
  edges: JurisdictionEdge[];
  disputedViews: DisputedView[];
  unknownRelationships: UnknownRelationship[];
}

export interface JurisdictionQuarantine {
  schema: typeof QUARANTINE_SCHEMA;
  reason: QuarantineReason;
  message: string;
  detail: string;
  field: string | null;
  graphId: string | null;
  nodeId: string | null;
  edgeId: string | null;
  viewId: string | null;
}

export interface AdmissionResult {
  graph: JurisdictionGraph | null;
  quarantined: JurisdictionQuarantine[];
}

export interface CandidateSlice {
  asOf: string;
  viewIds: string[];
  edges: JurisdictionEdge[];
  undecided: JurisdictionEdge[];
  unknownRelationships: UnknownRelationship[];
  applicability: typeof APPLICABILITY;
}

interface Problem {
  reason: QuarantineReason;
  detail: string;
  field: string | null;
}

interface Envelope {
  graphId: string;
  sourceId: string;
  sourceRevision: string;
  publisherId: string | null;
  observedAt: ObservedDate | null;
}

interface ViewDraft {
  id: string;
  statement: string;
  claimantIds: string[];
  claimantKnowledge: 'known' | 'unknown';
  valid: ValidityInterval;
}

interface NodeDraft {
  id: string;
  roles: NodeRole[];
  names: NodeName[];
  nameKnowledge: 'known' | 'inferred' | 'unknown';
  nameSource: string | null;
  aliases: NodeAlias[];
  level: AdministrativeLevel;
  externalIds: ExternalId[];
  parentKnowledge: ParentKnowledge;
  issuerKnowledge: IssuerKnowledge;
  issuerIds: string[];
  boundaries: BoundaryReference[];
  valid: ValidityInterval;
  note: string | null;
}

interface EdgeDraft {
  id: string;
  kind: RelationKind;
  fromId: string;
  toId: string;
  knowledge: 'known' | 'inferred';
  exclusive: boolean | null;
  evidence: string[];
  valid: ValidityInterval;
  viewId: string | null;
  note: string | null;
}

interface UnknownDraft {
  subjectId: string;
  about: UnknownAbout;
  reason: string;
}

function clampDetail(detail: string): string {
  const text = detail.trim();
  return text.length > 500 ? `${text.slice(0, 497)}...` : text;
}

function cleanString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function problem(reason: QuarantineReason, field: string | null, detail: string): Problem {
  return { reason, field, detail: clampDetail(detail) };
}

function isPrecision(value: string): value is DatePrecision {
  return value === 'day' || value === 'month' || value === 'year';
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function calendarOk(value: string, precision: DatePrecision): boolean {
  const parts = value.split('-').map((part) => Number(part));
  const year = parts[0];
  if (!Number.isInteger(year) || year < 1 || year > 9999) return false;
  if (precision === 'year') return /^\d{4}$/.test(value);
  const month = parts[1];
  if (!Number.isInteger(month) || month < 1 || month > 12) return false;
  if (precision === 'month') return /^\d{4}-\d{2}$/.test(value);
  const day = parts[2];
  const lengths = [0, 31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isInteger(day) && day >= 1 && day <= lengths[month];
}

function precisionOf(value: string): DatePrecision | null {
  if (/^\d{4}$/.test(value) && calendarOk(value, 'year')) return 'year';
  if (/^\d{4}-\d{2}$/.test(value) && calendarOk(value, 'month')) return 'month';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value) && calendarOk(value, 'day')) return 'day';
  return null;
}

function revisionProblem(value: string | null): QuarantineReason | null {
  if (!value) return 'missing-source-revision';
  const folded = value.toLowerCase();
  if (FLOATING_REVISIONS.has(folded) || /(?:^|\/)(?:head|main|master|latest)$/i.test(value) || /^refs\//i.test(value)) {
    return 'unpinned-source-revision';
  }
  if (/^[A-Fa-f0-9]{40}$/.test(value) || /^[A-Fa-f0-9]{64}$/.test(value)) return null;
  if (/^[A-Za-z0-9._:+/-]{12,128}$/.test(value)) return null;
  return 'invalid-source-revision';
}

function isBareCodeSegment(value: string): boolean {
  return CODE_SEGMENT.test(value.toLowerCase());
}

function recognizedLevel(kind: string): boolean {
  return (RECOGNIZED_LEVEL_KINDS as readonly string[]).includes(kind);
}

function tupleField(record: Record<string, unknown>): string | null {
  for (const field of TUPLE_FIELDS) {
    if (field in record) return field;
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function parseLooseDate(value: string): { value: string; precision: DatePrecision } | null {
  const precision = precisionOf(value.trim());
  if (!precision) return null;
  return { value: value.trim(), precision };
}

function compareBoundValues(
  left: { value: string; precision: DatePrecision },
  right: { value: string; precision: DatePrecision },
): number {
  const rank: Record<DatePrecision, number> = { year: 0, month: 1, day: 2 };
  const precision = rank[left.precision] <= rank[right.precision] ? left.precision : right.precision;
  const width = precision === 'year' ? 4 : precision === 'month' ? 7 : 10;
  const l = left.value.slice(0, width);
  const r = right.value.slice(0, width);
  if (l < r) return -1;
  if (l > r) return 1;
  return 0;
}

function boundComparable(bound: DatedBound | IntervalEnd): bound is { knowledge: 'known' | 'inferred'; value: string; precision: DatePrecision; source: string } {
  return bound.knowledge === 'known' || bound.knowledge === 'inferred';
}

export function intervalStatus(interval: ValidityInterval, asOf: string): IntervalStatus {
  const probed = parseLooseDate(asOf);
  if (!probed) {
    throw new JurisdictionSchemaError(`asOf ${JSON.stringify(asOf)} is not a real year, month, or day.`);
  }
  const start = interval.start;
  const end = interval.end;
  if (boundComparable(start) && compareBoundValues(probed, start) < 0) return 'outside';
  if (end.knowledge === 'open') return boundComparable(start) ? 'inside' : 'unknown';
  if (boundComparable(end) && compareBoundValues(probed, end) > 0) return 'outside';
  if (!boundComparable(start) || !boundComparable(end)) return 'unknown';
  return 'inside';
}

function endsBefore(
  leftEnd: IntervalEnd,
  rightStart: DatedBound,
): boolean | null {
  if (leftEnd.knowledge === 'open') return false;
  if (!boundComparable(leftEnd) || !boundComparable(rightStart)) return null;
  return compareBoundValues(leftEnd, rightStart) < 0;
}

function overlap(left: ValidityInterval, right: ValidityInterval): 'overlap' | 'disjoint' | 'undecided' {
  const leftFirst = endsBefore(left.end, right.start);
  const rightFirst = endsBefore(right.end, left.start);
  if (leftFirst === true || rightFirst === true) return 'disjoint';
  if (leftFirst === false && rightFirst === false) return 'overlap';
  return 'undecided';
}

function parseBound(input: unknown, field: string, side: 'start' | 'end'): { ok: true; bound: DatedBound | IntervalEnd } | { ok: false; problem: Problem } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, problem: problem('invalid-interval', field, `${field} must be an object with explicit knowledge.`) };
  }
  const record = input as Record<string, unknown>;
  const knowledge = record.knowledge;
  const source = cleanString(record.source);
  const rawValue = record.value;
  const hasValue = rawValue !== undefined && rawValue !== null && String(rawValue).trim() !== '';
  const precisionPresent = record.precision !== undefined && record.precision !== null && record.precision !== '';
  if (knowledge === 'open') {
    if (side === 'start') {
      return { ok: false, problem: problem('open-bound-on-start', field, `${field} cannot be open.`) };
    }
    if (hasValue || precisionPresent) {
      return { ok: false, problem: problem('open-bound-has-value', field, `${field} is open but still carries a date.`) };
    }
    if (!source) {
      return { ok: false, problem: problem('open-bound-without-source', field, `${field} is open without a source.`) };
    }
    return { ok: true, bound: { knowledge: 'open', value: null, precision: null, source } };
  }
  if (knowledge === 'unknown') {
    if (hasValue || precisionPresent) {
      return { ok: false, problem: problem('invalid-interval', field, `${field} is unknown but still carries a value or precision.`) };
    }
    return { ok: true, bound: { knowledge: 'unknown', value: null, precision: null, source } };
  }
  if (knowledge !== 'known' && knowledge !== 'inferred') {
    return { ok: false, problem: problem('invalid-interval', field, `${field} knowledge must be known, inferred, unknown, or open.`) };
  }
  if (!hasValue || typeof record.precision !== 'string' || !isPrecision(record.precision)) {
    return { ok: false, problem: problem('invalid-interval', field, `${field} needs a value and a day, month, or year precision.`) };
  }
  const value = String(rawValue).trim();
  if (precisionOf(value) !== record.precision || !calendarOk(value, record.precision)) {
    return { ok: false, problem: problem('invalid-interval', field, `${field} value ${JSON.stringify(value)} does not match precision ${record.precision}.`) };
  }
  if (!source) {
    return {
      ok: false,
      problem: problem('invalid-interval', field, `${field} is ${knowledge} without a source.`),
    };
  }
  return { ok: true, bound: { knowledge, value, precision: record.precision, source } };
}

function parseInterval(input: unknown, field: string): { ok: true; interval: ValidityInterval } | { ok: false; problem: Problem } {
  const record = asRecord(input);
  if (!record) return { ok: false, problem: problem('missing-validity', field, `${field} interval is required.`) };
  const start = parseBound(record.start, `${field}.start`, 'start');
  if (!start.ok) return start;
  if (start.bound.knowledge === 'open') {
    return { ok: false, problem: problem('open-bound-on-start', `${field}.start`, `${field}.start cannot be open.`) };
  }
  const end = parseBound(record.end, `${field}.end`, 'end');
  if (!end.ok) return end;
  const interval: ValidityInterval = { start: start.bound, end: end.bound };
  if (boundComparable(interval.start) && boundComparable(interval.end) && compareBoundValues(interval.end, interval.start) < 0) {
    return {
      ok: false,
      problem: problem('interval-ends-before-start', field, `${field} ends before it starts at the coarser shared precision.`),
    };
  }
  return { ok: true, interval };
}

function parseObservedAt(input: unknown): { ok: true; observedAt: ObservedDate | null } | { ok: false; problem: Problem } {
  if (input === undefined || input === null || input === '') return { ok: true, observedAt: null };
  if (typeof input === 'string') {
    const parsed = parseLooseDate(input);
    if (!parsed) return { ok: false, problem: problem('invalid-observed-at', 'observedAt', 'observedAt string is not a real date.') };
    return { ok: true, observedAt: { knowledge: 'known', value: parsed.value, precision: parsed.precision, source: 'observedAt' } };
  }
  const bound = parseBound(input, 'observedAt', 'start');
  if (!bound.ok) return { ok: false, problem: problem('invalid-observed-at', 'observedAt', bound.problem.detail) };
  if (bound.bound.knowledge === 'unknown') return { ok: true, observedAt: null };
  if (bound.bound.knowledge === 'open') {
    return { ok: false, problem: problem('invalid-observed-at', 'observedAt', 'observedAt cannot be open.') };
  }
  return {
    ok: true,
    observedAt: {
      knowledge: bound.bound.knowledge,
      value: bound.bound.value,
      precision: bound.bound.precision,
      source: bound.bound.source,
    },
  };
}

function parseLanguage(value: unknown, field: string): { ok: true; language: string } | { ok: false; problem: Problem } {
  const tag = cleanString(value);
  if (!tag || !LANGUAGE_TAG.test(tag)) {
    return { ok: false, problem: problem('invalid-language-tag', field, `${field} tag ${JSON.stringify(value)} is not a BCP 47 tag.`) };
  }
  return { ok: true, language: tag };
}

function parseScript(value: unknown, field: string): { ok: true; script: string | null } | { ok: false; problem: Problem } {
  if (value === undefined || value === null || value === '') return { ok: true, script: null };
  const script = cleanString(value);
  if (!script || !SCRIPT_TAG.test(script)) {
    return { ok: false, problem: problem('invalid-script', field, `${field} script ${JSON.stringify(value)} is not an ISO 15924 code.`) };
  }
  return { ok: true, script };
}

function parseName(input: unknown, field: string): { ok: true; name: NodeName } | { ok: false; problem: Problem } {
  const record = asRecord(input);
  if (!record) return { ok: false, problem: problem('invalid-name', field, `${field} must be an object.`) };
  const text = cleanString(record.text);
  if (!text) return { ok: false, problem: problem('invalid-name', field, `${field} text is empty.`) };
  const language = parseLanguage(record.language, field);
  if (!language.ok) return language;
  const script = parseScript(record.script, field);
  if (!script.ok) return script;
  return { ok: true, name: { text, language: language.language, script: script.script } };
}

function parseLevel(input: unknown): { ok: true; level: AdministrativeLevel } | { ok: false; problem: Problem } {
  const record = asRecord(input);
  if (!record) return { ok: false, problem: problem('invalid-level', 'level', 'Level must be an object.') };
  const knowledge = record.knowledge === undefined ? 'known' : record.knowledge;
  if (knowledge !== 'known' && knowledge !== 'inferred' && knowledge !== 'unknown') {
    return { ok: false, problem: problem('invalid-level', 'level.knowledge', 'Level knowledge is not known, inferred, or unknown.') };
  }
  const source = cleanString(record.source);
  if (knowledge === 'unknown') {
    const kind = cleanString(record.kind);
    const rankPresent = record.rank !== undefined && record.rank !== null;
    if ((kind && kind !== 'unknown') || record.label || rankPresent) {
      return { ok: false, problem: problem('unknown-level-has-kind', 'level.kind', 'Unknown level cannot carry a concrete kind, label, or rank.') };
    }
    return {
      ok: true,
      level: { kind: 'unknown', recognized: true, label: null, rank: null, knowledge: 'unknown', source: source },
    };
  }
  const kind = cleanString(record.kind);
  if (!kind || !LEVEL_KIND.test(kind) || kind === 'unknown') {
    return { ok: false, problem: problem('invalid-level', 'level.kind', 'Level kind must be a lowercase token.') };
  }
  const recognized = recognizedLevel(kind);
  let label: LevelLabel | null = null;
  if (record.label !== undefined && record.label !== null) {
    const parsed = parseName(record.label, 'level.label');
    if (!parsed.ok) return parsed;
    label = parsed.name;
  }
  if (!recognized && !label) {
    return {
      ok: false,
      problem: problem('arbitrary-level-without-label', 'level.label', `Level ${kind} is not a recognized kind and has no label.`),
    };
  }
  if (knowledge === 'inferred' && !source) {
    return { ok: false, problem: problem('missing-level-source', 'level.source', 'Inferred level has no source.') };
  }
  let rank: number | null = null;
  if (record.rank !== undefined && record.rank !== null) {
    if (typeof record.rank !== 'number' || !Number.isInteger(record.rank) || record.rank < 0 || record.rank > 10000) {
      return { ok: false, problem: problem('invalid-level', 'level.rank', 'Level rank must be an integer from 0 through 10000.') };
    }
    rank = record.rank;
  }
  return { ok: true, level: { kind, recognized, label, rank, knowledge, source } };
}

function parseAlias(input: unknown, index: number): { ok: true; alias: NodeAlias } | { ok: false; problem: Problem } {
  const record = asRecord(input);
  const field = `aliases[${index}]`;
  if (!record) return { ok: false, problem: problem('invalid-alias', field, 'Alias must be an object.') };
  const text = cleanString(record.text);
  const kind = record.kind;
  if (!text || typeof kind !== 'string' || !(ALIAS_KINDS as readonly string[]).includes(kind)) {
    return { ok: false, problem: problem('invalid-alias', field, 'Alias needs text and a supported kind.') };
  }
  const script = parseScript(record.script, field);
  if (!script.ok) return script;
  let language: string | null = null;
  if (kind === 'code') {
    if (record.language !== undefined && record.language !== null && cleanString(record.language)) {
      return { ok: false, problem: problem('code-alias-has-language', field, 'Code aliases cannot carry a language.') };
    }
    if (!CODE_TEXT.test(text)) {
      return { ok: false, problem: problem('invalid-alias', field, 'Code alias text is not a short code token.') };
    }
  } else {
    const parsed = parseLanguage(record.language, field);
    if (!parsed.ok) return parsed;
    language = parsed.language;
  }
  let valid: ValidityInterval | null = null;
  if (record.valid !== undefined && record.valid !== null) {
    const interval = parseInterval(record.valid, `${field}.valid`);
    if (!interval.ok) return interval;
    valid = interval.interval;
  } else if (kind === 'historical') {
    return { ok: false, problem: problem('historical-alias-without-validity', field, 'Historical alias has no validity interval.') };
  }
  return { ok: true, alias: { text, language, script: script.script, kind: kind as AliasKind, valid } };
}

function parseExternalId(input: unknown, index: number): { ok: true; externalId: ExternalId } | { ok: false; problem: Problem } {
  const record = asRecord(input);
  const field = `externalIds[${index}]`;
  if (!record) return { ok: false, problem: problem('invalid-external-id', field, 'External id must be an object.') };
  const scheme = record.scheme;
  const value = cleanString(record.value);
  if (typeof scheme !== 'string' || !(EXTERNAL_ID_SCHEMES as readonly string[]).includes(scheme) || !value) {
    return { ok: false, problem: problem('invalid-external-id', field, 'External id needs a supported scheme and a value.') };
  }
  let customScheme: string | null = null;
  if (scheme === 'iso-3166-1-alpha2' && !/^[A-Z]{2}$/.test(value)) {
    return { ok: false, problem: problem('invalid-external-id', field, 'ISO 3166-1 alpha-2 values use two uppercase letters.') };
  }
  if (scheme === 'iso-3166-1-alpha3' && !/^[A-Z]{3}$/.test(value)) {
    return { ok: false, problem: problem('invalid-external-id', field, 'ISO 3166-1 alpha-3 values use three uppercase letters.') };
  }
  if (scheme === 'iso-3166-2' && !/^[A-Z]{2}-[A-Z0-9]{1,3}$/.test(value)) {
    return { ok: false, problem: problem('invalid-external-id', field, 'ISO 3166-2 values look like NL-NH.') };
  }
  if (scheme === 'wikidata' && !/^Q[1-9][0-9]*$/.test(value)) {
    return { ok: false, problem: problem('invalid-external-id', field, 'Wikidata ids look like Q55.') };
  }
  if (scheme === 'geonames' && !/^[1-9][0-9]{0,10}$/.test(value)) {
    return { ok: false, problem: problem('invalid-external-id', field, 'GeoNames ids are positive integers.') };
  }
  if (scheme === 'custom') {
    const custom = cleanString(record.customScheme);
    if (!custom || !CUSTOM_SCHEME.test(custom)) {
      return { ok: false, problem: problem('invalid-external-id', field, 'Custom external ids need a customScheme token.') };
    }
    customScheme = custom;
  }
  return { ok: true, externalId: { scheme: scheme as ExternalIdScheme, customScheme, value } };
}

function parseBoundary(
  input: unknown,
  index: number,
  views: ReadonlySet<string>,
): { ok: true; boundary: BoundaryReference } | { ok: false; problem: Problem } {
  const record = asRecord(input);
  const field = `boundaries[${index}]`;
  if (!record) return { ok: false, problem: problem('invalid-boundary', field, 'Boundary must be an object.') };
  const boundaryId = cleanString(record.boundaryId);
  if (!boundaryId || !BOUNDARY_ID.test(boundaryId)) {
    return { ok: false, problem: problem('invalid-boundary', field, 'Boundary id must be a boundary: token.') };
  }
  const role = record.role;
  if (typeof role !== 'string' || !(BOUNDARY_ROLES as readonly string[]).includes(role)) {
    return { ok: false, problem: problem('invalid-boundary', field, 'Boundary role is not supported.') };
  }
  const viewId = record.viewId === undefined || record.viewId === null || record.viewId === '' ? null : cleanString(record.viewId);
  if (record.viewId !== undefined && record.viewId !== null && record.viewId !== '' && !viewId) {
    return { ok: false, problem: problem('invalid-view-ref', field, 'Boundary view id is empty.') };
  }
  if (role === 'disputed' && !viewId) {
    return { ok: false, problem: problem('disputed-boundary-without-view', field, `${boundaryId} is disputed without a view.`) };
  }
  if (viewId && (!VIEW_ID.test(viewId) || !views.has(viewId))) {
    return { ok: false, problem: problem('invalid-view-ref', field, `${boundaryId} names a missing view ${JSON.stringify(record.viewId)}.`) };
  }
  const geometryKnowledge = record.geometryKnowledge;
  if (geometryKnowledge !== 'known' && geometryKnowledge !== 'unknown') {
    return { ok: false, problem: problem('invalid-boundary', field, 'geometryKnowledge must be known or unknown.') };
  }
  const geometryRef = cleanString(record.geometryRef);
  const provenanceRecord = record.provenance;
  if (geometryKnowledge === 'unknown') {
    if (geometryRef || (provenanceRecord !== undefined && provenanceRecord !== null)) {
      return { ok: false, problem: problem('unknown-geometry-has-ref', field, `${boundaryId} is unknown geometry but still has a reference or provenance.`) };
    }
  }
  let provenance: BoundaryProvenance | null = null;
  if (geometryKnowledge === 'known') {
    if (!geometryRef || !GEOMETRY_REF.test(geometryRef)) {
      return { ok: false, problem: problem(geometryRef ? 'invalid-geometry-ref' : 'known-geometry-missing-ref', field, `${boundaryId} needs an artifact geometry reference.`) };
    }
    const provenanceObject = asRecord(provenanceRecord);
    if (!provenanceObject) {
      return { ok: false, problem: problem('boundary-provenance-missing', field, `${boundaryId} needs provenance.`) };
    }
    const sourceId = cleanString(provenanceObject.sourceId);
    const sourceRevision = cleanString(provenanceObject.sourceRevision);
    if (!sourceId || !SOURCE_ID.test(sourceId)) {
      return { ok: false, problem: problem('boundary-provenance-missing', field, `${boundaryId} provenance source id is missing.`) };
    }
    const revision = revisionProblem(sourceRevision);
    if (revision) {
      const reason = revision === 'missing-source-revision' ? 'boundary-provenance-missing' : 'unpinned-boundary-revision';
      return { ok: false, problem: problem(reason, field, `${boundaryId} provenance revision is not pinned.`) };
    }
    provenance = {
      sourceId,
      sourceRevision: sourceRevision as string,
      attribution: cleanString(provenanceObject.attribution),
      license: cleanString(provenanceObject.license),
    };
  }
  const interval = parseInterval(record.valid, `${field}.valid`);
  if (!interval.ok) return interval;
  const flags: BoundaryFlag[] = [];
  const rawFlags = record.flags === undefined ? [] : record.flags;
  if (!Array.isArray(rawFlags)) return { ok: false, problem: problem('invalid-boundary-flag', field, 'Boundary flags must be an array.') };
  for (const flag of rawFlags) {
    if (typeof flag !== 'string' || !(BOUNDARY_FLAGS as readonly string[]).includes(flag)) {
      return { ok: false, problem: problem('invalid-boundary-flag', field, `Flag ${JSON.stringify(flag)} is not supported.`) };
    }
    if (!flags.includes(flag as BoundaryFlag)) flags.push(flag as BoundaryFlag);
  }
  return {
    ok: true,
    boundary: {
      boundaryId,
      role: role as BoundaryRole,
      geometryRef: geometryKnowledge === 'known' ? geometryRef : null,
      geometryKnowledge,
      provenance,
      valid: interval.interval,
      viewId,
      flags,
      note: cleanString(record.note),
    },
  };
}

function parseNode(input: unknown, views: ReadonlySet<string>): { ok: true; node: NodeDraft } | { ok: false; problem: Problem } {
  const record = asRecord(input);
  if (!record) return { ok: false, problem: problem('invalid-node', null, 'Node must be an object.') };
  const tuple = tupleField(record);
  if (tuple) {
    return { ok: false, problem: problem('tuple-field-on-node', tuple, `Field ${tuple} cannot identify a place.`) };
  }
  const id = record.id;
  if (typeof id !== 'string' || !id.trim()) {
    return { ok: false, problem: problem(typeof id === 'string' ? 'missing-node-id' : 'missing-node-id', 'id', 'Node id is absent.') };
  }
  const trimmedId = id.trim();
  const segment = trimmedId.includes(':') ? trimmedId.slice(trimmedId.lastIndexOf(':') + 1) : trimmedId;
  if (isBareCodeSegment(trimmedId) || isBareCodeSegment(segment)) {
    return { ok: false, problem: problem('code-used-as-identity', 'id', `Id ${JSON.stringify(trimmedId)} is a code, not an internal id.`) };
  }
  if (!NODE_ID.test(trimmedId)) {
    return { ok: false, problem: problem('invalid-node-id', 'id', `Id ${JSON.stringify(trimmedId)} must use place: or issuer:.`) };
  }
  const rawRoles = record.roles;
  if (!Array.isArray(rawRoles) || rawRoles.length === 0) {
    return { ok: false, problem: problem('missing-node-role', 'roles', `${trimmedId} needs a role.`) };
  }
  const roles: NodeRole[] = [];
  for (const role of rawRoles) {
    if (role !== 'place' && role !== 'issuer') {
      return { ok: false, problem: problem('invalid-node-role', 'roles', `${trimmedId} has role ${JSON.stringify(role)}.`) };
    }
    if (!roles.includes(role)) roles.push(role);
  }
  const nameKnowledge = record.nameKnowledge === undefined ? null : record.nameKnowledge;
  if (nameKnowledge !== null && nameKnowledge !== 'known' && nameKnowledge !== 'inferred' && nameKnowledge !== 'unknown') {
    return { ok: false, problem: problem('invalid-name', 'nameKnowledge', `${trimmedId} name knowledge is not usable.`) };
  }
  const names: NodeName[] = [];
  const rawNames = record.names === undefined ? [] : record.names;
  if (!Array.isArray(rawNames) || rawNames.length > 50) {
    return { ok: false, problem: problem('invalid-name', 'names', `${trimmedId} names must be an array of at most 50.`) };
  }
  for (let index = 0; index < rawNames.length; index += 1) {
    const parsed = parseName(rawNames[index], `names[${index}]`);
    if (!parsed.ok) return parsed;
    names.push(parsed.name);
  }
  const nameSource = cleanString(record.nameSource);
  let resolvedNameKnowledge: 'known' | 'inferred' | 'unknown';
  if (nameKnowledge === 'unknown') {
    if (names.length > 0) {
      return { ok: false, problem: problem('unknown-name-has-value', 'names', `${trimmedId} is unnamed but has names.`) };
    }
    resolvedNameKnowledge = 'unknown';
  } else if (names.length === 0) {
    return { ok: false, problem: problem('missing-name', 'names', `${trimmedId} has no name and is not explicitly unknown.`) };
  } else if (nameKnowledge === 'inferred') {
    if (!nameSource) return { ok: false, problem: problem('missing-name-source', 'nameSource', `${trimmedId} inferred name has no source.`) };
    resolvedNameKnowledge = 'inferred';
  } else {
    resolvedNameKnowledge = 'known';
  }
  const aliases: NodeAlias[] = [];
  const rawAliases = record.aliases === undefined ? [] : record.aliases;
  if (!Array.isArray(rawAliases) || rawAliases.length > 200) {
    return { ok: false, problem: problem('invalid-alias', 'aliases', `${trimmedId} aliases must be an array of at most 200.`) };
  }
  for (let index = 0; index < rawAliases.length; index += 1) {
    const parsed = parseAlias(rawAliases[index], index);
    if (!parsed.ok) return parsed;
    aliases.push(parsed.alias);
  }
  const level = parseLevel(record.level);
  if (!level.ok) return level;
  const externalIds: ExternalId[] = [];
  const rawExternal = record.externalIds === undefined ? [] : record.externalIds;
  if (!Array.isArray(rawExternal)) {
    return { ok: false, problem: problem('invalid-external-id', 'externalIds', `${trimmedId} external ids must be an array.`) };
  }
  for (let index = 0; index < rawExternal.length; index += 1) {
    const parsed = parseExternalId(rawExternal[index], index);
    if (!parsed.ok) return parsed;
    externalIds.push(parsed.externalId);
  }
  for (const externalId of externalIds) {
    if (!externalId.scheme.startsWith('iso-3166')) continue;
    const matched = aliases.some((alias) => alias.kind === 'code' && alias.text.toUpperCase() === externalId.value.toUpperCase());
    if (!matched) {
      return {
        ok: false,
        problem: problem('code-not-recorded-as-alias', 'externalIds', `${externalId.value} is an ISO code and must also be a code alias.`),
      };
    }
  }
  const parentKnowledge = record.parentKnowledge;
  if (typeof parentKnowledge !== 'string' || !(PARENT_KNOWLEDGE as readonly string[]).includes(parentKnowledge)) {
    return { ok: false, problem: problem('invalid-parent-knowledge', 'parentKnowledge', `${trimmedId} parentKnowledge must be explicit.`) };
  }
  const issuerKnowledge = record.issuerKnowledge;
  if (typeof issuerKnowledge !== 'string' || !(ISSUER_KNOWLEDGE as readonly string[]).includes(issuerKnowledge)) {
    return { ok: false, problem: problem('invalid-issuer-knowledge', 'issuerKnowledge', `${trimmedId} issuerKnowledge must be explicit.`) };
  }
  const issuerIds: string[] = [];
  const rawIssuers = record.issuerIds === undefined ? [] : record.issuerIds;
  if (!Array.isArray(rawIssuers) || rawIssuers.length > 200) {
    return { ok: false, problem: problem('invalid-issuer-knowledge', 'issuerIds', `${trimmedId} issuerIds must be an array of at most 200.`) };
  }
  for (const issuerId of rawIssuers) {
    if (typeof issuerId !== 'string' || !issuerId.trim()) {
      return { ok: false, problem: problem('dangling-issuer', 'issuerIds', `${trimmedId} has an empty issuer id.`) };
    }
    const token = issuerId.trim();
    if (isBareCodeSegment(token) || isBareCodeSegment(token.slice(token.lastIndexOf(':') + 1))) {
      return { ok: false, problem: problem('code-used-as-identity', 'issuerIds', `${token} is a code, not an issuer id.`) };
    }
    if (!issuerIds.includes(token)) issuerIds.push(token);
  }
  if (issuerKnowledge === 'known' && issuerIds.length === 0) {
    return { ok: false, problem: problem('known-issuer-missing', 'issuerIds', `${trimmedId} is marked as having issuers but lists none.`) };
  }
  if (issuerKnowledge === 'none' && issuerIds.length > 0) {
    return { ok: false, problem: problem('none-issuer-has-id', 'issuerIds', `${trimmedId} says it has no issuer ids but lists some.`) };
  }
  if (issuerKnowledge === 'unknown' && issuerIds.length > 0) {
    return { ok: false, problem: problem('conflicting-issuer-knowledge', 'issuerIds', `${trimmedId} is unknown and also lists issuer ids.`) };
  }
  const boundaries: BoundaryReference[] = [];
  const rawBoundaries = record.boundaries === undefined ? [] : record.boundaries;
  if (!Array.isArray(rawBoundaries) || rawBoundaries.length > 100) {
    return { ok: false, problem: problem('invalid-boundary', 'boundaries', `${trimmedId} boundaries must be an array of at most 100.`) };
  }
  for (let index = 0; index < rawBoundaries.length; index += 1) {
    const parsed = parseBoundary(rawBoundaries[index], index, views);
    if (!parsed.ok) return { ok: false, problem: { ...parsed.problem, detail: `${trimmedId}: ${parsed.problem.detail}` } };
    boundaries.push(parsed.boundary);
  }
  const interval = parseInterval(record.valid, 'valid');
  if (!interval.ok) return interval;
  return {
    ok: true,
    node: {
      id: trimmedId,
      roles,
      names,
      nameKnowledge: resolvedNameKnowledge,
      nameSource,
      aliases,
      level: level.level,
      externalIds,
      parentKnowledge: parentKnowledge as ParentKnowledge,
      issuerKnowledge: issuerKnowledge as IssuerKnowledge,
      issuerIds,
      boundaries,
      valid: interval.interval,
      note: cleanString(record.note),
    },
  };
}

function parseView(input: unknown): { ok: true; view: ViewDraft } | { ok: false; problem: Problem } {
  const record = asRecord(input);
  if (!record) return { ok: false, problem: problem('invalid-view', null, 'Disputed view must be an object.') };
  const id = cleanString(record.id);
  if (!id) return { ok: false, problem: problem('missing-view-id', 'id', 'Disputed view id is absent.') };
  if (!VIEW_ID.test(id)) return { ok: false, problem: problem('invalid-view-id', 'id', `View id ${JSON.stringify(id)} must be a view: token.`) };
  const statement = cleanString(record.statement);
  if (!statement) return { ok: false, problem: problem('empty-view-statement', 'statement', `${id} has no statement.`) };
  const claimantKnowledge = record.claimantKnowledge === undefined ? 'known' : record.claimantKnowledge;
  if (claimantKnowledge !== 'known' && claimantKnowledge !== 'unknown') {
    return { ok: false, problem: problem('invalid-view', 'claimantKnowledge', `${id} claimant knowledge is not known or unknown.`) };
  }
  const claimantIds: string[] = [];
  const rawClaimants = record.claimantIds === undefined ? [] : record.claimantIds;
  if (!Array.isArray(rawClaimants)) {
    return { ok: false, problem: problem('invalid-view', 'claimantIds', `${id} claimantIds must be an array.`) };
  }
  for (const claimant of rawClaimants) {
    if (typeof claimant !== 'string' || !claimant.trim()) {
      return { ok: false, problem: problem('missing-claimant', 'claimantIds', `${id} has an empty claimant.`) };
    }
    if (!claimantIds.includes(claimant.trim())) claimantIds.push(claimant.trim());
  }
  if (claimantKnowledge === 'unknown' && claimantIds.length > 0) {
    return { ok: false, problem: problem('unknown-claimant-has-id', 'claimantIds', `${id} is unknown but names claimants.`) };
  }
  if (claimantKnowledge === 'known' && claimantIds.length === 0) {
    return { ok: false, problem: problem('missing-claimant', 'claimantIds', `${id} needs a claimant.`) };
  }
  const interval = parseInterval(record.valid, 'valid');
  if (!interval.ok) return interval;
  return { ok: true, view: { id, statement, claimantIds, claimantKnowledge, valid: interval.interval } };
}

function parseUnknown(input: unknown, nodes: ReadonlySet<string>): { ok: true; unknown: UnknownDraft } | { ok: false; problem: Problem } {
  const record = asRecord(input);
  if (!record) return { ok: false, problem: problem('invalid-unknown-relationship', null, 'Unknown relationship must be an object.') };
  for (const field of UNKNOWN_TARGET_FIELDS) {
    if (!(field in record)) continue;
    if (field === 'targetId' && record.targetId === null) continue;
    return {
      ok: false,
      problem: problem('unknown-relationship-has-target', field, `Unknown relationship names ${field}. No endpoint was guessed.`),
    };
  }
  const subjectId = cleanString(record.subjectId);
  if (!subjectId || !nodes.has(subjectId)) {
    return { ok: false, problem: problem('dangling-unknown-subject', 'subjectId', `Unknown relationship subject ${JSON.stringify(record.subjectId)} is not an admitted node.`) };
  }
  const about = record.about;
  if (typeof about !== 'string' || !(UNKNOWN_ABOUTS as readonly string[]).includes(about)) {
    return { ok: false, problem: problem('invalid-unknown-about', 'about', `Unknown about-value ${JSON.stringify(about)} is not supported.`) };
  }
  const reason = cleanString(record.reason);
  if (!reason) return { ok: false, problem: problem('missing-unknown-reason', 'reason', `${subjectId} unknown ${about} has no reason.`) };
  return { ok: true, unknown: { subjectId, about: about as UnknownAbout, reason } };
}

function parseEdge(input: unknown, nodes: ReadonlyMap<string, NodeDraft>, views: ReadonlySet<string>): { ok: true; edge: EdgeDraft } | { ok: false; problem: Problem } {
  const record = asRecord(input);
  if (!record) return { ok: false, problem: problem('invalid-edge', null, 'Edge must be an object.') };
  const id = cleanString(record.id);
  if (!id) return { ok: false, problem: problem('missing-edge-id', 'id', 'Edge id is absent.') };
  if (!EDGE_ID.test(id)) return { ok: false, problem: problem('invalid-edge-id', 'id', `Edge id ${JSON.stringify(id)} must be an edge: token.`) };
  const kind = record.kind;
  if (kind === 'unknown') {
    return { ok: false, problem: problem('invalid-relation-kind', 'kind', `${id} uses an edge for an unknown relationship. Use an unknown statement.`) };
  }
  if (typeof kind !== 'string' || !(RELATION_KINDS as readonly string[]).includes(kind)) {
    return { ok: false, problem: problem('invalid-relation-kind', 'kind', `${id} kind ${JSON.stringify(kind)} is not supported.`) };
  }
  if ('applicability' in record && record.applicability !== APPLICABILITY) {
    return { ok: false, problem: problem('applicability-asserted', 'applicability', `${id} asserts ${JSON.stringify(record.applicability)}.`) };
  }
  const fromId = cleanString(record.fromId);
  const toId = cleanString(record.toId);
  if (!fromId || !toId) return { ok: false, problem: problem('missing-endpoint', 'fromId', `${id} is missing an endpoint.`) };
  if (fromId === toId) return { ok: false, problem: problem('endpoint-is-self', 'fromId', `${id} starts and ends at ${fromId}.`) };
  if (!nodes.has(fromId) || !nodes.has(toId)) {
    return { ok: false, problem: problem('dangling-endpoint', 'fromId', `${id} names a node that is not admitted.`) };
  }
  const viewId = record.viewId === undefined || record.viewId === null || record.viewId === '' ? null : cleanString(record.viewId);
  if (viewId && (!VIEW_ID.test(viewId) || !views.has(viewId))) {
    return { ok: false, problem: problem('invalid-view-ref', 'viewId', `${id} names a missing view.`) };
  }
  const knowledge = record.knowledge === undefined ? 'known' : record.knowledge;
  if (knowledge !== 'known' && knowledge !== 'inferred') {
    return { ok: false, problem: problem('invalid-edge', 'knowledge', `${id} knowledge must be known or inferred. Unknown relationships are statements.`) };
  }
  const evidence: string[] = [];
  const rawEvidence = record.evidence === undefined ? [] : record.evidence;
  if (!Array.isArray(rawEvidence)) return { ok: false, problem: problem('invalid-edge', 'evidence', `${id} evidence must be an array.`) };
  for (const item of rawEvidence) {
    const text = cleanString(item);
    if (!text) return { ok: false, problem: problem('invalid-edge', 'evidence', `${id} has an empty evidence entry.`) };
    if (!evidence.includes(text)) evidence.push(text);
  }
  if (kind === 'legal-relationship' && evidence.length === 0) {
    return { ok: false, problem: problem('legal-relationship-without-evidence', 'evidence', `${id} has no evidence.`) };
  }
  if (knowledge === 'inferred' && evidence.length === 0) {
    return { ok: false, problem: problem('inferred-relation-without-evidence', 'evidence', `${id} is inferred without evidence.`) };
  }
  let exclusive: boolean | null = null;
  if (kind === 'administrative-containment') {
    if (record.exclusive === undefined) exclusive = true;
    else if (typeof record.exclusive !== 'boolean') {
      return { ok: false, problem: problem('invalid-edge', 'exclusive', `${id} exclusive must be boolean.`) };
    } else exclusive = record.exclusive;
  } else if (record.exclusive !== undefined) {
    return { ok: false, problem: problem('exclusive-not-applicable', 'exclusive', `${id} is not administrative containment.`) };
  }
  if (kind === 'delegated-authority' && !nodes.get(toId)?.roles.includes('issuer')) {
    return { ok: false, problem: problem('delegator-not-issuer', 'toId', `${id} delegates from ${toId}, which is not an issuer.`) };
  }
  const interval = parseInterval(record.valid, 'valid');
  if (!interval.ok) return interval;
  return {
    ok: true,
    edge: {
      id,
      kind: kind as RelationKind,
      fromId,
      toId,
      knowledge,
      exclusive,
      evidence,
      valid: interval.interval,
      viewId,
      note: cleanString(record.note),
    },
  };
}

function cyclicEdgeIds(edges: readonly EdgeDraft[]): Set<string> {
  const result = new Set<string>();
  const groups = new Map<string, EdgeDraft[]>();
  for (const edge of edges) {
    if (edge.kind !== 'administrative-containment') continue;
    const key = edge.viewId ?? '';
    const list = groups.get(key) ?? [];
    list.push(edge);
    groups.set(key, list);
  }
  for (const subset of groups.values()) {
    const outgoing = new Map<string, { to: string; id: string }[]>();
    const nodeIds = new Set<string>();
    for (const edge of subset) {
      nodeIds.add(edge.fromId);
      nodeIds.add(edge.toId);
      const list = outgoing.get(edge.fromId) ?? [];
      list.push({ to: edge.toId, id: edge.id });
      outgoing.set(edge.fromId, list);
    }
    const color = new Map<string, number>();
    for (const start of nodeIds) {
      if ((color.get(start) ?? 0) !== 0) continue;
      const stack: { node: string; next: number }[] = [{ node: start, next: 0 }];
      const path: string[] = [];
      color.set(start, 1);
      while (stack.length > 0) {
        const frame = stack[stack.length - 1];
        const links = outgoing.get(frame.node) ?? [];
        if (frame.next === 0) path.push(frame.node);
        if (frame.next >= links.length) {
          color.set(frame.node, 2);
          path.pop();
          stack.pop();
          continue;
        }
        const link = links[frame.next];
        frame.next += 1;
        const state = color.get(link.to) ?? 0;
        if (state === 1) {
          const startIndex = path.lastIndexOf(link.to);
          const cycle = new Set(startIndex >= 0 ? path.slice(startIndex) : [link.to]);
          for (const edge of subset) {
            if (cycle.has(edge.fromId) && cycle.has(edge.toId)) result.add(edge.id);
          }
          result.add(link.id);
        } else if (state === 0) {
          color.set(link.to, 1);
          stack.push({ node: link.to, next: 0 });
        }
      }
    }
  }
  return result;
}

function containmentFrom(edges: readonly EdgeDraft[], nodeId: string, view: 'base' | 'any' | 'view'): EdgeDraft[] {
  return edges.filter((edge) => {
    if (edge.kind !== 'administrative-containment' || edge.fromId !== nodeId) return false;
    if (view === 'base') return edge.viewId === null;
    if (view === 'view') return edge.viewId !== null;
    return true;
  });
}

function hasUnknown(unknowns: readonly UnknownDraft[], subjectId: string, about: UnknownAbout): boolean {
  return unknowns.some((item) => item.subjectId === subjectId && item.about === about);
}

function consistencyProblems(node: NodeDraft, edges: readonly EdgeDraft[], unknowns: readonly UnknownDraft[], nodes: ReadonlyMap<string, NodeDraft>): Problem[] {
  const found: Problem[] = [];
  if (node.nameKnowledge === 'unknown' && !hasUnknown(unknowns, node.id, 'name')) {
    found.push(problem('unknown-name-missing-statement', 'name', `${node.id} has an unknown name without a statement.`));
  }
  if (node.nameKnowledge !== 'unknown' && hasUnknown(unknowns, node.id, 'name')) {
    found.push(problem('conflicting-name-knowledge', 'name', `${node.id} has both a name and an unknown name statement.`));
  }
  if (node.level.knowledge === 'unknown' && !hasUnknown(unknowns, node.id, 'level')) {
    found.push(problem('unknown-level-missing-statement', 'level', `${node.id} has an unknown level without a statement.`));
  }
  if (node.level.knowledge !== 'unknown' && hasUnknown(unknowns, node.id, 'level')) {
    found.push(problem('conflicting-level-knowledge', 'level', `${node.id} has both a level and an unknown level statement.`));
  }
  const isPlace = node.roles.includes('place');
  const boundaryUnknown = hasUnknown(unknowns, node.id, 'boundary');
  if (node.boundaries.length > 0 && boundaryUnknown) {
    found.push(problem('boundary-both-known-and-unknown', 'boundaries', `${node.id} has a boundary and an unknown boundary statement.`));
  } else if (isPlace && node.boundaries.length === 0 && !boundaryUnknown) {
    found.push(problem('missing-boundary', 'boundaries', `${node.id} has no boundary and no unknown boundary statement.`));
  }
  const issuerUnknown = hasUnknown(unknowns, node.id, 'issuer');
  if (node.issuerKnowledge === 'unknown' && !issuerUnknown) {
    found.push(problem('unknown-issuer-missing-statement', 'issuerKnowledge', `${node.id} has unknown issuers without a statement.`));
  }
  if (node.issuerKnowledge !== 'unknown' && issuerUnknown) {
    found.push(problem('conflicting-issuer-knowledge', 'issuerKnowledge', `${node.id} states issuer knowledge and also says the issuer is unknown.`));
  }
  for (const issuerId of node.issuerIds) {
    if (issuerId === node.id && !node.roles.includes('issuer')) {
      found.push(problem('self-issuer-without-role', 'issuerIds', `${node.id} lists itself without the issuer role.`));
      continue;
    }
    const target = nodes.get(issuerId);
    if (!target) found.push(problem('dangling-issuer', 'issuerIds', `${node.id} names missing issuer ${issuerId}.`));
    else if (!target.roles.includes('issuer')) found.push(problem('issuer-lacks-role', 'issuerIds', `${issuerId} is not an issuer.`));
  }
  const parentUnknown = hasUnknown(unknowns, node.id, 'administrative-parent');
  const baseParents = containmentFrom(edges, node.id, 'base');
  const viewParents = containmentFrom(edges, node.id, 'view');
  const anyParents = containmentFrom(edges, node.id, 'any');
  if (node.parentKnowledge === 'none') {
    if (parentUnknown) found.push(problem('conflicting-parent-knowledge', 'parentKnowledge', `${node.id} says it has no parent and that the parent is unknown.`));
    if (anyParents.length > 0) found.push(problem('none-parent-has-edge', 'parentKnowledge', `${node.id} says it has no parent but has a containment edge.`));
  } else if (node.parentKnowledge === 'unknown') {
    if (!parentUnknown) found.push(problem('unknown-parent-missing-statement', 'parentKnowledge', `${node.id} has an unknown parent without a statement.`));
    if (anyParents.length > 0) found.push(problem('unknown-parent-has-edge', 'parentKnowledge', `${node.id} has an unknown parent and a containment edge.`));
  } else if (node.parentKnowledge === 'known') {
    if (parentUnknown) found.push(problem('conflicting-parent-knowledge', 'parentKnowledge', `${node.id} has a known parent and an unknown parent statement.`));
    if (baseParents.length === 0) found.push(problem('known-parent-missing', 'parentKnowledge', `${node.id} has no remaining base-graph parent.`));
  } else if (node.parentKnowledge === 'disputed') {
    if (parentUnknown) found.push(problem('conflicting-parent-knowledge', 'parentKnowledge', `${node.id} is disputed and also marked unknown.`));
    if (baseParents.length > 0) found.push(problem('disputed-parent-has-base', 'parentKnowledge', `${node.id} is disputed but also has a base parent.`));
    if (viewParents.length === 0) found.push(problem('disputed-parent-missing-view', 'parentKnowledge', `${node.id} is disputed without a view-scoped parent.`));
  }
  const relationUnknowns: Array<[UnknownAbout, RelationKind]> = [
    ['territorial-coverage', 'territorial-coverage'],
    ['delegated-authority', 'delegated-authority'],
    ['legal-relationship', 'legal-relationship'],
  ];
  for (const [about, kind] of relationUnknowns) {
    if (!hasUnknown(unknowns, node.id, about)) continue;
    const present = edges.some((edge) => edge.kind === kind && (edge.fromId === node.id || edge.toId === node.id));
    if (present) {
      found.push(problem('conflicting-unknown-relationship', about, `${node.id} has both a ${kind} edge and an unknown ${about} statement.`));
    }
  }
  return found;
}

function toNode(node: NodeDraft): JurisdictionNode {
  return { schema: JURISDICTION_NODE_SCHEMA, ...node };
}

function toEdge(edge: EdgeDraft): JurisdictionEdge {
  return { schema: JURISDICTION_EDGE_SCHEMA, ...edge, applicability: APPLICABILITY };
}

function toView(view: ViewDraft): DisputedView {
  return { schema: DISPUTED_VIEW_SCHEMA, ...view };
}

function toUnknown(item: UnknownDraft): UnknownRelationship {
  return { schema: UNKNOWN_RELATIONSHIP_SCHEMA, ...item, targetId: null };
}

function readCollection(record: Record<string, unknown>, field: 'nodes' | 'edges' | 'disputedViews' | 'unknownRelationships', max: number): { ok: true; values: unknown[] } | { ok: false; problem: Problem } {
  if (record[field] === undefined) return { ok: true, values: [] };
  if (!Array.isArray(record[field])) {
    return { ok: false, problem: problem('invalid-collection', field, `${field} must be an array.`) };
  }
  if (record[field].length > max) {
    return { ok: false, problem: problem('invalid-collection', field, `${field} exceeds the admission bound of ${max}.`) };
  }
  return { ok: true, values: record[field] as unknown[] };
}

export function admitJurisdictionGraph(input: unknown): AdmissionResult {
  if (input === null || input === undefined || typeof input !== 'object' || Array.isArray(input)) {
    throw new JurisdictionSchemaError('Jurisdiction graph input must be an object. No city, country, or parent was invented.');
  }
  const record = input as Record<string, unknown>;
  const quarantined: JurisdictionQuarantine[] = [];
  const graphId = cleanString(record.graphId);
  const push = (item: Problem, ids: { nodeId?: string | null; edgeId?: string | null; viewId?: string | null } = {}) => {
    quarantined.push({
      schema: QUARANTINE_SCHEMA,
      reason: item.reason,
      message: QUARANTINE_REASONS[item.reason],
      detail: item.detail,
      field: item.field,
      graphId,
      nodeId: ids.nodeId ?? null,
      edgeId: ids.edgeId ?? null,
      viewId: ids.viewId ?? null,
    });
  };
  if (tupleField(record)) {
    push(problem('tuple-is-not-graph', tupleField(record), 'The top-level record is a place tuple, not a graph.'));
    return { graph: null, quarantined };
  }
  if (!graphId) {
    push(problem('missing-graph-id', 'graphId', 'Graph id is absent.'));
    return { graph: null, quarantined };
  }
  if (!GRAPH_ID.test(graphId)) {
    push(problem('invalid-graph-id', 'graphId', `Graph id ${JSON.stringify(graphId)} is not a graph: token.`));
    return { graph: null, quarantined };
  }
  const sourceId = cleanString(record.sourceId);
  if (!sourceId || !SOURCE_ID.test(sourceId)) {
    push(problem('missing-graph-source', 'sourceId', 'Graph source id is absent or not a stable token.'));
    return { graph: null, quarantined };
  }
  const sourceRevision = cleanString(record.sourceRevision);
  const revision = revisionProblem(sourceRevision);
  if (revision) {
    push(problem(revision, 'sourceRevision', `Source revision ${JSON.stringify(record.sourceRevision)} cannot pin this graph.`));
    return { graph: null, quarantined };
  }
  let publisherId: string | null = null;
  if (record.publisherId !== undefined && record.publisherId !== null && record.publisherId !== '') {
    publisherId = cleanString(record.publisherId);
    if (!publisherId || !SOURCE_ID.test(publisherId)) {
      push(problem('invalid-publisher-id', 'publisherId', 'Publisher id is not a stable token.'));
      return { graph: null, quarantined };
    }
  }
  const observed = parseObservedAt(record.observedAt);
  if (!observed.ok) {
    push(observed.problem);
    return { graph: null, quarantined };
  }
  const nodesInput = readCollection(record, 'nodes', MAX_NODES);
  const edgesInput = readCollection(record, 'edges', MAX_EDGES);
  const viewsInput = readCollection(record, 'disputedViews', MAX_VIEWS);
  const unknownInput = readCollection(record, 'unknownRelationships', MAX_UNKNOWN_RELATIONSHIPS);
  for (const collection of [nodesInput, edgesInput, viewsInput, unknownInput]) {
    if (!collection.ok) {
      push(collection.problem);
      return { graph: null, quarantined };
    }
  }
  const envelope: Envelope = {
    graphId,
    sourceId,
    sourceRevision: sourceRevision as string,
    publisherId,
    observedAt: observed.observedAt,
  };

  const views = new Map<string, ViewDraft>();
  for (const entry of viewsInput.values) {
    const parsed = parseView(entry);
    if (!parsed.ok) {
      push(parsed.problem, { viewId: cleanString(asRecord(entry)?.id) });
      continue;
    }
    if (views.has(parsed.view.id)) {
      push(problem('duplicate-view-id', 'id', `${parsed.view.id} is duplicated.`), { viewId: parsed.view.id });
      continue;
    }
    views.set(parsed.view.id, parsed.view);
  }

  const nodes = new Map<string, NodeDraft>();
  for (const entry of nodesInput.values) {
    const parsed = parseNode(entry, new Set(views.keys()));
    const nodeId = cleanString(asRecord(entry)?.id);
    if (!parsed.ok) {
      push(parsed.problem, { nodeId });
      continue;
    }
    if (nodes.has(parsed.node.id)) {
      push(problem('duplicate-node-id', 'id', `${parsed.node.id} is duplicated.`), { nodeId: parsed.node.id });
      continue;
    }
    nodes.set(parsed.node.id, parsed.node);
  }

  for (const view of [...views.values()]) {
    const missing = view.claimantIds.filter((id) => !nodes.has(id));
    if (missing.length === 0) continue;
    views.delete(view.id);
    push(problem('dangling-claimant', 'claimantIds', `${view.id} names missing claimant ${missing.join(', ')}.`), { viewId: view.id });
  }

  const unknowns: UnknownDraft[] = [];
  const unknownKeys = new Set<string>();
  for (const entry of unknownInput.values) {
    const parsed = parseUnknown(entry, new Set(nodes.keys()));
    if (!parsed.ok) {
      push(parsed.problem, { nodeId: cleanString(asRecord(entry)?.subjectId) });
      continue;
    }
    const key = `${parsed.unknown.subjectId}\u0000${parsed.unknown.about}`;
    if (unknownKeys.has(key)) {
      push(problem('duplicate-unknown-relationship', 'about', `${parsed.unknown.subjectId} repeats ${parsed.unknown.about}.`), {
        nodeId: parsed.unknown.subjectId,
      });
      continue;
    }
    unknownKeys.add(key);
    unknowns.push(parsed.unknown);
  }

  const edges = new Map<string, EdgeDraft>();
  for (const entry of edgesInput.values) {
    const parsed = parseEdge(entry, nodes, new Set(views.keys()));
    const edgeId = cleanString(asRecord(entry)?.id);
    if (!parsed.ok) {
      push(parsed.problem, { edgeId, nodeId: cleanString(asRecord(entry)?.fromId) });
      continue;
    }
    if (edges.has(parsed.edge.id)) {
      push(problem('duplicate-edge-id', 'id', `${parsed.edge.id} is duplicated.`), { edgeId: parsed.edge.id });
      continue;
    }
    edges.set(parsed.edge.id, parsed.edge);
  }

  const cycles = cyclicEdgeIds([...edges.values()]);
  for (const edgeId of cycles) {
    const edge = edges.get(edgeId);
    if (!edge) continue;
    edges.delete(edgeId);
    push(problem('cyclic-containment', 'kind', `${edgeId} is part of an administrative cycle.`), {
      edgeId,
      nodeId: edge.fromId,
      viewId: edge.viewId,
    });
  }

  const byChild = new Map<string, EdgeDraft[]>();
  for (const edge of edges.values()) {
    if (edge.kind !== 'administrative-containment') continue;
    const key = `${edge.fromId}\u0000${edge.viewId ?? ''}`;
    const list = byChild.get(key) ?? [];
    list.push(edge);
    byChild.set(key, list);
  }
  const droppedForConflict = new Set<string>();
  for (const group of byChild.values()) {
    for (let index = 0; index < group.length; index += 1) {
      for (let other = index + 1; other < group.length; other += 1) {
        const left = group[index];
        const right = group[other];
        if (left.exclusive === false && right.exclusive === false) continue;
        const relation = overlap(left.valid, right.valid);
        if (relation === 'disjoint') continue;
        const reason = relation === 'overlap' ? 'conflicting-containment' : 'ambiguous-containment-interval';
        for (const edge of [left, right]) {
          if (!droppedForConflict.has(edge.id)) {
            droppedForConflict.add(edge.id);
            push(problem(reason, 'exclusive', `${edge.id} cannot share ${edge.fromId} with another exclusive parent in the same view.`), {
              edgeId: edge.id,
              nodeId: edge.fromId,
              viewId: edge.viewId,
            });
          }
          edges.delete(edge.id);
        }
      }
    }
  }

  const failedEdges = new Set<string>();
  const dropEdge = (edge: EdgeDraft, item: Problem) => {
    if (failedEdges.has(edge.id) || !edges.has(edge.id)) return;
    failedEdges.add(edge.id);
    edges.delete(edge.id);
    push(item, { edgeId: edge.id, nodeId: edge.fromId, viewId: edge.viewId });
  };
  let guard = 0;
  const limit = nodes.size + edges.size + views.size + 2;
  while (guard < limit) {
    guard += 1;
    const before = nodes.size + edges.size + views.size + unknowns.length;
    for (const node of [...nodes.values()]) {
      const problems = consistencyProblems(node, [...edges.values()], unknowns, nodes);
      if (problems.length === 0) continue;
      nodes.delete(node.id);
      for (const item of problems) push(item, { nodeId: node.id });
    }
    for (let index = unknowns.length - 1; index >= 0; index -= 1) {
      if (nodes.has(unknowns[index].subjectId)) continue;
      const removed = unknowns[index];
      unknowns.splice(index, 1);
      push(problem('dangling-unknown-subject', 'subjectId', `${removed.subjectId} was quarantined, so its unknown ${removed.about} statement was not kept.`), {
        nodeId: removed.subjectId,
      });
    }
    for (const view of [...views.values()]) {
      const missing = view.claimantIds.filter((id) => !nodes.has(id));
      if (missing.length === 0) continue;
      views.delete(view.id);
      push(problem('dangling-claimant', 'claimantIds', `${view.id} lost claimant ${missing.join(', ')}.`), { viewId: view.id });
    }
    for (const edge of [...edges.values()]) {
      if (!nodes.has(edge.fromId) || !nodes.has(edge.toId)) {
        dropEdge(edge, problem('dangling-endpoint', 'fromId', `${edge.id} lost an endpoint that was quarantined.`));
        continue;
      }
      if (edge.viewId && !views.has(edge.viewId)) {
        dropEdge(edge, problem('invalid-view-ref', 'viewId', `${edge.id} lost disputed view ${edge.viewId}.`));
      }
    }
    if (nodes.size + edges.size + views.size + unknowns.length === before) break;
  }

  const graph: JurisdictionGraph = {
    schema: JURISDICTION_GRAPH_SCHEMA,
    schemaVersion: SCHEMA_VERSION,
    cityRequired: CITY_REQUIRED,
    graphId: envelope.graphId,
    sourceId: envelope.sourceId,
    sourceRevision: envelope.sourceRevision,
    publisherId: envelope.publisherId,
    observedAt: envelope.observedAt,
    nodes: [...nodes.values()].sort((left, right) => left.id.localeCompare(right.id)).map(toNode),
    edges: [...edges.values()].sort((left, right) => left.id.localeCompare(right.id)).map(toEdge),
    disputedViews: [...views.values()].sort((left, right) => left.id.localeCompare(right.id)).map(toView),
    unknownRelationships: unknowns
      .sort((left, right) => left.subjectId.localeCompare(right.subjectId) || left.about.localeCompare(right.about))
      .map(toUnknown),
  };
  return { graph, quarantined };
}

export function candidateEdges(graph: JurisdictionGraph, query: { asOf: string; viewIds?: readonly string[] }): CandidateSlice {
  const viewIds = [...(query.viewIds ?? [])];
  const knownViews = new Set(graph.disputedViews.map((view) => view.id));
  for (const viewId of viewIds) {
    if (!knownViews.has(viewId)) {
      throw new JurisdictionSchemaError(`Disputed view ${JSON.stringify(viewId)} is not in graph ${graph.graphId}.`);
    }
  }
  const selected = new Set<string | null>([null, ...viewIds]);
  const edges: JurisdictionEdge[] = [];
  const undecided: JurisdictionEdge[] = [];
  for (const edge of graph.edges) {
    if (!selected.has(edge.viewId)) continue;
    const status = intervalStatus(edge.valid, query.asOf);
    if (status === 'inside') edges.push(edge);
    else if (status === 'unknown') undecided.push(edge);
  }
  edges.sort((left, right) => left.id.localeCompare(right.id));
  undecided.sort((left, right) => left.id.localeCompare(right.id));
  return {
    asOf: query.asOf,
    viewIds,
    edges,
    undecided,
    unknownRelationships: graph.unknownRelationships.map((item) => ({ ...item, targetId: null })),
    applicability: APPLICABILITY,
  };
}

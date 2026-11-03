/**
 * Join law issuers, territorial scope, and administrative parents.
 *
 * The selected place produces a search stack of national, regional, and local
 * candidates. Special and supranational candidates are added only when a
 * cited containment edge, territorial-coverage edge, delegated-authority edge,
 * sourced legal relationship, or law scope evidences them. Administrative
 * containment of a special or supranational node is not territorial scope.
 *
 * Issuer ids and territorial ids stay on separate sides of a candidate. A
 * parent issuer is not copied onto a child. Unknown relationships keep a null
 * target. A nearby place id is never added. Nothing in this module decides
 * that an instrument binds conduct. Geometry is not an input.
 */

import type { JurisdictionScope } from '../contracts';
import {
  APPLICABILITY,
  JURISDICTION_GRAPH_SCHEMA,
  JurisdictionSchemaError,
  candidateEdges,
  intervalStatus,
} from './schema';
import type {
  JurisdictionEdge,
  JurisdictionGraph,
  JurisdictionNode,
  RelationKind,
  UnknownAbout,
} from './schema';

export const AUTHORITY_STACK_SCHEMA = 'worldwide-legal-search.authority-stack@1';
export const STACK_HEADING = 'Laws and sources for this place';
export const INCLUSION_PREFIX = 'Included because';

export const AUTHORITY_BANDS = [
  'national',
  'regional',
  'local',
  'special',
  'supranational',
  'unclassified',
] as const;

export const INCLUSION_REASONS = [
  'selected-place',
  'administrative-parent',
  'territorial-coverage',
  'place-issuer',
  'delegated-authority',
  'legal-relationship',
  'law-territorial-scope',
  'law-issuer',
] as const;

export const OMISSION_REASONS = [
  'unevidenced-special',
  'unevidenced-supranational',
  'proximity',
  'validity-outside',
  'not-a-place',
  'territorial-scope-outside-stack',
] as const;

export const UNMATCHED_LAW_REASONS = [
  'territorial-scope-outside-stack',
  'unknown-scope',
  'invalid-law',
  'label-not-identity',
] as const;

export const AUTHORITY_LIMITS = {
  maxDepth: 32,
  maxCandidates: 500,
  maxLaws: 5000,
  maxNearby: 200,
  maxEvidence: 32,
} as const;

export const UNCERTAINTY = {
  notDetermination: 'This authority stack does not decide what binds conduct at this place.',
  proximity: 'Proximity does not establish inclusion.',
  containment: 'Administrative containment of a special or supranational authority is not territorial scope.',
  incomplete: 'The candidate set stopped at a bounded limit and is incomplete.',
  notAPlace: 'This id is not a place. No territory was invented.',
  noPlace: 'No place matched this id.',
  outside: 'The place is outside its validity at this date and is not current.',
  unknownValidity: 'The place validity is unknown and is not treated as current.',
} as const;

const NATIONAL_LEVELS = new Set(['country', 'constituent-country', 'dependency', 'national-authority']);
const REGIONAL_LEVELS = new Set([
  'region',
  'state',
  'province',
  'territory',
  'regional-authority',
  'autonomous-area',
]);
const LOCAL_LEVELS = new Set([
  'county',
  'district',
  'municipality',
  'city',
  'locality',
  'borough',
  'neighborhood',
  'unincorporated',
  'statistical-area',
  'postal-area',
  'local-authority',
]);

const KIND_ABOUT: Record<RelationKind, UnknownAbout> = {
  'administrative-containment': 'administrative-parent',
  'territorial-coverage': 'territorial-coverage',
  'delegated-authority': 'delegated-authority',
  'legal-relationship': 'legal-relationship',
};

export type AuthorityBand = (typeof AUTHORITY_BANDS)[number];
export type InclusionReason = (typeof INCLUSION_REASONS)[number];
export type OmissionReason = (typeof OMISSION_REASONS)[number];
export type UnmatchedLawReason = (typeof UNMATCHED_LAW_REASONS)[number];
export type AuthorityStatus = 'resolved' | 'unresolved' | 'invalid-query';
export type StackSide = 'territory' | 'issuer';

export interface LawScopeInput {
  lawId?: string;
  sectionId?: string;
  instrumentId?: string;
  sourceId?: string;
  sourceRevision?: string;
  issuerIds?: readonly string[];
  territorialIds?: readonly string[];
  territorialLabels?: readonly string[];
  knowledge?: string;
  uncertainty?: readonly string[];
  evidence?: readonly string[];
  scope?: {
    issuerIds?: readonly string[];
    territorialIds?: readonly string[];
    territorialLabels?: readonly string[];
    knowledge?: string;
    uncertainty?: readonly string[];
  };
}

export interface AuthorityQuery {
  placeId: string;
  asOf: string;
  viewIds?: readonly string[];
  laws?: readonly LawScopeInput[];
  nearbyPlaceIds?: readonly string[];
}

export interface Inclusion {
  reason: InclusionReason;
  because: string;
  knowledge: 'known' | 'inferred';
  evidence: string[];
  edgeIds: string[];
  lawIds: string[];
}

export interface AuthoritySide {
  distinction: StackSide;
  inclusions: Inclusion[];
}

export interface AuthorityCandidate {
  id: string;
  name: string | null;
  levelKind: string;
  band: AuthorityBand;
  territory: AuthoritySide | null;
  issuer: AuthoritySide | null;
  applicability: typeof APPLICABILITY;
}

export interface UnknownLink {
  subjectId: string;
  about: string;
  reason: string;
  targetId: null;
  edgeId: string | null;
  lawId: string | null;
}

export interface KnownAbsence {
  subjectId: string;
  about: 'administrative-parent' | 'issuer';
  statement: string;
}

export interface DisputedHold {
  subjectId: string;
  about: 'administrative-parent';
  viewIds: string[];
  statement: string;
}

export interface Omission {
  id: string;
  reason: OmissionReason;
  detail: string;
}

export interface UnmatchedLaw {
  lawId: string;
  reason: UnmatchedLawReason;
}

export interface AuthorityChecks {
  nodesConsidered: number;
  edgesConsidered: number;
  lawsConsidered: number;
}

export interface AuthorityStack {
  schema: typeof AUTHORITY_STACK_SCHEMA;
  status: AuthorityStatus;
  applicability: typeof APPLICABILITY;
  heading: typeof STACK_HEADING;
  graphId: string | null;
  placeId: string | null;
  asOf: string | null;
  viewIds: string[];
  issuerIds: string[];
  territorialIds: string[];
  uncertainty: string[];
  relationshipEvidence: string[];
  candidates: AuthorityCandidate[];
  byBand: Record<AuthorityBand, string[]>;
  unknownLinks: UnknownLink[];
  knownAbsences: KnownAbsence[];
  disputedHolds: DisputedHold[];
  omitted: Omission[];
  unmatchedLaws: UnmatchedLaw[];
  truncated: boolean;
  checks: AuthorityChecks;
}

interface Draft {
  id: string;
  name: string | null;
  levelKind: string;
  band: AuthorityBand;
  territory: Inclusion[];
  issuer: Inclusion[];
}

interface NormalizedLaw {
  lawId: string;
  issuerIds: string[];
  territorialIds: string[];
  territorialLabels: string[];
  knowledge: 'known' | 'inferred' | 'unknown';
  uncertainty: string[];
  evidence: string[];
}

interface Build {
  graph: JurisdictionGraph;
  asOf: string;
  viewIds: string[];
  selectedId: string;
  nodes: Map<string, JurisdictionNode>;
  parentsOf: Map<string, JurisdictionEdge[]>;
  undecidedByKind: Map<RelationKind, Map<string, JurisdictionEdge[]>>;
  edgesByKind: Map<RelationKind, JurisdictionEdge[]>;
  candidates: Map<string, Draft>;
  omissions: Omission[];
  unknownLinks: UnknownLink[];
  knownAbsences: KnownAbsence[];
  disputedHolds: DisputedHold[];
  uncertainty: Set<string>;
  unmatchedLaws: UnmatchedLaw[];
  truncated: boolean;
  expanded: Set<string>;
  lawsConsidered: number;
  edgesConsidered: number;
}

export function bandForLevel(kind: string): AuthorityBand {
  if (NATIONAL_LEVELS.has(kind)) return 'national';
  if (REGIONAL_LEVELS.has(kind)) return 'regional';
  if (LOCAL_LEVELS.has(kind)) return 'local';
  if (kind === 'supranational') return 'supranational';
  if (kind === 'unknown') return 'unclassified';
  return 'special';
}

export function inclusionLines(stack: AuthorityStack): string[] {
  const lines: string[] = [];
  for (const candidate of stack.candidates) {
    for (const side of [candidate.territory, candidate.issuer]) {
      if (!side) continue;
      for (const inclusion of side.inclusions) lines.push(inclusion.because);
    }
  }
  return lines;
}

export function jurisdictionScopeOf(stack: AuthorityStack): JurisdictionScope {
  return {
    placeId: stack.placeId ?? '',
    asOf: stack.asOf ?? '',
    issuerIds: [...stack.issuerIds],
    territorialIds: [...stack.territorialIds],
    uncertainty: [...stack.uncertainty],
    relationshipEvidence: [...stack.relationshipEvidence],
  };
}

export function joinAuthorityStack(graph: JurisdictionGraph, query: AuthorityQuery): AuthorityStack {
  const requestedPlace = typeof query?.placeId === 'string' ? query.placeId.trim() : '';
  const requestedAsOf = typeof query?.asOf === 'string' ? query.asOf.trim() : '';
  const graphId = graph && graph.schema === JURISDICTION_GRAPH_SCHEMA ? graph.graphId : null;
  if (!graph || graph.schema !== JURISDICTION_GRAPH_SCHEMA || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    return blankStack(graphId, 'invalid-query', requestedPlace || null, requestedAsOf || null, ['The jurisdiction graph is not an admitted graph.']);
  }
  if (!requestedPlace || !requestedAsOf) {
    return blankStack(graphId, 'invalid-query', requestedPlace || null, requestedAsOf || null, ['A place id and an as-of date are required.']);
  }
  const viewIds = readTokens(query.viewIds, 'view id');
  if (!viewIds.ok) return blankStack(graphId, 'invalid-query', requestedPlace, requestedAsOf, [viewIds.detail]);
  const nearby = readTokens(query.nearbyPlaceIds, 'nearby place id', AUTHORITY_LIMITS.maxNearby);
  if (!nearby.ok) return blankStack(graphId, 'invalid-query', requestedPlace, requestedAsOf, [nearby.detail]);
  if (query.laws !== undefined && query.laws !== null && !Array.isArray(query.laws)) {
    return blankStack(graphId, 'invalid-query', requestedPlace, requestedAsOf, ['laws must be an array.']);
  }
  try {
    intervalStatus(
      {
        start: { knowledge: 'known', value: '2000', precision: 'year', source: 'authority-stack' },
        end: { knowledge: 'open', value: null, precision: null, source: 'authority-stack' },
      },
      requestedAsOf,
    );
    const slice = candidateEdges(graph, { asOf: requestedAsOf, viewIds: viewIds.values });
    return assemble(graph, {
      placeId: requestedPlace,
      asOf: requestedAsOf,
      viewIds: viewIds.values,
      nearby: nearby.values,
      nearbyTruncated: nearby.truncated,
      laws: query.laws ?? [],
      sliceEdges: slice.edges,
      sliceUndecided: slice.undecided,
    });
  } catch (error) {
    if (error instanceof JurisdictionSchemaError) {
      return blankStack(graphId, 'invalid-query', requestedPlace, requestedAsOf, [error.message]);
    }
    throw error;
  }
}

function assemble(
  graph: JurisdictionGraph,
  input: {
    placeId: string;
    asOf: string;
    viewIds: string[];
    nearby: string[];
    nearbyTruncated: boolean;
    laws: readonly LawScopeInput[];
    sliceEdges: readonly JurisdictionEdge[];
    sliceUndecided: readonly JurisdictionEdge[];
  },
): AuthorityStack {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const selected = nodes.get(input.placeId);
  if (!selected) {
    return finishUnresolved(graph, input, nodes, UNCERTAINTY.noPlace, null);
  }
  if (!selected.roles.includes('place')) {
    const stack = finishUnresolved(graph, input, nodes, UNCERTAINTY.notAPlace, selected);
    stack.omitted.push({
      id: selected.id,
      reason: 'not-a-place',
      detail: `${selected.id} is an issuer or other node without the place role. No territory was invented.`,
    });
    return stack;
  }
  const validity = intervalStatus(selected.valid, input.asOf);
  if (validity === 'outside') {
    const stack = finishUnresolved(graph, input, nodes, UNCERTAINTY.outside, selected);
    stack.omitted.push({
      id: selected.id,
      reason: 'validity-outside',
      detail: `${labelOf(selected)} is outside its validity at this date and is not current.`,
    });
    return stack;
  }
  if (validity === 'unknown') {
    const stack = finishUnresolved(graph, input, nodes, UNCERTAINTY.unknownValidity, selected);
    stack.unknownLinks.push({
      subjectId: selected.id,
      about: 'validity',
      reason: UNCERTAINTY.unknownValidity,
      targetId: null,
      edgeId: null,
      lawId: null,
    });
    return stack;
  }

  const build = createBuild(graph, input, nodes);
  if (input.nearbyTruncated) build.truncated = true;
  addTerritory(build, selected, makeInclusion('selected-place', `${labelOf(selected)} is the selected place.`, 'known', [], [], []));
  walkParents(build, selected);
  addCoverage(build);
  const matchIds = territoryIds(build);
  addPlaceIssuers(build, matchIds);
  addDelegation(build);
  addLegalRelationships(build);
  addLaws(build, new Set(matchIds), input.laws);
  addNearbyOmissions(build, input.nearby);
  noteDisputedParents(build);
  noteKnownParentsMissing(build);
  noteAbsences(build);
  copyUnknownRelationships(build);
  synthesizeKnowledgeGaps(build);
  return toStack(build, 'resolved');
}

function createBuild(
  graph: JurisdictionGraph,
  input: {
    placeId: string;
    asOf: string;
    viewIds: string[];
    sliceEdges: readonly JurisdictionEdge[];
    sliceUndecided: readonly JurisdictionEdge[];
  },
  nodes: Map<string, JurisdictionNode>,
): Build {
  const parentsOf = new Map<string, JurisdictionEdge[]>();
  const edgesByKind = new Map<RelationKind, JurisdictionEdge[]>();
  for (const edge of input.sliceEdges) {
    const list = edgesByKind.get(edge.kind) ?? [];
    list.push(edge);
    edgesByKind.set(edge.kind, list);
    if (edge.kind === 'administrative-containment') pushEdge(parentsOf, edge.fromId, edge);
  }
  const undecidedByKind = new Map<RelationKind, Map<string, JurisdictionEdge[]>>();
  for (const edge of input.sliceUndecided) {
    let byFrom = undecidedByKind.get(edge.kind);
    if (!byFrom) {
      byFrom = new Map();
      undecidedByKind.set(edge.kind, byFrom);
    }
    pushEdge(byFrom, edge.fromId, edge);
  }
  for (const list of parentsOf.values()) sortEdges(list);
  for (const list of edgesByKind.values()) sortEdges(list);
  return {
    graph,
    asOf: input.asOf,
    viewIds: input.viewIds,
    selectedId: input.placeId,
    nodes,
    parentsOf,
    undecidedByKind,
    edgesByKind,
    candidates: new Map(),
    omissions: [],
    unknownLinks: [],
    knownAbsences: [],
    disputedHolds: [],
    uncertainty: new Set([UNCERTAINTY.notDetermination]),
    unmatchedLaws: [],
    truncated: false,
    expanded: new Set(),
    lawsConsidered: 0,
    edgesConsidered: input.sliceEdges.length + input.sliceUndecided.length,
  };
}

function walkParents(build: Build, selected: JurisdictionNode): void {
  const queue: Array<{ id: string; depth: number; via: JurisdictionEdge | null }> = [
    { id: selected.id, depth: 0, via: null },
  ];
  const queued = new Set<string>([`${selected.id}|`]);
  while (queue.length > 0) {
    const item = queue.shift();
    if (!item) break;
    const node = build.nodes.get(item.id);
    if (!node) continue;
    if (item.via) {
      const validity = intervalStatus(node.valid, build.asOf);
      if (validity === 'outside') {
        addOmission(build, node, 'validity-outside', `${labelOf(node)} is outside its validity at this date and is not current.`);
        continue;
      }
      if (validity === 'unknown') {
        addUnknown(build, {
          subjectId: node.id,
          about: 'validity',
          reason: `${labelOf(node)} has unknown validity and was not treated as a current authority.`,
          targetId: null,
          edgeId: item.via.id,
          lawId: null,
        });
        continue;
      }
      considerParent(build, node, item.via);
    }
    if (build.expanded.has(node.id)) continue;
    build.expanded.add(node.id);
    if (item.depth >= AUTHORITY_LIMITS.maxDepth) {
      build.truncated = true;
      build.uncertainty.add(UNCERTAINTY.incomplete);
      continue;
    }
    recordUndecided(build, node.id, 'administrative-containment');
    const parents = build.parentsOf.get(node.id) ?? [];
    for (const edge of parents) {
      if (!supportedEdge(build, edge)) continue;
      const key = `${edge.toId}|${edge.id}`;
      if (queued.has(key)) continue;
      queued.add(key);
      queue.push({ id: edge.toId, depth: item.depth + 1, via: edge });
    }
  }
}

function considerParent(build: Build, parent: JurisdictionNode, via: JurisdictionEdge): void {
  const band = bandForLevel(parent.level.kind);
  const routine = band === 'national' || band === 'regional' || band === 'local';
  const cited = via.evidence.length > 0;
  if (!routine && !cited) {
    const reason = band === 'supranational' ? 'unevidenced-supranational' : 'unevidenced-special';
    const detail = band === 'supranational'
      ? `${labelOf(parent)} is a supranational authority reached by administrative containment. Containment was not treated as territorial scope.`
      : `${labelOf(parent)} is a special, unrecognized, or unknown-level authority reached by administrative containment. No cited containment evidence included it.`;
    addOmission(build, parent, reason, detail);
    return;
  }
  const child = build.nodes.get(via.fromId);
  const childIsStack = via.fromId === build.selectedId || build.candidates.has(via.fromId);
  const sentence = childIsStack
    ? `${labelOf(child)} is administratively contained in ${labelOf(parent)}.`
    : `${labelOf(parent)} is an administrative ancestor of ${labelOf(build.nodes.get(build.selectedId))}.`;
  const inclusion = makeInclusion('administrative-parent', sentence, via.knowledge, via.evidence, [via.id], []);
  if (parent.roles.includes('place')) addTerritory(build, parent, inclusion);
  else if (parent.roles.includes('issuer')) addIssuer(build, parent, inclusion);
}

function addCoverage(build: Build): void {
  const fromIds = new Set(territoryIds(build));
  recordUndecidedFrom(build, fromIds, 'territorial-coverage');
  for (const edge of build.edgesByKind.get('territorial-coverage') ?? []) {
    if (!fromIds.has(edge.fromId) || !supportedEdge(build, edge)) continue;
    const covering = currentNode(build, edge.toId, edge.id);
    if (!covering || !covering.roles.includes('place')) continue;
    const covered = build.nodes.get(edge.fromId);
    addTerritory(
      build,
      covering,
      makeInclusion(
        'territorial-coverage',
        `${labelOf(covered)} records territorial coverage by ${labelOf(covering)}.`,
        edge.knowledge,
        edge.evidence,
        [edge.id],
        [],
      ),
    );
  }
}

function addPlaceIssuers(build: Build, territoryIdsToRead: readonly string[]): void {
  for (const territoryId of territoryIdsToRead) {
    const node = build.nodes.get(territoryId);
    if (!node) continue;
    if (node.issuerKnowledge === 'none' || node.issuerKnowledge === 'unknown') continue;
    for (const issuerId of node.issuerIds) {
      const issuer = build.nodes.get(issuerId);
      if (!issuer || !issuer.roles.includes('issuer')) {
        addUnknown(build, {
          subjectId: node.id,
          about: 'issuer',
          reason: `${labelOf(node)} names an issuer that is not an issuer node in this graph. No issuer was invented.`,
          targetId: null,
          edgeId: null,
          lawId: null,
        });
        continue;
      }
      if (!currentNode(build, issuer.id, null)) continue;
      addIssuer(
        build,
        issuer,
        makeInclusion(
          'place-issuer',
          `${labelOf(node)} lists ${labelOf(issuer)} as an issuer. The issuer remains distinct from the territory.`,
          'known',
          [],
          [],
          [],
        ),
      );
    }
  }
}

function addDelegation(build: Build): void {
  const issuerIds = new Set(issuerIdsOf(build));
  recordUndecidedFrom(build, issuerIds, 'delegated-authority');
  for (const edge of build.edgesByKind.get('delegated-authority') ?? []) {
    if (!issuerIds.has(edge.fromId) || !supportedEdge(build, edge)) continue;
    const delegator = currentNode(build, edge.toId, edge.id);
    if (!delegator || !delegator.roles.includes('issuer')) continue;
    const delegate = build.nodes.get(edge.fromId);
    addIssuer(
      build,
      delegator,
      makeInclusion(
        'delegated-authority',
        `${labelOf(delegate)} records delegated authority from ${labelOf(delegator)}.`,
        edge.knowledge,
        edge.evidence,
        [edge.id],
        [],
      ),
    );
  }
}

function addLegalRelationships(build: Build): void {
  const memberIds = new Set(build.candidates.keys());
  recordUndecidedFrom(build, memberIds, 'legal-relationship');
  for (const edge of build.edgesByKind.get('legal-relationship') ?? []) {
    if (!supportedEdge(build, edge) || edge.evidence.length === 0) continue;
    const fromMember = memberIds.has(edge.fromId);
    const toMember = memberIds.has(edge.toId);
    if (!fromMember && !toMember) continue;
    const targetIds = fromMember && toMember ? [edge.fromId, edge.toId] : [fromMember ? edge.toId : edge.fromId];
    const from = build.nodes.get(edge.fromId);
    const to = build.nodes.get(edge.toId);
    const inclusion = makeInclusion(
      'legal-relationship',
      `a sourced relationship links ${labelOf(from)} and ${labelOf(to)}.`,
      edge.knowledge,
      edge.evidence,
      [edge.id],
      [],
    );
    for (const targetId of targetIds) {
      const target = fromMember && toMember ? build.nodes.get(targetId) ?? null : currentNode(build, targetId, edge.id);
      if (!target) continue;
      if (target.roles.includes('place')) addTerritory(build, target, cloneInclusion(inclusion));
      if (target.roles.includes('issuer')) addIssuer(build, target, cloneInclusion(inclusion));
    }
  }
}

function addLaws(build: Build, matchIds: ReadonlySet<string>, laws: readonly LawScopeInput[]): void {
  const limited = laws.slice(0, AUTHORITY_LIMITS.maxLaws);
  if (laws.length > AUTHORITY_LIMITS.maxLaws) {
    build.truncated = true;
    build.uncertainty.add(UNCERTAINTY.incomplete);
  }
  for (const input of limited) {
    build.lawsConsidered += 1;
    const parsed = normalizeLaw(input);
    if (!parsed.ok) {
      build.unmatchedLaws.push({ lawId: parsed.lawId, reason: 'invalid-law' });
      build.uncertainty.add(parsed.detail);
      continue;
    }
    const law = parsed.law;
    if (law.knowledge === 'unknown') {
      addUnknown(build, {
        subjectId: law.lawId,
        about: 'law-scope',
        reason: `Law ${law.lawId} has unknown scope. Its issuer ids and territorial ids were not joined.`,
        targetId: null,
        edgeId: null,
        lawId: law.lawId,
      });
      for (const note of law.uncertainty) build.uncertainty.add(note);
      build.unmatchedLaws.push({ lawId: law.lawId, reason: 'unknown-scope' });
      continue;
    }
    if (law.territorialLabels.length > 0) {
      build.uncertainty.add(`Law ${law.lawId} territorial labels are not place ids and were not used as identity.`);
    }
    if (law.territorialIds.length === 0) {
      build.unmatchedLaws.push({
        lawId: law.lawId,
        reason: law.territorialLabels.length > 0 ? 'label-not-identity' : 'territorial-scope-outside-stack',
      });
      continue;
    }
    const matched = law.territorialIds.filter((id) => matchIds.has(id));
    if (matched.length === 0) {
      build.unmatchedLaws.push({ lawId: law.lawId, reason: 'territorial-scope-outside-stack' });
      continue;
    }
    for (const note of law.uncertainty) build.uncertainty.add(note);
    for (const territoryId of matched) {
      const territory = build.nodes.get(territoryId);
      if (!territory) continue;
      addTerritory(
        build,
        territory,
        makeInclusion(
          'law-territorial-scope',
          `law ${law.lawId} states a territorial scope that includes ${labelOf(territory)}.`,
          law.knowledge,
          law.evidence,
          [],
          [law.lawId],
        ),
      );
    }
    for (const extraId of law.territorialIds) {
      if (matchIds.has(extraId)) continue;
      const extra = build.nodes.get(extraId);
      if (!extra || !extra.roles.includes('place')) {
        build.uncertainty.add(`Law ${law.lawId} names ${extraId}, which is outside this place's stack and was not added.`);
        continue;
      }
      const band = bandForLevel(extra.level.kind);
      if (band !== 'special' && band !== 'supranational' && band !== 'unclassified') {
        build.uncertainty.add(`Law ${law.lawId} also names ${labelOf(extra)}, which is outside this place's national, regional, and local stack and was not added.`);
        continue;
      }
      if (!currentNode(build, extra.id, null)) continue;
      addTerritory(
        build,
        extra,
        makeInclusion(
          'law-territorial-scope',
          `law ${law.lawId} states a territorial scope that includes ${labelOf(extra)} together with this place's stack.`,
          law.knowledge,
          law.evidence,
          [],
          [law.lawId],
        ),
      );
    }
    for (const issuerId of law.issuerIds) {
      const issuer = build.nodes.get(issuerId);
      if (!issuer || !issuer.roles.includes('issuer') || !currentNode(build, issuer.id, null)) {
        addUnknown(build, {
          subjectId: law.lawId,
          about: 'issuer',
          reason: `Law ${law.lawId} names an issuer that is not an issuer node in this graph. No issuer was invented.`,
          targetId: null,
          edgeId: null,
          lawId: law.lawId,
        });
        continue;
      }
      addIssuer(
        build,
        issuer,
        makeInclusion(
          'law-issuer',
          `law ${law.lawId} names ${labelOf(issuer)} as an issuer for a territorial scope that includes this place. The issuer remains distinct from the territory.`,
          law.knowledge,
          law.evidence,
          [],
          [law.lawId],
        ),
      );
    }
  }
}

function noteDisputedParents(build: Build): void {
  const selectedViews = new Set(build.viewIds);
  for (const node of focusNodes(build)) {
    if (node.parentKnowledge !== 'disputed') continue;
    const current = build.parentsOf.get(node.id) ?? [];
    const views: string[] = [];
    for (const edge of build.graph.edges) {
      if (edge.kind !== 'administrative-containment' || edge.fromId !== node.id || !edge.viewId) continue;
      if (!views.includes(edge.viewId)) views.push(edge.viewId);
    }
    views.sort((left, right) => left.localeCompare(right));
    if (current.length === 0) {
      build.disputedHolds.push({
        subjectId: node.id,
        about: 'administrative-parent',
        viewIds: views,
        statement: 'Disputed administrative parents are not in this stack until their views are selected. No parent was chosen.',
      });
      continue;
    }
    const missing = views.filter((viewId) => !selectedViews.has(viewId));
    if (missing.length > 0) {
      build.uncertainty.add(
        `Disputed views ${missing.join(', ')} were not selected. Their administrative parents were not added, and no parent was treated as the only parent.`,
      );
    }
  }
}

function noteKnownParentsMissing(build: Build): void {
  for (const node of focusNodes(build)) {
    if (node.parentKnowledge !== 'known') continue;
    const current = build.parentsOf.get(node.id) ?? [];
    const undecided = build.undecidedByKind.get('administrative-containment')?.get(node.id) ?? [];
    if (current.length > 0 || undecided.length > 0) continue;
    build.uncertainty.add(`${labelOf(node)} is marked as having an administrative parent, but no parent edge is current at this date.`);
  }
}

function noteAbsences(build: Build): void {
  for (const draft of build.candidates.values()) {
    const node = build.nodes.get(draft.id);
    if (!node) continue;
    if (node.parentKnowledge === 'none') {
      build.knownAbsences.push({
        subjectId: node.id,
        about: 'administrative-parent',
        statement: `${labelOf(node)} has no administrative parent. No parent was invented.`,
      });
    }
    if (node.issuerKnowledge === 'none') {
      build.knownAbsences.push({
        subjectId: node.id,
        about: 'issuer',
        statement: `${labelOf(node)} lists no issuer ids. No issuer was invented.`,
      });
    }
  }
}

function copyUnknownRelationships(build: Build): void {
  const focus = focusIds(build);
  for (const item of build.graph.unknownRelationships) {
    if (!focus.has(item.subjectId)) continue;
    addUnknown(build, {
      subjectId: item.subjectId,
      about: item.about,
      reason: item.reason,
      targetId: null,
      edgeId: null,
      lawId: null,
    });
  }
}

function synthesizeKnowledgeGaps(build: Build): void {
  for (const node of focusNodes(build)) {
    if (node.parentKnowledge === 'unknown' && !hasUnknown(build, node.id, 'administrative-parent')) {
      addUnknown(build, {
        subjectId: node.id,
        about: 'administrative-parent',
        reason: 'Administrative parent is unknown. No parent was invented.',
        targetId: null,
        edgeId: null,
        lawId: null,
      });
    }
    if (node.issuerKnowledge === 'unknown' && !hasUnknown(build, node.id, 'issuer')) {
      addUnknown(build, {
        subjectId: node.id,
        about: 'issuer',
        reason: 'Issuer is unknown. No issuer was invented.',
        targetId: null,
        edgeId: null,
        lawId: null,
      });
    }
  }
}

function addNearbyOmissions(build: Build, nearby: readonly string[]): void {
  if (nearby.length === 0) return;
  build.uncertainty.add(UNCERTAINTY.proximity);
  for (const id of nearby) {
    if (id === build.selectedId || build.candidates.has(id)) continue;
    build.omissions.push({
      id,
      reason: 'proximity',
      detail: `Nearby id ${id} was not added. Proximity does not establish inclusion.`,
    });
  }
}

function toStack(build: Build, status: AuthorityStatus): AuthorityStack {
  const keptOmissions = build.omissions.filter((omission) => {
    if (!build.candidates.has(omission.id)) return true;
    return omission.reason !== 'unevidenced-special'
      && omission.reason !== 'unevidenced-supranational'
      && omission.reason !== 'proximity';
  });
  if (keptOmissions.some((omission) => omission.reason === 'unevidenced-special' || omission.reason === 'unevidenced-supranational')) {
    build.uncertainty.add(UNCERTAINTY.containment);
  }
  const candidates = [...build.candidates.values()]
    .map((draft) => toCandidate(draft))
    .filter((candidate) => candidate.territory || candidate.issuer)
    .sort(compareCandidates);
  const byBand = emptyByBand();
  for (const candidate of candidates) byBand[candidate.band].push(candidate.id);
  const territorial = candidates.filter((candidate) => candidate.territory).map((candidate) => candidate.id)
    .sort((left, right) => left.localeCompare(right));
  const issuers = candidates.filter((candidate) => candidate.issuer).map((candidate) => candidate.id)
    .sort((left, right) => left.localeCompare(right));
  const relationshipEvidence = new Set<string>();
  for (const candidate of candidates) {
    for (const side of [candidate.territory, candidate.issuer]) {
      if (!side) continue;
      for (const inclusion of side.inclusions) {
        for (const item of inclusion.evidence) relationshipEvidence.add(item);
      }
    }
  }
  const fixed = [
    UNCERTAINTY.notDetermination,
    ...(build.uncertainty.has(UNCERTAINTY.proximity) ? [UNCERTAINTY.proximity] : []),
    ...(build.uncertainty.has(UNCERTAINTY.containment) ? [UNCERTAINTY.containment] : []),
    ...(build.truncated ? [UNCERTAINTY.incomplete] : []),
  ];
  const extras = [...build.uncertainty].filter((item) => !fixed.includes(item)).sort((left, right) => left.localeCompare(right));
  return {
    schema: AUTHORITY_STACK_SCHEMA,
    status,
    applicability: APPLICABILITY,
    heading: STACK_HEADING,
    graphId: build.graph.graphId,
    placeId: build.selectedId,
    asOf: build.asOf,
    viewIds: [...build.viewIds],
    issuerIds: issuers,
    territorialIds: territorial,
    uncertainty: [...fixed, ...extras],
    relationshipEvidence: [...relationshipEvidence].sort((left, right) => left.localeCompare(right)),
    candidates,
    byBand,
    unknownLinks: sortUnknown(build.unknownLinks),
    knownAbsences: [...build.knownAbsences].sort((left, right) => left.subjectId.localeCompare(right.subjectId) || left.about.localeCompare(right.about)),
    disputedHolds: [...build.disputedHolds].sort((left, right) => left.subjectId.localeCompare(right.subjectId)),
    omitted: dedupeOmissions(keptOmissions),
    unmatchedLaws: [...build.unmatchedLaws].sort((left, right) => left.lawId.localeCompare(right.lawId) || left.reason.localeCompare(right.reason)),
    truncated: build.truncated,
    checks: {
      nodesConsidered: build.expanded.size,
      edgesConsidered: build.edgesConsidered,
      lawsConsidered: build.lawsConsidered,
    },
  };
}

function finishUnresolved(
  graph: JurisdictionGraph,
  input: { placeId: string; asOf: string; viewIds: string[]; nearby: string[] },
  nodes: Map<string, JurisdictionNode>,
  message: string,
  subject: JurisdictionNode | null,
): AuthorityStack {
  const unknownLinks: UnknownLink[] = [];
  if (subject) {
    for (const item of graph.unknownRelationships) {
      if (item.subjectId !== subject.id) continue;
      unknownLinks.push({
        subjectId: item.subjectId,
        about: item.about,
        reason: item.reason,
        targetId: null,
        edgeId: null,
        lawId: null,
      });
    }
  }
  const uncertainty = [UNCERTAINTY.notDetermination, message];
  if (input.nearby.length > 0) uncertainty.push(UNCERTAINTY.proximity);
  const omitted: Omission[] = input.nearby
    .filter((id) => id !== input.placeId)
    .map((id) => ({
      id,
      reason: 'proximity' as const,
      detail: `Nearby id ${id} was not added. Proximity does not establish inclusion.`,
    }));
  return {
    schema: AUTHORITY_STACK_SCHEMA,
    status: 'unresolved',
    applicability: APPLICABILITY,
    heading: STACK_HEADING,
    graphId: graph.graphId,
    placeId: input.placeId,
    asOf: input.asOf,
    viewIds: [...input.viewIds],
    issuerIds: [],
    territorialIds: [],
    uncertainty,
    relationshipEvidence: [],
    candidates: [],
    byBand: emptyByBand(),
    unknownLinks: sortUnknown(unknownLinks),
    knownAbsences: [],
    disputedHolds: [],
    omitted: dedupeOmissions(omitted),
    unmatchedLaws: [],
    truncated: false,
    checks: { nodesConsidered: subject && nodes.has(subject.id) ? 1 : 0, edgesConsidered: 0, lawsConsidered: 0 },
  };
}

function blankStack(
  graphId: string | null,
  status: AuthorityStatus,
  placeId: string | null,
  asOf: string | null,
  messages: string[],
): AuthorityStack {
  return {
    schema: AUTHORITY_STACK_SCHEMA,
    status,
    applicability: APPLICABILITY,
    heading: STACK_HEADING,
    graphId,
    placeId,
    asOf,
    viewIds: [],
    issuerIds: [],
    territorialIds: [],
    uncertainty: [UNCERTAINTY.notDetermination, ...messages],
    relationshipEvidence: [],
    candidates: [],
    byBand: emptyByBand(),
    unknownLinks: [],
    knownAbsences: [],
    disputedHolds: [],
    omitted: [],
    unmatchedLaws: [],
    truncated: false,
    checks: { nodesConsidered: 0, edgesConsidered: 0, lawsConsidered: 0 },
  };
}

function supportedEdge(build: Build, edge: JurisdictionEdge): boolean {
  if (edge.kind === 'legal-relationship' && edge.evidence.length === 0) {
    build.uncertainty.add(`Legal relationship ${edge.id} has no evidence and was not used.`);
    return false;
  }
  if (edge.knowledge === 'inferred' && edge.evidence.length === 0) {
    build.uncertainty.add(`Inferred ${edge.kind} edge ${edge.id} has no evidence and was not used.`);
    return false;
  }
  return true;
}

function currentNode(build: Build, id: string, edgeId: string | null): JurisdictionNode | null {
  const node = build.nodes.get(id);
  if (!node) return null;
  const validity = intervalStatus(node.valid, build.asOf);
  if (validity === 'inside') return node;
  if (validity === 'outside') {
    addOmission(build, node, 'validity-outside', `${labelOf(node)} is outside its validity at this date and is not current.`);
    return null;
  }
  addUnknown(build, {
    subjectId: node.id,
    about: 'validity',
    reason: `${labelOf(node)} has unknown validity and was not treated as a current authority.`,
    targetId: null,
    edgeId,
    lawId: null,
  });
  return null;
}

function recordUndecided(build: Build, fromId: string, kind: RelationKind): void {
  const edges = build.undecidedByKind.get(kind)?.get(fromId) ?? [];
  for (const edge of edges) {
    addUnknown(build, {
      subjectId: fromId,
      about: KIND_ABOUT[kind],
      reason: `${kind} edge ${edge.id} is not current because its validity is unknown. No endpoint was treated as included.`,
      targetId: null,
      edgeId: edge.id,
      lawId: null,
    });
  }
}

function recordUndecidedFrom(build: Build, fromIds: ReadonlySet<string>, kind: RelationKind): void {
  for (const fromId of fromIds) recordUndecided(build, fromId, kind);
}

function addTerritory(build: Build, node: JurisdictionNode, inclusion: Inclusion): void {
  addSide(build, node, 'territory', inclusion);
}

function addIssuer(build: Build, node: JurisdictionNode, inclusion: Inclusion): void {
  addSide(build, node, 'issuer', inclusion);
}

function addSide(build: Build, node: JurisdictionNode, side: StackSide, inclusion: Inclusion): void {
  let draft = build.candidates.get(node.id);
  if (!draft) {
    if (build.candidates.size >= AUTHORITY_LIMITS.maxCandidates) {
      build.truncated = true;
      build.uncertainty.add(UNCERTAINTY.incomplete);
      return;
    }
    draft = {
      id: node.id,
      name: node.names[0]?.text ?? null,
      levelKind: node.level.kind,
      band: bandForLevel(node.level.kind),
      territory: [],
      issuer: [],
    };
    build.candidates.set(node.id, draft);
  }
  const list = draft[side];
  const key = inclusionKey(inclusion);
  if (list.some((item) => inclusionKey(item) === key)) return;
  list.push(inclusion);
}

function addOmission(build: Build, node: JurisdictionNode, reason: OmissionReason, detail: string): void {
  build.omissions.push({ id: node.id, reason, detail });
}

function addUnknown(build: Build, link: UnknownLink): void {
  const key = `${link.subjectId}|${link.about}|${link.reason}|${link.edgeId ?? ''}|${link.lawId ?? ''}`;
  if (build.unknownLinks.some((item) => `${item.subjectId}|${item.about}|${item.reason}|${item.edgeId ?? ''}|${item.lawId ?? ''}` === key)) return;
  build.unknownLinks.push({ ...link, targetId: null });
}

function hasUnknown(build: Build, subjectId: string, about: string): boolean {
  return build.unknownLinks.some((link) => link.subjectId === subjectId && link.about === about);
}

function focusIds(build: Build): Set<string> {
  const ids = new Set<string>([build.selectedId, ...build.expanded, ...build.candidates.keys()]);
  return ids;
}

function focusNodes(build: Build): JurisdictionNode[] {
  const nodes: JurisdictionNode[] = [];
  for (const id of focusIds(build)) {
    const node = build.nodes.get(id);
    if (node) nodes.push(node);
  }
  return nodes;
}

function territoryIds(build: Build): string[] {
  const ids: string[] = [];
  for (const draft of build.candidates.values()) {
    if (draft.territory.length > 0) ids.push(draft.id);
  }
  ids.sort((left, right) => left.localeCompare(right));
  return ids;
}

function issuerIdsOf(build: Build): string[] {
  const ids: string[] = [];
  for (const draft of build.candidates.values()) {
    if (draft.issuer.length > 0) ids.push(draft.id);
  }
  return ids;
}

function makeInclusion(
  reason: InclusionReason,
  sentence: string,
  knowledge: 'known' | 'inferred',
  evidence: readonly string[],
  edgeIds: readonly string[],
  lawIds: readonly string[],
): Inclusion {
  const body = sentence.endsWith('.') ? sentence : `${sentence}.`;
  return {
    reason,
    because: `${INCLUSION_PREFIX} ${body} This does not determine what binds conduct here.`,
    knowledge,
    evidence: uniqueTexts(evidence).slice(0, AUTHORITY_LIMITS.maxEvidence),
    edgeIds: [...edgeIds],
    lawIds: [...lawIds],
  };
}

function toCandidate(draft: Draft): AuthorityCandidate {
  return {
    id: draft.id,
    name: draft.name,
    levelKind: draft.levelKind,
    band: draft.band,
    territory: draft.territory.length > 0 ? { distinction: 'territory', inclusions: sortInclusions(draft.territory) } : null,
    issuer: draft.issuer.length > 0 ? { distinction: 'issuer', inclusions: sortInclusions(draft.issuer) } : null,
    applicability: APPLICABILITY,
  };
}

function compareCandidates(left: AuthorityCandidate, right: AuthorityCandidate): number {
  const band = AUTHORITY_BANDS.indexOf(left.band) - AUTHORITY_BANDS.indexOf(right.band);
  if (band !== 0) return band;
  return left.id.localeCompare(right.id);
}

function sortInclusions(list: Inclusion[]): Inclusion[] {
  return [...list].sort((left, right) => {
    const reason = INCLUSION_REASONS.indexOf(left.reason) - INCLUSION_REASONS.indexOf(right.reason);
    if (reason !== 0) return reason;
    const edges = left.edgeIds.join(',').localeCompare(right.edgeIds.join(','));
    if (edges !== 0) return edges;
    const laws = left.lawIds.join(',').localeCompare(right.lawIds.join(','));
    if (laws !== 0) return laws;
    return left.because.localeCompare(right.because);
  });
}

function sortUnknown(links: readonly UnknownLink[]): UnknownLink[] {
  return [...links].sort((left, right) => (
    left.subjectId.localeCompare(right.subjectId)
    || left.about.localeCompare(right.about)
    || left.reason.localeCompare(right.reason)
    || (left.edgeId ?? '').localeCompare(right.edgeId ?? '')
    || (left.lawId ?? '').localeCompare(right.lawId ?? '')
  ));
}

function dedupeOmissions(omissions: readonly Omission[]): Omission[] {
  const seen = new Set<string>();
  const result: Omission[] = [];
  for (const omission of omissions) {
    const key = `${omission.reason}|${omission.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(omission);
  }
  return result.sort((left, right) => left.reason.localeCompare(right.reason) || left.id.localeCompare(right.id));
}

function cloneInclusion(inclusion: Inclusion): Inclusion {
  return {
    ...inclusion,
    evidence: [...inclusion.evidence],
    edgeIds: [...inclusion.edgeIds],
    lawIds: [...inclusion.lawIds],
  };
}

function inclusionKey(inclusion: Inclusion): string {
  return `${inclusion.reason}|${inclusion.because}|${inclusion.edgeIds.join(',')}|${inclusion.lawIds.join(',')}|${inclusion.knowledge}`;
}

function emptyByBand(): Record<AuthorityBand, string[]> {
  return {
    national: [],
    regional: [],
    local: [],
    special: [],
    supranational: [],
    unclassified: [],
  };
}

function labelOf(node: JurisdictionNode | undefined): string {
  if (!node) return 'the recorded node';
  return node.names[0]?.text ?? node.id;
}

function pushEdge(map: Map<string, JurisdictionEdge[]>, key: string, edge: JurisdictionEdge): void {
  const list = map.get(key);
  if (list) list.push(edge);
  else map.set(key, [edge]);
}

function sortEdges(edges: JurisdictionEdge[]): void {
  edges.sort((left, right) => left.id.localeCompare(right.id));
}

function uniqueTexts(values: readonly string[]): string[] {
  const result: string[] = [];
  for (const value of values) {
    const text = value.trim();
    if (!text || result.includes(text)) continue;
    result.push(text);
  }
  return result;
}

function readTokens(
  values: readonly string[] | undefined,
  label: string,
  max?: number,
): { ok: true; values: string[]; truncated: boolean } | { ok: false; detail: string } {
  if (values === undefined || values === null) return { ok: true, values: [], truncated: false };
  if (!Array.isArray(values)) return { ok: false, detail: `${label}s must be an array.` };
  const result: string[] = [];
  let truncated = false;
  for (const value of values) {
    if (typeof value !== 'string' || !value.trim()) return { ok: false, detail: `A ${label} must be a non-empty string.` };
    const token = value.trim();
    if (result.includes(token)) continue;
    if (max !== undefined && result.length >= max) {
      truncated = true;
      break;
    }
    result.push(token);
  }
  return { ok: true, values: result, truncated };
}

function normalizeLaw(
  input: LawScopeInput,
): { ok: true; law: NormalizedLaw } | { ok: false; lawId: string; detail: string } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, lawId: 'law:invalid', detail: 'A law scope record is not an object.' };
  }
  const lawId = clean(input.lawId) || clean(input.sectionId) || clean(input.instrumentId);
  if (!lawId) return { ok: false, lawId: 'law:invalid', detail: 'A law scope record has no law, section, or instrument id.' };
  const scope = input.scope;
  const issuerIds = readIdList(scope?.issuerIds ?? input.issuerIds);
  const territorialIds = readIdList(scope?.territorialIds ?? input.territorialIds);
  const territorialLabels = readIdList(scope?.territorialLabels ?? input.territorialLabels);
  const uncertainty = readIdList(scope?.uncertainty ?? input.uncertainty);
  const evidence = readIdList(input.evidence);
  if (!issuerIds || !territorialIds || !territorialLabels || !uncertainty || !evidence) {
    return { ok: false, lawId, detail: `Law ${lawId} has a scope list that is not an array of strings.` };
  }
  const knowledge = scope?.knowledge ?? input.knowledge ?? 'known';
  if (knowledge !== 'known' && knowledge !== 'inferred' && knowledge !== 'unknown') {
    return { ok: false, lawId, detail: `Law ${lawId} scope knowledge is not known, inferred, or unknown.` };
  }
  return {
    ok: true,
    law: { lawId, issuerIds, territorialIds, territorialLabels, knowledge, uncertainty, evidence },
  };
}

function readIdList(value: readonly string[] | undefined): string[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return null;
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || !item.trim()) return null;
    const token = item.trim();
    if (!result.includes(token)) result.push(token);
  }
  return result;
}

function clean(value: string | undefined): string {
  if (typeof value !== 'string') return '';
  return value.trim();
}

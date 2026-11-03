/**
 * Cross-index rank fusion.
 *
 * Reciprocal rank fusion (k = 60) combines ranks from BM25, citation, vector,
 * and title indexes. Raw provider scores are kept for display and are not
 * added. Each index contributes its best rank once.
 *
 * The same text version collapses to one row. An explicit equivalent-text
 * relation merges mirrors and preserves every provenance. A shared hash alone
 * does not merge. Conflicting versions stay separate, keep their own ranks,
 * and share a version group. Strict filters have already been isolated: a
 * miss is dropped before scoring.
 *
 * Fusion runs only after a stack-selected plan whose ranking is still
 * deferred. Searched and missing source counts come from that plan, including
 * sources that returned no hits.
 */

import { APPLICABILITY } from '../jurisdiction/schema';
import {
  SEARCH_PLAN_SCHEMA,
  hitMatchesStrictFilters,
  type FilterContext,
  type RetrievalKind,
  type SearchPlan,
  type SourceCounts,
  type StrictFilters,
} from './planner';

export const FUSION_SCHEMA = 'worldwide-legal-search.rank-fusion@1';
export const FUSION_K = 60;
export const FUSION_LIMIT_DEFAULT = 20;
export const FUSION_LIMIT_MAX = 100;
export const FUSION_HIT_CAP = 2000;
export const FUSION_NOTE_CAP = 100;

export const FUSION_RULE =
  'Reciprocal rank fusion with k=60. The score is the sum of 1/(k+rank) over indexes that contain the reconciled text. Ranks are 1-based. Each index contributes its best rank once. Raw BM25, vector, title, and citation scores are not added, scaled, or averaged. Strict filters remove candidates before scoring and have no weight. Ties break by fused score, then the number of contributing indexes, then the version key. Input order is not a tie break.';

export const FUSION_LIMITATIONS = [
  FUSION_RULE,
  'Equivalent-text merges require an explicit relation. A shared body hash alone is not a merge.',
  'A conflicting-version relation, or two text versions of one instrument, stays as separate rows and does not share ranks.',
  'A hit whose source or index is outside the planned batches is not ranked.',
  'An unpinned revision, a missing identity, or a missing rank is quarantined. No official citation is invented.',
  'Searched and missing source counts are the plan counts. A missing source adds no hits and remains missing.',
  'knownRecords is the planned denominator. returnedMatches is the fused page. A partial or capped search is not a complete total.',
  'This fusion does not decide that an instrument binds conduct.',
] as const;

const KINDS = new Set<string>(['bm25', 'citation', 'vector', 'title']);
const SEP = '\u001f';

export interface HitRelationInput {
  relation?: unknown;
  sourceId?: unknown;
  sourceRevision?: unknown;
  instrumentId?: unknown;
  textVersionId?: unknown;
  sectionId?: unknown;
  bodySha256?: unknown;
}

export interface RankedHitInput {
  sourceId?: unknown;
  sourceRevision?: unknown;
  instrumentId?: unknown;
  sectionId?: unknown;
  textVersionId?: unknown;
  bodySha256?: unknown;
  contentCid?: unknown;
  title?: unknown;
  language?: unknown;
  instrumentKind?: unknown;
  topics?: unknown;
  status?: unknown;
  authorityIds?: unknown;
  territorialIds?: unknown;
  issuerIds?: unknown;
  bands?: unknown;
  lawId?: unknown;
  publisherId?: unknown;
  officialCitation?: unknown;
  rank?: unknown;
  score?: unknown;
  relations?: unknown;
}

export interface IndexHitList {
  indexId?: unknown;
  sourceId?: unknown;
  sourceRevision?: unknown;
  kind?: unknown;
  shardId?: unknown;
  truncated?: unknown;
  hits?: unknown;
}

export interface FusionOptions {
  limit?: number;
}

export interface FusionIdentity {
  sourceId: string;
  sourceRevision: string;
  instrumentId: string;
  sectionId: string | null;
  textVersionId: string | null;
  bodySha256: string | null;
  contentCid: string | null;
}

export interface FusionMirror {
  sourceId: string;
  sourceRevision: string;
  instrumentId: string;
  sectionId: string | null;
  textVersionId: string | null;
  bodySha256: string | null;
  contentCid: string | null;
}

export interface FusionPart {
  indexId: string;
  kind: RetrievalKind;
  sourceId: string;
  rank: number;
  ignoredRawScore: number | null;
}

export interface FusedHit {
  rank: number;
  score: string;
  identity: FusionIdentity;
  versionKey: string;
  versionGroupId: string;
  versionsInGroup: number;
  otherVersionKeys: string[];
  duplicateCount: number;
  mirrors: FusionMirror[];
  title: string | null;
  language: string | null;
  instrumentKind: string | null;
  status: string | null;
  authorityIds: string[];
  bands: string[];
  includedBecause: string[];
  applicability: typeof APPLICABILITY;
  metadataConflict: boolean;
  titleConflict: boolean;
  explanation: {
    rule: 'reciprocal-rank-fusion';
    k: typeof FUSION_K;
    formula: string;
    parts: FusionPart[];
    rawScoresIgnored: true;
  };
}

export interface FusionNote {
  identity: string;
  sourceId: string | null;
  indexId: string | null;
  reason: string;
}

export interface FusionCounts extends SourceCounts {
  returnedMatches: number;
  fusedBeforeLimit: number;
  filteredOut: number;
  quarantined: number;
  sourcesWithHits: number;
  sourcesSearchedEmpty: number;
  partialSearch: boolean;
}

export interface FusionResult {
  schema: typeof FUSION_SCHEMA;
  status: 'ranked' | 'invalid-plan';
  applicability: typeof APPLICABILITY;
  rule: typeof FUSION_RULE;
  k: typeof FUSION_K;
  rawScoresIgnored: true;
  ranking: 'deferred';
  stackResolvedBeforeRanking: boolean;
  planStatus: string | null;
  stackCandidateIds: string[];
  sourceCounts: { searched: number; missing: number };
  counts: FusionCounts;
  partialReasons: string[];
  hits: FusedHit[];
  filtered: FusionNote[];
  quarantined: FusionNote[];
  limitations: readonly string[];
  truncated: boolean;
}

interface Relation {
  relation: 'equivalent-text' | 'conflicting-version';
  sourceId: string;
  sourceRevision: string;
  instrumentId: string;
  textVersionId: string;
  sectionId: string;
  bodySha256: string;
}

interface Member {
  indexId: string;
  kind: RetrievalKind;
  sourceId: string;
  sourceRevision: string;
  instrumentId: string;
  sectionId: string;
  textVersionId: string;
  bodySha256: string;
  contentCid: string;
  versionKey: string;
  rank: number;
  rawScore: number | null;
  title: string | null;
  language: string | null;
  instrumentKind: string | null;
  topics: string[];
  status: string | null;
  authorityIds: string[];
  territorialIds: string[];
  issuerIds: string[];
  bands: string[];
  lawId: string | null;
  officialCitation: string | null;
  relations: Relation[];
}

interface Group {
  versionKey: string;
  sourceId: string;
  sourceRevision: string;
  instrumentId: string;
  sectionId: string;
  textVersionId: string;
  bodySha256: string;
  members: Member[];
}

interface Fraction {
  n: bigint;
  d: bigint;
}

interface DraftRow {
  score: Fraction;
  scoreText: string;
  versionKey: string;
  instrumentKey: string;
  duplicateCount: number;
  mirrors: FusionMirror[];
  identity: FusionIdentity;
  title: string | null;
  language: string | null;
  instrumentKind: string | null;
  status: string | null;
  authorityIds: string[];
  bands: string[];
  includedBecause: string[];
  metadataConflict: boolean;
  titleConflict: boolean;
  parts: FusionPart[];
  memberVersionKeys: string[];
  conflictKeys: string[];
  versionGroupId: string;
  otherVersionKeys: string[];
  versionsInGroup: number;
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function clean(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).trim();
  return text ? text : null;
}

function unique(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const text = clean(item);
    if (text) out.push(text);
  }
  return unique(out);
}

function gcd(left: bigint, right: bigint): bigint {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b !== 0n) {
    const next = a % b;
    a = b;
    b = next;
  }
  return a === 0n ? 1n : a;
}

function fraction(n: bigint, d: bigint): Fraction {
  const g = gcd(n, d);
  return { n: n / g, d: d / g };
}

function addRank(score: Fraction, rank: number): Fraction {
  const denom = BigInt(FUSION_K + rank);
  return fraction(score.n * denom + score.d, score.d * denom);
}

function compareFraction(left: Fraction, right: Fraction): number {
  const a = left.n * right.d;
  const b = right.n * left.d;
  if (a > b) return 1;
  if (a < b) return -1;
  return 0;
}

function versionKeyOf(member: {
  sourceId: string;
  sourceRevision: string;
  instrumentId: string;
  textVersionId: string;
  sectionId: string;
}): string {
  return [member.sourceId, member.sourceRevision, member.instrumentId, member.textVersionId, member.sectionId].join(SEP);
}

function instrumentKeyOf(sourceId: string, instrumentId: string): string {
  return `${sourceId}${SEP}${instrumentId}`;
}

function emptyCounts(base?: SourceCounts | null): FusionCounts {
  const source = base ?? {
    searchedSources: 0,
    missingSources: 0,
    searchedCollections: 0,
    missingCollections: 0,
    partialSources: 0,
    unknownSources: 0,
    unavailableSources: 0,
    blockedSources: 0,
    excludedSources: 0,
    unpinnedSources: 0,
    unindexedSources: 0,
    filteredSources: 0,
    outOfStackSources: 0,
    rejectedSources: 0,
    stackCandidates: 0,
    stackCandidatesWithoutSource: 0,
    stackCandidatesNotSearched: 0,
    knownRecords: 0,
    knownRecordsComplete: true,
  };
  return {
    ...source,
    returnedMatches: 0,
    fusedBeforeLimit: 0,
    filteredOut: 0,
    quarantined: 0,
    sourcesWithHits: 0,
    sourcesSearchedEmpty: source.searchedSources,
    partialSearch: false,
  };
}

function invalidResult(plan: Partial<SearchPlan> | null, reason: string): FusionResult {
  const counts = emptyCounts(plan?.counts);
  counts.partialSearch = true;
  return {
    schema: FUSION_SCHEMA,
    status: 'invalid-plan',
    applicability: APPLICABILITY,
    rule: FUSION_RULE,
    k: FUSION_K,
    rawScoresIgnored: true,
    ranking: 'deferred',
    stackResolvedBeforeRanking: plan?.stackResolvedBeforeRanking === true,
    planStatus: plan?.status ?? null,
    stackCandidateIds: Array.isArray(plan?.stackCandidateIds) ? [...plan.stackCandidateIds] : [],
    sourceCounts: {
      searched: counts.searchedSources,
      missing: counts.missingSources,
    },
    counts,
    partialReasons: [reason],
    hits: [],
    filtered: [],
    quarantined: [],
    limitations: FUSION_LIMITATIONS,
    truncated: false,
  };
}

function planAccepted(plan: SearchPlan | null | undefined): plan is SearchPlan {
  return Boolean(plan
    && plan.schema === SEARCH_PLAN_SCHEMA
    && plan.status === 'stack-selected'
    && plan.phase === 'stack-selected'
    && plan.ranking === 'deferred'
    && plan.stackResolvedBeforeRanking === true
    && Array.isArray(plan.stackCandidateIds)
    && Array.isArray(plan.batches)
    && plan.strictFilters
    && plan.counts);
}

function readRelation(input: HitRelationInput): Relation | null {
  const relation = clean(input?.relation);
  const sourceId = clean(input?.sourceId);
  const sourceRevision = clean(input?.sourceRevision);
  const instrumentId = clean(input?.instrumentId);
  if ((relation !== 'equivalent-text' && relation !== 'conflicting-version') || !sourceId || !sourceRevision || !instrumentId) {
    return null;
  }
  return {
    relation,
    sourceId,
    sourceRevision,
    instrumentId,
    textVersionId: clean(input.textVersionId) ?? '',
    sectionId: clean(input.sectionId) ?? '',
    bodySha256: clean(input.bodySha256) ?? '',
  };
}

function readRank(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) return null;
  return value;
}

function readRawScore(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value;
}

function blankOrNull(value: string): string | null {
  return value ? value : null;
}

function note(identity: string, sourceId: string | null, indexId: string | null, reason: string): FusionNote {
  return { identity, sourceId, indexId, reason };
}

function sortNotes(notes: FusionNote[]): FusionNote[] {
  return [...notes].sort((left, right) => compareText(left.reason, right.reason)
    || compareText(left.identity, right.identity)
    || compareText(left.sourceId ?? '', right.sourceId ?? '')
    || compareText(left.indexId ?? '', right.indexId ?? ''));
}

function capNotes(notes: FusionNote[]): FusionNote[] {
  return sortNotes(notes).slice(0, FUSION_NOTE_CAP);
}

class UnionFind {
  private parent = new Map<string, string>();

  add(id: string): void {
    if (!this.parent.has(id)) this.parent.set(id, id);
  }

  find(id: string): string {
    let cur = id;
    while (this.parent.get(cur) !== cur) {
      const next = this.parent.get(this.parent.get(cur) ?? cur) ?? cur;
      this.parent.set(cur, next);
      cur = next;
    }
    return cur;
  }

  union(left: string, right: string): void {
    const a = this.find(left);
    const b = this.find(right);
    if (a === b) return;
    if (a < b) this.parent.set(b, a);
    else this.parent.set(a, b);
  }

  component(id: string): string[] {
    const root = this.find(id);
    const ids = [...this.parent.keys()].filter((key) => this.find(key) === root);
    ids.sort(compareText);
    return ids;
  }
}

function crossesConflict(left: string, right: string, groups: Map<string, Group>, conflicts: ReadonlySet<string>, find: (id: string) => string): boolean {
  const leftRoot = find(left);
  const rightRoot = find(right);
  if (leftRoot === rightRoot) return false;
  for (const pair of conflicts) {
    const [a, b] = pair.split('\u0000');
    if (!a || !b || !groups.has(a) || !groups.has(b)) continue;
    const aRoot = find(a);
    const bRoot = find(b);
    const crosses = (aRoot === leftRoot && bRoot === rightRoot) || (aRoot === rightRoot && bRoot === leftRoot);
    if (crosses) return true;
  }
  return false;
}

function metadataOf(members: readonly Member[]): {
  status: string | null;
  language: string | null;
  instrumentKind: string | null;
  metadataConflict: boolean;
  title: string | null;
  titleConflict: boolean;
} {
  const statuses = unique(members.map((member) => member.status ?? '').filter((item) => item));
  const languages = unique(members.map((member) => (member.language ?? '').toLowerCase()).filter((item) => item));
  const kinds = unique(members.map((member) => (member.instrumentKind ?? '').toLowerCase()).filter((item) => item));
  const titles = unique(members.map((member) => member.title ?? '').filter((item) => item));
  const primary = [...members].sort((left, right) => compareText(left.versionKey, right.versionKey)
    || compareText(left.indexId, right.indexId)
    || left.rank - right.rank)[0];
  return {
    status: statuses.length === 1 ? statuses[0] : null,
    language: languages.length === 1 ? languages[0] : null,
    instrumentKind: kinds.length === 1 ? kinds[0] : null,
    metadataConflict: statuses.length > 1 || languages.length > 1 || kinds.length > 1,
    title: primary?.title ?? null,
    titleConflict: titles.length > 1,
  };
}

function fuseMembers(members: readonly Member[], plan: SearchPlan): DraftRow {
  const primary = [...members].sort((left, right) => compareText(left.versionKey, right.versionKey)
    || compareText(left.indexId, right.indexId)
    || left.rank - right.rank)[0];
  const byIndex = new Map<string, Member>();
  for (const member of members) {
    const current = byIndex.get(member.indexId);
    if (!current || member.rank < current.rank) byIndex.set(member.indexId, member);
  }
  const parts: FusionPart[] = [...byIndex.values()]
    .sort((left, right) => compareText(left.indexId, right.indexId) || compareText(left.sourceId, right.sourceId))
    .map((member) => ({
      indexId: member.indexId,
      kind: member.kind,
      sourceId: member.sourceId,
      rank: member.rank,
      ignoredRawScore: member.rawScore,
    }));
  let score = fraction(0n, 1n);
  for (const part of parts) score = addRank(score, part.rank);
  const meta = metadataOf(members);
  const authorityIds = unique(members.flatMap((member) => member.authorityIds));
  const order = new Map(plan.stackCandidateIds.map((id, index) => [id, index]));
  authorityIds.sort((left, right) => (order.get(left) ?? Number.MAX_SAFE_INTEGER) - (order.get(right) ?? Number.MAX_SAFE_INTEGER)
    || compareText(left, right));
  const bands = unique(members.flatMap((member) => member.bands.map((band) => band.toLowerCase()))).sort(compareText);
  const included: string[] = [];
  const seenLines = new Set<string>();
  for (const id of authorityIds) {
    for (const line of plan.inclusionByCandidateId[id] ?? []) {
      if (seenLines.has(line)) continue;
      seenLines.add(line);
      included.push(line);
    }
  }
  const mirrorKeys = unique(members.map((member) => member.versionKey)).filter((key) => key !== primary.versionKey);
  const mirrors: FusionMirror[] = mirrorKeys.map((key) => {
    const member = members.find((item) => item.versionKey === key) as Member;
    return {
      sourceId: member.sourceId,
      sourceRevision: member.sourceRevision,
      instrumentId: member.instrumentId,
      sectionId: blankOrNull(member.sectionId),
      textVersionId: blankOrNull(member.textVersionId),
      bodySha256: blankOrNull(member.bodySha256),
      contentCid: blankOrNull(member.contentCid),
    };
  });
  return {
    score,
    scoreText: `${score.n.toString()}/${score.d.toString()}`,
    versionKey: primary.versionKey,
    instrumentKey: instrumentKeyOf(primary.sourceId, primary.instrumentId),
    duplicateCount: members.length,
    mirrors,
    identity: {
      sourceId: primary.sourceId,
      sourceRevision: primary.sourceRevision,
      instrumentId: primary.instrumentId,
      sectionId: blankOrNull(primary.sectionId),
      textVersionId: blankOrNull(primary.textVersionId),
      bodySha256: blankOrNull(primary.bodySha256),
      contentCid: blankOrNull(primary.contentCid),
    },
    title: meta.title,
    language: meta.language,
    instrumentKind: meta.instrumentKind,
    status: meta.status,
    authorityIds,
    bands,
    includedBecause: included,
    metadataConflict: meta.metadataConflict,
    titleConflict: meta.titleConflict,
    parts,
    memberVersionKeys: unique(members.map((member) => member.versionKey)),
    conflictKeys: [],
    versionGroupId: instrumentKeyOf(primary.sourceId, primary.instrumentId),
    otherVersionKeys: [],
    versionsInGroup: 1,
  };
}

function partialReasonsFor(plan: SearchPlan, listTruncated: boolean, fusionTruncated: boolean): string[] {
  const reasons: string[] = [];
  if (plan.counts.partialSources > 0) reasons.push('partial-source');
  if (plan.counts.missingSources > 0) reasons.push('missing-source');
  if (plan.counts.unknownSources > 0) reasons.push('unknown-source');
  if (plan.counts.unavailableSources > 0) reasons.push('unavailable-source');
  if (plan.counts.stackCandidatesWithoutSource > 0) reasons.push('stack-candidate-without-source');
  if (plan.counts.stackCandidatesNotSearched > 0) reasons.push('stack-candidate-not-searched');
  if (!plan.counts.knownRecordsComplete) reasons.push('known-records-incomplete');
  if (plan.truncated || plan.stack?.truncated) reasons.push('plan-truncated');
  if (listTruncated) reasons.push('index-truncated');
  if (fusionTruncated) reasons.push('fusion-truncated');
  return reasons;
}

/**
 * Fuse planned index lists. The same multiset of index id, identity, and rank
 * always produces the same page.
 */
export function fuseCrossIndexResults(
  plan: SearchPlan | null | undefined,
  lists: readonly IndexHitList[] | null | undefined,
  options: FusionOptions = {},
): FusionResult {
  if (!planAccepted(plan)) return invalidResult(plan ?? null, 'ranking-before-stack');
  if (!Array.isArray(lists)) return invalidResult(plan, 'index-lists-must-be-an-array');
  const requested = options.limit === undefined ? FUSION_LIMIT_DEFAULT : options.limit;
  if (typeof requested !== 'number' || !Number.isSafeInteger(requested) || requested < 1 || requested > FUSION_LIMIT_MAX) {
    return invalidResult(plan, 'invalid-limit');
  }

  const filters: StrictFilters = plan.strictFilters;
  const context: FilterContext = {
    bandByAuthorityId: new Map(plan.candidateBands.map((row) => [row.id, row.band])),
    temporalByLawId: new Map(plan.temporalLaws.map((law) => [law.lawId, law])),
  };
  const allowed = new Set<string>();
  const revisions = new Map<string, string>();
  for (const batch of plan.batches) {
    for (const request of batch.requests) {
      allowed.add([request.sourceId, request.indexId, request.kind, request.shardId].join(SEP));
      allowed.add([request.sourceId, request.indexId, request.kind].join(SEP));
      revisions.set(request.sourceId, request.sourceRevision);
    }
  }
  const searched = new Set(plan.searchedSourceIds);
  const filtered: FusionNote[] = [];
  const quarantined: FusionNote[] = [];
  const members: Member[] = [];
  let listTruncated = false;
  let hitCap = false;

  lists.forEach((list, listIndex) => {
    const indexId = clean(list?.indexId) ?? '';
    const sourceId = clean(list?.sourceId) ?? '';
    const sourceRevision = clean(list?.sourceRevision) ?? '';
    const kind = clean(list?.kind) ?? '';
    const shardId = clean(list?.shardId) ?? '';
    const listIdentity = indexId || `list#${listIndex}`;
    if (list?.truncated === true) listTruncated = true;
    const fail = (reason: string): void => {
      const hits = Array.isArray(list?.hits) ? list.hits : [];
      if (hits.length === 0) {
        quarantined.push(note(listIdentity, sourceId || null, indexId || null, reason));
        return;
      }
      hits.forEach((hit) => {
        const record = hit as RankedHitInput;
        const instrumentId = clean(record?.instrumentId) ?? '';
        const sectionId = clean(record?.sectionId) ?? '';
        quarantined.push(note(instrumentId || sectionId || `missing:${sourceId}:${indexId || listIdentity}`, sourceId || null, indexId || null, reason));
      });
    };
    if (!indexId || !sourceId || !KINDS.has(kind)) {
      fail('index-not-in-plan');
      return;
    }
    if (!searched.has(sourceId)) {
      fail('source-not-searched');
      return;
    }
    if (revisions.get(sourceId) !== sourceRevision) {
      fail('revision-mismatch');
      return;
    }
    const key = shardId
      ? [sourceId, indexId, kind, shardId].join(SEP)
      : [sourceId, indexId, kind].join(SEP);
    if (!allowed.has(key)) {
      fail('index-not-in-plan');
      return;
    }
    const hits = Array.isArray(list.hits) ? list.hits as RankedHitInput[] : [];
    hits.forEach((hit, hitIndex) => {
      if (members.length >= FUSION_HIT_CAP) {
        hitCap = true;
        quarantined.push(note(clean(hit?.instrumentId) ?? `${indexId}#${hitIndex}`, sourceId, indexId, 'hit-limit'));
        return;
      }
      const hitSource = clean(hit?.sourceId) ?? sourceId;
      const hitRevision = clean(hit?.sourceRevision) ?? sourceRevision;
      const instrumentId = clean(hit?.instrumentId) ?? '';
      const sectionId = clean(hit?.sectionId) ?? '';
      const identity = instrumentId || sectionId || `missing:${sourceId}:${indexId}`;
      if (hitSource !== sourceId) {
        quarantined.push(note(identity, hitSource, indexId, 'source-not-searched'));
        return;
      }
      if (hitRevision !== sourceRevision) {
        quarantined.push(note(identity, sourceId, indexId, 'unpinned-revision'));
        return;
      }
      if (!instrumentId && !sectionId) {
        quarantined.push(note(identity, sourceId, indexId, 'missing-identity'));
        return;
      }
      const rank = readRank(hit?.rank);
      if (hit?.rank === undefined || hit?.rank === null) {
        quarantined.push(note(identity, sourceId, indexId, 'missing-rank'));
        return;
      }
      if (rank === null) {
        quarantined.push(note(identity, sourceId, indexId, 'invalid-rank'));
        return;
      }
      const prepared: Member = {
        indexId,
        kind: kind as RetrievalKind,
        sourceId,
        sourceRevision,
        instrumentId: instrumentId || sectionId,
        sectionId,
        textVersionId: clean(hit?.textVersionId) ?? '',
        bodySha256: clean(hit?.bodySha256) ?? '',
        contentCid: clean(hit?.contentCid) ?? '',
        versionKey: '',
        rank,
        rawScore: readRawScore(hit?.score),
        title: clean(hit?.title),
        language: clean(hit?.language),
        instrumentKind: clean(hit?.instrumentKind)?.toLowerCase() ?? null,
        topics: stringList(hit?.topics).map((topic) => topic.toLowerCase()),
        status: clean(hit?.status)?.toLowerCase() ?? null,
        authorityIds: stringList(hit?.authorityIds),
        territorialIds: stringList(hit?.territorialIds),
        issuerIds: stringList(hit?.issuerIds),
        bands: stringList(hit?.bands).map((band) => band.toLowerCase()),
        lawId: clean(hit?.lawId),
        officialCitation: clean(hit?.officialCitation),
        relations: [],
      };
      prepared.versionKey = versionKeyOf(prepared);
      if (Array.isArray(hit?.relations)) {
        for (const relation of hit.relations as HitRelationInput[]) {
          const parsed = readRelation(relation);
          if (parsed) prepared.relations.push(parsed);
        }
      }
      const match = hitMatchesStrictFilters({
        sourceId: prepared.sourceId,
        authorityIds: prepared.authorityIds,
        territorialIds: prepared.territorialIds,
        issuerIds: prepared.issuerIds,
        bands: prepared.bands,
        topics: prepared.topics,
        instrumentKind: prepared.instrumentKind,
        language: prepared.language,
        status: prepared.status,
        lawId: prepared.lawId,
      }, filters, context);
      if (!match.ok) {
        filtered.push(note(prepared.versionKey, sourceId, indexId, match.reason));
        return;
      }
      members.push(prepared);
    });
  });

  const groups = new Map<string, Group>();
  const grouped = new Map<string, Member[]>();
  for (const member of members) {
    const list = grouped.get(member.versionKey) ?? [];
    list.push(member);
    grouped.set(member.versionKey, list);
  }
  for (const [key, groupMembers] of grouped) {
    const hashes = unique(groupMembers.map((member) => member.bodySha256).filter((hash) => hash));
    if (hashes.length > 1) {
      for (const member of groupMembers) {
        quarantined.push(note(member.versionKey, member.sourceId, member.indexId, 'conflicting-body'));
      }
      continue;
    }
    const first = groupMembers[0];
    groups.set(key, {
      versionKey: key,
      sourceId: first.sourceId,
      sourceRevision: first.sourceRevision,
      instrumentId: first.instrumentId,
      sectionId: first.sectionId,
      textVersionId: first.textVersionId,
      bodySha256: hashes[0] ?? '',
      members: groupMembers,
    });
  }

  const byInstrument = new Map<string, Group[]>();
  for (const group of groups.values()) {
    const key = instrumentKeyOf(group.sourceId, group.instrumentId);
    const list = byInstrument.get(key) ?? [];
    list.push(group);
    byInstrument.set(key, list);
  }
  const equivalent: Array<[string, string]> = [];
  const conflicts = new Set<string>();
  const pairKey = (left: string, right: string): string => (left < right ? `${left}\u0000${right}` : `${right}\u0000${left}`);
  for (const group of groups.values()) {
    for (const member of group.members) {
      for (const relation of member.relations) {
        const candidates = (byInstrument.get(instrumentKeyOf(relation.sourceId, relation.instrumentId)) ?? []).filter((target) => {
          if (target.versionKey === group.versionKey && relation.sourceId === group.sourceId) return false;
          if (relation.textVersionId && target.textVersionId !== relation.textVersionId) return false;
          if (relation.sectionId && target.sectionId !== relation.sectionId) return false;
          if (relation.bodySha256 && target.bodySha256 && target.bodySha256 !== relation.bodySha256) return false;
          if (relation.sourceRevision !== target.sourceRevision) return false;
          return true;
        });
        const narrowed = relation.textVersionId ? candidates : candidates.length === 1 ? candidates : [];
        if (narrowed.length !== 1) continue;
        const target = narrowed[0];
        if (target.versionKey === group.versionKey) continue;
        if (relation.relation === 'conflicting-version') conflicts.add(pairKey(group.versionKey, target.versionKey));
        else equivalent.push([group.versionKey, target.versionKey]);
      }
    }
  }

  const unions = new UnionFind();
  for (const key of groups.keys()) unions.add(key);
  for (const [left, right] of equivalent) {
    if (conflicts.has(pairKey(left, right))) continue;
    if (crossesConflict(left, right, groups, conflicts, (id) => unions.find(id))) continue;
    unions.union(left, right);
  }

  const components = new Map<string, string[]>();
  for (const key of groups.keys()) {
    const root = unions.find(key);
    const list = components.get(root) ?? [];
    list.push(key);
    components.set(root, list);
  }
  const drafts: DraftRow[] = [];
  for (const keys of components.values()) {
    const componentMembers = keys.flatMap((key) => groups.get(key)?.members ?? []);
    const draft = fuseMembers(componentMembers, plan);
    const conflictTargets: string[] = [];
    for (const key of keys) {
      for (const pair of conflicts) {
        const [left, right] = pair.split('\u0000');
        if (left === key) conflictTargets.push(right);
        else if (right === key) conflictTargets.push(left);
      }
    }
    draft.conflictKeys = unique(conflictTargets);
    drafts.push(draft);
  }

  const rowUnions = new UnionFind();
  drafts.forEach((draft, index) => rowUnions.add(String(index)));
  const instrumentBuckets = new Map<string, number[]>();
  drafts.forEach((draft, index) => {
    const bucket = instrumentBuckets.get(draft.instrumentKey) ?? [];
    bucket.push(index);
    instrumentBuckets.set(draft.instrumentKey, bucket);
  });
  for (const bucket of instrumentBuckets.values()) {
    for (let index = 1; index < bucket.length; index += 1) rowUnions.union(String(bucket[0]), String(index));
  }
  const keyToRow = new Map<string, number>();
  drafts.forEach((draft, index) => {
    for (const key of draft.memberVersionKeys) keyToRow.set(key, index);
  });
  drafts.forEach((draft, index) => {
    for (const key of draft.conflictKeys) {
      const other = keyToRow.get(key);
      if (other !== undefined && other !== index) rowUnions.union(String(index), String(other));
    }
  });
  const versionComponents = new Map<string, number[]>();
  drafts.forEach((_draft, index) => {
    const root = rowUnions.find(String(index));
    const list = versionComponents.get(root) ?? [];
    list.push(index);
    versionComponents.set(root, list);
  });
  for (const indexes of versionComponents.values()) {
    const instrumentKeys = unique(indexes.map((index) => drafts[index].instrumentKey)).sort(compareText);
    const groupId = instrumentKeys.length === 1 ? instrumentKeys[0] : `versions:${instrumentKeys[0]}`;
    const versionKeys = indexes.map((index) => drafts[index].versionKey).sort(compareText);
    for (const index of indexes) {
      drafts[index].versionGroupId = groupId;
      drafts[index].otherVersionKeys = versionKeys.filter((key) => key !== drafts[index].versionKey);
      drafts[index].versionsInGroup = versionKeys.length;
    }
  }

  drafts.sort((left, right) => compareFraction(right.score, left.score)
    || right.parts.length - left.parts.length
    || compareText(left.versionKey, right.versionKey));
  const fusionTruncated = drafts.length > requested || hitCap;
  const page = drafts.slice(0, requested);
  const hits: FusedHit[] = page.map((draft, index) => ({
    rank: index + 1,
    score: draft.scoreText,
    identity: draft.identity,
    versionKey: draft.versionKey,
    versionGroupId: draft.versionGroupId,
    versionsInGroup: draft.versionsInGroup,
    otherVersionKeys: draft.otherVersionKeys,
    duplicateCount: draft.duplicateCount,
    mirrors: draft.mirrors,
    title: draft.title,
    language: draft.language,
    instrumentKind: draft.instrumentKind,
    status: draft.status,
    authorityIds: draft.authorityIds,
    bands: draft.bands,
    includedBecause: draft.includedBecause,
    applicability: APPLICABILITY,
    metadataConflict: draft.metadataConflict,
    titleConflict: draft.titleConflict,
    explanation: {
      rule: 'reciprocal-rank-fusion',
      k: FUSION_K,
      formula: `sum 1/(${FUSION_K}+rank)`,
      parts: draft.parts,
      rawScoresIgnored: true,
    },
  }));

  const sourcesWithHits = new Set(drafts.flatMap((draft) => draft.parts.map((part) => part.sourceId)));
  const reasons = partialReasonsFor(plan, listTruncated, fusionTruncated);
  const counts = emptyCounts(plan.counts);
  counts.returnedMatches = hits.length;
  counts.fusedBeforeLimit = drafts.length;
  counts.filteredOut = filtered.length;
  counts.quarantined = quarantined.length;
  counts.sourcesWithHits = sourcesWithHits.size;
  counts.sourcesSearchedEmpty = Math.max(0, plan.counts.searchedSources - sourcesWithHits.size);
  counts.partialSearch = reasons.length > 0;
  return {
    schema: FUSION_SCHEMA,
    status: 'ranked',
    applicability: APPLICABILITY,
    rule: FUSION_RULE,
    k: FUSION_K,
    rawScoresIgnored: true,
    ranking: 'deferred',
    stackResolvedBeforeRanking: true,
    planStatus: plan.status,
    stackCandidateIds: [...plan.stackCandidateIds],
    sourceCounts: {
      searched: plan.counts.searchedSources,
      missing: plan.counts.missingSources,
    },
    counts,
    partialReasons: reasons,
    hits,
    filtered: capNotes(filtered),
    quarantined: capNotes(quarantined),
    limitations: FUSION_LIMITATIONS,
    truncated: fusionTruncated || listTruncated || plan.truncated,
  };
}

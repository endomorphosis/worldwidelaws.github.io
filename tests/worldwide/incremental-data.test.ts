import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { canonicalJson, sha256HexUtf8 } from '../../src/lib/worldwide/data/identity';
import {
  ARTIFACT_SCHEMA,
  CURRENT_SCHEMA,
  MANIFEST_SCHEMA,
  QUARANTINE_SCHEMA,
  SCHEMA_VERSION,
  UPDATE_SCHEMA,
  applyIncrementalUpdate,
  listQuarantine,
  readCurrent,
  readSnapshot,
  type ApplyOptions,
  type PublishedSource,
  type UpdateOperation,
  type UpdateResult,
} from '../../scripts/worldwide/update';

const AS_OF = '2026-11-03T00:00:00.000Z';
const AS_OF_LATER = '2026-11-03T01:00:00.000Z';
const REV_1 = 'a'.repeat(40);
const REV_2 = 'b'.repeat(40);
const REV_3 = 'c'.repeat(40);
const ALPHA = 'endomorphosis/ipfs_alpha_laws';
const BETA = 'endomorphosis/ipfs_beta_laws';
const GAMMA = 'justicedao/ipfs_gamma_laws';
const PUBLISHER = 'publisher:example';

function record(id: string, text: string, extra: Record<string, unknown> = {}) {
  return { id, title: `Title ${id}`, text, ...extra };
}

function artifact(fields: {
  sourceId?: string;
  publisherId?: string;
  sourceRevision?: string;
  records?: Array<Record<string, unknown>>;
  schema?: unknown;
  schemaVersion?: unknown;
  payloadSha256?: unknown;
  extra?: Record<string, unknown>;
} = {}) {
  const records = fields.records ?? [record('law-1', 'The whole act.')];
  const body: Record<string, unknown> = {
    schema: fields.schema ?? ARTIFACT_SCHEMA,
    schemaVersion: fields.schemaVersion ?? SCHEMA_VERSION,
    sourceId: fields.sourceId ?? ALPHA,
    publisherId: fields.publisherId ?? PUBLISHER,
    sourceRevision: fields.sourceRevision ?? REV_1,
    ...(fields.extra ?? {}),
    records,
    payloadSha256: fields.payloadSha256 === undefined ? sha256HexUtf8(canonicalJson(records)) : fields.payloadSha256,
  };
  return body;
}

function upsert(body: Record<string, unknown>): UpdateOperation {
  return { op: 'upsert', artifact: body };
}

async function apply(
  store: string,
  operations: UpdateOperation[],
  asOf = AS_OF,
  options?: ApplyOptions,
): Promise<UpdateResult> {
  return applyIncrementalUpdate(store, { asOf, operations }, options);
}

function source(view: { sources: PublishedSource[] }, sourceId: string): PublishedSource {
  const found = view.sources.find((item) => item.sourceId === sourceId);
  if (!found) throw new Error(`missing source ${sourceId}`);
  return found;
}

function fileBytes(store: string, relative: string): Buffer {
  return readFileSync(path.join(store, relative));
}

function temporaryNames(store: string): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (name.includes('.tmp') || name === '.update.lock' || name === 'staging') found.push(path.relative(store, full));
      if (statSync(full).isDirectory()) walk(full);
    }
  };
  if (existsSync(store)) walk(store);
  return found;
}

function treeText(store: string): string {
  const chunks: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else chunks.push(readFileSync(full).toString('utf8'));
    }
  };
  walk(store);
  return chunks.join('\n');
}

describe('incremental ingestion under schema drift', () => {
  let store = '';

  beforeEach(() => {
    store = mkdtempSync(path.join(tmpdir(), 'wwl-incremental-'));
  });

  afterEach(() => {
    rmSync(store, { recursive: true, force: true });
  });

  test('publishes the first pinned revision as the current snapshot', async () => {
    const result = await apply(store, [upsert(artifact({ records: [record('law-1', 'REV1-TEXT', { note: 'kept' })] }))]);

    expect(result.schema).toBe(UPDATE_SCHEMA);
    expect(result.changed).toBe(true);
    expect(result.previousSnapshotId).toBeNull();
    expect(result.snapshotId).toMatch(/^[0-9a-f]{64}$/);
    expect(result.manifestSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.quarantined).toEqual([]);

    const current = await readCurrent(store);
    expect(current.schema).toBe(CURRENT_SCHEMA);
    expect(current.snapshotId).toBe(result.snapshotId);
    expect(current.manifestSha256).toBe(result.manifestSha256);
    expect(current.manifest?.schema).toBe(MANIFEST_SCHEMA);
    expect(current.manifest?.parentSnapshotId).toBeNull();
    expect(current.manifest?.integrity.sha256).toBe(result.manifestSha256);
    const alpha = source(current, ALPHA);
    expect(alpha.sourceRevision).toBe(REV_1);
    expect(alpha.artifact).toBe(`artifacts/${alpha.payloadSha256}.json`);
    expect(alpha.records).toEqual([record('law-1', 'REV1-TEXT', { note: 'kept' })]);
    expect(fileBytes(store, alpha.artifact).toString('utf8')).toContain('REV1-TEXT');
    expect(temporaryNames(store)).toEqual([]);
  });

  test('a changed source revision updates the manifest atomically and leaves the old snapshot readable', async () => {
    const first = await apply(store, [
      upsert(artifact({ sourceId: ALPHA, sourceRevision: REV_1, records: [record('law-1', 'ALPHA-REV1')] })),
      upsert(artifact({ sourceId: BETA, sourceRevision: REV_1, records: [record('law-b', 'BETA-REV1')] })),
    ]);
    const firstManifest = fileBytes(store, path.join('snapshots', first.snapshotId as string, 'manifest.json'));
    const firstPointer = fileBytes(store, 'current.json');
    const firstView = await readSnapshot(store, first.snapshotId as string);
    const alphaArtifact = fileBytes(store, source(firstView, ALPHA).artifact);
    let pointerDuring: string | null = null;
    let nextManifestDuring = '';

    const second = await apply(store, [
      upsert(artifact({ sourceId: ALPHA, sourceRevision: REV_2, records: [record('law-1', 'ALPHA-REV2')] })),
    ], AS_OF_LATER, {
      beforeCurrentPublish(state) {
        pointerDuring = readFileSync(path.join(store, 'current.json'), 'utf8');
        nextManifestDuring = readFileSync(path.join(store, 'snapshots', state.nextSnapshotId, 'manifest.json'), 'utf8');
        expect(state.previousSnapshotId).toBe(first.snapshotId);
        expect(state.nextSnapshotId).not.toBe(first.snapshotId);
      },
    });

    expect(pointerDuring).toBe(firstPointer.toString('utf8'));
    expect(JSON.parse(nextManifestDuring).sources.map((item: { sourceId: string; sourceRevision: string }) => [item.sourceId, item.sourceRevision])).toEqual([
      [ALPHA, REV_2],
      [BETA, REV_1],
    ]);
    expect(second.changed).toBe(true);
    expect(second.previousSnapshotId).toBe(first.snapshotId);
    expect(fileBytes(store, path.join('snapshots', first.snapshotId as string, 'manifest.json')).equals(firstManifest)).toBe(true);
    expect(fileBytes(store, source(firstView, ALPHA).artifact).equals(alphaArtifact)).toBe(true);

    const current = await readCurrent(store);
    expect(current.snapshotId).toBe(second.snapshotId);
    expect(source(current, ALPHA).sourceRevision).toBe(REV_2);
    expect(source(current, ALPHA).records[0].text).toBe('ALPHA-REV2');
    expect(source(current, BETA).records[0].text).toBe('BETA-REV1');
    expect(current.manifest?.parentSnapshotId).toBe(first.snapshotId);

    const reread = await readSnapshot(store, first.snapshotId as string);
    expect(source(reread, ALPHA).sourceRevision).toBe(REV_1);
    expect(source(reread, ALPHA).records[0].text).toBe('ALPHA-REV1');
    expect(source(reread, BETA).records[0].text).toBe('BETA-REV1');
    expect(temporaryNames(store)).toEqual([]);
  });

  test('a removed source revision leaves the manifest and keeps the old snapshot readable', async () => {
    const first = await apply(store, [
      upsert(artifact({ sourceId: ALPHA, sourceRevision: REV_1, records: [record('law-1', 'ALPHA-REV1')] })),
      upsert(artifact({ sourceId: BETA, sourceRevision: REV_1, records: [record('law-b', 'BETA-REV1')] })),
    ]);
    const beta = source(await readSnapshot(store, first.snapshotId as string), BETA);
    const betaBytes = fileBytes(store, beta.artifact);

    const removed = await apply(store, [
      { op: 'remove', sourceId: BETA, sourceRevision: REV_1 },
    ], AS_OF_LATER);

    expect(removed.changed).toBe(true);
    expect(removed.applied).toEqual([
      { op: 'remove', sourceId: BETA, sourceRevision: REV_1, payloadSha256: beta.payloadSha256 },
    ]);
    const current = await readCurrent(store);
    expect(current.sources.map((item) => item.sourceId)).toEqual([ALPHA]);
    expect(existsSync(path.join(store, beta.artifact))).toBe(true);
    expect(fileBytes(store, beta.artifact).equals(betaBytes)).toBe(true);
    const old = await readSnapshot(store, first.snapshotId as string);
    expect(source(old, BETA).records[0].text).toBe('BETA-REV1');
    expect(source(old, ALPHA).records[0].text).toBe('ALPHA-REV1');
  });

  test('quarantines incompatible schemas and corrupt artifacts without changing current records', async () => {
    const first = await apply(store, [
      upsert(artifact({ sourceId: ALPHA, sourceRevision: REV_1, records: [record('law-1', 'ALPHA-REV1')] })),
      upsert(artifact({ sourceId: GAMMA, sourceRevision: REV_1, records: [record('law-g', 'GAMMA-REV1', { note: 'stable' })] })),
    ]);
    const before = fileBytes(store, 'current.json');
    const poisonSchema = 'POISON-TOKEN-schema-v2';
    const poisonDrift = 'POISON-TOKEN-drift';
    const poisonCorrupt = 'POISON-TOKEN-corrupt';
    const poisonHash = 'POISON-TOKEN-hash';
    const driftedRecords = [{ id: 'law-x', title: 'Drifted', body: poisonDrift }];
    const hashRecords = [record('law-h', poisonHash)];

    const result = await apply(store, [
      upsert(artifact({
        sourceId: BETA,
        sourceRevision: REV_2,
        schemaVersion: 2,
        records: [record('law-p', poisonSchema)],
      })),
      upsert(artifact({
        sourceId: BETA,
        sourceRevision: REV_2,
        schema: 'worldwide-legal-search.ingestion-artifact@2',
        records: [record('law-p', poisonSchema)],
      })),
      upsert(artifact({
        sourceId: ALPHA,
        sourceRevision: REV_2,
        records: driftedRecords,
        payloadSha256: sha256HexUtf8(canonicalJson(driftedRecords)),
      })),
      { op: 'upsert', raw: `{"schema":"${ARTIFACT_SCHEMA}","text":"${poisonCorrupt}"` },
      upsert(artifact({
        sourceId: BETA,
        sourceRevision: REV_3,
        records: hashRecords,
        payloadSha256: 'd'.repeat(64),
      })),
      { op: 'upsert-file', path: path.join(store, 'missing-artifact.json') },
    ], AS_OF_LATER);

    expect(result.changed).toBe(false);
    expect(result.snapshotId).toBe(first.snapshotId);
    expect(result.applied).toEqual([]);
    expect(result.quarantined.map((item) => item.reason)).toEqual([
      'incompatible-schema',
      'incompatible-schema',
      'incompatible-schema',
      'corrupt-artifact',
      'corrupt-artifact',
      'corrupt-artifact',
    ]);
    expect(result.quarantined.every((item) => item.poisonedCurrent === false && item.schema === QUARANTINE_SCHEMA)).toBe(true);
    expect(fileBytes(store, 'current.json').equals(before)).toBe(true);
    const current = await readCurrent(store);
    expect(source(current, ALPHA).records[0].text).toBe('ALPHA-REV1');
    expect(source(current, GAMMA).records).toEqual([record('law-g', 'GAMMA-REV1', { note: 'stable' })]);
    expect(current.sources.map((item) => item.sourceId)).toEqual([ALPHA, GAMMA]);
    expect(treeText(store).includes(poisonSchema)).toBe(false);
    expect(treeText(store).includes(poisonDrift)).toBe(false);
    expect(treeText(store).includes(poisonCorrupt)).toBe(false);
    expect(treeText(store).includes(poisonHash)).toBe(false);
    const stored = await listQuarantine(store);
    expect(stored).toHaveLength(result.quarantined.length);
    expect(stored.every((item) => item.poisonedCurrent === false)).toBe(true);
  });

  test('publishes accepted changes and removals together while quarantining the bad artifacts in that batch', async () => {
    const first = await apply(store, [
      upsert(artifact({ sourceId: ALPHA, sourceRevision: REV_1, records: [record('law-1', 'ALPHA-REV1')] })),
      upsert(artifact({ sourceId: BETA, sourceRevision: REV_1, records: [record('law-b', 'BETA-REV1')] })),
      upsert(artifact({ sourceId: GAMMA, sourceRevision: REV_1, records: [record('law-g', 'GAMMA-REV1')] })),
    ]);
    const oldManifest = fileBytes(store, path.join('snapshots', first.snapshotId as string, 'manifest.json'));
    const gammaArtifact = source(await readCurrent(store), GAMMA).artifact;
    const gammaBytes = fileBytes(store, gammaArtifact);
    const poison = 'POISON-TOKEN-mixed';

    const mixed = await apply(store, [
      upsert(artifact({ sourceId: ALPHA, sourceRevision: REV_2, records: [record('law-1', 'ALPHA-REV2')] })),
      { op: 'remove', sourceId: BETA, sourceRevision: REV_1 },
      upsert(artifact({
        sourceId: 'endomorphosis/ipfs_poison_laws',
        sourceRevision: REV_2,
        schemaVersion: 9,
        records: [record('law-p', poison)],
      })),
      { op: 'upsert', raw: '{"not":' },
      upsert(artifact({ sourceId: GAMMA, sourceRevision: REV_1, records: [record('law-g', 'GAMMA-REV1')] })),
    ], AS_OF_LATER);

    expect(mixed.changed).toBe(true);
    expect(mixed.previousSnapshotId).toBe(first.snapshotId);
    expect(mixed.applied.map((item) => [item.op, item.sourceId, item.sourceRevision])).toEqual([
      ['upsert', ALPHA, REV_2],
      ['remove', BETA, REV_1],
    ]);
    expect(mixed.skipped.map((item) => item.reason)).toEqual(['already-current']);
    expect(mixed.quarantined.map((item) => item.reason)).toEqual(['incompatible-schema', 'corrupt-artifact']);
    const current = await readCurrent(store);
    expect(current.sources.map((item) => [item.sourceId, item.sourceRevision])).toEqual([
      [ALPHA, REV_2],
      [GAMMA, REV_1],
    ]);
    expect(source(current, ALPHA).records[0].text).toBe('ALPHA-REV2');
    expect(source(current, GAMMA).artifact).toBe(gammaArtifact);
    expect(fileBytes(store, gammaArtifact).equals(gammaBytes)).toBe(true);
    expect(fileBytes(store, path.join('snapshots', first.snapshotId as string, 'manifest.json')).equals(oldManifest)).toBe(true);
    expect(source(await readSnapshot(store, first.snapshotId as string), BETA).records[0].text).toBe('BETA-REV1');
    expect(treeText(store).includes(poison)).toBe(false);
    expect(current.manifest?.parentSnapshotId).toBe(first.snapshotId);
  });

  test('a failed pointer swap does not publish the next snapshot, and the retry does', async () => {
    const first = await apply(store, [
      upsert(artifact({ records: [record('law-1', 'ALPHA-REV1')] })),
    ]);
    const pointer = fileBytes(store, 'current.json');
    const oldManifest = fileBytes(store, path.join('snapshots', first.snapshotId as string, 'manifest.json'));
    let nextId = '';

    await expect(apply(store, [
      upsert(artifact({ sourceRevision: REV_2, records: [record('law-1', 'ALPHA-REV2')] })),
    ], AS_OF_LATER, {
      beforeCurrentPublish(state) {
        nextId = state.nextSnapshotId;
        expect(readFileSync(path.join(store, 'current.json'), 'utf8')).toBe(pointer.toString('utf8'));
        expect(existsSync(path.join(store, 'snapshots', state.nextSnapshotId, 'manifest.json'))).toBe(true);
        throw new Error('injected publish failure');
      },
    })).rejects.toThrow('injected publish failure');

    expect(fileBytes(store, 'current.json').equals(pointer)).toBe(true);
    expect(fileBytes(store, path.join('snapshots', first.snapshotId as string, 'manifest.json')).equals(oldManifest)).toBe(true);
    expect((await readCurrent(store)).snapshotId).toBe(first.snapshotId);
    expect(source(await readSnapshot(store, nextId), ALPHA).records[0].text).toBe('ALPHA-REV2');
    const stagedManifest = fileBytes(store, path.join('snapshots', nextId, 'manifest.json'));
    expect(temporaryNames(store)).toEqual([]);

    const retried = await apply(store, [
      upsert(artifact({ sourceRevision: REV_2, records: [record('law-1', 'ALPHA-REV2')] })),
    ], AS_OF_LATER);
    expect(retried.changed).toBe(true);
    expect(retried.snapshotId).toBe(nextId);
    expect(fileBytes(store, path.join('snapshots', nextId, 'manifest.json')).equals(stagedManifest)).toBe(true);
    expect((await readCurrent(store)).snapshotId).toBe(nextId);
    expect(source(await readCurrent(store), ALPHA).records[0].text).toBe('ALPHA-REV2');
    expect(source(await readSnapshot(store, first.snapshotId as string), ALPHA).records[0].text).toBe('ALPHA-REV1');
  });

  test('a failure before the snapshot directory is renamed leaves current results untouched', async () => {
    const first = await apply(store, [upsert(artifact({ records: [record('law-1', 'ALPHA-REV1')] }))]);
    const pointer = fileBytes(store, 'current.json');
    let nextId = '';

    await expect(apply(store, [
      upsert(artifact({ sourceRevision: REV_2, records: [record('law-1', 'ALPHA-REV2')] })),
    ], AS_OF_LATER, {
      beforeSnapshotPublish(state) {
        nextId = state.nextSnapshotId;
        expect(existsSync(path.join(store, 'snapshots', state.nextSnapshotId))).toBe(false);
        expect(existsSync(path.join(store, 'staging', state.nextSnapshotId, 'manifest.json'))).toBe(true);
        throw new Error('injected snapshot failure');
      },
    })).rejects.toThrow('injected snapshot failure');

    expect(nextId).toMatch(/^[0-9a-f]{64}$/);
    expect(existsSync(path.join(store, 'snapshots', nextId))).toBe(false);
    expect(existsSync(path.join(store, 'staging'))).toBe(false);
    expect(fileBytes(store, 'current.json').equals(pointer)).toBe(true);
    expect((await readCurrent(store)).snapshotId).toBe(first.snapshotId);
    expect(temporaryNames(store)).toEqual([]);
  });

  test('the first publish is not current until the pointer rename succeeds', async () => {
    let nextId = '';
    await expect(apply(store, [upsert(artifact({ records: [record('law-1', 'ALPHA-REV1')] }))], AS_OF, {
      beforeCurrentPublish(state) {
        nextId = state.nextSnapshotId;
        expect(state.previousSnapshotId).toBeNull();
        expect(existsSync(path.join(store, 'current.json'))).toBe(false);
        throw new Error('injected first publish failure');
      },
    })).rejects.toThrow('injected first publish failure');

    expect((await readCurrent(store)).sources).toEqual([]);
    expect(source(await readSnapshot(store, nextId), ALPHA).records[0].text).toBe('ALPHA-REV1');

    const retried = await apply(store, [upsert(artifact({ records: [record('law-1', 'ALPHA-REV1')] }))]);
    expect(retried.snapshotId).toBe(nextId);
    expect((await readCurrent(store)).snapshotId).toBe(nextId);
  });

  test('a corrupt current pointer is quarantined and does not replace a readable snapshot', async () => {
    const first = await apply(store, [upsert(artifact({ records: [record('law-1', 'ALPHA-REV1')] }))]);
    const snapshotId = first.snapshotId as string;
    const manifest = fileBytes(store, path.join('snapshots', snapshotId, 'manifest.json'));
    writeFileSync(path.join(store, 'current.json'), '{');
    mkdirSync(path.join(store, 'quarantine'), { recursive: true });
    writeFileSync(path.join(store, 'quarantine', 'garbage.txt'), 'POISON-TOKEN-quarantine-dir');

    await expect(readCurrent(store)).rejects.toMatchObject({ name: 'UpdateError', code: 'corrupt-current' });
    expect(source(await readSnapshot(store, snapshotId), ALPHA).records[0].text).toBe('ALPHA-REV1');
    await expect(apply(store, [
      upsert(artifact({ sourceRevision: REV_2, records: [record('law-1', 'ALPHA-REV2')] })),
    ], AS_OF_LATER)).rejects.toMatchObject({ name: 'UpdateError', code: 'corrupt-current' });

    expect(readFileSync(path.join(store, 'current.json'), 'utf8')).toBe('{');
    expect(fileBytes(store, path.join('snapshots', snapshotId, 'manifest.json')).equals(manifest)).toBe(true);
    expect(source(await readSnapshot(store, snapshotId), ALPHA).records[0].text).toBe('ALPHA-REV1');
    const quarantined = await listQuarantine(store);
    expect(quarantined.map((item) => item.reason)).toEqual(['corrupt-artifact']);
    expect(quarantined[0].poisonedCurrent).toBe(false);
  });

  test('corrupt stored artifact bytes are not returned as current records or copied forward', async () => {
    const first = await apply(store, [
      upsert(artifact({ sourceId: ALPHA, sourceRevision: REV_1, records: [record('law-1', 'ALPHA-REV1')] })),
      upsert(artifact({ sourceId: GAMMA, sourceRevision: REV_1, records: [record('law-g', 'GAMMA-REV1')] })),
    ]);
    const gamma = source(await readCurrent(store), GAMMA);
    const artifactPath = path.join(store, gamma.artifact);
    const original = readFileSync(artifactPath);
    const flipped = Buffer.from(original);
    flipped[flipped.length - 2] = flipped[flipped.length - 2] === 0x61 ? 0x62 : 0x61;
    writeFileSync(artifactPath, flipped);

    await expect(readCurrent(store)).rejects.toMatchObject({ code: 'corrupt-snapshot' });
    await expect(readSnapshot(store, first.snapshotId as string)).rejects.toMatchObject({ code: 'corrupt-snapshot' });
    await expect(apply(store, [
      upsert(artifact({ sourceId: BETA, sourceRevision: REV_2, records: [record('law-b', 'BETA-NEW')] })),
    ], AS_OF_LATER)).rejects.toMatchObject({ code: 'corrupt-snapshot' });

    expect(readFileSync(artifactPath).equals(flipped)).toBe(true);
    expect(existsSync(path.join(store, 'snapshots', first.snapshotId as string, 'manifest.json'))).toBe(true);
    const pointer = JSON.parse(readFileSync(path.join(store, 'current.json'), 'utf8')) as { snapshotId: string };
    expect(pointer.snapshotId).toBe(first.snapshotId);
  });

  test('rejects a second payload for a pinned revision and a removal of a revision that is not current', async () => {
    await apply(store, [upsert(artifact({ sourceRevision: REV_1, records: [record('law-1', 'ALPHA-REV1')] }))]);
    const conflict = await apply(store, [
      upsert(artifact({ sourceRevision: REV_1, records: [record('law-1', 'DIFFERENT')] })),
      { op: 'remove', sourceId: ALPHA, sourceRevision: REV_2 },
      { op: 'remove', sourceId: BETA, sourceRevision: REV_1 },
      { op: 'upsert', artifact: artifact({ sourceRevision: 'main', records: [record('law-1', 'FLOATING')] }) },
    ], AS_OF_LATER);

    expect(conflict.changed).toBe(false);
    expect(conflict.quarantined.map((item) => item.reason)).toEqual([
      'revision-conflict',
      'stale-removal',
      'unpinned-source-revision',
    ]);
    expect(conflict.skipped).toEqual([
      { op: 'remove', sourceId: BETA, sourceRevision: REV_1, reason: 'already-absent' },
    ]);
    const current = await readCurrent(store);
    expect(source(current, ALPHA).sourceRevision).toBe(REV_1);
    expect(source(current, ALPHA).records[0].text).toBe('ALPHA-REV1');
    expect(treeText(store).includes('DIFFERENT')).toBe(false);
    expect(treeText(store).includes('FLOATING')).toBe(false);
  });

  test('keeps an additive record field and quarantines a drifted required column on the same source', async () => {
    await apply(store, [upsert(artifact({ records: [record('law-1', 'ALPHA-REV1')] }))]);
    const drifted = [{ id: 'law-1', title: 'Example', body: 'POISON-TOKEN-column' }];
    const changed = await apply(store, [
      upsert(artifact({
        sourceRevision: REV_2,
        records: drifted,
        payloadSha256: sha256HexUtf8(canonicalJson(drifted)),
      })),
    ], AS_OF_LATER);
    expect(changed.changed).toBe(false);
    expect(changed.quarantined[0].reason).toBe('incompatible-schema');
    expect(source(await readCurrent(store), ALPHA).records[0].text).toBe('ALPHA-REV1');

    const added = await apply(store, [
      upsert(artifact({
        sourceRevision: REV_2,
        records: [record('law-1', 'ALPHA-REV2', { citationNote: 'not an official citation' })],
      })),
    ], AS_OF_LATER);
    expect(added.changed).toBe(true);
    expect(source(await readCurrent(store), ALPHA).records).toEqual([
      record('law-1', 'ALPHA-REV2', { citationNote: 'not an official citation' }),
    ]);
  });

  test('applying the same delta again does not publish another snapshot', async () => {
    const first = await apply(store, [
      upsert(artifact({ sourceId: ALPHA, records: [record('law-1', 'ALPHA-REV1')] })),
      upsert(artifact({ sourceId: BETA, sourceRevision: REV_1, records: [record('law-b', 'BETA-REV1')] })),
    ]);
    const second = await apply(store, [
      upsert(artifact({ sourceId: ALPHA, records: [record('law-1', 'ALPHA-REV1')] })),
      { op: 'remove', sourceId: GAMMA, sourceRevision: REV_1 },
    ], AS_OF_LATER);

    expect(second.changed).toBe(false);
    expect(second.snapshotId).toBe(first.snapshotId);
    expect(second.skipped.map((item) => item.reason).sort()).toEqual(['already-absent', 'already-current']);
    expect(readdirSync(path.join(store, 'snapshots'))).toEqual([first.snapshotId]);
  });

  test('a later revision in the same batch replaces an earlier one, and a lock blocks a second writer', async () => {
    const result = await apply(store, [
      upsert(artifact({ sourceRevision: REV_1, records: [record('law-1', 'ALPHA-REV1')] })),
      upsert(artifact({ sourceRevision: REV_2, records: [record('law-1', 'ALPHA-REV2')] })),
      upsert(artifact({ sourceRevision: REV_3, records: [record('law-1', 'ALPHA-REV3')] })),
    ]);
    expect(result.applied.map((item) => item.sourceRevision)).toEqual([REV_3]);
    expect(source(await readCurrent(store), ALPHA).sourceRevision).toBe(REV_3);
    expect(source(await readCurrent(store), ALPHA).records[0].text).toBe('ALPHA-REV3');

    writeFileSync(path.join(store, '.update.lock'), 'held\n');
    const pointer = fileBytes(store, 'current.json');
    await expect(apply(store, [
      { op: 'remove', sourceId: ALPHA, sourceRevision: REV_3 },
    ], AS_OF_LATER)).rejects.toMatchObject({ name: 'UpdateError', code: 'locked' });
    expect(fileBytes(store, 'current.json').equals(pointer)).toBe(true);
    expect(readFileSync(path.join(store, '.update.lock'), 'utf8')).toBe('held\n');
  });

  test('reads a truncated artifact file as corrupt and does not create current results from it', async () => {
    const truncated = path.join(path.dirname(store), `${path.basename(store)}-truncated.json`);
    writeFileSync(truncated, `{"schema":"${ARTIFACT_SCHEMA}","schemaVersion":1,"records":[{"id":`);
    try {
      const result = await apply(store, [{ op: 'upsert-file', path: truncated }]);
      expect(result.changed).toBe(false);
      expect(result.snapshotId).toBeNull();
      expect(result.quarantined[0].reason).toBe('corrupt-artifact');
      expect(result.quarantined[0].poisonedCurrent).toBe(false);
      expect((await readCurrent(store)).sources).toEqual([]);
      expect(existsSync(path.join(store, 'current.json'))).toBe(false);
      expect(treeText(store).includes('"id":')).toBe(false);
    } finally {
      rmSync(truncated, { force: true });
    }
  });
});

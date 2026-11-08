import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanupReapedGateLock, seededOrder, verifyCompletedPhase10 } from '../../research/scripts/phase12-4-control.mjs';

const sha = '899fd35635db50dbf52abb54564a8a05a344b132';
const seed = 99537187;
const candidate = { persistentTable: true, seeQuiescence: true, seeOrdering: true, tunedEvaluation: false };
const baseline = { persistentTable: false, seeQuiescence: false, seeOrdering: false, tunedEvaluation: false };
const digest = (x: string | Buffer) => createHash('sha256').update(x).digest('hex');
const load = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
const save = (p: string, x: unknown) => writeFileSync(p, JSON.stringify(x) + '\n');

const fixture = () => {
  const dir = mkdtempSync(join(tmpdir(), 'chess-phase12-4-'));
  const runDir = join(dir, 'phase12-4-p10-300ms-899fd356');
  mkdirSync(runDir);
  // Synthetic control fixtures only; NEVER represent chess games or research results.
  const source = Array.from({length: 300}, (_, i) => ['e2e4', 'fixture-' + i]);
  const sourceFile = join(dir, 'source.json');
  save(sourceFile, source);
  const sourceSha256 = digest(JSON.stringify(source));
  const opening = { version: 1, mode: 'seeded-shuffle', seed,
    sourceSha256, openings: seededOrder(source, seed) };
  const snapshotFile = join(runDir, 'openings.json');
  save(snapshotFile, opening);
  const manifest: any = { schemaVersion: 1, candidateSha: sha, baselineSha: sha,
    newFeatures: candidate, baseFeatures: baseline,
    moveTimeMs: 300, maxPlies: 400, maxGames: 600, minGames: 50,
    elo0: 0, elo1: 25, alpha: 0.05, beta: 0.05, shards: 1, stopAtVerdict: false,
    openingSnapshotSha256: digest(readFileSync(snapshotFile)),
    openingOrder: { mode: 'seeded-shuffle', seed, openings: 300, sourceSha256 } };
  const manifestFile = join(runDir, 'experiment.json');
  save(manifestFile, manifest);
  const records = Array.from({length: 600}, (_, id) => ({id, fixtureOnly: true}));
  const jsonlFile = join(runDir, 'shard-0.jsonl');
  writeFileSync(jsonlFile, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const report: any = {
    name: 'phase12-4-p10-300ms-899fd356', schemaVersion: 1,
    source: 'prospective completed JSONL records only', manifest,
    status: 'complete', games: 600, totalSlots: 600, openings: 300,
    distinctOpenings: 300, completeColorPairs: 300, unpairedSlots: 0,
    missingSlotIds: [], recordsSha256: digest(JSON.stringify(records)) };
  const summaryFile = join(dir, 'report.json');
  save(summaryFile, report);
  const args = { runDir, summaryFile, sourceFile, sourceSha: sha, seed,
    newFeatures: candidate, baseFeatures: baseline };
  return {dir, args, source, manifest, report, manifestFile, snapshotFile, sourceFile, summaryFile, jsonlFile};
};
const inFixture = (fn: (f: ReturnType<typeof fixture>) => void) => {
  const f = fixture();
  try { fn(f); } finally { rmSync(f.dir, {recursive: true, force: true}); }
};

test('Phase 10 gate accepts exactly matching manifests even when override keys are reordered', () => inFixture((f) => {
  assert.equal(verifyCompletedPhase10(f.args), true);
  const m = structuredClone(f.manifest);
  m.newFeatures = Object.fromEntries(Object.entries(m.newFeatures).reverse());
  m.baseFeatures = Object.fromEntries(Object.entries(m.baseFeatures).reverse());
  save(f.manifestFile, m);
  const report = structuredClone(f.report);
  report.manifest = m;
  save(f.summaryFile, report);
  assert.equal(verifyCompletedPhase10(f.args), true);
}));

test('Phase 10 gate rejects wrong SHA, feature overrides, seed or limits', () => inFixture((f) => {
  const mutations = [
    (m: any) => { m.candidateSha = 'a'.repeat(40); },
    (m: any) => { m.baselineSha = 'b'.repeat(40); },
    (m: any) => { m.newFeatures.tunedEvaluation = true; },
    (m: any) => { m.baseFeatures.persistentTable = true; },
    (m: any) => { m.newFeatures.extra = true; },
    (m: any) => { delete m.baseFeatures.seeOrdering; },
    (m: any) => { m.openingOrder.seed += 1; },
    (m: any) => { m.openingOrder.sourceSha256 = '0'.repeat(64); },
    (m: any) => { m.moveTimeMs = 100; },
    (m: any) => { m.shards = 2; },
  ];
  for (const mutate of mutations) {
    const m = structuredClone(f.manifest);
    mutate(m);
    save(f.manifestFile, m);
    const report = structuredClone(f.report);
    report.manifest = m;
    save(f.summaryFile, report);
    assert.throws(() => verifyCompletedPhase10(f.args), /verification failed/);
  }
}));

test('Phase 10 gate rejects a changed committed opening source or a forged shuffled snapshot', () => inFixture((f) => {
  save(f.sourceFile, [...f.source].reverse());
  assert.throws(() => verifyCompletedPhase10(f.args), /source fingerprint/);
  save(f.sourceFile, f.source);
  const opening = load(f.snapshotFile);
  [opening.openings[0], opening.openings[1]] = [opening.openings[1], opening.openings[0]];
  save(f.snapshotFile, opening);
  const m = structuredClone(f.manifest);
  m.openingSnapshotSha256 = digest(readFileSync(f.snapshotFile));
  save(f.manifestFile, m);
  const report = structuredClone(f.report);
  report.manifest = m;
  save(f.summaryFile, report);
  assert.throws(() => verifyCompletedPhase10(f.args), /permutation/);
}));

test('Phase 10 gate rejects partial samples, missing raw records and stale reports', () => inFixture((f) => {
  const partial = structuredClone(f.report);
  partial.games = 599;
  save(f.summaryFile, partial);
  assert.throws(() => verifyCompletedPhase10(f.args), /600 audited games/);
  save(f.summaryFile, f.report);
  const changed = Array.from({length: 600}, (_, id) => ({id, changed: id === 599}));
  writeFileSync(f.jsonlFile, changed.map((r) => JSON.stringify(r)).join('\n') + '\n');
  assert.throws(() => verifyCompletedPhase10(f.args), /digest/);
}));

test('cleanup removes only the matching, reaped engine lock, never a live or foreign lock', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chess-phase12-4-lock-'));
  try {
    const file = join(dir, 'shard-0.lock');
    const child = spawnSync(process.execPath, ['-e', 'process.exit(0)']);
    assert.equal(child.status, 0);
    const deadPid = child.pid!;
    writeFileSync(file, hostname() + ':' + deadPid + ':' + randomUUID() + '\n');
    assert.equal(cleanupReapedGateLock(file, deadPid), 'removed');
    assert.equal(existsSync(file), false);
    assert.equal(cleanupReapedGateLock(file, deadPid), 'absent');
    writeFileSync(file, hostname() + ':' + (deadPid + 100000) + ':' + randomUUID() + '\n');
    assert.throws(() => cleanupReapedGateLock(file, deadPid), /different or unverified/);
    assert.equal(existsSync(file), true);
    writeFileSync(file, hostname() + ':' + process.pid + ':' + randomUUID() + '\n');
    assert.throws(() => cleanupReapedGateLock(file, process.pid), /still active/);
    assert.equal(existsSync(file), true);
  } finally { rmSync(dir, {recursive: true, force: true}); }
});

/** Phase 12.4 provenance gate and safe cleanup for reaped engine locks.
 * Pure Node; no engine import and no fabricated chess results. */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, unlinkSync } from 'node:fs';
import { hostname } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const fail = (s) => { throw new Error('Phase 12.4 verification failed: ' + s); };
const check = (ok, s) => { if (!ok) fail(s); };
const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
const sha256 = (x) => createHash('sha256').update(x).digest('hex');
const identical = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const sameOverrides = (actual, expected) => {
  const object = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
  if (!object(actual) || !object(expected)) return false;
  const entries = (x) => Object.entries(x).sort(([a], [b]) => a.localeCompare(b));
  return identical(entries(actual), entries(expected));
};

/** Match the seeded Fisher-Yates shuffle in sprt-openings.ts. */
export const seededOrder = (source, seed) => {
  const out = source.map((moves) => [...moves]);
  let state = seed;
  for (let i = out.length - 1; i > 0; i--) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const j = Math.floor((state / 0x100000000) * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

/** Never authorize Phase 11 on counts alone: audit exact Phase 10 identity. */
export const verifyCompletedPhase10 = ({
  runDir, summaryFile, sourceFile, sourceSha, seed, newFeatures, baseFeatures,
}) => {
  const report = json(summaryFile);
  const manifest = json(join(runDir, 'experiment.json'));
  const snapshotRaw = readFileSync(join(runDir, 'openings.json'));
  const snapshot = JSON.parse(snapshotRaw);
  const source = json(sourceFile);
  check(Array.isArray(source) && source.length === 300 && source.every(Array.isArray),
    'committed opening source must have 300 entries');
  check(new Set(source.map((line) => JSON.stringify(line))).size === 300,
    'committed opening source has duplicate lines');
  const originalHash = sha256(JSON.stringify(source));
  check(manifest.schemaVersion === 1 && report.schemaVersion === 1,
    'unexpected manifest/report schema');
  check(report.source === 'prospective completed JSONL records only',
    'unexpected report source');
  check(report.name === basename(runDir), 'report experiment name differs');
  check(identical(report.manifest, manifest), 'report manifest differs from experiment.json');
  check(manifest.candidateSha === sourceSha && manifest.baselineSha === sourceSha,
    'candidate/baseline SHA mismatch');
  check(sameOverrides(manifest.newFeatures, newFeatures), 'candidate overrides differ');
  check(sameOverrides(manifest.baseFeatures, baseFeatures), 'baseline overrides differ');
  check(manifest.moveTimeMs === 300 && manifest.maxPlies === 400 &&
    manifest.maxGames === 600 && manifest.minGames === 50 &&
    manifest.elo0 === 0 && manifest.elo1 === 25 &&
    manifest.alpha === 0.05 && manifest.beta === 0.05 &&
    manifest.shards === 1 && manifest.stopAtVerdict === false,
  'timing, limits, hypothesis or shard configuration mismatch');
  check(manifest.openingOrder?.mode === 'seeded-shuffle' &&
    manifest.openingOrder?.seed === seed &&
    manifest.openingOrder?.openings === 300 &&
    manifest.openingOrder?.sourceSha256 === originalHash,
  'opening seed/source fingerprint mismatch');
  check(snapshot.version === 1 && snapshot.mode === 'seeded-shuffle' &&
    snapshot.seed === seed && snapshot.sourceSha256 === originalHash &&
    identical(snapshot.openings, seededOrder(source, seed)),
  'snapshot differs from seeded permutation of committed openings');
  check(manifest.openingSnapshotSha256 === sha256(snapshotRaw),
    'opening snapshot hash mismatch');
  check(report.status === 'complete' && report.games === 600 &&
    report.totalSlots === 600 && report.openings === 300 &&
    report.distinctOpenings === 300 && report.completeColorPairs === 300 &&
    report.unpairedSlots === 0 && Array.isArray(report.missingSlotIds) &&
    report.missingSlotIds.length === 0,
  'Phase 10 must contain 600 audited games and 300 complete pairs');
  const records = [];
  for (const file of readdirSync(runDir).filter((f) => /^shard-\d+\.jsonl$/.test(f)).sort()) {
    check(file === 'shard-0.jsonl', 'unexpected shard JSONL');
    const raw = readFileSync(join(runDir, file), 'utf8');
    check(!raw || raw.endsWith('\n'), 'unterminated JSONL');
    for (const line of raw.split('\n').filter(Boolean)) records.push(JSON.parse(line));
  }
  check(records.length === 600, 'JSONL count differs from report');
  records.sort((a, b) => a.id - b.id);
  check(records.every((row, i) => row.id === i), 'missing or duplicated JSONL IDs');
  check(report.recordsSha256 === sha256(JSON.stringify(records)),
    'record digest differs from actual JSONL');
  return true;
};

/** Use after waiting for the direct Node child. Never remove a foreign lock. */
export const cleanupReapedGateLock = (file, pid) => {
  check(Number.isSafeInteger(pid) && pid > 0, 'invalid engine PID');
  if (!existsSync(file)) return 'absent';
  try {
    process.kill(pid, 0);
    fail('engine PID still active; preserve lock: ' + file);
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
  const token = readFileSync(file, 'utf8');
  const prefix = hostname() + ':' + pid + ':';
  check(token.startsWith(prefix) &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\n?$/.test(token.slice(prefix.length)),
  'lock belongs to a different or unverified writer: ' + file);
  check(readFileSync(file, 'utf8') === token, 'lock changed during verification');
  unlinkSync(file);
  return 'removed';
};

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    const [command, ...args] = process.argv.slice(2);
    if (command === 'verify-phase10') {
      check(args.length === 7, 'verify-phase10 expects seven arguments');
      const [runDir, summaryFile, sourceFile, sourceSha, seed, newFlags, baseFlags] = args;
      verifyCompletedPhase10({ runDir, summaryFile, sourceFile, sourceSha,
        seed: Number(seed), newFeatures: JSON.parse(newFlags), baseFeatures: JSON.parse(baseFlags) });
      console.log('Verified exact Phase 10 provenance and all 600 paired games.');
    } else if (command === 'cleanup-lock') {
      check(args.length === 2, 'cleanup-lock expects lock path and reaped PID');
      const outcome = cleanupReapedGateLock(args[0], Number(args[1]));
      if (outcome === 'removed') console.log('Removed owned stale lock: ' + args[0]);
    } else fail('unknown command');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

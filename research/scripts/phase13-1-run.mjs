/**
 * Phase 13.1 local-only reproducible performance baseline.
 * From repo root:
 *   node research/scripts/phase13-1-run.mjs capture --out=/tmp/chess-phase13-1
 *   node research/scripts/phase13-1-run.mjs profile --out=/tmp/chess-phase13-1
 *   node research/scripts/phase13-1-run.mjs browser --out=/tmp/chess-phase13-1
 *   node research/scripts/phase13-1-run.mjs report --out=/tmp/chess-phase13-1
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, platform, release, arch } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const backends = ['legacy', 'reference', 'independent'];
const checkpoints = [40, 80];
const root = 'profileMeasuredSearch';
const digest = (data) => createHash('sha256').update(data).digest('hex');
const run = (exe, args, env={}) => execFileSync(exe, args, { cwd: process.cwd(), encoding: 'utf8',
  env: { ...process.env, ...env }, maxBuffer: 25 * 1024 * 1024 });
const head = () => run('git', ['rev-parse', 'HEAD']).trim();
const lockHash = () => digest(readFileSync('package-lock.json'));
const load = (p) => JSON.parse(readFileSync(p, 'utf8'));
const save = (p, data) => { mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, typeof data === 'string' ? data : JSON.stringify(data, null, 2) + '\n', { flag: 'wx' }); };
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const ready = () => {
  assert.match(process.version, /^v22\./, 'Node 22 required');
  assert.equal(run('git', ['status', '--porcelain', '--untracked-files=no']).trim(), '', 'dirty tracked files');
  assert.ok(existsSync('node_modules/tsx') && existsSync('node_modules/.bin/esbuild'),
    'npm ci required in this checkout');
};
const metadata = () => {
  let cpuLimit = 'unknown';
  try { cpuLimit = readFileSync('/sys/fs/cgroup/cpu.max', 'utf8').trim(); } catch { /* other OS */ }
  return { schema: 1, recordedAt: new Date().toISOString(), sha: head(), lockHash: lockHash(),
    node: process.version, platform: platform() + ' ' + release() + ' ' + arch(),
    cpu: cpus()[0]?.model ?? 'unknown', logicalCpus: cpus().length, cpuLimit,
    protocol: 'five samples, ply 40/80, fixed-depth 4 and fixed-time 400ms; CPU profiles 400ms' };
};
const identity = (out) => {
  const m = load(join(out, 'manifest.json'));
  assert.equal(m.schema, 1);
  assert.equal(m.sha, head(), 'source commit changed');
  assert.equal(m.lockHash, lockHash(), 'dependency lock changed');
  assert.equal(m.node, process.version, 'Node changed');
  assert.equal(m.cpu, cpus()[0]?.model ?? 'unknown', 'CPU changed');
  assert.equal(m.platform, platform() + ' ' + release() + ' ' + arch(), 'OS changed');
  return m;
};

export function validateHistory(raw) {
  assert.equal(raw?.samplesPerMode, 5, 'sample count changed');
  assert.deepEqual(raw.results?.map((r) => r.ply), checkpoints, 'checkpoint coverage changed');
  for (const pos of raw.results) {
    assert.equal(pos.historyLength, pos.ply, 'history truncated');
    assert.equal(pos.fixedDepth?.depth, 4, 'fixed depth changed');
    assert.equal(pos.fixedTime?.timeLimitMs, 400, 'fixed time changed');
    for (const mode of ['fixedDepth', 'fixedTime']) for (const backend of backends) {
      const a = pos.samples?.[mode]?.[backend];
      assert.equal(a?.length, 5, 'missing '+mode+'/'+backend+' samples');
      assert.ok(a.every((s) => Number.isFinite(s.ms) && s.ms > 0
        && Number.isInteger(s.visits) && s.visits >= 0
        && Number.isInteger(s.depth) && s.depth >= 0
        && Number.isInteger(s.visitsPerSecond) && s.visitsPerSecond >= 0
        && typeof s.move === 'string' && s.move.length > 0), 'invalid timing/move/depth');
      assert.equal(pos[mode][backend].medianMs, median(a.map((s) => s.ms)), 'stale median ms');
      assert.equal(pos[mode][backend].medianVisits, median(a.map((s) => s.visits)), 'stale median visits');
      assert.equal(pos[mode][backend].medianVisitsPerSecond,
        median(a.map((s) => s.visitsPerSecond)), 'stale median visits/s');
    }
  }
  return true;
}

export function validateBrowser(raw, sha) {
  assert.equal(raw?.harnessRevision, 'phase13-1-reset-both', 'stale cache-reset harness');
  assert.equal(raw?.sourceSha, sha, 'wrong browser source SHA');
  assert.equal(raw?.samples, 3, 'wrong browser sample count');
  assert.equal(raw?.timeLimitMs, 1000, 'wrong browser time budget');
  assert.equal(raw?.worker?.length, 3, 'missing browser speed levels');
  for (const rate of [1,4,6]) {
    const group = raw.worker.find((x) => x.rate === rate);
    assert.ok(group && Number.isFinite(group.achievedSlowdown) && group.achievedSlowdown > 0,
      'missing measured slowdown');
    for (const ply of checkpoints) for (const backend of ['ts','kernel']) {
      const a = group.samples.filter((s) => s.ply === ply && s.backend === backend);
      assert.equal(a.length, 3, 'missing browser backend/position samples');
      for (const s of a) {
        assert.ok(s.move && Number.isFinite(s.elapsedMs) && s.elapsedMs > 0
          && Number.isInteger(s.completedDepth) && s.completedDepth > 0, 'invalid browser move/depth');
        assert.ok(!s.telemetry.some((v) => /fallback|timeout|error/i.test(v)), 'fallback in browser sample');
      }
    }
  }
  return true;
}

const capture = (out) => {
  ready();
  assert.ok(!existsSync(join(out, 'manifest.json')), 'baseline exists: choose a fresh directory');
  const raw = JSON.parse(run(process.execPath, ['--import', 'tsx',
    'research/scripts/search-position-history-benchmark.ts']));
  validateHistory(raw);
  save(join(out, 'history.json'), raw);
  save(join(out, 'manifest.json'), metadata());
  console.log('Full-history legacy/reference/independent matrix captured');
};
const profile = (out) => {
  const m = identity(out); ready();
  assert.ok(!existsSync(join(out, 'profiles.json')), 'profiles already captured');
  const bundle = join(out, 'profile-workload.mjs');
  run(resolve('node_modules/.bin/esbuild'), [
    'research/scripts/search-position-kernel-profile.ts', '--bundle', '--platform=node',
    '--format=esm', '--outfile='+bundle ]);
  const prof = {};
  for (const backend of ['legacy','independent']) {
    const dir = join(out, 'cpu-'+backend);
    mkdirSync(dir, {recursive: true});
    const sample = JSON.parse(run(process.execPath, ['--cpu-prof',
      '--cpu-prof-dir='+dir, bundle, '--backend='+backend]));
    assert.equal(sample.backend, backend);
    assert.equal(sample.searches, 16);
    assert.equal(sample.root, root);
    const summary = run(process.execPath, ['research/scripts/cpu-profile-summary.mjs', dir, root]);
    assert.match(summary, /Self time by category/);
    prof[backend] = { sample, selfTime: summary };
  }
  save(join(out,'profiles.json'), {sha:m.sha, root, prof});
  console.log('Symmetric legacy/new CPU profiles captured');
};
const browser = (out) => {
  const m = identity(out); ready();
  const target = join(out, 'browser.json');
  assert.ok(!existsSync(target), 'browser result exists');
  run(process.execPath, ['--import','tsx','research/scripts/browser-kernel-profile.ts'], {
    CHESS_BROWSER_PROFILE_OUTPUT: target, PHASE13_SOURCE_SHA: m.sha });
  validateBrowser(load(target), m.sha);
  console.log('Corrected Chromium worker benchmark captured');
};
const report = (out) => {
  const m = identity(out), raw = load(join(out, 'history.json'));
  validateHistory(raw);
  const p = existsSync(join(out,'profiles.json')) ? load(join(out,'profiles.json')) : null;
  if (p) { assert.equal(p.sha,m.sha); assert.ok(p.prof.legacy && p.prof.independent); }
  const b = existsSync(join(out,'browser.json')) ? load(join(out,'browser.json')) : null;
  if (b) validateBrowser(b,m.sha);
  const rows = raw.results.flatMap((r) => backends.map((backend) => ({
    ply:r.ply, backend, fixedDepthMs:r.fixedDepth[backend].medianMs,
    fixedTimeVisitsPerSecond:r.fixedTime[backend].medianVisitsPerSecond,
    completedDepths:r.samples.fixedTime[backend].map((s) => s.depth) })));
  const status = {history:'measured',cpu:p?'measured':'NOT RUN',
    browser:b?'measured':'NOT RUN',iphone:'NOT RUN',stockfish:'NOT PART OF THIS PHASE'};
  save(join(out,'summary.json'),{manifest:m,status,rows,
    browser:b?.worker?.map((x)=>({rate:x.rate,achievedSlowdown:x.achievedSlowdown,
      samples:x.samples})) ?? null});
  const lines=['# Phase 13.1 local performance baseline','',
    'Source: '+m.sha,'CPU: '+m.cpu,'OS: '+m.platform,'Node: '+m.node,
    'CPU quota: '+m.cpuLimit,'',
    '| Ply | Backend | Fixed-depth median ms | 400 ms visits/s | Completed depths |',
    '| --- | --- | ---: | ---: | --- |',
    ...rows.map((r)=>'| '+r.ply+' | '+r.backend+' | '+r.fixedDepthMs+' | '
      +r.fixedTimeVisitsPerSecond+' | '+r.completedDepths.join('/')+' |'),
    '', 'CPU profiles: '+status.cpu,'Corrected Chromium worker: '+status.browser,
    'Physical iPhone: NOT RUN','Stockfish comparison: NOT PART OF THIS PHASE','',
    'Visits are main + quiescence and not equal work between backends.',
    'These results do not establish Elo, phone performance or production readiness.',''];
  save(join(out,'summary.md'),lines.join('\n'));
  console.log('Summary created; all missing measurements explicitly marked NOT RUN');
};
const main = () => {
  const [action,...args] = process.argv.slice(2);
  if (action==='plan') {
    console.log('Local-only sequence: npm ci, capture, profile, optional browser, report');
    console.log('Requires Node 22 and a clean tracked worktree; browser requires Chromium/Playwright and Linux cgroup v1/root.');
    console.log('Use --out=/absolute/unique/directory for each command. Never overwrites archived results.');
    return;
  }
  assert.ok(['capture','profile','browser','report'].includes(action), 'unknown action');
  const outputArg = args.find((x)=>x.startsWith('--out='));
  assert.ok(outputArg?.slice(6)?.startsWith('/'), 'required --out=/absolute/path');
  const out = resolve(outputArg.slice(6));
  if(action==='capture')capture(out);
  if(action==='profile')profile(out);
  if(action==='browser')browser(out);
  if(action==='report')report(out);
};
if (process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  try { main(); } catch(e) { console.error(e); process.exitCode=1; }
}

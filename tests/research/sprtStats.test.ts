import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadRunOpenings, sprtVerdict } from '../../research/scripts/sprt-stats';

const BOUNDS = [Math.log(0.05 / 0.95), Math.log(0.95 / 0.05)] as const;

test('the SPRT verdict needs the minimum number of games before a bound counts', () => {
  // Eight games crossing the upper bound (as a near-zero variance can make it) are not a verdict.
  assert.equal(sprtVerdict(4.4, 8, BOUNDS, 50), 'undecided');
  assert.equal(sprtVerdict(-4.4, 8, BOUNDS, 50), 'undecided');
  assert.equal(sprtVerdict(3.1, 50, BOUNDS, 50), 'H1 accepted (improvement)');
  assert.equal(sprtVerdict(-3.1, 96, BOUNDS, 50), 'H0 accepted (no improvement)');
  assert.equal(sprtVerdict(2.9, 300, BOUNDS, 50), 'undecided');
});

test('the earlier phase 10 and 11 verdicts are unchanged by the minimum', () => {
  // Accepted runs: 92, 96, 173, 196 and 224 games.
  for (const games of [92, 96, 173, 196, 224]) assert.equal(sprtVerdict(3.0, games, BOUNDS, 50), 'H1 accepted (improvement)');
});

test('a run keeps the opening list it started with', async () => {
  const { runOpenings } = await import('../../research/scripts/sprt-stats');
  const a = [['e2e4', 'e7e5']]; const b = [['d2d4', 'd7d5']];
  // A new run stores what it was given.
  assert.deepEqual(runOpenings(undefined, a, true), { openings: a, store: true });
  // A restart without an override reuses the stored list, whatever the default is.
  assert.deepEqual(runOpenings(JSON.stringify(a), b, false), { openings: a, store: false });
  // The same override again is fine; a different one is refused before any game is played.
  assert.deepEqual(runOpenings(JSON.stringify(a), a, true), { openings: a, store: false });
  assert.throws(() => runOpenings(JSON.stringify(a), b, true), /different opening list/);
});

test('an opening list is atomically published and conflicts do not replace it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chess-sprt-'));
  try {
    const file = join(dir, 'openings.json');
    const first = [['e2e4', 'e7e5']];
    assert.deepEqual(loadRunOpenings(file, () => first, true), first);
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), first);
    assert.deepEqual(loadRunOpenings(file, () => { throw new Error('should not regenerate'); }, false), first);
    assert.throws(() => loadRunOpenings(file, () => [['d2d4']], true), /different opening list/);
    assert.deepEqual(readdirSync(dir), ['openings.json']); // no private files survive
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('concurrent shards publish one full list and reject conflicting overrides', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'chess-sprt-shards-'));
  try {
    const file = join(dir, 'openings.json');
    const gate = join(dir, 'go');
    const ready = [join(dir, 'ready-0'), join(dir, 'ready-1')];
    const helperUrl = new URL('../../research/scripts/sprt-stats.ts', import.meta.url).href;
    const worker = (opening: string, index: number): Promise<number | null> => new Promise((resolve, reject) => {
      const script = [
        "import { existsSync, writeFileSync } from 'node:fs';",
        `import { loadRunOpenings } from ${JSON.stringify(helperUrl)};`,
        `writeFileSync(${JSON.stringify(ready[index])}, 'ready');`,
        'const deadline = Date.now() + 10000;',
        `while (!existsSync(${JSON.stringify(gate)})) { if (Date.now() > deadline) process.exit(9); }`,
        `try { loadRunOpenings(${JSON.stringify(file)}, () => [[${JSON.stringify(opening)}]], true); }`,
        'catch { process.exit(2); }',
      ].join('\n');
      const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', script],
        { stdio: 'ignore' });
      child.once('error', reject);
      child.once('close', resolve);
    });
    const results = Promise.all([worker('e2e4', 0), worker('d2d4', 1)]);
    const deadline = Date.now() + 15000;
    while (!ready.every(existsSync)) {
      if (Date.now() > deadline) throw new Error('shards did not reach the start gate');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    writeFileSync(gate, 'go');
    assert.deepEqual((await results).sort(), [0, 2]);
    const published = JSON.parse(readFileSync(file, 'utf8')) as string[][];
    assert.ok(JSON.stringify(published) === JSON.stringify([['e2e4']])
      || JSON.stringify(published) === JSON.stringify([['d2d4']]));
    assert.deepEqual(readdirSync(dir).filter((name) => name.endsWith('.tmp')), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

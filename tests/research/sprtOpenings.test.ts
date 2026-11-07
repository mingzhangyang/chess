import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_OPENING_SEED, loadShuffledRunOpenings, openingSlotForGame, parseOpeningList,
  parseOpeningSeed, readRunOpeningOrder, shuffleOpeningPairs,
} from '../../research/scripts/sprt-openings.ts';

type Options = Parameters<typeof loadShuffledRunOpenings>[2];
const options = (overrides: Partial<Options> = {}): Options => ({
  seed: DEFAULT_OPENING_SEED, explicitSeed: false, sourceOverride: false,
  preserveOrder: false, explicitPreserveOrder: false, ...overrides,
});
const sample = (): string[][] => Array.from({ length: 300 }, (_, n) => [
  n < 100 ? 'd2d4' : n < 200 ? 'e2e4' : 'c2c4', String(n),
]);
const inTemp = async (fn: (dir: string) => void | Promise<void>): Promise<void> => {
  const dir = mkdtempSync(join(tmpdir(), 'chess-sprt-shuffle-'));
  try { await fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
};

test('a fixed seed deterministically shuffles whole opening pairs without mutating inputs', () => {
  const source = sample();
  const copy = structuredClone(source);
  const order = shuffleOpeningPairs(source, 321);
  assert.deepEqual(shuffleOpeningPairs(source, 321), order);
  assert.notDeepEqual(shuffleOpeningPairs(source, 322), order);
  assert.notDeepEqual(order, source);
  assert.deepEqual(source, copy);
  assert.deepEqual(order.map((line) => line.join('/')).sort(), source.map((line) => line.join('/')).sort());
  // The old sorted prefix was all d4; a short gate now samples all three families.
  assert.deepEqual(new Set(shuffleOpeningPairs(source, DEFAULT_OPENING_SEED).slice(0, 32).map((line) => line[0])),
    new Set(['d2d4', 'e2e4', 'c2c4']));
  for (let k = 0; k < order.length; k += 1) {
    assert.deepEqual(openingSlotForGame(k * 2, order), { opening: order[k], newColor: 'w' });
    assert.deepEqual(openingSlotForGame(k * 2 + 1, order), { opening: order[k], newColor: 'b' });
  }
  assert.throws(() => openingSlotForGame(order.length * 2, order), /outside/);
});

test('seed validation refuses wrapped, fractional and noncanonical values', () => {
  for (const input of ['-1', '4294967296', '1.5', '01', 'NaN', '', ' 7', '0xFF']) {
    assert.throws(() => parseOpeningSeed(input), /unsigned 32-bit/);
  }
  assert.equal(parseOpeningSeed('0'), 0);
  assert.equal(parseOpeningSeed('4294967295'), 0xffffffff);
});

test('a fresh run persists versioned seed, order and fingerprint; restart needs no regeneration', async () => {
  await inTemp(async (dir) => {
    const file = join(dir, 'openings.json');
    const src = sample();
    const ordered = loadShuffledRunOpenings(file, () => src, options({ seed: 23 }));
    assert.deepEqual(ordered, shuffleOpeningPairs(src, 23));
    const persisted = readFileSync(file, 'utf8');
    assert.deepEqual(loadShuffledRunOpenings(file, () => { throw new Error('regenerated'); }, options()), ordered);
    assert.equal(readFileSync(file, 'utf8'), persisted);
    assert.deepEqual(readRunOpeningOrder(file), {
      mode: 'seeded-shuffle', seed: 23, openings: src.length,
      sourceSha256: JSON.parse(persisted).sourceSha256,
    });
    assert.deepEqual(parseOpeningList(persisted), ordered);
    assert.throws(() => loadShuffledRunOpenings(file, () => src, options({
      seed: 24, explicitSeed: true,
    })), /different opening seed/);
    assert.deepEqual(readdirSync(dir), ['openings.json']);
  });
});

test('resuming with a conflicting openings override is rejected before changing the snapshot', async () => {
  await inTemp(async (dir) => {
    const file = join(dir, 'openings.json');
    const src = sample();
    const ordered = loadShuffledRunOpenings(file, () => src, options({ sourceOverride: true }));
    assert.deepEqual(loadShuffledRunOpenings(file, () => src, options({ sourceOverride: true })), ordered);
    const before = readFileSync(file, 'utf8');
    assert.throws(() => loadShuffledRunOpenings(file, () => [['a2a3']], options({ sourceOverride: true })),
      /different opening list/);
    assert.equal(readFileSync(file, 'utf8'), before);
  });
});

test('a fixed-slot comparison can explicitly preserve input order and records that mode', async () => {
  await inTemp(async (dir) => {
    const file = join(dir, 'openings.json');
    const src = sample();
    assert.deepEqual(loadShuffledRunOpenings(file, () => src, options({
      sourceOverride: true, preserveOrder: true, explicitPreserveOrder: true,
    })), src);
    assert.deepEqual(readRunOpeningOrder(file)?.mode, 'as-provided');
    assert.deepEqual(readRunOpeningOrder(file)?.seed, null);
    assert.deepEqual(loadShuffledRunOpenings(file, () => { throw new Error('regenerated'); }, options()), src);
    assert.throws(() => loadShuffledRunOpenings(file, () => src, options({
      sourceOverride: true, explicitPreserveOrder: true,
    })), /different opening order mode/);
  });
});

test('historical unshuffled run files retain their exact ID mapping', async () => {
  await inTemp(async (dir) => {
    const file = join(dir, 'openings.json');
    const sorted = sample();
    writeFileSync(file, `${JSON.stringify(sorted)}\n`);
    assert.deepEqual(loadShuffledRunOpenings(file, () => { throw new Error('regenerated'); }, options()), sorted);
    assert.deepEqual(loadShuffledRunOpenings(file, () => sorted, options({ sourceOverride: true })), sorted);
    assert.throws(() => loadShuffledRunOpenings(file, () => [['a']], options({ sourceOverride: true })),
      /different opening list/);
    assert.throws(() => loadShuffledRunOpenings(file, () => sorted, options({ explicitSeed: true })),
      /legacy SPRT run/);
    assert.deepEqual(readRunOpeningOrder(file), { mode: 'legacy-unshuffled', seed: null, openings: 300 });
    assert.deepEqual(parseOpeningList(readFileSync(file, 'utf8')), sorted);
  });
});

test('parallel starts agree on one persisted shuffled list, even with different seeds', async () => {
  await inTemp(async (dir) => {
    const file = join(dir, 'openings.json');
    const gate = join(dir, 'go');
    const ready = [join(dir, 'ready-0'), join(dir, 'ready-1')];
    const moduleUrl = new URL('../../research/scripts/sprt-openings.ts', import.meta.url).href;
    const spawnWorker = (seed: number, i: number): Promise<number | null> => new Promise((resolve, reject) => {
      const script = [
        "import { existsSync, writeFileSync } from 'node:fs';",
        `import { loadShuffledRunOpenings } from ${JSON.stringify(moduleUrl)};`,
        `writeFileSync(${JSON.stringify(ready[i])}, 'ready');`,
        `const until = Date.now() + 10000; while (!existsSync(${JSON.stringify(gate)})) {
          if (Date.now() > until) process.exit(9); }`,
        `try { loadShuffledRunOpenings(${JSON.stringify(file)}, () => [['d2d4'], ['e2e4'], ['c2c4']],
          {seed: ${seed}, explicitSeed:true, sourceOverride:true, preserveOrder:false, explicitPreserveOrder:false}); }
        catch { process.exit(2); }`,
      ].join('\n');
      const child = spawn(process.execPath,
        ['--experimental-strip-types', '--input-type=module', '--eval', script], { stdio: 'ignore' });
      child.once('error', reject);
      child.once('close', resolve);
    });
    const results = Promise.all([spawnWorker(17, 0), spawnWorker(93, 1)]);
    const deadline = Date.now() + 10000;
    while (!ready.every(existsSync)) {
      if (Date.now() > deadline) throw new Error('shards did not reach the start gate');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    writeFileSync(gate, 'go');
    assert.deepEqual((await results).sort(), [0, 2]);
    const snapshot = JSON.parse(readFileSync(file, 'utf8'));
    assert.ok([17, 93].includes(snapshot.seed));
    assert.equal(snapshot.openings.length, 3);
    assert.deepEqual(readdirSync(dir).filter((name) => name.endsWith('.tmp')), []);
    const restored = loadShuffledRunOpenings(file, () => { throw new Error('regenerated'); }, options());
    assert.deepEqual(restored, snapshot.openings);
  });
});

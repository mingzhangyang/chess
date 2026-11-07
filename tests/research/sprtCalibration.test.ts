import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { auditSprt, compareStockfishSlots, loadSprtAudit, parseJsonl,
  validateStockfishSlotsAgainstOpenings } from '../../research/scripts/sprt-calibration.ts';

const openings = [['d2d4'], ['e2e4'], ['c2c4']];
const game = (id: number, score: 0 | 0.5 | 1) => ({ id, newColor: id % 2 === 0 ? 'w' as const : 'b' as const, score });

test('full coverage is recognized only when every original color slot exists', () => {
  const full = auditSprt('synthetic', openings, [game(0, 1), game(1, 0), game(2, 0.5), game(3, 1), game(4, 0), game(5, 0.5)],
    { games: 6, wins: 2, draws: 2, losses: 2 });
  assert.equal(full.sample, 'full-opening-and-color-coverage');
  assert.equal(full.distinctOpenings, 3);
  assert.equal(full.completeColorPairs, 3);
  assert.equal(full.unpairedSlots, 0);
  assert.equal(full.openingDistributionTotalVariation, 0);
  assert.equal(full.elo, 0);
  assert.deepEqual(Object.keys(full.firstMoves), ['c2c4', 'd2d4', 'e2e4']);
});

test('an early sorted prefix is explicitly marked non-generalizable', () => {
  const partial = auditSprt('prefix', openings, [game(0, 1), game(1, 1)], { games: 2 });
  assert.equal(partial.distinctOpenings, 1);
  assert.equal(partial.sample, 'early-stopped-or-partial');
  assert.equal(partial.claim, 'partial coverage: cannot infer a full-opening Elo gain');
  assert.equal(partial.firstMoves.e2e4.observedGames, 0);
  assert.equal(partial.openingDistributionTotalVariation, 0.6667);
});

test('an uneven shard restart is counted by IDs rather than order or line count', () => {
  const run = auditSprt('sharded', openings, [game(3, 0), game(1, 1), game(0, 0.5)]);
  assert.equal(run.completeColorPairs, 1);
  assert.equal(run.unpairedSlots, 1);
  assert.equal(run.distinctOpenings, 2);
  assert.equal(run.games, 3);
});

test('rejects duplicated IDs, wrong slot colors, invalid scores and corrupted summaries', () => {
  assert.throws(() => auditSprt('x', openings, [game(0, 1), game(0, 0)]), /duplicate/);
  assert.throws(() => auditSprt('x', openings, [{ ...game(0, 1), newColor: 'b' }]), /wrong color/);
  assert.throws(() => auditSprt('x', openings, [game(6, 0)]), /invalid game ID/);
  assert.throws(() => auditSprt('x', openings, [game(0, 0.4 as 0)]), /invalid score/);
  assert.throws(() => auditSprt('x', openings, [game(0, 1)], { wins: 0 }), /summary wins/);
  assert.throws(() => auditSprt('x', [], [game(0, 1)]), /opening list/);
});

test('stockfish comparisons require identical opening and color for every ID', () => {
  const slot = (id: number, opening: string[], score: 0 | 0.5 | 1) =>
    ({ id, opening, kernelColor: id % 2 === 0 ? 'w' as const : 'b' as const, kernelScore: score });
  const before = [slot(0, ['e2e4'], 0), slot(1, ['e2e4'], 1)];
  const after = [slot(0, ['e2e4'], 1), slot(1, ['e2e4'], 1)];
  const result = compareStockfishSlots(before, after);
  assert.equal(result.scoreDifference, 0.5);
  assert.equal(result.slots, 2);
  assert.throws(() => compareStockfishSlots(before, [slot(0, ['d2d4'], 1), after[1]]), /mismatch/);
  assert.throws(() => compareStockfishSlots(before, [after[0]]), /incomplete/);
  assert.throws(() => compareStockfishSlots(before, [after[0], after[0]]), /mismatch/);
});

test('parseJsonl accepts final newline but not an invalid JSON record', () => {
  assert.deepEqual(parseJsonl('{"id":0}\n{"id":1}\n'), [{ id: 0 }, { id: 1 }]);
  assert.throws(() => parseJsonl('{"id":oops}'), /JSON/);
});


test('file-backed summaries require complete numeric totals and Elo', () => {
  const root = mkdtempSync(join(tmpdir(), 'sprt-calibration-summary-'));
  try {
    const folder = join(root, 'kernel-sprt', 'synthetic');
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, 'openings.json'), JSON.stringify([['e2e4']]));
    writeFileSync(join(folder, 'shard-0.jsonl'), `${JSON.stringify(game(0, 1))}\n${JSON.stringify(game(1, 0))}\n`);
    const summaryFile = join(root, 'kernel-sprt', 'synthetic-summary.json');
    const complete = { games: 2, wins: 1, draws: 0, losses: 1, elo: 0 };
    for (const invalid of [null, [], 'invalid', {}, { ...complete, elo: '0' },
      { ...complete, draws: undefined }, { ...complete, wins: 1.5 }, { ...complete, games: -2 }]) {
      writeFileSync(summaryFile, JSON.stringify(invalid));
      assert.throws(() => loadSprtAudit(root, 'synthetic'), /saved summary/);
    }
    writeFileSync(summaryFile, JSON.stringify(complete));
    assert.equal(loadSprtAudit(root, 'synthetic').elo, 0);
    assert.equal(JSON.parse(readFileSync(summaryFile, 'utf8')).games, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Stockfish Elo difference rounds only after subtracting raw estimates', () => {
  const slot = (id: number, score: 0 | 0.5 | 1) => ({ id, opening: ['e2e4'],
    kernelColor: id % 2 === 0 ? 'w' as const : 'b' as const, kernelScore: score });
  // Archive-equivalent 200-slot scores: Phase 10 = 44.50%, Phase 11 = 47.75%.
  const old = Array.from({ length: 200 }, (_, id) => slot(id, id < 82 ? 1 : id < 96 ? 0.5 : 0));
  const current = Array.from({ length: 200 }, (_, id) => slot(id, id < 89 ? 1 : id < 102 ? 0.5 : 0));
  const result = compareStockfishSlots(old, current);
  assert.equal(result.oldScore, 0.445);
  assert.equal(result.newScore, 0.4775);
  assert.equal(result.eloDifference, 23); // not -16 - (-38) = 22
});

test('Stockfish slots reject wrong parity even when both archives agree', () => {
  const slot = (id: number, opening: string[], kernelColor: 'w' | 'b') =>
    ({ id, opening, kernelColor, kernelScore: 1 as const });
  const valid = [slot(0, ['e2e4'], 'w'), slot(1, ['e2e4'], 'b')];
  validateStockfishSlotsAgainstOpenings(valid, [['e2e4']]);
  const sameWrongColor = [valid[0], slot(1, ['e2e4'], 'w')];
  assert.throws(() => compareStockfishSlots(sameWrongColor, sameWrongColor), /mismatch/);
  assert.throws(() => validateStockfishSlotsAgainstOpenings(sameWrongColor, [['e2e4']]), /mismatch/);
  for (const bad of [
    [valid[0], slot(2, ['e2e4'], 'w')],       // in-range IDs only
    [valid[0], slot(-1, ['e2e4'], 'b')],      // negative IDs are invalid
    [valid[0], slot(1.5, ['e2e4'], 'b')],     // fractional IDs are invalid
    [valid[0], valid[0]],                   // duplicate ID cannot hide a missing slot
    [valid[0], slot(1, ['d2d4'], 'b')],      // opening must match its slot
  ]) {
    assert.throws(() => validateStockfishSlotsAgainstOpenings(bad, [['e2e4']]), /mismatch/);
  }
  assert.throws(() => validateStockfishSlotsAgainstOpenings([valid[0]], [['e2e4']]), /differ/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { auditSprt, compareStockfishSlots, parseJsonl } from '../../research/scripts/sprt-calibration.ts';

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

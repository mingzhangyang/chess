import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { DEFAULT_AI_TUNING } from '../../src/utils/chess-ai/chessAITuning';
import { searchState } from '../../src/utils/chess-ai/chessAISearchDiagnostics';
import {
  getBacktrackPenalty,
  searchRootDepth,
  type RootSearchMove,
} from '../../src/utils/chess-ai/chessAIRootSearch';
import type { MinimaxRecurse } from '../../src/utils/chess-ai/chessAIPvsSearch';

const NF3 = { from: 'g1', to: 'f3', piece: 'n' } as const;

/** Position after 1.Nf3 d5: white can play the immediate backtrack Ng1. */
const afterNf3 = (): Chess => {
  const game = new Chess();
  game.move('Nf3');
  game.move('d5');
  return game;
};

const rootMoves = (game: Chess, sans: string[], scores: number[]): RootSearchMove[] => {
  const legal = game.moves({ verbose: true });
  return sans.map((san, i) => {
    const move = legal.find((m) => m.san === san);
    assert.ok(move, `expected ${san} to be legal`);
    return { move, rawScore: scores[i] };
  });
};

/** Scores root moves by from-square and records each search window. */
const recording = (scores: Record<string, number>) => {
  const calls: Record<string, Array<[number, number]>> = {};
  const recurse: MinimaxRecurse = (_g, _d, alpha, beta, _m, _c, _t, _p, _n, _x, _y, previousMove) => {
    const from = previousMove?.from ?? '';
    (calls[from] ??= []).push([alpha, beta]);
    return scores[from] ?? 0;
  };
  return { calls, recurse };
};

const searchHard = (game: Chess, itMoves: RootSearchMove[], recurse: MinimaxRecurse) => {
  searchState.searchAborted = false;
  return searchRootDepth({
    game,
    itMoves,
    depth: 1,
    color: 'w',
    difficulty: 'hard',
    openingPhase: false,
    previousOwnMove: NF3,
    tuning: DEFAULT_AI_TUNING,
    recurse,
  });
};

test('backtrack penalty applies only to a quiet immediate backtrack', () => {
  const game = afterNf3();
  const [ng1, d4] = rootMoves(game, ['Ng1', 'd4'], [0, 0]).map((m) => m.move);
  assert.equal(getBacktrackPenalty(ng1, NF3, DEFAULT_AI_TUNING), DEFAULT_AI_TUNING.backtrackPenalty);
  assert.equal(getBacktrackPenalty(d4, NF3, DEFAULT_AI_TUNING), 0);
  assert.equal(getBacktrackPenalty(ng1, null, DEFAULT_AI_TUNING), 0);
});

test('a previous own move no longer widens the band for unrelated moves', () => {
  const game = afterNf3();
  const { calls, recurse } = recording({ e2: 100, d2: 70 });
  const result = searchHard(game, rootMoves(game, ['e4', 'd4'], [100, 70]), recurse);
  const edge = 100 - DEFAULT_AI_TUNING.hardBand - 1;
  // d4 is 30 below e4, outside the hard band: one zero-window probe rejects it.
  assert.deepEqual(calls.d2, [[edge, edge + 1]]);
  assert.deepEqual(result.scores, [100, -Infinity]);
});

test('a penalized best backtrack lets moves near its penalized score stay selectable', () => {
  const game = afterNf3();
  const { recurse } = recording({ f3: 100, d2: 60, e2: 40 });
  const itMoves = rootMoves(game, ['Ng1', 'd4', 'e4'], [100, 60, 40]);
  const result = searchHard(game, itMoves, recurse);
  const byFrom = Object.fromEntries(itMoves.map((m, i) => [m.move.from, result.scores?.[i]]));
  // Ng1 nets 100 - 45 = 55, so d4 (60) leads and Ng1 stays within the band;
  // e4 (40) cannot reach 60 - hardBand and is rejected.
  assert.deepEqual(byFrom, { d2: 60, f3: 100, e2: -Infinity });
});

test('the backtrack move itself must clear the band after its penalty', () => {
  const game = afterNf3();
  const { calls, recurse } = recording({ e2: 100, f3: 80 });
  const result = searchHard(game, rootMoves(game, ['e4', 'Ng1'], [100, 80]), recurse);
  const edge = 100 - DEFAULT_AI_TUNING.hardBand - 1 + DEFAULT_AI_TUNING.backtrackPenalty;
  assert.deepEqual(calls.f3, [[edge, edge + 1]]);
  assert.deepEqual(result.scores, [100, -Infinity]);
});

test('a partial depth always includes the previous penalty-adjusted best move', () => {
  const game = afterNf3();
  // Ng1 leads on raw score (100) but nets 55 after its penalty; d4 (90) is
  // the real previous best. The clock runs out after one move is resolved.
  const itMoves = rootMoves(game, ['Ng1', 'd4'], [100, 90]);
  let calls = 0;
  const recurse: MinimaxRecurse = () => {
    calls += 1;
    if (calls === 2) searchState.searchAborted = true;
    return 90;
  };
  const result = searchHard(game, itMoves, recurse);
  searchState.searchAborted = false;
  assert.equal(result.completed, false);
  assert.equal(result.partialScores?.length, 1);
  assert.equal(`${itMoves[0].move.from}${itMoves[0].move.to}`, 'd2d4');
});

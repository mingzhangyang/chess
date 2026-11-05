import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { getBestMove, getLastSearchDiagnostics } from '../../src/utils/chessAI';
import { DEFAULT_AI_TUNING } from '../../src/utils/chess-ai/chessAITuning';
import { searchState } from '../../src/utils/chess-ai/chessAISearchDiagnostics';
import {
  applyRootDepthResult,
  searchRootDepth,
  type RootSearchMove,
} from '../../src/utils/chess-ai/chessAIRootSearch';
import type { MinimaxRecurse } from '../../src/utils/chess-ai/chessAIPvsSearch';

const rootMoves = (game: Chess, sans: string[], scores: number[]): RootSearchMove[] => {
  const legal = game.moves({ verbose: true });
  return sans.map((san, i) => {
    const move = legal.find((m) => m.san === san);
    assert.ok(move, `expected ${san} to be legal`);
    return { move, rawScore: scores[i] };
  });
};

/** Scores each root move by its from-square; aborts when `abortOn` is searched. */
const scriptedRecurse = (scores: Record<string, number>, abortOn: string): MinimaxRecurse =>
  (_game, _depth, _alpha, _beta, _isMax, _color, _tuning, _ply, _allowNull, _pMax, _pMin, previousMove) => {
    const from = previousMove?.from ?? '';
    if (from === abortOn) {
      searchState.searchAborted = true;
      return 0;
    }
    return scores[from] ?? 0;
  };

const runDepth = (itMoves: RootSearchMove[], game: Chess, recurse: MinimaxRecurse) => {
  searchState.searchAborted = false;
  try {
    return searchRootDepth({
      game,
      itMoves,
      depth: 2,
      color: 'w',
      difficulty: 'expert',
      openingPhase: false,
      tuning: DEFAULT_AI_TUNING,
      recurse,
    });
  } finally {
    searchState.searchAborted = false;
  }
};

test('aborted root depth reports exact scores of the moves it finished', () => {
  const game = new Chess();
  const itMoves = rootMoves(game, ['e4', 'd4', 'Nf3'], [100, 90, 80]);
  // e4 holds at 100, d4 beats it at 120, then the clock runs out on Nf3.
  const result = runDepth(itMoves, game, scriptedRecurse({ e2: 100, d2: 120 }, 'g1'));
  assert.equal(result.completed, false);
  assert.deepEqual(result.partialScores, [100, 120]);
  assert.equal(game.fen(), new Chess().fen());
});

test('aborted root depth reports nothing before the first move is resolved', () => {
  const game = new Chess();
  const itMoves = rootMoves(game, ['e4', 'd4'], [100, 90]);
  const result = runDepth(itMoves, game, scriptedRecurse({}, 'e2'));
  assert.equal(result.completed, false);
  assert.equal(result.partialScores, undefined);
});

test('partial results only count moves resolved in the current aspiration pass', () => {
  const game = new Chess();
  const itMoves = rootMoves(game, ['e4', 'd4'], [100, 90]);
  let e4Calls = 0;
  // e4 first fails high above the aspiration window (100 + 50), forcing a
  // re-search; the clock runs out during that re-search.
  const recurse: MinimaxRecurse = (_g, _d, _a, _b, _m, _c, _t, _p, _n, _x, _y, previousMove) => {
    if (previousMove?.from === 'e2') {
      e4Calls += 1;
      if (e4Calls === 2) searchState.searchAborted = true;
      return 400;
    }
    return 0;
  };
  const result = runDepth(itMoves, game, recurse);
  assert.equal(result.completed, false);
  assert.equal(result.partialScores, undefined);
});

test('applyRootDepthResult takes full scores from a completed depth', () => {
  const itMoves = [{ rawScore: 1 }, { rawScore: 2 }] as RootSearchMove[];
  assert.equal(applyRootDepthResult(itMoves, { completed: true, scores: [30, 20] }), 'completed');
  assert.deepEqual(itMoves.map((m) => m.rawScore), [30, 20]);
});

test('applyRootDepthResult keeps only the moves a partial depth resolved', () => {
  const itMoves = [{ rawScore: 100 }, { rawScore: 90 }, { rawScore: 80 }] as RootSearchMove[];
  assert.equal(applyRootDepthResult(itMoves, { completed: false, partialScores: [70, 95] }), 'partial');
  assert.deepEqual(itMoves.map((m) => m.rawScore), [70, 95, -Infinity]);
});

test('applyRootDepthResult leaves scores alone when nothing was resolved', () => {
  const itMoves = [{ rawScore: 100 }, { rawScore: 90 }] as RootSearchMove[];
  assert.equal(applyRootDepthResult(itMoves, { completed: false }), 'none');
  assert.deepEqual(itMoves.map((m) => m.rawScore), [100, 90]);
});

test('timed search reports at most one partial depth beyond the completed one', () => {
  const game = new Chess('r2q1rk1/1b2bppp/p2ppn2/1p6/3NP3/1BN1B3/PPP2PPP/R2Q1RK1 w - - 0 11');
  const move = getBestMove(game, 'hard', { openingBookEnabled: false }, 300);
  assert.ok(move);
  const { completedDepth, partialDepth } = getLastSearchDiagnostics();
  assert.ok(completedDepth >= 1);
  assert.ok(partialDepth === 0 || partialDepth === completedDepth + 1, `partial ${partialDepth} vs ${completedDepth}`);
});

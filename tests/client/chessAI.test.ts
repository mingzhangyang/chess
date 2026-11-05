import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { searchPvsMoves } from '../../src/utils/chess-ai/chessAIPvsSearch';
import { generatePseudoLegalMoves, getBoard, isTacticalMove, type AiMove } from '../../src/utils/chess-ai/chessAIBoardOps';
import { makeNullMove } from '../../src/utils/chess-ai/chessAISearchHeuristics';
import { drawScore, MATE_SCORE, quiescence } from '../../src/utils/chess-ai/chessAIQuiescence';
import { resetSearchCounters, searchState } from '../../src/utils/chess-ai/chessAISearchDiagnostics';
import { minimax, setSearchDeadline } from '../../src/utils/chess-ai/chessAISearchCore';
import {
  applyHistoryBonus as applyHeuristicHistoryBonus,
  clearKillers,
  getHistoryScore,
  killerScore,
  recordCountermove as recordHeuristicCountermove,
  storeKiller,
} from '../../src/utils/chess-ai/chessAIMoveHeuristics';
import { searchRootDepth } from '../../src/utils/chess-ai/chessAIRootSearch';
import {
  createRepetitionContext,
  getAiHistoryWindow,
  getRepetitionContextKey,
} from '../../src/utils/chess-ai/chessAIRepetition';
import { getCommittedOpeningMove, getOpeningBookMove, wouldAllowImmediateMate } from '../../src/utils/chess-ai/chessAIOpeningRuntime';
import {
  clearTranspositionTable as clearSearchTable,
  lookupTT,
  makeTTKey,
  denormalizeMateScoreFromTT,
  normalizeMateScoreForTT,
  storeTT,
} from '../../src/utils/chess-ai/chessAITranspositionTable';
import {
  DEFAULT_AI_TUNING,
  applyHistoryBonus,
  applyHistoryMalus,
  clearHistory,
  clearTranspositionTable,
  clearCountermoves,
  getCountermoveScore,
  getGamePhaseForTesting,
  getHistoryScoreForMove,
  getLmrReduction,
  getAiTuning,
  getBestMove,
  hasStandardOpeningProvenance,
  getLastSearchDiagnostics,
  resolveSearchTimeLimit,
  evaluateBoardForTesting,
  resetAiTuning,
  resetOpeningState,
  recordCountermove,
  resolveSearchBudgetMs,
  setAiTuning,
  shouldApplyReverseFutilityPruning,
  shouldPruneMoveByFutility,
  shouldPruneMoveByLmp,
  shouldPruneQCaptureByDelta,
  shouldAllowNullMoveByStaticEval,
} from '../../src/utils/chessAI';

test('hard mode should provide move variety from the starting position', { timeout: 60_000 }, () => {
  const originalRandom = Math.random;
  const sequence = [0.02, 0.38, 0.71, 0.95, 0.14, 0.52, 0.83, 0.27];
  let cursor = 0;
  Math.random = () => {
    const value = sequence[cursor % sequence.length];
    cursor += 1;
    return value;
  };

  try {
    const uniqueMoves = new Set<string>();
    for (let i = 0; i < 8; i += 1) {
      const game = new Chess();
      const move = getBestMove(game, 'hard');
      assert.ok(move, 'expected AI to choose a move');
      uniqueMoves.add(move as string);
    }
    assert.ok(uniqueMoves.size > 1, `expected variety in hard mode, got only: ${[...uniqueMoves].join(', ')}`);
  } finally {
    Math.random = originalRandom;
  }
});

test('hard mode should avoid immediate non-capturing backtrack move when alternatives exist', { timeout: 60_000 }, () => {
  resetOpeningState();
  clearTranspositionTable();
  const game = new Chess();
  game.move('b4');
  game.move('Nc6');
  game.move('Bb2');
  game.move('Nxb4');
  game.move('h3');
  game.move('Rb8');
  game.move('Nf3');

  const bestMove = getBestMove(game, 'hard');
  assert.ok(bestMove, 'expected AI to choose a move');
  assert.notEqual(bestMove, 'Ra8', 'expected AI to avoid immediate rook shuffle Ra8');
});

test('hard mode should keep taking forced checkmate in one', { timeout: 60_000 }, () => {
  resetOpeningState();
  clearTranspositionTable();
  const game = new Chess('7k/5Q2/6K1/8/8/8/8/8 w - - 0 1');
  const bestMove = getBestMove(game, 'hard');
  assert.ok(bestMove, 'expected a mating move');

  const after = new Chess(game.fen());
  const applied = after.move(bestMove as string);
  assert.ok(applied, 'expected selected move to be legal');
  assert.ok(after.isCheckmate(), `expected checkmate in one, got ${bestMove}`);
});

test('minimax scores stalemate as a draw even when null-move pruning could fail high', () => {
  // White (the AI) is stalemated but owns a knight, and black has enough
  // material for null-move pruning to be allowed. With a low beta a null-move
  // search would fail high; the stalemate must be recognised first.
  const game = new Chess('4k2r/8/8/8/6p1/1q3pP1/5P2/K6N w - - 0 1');
  assert.ok(game.isStalemate(), 'expected a stalemate fixture');
  clearSearchTable();
  setSearchDeadline(Infinity);
  searchState.searchAborted = false;
  const score = minimax(game, 3, -6000, -5000, true, 'w', DEFAULT_AI_TUNING);
  assert.equal(score, drawScore(game, 'w', DEFAULT_AI_TUNING));
});

test('minimax reports checkmate rather than a 50-move draw', () => {
  const game = new Chess('7k/6Q1/5K2/8/8/8/8/8 b - - 100 1');
  assert.ok(game.isCheckmate(), 'expected a checkmate fixture');
  clearSearchTable();
  setSearchDeadline(Infinity);
  searchState.searchAborted = false;
  assert.equal(minimax(game, 2, -Infinity, Infinity, true, 'b', DEFAULT_AI_TUNING), -MATE_SCORE);
  assert.equal(minimax(game, 2, -Infinity, Infinity, false, 'w', DEFAULT_AI_TUNING), MATE_SCORE);
});

test('quiescence should search forced evasions instead of using stand-pat while in check', () => {
  const game = new Chess('r1bq1k2/2p3pr/1p2p2p/p2p1P2/1nP2P2/PPn4B/RNQ1P2P/1N1K3R w - - 2 17');
  const standPat = evaluateBoardForTesting(game, 'w', DEFAULT_AI_TUNING);

  resetSearchCounters();
  searchState.searchAborted = false;
  setSearchDeadline(Infinity);
  try {
    const result = quiescence(game, -Infinity, Infinity, true, 'w', DEFAULT_AI_TUNING);
    assert.ok(result < standPat, `expected a forced evasion score below stand-pat (${standPat}), got ${result}`);
  } finally {
    searchState.searchAborted = false;
    setSearchDeadline(Infinity);
  }
});

test('quiescence preserves stand-pat even when searching a defended losing capture', () => {
  // Qxd5?? exd5 is unattractive, but geometric defenders are not
  // sufficient proof for safe pruning. Stand-pat still wins.
  const game = new Chess('4k3/8/4p3/3p4/8/8/8/3QK3 w - - 0 1');
  resetSearchCounters();
  searchState.searchAborted = false;
  setSearchDeadline(Infinity);
  const standPat = evaluateBoardForTesting(game, 'w', DEFAULT_AI_TUNING);
  const result = quiescence(game, -Infinity, Infinity, true, 'w', DEFAULT_AI_TUNING);
  assert.equal(result, standPat);
  assert.ok(searchState.qNodeCount > 1, 'even defended captures must be searched');
});

test('quiescence still searches equal trades and winning captures', () => {
  setSearchDeadline(Infinity);
  searchState.searchAborted = false;

  // Bxc6 bxc6 is an even trade (bishop 330 vs knight 320) and must be explored.
  const trade = new Chess('4k3/1p6/2n5/8/4B3/8/8/4K3 w - - 0 1');
  resetSearchCounters();
  quiescence(trade, -Infinity, Infinity, true, 'w', DEFAULT_AI_TUNING);
  assert.ok(searchState.qNodeCount > 1, 'expected the even bishop-for-knight trade to be searched');

  // exd5 wins a queen for a pawn.
  const winning = new Chess('4k3/8/8/3q4/4P3/8/8/4K3 w - - 0 1');
  const standPat = evaluateBoardForTesting(winning, 'w', DEFAULT_AI_TUNING);
  const result = quiescence(winning, -Infinity, Infinity, true, 'w', DEFAULT_AI_TUNING);
  assert.ok(result > standPat + 600, `expected exd5 to be found, got ${result} vs stand-pat ${standPat}`);
});

test('quiescence should stop when the search deadline has expired', () => {
  resetSearchCounters();
  searchState.searchAborted = false;
  setSearchDeadline(performance.now() - 1);
  try {
    const result = quiescence(new Chess(), -Infinity, Infinity, true, 'w', DEFAULT_AI_TUNING);
    assert.equal(result, 0);
    assert.equal(searchState.searchAborted, true);
  } finally {
    searchState.searchAborted = false;
    setSearchDeadline(Infinity);
  }
});

test('quiescence should report checkmate before a 50-move draw', () => {
  const checkmateAtDrawBoundary = new Chess('7k/6Q1/5K2/8/8/8/8/8 b - - 100 1');
  assert.ok(checkmateAtDrawBoundary.isCheckmate(), 'expected a checkmate position');
  const result = quiescence(
    checkmateAtDrawBoundary,
    -Infinity,
    Infinity,
    true,
    'b',
    DEFAULT_AI_TUNING,
  );
  assert.equal(result, -MATE_SCORE);
});

test('search should always examine at least one move when late-move pruning skips quiet moves', () => {
  const game = new Chess();
  const result = searchPvsMoves({
    game,
    rawMoves: game.moves({ verbose: true }),
    board: game.board(),
    depth: 1,
    alpha: 0,
    beta: 1,
    isMaximizingPlayer: true,
    color: 'w',
    tuning: DEFAULT_AI_TUNING,
    ply: 0,
    isPvNode: false,
    inCheck: false,
    isImproving: false,
    ttBestMove: 0,
    getStaticEval: () => -1000,
    recurse: () => 0,
  });

  assert.ok(result.bestMove, 'expected a fallback move to be searched');
  assert.ok(Number.isFinite(result.bestVal), `expected a finite score, got ${result.bestVal}`);
});

test('root PVS should re-search bound-only moves that can enter the selection band', () => {
  const game = new Chess();
  const legalMoves = game.moves({ verbose: true });
  const firstMove = legalMoves.find((move) => move.san === 'e4');
  const secondMove = legalMoves.find((move) => move.san === 'd4');
  assert.ok(firstMove && secondMove, 'expected e4 and d4 to be legal root moves');

  const calls = new Map<string, Array<[number, number]>>();
  const result = searchRootDepth({
    game,
    itMoves: [
      { move: firstMove, rawScore: 1000 },
      { move: secondMove, rawScore: 0 },
    ],
    depth: 1,
    color: 'w',
    difficulty: 'hard',
    openingPhase: false,
    tuning: DEFAULT_AI_TUNING,
    recurse: (_game, _depth, alpha, beta, _isMaximizing, _color, _tuning, _ply, _allowNullMove, _prevMax, _prevMin, previousMove) => {
      const key = `${previousMove?.from}${previousMove?.to}`;
      const moveCalls = calls.get(key) ?? [];
      moveCalls.push([alpha, beta]);
      calls.set(key, moveCalls);
      return key === 'e2e4' ? 100 : 95;
    },
  });

  assert.equal(result.completed, true);
  assert.equal(result.scores?.[0], 100);
  assert.equal(result.scores?.[1], 95);
  // Probe whether d4 reaches the hard band edge (100 - hardBand), then
  // resolve its exact score in a window bounded below by that edge instead of
  // an unbounded full-width re-search.
  const bandEdge = 100 - DEFAULT_AI_TUNING.hardBand;
  assert.deepEqual(calls.get('d2d4'), [[bandEdge - 1, bandEdge], [bandEdge - 1, Infinity]]);
});

test('root PVS should exactify a band fail-high whose narrow re-search lands on the band edge', () => {
  const game = new Chess();
  const legalMoves = game.moves({ verbose: true });
  const firstMove = legalMoves.find((move) => move.san === 'e4');
  const secondMove = legalMoves.find((move) => move.san === 'd4');
  assert.ok(firstMove && secondMove, 'expected e4 and d4 to be legal root moves');

  const calls: Array<[number, number]> = [];
  const result = searchRootDepth({
    game,
    itMoves: [
      { move: firstMove, rawScore: 1000 },
      { move: secondMove, rawScore: 0 },
    ],
    depth: 1,
    color: 'w',
    difficulty: 'hard',
    openingPhase: false,
    tuning: DEFAULT_AI_TUNING,
    recurse: (_game, _depth, alpha, beta, _isMaximizing, _color, _tuning, _ply, _allowNullMove, _prevMax, _prevMin, previousMove) => {
      if (previousMove?.from === 'd2') {
        calls.push([alpha, beta]);
        if (calls.length === 1) return beta;
        if (calls.length === 2) return alpha;
        return 95;
      }
      return 100;
    },
  });

  assert.equal(result.completed, true);
  assert.deepEqual(result.scores, [100, 95]);
  const bandEdge = 100 - DEFAULT_AI_TUNING.hardBand;
  assert.deepEqual(calls, [[bandEdge - 1, bandEdge], [bandEdge - 1, Infinity], [-Infinity, Infinity]]);
});

test('root PVS should discard out-of-band fail-low bounds instead of selecting them', () => {
  const game = new Chess();
  const legalMoves = game.moves({ verbose: true });
  const firstMove = legalMoves.find((move) => move.san === 'e4');
  const secondMove = legalMoves.find((move) => move.san === 'd4');
  assert.ok(firstMove && secondMove, 'expected e4 and d4 to be legal root moves');

  const calls: Array<[number, number]> = [];
  const result = searchRootDepth({
    game,
    itMoves: [
      { move: firstMove, rawScore: 1000 },
      { move: secondMove, rawScore: 0 },
    ],
    depth: 1,
    color: 'w',
    difficulty: 'hard',
    openingPhase: false,
    tuning: { ...DEFAULT_AI_TUNING, hardBand: 1 },
    recurse: (_game, _depth, alpha, beta, _isMaximizing, _color, _tuning, _ply, _allowNullMove, _prevMax, _prevMin, previousMove) => {
      if (previousMove?.from === 'd2') calls.push([alpha, beta]);
      return previousMove?.from === 'e2' ? 100 : 90;
    },
  });

  assert.equal(result.completed, true);
  assert.deepEqual(result.scores, [100, -Infinity]);
  assert.deepEqual(calls, [[98, 99]]);
});

test('root PVS should include the exact lower edge of the selection band', () => {
  const game = new Chess();
  const legalMoves = game.moves({ verbose: true });
  const firstMove = legalMoves.find((move) => move.san === 'e4');
  const secondMove = legalMoves.find((move) => move.san === 'd4');
  assert.ok(firstMove && secondMove, 'expected e4 and d4 to be legal root moves');

  const calls: Array<[number, number]> = [];
  const result = searchRootDepth({
    game,
    itMoves: [
      { move: firstMove, rawScore: 1000 },
      { move: secondMove, rawScore: 0 },
    ],
    depth: 1,
    color: 'w',
    difficulty: 'hard',
    openingPhase: false,
    tuning: { ...DEFAULT_AI_TUNING, hardBand: 5 },
    recurse: (_game, _depth, alpha, beta, _isMaximizing, _color, _tuning, _ply, _allowNullMove, _prevMax, _prevMin, previousMove) => {
      if (previousMove?.from === 'd2') calls.push([alpha, beta]);
      return previousMove?.from === 'e2' ? 100 : 95;
    },
  });

  assert.equal(result.completed, true);
  assert.deepEqual(result.scores, [100, 95]);
  assert.deepEqual(calls, [[94, 95], [94, Infinity]]);
});

test('root PVS for expert probes against the best score without a selection band', () => {
  const game = new Chess();
  const legalMoves = game.moves({ verbose: true });
  const firstMove = legalMoves.find((move) => move.san === 'e4');
  const secondMove = legalMoves.find((move) => move.san === 'd4');
  assert.ok(firstMove && secondMove, 'expected e4 and d4 to be legal root moves');

  const calls: Array<[number, number]> = [];
  const result = searchRootDepth({
    game,
    itMoves: [
      { move: firstMove, rawScore: 1000 },
      { move: secondMove, rawScore: 0 },
    ],
    depth: 1,
    color: 'w',
    difficulty: 'expert',
    openingPhase: false,
    tuning: DEFAULT_AI_TUNING,
    recurse: (_game, _depth, alpha, beta, _isMaximizing, _color, _tuning, _ply, _allowNullMove, _prevMax, _prevMin, previousMove) => {
      if (previousMove?.from === 'd2') calls.push([alpha, beta]);
      return previousMove?.from === 'e2' ? 100 : 95;
    },
  });

  assert.equal(result.completed, true);
  assert.deepEqual(result.scores, [100, -Infinity]);
  assert.deepEqual(calls, [[100, 101]]);
});

test('root aspiration retries should not commit partial scores', () => {
  const game = new Chess();
  const legalMoves = game.moves({ verbose: true });
  const firstMove = legalMoves.find((move) => move.san === 'e4');
  const secondMove = legalMoves.find((move) => move.san === 'd4');
  assert.ok(firstMove && secondMove, 'expected e4 and d4 to be legal root moves');

  const firstCalls: Array<[number, number]> = [];
  const result = searchRootDepth({
    game,
    itMoves: [
      { move: firstMove, rawScore: 1000 },
      { move: secondMove, rawScore: 0 },
    ],
    depth: 2,
    color: 'w',
    difficulty: 'hard',
    openingPhase: false,
    tuning: { ...DEFAULT_AI_TUNING, hardBand: 1 },
    recurse: (_game, _depth, alpha, beta, _isMaximizing, _color, _tuning, _ply, _allowNullMove, _prevMax, _prevMin, previousMove) => {
      if (previousMove?.from === 'e2') firstCalls.push([alpha, beta]);
      return previousMove?.from === 'e2' ? 10 : 5;
    },
  });

  assert.equal(result.completed, true);
  assert.deepEqual(result.scores, [10, -Infinity]);
  assert.deepEqual(firstCalls, [[950, 1050], [-Infinity, 1050]]);
});

test('search hints from earlier root moves are visible within the same iteration', () => {
  // TT entries and move-ordering hints used to be buffered until a whole root
  // iteration finished, so PVS/LMR re-searches and sibling nodes could not use
  // them. Entries only come from fully searched subtrees, so they are safe to
  // publish immediately.
  clearKillers();
  clearHistory();
  clearCountermoves();
  clearSearchTable();
  searchState.searchAborted = false;

  const game = new Chess();
  const legalMoves = game.moves({ verbose: true });
  const firstMove = legalMoves.find((move) => move.san === 'e4');
  const secondMove = legalMoves.find((move) => move.san === 'd4');
  assert.ok(firstMove && secondMove, 'expected e4 and d4 to be legal root moves');
  const quietReply = legalMoves.find((move) => move.san === 'Nf3');
  assert.ok(quietReply, 'expected Nf3 to be legal');
  const seenBySecondMove: Array<number | undefined> = [];

  const result = searchRootDepth({
    game,
    itMoves: [
      { move: firstMove, rawScore: 1000 },
      { move: secondMove, rawScore: 0 },
    ],
    depth: 1,
    color: 'w',
    difficulty: 'hard',
    openingPhase: false,
    tuning: DEFAULT_AI_TUNING,
    recurse: (_game, _depth, _alpha, _beta, _isMaximizing, _color, _tuning, _ply, _allowNullMove, _prevMax, _prevMin, previousRootMove) => {
      if (previousRootMove?.from === 'e2') {
        storeTT('same-iteration-entry', 123, 2, 'exact', firstMove);
        storeKiller(quietReply, 1);
        applyHeuristicHistoryBonus(quietReply, 20);
        return 100;
      }
      seenBySecondMove.push(lookupTT('same-iteration-entry', 2)?.score);
      return 90;
    },
  });

  assert.equal(result.completed, true);
  assert.equal(seenBySecondMove[0], 123);
  assert.equal(killerScore(quietReply, 1), 90);
  assert.ok(getHistoryScoreForMove(quietReply) > 0);
  clearSearchTable();
  clearKillers();
  clearHistory();
});

test('an aborted root depth reports incomplete and restores the board', () => {
  searchState.searchAborted = false;
  const game = new Chess();
  const legalMoves = game.moves({ verbose: true });
  const firstMove = legalMoves.find((move) => move.san === 'e4');
  const secondMove = legalMoves.find((move) => move.san === 'd4');
  assert.ok(firstMove && secondMove, 'expected e4 and d4 to be legal root moves');
  const startFen = game.fen();
  let calls = 0;

  const result = searchRootDepth({
    game,
    itMoves: [
      { move: firstMove, rawScore: 1000 },
      { move: secondMove, rawScore: 0 },
    ],
    depth: 1,
    color: 'w',
    difficulty: 'hard',
    openingPhase: false,
    tuning: DEFAULT_AI_TUNING,
    recurse: () => {
      calls += 1;
      if (calls === 2) searchState.searchAborted = true;
      return 100;
    },
  });

  assert.equal(result.completed, false);
  assert.equal(game.fen(), startFen);
  searchState.searchAborted = false;
});

test('aborted PVS nodes should not update move-ordering heuristics', () => {
  clearKillers();
  clearHistory();
  clearCountermoves();
  searchState.searchAborted = false;

  const game = new Chess();
  const rawMoves = game.moves({ verbose: true });
  const result = searchPvsMoves({
    game,
    rawMoves,
    board: game.board(),
    depth: 2,
    alpha: 0,
    beta: 1,
    isMaximizingPlayer: true,
    color: 'w',
    tuning: DEFAULT_AI_TUNING,
    ply: 0,
    isPvNode: false,
    inCheck: false,
    isImproving: false,
    previousMove: { from: 'e7', to: 'e5', promotion: undefined },
    ttBestMove: 0,
    getStaticEval: () => 0,
    recurse: () => {
      searchState.searchAborted = true;
      return 1;
    },
  });

  const searchedMove = rawMoves[0];
  assert.equal(result.bestMove, null);
  assert.equal(searchState.searchAborted, true);
  assert.equal(killerScore(searchedMove, 0), 0);
  assert.equal(getHistoryScore(searchedMove), 0);
  assert.equal(getCountermoveScore('w', { from: 'e7', to: 'e5', promotion: undefined }, searchedMove), 0);
  searchState.searchAborted = false;
});

test('expert fallback selection should not consume randomization', { timeout: 60_000 }, () => {
  const originalRandom = Math.random;
  Math.random = () => {
    throw new Error('expert fallback must be deterministic');
  };

  try {
    const game = new Chess('8/8/8/8/8/8/P7/K1k5 w - - 0 1');
    const move = getBestMove(game, 'expert', { openingBookEnabled: false }, 5);
    assert.ok(move, 'expected expert fallback to return a legal move');
  } finally {
    Math.random = originalRandom;
    searchState.searchAborted = false;
  }
});

test('opening book should only match the exact current move sequence', () => {
  const exact = new Chess();
  ['e4', 'e5', 'Nf3'].forEach((move) => exact.move(move));
  const exactMove = getOpeningBookMove(exact, DEFAULT_AI_TUNING);
  assert.ok(['Nc6', 'Nf6'].includes(exactMove ?? ''), `expected an exact opening reply, got ${exactMove}`);

  const extended = new Chess();
  ['e4', 'e5', 'Nf3', 'd6', 'd4'].forEach((move) => extended.move(move));
  assert.equal(getOpeningBookMove(extended, DEFAULT_AI_TUNING), null);
});

test('general opening book should reject moves that allow an immediate mate', () => {
  const game = new Chess('4k2r/8/8/8/2b4q/8/P4PPP/6K1 w - - 0 1');
  assert.equal(getOpeningBookMove(game, DEFAULT_AI_TUNING, [
    { sequence: [], replies: ['a2a3'] },
  ]), null);
});

test('committed opening runtime rejects a line when an earlier move deviated', () => {
  const game = new Chess();
  game.move('d4');
  game.move('e5');

  assert.equal(getCommittedOpeningMove(game, 'w', 2, {
    name: 'history guard',
    aiColor: 'w',
    moves: ['e2e4', 'e7e5', 'g1f3'],
  }), null);
});

test('committed opening lines should stop when the planned move allows immediate mate', () => {
  const game = new Chess('4k2r/8/8/8/2b4q/8/P4PPP/6K1 w - - 0 1');
  const quietMove = (game.moves({ verbose: true })).find((move) => move.san === 'a3');
  assert.ok(quietMove, 'expected the test position to contain the quiet move a3');
  assert.equal(wouldAllowImmediateMate(game, quietMove), true);
});

test('committed opening runtime applies the mate guard before returning its planned move', () => {
  const game = new Chess('4k2r/8/8/8/2b4q/8/P4PPP/6K1 w - - 0 1');

  assert.equal(getCommittedOpeningMove(game, 'w', 0, {
    name: 'test threat',
    aiColor: 'w',
    moves: ['a2a3'],
  }), null);
});

test('TS search gives medium and hard larger default time budgets', () => {
  assert.equal(resolveSearchTimeLimit('medium', undefined), 3000);
  assert.equal(resolveSearchTimeLimit('hard', undefined), 10_000);
  assert.equal(resolveSearchTimeLimit('expert', undefined), 3000);
});

test('medium and hard default tuning keeps move selection close to the best move', () => {
  assert.equal(DEFAULT_AI_TUNING.mediumBand, 18);
  assert.equal(DEFAULT_AI_TUNING.mediumNoise, 8);
  assert.equal(DEFAULT_AI_TUNING.hardBand, 6);
  assert.equal(DEFAULT_AI_TUNING.hardCandidateCap, 2);
});

test('TS search time limits normalize invalid and unbounded requests', () => {
  assert.equal(resolveSearchTimeLimit('medium', undefined), 3000);
  assert.equal(resolveSearchTimeLimit('medium', 0), 3000);
  assert.equal(resolveSearchTimeLimit('medium', -10), 3000);
  assert.equal(resolveSearchTimeLimit('medium', Number.NaN), 3000);
  assert.equal(resolveSearchTimeLimit('medium', Number.POSITIVE_INFINITY), 3000);
  assert.equal(resolveSearchTimeLimit('medium', 0.5), 1);
  assert.equal(resolveSearchTimeLimit('medium', 50_000), 20_000);
});

test('TS search reserves a bounded finalization margin from its time budget', () => {
  assert.equal(resolveSearchBudgetMs(1500), 1475);
  assert.equal(resolveSearchBudgetMs(25), 1);
  assert.equal(resolveSearchBudgetMs(1), 1);
});

test('transposition keys include search color and tuning context', () => {
  const fen = new Chess().fen();
  assert.notEqual(makeTTKey(fen, 'w:balanced'), makeTTKey(fen, 'b:balanced'));
  assert.notEqual(makeTTKey(fen, 'w:balanced'), makeTTKey(fen, 'w:aggressive'));
  assert.equal(makeTTKey(fen, 'w:balanced'), makeTTKey(fen, 'w:balanced'));
});

test('transposition table rejects a different key whose index hash fully collides', () => {
  // Both keys share the same 32-bit FNV-1a hash, which used to provide both
  // the slot index and the collision guard, so one position's score leaked
  // into the other's search.
  const fnv1a32 = (value: string): number => {
    let hash = 0x811c9dc5;
    for (let i = 0; i < value.length; i += 1) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash;
  };
  const storedKey = '8/8/8/8/8/8/8/K6k w - - 0|probe-122789';
  const collidingKey = '8/8/8/8/8/8/8/K6k w - - 0|probe-339192';
  assert.equal(fnv1a32(storedKey), fnv1a32(collidingKey), 'fixture keys must collide under FNV-1a');

  clearSearchTable();
  try {
    storeTT(storedKey, 777, 4, 'exact', null);
    assert.equal(lookupTT(storedKey, 4)?.score, 777);
    assert.equal(lookupTT(collidingKey, 1), undefined);
  } finally {
    clearSearchTable();
  }
});

test('mate scores normalize across transposition-table search plies', () => {
  const scoreAtPlyFour = MATE_SCORE - 4;
  const stored = normalizeMateScoreForTT(scoreAtPlyFour, 4);
  assert.equal(stored, MATE_SCORE);
  assert.equal(denormalizeMateScoreFromTT(stored, 2), MATE_SCORE - 2);

  const matedAtPlyFour = -(MATE_SCORE - 4);
  const storedMated = normalizeMateScoreForTT(matedAtPlyFour, 4);
  assert.equal(storedMated, -MATE_SCORE);
  assert.equal(denormalizeMateScoreFromTT(storedMated, 2), -(MATE_SCORE - 2));
});

test('opening provenance distinguishes standard history from FEN-only positions', () => {
  assert.equal(hasStandardOpeningProvenance(new Chess()), true);
  assert.equal(
    hasStandardOpeningProvenance(new Chess('4k3/8/8/8/8/8/4P3/4K3 w - - 0 1')),
    false,
  );
});

test('repetition context changes across reversible history and resets after an irreversible move', () => {
  const game = new Chess();
  game.move('e4');
  game.move('e5');
  const afterPawnMoves = getRepetitionContextKey(createRepetitionContext(game));
  game.move('Nf3');
  const afterReversibleMove = getRepetitionContextKey(createRepetitionContext(game));
  assert.notEqual(afterReversibleMove, afterPawnMoves);

  game.move('d6');
  const afterAnotherPawnMove = getRepetitionContextKey(createRepetitionContext(game));
  assert.equal(afterAnotherPawnMove, afterPawnMoves);
});

test('long games keep a bounded, replayable history window after the last irreversible move', () => {
  const game = new Chess();
  for (let i = 0; i < 128; i += 1) {
    game.move('Nf3');
    game.move('Nf6');
    game.move('Ng1');
    game.move('Ng8');
  }
  game.move('e4');
  game.move('Nf6');
  game.move('Nf3');
  game.move('Ng8');

  const window = getAiHistoryWindow(game, 8);
  assert.equal(window.history.length, 3);
  assert.equal(window.historyStartFen, 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 257');
  assert.equal(window.historyTruncated, true);

  const replay = new Chess(window.historyStartFen);
  for (const uci of window.history) {
    replay.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] as 'q' | 'r' | 'b' | 'n' | undefined });
  }
  assert.equal(replay.fen(), game.fen());
});

test('root search keeps a depth that finished without being aborted, even past its deadline', () => {
  // Real searches set searchAborted as soon as they notice the deadline, so a
  // depth that finishes un-aborted has complete scores and is worth keeping.
  const game = new Chess();
  const firstMove = game.moves({ verbose: true }).find((move) => move.san === 'e4');
  assert.ok(firstMove, 'expected e4 to be legal');
  searchState.searchAborted = false;
  setSearchDeadline(performance.now() - 1);

  try {
    const result = searchRootDepth({
      game,
      itMoves: [{ move: firstMove, rawScore: 0 }],
      depth: 1,
      color: 'w',
      difficulty: 'hard',
      openingPhase: false,
      tuning: DEFAULT_AI_TUNING,
      recurse: () => 100,
    });

    assert.equal(result.completed, true);
    assert.deepEqual(result.scores, [100]);
    assert.equal(game.fen(), new Chess().fen());
  } finally {
    searchState.searchAborted = false;
    setSearchDeadline(Infinity);
  }
});

test('returns null when game is already over by insufficient material', () => {
  const game = new Chess('8/8/8/8/8/8/8/K1k5 w - - 0 1');
  assert.ok(game.isInsufficientMaterial(), 'expected insufficient material');
  assert.ok(game.isGameOver(), 'expected game-over state');
  assert.ok(game.moves().length > 0, 'expected legal moves to still exist');

  assert.equal(getBestMove(game, 'easy'), null);
  assert.equal(getBestMove(game, 'hard', { openingBookEnabled: false }), null);
});

test('returns null when game is already over by threefold repetition', () => {
  const game = new Chess();
  ['Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3', 'Nf6', 'Ng1', 'Ng8'].forEach((move) => {
    game.move(move);
  });
  assert.ok(game.isThreefoldRepetition(), 'expected threefold repetition');
  assert.ok(game.isGameOver(), 'expected game-over state');
  assert.ok(game.moves().length > 0, 'expected legal moves to still exist');

  assert.equal(getBestMove(game, 'easy'), null);
  assert.equal(getBestMove(game, 'hard', { openingBookEnabled: false }), null);
});

test('hard mode should use opening book in early game', () => {
  const originalRandom = Math.random;
  Math.random = () => 0;

  try {
    resetAiTuning();
    const game = new Chess();
    game.move('e4');
    game.move('e5');

    const bestMove = getBestMove(game, 'hard');
    assert.equal(bestMove, 'Nf3');
  } finally {
    Math.random = originalRandom;
    resetAiTuning();
  }
});

test('search diagnostics should expose node counters after a search', () => {
  resetOpeningState();
  clearTranspositionTable();
  const game = new Chess('2k5/8/8/3p4/4b3/8/3R4/2K5 w - - 0 1');
  const move = getBestMove(
    game,
    'hard',
    {
      openingBookEnabled: false,
      enableNmpStaticGuard: true,
      enableQDelta: true,
      enableRfp: true,
      enableFp: true,
      enableLmp: true,
    },
    300,
  );
  assert.ok(move, 'expected search to produce a legal move');

  const diag = getLastSearchDiagnostics();
  assert.ok(diag.nodes >= 0, `expected nodes >= 0, got ${diag.nodes}`);
  assert.ok(diag.qNodes >= 0, `expected qNodes >= 0, got ${diag.qNodes}`);
  assert.ok(diag.completedDepth >= 0, `expected completedDepth >= 0, got ${diag.completedDepth}`);
  assert.ok(
    diag.completedDepth === 0 || diag.nodes > 0,
    `expected searched depth to imply node visits (depth=${diag.completedDepth}, nodes=${diag.nodes})`,
  );
});

test('supports runtime AI tuning overrides and reset', () => {
  resetAiTuning();
  const before = getAiTuning();
  assert.deepEqual(before, DEFAULT_AI_TUNING);

  const patched = setAiTuning({
    backtrackPenalty: 120,
    openingBookEnabled: false,
    openingBookMaxPly: 6,
    enableNmpStaticGuard: true,
    nmpStaticGuardMargin: 90,
    enableRfp: true,
    rfpDepthLimit: 2,
    rfpMarginBase: 110,
    rfpMarginPerDepth: 50,
    enableFp: true,
    fpDepthLimit: 2,
    fpMarginBase: 110,
    fpMarginPerDepth: 60,
    enableLmp: true,
    lmpDepthLimit: 2,
    lmpMoveCountBase: 6,
    lmpMoveCountPerDepth: 2,
    lmpEvalMarginBase: 160,
    lmpEvalMarginPerDepth: 80,
    enableLmrTable: true,
    enableHistoryMalus: true,
    enableCountermove: true,
    enableTaperedEval: true,
    enableNonlinearKingSafety: true,
    enableBackwardPawn: true,
    enableKnightOutpost: true,
    enablePassedPawnKingDistance: true,
    enableRookBehindPassedPawn: true,
    enableTempoBonus: true,
  });

  assert.equal(patched.backtrackPenalty, 120);
  assert.equal(patched.openingBookEnabled, false);
  assert.equal(patched.openingBookMaxPly, 6);
  assert.equal(patched.enableNmpStaticGuard, true);
  assert.equal(patched.nmpStaticGuardMargin, 90);
  assert.equal(patched.enableRfp, true);
  assert.equal(patched.rfpDepthLimit, 2);
  assert.equal(patched.rfpMarginBase, 110);
  assert.equal(patched.rfpMarginPerDepth, 50);
  assert.equal(patched.enableFp, true);
  assert.equal(patched.fpDepthLimit, 2);
  assert.equal(patched.fpMarginBase, 110);
  assert.equal(patched.fpMarginPerDepth, 60);
  assert.equal(patched.enableLmp, true);
  assert.equal(patched.lmpDepthLimit, 2);
  assert.equal(patched.lmpMoveCountBase, 6);
  assert.equal(patched.lmpMoveCountPerDepth, 2);
  assert.equal(patched.lmpEvalMarginBase, 160);
  assert.equal(patched.lmpEvalMarginPerDepth, 80);
  assert.equal(patched.enableLmrTable, true);
  assert.equal(patched.enableHistoryMalus, true);
  assert.equal(patched.enableCountermove, true);
  assert.equal(patched.enableTaperedEval, true);
  assert.equal(patched.enableNonlinearKingSafety, true);
  assert.equal(patched.enableBackwardPawn, true);
  assert.equal(patched.enableKnightOutpost, true);
  assert.equal(patched.enablePassedPawnKingDistance, true);
  assert.equal(patched.enableRookBehindPassedPawn, true);
  assert.equal(patched.enableTempoBonus, true);
  assert.equal(getAiTuning().backtrackPenalty, 120);

  const reset = resetAiTuning();
  assert.deepEqual(reset, DEFAULT_AI_TUNING);
  assert.deepEqual(getAiTuning(), DEFAULT_AI_TUNING);
});

test('default tuning should enable validated feature pack while keeping RFP disabled', () => {
  const defaults = resetAiTuning();

  assert.equal(defaults.enableNmpStaticGuard, true);
  assert.equal(defaults.enableQDelta, true);
  assert.equal(defaults.enableRfp, false);
  assert.equal(defaults.enableFp, true);
  assert.equal(defaults.enableLmp, true);
  assert.equal(defaults.enableLmrTable, true);
  assert.equal(defaults.enableHistoryMalus, true);
  assert.equal(defaults.enableCountermove, true);
  assert.equal(defaults.enableTaperedEval, true);
  assert.equal(defaults.enableNonlinearKingSafety, true);
  assert.equal(defaults.enableBackwardPawn, true);
  assert.equal(defaults.enableKnightOutpost, true);
  assert.equal(defaults.enablePassedPawnKingDistance, true);
  assert.equal(defaults.enableRookBehindPassedPawn, true);
  assert.equal(defaults.enableTempoBonus, true);
});

test('NMP static guard helper should honor flag and margin', () => {
  assert.equal(
    shouldAllowNullMoveByStaticEval(50, 120, {
      ...DEFAULT_AI_TUNING,
      enableNmpStaticGuard: false,
      nmpStaticGuardMargin: 120,
    }),
    true,
    'guard disabled: should always allow',
  );

  assert.equal(
    shouldAllowNullMoveByStaticEval(20, 120, {
      ...DEFAULT_AI_TUNING,
      enableNmpStaticGuard: true,
      nmpStaticGuardMargin: 60,
    }),
    false,
    'guard enabled: low static eval should block NMP',
  );

  assert.equal(
    shouldAllowNullMoveByStaticEval(70, 120, {
      ...DEFAULT_AI_TUNING,
      enableNmpStaticGuard: true,
      nmpStaticGuardMargin: 60,
    }),
    true,
    'guard enabled: static eval near beta should allow NMP',
  );
});

test('RFP helper should honor guards and side-to-move direction', () => {
  assert.equal(
    shouldApplyReverseFutilityPruning(
      {
        staticEval: 350,
        alpha: -100,
        beta: 100,
        depth: 1,
        isMaximizingPlayer: true,
        inCheck: false,
        isPvNode: false,
      },
      {
        ...DEFAULT_AI_TUNING,
        enableRfp: false,
      },
    ),
    false,
    'RFP disabled: should never prune',
  );

  assert.equal(
    shouldApplyReverseFutilityPruning(
      {
        staticEval: 350,
        alpha: -100,
        beta: 100,
        depth: 1,
        isMaximizingPlayer: true,
        inCheck: false,
        isPvNode: false,
      },
      {
        ...DEFAULT_AI_TUNING,
        enableRfp: true,
        rfpDepthLimit: 2,
        rfpMarginBase: 120,
        rfpMarginPerDepth: 60,
      },
    ),
    true,
    'maximizing node: high static eval should trigger RFP',
  );

  assert.equal(
    shouldApplyReverseFutilityPruning(
      {
        staticEval: -320,
        alpha: -100,
        beta: 100,
        depth: 1,
        isMaximizingPlayer: false,
        inCheck: false,
        isPvNode: false,
      },
      {
        ...DEFAULT_AI_TUNING,
        enableRfp: true,
        rfpDepthLimit: 2,
        rfpMarginBase: 120,
        rfpMarginPerDepth: 60,
      },
    ),
    true,
    'minimizing node: very low static eval should trigger mirrored RFP condition',
  );

  assert.equal(
    shouldApplyReverseFutilityPruning(
      {
        staticEval: 350,
        alpha: -100,
        beta: 100,
        depth: 3,
        isMaximizingPlayer: true,
        inCheck: false,
        isPvNode: false,
      },
      {
        ...DEFAULT_AI_TUNING,
        enableRfp: true,
        rfpDepthLimit: 2,
        rfpMarginBase: 120,
        rfpMarginPerDepth: 60,
      },
    ),
    false,
    'depth beyond limit: should not prune',
  );

  assert.equal(
    shouldApplyReverseFutilityPruning(
      {
        staticEval: 350,
        alpha: -100,
        beta: 100,
        depth: 1,
        isMaximizingPlayer: true,
        inCheck: true,
        isPvNode: false,
      },
      {
        ...DEFAULT_AI_TUNING,
        enableRfp: true,
      },
    ),
    false,
    'in-check nodes should not be pruned by RFP',
  );

  assert.equal(
    shouldApplyReverseFutilityPruning(
      {
        staticEval: 350,
        alpha: -100,
        beta: 100,
        depth: 1,
        isMaximizingPlayer: true,
        inCheck: false,
        isPvNode: true,
      },
      {
        ...DEFAULT_AI_TUNING,
        enableRfp: true,
      },
    ),
    false,
    'PV node should not be pruned by RFP',
  );
});

test('Q-search delta pruning helper should honor flag and margin', () => {
  assert.equal(
    shouldPruneQCaptureByDelta(100, 20, 200, {
      ...DEFAULT_AI_TUNING,
      enableQDelta: false,
      qDeltaMargin: 120,
    }),
    false,
    'delta disabled: should never prune',
  );

  assert.equal(
    shouldPruneQCaptureByDelta(100, 20, 260, {
      ...DEFAULT_AI_TUNING,
      enableQDelta: true,
      qDeltaMargin: 100,
    }),
    true,
    'delta enabled: low-gain capture should be pruned when far below alpha',
  );

  assert.equal(
    shouldPruneQCaptureByDelta(100, 90, 260, {
      ...DEFAULT_AI_TUNING,
      enableQDelta: true,
      qDeltaMargin: 100,
    }),
    false,
    'delta enabled: potentially useful capture should be kept',
  );
});

test('futility pruning helper should honor guards and side-to-move direction', () => {
  assert.equal(
    shouldPruneMoveByFutility(
      {
        staticEval: 0,
        alpha: 100,
        beta: 300,
        depth: 1,
        isMaximizingPlayer: true,
        inCheck: false,
        isPvNode: false,
        isQuiet: true,
      },
      {
        ...DEFAULT_AI_TUNING,
        enableFp: false,
      },
    ),
    false,
    'FP disabled: should never prune',
  );

  assert.equal(
    shouldPruneMoveByFutility(
      {
        staticEval: -180,
        alpha: 100,
        beta: 300,
        depth: 1,
        isMaximizingPlayer: true,
        inCheck: false,
        isPvNode: false,
        isQuiet: true,
      },
      {
        ...DEFAULT_AI_TUNING,
        enableFp: true,
        fpDepthLimit: 2,
        fpMarginBase: 200,
        fpMarginPerDepth: 80,
      },
    ),
    true,
    'maximizing node: low static eval should allow futility pruning',
  );

  assert.equal(
    shouldPruneMoveByFutility(
      {
        staticEval: 260,
        alpha: -200,
        beta: 100,
        depth: 1,
        isMaximizingPlayer: false,
        inCheck: false,
        isPvNode: false,
        isQuiet: true,
      },
      {
        ...DEFAULT_AI_TUNING,
        enableFp: true,
        fpDepthLimit: 2,
        fpMarginBase: 100,
        fpMarginPerDepth: 60,
      },
    ),
    true,
    'minimizing node: high static eval should allow mirrored futility pruning',
  );

  assert.equal(
    shouldPruneMoveByFutility(
      {
        staticEval: -180,
        alpha: 100,
        beta: 300,
        depth: 1,
        isMaximizingPlayer: true,
        inCheck: true,
        isPvNode: false,
        isQuiet: true,
      },
      {
        ...DEFAULT_AI_TUNING,
        enableFp: true,
      },
    ),
    false,
    'in-check nodes should not use futility pruning',
  );
});

test('LMP helper should honor depth, move index and static-eval guards', () => {
  assert.equal(
    shouldPruneMoveByLmp(
      {
        staticEval: -100,
        alpha: 80,
        beta: 300,
        depth: 2,
        moveIndex: 12,
        isMaximizingPlayer: true,
        inCheck: false,
        isPvNode: false,
        isQuiet: true,
      },
      {
        ...DEFAULT_AI_TUNING,
        enableLmp: false,
      },
    ),
    false,
    'LMP disabled: should never prune',
  );

  assert.equal(
    shouldPruneMoveByLmp(
      {
        staticEval: -220,
        alpha: 100,
        beta: 300,
        depth: 2,
        moveIndex: 12,
        isMaximizingPlayer: true,
        inCheck: false,
        isPvNode: false,
        isQuiet: true,
      },
      {
        ...DEFAULT_AI_TUNING,
        enableLmp: true,
        lmpDepthLimit: 3,
        lmpMoveCountBase: 6,
        lmpMoveCountPerDepth: 2,
        lmpEvalMarginBase: 120,
        lmpEvalMarginPerDepth: 70,
      },
    ),
    true,
    'late quiet move with weak static eval should be pruned by LMP',
  );

  assert.equal(
    shouldPruneMoveByLmp(
      {
        staticEval: -220,
        alpha: 100,
        beta: 300,
        depth: 2,
        moveIndex: 5,
        isMaximizingPlayer: true,
        inCheck: false,
        isPvNode: false,
        isQuiet: true,
      },
      {
        ...DEFAULT_AI_TUNING,
        enableLmp: true,
        lmpDepthLimit: 3,
        lmpMoveCountBase: 6,
        lmpMoveCountPerDepth: 2,
        lmpEvalMarginBase: 180,
        lmpEvalMarginPerDepth: 90,
      },
    ),
    false,
    'early move index should not be pruned by LMP',
  );

  assert.equal(
    shouldPruneMoveByLmp(
      {
        staticEval: -220,
        alpha: 100,
        beta: 300,
        depth: 2,
        moveIndex: 12,
        isMaximizingPlayer: true,
        inCheck: false,
        isPvNode: true,
        isQuiet: true,
      },
      {
        ...DEFAULT_AI_TUNING,
        enableLmp: true,
      },
    ),
    false,
    'PV node should not be pruned by LMP',
  );
});

test('LMR helper should honor flag, boundaries and correction terms', () => {
  assert.equal(
    getLmrReduction(
      {
        depth: 6,
        moveIndex: 8,
        inCheck: false,
        isPvNode: false,
        isQuiet: true,
        isImproving: false,
        killerMoveScore: 0,
        historyMoveScore: 0,
      },
      {
        ...DEFAULT_AI_TUNING,
        enableLmrTable: false,
      },
    ),
    1,
    'feature disabled: should fall back to legacy 1-ply reduction',
  );

  assert.equal(
    getLmrReduction(
      {
        depth: 6,
        moveIndex: 1,
        inCheck: false,
        isPvNode: false,
        isQuiet: true,
        isImproving: false,
        killerMoveScore: 0,
        historyMoveScore: 0,
      },
      {
        ...DEFAULT_AI_TUNING,
        enableLmrTable: true,
      },
    ),
    0,
    'first non-PV reply is not late enough for LMR',
  );

  const base = getLmrReduction(
    {
      depth: 10,
      moveIndex: 12,
      inCheck: false,
      isPvNode: false,
      isQuiet: true,
      isImproving: false,
      killerMoveScore: 0,
      historyMoveScore: 0,
    },
    {
      ...DEFAULT_AI_TUNING,
      enableLmrTable: true,
    },
  );
  assert.ok(base >= 1, `expected base reduction >= 1, got ${base}`);

  const corrected = getLmrReduction(
    {
      depth: 10,
      moveIndex: 12,
      inCheck: false,
      isPvNode: false,
      isQuiet: true,
      isImproving: true,
      killerMoveScore: 90,
      historyMoveScore: 60,
    },
    {
      ...DEFAULT_AI_TUNING,
      enableLmrTable: true,
    },
  );
  assert.ok(
    corrected < base,
    `expected correction terms to reduce LMR amount (base=${base}, corrected=${corrected})`,
  );

  assert.equal(
    getLmrReduction(
      {
        depth: 2,
        moveIndex: 20,
        inCheck: false,
        isPvNode: false,
        isQuiet: true,
        isImproving: false,
        killerMoveScore: 0,
        historyMoveScore: 0,
      },
      {
        ...DEFAULT_AI_TUNING,
        enableLmrTable: true,
      },
    ),
    1,
    'reduction is clamped to keep at least one ply for late-move search at depth=2',
  );
});

test('history helper should saturate bonus/malus and clear correctly', () => {
  clearHistory();
  const move = { from: 'a2', to: 'a3' } as const;

  for (let i = 0; i < 128; i += 1) {
    applyHistoryBonus(move, 12);
  }
  assert.equal(
    getHistoryScoreForMove(move),
    70,
    'history bonus should saturate to +70 ordering points',
  );

  for (let i = 0; i < 256; i += 1) {
    applyHistoryMalus(move, 12);
  }
  assert.equal(
    getHistoryScoreForMove(move),
    -70,
    'history malus should saturate to -70 ordering points',
  );

  clearHistory();
  assert.equal(
    getHistoryScoreForMove(move),
    0,
    'clearHistory should reset score to neutral',
  );
});

test('countermove helper should record, score and clear correctly', () => {
  clearCountermoves();
  const previousMove = { from: 'e2', to: 'e4' } as const;
  const bestReply = { from: 'c7', to: 'c5' } as const;
  const otherReply = { from: 'e7', to: 'e5' } as const;

  assert.equal(
    getCountermoveScore('b', previousMove, bestReply),
    0,
    'before recording countermove, score should be zero',
  );

  recordCountermove('b', previousMove, bestReply);
  assert.ok(
    getCountermoveScore('b', previousMove, bestReply) > 0,
    'recorded countermove should receive ordering bonus',
  );
  assert.equal(
    getCountermoveScore('b', previousMove, otherReply),
    0,
    'different reply should not receive countermove bonus',
  );
  assert.equal(
    getCountermoveScore('w', previousMove, bestReply),
    0,
    'countermove table is side-specific',
  );

  clearCountermoves();
  assert.equal(
    getCountermoveScore('b', previousMove, bestReply),
    0,
    'clearCountermoves should reset bonus to zero',
  );
});

test('C1 phase computation should follow N/B=1, R=2, Q=4 (max=24)', () => {
  const start = new Chess();
  assert.equal(getGamePhaseForTesting(start), 24, 'initial position should have full phase=24');

  const kingsOnly = new Chess('4k3/8/8/8/8/8/8/4K3 w - - 0 1');
  assert.equal(getGamePhaseForTesting(kingsOnly), 0, 'kings-only position should have phase=0');

  const queensAndKnights = new Chess('6k1/3q1ppp/2n2n2/8/8/2N2N2/3Q1PPP/6K1 w - - 0 1');
  assert.equal(getGamePhaseForTesting(queensAndKnights), 12, 'Q+N+N per side should result in phase=12');
});

test('C1 tapered eval should smooth score transition across MG/EG boundary', () => {
  const higherPhase = new Chess('6k1/3q1ppp/2n2n2/8/8/2N2N2/3Q4/4K3 w - - 0 1');
  const lowerPhase = new Chess('6k1/3q1ppp/5n2/8/8/5N2/3Q4/4K3 w - - 0 1');

  const legacyHi = evaluateBoardForTesting(higherPhase, 'w', { enableTaperedEval: false });
  const legacyLo = evaluateBoardForTesting(lowerPhase, 'w', { enableTaperedEval: false });
  const taperedHi = evaluateBoardForTesting(higherPhase, 'w', { enableTaperedEval: true });
  const taperedLo = evaluateBoardForTesting(lowerPhase, 'w', { enableTaperedEval: true });

  const legacyJump = Math.abs(legacyHi - legacyLo);
  const taperedJump = Math.abs(taperedHi - taperedLo);

  assert.ok(
    taperedJump < legacyJump,
    `expected tapered transition to be smoother (legacy=${legacyJump}, tapered=${taperedJump})`,
  );
});

test('C2.1 nonlinear king safety should penalize exposed king attacks more strongly', () => {
  const exposedKing = new Chess('6k1/5ppp/8/8/8/4rq2/4PPPP/4K3 w - - 0 1');

  const linearScore = evaluateBoardForTesting(exposedKing, 'w', {
    enableTaperedEval: true,
    enableNonlinearKingSafety: false,
  });
  const nonlinearScore = evaluateBoardForTesting(exposedKing, 'w', {
    enableTaperedEval: true,
    enableNonlinearKingSafety: true,
  });

  assert.ok(
    nonlinearScore < linearScore,
    `nonlinear king safety should reduce score under strong attack (linear=${linearScore}, nonlinear=${nonlinearScore})`,
  );
});

test('C2.2 backward pawn should be penalized when enabled', () => {
  const backwardPawnPosition = new Chess('6k1/8/8/8/4pp2/3P4/8/4K3 w - - 0 1');

  const withoutBackwardPenalty = evaluateBoardForTesting(backwardPawnPosition, 'w', {
    enableTaperedEval: true,
    enableBackwardPawn: false,
  });
  const withBackwardPenalty = evaluateBoardForTesting(backwardPawnPosition, 'w', {
    enableTaperedEval: true,
    enableBackwardPawn: true,
  });

  assert.ok(
    withBackwardPenalty < withoutBackwardPenalty,
    `backward pawn enabled should reduce score (off=${withoutBackwardPenalty}, on=${withBackwardPenalty})`,
  );
});

test('C2.3 knight outpost should increase score when enabled', () => {
  const knightOutpostPosition = new Chess('6k1/p6p/8/3N4/4P3/8/8/4K3 w - - 0 1');

  const withoutOutpostBonus = evaluateBoardForTesting(knightOutpostPosition, 'w', {
    enableTaperedEval: true,
    enableKnightOutpost: false,
  });
  const withOutpostBonus = evaluateBoardForTesting(knightOutpostPosition, 'w', {
    enableTaperedEval: true,
    enableKnightOutpost: true,
  });

  assert.ok(
    withOutpostBonus > withoutOutpostBonus,
    `knight outpost enabled should increase score (off=${withoutOutpostBonus}, on=${withOutpostBonus})`,
  );
});

test('C2.4 passed pawn king-distance should reward closer friendly king when enabled', () => {
  const passedPawnRace = new Chess('7k/2K5/3P4/8/8/8/8/8 w - - 0 1');

  const withoutKingDistanceBonus = evaluateBoardForTesting(passedPawnRace, 'w', {
    enableTaperedEval: true,
    enablePassedPawnKingDistance: false,
  });
  const withKingDistanceBonus = evaluateBoardForTesting(passedPawnRace, 'w', {
    enableTaperedEval: true,
    enablePassedPawnKingDistance: true,
  });

  assert.ok(
    withKingDistanceBonus > withoutKingDistanceBonus,
    `passed pawn king-distance enabled should increase score (off=${withoutKingDistanceBonus}, on=${withKingDistanceBonus})`,
  );
});

test('C2.5 rook behind passed pawn should increase score when enabled', () => {
  const rookBehindPassedPawn = new Chess('7k/8/4P3/8/8/8/8/4R1K1 w - - 0 1');

  const withoutRookBehindBonus = evaluateBoardForTesting(rookBehindPassedPawn, 'w', {
    enableTaperedEval: true,
    enableRookBehindPassedPawn: false,
  });
  const withRookBehindBonus = evaluateBoardForTesting(rookBehindPassedPawn, 'w', {
    enableTaperedEval: true,
    enableRookBehindPassedPawn: true,
  });

  assert.ok(
    withRookBehindBonus > withoutRookBehindBonus,
    `rook-behind-passed-pawn enabled should increase score (off=${withoutRookBehindBonus}, on=${withRookBehindBonus})`,
  );
});

test('C2.6 tempo bonus should favor side to move when enabled', () => {
  const whiteToMove = new Chess('6k1/8/8/8/3P4/8/8/4K3 w - - 0 1');
  const blackToMove = new Chess('6k1/8/8/8/3P4/8/8/4K3 b - - 0 1');

  const withoutTempoWhite = evaluateBoardForTesting(whiteToMove, 'w', {
    enableTaperedEval: true,
    enableTempoBonus: false,
  });
  const withoutTempoBlack = evaluateBoardForTesting(blackToMove, 'w', {
    enableTaperedEval: true,
    enableTempoBonus: false,
  });
  assert.equal(
    withoutTempoWhite,
    withoutTempoBlack,
    `without tempo bonus expected equal scores (wtm=${withoutTempoWhite}, btm=${withoutTempoBlack})`,
  );

  const withTempoWhite = evaluateBoardForTesting(whiteToMove, 'w', {
    enableTaperedEval: true,
    enableTempoBonus: true,
  });
  const withTempoBlack = evaluateBoardForTesting(blackToMove, 'w', {
    enableTaperedEval: true,
    enableTempoBonus: true,
  });

  assert.ok(
    withTempoWhite > withTempoBlack,
    `tempo bonus should favor side to move (wtm=${withTempoWhite}, btm=${withTempoBlack})`,
  );
});

test('quiescence search prevents horizon-effect blunder (rook not traded for bishop)', { timeout: 60_000 }, () => {
  // White rook can capture the black pawn on d5, but the black bishop on e4
  // immediately recaptures via Bxd5. Net exchange: white loses rook (500) and
  // gains only a pawn (100) = -400 centipawns. After Rxd5 → Bxd5 the resulting
  // king vs king+bishop position is a draw by insufficient material which the
  // draw-score heuristic values at +20. Other continuations with a functioning
  // quiescence search correctly score higher (≈ +50, white is ahead materially),
  // so Rxd5 is rejected in favour of any other rook move.
  resetOpeningState();
  clearTranspositionTable();
  const game = new Chess('2k5/8/8/3p4/4b3/8/3R4/2K5 w - - 0 1');
  const bestMove = getBestMove(game, 'hard', { openingBookEnabled: false, hardBand: 1, hardCandidateCap: 1 });
  assert.ok(bestMove, 'AI should return a move');
  assert.notEqual(bestMove, 'Rxd5', 'AI should not trade rook for bishop (QSearch must detect the recapture)');
});

test('endgame king centralization: king prefers central squares over corner', { timeout: 60_000 }, () => {
  // White king is on a1 with a pawn on a2; black has a pawn on a7 that blocks
  // white's a-pawn from being a passed pawn.  With neither pawn passed, the
  // dominant scoring term is the endgame king PST.
  //
  // Legal king moves from a1:  Kb1 (PST=−30)  Kb2 (PST=−10)
  // Legal pawn moves:          a3  (PST unchanged, not passed → 0 net change)
  //
  // Kb2 gains the most PST value (+40 over current a1=−50) and dominates.
  // hardBand:1 + hardCandidateCap:1 forces the single top-scored move.
  resetOpeningState();
  clearTranspositionTable();
  const originalRandom = Math.random;
  Math.random = () => 0;
  try {
    const game = new Chess('8/p7/8/8/8/8/P7/K6k w - - 0 1');
    const bestMove = getBestMove(game, 'hard', {
      openingBookEnabled: false,
      hardBand: 1,
      hardCandidateCap: 1,
    });
    assert.ok(bestMove, 'AI should return a move in an endgame position');
    assert.equal(bestMove, 'Kb2', 'expected king to centralise (Kb2) using the endgame king PST');
  } finally {
    Math.random = originalRandom;
    resetOpeningState();
    clearTranspositionTable();
  }
});

test('committed line aborts when opponent deviates from expected reply', { timeout: 60_000 }, () => {
  // With random=0 the AI commits to COMMITTED_LINES_WHITE[0] (Ruy Lopez):
  //   moves[0]='e2e4'  moves[1]='e7e5'  moves[2]='g1f3' …
  // White plays e4 (committed move 0). Black deviates by playing d5 instead of
  // the expected e5 (committed slot 1). When white calls getBestMove for move 2,
  // getCommittedOpeningMove checks history.last ('d7d5') against moves[1]
  // ('e7e5'), detects the mismatch, sets committedLineAborted=true and falls
  // through to the search. The AI must still return a valid legal move.
  resetOpeningState();
  clearTranspositionTable();
  const originalRandom = Math.random;
  Math.random = () => 0;
  try {
    const game = new Chess();
    const firstMove = getBestMove(game, 'hard', { openingBookEnabled: true });
    assert.ok(firstMove, 'expected AI to return an opening move');
    game.move(firstMove as string);

    // Black deviates from the expected reply
    game.move('d5');

    // After deviation the committed line is aborted; AI must use the search
    const secondMove = getBestMove(game, 'hard', { openingBookEnabled: true });
    assert.ok(secondMove, 'AI should return a valid move after committed line deviation');
    const verify = new Chess(game.fen());
    assert.ok(verify.move(secondMove as string), 'move returned after deviation must be legal');
  } finally {
    Math.random = originalRandom;
    resetOpeningState();
    clearTranspositionTable();
  }
});

test('resetOpeningState clears committed line so AI falls back to search', { timeout: 60_000 }, () => {
  // After a committed line is selected by the first getBestMove call, invoking
  // resetOpeningState() nulls out committedLine. On the next getBestMove at
  // plyCount > 0 (aiMovesMade > 0), selectCommittedLine is NOT re-triggered,
  // so getCommittedOpeningMove returns null immediately and the search is used.
  resetOpeningState();
  clearTranspositionTable();
  const originalRandom = Math.random;
  Math.random = () => 0;
  try {
    const game = new Chess();
    // First move: selects committed line (Ruy Lopez) and follows it
    const firstMove = getBestMove(game, 'hard', { openingBookEnabled: true });
    assert.ok(firstMove, 'expected first committed-line move');
    game.move(firstMove as string);
    game.move('e5'); // black follows expected reply

    // Reset mid-game: committed line state is cleared
    resetOpeningState();

    // plyCount=2, aiMovesMade=1 → selectCommittedLine is NOT called.
    // committedLine is null → falls straight to search.
    const secondMove = getBestMove(game, 'hard', { openingBookEnabled: true });
    assert.ok(secondMove, 'AI should return a valid move after resetOpeningState');
    const verify = new Chess(game.fen());
    assert.ok(verify.move(secondMove as string), 'move returned after reset must be legal');
  } finally {
    Math.random = originalRandom;
    resetOpeningState();
    clearTranspositionTable();
  }
});

// --- Pawn Structure Tests ---

test('passed pawn: AI promotes pawn on the penultimate rank', { timeout: 30_000 }, () => {
  // White pawn on e7 (one step from queening, no black pawns on d/e/f files).
  // PASSED_PAWN_BONUS[6] = 90 already applies at e7; queening to a queen (900 cp)
  // dwarfs any king move (+40 PST at best) → e8=Q must be the top-scored move.
  // isEndgame=true (no non-pawn material) so king safety is skipped.
  resetOpeningState();
  clearTranspositionTable();
  const game = new Chess('6k1/4P3/8/8/8/K7/8/8 w - - 0 1');
  const move = getBestMove(game, 'hard', {
    openingBookEnabled: false,
    hardBand: 1,
    hardCandidateCap: 1,
  });
  // The queen lands on e8 while the black king is on g8 (same rank) → promotion
  // gives check, so chess.js encodes the SAN as 'e8=Q+'.
  assert.equal(move, 'e8=Q+', 'AI should promote the passed pawn to queen (with check)');
});

test('passed pawn race: AI advances own passed pawn in mutual pawn race', { timeout: 30_000 }, () => {
  // White: King a1, passed pawn a6 (adv=5, bonus=60).
  // Black: King h8, passed pawn h3 (adv=5 for black, bonus=60). Mirror race.
  //
  // At depth 1 (static):  a7 gains +30 passed bonus (PASSED_PAWN_BONUS[6]=90 vs 60)
  //   + +40 PST (50 vs 10) = +70 net pawn improvement vs any king move (+20 king PST at most).
  // At depth 2 (after black replies h2): a7 keeps the race even (both at adv=6, bonus=90),
  //   while a king move falls behind (black pawn scores 90 while white's stays at 60).
  // So a7 should dominate at all search depths.
  resetOpeningState();
  clearTranspositionTable();
  const game = new Chess('7k/8/P7/8/8/7p/8/K7 w - - 0 1');
  const move = getBestMove(game, 'hard', {
    openingBookEnabled: false,
    hardBand: 1,
    hardCandidateCap: 1,
  });
  assert.equal(move, 'a7', 'AI should advance the passed pawn in a pawn race');
});

// --- King Safety Tests ---

test('king safety: AI preserves pawn shield when no tactical reason to break it', { timeout: 30_000 }, () => {
  // White king on g1, pawns f2/g2/h2 intact (full kingside shield).
  // White rook on f1, white queen on d1. Black: king g8, queen d8.
  // With king safety evaluation, shield-breaking advances (g3, h3, f3) incur an
  // OPEN_FILE or SEMI_OPEN penalty, so quiet non-shield moves score higher.
  resetOpeningState();
  clearTranspositionTable();
  const game = new Chess('6k1/3q4/8/8/8/8/3Q1PPP/3R1RK1 w - - 0 1');
  const move = getBestMove(game, 'hard', {
    openingBookEnabled: false,
    hardBand: 30,
    hardCandidateCap: 1,
  });
  assert.ok(move, 'AI should return a move');
  assert.ok(
    !['g3', 'h3', 'f3'].includes(move as string),
    `AI should not voluntarily break pawn shield; chose: ${move}`,
  );
});

test('king safety: evaluation runs correctly when king is exposed to queen attack', { timeout: 30_000 }, () => {
  // White: King e1 (no pawn shield), queen on d1, pawn on e2.
  // Black: Queen on e5 (on e-file pointing at the white king), king on g8.
  // isEndgame=false (both queens → non-pawn material > 1300 per side).
  // King safety evaluation triggers: open files near king + queen in king zone.
  // Verify the AI returns a legal move without errors from the new evaluation code.
  resetOpeningState();
  clearTranspositionTable();
  const game = new Chess('6k1/8/8/4q3/8/8/3QP3/4K3 w - - 0 1');
  const move = getBestMove(game, 'hard', {
    openingBookEnabled: false,
    hardBand: 1,
    hardCandidateCap: 1,
  });
  assert.ok(move, 'AI should return a valid move even when king is exposed');
  const verify = new Chess(game.fen());
  assert.ok(verify.move(move as string), `Move ${move} must be legal`);
});

// Regression: the single-player AI used to trade its queen for a minor piece
// or pawn because the time budget expired before depth 1 finished, leaving the
// raw capture-ordering seed (where "queen takes anything" ranks first) in
// charge of move selection.
const QUEEN_BLUNDER_CASES: Array<{ fen: string; forbidden: string[] }> = [
  // ...Qxd4?? exd4 loses the queen for a knight.
  { fen: 'rnbqkb1r/ppp2ppp/5n2/8/3N4/4P3/PPP2PPP/RNBQKB1R b KQkq - 0 5', forbidden: ['Qxd4'] },
  // Qxd5?? / Nxd5?? exd5 drops material to a pawn recapture.
  { fen: 'rnbqkbnr/ppp2ppp/4p3/3p4/8/2N5/PPP2PPP/R1BQKBNR w KQkq - 0 4', forbidden: ['Qxd5', 'Nxd5'] },
];

for (const difficulty of ['medium', 'hard'] as const) {
  test(`${difficulty} AI should not give up its queen for a defended pawn or minor piece`, { timeout: 60_000 }, () => {
    for (const { fen, forbidden } of QUEEN_BLUNDER_CASES) {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        resetOpeningState();
        clearTranspositionTable();
        const game = new Chess(fen);
        const move = getBestMove(game, difficulty, { openingBookEnabled: false });
        assert.ok(move, `expected a move for ${fen}`);
        assert.ok(!forbidden.includes(move as string), `${difficulty} AI blundered with ${move} in ${fen}`);
      }
    }
  });
}

test('AI should always finish depth 1 so tactical recaptures are seen even with a tiny time budget', { timeout: 30_000 }, () => {
  resetOpeningState();
  clearTranspositionTable();
  const game = new Chess(QUEEN_BLUNDER_CASES[0].fen);
  const move = getBestMove(game, 'medium', { openingBookEnabled: false }, 1);
  assert.ok(move, 'expected a move');
  assert.notEqual(move, 'Qxd4', 'AI should see the pawn recapture of its queen');
  assert.ok(getLastSearchDiagnostics().completedDepth >= 1, 'expected depth 1 to be completed');
});

test('search throughput should reach depth 2 in a middlegame well within one second', { timeout: 30_000 }, () => {
  // Building chess.js Move objects for every node capped the search at ~200
  // nodes/s, so even the 1.5s hard budget never got past depth 1.
  resetOpeningState();
  clearTranspositionTable();
  const game = new Chess('r2q1rk1/pp2bppp/2n1pn2/3p4/3P4/2NBPN2/PP3PPP/R2Q1RK1 w - - 0 10');
  const move = getBestMove(game, 'medium', { openingBookEnabled: false }, 1_000);
  assert.ok(move, 'expected a move');
  const { completedDepth } = getLastSearchDiagnostics();
  assert.ok(completedDepth >= 2, `expected at least depth 2 within one second, got ${completedDepth}`);
});

test('tuned evaluation weights keep conventional chess relationships', async () => {
  const { DEFAULT_EVAL_WEIGHTS: w } = await import('../../src/utils/chess-ai/chessAIEvaluation');
  for (const phase of [w.materialMg, w.materialEg]) {
    assert.ok(phase.p < phase.n && phase.p < phase.b, 'minor pieces must outweigh a pawn');
    assert.ok(phase.r >= Math.max(phase.n, phase.b) + phase.p, 'a rook must be worth at least a minor piece plus a pawn');
    assert.ok(phase.q > phase.r + Math.max(phase.n, phase.b), 'a queen must outweigh rook plus minor piece');
  }
  for (const bonus of [w.connectedPawn, w.rookOpenFile, w.rookSemiOpenFile, w.rookSeventhRank, w.doubledRooks,
    w.bishopPair, w.knightOutpostMg, w.knightOutpostEg, w.passedPawnMgPct, w.passedPawnEgPct, w.kingSafetyPct]) {
    assert.ok(bonus >= 0, `expected a non-negative bonus, got ${bonus}`);
  }
  for (const penalty of [w.doubledPawn, w.isolatedPawn, w.backwardPawn]) {
    assert.ok(penalty <= 0, `expected a non-positive penalty, got ${penalty}`);
  }
  assert.ok(w.passedPawnEgPct >= w.passedPawnMgPct, 'passed pawns should matter more in the endgame');
});

const playOut = (fen: string, maxPlies: number, timeLimitMs: number): Chess => {
  resetOpeningState();
  clearTranspositionTable();
  clearHistory();
  const game = new Chess(fen);
  while (!game.isGameOver() && game.history().length < maxPlies) {
    const move = getBestMove(game, 'hard', { openingBookEnabled: false }, timeLimitMs);
    assert.ok(move, 'expected a move');
    game.move(move as string);
  }
  return game;
};

test('AI converts king and queen against a lone king', { timeout: 120_000 }, () => {
  const game = playOut('8/8/3k4/8/8/4K3/8/7Q w - - 0 1', 40, 200);
  assert.ok(game.isCheckmate(), `expected mate within 20 moves, got: ${game.history().join(' ')}`);
});

test('AI converts king and rook against a lone king', { timeout: 120_000 }, () => {
  const game = playOut('8/8/8/4k3/8/8/1K6/R7 w - - 0 1', 64, 200);
  assert.ok(game.isCheckmate(), `expected mate within 32 moves, got: ${game.history().join(' ')}`);
});

test('mop-up evaluation rewards driving a lone king to the edge', () => {
  const centralised = evaluateBoardForTesting(new Chess('8/8/8/3k4/8/8/8/K6Q w - - 0 1'), 'w', DEFAULT_AI_TUNING);
  const cornered = evaluateBoardForTesting(new Chess('k7/8/8/8/8/8/8/K6Q w - - 0 1'), 'w', DEFAULT_AI_TUNING);
  const kingsClose = evaluateBoardForTesting(new Chess('k7/8/2K5/8/8/8/8/7Q w - - 0 1'), 'w', DEFAULT_AI_TUNING);
  // The tuned endgame king table alone gives ~50 here (the pre-tuning table
  // gave ~90); mop-up must restore at least that pre-tuning incentive.
  assert.ok(cornered > centralised + 80, `cornered ${cornered} vs centralised ${centralised}`);
  assert.ok(kingsClose > cornered, `kings close ${kingsClose} vs far ${cornered}`);
});


test('quiescence searches Qxb7# despite an apparent king defender in both directions', () => {
  // The black king geometrically attacks b7 but Kxb7 is illegal because the
  // white king on c7 protects the square. Qxb7 is a mating capture.
  const fen = 'k7/1pK5/8/8/8/8/8/1Q6 w - - 0 1';
  for (const [maximizing, color, mateScore] of [
    [true, 'w', MATE_SCORE - 1],
    [false, 'b', -(MATE_SCORE - 1)],
  ] as const) {
    const game = new Chess(fen);
    const standPat = evaluateBoardForTesting(game, color, DEFAULT_AI_TUNING);
    resetSearchCounters();
    searchState.searchAborted = false;
    setSearchDeadline(Infinity);
    // Force the maximizer's delta-pruning threshold above the material gain:
    // a mating capture must not be discarded based on a quiet static score.
    const alpha = maximizing ? standPat + 400 : -Infinity;
    const score = quiescence(game, alpha, Infinity, maximizing, color, DEFAULT_AI_TUNING);
    assert.equal(score, mateScore, `missed the Qxb7# capture for ${color}`);
    assert.ok(searchState.qNodeCount > 1, 'expected quiescence to explore the capture');
    assert.equal(game.fen(), fen, 'quiescence must restore the original position');
  }
});

test('quiescence scores stalemate with non-pawn material as a draw', () => {
  const fen = '4k2r/8/8/8/6p1/1q3pP1/5P2/K6N w - - 0 1';
  const game = new Chess(fen);
  assert.ok(game.isStalemate(), 'expected a non-pawn stalemate');
  resetSearchCounters();
  searchState.searchAborted = false;
  setSearchDeadline(Infinity);
  assert.equal(
    quiescence(game, -Infinity, Infinity, true, 'w', DEFAULT_AI_TUNING),
    drawScore(game, 'w', DEFAULT_AI_TUNING),
  );
  assert.equal(game.fen(), fen);
});

test('reverse futility pruning cannot replace stalemate with a static evaluation', () => {
  const tuning = {
    ...DEFAULT_AI_TUNING,
    enableRfp: true,
    rfpDepthLimit: 3,
    rfpMarginBase: 0,
    rfpMarginPerDepth: 0,
  };
  const game = new Chess('4k2r/8/8/8/6p1/1q3pP1/5P2/K6N w - - 0 1');
  assert.ok(game.isStalemate());
  clearSearchTable();
  resetSearchCounters();
  searchState.searchAborted = false;
  setSearchDeadline(Infinity);
  // A one-point non-PV window which would ordinarily trigger RFP.
  const score = minimax(game, 2, -10_000, -9_999, true, 'w', tuning);
  assert.equal(score, drawScore(game, 'w', tuning));
  assert.equal(searchState.rfpPruneCount, 0, 'RFP must not prune a stalemate');

  // RFP remains enabled for ordinary positions with legal moves.
  clearSearchTable();
  resetSearchCounters();
  minimax(new Chess(), 2, -10_000, -9_999, true, 'w', tuning);
  assert.ok(searchState.rfpPruneCount > 0, 'nonterminal positions should still use RFP');
});

test('en passant stays tactical when late quiet moves would be pruned', () => {
  const game = new Chess('rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3');
  const before = game.fen();
  const ep = generatePseudoLegalMoves(game).find((move) => move.from === 'e5' && move.to === 'f6');
  assert.ok(ep);
  assert.equal(ep.isEnPassant(), true);
  assert.equal(isTacticalMove(ep), true);
  assert.equal(getHistoryScore(ep), 0);
  assert.equal(killerScore(ep, 0), 0);

  // Ensure a first move is scored, then put alpha far above the static eval.
  // If en passant is incorrectly treated as quiet, futility pruning skips it.
  const first = game.moves({ verbose: true }).find((move) => move.san === 'Nf3');
  assert.ok(first);
  const firstWithCaptureOrdering: AiMove = {
    color: first.color,
    from: first.from,
    to: first.to,
    piece: first.piece,
    captured: 'q',
    flags: first.flags,
    isCapture: () => true,
    isEnPassant: () => false,
    isPromotion: () => false,
  };
  let searchedEnPassant = false;
  searchState.searchAborted = false;
  setSearchDeadline(Infinity);
  searchPvsMoves({
    game,
    rawMoves: [firstWithCaptureOrdering, ep],
    board: getBoard(game),
    depth: 1,
    alpha: 100_000,
    beta: 100_001,
    isMaximizingPlayer: true,
    color: 'w',
    tuning: { ...DEFAULT_AI_TUNING, enableFp: true, enableLmp: true },
    ply: 0,
    isPvNode: false,
    inCheck: false,
    isImproving: false,
    ttBestMove: 0,
    getStaticEval: () => 0,
    recurse: (child) => {
      searchedEnPassant ||= child.get('f6')?.type === 'p' && child.get('f6')?.color === 'w';
      return 0;
    },
  });
  assert.equal(searchedEnPassant, true, 'futility pruning must not skip en passant');
  assert.equal(game.fen(), before, 'search must fully restore the board');
});

test('null move avoids the fifty-move boundary and advances its synthetic clock', () => {
  const nearDraw = new Chess('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 99 51');
  assert.equal(makeNullMove(nearDraw), null);
  const normal = new Chess('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 12 51');
  const passed = makeNullMove(normal);
  assert.ok(passed);
  assert.equal(passed.turn(), 'b');
  assert.equal(passed.fen().split(' ')[4], '13');
  assert.equal(normal.fen().split(' ')[4], '12');
});

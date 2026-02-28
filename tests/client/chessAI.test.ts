import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import {
  DEFAULT_AI_TUNING,
  clearTranspositionTable,
  getAiTuning,
  getBestMove,
  resetAiTuning,
  resetOpeningState,
  setAiTuning,
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

test('supports runtime AI tuning overrides and reset', () => {
  resetAiTuning();
  const before = getAiTuning();
  assert.deepEqual(before, DEFAULT_AI_TUNING);

  const patched = setAiTuning({
    backtrackPenalty: 120,
    openingBookEnabled: false,
    openingBookMaxPly: 6,
  });

  assert.equal(patched.backtrackPenalty, 120);
  assert.equal(patched.openingBookEnabled, false);
  assert.equal(patched.openingBookMaxPly, 6);
  assert.equal(getAiTuning().backtrackPenalty, 120);

  const reset = resetAiTuning();
  assert.deepEqual(reset, DEFAULT_AI_TUNING);
  assert.deepEqual(getAiTuning(), DEFAULT_AI_TUNING);
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
  // White king is on a1 with a pawn on a2 (blocks Ka2 and prevents the
  // insufficient-material draw that would fire for a kings-only position).
  // totalNonPawnMaterial = 0 < 1500 → endgame mode → kingEndgamePST is active.
  //
  // Legal king moves from a1:  Kb1 (PST=−30)  Kb2 (PST=−10)
  // Legal pawn moves:          a3  (PST= +5)   a4  (PST= 0)
  //
  // Kb2 gains the most PST value (+40 over current a1=−50) and dominates the
  // evaluation. hardBand:1 + hardCandidateCap:1 forces the top-scored move.
  resetOpeningState();
  clearTranspositionTable();
  const originalRandom = Math.random;
  Math.random = () => 0;
  try {
    const game = new Chess('8/8/8/8/8/8/P7/K6k w - - 0 1');
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
    const firstMove = getBestMove(game, 'hard', { openingBookEnabled: false });
    assert.ok(firstMove, 'expected AI to return an opening move');
    game.move(firstMove as string);

    // Black deviates from the expected reply
    game.move('d5');

    // After deviation the committed line is aborted; AI must use the search
    const secondMove = getBestMove(game, 'hard', { openingBookEnabled: false });
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
    const firstMove = getBestMove(game, 'hard', { openingBookEnabled: false });
    assert.ok(firstMove, 'expected first committed-line move');
    game.move(firstMove as string);
    game.move('e5'); // black follows expected reply

    // Reset mid-game: committed line state is cleared
    resetOpeningState();

    // plyCount=2, aiMovesMade=1 → selectCommittedLine is NOT called.
    // committedLine is null → falls straight to search.
    const secondMove = getBestMove(game, 'hard', { openingBookEnabled: false });
    assert.ok(secondMove, 'AI should return a valid move after resetOpeningState');
    const verify = new Chess(game.fen());
    assert.ok(verify.move(secondMove as string), 'move returned after reset must be legal');
  } finally {
    Math.random = originalRandom;
    resetOpeningState();
    clearTranspositionTable();
  }
});

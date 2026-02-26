import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { DEFAULT_AI_TUNING, getAiTuning, getBestMove, resetAiTuning, setAiTuning } from '../../src/utils/chessAI';

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

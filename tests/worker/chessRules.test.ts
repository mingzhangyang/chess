import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { canResetGame, newGameFen, validateMove } from '../../worker/src/chessRules';

test('rejects spectator move', () => {
  const game = new Chess();
  const legalMove = game.move('e4');
  assert.ok(legalMove);

  const result = validateMove({
    currentFen: newGameFen(),
    nextFen: game.fen(),
    role: 'spectator',
    color: null,
  });

  assert.deepEqual(result, { ok: false, code: 'spectator-cannot-move' });
});

test('rejects move when it is not player turn', () => {
  const game = new Chess();
  const legalMove = game.move('e4');
  assert.ok(legalMove);

  const result = validateMove({
    currentFen: newGameFen(),
    nextFen: game.fen(),
    role: 'player',
    color: 'b',
  });

  assert.deepEqual(result, { ok: false, code: 'not-your-turn' });
});

test('rejects illegal transition FEN', () => {
  const illegalFen = '8/8/8/8/8/8/8/8 w - - 0 1';

  const result = validateMove({
    currentFen: newGameFen(),
    nextFen: illegalFen,
    role: 'player',
    color: 'w',
  });

  assert.deepEqual(result, { ok: false, code: 'illegal-move' });
});

test('accepts legal move transition and returns normalized FEN', () => {
  const game = new Chess();
  const legalMove = game.move('e4');
  assert.ok(legalMove);

  const result = validateMove({
    currentFen: newGameFen(),
    nextFen: game.fen(),
    role: 'player',
    color: 'w',
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.nextFen, game.fen());
  }
});

test('rejects reset for spectator', () => {
  const result = canResetGame('spectator');
  assert.deepEqual(result, { ok: false, code: 'spectator-cannot-reset' });
});

test('allows reset for player', () => {
  const result = canResetGame('player');
  assert.deepEqual(result, { ok: true });
});

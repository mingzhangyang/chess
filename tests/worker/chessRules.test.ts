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

function historyOf(moves: string[]): { game: Chess; fenHistory: string[] } {
  const game = new Chess();
  const fenHistory = [game.fen()];
  for (const move of moves) {
    game.move(move);
    fenHistory.push(game.fen());
  }
  return { game, fenHistory };
}

function fenAfter(fen: string, move: string): string {
  const game = new Chess(fen);
  game.move(move);
  return game.fen();
}

const KNIGHT_SHUFFLE = ['Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3', 'Nf6', 'Ng1', 'Ng8'];

test('rejects moves once the room history shows a threefold repetition', () => {
  const { game, fenHistory } = historyOf(KNIGHT_SHUFFLE);
  const result = validateMove({
    currentFen: game.fen(),
    nextFen: fenAfter(game.fen(), 'e4'),
    role: 'player',
    color: 'w',
    fenHistory,
  });
  assert.deepEqual(result, { ok: false, code: 'game-over' });
});

test('a position seen only twice is still playable', () => {
  const { game, fenHistory } = historyOf(KNIGHT_SHUFFLE.slice(0, 4));
  const result = validateMove({
    currentFen: game.fen(),
    nextFen: fenAfter(game.fen(), 'e4'),
    role: 'player',
    color: 'w',
    fenHistory,
  });
  assert.equal(result.ok, true);
});

test('rejects moves after draws visible from the position alone', () => {
  const insufficient = '4k3/8/8/8/8/8/8/4K3 w - - 0 1';
  const fiftyMove = '4k3/8/8/8/8/8/R7/4K3 w - - 100 80';
  for (const fen of [insufficient, fiftyMove]) {
    const result = validateMove({
      currentFen: fen,
      nextFen: fenAfter(fen, 'Kd1'),
      role: 'player',
      color: 'w',
    });
    assert.deepEqual(result, { ok: false, code: 'game-over' }, fen);
  }
});

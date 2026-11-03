import assert from 'node:assert/strict';
import test from 'node:test';
import { Chess } from 'chess.js';
import { prepareSinglePlayerMove } from '../../src/utils/prepareSinglePlayerMove';

test('a prepared move preserves the source and returns its applied game state', () => {
  const game = new Chess();
  const before = game.fen();
  const prepared = prepareSinglePlayerMove(game, 'e2', 'e4');
  assert.ok(prepared);
  assert.equal(game.fen(), before);
  assert.equal(game.history().length, 0);
  assert.equal(prepared.move.san, 'e4');
  assert.deepEqual(prepared.game.history(), ['e4']);
});

test('invalid moves cannot mutate the source game', () => {
  const game = new Chess();
  const before = game.fen();
  assert.equal(prepareSinglePlayerMove(game, 'e2', 'e5'), null);
  assert.equal(game.fen(), before);
});

test('prepared moves preserve repetition history for draw rules', () => {
  const game = new Chess();
  for (const move of ['Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3', 'Nf6', 'Ng1']) game.move(move);
  assert.equal(game.isThreefoldRepetition(), false);
  const prepared = prepareSinglePlayerMove(game, 'f6', 'g8');
  assert.ok(prepared);
  assert.equal(prepared.game.isThreefoldRepetition(), true);
  assert.equal(game.isThreefoldRepetition(), false);
});

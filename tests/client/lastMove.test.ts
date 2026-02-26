import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { deriveLastMoveFromFen } from '../../src/utils/lastMove';

test('deriveLastMoveFromFen returns matching move for next position fen', () => {
  const current = new Chess();
  const next = new Chess();
  const move = next.move('e4');
  assert.ok(move);

  const derived = deriveLastMoveFromFen(current, next.fen());
  assert.deepEqual(derived, { from: 'e2', to: 'e4' });
});

test('deriveLastMoveFromFen returns null when fen does not advance by one legal move', () => {
  const current = new Chess();
  const impossibleNext = new Chess();
  impossibleNext.move('e4');
  impossibleNext.move('e5');

  const derived = deriveLastMoveFromFen(current, impossibleNext.fen());
  assert.equal(derived, null);
});

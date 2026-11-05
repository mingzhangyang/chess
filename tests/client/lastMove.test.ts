import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { deriveLastMoveFromFen, deriveMoveFromFen } from '../../src/utils/lastMove';

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

test('deriveMoveFromFen restores capture metadata, including en passant', () => {
  const previous = new Chess();
  for (const san of ['e4', 'a6', 'e5', 'd5']) previous.move(san);
  const originalFen = previous.fen();
  const next = new Chess(originalFen);
  const capture = next.move('exd6');

  const derived = deriveMoveFromFen(previous, next.fen());
  assert.equal(derived?.from, capture.from);
  assert.equal(derived?.to, capture.to);
  assert.equal(derived?.captured, 'p');
  assert.equal(previous.fen(), originalFen, 'inference must not mutate source chess state');
});

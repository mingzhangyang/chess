import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { buildMoveOptionSquares, buildCurrentSquareStyles } from '../../src/utils/moveHighlights';

test('buildMoveOptionSquares marks source square and legal destinations', () => {
  const game = new Chess();
  const squares = buildMoveOptionSquares(game, 'e2');

  assert.deepEqual(Object.keys(squares).sort(), ['e2', 'e3', 'e4']);
  assert.equal(squares.e2.background, 'rgba(255, 255, 0, 0.4)');
  assert.equal(squares.e3.borderRadius, '50%');
  assert.equal(squares.e4.borderRadius, '50%');
});

test('buildMoveOptionSquares returns empty object for missing source square', () => {
  const game = new Chess();
  assert.deepEqual(buildMoveOptionSquares(game, null), {});
});

test('buildCurrentSquareStyles merges option, last-move, and invalid highlights', () => {
  const game = new Chess();
  game.move('e4');
  const optionSquares = buildMoveOptionSquares(game, 'e7');
  const styles = buildCurrentSquareStyles({
    optionSquares,
    lastMove: { from: 'e2', to: 'e4' },
    invalidMoveSquare: 'e4',
  });

  assert.equal(styles.e7.background, 'rgba(255, 255, 0, 0.4)');
  assert.equal(styles.e2.background, 'rgba(255, 255, 0, 0.4)');
  assert.equal(styles.e4.background, 'rgba(239, 68, 68, 0.6)');
});

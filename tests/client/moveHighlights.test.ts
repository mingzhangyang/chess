import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import {
  buildMoveOptionSquares,
  buildCurrentSquareStyles,
  findCheckedKingSquare,
} from '../../src/utils/moveHighlights';

test('buildMoveOptionSquares distinguishes source square and quiet destinations', () => {
  const game = new Chess();
  const squares = buildMoveOptionSquares(game, 'e2');

  assert.deepEqual(Object.keys(squares).sort(), ['e2', 'e3', 'e4']);
  assert.equal(squares.e2.background, 'var(--board-selected-bg)');
  assert.equal(squares.e2.boxShadow, 'inset 0 0 0 3px var(--board-selected-ring)');
  assert.match(String(squares.e3.background), /var\(--board-legal-dot\)/);
  assert.match(String(squares.e4.background), /var\(--board-legal-dot\)/);
});

test('buildMoveOptionSquares gives captures a ring including en passant', () => {
  const capture = new Chess('4k3/8/8/8/3p4/4P3/8/4K3 w - - 0 1');
  const captureStyles = buildMoveOptionSquares(capture, 'e3');
  assert.equal(captureStyles.d4.boxShadow, 'inset 0 0 0 5px var(--board-capture-ring)');

  const enPassant = new Chess('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1');
  const enPassantStyles = buildMoveOptionSquares(enPassant, 'e5');
  assert.equal(enPassantStyles.d6.boxShadow, 'inset 0 0 0 5px var(--board-capture-ring)');
});

test('buildMoveOptionSquares returns empty object for missing source square', () => {
  const game = new Chess();
  assert.deepEqual(buildMoveOptionSquares(game, null), {});
});

test('last move, selection, and invalid move each have different highlights', () => {
  const game = new Chess();
  game.move('e4');
  const optionSquares = buildMoveOptionSquares(game, 'e7');
  const styles = buildCurrentSquareStyles({
    optionSquares,
    lastMove: { from: 'e2', to: 'e4' },
    invalidMoveSquare: 'e4',
  });

  assert.equal(styles.e7.background, 'var(--board-selected-bg)');
  assert.equal(styles.e2.background, 'var(--board-last-move-bg)');
  assert.equal(styles.e4.background, 'var(--board-invalid-bg)');
});

test('selected square takes priority over the previous move highlight', () => {
  const styles = buildCurrentSquareStyles({
    optionSquares: { e4: { background: 'var(--board-selected-bg)' } },
    lastMove: { from: 'e2', to: 'e4' },
  });
  assert.equal(styles.e4.background, 'var(--board-selected-bg)');
});

test('only the checked side king is highlighted, for both colors', () => {
  const normal = new Chess();
  assert.equal(findCheckedKingSquare(normal), null);

  const whiteInCheck = new Chess('4k3/8/8/8/8/8/4r3/4K3 w - - 0 1');
  const blackInCheck = new Chess('4k3/4R3/8/8/8/8/8/4K3 b - - 0 1');
  assert.equal(findCheckedKingSquare(whiteInCheck), 'e1');
  assert.equal(findCheckedKingSquare(blackInCheck), 'e8');

  const styles = buildCurrentSquareStyles({
    optionSquares: {},
    checkedKingSquare: findCheckedKingSquare(whiteInCheck),
  });
  assert.equal(styles.e1.background, 'var(--board-check-bg)');
  assert.equal(styles.e1.boxShadow, 'inset 0 0 0 3px var(--board-check-ring)');
});

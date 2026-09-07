import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { isPawnPromotionMove, PROMOTION_PIECES } from '../../src/utils/chessPromotion';

test('detects white and black pawn promotion moves', () => {
  const whitePromotion = new Chess('k7/P7/8/8/8/8/8/7K w - - 0 1');
  const blackPromotion = new Chess('7k/8/8/8/8/8/p7/7K b - - 0 1');

  assert.equal(isPawnPromotionMove(whitePromotion, 'a7', 'a8'), true);
  assert.equal(isPawnPromotionMove(blackPromotion, 'a2', 'a1'), true);
  assert.equal(isPawnPromotionMove(whitePromotion, 'a7', 'a6'), false);
});

test('exposes all legal promotion choices in stable display order', () => {
  assert.deepEqual(PROMOTION_PIECES, ['q', 'r', 'b', 'n']);
});

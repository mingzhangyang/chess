import { Chess, type Move } from 'chess.js';
import { cloneGameWithHistory } from './cloneGameWithHistory';
import type { PromotionPiece } from './chessPromotion';

export type PreparedSinglePlayerMove = {
  game: Chess;
  move: Move;
};

/**
 * Prepare one legal move on a history-preserving clone so the UI can validate
 * and commit the same result without replaying the whole game a second time.
 */
export const prepareSinglePlayerMove = (
  sourceGame: Chess,
  sourceSquare: string,
  targetSquare: string,
  promotion: PromotionPiece = 'q',
): PreparedSinglePlayerMove | null => {
  const game = cloneGameWithHistory(sourceGame);
  try {
    const move = game.move({ from: sourceSquare, to: targetSquare, promotion });
    return move ? { game, move } : null;
  } catch {
    return null;
  }
};

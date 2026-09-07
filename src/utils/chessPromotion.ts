import type { Chess, Square } from 'chess.js';

export const PROMOTION_PIECES = ['q', 'r', 'b', 'n'] as const;
export type PromotionPiece = (typeof PROMOTION_PIECES)[number];

export function isPawnPromotionMove(game: Chess, from: string, to: string): boolean {
  const piece = game.get(from as Square);
  if (!piece || piece.type !== 'p') {
    return false;
  }

  const targetRank = to.at(-1);
  return piece.color === 'w' ? targetRank === '8' : targetRank === '1';
}

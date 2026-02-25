import { Chess } from 'chess.js';

export const cloneGameWithHistory = (sourceGame: Chess): Chess => {
  const clone = new Chess();
  const moves = sourceGame.history();

  try {
    for (const move of moves) {
      const appliedMove = clone.move(move);
      if (!appliedMove) {
        clone.load(sourceGame.fen());
        break;
      }
    }
  } catch {
    clone.load(sourceGame.fen());
  }

  return clone;
};

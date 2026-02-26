import { Chess } from 'chess.js';
import type { Chess as ChessInstance } from 'chess.js';
import type { LastMove } from './moveHighlights';

export function deriveLastMoveFromFen(previousGame: ChessInstance, nextFen: string): LastMove | null {
  if (previousGame.fen() === nextFen) {
    return null;
  }

  const legalMoves = previousGame.moves({ verbose: true });
  for (const legalMove of legalMoves) {
    const candidate = new Chess();
    candidate.load(previousGame.fen());
    const appliedMove = candidate.move(legalMove.san);
    if (appliedMove && candidate.fen() === nextFen) {
      return {
        from: appliedMove.from,
        to: appliedMove.to,
      };
    }
  }

  return null;
}

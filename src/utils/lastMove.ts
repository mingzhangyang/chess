import { Chess } from 'chess.js';
import type { Chess as ChessInstance, Move } from 'chess.js';
import type { LastMove } from './moveHighlights';

/** Reconstruct a server move from its before/after FENs, including captures. */
export function deriveMoveFromFen(previousGame: ChessInstance, nextFen: string): Move | null {
  if (previousGame.fen() === nextFen) return null;

  const legalMoves = previousGame.moves({ verbose: true });
  for (const legalMove of legalMoves) {
    const candidate = new Chess();
    candidate.load(previousGame.fen());
    const appliedMove = candidate.move(legalMove.san);
    if (appliedMove && candidate.fen() === nextFen) {
      return appliedMove;
    }
  }
  return null;
}

export function deriveLastMoveFromFen(previousGame: ChessInstance, nextFen: string): LastMove | null {
  const move = deriveMoveFromFen(previousGame, nextFen);
  return move ? { from: move.from, to: move.to } : null;
}

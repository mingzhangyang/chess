import type React from 'react';
import type { Chess, Square } from 'chess.js';

export type SquareStyles = Record<string, React.CSSProperties>;

export interface LastMove {
  from: string;
  to: string;
}

interface BuildCurrentSquareStylesParams {
  optionSquares: SquareStyles;
  lastMove?: LastMove;
  checkedKingSquare?: string | null;
  invalidMoveSquare?: string | null;
}

// backgroundImage overlays let the underlying light/dark square colors show through.
// Do not use the background shorthand; it resets backgroundColor on the board.
const SELECTED_SQUARE_STYLE: React.CSSProperties = {
  backgroundImage: 'linear-gradient(var(--board-selected-bg), var(--board-selected-bg))',
  boxShadow: 'inset 0 0 0 3px var(--board-selected-ring)',
};
const QUIET_MOVE_STYLE: React.CSSProperties = {
  backgroundImage: 'radial-gradient(circle, var(--board-legal-dot) 0 21%, transparent 22%)',
};
const CAPTURE_STYLE: React.CSSProperties = {
  boxShadow: 'inset 0 0 0 5px var(--board-capture-ring)',
};
const LAST_MOVE_STYLE: React.CSSProperties = {
  backgroundImage: 'linear-gradient(var(--board-last-move-bg), var(--board-last-move-bg))',
};
const CHECK_STYLE: React.CSSProperties = {
  backgroundImage: 'linear-gradient(var(--board-check-bg), var(--board-check-bg))',
  boxShadow: 'inset 0 0 0 3px var(--board-check-ring)',
};
const INVALID_STYLE: React.CSSProperties = {
  backgroundImage: 'linear-gradient(var(--board-invalid-bg), var(--board-invalid-bg))',
};

export function findCheckedKingSquare(game: Chess): string | null {
  if (!game.isCheck()) return null;

  const checkedColor = game.turn();
  for (const rank of game.board()) {
    for (const piece of rank) {
      if (piece && piece.type === 'k' && piece.color === checkedColor) {
        return piece.square;
      }
    }
  }
  return null;
}

export function buildMoveOptionSquares(game: Chess, fromSquare: string | null): SquareStyles {
  if (!fromSquare) return {};

  const optionSquares: SquareStyles = {
    [fromSquare]: { ...SELECTED_SQUARE_STYLE },
  };

  const moves = game.moves({ square: fromSquare as Square, verbose: true });
  for (const move of moves) {
    // Both ordinary captures and en passant deserve a capture ring.
    const isCapture = move.flags.includes('c') || move.flags.includes('e');
    optionSquares[move.to] = { ...(isCapture ? CAPTURE_STYLE : QUIET_MOVE_STYLE) };
  }

  return optionSquares;
}

export function buildCurrentSquareStyles({
  optionSquares,
  lastMove,
  checkedKingSquare,
  invalidMoveSquare,
}: BuildCurrentSquareStylesParams): SquareStyles {
  const squareStyles: SquareStyles = {};
  // Last move provides a background cue, but active legal moves must remain visible.
  if (lastMove) {
    squareStyles[lastMove.from] = { ...LAST_MOVE_STYLE };
    squareStyles[lastMove.to] = { ...LAST_MOVE_STYLE };
  }
  for (const [square, style] of Object.entries(optionSquares)) {
    squareStyles[square] = { ...squareStyles[square], ...style };
  }
  if (checkedKingSquare) {
    squareStyles[checkedKingSquare] = {
      ...squareStyles[checkedKingSquare],
      ...CHECK_STYLE,
    };
  }
  if (invalidMoveSquare) {
    squareStyles[invalidMoveSquare] = {
      ...squareStyles[invalidMoveSquare],
      ...INVALID_STYLE,
    };
  }
  return squareStyles;
}

import type React from 'react';
import type { Chess, Square } from 'chess.js';

export type SquareStyles = Record<string, React.CSSProperties>;

interface LastMove {
  from: string;
  to: string;
}

interface BuildCurrentSquareStylesParams {
  optionSquares: SquareStyles;
  lastMove?: LastMove;
  invalidMoveSquare?: string | null;
}

const SELECTED_SQUARE_STYLE: React.CSSProperties = { background: 'rgba(255, 255, 0, 0.4)' };
const MOVE_OPTION_STYLE: React.CSSProperties = {
  background: 'radial-gradient(circle, rgba(0,0,0,.2) 25%, transparent 25%)',
  borderRadius: '50%',
};
const INVALID_SQUARE_BACKGROUND = 'rgba(239, 68, 68, 0.6)';

export function buildMoveOptionSquares(game: Chess, fromSquare: string | null): SquareStyles {
  if (!fromSquare) {
    return {};
  }

  const optionSquares: SquareStyles = {
    [fromSquare]: { ...SELECTED_SQUARE_STYLE },
  };

  const moves = game.moves({ square: fromSquare as Square, verbose: true });
  for (const move of moves) {
    optionSquares[move.to] = { ...MOVE_OPTION_STYLE };
  }

  return optionSquares;
}

export function buildCurrentSquareStyles({
  optionSquares,
  lastMove,
  invalidMoveSquare,
}: BuildCurrentSquareStylesParams): SquareStyles {
  const squareStyles: SquareStyles = { ...optionSquares };

  if (lastMove) {
    squareStyles[lastMove.from] = {
      ...squareStyles[lastMove.from],
      background: SELECTED_SQUARE_STYLE.background,
    };
    squareStyles[lastMove.to] = {
      ...squareStyles[lastMove.to],
      background: SELECTED_SQUARE_STYLE.background,
    };
  }

  if (invalidMoveSquare) {
    squareStyles[invalidMoveSquare] = {
      ...squareStyles[invalidMoveSquare],
      background: INVALID_SQUARE_BACKGROUND,
    };
  }

  return squareStyles;
}

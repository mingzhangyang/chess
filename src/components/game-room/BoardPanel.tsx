import React, { useMemo, useRef } from 'react';
import { useMaxSquareSize } from '../../utils/useMaxSquareSize';
import { AccessibleChessboard } from '../AccessibleChessboard';

import { DARK_SQUARE_STYLE, LIGHT_SQUARE_STYLE } from '../../utils/boardStyles';

interface BoardPanelProps {
  fen: string;
  isBlackOrientation: boolean;
  currentSquareStyles: Record<string, React.CSSProperties>;
  onDrop: ({ sourceSquare, targetSquare }: { sourceSquare: string; targetSquare: string | null }) => boolean;
  onSquareClick: ({ square }: { square: string }) => void;
}

export const BoardPanel = React.memo(function BoardPanel({
  fen,
  isBlackOrientation,
  currentSquareStyles,
  onDrop,
  onSquareClick,
}: BoardPanelProps) {
  const boardViewportRef = useRef<HTMLDivElement>(null);
  const boardSize = useMaxSquareSize(boardViewportRef);
  const boardOptions = useMemo(() => ({
    position: fen,
    onPieceDrop: onDrop,
    onSquareClick,
    boardOrientation: isBlackOrientation ? 'black' : 'white',
    darkSquareStyle: DARK_SQUARE_STYLE,
    lightSquareStyle: LIGHT_SQUARE_STYLE,
    squareStyles: currentSquareStyles,
  }), [currentSquareStyles, fen, isBlackOrientation, onDrop, onSquareClick]);

  return (
    <div className="enter-fade enter-delay-1 flex min-h-0 flex-1 items-center justify-center overflow-hidden px-1.5 pb-[calc(4.5rem+env(safe-area-inset-bottom))] pt-1 sm:px-6 sm:pt-6 md:pb-6">
        <div ref={boardViewportRef} className="flex h-full w-full min-h-0 min-w-0 items-center justify-center">
      <div
        className="chess-board-frame max-h-full max-w-full overflow-hidden rounded-2xl p-1.5 sm:p-2"
        style={boardSize > 0 ? { width: `${boardSize}px`, height: `${boardSize}px` } : undefined}
      >
        <div className="h-full w-full overflow-hidden rounded-lg">
          <AccessibleChessboard options={boardOptions} />
        </div>
        </div>
      </div>
    </div>
  );
});

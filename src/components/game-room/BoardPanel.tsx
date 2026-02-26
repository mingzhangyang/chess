import React, { useMemo, useRef } from 'react';
import { Chessboard } from 'react-chessboard';
import { useMaxSquareSize } from '../../utils/useMaxSquareSize';

const DARK_SQUARE_STYLE: React.CSSProperties = { backgroundColor: '#8f6a4f' };
const LIGHT_SQUARE_STYLE: React.CSSProperties = { backgroundColor: '#f2e6cc' };

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
    <div ref={boardViewportRef} className="enter-fade enter-delay-1 flex min-h-0 flex-1 items-center justify-center overflow-hidden p-2 pb-24 sm:p-6 md:pb-6">
      <div
        className="surface-panel-strong max-h-full max-w-full overflow-hidden rounded-2xl border border-[var(--panel-border)] p-1.5 shadow-2xl sm:p-2"
        style={boardSize > 0 ? { width: `${boardSize}px`, height: `${boardSize}px` } : undefined}
      >
        <div className="h-full w-full overflow-hidden rounded-lg">
          <Chessboard options={boardOptions} />
        </div>
      </div>
    </div>
  );
});

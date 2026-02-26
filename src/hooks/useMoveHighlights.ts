import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import type { Chess } from 'chess.js';
import { buildCurrentSquareStyles, buildMoveOptionSquares, type LastMove, type SquareStyles } from '../utils/moveHighlights';

interface UseMoveHighlightsParams {
  game: Chess;
  moveFrom: string | null;
  lastMove?: LastMove;
  invalidHighlightDurationMs?: number;
}

interface UseMoveHighlightsResult {
  optionSquares: SquareStyles;
  invalidMoveSquare: string | null;
  triggerInvalidMove: (square: string) => void;
  clearInvalidMoveHighlight: () => void;
  currentSquareStyles: SquareStyles;
}

export function useMoveHighlights({
  game,
  moveFrom,
  lastMove,
  invalidHighlightDurationMs = 500,
}: UseMoveHighlightsParams): UseMoveHighlightsResult {
  const [invalidMoveSquare, setInvalidMoveSquare] = useState<string | null>(null);
  const invalidMoveTimerRef = useRef<number | null>(null);

  const clearInvalidMoveHighlight = useCallback(() => {
    if (invalidMoveTimerRef.current !== null) {
      window.clearTimeout(invalidMoveTimerRef.current);
      invalidMoveTimerRef.current = null;
    }
    setInvalidMoveSquare(null);
  }, []);

  const triggerInvalidMove = useCallback((square: string) => {
    setInvalidMoveSquare(square);
    if (invalidMoveTimerRef.current !== null) {
      window.clearTimeout(invalidMoveTimerRef.current);
    }
    invalidMoveTimerRef.current = window.setTimeout(() => {
      setInvalidMoveSquare(null);
      invalidMoveTimerRef.current = null;
    }, invalidHighlightDurationMs);
  }, [invalidHighlightDurationMs]);

  useEffect(() => {
    return () => {
      if (invalidMoveTimerRef.current !== null) {
        window.clearTimeout(invalidMoveTimerRef.current);
      }
    };
  }, []);

  const optionSquares = useMemo(() => buildMoveOptionSquares(game, moveFrom), [game, moveFrom]);

  const currentSquareStyles: Record<string, React.CSSProperties> = useMemo(
    () =>
      buildCurrentSquareStyles({
        optionSquares,
        lastMove,
        invalidMoveSquare,
      }),
    [invalidMoveSquare, lastMove, optionSquares],
  );

  return {
    optionSquares,
    invalidMoveSquare,
    triggerInvalidMove,
    clearInvalidMoveHighlight,
    currentSquareStyles,
  };
}

import React, { useCallback, useMemo } from 'react';
import { Chessboard } from 'react-chessboard';
import type { ChessboardOptions, SquareHandlerArgs } from 'react-chessboard';
import { useI18n } from '../i18n/I18nContext';

interface AccessibleChessboardProps {
  options: ChessboardOptions;
}

const PIECE_NAMES = {
  p: 'pawn',
  n: 'knight',
  b: 'bishop',
  r: 'rook',
  q: 'queen',
  k: 'king',
} as const;

export const AccessibleChessboard = React.memo(function AccessibleChessboard({ options }: AccessibleChessboardProps) {
  const { t } = useI18n();

  const squareRenderer = useCallback(({ piece, square, children }: SquareHandlerArgs & { children?: React.ReactNode }) => {
    const pieceType = piece?.pieceType.slice(1).toLowerCase() as keyof typeof PIECE_NAMES | undefined;
    const pieceColor = piece?.pieceType.startsWith('w') ? t('common.white') : t('common.black');
    const pieceLabel = pieceType ? `${pieceColor} ${t(`game.pieces.${PIECE_NAMES[pieceType]}`)}` : '';
    const ariaLabel = pieceLabel
      ? t('game.boardSquareOccupied', { square, piece: pieceLabel })
      : t('game.boardSquare', { square });

    const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== 'Enter' && event.key !== ' ') {
        return;
      }
      event.preventDefault();
      options.onSquareClick?.({ piece, square });
    };

    return (
      <div
        role="button"
        tabIndex={0}
        aria-label={ariaLabel}
        aria-roledescription={t('game.boardSquareRole')}
        onKeyDown={handleKeyDown}
        className="relative flex h-full w-full items-center justify-center"
        style={options.squareStyles?.[square]}
      >
        {children}
      </div>
    );
  }, [options.onSquareClick, options.squareStyles, t]);

  const accessibleOptions = useMemo(() => ({
    ...options,
    squareRenderer,
  }), [options, squareRenderer]);

  return (
    <div role="region" aria-label={t('game.boardLabel')} aria-describedby="chessboard-instructions" className="h-full w-full">
      <p id="chessboard-instructions" className="sr-only">
        {t('game.boardInstructions')}
      </p>
      <Chessboard options={accessibleOptions} />
    </div>
  );
});

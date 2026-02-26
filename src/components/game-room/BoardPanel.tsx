import React, { useMemo, useRef } from 'react';
import { Chessboard } from 'react-chessboard';
import { useMaxSquareSize } from '../../utils/useMaxSquareSize';
import { useI18n } from '../../i18n/I18nContext';

const DARK_SQUARE_STYLE: React.CSSProperties = { backgroundColor: '#8f6a4f' };
const LIGHT_SQUARE_STYLE: React.CSSProperties = { backgroundColor: '#f2e6cc' };

interface BoardPanelProps {
  fen: string;
  isBlackOrientation: boolean;
  currentSquareStyles: Record<string, React.CSSProperties>;
  statusAlert: boolean;
  turnColor: 'w' | 'b';
  gameStatus: string;
  myColor: 'w' | 'b' | null;
  resetPulse: boolean;
  onReset: () => void;
  onDrop: ({ sourceSquare, targetSquare }: { sourceSquare: string; targetSquare: string | null }) => boolean;
  onSquareClick: ({ square }: { square: string }) => void;
}

export const BoardPanel = React.memo(function BoardPanel({
  fen,
  isBlackOrientation,
  currentSquareStyles,
  statusAlert,
  turnColor,
  gameStatus,
  myColor,
  resetPulse,
  onReset,
  onDrop,
  onSquareClick,
}: BoardPanelProps) {
  const { t } = useI18n();
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
  const colorLabel = myColor === 'w' ? t('common.white') : myColor === 'b' ? t('common.black') : t('common.spectator');

  return (
    <div className="enter-fade enter-delay-1 flex min-h-0 flex-1 flex-col items-center overflow-hidden p-2 pb-24 sm:p-6 md:pb-6">
      <div className="flex h-full min-h-0 w-full max-w-[820px] flex-col gap-3 sm:gap-4">
        <div className="surface-panel flex flex-wrap items-center justify-between gap-3 rounded-2xl px-4 py-3">
          <div className={`flex items-center gap-3 rounded-lg px-2 py-1 transition-colors ${statusAlert ? 'status-alert bg-[var(--danger-soft)]' : ''}`}>
            <div className={`h-3 w-3 rounded-full ${turnColor === 'w' ? 'border border-slate-300 bg-white' : 'border border-slate-800 bg-black'}`} />
            <span className="font-medium text-sm sm:text-base">
              {gameStatus}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-3 sm:gap-4">
            <span className="text-xs sm:text-sm text-[var(--text-muted)]">
              {t('game.playingAsLabel')} <strong className="text-[var(--text-primary)]">{colorLabel}</strong>
            </span>
            <button
              onClick={onReset}
              className={`button-neutral rounded-lg px-3 py-1.5 text-xs font-medium transition-colors sm:text-sm ${resetPulse ? 'reset-feedback' : ''}`}
            >
              {t('game.reset')}
            </button>
          </div>
        </div>
        <div ref={boardViewportRef} className="flex min-h-0 w-full flex-1 items-center justify-center">
          <div
            className="surface-panel-strong max-h-full max-w-full overflow-hidden rounded-2xl border border-[var(--panel-border)] p-1.5 shadow-2xl sm:p-2"
            style={boardSize > 0 ? { width: `${boardSize}px`, height: `${boardSize}px` } : undefined}
          >
            <div className="h-full w-full overflow-hidden rounded-lg">
              <Chessboard options={boardOptions} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Chess, Square } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import { LogOut, RefreshCw, Undo2, Settings2, X, Sun, Moon, Volume2, VolumeX } from 'lucide-react';
import { cloneGameWithHistory } from '../utils/cloneGameWithHistory';
import { playMoveSound } from '../utils/moveSound';
import { useMaxSquareSize } from '../utils/useMaxSquareSize';
import { useMoveHighlights } from '../hooks/useMoveHighlights';
import type { LastMove } from '../utils/moveHighlights';
import type { AiTuning, AiStyle } from '../utils/chessAI';
import { useI18n } from '../i18n/I18nContext';
import { GameResultModal } from './GameResultModal';

const OPENING_VARIETY_STORAGE_KEY = 'single-player-opening-variety';
const ANTI_SHUFFLE_STORAGE_KEY = 'single-player-anti-shuffle';
const AI_STYLE_STORAGE_KEY = 'single-player-ai-style';

const clampNumber = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const readStoredSliderValue = (storageKey: string, fallback: number, min: number, max: number): number => {
  if (typeof window === 'undefined') {
    return fallback;
  }

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (raw === null) {
      return fallback;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }
    return clampNumber(Math.round(parsed), min, max);
  } catch {
    return fallback;
  }
};

interface SinglePlayerRoomProps {
  difficulty: string;
  onLeave: () => void;
  isDark: boolean;
  isSoundEnabled: boolean;
  onToggleTheme: () => void;
  onToggleSound: () => void;
}

interface AiComputeRequest {
  type: 'compute-best-move';
  requestId: number;
  fen: string;
  difficulty: string;
  tuning?: Partial<AiTuning>;
}

interface AiComputeResponse {
  type: 'best-move-result';
  requestId: number;
  fen: string;
  bestMove: string | null;
  error?: string;
}

export default function SinglePlayerRoom({
  difficulty,
  onLeave,
  isDark,
  isSoundEnabled,
  onToggleTheme,
  onToggleSound,
}: SinglePlayerRoomProps) {
  const { t } = useI18n();
  const [game, setGame] = useState(new Chess());
  const [playerColor, setPlayerColor] = useState<'w' | 'b'>('w');
  const [isThinking, setIsThinking] = useState(false);
  const [moveFrom, setMoveFrom] = useState<string | null>(null);
  const [lastMove, setLastMove] = useState<LastMove | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [resetPulse, setResetPulse] = useState(false);
  const [openingVariety, setOpeningVariety] = useState(() =>
    readStoredSliderValue(OPENING_VARIETY_STORAGE_KEY, 70, 0, 100),
  );
  const [antiShuffleStrength, setAntiShuffleStrength] = useState(() =>
    readStoredSliderValue(ANTI_SHUFFLE_STORAGE_KEY, 45, 0, 120),
  );
  const [aiStyle, setAiStyle] = useState<AiStyle>(() => {
    if (typeof window === 'undefined') return 'balanced';
    const stored = window.localStorage.getItem(AI_STYLE_STORAGE_KEY);
    return (['aggressive', 'defensive', 'balanced'] as AiStyle[]).includes(stored as AiStyle)
      ? (stored as AiStyle)
      : 'balanced';
  });
  const [isResultModalOpen, setIsResultModalOpen] = useState(false);
  const [hasShownResult, setHasShownResult] = useState(false);
  const resetFeedbackTimerRef = useRef<number | null>(null);
  const gameRef = useRef(game);
  const aiWorkerRef = useRef<Worker | null>(null);
  const aiRequestIdRef = useRef(0);
  const pendingFenRef = useRef<string | null>(null);
  const skipAutoMoveRef = useRef(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(min-width: 768px)');
    const handleLayoutChange = () => {
      setShowControls(mediaQuery.matches);
    };
    handleLayoutChange();
    mediaQuery.addEventListener('change', handleLayoutChange);
    return () => mediaQuery.removeEventListener('change', handleLayoutChange);
  }, []);

  useEffect(() => {
    return () => {
      if (resetFeedbackTimerRef.current) {
        window.clearTimeout(resetFeedbackTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(OPENING_VARIETY_STORAGE_KEY, String(openingVariety));
    } catch {
      // Ignore persistence failures in privacy modes.
    }
  }, [openingVariety]);

  useEffect(() => {
    try {
      window.localStorage.setItem(ANTI_SHUFFLE_STORAGE_KEY, String(antiShuffleStrength));
    } catch {
      // Ignore persistence failures in privacy modes.
    }
  }, [antiShuffleStrength]);

  useEffect(() => {
    try {
      window.localStorage.setItem(AI_STYLE_STORAGE_KEY, aiStyle);
    } catch {
      // Ignore persistence failures in privacy modes.
    }
  }, [aiStyle]);

  useEffect(() => {
    gameRef.current = game;
  }, [game]);

  const applyGameState = useCallback((nextGame: Chess, nextLastMove: LastMove | null) => {
    setGame(nextGame);
    setLastMove(nextLastMove);
    setCanUndo(nextGame.history().length > 0);

    if (nextGame.isGameOver()) {
      setIsResultModalOpen(true);
      setHasShownResult(true);
    } else {
      setHasShownResult(false);
    }
  }, []);

  useEffect(() => {
    const worker = new Worker(new URL('../workers/chessAiWorker.ts', import.meta.url), { type: 'module' });
    aiWorkerRef.current = worker;

    const handleWorkerMessage = (event: MessageEvent<AiComputeResponse>) => {
      const payload = event.data;
      if (!payload || payload.type !== 'best-move-result') {
        return;
      }
      if (payload.requestId !== aiRequestIdRef.current) {
        return;
      }

      setIsThinking(false);
      if (!payload.bestMove || payload.fen !== pendingFenRef.current) {
        return;
      }

      const currentGame = gameRef.current;
      if (currentGame.fen() !== payload.fen || currentGame.isGameOver() || currentGame.turn() === playerColor) {
        return;
      }

      const nextGame = cloneGameWithHistory(currentGame);
      try {
        const move = nextGame.move(payload.bestMove);
        if (!move) {
          return;
        }
        applyGameState(nextGame, { from: move.from, to: move.to });
        playMoveSound();
      } catch {
        return;
      }
    };

    worker.addEventListener('message', handleWorkerMessage);
    return () => {
      worker.removeEventListener('message', handleWorkerMessage);
      worker.terminate();
      aiWorkerRef.current = null;
      setIsThinking(false);
    };
  }, [applyGameState, playerColor]);

  const aiTuning = useMemo<Partial<AiTuning>>(() => {
    const normalizedVariety = Math.min(100, Math.max(0, openingVariety));
    const normalizedAntiShuffle = Math.min(200, Math.max(0, antiShuffleStrength));
    const openingBookEnabled = normalizedVariety > 0;
    const hardCandidateCap = normalizedVariety >= 75 ? 4 : normalizedVariety >= 40 ? 3 : 2;
    const hardOpeningBand = Math.round(20 + normalizedVariety * 1.2);
    const hardOpeningFallbackBand = Math.round(40 + normalizedVariety * 1.8);

    return {
      backtrackPenalty: normalizedAntiShuffle,
      openingBookEnabled,
      openingBookMaxPly: openingBookEnabled ? 10 : 0,
      hardOpeningBand,
      hardOpeningFallbackBand,
      hardCandidateCap,
      aiStyle,
    };
  }, [antiShuffleStrength, openingVariety, aiStyle]);

  const makeComputerMove = useCallback(() => {
    const worker = aiWorkerRef.current;
    if (!worker) {
      return;
    }
    const fen = game.fen();
    aiRequestIdRef.current += 1;
    pendingFenRef.current = fen;
    setIsThinking(true);
    const payload: AiComputeRequest = {
      type: 'compute-best-move',
      requestId: aiRequestIdRef.current,
      fen,
      difficulty,
      tuning: aiTuning,
    };
    worker.postMessage(payload);
  }, [aiTuning, difficulty, game]);

  useEffect(() => {
    if (skipAutoMoveRef.current) {
      skipAutoMoveRef.current = false;
      return;
    }
    if (!isThinking && game.turn() !== playerColor && !game.isGameOver()) {
      makeComputerMove();
    }
  }, [game, isThinking, makeComputerMove, playerColor]);

  const statusAlert = game.isCheck() || game.isCheckmate();

  const { triggerInvalidMove, clearInvalidMoveHighlight, currentSquareStyles } = useMoveHighlights({
    game,
    moveFrom,
    lastMove: lastMove ?? undefined,
  });

  const onSquareClick = useCallback(({ square }: { square: string }) => {
    if (game.turn() !== playerColor) return;
    if (isThinking) return;

    if (!moveFrom) {
      const piece = game.get(square as Square);
      if (piece && piece.color === playerColor) {
        setMoveFrom(square);
      }
      return;
    }

    try {
      const newGame = cloneGameWithHistory(game);
      const move = newGame.move({
        from: moveFrom,
        to: square,
        promotion: 'q',
      });

      if (move === null) {
        const piece = game.get(square as Square);
        if (piece && piece.color === playerColor) {
          setMoveFrom(square);
        } else {
          triggerInvalidMove(square);
          setMoveFrom(null);
        }
        return;
      }

      applyGameState(newGame, { from: move.from, to: move.to });
      setMoveFrom(null);
      playMoveSound();
    } catch (e) {
      const piece = game.get(square as Square);
      if (piece && piece.color === playerColor) {
        setMoveFrom(square);
      } else {
        triggerInvalidMove(square);
        setMoveFrom(null);
      }
    }
  }, [applyGameState, game, isThinking, moveFrom, playerColor, triggerInvalidMove]);

  const onDrop = useCallback(({ sourceSquare, targetSquare }: { sourceSquare: string, targetSquare: string | null }) => {
    if (!targetSquare) return false;
    if (game.turn() !== playerColor) return false;
    if (isThinking) return false;

    try {
      const newGame = cloneGameWithHistory(game);
      const move = newGame.move({
        from: sourceSquare,
        to: targetSquare,
        promotion: 'q',
      });

      if (move === null) {
        triggerInvalidMove(targetSquare);
        return false;
      }

      applyGameState(newGame, { from: move.from, to: move.to });
      setMoveFrom(null);
      playMoveSound();
      return true;
    } catch (e) {
      triggerInvalidMove(targetSquare);
      return false;
    }
  }, [applyGameState, game, isThinking, playerColor, triggerInvalidMove]);

  const resetGame = useCallback(() => {
    setResetPulse(true);
    if (resetFeedbackTimerRef.current) {
      window.clearTimeout(resetFeedbackTimerRef.current);
    }
    resetFeedbackTimerRef.current = window.setTimeout(() => setResetPulse(false), 260);
    applyGameState(new Chess(), null);
    setMoveFrom(null);
    clearInvalidMoveHighlight();
    setIsResultModalOpen(false);
    setHasShownResult(false);
  }, [applyGameState, clearInvalidMoveHighlight]);

  const undoMove = useCallback(() => {
    if (isThinking) return;

    const gameCopy = cloneGameWithHistory(game);

    if (gameCopy.history().length >= 2) {
      gameCopy.undo();
      gameCopy.undo();
    } else if (gameCopy.history().length === 1) {
      gameCopy.undo();
    } else {
      return;
    }

    applyGameState(gameCopy, null);
    setMoveFrom(null);
    clearInvalidMoveHighlight();
  }, [applyGameState, clearInvalidMoveHighlight, game, isThinking]);

  const gameStatus = useMemo(() => {
    if (game.isCheckmate()) {
      const winner = game.turn() === 'w' ? t('common.black') : t('common.white');
      return t('single.checkmate', { winner });
    }
    if (game.isStalemate()) return t('single.stalemate');
    if (game.isDraw()) return t('single.draw');
    if (game.isCheck()) return t('single.check');
    if (game.isGameOver()) return t('single.gameOver');
    return game.turn() === playerColor ? t('single.yourTurn') : t('single.computerThinking');
  }, [game, playerColor, t]);

  const modalData = useMemo(() => {
    if (!game.isGameOver()) return { title: '', subtitle: '' };

    if (game.isCheckmate()) {
      const winner = game.turn() === 'w' ? t('common.black') : t('common.white');
      return {
        title: t('single.checkmate', { winner }),
        subtitle: t('single.gameOver'),
      };
    }
    if (game.isStalemate()) {
      return {
        title: t('single.stalemate'),
        subtitle: t('single.gameOver'),
      };
    }
    if (game.isDraw()) {
      return {
        title: t('single.draw'),
        subtitle: t('single.gameOver'),
      };
    }
    return {
      title: t('single.gameOver'),
      subtitle: '',
    };
  }, [game, t]);

  const boardOptions = useMemo(() => ({
    position: game.fen(),
    onPieceDrop: onDrop,
    onSquareClick: onSquareClick,
    boardOrientation: playerColor === 'w' ? 'white' : 'black',
    darkSquareStyle: { backgroundColor: '#8f6a4f' },
    lightSquareStyle: { backgroundColor: '#f2e6cc' },
    squareStyles: currentSquareStyles,
  }), [currentSquareStyles, game, onDrop, onSquareClick, playerColor]);
  const boardViewportRef = useRef<HTMLDivElement>(null);
  const boardSize = useMaxSquareSize(boardViewportRef);

  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden text-[var(--text-primary)] md:h-dvh md:flex-row">
      {!showControls && (
        <button
          onClick={() => setShowControls(true)}
          className="surface-panel-strong button-neutral fixed bottom-4 right-4 z-50 rounded-full p-3 shadow-xl transition-all duration-200 hover:scale-[1.03] md:hidden"
          title={t('common.showControls')}
          aria-label={t('common.showControls')}
        >
          <Settings2 className="w-6 h-6" />
        </button>
      )}

      {showControls && (
        <button
          type="button"
          onClick={() => setShowControls(false)}
          className="fixed inset-0 z-30 bg-slate-900/45 backdrop-blur-[1px] md:hidden"
          aria-label={t('common.hideControls')}
        />
      )}

      <div className={`surface-panel-strong enter-fade-up fixed inset-x-0 bottom-0 z-40 mobile-drawer flex max-h-[78dvh] w-full shrink-0 flex-col overflow-y-auto rounded-t-3xl border-t border-[var(--panel-border)] pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl transition-[opacity,transform] duration-300 ease-out md:static md:h-full md:max-h-none md:w-[19rem] md:rounded-none md:border-t-0 md:border-r md:pb-0 md:shadow-none lg:w-[21rem] xl:w-[22rem] ${showControls ? 'mobile-drawer-open translate-y-0 opacity-100 pointer-events-auto' : 'mobile-drawer-closed translate-y-full opacity-0 pointer-events-none'} md:translate-y-0 md:opacity-100 md:pointer-events-auto`}>
        <header className="flex flex-col items-center justify-between gap-3 px-4 py-3 md:items-stretch md:p-5">
          <div className="flex items-center justify-between w-full">
            <div className="space-y-1">
              <h1 className="title-serif text-2xl font-semibold">{t('single.title')}</h1>
              <p className="text-xs text-[var(--text-muted)]">{t('single.subtitle')}</p>
            </div>
            <button
              onClick={() => setShowControls(false)}
              className="button-neutral rounded-lg p-2 transition-colors md:hidden"
              title={t('common.hideControls')}
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex w-full flex-col gap-3 sm:flex-row md:flex-col">
            <div className="surface-panel flex w-full flex-col gap-2 rounded-lg px-3 py-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-[var(--text-muted)]">{t('single.difficulty')}</span>
                <span className="font-semibold capitalize text-[var(--accent)]">{t(`difficulty.${difficulty}`)}</span>
              </div>
              {difficulty === 'expert' && (
                <p className="border-t border-[var(--panel-border)] pt-2 text-[10px] leading-relaxed text-[var(--text-muted)] animate-in fade-in slide-in-from-top-1 duration-200">
                  {t('difficulty.expertNotice')}
                </p>
              )}
            </div>
            <div className="surface-panel w-full rounded-lg px-3 py-3">
              <div className="space-y-3">
                <div>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <label htmlFor="opening-variety" className="font-medium text-[var(--text-primary)]">{t('single.openingVariety')}</label>
                    <span className="tabular-nums text-[var(--text-muted)]">{openingVariety}</span>
                  </div>
                  <input
                    id="opening-variety"
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={openingVariety}
                    onChange={(event) => setOpeningVariety(Number(event.target.value))}
                    aria-label={t('single.openingVarietyAria')}
                    className="h-11 w-full cursor-pointer accent-[var(--accent)]"
                  />
                </div>
                <div>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <label htmlFor="anti-shuffle" className="font-medium text-[var(--text-primary)]">{t('single.antiShuffle')}</label>
                    <span className="tabular-nums text-[var(--text-muted)]">{antiShuffleStrength}</span>
                  </div>
                  <input
                    id="anti-shuffle"
                    type="range"
                    min={0}
                    max={120}
                    step={5}
                    value={antiShuffleStrength}
                    onChange={(event) => setAntiShuffleStrength(Number(event.target.value))}
                    aria-label={t('single.antiShuffleAria')}
                    className="h-11 w-full cursor-pointer accent-[var(--accent)]"
                  />
                </div>
                <div>
                  <div className="mb-2 flex items-center justify-between text-xs">
                    <span className="font-medium text-[var(--text-primary)]">{t('aiStyle.label')}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-1">
                    {(['balanced', 'aggressive', 'defensive'] as const).map((style) => (
                      <button
                        key={style}
                        type="button"
                        onClick={() => setAiStyle(style)}
                        className={`rounded-md py-1.5 text-[10px] font-medium transition-all ${aiStyle === style
                          ? 'bg-[var(--accent)] text-white shadow-sm'
                          : 'bg-[var(--panel-bg-alt)] text-[var(--text-muted)] hover:bg-[var(--panel-bg-active)]'
                          }`}
                      >
                        {t(`aiStyle.${style}`)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            <div className="grid w-full grid-cols-2 gap-2">
              <button
                type="button"
                onClick={onToggleSound}
                className="button-neutral flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors"
                title={isSoundEnabled ? t('common.muteMoveSound') : t('common.unmuteMoveSound')}
                aria-label={isSoundEnabled ? t('common.muteMoveSound') : t('common.unmuteMoveSound')}
              >
                {isSoundEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
                <span>{t('common.sound')}</span>
              </button>
              <button
                type="button"
                onClick={onToggleTheme}
                className="button-neutral flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors"
                title={t('common.toggleTheme')}
                aria-label={t('common.toggleColorTheme')}
              >
                {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                <span>{t('common.theme')}</span>
              </button>
            </div>
          </div>
        </header>

        <div className="flex flex-col gap-4 border-t border-[var(--panel-border)] px-4 py-4 md:mt-auto md:p-5">
          <div className={`flex w-full items-center justify-center gap-3 rounded-lg px-2 py-1 md:justify-start ${statusAlert ? 'status-alert bg-[var(--danger-soft)]' : ''}`}>
            <div className={`h-3 w-3 rounded-full ${game.turn() === 'w' ? 'border border-slate-300 bg-white' : 'border border-slate-800 bg-black'}`} />
            <span className="font-medium">
              {gameStatus}
            </span>
          </div>
          <div className="flex w-full flex-col gap-2 sm:flex-row md:flex-col">
            <div className="py-1 text-center text-sm text-[var(--text-muted)] md:text-left">
              {t('single.playingAsLabel')} <strong className="text-[var(--text-primary)]">{playerColor === 'w' ? t('common.white') : t('common.black')}</strong>
            </div>
            <div className="flex w-full gap-2">
              <button
                onClick={() => {
                  skipAutoMoveRef.current = true;
                  setPlayerColor(prev => prev === 'w' ? 'b' : 'w');
                }}
                className="button-neutral flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors"
                title={t('single.swapColors')}
              >
                <RefreshCw className="w-4 h-4" />
                <span className="hidden sm:inline md:inline">{t('single.swap')}</span>
              </button>
              <button
                onClick={undoMove}
                disabled={isThinking || !canUndo}
                className="button-neutral flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45"
                title={t('single.undoMove')}
              >
                <Undo2 className="w-4 h-4" />
                <span className="hidden sm:inline md:inline">{t('single.undo')}</span>
              </button>
            </div>
            <button
              onClick={resetGame}
              className={`button-accent mt-1 w-full rounded-lg px-3 py-2 text-sm font-semibold transition-all duration-200 sm:mt-0 md:mt-2 ${resetPulse ? 'reset-feedback' : ''}`}
            >
              {t('single.resetGame')}
            </button>
          </div>
          <button
            onClick={onLeave}
            className="button-danger flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors"
          >
            <LogOut className="w-4 h-4" />
            <span>{t('single.leaveGame')}</span>
          </button>
        </div>
      </div>

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

      <GameResultModal
        isOpen={isResultModalOpen}
        onClose={() => setIsResultModalOpen(false)}
        onRestart={resetGame}
        title={modalData.title}
        subtitle={modalData.subtitle}
      />
    </div>
  );
}

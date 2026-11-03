import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Chess, Square } from 'chess.js';
import { LogOut, RefreshCw, Undo2, Settings2, X, Sun, Moon, Volume2, VolumeX } from 'lucide-react';
import { cloneGameWithHistory } from '../utils/cloneGameWithHistory';
import { playMoveSound } from '../utils/moveSound';
import { createTelemetry } from '../utils/telemetry';
import { useMaxSquareSize } from '../utils/useMaxSquareSize';
import { useMoveHighlights } from '../hooks/useMoveHighlights';
import type { LastMove } from '../utils/moveHighlights';
import type { AiTuning, AiStyle } from '../utils/chessAI';
import { TT_BYTES } from '../utils/chessAI';
import { resolveAiWorkerCount, resolveAiWorkerResponseTimeoutMs } from '../utils/aiWorkerPolicy';
import { getAiHistoryWindow } from '../utils/chess-ai/chessAIRepetition';
import { AccessibleChessboard } from './AccessibleChessboard';
import { useI18n } from '../i18n/I18nContext';
import { GameResultModal } from './GameResultModal';
import { PromotionDialog } from './PromotionDialog';
import { isPawnPromotionMove, type PromotionPiece } from '../utils/chessPromotion';

const OPENING_VARIETY_STORAGE_KEY = 'single-player-opening-variety';
const ANTI_SHUFFLE_STORAGE_KEY = 'single-player-anti-shuffle';
const AI_STYLE_STORAGE_KEY = 'single-player-ai-style';
const STOCKFISH_SKILL_STORAGE_KEY = 'single-player-stockfish-skill';
const STOCKFISH_MOVETIME_STORAGE_KEY = 'single-player-stockfish-movetime';

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
  history?: string[];
  historyStartFen?: string;
  historyTruncated?: boolean;
  difficulty: string;
  backend?: 'ts' | 'stockfish-wasm';
  tuning?: Partial<AiTuning>;
  timeLimitMs?: number;
  stockfishSkillLevel?: number;
}

interface AiComputeResponse {
  type: 'best-move-result';
  requestId: number;
  fen: string;
  bestMove: string | null;
  error?: string;
}

interface AiTelemetryMessage {
  type: 'ai-telemetry';
  scope: 'ai-worker';
  level: 'info' | 'warn' | 'error';
  name: string;
  timestamp: string;
  requestId?: number;
  data?: Record<string, unknown>;
}

type AiWorkerMessage = AiComputeResponse | AiTelemetryMessage;

type WorkerEventListeners = {
  message: (event: MessageEvent<AiWorkerMessage>) => void;
  error: (event: ErrorEvent) => void;
  messageerror: (event: MessageEvent) => void;
};

export default function SinglePlayerRoom({
  difficulty,
  onLeave,
  isDark,
  isSoundEnabled,
  onToggleTheme,
  onToggleSound,
}: SinglePlayerRoomProps) {
  const { t } = useI18n();
  const aiTelemetry = useMemo(() => createTelemetry('single-player-ai'), []);
  const [game, setGame] = useState(new Chess());
  const [playerColor, setPlayerColor] = useState<'w' | 'b'>('w');
  const [isThinking, setIsThinking] = useState(false);
  const [aiComputeError, setAiComputeError] = useState(false);
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
    try {
      const stored = window.localStorage.getItem(AI_STYLE_STORAGE_KEY);
      return (['aggressive', 'defensive', 'balanced'] as AiStyle[]).includes(stored as AiStyle)
        ? (stored as AiStyle)
        : 'balanced';
    } catch {
      return 'balanced';
    }
  });
  const [stockfishSkillSlider, setStockfishSkillSlider] = useState(() =>
    readStoredSliderValue(STOCKFISH_SKILL_STORAGE_KEY, 20, 0, 20),
  );
  const [stockfishMoveTimeSlider, setStockfishMoveTimeSlider] = useState(() =>
    readStoredSliderValue(STOCKFISH_MOVETIME_STORAGE_KEY, 3200, 200, 20000),
  );
  const [isResultModalOpen, setIsResultModalOpen] = useState(false);
  const [pendingPromotion, setPendingPromotion] = useState<{ from: string; to: string } | null>(null);
  const [isDesktopLayout, setIsDesktopLayout] = useState(false);
  const [workerPoolVersion, setWorkerPoolVersion] = useState(0);
  const resetFeedbackTimerRef = useRef<number | null>(null);
  const aiWatchdogTimerRef = useRef<number | null>(null);
  const gameRef = useRef(game);
  const workersRef = useRef<Worker[]>([]);
  const workerPoolRestartRef = useRef<() => void>(() => {});
  const workerFailureRef = useRef<(worker: Worker, reason: string, error?: string) => void>(() => {});
  const aiRequestIdRef = useRef(0);
  const pendingFenRef = useRef<string | null>(null);
  const aiMoveAppliedRef = useRef(false); // ensures exactly one worker response is applied per request
  const pendingResponseCountRef = useRef(0);
  const pendingWorkersRef = useRef<Set<Worker>>(new Set());
  const playerColorRef = useRef(playerColor);
  const controlsPanelRef = useRef<HTMLDivElement>(null);
  const controlsToggleButtonRef = useRef<HTMLButtonElement>(null);
  const controlsCloseButtonRef = useRef<HTMLButtonElement>(null);
  const aiBackend: 'ts' | 'stockfish-wasm' = difficulty === 'expert' ? 'stockfish-wasm' : 'ts';

  const clearAiWatchdog = useCallback(() => {
    if (aiWatchdogTimerRef.current !== null) {
      window.clearTimeout(aiWatchdogTimerRef.current);
      aiWatchdogTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(min-width: 768px)');
    const handleLayoutChange = () => {
      setIsDesktopLayout(mediaQuery.matches);
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
    try {
      window.localStorage.setItem(STOCKFISH_SKILL_STORAGE_KEY, String(stockfishSkillSlider));
    } catch {
      // Ignore persistence failures in privacy modes.
    }
  }, [stockfishSkillSlider]);

  useEffect(() => {
    try {
      window.localStorage.setItem(STOCKFISH_MOVETIME_STORAGE_KEY, String(stockfishMoveTimeSlider));
    } catch {
      // Ignore persistence failures in privacy modes.
    }
  }, [stockfishMoveTimeSlider]);

  useEffect(() => {
    gameRef.current = game;
  }, [game]);

  useEffect(() => {
    playerColorRef.current = playerColor;
  }, [playerColor]);

  useEffect(() => {
    if (controlsPanelRef.current) {
      controlsPanelRef.current.inert = !showControls && !isDesktopLayout;
    }
    if (!isDesktopLayout) {
      if (showControls) {
        controlsCloseButtonRef.current?.focus();
      } else {
        controlsToggleButtonRef.current?.focus();
      }
    }
  }, [isDesktopLayout, showControls]);

  const applyGameState = useCallback((nextGame: Chess, nextLastMove: LastMove | null) => {
    setGame(nextGame);
    setLastMove(nextLastMove);
    setCanUndo(nextGame.history().length >= 2);

    if (nextGame.isGameOver()) {
      setIsResultModalOpen(true);
    }
  }, []);

  useEffect(() => {
    // Shared typed-array TT entries are published through several ordinary
    // writes, so concurrent workers can observe a torn entry. Keep each
    // worker's TT private until an atomic publication protocol exists.
    const canShare = false;
    const workerCount = resolveAiWorkerCount(
      aiBackend,
      difficulty,
      canShare,
      navigator.hardwareConcurrency,
    );
    const sharedBuffer = canShare ? new SharedArrayBuffer(TT_BYTES) : null;
    const workers: Worker[] = [];
    const workerListeners = new Map<Worker, WorkerEventListeners>();
    const failedWorkers = new Set<Worker>();
    workersRef.current = workers;

    const removeWorker = (worker: Worker): void => {
      const listeners = workerListeners.get(worker);
      if (listeners) {
        worker.removeEventListener('message', listeners.message);
        worker.removeEventListener('error', listeners.error);
        worker.removeEventListener('messageerror', listeners.messageerror);
      }
      workerListeners.delete(worker);
      worker.terminate();
    };

    const stopAllWorkers = (): void => {
      for (const worker of [...workersRef.current]) {
        removeWorker(worker);
      }
      workers.splice(0, workers.length);
      workersRef.current = workers;
    };

    const restartWorkerPool = (): void => {
      stopAllWorkers();
      setWorkerPoolVersion((version) => version + 1);
    };
    workerPoolRestartRef.current = restartWorkerPool;

    const terminateOtherWorkers = (winner: Worker): void => {
      for (const worker of [...workers]) {
        if (worker !== winner) {
          removeWorker(worker);
          const index = workers.indexOf(worker);
          if (index >= 0) workers.splice(index, 1);
        }
      }
      workersRef.current = workers;
    };

    const finishFailedRequestIfNeeded = (): void => {
      if (aiMoveAppliedRef.current || pendingWorkersRef.current.size > 0) return;

      clearAiWatchdog();
      setIsThinking(false);
      if (workersRef.current.length === 0 && !gameRef.current.isGameOver()) {
        setAiComputeError(true);
      }
      if (!gameRef.current.isGameOver() && gameRef.current.turn() !== playerColorRef.current) {
        setAiComputeError(true);
      }
    };

    const handleWorkerFailure = (worker: Worker, reason: string, error?: string): void => {
      if (failedWorkers.has(worker)) return;
      failedWorkers.add(worker);
      aiTelemetry.error('worker-failed', {
        reason,
        error,
      });

      removeWorker(worker);
      const index = workers.indexOf(worker);
      if (index >= 0) workers.splice(index, 1);
      workersRef.current = workers;

      const wasPending = pendingWorkersRef.current.delete(worker);
      if (wasPending) {
        pendingResponseCountRef.current = Math.max(0, pendingResponseCountRef.current - 1);
      }
      if (wasPending || workersRef.current.length === 0) {
        finishFailedRequestIfNeeded();
      }
    };
    workerFailureRef.current = handleWorkerFailure;

    const handleWorkerMessage = (worker: Worker, event: MessageEvent<AiWorkerMessage>) => {
      const payload = event.data;
      if (!payload) return;
      if (payload.type === 'ai-telemetry') {
        if (payload.level === 'error') {
          aiTelemetry.error(payload.name, payload.data);
        } else if (payload.level === 'warn') {
          aiTelemetry.warn(payload.name, payload.data);
        } else {
          aiTelemetry.info(payload.name, payload.data);
        }
        return;
      }

      if (payload.type !== 'best-move-result') return;
      if (payload.requestId !== aiRequestIdRef.current) return;
      if (!pendingWorkersRef.current.has(worker)) return;

      pendingWorkersRef.current.delete(worker);
      pendingResponseCountRef.current = Math.max(0, pendingResponseCountRef.current - 1);
      if (payload.error) {
        aiTelemetry.error('compute-request-failed', {
          requestId: payload.requestId,
          fen: payload.fen,
          error: payload.error,
        });
      }

      if (payload.bestMove && payload.fen === pendingFenRef.current && !aiMoveAppliedRef.current) {
        const currentGame = gameRef.current;
        if (currentGame.fen() === payload.fen && !currentGame.isGameOver() && currentGame.turn() !== playerColorRef.current) {
          const nextGame = cloneGameWithHistory(currentGame);
          try {
            const move = nextGame.move(payload.bestMove);
            if (move) {
              aiMoveAppliedRef.current = true;
              pendingWorkersRef.current.clear();
              pendingResponseCountRef.current = 0;
              terminateOtherWorkers(worker);
              clearAiWatchdog();
              applyGameState(nextGame, { from: move.from, to: move.to });
              setAiComputeError(false);
              playMoveSound();
            }
          } catch {
            // Ignore invalid move payloads and wait for remaining workers.
          }
        }
      }

      if (aiMoveAppliedRef.current || pendingResponseCountRef.current <= 0) {
        clearAiWatchdog();
        setIsThinking(false);
        if (!aiMoveAppliedRef.current && pendingResponseCountRef.current <= 0) {
          setAiComputeError(true);
        }
      }
    };

    for (let index = 0; index < workerCount; index += 1) {
      let w: Worker;
      try {
        w = new Worker(new URL('../workers/chessAiWorker.ts', import.meta.url), { type: 'module' });
      } catch (error) {
        aiTelemetry.error('worker-create-failed', {
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }

      const listener = (event: MessageEvent<AiWorkerMessage>) => handleWorkerMessage(w, event);
      const errorListener = (event: ErrorEvent) => {
        handleWorkerFailure(w, 'error', event.message || 'worker-error');
      };
      const messageErrorListener = (event: MessageEvent) => {
        handleWorkerFailure(w, 'messageerror', event.type || 'worker-message-error');
      };
      workerListeners.set(w, {
        message: listener,
        error: errorListener,
        messageerror: messageErrorListener,
      });
      w.addEventListener('message', listener);
      w.addEventListener('error', errorListener);
      w.addEventListener('messageerror', messageErrorListener);
      workers.push(w);

      if (sharedBuffer) {
        try {
          w.postMessage({ type: 'init-shared-tt', buffer: sharedBuffer, backend: aiBackend });
        } catch (error) {
          handleWorkerFailure(w, 'init-post-message', error instanceof Error ? error.message : String(error));
        }
      }
    }

    workersRef.current = workers;
    if (workers.length === 0 && gameRef.current.turn() !== playerColorRef.current && !gameRef.current.isGameOver()) {
      setIsThinking(false);
      setAiComputeError(true);
    }

    return () => {
      if (workerPoolRestartRef.current === restartWorkerPool) {
        workerPoolRestartRef.current = () => {};
      }
      if (workerFailureRef.current === handleWorkerFailure) {
        workerFailureRef.current = () => {};
      }
      workers.forEach(removeWorker);
      workersRef.current = workersRef.current.filter((worker) => !workers.includes(worker));
      pendingWorkersRef.current.clear();
      pendingResponseCountRef.current = 0;
      clearAiWatchdog();
      setIsThinking(false);
    };
  }, [aiBackend, aiTelemetry, applyGameState, clearAiWatchdog, difficulty, workerPoolVersion]);

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

  const stockfishSkillLevel = useMemo(() => clampNumber(stockfishSkillSlider, 0, 20), [stockfishSkillSlider]);
  const stockfishMoveTimeMs = useMemo(
    () => clampNumber(stockfishMoveTimeSlider, 200, 20000),
    [stockfishMoveTimeSlider],
  );

  const makeComputerMove = useCallback(() => {
    clearAiWatchdog();
    const workers = workersRef.current;
    if (workers.length === 0) {
      setIsThinking(false);
      setAiComputeError(true);
      return;
    }

    setAiComputeError(false);
    const fen = game.fen();
    const historyWindow = getAiHistoryWindow(game);
    aiRequestIdRef.current += 1;
    pendingFenRef.current = fen;
    aiMoveAppliedRef.current = false; // reset for the new request
    pendingWorkersRef.current = new Set(workers);
    pendingResponseCountRef.current = workers.length;
    setIsThinking(true);

    const payload: AiComputeRequest = {
      type: 'compute-best-move',
      requestId: aiRequestIdRef.current,
      fen,
      history: historyWindow.history,
      historyStartFen: historyWindow.historyStartFen,
      historyTruncated: historyWindow.historyTruncated,
      difficulty,
      backend: aiBackend,
      tuning: aiBackend === 'ts' ? aiTuning : undefined,
      stockfishSkillLevel: aiBackend === 'stockfish-wasm' ? stockfishSkillLevel : undefined,
      timeLimitMs: aiBackend === 'stockfish-wasm' ? stockfishMoveTimeMs : undefined,
    };
    // Some hung workers never emit an error. Invalidate the request before
    // rebuilding its worker pool so a stale response can never play a move.
    const requestId = aiRequestIdRef.current;
    const timeoutMs = resolveAiWorkerResponseTimeoutMs(aiBackend, difficulty, stockfishMoveTimeMs);
    aiWatchdogTimerRef.current = window.setTimeout(() => {
      if (requestId !== aiRequestIdRef.current || aiMoveAppliedRef.current) return;
      aiWatchdogTimerRef.current = null;
      aiTelemetry.error('worker-request-timeout', { requestId, fen, timeoutMs });
      aiRequestIdRef.current += 1;
      pendingFenRef.current = null;
      pendingWorkersRef.current.clear();
      pendingResponseCountRef.current = 0;
      aiMoveAppliedRef.current = true;
      workerPoolRestartRef.current();
      setIsThinking(false);
      setAiComputeError(true);
    }, timeoutMs);

    // Broadcast to all workers — first valid response wins, rest are ignored.
    [...workers].forEach((worker) => {
      try {
        worker.postMessage(payload);
      } catch (error) {
        aiTelemetry.error('worker-request-post-failed', {
          requestId: aiRequestIdRef.current,
          error: error instanceof Error ? error.message : String(error),
        });
        workerFailureRef.current(worker, 'compute-post-message', error instanceof Error ? error.message : String(error));
      }
    });
  }, [aiBackend, aiTelemetry, aiTuning, clearAiWatchdog, difficulty, game, stockfishMoveTimeMs, stockfishSkillLevel]);

  const cancelComputerMove = useCallback(() => {
    clearAiWatchdog();
    aiRequestIdRef.current += 1;
    pendingFenRef.current = null;
    pendingWorkersRef.current.clear();
    pendingResponseCountRef.current = 0;
    aiMoveAppliedRef.current = true;
    workerPoolRestartRef.current();
    setAiComputeError(false);
    setIsThinking(false);
  }, [clearAiWatchdog]);

  const retryComputerMove = useCallback(() => {
    clearAiWatchdog();
    setAiComputeError(false);
    workerPoolRestartRef.current();
  }, [clearAiWatchdog]);

  useEffect(() => {
    if (!isThinking && !aiComputeError && game.turn() !== playerColor && !game.isGameOver()) {
      makeComputerMove();
    }
  }, [aiComputeError, game, isThinking, makeComputerMove, playerColor, workerPoolVersion]);

  const statusAlert = game.isCheck() || game.isCheckmate();

  const { triggerInvalidMove, clearInvalidMoveHighlight, currentSquareStyles } = useMoveHighlights({
    game,
    moveFrom,
    lastMove: lastMove ?? undefined,
  });

  const commitPlayerMove = useCallback((sourceSquare: string, targetSquare: string, promotion: PromotionPiece = 'q') => {
    try {
      const newGame = cloneGameWithHistory(game);
      const move = newGame.move({
        from: sourceSquare,
        to: targetSquare,
        promotion,
      });

      if (move === null) {
        triggerInvalidMove(targetSquare);
        return false;
      }

      applyGameState(newGame, { from: move.from, to: move.to });
      setAiComputeError(false);
      setMoveFrom(null);
      setPendingPromotion(null);
      playMoveSound();
      return true;
    } catch {
      triggerInvalidMove(targetSquare);
      return false;
    }
  }, [applyGameState, game, triggerInvalidMove]);

  const onSquareClick = useCallback(({ square }: { square: string }) => {
    if (game.turn() !== playerColor) return;
    if (isThinking || pendingPromotion) return;

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

      if (isPawnPromotionMove(game, moveFrom, square)) {
        setPendingPromotion({ from: moveFrom, to: square });
        setMoveFrom(null);
        return;
      }

      commitPlayerMove(moveFrom, square);
    } catch {
      const piece = game.get(square as Square);
      if (piece && piece.color === playerColor) {
        setMoveFrom(square);
      } else {
        triggerInvalidMove(square);
        setMoveFrom(null);
      }
    }
  }, [commitPlayerMove, game, isThinking, moveFrom, pendingPromotion, playerColor, triggerInvalidMove]);

  const onDrop = useCallback(({ sourceSquare, targetSquare }: { sourceSquare: string, targetSquare: string | null }) => {
    if (!targetSquare) return false;
    if (game.turn() !== playerColor) return false;
    if (isThinking || pendingPromotion) return false;

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

      if (isPawnPromotionMove(game, sourceSquare, targetSquare)) {
        setPendingPromotion({ from: sourceSquare, to: targetSquare });
        setMoveFrom(null);
        return false;
      }

      return commitPlayerMove(sourceSquare, targetSquare);
    } catch {
      triggerInvalidMove(targetSquare);
      return false;
    }
  }, [commitPlayerMove, game, isThinking, pendingPromotion, playerColor, triggerInvalidMove]);

  const completePromotion = useCallback((promotion: PromotionPiece) => {
    if (!pendingPromotion) return;
    commitPlayerMove(pendingPromotion.from, pendingPromotion.to, promotion);
  }, [commitPlayerMove, pendingPromotion]);

  const cancelPromotion = useCallback(() => {
    setPendingPromotion(null);
    setMoveFrom(null);
  }, []);

  const resetGame = useCallback(() => {
    cancelComputerMove();
    setResetPulse(true);
    if (resetFeedbackTimerRef.current) {
      window.clearTimeout(resetFeedbackTimerRef.current);
    }
    resetFeedbackTimerRef.current = window.setTimeout(() => setResetPulse(false), 260);
    applyGameState(new Chess(), null);
    setMoveFrom(null);
    setPendingPromotion(null);
    clearInvalidMoveHighlight();
    setIsResultModalOpen(false);
  }, [applyGameState, cancelComputerMove, clearInvalidMoveHighlight]);

  const undoMove = useCallback(() => {
    if (isThinking) return;

    const gameCopy = cloneGameWithHistory(game);

    if (gameCopy.history().length < 2) {
      return;
    }
    cancelComputerMove();
    gameCopy.undo();
    gameCopy.undo();

    applyGameState(gameCopy, null);
    setMoveFrom(null);
    setPendingPromotion(null);
    clearInvalidMoveHighlight();
    setShowControls(false);
  }, [applyGameState, cancelComputerMove, clearInvalidMoveHighlight, game, isThinking, setShowControls]);

  const gameStatus = useMemo(() => {
    if (aiComputeError) return t('single.computerUnavailable');
    if (game.isCheckmate()) {
      const winner = game.turn() === 'w' ? t('common.black') : t('common.white');
      return t('single.checkmate', { winner });
    }
    if (game.isStalemate()) return t('single.stalemate');
    if (game.isDraw()) return t('single.draw');
    if (game.isCheck()) return t('single.check');
    if (game.isGameOver()) return t('single.gameOver');
    return game.turn() === playerColor ? t('single.yourTurn') : t('single.computerThinking');
  }, [aiComputeError, game, playerColor, t]);

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

  const swapColors = useCallback(() => {
    cancelComputerMove();
    setMoveFrom(null);
    setPendingPromotion(null);
    setPlayerColor((prev) => (prev === 'w' ? 'b' : 'w'));
  }, [cancelComputerMove]);

  const closeResultModal = useCallback(() => {
    setIsResultModalOpen(false);
  }, []);

  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden text-[var(--text-primary)] md:h-dvh md:flex-row">
      {!showControls && (
        <button
          ref={controlsToggleButtonRef}
          type="button"
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

      <div
        ref={controlsPanelRef}
        aria-hidden={!showControls && !isDesktopLayout}
        className={`surface-panel-strong enter-fade-up fixed inset-x-0 bottom-0 z-40 mobile-drawer flex max-h-[78dvh] w-full shrink-0 flex-col overflow-y-auto rounded-t-3xl border-t border-[var(--panel-border)] pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl transition-[opacity,transform] duration-300 ease-out md:static md:h-full md:max-h-none md:w-[19rem] md:rounded-none md:border-t-0 md:border-r md:pb-0 md:shadow-none lg:w-[21rem] xl:w-[22rem] ${showControls ? 'mobile-drawer-open translate-y-0 opacity-100 pointer-events-auto' : 'mobile-drawer-closed translate-y-full opacity-0 pointer-events-none'} md:translate-y-0 md:opacity-100 md:pointer-events-auto`}
      >
        <header className="flex flex-col items-center justify-between gap-3 px-4 py-3 md:items-stretch md:p-5">
          <div className="flex items-center justify-between w-full">
            <div className="space-y-1">
              <h1 className="title-serif text-2xl font-semibold">{t('single.title')}</h1>
              <p className="text-xs text-[var(--text-muted)]">{t('single.subtitle')}</p>
            </div>
            <button
              ref={controlsCloseButtonRef}
              type="button"
              onClick={() => setShowControls(false)}
              className="button-neutral rounded-lg p-2 transition-colors md:hidden"
              title={t('common.hideControls')}
              aria-label={t('common.hideControls')}
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
            </div>
            {aiBackend === 'ts' ? (
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
                          aria-pressed={aiStyle === style}
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
            ) : (
              <div className="surface-panel w-full rounded-lg px-3 py-3">
                <div className="space-y-3">
                  <div>
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <label htmlFor="stockfish-skill" className="font-medium text-[var(--text-primary)]">{t('single.stockfishSkill')}</label>
                      <span className="tabular-nums text-[var(--text-muted)]">{stockfishSkillLevel}</span>
                    </div>
                    <input
                      id="stockfish-skill"
                      type="range"
                      min={0}
                      max={20}
                      step={1}
                      value={stockfishSkillLevel}
                      onChange={(event) => setStockfishSkillSlider(Number(event.target.value))}
                      aria-label={t('single.stockfishSkillAria')}
                      className="h-11 w-full cursor-pointer accent-[var(--accent)]"
                    />
                  </div>
                  <div>
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <label htmlFor="stockfish-movetime" className="font-medium text-[var(--text-primary)]">{t('single.stockfishMoveTime')}</label>
                      <span className="tabular-nums text-[var(--text-muted)]">{stockfishMoveTimeMs}</span>
                    </div>
                    <input
                      id="stockfish-movetime"
                      type="range"
                      min={200}
                      max={20000}
                      step={100}
                      value={stockfishMoveTimeMs}
                      onChange={(event) => setStockfishMoveTimeSlider(Number(event.target.value))}
                      aria-label={t('single.stockfishMoveTimeAria')}
                      className="h-11 w-full cursor-pointer accent-[var(--accent)]"
                    />
                  </div>
                  <p className="text-xs text-[var(--text-muted)]">{t('single.stockfishExpertNote')}</p>
                </div>
              </div>
            )}
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
          <div role="status" aria-live="polite" className={`flex w-full items-center justify-center gap-3 rounded-lg px-2 py-1 md:justify-start ${statusAlert ? 'status-alert bg-[var(--danger-soft)]' : ''}`}>
            <div className={`h-3 w-3 rounded-full ${game.turn() === 'w' ? 'border border-slate-300 bg-white' : 'border border-slate-800 bg-black'}`} />
            <span className="font-medium">
              {gameStatus}
            </span>
          </div>
          {aiComputeError && (
            <div role="alert" className="flex w-full items-center justify-between gap-3 rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-sm">
              <span>{t('single.computerUnavailable')}</span>
              <button
                type="button"
                onClick={retryComputerMove}
                className="button-neutral shrink-0 rounded-md px-3 py-1.5 text-sm font-medium transition-colors"
              >
                {t('single.retryComputer')}
              </button>
            </div>
          )}
          <div className="flex w-full flex-col gap-2 sm:flex-row md:flex-col">
            <div className="py-1 text-center text-sm text-[var(--text-muted)] md:text-left">
              {t('single.playingAsLabel')} <strong className="text-[var(--text-primary)]">{playerColor === 'w' ? t('common.white') : t('common.black')}</strong>
            </div>
            <div className="flex w-full gap-2">
              <button
                type="button"
                onClick={swapColors}
                className="button-neutral flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors"
                title={t('single.swapColors')}
                aria-label={t('single.swapColors')}
              >
                <RefreshCw className="w-4 h-4" />
                <span className="hidden sm:inline md:inline">{t('single.swap')}</span>
              </button>
              <button
                type="button"
                onClick={undoMove}
                disabled={isThinking || !canUndo}
                className="button-neutral flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45"
                title={t('single.undoMove')}
                aria-label={t('single.undoMove')}
              >
                <Undo2 className="w-4 h-4" />
                <span className="hidden sm:inline md:inline">{t('single.undo')}</span>
              </button>
            </div>
            <button
              type="button"
              onClick={resetGame}
              className={`button-accent mt-1 w-full rounded-lg px-3 py-2 text-sm font-semibold transition-all duration-200 sm:mt-0 md:mt-2 ${resetPulse ? 'reset-feedback' : ''}`}
              aria-label={t('single.resetGame')}
            >
              {t('single.resetGame')}
            </button>
          </div>
          <button
            type="button"
            onClick={onLeave}
            className="button-danger flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors"
            aria-label={t('single.leaveGame')}
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
            <AccessibleChessboard options={boardOptions} />
          </div>
        </div>
      </div>

      <GameResultModal
        isOpen={isResultModalOpen}
        onClose={closeResultModal}
        onRestart={resetGame}
        title={modalData.title}
        subtitle={modalData.subtitle}
      />

      <PromotionDialog
        isOpen={!!pendingPromotion}
        color={playerColor}
        onSelect={completePromotion}
        onCancel={cancelPromotion}
      />
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Chess, Move } from 'chess.js';
import { cloneGameWithHistory } from '../utils/cloneGameWithHistory';
import { createTelemetry } from '../utils/telemetry';
import { resolveAiWorkerCount, resolveAiWorkerResponseTimeoutMs } from '../utils/aiWorkerPolicy';
import { getAiHistoryWindow } from '../utils/chess-ai/chessAIRepetition';
import type { AiTuning } from '../utils/chessAI';
import type { AiComputeRequest, AiComputeResponse, AiTelemetryMessage } from '../workers/aiWorkerRuntime';

/** UI-facing orchestration only. All chess search code executes in the worker. */
type AiWorkerMessage = AiComputeResponse | AiTelemetryMessage;

type WorkerEventListeners = {
  message: (event: MessageEvent<AiWorkerMessage>) => void;
  error: (event: ErrorEvent) => void;
  messageerror: (event: MessageEvent) => void;
};

interface SinglePlayerAiOptions {
  game: Chess;
  playerColor: 'w' | 'b';
  difficulty: string;
  aiBackend: 'ts' | 'stockfish-wasm';
  aiTuning: Partial<AiTuning>;
  stockfishSkillLevel: number;
  stockfishMoveTimeMs: number;
  onAiMove: (game: Chess, move: Move) => void;
}

export function useSinglePlayerAi({
  game,
  playerColor,
  difficulty,
  aiBackend,
  aiTuning,
  stockfishSkillLevel,
  stockfishMoveTimeMs,
  onAiMove,
}: SinglePlayerAiOptions) {
  const aiTelemetry = useMemo(() => createTelemetry('single-player-ai'), []);
  const [isThinking, setIsThinking] = useState(false);
  const [aiComputeError, setAiComputeError] = useState(false);
  const [workerPoolVersion, setWorkerPoolVersion] = useState(0);
  const aiWatchdogTimerRef = useRef<number | null>(null);
  const gameRef = useRef(game);
  const playerColorRef = useRef(playerColor);
  const workersRef = useRef<Worker[]>([]);
  const workerPoolRestartRef = useRef<() => void>(() => {});
  const workerFailureRef = useRef<(worker: Worker, reason: string, error?: string) => void>(() => {});
  const aiRequestIdRef = useRef(0);
  const pendingFenRef = useRef<string | null>(null);
  const aiMoveAppliedRef = useRef(false);
  const pendingResponseCountRef = useRef(0);
  const pendingWorkersRef = useRef<Set<Worker>>(new Set());

  const clearAiWatchdog = useCallback(() => {
    if (aiWatchdogTimerRef.current !== null) {
      window.clearTimeout(aiWatchdogTimerRef.current);
      aiWatchdogTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    gameRef.current = game;
  }, [game]);

  useEffect(() => {
    playerColorRef.current = playerColor;
  }, [playerColor]);

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
              onAiMove(nextGame, move);
              setAiComputeError(false);
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
  }, [aiBackend, aiTelemetry, onAiMove, clearAiWatchdog, difficulty, workerPoolVersion]);


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
    // This request keeps its budget even if the user changes the settings mid-search.
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


  const clearAiError = useCallback(() => setAiComputeError(false), []);

  return {
    isThinking,
    aiComputeError,
    clearAiError,
    cancelComputerMove,
    retryComputerMove,
  };
}

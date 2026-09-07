import type { AiTuning } from '../utils/chessAI';
import { MAX_REPETITION_HISTORY_LENGTH } from '../utils/chess-ai/chessAIRepetition';
import { TT_BYTES } from '../utils/chess-ai/chessAITranspositionTable';
import type { AiEngineBackend, EngineAdapter } from './engineAdapter';
import { StockfishWasmAdapter } from './stockfishWasmAdapter';
import { TsEngineAdapter } from './tsEngineAdapter';

export interface AiInitSharedTTMessage {
  type: 'init-shared-tt';
  buffer: SharedArrayBuffer;
  backend?: AiEngineBackend;
}

export interface AiComputeRequest {
  type: 'compute-best-move';
  requestId: number;
  fen: string;
  history?: string[];
  historyStartFen?: string;
  historyTruncated?: boolean;
  difficulty: string;
  backend?: AiEngineBackend;
  tuning?: Partial<AiTuning>;
  timeLimitMs?: number;
  stockfishSkillLevel?: number;
}

export interface AiComputeResponse {
  type: 'best-move-result';
  requestId: number;
  fen: string;
  bestMove: string | null;
  error?: string;
}

export interface AiTelemetryMessage {
  type: 'ai-telemetry';
  scope: 'ai-worker';
  level: 'info' | 'warn' | 'error';
  name: string;
  timestamp: string;
  requestId?: number;
  data?: Record<string, unknown>;
}

export interface AiWorkerRuntimeDeps {
  resolveBackend: (requestedBackend?: AiEngineBackend) => AiEngineBackend;
  getAdapter: (backend: AiEngineBackend) => EngineAdapter;
  emitTelemetry?: (event: AiTelemetryMessage) => void;
}

export const MAX_AI_FEN_LENGTH = 128;
export const MAX_AI_HISTORY_LENGTH = MAX_REPETITION_HISTORY_LENGTH;
const MAX_AI_DIFFICULTY_LENGTH = 16;
const MAX_AI_TUNING_KEYS = 64;
const MAX_AI_TUNING_STRING_LENGTH = 32;
const UCI_MOVE_PATTERN = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const AI_DIFFICULTIES = new Set(['easy', 'medium', 'hard', 'expert']);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isBoundedFiniteNumber = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;

const isValidTuning = (value: unknown): boolean => {
  if (value === undefined) return true;
  if (!isRecord(value)) return false;
  const entries = Object.entries(value);
  if (entries.length > MAX_AI_TUNING_KEYS) return false;
  for (const [key, entry] of entries) {
    if (key.length > 64) return false;
    if (typeof entry === 'number') {
      if (!Number.isFinite(entry)) return false;
    } else if (typeof entry === 'string') {
      if (entry.length > MAX_AI_TUNING_STRING_LENGTH) return false;
    } else if (typeof entry !== 'boolean') {
      return false;
    }
  }
  return true;
};

const isValidSharedTTBuffer = (value: unknown): value is SharedArrayBuffer =>
  typeof SharedArrayBuffer !== 'undefined'
  && value instanceof SharedArrayBuffer
  && value.byteLength === TT_BYTES;

export const isAiComputeRequest = (payload: unknown): payload is AiComputeRequest => {
  if (!isRecord(payload) || payload.type !== 'compute-best-move') return false;
  if (!Number.isSafeInteger(payload.requestId) || (payload.requestId as number) < 0) return false;
  if (
    typeof payload.fen !== 'string'
    || payload.fen.length === 0
    || payload.fen.length > MAX_AI_FEN_LENGTH
    || CONTROL_CHARACTER_PATTERN.test(payload.fen)
  ) return false;
  if (
    typeof payload.difficulty !== 'string'
    || payload.difficulty.length > MAX_AI_DIFFICULTY_LENGTH
    || !AI_DIFFICULTIES.has(payload.difficulty)
  ) return false;
  if (payload.backend !== undefined && payload.backend !== 'ts' && payload.backend !== 'stockfish-wasm') {
    return false;
  }
  if (payload.history !== undefined) {
    if (!Array.isArray(payload.history) || payload.history.length > MAX_AI_HISTORY_LENGTH) return false;
    if (!payload.history.every((move) => typeof move === 'string' && UCI_MOVE_PATTERN.test(move))) return false;
  }
  if (payload.historyStartFen !== undefined) {
    if (
      typeof payload.historyStartFen !== 'string'
      || payload.historyStartFen.length === 0
      || payload.historyStartFen.length > MAX_AI_FEN_LENGTH
      || CONTROL_CHARACTER_PATTERN.test(payload.historyStartFen)
      || payload.history === undefined
    ) return false;
  }
  if (payload.historyTruncated !== undefined && typeof payload.historyTruncated !== 'boolean') return false;
  if (payload.historyTruncated === true && payload.historyStartFen === undefined) return false;
  if (!isValidTuning(payload.tuning)) return false;
  if (payload.timeLimitMs !== undefined && !isBoundedFiniteNumber(payload.timeLimitMs, 0, 20_000)) return false;
  if (payload.stockfishSkillLevel !== undefined && !isBoundedFiniteNumber(payload.stockfishSkillLevel, 0, 20)) {
    return false;
  }
  return true;
};

export const isAiInitSharedTTMessage = (payload: unknown): payload is AiInitSharedTTMessage =>
  isRecord(payload)
  && payload.type === 'init-shared-tt'
  && isValidSharedTTBuffer(payload.buffer)
  && (payload.backend === undefined || payload.backend === 'ts' || payload.backend === 'stockfish-wasm');

const monotonicNow = (): number => (
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now()
);

const FALLBACK_TIME_LIMITS_MS: Record<string, number> = {
  easy: 250,
  medium: 600,
  hard: 1600,
  expert: 3200,
};

export const resolveAiFallbackTimeLimit = (
  difficulty: string,
  requestedTimeLimitMs: number | undefined,
  elapsedMs: number,
): number => {
  const requested = requestedTimeLimitMs !== undefined
    && Number.isFinite(requestedTimeLimitMs)
    && requestedTimeLimitMs > 0
    ? Math.min(20_000, Math.max(1, Math.floor(requestedTimeLimitMs)))
    : FALLBACK_TIME_LIMITS_MS[difficulty] ?? 1000;
  const elapsed = Number.isFinite(elapsedMs) && elapsedMs > 0 ? elapsedMs : 0;
  return Math.max(0, Math.floor(requested - elapsed));
};

const adapterByBackend = new Map<AiEngineBackend, EngineAdapter>();

const getAdapter = (backend: AiEngineBackend): EngineAdapter => {
  const existing = adapterByBackend.get(backend);
  if (existing) {
    return existing;
  }
  const created = backend === 'stockfish-wasm'
    ? new StockfishWasmAdapter()
    : new TsEngineAdapter();
  adapterByBackend.set(backend, created);
  return created;
};

const resolveBackend = (requestedBackend?: AiEngineBackend): AiEngineBackend => {
  if (requestedBackend === 'stockfish-wasm') return 'stockfish-wasm';
  return 'ts';
};

const defaultDeps: AiWorkerRuntimeDeps = {
  resolveBackend,
  getAdapter,
  emitTelemetry: () => {},
};

const withRuntimeDeps = (overrides?: Partial<AiWorkerRuntimeDeps>): AiWorkerRuntimeDeps => ({
  ...defaultDeps,
  ...overrides,
});

const emitTelemetry = (
  deps: AiWorkerRuntimeDeps,
  level: AiTelemetryMessage['level'],
  name: string,
  data?: Record<string, unknown>,
  requestId?: number,
): void => {
  deps.emitTelemetry?.({
    type: 'ai-telemetry',
    scope: 'ai-worker',
    level,
    name,
    timestamp: new Date().toISOString(),
    requestId,
    data,
  });
};

export async function handleInitSharedTT(
  payload: AiInitSharedTTMessage,
  deps?: Partial<AiWorkerRuntimeDeps>,
): Promise<void> {
  if (!isAiInitSharedTTMessage(payload)) {
    throw new Error('invalid AI worker request');
  }
  const runtimeDeps = withRuntimeDeps(deps);
  const backend = runtimeDeps.resolveBackend(payload.backend);
  try {
    const adapter = runtimeDeps.getAdapter(backend);
    await adapter.init({ sharedTTBuffer: payload.buffer });
  } catch (error) {
    if (backend === 'ts') {
      emitTelemetry(
        runtimeDeps,
        'error',
        'backend-init-failed',
        {
          backend,
          error: error instanceof Error ? error.message : String(error),
        },
      );
      throw error;
    }
    emitTelemetry(
      runtimeDeps,
      'warn',
      'backend-init-fallback',
      {
        fromBackend: backend,
        toBackend: 'ts',
        error: error instanceof Error ? error.message : String(error),
      },
    );
    const tsAdapter = runtimeDeps.getAdapter('ts');
    await tsAdapter.init({ sharedTTBuffer: payload.buffer });
  }
}

export async function handleAiComputeRequest(
  payload: unknown,
  deps?: Partial<AiWorkerRuntimeDeps>,
): Promise<AiComputeResponse | null> {
  const runtimeDeps = withRuntimeDeps(deps);
  if (!isAiComputeRequest(payload)) {
    if (isRecord(payload) && payload.type === 'compute-best-move' && Number.isSafeInteger(payload.requestId)) {
      const requestId = payload.requestId as number;
      const fen = typeof payload.fen === 'string' ? payload.fen.slice(0, MAX_AI_FEN_LENGTH) : '';
      emitTelemetry(runtimeDeps, 'error', 'invalid-worker-request', { error: 'invalid AI worker request' }, requestId);
      return {
        type: 'best-move-result',
        requestId,
        fen,
        bestMove: null,
        error: 'invalid AI worker request',
      };
    }
    return null;
  }

  const requestStartedAt = monotonicNow();
  const response: AiComputeResponse = {
    type: 'best-move-result',
    requestId: payload.requestId,
    fen: payload.fen,
    bestMove: null,
  };

  try {
    const backend = runtimeDeps.resolveBackend(payload.backend);
    const computeInput = {
      fen: payload.fen,
      ...(payload.history === undefined ? {} : { history: payload.history }),
      ...(payload.historyStartFen === undefined ? {} : { historyStartFen: payload.historyStartFen }),
      ...(payload.historyTruncated === undefined ? {} : { historyTruncated: payload.historyTruncated }),
      difficulty: payload.difficulty,
      tuning: payload.tuning,
      timeLimitMs: payload.timeLimitMs,
      stockfishSkillLevel: payload.stockfishSkillLevel,
    };
    try {
      const adapter = runtimeDeps.getAdapter(backend);
      response.bestMove = await adapter.computeBestMove(computeInput);
    } catch (error) {
      if (backend === 'ts') {
        throw error;
      }
      emitTelemetry(
        runtimeDeps,
        'warn',
        'backend-compute-fallback',
        {
          fromBackend: backend,
          toBackend: 'ts',
          error: error instanceof Error ? error.message : String(error),
          fen: payload.fen,
          difficulty: payload.difficulty,
        },
        payload.requestId,
      );
      const remainingTimeLimitMs = resolveAiFallbackTimeLimit(
        payload.difficulty,
        payload.timeLimitMs,
        monotonicNow() - requestStartedAt,
      );
      if (remainingTimeLimitMs <= 0) {
        throw error;
      }
      const tsAdapter = runtimeDeps.getAdapter('ts');
      response.bestMove = await tsAdapter.computeBestMove({
        ...computeInput,
        timeLimitMs: remainingTimeLimitMs,
      });
    }
  } catch (error) {
    response.error = error instanceof Error ? error.message : 'unknown-error';
    emitTelemetry(
      runtimeDeps,
      'error',
      'backend-compute-failed',
      {
        backend: runtimeDeps.resolveBackend(payload.backend),
        error: response.error,
        fen: payload.fen,
        difficulty: payload.difficulty,
      },
      payload.requestId,
    );
  }

  return response;
}

import type { AiTuning } from '../utils/chessAI';
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
  payload: AiComputeRequest,
  deps?: Partial<AiWorkerRuntimeDeps>,
): Promise<AiComputeResponse | null> {
  const runtimeDeps = withRuntimeDeps(deps);
  if (!payload || payload.type !== 'compute-best-move') {
    return null;
  }

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
      const tsAdapter = runtimeDeps.getAdapter('ts');
      response.bestMove = await tsAdapter.computeBestMove(computeInput);
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

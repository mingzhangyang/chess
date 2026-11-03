export type AiWorkerBackend = 'ts' | 'stockfish-wasm';

export function resolveAiWorkerCount(
  backend: AiWorkerBackend,
  difficulty: string,
  canShare: boolean,
  hardwareConcurrency = 2,
): number {
  if (backend === 'stockfish-wasm' || !canShare || difficulty !== 'hard') {
    return 1;
  }

  const availableCores = Number.isFinite(hardwareConcurrency)
    ? Math.max(1, Math.floor(hardwareConcurrency))
    : 2;
  return Math.min(availableCores, 2);
}

/** Extra wall time for engine startup, fallback, and depth-one search grace. */
export const AI_WORKER_RESPONSE_GRACE_MS = 8_000;

const TS_SEARCH_TIME_MS: Record<string, number> = {
  easy: 250,
  medium: 300,
  hard: 1_500,
  expert: 3_000,
};

export function resolveAiWorkerResponseTimeoutMs(
  backend: AiWorkerBackend,
  difficulty: string,
  stockfishMoveTimeMs?: number,
): number {
  const defaultTimeMs = backend === 'stockfish-wasm' ? 3_200 : (TS_SEARCH_TIME_MS[difficulty] ?? 1_000);
  const searchTimeMs = backend === 'stockfish-wasm'
    && typeof stockfishMoveTimeMs === 'number'
    && Number.isFinite(stockfishMoveTimeMs)
    && stockfishMoveTimeMs > 0
    ? Math.min(20_000, Math.max(200, Math.floor(stockfishMoveTimeMs)))
    : defaultTimeMs;
  return searchTimeMs + AI_WORKER_RESPONSE_GRACE_MS;
}

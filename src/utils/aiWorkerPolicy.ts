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

/** Preserve the existing response allowance for the TypeScript engine. */
export const AI_WORKER_RESPONSE_GRACE_MS = 8_000;

/** Shared limits: keep the watchdog in sync with the engines' actual deadlines. */
export const STOCKFISH_INIT_TIMEOUT_MS = 1_500;
export const STOCKFISH_SEARCH_TIMEOUT_BUFFER_MS = 1_200;
export const TS_MIN_DEPTH_GRACE_MS = 2_000;

// Cold boot: factory, assets, module, UCI ack, initial ready, per-move ready.
// Each stage can wait for the full Stockfish initialization timeout.
const STOCKFISH_COLD_START_WAIT_COUNT = 6;
const WATCHDOG_SCHEDULING_MARGIN_MS = 1_000;

/** Include full Stockfish startup/search recovery plus the TS depth-one fallback. */
export const STOCKFISH_WORKER_RESPONSE_GRACE_MS =
  STOCKFISH_COLD_START_WAIT_COUNT * STOCKFISH_INIT_TIMEOUT_MS
  + STOCKFISH_SEARCH_TIMEOUT_BUFFER_MS
  + TS_MIN_DEPTH_GRACE_MS
  + WATCHDOG_SCHEDULING_MARGIN_MS;

/** Default TS engine think time per difficulty; deeper search = stronger play. */
export const TS_SEARCH_TIME_MS: Readonly<Record<string, number>> = {
  easy: 250,
  medium: 3_000,
  hard: 10_000,
  expert: 3_000,
};

/** How long the engine is expected to think for one move. */
export function resolveAiSearchTimeMs(
  backend: AiWorkerBackend,
  difficulty: string,
  stockfishMoveTimeMs?: number,
): number {
  if (backend !== 'stockfish-wasm') return TS_SEARCH_TIME_MS[difficulty] ?? 1_000;
  return typeof stockfishMoveTimeMs === 'number'
    && Number.isFinite(stockfishMoveTimeMs)
    && stockfishMoveTimeMs > 0
    ? Math.min(20_000, Math.max(200, Math.floor(stockfishMoveTimeMs)))
    : 3_200;
}

export function resolveAiWorkerResponseTimeoutMs(
  backend: AiWorkerBackend,
  difficulty: string,
  stockfishMoveTimeMs?: number,
): number {
  const searchTimeMs = resolveAiSearchTimeMs(backend, difficulty, stockfishMoveTimeMs);
  const graceMs = backend === 'stockfish-wasm'
    ? STOCKFISH_WORKER_RESPONSE_GRACE_MS
    : AI_WORKER_RESPONSE_GRACE_MS;
  return searchTimeMs + graceMs;
}

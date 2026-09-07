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
    ? Math.max(2, Math.floor(hardwareConcurrency))
    : 2;
  return Math.min(availableCores, 2);
}

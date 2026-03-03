import type { AiTuning } from '../utils/chessAI';

export type AiEngineBackend = 'ts' | 'stockfish-wasm';

export interface EngineAdapterInitInput {
  sharedTTBuffer?: SharedArrayBuffer;
}

export interface EngineAdapterComputeInput {
  fen: string;
  difficulty: string;
  tuning?: Partial<AiTuning>;
  timeLimitMs?: number;
}

export interface EngineAdapter {
  init(input?: EngineAdapterInitInput): void | Promise<void>;
  computeBestMove(input: EngineAdapterComputeInput): string | null | Promise<string | null>;
  dispose(): void;
}

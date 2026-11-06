import type { AiTuning } from '../utils/chessAI';

export type AiEngineBackend = 'ts' | 'stockfish-wasm';

export interface EngineAdapterInitInput {
  sharedTTBuffer?: SharedArrayBuffer;
}

export interface EngineAdapterComputeInput {
  fen: string;
  /** UCI moves from the standard starting position, or from historyStartFen when supplied. */
  history?: string[];
  /** Optional FEN before history when the complete game history exceeds the protocol cap. */
  historyStartFen?: string;
  /**
   * True when positions that could still repeat were omitted before
   * historyStartFen. History that ends at an irreversible move (pawn move,
   * capture, castling or lost castling right) may be omitted with false.
   */
  historyTruncated?: boolean;
  difficulty: string;
  tuning?: Partial<AiTuning>;
  timeLimitMs?: number;
  stockfishSkillLevel?: number;
  /** TS backend only, default off: search with the independent kernel. */
  tsSearchKernel?: 'independent';
}

export interface EngineAdapter {
  init(input?: EngineAdapterInitInput): void | Promise<void>;
  computeBestMove(input: EngineAdapterComputeInput): string | null | Promise<string | null>;
  dispose(): void;
}

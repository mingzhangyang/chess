import { Chess } from 'chess.js';
import { getBestMove, initSharedTranspositionTable } from '../utils/chessAI';
import type { AiTuning } from '../utils/chessAI';

export interface AiInitSharedTTMessage {
  type: 'init-shared-tt';
  buffer: SharedArrayBuffer;
}

export interface AiComputeRequest {
  type: 'compute-best-move';
  requestId: number;
  fen: string;
  difficulty: string;
  tuning?: Partial<AiTuning>;
  timeLimitMs?: number;
}

export interface AiComputeResponse {
  type: 'best-move-result';
  requestId: number;
  fen: string;
  bestMove: string | null;
  error?: string;
}

export function handleInitSharedTT(payload: AiInitSharedTTMessage): void {
  initSharedTranspositionTable(payload.buffer);
}

export function handleAiComputeRequest(
  payload: AiComputeRequest,
  resolveBestMove: (game: Chess, difficulty: string, tuning?: Partial<AiTuning>, timeLimitMs?: number) => string | null = getBestMove,
): AiComputeResponse | null {
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
    const game = new Chess();
    if (payload.fen !== 'start') {
      game.load(payload.fen);
    }
    response.bestMove = resolveBestMove(game, payload.difficulty, payload.tuning, payload.timeLimitMs);
  } catch (error) {
    response.error = error instanceof Error ? error.message : 'unknown-error';
  }

  return response;
}

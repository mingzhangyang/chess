import { Chess } from 'chess.js';
import { getBestMove } from '../utils/chessAI';

export interface AiComputeRequest {
  type: 'compute-best-move';
  requestId: number;
  fen: string;
  difficulty: string;
}

export interface AiComputeResponse {
  type: 'best-move-result';
  requestId: number;
  fen: string;
  bestMove: string | null;
  error?: string;
}

export function handleAiComputeRequest(
  payload: AiComputeRequest,
  resolveBestMove: (game: Chess, difficulty: string) => string | null = getBestMove,
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
    response.bestMove = resolveBestMove(game, payload.difficulty);
  } catch (error) {
    response.error = error instanceof Error ? error.message : 'unknown-error';
  }

  return response;
}

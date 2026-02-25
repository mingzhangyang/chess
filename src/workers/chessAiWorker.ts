import { Chess } from 'chess.js';
import { getBestMove } from '../utils/chessAI';

interface ComputeRequest {
  type: 'compute-best-move';
  requestId: number;
  fen: string;
  difficulty: string;
}

interface ComputeResponse {
  type: 'best-move-result';
  requestId: number;
  fen: string;
  bestMove: string | null;
  error?: string;
}

self.addEventListener('message', (event: MessageEvent<ComputeRequest>) => {
  const payload = event.data;
  if (!payload || payload.type !== 'compute-best-move') {
    return;
  }

  const response: ComputeResponse = {
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
    response.bestMove = getBestMove(game, payload.difficulty);
  } catch (error) {
    response.error = error instanceof Error ? error.message : 'unknown-error';
  }

  self.postMessage(response);
});

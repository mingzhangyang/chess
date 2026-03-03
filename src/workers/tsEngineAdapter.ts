import { Chess } from 'chess.js';
import { getBestMove, initSharedTranspositionTable } from '../utils/chessAI';
import type { EngineAdapter, EngineAdapterComputeInput, EngineAdapterInitInput } from './engineAdapter';

export class TsEngineAdapter implements EngineAdapter {
  init(input?: EngineAdapterInitInput): void {
    if (input?.sharedTTBuffer) {
      initSharedTranspositionTable(input.sharedTTBuffer);
    }
  }

  computeBestMove(input: EngineAdapterComputeInput): string | null {
    const game = new Chess();
    if (input.fen !== 'start') {
      game.load(input.fen);
    }
    return getBestMove(game, input.difficulty, input.tuning, input.timeLimitMs);
  }

  dispose(): void {}
}

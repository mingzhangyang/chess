import { Chess } from 'chess.js';
import { getBestMove, initSharedTranspositionTable } from '../utils/chessAI';
import type { AiTuning } from '../utils/chessAI';
import type { EngineAdapter, EngineAdapterComputeInput, EngineAdapterInitInput } from './engineAdapter';

const UCI_MOVE_PATTERN = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/;

export const resolveTsTuning = (input: EngineAdapterComputeInput): Partial<AiTuning> | undefined => {
  if (
    input.historyStartFen !== undefined
    || input.historyTruncated === true
    || (input.history === undefined && input.fen !== 'start')
  ) {
    return {
      ...input.tuning,
      openingBookEnabled: false,
      openingBookMaxPly: 0,
    };
  }
  return input.tuning;
};

const createGameFromInput = (input: EngineAdapterComputeInput): Chess => {
  if (input.historyStartFen !== undefined && input.history === undefined) {
    throw new Error('invalid AI move history');
  }
  const game = input.historyStartFen === undefined ? new Chess() : new Chess(input.historyStartFen);
  const startingFen = game.fen();
  if (input.history !== undefined) {
    for (const uci of input.history) {
      const match = UCI_MOVE_PATTERN.exec(uci);
      if (!match) {
        throw new Error('invalid AI move history');
      }
      let move;
      try {
        move = game.move({
          from: match[1],
          to: match[2],
          promotion: match[3],
        });
      } catch {
        throw new Error('invalid AI move history');
      }
      if (!move) {
        throw new Error('invalid AI move history');
      }
    }

    const expectedFen = input.fen === 'start' ? new Chess().fen() : input.fen;
    if (game.fen() !== expectedFen) {
      throw new Error('AI move history does not match FEN');
    }
    return game;
  }

  if (input.fen !== 'start') {
    game.load(input.fen);
  }
  return game;
};

export class TsEngineAdapter implements EngineAdapter {
  init(input?: EngineAdapterInitInput): void {
    if (input?.sharedTTBuffer) {
      initSharedTranspositionTable(input.sharedTTBuffer);
    }
  }

  computeBestMove(input: EngineAdapterComputeInput): string | null {
    const game = createGameFromInput(input);
    return getBestMove(game, input.difficulty, resolveTsTuning(input), input.timeLimitMs);
  }

  dispose(): void {}
}

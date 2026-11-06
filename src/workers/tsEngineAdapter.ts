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

export const createGameFromInput = (input: EngineAdapterComputeInput): Chess => {
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

/** The independent kernel failed inside its search stage; the caller may retry with the existing search. */
export class KernelSearchError extends Error {
  constructor(readonly kernelError: unknown) {
    super(kernelError instanceof Error ? kernelError.message : String(kernelError));
    this.name = 'KernelSearchError';
  }
}

type KernelEngineModule = typeof import('../utils/chess-ai/independent/kernelEngine');
let kernelEngine: Promise<KernelEngineModule> | undefined;
// Loaded only when a request turns the switch on, so the default worker never runs it.
const loadKernelEngine = (): Promise<KernelEngineModule> => {
  kernelEngine ??= import('../utils/chess-ai/independent/kernelEngine');
  return kernelEngine;
};

export interface TsEngineAdapterOptions {
  /** Test hooks for the kernel stage (cancellation, root position). */
  kernelHooks?: import('../utils/chess-ai/independent/kernelEngine').KernelStageHooks;
}

export class TsEngineAdapter implements EngineAdapter {
  constructor(private readonly options: TsEngineAdapterOptions = {}) {}

  init(input?: EngineAdapterInitInput): void {
    if (input?.sharedTTBuffer) {
      initSharedTranspositionTable(input.sharedTTBuffer);
    }
  }

  computeBestMove(input: EngineAdapterComputeInput): string | null | Promise<string | null> {
    if (input.tsSearchKernel === 'independent') return this.computeWithKernel(input);
    const game = createGameFromInput(input);
    return getBestMove(game, input.difficulty, resolveTsTuning(input), input.timeLimitMs);
  }

  /**
   * getBestMove's game-over, easy and opening-book steps, then the kernel in
   * place of its search. Errors before the kernel stage (such as invalid
   * history) propagate unchanged; errors inside it become KernelSearchError.
   */
  private async computeWithKernel(input: EngineAdapterComputeInput): Promise<string | null> {
    const game = createGameFromInput(input);
    const { searchKernelMove } = await loadKernelEngine();
    return getBestMove(game, input.difficulty, resolveTsTuning(input), input.timeLimitMs, (root, tuning) => {
      try {
        return searchKernelMove(root, input, tuning, this.options.kernelHooks);
      } catch (error) {
        throw new KernelSearchError(error);
      }
    });
  }

  dispose(): void {}
}

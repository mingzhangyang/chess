import { Chess } from 'chess.js';
import { getBestMove, initSharedTranspositionTable, type BestMoveOptions } from '../utils/chessAI';
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

/**
 * What createGameFromInput's replay already proves, so getBestMove need not
 * replay the game again: the ply count always, and the standard-opening
 * provenance when the history starts from the standard position (only then
 * can the opening book be on; see resolveTsTuning).
 */
export const knownBestMoveContext = (input: EngineAdapterComputeInput): Pick<BestMoveOptions, 'plyCount' | 'standardOpeningProvenance'> => ({
  plyCount: input.history?.length ?? 0,
  ...(input.historyStartFen === undefined && (input.history !== undefined || input.fen === 'start')
    ? { standardOpeningProvenance: true } : {}),
});

export class KernelSearchError extends Error {
  constructor(readonly kernelError: unknown) {
    super(kernelError instanceof Error ? kernelError.message : String(kernelError));
    this.name = 'KernelSearchError';
  }
}

type KernelEngineModule = typeof import('../utils/chess-ai/independent/kernelEngine');

/** Cache successful imports, but allow a failed dynamic import to be retried. */
export const createLazyKernelLoader = <T>(importModule: () => Promise<T>) => {
  let pending: Promise<T> | undefined;
  let loaded: T | undefined;
  return {
    load: (): Promise<T> => {
      pending ??= Promise.resolve().then(importModule).then(
        (module) => { loaded = module; return module; },
        (error: unknown) => { pending = undefined; throw error; },
      );
      return pending;
    },
    loaded: (): T | undefined => loaded,
  };
};

// The production default never imports the independent kernel chunk.
const lazyKernelEngine = createLazyKernelLoader<KernelEngineModule>(
  () => import('../utils/chess-ai/independent/kernelEngine'),
);

/** Profiling only: reset the independent table if the kernel chunk has loaded. */
export const clearLoadedKernelSearchTable = (): void => {
  lazyKernelEngine.loaded()?.clearKernelSearchTable();
};

export interface TsEngineAdapterOptions {
  /** Test hooks for the kernel stage (cancellation, root position). */
  kernelHooks?: import('../utils/chess-ai/independent/kernelEngine').KernelStageHooks;
  /** Inject a failing or controlled module import in worker regression tests. */
  kernelModuleLoader?: () => Promise<KernelEngineModule>;
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
    return getBestMove(game, input.difficulty, resolveTsTuning(input), input.timeLimitMs, knownBestMoveContext(input));
  }

  /**
   * getBestMove's game-over, easy and opening-book steps, then the kernel in
   * place of its search. Errors before the kernel stage (such as invalid
   * history) propagate unchanged; errors inside it become KernelSearchError.
   */
  private async computeWithKernel(input: EngineAdapterComputeInput): Promise<string | null> {
    const game = createGameFromInput(input);
    // Validation errors above are not search failures. Only a chunk-load
    // rejection should enter the existing TS search fallback.
    let kernelModule: KernelEngineModule;
    try {
      kernelModule = await (this.options.kernelModuleLoader ?? lazyKernelEngine.load)();
    } catch (error) {
      throw new KernelSearchError(error);
    }
    return getBestMove(game, input.difficulty, resolveTsTuning(input), input.timeLimitMs, {
      ...knownBestMoveContext(input),
      searchStage: (root, tuning) => {
        try {
          return kernelModule.searchKernelMove(root, input, tuning, this.options.kernelHooks);
        } catch (error) {
          throw new KernelSearchError(error);
        }
      },
    });
  }

  dispose(): void {}
}

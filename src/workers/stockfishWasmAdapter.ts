import { Chess } from 'chess.js';
import type { EngineAdapter, EngineAdapterComputeInput, EngineAdapterInitInput } from './engineAdapter';

interface StockfishEngine {
  postMessage: (command: string) => void;
  addMessageListener: (listener: (line: string) => void) => void;
  removeMessageListener?: (listener: (line: string) => void) => void;
  terminate?: () => void;
}

type StockfishFactory = (options?: Record<string, unknown>) => Promise<StockfishEngine>;

type Waiter = {
  id: number;
  predicate: (line: string) => boolean;
  resolve: (line: string) => void;
  reject: (error: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
};

type StockfishWasmAdapterOptions = {
  initTimeoutMs?: number;
  searchTimeoutBufferMs?: number;
  createFactory?: () => Promise<StockfishFactory>;
  resolveThreads?: () => number;
  resolveHashMb?: () => number;
};

const DEFAULT_INIT_TIMEOUT_MS = 1500;
const DEFAULT_SEARCH_TIMEOUT_BUFFER_MS = 1200;
const UCI_MOVE_PATTERN = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;

const withTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
  onLateResolve?: (value: T) => void,
): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      timedOut = true;
      reject(new Error(timeoutMessage));
    }, timeoutMs);
  });
  const trackedPromise = promise.then((value) => {
    if (timedOut) {
      try {
        onLateResolve?.(value);
      } catch {
        // Cleanup hooks must not turn a settled timeout into an unhandled error.
      }
    }
    return value;
  });
  try {
    return await Promise.race([trackedPromise, timeoutPromise]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
};

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const resolveSkillLevel = (difficulty: string): number => {
  if (difficulty === 'easy') return 3;
  if (difficulty === 'medium') return 8;
  if (difficulty === 'hard') return 15;
  return 20; // expert and unknown
};

const resolveEffectiveSkillLevel = (difficulty: string, override?: number): number => {
  if (Number.isFinite(override)) {
    return clamp(Math.round(override as number), 0, 20);
  }
  return resolveSkillLevel(difficulty);
};

const resolveDefaultMoveTimeMs = (difficulty: string): number => {
  if (difficulty === 'easy') return 250;
  if (difficulty === 'medium') return 600;
  if (difficulty === 'hard') return 1600;
  return 3200; // expert and unknown
};

const normalizeBestMoveToSan = (fen: string, uciMove: string): string | null => {
  const match = UCI_MOVE_PATTERN.exec(uciMove);
  if (!match) return null;

  try {
    const game = fen === 'start' ? new Chess() : new Chess(fen);
    const move = game.move({
      from: match[1],
      to: match[2],
      promotion: match[3],
    });
    return move?.san ?? null;
  } catch {
    return null;
  }
};

type NormalizedStockfishPosition = {
  fen: string;
  command: string;
};

const normalizeStockfishPosition = (input: EngineAdapterComputeInput): NormalizedStockfishPosition => {
  if (
    typeof input.fen !== 'string'
    || CONTROL_CHARACTER_PATTERN.test(input.fen)
    || (input.historyStartFen !== undefined && CONTROL_CHARACTER_PATTERN.test(input.historyStartFen))
  ) {
    throw new Error('invalid AI position');
  }

  const expectedGame = new Chess();
  if (input.fen !== 'start') {
    try {
      expectedGame.load(input.fen);
    } catch {
      throw new Error('invalid AI position');
    }
  }

  if (input.historyStartFen !== undefined && input.history === undefined) {
    throw new Error('invalid AI move history');
  }
  let game: Chess;
  if (input.historyStartFen !== undefined) {
    try {
      game = new Chess(input.historyStartFen);
    } catch {
      throw new Error('invalid AI move history');
    }
  } else {
    game = new Chess();
  }
  if (input.history !== undefined) {
    if (!Array.isArray(input.history)) {
      throw new Error('invalid AI move history');
    }
    for (const uci of input.history) {
      if (typeof uci !== 'string') {
        throw new Error('invalid AI move history');
      }
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
    if (game.fen() !== expectedGame.fen()) {
      throw new Error('AI move history does not match FEN');
    }
  } else if (input.fen !== 'start') {
    game.load(expectedGame.fen());
  }

  const fen = game.fen();
  const command = input.history !== undefined
    ? input.historyStartFen !== undefined
      ? input.history.length === 0
        ? `position fen ${input.historyStartFen}`
        : `position fen ${input.historyStartFen} moves ${input.history.join(' ')}`
      : input.history.length === 0
        ? 'position startpos'
        : `position startpos moves ${input.history.join(' ')}`
    : input.fen === 'start'
      ? 'position startpos'
      : `position fen ${fen}`;
  return { fen, command };
};

const defaultCreateFactory = async (): Promise<StockfishFactory> => {
  const stockfishModule = await import('stockfish.wasm');
  const factory = (stockfishModule as unknown as { default?: unknown }).default ?? stockfishModule;
  if (typeof factory !== 'function') {
    throw new Error('stockfish-wasm-factory-not-found');
  }
  return factory as StockfishFactory;
};

const defaultResolveThreads = (): number => {
  const concurrency = typeof navigator !== 'undefined' && Number.isFinite(navigator.hardwareConcurrency)
    ? navigator.hardwareConcurrency
    : 1;
  return clamp(Math.floor(concurrency || 1), 1, 4);
};

const defaultResolveHashMb = (): number => 32;

export class StockfishWasmAdapter implements EngineAdapter {
  private readonly initTimeoutMs: number;

  private readonly searchTimeoutBufferMs: number;

  private readonly createFactory: () => Promise<StockfishFactory>;

  private readonly resolveThreads: () => number;

  private readonly resolveHashMb: () => number;

  private engine: StockfishEngine | null = null;

  private engineReadyPromise: Promise<void> | null = null;

  private engineGeneration = 0;

  private activeEngineListener: ((line: string) => void) | null = null;

  private commandChain: Promise<void> = Promise.resolve();

  private waiters = new Map<number, Waiter>();

  private waiterId = 0;

  private currentSkillLevel: number | null = null;

  private assetUrlsPromise: Promise<Record<string, string> | null> | null = null;

  private readonly handleEngineLine = (generation: number, line: string): void => {
    if (generation !== this.engineGeneration) return;
    const normalized = line.trim();
    for (const [id, waiter] of this.waiters.entries()) {
      if (!waiter.predicate(normalized)) {
        continue;
      }
      this.waiters.delete(id);
      clearTimeout(waiter.timeoutId);
      waiter.resolve(normalized);
      break;
    }
  };

  constructor(options: StockfishWasmAdapterOptions = {}) {
    this.initTimeoutMs = options.initTimeoutMs ?? DEFAULT_INIT_TIMEOUT_MS;
    this.searchTimeoutBufferMs = options.searchTimeoutBufferMs ?? DEFAULT_SEARCH_TIMEOUT_BUFFER_MS;
    this.createFactory = options.createFactory ?? defaultCreateFactory;
    this.resolveThreads = options.resolveThreads ?? defaultResolveThreads;
    this.resolveHashMb = options.resolveHashMb ?? defaultResolveHashMb;
  }

  async init(_input?: EngineAdapterInitInput): Promise<void> {
    await this.withCommandLock(async () => {
      await this.ensureReady();
    });
  }

  async computeBestMove(input: EngineAdapterComputeInput): Promise<string | null> {
    const position = normalizeStockfishPosition(input);
    return this.withCommandLock(async () => {
      try {
        await this.ensureReady();
        await this.applyDifficulty(input.difficulty, input.stockfishSkillLevel);
        await this.sendAndWait('isready', (line) => line === 'readyok', this.initTimeoutMs);

        // No per-move `ucinewgame`: it wipes the hash table, throwing away the
        // previous move's search. Entries are keyed by position, so reusing
        // them across moves (or games) is safe.
        this.send(position.command);

        const moveTimeMs = input.timeLimitMs && input.timeLimitMs > 0
          ? clamp(Math.floor(input.timeLimitMs), 50, 20000)
          : resolveDefaultMoveTimeMs(input.difficulty);
        const bestMoveLine = await this.sendAndWait(
          `go movetime ${moveTimeMs}`,
          (line) => line.startsWith('bestmove '),
          moveTimeMs + this.searchTimeoutBufferMs,
        );

        const bestMove = bestMoveLine.split(/\s+/)[1];
        if (!bestMove || bestMove === '(none)') {
          return null;
        }
        return normalizeBestMoveToSan(position.fen, bestMove);
      } catch (error) {
        this.dispose();
        throw error;
      }
    });
  }

  dispose(): void {
    this.engineGeneration += 1;
    this.rejectAllWaiters(new Error('stockfish-wasm-disposed'));
    const engine = this.engine;
    if (engine) {
      if (this.activeEngineListener && typeof engine.removeMessageListener === 'function') {
        engine.removeMessageListener(this.activeEngineListener);
      }
      engine.terminate?.();
    }
    this.activeEngineListener = null;
    this.engine = null;
    this.engineReadyPromise = null;
    this.currentSkillLevel = null;
  }

  private async withCommandLock<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.commandChain.then(operation, operation);
    this.commandChain = run.then(() => undefined, () => undefined);
    return run;
  }

  private async ensureReady(): Promise<void> {
    if (!this.engineReadyPromise) {
      this.engineReadyPromise = this.bootstrapEngine();
    }
    await this.engineReadyPromise;
  }

  private async bootstrapEngine(): Promise<void> {
    const generation = this.engineGeneration + 1;
    this.engineGeneration = generation;
    try {
      const factory = await withTimeout(
        this.createFactory(),
        this.initTimeoutMs,
        `stockfish-wasm-factory-timeout-${this.initTimeoutMs}ms`,
      );
      const assetUrls = await withTimeout(
        this.resolveAssetUrls(),
        this.initTimeoutMs,
        `stockfish-wasm-assets-timeout-${this.initTimeoutMs}ms`,
      );
      const moduleOptions = assetUrls
        ? {
            locateFile: (path: string): string => assetUrls[path] ?? path,
            // pthread workers importScripts() this classic script to boot the
            // engine; the bundled module copy has no usable script URL.
            mainScriptUrlOrBlob: assetUrls['stockfish.js'],
          }
        : undefined;

      const engine = await withTimeout(
        factory(moduleOptions),
        this.initTimeoutMs,
        `stockfish-wasm-engine-timeout-${this.initTimeoutMs}ms`,
        (lateEngine) => lateEngine.terminate?.(),
      );
      if (generation !== this.engineGeneration) {
        engine.terminate?.();
        throw new Error('stockfish-wasm-engine-stale');
      }
      this.engine = engine;
      const listener = (line: string): void => this.handleEngineLine(generation, line);
      this.activeEngineListener = listener;
      engine.addMessageListener(listener);

      await this.sendAndWait('uci', (line) => line === 'uciok', this.initTimeoutMs);
      this.send(`setoption name Threads value ${this.resolveThreads()}`);
      this.send(`setoption name Hash value ${this.resolveHashMb()}`);
      this.send('ucinewgame');
      await this.sendAndWait('isready', (line) => line === 'readyok', this.initTimeoutMs);
    } catch (error) {
      if (generation === this.engineGeneration) {
        this.dispose();
      }
      throw error;
    }
  }

  private async applyDifficulty(difficulty: string, override?: number): Promise<void> {
    const skillLevel = resolveEffectiveSkillLevel(difficulty, override);
    if (this.currentSkillLevel === skillLevel) {
      return;
    }

    // Drive strength through `Skill Level` alone (20 = full strength). With
    // UCI_LimitStrength on, Stockfish ignores Skill Level and derives it from
    // UCI_Elo, which this build clamps to 1350..2850 by silently rejecting
    // out-of-range values, so skill 20 used to fall back to the 1350 floor.
    this.send('setoption name UCI_LimitStrength value false');
    this.send(`setoption name Skill Level value ${skillLevel}`);
    this.currentSkillLevel = skillLevel;
  }

  private send(command: string): void {
    if (!this.engine) {
      throw new Error('stockfish-wasm-engine-not-ready');
    }
    this.engine.postMessage(command);
  }

  private async sendAndWait(
    command: string,
    predicate: (line: string) => boolean,
    timeoutMs: number,
  ): Promise<string> {
    const id = this.waiterId++;
    const waitPromise = new Promise<string>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.waiters.delete(id);
        const timeoutError = new Error(`stockfish-wasm-timeout:${command}`);
        // A timed-out search can still emit its old bestmove. Dispose the
        // engine before the next command so that stale output cannot satisfy a
        // later request's waiter.
        this.dispose();
        reject(timeoutError);
      }, timeoutMs);
      this.waiters.set(id, {
        id,
        predicate,
        resolve,
        reject,
        timeoutId,
      });
    });

    try {
      this.send(command);
    } catch (error) {
      const waiter = this.waiters.get(id);
      this.waiters.delete(id);
      if (waiter) clearTimeout(waiter.timeoutId);
      this.dispose();
      throw error;
    }
    return waitPromise;
  }

  private rejectAllWaiters(error: Error): void {
    for (const [id, waiter] of this.waiters.entries()) {
      this.waiters.delete(id);
      clearTimeout(waiter.timeoutId);
      waiter.reject(error);
    }
  }

  private async resolveAssetUrls(): Promise<Record<string, string> | null> {
    if (!this.assetUrlsPromise) {
      this.assetUrlsPromise = (async () => {
        try {
          const [wasmModule, workerModule, mainScriptModule] = await Promise.all([
            import('stockfish.wasm/stockfish.wasm?url'),
            import('stockfish.wasm/stockfish.worker.js?url'),
            import('stockfish.wasm/stockfish.js?url'),
          ]);
          const wasmUrl = (wasmModule as unknown as { default?: string }).default;
          const workerUrl = (workerModule as unknown as { default?: string }).default;
          const mainScriptUrl = (mainScriptModule as unknown as { default?: string }).default;
          if (typeof wasmUrl !== 'string' || typeof workerUrl !== 'string' || typeof mainScriptUrl !== 'string') {
            return null;
          }
          return {
            'stockfish.wasm': wasmUrl,
            'stockfish.worker.js': workerUrl,
            'stockfish.js': mainScriptUrl,
          };
        } catch {
          if (
            typeof process !== 'undefined'
            && process.versions
            && typeof process.versions.node === 'string'
          ) {
            const wasmUrl = new URL('../../node_modules/stockfish.wasm/stockfish.wasm', import.meta.url).href;
            const workerPathUrl = new URL('../../node_modules/stockfish.wasm/stockfish.worker.js', import.meta.url);
            const workerUrl = decodeURIComponent(workerPathUrl.pathname);
            const mainScriptPathUrl = new URL('../../node_modules/stockfish.wasm/stockfish.js', import.meta.url);
            return {
              'stockfish.wasm': wasmUrl,
              'stockfish.worker.js': workerUrl,
              'stockfish.js': decodeURIComponent(mainScriptPathUrl.pathname),
            };
          }
          return null;
        }
      })();
    }
    return this.assetUrlsPromise;
  }
}

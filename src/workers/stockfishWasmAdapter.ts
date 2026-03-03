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

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
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

const resolveDefaultMoveTimeMs = (difficulty: string): number => {
  if (difficulty === 'easy') return 250;
  if (difficulty === 'medium') return 600;
  if (difficulty === 'hard') return 1600;
  return 3200; // expert and unknown
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

  private commandChain: Promise<void> = Promise.resolve();

  private waiters = new Map<number, Waiter>();

  private waiterId = 0;

  private currentSkillLevel: number | null = null;

  private assetUrlsPromise: Promise<Record<string, string> | null> | null = null;

  private readonly onEngineLine = (line: string): void => {
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
    return this.withCommandLock(async () => {
      await this.ensureReady();
      await this.applyDifficulty(input.difficulty);
      await this.sendAndWait('isready', (line) => line === 'readyok', this.initTimeoutMs);

      this.send('ucinewgame');
      const positionCommand = input.fen === 'start'
        ? 'position startpos'
        : `position fen ${input.fen}`;
      this.send(positionCommand);

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
      return bestMove;
    });
  }

  dispose(): void {
    this.rejectAllWaiters(new Error('stockfish-wasm-disposed'));
    if (this.engine) {
      if (typeof this.engine.removeMessageListener === 'function') {
        this.engine.removeMessageListener(this.onEngineLine);
      }
      this.engine.terminate?.();
    }
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
    try {
      const factory = await withTimeout(
        this.createFactory(),
        this.initTimeoutMs,
        `stockfish-wasm-factory-timeout-${this.initTimeoutMs}ms`,
      );
      const assetUrls = await this.resolveAssetUrls();
      const moduleOptions = assetUrls
        ? {
            locateFile: (path: string): string => assetUrls[path] ?? path,
          }
        : undefined;

      this.engine = await withTimeout(
        factory(moduleOptions),
        this.initTimeoutMs,
        `stockfish-wasm-engine-timeout-${this.initTimeoutMs}ms`,
      );
      this.engine.addMessageListener(this.onEngineLine);

      await this.sendAndWait('uci', (line) => line === 'uciok', this.initTimeoutMs);
      this.send(`setoption name Threads value ${this.resolveThreads()}`);
      this.send(`setoption name Hash value ${this.resolveHashMb()}`);
      await this.sendAndWait('isready', (line) => line === 'readyok', this.initTimeoutMs);
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  private async applyDifficulty(difficulty: string): Promise<void> {
    const skillLevel = resolveSkillLevel(difficulty);
    if (this.currentSkillLevel === skillLevel) {
      return;
    }

    this.send('setoption name UCI_LimitStrength value true');
    this.send(`setoption name Skill Level value ${skillLevel}`);
    const elo = 800 + skillLevel * 120;
    this.send(`setoption name UCI_Elo value ${elo}`);
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
        reject(new Error(`stockfish-wasm-timeout:${command}`));
      }, timeoutMs);
      this.waiters.set(id, {
        id,
        predicate,
        resolve,
        reject,
        timeoutId,
      });
    });

    this.send(command);
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
          const [wasmModule, workerModule] = await Promise.all([
            import('stockfish.wasm/stockfish.wasm?url'),
            import('stockfish.wasm/stockfish.worker.js?url'),
          ]);
          const wasmUrl = (wasmModule as unknown as { default?: string }).default;
          const workerUrl = (workerModule as unknown as { default?: string }).default;
          if (typeof wasmUrl !== 'string' || typeof workerUrl !== 'string') {
            return null;
          }
          return {
            'stockfish.wasm': wasmUrl,
            'stockfish.worker.js': workerUrl,
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
            return {
              'stockfish.wasm': wasmUrl,
              'stockfish.worker.js': workerUrl,
            };
          }
          return null;
        }
      })();
    }
    return this.assetUrlsPromise;
  }
}

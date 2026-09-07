import assert from 'node:assert/strict';
import test from 'node:test';
import { Chess } from 'chess.js';
import { StockfishWasmAdapter } from '../../src/workers/stockfishWasmAdapter';

type LineListener = (line: string) => void;

class FakeStockfishEngine {
  public readonly commands: string[] = [];

  public bestMoveDelayMs = 0;

  public terminateCalls = 0;

  public bestMoveUci = 'e2e4';

  public throwOnCommand: string | null = null;

  private listeners: LineListener[] = [];

  public removeMessageListener: ((listener: LineListener) => void) | undefined;

  constructor(supportsListenerRemoval = true) {
    if (supportsListenerRemoval) {
      this.removeMessageListener = (listener: LineListener): void => {
        const idx = this.listeners.indexOf(listener);
        if (idx >= 0) this.listeners.splice(idx, 1);
      };
    }
  }

  addMessageListener(listener: LineListener): void {
    this.listeners.push(listener);
  }

  postMessage(command: string): void {
    if (command === this.throwOnCommand) {
      throw new Error(`post failed: ${command}`);
    }
    this.commands.push(command);
    if (command === 'uci') {
      this.emitAsync('uciok');
      return;
    }
    if (command === 'isready') {
      this.emitAsync('readyok');
      return;
    }
    if (command.startsWith('go movetime ')) {
      this.emitAsync(`bestmove ${this.bestMoveUci} ponder e7e5`, this.bestMoveDelayMs);
    }
  }

  terminate(): void {
    this.terminateCalls += 1;
  }

  private emitAsync(line: string, delayMs = 0): void {
    setTimeout(() => {
      for (let i = 0; i < this.listeners.length; i += 1) {
        this.listeners[i](line);
      }
    }, delayMs);
  }
}

test('bootstraps UCI and applies base options on init', async () => {
  const engine = new FakeStockfishEngine();
  const adapter = new StockfishWasmAdapter({
    createFactory: async () => async () => engine,
    initTimeoutMs: 200,
    resolveThreads: () => 2,
    resolveHashMb: () => 48,
  });

  await adapter.init();

  assert.deepEqual(engine.commands, [
    'uci',
    'setoption name Threads value 2',
    'setoption name Hash value 48',
    'isready',
  ]);
  adapter.dispose();
});

test('computes best move with difficulty mapping and movetime', async () => {
  const engine = new FakeStockfishEngine();
  const adapter = new StockfishWasmAdapter({
    createFactory: async () => async () => engine,
    initTimeoutMs: 200,
  });

  const bestMove = await adapter.computeBestMove({
    fen: 'start',
    difficulty: 'hard',
    timeLimitMs: 777,
  });

  assert.equal(bestMove, 'e4');
  assert.ok(engine.commands.includes('setoption name Skill Level value 15'));
  assert.ok(engine.commands.includes('position startpos'));
  assert.ok(engine.commands.includes('go movetime 777'));
  adapter.dispose();
});

test('respects explicit stockfish skill override', async () => {
  const engine = new FakeStockfishEngine();
  const adapter = new StockfishWasmAdapter({
    createFactory: async () => async () => engine,
    initTimeoutMs: 200,
  });

  const bestMove = await adapter.computeBestMove({
    fen: 'start',
    difficulty: 'expert',
    stockfishSkillLevel: 7,
    timeLimitMs: 500,
  });

  assert.equal(bestMove, 'e4');
  assert.ok(engine.commands.includes('setoption name Skill Level value 7'));
  assert.ok(engine.commands.includes('setoption name UCI_Elo value 1640'));
  adapter.dispose();
});

test('throws timeout when engine does not return bestmove', async () => {
  const engine = new FakeStockfishEngine();
  const originalPostMessage = engine.postMessage.bind(engine);
  engine.postMessage = (command: string) => {
    if (command.startsWith('go movetime ')) {
      engine.commands.push(command);
      return;
    }
    originalPostMessage(command);
  };

  const adapter = new StockfishWasmAdapter({
    createFactory: async () => async () => engine,
    initTimeoutMs: 100,
    searchTimeoutBufferMs: 20,
  });

  await assert.rejects(
    adapter.computeBestMove({
      fen: 'start',
      difficulty: 'easy',
      timeLimitMs: 60,
    }),
    /stockfish-wasm-timeout:go movetime 60/,
  );
  assert.equal(engine.terminateCalls, 1);
  adapter.dispose();
});

test('recreates Stockfish after a search timeout before the next request', async () => {
  const slowEngine = new FakeStockfishEngine();
  slowEngine.bestMoveDelayMs = 50;
  const recoveredEngine = new FakeStockfishEngine();
  let factoryCalls = 0;
  const adapter = new StockfishWasmAdapter({
    createFactory: async () => async () => {
      factoryCalls += 1;
      return factoryCalls === 1 ? slowEngine : recoveredEngine;
    },
    initTimeoutMs: 100,
    searchTimeoutBufferMs: 0,
  });

  await assert.rejects(
    adapter.computeBestMove({
      fen: 'start',
      difficulty: 'expert',
      timeLimitMs: 10,
    }),
    /stockfish-wasm-timeout:go movetime 50/,
  );

  assert.equal(await adapter.computeBestMove({
    fen: 'start',
    difficulty: 'expert',
    timeLimitMs: 10,
  }), 'e4');
  assert.equal(factoryCalls, 2);
  assert.equal(slowEngine.terminateCalls, 1);
  adapter.dispose();
});

test('ignores stale output from a disposed engine without listener removal', async () => {
  const staleEngine = new FakeStockfishEngine(false);
  staleEngine.bestMoveDelayMs = 70;
  staleEngine.bestMoveUci = 'a2a3';
  const currentEngine = new FakeStockfishEngine(false);
  currentEngine.bestMoveDelayMs = 30;
  let factoryCalls = 0;
  const adapter = new StockfishWasmAdapter({
    createFactory: async () => async () => {
      factoryCalls += 1;
      return factoryCalls === 1 ? staleEngine : currentEngine;
    },
    initTimeoutMs: 100,
    searchTimeoutBufferMs: 0,
  });

  await assert.rejects(
    adapter.computeBestMove({ fen: 'start', difficulty: 'hard', timeLimitMs: 50 }),
    /stockfish-wasm-timeout:go movetime 50/,
  );
  assert.equal(
    await adapter.computeBestMove({ fen: 'start', difficulty: 'hard', timeLimitMs: 50 }),
    'e4',
  );
  adapter.dispose();
});

test('rejects invalid or control-character FEN before sending UCI commands', async () => {
  const engine = new FakeStockfishEngine();
  const adapter = new StockfishWasmAdapter({
    createFactory: async () => async () => engine,
    initTimeoutMs: 100,
  });

  await assert.rejects(
    adapter.computeBestMove({ fen: 'not-a-fen', difficulty: 'medium' }),
    /invalid AI position/,
  );
  await assert.rejects(
    adapter.computeBestMove({ fen: 'start\nposition startpos', difficulty: 'medium' }),
    /invalid AI position/,
  );
  assert.deepEqual(engine.commands, []);
  adapter.dispose();
});

test('validates Stockfish history against the requested FEN', async () => {
  const engine = new FakeStockfishEngine();
  const adapter = new StockfishWasmAdapter({
    createFactory: async () => async () => engine,
    initTimeoutMs: 100,
  });
  const afterE4 = new Chess();
  afterE4.move('e4');

  await assert.rejects(
    adapter.computeBestMove({
      fen: afterE4.fen(),
      history: [],
      difficulty: 'medium',
    }),
    /AI move history does not match FEN/,
  );
  assert.deepEqual(engine.commands, []);
  adapter.dispose();
});

test('sends validated history to Stockfish so repetition context is preserved', async () => {
  const engine = new FakeStockfishEngine();
  engine.bestMoveUci = 'e7e5';
  const adapter = new StockfishWasmAdapter({
    createFactory: async () => async () => engine,
    initTimeoutMs: 100,
  });
  const afterE4 = new Chess();
  afterE4.move('e4');

  assert.equal(await adapter.computeBestMove({
    fen: afterE4.fen(),
    history: ['e2e4'],
    difficulty: 'medium',
  }), 'e5');
  assert.ok(engine.commands.includes('position startpos moves e2e4'));
  adapter.dispose();
});

test('replays a bounded history segment from its supplied FEN', async () => {
  const engine = new FakeStockfishEngine();
  engine.bestMoveUci = 'd7d6';
  const adapter = new StockfishWasmAdapter({
    createFactory: async () => async () => engine,
    initTimeoutMs: 100,
  });
  const base = new Chess();
  base.move('e4');
  const game = new Chess(base.fen());
  game.move('Nf6');
  game.move('Nf3');

  assert.equal(await adapter.computeBestMove({
    fen: game.fen(),
    history: ['g8f6', 'g1f3'],
    historyStartFen: base.fen(),
    historyTruncated: true,
    difficulty: 'expert',
    timeLimitMs: 50,
  }), 'd6');
  assert.ok(engine.commands.includes(`position fen ${base.fen()} moves g8f6 g1f3`));
  adapter.dispose();
});

test('terminates an engine that resolves after initialization timeout', async () => {
  const lateEngine = new FakeStockfishEngine();
  const adapter = new StockfishWasmAdapter({
    createFactory: async () => async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
      return lateEngine;
    },
    initTimeoutMs: 10,
  });

  await assert.rejects(
    adapter.computeBestMove({ fen: 'start', difficulty: 'medium' }),
    /stockfish-wasm-engine-timeout-10ms/,
  );
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(lateEngine.terminateCalls, 1);
  adapter.dispose();
});

test('disposes Stockfish when a direct UCI command fails', async () => {
  const engine = new FakeStockfishEngine();
  engine.throwOnCommand = 'ucinewgame';
  const adapter = new StockfishWasmAdapter({
    createFactory: async () => async () => engine,
    initTimeoutMs: 100,
  });

  await assert.rejects(
    adapter.computeBestMove({ fen: 'start', difficulty: 'hard', timeLimitMs: 50 }),
    /post failed: ucinewgame/,
  );
  assert.equal(engine.terminateCalls, 1);
  adapter.dispose();
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { StockfishWasmAdapter } from '../../src/workers/stockfishWasmAdapter';

type LineListener = (line: string) => void;

class FakeStockfishEngine {
  public readonly commands: string[] = [];

  private listeners: LineListener[] = [];

  addMessageListener(listener: LineListener): void {
    this.listeners.push(listener);
  }

  removeMessageListener(listener: LineListener): void {
    const idx = this.listeners.indexOf(listener);
    if (idx >= 0) this.listeners.splice(idx, 1);
  }

  terminate(): void {}

  postMessage(command: string): void {
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
      this.emitAsync('bestmove e2e4 ponder e7e5');
    }
  }

  private emitAsync(line: string): void {
    setTimeout(() => {
      for (let i = 0; i < this.listeners.length; i += 1) {
        this.listeners[i](line);
      }
    }, 0);
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

  assert.equal(bestMove, 'e2e4');
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

  assert.equal(bestMove, 'e2e4');
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
  adapter.dispose();
});

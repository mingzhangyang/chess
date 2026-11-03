import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import type { EngineAdapter } from '../../src/workers/engineAdapter';
import {
  handleAiComputeRequest,
  handleInitSharedTT,
  isAiComputeRequest,
  isAiInitSharedTTMessage,
  MAX_AI_FEN_LENGTH,
  MAX_AI_HISTORY_LENGTH,
  EMERGENCY_TS_FALLBACK_TIME_MS,
  resolveAiFallbackTimeLimit,
  type AiWorkerRuntimeDeps,
} from '../../src/workers/aiWorkerRuntime';
import { TT_BYTES } from '../../src/utils/chess-ai/chessAITranspositionTable';
import { TsEngineAdapter } from '../../src/workers/tsEngineAdapter';

const withAdapter = (adapter: EngineAdapter): AiWorkerRuntimeDeps => ({
  resolveBackend: () => 'ts',
  getAdapter: () => adapter,
});

test('returns best move payload for valid request', async () => {
  const response = await handleAiComputeRequest(
    {
      type: 'compute-best-move',
      requestId: 7,
      fen: 'start',
      difficulty: 'easy',
    },
    withAdapter({
      init: () => {},
      computeBestMove: () => 'e4',
      dispose: () => {},
    }),
  );

  assert.equal(response?.type, 'best-move-result');
  assert.equal(response?.requestId, 7);
  assert.equal(response?.bestMove, 'e4');
});

test('returns null for unsupported message type', async () => {
  const response = await handleAiComputeRequest(
    {
      type: 'unknown',
      requestId: 1,
      fen: 'start',
      difficulty: 'easy',
    } as never,
    withAdapter({
      init: () => {},
      computeBestMove: () => 'e4',
      dispose: () => {},
    }),
  );

  assert.equal(response, null);
});

test('returns a terminal error for malformed compute requests', async () => {
  const response = await handleAiComputeRequest(
    {
      type: 'compute-best-move',
      requestId: 17,
      fen: 'start',
      difficulty: 'hard',
      timeLimitMs: Number.POSITIVE_INFINITY,
    } as never,
    withAdapter({
      init: () => {},
      computeBestMove: () => 'e4',
      dispose: () => {},
    }),
  );

  assert.equal(response?.requestId, 17);
  assert.equal(response?.bestMove, null);
  assert.equal(response?.error, 'invalid AI worker request');
});

test('worker request validators enforce bounded protocol inputs', () => {
  const valid = {
    type: 'compute-best-move',
    requestId: 1,
    fen: 'start',
    difficulty: 'hard',
  };
  assert.equal(isAiComputeRequest(valid), true);
  assert.equal(isAiComputeRequest({ ...valid, fen: 'x'.repeat(MAX_AI_FEN_LENGTH + 1) }), false);
  assert.equal(isAiComputeRequest({
    ...valid,
    history: new Array(MAX_AI_HISTORY_LENGTH + 1).fill('e2e4'),
  }), false);
  assert.equal(isAiComputeRequest({
    ...valid,
    history: ['e2e4'],
    historyStartFen: 'start\nposition startpos',
  }), false);
  assert.equal(isAiComputeRequest({
    ...valid,
    history: ['e2e4'],
    historyStartFen: new Chess().fen(),
    historyTruncated: true,
  }), true);
  assert.equal(isAiComputeRequest({ ...valid, historyTruncated: false }), true);
  assert.equal(isAiComputeRequest({ ...valid, historyTruncated: true }), false);
  assert.equal(isAiComputeRequest({ ...valid, timeLimitMs: Number.POSITIVE_INFINITY }), false);
  assert.equal(isAiComputeRequest({ ...valid, backend: 'unknown' }), false);
  assert.equal(isAiInitSharedTTMessage({
    type: 'init-shared-tt',
    buffer: new SharedArrayBuffer(TT_BYTES),
  }), true);
  assert.equal(isAiInitSharedTTMessage({
    type: 'init-shared-tt',
    buffer: new SharedArrayBuffer(64),
  }), false);
});

test('returns error in payload when adapter throws', async () => {
  const telemetryEvents: Array<{ name: string; level: string }> = [];
  const response = await handleAiComputeRequest(
    {
      type: 'compute-best-move',
      requestId: 9,
      fen: 'not-a-fen',
      difficulty: 'hard',
    },
    {
      ...withAdapter({
        init: () => {},
        computeBestMove: () => {
          throw new Error('invalid-fen');
        },
        dispose: () => {},
      }),
      emitTelemetry: (event) => {
        telemetryEvents.push({ name: event.name, level: event.level });
      },
    },
  );

  assert.equal(response?.type, 'best-move-result');
  assert.equal(response?.requestId, 9);
  assert.equal(response?.bestMove, null);
  assert.equal(response?.error, 'invalid-fen');
  assert.deepEqual(telemetryEvents, [{ name: 'backend-compute-failed', level: 'error' }]);
});

test('passes tuning overrides to selected adapter', async () => {
  const tuning = {
    backtrackPenalty: 99,
    openingBookEnabled: false,
  };
  let received: unknown;

  const response = await handleAiComputeRequest(
    {
      type: 'compute-best-move',
      requestId: 11,
      fen: 'start',
      difficulty: 'hard',
      tuning,
      timeLimitMs: 1234,
      backend: 'stockfish-wasm',
    },
    {
      resolveBackend: () => 'ts',
      getAdapter: () => ({
        init: () => {},
        computeBestMove: (input) => {
          received = input;
          return 'Nf3';
        },
        dispose: () => {},
      }),
    },
  );

  assert.equal(response?.bestMove, 'Nf3');
  assert.deepEqual(received, {
    fen: 'start',
    difficulty: 'hard',
    tuning,
    timeLimitMs: 1234,
    stockfishSkillLevel: undefined,
  });
});

test('forwards UCI move history to the selected adapter', async () => {
  let received: unknown;
  const game = new Chess();
  game.move('e4');
  game.move('e5');
  game.move('Nf3');
  const history = ['e2e4', 'e7e5', 'g1f3'];

  const response = await handleAiComputeRequest(
    {
      type: 'compute-best-move',
      requestId: 13,
      fen: game.fen(),
      history,
      difficulty: 'hard',
    },
    {
      resolveBackend: () => 'ts',
      getAdapter: () => ({
        init: () => {},
        computeBestMove: (input) => {
          received = input;
          return 'Nc6';
        },
        dispose: () => {},
      }),
    },
  );

  assert.equal(response?.bestMove, 'Nc6');
  assert.deepEqual(received, {
    fen: game.fen(),
    history,
    difficulty: 'hard',
    tuning: undefined,
    timeLimitMs: undefined,
    stockfishSkillLevel: undefined,
  });
});

test('forwards bounded history-window metadata to the selected adapter', async () => {
  let received: unknown;
  const game = new Chess();
  game.move('e4');
  const historyStartFen = new Chess().fen();

  const response = await handleAiComputeRequest(
    {
      type: 'compute-best-move',
      requestId: 131,
      fen: game.fen(),
      history: ['e2e4'],
      historyStartFen,
      historyTruncated: true,
      difficulty: 'hard',
    },
    {
      resolveBackend: () => 'ts',
      getAdapter: () => ({
        init: () => {},
        computeBestMove: (input) => {
          received = input;
          return 'e5';
        },
        dispose: () => {},
      }),
    },
  );

  assert.equal(response?.bestMove, 'e5');
  assert.deepEqual(received, {
    fen: game.fen(),
    history: ['e2e4'],
    historyStartFen,
    historyTruncated: true,
    difficulty: 'hard',
    tuning: undefined,
    timeLimitMs: undefined,
    stockfishSkillLevel: undefined,
  });
});

test('runtime and TypeScript adapter preserve history-dependent opening context', async () => {
  const game = new Chess();
  game.move('e4');
  game.move('e5');
  const originalRandom = Math.random;
  Math.random = () => 0;

  try {
    const response = await handleAiComputeRequest(
      {
        type: 'compute-best-move',
        requestId: 15,
        fen: game.fen(),
        history: ['e2e4', 'e7e5'],
        difficulty: 'medium',
        tuning: { openingBookEnabled: true, openingBookMaxPly: 10 },
      },
      {
        resolveBackend: () => 'ts',
        getAdapter: () => new TsEngineAdapter(),
      },
    );

    assert.equal(response?.bestMove, 'Nf3');
    assert.equal(response?.error, undefined);
  } finally {
    Math.random = originalRandom;
  }
});

test('returns a validation error when the TypeScript adapter rejects history', async () => {
  const response = await handleAiComputeRequest(
    {
      type: 'compute-best-move',
      requestId: 16,
      fen: 'start',
      history: ['e2e5'],
      difficulty: 'medium',
    },
    {
      resolveBackend: () => 'ts',
      getAdapter: () => new TsEngineAdapter(),
    },
  );

  assert.equal(response?.bestMove, null);
  assert.equal(response?.error, 'invalid AI move history');
});

test('passes stockfish expert overrides to selected adapter', async () => {
  let received: unknown;

  const response = await handleAiComputeRequest(
    {
      type: 'compute-best-move',
      requestId: 14,
      fen: 'start',
      difficulty: 'expert',
      backend: 'stockfish-wasm',
      stockfishSkillLevel: 12,
      timeLimitMs: 1900,
    },
    {
      resolveBackend: () => 'stockfish-wasm',
      getAdapter: () => ({
        init: () => {},
        computeBestMove: (input) => {
          received = input;
          return 'e2e4';
        },
        dispose: () => {},
      }),
    },
  );

  assert.equal(response?.bestMove, 'e2e4');
  assert.deepEqual(received, {
    fen: 'start',
    difficulty: 'expert',
    tuning: undefined,
    timeLimitMs: 1900,
    stockfishSkillLevel: 12,
  });
});

test('initializes selected adapter with shared TT buffer', async () => {
  const shared = new SharedArrayBuffer(TT_BYTES);
  let initInput: unknown;

  await handleInitSharedTT(
    {
      type: 'init-shared-tt',
      buffer: shared,
      backend: 'stockfish-wasm',
    },
    {
      resolveBackend: () => 'ts',
      getAdapter: () => ({
        init: (input) => {
          initInput = input;
        },
        computeBestMove: () => null,
        dispose: () => {},
      }),
    },
  );

  assert.deepEqual(initInput, { sharedTTBuffer: shared });
});

test('falls back to ts adapter when stockfish compute fails', async () => {
  let stockfishCalls = 0;
  let tsCalls = 0;
  const telemetryEvents: Array<{ name: string; level: string }> = [];

  const response = await handleAiComputeRequest(
    {
      type: 'compute-best-move',
      requestId: 12,
      fen: 'start',
      difficulty: 'hard',
      backend: 'stockfish-wasm',
    },
    {
      resolveBackend: () => 'stockfish-wasm',
      getAdapter: (backend) => {
        if (backend === 'stockfish-wasm') {
          return {
            init: () => {},
            computeBestMove: () => {
              stockfishCalls += 1;
              throw new Error('stockfish-init-failed');
            },
            dispose: () => {},
          };
        }
        return {
          init: () => {},
          computeBestMove: () => {
            tsCalls += 1;
            return 'e4';
          },
          dispose: () => {},
        };
      },
      emitTelemetry: (event) => {
        telemetryEvents.push({ name: event.name, level: event.level });
      },
    },
  );

  assert.equal(response?.bestMove, 'e4');
  assert.equal(response?.error, undefined);
  assert.equal(stockfishCalls, 1);
  assert.equal(tsCalls, 1);
  assert.deepEqual(telemetryEvents, [{ name: 'backend-compute-fallback', level: 'warn' }]);
});

test('reserves a bounded emergency budget when Stockfish has already timed out', () => {
  assert.equal(resolveAiFallbackTimeLimit('hard', 1500, 400), 1100);
  assert.equal(resolveAiFallbackTimeLimit('hard', 1500, 1600), EMERGENCY_TS_FALLBACK_TIME_MS);
  assert.equal(resolveAiFallbackTimeLimit('expert', undefined, 100), 3100);
});

test('falls back to ts adapter when stockfish init fails', async () => {
  const shared = new SharedArrayBuffer(TT_BYTES);
  let stockfishInitCalls = 0;
  let tsInitCalls = 0;
  const telemetryEvents: Array<{ name: string; level: string }> = [];

  await handleInitSharedTT(
    {
      type: 'init-shared-tt',
      buffer: shared,
      backend: 'stockfish-wasm',
    },
    {
      resolveBackend: () => 'stockfish-wasm',
      getAdapter: (backend) => {
        if (backend === 'stockfish-wasm') {
          return {
            init: () => {
              stockfishInitCalls += 1;
              throw new Error('stockfish-module-missing');
            },
            computeBestMove: () => null,
            dispose: () => {},
          };
        }
        return {
          init: () => {
            tsInitCalls += 1;
          },
          computeBestMove: () => null,
          dispose: () => {},
        };
      },
      emitTelemetry: (event) => {
        telemetryEvents.push({ name: event.name, level: event.level });
      },
    },
  );

  assert.equal(stockfishInitCalls, 1);
  assert.equal(tsInitCalls, 1);
  assert.deepEqual(telemetryEvents, [{ name: 'backend-init-fallback', level: 'warn' }]);
});

test('late Stockfish failure still computes a fallback move after its deadline', async () => {
  let fallbackBudget = 0;
  const response = await handleAiComputeRequest(
    {
      type: 'compute-best-move',
      requestId: 51,
      fen: 'start',
      difficulty: 'expert',
      backend: 'stockfish-wasm',
      timeLimitMs: 1,
    },
    {
      resolveBackend: () => 'stockfish-wasm',
      getAdapter: (backend) => backend === 'stockfish-wasm'
        ? {
          init: () => {},
          computeBestMove: async () => {
            await new Promise((resolve) => setTimeout(resolve, 15));
            throw new Error('stockfish-wasm-timeout');
          },
          dispose: () => {},
        }
        : {
          init: () => {},
          computeBestMove: (input) => {
            fallbackBudget = input.timeLimitMs ?? 0;
            return 'e4';
          },
          dispose: () => {},
        },
    },
  );
  assert.equal(response?.bestMove, 'e4');
  assert.equal(response?.error, undefined);
  assert.equal(fallbackBudget, EMERGENCY_TS_FALLBACK_TIME_MS);
});

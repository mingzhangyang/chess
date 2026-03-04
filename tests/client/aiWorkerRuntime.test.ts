import test from 'node:test';
import assert from 'node:assert/strict';
import type { EngineAdapter } from '../../src/workers/engineAdapter';
import { handleAiComputeRequest, handleInitSharedTT, type AiWorkerRuntimeDeps } from '../../src/workers/aiWorkerRuntime';

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
  const shared = new SharedArrayBuffer(64);
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

test('falls back to ts adapter when stockfish init fails', async () => {
  const shared = new SharedArrayBuffer(64);
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

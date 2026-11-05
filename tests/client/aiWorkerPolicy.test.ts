import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AI_WORKER_RESPONSE_GRACE_MS,
  STOCKFISH_INIT_TIMEOUT_MS,
  STOCKFISH_SEARCH_TIMEOUT_BUFFER_MS,
  STOCKFISH_WORKER_RESPONSE_GRACE_MS,
  TS_DEPTH_COMPLETION_FACTOR,
  TS_MIN_DEPTH_GRACE_MS,
  resolveAiSearchTimeMs,
  resolveAiWorkerCount,
  resolveAiWorkerResponseTimeoutMs,
} from '../../src/utils/aiWorkerPolicy';

test('keeps easy and medium AI to one worker even when sharing is available', () => {
  assert.equal(resolveAiWorkerCount('ts', 'easy', true, 16), 1);
  assert.equal(resolveAiWorkerCount('ts', 'medium', true, 16), 1);
});

test('limits hard TypeScript AI to two shared workers', () => {
  assert.equal(resolveAiWorkerCount('ts', 'hard', true, 16), 2);
  assert.equal(resolveAiWorkerCount('ts', 'hard', false, 16), 1);
});

test('keeps hard AI to one worker on a single-core device', () => {
  assert.equal(resolveAiWorkerCount('ts', 'hard', true, 1), 1);
});

test('keeps Stockfish on one worker', () => {
  assert.equal(resolveAiWorkerCount('stockfish-wasm', 'expert', true, 16), 1);
});

test('AI watchdog allows engine startup, failure recovery, and depth-one grace', () => {
  assert.equal(resolveAiWorkerResponseTimeoutMs('ts', 'hard'), 24_000 + AI_WORKER_RESPONSE_GRACE_MS);
  assert.equal(resolveAiWorkerResponseTimeoutMs('ts', 'medium'), 9_000 + AI_WORKER_RESPONSE_GRACE_MS);
  assert.equal(resolveAiWorkerResponseTimeoutMs('stockfish-wasm', 'expert', 20_000), 20_000 + STOCKFISH_WORKER_RESPONSE_GRACE_MS);
  assert.equal(resolveAiWorkerResponseTimeoutMs('stockfish-wasm', 'expert', Number.NaN), 3_200 + STOCKFISH_WORKER_RESPONSE_GRACE_MS);
  assert.equal(resolveAiWorkerResponseTimeoutMs('stockfish-wasm', 'expert', 100_000), 20_000 + STOCKFISH_WORKER_RESPONSE_GRACE_MS);
});

test('Stockfish cold-start watchdog preserves all six readiness waits, search buffer and TS fallback', () => {
  const coldStartAndFallbackMs =
    6 * STOCKFISH_INIT_TIMEOUT_MS
    + STOCKFISH_SEARCH_TIMEOUT_BUFFER_MS
    + TS_MIN_DEPTH_GRACE_MS;
  assert.ok(STOCKFISH_WORKER_RESPONSE_GRACE_MS > coldStartAndFallbackMs);
  assert.ok(STOCKFISH_WORKER_RESPONSE_GRACE_MS > AI_WORKER_RESPONSE_GRACE_MS);
  assert.ok(resolveAiWorkerResponseTimeoutMs('stockfish-wasm', 'expert', 200)
    > 200 + coldStartAndFallbackMs);
  assert.ok(resolveAiWorkerResponseTimeoutMs('stockfish-wasm', 'expert', 20_000)
    > 20_000 + coldStartAndFallbackMs);
  assert.equal(resolveAiWorkerResponseTimeoutMs('ts', 'hard'), 24_000 + AI_WORKER_RESPONSE_GRACE_MS);
});

test('AI search time is the think budget shown to the player', () => {
  assert.equal(resolveAiSearchTimeMs('ts', 'medium'), 3_000);
  assert.equal(resolveAiSearchTimeMs('ts', 'hard'), 8_000);
  assert.equal(resolveAiSearchTimeMs('ts', 'unknown'), 1_000);
  assert.equal(resolveAiSearchTimeMs('stockfish-wasm', 'expert'), 3_200);
  assert.equal(resolveAiSearchTimeMs('stockfish-wasm', 'expert', 50), 200);
  assert.equal(resolveAiSearchTimeMs('stockfish-wasm', 'expert', 50_000), 20_000);
  assert.equal(resolveAiSearchTimeMs('ts', 'hard', 50), 8_000, 'TS ignores the Stockfish slider');
});

test('TS watchdog covers the depth-completion overrun', () => {
  assert.equal(TS_DEPTH_COMPLETION_FACTOR, 3);
  assert.equal(
    resolveAiWorkerResponseTimeoutMs('ts', 'hard'),
    resolveAiSearchTimeMs('ts', 'hard') * TS_DEPTH_COMPLETION_FACTOR + AI_WORKER_RESPONSE_GRACE_MS,
  );
});

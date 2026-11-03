import test from 'node:test';
import assert from 'node:assert/strict';
import { AI_WORKER_RESPONSE_GRACE_MS, resolveAiWorkerCount, resolveAiWorkerResponseTimeoutMs } from '../../src/utils/aiWorkerPolicy';

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
  assert.equal(resolveAiWorkerResponseTimeoutMs('ts', 'hard'), 1_500 + AI_WORKER_RESPONSE_GRACE_MS);
  assert.equal(resolveAiWorkerResponseTimeoutMs('ts', 'medium'), 300 + AI_WORKER_RESPONSE_GRACE_MS);
  assert.equal(resolveAiWorkerResponseTimeoutMs('stockfish-wasm', 'expert', 20_000), 20_000 + AI_WORKER_RESPONSE_GRACE_MS);
  assert.equal(resolveAiWorkerResponseTimeoutMs('stockfish-wasm', 'expert', Number.NaN), 3_200 + AI_WORKER_RESPONSE_GRACE_MS);
  assert.equal(resolveAiWorkerResponseTimeoutMs('stockfish-wasm', 'expert', 100_000), 20_000 + AI_WORKER_RESPONSE_GRACE_MS);
});

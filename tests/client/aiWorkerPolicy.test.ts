import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAiWorkerCount } from '../../src/utils/aiWorkerPolicy';

test('keeps easy and medium AI to one worker even when sharing is available', () => {
  assert.equal(resolveAiWorkerCount('ts', 'easy', true, 16), 1);
  assert.equal(resolveAiWorkerCount('ts', 'medium', true, 16), 1);
});

test('limits hard TypeScript AI to two shared workers', () => {
  assert.equal(resolveAiWorkerCount('ts', 'hard', true, 16), 2);
  assert.equal(resolveAiWorkerCount('ts', 'hard', false, 16), 1);
});

test('keeps Stockfish on one worker', () => {
  assert.equal(resolveAiWorkerCount('stockfish-wasm', 'expert', true, 16), 1);
});

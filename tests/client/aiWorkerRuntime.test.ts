import test from 'node:test';
import assert from 'node:assert/strict';
import { handleAiComputeRequest } from '../../src/workers/aiWorkerRuntime';

test('returns best move payload for valid request', () => {
  const response = handleAiComputeRequest(
    {
      type: 'compute-best-move',
      requestId: 7,
      fen: 'start',
      difficulty: 'easy',
    },
    () => 'e4',
  );

  assert.equal(response?.type, 'best-move-result');
  assert.equal(response?.requestId, 7);
  assert.equal(response?.bestMove, 'e4');
});

test('returns null for unsupported message type', () => {
  const response = handleAiComputeRequest(
    {
      type: 'unknown',
      requestId: 1,
      fen: 'start',
      difficulty: 'easy',
    } as never,
    () => 'e4',
  );

  assert.equal(response, null);
});

test('returns error in payload when chess parsing fails', () => {
  const response = handleAiComputeRequest(
    {
      type: 'compute-best-move',
      requestId: 9,
      fen: 'not-a-fen',
      difficulty: 'hard',
    },
    () => 'e4',
  );

  assert.equal(response?.type, 'best-move-result');
  assert.equal(response?.requestId, 9);
  assert.equal(response?.bestMove, null);
  assert.ok(response?.error);
});

test('passes tuning overrides to move resolver', () => {
  const tuning = {
    backtrackPenalty: 99,
    openingBookEnabled: false,
  };
  let received: unknown = null;

  const response = handleAiComputeRequest(
    {
      type: 'compute-best-move',
      requestId: 11,
      fen: 'start',
      difficulty: 'hard',
      tuning,
    },
    (_game, _difficulty, payloadTuning) => {
      received = payloadTuning;
      return 'Nf3';
    },
  );

  assert.equal(response?.bestMove, 'Nf3');
  assert.deepEqual(received, tuning);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { dutyCycleForRate } from '../../research/scripts/renderer-throttle';

test('duty-cycle fallback preserves requested 1x and derives slower rates', () => {
  assert.deepEqual(dutyCycleForRate(1), { cycleMs: 100, runMs: 100, pauseMs: 0 });
  assert.deepEqual(dutyCycleForRate(4), { cycleMs: 100, runMs: 25, pauseMs: 75 });
  assert.deepEqual(dutyCycleForRate(6), { cycleMs: 100, runMs: 17, pauseMs: 83 });
});

test('duty-cycle fallback rejects invalid rates and cycles', () => {
  assert.throws(() => dutyCycleForRate(0), /rate/);
  assert.throws(() => dutyCycleForRate(Number.NaN), /rate/);
  assert.throws(() => dutyCycleForRate(4, 1), /cycle/);
});

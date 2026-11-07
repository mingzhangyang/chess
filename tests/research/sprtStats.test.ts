import test from 'node:test';
import assert from 'node:assert/strict';
import { sprtVerdict } from '../../research/scripts/sprt-stats';

const BOUNDS = [Math.log(0.05 / 0.95), Math.log(0.95 / 0.05)] as const;

test('the SPRT verdict needs the minimum number of games before a bound counts', () => {
  // Eight games crossing the upper bound (as a near-zero variance can make it) are not a verdict.
  assert.equal(sprtVerdict(4.4, 8, BOUNDS, 50), 'undecided');
  assert.equal(sprtVerdict(-4.4, 8, BOUNDS, 50), 'undecided');
  assert.equal(sprtVerdict(3.1, 50, BOUNDS, 50), 'H1 accepted (improvement)');
  assert.equal(sprtVerdict(-3.1, 96, BOUNDS, 50), 'H0 accepted (no improvement)');
  assert.equal(sprtVerdict(2.9, 300, BOUNDS, 50), 'undecided');
});

test('the earlier phase 10 and 11 verdicts are unchanged by the minimum', () => {
  // Accepted runs: 92, 96, 173, 196 and 224 games.
  for (const games of [92, 96, 173, 196, 224]) assert.equal(sprtVerdict(3.0, games, BOUNDS, 50), 'H1 accepted (improvement)');
});

test('a run keeps the opening list it started with', async () => {
  const { runOpenings } = await import('../../research/scripts/sprt-stats');
  const a = [['e2e4', 'e7e5']]; const b = [['d2d4', 'd7d5']];
  // A new run stores what it was given.
  assert.deepEqual(runOpenings(undefined, a, true), { openings: a, store: true });
  // A restart without an override reuses the stored list, whatever the default is.
  assert.deepEqual(runOpenings(JSON.stringify(a), b, false), { openings: a, store: false });
  // The same override again is fine; a different one is refused before any game is played.
  assert.deepEqual(runOpenings(JSON.stringify(a), a, true), { openings: a, store: false });
  assert.throws(() => runOpenings(JSON.stringify(a), b, true), /different opening list/);
});

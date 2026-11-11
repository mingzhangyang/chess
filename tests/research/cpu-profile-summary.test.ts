import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeProfile } from '../../research/scripts/cpu-profile-summary.mjs';
const node = (id: number, name: string, children: number[] = [], url = 'workload.mjs') =>
  ({ id, callFrame: { functionName: name, url, lineNumber: id, columnNumber: 0 }, children });
test('profile attribution separates boundary, tree, GC and excludes setup outside root', () => {
  const profile = { startTime: 0, endTime: 7000, nodes: [node(1, '(root)', [2,3,10]),
    node(2, 'fixture'), node(3, 'profileMeasuredSearch', [4,5]), node(4, '_moves'),
    node(5, 'minimax', [6,7,8]), node(6, '_moves'), node(7, '_makeMove'),
    node(8, 'evaluate', [9]), node(9, 'kernelMobility'), node(10, '(garbage collector)')],
    samples: [2,4,6,7,9,10,5], timeDeltas: [1000,1000,1000,1000,1000,1000,1000] };
  const summary = summarizeProfile(profile, 'profileMeasuredSearch');
  assert.equal(summary.totalMs, 5);
  assert.equal(summary.excludedSamples, 2);
  assert.equal(summary.categories['Boundary / preparation / result'], 1);
  assert.equal(summary.categories['Move generation and legality'], 1);
  assert.equal(summary.categories['Make/undo and repetition'], 1);
  assert.equal(summary.categories.Evaluation, 1);
  const measured = summarizeProfile(profile, 'profileMeasuredSearch', true);
  assert.equal(measured.totalMs, 6);
  assert.equal(measured.categories['Garbage collection (measured window)'], 1);
  assert.ok(measured.functions.every(f => Number.isFinite(f.selfMs) && f.samples > 0));
});
test('empty profiles and invalid sample deltas fail', () => {
  assert.throws(() => summarizeProfile({nodes:[],samples:[],timeDeltas:[]}, 'root'), /samples/);
  assert.throws(() => summarizeProfile({nodes:[node(1,'root')],samples:[1],timeDeltas:[]}, 'root'), /deltas/);
});

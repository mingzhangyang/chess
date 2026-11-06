/**
 * Phase 9 refactors must leave the kernel's search tree exactly as it was:
 * the same score for every root move and the same node, quiescence and
 * pruning counts at fixed depths (fixtures/kernelGolden.ts).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { goldenCases, runGoldenCase, type GoldenResult } from './fixtures/kernelGolden';
import golden from './fixtures/kernelGolden.json' with { type: 'json' };

test('the kernel reproduces its golden search trees node for node', () => {
  const expected = new Map((golden as GoldenResult[]).map((result) => [result.name, result]));
  const cases = goldenCases();
  assert.equal(cases.length, expected.size);
  for (const golden of cases) {
    const want = expected.get(golden.name);
    assert.ok(want, golden.name);
    assert.deepEqual(runGoldenCase(golden), want, golden.name);
  }
});

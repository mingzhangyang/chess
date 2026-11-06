/**
 * Writes tests/client/fixtures/kernelGolden.json: the kernel's fixed-depth
 * search trees (root scores and counters) for the cases in kernelGolden.ts.
 * Regenerate only when a change is meant to alter the tree, and say so.
 *
 *   node --import tsx research/scripts/kernel-golden-fixture.ts
 */
import { writeFileSync } from 'node:fs';
import { goldenCases, runGoldenCase } from '../../tests/client/fixtures/kernelGolden';

const started = performance.now();
const results = goldenCases().map((golden) => {
  const result = runGoldenCase(golden);
  console.log(`${golden.name}: depth ${result.completedDepth}, ${result.counters.nodes + result.counters.qNodes} visits`);
  return result;
});
writeFileSync('tests/client/fixtures/kernelGolden.json', `${JSON.stringify(results)}\n`);
console.log(`${results.length} cases in ${((performance.now() - started) / 1000).toFixed(1)} s`);

/**
 * Workload for profiling the independent kernel alone: sixteen 400 ms
 * searches, alternating the ply-40 and ply-80 positions of the history
 * benchmark (full history). tsx emits one-line modules, so bundle first:
 *
 *   npx esbuild research/scripts/search-position-kernel-profile.ts --bundle \
 *     --platform=node --format=esm --outfile=/tmp/kernel-profile.mjs
 *   node --cpu-prof --cpu-prof-dir=/tmp/kernel-prof /tmp/kernel-profile.mjs
 *   node research/scripts/cpu-profile-summary.mjs /tmp/kernel-prof
 *
 * Building the positions plays a legacy self-play game first; the summary
 * counts only samples under searchIndependentKernel, so that is excluded.
 */
import { searchForComparison } from '../../src/utils/chess-ai/independentSearch';
import { selfPlayHistoryPositions } from '../../tests/client/fixtures/selfPlayHistory';

const positions = selfPlayHistoryPositions([40, 80]);
const start = performance.now();
let visits = 0;
for (let run = 0; run < 8; run += 1) {
  for (const ply of [40, 80]) {
    const result = searchForComparison({ backend: 'independent', input: positions.get(ply)!, timeLimitMs: 400, random: () => 0 });
    visits += result.diagnostics.nodes + result.diagnostics.qNodes;
  }
}
const seconds = (performance.now() - start) / 1000;
console.log(JSON.stringify({ searches: 16, seconds: Number(seconds.toFixed(2)), visitsPerSecond: Math.round(visits / seconds) }));

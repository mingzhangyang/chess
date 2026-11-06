/** Full-search comparison on positions that carry their real game history.
 * The production UI always sends the complete move history, so this is the
 * representative case; the phase 3 benchmark used history-free positions.
 * Run: node --import tsx research/scripts/search-position-history-benchmark.ts
 */
import { arch, cpus, platform, release } from 'node:os';
import { searchForComparison, type ComparisonOptions } from '../../src/utils/chess-ai/independentSearch';
import { createGameFromInput } from '../../src/workers/tsEngineAdapter';
import type { EngineAdapterComputeInput } from '../../src/workers/engineAdapter';

const CHECKPOINTS = [40, 80];
const SAMPLES = 5;
const FIXED_DEPTH = 4;
const FIXED_TIME_MS = 400;
const tuning = { openingBookEnabled: false };
const median = (numbers: number[]) => [...numbers].sort((a, b) => a - b)[Math.floor(numbers.length / 2)];
const BACKENDS: ComparisonOptions['backend'][] = ['legacy', 'reference', 'independent'];
/** Rotate the backend order between runs so no backend always runs first. */
const backendOrder = (run: number): ComparisonOptions['backend'][] => BACKENDS.map((_, i) => BACKENDS[(i + run) % BACKENDS.length]);
type Sample = ReturnType<typeof measure>;
const bySample = (): Record<ComparisonOptions['backend'], Sample[]> => ({ legacy: [], reference: [], independent: [] });

const measure = (backend: ComparisonOptions['backend'], input: EngineAdapterComputeInput, opts: { maxDepth?: number; timeLimitMs: number }) => {
  const start = performance.now();
  const result = searchForComparison({ backend, input, ...opts, random: () => 0 });
  const ms = performance.now() - start;
  const visits = result.diagnostics.nodes + result.diagnostics.qNodes;
  return { ms: Number(ms.toFixed(2)), move: result.move, score: result.score, depth: result.completedDepth,
    partialDepth: result.partialDepth, visits, visitsPerSecond: Math.round(visits / (ms / 1000)) };
};

// A deterministic self-played game: the legacy engine at depth 2 from the start.
const history: string[] = [];
const game = createGameFromInput({ fen: 'start', history: [], difficulty: 'expert' });
const results = [];
for (let ply = 1; ply <= Math.max(...CHECKPOINTS); ply += 1) {
  const step = searchForComparison({ backend: 'legacy', input: { fen: game.fen(), history: [...history], difficulty: 'expert', tuning },
    maxDepth: 2, timeLimitMs: 60_000, random: () => 0 });
  if (!step.uci) break;
  game.move({ from: step.uci.slice(0, 2), to: step.uci.slice(2, 4), promotion: step.uci[4] });
  history.push(step.uci);
  if (!CHECKPOINTS.includes(ply)) continue;
  const input: EngineAdapterComputeInput = { fen: game.fen(), history: [...history], difficulty: 'expert', tuning };
  for (const backend of backendOrder(0)) measure(backend, input, { maxDepth: 2, timeLimitMs: 20_000 });
  const fixedDepth = bySample();
  const fixedTime = bySample();
  for (let run = 0; run < SAMPLES; run += 1) for (const backend of backendOrder(run)) {
    fixedDepth[backend].push(measure(backend, input, { maxDepth: FIXED_DEPTH, timeLimitMs: 60_000 }));
  }
  for (let run = 0; run < SAMPLES; run += 1) for (const backend of backendOrder(run)) {
    fixedTime[backend].push(measure(backend, input, { timeLimitMs: FIXED_TIME_MS }));
  }
  const summary = (samples: Sample[]) => ({ medianMs: median(samples.map((x) => x.ms)),
    medianVisits: median(samples.map((x) => x.visits)), medianVisitsPerSecond: median(samples.map((x) => x.visitsPerSecond)),
    depths: samples.map((x) => `${x.depth}/${x.partialDepth}`), moves: [...new Set(samples.map((x) => x.move))] });
  results.push({ ply, fen: game.fen(), historyLength: history.length,
    fixedDepth: { depth: FIXED_DEPTH, legacy: summary(fixedDepth.legacy), reference: summary(fixedDepth.reference),
      independent: summary(fixedDepth.independent) },
    fixedTime: { timeLimitMs: FIXED_TIME_MS, legacy: summary(fixedTime.legacy), reference: summary(fixedTime.reference),
      independent: summary(fixedTime.independent) },
    samples: { fixedDepth, fixedTime } });
}

console.log(JSON.stringify({ environment: { node: process.version, os: `${platform()} ${release()} ${arch()}`,
  cpu: cpus()[0]?.model, logicalCpus: cpus().length }, samplesPerMode: SAMPLES,
  note: 'Positions from a deterministic legacy depth-2 self-play game with complete history. visits = main + quiescence nodes. '
    + 'legacy = chess.js, reference = frozen SearchPosition on the shared search, independent = integer-move kernel.',
  results }, null, 2));

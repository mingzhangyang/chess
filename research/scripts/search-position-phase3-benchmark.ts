/** Full-search comparison, not a move-generation microbenchmark.
 * Run: node --import tsx research/scripts/search-position-phase3-benchmark.ts
 */
import assert from 'node:assert/strict';
import { arch, cpus, platform, release } from 'node:os';
import { Chess } from 'chess.js';
import { searchForComparison, type ComparisonOptions } from '../../src/utils/chess-ai/independentSearch';
import type { EngineAdapterComputeInput } from '../../src/workers/engineAdapter';

const positions = [
  { name: 'initial', fen: 'start', depth: 4 },
  { name: 'middlegame', fen: 'r2q1rk1/1b2bppp/p2ppn2/1p6/3NP3/1BN1B3/PPP2PPP/R2Q1RK1 w - - 0 11', depth: 3 },
  { name: 'endgame', fen: '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', depth: 4 },
];
const inputFor = (fen: string): EngineAdapterComputeInput => ({ fen, difficulty: 'expert', history: [], historyTruncated: false,
  ...(fen === 'start' ? {} : { historyStartFen: fen }), tuning: { openingBookEnabled: false } });
const measure = (backend: ComparisonOptions['backend'], input: EngineAdapterComputeInput, opts: { maxDepth?: number; timeLimitMs: number }) => {
  const start = performance.now();
  const result = searchForComparison({ backend, input, ...opts, random: () => 0 });
  const elapsed = performance.now() - start;
  if (result.move) {
    const verify = new Chess(input.fen === 'start' ? undefined : input.fen);
    assert.ok(verify.move(result.move));
  }
  return { ms: Number(elapsed.toFixed(2)), move: result.move, uci: result.uci, score: result.score,
    depth: result.completedDepth, partialDepth: result.partialDepth, aborted: result.diagnostics.searchAborted,
    nodes: result.diagnostics.nodes, qNodes: result.diagnostics.qNodes,
    totalVisits: result.diagnostics.nodes + result.diagnostics.qNodes };
};
const median = (numbers: number[]) => [...numbers].sort((a, b) => a - b)[Math.floor(numbers.length / 2)];
const backendOrder = (run: number): ComparisonOptions['backend'][] => run % 2 ? ['independent', 'legacy'] : ['legacy', 'independent'];
const results = [];
for (const position of positions) {
  const input = inputFor(position.fen);
  for (const backend of backendOrder(0)) measure(backend, input, { maxDepth: 2, timeLimitMs: 20_000 });
  const fixedDepth = { legacy: [] as ReturnType<typeof measure>[], independent: [] as ReturnType<typeof measure>[] };
  for (let run = 0; run < 5; run++) for (const backend of backendOrder(run)) {
    const sample = measure(backend, input, { maxDepth: position.depth, timeLimitMs: 20_000 });
    assert.equal(sample.depth, position.depth, `${position.name} ${backend} did not finish fixed depth`);
    fixedDepth[backend].push(sample);
  }
  const fixedTime = { legacy: [] as ReturnType<typeof measure>[], independent: [] as ReturnType<typeof measure>[] };
  for (let run = 0; run < 5; run++) for (const backend of backendOrder(run)) {
    fixedTime[backend].push(measure(backend, input, { timeLimitMs: 400 }));
  }
  results.push({ position: position.name, depth: position.depth, fixedDepth, fixedTime,
    medianFixedDepthMs: { legacy: median(fixedDepth.legacy.map((x) => x.ms)), independent: median(fixedDepth.independent.map((x) => x.ms)) },
    medianFixedTimeVisits: { legacy: median(fixedTime.legacy.map((x) => x.totalVisits)), independent: median(fixedTime.independent.map((x) => x.totalVisits)) } });
}

const tactics = [
  { name: 'mate in one', fen: '7k/5Q2/6K1/8/8/8/8/8 w - - 0 1' },
  { name: 'capture queen', fen: '4k3/8/8/3q4/4P3/8/8/4K3 w - - 0 1' },
  { name: 'promotion', fen: '6k1/4P3/8/8/8/K7/8/8 w - - 0 1' },
  { name: 'en passant evasion', fen: '6k1/8/8/3pP3/4K3/8/8/8 w - d6 0 2' },
  { name: 'castling rights', fen: 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1' },
  { name: 'quiet check evasion', fen: '4r1k1/8/8/8/8/8/8/4K3 w - - 0 1' },
  { name: 'queen blunder A', fen: 'rnbqkb1r/ppp2ppp/5n2/8/3N4/4P3/PPP2PPP/RNBQKB1R b KQkq - 0 5' },
  { name: 'queen blunder B', fen: 'rnbqkbnr/ppp2ppp/4p3/3p4/8/2N5/PPP2PPP/R1BQKBNR w KQkq - 0 4' },
];
const tacticalResults = tactics.map(({ name, fen }) => ({ name,
  legacy: measure('legacy', inputFor(fen), { maxDepth: 3, timeLimitMs: 20_000 }),
  independent: measure('independent', inputFor(fen), { maxDepth: 3, timeLimitMs: 20_000 }) }));
console.log(JSON.stringify({ environment: { node: process.version, os: `${platform()} ${release()} ${arch()}`,
  cpu: cpus()[0]?.model, logicalCpus: cpus().length }, samplesPerMode: 5,
  fixedTimeMs: 400, note: 'main nodes plus quiescence nodes; depth-zero transitions count in both. Timings include boundary validation and isolated state clearing.',
  results, tacticalResults }, null, 2));

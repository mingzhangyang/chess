/**
 * Microbenchmark only: transposition key construction and lookup, not Elo.
 * Run: node --import tsx research/scripts/phaseE2-tt-key-benchmark.ts
 * Optional: TT_KEY_BENCH_LOOPS=200000.
 */
import { performance } from 'node:perf_hooks';
import { Chess } from 'chess.js';
import { createRepetitionContext, getRepetitionContextKey } from '../../src/utils/chess-ai/chessAIRepetition';
import {
  clearTranspositionTable, lookupTT, makeIncrementalTTKey, makeTTKey, storeTT,
} from '../../src/utils/chess-ai/chessAITranspositionTable';

const scenarios = [
  { name: 'opening', game: new Chess() },
  { name: 'middlegame', game: new Chess('r2q1rk1/pp2bppp/2np1n2/2p1p3/2P1P3/2NP1NP1/PP2PPBP/R1BQ1RK1 w - - 0 10') },
  { name: 'endgame-clock', game: new Chess('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 91 63') },
];
const count = Number(process.env.TT_KEY_BENCH_LOOPS ?? 100_000);
const loops = Number.isFinite(count) ? Math.max(1, Math.min(1_000_000, Math.floor(count))) : 100_000;
const tuningHash = 0x1234abcd;
const tuningKey = tuningHash.toString(16);

function measure(build: () => string | { index: number; verifier: number }, warmups: number) {
  let checksum = 0;
  for (let n = 0; n < warmups; n += 1) lookupTT(build(), 3);
  const start = performance.now();
  for (let n = 0; n < loops; n += 1) {
    const result = lookupTT(build(), 3);
    checksum += result?.score ?? 0;
  }
  return { elapsed: performance.now() - start, checksum };
}

for (const { name, game } of scenarios) {
  const ctx = createRepetitionContext(game);
  const stringContext = `w:${tuningKey}:${getRepetitionContextKey(ctx)}`;
  const stringBuild = () => makeTTKey(game.fen(), stringContext);
  const numericBuild = () => makeIncrementalTTKey(game, 'w', tuningHash, ctx);
  if (typeof numericBuild() === 'string') throw new Error('incremental chess.js hash unavailable');
  clearTranspositionTable();
  storeTT(stringBuild(), 37, 3, 'exact', null);
  const baseline = measure(stringBuild, 500);
  clearTranspositionTable();
  storeTT(numericBuild(), 37, 3, 'exact', null);
  const improved = measure(numericBuild, 500);
  if (baseline.checksum !== improved.checksum) throw new Error('benchmark lookup mismatch');
  console.log(
    `${name}: ${loops} key+lookups: ${baseline.elapsed.toFixed(1)}ms FEN vs ${improved.elapsed.toFixed(1)}ms incremental; ${(baseline.elapsed / improved.elapsed).toFixed(2)}x`,
  );
}
clearTranspositionTable();

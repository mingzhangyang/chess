/**
 * Repeatable local-only comparison of the legacy comparator and cached score sort.
 *
 * Run: node --import tsx research/scripts/phaseE1-move-ordering-benchmark.ts
 * Optional: MOVE_ORDER_BENCH_LOOPS=3000 (per position / variant).
 * This is a microbenchmark, not an engine Elo or end-to-end latency claim.
 */
import { performance } from 'node:perf_hooks';
import { Chess } from 'chess.js';
import { generateMoves, generateTacticalMoves, getBoard, type AiMove } from '../../src/utils/chess-ai/chessAIBoardOps';
import { orderMoves, scoreMoveForOrdering } from '../../src/utils/chess-ai/chessAIMoveOrdering';

const positions = [
  { name: 'middlegame', fen: 'r2q1rk1/pp2bppp/2np1n2/2p1p3/2P1P3/2NP1NP1/PP2PPBP/R1BQ1RK1 w - - 0 10', tactical: false },
  { name: 'en-passant', fen: 'rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3', tactical: false },
  { name: 'recapture', fen: '2k5/8/8/3p4/4b3/8/3R4/2K5 w - - 0 1', tactical: false },
  { name: 'quiescence', fen: '2k5/8/8/3p4/4b3/8/p2R4/2K5 w - - 0 1', tactical: true },
];
const input = Number(process.env.MOVE_ORDER_BENCH_LOOPS ?? 2000);
const loops = Number.isFinite(input) ? Math.max(1, Math.min(50_000, Math.floor(input))) : 2000;

const moveKey = (move: AiMove): string => `${move.from}${move.to}${move.promotion ?? ''}`;
const legacy = (moves: AiMove[], board: ReturnType<Chess['board']>): AiMove[] =>
  moves.sort((a, b) => scoreMoveForOrdering(b, board) - scoreMoveForOrdering(a, board));

const measure = (name: string, inputMoves: AiMove[], board: ReturnType<Chess['board']>, sort: typeof legacy) => {
  let checksum = 0;
  for (let i = 0; i < 100; i += 1) {
    sort([...inputMoves], board);
  }
  const started = performance.now();
  for (let i = 0; i < loops; i += 1) {
    const sorted = sort([...inputMoves], board);
    checksum += sorted[0]?.to.charCodeAt(0) ?? 0;
  }
  return { name, ms: performance.now() - started, checksum };
};

for (const scenario of positions) {
  const game = new Chess(scenario.fen);
  const board = getBoard(game);
  const moves = scenario.tactical ? generateTacticalMoves(game) : generateMoves(game);
  if (scenario.tactical) {
    if (moves.length < 2) {
      throw new Error(`tactical benchmark ${scenario.name} needs at least two candidates`);
    }
    if (new Set(moves.map((move) => scoreMoveForOrdering(move, board))).size < 2) {
      throw new Error(`tactical benchmark ${scenario.name} needs different ordering scores`);
    }
  }
  const baselineOrder = legacy([...moves], board).map(moveKey);
  const cachedOrder = orderMoves([...moves], board).map(moveKey);
  if (baselineOrder.join(',') !== cachedOrder.join(',')) {
    throw new Error(`move-order regression at ${scenario.name}`);
  }

  const baseline = measure('legacy', moves, board, legacy);
  const cached = measure('cached', moves, board, orderMoves);
  if (baseline.checksum !== cached.checksum) throw new Error('benchmark checksum mismatch');
  const ratio = cached.ms > 0 ? (baseline.ms / cached.ms).toFixed(2) : 'n/a';
  console.log(`${scenario.name.padEnd(12)} candidates=${String(moves.length).padStart(2)} ${baseline.ms.toFixed(1)}ms -> ${cached.ms.toFixed(1)}ms (${ratio}x) across ${loops} sorts`);
}

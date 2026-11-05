/**
 * Local microbenchmark for phase 1 only:
 *   node --import tsx research/scripts/search-position-benchmark.ts
 *
 * Both implementations receive pre-generated legal moves. This measures
 * make/undo and repetition bookkeeping, not move generation, legality,
 * evaluation, completed depth, playing strength, or browser latency.
 */
import { Chess } from 'chess.js';
import { generateMoves, isFastBoardOpsEnabled, makeMove, undoMove, type AiMove } from '../../src/utils/chess-ai/chessAIBoardOps';
import { SearchPosition, squareFromAlgebraic, type SearchMove } from '../../src/utils/chess-ai/searchPosition';

type Fixture = { game: Chess; position: SearchPosition; moves: AiMove[]; searchMoves: SearchMove[] };
const asSearchMove = (move: AiMove): SearchMove => ({
  from: squareFromAlgebraic(move.from),
  to: squareFromAlgebraic(move.to),
  promotion: move.promotion as SearchMove['promotion'],
});
const fens = [
  new Chess().fen(),
  'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
  'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1',
  '4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1',
  '4r1k1/8/8/2PpP3/8/8/8/4K3 w - d6 0 2',
  '8/6bb/8/8/R1pP2k1/4P3/P7/K7 b - d3 0 1',
  '1r2k3/P7/8/8/8/8/8/4K3 w - - 98 1',
  '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
];
let seed = 0x2d23a59b;
const random = (n: number) => {
  seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
  return (seed >>> 0) % n;
};
const lines: Fixture[] = [];
for (let run = 0; run < 8; run += 1) {
  const game = new Chess();
  const moves: AiMove[] = [];
  for (let ply = 0; ply < 70 && !game.isGameOver(); ply += 1) {
    const legal = generateMoves(game);
    if (!legal.length) break;
    if (run < 4 && ply % 8 === 4) fens.push(game.fen());
    const move = legal[random(legal.length)];
    moves.push(move);
    makeMove(game, move);
  }
  const root = new Chess();
  lines.push({ game: root, position: new SearchPosition(root.fen(), { historyComplete: true }), moves, searchMoves: moves.map(asSearchMove) });
}
const roots: Fixture[] = fens.map((fen) => {
  const game = new Chess(fen);
  const moves = generateMoves(game);
  return { game, position: new SearchPosition(fen, { historyComplete: true }), moves, searchMoves: moves.map(asSearchMove) };
});
if (!isFastBoardOpsEnabled()) throw new Error('reference fast path is unavailable');

const rawRounds = Number(process.env.SEARCH_POSITION_BENCH_ROUNDS ?? 40);
const rounds = Number.isFinite(rawRounds) ? Math.max(1, Math.min(500, Math.floor(rawRounds))) : 40;
const measure = (fixtures: Fixture[], kind: 'reference' | 'position', deep: boolean) => {
  let pairs = 0;
  const started = performance.now();
  for (let repeat = 0; repeat < rounds; repeat += 1) {
    for (const fixture of fixtures) {
      if (kind === 'reference') {
        if (deep) {
          for (const move of fixture.moves) makeMove(fixture.game, move);
          for (let i = 0; i < fixture.moves.length; i += 1) undoMove(fixture.game);
        } else {
          for (const move of fixture.moves) { makeMove(fixture.game, move); undoMove(fixture.game); }
        }
      } else if (deep) {
        for (const move of fixture.searchMoves) fixture.position.makeMove(move);
        for (let i = 0; i < fixture.searchMoves.length; i += 1) fixture.position.undo();
      } else {
        for (const move of fixture.searchMoves) { fixture.position.makeMove(move); fixture.position.undo(); }
      }
      pairs += fixture.moves.length;
    }
  }
  return { elapsedMs: performance.now() - started, pairs };
};
const median = (numbers: number[]) => [...numbers].sort((a, b) => a - b)[Math.floor(numbers.length / 2)];
const compare = (name: string, fixtures: Fixture[], deep: boolean) => {
  for (let warmup = 0; warmup < 3; warmup += 1) {
    measure(fixtures, 'reference', deep); measure(fixtures, 'position', deep);
  }
  const reference: number[] = [], position: number[] = [];
  let pairs = 0;
  for (let run = 0; run < 7; run += 1) {
    const first = measure(fixtures, run % 2 === 0 ? 'reference' : 'position', deep);
    const second = measure(fixtures, run % 2 === 0 ? 'position' : 'reference', deep);
    reference.push(run % 2 === 0 ? first.elapsedMs : second.elapsedMs);
    position.push(run % 2 === 0 ? second.elapsedMs : first.elapsedMs);
    if (first.pairs !== second.pairs) throw new Error('different move counts');
    pairs = first.pairs;
  }
  const a = median(reference), b = median(position);
  console.log(JSON.stringify({ name, fixtures: fixtures.length, rounds, pairs,
    referenceMedianMs: +a.toFixed(2), positionMedianMs: +b.toFixed(2), medianRatio: +(a / b).toFixed(2) }));
};
compare('single-move roots', roots, false);
compare('multi-ply paths', lines, true);

/**
 * Local perft-style move generation + make/undo benchmark, not an AI benchmark.
 * Run: node --import tsx research/scripts/search-position-movegen-benchmark.ts
 */
import assert from 'node:assert/strict';
import { cpus, platform, release, arch } from 'node:os';
import { Chess } from 'chess.js';
import { generateMoves, isFastBoardOpsEnabled, makeMove, undoMove } from '../../src/utils/chess-ai/chessAIBoardOps';
import { SearchPosition, squareToAlgebraic, type SearchMove } from '../../src/utils/chess-ai/searchPosition';

const cases = [
  { name: 'initial', fen: new Chess().fen(), depth: 4, expected: 197281 },
  { name: 'kiwipete', fen: 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', depth: 3, expected: 97862 },
  { name: 'endgame', fen: '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', depth: 4, expected: 43238 },
] as const;
const searchUci = (m: SearchMove) => `${squareToAlgebraic(m.from)}${squareToAlgebraic(m.to)}${m.promotion ?? ''}`;
const fastUci = (m: ReturnType<typeof generateMoves>[number]) => `${m.from}${m.to}${m.promotion ?? ''}`;

const searchPerft = (p: SearchPosition, depth: number): number => {
  if (!depth) return 1;
  let nodes = 0;
  for (const move of p.generateLegalMoves()) {
    p.makeMove(move);
    try { nodes += searchPerft(p, depth - 1); } finally { p.undo(); }
  }
  return nodes;
};
const fastPerft = (game: Chess, depth: number): number => {
  if (!depth) return 1;
  let nodes = 0;
  for (const move of generateMoves(game)) {
    makeMove(game, move);
    try { nodes += fastPerft(game, depth - 1); } finally { undoMove(game); }
  }
  return nodes;
};

// Before timing, compare complete move sets at every interior node and verify
// the known totals. The move path in assertion messages acts as a divide aid.
const verifyTree = (p: SearchPosition, game: Chess, depth: number, path = ''): number => {
  if (!depth) return 1;
  const searchMoves = p.generateLegalMoves();
  const fastMoves = generateMoves(game);
  const byUci = new Map(fastMoves.map((m) => [fastUci(m), m]));
  assert.deepEqual(searchMoves.map(searchUci).sort(), [...byUci.keys()].sort(), `move sets: ${path || '(root)'}`);
  let nodes = 0;
  for (const move of searchMoves) {
    const key = searchUci(move);
    p.makeMove(move);
    makeMove(game, byUci.get(key)!);
    try { nodes += verifyTree(p, game, depth - 1, `${path} ${key}`); }
    finally { p.undo(); undoMove(game); }
  }
  return nodes;
};

if (!isFastBoardOpsEnabled()) throw new Error('Existing fast board path is unavailable; benchmark would not be comparable');
const results = [];
for (const c of cases) {
  const verified = verifyTree(new SearchPosition(c.fen), new Chess(c.fen), c.depth);
  assert.equal(verified, c.expected, `${c.name} reference count`);
  // Warm both paths before recording, then alternate order to reduce order bias.
  searchPerft(new SearchPosition(c.fen), Math.min(c.depth, 2));
  fastPerft(new Chess(c.fen), Math.min(c.depth, 2));
  const times: Record<'fast' | 'search', number[]> = { fast: [], search: [] };
  for (let run = 0; run < 5; run++) {
    for (const which of (run % 2 ? ['search', 'fast'] : ['fast', 'search']) as Array<'fast' | 'search'>) {
      const p = which === 'search' ? new SearchPosition(c.fen) : null;
      const game = which === 'fast' ? new Chess(c.fen) : null;
      const start = process.hrtime.bigint();
      const count = p ? searchPerft(p, c.depth) : fastPerft(game!, c.depth);
      const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
      assert.equal(count, c.expected, `${c.name} ${which} run ${run}`);
      times[which].push(Number(elapsed.toFixed(2)));
    }
  }
  const median = (values: number[]) => [...values].sort((a, b) => a - b)[2];
  results.push({ position: c.name, depth: c.depth, leafNodes: c.expected, samplesMs: times,
    medianMs: { fast: median(times.fast), search: median(times.search) } });
}
console.log(JSON.stringify({ environment: { node: process.version, os: `${platform()} ${release()} ${arch()}`,
  cpu: cpus()[0]?.model ?? 'unknown', logicalCpus: cpus().length }, samplesPerPath: 5, results }, null, 2));

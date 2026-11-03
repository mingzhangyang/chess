import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { generateMoves, generateTacticalMoves, getBoard } from '../../src/utils/chess-ai/chessAIBoardOps';
import { orderMoves, scoreMoveForOrdering, sortMovesByCachedScore } from '../../src/utils/chess-ai/chessAIMoveOrdering';

const scenarios = [
  { name: 'starting position', fen: new Chess().fen() },
  { name: 'complex middlegame', fen: 'r2q1rk1/pp2bppp/2np1n2/2p1p3/2P1P3/2NP1NP1/PP2PPBP/R1BQ1RK1 w - - 0 10' },
  { name: 'en passant', fen: 'rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3' },
  { name: 'promotion', fen: '6k1/4P3/8/8/8/K7/8/8 w - - 0 1' },
  { name: 'tactical recapture', fen: '2k5/8/8/3p4/4b3/8/3R4/2K5 w - - 0 1' },
];

const moveKey = (move: { from: string; to: string; promotion?: string }): string =>
  `${move.from}${move.to}${move.promotion ?? ''}`;

test('cached score sorting evaluates every candidate exactly once and keeps stable ties', () => {
  const entries = [
    { id: 'a', score: 10 },
    { id: 'b', score: -5 },
    { id: 'c', score: 10 },
    { id: 'd', score: 25 },
    { id: 'e', score: -5 },
  ];
  const seen = new Map<string, number>();
  const original = entries;
  const sorted = sortMovesByCachedScore(entries, (entry) => {
    seen.set(entry.id, (seen.get(entry.id) ?? 0) + 1);
    return entry.score;
  });
  assert.equal(sorted, original, 'sort must mutate and return the original array');
  assert.deepEqual(sorted.map((entry) => entry.id), ['d', 'a', 'c', 'b', 'e']);
  assert.deepEqual([...seen.values()], [1, 1, 1, 1, 1]);
});

test('cached score sorting does no work for empty and single-move arrays', () => {
  const neverCalled = (): never => { throw new Error('unnecessary scoring'); };
  const empty: number[] = [];
  const single = [42];
  assert.equal(sortMovesByCachedScore(empty, neverCalled), empty);
  assert.equal(sortMovesByCachedScore(single, neverCalled), single);
});

test('move ordering is identical to legacy comparator across representative positions', () => {
  for (const { name, fen } of scenarios) {
    const game = new Chess(fen);
    const before = game.fen();
    const board = getBoard(game);
    const candidates = generateMoves(game);
    const expected = [...candidates]
      .sort((a, b) => scoreMoveForOrdering(b, board) - scoreMoveForOrdering(a, board))
      .map(moveKey);
    const actual = orderMoves(candidates, board);
    assert.equal(actual, candidates, `${name}: preserve input array identity`);
    assert.deepEqual(actual.map(moveKey), expected, `${name}: preserve ordering and ties`);
    assert.equal(game.fen(), before, `${name}: do not mutate board`);
  }
});

test('quiescence tactical ordering stays identical to legacy comparator', () => {
  for (const { name, fen } of scenarios) {
    const game = new Chess(fen);
    const board = getBoard(game);
    const candidates = generateTacticalMoves(game);
    const expected = [...candidates]
      .sort((a, b) => scoreMoveForOrdering(b, board) - scoreMoveForOrdering(a, board))
      .map(moveKey);
    assert.deepEqual(orderMoves(candidates, board).map(moveKey), expected, `${name}: tactical order`);
  }
});

test('quiescence benchmark position offers multiple captures with different ordering scores', () => {
  const game = new Chess('2k5/8/8/3p4/4b3/8/p2R4/2K5 w - - 0 1');
  const board = getBoard(game);
  const moves = generateTacticalMoves(game);
  const moveKeys = moves.map(moveKey);

  assert.ok(moves.length >= 2, 'sorting requires at least two tactical candidates');
  assert.ok(moveKeys.includes('d2d5'), 'white rook should be able to capture the pawn on d5');
  assert.ok(moveKeys.includes('d2a2'), 'white rook should be able to capture the pawn on a2');
  assert.ok(new Set(moves.map((move) => scoreMoveForOrdering(move, board))).size >= 2,
    'benchmark must exercise genuinely different ordering scores');
});

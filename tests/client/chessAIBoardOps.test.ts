import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess, type Move } from 'chess.js';
import {
  generateMoves,
  generatePseudoLegalMoves,
  hasLegalMove,
  isFastBoardOpsEnabled,
  makeMove,
  makeMoveIfLegal,
  moveToSan,
  undoMove,
  type AiMove,
} from '../../src/utils/chess-ai/chessAIBoardOps';

// Positions covering castling, en passant, promotions (with and without
// capture), checks, pins and a stalemate-adjacent endgame.
const PARITY_FENS = [
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
  'rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3',
  'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1',
  '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
  'n1n5/PPPk4/8/8/8/8/4Kppp/5N1N b - - 0 1',
  '4k3/8/8/8/8/8/4q3/4K3 w - - 0 1',
];

const describeMove = (move: AiMove): string => JSON.stringify({
  color: move.color,
  from: move.from,
  to: move.to,
  piece: move.piece,
  captured: move.captured,
  promotion: move.promotion,
  flags: move.flags,
  isCapture: move.isCapture(),
  isPromotion: move.isPromotion(),
  isEnPassant: move.isEnPassant(),
});

test('fast board ops are active for the installed chess.js version', () => {
  assert.equal(isFastBoardOpsEnabled(), true);
});

test('generateMoves matches chess.js verbose move generation', () => {
  for (const fen of PARITY_FENS) {
    const game = new Chess(fen);
    const expected = (game.moves({ verbose: true }) as Move[]).map(describeMove).sort();
    const actual = generateMoves(game).map(describeMove).sort();
    assert.deepEqual(actual, expected, `move generation mismatch for ${fen}`);
  }
});

const perft = (game: Chess, depth: number): number => {
  if (depth === 0) return 1;
  const moves = generateMoves(game);
  if (depth === 1) return moves.length;
  let nodes = 0;
  for (const move of moves) {
    makeMove(game, move);
    nodes += perft(game, depth - 1);
    undoMove(game);
  }
  return nodes;
};

test('make/undo with generated moves reproduces reference perft counts', () => {
  // Reference values from the chess programming wiki perft suite.
  assert.equal(perft(new Chess(), 3), 8902);
  assert.equal(perft(new Chess(PARITY_FENS[1]), 2), 2039);
  assert.equal(perft(new Chess(PARITY_FENS[4]), 3), 2812);
  assert.equal(perft(new Chess(PARITY_FENS[3]), 2), 264);
});

test('make/undo restores FEN, hash, history and repetition state', () => {
  for (const fen of PARITY_FENS) {
    const game = new Chess(fen);
    const beforeFen = game.fen();
    const beforeHash = game.hash();
    const beforeHistory = game.history().length;
    for (const move of generateMoves(game)) {
      makeMove(game, move);
      const reference = new Chess(beforeFen);
      reference.move({ from: move.from, to: move.to, promotion: move.promotion });
      assert.equal(game.fen(), reference.fen(), `make mismatch for ${move.from}${move.to} in ${fen}`);
      assert.equal(game.hash(), reference.hash(), `hash mismatch for ${move.from}${move.to} in ${fen}`);
      undoMove(game);
      assert.equal(game.fen(), beforeFen);
      assert.equal(game.hash(), beforeHash);
      assert.equal(game.history().length, beforeHistory);
    }
  }
});

test('moves made through board ops still count towards threefold repetition', () => {
  const game = new Chess();
  const shuffle = ['Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3', 'Nf6', 'Ng1'];
  for (const san of shuffle) game.move(san);
  assert.equal(game.isThreefoldRepetition(), false);

  const repeat = generateMoves(game).find((move) => move.from === 'f6' && move.to === 'g8');
  assert.ok(repeat, 'expected Ng8 to be legal');
  makeMove(game, repeat);
  assert.equal(game.isThreefoldRepetition(), true);
  undoMove(game);
  assert.equal(game.isThreefoldRepetition(), false);
});

test('board ops accept chess.js Move objects as well as generated moves', () => {
  const game = new Chess();
  const verbose = game.moves({ verbose: true }).find((move) => move.san === 'e4');
  assert.ok(verbose);
  makeMove(game, verbose);
  assert.equal(game.fen(), 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1');
  undoMove(game);
  assert.equal(game.fen(), new Chess().fen());
});

test('moveToSan converts a generated move into SAN for the current position', () => {
  const game = new Chess('n1n5/PPPk4/8/8/8/8/4Kppp/5N1N w - - 0 1');
  const promotion = generateMoves(game).find((move) => move.from === 'b7' && move.to === 'a8' && move.promotion === 'n');
  assert.ok(promotion);
  assert.equal(moveToSan(game, promotion), 'bxa8=N');
});

const lazyPerft = (game: Chess, depth: number): number => {
  if (depth === 0) return 1;
  let nodes = 0;
  for (const move of generatePseudoLegalMoves(game)) {
    if (!makeMoveIfLegal(game, move)) continue;
    nodes += lazyPerft(game, depth - 1);
    undoMove(game);
  }
  return nodes;
};

test('pseudo-legal generation with lazy legality checks reproduces reference perft counts', () => {
  assert.equal(lazyPerft(new Chess(), 3), 8902);
  assert.equal(lazyPerft(new Chess(PARITY_FENS[1]), 2), 2039);
  assert.equal(lazyPerft(new Chess(PARITY_FENS[4]), 3), 2812);
  assert.equal(lazyPerft(new Chess(PARITY_FENS[3]), 2), 264);
});

test('makeMoveIfLegal leaves the position untouched when the move exposes the king', () => {
  // The e2 knight is pinned against the king by the e8 rook.
  const game = new Chess('4r1k1/8/8/8/8/8/4N3/4K3 w - - 0 1');
  const before = game.fen();
  const pinnedMove = generatePseudoLegalMoves(game).find((move) => move.from === 'e2' && move.to === 'c3');
  assert.ok(pinnedMove, 'expected the pinned knight move among pseudo-legal moves');
  assert.equal(makeMoveIfLegal(game, pinnedMove), false);
  assert.equal(game.fen(), before);
  assert.equal(game.history().length, 0);
});

test('hasLegalMove distinguishes stalemate from positions with a legal move', () => {
  assert.equal(hasLegalMove(new Chess('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1')), false);
  assert.equal(hasLegalMove(new Chess()), true);
  assert.equal(hasLegalMove(new Chess('4k2r/8/8/8/6p1/1q3pP1/5P2/K6N w - - 0 1')), false);
});

/**
 * Phase 9 bitboard shortcuts must give exactly the answers of the square-by-
 * square code they speed up: attack tests against a naive board scan, and the
 * kernel's mobility and king-safety terms against the shared evaluator's.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { evaluateKingSafety, pseudoMobility } from '../../src/utils/chess-ai/chessAIEvaluation';
import { DEFAULT_AI_TUNING } from '../../src/utils/chess-ai/chessAITuning';
import { kernelKingSafety, kernelMobility } from '../../src/utils/chess-ai/independent/kernelEvaluation';
import { SearchPosition } from '../../src/utils/chess-ai/searchPosition';

const SPECIAL_FENS = [
  'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
  'r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1',
  '4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1',
  'n1n5/PPPk4/8/8/8/8/4Kppp/5N1N b - - 0 1',
  '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
  'q3k2q/8/8/3QQ3/3qq3/8/8/Q3K2Q w - - 0 1',
  'b6b/1B4B1/8/3kK3/8/8/1b4b1/B6B w - - 0 1',
  '7k/8/8/8/8/8/8/R3K2R w KQ - 0 1',
];

/** Positions from seeded games that favour captures, so sliders get open lines. */
const positions = (): SearchPosition[] => {
  const out = SPECIAL_FENS.map((fen) => new SearchPosition(fen));
  let seed = 0x0b17b0a2;
  const random = (n: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
  for (let game = 0; game < 24; game += 1) {
    const position = new SearchPosition(new Chess().fen(), { historyComplete: true });
    for (let ply = 0; ply < 140; ply += 1) {
      const moves = position.generateLegalMoves();
      if (!moves.length) break;
      const tactical = position.generateTacticalMoves();
      position.makeMove(tactical.length && random(2) === 0 ? tactical[random(tactical.length)] : moves[random(moves.length)]);
      if (ply % 3 === 0) out.push(new SearchPosition(position.toFen({ rawEnPassant: true })));
    }
  }
  return out;
};

/** Does side `by` attack `target`? Square by square, pins ignored. */
const naiveAttacked = (squares: Int8Array, target: number, by: 1 | -1): boolean => {
  const rank = target >> 3; const file = target & 7;
  const at = (r: number, f: number) => (r >= 0 && r < 8 && f >= 0 && f < 8 ? squares[r * 8 + f] : 99);
  if (at(rank + by, file - 1) === by || at(rank + by, file + 1) === by) return true;
  for (const [dr, df] of [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]]) if (at(rank + dr, file + df) === by * 2) return true;
  for (let dr = -1; dr <= 1; dr += 1) for (let df = -1; df <= 1; df += 1) {
    if (!dr && !df) continue;
    if (at(rank + dr, file + df) === by * 6) return true;
    const slider = dr && df ? by * 3 : by * 4;
    for (let r = rank + dr, f = file + df; at(r, f) !== 99; r += dr, f += df) {
      const piece = at(r, f);
      if (piece === 0) continue;
      if (piece === slider || piece === by * 5) return true;
      break;
    }
  }
  return false;
};

test('attack tests with slider pre-checks agree with a naive scan on every square', () => {
  let checks = 0;
  for (const position of positions()) {
    for (let square = 0; square < 64; square += 1) for (const by of [1, -1] as const) {
      assert.equal(position.isSquareAttackedBy(square, by), naiveAttacked(position.squares, square, by), `${position.toFen()} ${square} ${by}`);
      checks += 1;
    }
  }
  assert.ok(checks > 100_000, `${checks}`);
});

test('the slider bitboards hold exactly the bishops, rooks and queens of each side', () => {
  for (const position of positions()) {
    const expected = new Int32Array(8);
    position.squares.forEach((piece, square) => {
      const type = Math.abs(piece);
      const base = piece > 0 ? 0 : 4;
      const bit = 1 << (square & 31);
      if (type === 3 || type === 5) expected[base + (square >> 5)] |= bit;
      if (type === 4 || type === 5) expected[base + 2 + (square >> 5)] |= bit;
    });
    assert.deepEqual([...position.sliderOccupancy], [...expected], position.toFen());
  }
});

test('kernel mobility equals the shared pseudo-mobility for every piece', () => {
  let pieces = 0;
  for (const position of positions()) {
    const squares = position.squares;
    for (let square = 0; square < 64; square += 1) {
      const piece = squares[square];
      const type = Math.abs(piece);
      if (type < 2 || type > 5) continue;
      assert.equal(kernelMobility(position, square, type, piece > 0), pseudoMobility(squares, square, type, piece > 0), `${position.toFen()} ${square}`);
      pieces += 1;
    }
  }
  assert.ok(pieces > 5_000, `${pieces}`);
});

test('kernel king safety equals the shared king safety for both kings and both settings', () => {
  const pawnFiles = (squares: Int8Array, white: boolean): Uint8Array => {
    const files = new Uint8Array(8);
    squares.forEach((piece, square) => { if (piece === (white ? 1 : -1)) files[square & 7] |= 1 << (square >> 3); });
    return files;
  };
  for (const position of positions()) for (const enableNonlinearKingSafety of [true, false]) {
    const tuning = { ...DEFAULT_AI_TUNING, enableNonlinearKingSafety };
    for (const color of ['w', 'b'] as const) {
      const king = color === 'w' ? position.whiteKingSquare : position.blackKingSquare;
      const pawns = pawnFiles(position.squares, color === 'w');
      assert.equal(kernelKingSafety(position, king, pawns, color, tuning),
        evaluateKingSafety(position.squares, king >> 3, king & 7, pawns, color, tuning), `${position.toFen()} ${color}`);
    }
  }
});

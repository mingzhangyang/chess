/**
 * Static exchange evaluation (phase 10): the material balance of the capture
 * sequence on one square when both sides always recapture with their least
 * valuable attacker and may stop when continuing would lose. Pins are
 * ignored, as is usual; x-ray attackers behind a captured piece join in.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { MAX_MOVES, moveCaptured, moveFrom, moveTo, movePromotion, isEnPassantMove } from '../../src/utils/chess-ai/independent/moveCode';
import { SearchPosition, squareFromAlgebraic } from '../../src/utils/chess-ai/searchPosition';

const VALUE = [0, 100, 320, 330, 500, 900, 20_000];

/** The same algorithm on a copied board, square by square. */
const naiveSee = (position: SearchPosition, move: number): number => {
  const board = Int8Array.from(position.squares);
  const to = moveTo(move);
  const from = moveFrom(move);
  const at = (r: number, f: number) => (r >= 0 && r < 8 && f >= 0 && f < 8 ? board[r * 8 + f] : 99);
  const leastAttacker = (side: number): number => {
    const rank = to >> 3; const file = to & 7;
    let best = -1; let bestValue = Infinity;
    const consider = (square: number) => {
      const type = Math.abs(board[square]);
      if (VALUE[type] < bestValue) { bestValue = VALUE[type]; best = square; }
    };
    for (const df of [-1, 1]) if (at(rank + side, file + df) === side) consider((rank + side) * 8 + file + df);
    for (const [dr, df] of [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]]) {
      if (at(rank + dr, file + df) === side * 2) consider((rank + dr) * 8 + file + df);
    }
    // boardGeometry's direction order, so equal-valued attackers are chosen alike.
    for (const [dr, df] of [[-1, -1], [-1, 1], [1, -1], [1, 1], [-1, 0], [1, 0], [0, -1], [0, 1]]) {
      if (at(rank + dr, file + df) === side * 6) consider((rank + dr) * 8 + file + df);
      const slider = dr && df ? 3 : 4;
      for (let r = rank + dr, f = file + df; at(r, f) !== 99; r += dr, f += df) {
        const piece = at(r, f);
        if (piece === 0) continue;
        if (piece === side * slider || piece === side * 5) consider(r * 8 + f);
        break;
      }
    }
    return best;
  };
  const gains: number[] = [];
  const captured = isEnPassantMove(move) ? 1 : moveCaptured(move);
  gains.push(VALUE[captured]);
  let onSquare = movePromotion(move) ? VALUE[movePromotion(move)] : VALUE[Math.abs(board[from])];
  if (movePromotion(move)) gains[0] += VALUE[movePromotion(move)] - VALUE[1];
  const mover = Math.sign(board[from]);
  if (isEnPassantMove(move)) board[to + mover * 8] = 0;
  board[to] = movePromotion(move) ? mover * movePromotion(move) : board[from];
  board[from] = 0;
  let side = -mover;
  for (;;) {
    const attacker = leastAttacker(side);
    if (attacker < 0) break;
    gains.push(onSquare - gains[gains.length - 1]);
    onSquare = VALUE[Math.abs(board[attacker])];
    board[to] = board[attacker];
    board[attacker] = 0;
    side = -side;
  }
  for (let i = gains.length - 1; i > 0; i -= 1) gains[i - 1] = -Math.max(-gains[i - 1], gains[i]);
  return gains[0];
};

const captures = (position: SearchPosition): number[] => {
  const buffer = new Int32Array(MAX_MOVES);
  return Array.from(buffer.subarray(0, position.generateMoveCodes(buffer, true)));
};
const find = (fen: string, uci: string): [SearchPosition, number] => {
  const position = new SearchPosition(fen);
  const move = captures(position).find((m) => moveFrom(m) === squareFromAlgebraic(uci.slice(0, 2)) && moveTo(m) === squareFromAlgebraic(uci.slice(2, 4)));
  assert.ok(move, uci);
  return [position, move];
};

test('static exchange on hand-checked positions', () => {
  const cases: Array<[string, string, number]> = [
    // An undefended pawn.
    ['1k1r4/1pp4p/p7/4p3/8/P5P1/1PP4P/2K1R3 w - - 0 1', 'e1e5', 100],
    // Knight takes a pawn defended by a knight: the knight is lost for the pawn.
    ['1k1r3q/1ppn3p/p4b2/4p3/8/P2N2P1/1PP1R1BP/2K1Q3 w - - 0 1', 'd3e5', 100 - 320],
    // Queen takes a pawn defended by a pawn.
    ['4k3/8/3p4/4p3/8/8/7Q/4K3 w - - 0 1', 'h2e5', 100 - 900],
    // Pawn takes an undefended knight.
    ['4k3/8/8/3n4/4P3/8/8/4K3 w - - 0 1', 'e4d5', 320],
    // X-ray: the rook behind the capturing rook makes the recapture lose, so black declines it.
    ['4k3/4r3/8/4p3/8/8/4R3/4R1K1 w - - 0 1', 'e2e5', 100],
    // Without the second rook the recapture wins the rook.
    ['4k3/4r3/8/4p3/8/8/4R3/6K1 w - - 0 1', 'e2e5', 100 - 500],
  ];
  for (const [fen, uci, expected] of cases) {
    const [position, move] = find(fen, uci);
    assert.equal(position.staticExchange(move), expected, `${fen} ${uci}`);
    assert.equal(naiveSee(position, move), expected, `naive ${fen} ${uci}`);
  }
});

test('static exchange equals a square-by-square implementation on random captures', () => {
  let seed = 0x5ee5ee;
  const random = (n: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
  let checked = 0;
  for (let game = 0; game < 40; game += 1) {
    const position = new SearchPosition(new Chess().fen(), { historyComplete: true });
    for (let ply = 0; ply < 120; ply += 1) {
      for (const move of captures(position)) {
        assert.equal(position.staticExchange(move), naiveSee(position, move) + 0, `${position.toFen()} ${move}`);
        checked += 1;
      }
      const moves = position.generateLegalMoves();
      if (!moves.length) break;
      const tactical = position.generateTacticalMoves();
      position.makeMove(tactical.length && random(3) === 0 ? tactical[random(tactical.length)] : moves[random(moves.length)]);
    }
  }
  assert.ok(checked > 5_000, `${checked}`);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { MAX_MOVES, moveCodeToUci } from '../../src/utils/chess-ai/independent/moveCode';
import { SearchPosition } from '../../src/utils/chess-ai/searchPosition';
import { referenceMoveCodes } from './fixtures/referenceMoveGeneration';

const buffer = new Int32Array(MAX_MOVES);
const codesOf = (p: SearchPosition, tacticalOnly = false): number[] => Array.from(buffer.subarray(0, p.generateMoveCodes(buffer, tacticalOnly)));
const fenOf = (p: SearchPosition) => p.toFen({ rawEnPassant: true });

/** Full and tactical lists equal the frozen reference code for code; firstOnly finds legal moves exactly when they exist. */
const checkPosition = (p: SearchPosition, label: string) => {
  const fen = fenOf(p);
  for (const tacticalOnly of [false, true]) {
    const expected = referenceMoveCodes(fen, tacticalOnly);
    assert.deepEqual(codesOf(p, tacticalOnly).map(moveCodeToUci), expected.map(moveCodeToUci), `${label} ${fen} tactical=${tacticalOnly}`);
    assert.deepEqual(codesOf(p, tacticalOnly), expected, `${label} ${fen} codes tactical=${tacticalOnly}`);
  }
  const all = referenceMoveCodes(fen);
  // firstOnly may stop after the first piece with a legal move: at least one, all of them legal.
  const first = p.generateMoveCodes(buffer, false, true);
  assert.equal(first > 0, all.length > 0, `${label} ${fen} firstOnly`);
  for (let i = 0; i < first; i += 1) assert.ok(all.includes(buffer[i]), `${label} ${fen} firstOnly move`);
  assert.equal(p.hasLegalMove(), all.length > 0);
  const fresh = new SearchPosition(fen);
  assert.equal(p.isInCheck(), fresh.isInCheck(), `${label} ${fen} check`);
  const occupancy = [0, 0, 0, 0]; const officers = [0, 0];
  for (let square = 0; square < 64; square += 1) {
    const piece = p.pieceAt(square);
    if (piece) occupancy[(piece > 0 ? 0 : 2) + (square >> 5)] |= 1 << (square & 31);
    if (Math.abs(piece) > 1 && Math.abs(piece) < 6) officers[square >> 5] |= 1 << (square & 31);
  }
  assert.deepEqual([...p.occupancy], occupancy, `${label} ${fen} occupancy`);
  assert.deepEqual([...p.officerOccupancy], officers, `${label} ${fen} knights, bishops, rooks and queens`);
};

const SPECIAL_FENS = [
  new Chess().fen(),
  'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
  'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R b KQkq - 0 1',
  '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
  'r3k2r/8/8/8/8/5r2/8/R3K2R w KQkq - 0 1', // attacked transit
  'r3k2r/8/8/8/8/6r1/8/R3K2R w KQkq - 0 1', // attacked destination
  'r3k2r/8/8/8/8/8/8/R2BK2R w KQkq - 0 1', // blocked queenside
  '4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1',
  '4r1k1/8/8/3pP3/8/8/8/4K3 w - d6 0 2', // pinned en passant
  '8/6bb/8/8/R1pP2k1/4P3/P7/K7 b - d3 0 1', // en passant opens a rank
  '6k1/8/8/3pP3/4K3/8/8/8 w - d6 0 2', // en passant evades check
  '3k4/8/8/2KPp2r/8/8/8/8 w - e6 0 1', // en passant would expose the king
  '1r2k3/P7/8/8/8/8/8/4K3 w - - 0 1', // promotions, with capture
  'n1n5/PPPk4/8/8/8/8/4Kppp/5N1N b - - 0 1',
  '4r1k1/8/8/8/8/8/4N3/4K3 w - - 0 1', // pinned knight
  '4r1k1/8/8/8/1b6/8/8/R3K3 w - - 0 1', // double check
  '4k3/8/8/8/8/2b5/3B4/4K3 w - - 0 1', // pinned bishop on its own diagonal
  '4k3/4r3/8/8/8/8/4R3/4K3 w - - 0 1', // pinned rook on its own file
  '4k3/8/8/1b6/8/3Q4/8/5K2 w - - 0 1', // pinned queen
  '4k3/8/8/8/8/5b2/4P3/3K4 w - - 0 1', // pinned pawn can capture the pinner
  '4k3/4r3/8/8/8/8/4P3/4K3 w - - 0 1', // pinned pawn can still push
  'K7/1P6/8/8/8/8/6q1/k7 w - - 0 1', // pinned pawn on the long diagonal
  'rb2k3/P7/K7/8/8/8/8/8 w - - 0 1', // pinned pawn's capturing promotion
  '4k3/8/8/8/8/8/3q4/4K3 w - - 0 1', // adjacent checker
  '4k3/8/8/8/1b6/8/8/4K2R w K - 0 1', // check by a bishop: block or move
  '4k3/8/8/8/8/8/8/r3K2R w K - 0 1', // check along the rank
  '8/8/8/2k5/3Pp3/8/8/4K3 b - d3 0 1', // the double-pushed pawn checks; en passant captures it
  '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1', // stalemate
  '7k/6Q1/6K1/8/8/8/8/8 b - - 0 1', // mate
];

test('generated codes equal the frozen reference generator in content and order', () => {
  for (const fen of SPECIAL_FENS) {
    const p = new SearchPosition(fen);
    checkPosition(p, 'special');
    // Children are reached incrementally, so every maintained structure is exercised.
    for (const code of codesOf(p)) { p.makeMoveCode(code); checkPosition(p, `after ${moveCodeToUci(code)}`); p.undo(); }
    checkPosition(p, 'after undo');
  }
});

test('seeded games and their search trees match the reference generator, in and out of check', () => {
  let seed = 0x6e3e_7a11;
  const random = (n: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
  let checked = 0; let inCheck = 0;
  for (let run = 0; run < 12; run += 1) {
    const p = new SearchPosition(new Chess().fen(), { historyComplete: true });
    for (let ply = 0; ply < 120; ply += 1) {
      checkPosition(p, `game ${run} ply ${ply}`);
      checked += 1;
      const codes = codesOf(p);
      if (!codes.length) break;
      // A sample of children and grandchildren, as a search visits them.
      for (let i = ply % 5; i < codes.length; i += 5) {
        p.makeMoveCode(codes[i]);
        checkPosition(p, `game ${run} ply ${ply} child`); checked += 1;
        if (p.isInCheck()) inCheck += 1;
        const replies = codesOf(p);
        if (replies.length) { p.makeMoveCode(replies[random(replies.length)]); checkPosition(p, 'grandchild'); checked += 1; p.undo(); }
        p.undo();
      }
      const tactical = codesOf(p, true);
      p.makeMoveCode(tactical.length && random(3) === 0 ? tactical[random(tactical.length)] : codes[random(codes.length)]);
    }
  }
  assert.ok(checked > 3000 && inCheck > 150, `${checked} positions, ${inCheck} in check`);
});

test('the in-check answer stays correct across null moves, undo and checkpoint restore', () => {
  const p = new SearchPosition('4k3/8/8/8/1b6/8/8/4K2R w K - 0 1');
  assert.equal(p.isInCheck(), true);
  const [first] = codesOf(p);
  p.makeMoveCode(first);
  assert.equal(p.isInCheck(), new SearchPosition(p.toFen()).isInCheck());
  p.undo();
  assert.equal(p.isInCheck(), true);
  const quiet = new SearchPosition('4k3/8/8/8/8/8/8/4K2R w K - 0 1');
  assert.equal(quiet.isInCheck(), false);
  quiet.makeNullMove();
  assert.equal(quiet.isInCheck(), false);
  quiet.makeMoveCode(codesOf(quiet)[0]);
  assert.equal(quiet.isInCheck(), new SearchPosition(quiet.toFen()).isInCheck());
  quiet.restore(0);
  assert.equal(quiet.isInCheck(), false);
});

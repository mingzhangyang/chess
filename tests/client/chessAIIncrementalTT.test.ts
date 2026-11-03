import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { generateMoves, makeMove, undoMove } from '../../src/utils/chess-ai/chessAIBoardOps';
import {
  clearTranspositionTable,
  lookupTT,
  makeIncrementalTTKey,
  storeTT,
} from '../../src/utils/chess-ai/chessAITranspositionTable';
import {
  advanceRepetitionContext,
  advanceRepetitionContextWithRights,
  createRepetitionContext,
  getCastlingRightsState,
  type RepetitionContext,
} from '../../src/utils/chess-ai/chessAIRepetition';

const context = (hash = 0x811c9dc5, reversiblePly = 0): RepetitionContext => ({ hash, reversiblePly });
const position = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq -';

const keyFor = (game: Chess, color: 'w' | 'b' = 'w', tuningHash = 123, ctx = context()) =>
  makeIncrementalTTKey(game, color, tuningHash, ctx);

test('incremental transposition key uses numeric Zobrist state without FEN serialization', () => {
  const game = new Chess();
  const originalFen = game.fen;
  game.fen = () => { throw new Error('FEN must not be needed by the numeric search hot path'); };
  try {
    const key = keyFor(game);
    assert.equal(typeof key, 'object');
    assert.ok(key && typeof key !== 'string' && Number.isInteger(key.index));
    assert.ok(key && typeof key !== 'string' && Number.isInteger(key.verifier));
    assert.deepEqual(keyFor(game), key);
  } finally {
    game.fen = originalFen;
  }
});

test('Zobrist keys preserve halfmove but ignore fullmove number', () => {
  const a = new Chess(`${position} 0 1`);
  const b = new Chess(`${position} 95 1`);
  const c = new Chess(`${position} 0 57`);
  assert.equal(a.hash(), b.hash(), 'base board hash excludes the fifty-move clock');
  assert.equal(a.hash(), c.hash(), 'base board hash excludes move numbering');
  assert.notDeepEqual(keyFor(a), keyFor(b), 'TT must distinguish fifty-move clocks');
  assert.deepEqual(keyFor(a), keyFor(c), 'move numbering must not split identical TT states');
});

test('Zobrist keys distinguish position, side, castling, en-passant, tuning and perspective', () => {
  const initial = new Chess();
  const afterE4 = new Chess();
  afterE4.move('e4');
  assert.notDeepEqual(keyFor(initial), keyFor(afterE4));
  assert.notDeepEqual(keyFor(initial, 'w'), keyFor(initial, 'b'));
  assert.notDeepEqual(keyFor(initial, 'w', 11), keyFor(initial, 'w', 12));

  const bothRights = new Chess(`${position} 0 1`);
  const fewerRights = new Chess('r3k2r/8/8/8/8/8/8/R3K2R w Kk - 0 1');
  assert.notDeepEqual(keyFor(bothRights), keyFor(fewerRights), 'castling rights change the position hash');

  const withEp = new Chess('rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3');
  const withoutEp = new Chess('rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq - 0 3');
  assert.notDeepEqual(keyFor(withEp), keyFor(withoutEp), 'legal en-passant rights affect the position');
});

test('repetition contexts prevent caching across equal FEN and Zobrist states', () => {
  const first = new Chess();
  for (const san of ['Nf3', 'Nf6', 'Nc3', 'Nc6']) first.move(san);
  const second = new Chess();
  for (const san of ['Nc3', 'Nc6', 'Nf3', 'Nf6']) second.move(san);
  assert.equal(first.fen(), second.fen(), 'the move orders must transpose to the same position');
  assert.equal(first.hash(), second.hash());
  assert.notDeepEqual(
    keyFor(first, 'w', 123, createRepetitionContext(first)),
    keyFor(second, 'w', 123, createRepetitionContext(second)),
    'different reversible histories cannot reuse TT scores',
  );
  assert.notDeepEqual(keyFor(first, 'w', 123, context(1, 1)), keyFor(first, 'w', 123, context(1, 2)));
  assert.notDeepEqual(keyFor(first, 'w', 123, context(1, 1)), keyFor(first, 'w', 123, context(2, 1)));
});

test('numeric TT keys store/lookup scores and reject verification collisions', () => {
  const key = keyFor(new Chess());
  assert.notEqual(typeof key, 'string');
  if (typeof key === 'string') throw new Error('expected fast numeric key');
  const forgedCollision = { index: key.index, verifier: key.verifier ^ 1 };
  clearTranspositionTable();
  try {
    storeTT(key, 471, 5, 'exact', null);
    assert.equal(lookupTT(key, 5)?.score, 471);
    assert.equal(lookupTT(forgedCollision, 1), undefined);
    assert.equal(lookupTT(keyFor(new Chess(`${position} 99 1`), 'w'), 1)?.score, undefined);
  } finally {
    clearTranspositionTable();
  }
});

test('incremental key survives make/undo across castling, en passant and promotion', () => {
  const positions = [
    new Chess().fen(),
    `${position} 0 1`,
    'rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3',
    '6k1/4P3/8/8/8/K7/8/8 w - - 0 1',
  ];
  for (const fen of positions) {
    const game = new Chess(fen);
    const original = keyFor(game);
    const hash = game.hash();
    for (const move of generateMoves(game)) {
      makeMove(game, move);
      undoMove(game);
      assert.equal(game.hash(), hash, `hash restoration after ${move.from}${move.to} at ${fen}`);
      assert.deepEqual(keyFor(game), original, `key restoration after ${move.from}${move.to}`);
    }
  }
});

test('castling-right snapshots match existing FEN-based repetition handling', () => {
  const sequences = [
    { game: new Chess(), san: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6', 'O-O', 'Bc5', 'Re1'] },
    { game: new Chess(`${position} 0 1`), san: ['Rh2', 'Ra7'] },
    { game: new Chess('rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3'), san: ['exf6'] },
  ];
  for (const { game, san } of sequences) {
    let original = context();
    let incremental = context();
    for (const moveSan of san) {
      const beforeFen = game.fen();
      const rightsBefore = getCastlingRightsState(game);
      const move = game.move(moveSan);
      assert.ok(move, `move ${moveSan} must be legal`);
      const rightsAfter = getCastlingRightsState(game);
      const afterFen = game.fen();
      original = advanceRepetitionContext(original, move, beforeFen, afterFen);
      incremental = advanceRepetitionContextWithRights(incremental, move, rightsBefore, rightsAfter);
      assert.deepEqual(incremental, original, `repetition mismatch after ${moveSan} at ${beforeFen}`);
    }
  }
});

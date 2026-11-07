import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import {
  extractPositions, isQuietForKernel, positionKey, splitTrainValidation, type GameRecord,
} from '../../research/scripts/texel/dataset';
import { SearchPosition } from '../../src/utils/chess-ai/searchPosition';

const uciOf = (sans: string[]): string[] => {
  const game = new Chess();
  return sans.map((san) => { const m = game.move(san); return `${m.from}${m.to}${m.promotion ?? ''}`; });
};

test('positionKey ignores the move clocks but keeps side, castling and en passant', () => {
  assert.equal(positionKey('8/8/8/8/8/8/8/K6k w - - 3 40'), positionKey('8/8/8/8/8/8/8/K6k w - - 0 1'));
  assert.notEqual(positionKey('8/8/8/8/8/8/8/K6k w - - 0 1'), positionKey('8/8/8/8/8/8/8/K6k b - - 0 1'));
});

test('a quiet position: the static evaluation equals the capture search', () => {
  assert.equal(isQuietForKernel(new SearchPosition('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')), true);
  // White to move can take a hanging queen: not quiet.
  assert.equal(isQuietForKernel(new SearchPosition('4k3/8/8/3q4/4P3/8/8/4K3 w - - 0 1')), false);
});

test('extractPositions skips the first 8 moves, checks, loud and repeated positions', () => {
  // A short game with a check (Bb5+) after move 8 and a capture sequence.
  const sans = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3', 'Nf6', 'd3', 'd6', 'O-O', 'O-O', 'Nbd2', 'a6',
    'Bb3', 'Ba7', 'h3', 'h6', 'Re1', 'Re8', 'Nf1', 'Be6', 'Bxe6', 'Rxe6', 'Ng3', 'Qd7', 'Nh2', 'Ree8'];
  const moves = uciOf(sans);
  const game: GameRecord = { id: 0, openingPlies: 4, moves, result: 0.5, reason: 'test' };
  const positions = extractPositions(game);
  assert.ok(positions.length > 0);
  const keys = new Set<string>();
  for (const { fen, ply, result } of positions) {
    assert.ok(ply >= 16, `ply ${ply}`);
    assert.equal(result, 0.5);
    const position = new SearchPosition(fen);
    assert.equal(position.isInCheck(), false);
    assert.equal(isQuietForKernel(position), true);
    keys.add(positionKey(fen));
  }
  assert.equal(keys.size, positions.length);
  // After Bxe6 (ply 23) the recapture is pending: that position is not quiet.
  const replay = new Chess();
  for (const uci of moves.slice(0, 23)) replay.move({ from: uci.slice(0, 2), to: uci.slice(2, 4) });
  assert.ok(!positions.some((p) => positionKey(p.fen) === positionKey(replay.fen())));
});

test('extractPositions dedupes across games with a shared seen set', () => {
  const moves = uciOf(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3', 'Nf6', 'd3', 'd6', 'O-O', 'O-O', 'h3', 'h6', 'a3', 'a5', 'Re1', 'Re8']);
  const seen = new Set<string>();
  const first = extractPositions({ id: 0, openingPlies: 0, moves, result: 1, reason: 'test' }, seen);
  const second = extractPositions({ id: 1, openingPlies: 0, moves, result: 0, reason: 'test' }, seen);
  assert.ok(first.length > 0);
  assert.equal(second.length, 0);
});

test('splitTrainValidation splits by game, deterministically', () => {
  const ids = Array.from({ length: 1000 }, (_, i) => i);
  const a = ids.filter((id) => splitTrainValidation(id) === 'validation');
  const b = ids.filter((id) => splitTrainValidation(id) === 'validation');
  assert.deepEqual(a, b);
  assert.ok(a.length > 150 && a.length < 250, `${a.length}`);
});

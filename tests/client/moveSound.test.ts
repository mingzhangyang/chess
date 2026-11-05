import assert from 'node:assert/strict';
import test from 'node:test';
import { Chess } from 'chess.js';
import { getMoveSoundKind } from '../../src/utils/moveSound';

test('quiet moves, ordinary captures and en passant have their own cues', () => {
  const quiet = new Chess();
  const quietMove = quiet.move('e4');
  assert.equal(getMoveSoundKind(quiet, quietMove), 'move');

  const capture = new Chess();
  for (const san of ['e4', 'd5']) capture.move(san);
  const capturedMove = capture.move('exd5');
  assert.equal(capturedMove.captured, 'p');
  assert.equal(getMoveSoundKind(capture, capturedMove), 'capture');

  const enPassant = new Chess();
  for (const san of ['e4', 'a6', 'e5', 'd5']) enPassant.move(san);
  const enPassantMove = enPassant.move('exd6');
  assert.equal(enPassantMove.captured, 'p');
  assert.equal(getMoveSoundKind(enPassant, enPassantMove), 'capture');
});

test('check takes priority over capture, and checkmate takes priority over check', () => {
  const checked = new Chess('4k2r/8/8/8/8/8/8/4K2R w K - 0 1');
  const checkingCapture = checked.move({ from: 'h1', to: 'h8' });
  assert.equal(checked.isCheck(), true);
  assert.equal(checked.isGameOver(), false);
  assert.equal(checkingCapture.captured, 'r');
  assert.equal(getMoveSoundKind(checked, checkingCapture), 'check');

  const mate = new Chess();
  for (const san of ['f3', 'e5', 'g4']) mate.move(san);
  const winningMove = mate.move('Qh4#');
  assert.equal(mate.isCheckmate(), true);
  assert.equal(getMoveSoundKind(mate, winningMove), 'game-over');
});

test('drawn positions use the same terminal cue', () => {
  const stalemate = new Chess('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
  assert.equal(stalemate.isStalemate(), true);
  assert.equal(getMoveSoundKind(stalemate, null), 'game-over');
});

test('multiplayer recognizes threefold repetition from server history and optimistic moves', () => {
  const server = new Chess();
  const positions = [server.fen()];
  let lastMove = server.move('Nf3');
  positions.push(server.fen());
  for (const san of ['Nf6', 'Ng1', 'Ng8', 'Nf3', 'Nf6', 'Ng1', 'Ng8']) {
    lastMove = server.move(san);
    positions.push(server.fen());
  }
  const fenOnly = new Chess(server.fen());
  assert.equal(fenOnly.isThreefoldRepetition(), false);
  assert.equal(getMoveSoundKind(fenOnly, lastMove, positions), 'game-over');
  assert.equal(getMoveSoundKind(fenOnly, lastMove, positions.slice(0, -1)), 'game-over');
  assert.equal(getMoveSoundKind(new Chess(positions[4]), null, positions.slice(0, 5)), 'move');
});

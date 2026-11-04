import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Chess } from 'chess.js';
import { I18nProvider } from '../../src/i18n/I18nContext';
import { MoveHistory } from '../../src/components/MoveHistory';
import {
  groupMoveHistory,
  replayFenHistory,
  type FenReplayCache,
} from '../../src/utils/fenHistoryReplay';

function record(sans: readonly string[], startFen?: string): string[] {
  const game = startFen ? new Chess(startFen) : new Chess();
  const fens = [game.fen()];
  for (const san of sans) {
    game.move(san);
    fens.push(game.fen());
  }
  return fens;
}

test('replayFenHistory returns SAN for ordinary moves, castling, en passant, and promotion', () => {
  const ordinary = record(['e4', 'e5', 'Nf3', 'Nc6']);
  assert.deepEqual(replayFenHistory(ordinary).moves, ['e4', 'e5', 'Nf3', 'Nc6']);

  const castle = record(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O']);
  assert.deepEqual(replayFenHistory(castle).moves.at(-1), 'O-O');

  const enPassant = record(['e4', 'a6', 'e5', 'd5', 'exd6']);
  assert.deepEqual(replayFenHistory(enPassant).moves.at(-1), 'exd6');

  const promotionFen = '4k3/P7/8/8/8/8/8/4K3 w - - 0 1';
  const promotionGame = new Chess(promotionFen);
  promotionGame.move('a8=Q');
  assert.deepEqual(replayFenHistory([promotionFen, promotionGame.fen()]).moves, promotionGame.history());
});

test('replayFenHistory derives the first move number and side from the earliest retained FEN', () => {
  const warmup = new Chess();
  warmup.move('e4');
  const blackToMove = record(['e5', 'Nf3'], warmup.fen());
  const blackReplay = replayFenHistory(blackToMove);
  assert.equal(blackReplay.startsWithBlack, true);
  assert.equal(blackReplay.firstMoveNumber, 1);
  assert.deepEqual(blackReplay.moves, ['e5', 'Nf3']);
  assert.deepEqual(groupMoveHistory(blackReplay.moves, blackReplay.firstMoveNumber, blackReplay.startsWithBlack), [
    { moveNumber: 1, white: null, black: 'e5' },
    { moveNumber: 2, white: 'Nf3', black: null },
  ]);

  const late = new Chess('4k3/8/8/8/8/8/8/4K3 b - - 0 40');
  const lateFen = late.fen();
  late.move('Ke7');
  const lateReplay = replayFenHistory([lateFen, late.fen()]);
  assert.equal(lateReplay.startsWithBlack, true);
  assert.equal(lateReplay.firstMoveNumber, 40);
  assert.deepEqual(lateReplay.moves, ['Ke7']);
  assert.deepEqual(groupMoveHistory(lateReplay.moves, lateReplay.firstMoveNumber, true), [
    { moveNumber: 40, white: null, black: 'Ke7' },
  ]);
});

test('replayFenHistory reuses a cached prefix for extensions, undo, reset, and truncation', () => {
  const cache: FenReplayCache = { fens: [], moves: [] };
  const opening = record(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5']);
  assert.deepEqual(replayFenHistory(opening.slice(0, 3), cache).moves, ['e4', 'e5']);
  assert.deepEqual(replayFenHistory(opening, cache).moves, ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5']);
  assert.deepEqual(replayFenHistory(opening.slice(0, 4), cache).moves, ['e4', 'e5', 'Nf3']);

  assert.deepEqual(replayFenHistory([opening[0]], cache).moves, []);

  const truncated = opening.slice(2);
  const truncatedReplay = replayFenHistory(truncated, cache);
  assert.deepEqual(truncatedReplay.moves, ['Nf3', 'Nc6', 'Bb5']);
  assert.equal(truncatedReplay.startsWithBlack, false);
  assert.equal(truncatedReplay.firstMoveNumber, 2);
});

test('replayFenHistory keeps the reconstructed prefix when a later FEN does not match', () => {
  const opening = record(['e4', 'e5']);
  const broken = [...opening, '8/8/8/8/8/8/8/8 w - - 0 1'];
  assert.deepEqual(replayFenHistory(broken).moves, ['e4', 'e5']);
});

test('groupMoveHistory numbers a game that starts with White at move 1', () => {
  assert.deepEqual(groupMoveHistory(['e4', 'e5', 'Nf3'], 1, false), [
    { moveNumber: 1, white: 'e4', black: 'e5' },
    { moveNumber: 2, white: 'Nf3', black: null },
  ]);
});

test('MoveHistory renders retained-FEN numbering and a keyboard-focusable log', () => {
  const html = renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(MoveHistory, {
        moves: ['Ke7', 'Ke2'],
        firstMoveNumber: 40,
        startsWithBlack: true,
      }),
    ),
  );

  assert.match(html, /role="log"/);
  assert.match(html, /tabindex="0"/);
  assert.match(html, /40\./);
  assert.match(html, /…/);
  assert.match(html, />Ke7</);
  assert.match(html, /41\./);
  assert.match(html, />Ke2</);
  assert.doesNotMatch(html, /No moves yet/);
});

test('FEN replay handles both castling sides and underpromotion', () => {
  const queenside = record(['d4', 'd5', 'Nc3', 'Nf6', 'Bf4', 'e6', 'Qd2', 'Be7', 'O-O-O']);
  assert.equal(replayFenHistory(queenside).moves.at(-1), 'O-O-O');
  const underpromotion = record(['a8=N'], '4k3/P7/8/8/8/8/8/4K3 w - - 0 1');
  assert.deepEqual(replayFenHistory(underpromotion).moves, ['a8=N']);
});

test('FEN replay retains valid prefix when a target has wrong metadata', () => {
  const history = record(['e4', 'e5']);
  const mismatch = history[2].replace(/ 0 2$/, ' 5 2');
  assert.deepEqual(replayFenHistory([...history, mismatch]).moves, ['e4', 'e5']);
});

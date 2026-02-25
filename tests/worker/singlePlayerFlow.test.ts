import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { getBestMove } from '../../src/utils/chessAI';
import { cloneGameWithHistory } from '../../src/utils/cloneGameWithHistory';

test('single-player undo reverts both player and AI moves', () => {
  const startGame = new Chess();
  const startFen = startGame.fen();

  const playerTurnGame = cloneGameWithHistory(startGame);
  const playerMove = playerTurnGame.move('e4');
  assert.ok(playerMove, 'expected player move to be legal');
  assert.equal(playerTurnGame.history().length, 1);

  const aiMoveSan = getBestMove(playerTurnGame, 'hard');
  assert.ok(aiMoveSan, 'expected AI to find a move');

  const withAiResponse = cloneGameWithHistory(playerTurnGame);
  const aiMove = withAiResponse.move(aiMoveSan as string);
  assert.ok(aiMove, 'expected AI move to be legal');
  assert.equal(withAiResponse.history().length, 2);

  const undoGame = cloneGameWithHistory(withAiResponse);
  const undoAi = undoGame.undo();
  const undoPlayer = undoGame.undo();
  assert.ok(undoAi, 'expected first undo to revert AI move');
  assert.ok(undoPlayer, 'expected second undo to revert player move');
  assert.equal(undoGame.fen(), startFen);
  assert.equal(undoGame.history().length, 0);
});

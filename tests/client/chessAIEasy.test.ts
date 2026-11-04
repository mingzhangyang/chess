import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { generateMoves, type AiMove } from '../../src/utils/chess-ai/chessAIBoardOps';
import {
  EASY_MAX_IMMEDIATE_LOSS,
  scoreEasyMoveSafety,
} from '../../src/utils/chess-ai/chessAIEasy';
import { getBestMove } from '../../src/utils/chessAI';

const findMove = (game: Chess, from: string, to: string): AiMove => {
  const move = generateMoves(game).find((candidate) => candidate.from === from && candidate.to === to);
  assert.ok(move, `expected a legal move ${from}-${to} in ${game.fen()}`);
  return move;
};

test('Easy rejects walking a queen into an immediate pawn capture, regardless of RNG', () => {
  const fen = '7k/8/8/3p4/8/8/8/K3Q3 w - - 0 1';
  const game = new Chess(fen);
  const badMove = findMove(game, 'e1', 'e4');
  assert.ok(scoreEasyMoveSafety(game, badMove) <= -800);
  assert.equal(game.fen(), fen, 'safety analysis must restore the board');

  const originalRandom = Math.random;
  try {
    for (let i = 0; i < 12; i += 1) {
      Math.random = () => i / 12;
      const position = new Chess(fen);
      const move = getBestMove(position, 'easy');
      assert.ok(move);
      assert.equal(position.fen(), fen, 'Easy move selection must not play a move on the game');
      position.move(move);
      assert.equal(
        position.moves({ verbose: true }).some((reply) => reply.captured === 'q'),
        false,
        `Easy left its queen available for an immediate capture after ${move}`,
      );
    }
  } finally {
    Math.random = originalRandom;
  }
});

test('Easy rejects queen-for-knight bait even if the queen itself captures', () => {
  const fen = 'rnbqkb1r/ppp2ppp/5n2/8/3N4/4P3/PPP2PPP/RNBQKB1R b KQkq - 0 5';
  const game = new Chess(fen);
  const badMove = findMove(game, 'd8', 'd4');
  assert.ok(scoreEasyMoveSafety(game, badMove) < -EASY_MAX_IMMEDIATE_LOSS);
  assert.equal(game.fen(), fen);
  const originalRandom = Math.random;
  try {
    for (const value of [0, 0.2, 0.5, 0.8, 0.999]) {
      Math.random = () => value;
      assert.notEqual(getBestMove(game, 'easy'), 'Qxd4');
      assert.equal(game.fen(), fen);
    }
  } finally {
    Math.random = originalRandom;
  }
});

test('Easy permits an even queen trade instead of banning threatened queens outright', () => {
  // Qxd4 cxd4 exchanges queens rather than hanging one for a pawn.
  const game = new Chess('7k/8/8/2p5/3q4/8/3Q4/4K3 w - - 0 1');
  const originalFen = game.fen();
  assert.equal(scoreEasyMoveSafety(game, findMove(game, 'd2', 'd4')), 0);
  assert.equal(game.fen(), originalFen);
});

test('Easy credits legal recaptures, but does not assume a queen is defended', () => {
  // After Kf1, ...Qxd2 Rxd2 is a fair exchange.
  const guarded = new Chess('7k/8/8/8/3q4/8/3Q4/3RK3 w - - 0 1');
  assert.equal(scoreEasyMoveSafety(guarded, findMove(guarded, 'e1', 'f1')), 0);

  // Without the rook, the same move allows ...Qxd2 with no reply.
  const undefended = new Chess('7k/8/8/8/3q4/8/3Q4/4K3 w - - 0 1');
  assert.equal(scoreEasyMoveSafety(undefended, findMove(undefended, 'e1', 'f1')), -900);
});

test('Easy ignores geometrical attacks when the attacker is pinned', () => {
  // Black e7 pawn appears to attack d6, but capturing Qd6 would expose
  // the black king on e8 to the white rook on e1 and is illegal.
  const game = new Chess('4k3/4p3/8/8/8/8/8/3QR2K w - - 0 1');
  const originalFen = game.fen();
  assert.equal(scoreEasyMoveSafety(game, findMove(game, 'd1', 'd6')), 0);
  assert.equal(game.fen(), originalFen);
});

test('Easy still produces different legal opening moves for different RNG values', () => {
  const originalRandom = Math.random;
  try {
    const picks = new Set<string>();
    for (const value of [0, 0.25, 0.5, 0.75, 0.999]) {
      Math.random = () => value;
      const game = new Chess();
      const move = getBestMove(game, 'easy');
      assert.ok(move);
      assert.doesNotThrow(() => game.move(move));
      picks.add(move);
    }
    assert.ok(picks.size >= 3, `expected varied Easy moves, got ${[...picks].join(', ')}`);
  } finally {
    Math.random = originalRandom;
  }
});

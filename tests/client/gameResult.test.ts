import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { describeGameResult, formatGameResult } from '../../src/utils/gameResult';
import { translate } from '../../src/i18n/translations';
import { appendFenHistory } from '../../src/utils/fenHistoryReplay';

const FOOLS_MATE = ['f3', 'e5', 'g4', 'Qh4#'];

function play(moves: string[]): Chess {
  const game = new Chess();
  for (const move of moves) game.move(move);
  return game;
}

test('describeGameResult returns null while the game is still in progress', () => {
  assert.equal(describeGameResult(new Chess(), 'w'), null);
  assert.equal(describeGameResult(new Chess('4k3/8/8/8/8/8/4r3/4K3 w - - 0 1'), 'w'), null);
});

test('checkmate is reported from the viewer perspective', () => {
  const game = play(FOOLS_MATE);
  assert.deepEqual(describeGameResult(game, 'b'), { outcome: 'win', reason: 'checkmate', winner: 'b' });
  assert.deepEqual(describeGameResult(game, 'w'), { outcome: 'loss', reason: 'checkmate', winner: 'b' });
  assert.deepEqual(describeGameResult(game, null), { outcome: 'decisive', reason: 'checkmate', winner: 'b' });
});

test('each draw rule is reported with its own reason', () => {
  const stalemate = new Chess('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
  assert.deepEqual(describeGameResult(stalemate, 'w'), { outcome: 'draw', reason: 'stalemate', winner: null });

  const insufficient = new Chess('4k3/8/8/8/8/8/8/4K3 w - - 0 1');
  assert.equal(describeGameResult(insufficient, 'w')?.reason, 'insufficient');

  const fiftyMove = new Chess('4k3/8/8/8/8/8/R7/4K3 w - - 100 80');
  assert.equal(describeGameResult(fiftyMove, 'b')?.reason, 'fiftyMove');

  const threefold = play(['Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3', 'Nf6', 'Ng1', 'Ng8']);
  assert.deepEqual(describeGameResult(threefold, null), { outcome: 'draw', reason: 'threefold', winner: null });
});

test('formatGameResult produces perspective-aware titles and reason subtitles', () => {
  const t = (key: string, params?: Record<string, string | number>) => translate('en', key, params);
  const game = play(FOOLS_MATE);

  assert.deepEqual(formatGameResult(describeGameResult(game, 'b'), t), { title: 'You won!', subtitle: 'Checkmate' });
  assert.deepEqual(formatGameResult(describeGameResult(game, 'w'), t), { title: 'You lost', subtitle: 'Checkmate' });
  assert.deepEqual(formatGameResult(describeGameResult(game, null), t), { title: 'Black wins', subtitle: 'Checkmate' });

  const stalemate = new Chess('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
  assert.deepEqual(formatGameResult(describeGameResult(stalemate, 'w'), t), { title: 'Draw', subtitle: 'Stalemate' });
  assert.deepEqual(formatGameResult(null, t), { title: '', subtitle: '' });
});

test('result titles and reasons are translated in every supported language', () => {
  const keys = [
    'result.youWon', 'result.youLost', 'result.draw', 'result.sideWins',
    'result.reason.checkmate', 'result.reason.stalemate', 'result.reason.threefold',
    'result.reason.insufficient', 'result.reason.fiftyMove', 'result.reason.draw',
  ];
  for (const language of ['en', 'zh', 'fr', 'es', 'ja'] as const) {
    for (const key of keys) {
      const value = translate(language, key, { winner: 'X' });
      assert.notEqual(value, key, `${language} missing ${key}`);
      if (language !== 'en') {
        assert.notEqual(value, translate('en', key, { winner: 'X' }), `${language} falls back to english for ${key}`);
      }
    }
    assert.match(translate(language, 'result.sideWins', { winner: 'X' }), /X/);
  }
});

// Multiplayer clients hold a FEN-only game (no move history) plus the
// server's authoritative FEN history, appended one broadcast at a time.
function multiplayerState(moves: string[]): { game: Chess; fenHistory: string[] } {
  const server = new Chess();
  let fenHistory = [server.fen()];
  for (const move of moves) {
    const previousFen = server.fen();
    server.move(move);
    fenHistory = appendFenHistory(fenHistory, previousFen, server.fen());
  }
  const game = new Chess();
  game.load(server.fen());
  return { game, fenHistory };
}

const KNIGHT_SHUFFLE = ['Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3', 'Nf6', 'Ng1', 'Ng8'];

test('multiplayer detects threefold repetition from the synchronized FEN history', () => {
  const { game, fenHistory } = multiplayerState(KNIGHT_SHUFFLE);
  assert.equal(game.isThreefoldRepetition(), false, 'a FEN-only game has no repetition history');

  const expected = { outcome: 'draw', reason: 'threefold', winner: null };
  assert.deepEqual(describeGameResult(game, 'w', fenHistory), expected);
  assert.deepEqual(describeGameResult(game, 'b', fenHistory), expected);
  assert.deepEqual(describeGameResult(game, null, fenHistory), expected);

  const twice = multiplayerState(KNIGHT_SHUFFLE.slice(0, 4));
  assert.equal(describeGameResult(twice.game, 'w', twice.fenHistory), null);
});

test('an optimistic local move counts before the server echoes it into the history', () => {
  const { fenHistory } = multiplayerState(KNIGHT_SHUFFLE.slice(0, 7));
  const optimistic = new Chess();
  optimistic.load(fenHistory.at(-1)!);
  optimistic.move('Ng8');
  assert.notEqual(fenHistory.at(-1), optimistic.fen());
  assert.equal(describeGameResult(optimistic, 'b', fenHistory)?.reason, 'threefold');
});

test('positions only repeat when side to move, castling and en passant rights match', () => {
  // Same placement three times, but castling rights were lost after the first.
  const { game, fenHistory } = multiplayerState([
    'e4', 'e5', 'Ke2', 'Ke7', 'Ke1', 'Ke8', 'Ke2', 'Ke7', 'Ke1', 'Ke8',
  ]);
  assert.equal(describeGameResult(game, 'w', fenHistory), null);
});

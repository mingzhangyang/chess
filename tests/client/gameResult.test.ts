import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { describeGameResult, formatGameResult } from '../../src/utils/gameResult';
import { translate } from '../../src/i18n/translations';

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

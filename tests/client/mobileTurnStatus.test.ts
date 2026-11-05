import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '../../src/i18n/I18nContext';
import { MobileTurnStatus } from '../../src/components/MobileTurnStatus';
import { translate } from '../../src/i18n/translations';

function render(props: React.ComponentProps<typeof MobileTurnStatus>): string {
  return renderToStaticMarkup(
    React.createElement(I18nProvider, null, React.createElement(MobileTurnStatus, props)),
  );
}

test('MobileTurnStatus announces a localized side-to-move label during play', () => {
  const html = render({ status: 'Check!', color: 'b' });
  assert.match(html, /<span class="sr-only">Black to move<\/span>/);
  const white = render({ status: 'Spectating', color: 'w' });
  assert.match(white, /<span class="sr-only">White to move<\/span>/);
});

test('MobileTurnStatus omits the side-to-move label once the game is over', () => {
  const html = render({ status: 'Checkmate! White wins.', color: 'b', gameOver: true });
  assert.doesNotMatch(html, /to move/);
  assert.doesNotMatch(html, /sr-only/);
});

test('side-to-move label is translated in every locale', () => {
  const expected = {
    en: 'White to move',
    zh: '轮到白方走棋',
    fr: 'Aux Blancs de jouer',
    es: 'Juegan las Blancas',
    ja: '白の手番',
  } as const;
  for (const [language, label] of Object.entries(expected)) {
    const side = translate(language as keyof typeof expected, 'common.white');
    assert.equal(translate(language as keyof typeof expected, 'common.sideToMove', { side }), label);
  }
  const source = readFileSync(path.resolve(process.cwd(), 'src/components/MobileTurnStatus.tsx'), 'utf8');
  assert.doesNotMatch(source, /\} to move</);
});

test('room layouts pass game-over state to the mobile turn status', () => {
  for (const file of ['src/components/SinglePlayerRoom.tsx', 'src/components/GameRoom.tsx']) {
    const source = readFileSync(path.resolve(process.cwd(), file), 'utf8');
    // Multiplayer also counts history-only endings (threefold repetition).
    assert.match(source, /<MobileTurnStatus[\s\S]*?gameOver=\{(game\.isGameOver\(\)|isGameFinished)\}/);
  }
});

test('short touch-landscape rule targets class names used by both board wrappers', () => {
  const css = readFileSync(path.resolve(process.cwd(), 'src/index.css'), 'utf8');
  assert.match(css, /\.portrait-app-content \.landscape-scroll-board \{ height: 100dvh; min-height: 20rem; flex: none; \}/);
  for (const file of ['src/components/SinglePlayerRoom.tsx', 'src/components/game-room/BoardPanel.tsx']) {
    const source = readFileSync(path.resolve(process.cwd(), file), 'utf8');
    assert.match(source, /className="landscape-scroll-board enter-fade/);
  }
});

test('MobileTurnStatus shows an indeterminate thinking cue without changing idle status', () => {
  const html = render({ status: 'Computer is thinking...', color: 'b', thinking: true });
  assert.equal(html.match(/class="ai-thinking-dot"/g)?.length, 3);
  assert.match(html, /class="ai-thinking-cue(?:\s[^"]*)?"/);
  assert.match(html, /class="ai-thinking-track"/);
  assert.match(html, /min-w-0 flex-1 text-sm font-semibold[^"]* truncate/);
  assert.doesNotMatch(html, /--ai-think-budget/);
  const idle = render({ status: 'Your turn', color: 'w' });
  assert.doesNotMatch(idle, /ai-thinking|truncate/);
});

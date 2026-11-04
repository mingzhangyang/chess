import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '../../src/i18n/I18nContext';
import { MediaPanel } from '../../src/components/game-room/MediaPanel';

function renderPanel(overrides: Partial<React.ComponentProps<typeof MediaPanel>>): string {
  const noop = () => {};
  const props: React.ComponentProps<typeof MediaPanel> = {
    remoteStream: null,
    remoteVideoRef: { current: null },
    localVideoRef: { current: null },
    opponentName: 'Bob',
    userName: 'Alice',
    mobilePrimaryView: 'self',
    canEnableMedia: true,
    isMediaEnabled: false,
    isMicOn: true,
    isVideoOn: true,
    onTogglePrimaryView: noop,
    onToggleMic: noop,
    onToggleVideo: noop,
    onEnableMedia: noop,
    ...overrides,
  };
  return renderToStaticMarkup(React.createElement(I18nProvider, null, React.createElement(MediaPanel, props)));
}

const count = (html: string, needle: string) => html.split(needle).length - 1;

test('self preview hides corner media toggles while the enable-media prompt is shown', () => {
  const html = renderPanel({ isMediaEnabled: false, canEnableMedia: true });
  assert.match(html, /Enable/i);
  // Only the opponent tile (mobile-only) keeps its toggles; none overlap the prompt.
  assert.equal(count(html, 'aria-label="Mute microphone"'), 1);
  assert.equal(count(html, 'aria-label="Turn camera off"'), 1);
  assert.equal(count(html, 'You (Alice)'), 1, 'only the mobile header names the self view');
});

test('self preview shows corner media toggles once media is enabled', () => {
  const html = renderPanel({ isMediaEnabled: true });
  assert.equal(count(html, 'aria-label="Mute microphone"'), 2);
  assert.equal(count(html, 'aria-label="Turn camera off"'), 2);
  assert.equal(count(html, 'You (Alice)'), 2);
});

test('enable-media prompt is compact enough for the capped mobile preview', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'src/components/game-room/MediaPanel.tsx'), 'utf8');
  assert.match(source, /absolute inset-0 flex flex-col items-center justify-center gap-1\.5 bg-slate-950\/90 p-2 text-center text-xs[^"]*md:gap-3 md:p-4 md:text-sm/);
});

test('landscape board sizing stays flexible in the md row layout', () => {
  const css = readFileSync(path.resolve(process.cwd(), 'src/index.css'), 'utf8');
  assert.match(
    css,
    /@media \(orientation: landscape\) and \(max-height: 500px\) and \(pointer: coarse\) and \(min-width: 768px\) \{\s*\.portrait-app-content \.landscape-scroll-board \{ flex: 1 1 0%; min-width: 0; \}\s*\}/,
  );
});

test('every button-* style class used by components is defined in index.css', () => {
  const css = readFileSync(path.resolve(process.cwd(), 'src/index.css'), 'utf8');
  const defined = new Set([...css.matchAll(/\.(button-[a-z-]+)\s*[{,:]/g)].map((m) => m[1]));
  const files = ['src/components/game-room/MediaPanel.tsx', 'src/components/GameRoom.tsx', 'src/components/SinglePlayerRoom.tsx', 'src/components/Lobby.tsx', 'src/components/game-room/ChatPanel.tsx'];
  for (const file of files) {
    const source = readFileSync(path.resolve(process.cwd(), file), 'utf8');
    for (const [, cls] of source.matchAll(/(?:^|[\s"'`])(button-[a-z-]+)(?=[\s"'`])/g)) {
      assert.ok(defined.has(cls), `${file} uses undefined class ${cls}`);
    }
  }
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MessageCircle, Menu, Undo2 } from 'lucide-react';
import { I18nProvider } from '../../src/i18n/I18nContext';
import { MobileQuickActionBar, type MobileQuickAction } from '../../src/components/MobileQuickActionBar';
import { translate } from '../../src/i18n/translations';

const actions: [MobileQuickAction, MobileQuickAction, MobileQuickAction] = [
  { key: 'undo', icon: Undo2, label: 'Undo', ariaLabel: 'Undo move', onClick: () => {}, disabled: true },
  { key: 'chat', icon: MessageCircle, label: 'Chat', onClick: () => {} },
  { key: 'menu', icon: Menu, label: 'Menu', onClick: () => {} },
];

test('mobile quick action bar renders three accessible, touch-sized controls', () => {
  const html = renderToStaticMarkup(React.createElement(
    I18nProvider,
    null,
    React.createElement(MobileQuickActionBar, { actions }),
  ));
  assert.match(html, /<nav[^>]*aria-label="Game actions"[^>]*md:hidden/);
  assert.equal((html.match(/<button\b/g) ?? []).length, 3);
  assert.match(html, /aria-label="Undo move"[^>]*disabled=""/);
  assert.match(html, /aria-label="Chat"/);
  assert.match(html, /aria-label="Menu"/);
  assert.match(html, /min-h-12/);
  assert.match(html, /safe-area-inset-bottom/);
});

test('accessible names include visible labels when custom names differ', () => {
  const overrides: [MobileQuickAction, MobileQuickAction, MobileQuickAction] = [
    { key: 'menu', icon: Menu, label: 'Menu', ariaLabel: 'Show Controls', onClick: () => {} },
    { key: 'undo', icon: Undo2, label: 'Annuler', ariaLabel: 'Demander une annulation', onClick: () => {} },
    { key: 'chat', icon: MessageCircle, label: 'Chat', ariaLabel: 'Open chat', onClick: () => {} },
  ];
  const html = renderToStaticMarkup(React.createElement(
    I18nProvider,
    null,
    React.createElement(MobileQuickActionBar, { actions: overrides }),
  ));
  const buttons = html.match(/<button\\b[^>]*>[\\s\\S]*?<\\/button>/g) ?? [];
  assert.equal(buttons.length, 3);
  assert.match(buttons[0], /aria-label="Menu — Show Controls"/);
  assert.match(buttons[0], />Menu<\\/span>/);
  assert.match(buttons[1], /aria-label="Annuler — Demander une annulation"/);
  assert.match(buttons[1], />Annuler<\\/span>/);
  // "Open chat" already contains the visible "Chat" (case insensitive).
  assert.match(buttons[2], /aria-label="Open chat"/);
  assert.doesNotMatch(buttons[2], /Chat — Open chat/);
});

test('first-stage quick actions keep the AI hint feature out of scope', () => {
  const single = readFileSync(path.resolve(process.cwd(), 'src/components/SinglePlayerRoom.tsx'), 'utf8');
  const multi = readFileSync(path.resolve(process.cwd(), 'src/components/GameRoom.tsx'), 'utf8');
  const bar = readFileSync(path.resolve(process.cwd(), 'src/components/MobileQuickActionBar.tsx'), 'utf8');
  assert.match(single, /key: 'restart'[\s\S]*?onClick: confirmResetGame/);
  assert.match(single, /game\.history\(\)\.length > 0 && !window\.confirm/);
  assert.match(multi, /key: 'undo'[\s\S]*?ariaLabel: t\('game\.requestUndo'\)[\s\S]*?onClick: requestUndo/);
  assert.match(multi, /!isAnyMobileDrawerOpen && \(/);
  assert.doesNotMatch(single + multi + bar, /key: 'hint'/);
  assert.doesNotMatch(single + multi + bar, /fixed bottom-4 (right|left)-4 z-50/);
});

test('quick action labels and reset confirmation are localized in all five languages', () => {
  for (const locale of ['en', 'zh', 'fr', 'es', 'ja'] as const) {
    for (const key of ['common.mobileActions', 'common.menu', 'common.chat', 'game.requestUndo', 'single.confirmReset']) {
      assert.notEqual(translate(locale, key), key, locale + ': ' + key);
    }
  }
});

test('quick action bar fits the existing board clearance without increasing board padding', () => {
  const bar = readFileSync(path.resolve(process.cwd(), 'src/components/MobileQuickActionBar.tsx'), 'utf8');
  for (const p of ['src/components/SinglePlayerRoom.tsx', 'src/components/game-room/BoardPanel.tsx']) {
    const source = readFileSync(path.resolve(process.cwd(), p), 'utf8');
    assert.match(source, /pb-\[calc\(4\.5rem\+env\(safe-area-inset-bottom\)\)\]/);
  }
  assert.match(bar, /min-h-12/);
  assert.match(bar, /pt-2 pb-\[calc\(0\.5rem\+env\(safe-area-inset-bottom\)\)\]/);
});

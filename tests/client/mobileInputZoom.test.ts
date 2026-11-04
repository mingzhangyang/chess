import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const read = (file: string) => readFileSync(path.resolve(process.cwd(), file), 'utf8');

test('text inputs use at least 16px on touch devices so mobile browsers do not zoom on focus', () => {
  const css = read('src/index.css');
  const rule = css.match(/@media \(pointer: coarse\) \{\s*(input[^{]*textarea[^{]*select[^{]*)\{\s*font-size: max\(16px, 1em\);\s*\}\s*\}/);
  assert.ok(rule, 'expected a coarse-pointer rule forcing 16px form controls');
  assert.match(rule[1], /input:not\(\[type='range'\]\)/);
});

test('chat input is not shrunk below 16px on phones', () => {
  const chat = read('src/components/game-room/ChatPanel.tsx');
  const input = chat.match(/id="chat-message-input"[\s\S]*?className="([^"]+)"/);
  assert.ok(input);
  assert.doesNotMatch(input[1], /(^|\s)text-xs(\s|$)/);
  assert.match(input[1], /(^|\s)text-base(\s|$)/);
});

test('viewport keeps pinch-zoom available for accessibility', () => {
  for (const file of ['index.html', 'zh/index.html', 'fr/index.html', 'es/index.html', 'ja/index.html']) {
    const html = read(file);
    assert.doesNotMatch(html, /maximum-scale|user-scalable=no/);
  }
});

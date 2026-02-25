import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const gameRoomPath = path.resolve(process.cwd(), 'src/components/GameRoom.tsx');
const lobbyPath = path.resolve(process.cwd(), 'src/components/Lobby.tsx');
const singlePlayerPath = path.resolve(process.cwd(), 'src/components/SinglePlayerRoom.tsx');

test('chat send button exposes an accessible label', () => {
  const source = readFileSync(gameRoomPath, 'utf8');
  assert.match(source, /type="submit"[\s\S]*?aria-label="Send message"/);
});

test('mic and camera toggles expose labels, pressed state, and touch targets', () => {
  const source = readFileSync(gameRoomPath, 'utf8');

  assert.match(source, /onClick=\{onToggleMic\}[\s\S]*?aria-label=\{(?:isMicOn \? 'Mute microphone' : 'Unmute microphone'|micToggleLabel)\}[\s\S]*?aria-pressed=\{isMicOn\}/);
  assert.match(source, /onClick=\{onToggleVideo\}[\s\S]*?aria-label=\{(?:isVideoOn \? 'Turn camera off' : 'Turn camera on'|videoToggleLabel)\}[\s\S]*?aria-pressed=\{isVideoOn\}/);

  const touchTargetMatches = source.match(/min-h-11 min-w-11/g) ?? [];
  assert.ok(touchTargetMatches.length >= 4);
});

test('mode switch buttons expose pressed state semantics', () => {
  const source = readFileSync(lobbyPath, 'utf8');
  assert.match(source, /onClick=\{\(\) => setMode\('multi'\)\}[\s\S]*?aria-pressed=\{mode === 'multi'\}/);
  assert.match(source, /onClick=\{\(\) => setMode\('single'\)\}[\s\S]*?aria-pressed=\{mode === 'single'\}/);
});

test('game room avoids extra-small text classes', () => {
  const source = readFileSync(gameRoomPath, 'utf8');
  assert.doesNotMatch(source, /text-\[(?:9|10|11)px\]/);
});

test('control sidebars use responsive widths instead of fixed md width', () => {
  const gameRoomSource = readFileSync(gameRoomPath, 'utf8');
  const singlePlayerSource = readFileSync(singlePlayerPath, 'utf8');

  assert.match(gameRoomSource, /md:w-\[19rem\][\s\S]*?lg:w-\[21rem\][\s\S]*?xl:w-\[22rem\]/);
  assert.match(singlePlayerSource, /md:w-\[19rem\][\s\S]*?lg:w-\[21rem\][\s\S]*?xl:w-\[22rem\]/);
  assert.doesNotMatch(gameRoomSource, /md:w-\[22rem\]/);
  assert.doesNotMatch(singlePlayerSource, /md:w-\[22rem\]/);
});

test('lobby form labels use theme tokens instead of fixed slate colors', () => {
  const source = readFileSync(lobbyPath, 'utf8');
  assert.doesNotMatch(source, /text-slate-700|dark:text-slate-300/);
  assert.match(source, /text-\[var\(--text-primary\)\]/);
});

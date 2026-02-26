import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const gameRoomPath = path.resolve(process.cwd(), 'src/components/GameRoom.tsx');
const lobbyPath = path.resolve(process.cwd(), 'src/components/Lobby.tsx');
const singlePlayerPath = path.resolve(process.cwd(), 'src/components/SinglePlayerRoom.tsx');
const appPath = path.resolve(process.cwd(), 'src/App.tsx');

test('chat send button exposes an accessible label', () => {
  const source = readFileSync(gameRoomPath, 'utf8');
  assert.match(source, /type="submit"[\s\S]*?aria-label=\{t\('game\.chat\.sendAria'\)\}/);
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

test('language switcher is rendered inside lobby footer beside privacy link', () => {
  const appSource = readFileSync(appPath, 'utf8');
  const lobbySource = readFileSync(lobbyPath, 'utf8');

  assert.doesNotMatch(appSource, /id="language-switcher"/);
  assert.match(
    lobbySource,
    /<div className="[^"]*items-center[^"]*gap-[^"]*"[\s\S]*?href=\{PRIVACY_PATHS\[language\]\}[\s\S]*?id="language-switcher"[\s\S]*?<\/div>/,
  );
});

test('single-player tuning sliders expose accessible labels', () => {
  const source = readFileSync(singlePlayerPath, 'utf8');
  assert.match(source, /htmlFor="opening-variety"/);
  assert.match(source, /id="opening-variety"[\s\S]*?type="range"[\s\S]*?aria-label=\{t\('single\.openingVarietyAria'\)\}/);
  assert.match(source, /htmlFor="anti-shuffle"/);
  assert.match(source, /id="anti-shuffle"[\s\S]*?type="range"[\s\S]*?aria-label=\{t\('single\.antiShuffleAria'\)\}/);
});

test('single-player tuning values persist via localStorage', () => {
  const source = readFileSync(singlePlayerPath, 'utf8');
  assert.match(source, /const OPENING_VARIETY_STORAGE_KEY = 'single-player-opening-variety'/);
  assert.match(source, /const ANTI_SHUFFLE_STORAGE_KEY = 'single-player-anti-shuffle'/);
  assert.match(source, /localStorage\.getItem\(storageKey\)/);
  assert.match(source, /localStorage\.setItem\(OPENING_VARIETY_STORAGE_KEY,/);
  assert.match(source, /localStorage\.setItem\(ANTI_SHUFFLE_STORAGE_KEY,/);
});

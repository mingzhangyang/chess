import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const gameRoomPath = path.resolve(process.cwd(), 'src/components/GameRoom.tsx');
const gameRoomBoardPanelPath = path.resolve(process.cwd(), 'src/components/game-room/BoardPanel.tsx');
const gameRoomRealtimeHookPath = path.resolve(process.cwd(), 'src/components/game-room/hooks/useGameRoomRealtime.ts');
const gameRoomChatPanelPath = path.resolve(process.cwd(), 'src/components/game-room/ChatPanel.tsx');
const gameRoomMediaPanelPath = path.resolve(process.cwd(), 'src/components/game-room/MediaPanel.tsx');
const lobbyPath = path.resolve(process.cwd(), 'src/components/Lobby.tsx');
const singlePlayerPath = path.resolve(process.cwd(), 'src/components/SinglePlayerRoom.tsx');
const appPath = path.resolve(process.cwd(), 'src/App.tsx');

test('chat send button exposes an accessible label', () => {
  const source = readFileSync(gameRoomChatPanelPath, 'utf8');
  assert.match(source, /import\s+\{[^}]*Send[^}]*\}\s+from\s+'lucide-react'/);
  assert.match(source, /type="submit"[\s\S]*?aria-label=\{t\('game\.chat\.sendAria'\)\}/);
});

test('mic and camera toggles expose labels, pressed state, and touch targets', () => {
  const source = readFileSync(gameRoomMediaPanelPath, 'utf8');

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

test('single-player mobile controls use bottom settings button and drawer panel', () => {
  const source = readFileSync(singlePlayerPath, 'utf8');
  assert.match(source, /import\s+\{[^}]*Settings2[^}]*\}\s+from\s+'lucide-react'/);
  assert.match(source, /fixed bottom-4 right-4 z-50[^"]*md:hidden/);
  assert.match(source, /<Settings2 className="w-6 h-6" \/>/);
  assert.match(source, /fixed inset-x-0 bottom-0 z-40[^"]*max-h-\[78dvh\][^"]*overflow-y-auto[^"]*rounded-t-3xl[^"]*md:static/);
});

test('game-room mobile settings drawer keeps media panel always visible outside drawer', () => {
  const source = readFileSync(gameRoomPath, 'utf8');
  assert.match(source, /import\s+\{[^}]*Settings2[^}]*\}\s+from\s+'lucide-react'/);
  assert.match(source, /fixed bottom-4 right-4 z-50[^"]*md:hidden/);
  assert.match(source, /<Settings2 className="w-6 h-6" \/>/);
  const mediaPanelIndex = source.indexOf('<MediaPanel');
  const controlsDrawerIndex = source.indexOf('surface-panel-strong enter-fade-up fixed inset-x-0 bottom-0 z-40 mobile-drawer');
  assert.ok(mediaPanelIndex >= 0);
  assert.ok(controlsDrawerIndex > mediaPanelIndex);
  assert.doesNotMatch(source, /<\/header>\s*<ChatPanel[\s\S]*?\/>/);
});

test('game-room mobile chat uses a separate bottom drawer and floating button', () => {
  const source = readFileSync(gameRoomPath, 'utf8');
  assert.match(source, /import\s+\{[^}]*MessageCircle[^}]*\}\s+from\s+'lucide-react'/);
  assert.match(source, /fixed bottom-4 left-4 z-50[^"]*md:hidden/);
  assert.match(source, /<MessageCircle className="w-6 h-6" \/>/);
  assert.match(source, /<div className=\{`surface-panel-strong fixed inset-x-0 bottom-0 z-40 mobile-drawer[^"]*md:hidden/);
});

test('game-room desktop chat uses floating bubble trigger and popup panel', () => {
  const source = readFileSync(gameRoomPath, 'utf8');
  assert.match(source, /fixed bottom-6 right-6 z-40 hidden md:inline-flex/);
  assert.match(source, /<div className=\{`surface-panel-strong fixed bottom-24 right-6 z-40 hidden h-\[min\(34rem,calc\(100vh-10rem\)\)\] w-\[min\(23rem,calc\(100vw-3rem\)\)\] flex-col overflow-hidden/);
  assert.match(source, /<ChatPanel[\s\S]*?onClose=\{\(\) => setShowDesktopChat\(false\)\}[\s\S]*?\/>/);
});

test('game-room mobile drawer is not wrapped by transformed z-index panel container', () => {
  const source = readFileSync(gameRoomPath, 'utf8');
  assert.match(source, /surface-panel-strong flex min-h-0 w-full shrink-0 flex-col overflow-hidden/);
  assert.doesNotMatch(source, /surface-panel-strong enter-fade-up z-20 flex min-h-0 w-full shrink-0 flex-col overflow-hidden/);
});

test('game-room desktop sidebar stacks header, media, and footer sections', () => {
  const source = readFileSync(gameRoomPath, 'utf8');
  assert.match(source, /md:contents/);
  assert.match(source, /<header className="[^"]*md:order-1[^"]*"/);
  assert.match(source, /<div className="md:order-2 md:min-h-0 md:flex-1">[\s\S]*?<MediaPanel/);
  assert.match(source, /<div className="md:order-3 md:shrink-0">[\s\S]*?t\('game\.playingAsLabel'\)/);
});

test('game-room control footer aligns with single-player action layout', () => {
  const source = readFileSync(gameRoomPath, 'utf8');
  const boardPanelSource = readFileSync(gameRoomBoardPanelPath, 'utf8');

  assert.match(source, /<div className="flex flex-col gap-4 border-t border-\[var\(--panel-border\)\] px-4 py-4 md:mt-auto md:p-5">/);
  assert.match(source, /className=\{`flex w-full items-center justify-center gap-3 rounded-lg px-2 py-1 md:justify-start/);
  assert.match(source, /<RefreshCw className="w-4 h-4" \/>[\s\S]*?t\('single\.swap'\)/);
  assert.match(source, /<Undo2 className="w-4 h-4" \/>[\s\S]*?t\('single\.undo'\)/);
  assert.match(source, /className=\{`button-accent mt-1 w-full rounded-lg px-3 py-2 text-sm font-semibold transition-all duration-200 sm:mt-0 md:mt-2/);
  assert.doesNotMatch(boardPanelSource, /t\('game\.reset'\)/);
});

test('game-room swap and undo buttons emit room action requests', () => {
  const source = readFileSync(gameRoomPath, 'utf8');
  assert.match(source, /socket\.emit\('request-swap'\)/);
  assert.match(source, /socket\.emit\('request-undo'\)/);
});

test('game-room realtime hook asks confirmation and emits action responses', () => {
  const source = readFileSync(gameRoomRealtimeHookPath, 'utf8');
  assert.match(source, /window\.confirm\(prompt\)/);
  assert.match(source, /emit\('action-response', \{ requestId: payload\.requestId, accept \}\)/);
});

test('mobile drawers include pop-in animation class hooks', () => {
  const singleSource = readFileSync(singlePlayerPath, 'utf8');
  const gameSource = readFileSync(gameRoomPath, 'utf8');
  assert.match(singleSource, /mobile-drawer-open/);
  assert.match(gameSource, /mobile-drawer-open/);
});

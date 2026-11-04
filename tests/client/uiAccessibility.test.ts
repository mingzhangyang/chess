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
  assert.match(source, /id="chat-message-input"[\s\S]*?maxLength=\{500\}/);
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

test('lobby validates room ids and uses the secure room id generator', () => {
  const source = readFileSync(lobbyPath, 'utf8');
  assert.match(source, /createRoomId/);
  assert.match(source, /isValidRoomId/);
  assert.doesNotMatch(source, /Math\.random\(\)/);
  assert.match(source, /pattern="\[A-Za-z0-9_\-\]\{10,32\}"/);
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

test('single-player renders backend-specific controls for ts and stockfish expert', () => {
  const source = readFileSync(singlePlayerPath, 'utf8');
  assert.match(source, /\{aiBackend === 'ts' \? \(/);
  assert.match(source, /id="stockfish-skill"[\s\S]*?type="range"[\s\S]*?aria-label=\{t\('single\.stockfishSkillAria'\)\}/);
  assert.match(source, /id="stockfish-movetime"[\s\S]*?type="range"[\s\S]*?aria-label=\{t\('single\.stockfishMoveTimeAria'\)\}/);
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
  assert.match(source, /\{showMobileChat && \([\s\S]*?<div className="surface-panel-strong fixed inset-x-0 bottom-0 z-40 mobile-drawer[^"]*md:hidden/);
});

test('game-room desktop chat uses a non-occluding sidebar panel', () => {
  const source = readFileSync(gameRoomPath, 'utf8');
  assert.match(source, /fixed bottom-6 right-6 z-40 hidden md:inline-flex/);
  assert.match(source, /<div className="surface-panel-strong hidden h-full w-\[min\(23rem,30vw\)\] shrink-0 flex-col overflow-hidden border-l/);
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
  assert.match(source, /<div className="md:order-4 md:shrink-0">[\s\S]*?t\('game\.playingAsLabel'\)/);
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

test('game-room realtime hook presents action requests and emits responses', () => {
  const source = readFileSync(gameRoomRealtimeHookPath, 'utf8');
  assert.match(source, /setPendingRoomAction\(pendingAction\)/);
  assert.match(source, /socketRef\.current\?\.emit\('action-response', \{[\s\S]*?requestId: pendingAction\.requestId[\s\S]*?accept,[\s\S]*?\}\)/);
});

test('mobile drawers include pop-in animation class hooks', () => {
  const singleSource = readFileSync(singlePlayerPath, 'utf8');
  const gameSource = readFileSync(gameRoomPath, 'utf8');
  assert.match(singleSource, /mobile-drawer-open/);
  assert.match(gameSource, /mobile-drawer-open/);
});

test('game result modal exposes dialog semantics and keyboard dismissal', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'src/components/GameResultModal.tsx'), 'utf8');
  assert.match(source, /role="dialog"/);
  assert.match(source, /aria-modal="true"/);
  assert.match(source, /handleKeyDown/);
  assert.match(source, /game-result-title/);
});

test('closed drawers are removed from keyboard and assistive technology navigation', () => {
  const gameSource = readFileSync(gameRoomPath, 'utf8');
  const singleSource = readFileSync(singlePlayerPath, 'utf8');

  assert.match(gameSource, /showMobileChat &&/);
  assert.match(gameSource, /showDesktopChat &&/);
  assert.match(gameSource, /controlsPanelRef/);
  assert.match(singleSource, /controlsPanelRef/);
  assert.match(singleSource, /aria-hidden=\{!showControls && !isDesktopLayout\}/);
});


test('both chess modes share theme-aware board colors', () => {
  const singleSource = readFileSync(singlePlayerPath, 'utf8');
  const boardSource = readFileSync(gameRoomBoardPanelPath, 'utf8');
  const sharedSource = readFileSync(path.resolve(process.cwd(), 'src/utils/boardStyles.ts'), 'utf8');
  const cssSource = readFileSync(path.resolve(process.cwd(), 'src/index.css'), 'utf8');

  assert.match(singleSource, /darkSquareStyle: DARK_SQUARE_STYLE/);
  assert.match(singleSource, /lightSquareStyle: LIGHT_SQUARE_STYLE/);
  assert.match(boardSource, /darkSquareStyle: DARK_SQUARE_STYLE/);
  assert.match(boardSource, /lightSquareStyle: LIGHT_SQUARE_STYLE/);
  assert.match(sharedSource, /var\(--board-square-light\)/);
  assert.match(sharedSource, /var\(--board-square-dark\)/);
  assert.match(cssSource, /:root\s*\{[\s\S]*--board-square-light:/);
  assert.match(cssSource, /\.dark\s*\{[\s\S]*--board-square-light:/);
  assert.doesNotMatch(singleSource, /#8f6a4f|#f2e6cc/);
  assert.doesNotMatch(boardSource, /#8f6a4f|#f2e6cc/);
});

test('single and multiplayer display accessible turn status outside mobile control drawers', () => {
  const singleSource = readFileSync(singlePlayerPath, 'utf8');
  const gameSource = readFileSync(gameRoomPath, 'utf8');
  const statusSource = readFileSync(path.resolve(process.cwd(), 'src/components/MobileTurnStatus.tsx'), 'utf8');
  for (const source of [singleSource, gameSource]) {
    assert.match(source, /<MobileTurnStatus/);
    assert.match(source, /status=\{gameStatus\}/);
  }
  assert.match(singleSource, /thinking=\{isThinking && !aiComputeError && !game\.isGameOver\(\)\}/);
  assert.match(statusSource, /role="status"/);
  assert.match(statusSource, /aria-live="polite"/);
  assert.match(statusSource, /aria-atomic="true"/);
  assert.match(statusSource, /md:hidden/);
});

test('move history is visible in both desktop sidebars and mobile layouts', () => {
  const single = readFileSync(singlePlayerPath, 'utf8');
  const multi = readFileSync(gameRoomPath, 'utf8');
  const history = readFileSync(path.resolve(process.cwd(), 'src/components/MoveHistory.tsx'), 'utf8');
  assert.match(single, /const moveHistory = useMemo\(\(\) => game\.history\(\), \[game\]\)/);
  assert.match(single, /<MoveHistory moves=\{moveHistory\} \/>/);
  assert.match(single, /<MoveHistory moves=\{moveHistory\} compact \/>/);
  assert.match(multi, /replayFenHistory\(fenHistory, fenReplayCache\.current\)/);
  assert.match(multi, /moves=\{replayedHistory\.moves\}/);
  assert.match(multi, /startsWithBlack=\{replayedHistory\.startsWithBlack\}/);
  assert.match(multi, /md:order-3 md:block/);
  assert.match(multi, /min-h-0 shrink overflow-y-auto px-4 pb-2 md:order-3/);
  assert.match(multi, /md:order-4 md:shrink-0/);
  assert.match(history, /tabIndex=\{0\}/);
  assert.match(history, /new ResizeObserver/);
  assert.match(history, /\[compact, moves\]/);
  assert.match(history, /scrollLeft = container\.scrollWidth/);
  assert.match(history, /scrollTop = container\.scrollHeight/);
  assert.match(history, /role="log"/);
  assert.doesNotMatch(history, /from 'chess\.js'/);
  assert.doesNotMatch(history, /game\.history/);
  assert.doesNotMatch(history, /new Chess/);
});

test('mobile chess layouts prioritize board height and preserve safe-area controls', () => {
  const single = readFileSync(singlePlayerPath, 'utf8');
  const multi = readFileSync(gameRoomPath, 'utf8');
  const board = readFileSync(gameRoomBoardPanelPath, 'utf8');
  const media = readFileSync(gameRoomMediaPanelPath, 'utf8');
  const status = readFileSync(path.resolve(process.cwd(), 'src/components/MobileTurnStatus.tsx'), 'utf8');
  const history = readFileSync(path.resolve(process.cwd(), 'src/components/MoveHistory.tsx'), 'utf8');
  for (const source of [single, multi]) {
    assert.match(source, /relative flex h-dvh min-h-0 flex-col overflow-hidden/);
  }
  for (const source of [single, board]) {
    assert.match(source, /pb-\[calc\(4\.5rem\+env\(safe-area-inset-bottom\)\)\]/);
    assert.match(source, /md:pb-6/);
  }
  assert.match(media, /max-h-28 flex-1/);
  assert.match(media, /md:max-h-none/);
  assert.match(status, /min-h-10/);
  assert.match(history, /min-h-8/);
});

test('multiplayer history is synchronized from authoritative server FEN sequence', () => {
  const room = readFileSync(gameRoomPath, 'utf8');
  const realtime = readFileSync(gameRoomRealtimeHookPath, 'utf8');
  const store = readFileSync(path.resolve(process.cwd(), 'worker/src/RoomStateStore.ts'), 'utf8');
  const worker = readFileSync(path.resolve(process.cwd(), 'worker/src/RoomDurableObject.ts'), 'utf8');
  assert.match(room, /replayFenHistory\(fenHistory, fenReplayCache\.current\)/);
  assert.match(realtime, /onRoomState: \(\{ users: roomUsers, fen, fenHistory, myColor \}\)/);
  assert.match(realtime, /onChessMove: \(\{ fen, fenHistory, actorId \}\)/);
  assert.match(store, /getFenHistory\(\)/);
  assert.match(worker, /fenHistory: this\.roomState\.getFenHistory\(\)/);
});

test('accessible square renderer applies visual highlight styles', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'src/components/AccessibleChessboard.tsx'), 'utf8');
  assert.match(source, /style=\\{options\\.squareStyles\\?\\.\\[square\\]\\}/);
});

test('landscape mobile board keeps bottom safe-area padding', () => {
  for (const file of [singlePlayerPath, gameRoomBoardPanelPath]) {
    const source = readFileSync(file, 'utf8');
    assert.match(source, /sm:px-6 sm:pt-6 md:pb-6/);
    assert.doesNotMatch(source, /sm:p-6/);
  }
});

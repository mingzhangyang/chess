import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const singlePlayerPath = path.resolve(process.cwd(), 'src/components/SinglePlayerRoom.tsx');
const aiHookPath = path.resolve(process.cwd(), 'src/hooks/useSinglePlayerAi.ts');
const workerPath = path.resolve(process.cwd(), 'src/workers/chessAiWorker.ts');

test('single-player routes expert difficulty to stockfish backend', () => {
  const source = readFileSync(singlePlayerPath, 'utf8');
  assert.match(source, /const aiBackend: 'ts' \| 'stockfish-wasm' = difficulty === 'expert' \? 'stockfish-wasm' : 'ts';/);
  const hook = readFileSync(aiHookPath, 'utf8');
  assert.match(hook, /type: 'compute-best-move'[\s\S]*?difficulty,[\s\S]*?backend: aiBackend,/);
});

test('single-player avoids unsynchronized SharedArrayBuffer TT writes', () => {
  const source = readFileSync(aiHookPath, 'utf8');
  assert.match(source, /resolveAiWorkerCount\(\s*aiBackend,\s*difficulty,\s*canShare,/s);
  assert.match(source, /const canShare = false;/);
  assert.doesNotMatch(source, /new SharedArrayBuffer|init-shared-tt/);
});

test('single-player tracks pending worker responses before clearing thinking state', () => {
  const source = readFileSync(aiHookPath, 'utf8');
  assert.match(source, /const pendingResponseCountRef = useRef\(0\);/);
  assert.match(source, /pendingResponseCountRef\.current = workers\.length;/);
  assert.match(source, /pendingResponseCountRef\.current = Math\.max\(0, pendingResponseCountRef\.current - 1\);/);
  assert.match(source, /if \(aiMoveAppliedRef\.current \|\| pendingResponseCountRef\.current <= 0\) \{\s*clearAiWatchdog\(\);\s*setIsThinking\(false\);/);
});

test('single-player terminates redundant AI workers after accepting a move', () => {
  const source = readFileSync(aiHookPath, 'utf8');

  assert.match(source, /terminateOtherWorkers/);
  assert.match(source, /workerPoolRestartRef/);
  assert.match(source, /worker\.terminate\(\)/);
});

test('single-player sends stockfish expert options separately from ts tuning', () => {
  const source = readFileSync(singlePlayerPath, 'utf8');
  assert.match(source, /const aiTuning = useMemo<Partial<AiTuning>>\(\(\) => \{/);
  assert.match(source, /const stockfishSkillLevel = useMemo\(\(\) => /);
  assert.match(source, /const stockfishMoveTimeMs = useMemo\(\s*\(\) => /);
  const hook = readFileSync(aiHookPath, 'utf8');
  assert.match(hook, /const payload: AiComputeRequest = \{[\s\S]*?tuning: aiBackend === 'ts' \? aiTuning : undefined,/);
  assert.match(hook, /stockfishSkillLevel: aiBackend === 'stockfish-wasm' \? stockfishSkillLevel : undefined,/);
  assert.match(hook, /timeLimitMs: aiBackend === 'stockfish-wasm' \? stockfishMoveTimeMs : undefined,/);
});

test('single-player sends move history with the FEN to preserve opening context', () => {
  const source = readFileSync(aiHookPath, 'utf8');
  assert.match(source, /const historyWindow = getAiHistoryWindow\(game\);/);
  assert.match(source, /const payload: AiComputeRequest = \{[\s\S]*?fen,[\s\S]*?history: historyWindow\.history,[\s\S]*?difficulty,/);
  assert.match(source, /historyStartFen: historyWindow\.historyStartFen/);
  assert.match(source, /historyTruncated: historyWindow\.historyTruncated/);
});

test('single-player stops automatic AI retries after all workers fail', () => {
  const source = readFileSync(aiHookPath, 'utf8');
  assert.match(source, /const \[aiComputeError, setAiComputeError\] = useState\(false\);/);
  assert.match(source, /if \(!isThinking && !aiComputeError && game\.turn\(\) !== playerColor/);
  assert.match(source, /if \(!aiMoveAppliedRef\.current && pendingResponseCountRef\.current <= 0\) \{\s*setAiComputeError\(true\);/);
  const ui = readFileSync(singlePlayerPath, 'utf8');
  assert.match(ui, /onClick=\{retryComputerMove\}/);
});

test('single-player handles worker runtime failures and rebuilds the pool on retry', () => {
  const source = readFileSync(aiHookPath, 'utf8');
  assert.match(source, /const pendingWorkersRef = useRef<Set<Worker>>\(new Set\(\)\);/);
  assert.match(source, /w\.addEventListener\('error', errorListener\);/);
  assert.match(source, /w\.addEventListener\('messageerror', messageErrorListener\);/);
  assert.match(source, /const handleWorkerFailure = \(worker: Worker,/);
  assert.match(source, /pendingWorkersRef\.current\.delete\(worker\);/);
  assert.match(source, /const retryComputerMove = useCallback\(\(\) => \{\s*clearAiWatchdog\(\);\s*setAiComputeError\(false\);\s*workerPoolRestartRef\.current\(\);/s);
  assert.match(source, /if \(workers\.length === 0\) \{\s*setIsThinking\(false\);\s*setAiComputeError\(true\);\s*return;/s);
});

test('AI worker converts async runtime failures into a terminal response', () => {
  const source = readFileSync(workerPath, 'utf8');
  assert.match(source, /try \{[\s\S]*?handleAiComputeRequest\(data, runtimeDeps\)/);
  assert.match(source, /type: 'best-move-result'/);
  assert.match(source, /bestMove: null/);
});

test('AI worker validates message data before reading its type in the failure path', () => {
  const source = readFileSync(workerPath, 'utf8');
  assert.match(source, /const isWorkerMessage = \(data: unknown\)/);
  assert.match(source, /typeof data !== 'object' \|\| data === null/);
  assert.match(source, /requestId: request\?\.requestId/);
});

test('single-player handles a worker pool that fails before the AI turn', () => {
  const source = readFileSync(aiHookPath, 'utf8');
  assert.match(source, /if \(workersRef\.current\.length === 0 && !isGameOver\(gameRef\.current\)\) \{\s*setAiComputeError\(true\);/s);
  assert.match(source, /onAiMove\(nextGame, move\);\s*setAiComputeError\(false\);/s);
  const ui = readFileSync(singlePlayerPath, 'utf8');
  assert.match(ui, /applyGameState\(prepared\.game, \{ from: prepared\.move\.from, to: prepared\.move\.to \}\);\s*clearAiError\(\);/s);
});

test('single-player reads AI style from storage defensively', () => {
  const source = readFileSync(singlePlayerPath, 'utf8');
  const aiStyleInitializer = source.match(/const \[aiStyle,[\s\S]*?\n  \}\);/);
  assert.ok(aiStyleInitializer, 'expected AI style state initializer');
  assert.match(aiStyleInitializer[0], /try \{/);
  assert.match(aiStyleInitializer[0], /catch \{/);
});

test('the single-player watchdog invalidates hung requests and offers retry', () => {
  const source = readFileSync(aiHookPath, 'utf8');
  assert.match(source, /resolveAiWorkerResponseTimeoutMs\(aiBackend, difficulty, stockfishMoveTimeMs\)/);
  assert.match(source, /requestId !== aiRequestIdRef\.current/);
  assert.match(source, /aiTelemetry\.error\('worker-request-timeout'/);
  assert.match(source, /workerPoolRestartRef\.current\(\);\s*setIsThinking\(false\);\s*setAiComputeError\(true\);/s);
  assert.match(source, /clearAiWatchdog\(\);/);
});

test('player clicks and drops reuse a prepared move rather than repeating history', () => {
  const source = readFileSync(singlePlayerPath, 'utf8');
  assert.match(source, /const prepared = validated \?\? prepareSinglePlayerMove\(game, sourceSquare, targetSquare, promotion\)/);
  assert.match(source, /commitPlayerMove\(moveFrom, square, 'q', prepared\)/);
  assert.match(source, /commitPlayerMove\(sourceSquare, targetSquare, 'q', prepared\)/);
});

test('single-player UI delegates all AI worker orchestration without importing search runtime', () => {
  const ui = readFileSync(singlePlayerPath, 'utf8');
  const hook = readFileSync(aiHookPath, 'utf8');
  assert.match(ui, /\} = useSinglePlayerAi\(\{/);
  assert.match(ui, /const onAiMove = useCallback\(\(nextGame: Chess, move: Move\) => \{/);
  assert.match(ui, /playMoveSound\(getMoveSoundKind\(nextGame, move\)\)/);
  assert.match(ui, /playMoveSound\(getMoveSoundKind\(prepared\.game, prepared\.move\)\)/);
  assert.doesNotMatch(ui, /new Worker\(|workerPoolRestartRef|pendingWorkersRef|aiRequestIdRef|TT_BYTES|SharedArrayBuffer/);
  assert.doesNotMatch(ui, /import \{[^\n]*\} from '\.\.\/utils\/chessAI'/);
  assert.match(hook, /new Worker\(new URL\('\.\.\/workers\/chessAiWorker\.ts', import\.meta\.url\)/);
  assert.match(hook, /const \[isThinking, setIsThinking\] = useState\(false\)/);
  assert.match(hook, /const \[aiComputeError, setAiComputeError\] = useState\(false\)/);
});

test('AI hook binds accepted moves to current request, FEN and player color', () => {
  const source = readFileSync(aiHookPath, 'utf8');
  assert.match(source, /payload\.requestId !== aiRequestIdRef\.current/);
  assert.match(source, /pendingWorkersRef\.current\.has\(worker\)/);
  assert.match(source, /payload\.fen === pendingFenRef\.current/);
  assert.match(source, /currentGame\.fen\(\) === payload\.fen/);
  assert.match(source, /currentGame\.turn\(\) !== playerColorRef\.current/);
  assert.match(source, /terminateOtherWorkers\(worker\);\s*clearAiWatchdog\(\);\s*onAiMove\(nextGame,/s);
});

test('AI hook cancels, restarts and cleans up workers without allowing stale responses', () => {
  const source = readFileSync(aiHookPath, 'utf8');
  assert.match(source, /const cancelComputerMove = useCallback\(\(\) => \{\s*clearAiWatchdog\(\);\s*aiRequestIdRef\.current \+= 1;/s);
  assert.match(source, /pendingWorkersRef\.current\.clear\(\);\s*pendingResponseCountRef\.current = 0;/s);
  assert.match(source, /workerPoolRestartRef\.current\(\)/);
  assert.match(source, /worker\.removeEventListener\('message'/);
  assert.match(source, /worker\.terminate\(\)/);
  assert.match(source, /clearAiWatchdog\(\);\s*setIsThinking\(false\);/s);
  assert.match(source, /if \(requestId !== aiRequestIdRef\.current \|\| aiMoveAppliedRef\.current\) return;/);
});

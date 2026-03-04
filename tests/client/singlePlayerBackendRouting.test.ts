import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const singlePlayerPath = path.resolve(process.cwd(), 'src/components/SinglePlayerRoom.tsx');

test('single-player routes expert difficulty to stockfish backend', () => {
  const source = readFileSync(singlePlayerPath, 'utf8');
  assert.match(source, /const aiBackend: 'ts' \| 'stockfish-wasm' = difficulty === 'expert' \? 'stockfish-wasm' : 'ts';/);
  assert.match(source, /type: 'compute-best-move'[\s\S]*?difficulty,[\s\S]*?backend: aiBackend,/);
});

test('single-player uses single worker for stockfish backend to avoid duplicated compute', () => {
  const source = readFileSync(singlePlayerPath, 'utf8');
  assert.match(source, /const canShare = aiBackend === 'ts' && typeof SharedArrayBuffer !== 'undefined';/);
  assert.match(source, /const workerCount = aiBackend === 'ts'[\s\S]*?: 1;/);
  assert.match(source, /w\.postMessage\(\{ type: 'init-shared-tt', buffer: sharedBuffer, backend: aiBackend \}\);/);
});

test('single-player tracks pending worker responses before clearing thinking state', () => {
  const source = readFileSync(singlePlayerPath, 'utf8');
  assert.match(source, /const pendingResponseCountRef = useRef\(0\);/);
  assert.match(source, /pendingResponseCountRef\.current = workers\.length;/);
  assert.match(source, /pendingResponseCountRef\.current = Math\.max\(0, pendingResponseCountRef\.current - 1\);/);
  assert.match(source, /if \(aiMoveAppliedRef\.current \|\| pendingResponseCountRef\.current <= 0\) \{\s*setIsThinking\(false\);/);
});

test('single-player sends stockfish expert options separately from ts tuning', () => {
  const source = readFileSync(singlePlayerPath, 'utf8');
  assert.match(source, /const aiTuning = useMemo<Partial<AiTuning>>\(\(\) => \{/);
  assert.match(source, /const stockfishSkillLevel = useMemo\(\(\) => /);
  assert.match(source, /const stockfishMoveTimeMs = useMemo\(\s*\(\) => /);
  assert.match(source, /const payload: AiComputeRequest = \{[\s\S]*?tuning: aiBackend === 'ts' \? aiTuning : undefined,/);
  assert.match(source, /stockfishSkillLevel: aiBackend === 'stockfish-wasm' \? stockfishSkillLevel : undefined,/);
  assert.match(source, /timeLimitMs: aiBackend === 'stockfish-wasm' \? stockfishMoveTimeMs : undefined,/);
});

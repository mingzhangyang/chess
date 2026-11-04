import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Chess } from 'chess.js';
import { appendFenHistory } from '../../src/utils/fenHistoryReplay';
import { MAX_FEN_HISTORY } from '../../shared/realtimeProtocol';
import { translate } from '../../src/i18n/translations';

const start = new Chess().fen();
const afterE4 = (() => { const g = new Chess(); g.move('e4'); return g.fen(); })();
const afterE5 = (() => { const g = new Chess(); g.move('e4'); g.move('e5'); return g.fen(); })();

test('appendFenHistory appends when the move continues the local history', () => {
  assert.deepEqual(appendFenHistory([start], start, afterE4), [start, afterE4]);
  assert.deepEqual(appendFenHistory([start, afterE4], afterE4, afterE5), [start, afterE4, afterE5]);
});

test('appendFenHistory ignores a duplicate of the latest position', () => {
  const history = [start, afterE4];
  assert.equal(appendFenHistory(history, start, afterE4), history);
});

test('appendFenHistory falls back to the two known positions when out of sync', () => {
  assert.deepEqual(appendFenHistory([start], afterE4, afterE5), [afterE4, afterE5]);
  assert.deepEqual(appendFenHistory([start], undefined, afterE5), [afterE5]);
});

test('appendFenHistory keeps the same cap as the server', () => {
  const full = Array.from({ length: MAX_FEN_HISTORY }, (_, i) => `fen-${i}`);
  const next = appendFenHistory(full, `fen-${MAX_FEN_HISTORY - 1}`, 'fen-new');
  assert.equal(next.length, MAX_FEN_HISTORY);
  assert.equal(next[0], 'fen-1');
  assert.equal(next.at(-1), 'fen-new');
  const store = readFileSync(path.resolve(process.cwd(), 'worker/src/RoomStateStore.ts'), 'utf8');
  assert.match(store, /MAX_FEN_HISTORY/);
  assert.doesNotMatch(store, /\b512\b/);
});

test('chess-move broadcast does not carry the whole FEN history', () => {
  const worker = readFileSync(path.resolve(process.cwd(), 'worker/src/RoomDurableObject.ts'), 'utf8');
  const broadcast = worker.match(/type: 'chess-move',\s*payload: \{([^}]*)\}/);
  assert.ok(broadcast);
  assert.doesNotMatch(broadcast[1], /fenHistory/);
  assert.match(broadcast[1], /previousFen/);
});

test('landscape notice recommends portrait instead of saying landscape is unsupported', () => {
  const app = readFileSync(path.resolve(process.cwd(), 'src/App.tsx'), 'utf8');
  assert.match(app, /t\('app\.portraitNotice\.title'\)/);
  assert.match(app, /t\('app\.portraitNotice\.body'\)/);
  for (const language of ['en', 'zh', 'fr', 'es', 'ja'] as const) {
    const title = translate(language, 'app.portraitNotice.title');
    const body = translate(language, 'app.portraitNotice.body');
    assert.notEqual(title, 'app.portraitNotice.title');
    assert.notEqual(body, 'app.portraitNotice.body');
    assert.doesNotMatch(`${title} ${body}`, /only|仅|只|solo|のみ|uniquement|seulement/i);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Chess } from 'chess.js';
import {
  SINGLE_PLAYER_SAVED_GAME_KEY,
  persistSinglePlayerGame,
  readSavedSinglePlayerGame,
  type SavedSinglePlayerGame,
} from '../../src/utils/singlePlayerSavedGame';
import { restoreSavedSinglePlayerGame } from '../../src/utils/restoreSinglePlayerGame';

class MemoryStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null {
    return this.values.has(key) ? this.values.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
  removeItem(key: string): void {
    this.values.delete(key);
  }
}

function play(moves: string[]): Chess {
  const game = new Chess();
  for (const move of moves) game.move(move);
  return game;
}

test('an in-progress game round-trips with its history, color and difficulty', () => {
  const storage = new MemoryStorage();
  const game = play(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5']);
  persistSinglePlayerGame(storage, game, 'hard', 'b', 1234);

  const saved = readSavedSinglePlayerGame(storage);
  assert.deepEqual(saved, {
    version: 1,
    difficulty: 'hard',
    playerColor: 'b',
    moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'],
    savedAt: 1234,
  });

  const restored = restoreSavedSinglePlayerGame(saved!);
  assert.ok(restored);
  assert.equal(restored.game.fen(), game.fen());
  assert.deepEqual(restored.game.history(), game.history());
  assert.deepEqual(restored.lastMove, { from: 'f1', to: 'b5' });
  assert.equal(restored.playerColor, 'b');
});

test('promotions survive a save and restore', () => {
  const storage = new MemoryStorage();
  const game = new Chess();
  for (const move of ['a4', 'b5', 'axb5', 'a6', 'bxa6', 'Bb7', 'axb7', 'Nc6', 'bxa8=N']) game.move(move);
  persistSinglePlayerGame(storage, game, 'easy', 'w');

  const restored = restoreSavedSinglePlayerGame(readSavedSinglePlayerGame(storage)!);
  assert.equal(restored?.game.fen(), game.fen());
});

test('fresh, finished and reset games clear the saved entry', () => {
  const storage = new MemoryStorage();
  persistSinglePlayerGame(storage, play(['e4']), 'easy', 'w');
  assert.ok(storage.getItem(SINGLE_PLAYER_SAVED_GAME_KEY));

  persistSinglePlayerGame(storage, new Chess(), 'easy', 'w');
  assert.equal(storage.getItem(SINGLE_PLAYER_SAVED_GAME_KEY), null);

  persistSinglePlayerGame(storage, play(['e4']), 'easy', 'w');
  persistSinglePlayerGame(storage, play(['f3', 'e5', 'g4', 'Qh4#']), 'easy', 'w');
  assert.equal(storage.getItem(SINGLE_PLAYER_SAVED_GAME_KEY), null);
});

test('malformed or unknown saved entries are ignored', () => {
  const storage = new MemoryStorage();
  const valid = { version: 1, difficulty: 'medium', playerColor: 'w', moves: ['e4', 'e5'], savedAt: 1 };
  const cases: unknown[] = [
    'not json',
    null,
    { ...valid, version: 2 },
    { ...valid, difficulty: 'grandmaster' },
    { ...valid, playerColor: 'red' },
    { ...valid, moves: 'e4 e5' },
    { ...valid, moves: [] },
    { ...valid, moves: [1, 2] },
  ];
  for (const entry of cases) {
    storage.setItem(SINGLE_PLAYER_SAVED_GAME_KEY, typeof entry === 'string' ? entry : JSON.stringify(entry));
    assert.equal(readSavedSinglePlayerGame(storage), null, JSON.stringify(entry));
  }

  storage.setItem(SINGLE_PLAYER_SAVED_GAME_KEY, JSON.stringify(valid));
  assert.equal(readSavedSinglePlayerGame(storage)?.difficulty, 'medium');
});

test('restoring rejects tampered moves and already finished games', () => {
  const base: SavedSinglePlayerGame = { version: 1, difficulty: 'easy', playerColor: 'w', moves: [], savedAt: 1 };
  assert.equal(restoreSavedSinglePlayerGame({ ...base, moves: ['e4', 'e4'] }), null);
  assert.equal(restoreSavedSinglePlayerGame({ ...base, moves: ['Qxf7#'] }), null);
  assert.equal(restoreSavedSinglePlayerGame({ ...base, moves: ['f3', 'e5', 'g4', 'Qh4#'] }), null);
  assert.equal(restoreSavedSinglePlayerGame({ ...base, moves: [] }), null);
});

test('the lobby-side saved-game module keeps chess.js out of the initial bundle', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'src/utils/singlePlayerSavedGame.ts'), 'utf8');
  assert.doesNotMatch(source, /^import (?!type )[^\n]*from '(chess\.js|\.\/restoreSinglePlayerGame)'/m);
  const app = readFileSync(path.resolve(process.cwd(), 'src/App.tsx'), 'utf8');
  const lobby = readFileSync(path.resolve(process.cwd(), 'src/components/Lobby.tsx'), 'utf8');
  for (const source of [app, lobby]) {
    assert.doesNotMatch(source, /restoreSinglePlayerGame|from 'chess\.js'/);
  }
});

test('storage failures never break gameplay', () => {
  const throwing = {
    getItem: () => { throw new Error('denied'); },
    setItem: () => { throw new Error('quota'); },
    removeItem: () => { throw new Error('denied'); },
  };
  assert.equal(readSavedSinglePlayerGame(throwing), null);
  assert.equal(readSavedSinglePlayerGame(null), null);
  assert.doesNotThrow(() => persistSinglePlayerGame(throwing, play(['e4']), 'easy', 'w'));
  assert.doesNotThrow(() => persistSinglePlayerGame(null, play(['e4']), 'easy', 'w'));
});

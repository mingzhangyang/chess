import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { resolveTsTuning, TsEngineAdapter } from '../../src/workers/tsEngineAdapter';

test('replays UCI history before applying opening-book strategy', () => {
  const game = new Chess();
  game.move('e4');
  game.move('e5');
  const originalRandom = Math.random;
  Math.random = () => 0;

  try {
    const adapter = new TsEngineAdapter();
    const move = adapter.computeBestMove({
      fen: game.fen(),
      history: ['e2e4', 'e7e5'],
      difficulty: 'medium',
      tuning: {
        openingBookEnabled: true,
        openingBookMaxPly: 10,
      },
    });

    assert.equal(move, 'Nf3');
  } finally {
    Math.random = originalRandom;
  }
});

test('accepts the start marker with explicit empty history', () => {
  const adapter = new TsEngineAdapter();
  const move = adapter.computeBestMove({
    fen: 'start',
    history: [],
    difficulty: 'easy',
  });

  assert.ok(move, 'expected a legal move from the starting position');
});

test('rejects an explicitly empty history when it does not describe the FEN', () => {
  const game = new Chess();
  game.move('e4');
  const adapter = new TsEngineAdapter();

  assert.throws(
    () => adapter.computeBestMove({
      fen: game.fen(),
      history: [],
      difficulty: 'medium',
      tuning: { openingBookEnabled: true, openingBookMaxPly: 10 },
    }),
    /AI move history does not match FEN/,
  );
});

test('rejects malformed UCI history before starting a search', () => {
  const adapter = new TsEngineAdapter();

  assert.throws(
    () => adapter.computeBestMove({
      fen: new Chess().fen(),
      history: ['e2e5'],
      difficulty: 'medium',
    }),
    /invalid AI move history/,
  );
});

test('disables opening-book moves for FEN-only non-start positions', () => {
  const tuning = resolveTsTuning({
    fen: '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1',
    difficulty: 'hard',
    tuning: { openingBookEnabled: true },
  });

  assert.equal(tuning?.openingBookEnabled, false);
});

test('replays a bounded history segment from its supplied starting FEN', () => {
  const base = new Chess();
  base.move('e4');
  const game = new Chess(base.fen());
  game.move('Nf6');
  game.move('Nf3');

  const tuning = resolveTsTuning({
    fen: game.fen(),
    history: ['g8f6', 'g1f3'],
    historyStartFen: base.fen(),
    historyTruncated: true,
    difficulty: 'hard',
    tuning: { openingBookEnabled: true },
    timeLimitMs: 1,
  });
  assert.equal(tuning?.openingBookEnabled, false);

  const adapter = new TsEngineAdapter();
  assert.ok(adapter.computeBestMove({
    fen: game.fen(),
    history: ['g8f6', 'g1f3'],
    historyStartFen: base.fen(),
    historyTruncated: true,
    difficulty: 'easy',
    timeLimitMs: 1,
  }));
});

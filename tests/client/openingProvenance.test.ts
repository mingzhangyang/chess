/**
 * getBestMove's steps before the search (game over, easy, opening books) must
 * not depend on whether the caller supplies the ply count and the
 * standard-opening provenance, and the worker must supply them only when its
 * request proves them. Supplying them skips two whole-game chess.js replays
 * per move.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { getBestMove, hasStandardOpeningProvenance, resetOpeningState, type AiTuning } from '../../src/utils/chessAI';
import type { EngineAdapterComputeInput } from '../../src/workers/engineAdapter';
import { createGameFromInput, knownBestMoveContext, resolveTsTuning, TsEngineAdapter } from '../../src/workers/tsEngineAdapter';

const STAGE = 'search-stage';
const seeded = (seed: number) => () => {
  seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
  return seed / 4294967296;
};
const play = (sans: readonly string[], start?: string): Chess => {
  const game = start ? new Chess(start) : new Chess();
  for (const san of sans) game.move(san);
  return game;
};
const uci = (game: Chess): string[] => game.history({ verbose: true }).map((m) => `${m.from}${m.to}${m.promotion ?? ''}`);

// Games that follow the book, leave it, give check, capture, and run past
// openingBookMaxPly; replayed in order, with undo-like jumps back.
const LINES = [
  [], ['e4'], ['e4', 'e5'], ['e4', 'e5', 'Nf3'], ['e4', 'e5', 'Nf3', 'Nc6'], ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'],
  ['d4', 'Nf6', 'c4', 'g6'], ['d4', 'Nf6', 'c4', 'g6', 'Nc3', 'Bg7'], ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6'],
  ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7', 'Re1', 'b5', 'Bb3', 'd6'],
  ['e4', 'e5'], ['f3', 'e5', 'g4'], ['e4', 'd5', 'exd5'], ['e4', 'f5', 'Qh5+'], ['e4'],
  ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3', 'Nf6', 'd4', 'exd4', 'cxd4', 'Bb4+'],
];
const TUNINGS: Array<Partial<AiTuning>> = [
  { openingBookEnabled: true, openingBookMaxPly: 10 },
  { openingBookEnabled: true, openingBookMaxPly: 4 },
  { openingBookEnabled: false, openingBookMaxPly: 0 },
];

/** Every call of a sequence with fresh opening state, a seeded random source and the search cut off by a stage. */
const runSequence = (difficulty: string, tuning: Partial<AiTuning>, seed: number, supplyContext: boolean) => {
  const original = Math.random;
  const random = seeded(seed);
  let draws = 0;
  Math.random = () => { draws += 1; return random(); };
  resetOpeningState();
  try {
    return LINES.map((line) => {
      const game = play(line);
      const options = supplyContext
        ? { searchStage: () => STAGE, plyCount: line.length, standardOpeningProvenance: true }
        : { searchStage: () => STAGE };
      return [getBestMove(game, difficulty, tuning, undefined, options), draws];
    });
  } finally {
    Math.random = original;
    resetOpeningState();
  }
};

test('known ply count and provenance leave every step before the search unchanged', () => {
  for (const difficulty of ['easy', 'medium', 'hard', 'expert']) for (const tuning of TUNINGS) for (const seed of [1, 7, 42]) {
    const label = `${difficulty} ${JSON.stringify(tuning)} seed ${seed}`;
    const computed = runSequence(difficulty, tuning, seed, false);
    assert.deepEqual(runSequence(difficulty, tuning, seed, true), computed, label);
    // The sequences really exercise the books and the search stage.
    if (difficulty === 'hard' && tuning.openingBookEnabled) assert.ok(computed.some(([move]) => move !== STAGE), label);
    if (difficulty !== 'easy') assert.ok(computed.some(([move]) => move === STAGE), label);
  }
});

test('games that do not start from the standard position keep their computed provenance', () => {
  const start = '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1';
  const custom = play(['e4', 'Kd7'], start);
  assert.equal(hasStandardOpeningProvenance(custom), false);
  for (const difficulty of ['medium', 'hard']) {
    const tuning = { openingBookEnabled: true, openingBookMaxPly: 10 };
    resetOpeningState();
    const without = getBestMove(custom, difficulty, tuning, undefined, { searchStage: () => STAGE });
    resetOpeningState();
    // Only the ply count is supplied: provenance is still computed (false).
    const withPly = getBestMove(custom, difficulty, tuning, undefined, { searchStage: () => STAGE, plyCount: 2 });
    assert.equal(withPly, without);
    assert.equal(without, STAGE);
  }
});

test('the worker supplies the ply count and provenance only when its request proves them', () => {
  const standard = new Chess().fen();
  const ruy = play(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5']);
  const custom = '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1';
  const inputs: EngineAdapterComputeInput[] = [
    { fen: 'start', difficulty: 'hard' },
    { fen: 'start', history: [], difficulty: 'hard' },
    { fen: ruy.fen(), history: uci(ruy), difficulty: 'hard' },
    { fen: standard, difficulty: 'hard' },
    { fen: ruy.fen(), difficulty: 'hard' },
    { fen: ruy.fen(), historyStartFen: standard, history: uci(ruy), difficulty: 'hard' },
    { fen: ruy.fen(), historyStartFen: play(['e4', 'e5']).fen(), history: uci(ruy).slice(2), historyTruncated: true, difficulty: 'hard' },
    { fen: play(['e4'], custom).fen(), historyStartFen: custom, history: ['e2e4'], historyTruncated: false, difficulty: 'hard' },
    { fen: custom, difficulty: 'hard' },
  ];
  for (const input of inputs) {
    const game = createGameFromInput(input);
    const known = knownBestMoveContext(input);
    assert.equal(known.plyCount, game.history().length, JSON.stringify(input));
    if (known.standardOpeningProvenance !== undefined) {
      assert.equal(known.standardOpeningProvenance, hasStandardOpeningProvenance(game), JSON.stringify(input));
    } else {
      // Not supplied: the book is off for these requests, so it is never computed either.
      assert.equal(resolveTsTuning(input)?.openingBookEnabled, false, JSON.stringify(input));
    }
  }
});

test('with the known context, a request past the book replays no chess.js history before the search', async () => {
  const game = play(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7', 'Re1', 'b5']);
  const input = { fen: game.fen(), history: uci(game), tuning: { openingBookEnabled: true, openingBookMaxPly: 10 } };
  const original = Chess.prototype.history;
  let calls = 0;
  Chess.prototype.history = function (this: Chess, ...args: Parameters<Chess['history']>) {
    calls += 1;
    return original.apply(this, args);
  } as Chess['history'];
  try {
    for (const difficulty of ['medium', 'hard']) {
      resetOpeningState();
      calls = 0;
      const root = createGameFromInput({ ...input, difficulty });
      assert.equal(getBestMove(root, difficulty, input.tuning, undefined, { searchStage: () => STAGE }), STAGE);
      const computed = calls;
      calls = 0;
      assert.equal(getBestMove(root, difficulty, input.tuning, undefined,
        { searchStage: () => STAGE, ...knownBestMoveContext({ ...input, difficulty }) }), STAGE);
      // Without it: the ply count and the provenance replay (the book lookup is already skipped past its range).
      assert.ok(computed >= 2, `${difficulty}: ${computed} history calls without the context`);
      assert.equal(calls, 0, `${difficulty}: history calls with the context`);
      // The kernel request as a whole replays no history either.
      calls = 0;
      const move = await new TsEngineAdapter().computeBestMove({ ...input, difficulty, timeLimitMs: 50, tsSearchKernel: 'independent' });
      assert.ok(move && game.moves().includes(move));
      assert.equal(calls, 0, `${difficulty}: history calls in a kernel request`);
    }
  } finally {
    Chess.prototype.history = original;
    resetOpeningState();
  }
});

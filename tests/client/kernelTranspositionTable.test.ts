import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { KernelTranspositionTable, TT_EXACT, TT_LOWER, TT_UPPER } from '../../src/utils/chess-ai/independent/kernelTranspositionTable';
import { MAX_MOVES, moveCodeToUci, moveKey } from '../../src/utils/chess-ai/independent/moveCode';
import { SearchPosition, squareFromAlgebraic } from '../../src/utils/chess-ai/searchPosition';

const MATE_SCORE = 1_000_000;
const toSearchMove = (u: string) => ({ from: squareFromAlgebraic(u.slice(0, 2)), to: squareFromAlgebraic(u.slice(2, 4)) });
const firstKey = (position: SearchPosition): number => {
  const buffer = new Int32Array(MAX_MOVES);
  position.generateMoveCodes(buffer);
  return moveKey(buffer[0]);
};
/** probe() as a value, for deep comparison. */
const lookup = (table: KernelTranspositionTable, position: SearchPosition, depth: number) => (table.probe(position, depth)
  ? (table.flag === 0 ? { move: table.move } : { move: table.move, score: table.score, flag: table.flag })
  : undefined);

test('the kernel table separates clocks, repetition history and unrelated positions in one slot', () => {
  const start = new Chess().fen();
  const cycle = ['g1f3', 'g8f6', 'f3g1', 'f6g8'];
  const repeated = SearchPosition.fromHistory(start, cycle.map(toSearchMove), { historyComplete: true });
  const fresh = new SearchPosition(repeated.toFen(), { historyComplete: true });
  const clock = new SearchPosition(repeated.toFen().replace(' 4 3', ' 5 3'), { historyComplete: true });
  const unrelated = new SearchPosition('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1', { historyComplete: true });
  // A one-slot table puts every position in the same slot, so only the
  // stored key words separate them.
  const table = new KernelTranspositionTable(0);
  table.store(repeated, 3, 123, TT_EXACT, firstKey(repeated));
  assert.deepEqual(lookup(table, repeated, 3), { move: firstKey(repeated), score: 123, flag: TT_EXACT });
  for (const other of [fresh, clock, unrelated]) assert.equal(lookup(table, other, 3), undefined, other.toFen());
});

test('the kernel table never stores or probes positions with incomplete history', () => {
  const unknown = new SearchPosition(new Chess().fen());
  assert.equal(unknown.hasCompleteHistory, false);
  const table = new KernelTranspositionTable(0);
  table.store(unknown, 3, 99, TT_EXACT, firstKey(unknown));
  assert.equal(lookup(table, unknown, 3), undefined);
  // Not even as a move-only entry for a complete position in the same slot.
  const complete = new SearchPosition(new Chess().fen(), { historyComplete: true });
  assert.equal(lookup(table, complete, 1), undefined);
});

test('the kernel table shares transpositions, keeps deeper entries and returns only the move when shallow', () => {
  const start = new Chess().fen();
  const a = SearchPosition.fromHistory(start, ['g1f3', 'b8c6', 'b1c3', 'e7e5'].map(toSearchMove), { historyComplete: true });
  const b = SearchPosition.fromHistory(start, ['b1c3', 'b8c6', 'g1f3', 'e7e5'].map(toSearchMove), { historyComplete: true });
  const table = new KernelTranspositionTable();
  table.store(a, 3, 42, TT_LOWER, firstKey(a));
  assert.deepEqual(lookup(table, b, 3), { move: firstKey(a), score: 42, flag: TT_LOWER });
  assert.deepEqual(lookup(table, b, 4), { move: firstKey(a) }, 'a shallower entry only supplies its move');

  const other = new SearchPosition('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', { historyComplete: true });
  const slot = new KernelTranspositionTable(0);
  slot.store(a, 3, 10, TT_EXACT, firstKey(a));
  slot.store(other, 2, 20, TT_EXACT, firstKey(other));
  assert.deepEqual(lookup(slot, a, 3), { move: firstKey(a), score: 10, flag: TT_EXACT }, 'a shallower store does not displace a deeper entry');
  assert.equal(lookup(slot, other, 2), undefined);
  slot.store(other, 3, 30, TT_UPPER, firstKey(other));
  assert.deepEqual(lookup(slot, other, 3), { move: firstKey(other), score: 30, flag: TT_UPPER }, 'an equal depth replaces');
  slot.store(other, 4, -MATE_SCORE + 7, TT_UPPER, firstKey(other));
  assert.equal(lookup(slot, other, 4)?.score, -MATE_SCORE + 7);
  assert.equal(lookup(slot, a, 3), undefined);
});

test('the kernel table round-trips every bound, mate scores, promotion move keys and depths', () => {
  const position = new SearchPosition('1r2k3/P7/8/8/8/8/8/4K3 w - - 0 1', { historyComplete: true });
  const buffer = new Int32Array(MAX_MOVES);
  const promotions = Array.from(buffer.subarray(0, position.generateMoveCodes(buffer))).filter((m) => moveCodeToUci(m).length === 5);
  assert.equal(promotions.length, 8, 'a7a8 and a7xb8, each to four pieces');
  const table = new KernelTranspositionTable(4);
  for (const flag of [TT_EXACT, TT_LOWER, TT_UPPER]) for (const move of promotions) {
    for (const score of [MATE_SCORE - 3, -(MATE_SCORE - 3), 0, -1, 2 ** 31 - 1, -(2 ** 31)]) for (const depth of [1, 255]) {
      const fresh = new KernelTranspositionTable(4);
      fresh.store(position, depth, score, flag, moveKey(move));
      assert.deepEqual(lookup(fresh, position, depth), { move: moveKey(move), score, flag });
    }
  }
  // Depths beyond the stored range are clamped, as in the reference table.
  table.store(position, 300, 5, TT_EXACT, moveKey(promotions[0]));
  assert.equal(lookup(table, position, 255)?.score, 5);
  assert.deepEqual(lookup(table, position, 256), { move: moveKey(promotions[0]) });
});

test('the kernel table verifies both key words, not just the slot word', () => {
  // The table reads only these three fields. Real 32-bit collisions of the
  // first word cannot be constructed, so use positions that share it.
  const keyed = (low: number, high: number) => ({ hasCompleteHistory: true,
    transpositionKeyLow: low, transpositionKeyHigh: high }) as unknown as SearchPosition;
  const table = new KernelTranspositionTable(4);
  const a = keyed(0x8000_0005, 0x1234_5678);
  table.store(a, 3, 77, TT_EXACT, 64);
  assert.deepEqual(lookup(table, a, 3), { move: 64, score: 77, flag: TT_EXACT });
  assert.equal(lookup(table, keyed(0x8000_0005, 0x1234_5679), 3), undefined, 'same first word, different second word');
  assert.equal(lookup(table, keyed(0x0000_0005, 0x1234_5678), 3), undefined, 'same slot, different first word');
  assert.deepEqual(lookup(table, keyed(0x8000_0005, 0x1234_5678), 3), { move: 64, score: 77, flag: TT_EXACT }, 'unsigned keys above 2^31 match');
});

test('clear() empties a reused table without reallocating it', () => {
  const position = SearchPosition.fromHistory(new Chess().fen(), ['e2e4', 'e7e5'].map(toSearchMove), { historyComplete: true });
  const table = new KernelTranspositionTable(4);
  table.store(position, 5, 42, TT_LOWER, firstKey(position));
  assert.ok(lookup(table, position, 5));
  table.clear();
  assert.equal(lookup(table, position, 0), undefined);
  // A cleared slot accepts any depth again (depth-preferred replacement starts over).
  table.store(position, 1, 7, TT_UPPER, firstKey(position));
  assert.deepEqual(lookup(table, position, 1), { move: firstKey(position), score: 7, flag: TT_UPPER });
});

test('a search with a reused, cleared table equals a search with a fresh table', async () => {
  const { runKernelSearch } = await import('../../src/utils/chess-ai/independent/kernelSearch');
  const { DEFAULT_AI_TUNING } = await import('../../src/utils/chess-ai/chessAITuning');
  const { resetSearchCounters, searchState } = await import('../../src/utils/chess-ai/chessAISearchDiagnostics');
  const history = ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'a7a6', 'b5a4', 'g8f6'];
  const search = (table?: KernelTranspositionTable) => {
    const position = SearchPosition.fromHistory(new Chess().fen(), history.map(toSearchMove), { historyComplete: true });
    const buffer = new Int32Array(MAX_MOVES);
    const rootOrder = Array.from(buffer.subarray(0, position.generateMoveCodes(buffer)));
    resetSearchCounters(); searchState.searchAborted = false;
    const result = runKernelSearch(position, rootOrder, { color: 'w', tuning: DEFAULT_AI_TUNING, difficulty: 'expert', maxDepth: 4,
      openingPhase: false, previousOwnMove: null, firstDepthDeadline: Infinity, softDeadline: Infinity, hardDeadline: Infinity, table });
    return { moves: result.rootMoves.map(({ move, rawScore }) => [moveCodeToUci(move), rawScore]), nodes: searchState.nodeCount + searchState.qNodeCount };
  };
  const fresh = search();
  const reused = new KernelTranspositionTable();
  // Fill the table with another search's entries (black to move, other position).
  const other = SearchPosition.fromHistory(new Chess().fen(), ['d2d4'].map(toSearchMove), { historyComplete: true });
  for (let depth = 1; depth < 30; depth += 1) reused.store(other, depth, depth, TT_EXACT, firstKey(other));
  assert.deepEqual(search(reused), fresh);
  assert.deepEqual(search(reused), fresh, 'second reuse');
  // The search really used the reused table: the root's children were stored.
  const child = SearchPosition.fromHistory(new Chess().fen(), [...history, 'e1g1'].map(toSearchMove), { historyComplete: true });
  assert.equal(reused.probe(child, 0), true);
});

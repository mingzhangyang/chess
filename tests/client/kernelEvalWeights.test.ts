import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { DEFAULT_AI_TUNING } from '../../src/utils/chess-ai/chessAITuning';
import { PIECE_SQUARE_EG, PIECE_SQUARE_MG } from '../../src/utils/chess-ai/evaluationTables';
import {
  DEFAULT_KERNEL_EVAL_WEIGHTS, flattenWeights, pieceSquareTables, unflattenWeights, WEIGHT_COUNT, WEIGHT_FIELDS, WEIGHT_OFFSETS,
  type KernelEvalWeights,
} from '../../src/utils/chess-ai/independent/kernelEvalWeights';
import { KernelEvaluator } from '../../src/utils/chess-ai/independent/kernelEvaluation';
import { MAX_MOVES } from '../../src/utils/chess-ai/independent/moveCode';
import { SearchPosition } from '../../src/utils/chess-ai/searchPosition';

const withChange = (change: (v: Float64Array) => void): KernelEvalWeights => {
  const vector = flattenWeights(DEFAULT_KERNEL_EVAL_WEIGHTS);
  change(vector);
  return unflattenWeights(vector);
};

test('the default weights give the shared piece-square tables themselves', () => {
  const tables = pieceSquareTables(DEFAULT_KERNEL_EVAL_WEIGHTS);
  assert.equal(tables.mg, PIECE_SQUARE_MG);
  assert.equal(tables.eg, PIECE_SQUARE_EG);
  // A rebuilt copy of the defaults is recognised too.
  const copy = pieceSquareTables(unflattenWeights(flattenWeights(DEFAULT_KERNEL_EVAL_WEIGHTS)));
  assert.equal(copy.mg, PIECE_SQUARE_MG);
});

test('the flat view round-trips and its fields do not overlap', () => {
  const vector = flattenWeights(DEFAULT_KERNEL_EVAL_WEIGHTS);
  assert.equal(vector.length, WEIGHT_COUNT);
  assert.deepEqual(flattenWeights(unflattenWeights(vector)), vector);
  const offsets = WEIGHT_FIELDS.map((f) => WEIGHT_OFFSETS[f.name]);
  for (let i = 1; i < offsets.length; i += 1) assert.equal(offsets[i], offsets[i - 1] + WEIGHT_FIELDS[i - 1].length);
  assert.equal(vector[WEIGHT_OFFSETS.materialMg + 5], 1100);
  assert.equal(vector[WEIGHT_OFFSETS.pstEg + 6 * 64 + 27], DEFAULT_KERNEL_EVAL_WEIGHTS.pstEg[6][27]);
  assert.equal(vector[WEIGHT_OFFSETS.tempo], 10);
});

test('material and piece-square weights must be integers', () => {
  assert.throws(() => pieceSquareTables(withChange((v) => { v[WEIGHT_OFFSETS.materialMg + 1] = 100.5; })), /integers/);
});

test('a position switched to other piece-square tables keeps exact sums through make and undo', () => {
  const weights = withChange((v) => {
    v[WEIGHT_OFFSETS.materialMg + 2] += 7;
    for (let i = 0; i < 64; i += 1) v[WEIGHT_OFFSETS.pstEg + 1 * 64 + i] += i % 5;
  });
  const tables = pieceSquareTables(weights);
  assert.notEqual(tables.mg, PIECE_SQUARE_MG);
  const fresh = (fen: string) => { const p = new SearchPosition(fen); p.usePieceSquareTables(tables.mg, tables.eg); return p; };
  const game = new Chess();
  const position = fresh(game.fen());
  let seed = 7;
  const random = (n: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
  const buffer = new Int32Array(MAX_MOVES);
  for (let ply = 0; ply < 80; ply += 1) {
    const count = position.generateMoveCodes(buffer);
    if (count === 0) break;
    position.makeMoveCode(buffer[random(count)]);
    const rebuilt = fresh(position.toFen({ rawEnPassant: true }));
    assert.equal(position.pieceSquareMg, rebuilt.pieceSquareMg);
    assert.equal(position.pieceSquareEg, rebuilt.pieceSquareEg);
  }
  const deep = position.pieceSquareMg;
  while (position.ply > 0) position.undo();
  assert.equal(position.pieceSquareMg, fresh(game.fen()).pieceSquareMg);
  assert.notEqual(deep, 0);
  // Switching tables mid-line would leave stale sums in the undo frames.
  position.makeMoveCode(buffer[0]);
  assert.throws(() => position.usePieceSquareTables(PIECE_SQUARE_MG, PIECE_SQUARE_EG), /root/);
});

test('changed weights change the kernel evaluation in the expected direction', () => {
  const tuning = { ...DEFAULT_AI_TUNING };
  const fen = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3';
  const base = new KernelEvaluator(tuning).evaluate(new SearchPosition(fen), 'w');
  // Ten more tempo for the side to move.
  const tempo = new KernelEvaluator(tuning, 12, withChange((v) => { v[WEIGHT_OFFSETS.tempo] += 10; }));
  assert.equal(tempo.evaluate(new SearchPosition(fen), 'w'), base + 10);
  // A knight worth 24 more in both phases, on a board where only white has one.
  const knights = new KernelEvaluator(tuning, 12, withChange((v) => { v[WEIGHT_OFFSETS.materialMg + 2] += 24; v[WEIGHT_OFFSETS.materialEg + 2] += 24; }));
  const unbalanced = '4k3/8/8/8/8/8/8/1N2K3 w - - 0 1';
  const plain = new KernelEvaluator(tuning).evaluate(new SearchPosition(unbalanced), 'w');
  assert.equal(knights.evaluate(new SearchPosition(unbalanced), 'w'), plain + 24);
  assert.equal(knights.evaluate(new SearchPosition(unbalanced), 'b'), -(plain + 24));
});

test('the kernel pawn structure with default weights equals the shared one in both phases', async () => {
  const { evaluatePawnStructure, lastPassedPawnScore, DEFAULT_EVAL_WEIGHTS } = await import('../../src/utils/chess-ai/chessAIEvaluation');
  const { kernelPawnStructure } = await import('../../src/utils/chess-ai/independent/kernelEvaluation');
  let seed = 99;
  const random = (n: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
  const out = [0, 0];
  for (let trial = 0; trial < 5000; trial += 1) {
    const mine = new Uint8Array(8); const theirs = new Uint8Array(8);
    // Pawns on ranks 1..6 (indices), random density.
    for (let file = 0; file < 8; file += 1) {
      for (let rank = 1; rank < 7; rank += 1) {
        if (random(6) === 0) mine[file] |= 1 << rank;
        else if (random(6) === 0) theirs[file] |= 1 << rank;
      }
    }
    for (const white of [true, false]) for (const enableBackwardPawn of [true, false]) {
      const tuning = { ...DEFAULT_AI_TUNING, enableBackwardPawn };
      const sharedPassed = new Uint8Array(8); const kernelPassed = new Uint8Array(8);
      const total = evaluatePawnStructure(mine, theirs, white ? 'w' : 'b', tuning, sharedPassed, DEFAULT_EVAL_WEIGHTS);
      const passed = lastPassedPawnScore();
      kernelPawnStructure(mine, theirs, white, tuning, kernelPassed, DEFAULT_KERNEL_EVAL_WEIGHTS, out);
      assert.deepEqual(kernelPassed, sharedPassed);
      assert.equal(out[0], total - passed + (passed * DEFAULT_EVAL_WEIGHTS.passedPawnMgPct) / 100);
      assert.equal(out[1], total - passed + (passed * DEFAULT_EVAL_WEIGHTS.passedPawnEgPct) / 100);
    }
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_AI_TUNING } from '../../src/utils/chess-ai/chessAITuning';
import { searchState } from '../../src/utils/chess-ai/chessAISearchDiagnostics';
import { setSearchDeadline } from '../../src/utils/chess-ai/chessAISearchTiming';
import { DEFAULT_KERNEL_EVAL_WEIGHTS, flattenWeights, pieceSquareTables } from '../../src/utils/chess-ai/independent/kernelEvalWeights';
import { KernelEvaluator } from '../../src/utils/chess-ai/independent/kernelEvaluation';
import {
  ALL_FEATURES, KERNEL_FEATURES, kernelStaticAndQuiescence, REFERENCE_FEATURES, runKernelSearch,
} from '../../src/utils/chess-ai/independent/kernelSearch';
import { TUNED_KERNEL_EVAL_WEIGHTS } from '../../src/utils/chess-ai/independent/kernelTunedWeights';
import { MAX_MOVES } from '../../src/utils/chess-ai/independent/moveCode';
import { SearchPosition } from '../../src/utils/chess-ai/searchPosition';

const FENS = [
  'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3',
  'r3k2r/pp1n1ppp/2p1pn2/q7/1bPP4/2N1PN2/PP1B1PPP/R2QKB1R b KQkq - 4 9',
  '8/5pk1/6p1/3P4/1p6/1P3KP1/8/8 w - - 0 45',
  '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1',
];

test('the tuned evaluation is the default (SPRT at 100 ms and 1 s), off in the reference', () => {
  assert.equal(REFERENCE_FEATURES.tunedEvaluation, false);
  assert.equal(KERNEL_FEATURES.tunedEvaluation, true);
  assert.equal(ALL_FEATURES.tunedEvaluation, true);
});

test('the tuned weights are a complete, valid weight set', () => {
  assert.equal(flattenWeights(TUNED_KERNEL_EVAL_WEIGHTS).length, flattenWeights(DEFAULT_KERNEL_EVAL_WEIGHTS).length);
  // Integers where SearchPosition and the pawn table need them.
  pieceSquareTables(TUNED_KERNEL_EVAL_WEIGHTS);
  new KernelEvaluator(DEFAULT_AI_TUNING, 12, TUNED_KERNEL_EVAL_WEIGHTS);
  // The weights the tuner never changes.
  assert.deepEqual(TUNED_KERNEL_EVAL_WEIGHTS.kingAttackByType, DEFAULT_KERNEL_EVAL_WEIGHTS.kingAttackByType);
  assert.equal(TUNED_KERNEL_EVAL_WEIGHTS.kingSafetyPct, DEFAULT_KERNEL_EVAL_WEIGHTS.kingSafetyPct);
});

test('with the flag the kernel evaluates with the tuned weights, without it with the defaults', () => {
  for (const fen of FENS) {
    const turn = fen.split(' ')[1] as 'w' | 'b';
    const tuned = new KernelEvaluator(DEFAULT_AI_TUNING, 12, TUNED_KERNEL_EVAL_WEIGHTS).evaluate(new SearchPosition(fen), turn);
    const plain = new KernelEvaluator(DEFAULT_AI_TUNING).evaluate(new SearchPosition(fen), turn);
    assert.equal(kernelStaticAndQuiescence(new SearchPosition(fen), DEFAULT_AI_TUNING, { ...KERNEL_FEATURES, tunedEvaluation: true }).staticEval, tuned);
    assert.equal(kernelStaticAndQuiescence(new SearchPosition(fen), DEFAULT_AI_TUNING, { ...KERNEL_FEATURES, tunedEvaluation: false }).staticEval, plain);
  }
});

test('a tuned search switches the root position to the tuned tables and leaves it consistent', () => {
  for (const fen of FENS) {
    const position = new SearchPosition(fen);
    const buffer = new Int32Array(MAX_MOVES);
    const rootOrder = Array.from(buffer.subarray(0, position.generateMoveCodes(buffer)));
    searchState.searchAborted = false;
    const result = runKernelSearch(position, rootOrder, { color: position.turn, tuning: DEFAULT_AI_TUNING, difficulty: 'expert',
      maxDepth: 4, openingPhase: false, previousOwnMove: null, firstDepthDeadline: Infinity, softDeadline: Infinity,
      hardDeadline: Infinity, features: KERNEL_FEATURES });
    setSearchDeadline(Infinity);
    assert.equal(result.completedDepth, 4);
    const tables = pieceSquareTables(TUNED_KERNEL_EVAL_WEIGHTS);
    assert.equal(position.pieceSquareTableMg, tables.mg);
    const fresh = new SearchPosition(fen);
    fresh.usePieceSquareTables(tables.mg, tables.eg);
    assert.equal(position.pieceSquareMg, fresh.pieceSquareMg);
    assert.equal(position.pieceSquareEg, fresh.pieceSquareEg);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_AI_TUNING } from '../../src/utils/chess-ai/chessAITuning';
import {
  DEFAULT_KERNEL_EVAL_WEIGHTS, flattenWeights, unflattenWeights, WEIGHT_COUNT, WEIGHT_OFFSETS,
} from '../../src/utils/chess-ai/independent/kernelEvalWeights';
import { KernelEvaluator } from '../../src/utils/chess-ai/independent/kernelEvaluation';
import { MAX_MOVES } from '../../src/utils/chess-ai/independent/moveCode';
import { SearchPosition } from '../../src/utils/chess-ai/searchPosition';
import { extractFeatures, linearEvaluation, WEIGHT_CLASS } from '../../research/scripts/texel/features';
import {
  buildDataset, evaluateAll, exactMeanSquaredError, fitK, meanSquaredError, sigmoid, tune,
} from '../../research/scripts/texel/tuner';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/** FENs from seeded random games that favour captures, so endgames and passed pawns appear. */
const randomFens = (games: number, plies: number, seed0: number): string[] => {
  let seed = seed0;
  const random = (n: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
  const fens: string[] = [];
  const buffer = new Int32Array(MAX_MOVES);
  for (let g = 0; g < games; g += 1) {
    const position = new SearchPosition(START);
    for (let ply = 0; ply < plies; ply += 1) {
      const count = position.generateMoveCodes(buffer);
      if (count === 0 || position.isInsufficientMaterial()) break;
      const captures: number[] = [];
      for (let i = 0; i < count; i += 1) if (position.squares[(buffer[i] >> 6) & 63] !== 0) captures.push(buffer[i]);
      position.makeMoveCode(captures.length && random(3) === 0 ? captures[random(captures.length)] : buffer[random(count)]);
      fens.push(position.toFen());
    }
  }
  return fens;
};

const TUNABLE = (i: number) => WEIGHT_CLASS[i] !== 'fixed';
const perturbed = (seed0: number, size: number): Float64Array => {
  let seed = seed0;
  const random = (n: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
  const vector = flattenWeights(DEFAULT_KERNEL_EVAL_WEIGHTS);
  for (let i = 0; i < WEIGHT_COUNT; i += 1) if (TUNABLE(i)) vector[i] += random(2 * size + 1) - size;
  return vector;
};

test('the linear features reproduce the kernel evaluation exactly for any weights', () => {
  const fens = randomFens(12, 140, 0x7e5e1);
  const variants = [{}, { enableNonlinearKingSafety: false }, { enableBackwardPawn: false, enableKnightOutpost: false },
    { enablePassedPawnKingDistance: false, enableRookBehindPassedPawn: false, enableTempoBonus: false }];
  let compared = 0;
  for (const [v, variant] of variants.entries()) {
    const tuning = { ...DEFAULT_AI_TUNING, ...variant };
    for (const vector of [flattenWeights(DEFAULT_KERNEL_EVAL_WEIGHTS), perturbed(11 + v, 6), perturbed(97 + v, 40)]) {
      const evaluator = new KernelEvaluator(tuning, 12, unflattenWeights(vector));
      for (const fen of fens) {
        const features = extractFeatures(new SearchPosition(fen), tuning);
        // + 0 folds -0 into 0.
        assert.equal(linearEvaluation(features, vector) + 0, evaluator.evaluate(new SearchPosition(fen), 'w') + 0, `${fen} ${JSON.stringify(variant)}`);
        compared += 1;
      }
    }
  }
  assert.ok(compared > 15000, `${compared}`);
});

// A synthetic data set: real positions, results drawn from known weights and a known K.
const synthetic = (() => {
  const fens = randomFens(30, 120, 0x51a7);
  const features = fens.map((fen) => extractFeatures(new SearchPosition(fen), DEFAULT_AI_TUNING));
  const truth = flattenWeights(DEFAULT_KERNEL_EVAL_WEIGHTS);
  truth[WEIGHT_OFFSETS.materialMg + 2] += 40; // knight
  truth[WEIGHT_OFFSETS.materialEg + 3] -= 30; // bishop
  truth[WEIGHT_OFFSETS.materialMg + 4] += 25; // rook
  truth[WEIGHT_OFFSETS.mobilityMg + 3] += 4;
  truth[WEIGHT_OFFSETS.tempo] += 12;
  const k = 1.3;
  const probe = buildDataset(features, new Float64Array(features.length));
  const results = Array.from(evaluateAll(probe, truth), (e) => sigmoid(e, k));
  return { data: buildDataset(features, results), truth, k };
})();

test('fitK recovers the scaling constant of the results', () => {
  const k = fitK(synthetic.data, synthetic.truth);
  assert.ok(Math.abs(k - synthetic.k) < 0.01, `${k}`);
});

test('coordinate descent recovers known weights from the default start', () => {
  const chosen = [WEIGHT_OFFSETS.materialMg + 2, WEIGHT_OFFSETS.materialEg + 3, WEIGHT_OFFSETS.materialMg + 4,
    WEIGHT_OFFSETS.mobilityMg + 3, WEIGHT_OFFSETS.tempo];
  const start = flattenWeights(DEFAULT_KERNEL_EVAL_WEIGHTS);
  const errors: number[] = [];
  const tuned = tune(synthetic.data, start, synthetic.k, {
    tunable: (i) => chosen.includes(i), steps: [8, 4, 2, 1], onPass: (_pass, _step, error) => { errors.push(error); },
  });
  for (const i of chosen) assert.ok(Math.abs(tuned[i] - synthetic.truth[i]) <= 1, `weight ${i}: ${tuned[i]} vs ${synthetic.truth[i]}`);
  for (let i = 0; i < WEIGHT_COUNT; i += 1) if (!chosen.includes(i)) assert.equal(tuned[i], start[i]);
  // The error never rises and ends near zero; tuned weights stay integers.
  for (let p = 1; p < errors.length; p += 1) assert.ok(errors[p] <= errors[p - 1] + 1e-15);
  assert.ok(meanSquaredError(synthetic.data, evaluateAll(synthetic.data, tuned), synthetic.k) < 1e-5);
  assert.ok(tuned.every(Number.isInteger));
  // The running error agrees with a fresh computation, and the rounded error is close.
  assert.ok(Math.abs(errors[errors.length - 1] - meanSquaredError(synthetic.data, evaluateAll(synthetic.data, tuned), synthetic.k)) < 1e-9);
  assert.ok(exactMeanSquaredError(synthetic.data, tuned, synthetic.k) < 1e-4);
});

test('tuning every weight lowers the error and leaves the fixed weights alone', () => {
  const start = flattenWeights(DEFAULT_KERNEL_EVAL_WEIGHTS);
  const before = meanSquaredError(synthetic.data, evaluateAll(synthetic.data, start), synthetic.k);
  const tuned = tune(synthetic.data, start, synthetic.k, { tunable: TUNABLE, steps: [4, 1], maxPasses: 4 });
  const after = meanSquaredError(synthetic.data, evaluateAll(synthetic.data, tuned), synthetic.k);
  assert.ok(after < before / 2, `${before} -> ${after}`);
  for (let i = 0; i < WEIGHT_COUNT; i += 1) if (WEIGHT_CLASS[i] === 'fixed') assert.equal(tuned[i], start[i]);
});

test('an L2 pull toward the start limits how far the weights move', () => {
  const chosen = [WEIGHT_OFFSETS.materialMg + 2, WEIGHT_OFFSETS.tempo];
  const start = flattenWeights(DEFAULT_KERNEL_EVAL_WEIGHTS);
  const free = tune(synthetic.data, start, synthetic.k, { tunable: (i) => chosen.includes(i), steps: [1] });
  const pulled = tune(synthetic.data, start, synthetic.k, { tunable: (i) => chosen.includes(i), steps: [1], l2: 1e-6 });
  const frozen = tune(synthetic.data, start, synthetic.k, { tunable: (i) => chosen.includes(i), steps: [1], l2: 1 });
  for (const i of chosen) {
    assert.ok(Math.abs(pulled[i] - start[i]) <= Math.abs(free[i] - start[i]), `${i}`);
    assert.equal(frozen[i], start[i]);
  }
  assert.ok(Math.abs(pulled[chosen[0]] - start[chosen[0]]) < Math.abs(free[chosen[0]] - start[chosen[0]]));
});

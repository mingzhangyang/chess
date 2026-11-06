/**
 * Texel tuning (phase 11): the evaluation, mapped to an expected score by
 * sigma(E) = 1 / (1 + 10^(-K E / 400)), is fitted to game results by
 * minimising the mean squared error.
 *
 * - fitK finds the scaling constant K for fixed weights (golden-section search).
 * - tune runs coordinate descent on integer weights: in each pass every
 *   tunable weight moves by at most one step (+step, else -step) if that
 *   lowers the error; passes repeat until none moves, then the step shrinks.
 *   Weights whose feature occurs in fewer than minPositions positions stay. The error change of one weight is computed
 *   only over the positions whose features contain it.
 *
 * Evaluations here are continuous (not rounded to a centipawn): the features
 * are linear (features.ts). The exact, rounded error is reported separately.
 */
import { MAX_PHASE } from '../../../src/utils/chess-ai/chessAIEvaluation';
import { WEIGHT_COUNT, WEIGHT_OFFSETS } from '../../../src/utils/chess-ai/independent/kernelEvalWeights';
import { linearEvaluation, WEIGHT_CLASS, type PositionFeatures } from './features';

export type Dataset = {
  count: number;
  result: Float64Array;
  /** Continuous evaluation = base + sum over this position's entries of weight * effective coefficient. */
  base: Float64Array;
  /** Per weight: the positions and effective coefficients (phase factor included). */
  weightStart: Int32Array;
  weightPosition: Int32Array;
  weightCoef: Float64Array;
  /** The features, for exact (rounded) evaluation. */
  features: PositionFeatures[];
};

const TEMPO = WEIGHT_OFFSETS.tempo;

export const buildDataset = (features: PositionFeatures[], results: ArrayLike<number>): Dataset => {
  const count = features.length;
  const base = new Float64Array(count);
  const counts = new Int32Array(WEIGHT_COUNT + 1);
  for (const f of features) {
    for (const i of f.index) counts[i + 1] += 1;
    if (f.tempoSign !== 0) counts[TEMPO + 1] += 1;
  }
  const weightStart = new Int32Array(WEIGHT_COUNT + 1);
  for (let i = 0; i < WEIGHT_COUNT; i += 1) weightStart[i + 1] = weightStart[i] + counts[i + 1];
  const fill = weightStart.slice(0, WEIGHT_COUNT);
  const total = weightStart[WEIGHT_COUNT];
  const weightPosition = new Int32Array(total);
  const weightCoef = new Float64Array(total);
  features.forEach((f, p) => {
    const mgShare = f.phase / MAX_PHASE;
    base[p] = f.constMg * mgShare + f.constEg * (1 - mgShare);
    for (let k = 0; k < f.index.length; k += 1) {
      const i = f.index[k];
      const at = fill[i]++;
      weightPosition[at] = p;
      weightCoef[at] = f.coef[k] * (WEIGHT_CLASS[i] === 'mg' ? mgShare : 1 - mgShare);
    }
    if (f.tempoSign !== 0) { const at = fill[TEMPO]++; weightPosition[at] = p; weightCoef[at] = f.tempoSign; }
  });
  return { count, result: Float64Array.from(results), base, weightStart, weightPosition, weightCoef, features };
};

/** Continuous evaluations of every position with `weights`. */
export const evaluateAll = (data: Dataset, weights: ArrayLike<number>): Float64Array => {
  const evals = Float64Array.from(data.base);
  for (let i = 0; i < WEIGHT_COUNT; i += 1) {
    const w = weights[i];
    if (w === 0) continue;
    for (let at = data.weightStart[i]; at < data.weightStart[i + 1]; at += 1) evals[data.weightPosition[at]] += w * data.weightCoef[at];
  }
  return evals;
};

export const sigmoid = (evaluation: number, k: number): number => 1 / (1 + 10 ** (-k * evaluation / 400));

export const meanSquaredError = (data: Dataset, evals: ArrayLike<number>, k: number): number => {
  let sum = 0;
  for (let p = 0; p < data.count; p += 1) { const e = data.result[p] - sigmoid(evals[p], k); sum += e * e; }
  return sum / data.count;
};

/** The error with the kernel's exact, rounded evaluations. */
export const exactMeanSquaredError = (data: Dataset, weights: ArrayLike<number>, k: number): number => {
  let sum = 0;
  for (let p = 0; p < data.count; p += 1) {
    const e = data.result[p] - sigmoid(linearEvaluation(data.features[p], weights), k);
    sum += e * e;
  }
  return sum / data.count;
};

/** K minimising the error for fixed weights, by golden-section search on [lo, hi]. */
export const fitK = (data: Dataset, weights: ArrayLike<number>, lo = 0.05, hi = 5, tolerance = 1e-4): number => {
  const evals = evaluateAll(data, weights);
  const ratio = (Math.sqrt(5) - 1) / 2;
  let a = lo; let b = hi;
  let c = b - ratio * (b - a); let d = a + ratio * (b - a);
  let fc = meanSquaredError(data, evals, c); let fd = meanSquaredError(data, evals, d);
  while (b - a > tolerance) {
    if (fc < fd) { b = d; d = c; fd = fc; c = b - ratio * (b - a); fc = meanSquaredError(data, evals, c); }
    else { a = c; c = d; fc = fd; d = a + ratio * (b - a); fd = meanSquaredError(data, evals, d); }
  }
  return (a + b) / 2;
};

export type TuneOptions = {
  /** Which flat weights may change. */
  tunable: (index: number) => boolean;
  /** Step sizes, largest first. */
  steps?: number[];
  maxPasses?: number;
  /** Moves per weight and pass (1, the classic rule). */
  movesPerPass?: number;
  /** Weights whose feature occurs in fewer positions are not tuned. */
  minPositions?: number;
  /** Penalty added to the mean squared error per squared centipawn a weight moves from its start (0: none). */
  l2?: number;
  /** Called after every pass with the training error (penalty included). */
  onPass?: (pass: number, step: number, trainError: number, weights: Float64Array) => void;
};

/** Coordinate descent from `initial`; returns the tuned weights (integers if the start is). */
export const tune = (data: Dataset, initial: ArrayLike<number>, k: number, options: TuneOptions): Float64Array => {
  const weights = Float64Array.from(initial);
  const evals = evaluateAll(data, weights);
  const { weightStart, weightPosition, weightCoef, result } = data;
  const steps = options.steps ?? [8, 4, 2, 1];
  const maxPasses = options.maxPasses ?? 50;
  const movesPerPass = options.movesPerPass ?? 1;
  const minPositions = options.minPositions ?? 1;
  const l2 = (options.l2 ?? 0) * data.count;
  const start = Float64Array.from(initial);
  let sse = meanSquaredError(data, evals, k) * data.count;
  /** Error change from adding `delta` to weight i. */
  const deltaError = (i: number, delta: number): number => {
    let change = 0;
    for (let at = weightStart[i]; at < weightStart[i + 1]; at += 1) {
      const p = weightPosition[at];
      const before = result[p] - sigmoid(evals[p], k);
      const after = result[p] - sigmoid(evals[p] + delta * weightCoef[at], k);
      change += after * after - before * before;
    }
    const from = weights[i] - start[i];
    return change + l2 * ((from + delta) ** 2 - from ** 2);
  };
  const apply = (i: number, delta: number) => {
    weights[i] += delta;
    for (let at = weightStart[i]; at < weightStart[i + 1]; at += 1) evals[weightPosition[at]] += delta * weightCoef[at];
  };
  const order = Array.from({ length: WEIGHT_COUNT }, (_, i) => i)
    .filter((i) => options.tunable(i) && WEIGHT_CLASS[i] !== 'fixed' && weightStart[i + 1] - weightStart[i] >= minPositions);
  let pass = 0;
  for (const step of steps) {
    for (;;) {
      if (pass >= maxPasses) return weights;
      pass += 1;
      let improved = false;
      for (const i of order) {
        for (const direction of [1, -1]) {
          let moved = false;
          for (let tries = 0; tries < movesPerPass; tries += 1) {
            const change = deltaError(i, direction * step);
            if (change >= -1e-12) break;
            apply(i, direction * step);
            sse += change; // the penalty included
            moved = true;
          }
          if (moved) { improved = true; break; }
        }
      }
      options.onPass?.(pass, step, sse / data.count, weights);
      if (!improved) break;
    }
  }
  return weights;
};

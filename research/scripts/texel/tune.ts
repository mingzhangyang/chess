/**
 * Texel tuning of the kernel evaluation (phase 11).
 *
 *   node --import tsx research/scripts/texel/tune.ts --extract   # games -> positions.jsonl (filtered, deduplicated)
 *   node --import tsx research/scripts/texel/tune.ts --tune      # positions -> tuned-weights.json and tune-summary.json
 *   node --import tsx research/scripts/texel/tune.ts --emit      # tuned-weights.json -> independent/kernelTunedWeights.ts
 *
 * Positions come from research/results/texel/games (selfplay.ts) in game-id
 * order, so the deduplication is deterministic. Games are split into a
 * training and a validation set (about one in five, by game id); K is fitted
 * on the training set with the default weights and then kept fixed.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { DEFAULT_AI_TUNING } from '../../../src/utils/chess-ai/chessAITuning';
import {
  DEFAULT_KERNEL_EVAL_WEIGHTS, flattenWeights, unflattenWeights, WEIGHT_COUNT, WEIGHT_FIELDS, WEIGHT_OFFSETS,
} from '../../../src/utils/chess-ai/independent/kernelEvalWeights';
import { SearchPosition } from '../../../src/utils/chess-ai/searchPosition';
import { extractPositions, splitTrainValidation, type DataPosition, type GameRecord } from './dataset';
import { extractFeatures, WEIGHT_CLASS } from './features';
import { buildDataset, evaluateAll, exactMeanSquaredError, fitK, meanSquaredError, tune } from './tuner';

const args = process.argv.slice(2);
const option = (name: string, fallback: string): string => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const ROOT = 'research/results/texel';
const GAMES_DIR = `${ROOT}/games`;
const POSITIONS = `${ROOT}/positions.jsonl`;
const STEPS = option('--steps', '8,4,2,1').split(',').map(Number);
const MAX_PASSES = Number(option('--max-passes', '200'));
const MIN_POSITIONS = Number(option('--min-positions', '1000'));
const L2 = Number(option('--l2', '0'));
const OUT = option('--out', `${ROOT}/tuned-weights.json`);
const SUMMARY = option('--summary', `${ROOT}/tune-summary.json`);

const readGames = (): GameRecord[] => readdirSync(GAMES_DIR).filter((f) => f.endsWith('.jsonl'))
  .flatMap((f) => readFileSync(`${GAMES_DIR}/${f}`, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as GameRecord))
  .sort((a, b) => a.id - b.id);

const extract = () => {
  const games = readGames();
  const seen = new Set<string>();
  const lines: string[] = [];
  let plies = 0;
  const started = Date.now();
  for (const [n, game] of games.entries()) {
    plies += game.moves.length + 1 - Math.max(16, game.openingPlies);
    for (const p of extractPositions(game, seen)) lines.push(JSON.stringify(p));
    if (n % 500 === 499) console.log(`${n + 1} games, ${lines.length} positions, ${((Date.now() - started) / 1000).toFixed(0)} s`);
  }
  writeFileSync(POSITIONS, `${lines.join('\n')}\n`);
  const results = games.map((g) => g.result);
  const summary = {
    games: games.length,
    whiteWins: results.filter((r) => r === 1).length,
    draws: results.filter((r) => r === 0.5).length,
    blackWins: results.filter((r) => r === 0).length,
    candidatePositions: plies,
    keptPositions: lines.length,
  };
  writeFileSync(`${ROOT}/dataset-summary.json`, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(summary);
};

const fieldOf = (index: number): string => {
  for (const field of WEIGHT_FIELDS) {
    const start = WEIGHT_OFFSETS[field.name];
    if (index >= start && index < start + field.length) return field.length === 1 ? field.name : `${field.name}[${index - start}]`;
  }
  return `#${index}`;
};

const tuneWeights = () => {
  if (!existsSync(POSITIONS)) throw new Error('run --extract first');
  const positions = readFileSync(POSITIONS, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as DataPosition);
  const sets = { train: [] as DataPosition[], validation: [] as DataPosition[] };
  for (const p of positions) sets[splitTrainValidation(p.game)].push(p);
  const build = (list: DataPosition[]) => buildDataset(
    list.map((p) => extractFeatures(new SearchPosition(p.fen), DEFAULT_AI_TUNING)), list.map((p) => p.result));
  const train = build(sets.train);
  const validation = build(sets.validation);
  const start = flattenWeights(DEFAULT_KERNEL_EVAL_WEIGHTS);
  const k = fitK(train, start);
  const error = (data: typeof train, w: ArrayLike<number>) => meanSquaredError(data, evaluateAll(data, w), k);
  const before = { train: error(train, start), validation: error(validation, start),
    trainExact: exactMeanSquaredError(train, start, k), validationExact: exactMeanSquaredError(validation, start, k) };
  console.log(`K ${k.toFixed(4)}; train ${train.count}, validation ${validation.count}; before`, before);
  const passes: { pass: number; step: number; train: number; validation: number }[] = [];
  let best = { validation: before.validation, weights: start, pass: 0 };
  const started = Date.now();
  tune(train, start, k, {
    tunable: (i) => WEIGHT_CLASS[i] !== 'fixed', steps: STEPS, maxPasses: MAX_PASSES, minPositions: MIN_POSITIONS, l2: L2,
    onPass: (pass, step, _objective, weights) => {
      const trainError = error(train, weights);
      const validationError = error(validation, weights);
      passes.push({ pass, step, train: trainError, validation: validationError });
      if (validationError < best.validation) best = { validation: validationError, weights: Float64Array.from(weights), pass };
      console.log(`pass ${pass} step ${step}: train ${trainError.toFixed(6)} validation ${validationError.toFixed(6)} (${((Date.now() - started) / 1000).toFixed(0)} s)`);
    },
  });
  const tuned = best.weights;
  const after = { train: error(train, tuned), validation: error(validation, tuned),
    trainExact: exactMeanSquaredError(train, tuned, k), validationExact: exactMeanSquaredError(validation, tuned, k) };
  const changes = Array.from({ length: WEIGHT_COUNT }, (_, i) => i).filter((i) => tuned[i] !== start[i])
    .map((i) => ({ weight: fieldOf(i), from: start[i], to: tuned[i] }));
  // Throws if a material or piece-square weight is not an integer.
  unflattenWeights(tuned);
  writeFileSync(OUT, `${JSON.stringify({ k, fields: WEIGHT_FIELDS.map((f) => f.name), weights: Array.from(tuned) })}\n`);
  writeFileSync(SUMMARY, `${JSON.stringify({ k, trainPositions: train.count, validationPositions: validation.count, steps: STEPS, minPositions: MIN_POSITIONS, l2: L2,
    bestPass: best.pass, before, after, passes, changedWeights: changes.length, changes }, null, 2)}\n`);
  console.log('after', after, `${changes.length} weights changed, best pass ${best.pass}`);
};

/** Write the tuned weights as the kernel's TUNED_KERNEL_EVAL_WEIGHTS module. */
const emit = () => {
  const { k, weights } = JSON.parse(readFileSync(OUT, 'utf8')) as { k: number; weights: number[] };
  const tuned = unflattenWeights(weights) as unknown as Record<string, number | number[] | number[][]>;
  const row = (values: readonly number[]) => `[${values.join(', ')}]`;
  const body = Object.entries(tuned).map(([name, value]) => {
    if (typeof value === 'number') return `  ${name}: ${value},`;
    if (Array.isArray(value[1])) {
      const rows = (value as number[][]).map((table) => (table.length === 0 ? '    [],'
        : `    [\n${Array.from({ length: 8 }, (_, r) => `      ${table.slice(r * 8, r * 8 + 8).join(', ')},`).join('\n')}\n    ],`));
      return `  ${name}: [\n${rows.join('\n')}\n  ],`;
    }
    return `  ${name}: ${row(value as number[])},`;
  }).join('\n');
  const source = `/**
 * The kernel's Texel-tuned evaluation weights (phase 11), used with the
 * tunedEvaluation kernel feature. Written by research/scripts/texel/tune.ts
 * --emit from research/results/texel/tuned-weights.json (K = ${k.toFixed(4)});
 * see research/search-position-phase11.md. Do not edit by hand.
 */
import type { KernelEvalWeights } from './kernelEvalWeights';

export const TUNED_KERNEL_EVAL_WEIGHTS: KernelEvalWeights = Object.freeze({
${body}
});
`;
  writeFileSync('src/utils/chess-ai/independent/kernelTunedWeights.ts', source);
  console.log('wrote src/utils/chess-ai/independent/kernelTunedWeights.ts');
};

if (args.includes('--extract')) extract();
else if (args.includes('--emit')) emit();
else if (args.includes('--tune')) tuneWeights();
else console.log('use --extract or --tune');

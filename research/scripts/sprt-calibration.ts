/**
 * Phase 12.2: audit the historical SPRT gates without replaying games or
 * pretending that a post-hoc shuffle creates independent outcomes.
 *
 * node --import tsx research/scripts/sprt-calibration.ts --output research/results/kernel-sprt/phase12-2-calibration.json
 *
 * A nominal fixed-sample Wilson interval is descriptive for early-stopped
 * experiments, NOT a sequentially valid confidence interval or evidence
 * about openings that were never played.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CALIBRATION_RUNS = [
  'final-default', 'package-all', 'ablate-persistentTable', 'symmetric-pruning',
  'batch2', 'tuned-eval-100ms', 'tuned-eval-1s', 'tuned-eval-300ms',
  'tuned-eval-300ms-matched',
] as const;

type GameScore = 0 | 0.5 | 1;
export type SprtRecord = { id: number; newColor: 'w' | 'b'; score: GameScore };
export type StockfishRecord = { id: number; opening: string[]; kernelColor: 'w' | 'b'; kernelScore: GameScore };
type Summary = { games?: number; wins?: number; draws?: number; losses?: number; elo?: number; moveTimeMs?: number; verdict?: string };

const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const round = (value: number, digits = 4): number => Number(value.toFixed(digits));
const rawElo = (score: number): number => {
  const bounded = Math.max(1e-9, Math.min(1 - 1e-9, score));
  return 400 * Math.log10(bounded / (1 - bounded));
};
const elo = (score: number): number => Math.round(rawElo(score));

const validateOpenings = (value: unknown): string[][] => {
  if (!Array.isArray(value) || value.length === 0 || !value.every((line: unknown) =>
    Array.isArray(line) && line.length > 0 && line.every((move: unknown) => typeof move === 'string' && move.length > 0))) {
    throw new Error('opening list must be a non-empty array of non-empty string move lists');
  }
  return value as string[][];
};

const classify = (openings: string[][], records: SprtRecord[]): {
  firstMoves: Record<string, { availableSlots: number; observedGames: number; score: number | null }>;
  totalVariation: number;
} => {
  const expected = new Map<string, number>();
  const grouped = new Map<string, { games: number; total: number }>();
  for (const line of openings) expected.set(line[0], (expected.get(line[0]) ?? 0) + 2);
  for (const rec of records) {
    const move = openings[Math.floor(rec.id / 2)][0];
    const group = grouped.get(move) ?? { games: 0, total: 0 };
    group.games += 1; group.total += rec.score;
    grouped.set(move, group);
  }
  const output: Record<string, { availableSlots: number; observedGames: number; score: number | null }> = {};
  let tv = 0;
  for (const first of [...expected.keys()].sort()) {
    const obs = grouped.get(first) ?? { games: 0, total: 0 };
    const availableSlots = expected.get(first)!;
    output[first] = { availableSlots, observedGames: obs.games,
      score: obs.games ? round(obs.total / obs.games) : null };
    tv += Math.abs(obs.games / records.length - availableSlots / (openings.length * 2));
  }
  return { firstMoves: output, totalVariation: round(tv / 2) };
};

/** Always checks every original ID; never fills unplayed slots with estimates. */
export const auditSprt = (name: string, openingsInput: unknown, records: SprtRecord[], summary: Summary = {}) => {
  const openings = validateOpenings(openingsInput);
  if (!records.length) throw new Error(`${name}: no completed games`);
  const ids = new Set<number>();
  for (const rec of records) {
    if (!Number.isInteger(rec.id) || rec.id < 0 || rec.id >= openings.length * 2)
      throw new Error(`${name}: invalid game ID ${rec.id}`);
    if (ids.has(rec.id)) throw new Error(`${name}: duplicate game ID ${rec.id}`);
    ids.add(rec.id);
    if (rec.newColor !== (rec.id % 2 === 0 ? 'w' : 'b')) throw new Error(`${name}: wrong color at ID ${rec.id}`);
    if (rec.score !== 0 && rec.score !== 0.5 && rec.score !== 1)
      throw new Error(`${name}: invalid score at ID ${rec.id}`);
  }
  const ordered = [...records].sort((a, b) => a.id - b.id);
  const wins = ordered.filter((r) => r.score === 1).length;
  const draws = ordered.filter((r) => r.score === 0.5).length;
  const losses = ordered.length - wins - draws;
  const score = (wins + draws / 2) / ordered.length;
  const actualElo = elo(score);
  for (const [key, actual] of Object.entries({ games: records.length, wins, draws, losses, elo: actualElo })) {
    if (summary[key as keyof Summary] !== undefined && summary[key as keyof Summary] !== actual)
      throw new Error(`${name}: committed summary ${key} does not match shard logs`);
  }
  const distinct = new Set(ordered.map((r) => Math.floor(r.id / 2))).size;
  const completedPairs = ordered.filter((r) => r.id % 2 === 0 && ids.has(r.id + 1)).length;
  const complete = records.length === openings.length * 2;
  const breakdown = classify(openings, ordered);
  const z = 1.96;
  const n = ordered.length;
  const centre = (score + z ** 2 / (2 * n)) / (1 + z ** 2 / n);
  const half = z / (1 + z ** 2 / n) * Math.sqrt(score * (1 - score) / n + z ** 2 / (4 * n ** 2));
  return {
    name, timeMs: summary.moveTimeMs ?? null, openingCount: openings.length,
    games: records.length, totalSlots: openings.length * 2, distinctOpenings: distinct,
    completeColorPairs: completedPairs, unpairedSlots: records.length - completedPairs * 2,
    wins, draws, losses, score: round(score), elo: actualElo,
    nominalWilson95Elo: [elo(centre - half), elo(centre + half)],
    openingDistributionTotalVariation: breakdown.totalVariation,
    firstMoves: breakdown.firstMoves,
    sample: complete ? 'full-opening-and-color-coverage' : 'early-stopped-or-partial',
    claim: complete ? 'full-slot fixed sample (still uncertain if CI includes zero)' :
      'partial coverage: cannot infer a full-opening Elo gain',
    historicalVerdict: summary.verdict ?? null,
    openingsSha256: hash(openings), recordsSha256: hash(ordered),
  };
};

export const parseJsonl = <T>(raw: string): T[] => raw.split('\n').map((x) => x.trim()).filter(Boolean).map((line) => JSON.parse(line) as T);

/** A file-backed summary must contain all required numeric totals and Elo.
 * Direct synthetic calls to auditSprt may still omit the summary entirely. */
export const parseSavedSummary = (raw: string, name: string): Summary => {
  const value: unknown = JSON.parse(raw);
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name}: saved summary must be a JSON object`);
  }
  const fields = value as Record<string, unknown>;
  for (const key of ['games', 'wins', 'draws', 'losses'] as const) {
    if (typeof fields[key] !== 'number' || !Number.isSafeInteger(fields[key]) || fields[key] < 0) {
      throw new Error(`${name}: saved summary ${key} must be a nonnegative integer`);
    }
  }
  if (typeof fields.elo !== 'number' || !Number.isFinite(fields.elo)) {
    throw new Error(`${name}: saved summary elo must be a finite number`);
  }
  return fields as Summary;
};

export const loadSprtAudit = (root: string, name: string) => {
  const folder = join(root, 'kernel-sprt', name);
  const raw: unknown = JSON.parse(readFileSync(join(folder, 'openings.json'), 'utf8'));
  const openings = validateOpenings(Array.isArray(raw) ? raw : (raw as { openings: unknown }).openings);
  const files = readdirSync(folder).filter((f) => /^shard-\d+\.jsonl$/.test(f)).sort();
  if (!files.length) throw new Error(`${name}: no shard logs`);
  const records = files.flatMap((f) => parseJsonl<SprtRecord>(readFileSync(join(folder, f), 'utf8')));
  const summary = parseSavedSummary(readFileSync(join(root, 'kernel-sprt', `${name}-summary.json`), 'utf8'), name);
  return auditSprt(name, openings, records, summary);
};

/** A Stockfish slot number fixes its color, even if both archives agree on a wrong color. */
const validStockfishColorSlot = (record: StockfishRecord): boolean =>
  Number.isSafeInteger(record.id) && record.id >= 0 &&
  record.kernelColor === (record.id % 2 === 0 ? 'w' : 'b');

/** Compare identical opening AND color slots, never aggregate unmatched games. */
export const compareStockfishSlots = (older: StockfishRecord[], newer: StockfishRecord[]) => {
  const previous = new Map<number, StockfishRecord>();
  for (const r of older) {
    if (!validStockfishColorSlot(r)) throw new Error(`Stockfish opening/color slot mismatch at ${r.id}`);
    if (previous.has(r.id)) throw new Error(`duplicate baseline stockfish slot ${r.id}`);
    previous.set(r.id, r);
  }
  if (!older.length || newer.length !== older.length) throw new Error('Stockfish samples are incomplete or unequal');
  const seen = new Set<number>();
  let oldTotal = 0, newTotal = 0;
  const byFirst = new Map<string, { games: number; difference: number }>();
  for (const next of newer) {
    const old = previous.get(next.id);
    if (!validStockfishColorSlot(next) || !old || seen.has(next.id) ||
      JSON.stringify(old.opening) !== JSON.stringify(next.opening) ||
      old.kernelColor !== next.kernelColor) throw new Error(`Stockfish opening/color slot mismatch at ${next.id}`);
    if (![0, 0.5, 1].includes(old.kernelScore) || ![0, 0.5, 1].includes(next.kernelScore))
      throw new Error('invalid Stockfish score');
    seen.add(next.id);
    oldTotal += old.kernelScore; newTotal += next.kernelScore;
    const first = next.opening[0];
    const entry = byFirst.get(first) ?? { games: 0, difference: 0 };
    entry.games += 1; entry.difference += next.kernelScore - old.kernelScore;
    byFirst.set(first, entry);
  }
  const oldScore = oldTotal / older.length;
  const newScore = newTotal / newer.length;
  return { slots: newer.length, oldScore: round(oldScore), newScore: round(newScore),
    scoreDifference: round(newScore - oldScore), eloDifference: Math.round(rawElo(newScore) - rawElo(oldScore)),
    byFirstMove: Object.fromEntries([...byFirst.entries()].sort().map(([key, x]) =>
      [key, { slots: x.games, scoreDifference: round(x.difference / x.games) }])),
    baselineSha256: hash([...older].sort((a, b) => a.id - b.id).map((r) => [r.id, r.opening, r.kernelColor, r.kernelScore])),
    candidateSha256: hash([...newer].sort((a, b) => a.id - b.id).map((r) => [r.id, r.opening, r.kernelColor, r.kernelScore])),
  };
};

/** Validate the archived Stockfish records against the exact self-play slot map. */
export const validateStockfishSlotsAgainstOpenings = (records: StockfishRecord[], openingsInput: unknown): void => {
  const openings = validateOpenings(openingsInput);
  const totalSlots = openings.length * 2;
  if (records.length !== totalSlots) throw new Error('Phase 11 matched self-play/Stockfish opening/color slots differ');
  const seen = new Set<number>();
  for (const record of records) {
    if (!validStockfishColorSlot(record) || record.id >= totalSlots || seen.has(record.id) ||
        JSON.stringify(record.opening) !== JSON.stringify(openings[Math.floor(record.id / 2)])) {
      throw new Error(`Phase 11 matched self-play/Stockfish opening/color slot mismatch at ${record.id}`);
    }
    seen.add(record.id);
  }
};

export const createCalibration = (root: string) => {
  const runs = CALIBRATION_RUNS.map((name) => loadSprtAudit(root, name));
  const readStockfish = (phase: 'phase10' | 'phase11'): StockfishRecord[] =>
    parseJsonl<StockfishRecord>(readFileSync(join(root,
      `kernel-vs-stockfish-skill6-300ms-${phase}`, 'shard-0.jsonl'), 'utf8'));
  const stockfishSkill6 = compareStockfishSlots(readStockfish('phase10'), readStockfish('phase11'));
  const matchedOpenings = JSON.parse(readFileSync(join(root, 'kernel-sprt', 'tuned-eval-300ms-matched', 'openings.json'), 'utf8')) as string[][];
  const stockfishSlots = readStockfish('phase11');
  validateStockfishSlotsAgainstOpenings(stockfishSlots, matchedOpenings);
  return { schemaVersion: 1,
    methodology: 'retrospective raw-log audit, not a new shuffled match',
    uncertainty: 'Wilson intervals on early-stopped data are descriptive, not sequentially valid or representative of unplayed openings',
    runs, stockfishSkill6 };
};

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const at = args.indexOf('--output');
  if (at >= 0 && !args[at + 1]) throw new Error('--output requires a file path');
  if (args.some((arg, i) => arg.startsWith('--') && (arg !== '--output' || i !== at))) throw new Error('unknown calibration option');
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'results');
  const report = `${JSON.stringify(createCalibration(root), null, 2)}\n`;
  if (at >= 0) writeFileSync(args[at + 1], report);
  else process.stdout.write(report);
}

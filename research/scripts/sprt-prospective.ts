/** Immutable prospective SPRT provenance, single-writer shard locks, and raw-log audit.
 * No engine imports: reports can be regenerated without chess.js or tsx. */
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { closeSync, existsSync, openSync, readFileSync, realpathSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { publishOnce } from './sprt-stats.ts';
import { openingSlotForGame, parseOpeningList, readRunOpeningOrder } from './sprt-openings.ts';

export type SearchTotals = { moves: number; completedDepthSum: number; nodes: number; qNodes: number; elapsedMs: number };
export type ProspectiveGame = {
  id: number; newColor: 'w' | 'b'; score: number; reason: string; plies: number;
  opening: string[]; moves: string[]; search: { new: SearchTotals; base: SearchTotals };
};
export type ExperimentManifest = {
  schemaVersion: 1; candidateSha: string; baselineSha: string;
  moveTimeMs: number; maxPlies: number; maxGames: number; minGames: number;
  elo0: number; elo1: number; alpha: number; beta: number;
  shards: number; stopAtVerdict: boolean; newFeatures: object | null; baseFeatures: object | null;
  openingSnapshotSha256: string;
  openingOrder: { mode: string; seed: number | null; openings: number; sourceSha256?: string };
};

export const sha256 = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');
export const gitHead = (dir: string): string => execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
export const gitIsClean = (dir: string): boolean => execFileSync('git', ['-C', dir, 'status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim() === '';
export const snapshotIdentity = (file: string) => {
  const order = readRunOpeningOrder(file);
  if (!order) throw new Error(`missing opening snapshot: ${file}`);
  return { openingSnapshotSha256: sha256(readFileSync(file)), openingOrder: order };
};
const record = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x);
const sha = (x: unknown) => typeof x === 'string' && /^[a-f0-9]{40}$/.test(x);

/** Resolve the enclosing git checkout, not just the path spelling; reject symlinks and nested aliases. */
export const assertSeparateWorktrees = (candidate: string, baseline: string): void => {
  const worktree = (dir: string) => realpathSync(execFileSync('git',
    ['-C', dir, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim());
  if (worktree(candidate) === worktree(baseline)) {
    throw new Error('baseline checkout aliases the candidate checkout: use an independent git worktree');
  }
};

/** No unsafe casts from persisted JSON: a bad manifest must fail before producing Elo or an SPRT verdict. */
export const parseExperimentManifest = (input: unknown): ExperimentManifest => {
  if (!record(input)) throw new Error('invalid prospective experiment manifest: expected an object');
  const nonnegativeInt = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
  const positiveInt = (v: unknown): v is number => nonnegativeInt(v) && v > 0;
  const positiveNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;
  const probability = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 0.5;
  const hash64 = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
  const featureFlags = (v: unknown) => v === null || (record(v) &&
    Object.values(v).every((x) => typeof x === 'boolean'));
  const o = input.openingOrder;
  const validOrder = record(o) && positiveInt(o.openings) &&
    (o.mode === 'seeded-shuffle' || o.mode === 'as-provided' || o.mode === 'legacy-unshuffled') &&
    (o.mode === 'seeded-shuffle'
      ? nonnegativeInt(o.seed) && o.seed <= 0xffffffff && hash64(o.sourceSha256)
      : o.seed === null && (o.mode === 'legacy-unshuffled' ? o.sourceSha256 === undefined : hash64(o.sourceSha256)));
  if (input.schemaVersion !== 1 || !sha(input.candidateSha) || !sha(input.baselineSha) ||
      !positiveNumber(input.moveTimeMs) || !positiveInt(input.maxPlies) ||
      !positiveInt(input.maxGames) || !positiveInt(input.minGames) ||
      typeof input.elo0 !== 'number' || !Number.isFinite(input.elo0) ||
      typeof input.elo1 !== 'number' || !Number.isFinite(input.elo1) ||
      input.elo1 <= input.elo0 || !probability(input.alpha) || !probability(input.beta) ||
      !positiveInt(input.shards) || typeof input.stopAtVerdict !== 'boolean' ||
      !featureFlags(input.newFeatures) || !featureFlags(input.baseFeatures) ||
      !hash64(input.openingSnapshotSha256) || !validOrder ||
      input.maxGames > (o as Record<string, number>).openings * 2) {
    throw new Error('invalid prospective experiment manifest: required SHA/configuration/hypothesis/openings fields');
  }
  return input as ExperimentManifest;
};

/** Use the immutable opening snapshot and manifest as one experiment identity. */
export const establishExperiment = (dir: string, expected: ExperimentManifest): ExperimentManifest => {
  parseExperimentManifest(expected);
  const file = join(dir, 'experiment.json');
  if (!existsSync(file) && readdirSync(dir).some((name) => /^shard-\d+\.jsonl$/.test(name))) {
    throw new Error('existing shard logs have no experiment identity: use a fresh --name');
  }
  if (!existsSync(file)) publishOnce(file, `${JSON.stringify(expected, null, 2)}\n`);
  const actual: unknown = JSON.parse(readFileSync(file, 'utf8'));
  // A corrupted persisted manifest is an error, not a trustworthy source of experimental parameters.
  const parsed = parseExperimentManifest(actual);
  if (JSON.stringify(parsed) !== JSON.stringify(expected)) {
    throw new Error('experiment SHA/configuration/shard count/opening seed or list differs: use a fresh --name');
  }
  return parsed;
};

/** An active shard cannot be started twice; a crash leaves a lock requiring explicit inspection. */
export const withShardLock = async <T>(dir: string, shard: number, task: () => Promise<T>): Promise<T> => {
  const file = join(dir, `shard-${shard}.lock`);
  const token = `${hostname()}:${process.pid}:${randomUUID()}`;
  let fd: number;
  try { fd = openSync(file, 'wx'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(`shard ${shard} already locked; verify the former process has exited before manually removing ${file}`);
    }
    throw error;
  }
  try {
    writeFileSync(fd, `${token}\n`);
    return await task();
  } finally {
    closeSync(fd);
    if (readFileSync(file, 'utf8').trim() === token) unlinkSync(file);
  }
};

/** Per-shard atomic copy-on-write JSONL avoids readers observing partial appends. */
export const persistProspectiveGame = (file: string, game: ProspectiveGame): void => {
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    const previous = existsSync(file) ? readFileSync(file, 'utf8') : '';
    if (previous && !previous.endsWith('\n')) throw new Error('shard JSONL is incomplete; inspect before resuming');
    writeFileSync(temp, `${previous}${JSON.stringify(game)}\n`, { flag: 'wx' });
    renameSync(temp, file);
  } finally {
    if (existsSync(temp)) unlinkSync(temp);
  }
};

const finiteNonnegative = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x >= 0;
const validTotals = (x: unknown): x is SearchTotals => record(x) &&
  ['moves', 'completedDepthSum', 'nodes', 'qNodes'].every((k) => Number.isSafeInteger(x[k]) && (x[k] as number) >= 0) &&
  finiteNonnegative(x.elapsedMs);
const rawElo = (p: number): number => 400 * Math.log10(Math.max(1e-9, Math.min(1 - 1e-9, p)) /
  (1 - Math.max(1e-9, Math.min(1 - 1e-9, p))));
const round = (n: number, d = 4) => Number(n.toFixed(d));
const DRAW_REASONS = new Set(['stalemate', 'threefold', 'insufficient', 'fiftyMove', 'draw', 'maxPlies']);
const outcomeMatches = (reason: unknown, score: unknown, plies: number, newColor: 'w' | 'b'): boolean => {
  if (DRAW_REASONS.has(reason as string)) return score === 0.5;
  if (reason !== 'checkmate') return false;
  // After N plies, the winning color at checkmate is the color that made ply N.
  const winner = plies % 2 === 1 ? 'w' : 'b';
  return score === (winner === newColor ? 1 : 0);
};
const movesByNewKernel = (openingPlies: number, totalPlies: number, newColor: 'w' | 'b'): number => {
  const played = totalPlies - openingPlies;
  const openingNextColor = openingPlies % 2 === 0 ? 'w' : 'b';
  return Math.floor(played / 2) + (played % 2 === 1 && openingNextColor === newColor ? 1 : 0);
};

/** Reject malformed, duplicated, miscolored, wrongly sharded or wrongly mapped games. */
export const loadProspectiveRecords = (dir: string, openings: string[][], shards: number): ProspectiveGame[] => {
  const seen = new Set<number>();
  const games: ProspectiveGame[] = [];
  for (const filename of readdirSync(dir).filter((f) => /^shard-\d+\.jsonl$/.test(f)).sort()) {
    const fileShard = Number(filename.match(/^shard-(\d+)/)![1]);
    if (fileShard >= shards) throw new Error(`${filename}: unexpected shard`);
    const lines = readFileSync(join(dir, filename), 'utf8').split('\n');
    for (const [index, line] of lines.entries()) {
      if (!line.trim()) continue;
      let x: unknown;
      try { x = JSON.parse(line); } catch { throw new Error(`${filename}:${index + 1}: malformed JSONL record`); }
      const label = `${filename}:${index + 1}`;
      if (!record(x) || !Number.isSafeInteger(x.id) || (x.id as number) < 0 ||
          (x.id as number) >= openings.length * 2 || (x.id as number) % shards !== fileShard) {
        throw new Error(`${label}: invalid or wrong-shard game ID`);
      }
      const id = x.id as number;
      if (seen.has(id)) throw new Error(`${label}: duplicate game ID ${id}`);
      seen.add(id);
      const slot = openingSlotForGame(id, openings);
      if (x.newColor !== slot.newColor || ![0, 0.5, 1].includes(x.score as number) ||
          !Array.isArray(x.opening) || JSON.stringify(x.opening) !== JSON.stringify(slot.opening) ||
          !Array.isArray(x.moves) || !x.moves.every((m: unknown) => typeof m === 'string' && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(m)) ||
          x.moves.length !== x.plies || x.plies < slot.opening.length ||
          JSON.stringify(x.moves.slice(0, slot.opening.length)) !== JSON.stringify(slot.opening) ||
          !outcomeMatches(x.reason, x.score, x.plies as number, slot.newColor) || !record(x.search) ||
          !validTotals(x.search.new) || !validTotals(x.search.base) ||
          x.search.new.moves !== movesByNewKernel(slot.opening.length, x.plies as number, slot.newColor) ||
          x.search.base.moves !== (x.plies as number) - slot.opening.length - x.search.new.moves) {
        throw new Error(`${label}: invalid opening/color/score/game or search metrics`);
      }
      games.push(x as ProspectiveGame);
    }
  }
  return games.sort((a, b) => a.id - b.id);
};

/** Reconstruct a report exclusively from immutable config, opening snapshot, and recorded games. */
export const auditProspectiveRun = (dir: string) => {
  const manifestPath = join(dir, 'experiment.json');
  if (!existsSync(manifestPath)) throw new Error('missing prospective experiment.json');
  const manifest = parseExperimentManifest(JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown);
  const openingPath = join(dir, 'openings.json');
  if (sha256(readFileSync(openingPath)) !== manifest.openingSnapshotSha256 ||
      JSON.stringify(readRunOpeningOrder(openingPath)) !== JSON.stringify(manifest.openingOrder)) {
    throw new Error('opening snapshot changed since experiment creation');
  }
  const openings = parseOpeningList(readFileSync(openingPath, 'utf8'));
  const games = loadProspectiveRecords(dir, openings, manifest.shards);
  const n = games.length;
  const wins = games.filter((g) => g.score === 1).length;
  const draws = games.filter((g) => g.score === 0.5).length;
  const losses = n - wins - draws;
  const points = wins + draws / 2;
  const score = n ? points / n : 0.5;
  const expectedScore = (elo: number) => 1 / (1 + 10 ** (-elo / 400));
  const s0 = expectedScore(manifest.elo0), s1 = expectedScore(manifest.elo1);
  const variance = n ? games.reduce((total, g) => total + (g.score - score) ** 2, 0) / n : 0.25;
  const llr = n && variance > 0 ? n * (s1 - s0) * (2 * score - s0 - s1) / (2 * variance) : 0;
  const lower = Math.log(manifest.beta / (1 - manifest.alpha));
  const upper = Math.log((1 - manifest.beta) / manifest.alpha);
  const sequentialVerdict = n < manifest.minGames ? 'undecided' :
    llr >= upper ? 'H1 accepted (improvement)' : llr <= lower ? 'H0 accepted (no improvement)' : 'undecided';
  const ids = new Set(games.map((g) => g.id));
  const pairs = games.filter((g) => g.id % 2 === 0 && ids.has(g.id + 1)).length;
  const firstMoves: Record<string, { slots: number; games: number; score: number | null }> = {};
  for (const opening of openings) (firstMoves[opening[0]] ??= { slots: 0, games: 0, score: null }).slots += 2;
  const totals: Record<string, number> = {};
  for (const game of games) {
    const category = openings[Math.floor(game.id / 2)][0];
    const item = firstMoves[category];
    item.games++;
    totals[category] = (totals[category] ?? 0) + game.score;
  }
  for (const [key, value] of Object.entries(firstMoves)) value.score = value.games ? round(totals[key] / value.games) : null;
  const coverage = n ? round(Object.values(firstMoves).reduce((t, f) => t + Math.abs(f.games / n - f.slots / (2 * openings.length)), 0) / 2) : null;
  // For a complete paired experiment, the independent unit is an opening pair, not a move or color slot.
  const pairedScores = games.filter((g) => g.id % 2 === 0 && ids.has(g.id + 1))
    .map((g) => (g.score + games.find((other) => other.id === g.id + 1)!.score) / 2);
  const fullPairs = pairs === openings.length && n === openings.length * 2;
  const mean = pairedScores.length ? pairedScores.reduce((a, b) => a + b, 0) / pairedScores.length : 0.5;
  const se = pairedScores.length > 1 ? Math.sqrt(pairedScores.reduce((a, b) => a + (b - mean) ** 2, 0) /
    (pairedScores.length * (pairedScores.length - 1))) : null;
  // A zero-variance plug-in SE yields a false zero-width interval for finite bounded scores.
  // Withhold the nominal Wald interval rather than incorrectly imply exact strength.
  const pair95 = fullPairs && se !== null && se > 0 ? [Math.round(rawElo(Math.max(0, mean - 1.96 * se))),
    Math.round(rawElo(Math.min(1, mean + 1.96 * se)))] : null;
  const summary = (side: 'new' | 'base') => {
    const m = games.reduce((a, g) => ({ moves: a.moves + g.search[side].moves,
      completedDepthSum: a.completedDepthSum + g.search[side].completedDepthSum,
      nodes: a.nodes + g.search[side].nodes, qNodes: a.qNodes + g.search[side].qNodes,
      elapsedMs: a.elapsedMs + g.search[side].elapsedMs }),
    { moves: 0, completedDepthSum: 0, nodes: 0, qNodes: 0, elapsedMs: 0 });
    return { moves: m.moves, meanCompletedDepth: m.moves ? round(m.completedDepthSum / m.moves, 2) : null,
      meanNodesPerMove: m.moves ? Math.round(m.nodes / m.moves) : null, nodes: m.nodes, qNodes: m.qNodes,
      measuredElapsedMs: Math.round(m.elapsedMs) };
  };
  return {
    schemaVersion: 1, source: 'prospective completed JSONL records only', manifest,
    games: n, totalSlots: openings.length * 2, openings: openings.length,
    distinctOpenings: new Set(games.map((g) => Math.floor(g.id / 2))).size,
    completeColorPairs: pairs, unpairedSlots: n - pairs * 2,
    missingSlotIds: openings.flatMap((_o, index) => [2 * index, 2 * index + 1]).filter((id) => !ids.has(id)),
    status: n === 0 ? 'not-started' : fullPairs ? 'complete' : 'in-progress',
    wins, draws, losses, score: round(score), elo: n ? Math.round(rawElo(score)) : null,
    sprt: { llr: round(llr, 3), lower: round(lower, 3), upper: round(upper, 3),
      minGames: manifest.minGames, verdict: manifest.stopAtVerdict ? sequentialVerdict : 'not-applicable (fixed-sample)',
      note: manifest.stopAtVerdict ? 'sequential stopping decision; not a fixed-sample confidence interval' :
        'informational LLR only: fixed-sample full-pairs mode deliberately does not stop at a boundary' },
    fixedSamplePaired95Elo: pair95,
    intervalQualification: fullPairs
      ? pair95 === null
        ? 'unavailable: zero observed between-opening variance would produce a misleading zero-width normal interval'
        : 'nominal 95% fixed-sample CI, clustering the two colors by opening; not an SPRT stopping interval'
      : 'not available: full opening/color coverage required; sequential SPRT decisions are separate',
    firstMoves, openingDistributionTotalVariation: coverage,
    search: { new: summary('new'), base: summary('base') },
    recordsSha256: sha256(JSON.stringify(games)),
  };
};

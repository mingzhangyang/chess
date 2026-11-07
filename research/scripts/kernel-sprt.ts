/**
 * SPRT gate for search changes that alter the kernel's tree (phase 10): the
 * working tree's kernel against a frozen baseline kernel, both through the
 * production adapter path (TsEngineAdapter with tsSearchKernel), expert, book
 * off, the same time per move.
 *
 *   git worktree add .sprt-base <baseline-commit>
 *   ln -s ../node_modules .sprt-base/node_modules
 *   (--base <dir> selects another baseline worktree; --new-features and
 *   --base-features '<json>' override either side's KernelFeatures)
 *   node --import tsx research/scripts/kernel-sprt.ts --name negamax-nmp --shard 0/3   # in three processes
 *   node --import tsx research/scripts/kernel-sprt.ts --name negamax-nmp --report
 *
 * Each module graph (working tree, .sprt-base) has its own search state, so
 * the two kernels share nothing. Openings: 300 balanced positions (book lines
 * of 3+ plies plus seeded two-ply extensions with a depth-4 score within
 * 0.8 pawns), each played with both colors. Games end by the application's
 * rules (describeGameResult) or as a draw at 400 plies.
 *
 * Sequential test: H0 elo = ELO0, H1 elo = ELO1 (logistic), alpha = beta =
 * 0.05, trinomial GSPRT log-likelihood ratio (normal approximation, as in
 * Fishtest). Shards append finished games to
 * research/results/kernel-sprt/<name>/shard-<i>.jsonl and stop once the LLR
 * crosses a bound (after at least --min-games games, 50 by default) or
 * every opening pair is played. Restarting resumes.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { Chess } from 'chess.js';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { getLastSearchDiagnostics as getNewSearchDiagnostics } from '../../src/utils/chess-ai/chessAISearchDiagnostics';
import {
  auditProspectiveRun, establishExperiment, gitHead, gitIsClean, loadProspectiveRecords, persistProspectiveGame,
  snapshotIdentity, withShardLock, type ExperimentManifest, type ProspectiveGame, type SearchTotals,
} from './sprt-prospective.ts';
import { HARD_OPENING_BOOK, COMMITTED_LINES_BLACK, COMMITTED_LINES_WHITE } from '../../src/utils/chess-ai/chessAIOpenings';
import { searchForComparison } from '../../src/utils/chess-ai/independentSearch';
import { describeGameResult } from '../../src/utils/gameResult';
import { loadRunOpenings, sprtVerdict } from './sprt-stats';
import { DEFAULT_OPENING_SEED, loadShuffledRunOpenings, openingSlotForGame, parseOpeningList, parseOpeningSeed, readRunOpeningOrder } from './sprt-openings';
import { TsEngineAdapter as NewAdapter } from '../../src/workers/tsEngineAdapter';

const args = process.argv.slice(2);
const option = (name: string, fallback: string): string => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const NAME = option('--name', 'unnamed');
if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(NAME) || NAME === '..') throw new Error('unsafe experiment --name');
const MOVE_TIME_MS = Number(option('--move-time', '100'));
const ELO0 = Number(option('--elo0', '0'));
const ELO1 = Number(option('--elo1', '25'));
const ALPHA = 0.05;
const BETA = 0.05;
const OPENINGS = 300;
const MAX_PLIES = 400;
const DIR = `research/results/kernel-sprt/${NAME}`;
/** The baseline worktree (a frozen commit). */
const BASE = option('--base', '.sprt-base');
/** Stop after this many games even if the test is undecided (an estimate, not a verdict). */
const MAX_GAMES = Number(option('--max-games', '600'));
/** No verdict before this many games (sprt-stats.ts); every earlier verdict came later (92 games or more). */
const MIN_GAMES = Number(option('--min-games', '50'));
/** Fixed-sample mode plays all 300 opening pairs; SPRT boundaries are only diagnostic. */
const FULL_PAIRS = args.includes('--full-pairs');
if (!Number.isFinite(MOVE_TIME_MS) || MOVE_TIME_MS <= 0 ||
    !Number.isFinite(ELO0) || !Number.isFinite(ELO1) || ELO1 <= ELO0 ||
    !Number.isSafeInteger(MAX_GAMES) || MAX_GAMES < 1 ||
    !Number.isSafeInteger(MIN_GAMES) || MIN_GAMES < 1)
  throw new Error('invalid SPRT numeric options');
const OPENINGS_FILE = 'research/results/kernel-sprt/openings.json';
/**
 * Another fixed opening list (JSON array of UCI move lists), e.g. the one a
 * kernel-match.ts run wrote, so the games use the same opening and color
 * slots: game id 2k plays opening k with the new kernel as white, 2k+1 as black.
 */
const OPENINGS_OVERRIDE = args.includes('--openings-file') ? option('--openings-file', '') : undefined;
const EXPLICIT_OPENING_SEED = args.includes('--opening-seed');
const OPENING_SEED = parseOpeningSeed(option('--opening-seed', String(DEFAULT_OPENING_SEED)));
const PRESERVE_OPENINGS_ORDER = args.includes('--preserve-openings-order');
if (PRESERVE_OPENINGS_ORDER && OPENINGS_OVERRIDE === undefined) throw new Error('--preserve-openings-order requires --openings-file');
if (PRESERVE_OPENINGS_ORDER && EXPLICIT_OPENING_SEED) throw new Error('--opening-seed cannot be used with --preserve-openings-order');
/** Feature overrides (JSON merged into KERNEL_FEATURES) for either side; omitted: that code's defaults. */
const NEW_FEATURES = args.includes('--new-features') ? JSON.parse(option('--new-features', '{}')) : undefined;
const BASE_FEATURES = args.includes('--base-features') ? JSON.parse(option('--base-features', '{}')) : undefined;

type Record_ = { id: number; newColor: 'w' | 'b'; score: number; reason: string; plies: number };

const play = (game: Chess, uci: string) => game.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });

/** 300 balanced openings, generated once and cached so every test uses the same set. */
const openings = (): string[][] => {
  if (OPENINGS_OVERRIDE) return parseOpeningList(readFileSync(OPENINGS_OVERRIDE, 'utf8'));
  if (existsSync(OPENINGS_FILE)) return JSON.parse(readFileSync(OPENINGS_FILE, 'utf8'));
  const book = new Set<string>();
  for (const entry of HARD_OPENING_BOOK) for (const reply of entry.replies) book.add([...entry.sequence, reply].join(' '));
  for (const line of [...COMMITTED_LINES_WHITE, ...COMMITTED_LINES_BLACK]) {
    for (let length = 3; length <= line.moves.length; length += 1) book.add(line.moves.slice(0, length).join(' '));
  }
  const bases = [...book].map((s) => s.split(' ')).filter((m) => m.length >= 3).sort((a, b) => a.join(' ').localeCompare(b.join(' ')));
  let seed = 0x0ae11;
  const random = (n: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
  const seen = new Set<string>();
  const out: string[][] = [];
  const accept = (moves: string[]): boolean => {
    const game = new Chess();
    try { for (const uci of moves) play(game, uci); } catch { return false; }
    if (game.isGameOver()) return false;
    const key = game.fen().split(' ').slice(0, 4).join(' ');
    if (seen.has(key)) return false;
    const result = searchForComparison({ backend: 'independent', input: { fen: game.fen(), history: moves, difficulty: 'expert' },
      maxDepth: 4, timeLimitMs: 60_000 });
    if (result.score === null || Math.abs(result.score) > 80) return false;
    seen.add(key);
    out.push(moves);
    return true;
  };
  for (const moves of bases) accept(moves);
  for (let attempt = 0; out.length < OPENINGS && attempt < 20_000; attempt += 1) {
    const base = bases[random(bases.length)];
    const game = new Chess();
    for (const uci of base) play(game, uci);
    const extended = [...base];
    for (let ply = 0; ply < 2; ply += 1) {
      const moves = game.moves({ verbose: true });
      const move = moves[random(moves.length)];
      game.move(move);
      extended.push(`${move.from}${move.to}${move.promotion ?? ''}`);
    }
    accept(extended);
  }
  const result = out.slice(0, OPENINGS);
  mkdirSync('research/results/kernel-sprt', { recursive: true });
  return loadRunOpenings(OPENINGS_FILE, () => result, false);
};

const readRecords = (): Record_[] => {
  if (existsSync(`${DIR}/experiment.json`)) {
    const config = JSON.parse(readFileSync(`${DIR}/experiment.json`, 'utf8')) as ExperimentManifest;
    return loadProspectiveRecords(DIR, parseOpeningList(readFileSync(`${DIR}/openings.json`, 'utf8')), config.shards);
  }
  // Historical archives are read-only: never promote their old logs into a new experiment.
  return existsSync(DIR)
    ? readdirSync(DIR).filter((f) => /^shard-\d+\.jsonl$/.test(f)).flatMap((f) =>
        readFileSync(`${DIR}/${f}`, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as Record_))
    : [];
};

const scoreOf = (elo: number) => 1 / (1 + 10 ** (-elo / 400));
const eloOf = (score: number) => -400 * Math.log10(1 / Math.min(1 - 1e-9, Math.max(1e-9, score)) - 1);
const LOWER = Math.log(BETA / (1 - ALPHA));
const UPPER = Math.log((1 - BETA) / ALPHA);

export const summarize = (records: Record_[], config: { elo0?: number; elo1?: number; minGames?: number } = {}) => {
  const elo0 = config.elo0 ?? ELO0; const elo1 = config.elo1 ?? ELO1;
  const minGames = config.minGames ?? MIN_GAMES;
  const n = records.length;
  const wins = records.filter((r) => r.score === 1).length;
  const draws = records.filter((r) => r.score === 0.5).length;
  const losses = n - wins - draws;
  const score = n ? (wins + draws / 2) / n : 0.5;
  const variance = n ? records.reduce((s, r) => s + (r.score - score) ** 2, 0) / n : 0.25;
  const s0 = scoreOf(elo0); const s1 = scoreOf(elo1);
  const llr = n && variance > 0 ? (n * (s1 - s0) * (2 * score - s0 - s1)) / (2 * variance) : 0;
  const z = 1.96;
  const centre = n ? (score + z * z / (2 * n)) / (1 + z * z / n) : 0.5;
  const half = n ? (z / (1 + z * z / n)) * Math.sqrt(score * (1 - score) / n + z * z / (4 * n * n)) : 0.5;
  return { games: n, wins, draws, losses, score: Number(score.toFixed(4)), elo: Math.round(eloOf(score)),
    elo95Wilson: [Math.round(eloOf(centre - half)), Math.round(eloOf(centre + half))],
    llr: Number(llr.toFixed(3)), bounds: [Number(LOWER.toFixed(3)), Number(UPPER.toFixed(3))], elo0, elo1,
    minGames, verdict: sprtVerdict(llr, n, [LOWER, UPPER], minGames) };
};

const playGame = async (id: number, opening: string[], newColor: 'w' | 'b',
  engines: Record<'new' | 'base', { computeBestMove: (input: never) => unknown }>,
  diagnostics: Record<'new' | 'base', typeof getNewSearchDiagnostics>): Promise<ProspectiveGame> => {
  const game = new Chess();
  const history: string[] = [];
  for (const uci of opening) { play(game, uci); history.push(uci); }
  const zero = (): SearchTotals => ({ moves: 0, completedDepthSum: 0, nodes: 0, qNodes: 0, elapsedMs: 0 });
  const search = { new: zero(), base: zero() };
  let result = describeGameResult(game, null);
  while (!result && history.length < MAX_PLIES) {
    const side = game.turn() === newColor ? 'new' : 'base';
    const started = performance.now();
    const san = await engines[side].computeBestMove({ fen: game.fen(), history: [...history], difficulty: 'expert',
      tuning: { openingBookEnabled: false }, timeLimitMs: MOVE_TIME_MS, tsSearchKernel: 'independent' } as never) as string | null;
    const elapsed = performance.now() - started;
    if (!san) throw new Error(`game ${id}: no move in ${game.fen()}`);
    const measure = diagnostics[side]();
    search[side].moves += 1;
    search[side].completedDepthSum += measure.completedDepth;
    search[side].nodes += measure.nodes;
    search[side].qNodes += measure.qNodes;
    search[side].elapsedMs += elapsed;
    const move = game.move(san);
    history.push(`${move.from}${move.to}${move.promotion ?? ''}`);
    result = describeGameResult(game, null);
  }
  const winner = result?.winner ?? null;
  return { id, opening: [...opening], moves: history, newColor,
    score: winner === null ? 0.5 : winner === newColor ? 1 : 0,
    reason: result?.reason ?? 'maxPlies', plies: history.length, search };
};

const run = async (shard: number, shards: number) => {
  if (!Number.isSafeInteger(shards) || shards < 1 || !Number.isSafeInteger(shard) || shard < 0 || shard >= shards) {
    throw new Error('--shard must be an index/count such as 0/4');
  }
  // A prospective match requires two clean, separately loaded copies of the kernel.
  if (!gitIsClean('.') || !gitIsClean(BASE)) throw new Error('candidate and baseline must have clean tracked worktrees');
  const candidateSha = gitHead('.');
  const baselineSha = gitHead(BASE);
  mkdirSync(DIR, { recursive: true });
  const runFile = `${DIR}/openings.json`;
  const set = loadShuffledRunOpenings(runFile, openings, {
    seed: OPENING_SEED, explicitSeed: EXPLICIT_OPENING_SEED,
    sourceOverride: OPENINGS_OVERRIDE !== undefined,
    preserveOrder: PRESERVE_OPENINGS_ORDER, explicitPreserveOrder: PRESERVE_OPENINGS_ORDER,
  });
  if (FULL_PAIRS && MAX_GAMES < set.length * 2) throw new Error('--full-pairs requires --max-games >= every opening/color slot');
  const manifest = establishExperiment(DIR, {
    schemaVersion: 1, candidateSha, baselineSha, moveTimeMs: MOVE_TIME_MS,
    maxPlies: MAX_PLIES, maxGames: Math.min(MAX_GAMES, set.length * 2), minGames: MIN_GAMES,
    elo0: ELO0, elo1: ELO1, alpha: ALPHA, beta: BETA, shards, stopAtVerdict: !FULL_PAIRS,
    newFeatures: NEW_FEATURES ?? null, baseFeatures: BASE_FEATURES ?? null,
    ...snapshotIdentity(runFile),
  });
  const moduleUrl = (root: string, path: string) => pathToFileURL(join(root, path)).href;
  await withShardLock(DIR, shard, async () => {
    const candidateRoot = resolve('.');
    const baselineRoot = resolve(BASE);
    const { TsEngineAdapter: BaseAdapter } = await import(moduleUrl(baselineRoot, 'src/workers/tsEngineAdapter.ts'))
      as typeof import('../../src/workers/tsEngineAdapter');
    const { getLastSearchDiagnostics: getBaseSearchDiagnostics } =
      await import(moduleUrl(baselineRoot, 'src/utils/chess-ai/chessAISearchDiagnostics.ts'))
      as typeof import('../../src/utils/chess-ai/chessAISearchDiagnostics');
    const engines = { new: new NewAdapter(), base: new BaseAdapter() };
    const diagnostics = { new: getNewSearchDiagnostics, base: getBaseSearchDiagnostics };
    const setFeatures = async (root: string, overrides: object | undefined) => {
      if (!overrides) return;
      const kernelEngine = await import(moduleUrl(root, 'src/utils/chess-ai/independent/kernelEngine.ts'))
        as typeof import('../../src/utils/chess-ai/independent/kernelEngine');
      const { KERNEL_FEATURES } = await import(moduleUrl(root, 'src/utils/chess-ai/independent/kernelSearch.ts'))
        as typeof import('../../src/utils/chess-ai/independent/kernelSearch');
      kernelEngine.setKernelFeaturesForTesting({ ...KERNEL_FEATURES, ...overrides });
    };
    await setFeatures(candidateRoot, NEW_FEATURES);
    await setFeatures(baselineRoot, BASE_FEATURES);
    const file = `${DIR}/shard-${shard}.jsonl`;
    for (let id = 0; id < set.length * 2; id += 1) {
      if (id % shards !== shard) continue;
      const records = readRecords();
      if (records.some((r) => r.id === id)) continue;
      const summary = summarize(records, manifest);
      if ((manifest.stopAtVerdict && summary.verdict !== 'undecided') || records.length >= manifest.maxGames) break;
      const { opening, newColor } = openingSlotForGame(id, set);
      const game = await playGame(id, opening, newColor, engines, diagnostics);
      persistProspectiveGame(file, game);
      const after = summarize(readRecords(), manifest);
      console.log(`game ${id}: new ${game.newColor} ${game.score} (${game.reason}, ${game.plies}); ${after.games} games, LLR ${after.llr} ${JSON.stringify(after.bounds)}`);
    }
  });
};

if (args.includes('--report')) {
  if (existsSync(`${DIR}/experiment.json`)) {
    const audit = auditProspectiveRun(DIR);
    const report = { name: NAME, moveTimeMs: audit.manifest.moveTimeMs, ...audit };
    writeFileSync(`${DIR}-summary.json`, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));
  } else {
    // Historical logs must not be rewritten by a command with missing defaults.
    console.log(JSON.stringify({ ...summarize(readRecords()), historical: true,
      note: 'Read-only legacy summary; no prospective opening or run identity' }, null, 2));
  }
} else if (args.includes('--openings')) {
  console.log(openings().length);
} else {
  const [shard, shards] = option('--shard', '0/1').split('/').map(Number);
  await run(shard, shards);
}

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
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { Chess } from 'chess.js';
import { HARD_OPENING_BOOK, COMMITTED_LINES_BLACK, COMMITTED_LINES_WHITE } from '../../src/utils/chess-ai/chessAIOpenings';
import { searchForComparison } from '../../src/utils/chess-ai/independentSearch';
import { describeGameResult } from '../../src/utils/gameResult';
import { sprtVerdict } from './sprt-stats';
import { TsEngineAdapter as NewAdapter } from '../../src/workers/tsEngineAdapter';

const args = process.argv.slice(2);
const option = (name: string, fallback: string): string => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const NAME = option('--name', 'unnamed');
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
const OPENINGS_FILE = 'research/results/kernel-sprt/openings.json';
/**
 * Another fixed opening list (JSON array of UCI move lists), e.g. the one a
 * kernel-match.ts run wrote, so the games use the same opening and color
 * slots: game id 2k plays opening k with the new kernel as white, 2k+1 as black.
 */
const OPENINGS_OVERRIDE = args.includes('--openings-file') ? option('--openings-file', '') : undefined;
/** Feature overrides (JSON merged into KERNEL_FEATURES) for either side; omitted: that code's defaults. */
const NEW_FEATURES = args.includes('--new-features') ? JSON.parse(option('--new-features', '{}')) : undefined;
const BASE_FEATURES = args.includes('--base-features') ? JSON.parse(option('--base-features', '{}')) : undefined;

type Record_ = { id: number; newColor: 'w' | 'b'; score: number; reason: string; plies: number };

const play = (game: Chess, uci: string) => game.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });

/** 300 balanced openings, generated once and cached so every test uses the same set. */
const openings = (): string[][] => {
  if (OPENINGS_OVERRIDE) return JSON.parse(readFileSync(OPENINGS_OVERRIDE, 'utf8'));
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
  writeFileSync(OPENINGS_FILE, `${JSON.stringify(result)}\n`);
  return result;
};

const readRecords = (): Record_[] => (existsSync(DIR)
  ? readdirSync(DIR).filter((f) => f.endsWith('.jsonl')).flatMap((f) => readFileSync(`${DIR}/${f}`, 'utf8').split('\n').filter(Boolean)
    .map((line) => JSON.parse(line) as Record_))
  : []);

const scoreOf = (elo: number) => 1 / (1 + 10 ** (-elo / 400));
const eloOf = (score: number) => -400 * Math.log10(1 / Math.min(1 - 1e-9, Math.max(1e-9, score)) - 1);
const LOWER = Math.log(BETA / (1 - ALPHA));
const UPPER = Math.log((1 - BETA) / ALPHA);

export const summarize = (records: Record_[]) => {
  const n = records.length;
  const wins = records.filter((r) => r.score === 1).length;
  const draws = records.filter((r) => r.score === 0.5).length;
  const losses = n - wins - draws;
  const score = n ? (wins + draws / 2) / n : 0.5;
  const variance = n ? records.reduce((s, r) => s + (r.score - score) ** 2, 0) / n : 0.25;
  const s0 = scoreOf(ELO0); const s1 = scoreOf(ELO1);
  const llr = n && variance > 0 ? (n * (s1 - s0) * (2 * score - s0 - s1)) / (2 * variance) : 0;
  const z = 1.96;
  const centre = n ? (score + z * z / (2 * n)) / (1 + z * z / n) : 0.5;
  const half = n ? (z / (1 + z * z / n)) * Math.sqrt(score * (1 - score) / n + z * z / (4 * n * n)) : 0.5;
  return { games: n, wins, draws, losses, score: Number(score.toFixed(4)), elo: Math.round(eloOf(score)),
    elo95Wilson: [Math.round(eloOf(centre - half)), Math.round(eloOf(centre + half))],
    llr: Number(llr.toFixed(3)), bounds: [Number(LOWER.toFixed(3)), Number(UPPER.toFixed(3))], elo0: ELO0, elo1: ELO1,
    minGames: MIN_GAMES, verdict: sprtVerdict(llr, n, [LOWER, UPPER], MIN_GAMES) };
};

const playGame = async (id: number, opening: string[], newColor: 'w' | 'b',
  engines: Record<'new' | 'base', { computeBestMove: (input: never) => unknown }>): Promise<Record_> => {
  const game = new Chess();
  const history: string[] = [];
  for (const uci of opening) { play(game, uci); history.push(uci); }
  let result = describeGameResult(game, null);
  while (!result && history.length < MAX_PLIES) {
    const engine = game.turn() === newColor ? engines.new : engines.base;
    const san = await engine.computeBestMove({ fen: game.fen(), history: [...history], difficulty: 'expert',
      tuning: { openingBookEnabled: false }, timeLimitMs: MOVE_TIME_MS, tsSearchKernel: 'independent' } as never) as string | null;
    if (!san) throw new Error(`game ${id}: no move in ${game.fen()}`);
    const move = game.move(san);
    history.push(`${move.from}${move.to}${move.promotion ?? ''}`);
    result = describeGameResult(game, null);
  }
  const winner = result?.winner ?? null;
  return { id, newColor, score: winner === null ? 0.5 : winner === newColor ? 1 : 0, reason: result?.reason ?? 'maxPlies', plies: history.length };
};

const run = async (shard: number, shards: number) => {
  const set = openings();
  mkdirSync(DIR, { recursive: true });
  // A variable path: the baseline worktree is not part of the type-checked project.
  const basePath = `../../${BASE}/src/workers/tsEngineAdapter.ts`;
  const { TsEngineAdapter: BaseAdapter } = await import(basePath) as typeof import('../../src/workers/tsEngineAdapter');
  const engines = { new: new NewAdapter(), base: new BaseAdapter() };
  // Load each side's kernel module and apply its feature set before the first move.
  const setFeatures = async (root: string, overrides: object | undefined) => {
    if (!overrides) return;
    const path = `${root}/src/utils/chess-ai/independent/kernelEngine.ts`;
    const kernelEngine = await import(path) as typeof import('../../src/utils/chess-ai/independent/kernelEngine');
    const { KERNEL_FEATURES } = await import(`${root}/src/utils/chess-ai/independent/kernelSearch.ts`) as typeof import('../../src/utils/chess-ai/independent/kernelSearch');
    kernelEngine.setKernelFeaturesForTesting({ ...KERNEL_FEATURES, ...overrides });
  };
  await setFeatures('../..', NEW_FEATURES);
  await setFeatures(`../../${BASE}`, BASE_FEATURES);
  const file = `${DIR}/shard-${shard}.jsonl`;
  for (let id = 0; id < set.length * 2; id += 1) {
    if (id % shards !== shard) continue;
    const records = readRecords();
    if (records.some((r) => r.id === id)) continue;
    const summary = summarize(records);
    if (summary.verdict !== 'undecided' || records.length >= MAX_GAMES) break;
    const record = await playGame(id, set[id >> 1], id % 2 === 0 ? 'w' : 'b', engines);
    appendFileSync(file, `${JSON.stringify(record)}\n`);
    const after = summarize(readRecords());
    console.log(`game ${id}: new ${record.newColor} ${record.score} (${record.reason}, ${record.plies}); ${after.games} games, LLR ${after.llr} ${JSON.stringify(after.bounds)}`);
  }
};

if (args.includes('--report')) {
  const summary = summarize(readRecords());
  writeFileSync(`${DIR}-summary.json`, `${JSON.stringify({ name: NAME, moveTimeMs: MOVE_TIME_MS,
    ...(NEW_FEATURES ? { newFeatures: NEW_FEATURES } : {}), ...(BASE_FEATURES ? { baseFeatures: BASE_FEATURES } : {}), ...summary }, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
} else if (args.includes('--openings')) {
  console.log(openings().length);
} else {
  const [shard, shards] = option('--shard', '0/1').split('/').map(Number);
  await run(shard, shards);
}

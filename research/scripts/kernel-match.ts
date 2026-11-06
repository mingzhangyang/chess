/**
 * Match: the independent kernel against the production TS search, through
 * the worker's TS adapter (the same code paths the switch selects).
 *
 *   node --import tsx research/scripts/kernel-match.ts --shard 0/3   # play (resumable)
 *   node --import tsx research/scripts/kernel-match.ts --report      # summarize
 *
 * Against Stockfish (the app's StockfishWasmAdapter and the kernel, both in a
 * real Chromium worker built from research/browser; one shard, since
 * Stockfish uses up to four threads):
 *
 *   node --import tsx research/scripts/kernel-match.ts --opponent stockfish --skill 20 --move-time 300 --games 100
 *   node --import tsx research/scripts/kernel-match.ts --opponent stockfish --skill 20 --move-time 300 --report
 *
 * Openings: 100 distinct positions from the app's own opening book (book
 * lines of 3 or more plies, deduplicated by position, longest first). Each is
 * played twice with colors swapped: 200 games. Both engines get `expert`
 * (deterministic selection), the opening book off and an explicit 300 ms per
 * move. Games end by the application's rules from phase 8 step 1
 * (describeGameResult: checkmate, stalemate, insufficient material, fifty
 * moves, threefold repetition as the engine counts it), or are adjudicated a
 * draw at 400 plies. The production search's table and history heuristics are
 * cleared at the start of every game, as in a fresh worker; the kernel clears
 * its table every search.
 *
 * Interruptible: each finished game is appended as one JSON line to
 * research/results/kernel-match/shard-<i>.jsonl, and a restarted shard skips
 * the games already there. A game cut off midway is replayed from its start.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { Chess } from 'chess.js';
import { HARD_OPENING_BOOK, COMMITTED_LINES_BLACK, COMMITTED_LINES_WHITE } from '../../src/utils/chess-ai/chessAIOpenings';
import { clearCountermoves, clearHistory, clearTranspositionTable, getLastSearchDiagnostics, resetOpeningState } from '../../src/utils/chessAI';
import { describeGameResult } from '../../src/utils/gameResult';
import { TsEngineAdapter } from '../../src/workers/tsEngineAdapter';

const args = process.argv.slice(2);
const option = (name: string, fallback: string): string => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const OPPONENT = option('--opponent', 'ts') as 'ts' | 'stockfish';
const SKILL = Number(option('--skill', '20'));
const MOVE_TIME_MS = Number(option('--move-time', '300'));
const GAMES = Number(option('--games', '200'));
const DIR = OPPONENT === 'ts' ? 'research/results/kernel-match' : `research/results/kernel-vs-stockfish-skill${SKILL}-${MOVE_TIME_MS}ms`;
const SUMMARY = OPPONENT === 'ts' ? 'research/results/kernel-match-summary.json' : `${DIR}-summary.json`;
const OPENING_COUNT = 100;
const MAX_PLIES = 400;

type Engine = 'kernel' | 'ts';
type GameRecord = {
  id: number; opening: string[]; kernelColor: 'w' | 'b'; result: '1-0' | '0-1' | '1/2-1/2'; reason: string;
  kernelScore: number; plies: number; moves: string[];
  depth: Record<Engine, { sum: number; moves: number; partial: number }>; ms: Record<Engine, number>;
};

export const matchOpenings = (): string[][] => {
  const sequences = new Set<string>();
  for (const entry of HARD_OPENING_BOOK) for (const reply of entry.replies) sequences.add([...entry.sequence, reply].join(' '));
  for (const line of [...COMMITTED_LINES_WHITE, ...COMMITTED_LINES_BLACK]) {
    for (let length = 3; length <= line.moves.length; length += 1) sequences.add(line.moves.slice(0, length).join(' '));
  }
  const candidates = [...sequences].map((s) => s.split(' ')).filter((moves) => moves.length >= 3)
    .sort((a, b) => b.length - a.length || a.join(' ').localeCompare(b.join(' ')));
  const seen = new Set<string>();
  const openings: string[][] = [];
  for (const moves of candidates) {
    const game = new Chess();
    try { for (const uci of moves) game.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }); } catch { continue; }
    const key = game.fen().split(' ').slice(0, 4).join(' ');
    if (seen.has(key)) continue;
    seen.add(key);
    openings.push(moves);
    if (openings.length === OPENING_COUNT) break;
  }
  if (openings.length < OPENING_COUNT) throw new Error(`only ${openings.length} openings`);
  return openings;
};

/** One move: SAN plus the search's completed depth (null when the engine does not report it). */
type Mover = (engine: Engine, fen: string, history: string[]) => Promise<{ san: string | null; depth: number | null; partial: boolean }>;

const nodeMover = (): Mover => {
  const adapter = new TsEngineAdapter();
  return async (engine, fen, history) => {
    const san = await adapter.computeBestMove({ fen, history, difficulty: 'expert', tuning: { openingBookEnabled: false },
      timeLimitMs: MOVE_TIME_MS, ...(engine === 'kernel' ? { tsSearchKernel: 'independent' as const } : {}) });
    const diagnostics = getLastSearchDiagnostics();
    return { san, depth: diagnostics.completedDepth, partial: diagnostics.partialDepth > diagnostics.completedDepth };
  };
};

/** Both engines through the production runtime in a Chromium worker (research/browser). */
const browserMover = async (): Promise<{ mover: Mover; close: () => Promise<void> }> => {
  const { createRequire } = await import('node:module');
  const { build, preview } = await import('vite');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { chromium } = createRequire(import.meta.url)('playwright') as any;
  await build({ configFile: 'research/browser/vite.config.ts', logLevel: 'warn' });
  const server = await preview({ configFile: 'research/browser/vite.config.ts', preview: { port: 4183, strictPort: true } });
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('http://localhost:4183/');
  await page.waitForFunction(() => (window as unknown as { profileReady?: boolean }).profileReady === true);
  let requestId = 1;
  const mover: Mover = async (engine, fen, history) => {
    const request = engine === 'kernel'
      ? { type: 'compute-best-move', requestId: requestId++, fen, history, difficulty: 'expert', backend: 'ts',
        tuning: { openingBookEnabled: false }, timeLimitMs: MOVE_TIME_MS, tsSearchKernel: 'independent' }
      : { type: 'compute-best-move', requestId: requestId++, fen, history, difficulty: 'expert', backend: 'stockfish-wasm',
        stockfishSkillLevel: SKILL, timeLimitMs: MOVE_TIME_MS };
    const r = await page.evaluate((q: unknown) => (window as unknown as { profileSearch: (q: unknown) => Promise<never> }).profileSearch(q), request) as
      { bestMove: string | null; error?: string; telemetry: string[]; diagnostics: { completedDepth: number; partialDepth: number } };
    // A Stockfish failure silently falls back to the TS search: that move would not be Stockfish's.
    if (r.telemetry.length > 0 || r.error) throw new Error(`${engine}: ${r.error ?? ''} ${r.telemetry.join(', ')}`);
    return engine === 'kernel'
      ? { san: r.bestMove, depth: r.diagnostics.completedDepth, partial: r.diagnostics.partialDepth > r.diagnostics.completedDepth }
      : { san: r.bestMove, depth: null, partial: false };
  };
  return { mover, close: async () => { await browser.close(); await new Promise<void>((resolve) => server.httpServer.close(() => resolve())); } };
};

const playGame = async (id: number, opening: string[], kernelColor: 'w' | 'b', mover: Mover): Promise<GameRecord> => {
  const game = new Chess();
  const history: string[] = [];
  for (const uci of opening) { game.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }); history.push(uci); }
  clearTranspositionTable(); clearHistory(); clearCountermoves(); resetOpeningState();
  const depth = { kernel: { sum: 0, moves: 0, partial: 0 }, ts: { sum: 0, moves: 0, partial: 0 } };
  const ms = { kernel: 0, ts: 0 };
  let result = describeGameResult(game, null);
  while (!result && history.length < MAX_PLIES) {
    const engine: Engine = game.turn() === kernelColor ? 'kernel' : 'ts';
    const started = performance.now();
    const { san, depth: completed, partial } = await mover(engine, game.fen(), [...history]);
    ms[engine] += performance.now() - started;
    if (!san) throw new Error(`game ${id}: ${engine} returned no move in ${game.fen()}`);
    if (completed !== null) { depth[engine].sum += completed; depth[engine].moves += 1; }
    if (partial) depth[engine].partial += 1;
    const move = game.move(san);
    history.push(`${move.from}${move.to}${move.promotion ?? ''}`);
    result = describeGameResult(game, null);
  }
  const winner = result?.winner ?? null;
  const pgnResult = winner === 'w' ? '1-0' : winner === 'b' ? '0-1' : '1/2-1/2';
  return { id, opening, kernelColor, result: pgnResult, reason: result?.reason ?? 'maxPlies',
    kernelScore: winner === null ? 0.5 : winner === kernelColor ? 1 : 0, plies: history.length, moves: history.slice(opening.length),
    depth, ms: { kernel: Math.round(ms.kernel), ts: Math.round(ms.ts) } };
};

const readRecords = (): GameRecord[] => {
  if (!existsSync(DIR)) return [];
  return readdirSync(DIR).filter((f) => f.endsWith('.jsonl')).flatMap((f) => readFileSync(`${DIR}/${f}`, 'utf8')
    .split('\n').filter(Boolean).map((line) => JSON.parse(line) as GameRecord));
};

const play = async (shard: number, shards: number) => {
  mkdirSync(DIR, { recursive: true });
  const openings = matchOpenings();
  writeFileSync(`${DIR}/openings.json`, `${JSON.stringify(openings)}\n`);
  const file = `${DIR}/shard-${shard}.jsonl`;
  const done = new Set(readRecords().map((r) => r.id));
  const browser = OPPONENT === 'stockfish' ? await browserMover() : undefined;
  const mover = browser?.mover ?? nodeMover();
  try {
    for (let id = 0; id < Math.min(GAMES, openings.length * 2); id += 1) {
      if (id % shards !== shard || done.has(id)) continue;
      const record = await playGame(id, openings[id >> 1], id % 2 === 0 ? 'w' : 'b', mover);
      appendFileSync(file, `${JSON.stringify(record)}\n`);
      const average = (engine: Engine) => (record.depth[engine].moves ? (record.depth[engine].sum / record.depth[engine].moves).toFixed(1) : '-');
      console.log(`game ${id}: kernel ${record.kernelColor} ${record.result} (${record.reason}, ${record.plies} plies), kernel depth ${average('kernel')}, ${OPPONENT} depth ${average('ts')}`);
    }
  } finally {
    await browser?.close();
  }
};

/** Elo from a score fraction. */
const elo = (score: number): number => -400 * Math.log10(1 / score - 1);

export const summarize = (records: GameRecord[]) => {
  const n = records.length;
  const wins = records.filter((r) => r.kernelScore === 1).length;
  const draws = records.filter((r) => r.kernelScore === 0.5).length;
  const losses = n - wins - draws;
  const score = (wins + draws / 2) / n;
  // Trinomial per-game variance; normal approximation of the mean score.
  const variance = records.reduce((sum, r) => sum + (r.kernelScore - score) ** 2, 0) / n;
  const se = Math.sqrt(variance / n);
  const clamp = (s: number) => Math.min(1 - 1e-9, Math.max(1e-9, s));
  // Pentanomial: games paired by opening (same position, colors swapped).
  const pairs = new Map<number, number[]>();
  for (const r of records) pairs.set(r.id >> 1, [...(pairs.get(r.id >> 1) ?? []), r.kernelScore]);
  const complete = [...pairs.values()].filter((p) => p.length === 2).map((p) => (p[0] + p[1]) / 2);
  const pairMean = complete.reduce((a, b) => a + b, 0) / complete.length;
  const pairSe = Math.sqrt(complete.reduce((s, x) => s + (x - pairMean) ** 2, 0) / complete.length / complete.length);
  const depthOf = (engine: Engine) => {
    const sum = records.reduce((s, r) => s + r.depth[engine].sum, 0);
    const moves = records.reduce((s, r) => s + r.depth[engine].moves, 0);
    const played = records.reduce((s, r) => s + Math.ceil((r.plies - r.opening.length + (engine === 'kernel' ? 1 : 0)) / 2), 0);
    return { averageCompletedDepth: moves ? Number((sum / moves).toFixed(2)) : null, moves,
      averageMsPerMove: Math.round(records.reduce((s, r) => s + r.ms[engine], 0) / Math.max(1, moves || played)) };
  };
  const reasons: Record<string, number> = {};
  for (const r of records) reasons[r.reason] = (reasons[r.reason] ?? 0) + 1;
  // Wilson score interval (draws as half points): unlike the normal
  // approximation it stays inside (0, 1) when the score is near 0 or 1.
  const z = 1.96;
  const centre = (score + z * z / (2 * n)) / (1 + z * z / n);
  const half = (z / (1 + z * z / n)) * Math.sqrt(score * (1 - score) / n + z * z / (4 * n * n));
  return {
    games: n, wins, draws, losses, score: Number(score.toFixed(4)),
    elo: Math.round(elo(clamp(score))),
    elo95Wilson: [Math.round(elo(clamp(centre - half))), Math.round(elo(clamp(centre + half)))],
    // Normal approximation; meaningless (clamped) when the score is near 0 or 1.
    elo95: [Math.round(elo(clamp(score - 1.96 * se))), Math.round(elo(clamp(score + 1.96 * se)))],
    pairs: complete.length,
    eloPentanomial95: [Math.round(elo(clamp(pairMean - 1.96 * pairSe))), Math.round(elo(clamp(pairMean + 1.96 * pairSe)))],
    kernelWhite: { games: records.filter((r) => r.kernelColor === 'w').length, score: records.filter((r) => r.kernelColor === 'w').reduce((s, r) => s + r.kernelScore, 0) },
    kernelBlack: { games: records.filter((r) => r.kernelColor === 'b').length, score: records.filter((r) => r.kernelColor === 'b').reduce((s, r) => s + r.kernelScore, 0) },
    reasons,
    averagePlies: Math.round(records.reduce((s, r) => s + r.plies, 0) / n),
    kernel: depthOf('kernel'), [OPPONENT]: depthOf('ts'),
  };
};

if (args.includes('--report')) {
  const summary = summarize(readRecords());
  writeFileSync(SUMMARY, `${JSON.stringify({ date: new Date().toISOString(), opponent: OPPONENT,
    ...(OPPONENT === 'stockfish' ? { stockfishSkillLevel: SKILL } : {}), moveTimeMs: MOVE_TIME_MS, ...summary }, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
} else {
  const [shard, shards] = option('--shard', '0/1').split('/').map(Number);
  await play(shard, shards);
}

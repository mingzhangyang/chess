/**
 * Self-play games of the independent kernel for the Texel data set (phase 11).
 *
 *   node --import tsx research/scripts/texel/selfplay.ts --shard 0/3 --games 4000   # one process per shard
 *   node --import tsx research/scripts/texel/selfplay.ts --report
 *
 * - Engine: runKernelSearch with the phase 10 KERNEL_FEATURES (untuned evaluation) and default
 *   tuning, as the worker's kernel stage does at expert: the best score after
 *   the backtrack penalty, no book. Each side keeps its own persistent table.
 * - Time: the same fixed time per move for both sides (--move-time, 50 ms).
 * - Openings: a fixed list (research/results/texel/openings.json), made once:
 *   book lines of 3+ plies plus four seeded random plies, kept when a depth-4
 *   kernel score is within one pawn, excluding the SPRT openings. Game i uses
 *   opening i.
 * - End: the engine's rules (checkmate, stalemate, threefold repetition,
 *   insufficient material, the 50-move rule, which phase 8 showed equal the
 *   application's), a draw at 400 plies, or a win adjudicated after 8
 *   consecutive plies in which the side to move scores at least 1000 for the
 *   same winner.
 * - Resumable: shards append finished games to
 *   research/results/texel/games/shard-<i>.jsonl and skip ids already there.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { Chess } from 'chess.js';
import { COMMITTED_LINES_BLACK, COMMITTED_LINES_WHITE, HARD_OPENING_BOOK } from '../../../src/utils/chess-ai/chessAIOpenings';
import { resetSearchCounters, searchState } from '../../../src/utils/chess-ai/chessAISearchDiagnostics';
import { setSearchDeadline } from '../../../src/utils/chess-ai/chessAISearchTiming';
import { backtrackPenalty, KERNEL_FEATURES, runKernelSearch, type PreviousOwnMove } from '../../../src/utils/chess-ai/independent/kernelSearch';
import { KernelTranspositionTable } from '../../../src/utils/chess-ai/independent/kernelTranspositionTable';
import { MAX_MOVES, moveCodeToUci } from '../../../src/utils/chess-ai/independent/moveCode';
import { searchForComparison } from '../../../src/utils/chess-ai/independentSearch';
import { SearchPosition, squareFromAlgebraic } from '../../../src/utils/chess-ai/searchPosition';
import { resolveAiTuning } from '../../../src/utils/chessAI';
import { positionKey, STANDARD_FEN, toSearchMove, type GameRecord } from './dataset';

const args = process.argv.slice(2);
const option = (name: string, fallback: string): string => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const MOVE_TIME_MS = Number(option('--move-time', '50'));
const GAMES = Number(option('--games', '4000'));
const MAX_PLIES = 400;
const ADJUDICATE_SCORE = 1000;
const ADJUDICATE_PLIES = 8;
const ROOT = 'research/results/texel';
const DIR = `${ROOT}/games`;
const OPENINGS_FILE = `${ROOT}/openings.json`;
const SPRT_OPENINGS_FILE = 'research/results/kernel-sprt/openings.json';
const TUNING = resolveAiTuning({ openingBookEnabled: false });
/** The kernel the games were played with: the phase 10 default, before the tuned weights. */
const SELFPLAY_FEATURES = Object.freeze({ ...KERNEL_FEATURES, tunedEvaluation: false });

const play = (game: Chess, uci: string) => game.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });

const openings = (count: number): string[][] => {
  if (existsSync(OPENINGS_FILE)) {
    const cached = JSON.parse(readFileSync(OPENINGS_FILE, 'utf8')) as string[][];
    if (cached.length >= count) return cached;
  }
  const book = new Set<string>();
  for (const entry of HARD_OPENING_BOOK) for (const reply of entry.replies) book.add([...entry.sequence, reply].join(' '));
  for (const line of [...COMMITTED_LINES_WHITE, ...COMMITTED_LINES_BLACK]) {
    for (let length = 3; length <= line.moves.length; length += 1) book.add(line.moves.slice(0, length).join(' '));
  }
  const bases = [...book].map((s) => s.split(' ')).filter((m) => m.length >= 3).sort((a, b) => a.join(' ').localeCompare(b.join(' ')));
  const seen = new Set<string>();
  if (existsSync(SPRT_OPENINGS_FILE)) {
    for (const moves of JSON.parse(readFileSync(SPRT_OPENINGS_FILE, 'utf8')) as string[][]) {
      const game = new Chess();
      for (const uci of moves) play(game, uci);
      seen.add(positionKey(game.fen()));
    }
  }
  let seed = 0x7e8e1;
  const random = (n: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
  const out: string[][] = [];
  for (let attempt = 0; out.length < count && attempt < count * 20; attempt += 1) {
    const base = bases[random(bases.length)];
    const game = new Chess();
    for (const uci of base) play(game, uci);
    const moves = [...base];
    for (let ply = 0; ply < 4 && !game.isGameOver(); ply += 1) {
      const legal = game.moves({ verbose: true });
      const move = legal[random(legal.length)];
      game.move(move);
      moves.push(`${move.from}${move.to}${move.promotion ?? ''}`);
    }
    if (game.isGameOver()) continue;
    const key = positionKey(game.fen());
    if (seen.has(key)) continue;
    const result = searchForComparison({ backend: 'independent', input: { fen: game.fen(), history: moves, difficulty: 'expert' },
      maxDepth: 4, timeLimitMs: 60_000 });
    if (result.score === null || Math.abs(result.score) > 100) continue;
    seen.add(key);
    out.push(moves);
  }
  mkdirSync(ROOT, { recursive: true });
  writeFileSync(OPENINGS_FILE, `${JSON.stringify(out)}\n`);
  return out;
};

const readRecords = (): GameRecord[] => (existsSync(DIR)
  ? readdirSync(DIR).filter((f) => f.endsWith('.jsonl')).flatMap((f) => readFileSync(`${DIR}/${f}`, 'utf8').split('\n').filter(Boolean)
    .map((line) => JSON.parse(line) as GameRecord))
  : []);

type Side = { table: KernelTranspositionTable };

/** The kernel's expert move for the side to move of `position`, and its score from that side. */
const searchMove = (position: SearchPosition, side: Side, history: string[]): { uci: string; score: number } => {
  const buffer = new Int32Array(MAX_MOVES);
  const rootOrder = Array.from(buffer.subarray(0, position.generateMoveCodes(buffer)));
  let previousOwnMove: PreviousOwnMove | null = null;
  if (history.length >= 2) {
    const uci = history[history.length - 2];
    const to = squareFromAlgebraic(uci.slice(2, 4));
    const occupant = position.squares[to];
    const own = occupant !== 0 && (occupant > 0) === (position.sideToMove === 1);
    previousOwnMove = { from: squareFromAlgebraic(uci.slice(0, 2)), to, piece: uci.length === 5 ? 1 : own ? Math.abs(occupant) : 0 };
  }
  resetSearchCounters(); searchState.searchAborted = false;
  const start = performance.now();
  const deadline = start + Math.max(1, MOVE_TIME_MS - 5);
  const result = runKernelSearch(position, rootOrder, { color: position.turn, tuning: TUNING, difficulty: 'expert', maxDepth: 20,
    openingPhase: history.length < 8, previousOwnMove, softDeadline: deadline, hardDeadline: deadline,
    firstDepthDeadline: Math.max(deadline, start + 250), table: side.table, features: SELFPLAY_FEATURES });
  setSearchDeadline(Infinity); searchState.searchAborted = false;
  let best = result.rootMoves[0]; let bestScore = -Infinity;
  for (const root of result.rootMoves) {
    const score = root.rawScore - backtrackPenalty(root.move, previousOwnMove, TUNING);
    if (score > bestScore) { bestScore = score; best = root; }
  }
  return { uci: moveCodeToUci(best.move), score: bestScore };
};

const playGame = (id: number, opening: string[]): GameRecord => {
  const moves = [...opening];
  const sides: Record<'w' | 'b', Side> = { w: { table: new KernelTranspositionTable() }, b: { table: new KernelTranspositionTable() } };
  let streakWinner: 'w' | 'b' | null = null; let streak = 0;
  for (;;) {
    const position = SearchPosition.fromHistory(STANDARD_FEN, moves.map(toSearchMove), { historyComplete: true });
    const turn = position.turn;
    if (!position.hasLegalMove()) {
      return position.isInCheck()
        ? { id, openingPlies: opening.length, moves, result: turn === 'w' ? 0 : 1, reason: 'checkmate' }
        : { id, openingPlies: opening.length, moves, result: 0.5, reason: 'stalemate' };
    }
    if (position.repetitionCount >= 3) return { id, openingPlies: opening.length, moves, result: 0.5, reason: 'threefold' };
    if (position.isInsufficientMaterial()) return { id, openingPlies: opening.length, moves, result: 0.5, reason: 'insufficient' };
    if (position.drawHalfmoveClock >= 100) return { id, openingPlies: opening.length, moves, result: 0.5, reason: 'fifty-move' };
    if (moves.length >= MAX_PLIES) return { id, openingPlies: opening.length, moves, result: 0.5, reason: 'maxPlies' };
    const { uci, score } = searchMove(position, sides[turn], moves);
    const winner = score >= ADJUDICATE_SCORE ? turn : score <= -ADJUDICATE_SCORE ? (turn === 'w' ? 'b' : 'w') : null;
    if (winner !== null && winner === streakWinner) streak += 1; else { streakWinner = winner; streak = winner ? 1 : 0; }
    if (streak >= ADJUDICATE_PLIES) return { id, openingPlies: opening.length, moves, result: winner === 'w' ? 1 : 0, reason: 'adjudicated' };
    moves.push(uci);
  }
};

if (args.includes('--report')) {
  const records = readRecords();
  const reasons: Record<string, number> = {};
  for (const r of records) reasons[r.reason] = (reasons[r.reason] ?? 0) + 1;
  const white = records.filter((r) => r.result === 1).length;
  const black = records.filter((r) => r.result === 0).length;
  const plies = records.reduce((s, r) => s + r.moves.length, 0);
  console.log(JSON.stringify({ games: records.length, whiteWins: white, draws: records.length - white - black, blackWins: black,
    meanPlies: Math.round(plies / Math.max(1, records.length)), reasons }, null, 2));
} else if (args.includes('--openings')) {
  console.log(openings(GAMES).length);
} else {
  const set = openings(GAMES);
  const [shard, shards] = option('--shard', '0/1').split('/').map(Number);
  mkdirSync(DIR, { recursive: true });
  const done = new Set(readRecords().map((r) => r.id));
  const file = `${DIR}/shard-${shard}.jsonl`;
  for (let id = shard; id < Math.min(GAMES, set.length); id += shards) {
    if (done.has(id)) continue;
    const started = Date.now();
    const record = playGame(id, set[id]);
    appendFileSync(file, `${JSON.stringify(record)}\n`);
    console.log(`game ${id}: ${record.result} ${record.reason} ${record.moves.length} plies, ${((Date.now() - started) / 1000).toFixed(1)} s`);
  }
}

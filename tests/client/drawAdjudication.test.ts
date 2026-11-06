/**
 * The application's draw rules (chess.js plus src/utils/gameResult.ts, and the
 * room worker's chessRules.ts) must agree with the engine's (SearchPosition):
 * an en-passant right is part of a position only when a legal en-passant
 * capture exists, and the fifty-move and insufficient-material rules match.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Chess, type Move } from 'chess.js';
import { hasThreefoldRepetition } from '../../shared/gameRules';
import { describeGameResult, isGameOver, isThreefoldRepetition } from '../../src/utils/gameResult';
import { SearchPosition, squareFromAlgebraic, type SearchMove } from '../../src/utils/chess-ai/searchPosition';
import { isGameFinished, validateMove } from '../../worker/src/chessRules';

type Reason = 'checkmate' | 'stalemate' | 'insufficient' | 'threefold' | 'fiftyMove' | null;

const toSearchMove = (move: Pick<Move, 'from' | 'to' | 'promotion'>): SearchMove => ({
  from: squareFromAlgebraic(move.from),
  to: squareFromAlgebraic(move.to),
  ...(move.promotion ? { promotion: move.promotion as SearchMove['promotion'] } : {}),
});

/** The engine's view: the position rebuilt from the complete game, as the search boundary does. */
const engineReason = (startFen: string, moves: readonly Move[]): Reason => {
  const position = SearchPosition.fromHistory(startFen, moves.map(toSearchMove), { historyComplete: true });
  if (!position.hasLegalMove()) return position.isInCheck() ? 'checkmate' : 'stalemate';
  if (position.isInsufficientMaterial()) return 'insufficient';
  if (position.repetitionCount >= 3) return 'threefold';
  if (position.drawHalfmoveClock >= 100) return 'fiftyMove';
  return null;
};

const appReason = (game: Chess, fenHistory?: readonly string[]): Reason =>
  (describeGameResult(game, null, fenHistory)?.reason ?? null) as Reason;

const play = (startFen: string, ucis: readonly string[]): Chess => {
  const game = new Chess(startFen);
  for (const uci of ucis) game.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  return game;
};

// After ...d7d5 the e5 pawn could capture en passant, but it is pinned to its
// king by the rook on e8, so the right is not part of the position.
const VERTICAL_PIN = '4r1k1/3p4/8/4P3/8/8/8/4K3 b - - 0 1';
const VERTICAL_PIN_MOVES = ['d7d5', 'e1f1', 'g8h8', 'f1e1', 'h8g8', 'e1f1', 'g8h8', 'f1e1', 'h8g8'];
// After e2e4, dxe3 would remove both pawns from the fourth rank and expose the
// black king on a4 to the rook on h4.
const HORIZONTAL_PIN = '8/8/8/8/k2p3R/8/4P3/4K3 w - - 0 1';
const HORIZONTAL_PIN_MOVES = ['e2e4', 'a4a5', 'e1f1', 'a5a4', 'f1e1', 'a4a5', 'e1f1', 'a5a4', 'f1e1'];

test('a pinned en-passant right does not prevent threefold repetition (vertical and horizontal pins)', () => {
  for (const [start, moves] of [[VERTICAL_PIN, VERTICAL_PIN_MOVES], [HORIZONTAL_PIN, HORIZONTAL_PIN_MOVES]] as const) {
    const game = play(start, moves);
    // chess.js alone keeps the unusable right in its repetition hash.
    assert.equal(game.isThreefoldRepetition(), false, start);
    assert.equal(isThreefoldRepetition(game), true, start);
    assert.equal(isGameOver(game), true, start);
    assert.deepEqual(describeGameResult(game, 'w'), { outcome: 'draw', reason: 'threefold', winner: null });
    assert.equal(engineReason(start, game.history({ verbose: true })), 'threefold', start);
    // One move earlier the position has occurred twice: not yet a draw.
    const before = play(start, moves.slice(0, -4));
    assert.equal(isGameOver(before), false, start);
  }
});

test('a legal en-passant right still distinguishes the position', () => {
  // Same shuffle without the pinning rook: exd6 is legal right after d7d5.
  const start = '6k1/3p4/8/4P3/8/8/8/4K3 b - - 0 1';
  const game = play(start, VERTICAL_PIN_MOVES);
  assert.equal(game.fen().split(' ')[3], '-');
  assert.equal(isThreefoldRepetition(game), false);
  assert.equal(isGameOver(game), false);
  assert.equal(engineReason(start, game.history({ verbose: true })), null);
  // One more cycle makes it threefold for everyone.
  const longer = play(start, [...VERTICAL_PIN_MOVES, 'e1f1', 'g8h8', 'f1e1', 'h8g8']);
  assert.equal(longer.isThreefoldRepetition(), true);
  assert.equal(isThreefoldRepetition(longer), true);
  assert.equal(engineReason(start, longer.history({ verbose: true })), 'threefold');
});

test('the room worker and FEN-history clients agree on the pinned en-passant threefold', () => {
  const game = new Chess(VERTICAL_PIN);
  const fenHistory = [game.fen()];
  for (const uci of VERTICAL_PIN_MOVES) {
    game.move({ from: uci.slice(0, 2), to: uci.slice(2, 4) });
    fenHistory.push(game.fen());
  }
  assert.equal(hasThreefoldRepetition(game.fen(), fenHistory), true);
  assert.equal(isGameFinished(game.fen(), fenHistory), true);
  const next = new Chess(game.fen());
  next.move('Kf1');
  assert.deepEqual(validateMove({ currentFen: game.fen(), nextFen: next.fen(), role: 'player', color: 'w', fenHistory }),
    { ok: false, code: 'game-over' });
  // A client holding only the FEN and the synchronized history.
  assert.equal(appReason(new Chess(game.fen()), fenHistory), 'threefold');
});

test('checkmate on the hundredth reversible half-move takes precedence for both', () => {
  const start = '7k/8/6K1/8/8/8/8/R7 w - - 99 80';
  const game = play(start, ['a1a8']);
  assert.equal(game.isCheckmate(), true);
  assert.equal(appReason(game), 'checkmate');
  assert.equal(engineReason(start, game.history({ verbose: true })), 'checkmate');
  const quiet = play(start, ['a1b1']);
  assert.equal(appReason(quiet), 'fiftyMove');
  assert.equal(engineReason(start, quiet.history({ verbose: true })), 'fiftyMove');
});

const mulberry32 = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** `back`: how often a side undoes its previous move; `mate`: how often a mating move is played. */
const KIND_STARTS: ReadonlyArray<{ fen: string; prefix?: string[]; back: number; mate: number }> = [
  { fen: new Chess().fen(), back: 0.3, mate: 0.5 },
  { fen: VERTICAL_PIN, prefix: ['d7d5'], back: 0.9, mate: 0 },
  { fen: HORIZONTAL_PIN, prefix: ['e2e4'], back: 0.9, mate: 0 },
  { fen: '6k1/3p4/8/4P3/8/8/8/4K3 b - - 0 1', prefix: ['d7d5'], back: 0.9, mate: 0 },
  { fen: '4k3/8/8/8/8/8/R7/4K3 w - - 80 80', back: 0, mate: 0 },
  { fen: '4k3/8/8/3n4/8/2B5/8/4K3 w - - 0 1', back: 0.2, mate: 0 },
  { fen: '4k3/2p5/8/8/8/8/5P2/4K2R w K - 0 1', back: 0.5, mate: 0.9 },
  { fen: 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', back: 0.4, mate: 0.9 },
  { fen: '7k/5Q2/8/6K1/8/8/8/8 w - - 0 1', back: 0, mate: 0.9 },
];

test('random games: application and engine adjudication agree after every move', (t) => {
  const random = mulberry32(20261106);
  const seen = new Map<string, number>();
  let chessJsMisses = 0;
  let steps = 0;
  for (let gameIndex = 0; gameIndex < 90; gameIndex += 1) {
    const { fen: start, prefix = [], back: backRate, mate: mateRate } = KIND_STARTS[gameIndex % KIND_STARTS.length];
    const game = new Chess(start);
    const fenHistory = [game.fen()];
    const played: Move[] = [];
    for (let ply = 0; ply < 140; ply += 1) {
      const moves = game.moves({ verbose: true });
      if (moves.length === 0) break;
      let move: Move;
      if (ply < prefix.length) {
        move = moves.find((m) => `${m.from}${m.to}` === prefix[ply])!;
      } else {
        // Undo our own previous move so that repetitions happen, or mate.
        const own = played.at(-2);
        const mate = random() < mateRate ? moves.find((m) => m.san.endsWith('#')) : undefined;
        const back = own && random() < backRate ? moves.find((m) => m.from === own.to && m.to === own.from) : undefined;
        move = mate ?? back ?? moves[Math.floor(random() * moves.length)];
      }
      played.push(game.move(move));
      fenHistory.push(game.fen());
      steps += 1;

      const engine = engineReason(start, played);
      const app = appReason(game);
      assert.equal(app, engine, `single player: game ${gameIndex} ply ${ply} ${game.fen()}`);
      assert.equal(isGameOver(game), engine !== null);
      // Multiplayer: FEN-only games with the room's history, client and worker.
      assert.equal(appReason(new Chess(game.fen()), fenHistory), engine, `room: game ${gameIndex} ply ${ply}`);
      assert.equal(isGameFinished(game.fen(), fenHistory), engine !== null);
      if (engine === 'threefold' && !game.isThreefoldRepetition()) chessJsMisses += 1;
      if (engine !== null) { seen.set(engine, (seen.get(engine) ?? 0) + 1); break; }
    }
  }
  const summary = JSON.stringify(Object.fromEntries(seen));
  for (const reason of ['checkmate', 'stalemate', 'insufficient', 'threefold', 'fiftyMove']) {
    assert.ok((seen.get(reason) ?? 0) > 0, `no ${reason} reached: ${summary}`);
  }
  assert.ok(chessJsMisses > 0, 'the sample must include threefolds that chess.js alone misses');
  assert.ok(steps > 1000, `steps ${steps}`);
  t.diagnostic(`endings ${summary}, ${steps} positions, ${chessJsMisses} threefolds chess.js alone misses`);
});

test('insufficient material agrees for every small material set and placement sample', () => {
  const random = mulberry32(7);
  let checked = 0;
  const sets = ['', 'N', 'B', 'n', 'b', 'NN', 'BB', 'Bb', 'Nb', 'Bn', 'bb', 'nn', 'BN', 'bbb', 'BBb', 'P', 'p', 'R', 'q'];
  for (const set of sets) for (let sample = 0; sample < 60; sample += 1) {
    const squares = new Set<number>();
    const pick = (avoidBackRanks: boolean): number => {
      for (;;) {
        const square = Math.floor(random() * 64);
        if (squares.has(square) || (avoidBackRanks && (square < 8 || square >= 56))) continue;
        squares.add(square); return square;
      }
    };
    const board: string[] = new Array(64).fill('');
    board[pick(false)] = 'K'; board[pick(false)] = 'k';
    for (const piece of set) board[pick(piece.toLowerCase() === 'p')] = piece;
    const rows: string[] = [];
    for (let rank = 0; rank < 8; rank += 1) {
      let row = ''; let empty = 0;
      for (let file = 0; file < 8; file += 1) {
        const piece = board[rank * 8 + file];
        if (!piece) { empty += 1; continue; }
        if (empty) { row += empty; empty = 0; }
        row += piece;
      }
      rows.push(row + (empty ? empty : ''));
    }
    const fen = `${rows.join('/')} w - - 0 1`;
    let game: Chess; let position: SearchPosition;
    try { game = new Chess(fen); position = new SearchPosition(fen); } catch { continue; }
    assert.equal(position.isInsufficientMaterial(), game.isInsufficientMaterial(), fen);
    checked += 1;
  }
  assert.ok(checked > 900, `checked ${checked}`);
});

test('application code decides game over through gameResult, not chess.js alone', () => {
  // The worker's search entry (src/utils/chessAI.ts) keeps chess.js's test:
  // the application never asks it to move once these rules end the game, and
  // chess.js never reports a repetition that these rules do not.
  for (const file of ['src/hooks/useSinglePlayerAi.ts', 'src/components/SinglePlayerRoom.tsx', 'src/components/GameRoom.tsx',
    'src/utils/moveSound.ts', 'src/utils/singlePlayerSavedGame.ts', 'src/utils/restoreSinglePlayerGame.ts']) {
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /\.(isGameOver|isDraw|isThreefoldRepetition)\(\)/, file);
  }
});

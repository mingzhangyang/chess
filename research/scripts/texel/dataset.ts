/**
 * Texel data set (phase 11): which self-play positions are kept.
 *
 * A game record holds the moves of one self-play game from the standard
 * start and its result from white's side. extractPositions replays it and
 * keeps a position only when
 * - it is past the first 8 moves (ply 16 or later) and past the fixed opening,
 * - the side to move is not in check,
 * - it is quiet: the kernel's capture search returns the static evaluation,
 * - it was not kept before (same placement, side, castling and en passant).
 */
import { resolveAiTuning } from '../../../src/utils/chessAI';
import { kernelStaticAndQuiescence } from '../../../src/utils/chess-ai/independent/kernelSearch';
import { SearchPosition, squareFromAlgebraic, type SearchMove } from '../../../src/utils/chess-ai/searchPosition';

export const STANDARD_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
/** Positions before this ply (the first 8 moves) are dropped. */
export const MIN_PLY = 16;

export type GameRecord = {
  id: number;
  /** Plies of the fixed opening at the start of `moves`. */
  openingPlies: number;
  moves: string[];
  /** White's score: 1, 0.5 or 0. */
  result: number;
  reason: string;
};
export type DataPosition = { fen: string; ply: number; result: number; game: number };

export const toSearchMove = (uci: string): SearchMove => ({
  from: squareFromAlgebraic(uci.slice(0, 2)),
  to: squareFromAlgebraic(uci.slice(2, 4)),
  ...(uci.length === 5 ? { promotion: uci[4] as SearchMove['promotion'] } : {}),
});

/** Placement, side, castling and en passant: the FEN without its clocks. */
export const positionKey = (fen: string): string => fen.split(' ').slice(0, 4).join(' ');

const TUNING = resolveAiTuning({});

export const isQuietForKernel = (position: SearchPosition): boolean => {
  const { staticEval, quiescence } = kernelStaticAndQuiescence(position, TUNING);
  return staticEval === quiescence;
};

export const extractPositions = (game: GameRecord, seen: Set<string> = new Set()): DataPosition[] => {
  const out: DataPosition[] = [];
  const position = new SearchPosition(STANDARD_FEN, { historyComplete: true });
  const first = Math.max(MIN_PLY, game.openingPlies);
  for (let ply = 0; ply <= game.moves.length; ply += 1) {
    if (ply > 0) position.makeMove(toSearchMove(game.moves[ply - 1]));
    if (ply < first) continue;
    if (position.isInCheck() || !position.hasLegalMove()) continue;
    const fen = position.toFen();
    const key = positionKey(fen);
    if (seen.has(key)) continue;
    // Each check runs on a sealed copy so the replay's own state is untouched.
    if (!isQuietForKernel(new SearchPosition(fen))) continue;
    seen.add(key);
    out.push({ fen, ply, result: game.result, game: game.id });
  }
  return out;
};

/** About one game in five goes to validation, by a hash of its id, so no game is split. */
export const splitTrainValidation = (gameId: number): 'train' | 'validation' => {
  const h = Math.imul(gameId ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  return ((h ^ (h >>> 13)) >>> 0) % 5 === 0 ? 'validation' : 'train';
};

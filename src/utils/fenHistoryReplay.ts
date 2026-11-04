import { Chess } from 'chess.js';
import { MAX_FEN_HISTORY } from '../../shared/realtimeProtocol';

export interface FenReplayCache {
  fens: string[];
  moves: string[];
}

export interface ReplayedHistory {
  moves: string[];
  firstMoveNumber: number;
  startsWithBlack: boolean;
}

export interface MoveHistoryRow {
  moveNumber: number;
  white: string | null;
  black: string | null;
}

function emptyCache(): FenReplayCache {
  return { fens: [], moves: [] };
}

function startsWith(values: readonly string[], prefix: readonly string[]): boolean {
  if (prefix.length > values.length) return false;
  for (let index = 0; index < prefix.length; index += 1) {
    if (values[index] !== prefix[index]) return false;
  }
  return true;
}

function headerFrom(fen: string | undefined): Pick<ReplayedHistory, 'firstMoveNumber' | 'startsWithBlack'> {
  const parts = fen?.split(' ') ?? [];
  const fullmove = Number(parts[5]);
  return {
    firstMoveNumber: Number.isInteger(fullmove) && fullmove > 0 ? fullmove : 1,
    startsWithBlack: parts[1] === 'b',
  };
}

function changedMove(beforeFen: string, afterFen: string): { from: string; to: string; promotion?: string } | null {
  const expand = (fen: string): string[] | null => {
    const ranks = fen.split(' ')[0].split('/');
    if (ranks.length !== 8) return null;
    const result: string[] = [];
    for (const rank of ranks) {
      let cells = '';
      for (const c of rank) {
        const count = Number(c);
        cells += Number.isInteger(count) && count >= 1 && count <= 8 ? '.'.repeat(count) : c;
      }
      if (cells.length !== 8) return null;
      result.push(...cells);
    }
    return result;
  };
  const before = expand(beforeFen);
  const after = expand(afterFen);
  if (!before || !after) return null;
  const turn = beforeFen.split(' ')[1];
  const mover = (piece: string) => piece !== '.' && (turn === 'w' ? piece === piece.toUpperCase() : piece === piece.toLowerCase());
  const departure = before.map((_, index) => index).filter((index) => before[index] !== after[index] && mover(before[index]));
  const arrival = after.map((_, index) => index).filter((index) => before[index] !== after[index] && mover(after[index]));
  const square = (index: number) => `${'abcdefgh'[index % 8]}${8 - Math.floor(index / 8)}`;
  // Castling changes both a king and a rook: choose the king's squares.
  const king = turn === 'w' ? 'K' : 'k';
  const kingFrom = departure.find((index) => before[index] === king);
  const kingTo = arrival.find((index) => after[index] === king);
  if (kingFrom !== undefined && kingTo !== undefined) {
    return { from: square(kingFrom), to: square(kingTo) };
  }
  if (departure.length !== 1 || arrival.length !== 1) return null;
  const from = departure[0];
  const to = arrival[0];
  const promotion = before[from].toLowerCase() === 'p' && after[to].toLowerCase() !== 'p'
    ? after[to].toLowerCase()
    : undefined;
  return { from: square(from), to: square(to), ...(promotion ? { promotion } : {}) };
}

function playTargets(startFen: string, targets: readonly string[]): { moves: string[]; played: number } | null {
  let replay: Chess;
  try {
    replay = new Chess(startFen);
  } catch {
    return null;
  }

  const moves: string[] = [];
  for (const target of targets) {
    const request = changedMove(replay.fen(), target);
    if (!request) break;
    try {
      const move = replay.move(request);
      if (!move || replay.fen() !== target) break;
      moves.push(move.san);
    } catch {
      break;
    }
  }
  return { moves, played: moves.length };
}

export function replayFenHistory(
  fenHistory: readonly string[],
  cache: FenReplayCache = emptyCache(),
): ReplayedHistory {
  if (fenHistory.length < 2) {
    cache.fens = [...fenHistory];
    cache.moves = [];
    return { moves: [], ...headerFrom(fenHistory[0]) };
  }

  const cachedIsConsistent = cache.moves.length === Math.max(0, cache.fens.length - 1);
  if (cachedIsConsistent && cache.fens.length >= 1 && startsWith(fenHistory, cache.fens)) {
    const extraTargets = fenHistory.slice(cache.fens.length);
    const played = playTargets(cache.fens[cache.fens.length - 1], extraTargets);
    if (played && played.played === extraTargets.length) {
      cache.moves = cache.moves.concat(played.moves);
      cache.fens = [...fenHistory];
      return { moves: [...cache.moves], ...headerFrom(fenHistory[0]) };
    }
    if (played && played.played > 0) {
      cache.moves = cache.moves.concat(played.moves);
      cache.fens = fenHistory.slice(0, cache.fens.length + played.played);
      return { moves: [...cache.moves], ...headerFrom(fenHistory[0]) };
    }
    return { moves: [...cache.moves], ...headerFrom(cache.fens[0]) };
  }

  if (cachedIsConsistent && cache.fens.length > fenHistory.length && startsWith(cache.fens, fenHistory)) {
    cache.fens = [...fenHistory];
    cache.moves = cache.moves.slice(0, fenHistory.length - 1);
    return { moves: [...cache.moves], ...headerFrom(cache.fens[0]) };
  }

  // Sliding MAX_FEN_HISTORY-position window: reuse the overlapping cached suffix rather
  // than reconstructing hundreds of moves every time the oldest FEN drops.
  if (cachedIsConsistent && cache.fens.length > 1) {
    const first = cache.fens.indexOf(fenHistory[0]);
    if (first > 0 && startsWith(fenHistory, cache.fens.slice(first))) {
      const overlap = cache.fens.length - first;
      const suffix = cache.moves.slice(first);
      const extraTargets = fenHistory.slice(overlap);
      const extension = playTargets(cache.fens[cache.fens.length - 1], extraTargets);
      if (extension && extension.played === extraTargets.length) {
        cache.moves = suffix.concat(extension.moves);
        cache.fens = [...fenHistory];
        return { moves: [...cache.moves], ...headerFrom(fenHistory[0]) };
      }
    }
  }

  const played = playTargets(fenHistory[0], fenHistory.slice(1));
  if (!played) {
    cache.fens = [];
    cache.moves = [];
    return { moves: [], firstMoveNumber: 1, startsWithBlack: false };
  }

  cache.fens = fenHistory.slice(0, played.played + 1);
  cache.moves = played.moves;
  return { moves: [...cache.moves], ...headerFrom(cache.fens[0] ?? fenHistory[0]) };
}

export function groupMoveHistory(
  moves: readonly string[],
  firstMoveNumber: number,
  startsWithBlack: boolean,
): MoveHistoryRow[] {
  const rows: MoveHistoryRow[] = [];
  let index = 0;
  let moveNumber = firstMoveNumber;
  if (startsWithBlack && index < moves.length) {
    rows.push({ moveNumber, white: null, black: moves[index] });
    index += 1;
    moveNumber += 1;
  }
  for (; index < moves.length; index += 2) {
    rows.push({
      moveNumber,
      white: moves[index],
      black: moves[index + 1] ?? null,
    });
    moveNumber += 1;
  }
  return rows;
}

/**
 * Applies a `chess-move` broadcast to the locally held FEN history. The server
 * only sends the full history on `room-state` (join, reconnect, undo, reset),
 * so each move carries just the position it was played from.
 */
export function appendFenHistory(
  history: string[],
  previousFen: string | undefined,
  fen: string,
): string[] {
  if (history.at(-1) === fen) return history;
  if (previousFen !== undefined && history.at(-1) === previousFen) {
    const next = [...history, fen];
    return next.length > MAX_FEN_HISTORY ? next.slice(-MAX_FEN_HISTORY) : next;
  }
  return previousFen !== undefined ? [previousFen, fen] : [fen];
}

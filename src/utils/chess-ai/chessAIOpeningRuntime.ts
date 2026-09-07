import { Chess, Move } from 'chess.js';
import {
  COMMITTED_LINES_BLACK,
  COMMITTED_LINES_WHITE,
  HARD_OPENING_BOOK,
  type OpeningBookEntry,
  type OpeningLine,
} from './chessAIOpenings';
import type { AiTuning } from './chessAITuning';

let committedLine: OpeningLine | null = null;
let committedLineAborted = false;

const toUci = (move: Pick<Move, 'from' | 'to' | 'promotion'>): string =>
  `${move.from}${move.to}${move.promotion ?? ''}`;

export const wouldAllowImmediateMate = (game: Chess, move: Pick<Move, 'from' | 'to' | 'promotion'>): boolean => {
  const probe = new Chess(game.fen());
  const applied = probe.move({
    from: move.from,
    to: move.to,
    promotion: move.promotion,
  });
  if (!applied) {
    return true;
  }

  const replies = probe.moves({ verbose: true }) as Move[];
  for (const reply of replies) {
    probe.move(reply.san);
    const isMate = probe.isCheckmate();
    probe.undo();
    if (isMate) {
      return true;
    }
  }

  return false;
};

export const resetOpeningState = (): void => {
  committedLine = null;
  committedLineAborted = false;
};

export const selectCommittedLine = (color: 'w' | 'b'): void => {
  const lines = color === 'w' ? COMMITTED_LINES_WHITE : COMMITTED_LINES_BLACK;
  committedLine = lines[Math.floor(Math.random() * lines.length)];
  committedLineAborted = false;
};

export const getCommittedOpeningMove = (
  game: Chess,
  color: 'w' | 'b',
  plyCount: number,
  lineOverride?: OpeningLine,
): string | null => {
  const activeLine = lineOverride ?? committedLine;
  const abortLine = (): null => {
    if (!lineOverride) {
      committedLineAborted = true;
    }
    return null;
  };

  if (!activeLine || (!lineOverride && committedLineAborted)) return null;

  // Safety: the committed line must have been selected for this side
  if (activeLine.aiColor !== color) {
    return abortLine();
  }

  // Abort on check
  if (game.isCheck()) {
    return abortLine();
  }

  // Abort if opponent's last move was any capture — position may be tactically sharp
  const history = game.history({ verbose: true }) as Move[];
  if (history.length > 0 && history[history.length - 1].captured) {
    return abortLine();
  }

  // Identify which slot in the interleaved line corresponds to our next move
  const aiMovesMade = color === 'w' ? Math.floor(plyCount / 2) : Math.floor((plyCount - 1) / 2);
  const ourSlot = color === 'w' ? aiMovesMade * 2 : aiMovesMade * 2 + 1;
  if (ourSlot >= activeLine.moves.length) return null;

  // Guard: game ply must match the expected slot — catches any state mismatch.
  if (history.length !== ourSlot || plyCount !== history.length || game.turn() !== color) {
    return abortLine();
  }

  // Verify every prior move in the committed line; checking only the last move
  // would allow a divergent middle game to re-enter the planned sequence.
  for (let i = 0; i < history.length; i += 1) {
    if (toUci(history[i]) !== activeLine.moves[i]) {
      return abortLine();
    }
  }

  const plannedUci = activeLine.moves[ourSlot];

  // Verify the move is still legal in the current position
  const legalMoves = game.moves({ verbose: true });
  const legalByUci = new Map(legalMoves.map((m) => [toUci(m), m] as const));
  const legal = legalByUci.get(plannedUci);
  if (!legal) {
    return abortLine();
  }

  if (wouldAllowImmediateMate(game, legal)) {
    return abortLine();
  }

  return legal.san;
};

export const getOpeningBookMove = (
  game: Chess,
  tuning: AiTuning,
  bookOverride?: OpeningBookEntry[],
): string | null => {
  if (!tuning.openingBookEnabled) {
    return null;
  }

  const history = game.history({ verbose: true }) as Move[];
  if (history.length >= tuning.openingBookMaxPly) {
    return null;
  }

  const historyUci = history.map(toUci);
  const openingBook = bookOverride ?? HARD_OPENING_BOOK;
  const matchedEntries = openingBook.filter((entry) => {
    if (entry.sequence.length !== historyUci.length) {
      return false;
    }
    for (let i = 0; i < entry.sequence.length; i += 1) {
      if (entry.sequence[i] !== historyUci[i]) {
        return false;
      }
    }
    return true;
  });

  if (matchedEntries.length === 0) {
    return null;
  }

  const legalMoves = game.moves({ verbose: true });
  const legalByUci = new Map(legalMoves.map((move) => [toUci(move), move] as const));
  const candidateMoves: Move[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < matchedEntries.length; i += 1) {
    const entry = matchedEntries[i];
    for (let j = 0; j < entry.replies.length; j += 1) {
      const reply = entry.replies[j];
      const legalMove = legalByUci.get(reply);
      if (legalMove && !seen.has(reply) && !wouldAllowImmediateMate(game, legalMove)) {
        seen.add(reply);
        candidateMoves.push(legalMove);
      }
    }
  }

  if (candidateMoves.length === 0) {
    return null;
  }

  const choiceIndex = Math.floor(Math.random() * candidateMoves.length);
  return candidateMoves[choiceIndex].san;
};

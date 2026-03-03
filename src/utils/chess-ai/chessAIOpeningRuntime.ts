import { Chess, Move } from 'chess.js';
import { COMMITTED_LINES_BLACK, COMMITTED_LINES_WHITE, HARD_OPENING_BOOK, OpeningLine } from './chessAIOpenings';
import type { AiTuning } from './chessAITuning';

let committedLine: OpeningLine | null = null;
let committedLineAborted = false;

const toUci = (move: Pick<Move, 'from' | 'to' | 'promotion'>): string =>
  `${move.from}${move.to}${move.promotion ?? ''}`;

export const resetOpeningState = (): void => {
  committedLine = null;
  committedLineAborted = false;
};

export const selectCommittedLine = (color: 'w' | 'b'): void => {
  const lines = color === 'w' ? COMMITTED_LINES_WHITE : COMMITTED_LINES_BLACK;
  committedLine = lines[Math.floor(Math.random() * lines.length)];
  committedLineAborted = false;
};

export const getCommittedOpeningMove = (game: Chess, color: 'w' | 'b', plyCount: number): string | null => {
  if (!committedLine || committedLineAborted) return null;

  // Safety: the committed line must have been selected for this side
  if (committedLine.aiColor !== color) {
    committedLineAborted = true;
    return null;
  }

  // Abort on check
  if (game.isCheck()) {
    committedLineAborted = true;
    return null;
  }

  // Abort if opponent's last move was any capture — position may be tactically sharp
  const history = game.history({ verbose: true }) as Move[];
  if (history.length > 0 && history[history.length - 1].captured) {
    committedLineAborted = true;
    return null;
  }

  // Identify which slot in the interleaved line corresponds to our next move
  const aiMovesMade = color === 'w' ? Math.floor(plyCount / 2) : Math.floor((plyCount - 1) / 2);
  const ourSlot = color === 'w' ? aiMovesMade * 2 : aiMovesMade * 2 + 1;
  if (ourSlot >= committedLine.moves.length) return null;

  // Guard: game ply must match the expected slot — catches any state mismatch.
  if (history.length !== ourSlot) {
    committedLineAborted = true;
    return null;
  }

  // Verify the opponent followed the expected line; abort if they deviated
  const opponentSlot = ourSlot - 1;
  if (opponentSlot >= 0 && history.length > 0) {
    const expected = committedLine.moves[opponentSlot];
    const actual = toUci(history[history.length - 1]);
    if (actual !== expected) {
      committedLineAborted = true;
      return null;
    }
  }

  const plannedUci = committedLine.moves[ourSlot];

  // Verify the move is still legal in the current position
  const legalMoves = game.moves({ verbose: true });
  const legalByUci = new Map(legalMoves.map((m) => [toUci(m), m] as const));
  const legal = legalByUci.get(plannedUci);
  if (!legal) {
    committedLineAborted = true;
    return null;
  }

  return legal.san;
};

export const getOpeningBookMove = (game: Chess, tuning: AiTuning): string | null => {
  if (!tuning.openingBookEnabled) {
    return null;
  }

  const history = game.history({ verbose: true }) as Move[];
  if (history.length >= tuning.openingBookMaxPly) {
    return null;
  }

  const historyUci = history.map(toUci);
  const matchedEntries = HARD_OPENING_BOOK.filter((entry) => {
    if (entry.sequence.length > historyUci.length) {
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

  matchedEntries.sort((a, b) => b.sequence.length - a.sequence.length);
  const longestLength = matchedEntries[0].sequence.length;
  const scopedEntries = matchedEntries.filter((entry) => entry.sequence.length === longestLength);

  const legalMoves = game.moves({ verbose: true });
  const legalByUci = new Map(legalMoves.map((move) => [toUci(move), move] as const));
  const candidateMoves: Move[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < scopedEntries.length; i += 1) {
    const entry = scopedEntries[i];
    for (let j = 0; j < entry.replies.length; j += 1) {
      const reply = entry.replies[j];
      const legalMove = legalByUci.get(reply);
      if (legalMove && !seen.has(reply)) {
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

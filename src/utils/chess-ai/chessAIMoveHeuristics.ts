import type { AiMove } from './chessAIBoardOps';

export type CompactMove = Pick<AiMove, 'from' | 'to' | 'promotion'>;

type HeuristicMutation =
  | { kind: 'killer'; move: CompactMove; ply: number }
  | { kind: 'history-bonus'; move: CompactMove; depth: number }
  | { kind: 'history-malus'; move: CompactMove; depth: number }
  | { kind: 'countermove'; replyingColor: 'w' | 'b'; previousMove: CompactMove; replyMove: CompactMove };

// Move-ordering state is optional; bound staged mutations so aborted/slow
// searches cannot retain an unbounded list of Move/FEN objects.
export const MAX_PENDING_HEURISTIC_MUTATIONS = 4096;
let pendingHeuristicMutations: HeuristicMutation[] | null = null;

const toCompactMove = (move: CompactMove): CompactMove => ({
  from: move.from,
  to: move.to,
  promotion: move.promotion,
});

// --- Killer Move Heuristic ---
const MAX_KILLER_PLY = 10;
const killerMoves: Array<[CompactMove | null, CompactMove | null]> = Array.from(
  { length: MAX_KILLER_PLY + 1 },
  () => [null, null],
);

export const clearKillers = (): void => {
  for (let i = 0; i <= MAX_KILLER_PLY; i += 1) {
    killerMoves[i][0] = null;
    killerMoves[i][1] = null;
  }
};

const storeKillerNow = (move: CompactMove, ply: number): void => {
  if (ply > MAX_KILLER_PLY) return;
  const slot = killerMoves[ply];
  if (slot[0] && slot[0].from === move.from && slot[0].to === move.to) return;
  slot[1] = slot[0];
  slot[0] = move;
};

export const storeKiller = (move: CompactMove, ply: number): void => {
  if (pendingHeuristicMutations) {
    if (pendingHeuristicMutations.length < MAX_PENDING_HEURISTIC_MUTATIONS) {
      pendingHeuristicMutations.push({ kind: 'killer', move: toCompactMove(move), ply });
    }
    return;
  }
  storeKillerNow(move, ply);
};

export const killerScore = (move: AiMove, ply: number): number => {
  if (move.isCapture() || move.isPromotion() || ply > MAX_KILLER_PLY) return 0;
  const slot = killerMoves[ply];
  if (slot[0] && slot[0].from === move.from && slot[0].to === move.to) return 90;
  if (slot[1] && slot[1].from === move.from && slot[1].to === move.to) return 80;
  return 0;
};

// --- History Heuristic ---
// Maps (fromSquare, toSquare) → accumulated score for quiet moves that caused beta cutoffs.
// Persists across moves within a game; cleared at game start and on full reset.
const squareToIndex = (sq: string): number =>
  (sq.charCodeAt(1) - 49) * 8 + (sq.charCodeAt(0) - 97);

const historyTable: number[][] = Array.from({ length: 64 }, () => new Array(64).fill(0));
const MAX_HISTORY_SCORE = 8000;
const MIN_HISTORY_SCORE = -MAX_HISTORY_SCORE;

export const clearHistory = (): void => {
  for (let i = 0; i < 64; i += 1) historyTable[i].fill(0);
};

// Called on beta cutoff for quiet moves; depth² bonus rewards deeper cutoffs more.
const applyHistoryBonusNow = (move: CompactMove, depth: number): void => {
  const from = squareToIndex(move.from);
  const to = squareToIndex(move.to);
  historyTable[from][to] = Math.min(historyTable[from][to] + depth * depth, MAX_HISTORY_SCORE);
};

export const applyHistoryBonus = (move: CompactMove, depth: number): void => {
  if (pendingHeuristicMutations) {
    if (pendingHeuristicMutations.length < MAX_PENDING_HEURISTIC_MUTATIONS) {
      pendingHeuristicMutations.push({ kind: 'history-bonus', move: toCompactMove(move), depth });
    }
    return;
  }
  applyHistoryBonusNow(move, depth);
};

const applyHistoryMalusNow = (move: CompactMove, depth: number): void => {
  const from = squareToIndex(move.from);
  const to = squareToIndex(move.to);
  historyTable[from][to] = Math.max(historyTable[from][to] - depth * depth, MIN_HISTORY_SCORE);
};

export const applyHistoryMalus = (move: CompactMove, depth: number): void => {
  if (pendingHeuristicMutations) {
    if (pendingHeuristicMutations.length < MAX_PENDING_HEURISTIC_MUTATIONS) {
      pendingHeuristicMutations.push({ kind: 'history-malus', move: toCompactMove(move), depth });
    }
    return;
  }
  applyHistoryMalusNow(move, depth);
};

// Returns a 0–70 ordering bonus (below killer scores of 80–90) for quiet moves.
export const getHistoryScore = (move: AiMove): number => {
  if (move.isCapture() || move.isPromotion()) return 0;
  return getHistoryScoreForMove(move);
};

export const getHistoryScoreForMove = (move: CompactMove): number => {
  const from = squareToIndex(move.from);
  const to = squareToIndex(move.to);
  return (historyTable[from][to] * 70 / MAX_HISTORY_SCORE) | 0;
};

// --- Countermove Heuristic ---
// For each (side-to-move, previous move from/to), remember the quiet reply that
// previously produced a cutoff, and boost that reply in move ordering.
const COUNTERMOVE_BONUS = 75;
const countermoveTable: [Uint16Array, Uint16Array] = [
  new Uint16Array(64 * 64), // replies for white to move
  new Uint16Array(64 * 64), // replies for black to move
];

const PROMO_TO_INT: Record<string, number> = { q: 1, r: 2, b: 3, n: 4 };

const encodeCompactMove = (move: CompactMove): number => {
  const from = (move.from.charCodeAt(1) - 49) * 8 + (move.from.charCodeAt(0) - 97);
  const to = (move.to.charCodeAt(1) - 49) * 8 + (move.to.charCodeAt(0) - 97);
  const promo = move.promotion ? (PROMO_TO_INT[move.promotion] ?? 0) : 0;
  return (from & 63) | ((to & 63) << 6) | ((promo & 7) << 12);
};

const colorToIndex = (color: 'w' | 'b'): 0 | 1 => (color === 'w' ? 0 : 1);
const encodeMovePairIndex = (move: CompactMove): number =>
  squareToIndex(move.from) * 64 + squareToIndex(move.to);

export const clearCountermoves = (): void => {
  countermoveTable[0].fill(0);
  countermoveTable[1].fill(0);
};

const recordCountermoveNow = (
  replyingColor: 'w' | 'b',
  previousMove: CompactMove,
  replyMove: CompactMove,
): void => {
  const table = countermoveTable[colorToIndex(replyingColor)];
  table[encodeMovePairIndex(previousMove)] = encodeCompactMove(replyMove);
};

export const recordCountermove = (
  replyingColor: 'w' | 'b',
  previousMove: CompactMove,
  replyMove: CompactMove,
): void => {
  if (pendingHeuristicMutations) {
    if (pendingHeuristicMutations.length < MAX_PENDING_HEURISTIC_MUTATIONS) {
      pendingHeuristicMutations.push({
        kind: 'countermove',
        replyingColor,
        previousMove: toCompactMove(previousMove),
        replyMove: toCompactMove(replyMove),
      });
    }
    return;
  }
  recordCountermoveNow(replyingColor, previousMove, replyMove);
};

export const getCountermoveScore = (
  replyingColor: 'w' | 'b',
  previousMove: CompactMove | null | undefined,
  candidate: CompactMove,
): number => {
  if (!previousMove) return 0;
  const table = countermoveTable[colorToIndex(replyingColor)];
  const expected = table[encodeMovePairIndex(previousMove)];
  if (expected === 0) return 0;
  return expected === encodeCompactMove(candidate) ? COUNTERMOVE_BONUS : 0;
};

export const beginMoveHeuristicTransaction = (): void => {
  pendingHeuristicMutations = [];
};

export const commitMoveHeuristicTransaction = (): void => {
  const mutations = pendingHeuristicMutations;
  pendingHeuristicMutations = null;
  if (!mutations) return;

  for (const mutation of mutations) {
    if (mutation.kind === 'killer') {
      storeKillerNow(mutation.move, mutation.ply);
    } else if (mutation.kind === 'history-bonus') {
      applyHistoryBonusNow(mutation.move, mutation.depth);
    } else if (mutation.kind === 'history-malus') {
      applyHistoryMalusNow(mutation.move, mutation.depth);
    } else {
      recordCountermoveNow(mutation.replyingColor, mutation.previousMove, mutation.replyMove);
    }
  }
};

export const discardMoveHeuristicTransaction = (): void => {
  pendingHeuristicMutations = null;
};

export const getPendingHeuristicMutationCountForTesting = (): number => pendingHeuristicMutations?.length ?? 0;

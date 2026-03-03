import type { Move } from 'chess.js';

export type CompactMove = Pick<Move, 'from' | 'to' | 'promotion'>;

// --- Killer Move Heuristic ---
const MAX_KILLER_PLY = 10;
const killerMoves: Array<[Move | null, Move | null]> = Array.from(
  { length: MAX_KILLER_PLY + 1 },
  () => [null, null],
);

export const clearKillers = (): void => {
  for (let i = 0; i <= MAX_KILLER_PLY; i += 1) {
    killerMoves[i][0] = null;
    killerMoves[i][1] = null;
  }
};

export const storeKiller = (move: Move, ply: number): void => {
  if (ply > MAX_KILLER_PLY) return;
  const slot = killerMoves[ply];
  if (slot[0] && slot[0].from === move.from && slot[0].to === move.to) return;
  slot[1] = slot[0];
  slot[0] = move;
};

export const killerScore = (move: Move, ply: number): number => {
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
export const applyHistoryBonus = (move: CompactMove, depth: number): void => {
  const from = squareToIndex(move.from);
  const to = squareToIndex(move.to);
  historyTable[from][to] = Math.min(historyTable[from][to] + depth * depth, MAX_HISTORY_SCORE);
};

export const applyHistoryMalus = (move: CompactMove, depth: number): void => {
  const from = squareToIndex(move.from);
  const to = squareToIndex(move.to);
  historyTable[from][to] = Math.max(historyTable[from][to] - depth * depth, MIN_HISTORY_SCORE);
};

// Returns a 0–70 ordering bonus (below killer scores of 80–90) for quiet moves.
export const getHistoryScore = (move: Move): number => {
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

export const recordCountermove = (
  replyingColor: 'w' | 'b',
  previousMove: CompactMove,
  replyMove: CompactMove,
): void => {
  const table = countermoveTable[colorToIndex(replyingColor)];
  table[encodeMovePairIndex(previousMove)] = encodeCompactMove(replyMove);
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

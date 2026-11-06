/**
 * Integer move encoding for the independent kernel. One move is a
 * non-negative 24-bit integer, never 0 (a move cannot go from a8 to a8):
 *
 *   bits  0..5   from square (a8 = 0 .. h1 = 63)
 *   bits  6..11  to square
 *   bits 12..14  promotion piece type (0 = none, 2..5 = n, b, r, q)
 *   bits 15..17  moving piece type (1..6 = p, n, b, r, q, k)
 *   bits 18..20  captured piece type (0 = none; 1 for en passant)
 *   bit  21      en passant, bit 22 castling, bit 23 pawn double push
 *
 * The low 15 bits (`moveKey`) identify the move within a position and are
 * what the transposition table, killers and countermoves store.
 */
export const MAX_MOVES = 256;

export const PROMOTION_SHIFT = 12;
export const PIECE_SHIFT = 15;
export const CAPTURED_SHIFT = 18;
export const EN_PASSANT_FLAG = 1 << 21;
export const CASTLING_FLAG = 1 << 22;
export const DOUBLE_PUSH_FLAG = 1 << 23;
const TACTICAL_MASK = (7 << PROMOTION_SHIFT) | (7 << CAPTURED_SHIFT);

export const encodeMove = (from: number, to: number, piece: number, captured: number, promotion: number, flags: number): number =>
  from | (to << 6) | (promotion << PROMOTION_SHIFT) | (piece << PIECE_SHIFT) | (captured << CAPTURED_SHIFT) | flags;

export const moveFrom = (move: number): number => move & 63;
export const moveTo = (move: number): number => (move >> 6) & 63;
export const movePromotion = (move: number): number => (move >> PROMOTION_SHIFT) & 7;
export const movePiece = (move: number): number => (move >> PIECE_SHIFT) & 7;
export const moveCaptured = (move: number): number => (move >> CAPTURED_SHIFT) & 7;
export const isEnPassantMove = (move: number): boolean => (move & EN_PASSANT_FLAG) !== 0;
export const isCastlingMove = (move: number): boolean => (move & CASTLING_FLAG) !== 0;
export const isDoublePawnMove = (move: number): boolean => (move & DOUBLE_PUSH_FLAG) !== 0;
/** Captures (including en passant) and promotions. */
export const isTacticalMoveCode = (move: number): boolean => (move & TACTICAL_MASK) !== 0;
/** From, to and promotion: unique among the legal moves of one position. */
export const moveKey = (move: number): number => move & 0x7fff;

const FILES = 'abcdefgh';
const PROMOTION_LETTERS = '  nbrq';
export const moveCodeToUci = (move: number): string => {
  const from = moveFrom(move); const to = moveTo(move); const promotion = movePromotion(move);
  return `${FILES[from & 7]}${8 - (from >> 3)}${FILES[to & 7]}${8 - (to >> 3)}${promotion ? PROMOTION_LETTERS[promotion] : ''}`;
};

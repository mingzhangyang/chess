import type { Move } from 'chess.js';

// --- Transposition Table (typed-array, optionally SharedArrayBuffer-backed) ---
//
// Buffer layout (10 bytes × TT_SIZE entries = 10 MB):
//   [0,           4×N): Int32Array  – scores
//   [4×N,        5×N): Uint8Array   – depths
//   [5×N,        6×N): Uint8Array   – flags  (0=empty 1=exact 2=lower 3=upper)
//   [6×N,        8×N): Uint16Array  – 16-bit hash suffix (collision guard)
//   [8×N,       10×N): Uint16Array  – best move (from | to<<6 | promo<<12; 0=none)
//
// A plain ArrayBuffer is used by default; initSharedTranspositionTable() replaces
// it with a SharedArrayBuffer so all Lazy-SMP workers share one table.

const TT_BITS = 20; // 2^20 = 1 048 576 entries
const TT_SIZE = 1 << TT_BITS;
const TT_INDEX_MASK = TT_SIZE - 1;
export const TT_BYTES = TT_SIZE * 10;

let _ttBuf = new ArrayBuffer(TT_BYTES);
let _ttScores = new Int32Array(_ttBuf, 0, TT_SIZE);
let _ttDepths = new Uint8Array(_ttBuf, TT_SIZE * 4, TT_SIZE);
let _ttFlags = new Uint8Array(_ttBuf, TT_SIZE * 5, TT_SIZE);
let _ttHashKeys = new Uint16Array(_ttBuf, TT_SIZE * 6, TT_SIZE);
let _ttBestMoves = new Uint16Array(_ttBuf, TT_SIZE * 8, TT_SIZE);

// FNV-1a 32-bit — fast and well-distributed for short ASCII strings.
const fnv1a32 = (s: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
};

// Strip the fullmove number (last field) from FEN while keeping halfmove clock
// for correct 50-move rule tracking.
export const makeTTKey = (fen: string): string => fen.slice(0, fen.lastIndexOf(' '));

// Encodes a move's from/to/promotion into a compact Uint16 for TT storage.
// Bit layout: bits[5:0]=from(0–63), bits[11:6]=to(0–63), bits[14:12]=promo(0=none 1=q 2=r 3=b 4=n).
// Value 0 is the "no move" sentinel; a1→a1 is always illegal so 0 is a safe sentinel.
const PROMO_TO_INT: Record<string, number> = { q: 1, r: 2, b: 3, n: 4 };

type CompactMove = Pick<Move, 'from' | 'to' | 'promotion'>;

const encodeCompactMove = (move: CompactMove): number => {
  const from = (move.from.charCodeAt(1) - 49) * 8 + (move.from.charCodeAt(0) - 97);
  const to = (move.to.charCodeAt(1) - 49) * 8 + (move.to.charCodeAt(0) - 97);
  const promo = move.promotion ? (PROMO_TO_INT[move.promotion] ?? 0) : 0;
  return (from & 63) | ((to & 63) << 6) | ((promo & 7) << 12);
};

const encodeTTMove = (move: Move): number => encodeCompactMove(move);

export const ttMoveMatches = (move: Move, encoded: number): boolean => {
  if (encoded === 0) return false;
  return encodeCompactMove(move) === encoded;
};

export const lookupTT = (
  key: string,
  depth: number,
): { score?: number; flag?: 'exact' | 'lowerbound' | 'upperbound'; bestMove: number } | undefined => {
  const h = fnv1a32(key);
  const idx = h & TT_INDEX_MASK;
  const f = _ttFlags[idx];
  if (f === 0) return undefined;
  if (_ttHashKeys[idx] !== ((h >>> 16) & 0xffff)) return undefined;
  const bestMove = _ttBestMoves[idx];
  if (_ttDepths[idx] < depth) return { bestMove };
  return {
    score: _ttScores[idx],
    flag: f === 1 ? 'exact' : f === 2 ? 'lowerbound' : 'upperbound',
    bestMove,
  };
};

export const storeTT = (
  key: string,
  score: number,
  depth: number,
  flag: 'exact' | 'lowerbound' | 'upperbound',
  bestMove: Move | null,
): void => {
  const h = fnv1a32(key);
  const idx = h & TT_INDEX_MASK;
  // Depth-preferred replacement: never displace a deeper entry.
  if (_ttFlags[idx] !== 0 && _ttDepths[idx] > depth) return;
  _ttScores[idx] = score;
  _ttDepths[idx] = depth;
  _ttFlags[idx] = flag === 'exact' ? 1 : flag === 'lowerbound' ? 2 : 3;
  _ttHashKeys[idx] = (h >>> 16) & 0xffff;
  _ttBestMoves[idx] = bestMove ? encodeTTMove(bestMove) : 0;
};

/** Call once per worker to attach a SharedArrayBuffer so all workers share one TT. */
export const initSharedTranspositionTable = (buffer: SharedArrayBuffer): void => {
  _ttBuf = buffer;
  _ttScores = new Int32Array(buffer, 0, TT_SIZE);
  _ttDepths = new Uint8Array(buffer, TT_SIZE * 4, TT_SIZE);
  _ttFlags = new Uint8Array(buffer, TT_SIZE * 5, TT_SIZE);
  _ttHashKeys = new Uint16Array(buffer, TT_SIZE * 6, TT_SIZE);
  _ttBestMoves = new Uint16Array(buffer, TT_SIZE * 8, TT_SIZE);
};

export const clearTranspositionTable = (): void => {
  _ttFlags.fill(0); // flag=0 marks every slot as empty
};

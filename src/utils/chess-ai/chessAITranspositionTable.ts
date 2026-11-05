import type { Chess, Color } from 'chess.js';
import type { AiMove } from './chessAIBoardOps';
import { getRepetitionContextKey, type RepetitionContext } from './chessAIRepetition';

const MATE_SCORE = 1_000_000;
const MATE_SCORE_THRESHOLD = MATE_SCORE - 10_000;

export const normalizeMateScoreForTT = (score: number, ply: number): number => {
  if (score >= MATE_SCORE_THRESHOLD) return score + ply;
  if (score <= -MATE_SCORE_THRESHOLD) return score - ply;
  return score;
};

export const denormalizeMateScoreFromTT = (score: number, ply: number): number => {
  if (score >= MATE_SCORE_THRESHOLD) return score - ply;
  if (score <= -MATE_SCORE_THRESHOLD) return score + ply;
  return score;
};

// --- Transposition Table (typed-array, optionally SharedArrayBuffer-backed) ---
//
// Buffer layout (12 bytes × TT_SIZE entries = 12 MB):
//   [0,           4×N): Int32Array  – scores
//   [4×N,        8×N): Uint32Array  – 32-bit verification hash (collision guard)
//   [8×N,       10×N): Uint16Array  – best move (from | to<<6 | promo<<12; 0=none)
//   [10×N,      11×N): Uint8Array   – depths
//   [11×N,      12×N): Uint8Array   – flags  (0=empty 1=exact 2=lower 3=upper)
//
// The slot index and the verification hash come from two independent hash
// functions. Deriving both from one 32-bit hash left only 12 guard bits, so
// roughly 1 in 4096 probes of an occupied slot returned another position's
// score, which surfaced as occasional inexplicable blunders.
//
// A plain ArrayBuffer is used by default; initSharedTranspositionTable() replaces
// it with a SharedArrayBuffer so all Lazy-SMP workers share one table.

const TT_BITS = 20; // 2^20 = 1 048 576 entries
const TT_SIZE = 1 << TT_BITS;
const TT_INDEX_MASK = TT_SIZE - 1;
export const TT_BYTES = TT_SIZE * 12;

let _ttBuf = new ArrayBuffer(TT_BYTES);
let _ttScores = new Int32Array(_ttBuf, 0, TT_SIZE);
let _ttHashKeys = new Uint32Array(_ttBuf, TT_SIZE * 4, TT_SIZE);
let _ttBestMoves = new Uint16Array(_ttBuf, TT_SIZE * 8, TT_SIZE);
let _ttDepths = new Uint8Array(_ttBuf, TT_SIZE * 10, TT_SIZE);
let _ttFlags = new Uint8Array(_ttBuf, TT_SIZE * 11, TT_SIZE);

// FNV-1a 32-bit — fast and well-distributed for short ASCII strings.
const fnv1a32 = (s: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
};

// Independent verification hash (multiply-xorshift mixing, different constants
// from FNV-1a) so an index collision is not also a guard collision.
const verificationHash32 = (s: string): number => {
  let h = 0x9747b28c ^ s.length;
  for (let i = 0; i < s.length; i += 1) {
    h = Math.imul(h ^ s.charCodeAt(i), 0x5bd1e995);
    h ^= h >>> 15;
  }
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
};

// Strip the fullmove number (last field) from FEN while keeping halfmove clock
// for correct 50-move rule tracking.
export const makeTTKey = (fen: string, searchContext = ''): string => {
  const positionKey = fen.slice(0, fen.lastIndexOf(' '));
  return searchContext ? `${positionKey}|${searchContext}` : positionKey;
};

/**
 * A search position's Zobrist hash is updated by chess.js on each make/undo.
 * Keep the position and all non-board search context in two mixed 32-bit words
 * rather than repeatedly formatting a FEN and rehashing its characters.
 *
 * Both index and verifier include *all* correctness-sensitive components:
 * halfmove clock (50-move rule), search/evaluation perspective, tuning, and
 * reversible-history context (threefold repetition). The 32-bit verifier is
 * separate from the 20-bit table index; sharing just one 32-bit hash would
 * reintroduce the previously fixed transposition collision bug.
 */
export type NumericTTKey = Readonly<{ index: number; verifier: number }>;
export type TranspositionTableKey = string | NumericTTKey;

const ZOBRIST_MASK_32 = 0xffff_ffffn;
const avalanche32 = (value: number): number => {
  let v = value >>> 0;
  v ^= v >>> 16;
  v = Math.imul(v, 0x85ebca6b);
  v ^= v >>> 13;
  v = Math.imul(v, 0xc2b2ae35);
  return (v ^ (v >>> 16)) >>> 0;
};

type IncrementalChessState = { _hash?: bigint; _halfMoves?: number };

/**
 * Fast path uses chess.js's incrementally maintained 64-bit position hash.
 * Fall back to the original FEN key if the private state changes in a later
 * chess.js release. Never use the Zobrist hash alone: the draw history matters.
 */
export const makeIncrementalTTKey = (
  game: Chess,
  color: Color,
  tuningHash: number,
  repetitionContext: RepetitionContext,
): TranspositionTableKey => {
  const internal = game as unknown as IncrementalChessState;
  if (typeof internal._hash !== 'bigint'
    || !Number.isSafeInteger(internal._halfMoves)
    || (internal._halfMoves as number) < 0) {
    return makeTTKey(
      game.fen(),
      `${color}:${tuningHash.toString(16)}:${getRepetitionContextKey(repetitionContext)}`,
    );
  }

  const low = Number(internal._hash & ZOBRIST_MASK_32) >>> 0;
  const high = Number((internal._hash >> 32n) & ZOBRIST_MASK_32) >>> 0;
  const halfmove = internal._halfMoves as number;
  const history = repetitionContext.hash >>> 0;
  const reversible = repetitionContext.reversiblePly >>> 0;
  const perspective = color === 'w' ? 0x54b2a1f3 : 0xa5f04de9;

  // Distinct salts / multipliers keep index and verification fingerprints
  // independent even when two positions land in the same TT slot.
  const indexContext = (
    avalanche32(halfmove ^ 0x146f35a7)
    ^ avalanche32(history ^ 0x9e3779b9)
    ^ avalanche32(reversible ^ 0x27d4eb2f)
    ^ avalanche32(tuningHash ^ 0x165667b1)
    ^ perspective
  );
  const verifierContext = (
    avalanche32(halfmove ^ 0x3c6ef372)
    ^ avalanche32(history ^ 0xb5297a4d)
    ^ avalanche32(reversible ^ 0x1b873593)
    ^ avalanche32(tuningHash ^ 0x7feb352d)
    ^ (perspective ^ 0xff51afd7)
  );
  return {
    index: avalanche32(low ^ Math.imul(high, 0x9e3779b1) ^ indexContext) & TT_INDEX_MASK,
    verifier: avalanche32(high ^ Math.imul(low, 0x85ebca77) ^ verifierContext),
  };
};

// Encodes a move's from/to/promotion into a compact Uint16 for TT storage.
// Bit layout: bits[5:0]=from(0–63), bits[11:6]=to(0–63), bits[14:12]=promo(0=none 1=q 2=r 3=b 4=n).
// Value 0 is the "no move" sentinel; a1→a1 is always illegal so 0 is a safe sentinel.
const PROMO_TO_INT: Record<string, number> = { q: 1, r: 2, b: 3, n: 4 };

type CompactMove = Pick<AiMove, 'from' | 'to' | 'promotion'>;

const encodeCompactMove = (move: CompactMove): number => {
  const from = (move.from.charCodeAt(1) - 49) * 8 + (move.from.charCodeAt(0) - 97);
  const to = (move.to.charCodeAt(1) - 49) * 8 + (move.to.charCodeAt(0) - 97);
  const promo = move.promotion ? (PROMO_TO_INT[move.promotion] ?? 0) : 0;
  return (from & 63) | ((to & 63) << 6) | ((promo & 7) << 12);
};

export const encodeTTMove = (move: CompactMove): number => encodeCompactMove(move);

export const ttMoveMatches = (move: CompactMove, encoded: number): boolean => {
  if (encoded === 0) return false;
  return encodeCompactMove(move) === encoded;
};

export const lookupTT = (
  key: TranspositionTableKey,
  depth: number,
): { score?: number; flag?: 'exact' | 'lowerbound' | 'upperbound'; bestMove: number } | undefined => {
  const idx = typeof key === 'string' ? fnv1a32(key) & TT_INDEX_MASK : key.index;
  const f = _ttFlags[idx];
  if (f === 0) return undefined;
  if (_ttHashKeys[idx] !== (typeof key === 'string' ? verificationHash32(key) : key.verifier)) return undefined;
  const bestMove = _ttBestMoves[idx];
  if (_ttDepths[idx] < depth) return { bestMove };
  return {
    score: _ttScores[idx],
    flag: f === 1 ? 'exact' : f === 2 ? 'lowerbound' : 'upperbound',
    bestMove,
  };
};

export const storeTT = (
  key: TranspositionTableKey,
  score: number,
  depth: number,
  flag: 'exact' | 'lowerbound' | 'upperbound',
  bestMove: CompactMove | null,
): void => {
  const idx = typeof key === 'string' ? fnv1a32(key) & TT_INDEX_MASK : key.index;
  // Depth-preferred replacement: never displace a deeper entry.
  if (_ttFlags[idx] !== 0 && _ttDepths[idx] > depth) return;
  _ttScores[idx] = score;
  _ttDepths[idx] = depth;
  _ttFlags[idx] = flag === 'exact' ? 1 : flag === 'lowerbound' ? 2 : 3;
  _ttHashKeys[idx] = typeof key === 'string' ? verificationHash32(key) : key.verifier;
  _ttBestMoves[idx] = bestMove ? encodeTTMove(bestMove) : 0;
};


/** Call once per worker to attach a SharedArrayBuffer so all workers share one TT. */
export const initSharedTranspositionTable = (buffer: SharedArrayBuffer): void => {
  _ttBuf = buffer;
  _ttScores = new Int32Array(buffer, 0, TT_SIZE);
  _ttHashKeys = new Uint32Array(buffer, TT_SIZE * 4, TT_SIZE);
  _ttBestMoves = new Uint16Array(buffer, TT_SIZE * 8, TT_SIZE);
  _ttDepths = new Uint8Array(buffer, TT_SIZE * 10, TT_SIZE);
  _ttFlags = new Uint8Array(buffer, TT_SIZE * 11, TT_SIZE);
};

export const clearTranspositionTable = (): void => {
  _ttFlags.fill(0); // flag=0 marks every slot as empty
};

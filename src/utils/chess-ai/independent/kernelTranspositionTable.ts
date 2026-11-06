import type { SearchPosition } from '../searchPosition';

export const KERNEL_TT_DEFAULT_BITS = 20;
export const KERNEL_TT_ENTRY_BYTES = 16;

export const TT_EXACT = 1;
export const TT_LOWER = 2;
export const TT_UPPER = 3;

/**
 * Transposition table of the independent kernel, private to one search (one
 * perspective and tuning). Same semantics as IndependentTranspositionTable:
 * each slot stores both 32-bit history-aware key words and is indexed by the
 * low bits of the first, so with the default 2^20 slots an unrelated position
 * probing an occupied slot matches with about 2^-44 probability (a
 * probabilistic guard, not an identity check). Replacement is depth-preferred,
 * and positions with incomplete history are never stored or probed. Each slot
 * is one 16-byte record in a single Int32Array:
 *
 *   [0] key low   [1] key high   [2] score
 *   [3] move key (bits 0..15) | depth (16..23) | flag (24..25, 0 = empty)
 *
 * so a probe touches one cache line instead of six separate arrays.
 */
export class KernelTranspositionTable {
  private readonly mask: number;
  private readonly slots: Int32Array;
  /** Results of the last successful `probe`. */
  move = 0;
  score = 0;
  flag = 0;

  constructor(sizeBits = KERNEL_TT_DEFAULT_BITS) {
    if (!Number.isInteger(sizeBits) || sizeBits < 0 || sizeBits > 24) throw new Error('invalid table size');
    this.mask = 2 ** sizeBits - 1;
    this.slots = new Int32Array(2 ** sizeBits * 4);
  }

  /**
   * Returns whether `position` has an entry. On a hit, `move` is its best-move
   * key and `flag` is 0 when the entry is shallower than `depth` (the move is
   * still usable for ordering), otherwise its bound with `score`.
   */
  probe(position: SearchPosition, depth: number): boolean {
    if (!position.hasCompleteHistory) return false;
    const low = position.transpositionKeyLow;
    const base = (low & this.mask) << 2;
    const slots = this.slots;
    const meta = slots[base + 3];
    if ((meta >>> 24) === 0 || slots[base] !== (low | 0) || slots[base + 1] !== (position.transpositionKeyHigh | 0)) return false;
    this.move = meta & 0xffff;
    if (((meta >>> 16) & 0xff) < depth) { this.flag = 0; return true; }
    this.flag = meta >>> 24;
    this.score = slots[base + 2];
    return true;
  }

  store(position: SearchPosition, depth: number, score: number, flag: number, moveKey: number): void {
    if (!position.hasCompleteHistory) return;
    const low = position.transpositionKeyLow;
    const base = (low & this.mask) << 2;
    const slots = this.slots;
    const meta = slots[base + 3];
    if ((meta >>> 24) !== 0 && ((meta >>> 16) & 0xff) > depth) return;
    slots[base] = low;
    slots[base + 1] = position.transpositionKeyHigh;
    slots[base + 2] = score;
    slots[base + 3] = (moveKey & 0xffff) | (Math.max(0, Math.min(255, depth)) << 16) | (flag << 24);
  }
}

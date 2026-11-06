import type { AiMove } from './chessAIBoardOps';
import { encodeTTMove } from './chessAITranspositionTable';
import type { AiTuning } from './chessAITuning';
import type { SearchPosition } from './searchPosition';

type Flag = 'exact' | 'lowerbound' | 'upperbound';
const FLAGS: readonly Flag[] = ['exact', 'lowerbound', 'upperbound'];
export const INDEPENDENT_TT_DEFAULT_BITS = 20;
export const INDEPENDENT_TT_ENTRY_BYTES = 16;

/**
 * Fixed-size table private to a single comparison search; it never shares
 * scores with production. Each slot stores the position's two history-aware
 * key words (64 verification bits), so neither a slot collision nor a board
 * hash collision with a different clock or repetition history can match.
 * Memory is fixed at 16 bytes per slot (16 MiB by default) regardless of how
 * long the game history is.
 */
export class IndependentTranspositionTable {
  private readonly mask: number;
  private readonly keyLow: Uint32Array;
  private readonly keyHigh: Uint32Array;
  private readonly scores: Int32Array;
  private readonly moves: Uint16Array;
  private readonly depths: Uint8Array;
  /** 0 = empty, otherwise 1 + index into FLAGS. */
  private readonly flags: Uint8Array;
  private readonly tuningKey: string;

  constructor(private readonly color: 'w' | 'b', private readonly tuning: AiTuning,
    sizeBits = INDEPENDENT_TT_DEFAULT_BITS) {
    if (!Number.isInteger(sizeBits) || sizeBits < 0 || sizeBits > 24) throw new Error('invalid table size');
    const size = 2 ** sizeBits;
    this.mask = size - 1;
    const buffer = new ArrayBuffer(size * INDEPENDENT_TT_ENTRY_BYTES);
    this.keyLow = new Uint32Array(buffer, 0, size);
    this.keyHigh = new Uint32Array(buffer, size * 4, size);
    this.scores = new Int32Array(buffer, size * 8, size);
    this.moves = new Uint16Array(buffer, size * 12, size);
    this.depths = new Uint8Array(buffer, size * 14, size);
    this.flags = new Uint8Array(buffer, size * 15, size);
    this.tuningKey = JSON.stringify(tuning);
  }

  /** Missing earlier history can change any descendant's score: never reuse it. */
  private usable(position: SearchPosition, color: 'w' | 'b', tuning: AiTuning): boolean {
    if (!position.hasCompleteHistory || color !== this.color) return false;
    return (tuning === this.tuning && Object.isFrozen(tuning)) || JSON.stringify(tuning) === this.tuningKey;
  }

  lookup(position: SearchPosition, color: 'w' | 'b', tuning: AiTuning, depth: number):
    { bestMove: number; score?: number; flag?: Flag } | undefined {
    if (!this.usable(position, color, tuning)) return undefined;
    const low = position.transpositionKeyLow;
    const slot = low & this.mask;
    const flag = this.flags[slot];
    if (flag === 0 || this.keyLow[slot] !== low || this.keyHigh[slot] !== position.transpositionKeyHigh) return undefined;
    const bestMove = this.moves[slot];
    return this.depths[slot] < depth ? { bestMove } : { bestMove, score: this.scores[slot], flag: FLAGS[flag - 1] };
  }

  store(position: SearchPosition, color: 'w' | 'b', tuning: AiTuning,
    depth: number, score: number, flag: Flag, move: AiMove): void {
    if (!this.usable(position, color, tuning)) return;
    const low = position.transpositionKeyLow;
    const slot = low & this.mask;
    // Depth-preferred replacement, matching the production table.
    if (this.flags[slot] !== 0 && this.depths[slot] > depth) return;
    this.keyLow[slot] = low;
    this.keyHigh[slot] = position.transpositionKeyHigh;
    this.scores[slot] = score;
    this.moves[slot] = encodeTTMove(move);
    this.depths[slot] = Math.max(0, Math.min(255, depth));
    this.flags[slot] = FLAGS.indexOf(flag) + 1;
  }
}

let current: IndependentTranspositionTable | undefined;
export const setIndependentTable = (table?: IndependentTranspositionTable): void => { current = table; };
export const getIndependentTable = (): IndependentTranspositionTable | undefined => current;

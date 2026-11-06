/** A search-side repetition identity. Clocks are deliberately excluded. */
export type SearchSide = 1 | -1;

/**
 * How a pushed position was reached. A pawn move, capture or loss of a
 * castling right is irreversible: no earlier position can occur again, so the
 * repetition window restarts there and the history before it is irrelevant.
 * A synthetic null move opens an empty, incomplete scope instead.
 */
export type RepetitionTransition = 'reversible' | 'irreversible' | 'null';

const avalanche32 = (value: number): number => {
  let v = value >>> 0;
  v ^= v >>> 16;
  v = Math.imul(v, 0x85ebca6b);
  v ^= v >>> 13;
  v = Math.imul(v, 0xc2b2ae35);
  return (v ^ (v >>> 16)) >>> 0;
};

/**
 * One entry per position from the start of the known history to the current
 * search node. Only positions since the last irreversible move form the
 * repetition window, so counting scans at most the reversible plies and the
 * window signature is maintained in O(1) per push/pop.
 *
 * Hashes are an index only: a repetition is counted only after comparing the
 * board, side, castling rights and legally capturable en-passant file.
 */
export class RepetitionStack {
  private capacity = 0;
  private top = -1;
  private hashLow = new Uint32Array(0);
  private hashHigh = new Uint32Array(0);
  private identity = new Int16Array(0);
  private boards = new Int8Array(0);
  private windowStart = new Int32Array(0);
  private counts = new Int32Array(0);
  private completes = new Uint8Array(0);
  private sigLow = new Uint32Array(0);
  private sigHigh = new Uint32Array(0);

  constructor(private readonly rootComplete: boolean, initialCapacity = 128) {
    this.grow(Math.max(1, Math.floor(initialCapacity)));
  }

  private grow(capacity: number): void {
    const used = this.top + 1;
    const resize = <T extends { set(values: ArrayLike<number>): void; subarray(begin: number, end: number): ArrayLike<number> }>(
      old: T, next: T, stride = 1,
    ): T => {
      next.set(old.subarray(0, used * stride));
      return next;
    };
    this.hashLow = resize(this.hashLow, new Uint32Array(capacity));
    this.hashHigh = resize(this.hashHigh, new Uint32Array(capacity));
    this.identity = resize(this.identity, new Int16Array(capacity));
    this.boards = resize(this.boards, new Int8Array(capacity * 64), 64);
    this.windowStart = resize(this.windowStart, new Int32Array(capacity));
    this.counts = resize(this.counts, new Int32Array(capacity));
    this.completes = resize(this.completes, new Uint8Array(capacity));
    this.sigLow = resize(this.sigLow, new Uint32Array(capacity));
    this.sigHigh = resize(this.sigHigh, new Uint32Array(capacity));
    this.capacity = capacity;
  }

  /** The first push is the root; later pushes say how that position was reached. */
  push(
    hashLow: number,
    hashHigh: number,
    board: Int8Array,
    side: SearchSide,
    castlingRights: number,
    legalEnPassantFile: number,
    transition: RepetitionTransition,
  ): void {
    if (board.length !== 64) throw new Error('invalid repetition board');
    if (this.top < 0 && transition === 'null') throw new Error('the root cannot be a null move');
    const index = this.top + 1;
    if (index === this.capacity) this.grow(this.capacity * 2);
    const identity = (side === 1 ? 1 : 0) | ((castlingRights & 15) << 1) | ((legalEnPassantFile + 1) << 5);
    this.hashLow[index] = hashLow >>> 0;
    this.hashHigh[index] = hashHigh >>> 0;
    this.identity[index] = identity;
    this.boards.set(board, index * 64);

    let start: number;
    let complete: boolean;
    if (index === 0) { start = 0; complete = this.rootComplete; }
    else if (transition === 'null') { start = index + 1; complete = false; }
    else if (transition === 'irreversible') { start = index; complete = true; }
    else { start = this.windowStart[index - 1]; complete = this.completes[index - 1] === 1; }
    this.windowStart[index] = start;
    this.completes[index] = complete ? 1 : 0;

    if (start > index) {
      this.counts[index] = 0;
      this.sigLow[index] = 0;
      this.sigHigh[index] = 0;
    } else {
      // Inside a window every move is real, so sides alternate and only every
      // second earlier entry can share the side to move.
      let count = 1;
      for (let earlier = index - 2; earlier >= start; earlier -= 2) {
        if (this.hashLow[earlier] === this.hashLow[index] && this.hashHigh[earlier] === this.hashHigh[index]
          && this.identity[earlier] === identity && this.sameBoard(earlier, index)) count += 1;
      }
      this.counts[index] = count;
      // A commutative sum identifies the multiset of repeatable positions.
      const low = index > start ? this.sigLow[index - 1] : 0;
      const high = index > start ? this.sigHigh[index - 1] : 0;
      this.sigLow[index] = (low + avalanche32(hashLow ^ Math.imul(hashHigh, 0x9e3779b1) ^ 0x7feb352d)) >>> 0;
      this.sigHigh[index] = (high + avalanche32(hashHigh ^ Math.imul(hashLow, 0x85ebca77) ^ 0x165667b1)) >>> 0;
    }
    this.top = index;
  }

  pop(): void {
    if (this.top <= 0) throw new Error('cannot pop the repetition root');
    this.top -= 1;
  }

  private sameBoard(a: number, b: number): boolean {
    const boards = this.boards;
    const offsetA = a * 64;
    const offsetB = b * 64;
    for (let i = 0; i < 64; i += 1) if (boards[offsetA + i] !== boards[offsetB + i]) return false;
    return true;
  }

  get size(): number { return this.top + 1; }
  /** Occurrences of the current position in its window, itself included; 0 right after a null move. */
  get count(): number { return this.counts[this.top]; }
  /** Whether every position that could still repeat is known. */
  get complete(): boolean { return this.completes[this.top] === 1; }
  /** Positions that can still be repeated, the current one included. */
  get windowLength(): number { return Math.max(0, this.top + 1 - this.windowStart[this.top]); }
  get signatureLow(): number { return this.sigLow[this.top]; }
  get signatureHigh(): number { return this.sigHigh[this.top]; }
}

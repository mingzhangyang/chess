/** A search-side repetition identity. Clocks are deliberately excluded. */
export type SearchSide = 1 | -1;

export type PositionOccurrence = {
  readonly board: Int8Array;
  side: SearchSide;
  castlingRights: number;
  legalEnPassantFile: number;
  count: number;
};

/**
 * Counts complete position identities within one real or synthetic history.
 * The hash is an index only: a collision is resolved by comparing the board,
 * side, castling rights, and legally capturable en-passant file.
 */
export class PositionRepetition {
  private readonly buckets = new Map<bigint, PositionOccurrence[]>();

  constructor(readonly historyComplete: boolean) {}

  private matches(
    entry: PositionOccurrence,
    board: Int8Array,
    side: SearchSide,
    castlingRights: number,
    legalEnPassantFile: number,
  ): boolean {
    if (entry.side !== side || entry.castlingRights !== castlingRights
      || entry.legalEnPassantFile !== legalEnPassantFile) return false;
    for (let i = 0; i < 64; i += 1) {
      if (entry.board[i] !== board[i]) return false;
    }
    return true;
  }

  count(hash: bigint, board: Int8Array, side: SearchSide, rights: number, epFile: number): number {
    if (board.length !== 64) throw new Error('invalid repetition board');
    return this.buckets.get(hash)?.find((entry) => this.matches(entry, board, side, rights, epFile))?.count ?? 0;
  }

  add(
    hash: bigint,
    board: Int8Array,
    side: SearchSide,
    rights: number,
    epFile: number,
    reusable?: PositionOccurrence,
  ): PositionOccurrence {
    if (board.length !== 64 || (reusable && reusable.board.length !== 64)) throw new Error('invalid repetition board');
    const bucket = this.buckets.get(hash);
    const found = bucket?.find((entry) => this.matches(entry, board, side, rights, epFile));
    if (found) {
      found.count += 1;
      return found;
    }

    if (reusable && reusable.count !== 0) throw new Error('repetition entry still in use');
    const entry = reusable ?? {
      board: new Int8Array(64), side, castlingRights: rights, legalEnPassantFile: epFile, count: 0,
    };
    entry.board.set(board);
    entry.side = side;
    entry.castlingRights = rights;
    entry.legalEnPassantFile = epFile;
    entry.count = 1;
    if (bucket) bucket.push(entry);
    else this.buckets.set(hash, [entry]);
    return entry;
  }

  remove(hash: bigint, entry: PositionOccurrence): void {
    const bucket = this.buckets.get(hash);
    const index = bucket?.indexOf(entry) ?? -1;
    if (!bucket || index < 0 || entry.count <= 0) throw new Error('repetition entry not found');
    entry.count -= 1;
    if (entry.count === 0) {
      bucket.splice(index, 1);
      if (bucket.length === 0) this.buckets.delete(hash);
    }
  }

  /** Detach replayed real history from reusable per-ply search frames. */
  clone(): PositionRepetition {
    const copy = new PositionRepetition(this.historyComplete);
    for (const [hash, bucket] of this.buckets) {
      copy.buckets.set(hash, bucket.map((entry) => ({ ...entry, board: entry.board.slice() })));
    }
    return copy;
  }
}

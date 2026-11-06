import { RepetitionStack, type SearchSide } from './searchPositionRepetition';

/**
 * Independent search-state experiment. makeMove still requires a legal move,
 * such as one returned by generateLegalMoves; its structural checks do not
 * validate arbitrary piece movement, pins, or exposed kings.
 * Squares are 0..63 from a8 to h1. Pieces are signed: white is positive,
 * black is negative, and pawn/knight/bishop/rook/queen/king are 1..6.
 */
export type PromotionPiece = 'n' | 'b' | 'r' | 'q';
export type SearchMove = { from: number; to: number; promotion?: PromotionPiece };
export type SearchPositionOptions = { historyComplete?: boolean };
export type RepetitionStatus = 'threefold' | 'not-threefold' | 'unknown';

const PIECES = '.pnbrqk';
const PIECE_VALUES = [0, 100, 320, 330, 500, 900, 0] as const;
const WHITE_KING_SIDE = 1;
const WHITE_QUEEN_SIDE = 2;
const BLACK_KING_SIDE = 4;
const BLACK_QUEEN_SIDE = 8;
const NO_SQUARE = -1;
const CASTLING_KEYS = 12 * 64;
const EP_KEYS = CASTLING_KEYS + 16;
const TURN_KEY = EP_KEYS + 8;
const KNIGHT_DELTAS = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]] as const;
const ATTACK_DIRECTIONS = [[-1, -1], [-1, 1], [1, -1], [1, 1], [-1, 0], [1, 0], [0, -1], [0, 1]] as const;

// Stable SplitMix64 keys are generated once, then split into 32-bit words for
// incremental updates. RepetitionStack verifies the full state on a hit.
// Separate stretches of a linear 32-bit PRNG would give correlated halves and
// only 32 bits of effective XOR entropy.
const MASK_64 = 0xffff_ffff_ffff_ffffn;
let randomState = 0x93f4_a51d_7c62_0e39n;
const nextRandom64 = (): bigint => {
  randomState = (randomState + 0x9e37_79b9_7f4a_7c15n) & MASK_64;
  let value = randomState;
  value = ((value ^ (value >> 30n)) * 0xbf58_476d_1ce4_e5b9n) & MASK_64;
  value = ((value ^ (value >> 27n)) * 0x94d0_49bb_1331_11ebn) & MASK_64;
  return (value ^ (value >> 31n)) & MASK_64;
};
const HASH_LOW = new Uint32Array(TURN_KEY + 1);
const HASH_HIGH = new Uint32Array(TURN_KEY + 1);
for (let index = 0; index <= TURN_KEY; index += 1) {
  const key = nextRandom64();
  HASH_LOW[index] = Number(key & 0xffff_ffffn);
  HASH_HIGH[index] = Number(key >> 32n);
}
const mix32 = (value: number): number => {
  let v = value >>> 0;
  v ^= v >>> 16;
  v = Math.imul(v, 0x85ebca6b);
  v ^= v >>> 13;
  v = Math.imul(v, 0xc2b2ae35);
  return (v ^ (v >>> 16)) >>> 0;
};
const pieceKeyIndex = (piece: number, square: number): number => (
  (piece > 0 ? piece - 1 : 6 - piece - 1) * 64 + square
);

export const squareFromAlgebraic = (square: string): number => {
  if (!/^[a-h][1-8]$/.test(square)) throw new Error('invalid square');
  return (8 - Number(square[1])) * 8 + square.charCodeAt(0) - 97;
};

export const squareToAlgebraic = (square: number): string => {
  if (!Number.isInteger(square) || square < 0 || square >= 64) throw new Error('invalid square');
  return String.fromCharCode(97 + (square & 7)) + String(8 - (square >> 3));
};

type UndoFrame = {
  kind: 'move' | 'null';
  from: number;
  to: number;
  moving: number;
  captured: number;
  captureSquare: number;
  rookFrom: number;
  rookTo: number;
  rookPiece: number;
  side: SearchSide;
  rights: number;
  epSquare: number;
  epFile: number;
  halfmove: number;
  drawHalfmove: number;
  fullmove: number;
  material: number;
  whiteKing: number;
  blackKing: number;
  hashLow: number;
  hashHigh: number;
};

const createFrame = (): UndoFrame => ({
  kind: 'move', from: -1, to: -1, moving: 0, captured: 0, captureSquare: -1,
  rookFrom: -1, rookTo: -1, rookPiece: 0, side: 1, rights: 0, epSquare: -1,
  epFile: -1, halfmove: 0, drawHalfmove: 0, fullmove: 1, material: 0, whiteKing: -1, blackKing: -1,
  hashLow: 0, hashHigh: 0,
});

const parseClock = (value: string, minimum: number): number => {
  if (!/^(?:0|[1-9]\d*)$/.test(value)) throw new Error('invalid FEN clock');
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < minimum) throw new Error('invalid FEN clock');
  return result;
};

export class SearchPosition {
  private readonly board = new Int8Array(64);
  private side: SearchSide = 1;
  private rights = 0;
  private epSquare = NO_SQUARE;
  private legalEpFile = NO_SQUARE;
  private halfmove = 0;
  // A synthetic null updates the displayed FEN clock but is not a real move.
  private drawHalfmove = 0;
  private fullmove = 1;
  private material = 0;
  private whiteKing = NO_SQUARE;
  private blackKing = NO_SQUARE;
  private hashLow = 0;
  private hashHigh = 0;
  private depth = 0;
  private readonly frames: UndoFrame[] = [];
  private readonly repetition: RepetitionStack;

  constructor(fen: string, options: SearchPositionOptions = {}) {
    const parts = fen.trim().split(/\s+/);
    if (parts.length !== 6) throw new Error('invalid FEN');
    const [placement, turn, castling, ep, halfmove, fullmove] = parts;
    const ranks = placement.split('/');
    if (ranks.length !== 8) throw new Error('invalid FEN board');
    let whiteKings = 0;
    let blackKings = 0;
    for (let rank = 0; rank < 8; rank += 1) {
      let file = 0;
      let previousDigit = false;
      for (const symbol of ranks[rank]) {
        if (/^[1-8]$/.test(symbol)) {
          if (previousDigit) throw new Error('invalid FEN board');
          file += Number(symbol);
          previousDigit = true;
          continue;
        }
        previousDigit = false;
        const type = PIECES.indexOf(symbol.toLowerCase());
        if (type <= 0 || file >= 8 || (type === 1 && (rank === 0 || rank === 7))) {
          throw new Error('invalid FEN board');
        }
        const piece = symbol === symbol.toUpperCase() ? type : -type;
        const square = rank * 8 + file;
        this.board[square] = piece;
        this.material += Math.sign(piece) * PIECE_VALUES[type];
        if (piece === 6) { this.whiteKing = square; whiteKings += 1; }
        if (piece === -6) { this.blackKing = square; blackKings += 1; }
        file += 1;
      }
      if (file !== 8) throw new Error('invalid FEN rank');
    }
    if (whiteKings !== 1 || blackKings !== 1) throw new Error('FEN must contain exactly two kings');
    if (turn !== 'w' && turn !== 'b') throw new Error('invalid FEN turn');
    this.side = turn === 'w' ? 1 : -1;
    if (castling !== '-') {
      if (!/^[KQkq]+$/.test(castling) || new Set(castling).size !== castling.length) {
        throw new Error('invalid FEN castling rights');
      }
      this.rights = (castling.includes('K') ? WHITE_KING_SIDE : 0)
        | (castling.includes('Q') ? WHITE_QUEEN_SIDE : 0)
        | (castling.includes('k') ? BLACK_KING_SIDE : 0)
        | (castling.includes('q') ? BLACK_QUEEN_SIDE : 0);
    }
    if (ep !== '-') {
      if (!/^[a-h][36]$/.test(ep) || (this.side === 1 ? ep[1] !== '6' : ep[1] !== '3')) {
        throw new Error('invalid FEN en-passant square');
      }
      this.epSquare = squareFromAlgebraic(ep);
      if (this.board[this.epSquare] !== 0) throw new Error('occupied FEN en-passant square');
    }
    this.halfmove = parseClock(halfmove, 0);
    this.drawHalfmove = this.halfmove;
    this.fullmove = parseClock(fullmove, 1);
    this.legalEpFile = this.findLegalEnPassantFile();
    for (let square = 0; square < 64; square += 1) {
      if (this.board[square]) this.xorKey(pieceKeyIndex(this.board[square], square));
    }
    this.xorKey(CASTLING_KEYS + this.rights);
    if (this.side === -1) this.xorKey(TURN_KEY);
    if (this.legalEpFile !== NO_SQUARE) this.xorKey(EP_KEYS + this.legalEpFile);
    // A FEN does not contain prior positions. Callers must explicitly say when
    // the provided root starts a complete history.
    this.repetition = new RepetitionStack(options.historyComplete === true);
    this.repetition.push(this.hashLow, this.hashHigh, this.board, this.side, this.rights, this.legalEpFile, 'reversible');
  }

  /** Replay already-validated real moves, then seal their state as the root. */
  static fromHistory(
    startingFen: string,
    moves: readonly SearchMove[],
    options: SearchPositionOptions & { expectedFen?: string } = {},
  ): SearchPosition {
    const position = new SearchPosition(startingFen, options);
    for (const move of moves) position.makeMove(move);
    if (options.expectedFen !== undefined) {
      const expected = new SearchPosition(options.expectedFen).toFen();
      if (position.toFen() !== expected) throw new Error('history does not match expected FEN');
    }
    // The replayed positions stay in the repetition stack; undo frames are
    // reused by the search and cannot cross this root.
    position.depth = 0;
    return position;
  }

  get turn(): 'w' | 'b' { return this.side === 1 ? 'w' : 'b'; }
  /** Bit flags K=1, Q=2, k=4, q=8. */
  get castlingRights(): number { return this.rights; }
  get enPassantSquare(): number { return this.epSquare; }
  get halfmoveClock(): number { return this.halfmove; }
  get drawHalfmoveClock(): number { return this.drawHalfmove; }
  get fullmoveNumber(): number { return this.fullmove; }
  /** Simple signed material balance; this is not the full tapered evaluation. */
  get materialBalance(): number { return this.material; }
  get ply(): number { return this.depth; }
  /** Board identity only; not a complete transposition-table score key. */
  get positionHash(): bigint { return (BigInt(this.hashHigh) << 32n) | BigInt(this.hashLow); }
  get repetitionCount(): number { return this.repetition.count; }
  get repetitionStatus(): RepetitionStatus {
    if (this.repetition.count >= 3) return 'threefold';
    return this.repetition.complete ? 'not-threefold' : 'unknown';
  }
  /** Positions since the last irreversible move (or null move), the current one included. */
  get repetitionWindowLength(): number { return this.repetition.windowLength; }

  /**
   * Whether every position that could still repeat is known: the root history
   * was declared complete, or an irreversible move has been observed since the
   * root or the last null move.
   */
  get hasCompleteHistory(): boolean { return this.repetition.complete; }

  /**
   * Two independent 32-bit words of a history-aware transposition key. They
   * combine the position hash, both clocks and the multiset of positions that
   * can still repeat, so transpositions merge exactly when their future draw
   * outcomes agree. Meaningful only when hasCompleteHistory is true.
   */
  get transpositionKeyLow(): number {
    return mix32(this.hashLow ^ mix32(this.repetition.signatureLow ^ 0x3c6ef372)
      ^ mix32((this.halfmove >>> 0) ^ 0x146f35a7) ^ mix32((this.drawHalfmove >>> 0) ^ 0x27d4eb2f));
  }
  get transpositionKeyHigh(): number {
    return mix32(this.hashHigh ^ mix32(this.repetition.signatureHigh ^ 0xb5297a4d)
      ^ mix32((this.halfmove >>> 0) ^ 0x1b873593) ^ mix32((this.drawHalfmove >>> 0) ^ 0x68e31da4));
  }

  isInsufficientMaterial(): boolean {
    let knights = 0; let bishops = 0; let other = 0; let bishopColor = -1;
    for (let i = 0; i < 64; i += 1) {
      const type = Math.abs(this.board[i]);
      if (type === 2) knights += 1;
      else if (type === 3) {
        bishops += 1;
        const color = ((i >> 3) + (i & 7)) & 1;
        if (bishopColor === -1) bishopColor = color;
        else if (bishopColor !== color) bishopColor = 2;
      } else if (type && type !== 6) other += 1;
    }
    return other === 0 && (knights + bishops <= 1 || (knights === 0 && bishopColor !== 2));
  }

  pieceAt(square: number): number {
    if (!Number.isInteger(square) || square < 0 || square >= 64) throw new Error('invalid square');
    return this.board[square];
  }

  private xorKey(index: number): void {
    this.hashLow = (this.hashLow ^ HASH_LOW[index]) >>> 0;
    this.hashHigh = (this.hashHigh ^ HASH_HIGH[index]) >>> 0;
  }

  private setSquare(square: number, piece: number): void {
    const old = this.board[square];
    if (old) {
      this.xorKey(pieceKeyIndex(old, square));
      this.material -= Math.sign(old) * PIECE_VALUES[Math.abs(old)];
    }
    if (piece) {
      this.xorKey(pieceKeyIndex(piece, square));
      this.material += Math.sign(piece) * PIECE_VALUES[Math.abs(piece)];
    }
    this.board[square] = piece;
  }

  /** Geometric attacks count even when the attacking piece is pinned. */
  private isSquareAttacked(target: number, by: SearchSide): boolean {
    const rank = target >> 3;
    const file = target & 7;
    const pawnRank = rank + (by === 1 ? 1 : -1);
    if (pawnRank >= 0 && pawnRank < 8) {
      for (const df of [-1, 1]) {
        const pawnFile = file + df;
        if (pawnFile >= 0 && pawnFile < 8 && this.board[pawnRank * 8 + pawnFile] === by) return true;
      }
    }
    for (const [dr, df] of KNIGHT_DELTAS) {
      const r = rank + dr; const f = file + df;
      if (r >= 0 && r < 8 && f >= 0 && f < 8 && this.board[r * 8 + f] === by * 2) return true;
    }
    for (let i = 0; i < ATTACK_DIRECTIONS.length; i += 1) {
      const [dr, df] = ATTACK_DIRECTIONS[i];
      let r = rank + dr; let f = file + df; let distance = 1;
      while (r >= 0 && r < 8 && f >= 0 && f < 8) {
        const piece = this.board[r * 8 + f];
        if (piece) {
          if (Math.sign(piece) === by) {
            const type = Math.abs(piece);
            if (type === 5 || (i < 4 && type === 3) || (i >= 4 && type === 4)
              || (distance === 1 && type === 6)) return true;
          }
          break;
        }
        r += dr; f += df; distance += 1;
      }
    }
    return false;
  }

  isInCheck(): boolean {
    return this.isSquareAttacked(this.side === 1 ? this.whiteKing : this.blackKing, -this.side as SearchSide);
  }

  /**
   * Test a candidate generated below without calling makeMove on an illegal
   * move. Only the private board is changed temporarily; turn, king fields,
   * clocks, hash, undo frames and repetition history are never touched. The
   * attack test uses the original mover's king, including after a king move.
   */
  private isLegalCandidate(move: SearchMove): boolean {
    const { from, to, promotion } = move;
    const moving = this.board[from];
    const target = this.board[to];
    const enPassant = Math.abs(moving) === 1 && to === this.epSquare
      && target === 0 && (from & 7) !== (to & 7);
    const captureSquare = enPassant ? to + this.side * 8 : to;
    const captured = this.board[captureSquare];
    const castle = Math.abs(moving) === 6 && Math.abs(to - from) === 2;
    const rookFrom = castle ? from + (to > from ? 3 : -4) : NO_SQUARE;
    const rookTo = castle ? from + (to > from ? 1 : -1) : NO_SQUARE;
    const rook = castle ? this.board[rookFrom] : 0;
    const king = Math.abs(moving) === 6 ? to : (this.side === 1 ? this.whiteKing : this.blackKing);
    try {
      this.board[from] = 0;
      if (enPassant) this.board[captureSquare] = 0;
      this.board[to] = promotion ? this.side * PIECES.indexOf(promotion) : moving;
      if (castle) { this.board[rookFrom] = 0; this.board[rookTo] = rook; }
      return !this.isSquareAttacked(king, -this.side as SearchSide);
    } finally {
      this.board[from] = moving;
      this.board[to] = target;
      if (enPassant) this.board[captureSquare] = captured;
      if (castle) { this.board[rookFrom] = rook; this.board[rookTo] = 0; }
    }
  }

  private generateMoves(tacticalOnly: boolean): SearchMove[] {
    const moves: SearchMove[] = [];
    const side = this.side;
    const add = (from: number, to: number, promotion?: PromotionPiece) => {
      const candidate: SearchMove = promotion ? { from, to, promotion } : { from, to };
      if (this.isLegalCandidate(candidate)) moves.push(candidate);
    };
    const addPawn = (from: number, to: number) => {
      if ((to >> 3) === (side === 1 ? 0 : 7)) {
        for (const promotion of ['n', 'b', 'r', 'q'] as const) add(from, to, promotion);
      } else add(from, to);
    };
    for (let from = 0; from < 64; from += 1) {
      const piece = this.board[from];
      if (Math.sign(piece) !== side) continue;
      const type = Math.abs(piece);
      const rank = from >> 3;
      const file = from & 7;
      if (type === 1) {
        const dr = -side;
        const nextRank = rank + dr;
        if (nextRank < 0 || nextRank >= 8) continue;
        const forward = nextRank * 8 + file;
        if (!this.board[forward]) {
          if (!tacticalOnly || nextRank === (side === 1 ? 0 : 7)) addPawn(from, forward);
          const double = from + dr * 16;
          if (!tacticalOnly && rank === (side === 1 ? 6 : 1) && !this.board[double]) add(from, double);
        }
        for (const df of [-1, 1]) {
          const f = file + df;
          if (f < 0 || f >= 8) continue;
          const to = nextRank * 8 + f;
          const target = this.board[to];
          if ((Math.sign(target) === -side && Math.abs(target) !== 6)
            || (to === this.epSquare && !target && this.board[to + side * 8] === -side)) addPawn(from, to);
        }
        continue;
      }

      const directions = type === 2 ? KNIGHT_DELTAS : ATTACK_DIRECTIONS;
      for (let i = 0; i < directions.length; i += 1) {
        if ((type === 3 && i >= 4) || (type === 4 && i < 4)) continue;
        const [dr, df] = directions[i];
        let r = rank + dr; let f = file + df;
        while (r >= 0 && r < 8 && f >= 0 && f < 8) {
          const to = r * 8 + f;
          const target = this.board[to];
          if (Math.sign(target) === side || Math.abs(target) === 6) break;
          if (target || !tacticalOnly) add(from, to);
          if (target || type === 2 || type === 6) break;
          r += dr; f += df;
        }
      }

      if (type === 6 && !tacticalOnly && from === (side === 1 ? 60 : 4) && !this.isInCheck()) {
        for (const kingSide of [true, false]) {
          const right = side === 1
            ? (kingSide ? WHITE_KING_SIDE : WHITE_QUEEN_SIDE)
            : (kingSide ? BLACK_KING_SIDE : BLACK_QUEEN_SIDE);
          const step = kingSide ? 1 : -1;
          const rook = from + (kingSide ? 3 : -4);
          if (!(this.rights & right) || this.board[rook] !== side * 4
            || this.board[from + step] || this.board[from + step * 2]
            || (!kingSide && this.board[from - 3])) continue;
          // A rook move may not shield the king while it crosses the transit square.
          if (this.isLegalCandidate({ from, to: from + step })) add(from, from + step * 2);
        }
      }
    }
    return moves;
  }

  /** All legal moves; draw adjudication is deliberately the caller's job. */
  generateLegalMoves(): SearchMove[] { return this.generateMoves(false); }

  /** Legal captures, en passant and all promotions, even quiet promotions. */
  generateTacticalMoves(): SearchMove[] { return this.generateMoves(true); }

  /** In check, quiescence must consider every legal evasion, including quiet ones. */
  generateQuiescenceMoves(): SearchMove[] {
    return this.isInCheck() ? this.generateLegalMoves() : this.generateTacticalMoves();
  }

  /** Hash en-passant only when at least one capture is actually legal. */
  private findLegalEnPassantFile(): number {
    if (this.epSquare === NO_SQUARE || this.board[this.epSquare] !== 0) return NO_SQUARE;
    const capturedSquare = this.epSquare + this.side * 8;
    if (capturedSquare < 0 || capturedSquare >= 64 || this.board[capturedSquare] !== -this.side) return NO_SQUARE;
    const file = capturedSquare & 7;
    for (const df of [-1, 1]) {
      if (file + df < 0 || file + df >= 8) continue;
      const from = capturedSquare + df;
      if (this.board[from] !== this.side) continue;
      if (this.isLegalCandidate({ from, to: this.epSquare })) return this.epSquare & 7;
    }
    return NO_SQUARE;
  }

  private prepareFrame(kind: UndoFrame['kind']): UndoFrame {
    const frame = this.frames[this.depth] ?? createFrame();
    if (!this.frames[this.depth]) this.frames[this.depth] = frame;
    frame.kind = kind;
    frame.side = this.side; frame.rights = this.rights;
    frame.epSquare = this.epSquare; frame.epFile = this.legalEpFile;
    frame.halfmove = this.halfmove; frame.drawHalfmove = this.drawHalfmove; frame.fullmove = this.fullmove; frame.material = this.material;
    frame.whiteKing = this.whiteKing; frame.blackKing = this.blackKing;
    frame.hashLow = this.hashLow; frame.hashHigh = this.hashHigh;
    return frame;
  }

  /** Apply an already-legal move. Structural errors are rejected before mutation. */
  makeMove(move: SearchMove): void {
    const { from, to, promotion } = move;
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || from >= 64 || to < 0 || to >= 64 || from === to) {
      throw new Error('invalid move squares');
    }
    const moving = this.board[from];
    if (!moving || Math.sign(moving) !== this.side) throw new Error('invalid moving piece');
    if (Math.sign(this.board[to]) === this.side || Math.abs(this.board[to]) === 6) throw new Error('invalid capture');
    const type = Math.abs(moving);
    if (promotion !== undefined && !['n', 'b', 'r', 'q'].includes(promotion)) throw new Error('invalid promotion');
    const promotionRank = this.side === 1 ? 0 : 7;
    if ((promotion !== undefined) !== (type === 1 && (to >> 3) === promotionRank)) {
      throw new Error('invalid promotion');
    }

    let captureSquare = to;
    let newEpSquare = NO_SQUARE;
    if (type === 1) {
      const direction = this.side === 1 ? -8 : 8;
      const fileDifference = (to & 7) - (from & 7);
      const delta = to - from;
      if (fileDifference === 0) {
        if (this.board[to] !== 0) throw new Error('blocked pawn');
        if (delta === direction * 2) {
          if ((from >> 3) !== (this.side === 1 ? 6 : 1) || this.board[from + direction] !== 0) {
            throw new Error('invalid pawn double move');
          }
          newEpSquare = from + direction;
        } else if (delta !== direction) throw new Error('invalid pawn move');
      } else if (Math.abs(fileDifference) === 1 && delta === direction + fileDifference) {
        if (this.board[to] === 0) {
          captureSquare = to + this.side * 8;
          if (to !== this.epSquare || captureSquare < 0 || captureSquare >= 64 || this.board[captureSquare] !== -this.side) {
            throw new Error('invalid en-passant capture');
          }
        }
      } else throw new Error('invalid pawn move');
    }

    let rookFrom = NO_SQUARE;
    let rookTo = NO_SQUARE;
    if (type === 6 && Math.abs(to - from) === 2) {
      const home = this.side === 1 ? 60 : 4;
      const kingSide = to > from;
      const requiredRight = this.side === 1
        ? (kingSide ? WHITE_KING_SIDE : WHITE_QUEEN_SIDE)
        : (kingSide ? BLACK_KING_SIDE : BLACK_QUEEN_SIDE);
      rookFrom = home + (kingSide ? 3 : -4);
      rookTo = home + (kingSide ? 1 : -1);
      if (from !== home || to !== home + (kingSide ? 2 : -2) || !(this.rights & requiredRight)
        || this.board[rookFrom] !== this.side * 4 || this.board[to] !== 0 || this.board[rookTo] !== 0
        || (!kingSide && this.board[home - 3] !== 0)) throw new Error('invalid castling');
      const opponent = -this.side as SearchSide;
      if (this.isInCheck() || this.isSquareAttacked(rookTo, opponent) || this.isSquareAttacked(to, opponent)) {
        throw new Error('castling through check');
      }
    }
    const captured = this.board[captureSquare];
    if (this.side === -1 && this.fullmove === Number.MAX_SAFE_INTEGER) throw new Error('fullmove overflow');
    if (type !== 1 && !captured && this.halfmove === Number.MAX_SAFE_INTEGER) throw new Error('halfmove overflow');

    const frame = this.prepareFrame('move');
    frame.from = from; frame.to = to; frame.moving = moving; frame.captured = captured;
    frame.captureSquare = captureSquare; frame.rookFrom = rookFrom; frame.rookTo = rookTo;
    frame.rookPiece = rookFrom === NO_SQUARE ? 0 : this.board[rookFrom];

    this.xorKey(CASTLING_KEYS + this.rights);
    if (this.legalEpFile !== NO_SQUARE) this.xorKey(EP_KEYS + this.legalEpFile);
    this.setSquare(from, 0);
    if (captureSquare !== to) this.setSquare(captureSquare, 0);
    this.setSquare(to, promotion ? this.side * PIECES.indexOf(promotion) : moving);
    if (rookFrom !== NO_SQUARE) { this.setSquare(rookFrom, 0); this.setSquare(rookTo, frame.rookPiece); }
    if (moving === 6) { this.whiteKing = to; this.rights &= ~(WHITE_KING_SIDE | WHITE_QUEEN_SIDE); }
    if (moving === -6) { this.blackKing = to; this.rights &= ~(BLACK_KING_SIDE | BLACK_QUEEN_SIDE); }
    if ((moving === 4 && from === 63) || (captured === 4 && captureSquare === 63)) this.rights &= ~WHITE_KING_SIDE;
    if ((moving === 4 && from === 56) || (captured === 4 && captureSquare === 56)) this.rights &= ~WHITE_QUEEN_SIDE;
    if ((moving === -4 && from === 7) || (captured === -4 && captureSquare === 7)) this.rights &= ~BLACK_KING_SIDE;
    if ((moving === -4 && from === 0) || (captured === -4 && captureSquare === 0)) this.rights &= ~BLACK_QUEEN_SIDE;
    this.epSquare = newEpSquare;
    this.halfmove = type === 1 || captured ? 0 : this.halfmove + 1;
    this.drawHalfmove = type === 1 || captured ? 0 : this.drawHalfmove + 1;
    if (this.side === -1) this.fullmove += 1;
    this.side = -this.side as SearchSide;
    this.xorKey(TURN_KEY);
    this.xorKey(CASTLING_KEYS + this.rights);
    this.legalEpFile = this.findLegalEnPassantFile();
    if (this.legalEpFile !== NO_SQUARE) this.xorKey(EP_KEYS + this.legalEpFile);
    const irreversible = type === 1 || captured !== 0 || this.rights !== frame.rights;
    this.repetition.push(this.hashLow, this.hashHigh, this.board, this.side, this.rights, this.legalEpFile,
      irreversible ? 'irreversible' : 'reversible');
    this.depth += 1;
  }

  /**
   * Synthetic pass for null-move pruning; it starts a fresh repetition scope.
   * The caller must first exclude stalemate and apply its other pruning guards:
   * use generateLegalMoves to exclude stalemate before applying this operation.
   */
  makeNullMove(): void {
    if ((this.depth > 0 && this.frames[this.depth - 1].kind === 'null') || this.isInCheck() || this.halfmove >= 98) {
      throw new Error('null move is not safe in this position');
    }
    if (this.side === -1 && this.fullmove === Number.MAX_SAFE_INTEGER) throw new Error('fullmove overflow');
    this.prepareFrame('null');
    if (this.legalEpFile !== NO_SQUARE) this.xorKey(EP_KEYS + this.legalEpFile);
    this.epSquare = NO_SQUARE; this.legalEpFile = NO_SQUARE;
    this.halfmove += 1;
    if (this.side === -1) this.fullmove += 1;
    this.side = -this.side as SearchSide;
    this.xorKey(TURN_KEY);
    this.repetition.push(this.hashLow, this.hashHigh, this.board, this.side, this.rights, this.legalEpFile, 'null');
    this.depth += 1;
  }

  undo(): void {
    if (this.depth === 0) throw new Error('cannot undo past search root');
    const frame = this.frames[this.depth - 1];
    this.repetition.pop();
    if (frame.kind === 'move') {
      this.board[frame.from] = frame.moving;
      this.board[frame.to] = 0;
      this.board[frame.captureSquare] = frame.captured;
      if (frame.rookFrom !== NO_SQUARE) {
        this.board[frame.rookFrom] = frame.rookPiece;
        this.board[frame.rookTo] = 0;
      }
    }
    this.side = frame.side; this.rights = frame.rights;
    this.epSquare = frame.epSquare; this.legalEpFile = frame.epFile;
    this.halfmove = frame.halfmove; this.drawHalfmove = frame.drawHalfmove; this.fullmove = frame.fullmove; this.material = frame.material;
    this.whiteKing = frame.whiteKing; this.blackKing = frame.blackKing;
    this.hashLow = frame.hashLow; this.hashHigh = frame.hashHigh;
    this.depth -= 1;
  }

  checkpoint(): number { return this.depth; }

  restore(checkpoint: number): void {
    if (!Number.isInteger(checkpoint) || checkpoint < 0 || checkpoint > this.depth) throw new Error('invalid checkpoint');
    while (this.depth > checkpoint) this.undo();
  }

  /** Execute synchronous search work and unwind every nested move on return or throw. */
  withMove<T>(move: SearchMove, search: () => T): T {
    const checkpoint = this.checkpoint();
    this.makeMove(move);
    try {
      const result = search();
      if (result && typeof (result as { then?: unknown }).then === 'function') {
        throw new Error('search callback must be synchronous');
      }
      return result;
    } finally {
      this.restore(checkpoint);
    }
  }

  toFen(options: { rawEnPassant?: boolean } = {}): string {
    let placement = '';
    for (let rank = 0; rank < 8; rank += 1) {
      let empty = 0;
      for (let file = 0; file < 8; file += 1) {
        const piece = this.board[rank * 8 + file];
        if (!piece) { empty += 1; continue; }
        if (empty) { placement += empty; empty = 0; }
        const symbol = PIECES[Math.abs(piece)];
        placement += piece > 0 ? symbol.toUpperCase() : symbol;
      }
      if (empty) placement += empty;
      if (rank < 7) placement += '/';
    }
    const castling = (this.rights & WHITE_KING_SIDE ? 'K' : '')
      + (this.rights & WHITE_QUEEN_SIDE ? 'Q' : '')
      + (this.rights & BLACK_KING_SIDE ? 'k' : '')
      + (this.rights & BLACK_QUEEN_SIDE ? 'q' : '');
    const ep = this.epSquare !== NO_SQUARE && (options.rawEnPassant || this.legalEpFile !== NO_SQUARE)
      ? squareToAlgebraic(this.epSquare) : '-';
    return `${placement} ${this.turn} ${castling || '-'} ${ep} ${this.halfmove} ${this.fullmove}`;
  }
}

import {
  DIRECTION_BETWEEN, FIRST_ORTHOGONAL_DIRECTION, KING_TARGETS, KNIGHT_TARGETS, PAWN_ATTACKERS, RAY_ASCENDING, RAY_MASKS, RAYS,
} from './boardGeometry';
import { PHASE_BY_TYPE, PIECE_SQUARE_EG, PIECE_SQUARE_MG } from './evaluationTables';
import { RepetitionStack, type SearchSide } from './searchPositionRepetition';
import {
  CASTLING_FLAG, DOUBLE_PUSH_FLAG, EN_PASSANT_FLAG, encodeMove, MAX_MOVES, moveFrom, movePromotion, moveTo,
} from './independent/moveCode';

const EMPTY_MOVES = new Int32Array(0);
/** Offsets in `bits` of the slider bitboards (each two words; orthogonal at +2). */
const WHITE_DIAGONAL = 6;
const BLACK_DIAGONAL = 10;
const FACT_SLOT = 8;
const FACT_CHECK = 0;
const FACT_MARKED = 1;
const FACT_CHECKERS = 2;
const FACT_EVASION_LOW = 3;
const FACT_EVASION_HIGH = 4;
const FACT_PIN_LOW = 5;
const FACT_PIN_HIGH = 6;
/** Whether `square` is set in the bitboard (low, high). */
const hasSquare = (low: number, high: number, square: number): boolean => (
  ((square < 32 ? low >>> square : high >>> (square - 32)) & 1) !== 0);
/** All diagonal (directions 0-3) and all orthogonal (4-7) ray squares of each square, two words each. */
const LINE_UNIONS = new Int32Array(64 * 4);
for (let square = 0; square < 64; square += 1) {
  for (let direction = 0; direction < 8; direction += 1) {
    const at = square * 4 + (direction < FIRST_ORTHOGONAL_DIRECTION ? 0 : 2);
    LINE_UNIONS[at] |= RAY_MASKS[(square * 8 + direction) * 2];
    LINE_UNIONS[at + 1] |= RAY_MASKS[(square * 8 + direction) * 2 + 1];
  }
}
/** Whether two squares are neighbours (a king's step apart). */
const isAdjacent = (a: number, b: number): boolean => {
  const rankGap = (a >> 3) - (b >> 3);
  const fileGap = (a & 7) - (b & 7);
  return a !== b && rankGap >= -1 && rankGap <= 1 && fileGap >= -1 && fileGap <= 1;
};
/** Generation modes: every legal move, captures and promotions only, or the rest. */
const ALL_MOVES = 0;
const TACTICAL_MOVES = 1;
const QUIET_MOVES = 2;

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
const PROMOTIONS = ['n', 'b', 'r', 'q'] as const;
const CASTLING_KEYS = 12 * 64;
const EP_KEYS = CASTLING_KEYS + 16;
const TURN_KEY = EP_KEYS + 8;

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
  pieceSquareMg: number;
  pieceSquareEg: number;
  phase: number;
  whiteNonPawn: number;
  blackNonPawn: number;
  whiteBishops: number;
  blackBishops: number;
  pawnKey: number;
  pawns0: number;
  pawns1: number;
  pawns2: number;
  pawns3: number;
  bits0: number;
  bits1: number;
  bits2: number;
  bits3: number;
  bits4: number;
  bits5: number;
  bits6: number;
  bits7: number;
  bits8: number;
  bits9: number;
  bits10: number;
  bits11: number;
  bits12: number;
  bits13: number;
  whiteKing: number;
  blackKing: number;
  hashLow: number;
  hashHigh: number;
};

const createFrame = (): UndoFrame => ({
  kind: 'move', from: -1, to: -1, moving: 0, captured: 0, captureSquare: -1,
  rookFrom: -1, rookTo: -1, rookPiece: 0, side: 1, rights: 0, epSquare: -1,
  epFile: -1, halfmove: 0, drawHalfmove: 0, fullmove: 1, material: 0,
  pieceSquareMg: 0, pieceSquareEg: 0, phase: 0, whiteNonPawn: 0, blackNonPawn: 0, whiteBishops: 0, blackBishops: 0,
  pawnKey: 0, pawns0: 0, pawns1: 0, pawns2: 0, pawns3: 0,
  bits0: 0, bits1: 0, bits2: 0, bits3: 0, bits4: 0, bits5: 0,
  bits6: 0, bits7: 0, bits8: 0, bits9: 0, bits10: 0, bits11: 0, bits12: 0, bits13: 0, whiteKing: -1, blackKing: -1,
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
  // Terms of the tapered evaluation kept up to date by setSquare; see the getters.
  private psqMg = 0;
  private psqEg = 0;
  private phase = 0;
  private whiteNonPawn = 0;
  private blackNonPawn = 0;
  private whiteBishops = 0;
  private blackBishops = 0;
  private pawnHash = 0;
  private readonly pawnFiles = new Int32Array(4);
  // Bitboards in two 32-bit words each (squares 0..31, 32..63): white pieces,
  // black pieces, knights, bishops, rooks and queens of both sides, then the
  // diagonal sliders (bishops, queens) and orthogonal sliders (rooks, queens)
  // of white and of black.
  private readonly bits = new Int32Array(14);
  private readonly occupancyView = this.bits.subarray(0, 4);
  private readonly officerView = this.bits.subarray(4, 6);
  private readonly sliderView = this.bits.subarray(6, 14);
  /**
   * Facts about each position on the current line, by depth, for check
   * detection and move generation: FACT_CHECK (0 not yet known, 1 not in
   * check, 2 in check), then, once FACT_MARKED is 1, the number of checkers
   * and bitboards of the evasion squares and of the pinned pieces. A move or
   * null move clears the slot of the new depth; undo returns to a slot that
   * still describes its position.
   */
  private facts = new Int32Array(64 * FACT_SLOT);
  private whiteKing = NO_SQUARE;
  private blackKing = NO_SQUARE;
  private hashLow = 0;
  private hashHigh = 0;
  private depth = 0;
  private readonly frames: UndoFrame[] = [];
  // Results of markCheck and markPins.
  private evasionLow = 0;
  private evasionHigh = 0;
  private pinLow = 0;
  private pinHigh = 0;
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
        this.updateTerms(piece, square, 1);
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
    position.forgetFacts();
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
    let knights = 0; let bishops = 0; let bishopColor = -1;
    for (let i = 0; i < 64; i += 1) {
      const type = Math.abs(this.board[i]);
      if (type === 2) knights += 1;
      else if (type === 3) {
        bishops += 1;
        const color = ((i >> 3) + (i & 7)) & 1;
        if (bishopColor === -1) bishopColor = color;
        else if (bishopColor !== color) bishopColor = 2;
      } else if (type && type !== 6) return false; // a pawn, rook or queen can always mate
    }
    return knights + bishops <= 1 || (knights === 0 && bishopColor !== 2);
  }

  /** The live board for read-only hot paths such as evaluation; never mutate it. */
  get squares(): Int8Array { return this.board; }

  // --- Incremental evaluation terms (white minus black where signed) ---

  /** Material plus middlegame piece-square value of the tapered evaluation; kings carry no material. */
  get pieceSquareMg(): number { return this.psqMg; }
  /** Material plus endgame piece-square value of the tapered evaluation. */
  get pieceSquareEg(): number { return this.psqEg; }
  /** Unclamped game-phase weight: 1 per minor piece, 2 per rook, 4 per queen. */
  get phaseWeight(): number { return this.phase; }
  /** Knights, bishops, rooks and queens at 320, 330, 500 and 900. */
  get whiteNonPawnMaterial(): number { return this.whiteNonPawn; }
  get blackNonPawnMaterial(): number { return this.blackNonPawn; }
  get whiteBishopCount(): number { return this.whiteBishops; }
  get blackBishopCount(): number { return this.blackBishops; }
  /** 32-bit Zobrist key of the pawns alone, for pawn-structure caches. */
  get pawnKey(): number { return this.pawnHash; }
  /**
   * Live per-file pawn masks, packed four files per word: bits 8f..8f+7 of
   * word w hold file 4w+f (white words 0-1, black words 2-3), and bit r of a
   * file is rank index r (0 = eighth rank). Never mutate it.
   */
  get pawnFileMasks(): Int32Array { return this.pawnFiles; }
  /** Live occupancy bitboards: words 0-1 white (squares 0..31, 32..63), words 2-3 black. Never mutate them. */
  get occupancy(): Int32Array { return this.occupancyView; }
  /** Live bitboard (two words) of the knights, bishops, rooks and queens of both sides. Never mutate it. */
  get officerOccupancy(): Int32Array { return this.officerView; }
  /**
   * Live slider bitboards, two words each: white diagonal (bishops, queens),
   * white orthogonal (rooks, queens), black diagonal, black orthogonal.
   * Never mutate them.
   */
  get sliderOccupancy(): Int32Array { return this.sliderView; }
  get whiteKingSquare(): number { return this.whiteKing; }
  get blackKingSquare(): number { return this.blackKing; }

  /** Add (`sign` 1) or remove (`sign` -1) one piece from the incremental terms. */
  private updateTerms(piece: number, square: number, sign: 1 | -1): void {
    const index = (piece + 6) * 64 + square;
    this.psqMg += sign * PIECE_SQUARE_MG[index];
    this.psqEg += sign * PIECE_SQUARE_EG[index];
    const type = piece > 0 ? piece : -piece;
    this.phase += sign * PHASE_BY_TYPE[type];
    const word = square >> 5;
    const bit = 1 << (square & 31);
    this.bits[(piece > 0 ? 0 : 2) + word] ^= bit;
    if (type > 1 && type < 6) this.bits[4 + word] ^= bit;
    if (type === 3 || type === 5) this.bits[(piece > 0 ? WHITE_DIAGONAL : BLACK_DIAGONAL) + word] ^= bit;
    if (type === 4 || type === 5) this.bits[(piece > 0 ? WHITE_DIAGONAL : BLACK_DIAGONAL) + 2 + word] ^= bit;
    if (type === 1) {
      this.pawnHash = (this.pawnHash ^ HASH_LOW[pieceKeyIndex(piece, square)]) >>> 0;
      const file = square & 7;
      this.pawnFiles[(piece > 0 ? 0 : 2) + (file >> 2)] ^= 1 << (((file & 3) << 3) | (square >> 3));
    } else if (type !== 6) {
      if (piece > 0) {
        this.whiteNonPawn += sign * PIECE_VALUES[type];
        if (type === 3) this.whiteBishops += sign;
      } else {
        this.blackNonPawn += sign * PIECE_VALUES[type];
        if (type === 3) this.blackBishops += sign;
      }
    }
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
      this.updateTerms(old, square, -1);
    }
    if (piece) {
      this.xorKey(pieceKeyIndex(piece, square));
      this.material += Math.sign(piece) * PIECE_VALUES[Math.abs(piece)];
      this.updateTerms(piece, square, 1);
    }
    this.board[square] = piece;
  }

  /** Geometric attacks count even when the attacking piece is pinned. */
  private isSquareAttacked(target: number, by: SearchSide): boolean {
    const board = this.board;
    const pawns = PAWN_ATTACKERS[by === 1 ? 0 : 1][target];
    for (let i = 0; i < pawns.length; i += 1) if (board[pawns[i]] === by) return true;
    const knight = by * 2;
    const knights = KNIGHT_TARGETS[target];
    for (let i = 0; i < knights.length; i += 1) if (board[knights[i]] === knight) return true;
    if (isAdjacent(target, by === 1 ? this.whiteKing : this.blackKing)) return true;
    const bishop = by * 3; const rook = by * 4; const queen = by * 5;
    const bits = this.bits;
    const sliders = by === 1 ? WHITE_DIAGONAL : BLACK_DIAGONAL;
    const rays = RAYS[target];
    // No enemy slider on any diagonal (orthogonal) line: skip those four rays.
    const lines = target * 4;
    const diagonal = (LINE_UNIONS[lines] & bits[sliders]) !== 0 || (LINE_UNIONS[lines + 1] & bits[sliders + 1]) !== 0;
    const orthogonal = (LINE_UNIONS[lines + 2] & bits[sliders + 2]) !== 0 || (LINE_UNIONS[lines + 3] & bits[sliders + 3]) !== 0;
    if (!diagonal && !orthogonal) return false;
    for (let direction = diagonal ? 0 : FIRST_ORTHOGONAL_DIRECTION; direction < (orthogonal ? 8 : FIRST_ORTHOGONAL_DIRECTION); direction += 1) {
      // A ray without an enemy slider of its kind cannot attack.
      const kind = sliders + (direction < FIRST_ORTHOGONAL_DIRECTION ? 0 : 2);
      const mask = (target * 8 + direction) * 2;
      if ((RAY_MASKS[mask] & bits[kind]) === 0 && (RAY_MASKS[mask + 1] & bits[kind + 1]) === 0) continue;
      const ray = rays[direction];
      const slider = direction < FIRST_ORTHOGONAL_DIRECTION ? bishop : rook;
      for (let i = 0; i < ray.length; i += 1) {
        const piece = board[ray[i]];
        if (piece === 0) continue;
        if (piece === slider || piece === queen) return true;
        break;
      }
    }
    return false;
  }

  /**
   * isSquareAttacked as if `vacated` were empty: the legality test of a king
   * move from `vacated`, whose sliders' rays continue through the king's old
   * square. A piece captured on `target` lies on none of the rays from it.
   */
  private isSquareAttackedVacating(target: number, by: SearchSide, vacated: number): boolean {
    const board = this.board;
    const pawns = PAWN_ATTACKERS[by === 1 ? 0 : 1][target];
    for (let i = 0; i < pawns.length; i += 1) if (board[pawns[i]] === by) return true;
    const knight = by * 2;
    const knights = KNIGHT_TARGETS[target];
    for (let i = 0; i < knights.length; i += 1) if (board[knights[i]] === knight) return true;
    if (isAdjacent(target, by === 1 ? this.whiteKing : this.blackKing)) return true;
    const bishop = by * 3; const rook = by * 4; const queen = by * 5;
    const bits = this.bits;
    const sliders = by === 1 ? WHITE_DIAGONAL : BLACK_DIAGONAL;
    const rays = RAYS[target];
    const lines = target * 4;
    const diagonal = (LINE_UNIONS[lines] & bits[sliders]) !== 0 || (LINE_UNIONS[lines + 1] & bits[sliders + 1]) !== 0;
    const orthogonal = (LINE_UNIONS[lines + 2] & bits[sliders + 2]) !== 0 || (LINE_UNIONS[lines + 3] & bits[sliders + 3]) !== 0;
    if (!diagonal && !orthogonal) return false;
    for (let direction = diagonal ? 0 : FIRST_ORTHOGONAL_DIRECTION; direction < (orthogonal ? 8 : FIRST_ORTHOGONAL_DIRECTION); direction += 1) {
      const kind = sliders + (direction < FIRST_ORTHOGONAL_DIRECTION ? 0 : 2);
      const mask = (target * 8 + direction) * 2;
      if ((RAY_MASKS[mask] & bits[kind]) === 0 && (RAY_MASKS[mask + 1] & bits[kind + 1]) === 0) continue;
      const ray = rays[direction];
      const slider = direction < FIRST_ORTHOGONAL_DIRECTION ? bishop : rook;
      for (let i = 0; i < ray.length; i += 1) {
        const square = ray[i];
        const piece = board[square];
        if (piece === 0 || square === vacated) continue;
        if (piece === slider || piece === queen) return true;
        break;
      }
    }
    return false;
  }

  /** Whether `by` (1 white, -1 black) attacks `square`, pins ignored. */
  isSquareAttackedBy(square: number, by: SearchSide): boolean { return this.isSquareAttacked(square, by); }

  /** 1 when white is to move, -1 when black is. */
  get sideToMove(): SearchSide { return this.side; }

  /** Cached per position: move generation and the search's own checks share one attack test. */
  isInCheck(): boolean {
    const base = this.factBase();
    let state = this.facts[base + FACT_CHECK];
    if (state === 0) {
      state = this.isSquareAttacked(this.side === 1 ? this.whiteKing : this.blackKing, -this.side as SearchSide) ? 2 : 1;
      this.facts[base + FACT_CHECK] = state;
    }
    return state === 2;
  }

  /** Offset of the current position's slot in `facts`, growing the table when the line gets longer. */
  private factBase(): number {
    const base = this.depth * FACT_SLOT;
    if (base >= this.facts.length) {
      const grown = new Int32Array(Math.max(this.facts.length * 2, base + FACT_SLOT));
      grown.set(this.facts);
      this.facts = grown;
    }
    return base;
  }

  /** The position at the current depth is new: nothing about it is known yet. */
  private forgetFacts(): void {
    const base = this.factBase();
    this.facts[base + FACT_CHECK] = 0;
    this.facts[base + FACT_MARKED] = 0;
  }

  /**
   * Test a candidate generated below without calling makeMove on an illegal
   * move. Only the private board is changed temporarily; turn, king fields,
   * clocks, hash, undo frames and repetition history are never touched. The
   * attack test uses the original mover's king, including after a king move.
   */
  private isLegalCandidate(from: number, to: number, promotion = 0): boolean {
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
      this.board[to] = promotion ? this.side * promotion : moving;
      if (castle) { this.board[rookFrom] = 0; this.board[rookTo] = rook; }
      return !this.isSquareAttacked(king, -this.side as SearchSide);
    } finally {
      this.board[from] = moving;
      this.board[to] = target;
      if (enPassant) this.board[captureSquare] = captured;
      if (castle) { this.board[rookFrom] = rook; this.board[rookTo] = 0; }
    }
  }

  /**
   * Set pinLow/pinHigh to the own pieces that shield the king from an enemy
   * slider on the same line. A pinned piece's line is the direction from the
   * king to it.
   */
  private markPins(king: number): void {
    const board = this.board;
    const side = this.side;
    const queen = -side * 5;
    const rays = RAYS[king];
    const bits = this.bits;
    const sliders = side === 1 ? BLACK_DIAGONAL : WHITE_DIAGONAL;
    let low = 0;
    let high = 0;
    for (let direction = 0; direction < 8; direction += 1) {
      // Only an enemy slider of the ray's kind can pin along it.
      const kind = sliders + (direction < FIRST_ORTHOGONAL_DIRECTION ? 0 : 2);
      const mask = (king * 8 + direction) * 2;
      if ((RAY_MASKS[mask] & bits[kind]) === 0 && (RAY_MASKS[mask + 1] & bits[kind + 1]) === 0) continue;
      const ray = rays[direction];
      const slider = direction < FIRST_ORTHOGONAL_DIRECTION ? -side * 3 : -side * 4;
      let shield = NO_SQUARE;
      for (let i = 0; i < ray.length; i += 1) {
        const piece = board[ray[i]];
        if (piece === 0) continue;
        if ((piece > 0 ? 1 : -1) === side) {
          if (shield !== NO_SQUARE) break;
          shield = ray[i];
          continue;
        }
        if (shield !== NO_SQUARE && (piece === slider || piece === queen)) {
          if (shield < 32) low |= 1 << shield; else high |= 1 << (shield - 32);
        }
        break;
      }
    }
    this.pinLow = low;
    this.pinHigh = high;
  }

  /**
   * Count the pieces checking `king` (0, 1 or 2). With exactly one checker,
   * set evasionLow/evasionHigh to the squares that resolve it: the checker
   * and, for a slider, the squares between it and the king.
   */
  private markCheck(king: number): number {
    const board = this.board;
    const by = -this.side as SearchSide;
    let checkers = 0;
    let checker = NO_SQUARE;
    let checkRay: Int8Array | null = null;
    const pawns = PAWN_ATTACKERS[by === 1 ? 0 : 1][king];
    for (let i = 0; i < pawns.length; i += 1) if (board[pawns[i]] === by) { checkers += 1; checker = pawns[i]; }
    const knights = KNIGHT_TARGETS[king];
    for (let i = 0; i < knights.length; i += 1) if (board[knights[i]] === by * 2) { checkers += 1; checker = knights[i]; }
    // Adjacent kings cannot arise in play; match isInCheck if a FEN has them.
    const neighbours = KING_TARGETS[king];
    for (let i = 0; i < neighbours.length; i += 1) if (board[neighbours[i]] === by * 6) { checkers += 1; checker = neighbours[i]; }
    const rays = RAYS[king];
    const bits = this.bits;
    const sliders = by === 1 ? WHITE_DIAGONAL : BLACK_DIAGONAL;
    for (let direction = 0; direction < 8; direction += 1) {
      const kind = sliders + (direction < FIRST_ORTHOGONAL_DIRECTION ? 0 : 2);
      const mask = (king * 8 + direction) * 2;
      if ((RAY_MASKS[mask] & bits[kind]) === 0 && (RAY_MASKS[mask + 1] & bits[kind + 1]) === 0) continue;
      const ray = rays[direction];
      const slider = direction < FIRST_ORTHOGONAL_DIRECTION ? by * 3 : by * 4;
      for (let i = 0; i < ray.length; i += 1) {
        const piece = board[ray[i]];
        if (piece === 0) continue;
        if (piece === slider || piece === by * 5) { checkers += 1; checker = ray[i]; checkRay = ray; }
        break;
      }
    }
    this.evasionLow = 0;
    this.evasionHigh = 0;
    if (checkers !== 1) return checkers;
    // Sliders are scanned last, so a recorded ray belongs to this checker.
    if (checkRay) {
      for (let i = 0; checkRay[i] !== checker; i += 1) this.markEvasion(checkRay[i]);
    }
    this.markEvasion(checker);
    return 1;
  }

  private markEvasion(square: number): void {
    if (square < 32) this.evasionLow |= 1 << square;
    else this.evasionHigh |= 1 << (square - 32);
  }

  // Per-call state of generateMoveCodes, kept in fields so candidate filtering
  // needs neither a closure nor an object per move.
  private genOut: Int32Array = EMPTY_MOVES;
  private genCount = 0;
  private genKing = NO_SQUARE;
  private genCheckers = 0;
  private genMode = ALL_MOVES;
  /** With legalMoveCode, the only destination to generate; otherwise -1. */
  private genTarget = NO_SQUARE;
  private genEvasionLow = 0;
  private genEvasionHigh = 0;
  private genPinLow = 0;
  private genPinHigh = 0;

  /**
   * A move by a piece other than the king, except en passant (which removes
   * two pawns from a rank), cannot expose the king unless the piece is
   * pinned, and a pinned piece is safe exactly while it stays on the line
   * from the king through it. In check a move must also capture the checker
   * or block its line; a pinned piece never can. In double check only the
   * king may move. A king move is safe when its destination is not attacked
   * with the king's old square empty. Only en passant and castling are still
   * tried on the board.
   */
  private addCandidate(from: number, to: number, promotion: number, flags: number): void {
    if (this.genTarget !== NO_SQUARE && to !== this.genTarget) return;
    const board = this.board;
    const enPassant = (flags & EN_PASSANT_FLAG) !== 0;
    let legal: boolean;
    if (enPassant || (flags & CASTLING_FLAG) !== 0) legal = this.isLegalCandidate(from, to, promotion);
    else if (from === this.genKing) legal = !this.isSquareAttackedVacating(to, -this.side as SearchSide, from);
    else if (this.genCheckers > 1) legal = false;
    else if (this.genCheckers === 1) {
      legal = !hasSquare(this.genPinLow, this.genPinHigh, from) && hasSquare(this.genEvasionLow, this.genEvasionHigh, to);
    } else {
      legal = !hasSquare(this.genPinLow, this.genPinHigh, from)
        || DIRECTION_BETWEEN[this.genKing * 64 + to] === DIRECTION_BETWEEN[this.genKing * 64 + from];
    }
    if (!legal) return;
    // Typed arrays silently ignore writes past their length. Fail instead of truncating moves.
    if (this.genCount >= this.genOut.length) throw new Error('move buffer too small; use MAX_MOVES entries');
    const moving = board[from];
    const captured = enPassant ? 1 : (board[to] > 0 ? board[to] : -board[to]);
    this.genOut[this.genCount++] = encodeMove(from, to, moving > 0 ? moving : -moving, captured, promotion, flags);
  }

  private addPawnCandidate(from: number, to: number, promotionRank: number, flags: number): void {
    if ((to >> 3) === promotionRank) {
      for (let promotion = 2; promotion <= 5; promotion += 1) this.addCandidate(from, to, promotion, flags);
    } else this.addCandidate(from, to, 0, flags);
  }

  /**
   * Write the legal moves as integer codes (see independent/moveCode.ts) into
   * `out` and return how many were written. `tacticalOnly` keeps captures, en
   * passant and all promotions; `firstOnly` stops after the first piece with
   * a legal move, so it writes at least one exactly when one exists.
   * `out` must hold MAX_MOVES entries.
   *
   * The order is fixed: own pieces from a8 to h1, and for each piece the
   * order of generateFrom. tests/client/fixtures/referenceMoveGeneration.ts
   * freezes it, because the kernel's tie order and so its node counts depend
   * on it.
   */
  generateMoveCodes(out: Int32Array, tacticalOnly = false, firstOnly = false): number {
    try {
      const king = this.beginGeneration(out, tacticalOnly ? TACTICAL_MOVES : ALL_MOVES);
      if (this.genCheckers > 1) this.generateFrom(king, 6);
      else {
        const base = this.side === 1 ? 0 : 2;
        scan: for (let word = 0; word < 2; word += 1) {
          let pieces = this.bits[base + word];
          while (pieces !== 0) {
            if (firstOnly && this.genCount) break scan;
            const bit = pieces & -pieces;
            pieces ^= bit;
            const from = (word << 5) | (31 - Math.clz32(bit));
            // Existence needs no order: try the king, the only piece whose moves need an attack test, last.
            if (firstOnly && from === king) continue;
            const piece = this.board[from];
            this.generateFrom(from, piece > 0 ? piece : -piece);
          }
        }
        if (firstOnly && !this.genCount) this.generateFrom(king, 6);
      }
      return this.endGeneration();
    } finally {
      // Never retain a caller's buffer or targeted-move filter after a failed legality trial.
      this.genOut = EMPTY_MOVES;
      this.genTarget = NO_SQUARE;
    }
  }

  /**
   * The legal moves that are neither captures nor promotions, in the order
   * of generateMoveCodes: together with the tactical moves they partition
   * the legal moves. Staged search generates them only when it gets there.
   */
  generateQuietMoveCodes(out: Int32Array): number {
    try {
      const king = this.beginGeneration(out, QUIET_MOVES);
      if (this.genCheckers > 1) this.generateFrom(king, 6);
      else {
        const base = this.side === 1 ? 0 : 2;
        for (let word = 0; word < 2; word += 1) {
          let pieces = this.bits[base + word];
          while (pieces !== 0) {
            const bit = pieces & -pieces;
            pieces ^= bit;
            const from = (word << 5) | (31 - Math.clz32(bit));
            const piece = this.board[from];
            this.generateFrom(from, piece > 0 ? piece : -piece);
          }
        }
      }
      return this.endGeneration();
    } finally {
      // Never retain a caller's buffer or targeted-move filter after a failed legality trial.
      this.genOut = EMPTY_MOVES;
      this.genTarget = NO_SQUARE;
    }
  }

  private readonly pieceScratch = new Int32Array(MAX_MOVES);

  /**
   * The code generateMoveCodes would produce for the move with this key
   * (from, to and promotion, see moveKey), or 0 when it is not legal here.
   * Only the moves of the piece on `from` are generated, so a stored move
   * (TT move, killer, countermove) can be tried before generating the rest.
   */
  legalMoveCode(key: number): number {
    try {
      const from = key & 63;
      const piece = this.board[from];
      if (piece === 0 || (piece > 0 ? 1 : -1) !== this.side) return 0;
      const king = this.beginGeneration(this.pieceScratch, ALL_MOVES);
      this.genTarget = (key >> 6) & 63;
      if (this.genCheckers < 2 || from === king) this.generateFrom(from, piece > 0 ? piece : -piece);
      this.genTarget = NO_SQUARE;
      const count = this.endGeneration();
      for (let i = 0; i < count; i += 1) if ((this.pieceScratch[i] & 0x7fff) === key) return this.pieceScratch[i];
      return 0;
    } finally {
      // Never retain a caller's buffer or targeted-move filter after a failed legality trial.
      this.genOut = EMPTY_MOVES;
      this.genTarget = NO_SQUARE;
    }
  }

  /**
   * Set the per-call state from the position's checkers, evasion squares
   * and pins, computing them only the first time this position asks;
   * returns the king of the side to move.
   */
  private beginGeneration(out: Int32Array, mode: number): number {
    const king = this.side === 1 ? this.whiteKing : this.blackKing;
    const base = this.factBase();
    const facts = this.facts;
    if (facts[base + FACT_MARKED] === 0) {
      let checkers = 0;
      // A position already known not to be in check needs no checker scan.
      if (facts[base + FACT_CHECK] === 1) { this.evasionLow = 0; this.evasionHigh = 0; }
      else { checkers = this.markCheck(king); facts[base + FACT_CHECK] = checkers > 0 ? 2 : 1; }
      this.markPins(king);
      facts[base + FACT_CHECKERS] = checkers;
      facts[base + FACT_EVASION_LOW] = this.evasionLow; facts[base + FACT_EVASION_HIGH] = this.evasionHigh;
      facts[base + FACT_PIN_LOW] = this.pinLow; facts[base + FACT_PIN_HIGH] = this.pinHigh;
      facts[base + FACT_MARKED] = 1;
    }
    this.genCheckers = facts[base + FACT_CHECKERS];
    this.genEvasionLow = facts[base + FACT_EVASION_LOW]; this.genEvasionHigh = facts[base + FACT_EVASION_HIGH];
    this.genPinLow = facts[base + FACT_PIN_LOW]; this.genPinHigh = facts[base + FACT_PIN_HIGH];
    this.genOut = out; this.genCount = 0; this.genKing = king; this.genMode = mode;
    return king;
  }

  /** Return how many moves were written since beginGeneration. */
  private endGeneration(): number {
    const count = this.genCount;
    this.genOut = EMPTY_MOVES;
    return count;
  }

  /**
   * Candidates of the piece on `from`, in order: a pawn's push (each
   * promotion n, b, r, q), double push, then captures towards the a-file and
   * the h-file; a knight's or king's target table, then kingside and
   * queenside castling; a slider's directions in boardGeometry order, nearest
   * square first. In check, rays and targets that cannot reach an evasion
   * square are skipped; tactical generation finds a slider's capture from
   * the bitboards without walking its empty squares.
   */
  private generateFrom(from: number, type: number): void {
    const board = this.board;
    const side = this.side;
    const mode = this.genMode;
    const quiets = mode !== TACTICAL_MOVES;
    const tacticals = mode !== QUIET_MOVES;
    const checkers = this.genCheckers;
    if (type === 1) {
      const promotionRank = side === 1 ? 0 : 7;
      const rank = from >> 3;
      const file = from & 7;
      const nextRank = rank - side;
      if (nextRank < 0 || nextRank >= 8) return;
      const forward = nextRank * 8 + file;
      if (!board[forward]) {
        if (nextRank === promotionRank ? tacticals : quiets) this.addPawnCandidate(from, forward, promotionRank, 0);
        const double = forward - side * 8;
        if (quiets && rank === (side === 1 ? 6 : 1) && !board[double]) this.addCandidate(from, double, 0, DOUBLE_PUSH_FLAG);
      }
      if (!tacticals) return;
      for (let df = -1; df <= 1; df += 2) {
        const f = file + df;
        if (f < 0 || f >= 8) continue;
        const to = nextRank * 8 + f;
        const target = board[to];
        if (target !== 0 && (target > 0 ? 1 : -1) === -side && target !== -side * 6) this.addPawnCandidate(from, to, promotionRank, 0);
        else if (to === this.epSquare && !target && board[to + side * 8] === -side) this.addPawnCandidate(from, to, promotionRank, EN_PASSANT_FLAG);
      }
      return;
    }
    // Apart from a pawn's en passant, a pinned piece cannot resolve a check.
    if (checkers === 1 && hasSquare(this.genPinLow, this.genPinHigh, from)) return;

    if (type === 2 || type === 6) {
      const steps = type === 2 ? KNIGHT_TARGETS[from] : KING_TARGETS[from];
      const evading = checkers === 1 && type === 2;
      for (let i = 0; i < steps.length; i += 1) {
        const to = steps[i];
        const target = board[to];
        if (evading && !hasSquare(this.genEvasionLow, this.genEvasionHigh, to)) continue;
        if (target === 0 ? quiets : (tacticals && (target > 0 ? 1 : -1) !== side && target !== -side * 6)) this.addCandidate(from, to, 0, 0);
      }
      if (type === 6 && quiets && checkers === 0 && from === (side === 1 ? 60 : 4)) {
        for (let castle = 0; castle < 2; castle += 1) {
          const kingSide = castle === 0;
          const right = side === 1
            ? (kingSide ? WHITE_KING_SIDE : WHITE_QUEEN_SIDE)
            : (kingSide ? BLACK_KING_SIDE : BLACK_QUEEN_SIDE);
          const step = kingSide ? 1 : -1;
          const rook = from + (kingSide ? 3 : -4);
          if (!(this.rights & right) || board[rook] !== side * 4
            || board[from + step] || board[from + step * 2]
            || (!kingSide && board[from - 3])) continue;
          // The king may not cross an attacked square; the destination is tried with the rook moved.
          if (!this.isSquareAttackedVacating(from + step, -side as SearchSide, from)) {
            this.addCandidate(from, from + step * 2, 0, CASTLING_FLAG);
          }
        }
      }
      return;
    }

    const bits = this.bits;
    const occupiedLow = bits[0] | bits[2];
    const occupiedHigh = bits[1] | bits[3];
    const rays = RAYS[from];
    const last = type === 3 ? FIRST_ORTHOGONAL_DIRECTION : 8;
    for (let direction = type === 4 ? FIRST_ORTHOGONAL_DIRECTION : 0; direction < last; direction += 1) {
      const mask = (from * 8 + direction) * 2;
      if (checkers === 1 && (RAY_MASKS[mask] & this.genEvasionLow) === 0 && (RAY_MASKS[mask + 1] & this.genEvasionHigh) === 0) continue;
      if (this.genTarget !== NO_SQUARE && DIRECTION_BETWEEN[from * 64 + this.genTarget] !== direction) continue;
      if (mode === TACTICAL_MOVES) {
        // The nearest piece on the ray: the lowest set bit on an ascending ray, the highest otherwise.
        const low = RAY_MASKS[mask] & occupiedLow;
        const high = RAY_MASKS[mask + 1] & occupiedHigh;
        let to: number;
        if (RAY_ASCENDING[direction]) to = low !== 0 ? 31 - Math.clz32(low & -low) : high !== 0 ? 63 - Math.clz32(high & -high) : NO_SQUARE;
        else to = high !== 0 ? 63 - Math.clz32(high) : low !== 0 ? 31 - Math.clz32(low) : NO_SQUARE;
        if (to === NO_SQUARE) continue;
        const target = board[to];
        if ((target > 0 ? 1 : -1) !== side && target !== -side * 6) this.addCandidate(from, to, 0, 0);
        continue;
      }
      const ray = rays[direction];
      for (let i = 0; i < ray.length; i += 1) {
        const to = ray[i];
        const target = board[to];
        if (target === 0) { this.addCandidate(from, to, 0, 0); continue; }
        if (tacticals && (target > 0 ? 1 : -1) !== side && target !== -side * 6) this.addCandidate(from, to, 0, 0);
        break;
      }
    }
  }

  private readonly moveScratch = new Int32Array(MAX_MOVES);

  private generateMoves(tacticalOnly: boolean): SearchMove[] {
    const count = this.generateMoveCodes(this.moveScratch, tacticalOnly);
    const moves: SearchMove[] = new Array(count);
    for (let i = 0; i < count; i += 1) {
      const code = this.moveScratch[i];
      const promotion = movePromotion(code);
      moves[i] = promotion
        ? { from: moveFrom(code), to: moveTo(code), promotion: PIECES[promotion] as PromotionPiece }
        : { from: moveFrom(code), to: moveTo(code) };
    }
    return moves;
  }

  /** Whether the side to move has any legal move, without generating them all. */
  hasLegalMove(): boolean { return this.generateMoveCodes(this.moveScratch, false, true) > 0; }

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
      if (this.isLegalCandidate(from, this.epSquare)) return this.epSquare & 7;
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
    frame.pieceSquareMg = this.psqMg; frame.pieceSquareEg = this.psqEg; frame.phase = this.phase;
    frame.whiteNonPawn = this.whiteNonPawn; frame.blackNonPawn = this.blackNonPawn;
    frame.whiteBishops = this.whiteBishops; frame.blackBishops = this.blackBishops; frame.pawnKey = this.pawnHash;
    const pawns = this.pawnFiles;
    frame.pawns0 = pawns[0]; frame.pawns1 = pawns[1]; frame.pawns2 = pawns[2]; frame.pawns3 = pawns[3];
    const bits = this.bits;
    frame.bits0 = bits[0]; frame.bits1 = bits[1]; frame.bits2 = bits[2]; frame.bits3 = bits[3];
    frame.bits4 = bits[4]; frame.bits5 = bits[5];
    frame.bits6 = bits[6]; frame.bits7 = bits[7]; frame.bits8 = bits[8]; frame.bits9 = bits[9];
    frame.bits10 = bits[10]; frame.bits11 = bits[11]; frame.bits12 = bits[12]; frame.bits13 = bits[13];
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
    this.applyMove(from, to, promotion ? PIECES.indexOf(promotion) : 0, captureSquare, newEpSquare, rookFrom, rookTo);
  }

  /**
   * Apply a code from generateMoveCodes on the position it was generated for.
   * It skips makeMove's structural validation: passing any other integer is
   * undefined behaviour.
   */
  makeMoveCode(code: number): void {
    const from = code & 63;
    const to = (code >> 6) & 63;
    let captureSquare = to;
    let newEpSquare = NO_SQUARE;
    let rookFrom = NO_SQUARE;
    let rookTo = NO_SQUARE;
    if (code & EN_PASSANT_FLAG) captureSquare = to + this.side * 8;
    else if (code & DOUBLE_PUSH_FLAG) newEpSquare = (from + to) >> 1;
    else if (code & CASTLING_FLAG) {
      const kingSide = to > from;
      rookFrom = from + (kingSide ? 3 : -4);
      rookTo = from + (kingSide ? 1 : -1);
    }
    this.applyMove(from, to, movePromotion(code), captureSquare, newEpSquare, rookFrom, rookTo);
  }

  private applyMove(from: number, to: number, promotion: number, captureSquare: number,
    newEpSquare: number, rookFrom: number, rookTo: number): void {
    const moving = this.board[from];
    const type = moving > 0 ? moving : -moving;
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
    this.setSquare(to, promotion ? this.side * promotion : moving);
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
    this.forgetFacts();
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
    this.forgetFacts();
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
    this.psqMg = frame.pieceSquareMg; this.psqEg = frame.pieceSquareEg; this.phase = frame.phase;
    this.whiteNonPawn = frame.whiteNonPawn; this.blackNonPawn = frame.blackNonPawn;
    this.whiteBishops = frame.whiteBishops; this.blackBishops = frame.blackBishops; this.pawnHash = frame.pawnKey;
    const pawns = this.pawnFiles;
    pawns[0] = frame.pawns0; pawns[1] = frame.pawns1; pawns[2] = frame.pawns2; pawns[3] = frame.pawns3;
    const bits = this.bits;
    bits[0] = frame.bits0; bits[1] = frame.bits1; bits[2] = frame.bits2; bits[3] = frame.bits3;
    bits[4] = frame.bits4; bits[5] = frame.bits5;
    bits[6] = frame.bits6; bits[7] = frame.bits7; bits[8] = frame.bits8; bits[9] = frame.bits9;
    bits[10] = frame.bits10; bits[11] = frame.bits11; bits[12] = frame.bits12; bits[13] = frame.bits13;
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

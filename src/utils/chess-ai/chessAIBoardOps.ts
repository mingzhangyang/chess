import { Chess, type Color, type PieceSymbol, type Square } from 'chess.js';
import { SearchPosition, squareToAlgebraic, type SearchMove } from './searchPosition';

export type SearchGame = Chess | SearchPosition;
export const searchTurn = (game: SearchGame): Color => game instanceof SearchPosition ? game.turn : game.turn();
export const searchInCheck = (game: SearchGame): boolean => game instanceof SearchPosition ? game.isInCheck() : game.isCheck();

/**
 * The subset of chess.js `Move` that the search relies on. chess.js `Move`
 * objects satisfy it structurally, so callers may pass either kind.
 */
export interface AiMove {
  color: Color;
  from: Square;
  to: Square;
  piece: PieceSymbol;
  captured?: PieceSymbol;
  promotion?: PieceSymbol;
  flags: string;
  isCapture(): boolean;
  isPromotion(): boolean;
  isEnPassant(): boolean;
}

// chess.js's public move API builds a `Move` for every generated move, and
// for every move()/undo() call. Each `Move` regenerates the full legal move
// list to compute SAN plus two FENs, which made each search node O(n^2) and
// limited the AI to ~200 nodes/s. The search only needs the raw move data, so
// it talks to the engine's internal generator/make/unmake directly when the
// installed chess.js exposes them, and falls back to the public API otherwise.
type InternalMove = {
  color: Color;
  from: number;
  to: number;
  piece: PieceSymbol;
  captured?: PieceSymbol;
  promotion?: PieceSymbol;
  flags: number;
};

type ChessInternals = {
  _board: Array<{ type: PieceSymbol; color: Color } | undefined>;
  _hash: bigint;
  _moves(options: { legal: boolean }): InternalMove[];
  _makeMove(move: InternalMove): void;
  _undoMove(): InternalMove | null;
  _incPositionCount(): void;
  _decPositionCount(hash: bigint): void;
  _isKingAttacked(color: Color): boolean;
};

const BITS = {
  CAPTURE: 2,
  EP_CAPTURE: 8,
  PROMOTION: 16,
} as const;
const TACTICAL_BITS = BITS.CAPTURE | BITS.EP_CAPTURE | BITS.PROMOTION;

// Same letters and order chess.js uses when it builds `Move.flags`.
const FLAG_LETTERS: ReadonlyArray<readonly [number, string]> = [
  [1, 'n'],
  [2, 'c'],
  [4, 'b'],
  [8, 'e'],
  [16, 'p'],
  [32, 'k'],
  [64, 'q'],
];

const FLAG_STRINGS: string[] = Array.from({ length: 256 }, (_, bits) =>
  FLAG_LETTERS.filter(([bit]) => (bits & bit) !== 0).map(([, letter]) => letter).join(''));

// 0x88 board index -> algebraic square.
const SQUARE_NAMES: Square[] = Array.from({ length: 128 }, (_, index) =>
  (index & 0x88 ? '' : `${'abcdefgh'[index & 7]}${8 - (index >> 4)}`) as Square);

class FastMove implements AiMove {
  readonly color: Color;
  readonly from: Square;
  readonly to: Square;
  readonly piece: PieceSymbol;
  readonly captured?: PieceSymbol;
  readonly promotion?: PieceSymbol;
  readonly flags: string;
  readonly internal: InternalMove;

  constructor(internal: InternalMove) {
    this.internal = internal;
    this.color = internal.color;
    this.from = SQUARE_NAMES[internal.from];
    this.to = SQUARE_NAMES[internal.to];
    this.piece = internal.piece;
    if (internal.captured) this.captured = internal.captured;
    if (internal.promotion) this.promotion = internal.promotion;
    this.flags = FLAG_STRINGS[internal.flags & 0xff];
  }

  isCapture(): boolean {
    return (this.internal.flags & BITS.CAPTURE) !== 0;
  }

  isPromotion(): boolean {
    return (this.internal.flags & BITS.PROMOTION) !== 0;
  }

  isEnPassant(): boolean {
    return (this.internal.flags & BITS.EP_CAPTURE) !== 0;
  }
}

/** Adapt independent moves to the existing ordering and search heuristics. */
class IndependentMove implements AiMove {
  readonly color: Color;
  readonly from: Square;
  readonly to: Square;
  readonly piece: PieceSymbol;
  readonly captured?: PieceSymbol;
  readonly promotion?: PieceSymbol;
  readonly flags: string;

  constructor(readonly internal: SearchMove, game: SearchPosition) {
    const piece = game.pieceAt(internal.from);
    const target = game.pieceAt(internal.to);
    const ep = Math.abs(piece) === 1 && internal.to === game.enPassantSquare
      && !target && (internal.from & 7) !== (internal.to & 7);
    const castle = Math.abs(piece) === 6 && Math.abs(internal.to - internal.from) === 2;
    this.color = game.turn;
    this.from = squareToAlgebraic(internal.from) as Square;
    this.to = squareToAlgebraic(internal.to) as Square;
    this.piece = ' pnbrqk'[Math.abs(piece)] as PieceSymbol;
    this.captured = ep ? 'p' : target ? ' pnbrqk'[Math.abs(target)] as PieceSymbol : undefined;
    this.promotion = internal.promotion;
    const doublePawn = Math.abs(piece) === 1 && Math.abs(internal.to - internal.from) === 16;
    this.flags = (!target && !ep && !castle && !doublePawn ? 'n' : '')
      + (target ? 'c' : '') + (ep ? 'e' : '') + (internal.promotion ? 'p' : '')
      + (castle ? (internal.to > internal.from ? 'k' : 'q') : '')
      + (doublePawn ? 'b' : '');
  }
  isCapture(): boolean { return this.flags.includes('c'); }
  isEnPassant(): boolean { return this.flags.includes('e'); }
  isPromotion(): boolean { return Boolean(this.promotion); }
}

const detectFastInternals = (): boolean => {
  try {
    const probe = new Chess() as unknown as Partial<ChessInternals>;
    if (
      typeof probe._moves !== 'function'
      || typeof probe._makeMove !== 'function'
      || typeof probe._undoMove !== 'function'
      || typeof probe._incPositionCount !== 'function'
      || typeof probe._decPositionCount !== 'function'
      || typeof probe._isKingAttacked !== 'function'
      || typeof probe._hash !== 'bigint'
      || !Array.isArray(probe._board)
      || probe._board.length !== 128
    ) {
      return false;
    }
    const internals = probe as ChessInternals;
    const moves = internals._moves({ legal: true });
    const e4 = moves.find((move) => SQUARE_NAMES[move.from] === 'e2' && SQUARE_NAMES[move.to] === 'e4');
    if (moves.length !== 20 || !e4) return false;
    const startFen = (probe as unknown as Chess).fen();
    internals._makeMove(e4);
    const movedFen = (probe as unknown as Chess).fen();
    internals._undoMove();
    return movedFen === 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'
      && (probe as unknown as Chess).fen() === startFen;
  } catch {
    return false;
  }
};

const FAST_INTERNALS_AVAILABLE = detectFastInternals();

export const isFastBoardOpsEnabled = (): boolean => FAST_INTERNALS_AVAILABLE;

const wrapMoves = (internalMoves: InternalMove[]): AiMove[] => {
  const moves: AiMove[] = new Array(internalMoves.length);
  for (let i = 0; i < internalMoves.length; i += 1) {
    moves[i] = new FastMove(internalMoves[i]);
  }
  return moves;
};

// Plays a pseudo-legal internal move and reports whether it left the mover's
// own king attacked. The move stays on the board; the caller undoes it.
const playAndTestExposure = (internals: ChessInternals, move: InternalMove): boolean => {
  internals._makeMove(move);
  return internals._isKingAttacked(move.color);
};

type BoardGrid = ReturnType<Chess['board']>;

/**
 * The 8x8 piece grid (rank 8 first), like `game.board()` but without
 * allocating a `{ square, type, color }` object per piece: entries reference
 * chess.js's own piece records, which it never mutates in place. Entries have
 * no `square` field.
 */
const INDEPENDENT_PIECES = ['p', 'n', 'b', 'r', 'q', 'k'].map((type) => ({
  w: { type, color: 'w' }, b: { type, color: 'b' },
}));

export const getBoard = (game: SearchGame): BoardGrid => {
  if (game instanceof SearchPosition) {
    const grid = new Array(8);
    for (let rank = 0; rank < 8; rank += 1) {
      const row = new Array(8);
      for (let file = 0; file < 8; file += 1) {
        const piece = game.pieceAt(rank * 8 + file);
        row[file] = piece ? INDEPENDENT_PIECES[Math.abs(piece) - 1][piece > 0 ? 'w' : 'b'] : null;
      }
      grid[rank] = row;
    }
    return grid as BoardGrid;
  }
  if (!FAST_INTERNALS_AVAILABLE) {
    return game.board();
  }
  const squares = (game as unknown as ChessInternals)._board;
  const grid = new Array(8);
  for (let rank = 0; rank < 8; rank += 1) {
    const row = new Array(8);
    const base = rank * 16;
    for (let file = 0; file < 8; file += 1) {
      row[file] = squares[base + file] ?? null;
    }
    grid[rank] = row;
  }
  return grid as BoardGrid;
};

/** Legal moves for the side to move, without building chess.js `Move` objects. */
export const generateMoves = (game: SearchGame): AiMove[] => {
  if (game instanceof SearchPosition) return game.generateLegalMoves().map((move) => new IndependentMove(move, game));
  if (!FAST_INTERNALS_AVAILABLE) {
    return game.moves({ verbose: true });
  }
  return wrapMoves((game as unknown as ChessInternals)._moves({ legal: true }));
};

/**
 * Pseudo-legal moves: some may leave the mover's king in check. Play them with
 * `makeMoveIfLegal`, which tests legality only for moves the search actually
 * tries. chess.js otherwise makes and unmakes every move just to filter them.
 */
export const generatePseudoLegalMoves = (game: SearchGame): AiMove[] => {
  if (game instanceof SearchPosition) return generateMoves(game);
  if (!FAST_INTERNALS_AVAILABLE) {
    return game.moves({ verbose: true });
  }
  return wrapMoves((game as unknown as ChessInternals)._moves({ legal: false }));
};

/** Whether the side to move has any legal move (stops at the first one found). */
export const hasLegalMove = (game: SearchGame): boolean => {
  if (game instanceof SearchPosition) return game.generateLegalMoves().length > 0;
  if (!FAST_INTERNALS_AVAILABLE) {
    return game.moves().length > 0;
  }
  const internals = game as unknown as ChessInternals;
  const pseudoLegalMoves = internals._moves({ legal: false });
  for (let i = 0; i < pseudoLegalMoves.length; i += 1) {
    const exposed = playAndTestExposure(internals, pseudoLegalMoves[i]);
    internals._undoMove();
    if (!exposed) return true;
  }
  return false;
};

/** chess.js marks en passant separately from ordinary captures, so both are tactical. */
export const isTacticalMove = (move: AiMove): boolean =>
  move.isCapture() || move.isEnPassant() || move.isPromotion();

/**
 * Legal captures, en-passant captures and promotions for the side to move.
 * Quiescence search only needs these, and filtering before the legality test
 * skips the make/unmake chess.js would otherwise spend on every quiet move.
 */
export const generateTacticalMoves = (game: SearchGame): AiMove[] => {
  if (game instanceof SearchPosition) return game.generateTacticalMoves().map((move) => new IndependentMove(move, game));
  if (!FAST_INTERNALS_AVAILABLE) {
    return game.moves({ verbose: true }).filter(isTacticalMove);
  }
  const internals = game as unknown as ChessInternals;
  const pseudoLegalMoves = internals._moves({ legal: false });
  const moves: AiMove[] = [];
  for (let i = 0; i < pseudoLegalMoves.length; i += 1) {
    const move = pseudoLegalMoves[i];
    if ((move.flags & TACTICAL_BITS) === 0) continue;
    const exposed = playAndTestExposure(internals, move);
    internals._undoMove();
    if (!exposed) {
      moves.push(new FastMove(move));
    }
  }
  return moves;
};

/**
 * Plays `move` on `game`. Moves from `generateMoves` must be played on the
 * same position they were generated for; chess.js `Move`-shaped objects are
 * validated through the public API.
 */
export const makeMove = (game: SearchGame, move: AiMove): void => {
  if (game instanceof SearchPosition) {
    if (!(move instanceof IndependentMove)) throw new Error('independent move required');
    game.makeMove(move.internal);
    return;
  }
  if (FAST_INTERNALS_AVAILABLE && move instanceof FastMove) {
    const internals = game as unknown as ChessInternals;
    internals._makeMove(move.internal);
    internals._incPositionCount();
    return;
  }
  game.move({ from: move.from, to: move.to, promotion: move.promotion });
};

/**
 * Plays `move` if it does not leave the mover's king in check and returns
 * whether it was played. Meant for moves from `generatePseudoLegalMoves`.
 */
export const makeMoveIfLegal = (game: SearchGame, move: AiMove): boolean => {
  if (game instanceof SearchPosition) { makeMove(game, move); return true; }
  if (FAST_INTERNALS_AVAILABLE && move instanceof FastMove) {
    const internals = game as unknown as ChessInternals;
    if (playAndTestExposure(internals, move.internal)) {
      internals._undoMove();
      return false;
    }
    internals._incPositionCount();
    return true;
  }
  try {
    makeMove(game, move);
    return true;
  } catch {
    return false;
  }
};

/** Takes back the last move, keeping chess.js repetition bookkeeping intact. */
export const undoMove = (game: SearchGame): void => {
  if (game instanceof SearchPosition) { game.undo(); return; }
  if (!FAST_INTERNALS_AVAILABLE) {
    game.undo();
    return;
  }
  const internals = game as unknown as ChessInternals;
  const hash = internals._hash;
  if (internals._undoMove()) {
    internals._decPositionCount(hash);
  }
};

export const isSameMove = (
  a: Pick<AiMove, 'from' | 'to' | 'promotion'>,
  b: Pick<AiMove, 'from' | 'to' | 'promotion'>,
): boolean => a.from === b.from && a.to === b.to && (a.promotion ?? '') === (b.promotion ?? '');

/** SAN for `move` in the current position, or null if it is not legal here. */
export const moveToSan = (game: Chess, move: Pick<AiMove, 'from' | 'to' | 'promotion'>): string | null =>
  game.moves({ verbose: true }).find((candidate) => isSameMove(candidate, move))?.san ?? null;

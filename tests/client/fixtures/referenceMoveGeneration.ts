/**
 * Frozen reference for the order and content of SearchPosition.generateMoveCodes
 * as of the phase 5 kernel (commit c134032). It is deliberately naive: its own
 * board, its own attack test, and legality by making each pseudo-legal move on
 * a copy and testing the king. The node-for-node kernel test depends on the
 * generation order, so optimisations of the generator must reproduce this list
 * exactly. Do not edit to follow generator changes; change it only with a
 * deliberate, reviewed change of move order.
 *
 * Order: squares a8..h1 (0..63) holding a piece of the side to move; per piece
 * - pawn: the push (promotions n, b, r, q), the double push, then the capture
 *   towards the a-file and towards the h-file (each with promotions, or en
 *   passant);
 * - knight and king: the target tables of boardGeometry in order, then for the
 *   king kingside and queenside castling;
 * - bishop, rook and queen: directions 0..7 of boardGeometry (bishops 0..3,
 *   rooks 4..7), nearest square first.
 * Tactical generation keeps captures, en passant and promotions only.
 */
import { DIRECTIONS, KING_TARGETS, KNIGHT_TARGETS } from '../../../src/utils/chess-ai/boardGeometry';
import { CASTLING_FLAG, DOUBLE_PUSH_FLAG, encodeMove, EN_PASSANT_FLAG } from '../../../src/utils/chess-ai/independent/moveCode';

type Board = { squares: Int8Array; side: 1 | -1; rights: number; ep: number };

const parse = (fen: string): Board => {
  const [placement, turn, castling, ep] = fen.split(' ');
  const squares = new Int8Array(64);
  let square = 0;
  for (const symbol of placement.replace(/\//g, '')) {
    if (/\d/.test(symbol)) { square += Number(symbol); continue; }
    const type = ' pnbrqk'.indexOf(symbol.toLowerCase());
    squares[square++] = symbol === symbol.toLowerCase() ? -type : type;
  }
  const rights = (castling.includes('K') ? 1 : 0) | (castling.includes('Q') ? 2 : 0)
    | (castling.includes('k') ? 4 : 0) | (castling.includes('q') ? 8 : 0);
  const epSquare = ep === '-' ? -1 : (8 - Number(ep[1])) * 8 + ep.charCodeAt(0) - 97;
  return { squares, side: turn === 'w' ? 1 : -1, rights, ep: epSquare };
};

const onBoard = (rank: number, file: number) => rank >= 0 && rank < 8 && file >= 0 && file < 8;

const attacked = (squares: Int8Array, target: number, by: 1 | -1): boolean => {
  const rank = target >> 3; const file = target & 7;
  for (const df of [-1, 1]) {
    const r = rank + by; const f = file + df; // a white pawn attacks from the rank below (higher index)
    if (onBoard(r, f) && squares[r * 8 + f] === by) return true;
  }
  for (const [dr, df] of [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]]) {
    if (onBoard(rank + dr, file + df) && squares[(rank + dr) * 8 + file + df] === by * 2) return true;
  }
  for (let direction = 0; direction < 8; direction += 1) {
    const [dr, df] = DIRECTIONS[direction];
    for (let r = rank + dr, f = file + df, step = 0; onBoard(r, f); r += dr, f += df, step += 1) {
      const piece = squares[r * 8 + f];
      if (piece === 0) continue;
      if (piece === by * 5 || piece === by * (direction < 4 ? 3 : 4) || (step === 0 && piece === by * 6)) return true;
      break;
    }
  }
  return false;
};

const legalAfter = (board: Board, from: number, to: number, promotion: number, flags: number): boolean => {
  const squares = Int8Array.from(board.squares);
  const moving = squares[from];
  squares[from] = 0;
  if (flags & EN_PASSANT_FLAG) squares[to + board.side * 8] = 0;
  squares[to] = promotion ? board.side * promotion : moving;
  if (flags & CASTLING_FLAG) {
    const kingSide = to > from;
    squares[from + (kingSide ? 1 : -1)] = squares[from + (kingSide ? 3 : -4)];
    squares[from + (kingSide ? 3 : -4)] = 0;
  }
  const king = squares.indexOf(board.side * 6);
  return !attacked(squares, king, -board.side as 1 | -1);
};

/** Codes of the legal moves of `fen`, in generator order. */
export const referenceMoveCodes = (fen: string, tacticalOnly = false): number[] => {
  const board = parse(fen);
  const { squares, side } = board;
  const out: number[] = [];
  const isEnemy = (piece: number) => piece !== 0 && Math.sign(piece) === -side && piece !== -side * 6;
  const add = (from: number, to: number, promotion: number, flags: number) => {
    if (!legalAfter(board, from, to, promotion, flags)) return;
    const captured = flags & EN_PASSANT_FLAG ? 1 : Math.abs(squares[to]);
    out.push(encodeMove(from, to, Math.abs(squares[from]), captured, promotion, flags));
  };
  const addPawn = (from: number, to: number, flags: number) => {
    if ((to >> 3) === (side === 1 ? 0 : 7)) for (let promotion = 2; promotion <= 5; promotion += 1) add(from, to, promotion, flags);
    else add(from, to, 0, flags);
  };
  for (let from = 0; from < 64; from += 1) {
    const piece = squares[from];
    if (piece === 0 || Math.sign(piece) !== side) continue;
    const type = Math.abs(piece);
    const rank = from >> 3; const file = from & 7;
    if (type === 1) {
      const next = rank - side;
      const forward = next * 8 + file;
      const promotes = next === (side === 1 ? 0 : 7);
      if (squares[forward] === 0) {
        if (!tacticalOnly || promotes) addPawn(from, forward, 0);
        if (!tacticalOnly && rank === (side === 1 ? 6 : 1) && squares[forward - side * 8] === 0) add(from, forward - side * 8, 0, DOUBLE_PUSH_FLAG);
      }
      for (const df of [-1, 1]) {
        if (!onBoard(next, file + df)) continue;
        const to = next * 8 + file + df;
        if (isEnemy(squares[to])) addPawn(from, to, 0);
        else if (to === board.ep && squares[to] === 0 && squares[to + side * 8] === -side) addPawn(from, to, EN_PASSANT_FLAG);
      }
    } else if (type === 2 || type === 6) {
      for (const to of type === 2 ? KNIGHT_TARGETS[from] : KING_TARGETS[from]) {
        if (squares[to] === 0 ? !tacticalOnly : isEnemy(squares[to])) add(from, to, 0, 0);
      }
      if (type === 6 && !tacticalOnly && from === (side === 1 ? 60 : 4) && !attacked(squares, from, -side as 1 | -1)) {
        for (const kingSide of [true, false]) {
          const right = (side === 1 ? 1 : 4) << (kingSide ? 0 : 1);
          const step = kingSide ? 1 : -1;
          if (!(board.rights & right) || squares[from + (kingSide ? 3 : -4)] !== side * 4
            || squares[from + step] || squares[from + 2 * step] || (!kingSide && squares[from - 3])) continue;
          if (legalAfter(board, from, from + step, 0, 0)) add(from, from + 2 * step, 0, CASTLING_FLAG);
        }
      }
    } else {
      for (let direction = type === 4 ? 4 : 0; direction < (type === 3 ? 4 : 8); direction += 1) {
        const [dr, df] = DIRECTIONS[direction];
        for (let r = rank + dr, f = file + df; onBoard(r, f); r += dr, f += df) {
          const to = r * 8 + f;
          if (squares[to] === 0) { if (!tacticalOnly) add(from, to, 0, 0); continue; }
          if (isEnemy(squares[to])) add(from, to, 0, 0);
          break;
        }
      }
    }
  }
  return out;
};

import type { Chess, Move } from 'chess.js';
import { PIECE_VALUES } from './chessAIEvaluation';

const pieceValues = PIECE_VALUES;

const KNIGHT_JUMPS = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]] as const;
const DIAG_DIRS = [[-1, -1], [-1, 1], [1, -1], [1, 1]] as const;
const ORTHO_DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const;

// Returns true if (rank, file) is attacked by any piece of byColor.
// Uses the board as-is (pre-capture); accurate enough for SEE approximation.
export const isSquareAttacked = (
  board: ReturnType<Chess['board']>,
  rank: number,
  file: number,
  byColor: 'w' | 'b',
): boolean => {
  const pawnRank = rank + (byColor === 'w' ? 1 : -1);
  for (const df of [-1, 1]) {
    const f = file + df;
    if (pawnRank >= 0 && pawnRank < 8 && f >= 0 && f < 8) {
      const p = board[pawnRank][f];
      if (p && p.type === 'p' && p.color === byColor) return true;
    }
  }
  for (const [dr, df] of KNIGHT_JUMPS) {
    const r = rank + dr;
    const f = file + df;
    if (r >= 0 && r < 8 && f >= 0 && f < 8) {
      const p = board[r][f];
      if (p && p.type === 'n' && p.color === byColor) return true;
    }
  }
  for (const [dr, df] of DIAG_DIRS) {
    for (let s = 1; s < 8; s += 1) {
      const r = rank + dr * s;
      const f = file + df * s;
      if (r < 0 || r >= 8 || f < 0 || f >= 8) break;
      const p = board[r][f];
      if (p) {
        if (p.color === byColor && (p.type === 'b' || p.type === 'q')) return true;
        break;
      }
    }
  }
  for (const [dr, df] of ORTHO_DIRS) {
    for (let s = 1; s < 8; s += 1) {
      const r = rank + dr * s;
      const f = file + df * s;
      if (r < 0 || r >= 8 || f < 0 || f >= 8) break;
      const p = board[r][f];
      if (p) {
        if (p.color === byColor && (p.type === 'r' || p.type === 'q')) return true;
        break;
      }
    }
  }
  for (let dr = -1; dr <= 1; dr += 1) {
    for (let df = -1; df <= 1; df += 1) {
      if (dr === 0 && df === 0) continue;
      const r = rank + dr;
      const f = file + df;
      if (r >= 0 && r < 8 && f >= 0 && f < 8) {
        const p = board[r][f];
        if (p && p.type === 'k' && p.color === byColor) return true;
      }
    }
  }
  return false;
};

// Returns a move-ordering score. When board is provided, applies a simplified SEE
// correction: losing captures (victim < attacker AND square is defended) are scored
// negatively so they sort below quiet moves and are searched last.
export const scoreMoveForOrdering = (move: Move, board?: ReturnType<Chess['board']>): number => {
  let score = 0;

  if (move.isCapture() || move.isEnPassant()) {
    const capturedValue = move.captured ? (pieceValues[move.captured] || 0) : pieceValues.p;
    const attackerValue = pieceValues[move.piece] || 0;
    if (board && capturedValue < attackerValue) {
      // Potentially losing: check if target square is defended by the opponent.
      const toRank = 7 - (move.to.charCodeAt(1) - 49); // board rank index
      const toFile = move.to.charCodeAt(0) - 97;       // file index
      const defColor: 'w' | 'b' = move.color === 'w' ? 'b' : 'w';
      if (isSquareAttacked(board, toRank, toFile, defColor)) {
        score += capturedValue - attackerValue; // negative → sorted after quiet moves
      } else {
        score += capturedValue * 10 - attackerValue;
      }
    } else {
      score += capturedValue * 10 - attackerValue;
    }
  }

  if (move.isPromotion()) {
    const promotedPieceValue = move.promotion ? (pieceValues[move.promotion] || 0) : pieceValues.q;
    score += 20 + promotedPieceValue;
  }

  return score;
};

export const orderMoves = (moves: Move[], board?: ReturnType<Chess['board']>): Move[] => {
  moves.sort((a, b) => scoreMoveForOrdering(b, board) - scoreMoveForOrdering(a, board));
  return moves;
};

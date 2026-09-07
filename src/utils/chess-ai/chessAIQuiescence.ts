import { Chess, Move } from 'chess.js';
import { evaluateBoard, PIECE_VALUES } from './chessAIEvaluation';
import { searchState } from './chessAISearchDiagnostics';
import { checkSearchDeadline } from './chessAISearchTiming';
import { scoreMoveForOrdering } from './chessAIMoveOrdering';
import type { AiTuning } from './chessAITuning';

const pieceValues = PIECE_VALUES;
export const MATE_SCORE = 1000000;

// isDraw covers threefold repetition, insufficient material, and the 50-move rule.
// Note: isGameOver() is NOT called here because that redundantly checks checkmate/stalemate
// which we already detect via the rawMoves.length === 0 path in minimax.
export const isDraw = (game: Chess): boolean =>
  game.isThreefoldRepetition() || game.isInsufficientMaterial() || game.isDrawByFiftyMoves();

export const drawScore = (game: Chess, color: 'w' | 'b', tuning: AiTuning): number => {
  const boardScore = evaluateBoard(game, color, tuning);
  if (boardScore < -200) return 20;
  if (boardScore > 200) return -20;
  return -5;
};

export const shouldPruneQCaptureByDelta = (
  standPat: number,
  captureGain: number,
  alpha: number,
  tuning: Pick<AiTuning, 'enableQDelta' | 'qDeltaMargin'>,
): boolean => {
  if (!tuning.enableQDelta) {
    return false;
  }
  return standPat + captureGain + tuning.qDeltaMargin < alpha;
};

// Quiescence search: resolves captures and promotions to avoid the horizon effect.
export const quiescence = (
  game: Chess,
  alpha: number,
  beta: number,
  isMaximizingPlayer: boolean,
  color: 'w' | 'b',
  tuning: AiTuning,
  ply = 0,
): number => {
  searchState.qNodeCount += 1;
  if (checkSearchDeadline()) {
    return 0;
  }

  const allMoves = game.moves({ verbose: true }) as Move[];

  if (allMoves.length === 0) {
    if (game.isCheck()) {
      const aiIsMated = game.turn() === color;
      return aiIsMated ? -(MATE_SCORE - ply) : MATE_SCORE - ply;
    }
    return drawScore(game, color, tuning);
  }

  if (isDraw(game)) {
    return drawScore(game, color, tuning);
  }

  const standPat = evaluateBoard(game, color, tuning);
  const inCheckQ = game.isCheck();

  // Stand-pat is only valid when the side to move can choose not to capture.
  // When in check the side is *forced* to move, so stand-pat is meaningless.
  if (!inCheckQ) {
    if (isMaximizingPlayer) {
      if (standPat >= beta) return standPat;
      if (standPat > alpha) alpha = standPat;
    } else {
      if (standPat <= alpha) return standPat;
      if (standPat < beta) beta = standPat;
    }
  }

  // When in check all legal moves are evasions and must be searched — a quiet
  // king step may be the only legal move and ignoring it would return a wrong score.
  // Pass the board to scoreMoveForOrdering so SEE can filter losing captures.
  const qBoard = game.board();
  const captures = inCheckQ
    ? (allMoves as Move[]).sort((a, b) => scoreMoveForOrdering(b, qBoard) - scoreMoveForOrdering(a, qBoard))
    : allMoves
        .filter((m) => m.isCapture() || m.isEnPassant() || m.isPromotion())
        .sort((a, b) => scoreMoveForOrdering(b, qBoard) - scoreMoveForOrdering(a, qBoard));
  if (captures.length === 0) return inCheckQ
    ? (isMaximizingPlayer ? -Infinity : Infinity)
    : standPat;

  if (isMaximizingPlayer) {
    let bestVal = inCheckQ ? -Infinity : standPat;
    for (const move of captures) {
      if (checkSearchDeadline()) return 0;
      if (!inCheckQ && !move.isPromotion()) {
        const captureGain = move.captured ? (pieceValues[move.captured] || 0) : pieceValues.p;
        if (shouldPruneQCaptureByDelta(standPat, captureGain, alpha, tuning)) {
          continue;
        }
      }
      game.move(move.san);
      const childValue = quiescence(game, alpha, beta, false, color, tuning, ply + 1);
      game.undo();
      if (searchState.searchAborted) return 0;
      bestVal = Math.max(bestVal, childValue);
      alpha = Math.max(alpha, bestVal);
      if (beta <= alpha) break;
    }
    return bestVal;
  }

  let bestVal = inCheckQ ? Infinity : standPat;
  for (const move of captures) {
    if (checkSearchDeadline()) return 0;
    game.move(move.san);
    const childValue = quiescence(game, alpha, beta, true, color, tuning, ply + 1);
    game.undo();
    if (searchState.searchAborted) return 0;
    bestVal = Math.min(bestVal, childValue);
    beta = Math.min(beta, bestVal);
    if (beta <= alpha) break;
  }
  return bestVal;
};

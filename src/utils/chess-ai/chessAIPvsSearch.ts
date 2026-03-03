import { Chess, Move } from 'chess.js';
import { searchState } from './chessAISearchDiagnostics';
import { getLmrReduction, shouldPruneMoveByFutility, shouldPruneMoveByLmp } from './chessAISearchHeuristics';
import {
  applyHistoryBonus,
  applyHistoryMalus,
  getCountermoveScore,
  getHistoryScore,
  killerScore,
  recordCountermove,
  storeKiller,
  type CompactMove,
} from './chessAIMoveHeuristics';
import { scoreMoveForOrdering } from './chessAIMoveOrdering';
import { ttMoveMatches } from './chessAITranspositionTable';
import type { AiTuning } from './chessAITuning';

export type MinimaxRecurse = (
  game: Chess,
  depth: number,
  alpha: number,
  beta: number,
  isMaximizingPlayer: boolean,
  color: 'w' | 'b',
  tuning: AiTuning,
  ply?: number,
  allowNullMove?: boolean,
  prevMaxStaticEval?: number,
  prevMinStaticEval?: number,
  previousMove?: CompactMove,
) => number;

type SearchPvsMovesParams = {
  game: Chess;
  rawMoves: Move[];
  board: ReturnType<Chess['board']>;
  depth: number;
  alpha: number;
  beta: number;
  isMaximizingPlayer: boolean;
  color: 'w' | 'b';
  tuning: AiTuning;
  ply: number;
  isPvNode: boolean;
  inCheck: boolean;
  isImproving: boolean;
  nextPrevMaxStaticEval?: number;
  nextPrevMinStaticEval?: number;
  previousMove?: CompactMove;
  ttBestMove: number;
  getStaticEval: () => number;
  recurse: MinimaxRecurse;
};

export type SearchPvsMovesResult = {
  bestMove: Move | null;
  bestVal: number;
};

export const searchPvsMoves = ({
  game,
  rawMoves,
  board,
  depth,
  alpha: initialAlpha,
  beta: initialBeta,
  isMaximizingPlayer,
  color,
  tuning,
  ply,
  isPvNode,
  inCheck,
  isImproving,
  nextPrevMaxStaticEval,
  nextPrevMinStaticEval,
  previousMove,
  ttBestMove,
  getStaticEval,
  recurse,
}: SearchPvsMovesParams): SearchPvsMovesResult => {
  let alpha = initialAlpha;
  let beta = initialBeta;
  let bestMove: Move | null = null;
  let bestVal = isMaximizingPlayer ? -Infinity : Infinity;

  const sideToMove = game.turn();
  const orderingScore = (move: Move): number => (
    scoreMoveForOrdering(move, board)
    + killerScore(move, ply)
    + getHistoryScore(move)
    + (tuning.enableCountermove && !move.isCapture() && !move.isPromotion()
      ? getCountermoveScore(sideToMove, previousMove, move)
      : 0)
    + (ttMoveMatches(move, ttBestMove) ? 20000 : 0)
  );
  const moves = rawMoves.sort((a, b) => orderingScore(b) - orderingScore(a));

  const searchedQuietMoves: Move[] = [];
  for (let i = 0; i < moves.length; i += 1) {
    const move = moves[i];
    const isQuiet = !move.isCapture() && !move.isPromotion();
    const killerMoveScore = killerScore(move, ply);
    const historyMoveScore = getHistoryScore(move);
    if (isQuiet && shouldPruneMoveByLmp(
      {
        staticEval: getStaticEval(),
        alpha,
        beta,
        depth,
        moveIndex: i,
        isMaximizingPlayer,
        inCheck,
        isPvNode,
        isQuiet,
      },
      tuning,
    )) {
      searchState.lmpPruneCount += 1;
      continue;
    }
    if (isQuiet && shouldPruneMoveByFutility(
      {
        staticEval: getStaticEval(),
        alpha,
        beta,
        depth,
        isMaximizingPlayer,
        inCheck,
        isPvNode,
        isQuiet,
      },
      tuning,
    )) {
      searchState.fpPruneCount += 1;
      continue;
    }
    const lmrReduction = getLmrReduction(
      {
        depth,
        moveIndex: i,
        inCheck,
        isPvNode,
        isQuiet,
        isImproving,
        killerMoveScore,
        historyMoveScore,
      },
      tuning,
    );

    game.move(move.san);
    let val: number;
    if (i === 0) {
      // PV move: always search with full window.
      val = recurse(
        game,
        depth - 1,
        alpha,
        beta,
        !isMaximizingPlayer,
        color,
        tuning,
        ply + 1,
        true,
        nextPrevMaxStaticEval,
        nextPrevMinStaticEval,
        move,
      );
    } else if (isMaximizingPlayer) {
      // Non-PV max node: zero window search, with optional LMR depth reduction.
      const lmrDepth = depth - 1 - lmrReduction;
      val = recurse(
        game,
        lmrDepth,
        alpha,
        alpha + 1,
        false,
        color,
        tuning,
        ply + 1,
        true,
        nextPrevMaxStaticEval,
        nextPrevMinStaticEval,
        move,
      );
      if (!searchState.searchAborted) {
        // If LMR-reduced and failed high, retry at full depth with narrow window.
        if (lmrReduction > 0 && val > alpha) {
          val = recurse(
            game,
            depth - 1,
            alpha,
            alpha + 1,
            false,
            color,
            tuning,
            ply + 1,
            true,
            nextPrevMaxStaticEval,
            nextPrevMinStaticEval,
            move,
          );
        }
        // If narrow window failed high (score might be in [alpha+1, beta)), full re-search.
        if (val > alpha && val < beta) {
          val = recurse(
            game,
            depth - 1,
            alpha,
            beta,
            false,
            color,
            tuning,
            ply + 1,
            true,
            nextPrevMaxStaticEval,
            nextPrevMinStaticEval,
            move,
          );
        }
      }
    } else {
      // Non-PV min node: zero window search, with optional LMR depth reduction.
      const lmrDepth = depth - 1 - lmrReduction;
      val = recurse(
        game,
        lmrDepth,
        beta - 1,
        beta,
        true,
        color,
        tuning,
        ply + 1,
        true,
        nextPrevMaxStaticEval,
        nextPrevMinStaticEval,
        move,
      );
      if (!searchState.searchAborted) {
        // If LMR-reduced and failed low, retry at full depth with narrow window.
        if (lmrReduction > 0 && val < beta) {
          val = recurse(
            game,
            depth - 1,
            beta - 1,
            beta,
            true,
            color,
            tuning,
            ply + 1,
            true,
            nextPrevMaxStaticEval,
            nextPrevMinStaticEval,
            move,
          );
        }
        // If narrow window failed low (score might be in (alpha, beta-1)), full re-search.
        if (val < beta && val > alpha) {
          val = recurse(
            game,
            depth - 1,
            alpha,
            beta,
            true,
            color,
            tuning,
            ply + 1,
            true,
            nextPrevMaxStaticEval,
            nextPrevMinStaticEval,
            move,
          );
        }
      }
    }
    game.undo();

    if (isMaximizingPlayer) {
      if (val > bestVal) {
        bestVal = val;
        bestMove = move;
      }
      alpha = Math.max(alpha, bestVal);
    } else {
      if (val < bestVal) {
        bestVal = val;
        bestMove = move;
      }
      beta = Math.min(beta, bestVal);
    }

    if (beta <= alpha) {
      if (isQuiet) {
        storeKiller(move, ply);
        applyHistoryBonus(move, depth);
        if (tuning.enableHistoryMalus) {
          for (let q = 0; q < searchedQuietMoves.length; q += 1) {
            applyHistoryMalus(searchedQuietMoves[q], depth);
          }
        }
        if (tuning.enableCountermove && previousMove) {
          recordCountermove(sideToMove, previousMove, move);
        }
      }
      break;
    }
    if (isQuiet) {
      searchedQuietMoves.push(move);
    }
  }

  return { bestMove, bestVal };
};

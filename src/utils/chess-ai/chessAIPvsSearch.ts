import { Chess } from 'chess.js';
import { isTacticalMove, makeMoveIfLegal, undoMove, type AiMove } from './chessAIBoardOps';
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
import { advanceRepetitionContext, createRepetitionContext, type RepetitionContext } from './chessAIRepetition';
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
  repetitionContext?: RepetitionContext,
) => number;

type SearchPvsMovesParams = {
  game: Chess;
  rawMoves: AiMove[];
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
  repetitionContext?: RepetitionContext;
};

export type SearchPvsMovesResult = {
  bestMove: AiMove | null;
  bestVal: number;
  /** Legal moves actually played; 0 with no abort means checkmate or stalemate. */
  legalMoveCount: number;
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
  repetitionContext,
}: SearchPvsMovesParams): SearchPvsMovesResult => {
  let alpha = initialAlpha;
  let beta = initialBeta;
  let bestMove: AiMove | null = null;
  let bestVal = isMaximizingPlayer ? -Infinity : Infinity;

  const sideToMove = game.turn();
  const currentRepetitionContext = repetitionContext ?? createRepetitionContext(game);
  const orderingScore = (move: AiMove): number => (
    scoreMoveForOrdering(move, board)
    + killerScore(move, ply)
    + getHistoryScore(move)
    + (tuning.enableCountermove && !isTacticalMove(move)
      ? getCountermoveScore(sideToMove, previousMove, move)
      : 0)
    + (ttMoveMatches(move, ttBestMove) ? 20000 : 0)
  );
  const moves = rawMoves.sort((a, b) => orderingScore(b) - orderingScore(a));
  // `rawMoves` may be pseudo-legal; `legalMoveCount` is the index of the next
  // legal move to be searched and drives PV/LMR/LMP decisions.
  let legalMoveCount = 0;
  const previousFen = game.fen();

  const searchedQuietMoves: AiMove[] = [];
  for (let i = 0; i < moves.length; i += 1) {
    const move = moves[i];
    const moveIndex = legalMoveCount;
    const isQuiet = !isTacticalMove(move);
    const killerMoveScore = killerScore(move, ply);
    const historyMoveScore = getHistoryScore(move);
    // Never prune the first candidate before a real score exists. Besides
    // preserving a legal fallback, this prevents a zero-window node from
    // returning +/-Infinity when every move is quiet.
    if (bestMove && isQuiet && shouldPruneMoveByLmp(
      {
        staticEval: getStaticEval(),
        alpha,
        beta,
        depth,
        moveIndex,
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
    if (bestMove && isQuiet && shouldPruneMoveByFutility(
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
        moveIndex,
        inCheck,
        isPvNode,
        isQuiet,
        isImproving,
        killerMoveScore,
        historyMoveScore,
      },
      tuning,
    );

    if (!makeMoveIfLegal(game, move)) {
      continue;
    }
    legalMoveCount += 1;
    const childRepetitionContext = advanceRepetitionContext(
      currentRepetitionContext,
      move,
      previousFen,
      game.fen(),
    );
    let val: number;
    if (moveIndex === 0) {
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
        childRepetitionContext,
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
        childRepetitionContext,
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
            childRepetitionContext,
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
            childRepetitionContext,
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
        childRepetitionContext,
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
            childRepetitionContext,
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
            childRepetitionContext,
          );
        }
      }
    }
    undoMove(game);

    // An aborted child has no valid score. Stop before updating best-move or
    // move-ordering state so a partial iteration cannot train the next search.
    if (searchState.searchAborted) {
      return { bestMove: null, bestVal: isMaximizingPlayer ? -Infinity : Infinity, legalMoveCount };
    }

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

  return { bestMove, bestVal, legalMoveCount };
};

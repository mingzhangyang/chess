import { Chess, Move } from 'chess.js';
import { evaluateBoard } from './chessAIEvaluation';
import { searchState } from './chessAISearchDiagnostics';
import {
  allowNullMovePruning,
  makeNullMove,
  shouldAllowNullMoveByStaticEval,
  shouldApplyReverseFutilityPruning,
} from './chessAISearchHeuristics';
import { type CompactMove } from './chessAIMoveHeuristics';
import { searchPvsMoves } from './chessAIPvsSearch';
import { drawScore, isDraw, MATE_SCORE, quiescence } from './chessAIQuiescence';
import { lookupTT, makeTTKey, storeTT } from './chessAITranspositionTable';
import type { AiTuning } from './chessAITuning';

const TIME_CHECK_MASK = 2047;

let searchDeadline = Infinity;

export const setSearchDeadline = (deadline: number): void => {
  searchDeadline = deadline;
};

export { shouldPruneQCaptureByDelta } from './chessAIQuiescence';

export const minimax = (
  game: Chess,
  depth: number,
  alpha: number,
  beta: number,
  isMaximizingPlayer: boolean,
  color: 'w' | 'b',
  tuning: AiTuning,
  ply = 0,
  allowNullMove = true,
  prevMaxStaticEval?: number,
  prevMinStaticEval?: number,
  previousMove?: CompactMove,
): number => {
  // Periodic time check — only calls performance.now() every 2048 nodes.
  if ((++searchState.nodeCount & TIME_CHECK_MASK) === 0 && performance.now() >= searchDeadline) {
    searchState.searchAborted = true;
  }
  if (searchState.searchAborted) return 0; // Result discarded at root; exit fast.

  // Generate moves once per node
  const rawMoves = game.moves({ verbose: true });

  // Terminal: no legal moves
  if (rawMoves.length === 0) {
    if (game.isCheck()) {
      // Checkmate
      const aiIsMated = game.turn() === color;
      return aiIsMated ? -(MATE_SCORE + depth) : MATE_SCORE + depth;
    }
    // Stalemate
    return drawScore(game, color, tuning);
  }

  // Draw detection (threefold repetition, insufficient material, 50-move rule)
  if (isDraw(game)) {
    return drawScore(game, color, tuning);
  }

  // Compute inCheck here so it's available for both the check extension and
  // the LMR / null-move conditions below (avoids a second isCheck() call).
  const inCheck = game.isCheck();

  if (depth === 0) {
    // Check extension: when in check at the horizon, extend by 1 ply so that
    // all forced evasions are searched at full minimax depth rather than being
    // handed off to quiescence (which only looks at captures/promotions and
    // would miss quiet evasions like a king step).
    // The time-limit and chess.js draw detection bound the recursion depth.
    if (inCheck) {
      return minimax(
        game,
        1,
        alpha,
        beta,
        isMaximizingPlayer,
        color,
        tuning,
        ply,
        allowNullMove,
        prevMaxStaticEval,
        prevMinStaticEval,
        previousMove,
      );
    }
    return quiescence(game, alpha, beta, isMaximizingPlayer, color, tuning);
  }

  // Transposition table lookup
  const ttKey = makeTTKey(game.fen());
  const originalAlpha = alpha;
  const originalBeta = beta;
  const ttEntry = lookupTT(ttKey, depth);
  const ttBestMove = ttEntry?.bestMove ?? 0;
  if (ttEntry?.score !== undefined && ttEntry.flag !== undefined) {
    if (ttEntry.flag === 'exact') return ttEntry.score;
    if (ttEntry.flag === 'lowerbound' && ttEntry.score > alpha) alpha = ttEntry.score;
    if (ttEntry.flag === 'upperbound' && ttEntry.score < beta) beta = ttEntry.score;
    if (beta <= alpha) return ttEntry.score;
  }

  let staticEvalCache: number | undefined;
  const getStaticEval = (): number => {
    if (staticEvalCache === undefined) {
      staticEvalCache = evaluateBoard(game, color, tuning);
    }
    return staticEvalCache;
  };
  const isPvNode = beta - alpha > 1;
  const currentStaticEval = getStaticEval();
  const isImproving = isMaximizingPlayer
    ? (prevMaxStaticEval !== undefined && currentStaticEval > prevMaxStaticEval)
    : (prevMinStaticEval !== undefined && currentStaticEval < prevMinStaticEval);
  const nextPrevMaxStaticEval = isMaximizingPlayer ? currentStaticEval : prevMaxStaticEval;
  const nextPrevMinStaticEval = isMaximizingPlayer ? prevMinStaticEval : currentStaticEval;

  if (shouldApplyReverseFutilityPruning(
    {
      staticEval: currentStaticEval,
      alpha,
      beta,
      depth,
      isMaximizingPlayer,
      inCheck,
      isPvNode,
    },
    tuning,
  )) {
    searchState.rfpPruneCount += 1;
    return getStaticEval();
  }

  // Compute board once: used for null-move endgame check and SEE move ordering.
  const board = game.board();

  // Null-move pruning: if we can exceed beta even without moving, prune.
  // Disabled in endgame to avoid Zugzwang errors (allowNullMovePruning checks both).
  if (
    allowNullMove
    && isMaximizingPlayer
    && depth >= 3
    && !inCheck
    && allowNullMovePruning(board, color)
  ) {
    const staticGuardPasses = !tuning.enableNmpStaticGuard
      || shouldAllowNullMoveByStaticEval(currentStaticEval, beta, tuning);
    if (staticGuardPasses) {
      const R = depth >= 5 ? 3 : 2;
      const nullGame = makeNullMove(game);
      if (nullGame) {
        searchState.nullMoveAttemptCount += 1;
        const nullScore = minimax(
          nullGame,
          depth - 1 - R,
          alpha,
          beta,
          false,
          color,
          tuning,
          ply + 1,
          false,
          nextPrevMaxStaticEval,
          nextPrevMinStaticEval,
          previousMove,
        );
        if (nullScore >= beta) {
          searchState.nullMoveCutCount += 1;
          return beta;
        }
      }
    }
  }

  const { bestMove, bestVal } = searchPvsMoves({
    game,
    rawMoves: rawMoves as Move[],
    board,
    depth,
    alpha,
    beta,
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
    recurse: minimax,
  });

  // Store result in transposition table (depth-preferred replacement is handled inside storeTT).
  let flag: 'exact' | 'lowerbound' | 'upperbound';
  if (bestVal <= originalAlpha) {
    flag = 'upperbound';
  } else if (bestVal >= originalBeta) {
    flag = 'lowerbound';
  } else {
    flag = 'exact';
  }
  storeTT(ttKey, bestVal, depth, flag, bestMove);

  return bestVal;
};

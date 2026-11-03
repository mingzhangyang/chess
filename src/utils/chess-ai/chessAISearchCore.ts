import { Chess } from 'chess.js';
import { generatePseudoLegalMoves, getBoard, hasLegalMove } from './chessAIBoardOps';
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
import {
  denormalizeMateScoreFromTT,
  lookupTT,
  makeTTKey,
  normalizeMateScoreForTT,
  storeTT,
} from './chessAITranspositionTable';
import {
  createRepetitionContext,
  getRepetitionContextKey,
  type RepetitionContext,
} from './chessAIRepetition';
import { checkSearchDeadline } from './chessAISearchTiming';
import type { AiTuning } from './chessAITuning';

const TIME_CHECK_MASK = 255;

const tuningContextKeys = new WeakMap<AiTuning, string>();

const getTuningContextKey = (tuning: AiTuning): string => {
  const cached = tuningContextKeys.get(tuning);
  if (cached) return cached;

  const serialized = JSON.stringify(tuning);
  let hash = 0x811c9dc5;
  for (let i = 0; i < serialized.length; i += 1) {
    hash ^= serialized.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  const key = (hash >>> 0).toString(16);
  tuningContextKeys.set(tuning, key);
  return key;
};

export { setSearchDeadline } from './chessAISearchTiming';

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
  repetitionContext?: RepetitionContext,
): number => {
  // Check at the first node and periodically afterwards. Quiescence performs
  // its own checks because tactical capture trees can dominate node counts.
  ++searchState.nodeCount;
  if ((searchState.nodeCount & TIME_CHECK_MASK) === 1 && checkSearchDeadline()) {
    return 0;
  }
  if (searchState.searchAborted) return 0; // Result discarded at root; exit fast.

  const currentRepetitionContext = repetitionContext ?? createRepetitionContext(game);

  // Compute inCheck here so it's available for both the check extension and
  // the LMR / null-move conditions below (avoids a second isCheck() call).
  const inCheck = game.isCheck();
  const matedScore = (): number => (game.turn() === color ? -(MATE_SCORE - ply) : MATE_SCORE - ply);

  // Draw detection (threefold repetition, insufficient material, 50-move rule).
  // Checkmate still takes precedence over a draw claim.
  if (isDraw(game)) {
    return inCheck && !hasLegalMove(game) ? matedScore() : drawScore(game, color, tuning);
  }

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
        currentRepetitionContext,
      );
    }
    return quiescence(game, alpha, beta, isMaximizingPlayer, color, tuning, ply);
  }

  // Transposition table lookup
  const ttKey = makeTTKey(
    game.fen(),
    `${color}:${getTuningContextKey(tuning)}:${getRepetitionContextKey(currentRepetitionContext)}`,
  );
  const originalAlpha = alpha;
  const originalBeta = beta;
  const ttEntry = lookupTT(ttKey, depth);
  const ttBestMove = ttEntry?.bestMove ?? 0;
  if (ttEntry?.score !== undefined && ttEntry.flag !== undefined) {
    const ttScore = denormalizeMateScoreFromTT(ttEntry.score, ply);
    if (ttEntry.flag === 'exact') return ttScore;
    if (ttEntry.flag === 'lowerbound' && ttScore > alpha) alpha = ttScore;
    if (ttEntry.flag === 'upperbound' && ttScore < beta) beta = ttScore;
    if (beta <= alpha) return ttScore;
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
    // A quiet stalemate would otherwise be returned as a static score by RFP.
    // Check move availability only at a pruning candidate, not at every node.
    if (!hasLegalMove(game)) return drawScore(game, color, tuning);
    searchState.rfpPruneCount += 1;
    return getStaticEval();
  }

  // Compute board once: used for null-move endgame check and SEE move ordering.
  const board = getBoard(game);

  // Null-move pruning: if we can exceed beta even without moving, prune.
  // Disabled in endgame to avoid Zugzwang errors (allowNullMovePruning checks both).
  if (
    allowNullMove
    && isMaximizingPlayer
    && depth >= 3
    && !inCheck
    && allowNullMovePruning(board, color)
    // Moves are generated lazily, so rule out stalemate before passing:
    // a null move from a stalemate could otherwise fail high.
    && hasLegalMove(game)
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
          currentRepetitionContext,
        );
        if (nullScore >= beta) {
          searchState.nullMoveCutCount += 1;
          return beta;
        }
      }
    }
  }

  // Pseudo-legal moves: legality is checked only for the moves actually
  // searched. Checkmate and stalemate show up as zero legal moves below.
  const rawMoves = generatePseudoLegalMoves(game);
  const { bestMove, bestVal, legalMoveCount } = searchPvsMoves({
    game,
    rawMoves,
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
    repetitionContext: currentRepetitionContext,
  });

  if (!searchState.searchAborted && legalMoveCount === 0) {
    return inCheck ? matedScore() : drawScore(game, color, tuning);
  }

  // Store result in transposition table (depth-preferred replacement is handled inside storeTT).
  let flag: 'exact' | 'lowerbound' | 'upperbound';
  if (bestVal <= originalAlpha) {
    flag = 'upperbound';
  } else if (bestVal >= originalBeta) {
    flag = 'lowerbound';
  } else {
    flag = 'exact';
  }
  if (!searchState.searchAborted && bestMove && Number.isFinite(bestVal)) {
    storeTT(ttKey, normalizeMateScoreForTT(bestVal, ply), depth, flag, bestMove);
  }

  return bestVal;
};

import { Chess } from 'chess.js';
import { makeMove, undoMove, type AiMove } from './chessAIBoardOps';
import { searchState } from './chessAISearchDiagnostics';
import type { MinimaxRecurse } from './chessAIPvsSearch';
import type { AiTuning } from './chessAITuning';
import { advanceRepetitionContextWithRights, createRepetitionContext, getCastlingRightsState, type RepetitionContext } from './chessAIRepetition';

const ASPIRATION_DELTA = 50;

export type RootSearchMove = {
  move: AiMove;
  rawScore: number;
};

export type RootSearchDepthParams = {
  game: Chess;
  itMoves: RootSearchMove[];
  depth: number;
  color: 'w' | 'b';
  difficulty: string;
  openingPhase: boolean;
  previousOwnMove?: Pick<AiMove, 'from' | 'to' | 'piece'> | null;
  tuning: AiTuning;
  recurse: MinimaxRecurse;
  /** Repetition context of `game`; computed from its history when omitted. */
  rootRepetitionContext?: RepetitionContext;
};

export type RootSearchDepthResult = {
  completed: boolean;
  scores?: number[];
  /**
   * Set when the clock ran out mid-depth after at least the first (previous
   * best) move was resolved: exact scores for `itMoves[0..length-1]` at this
   * depth. A later move only scores higher by beating the first at this depth.
   */
  partialScores?: number[];
};

/**
 * Write one depth's result into the root move scores. A partial depth keeps
 * only the moves it resolved, since the rest were never checked this deep.
 */
export const applyRootDepthResult = (
  itMoves: RootSearchMove[],
  result: RootSearchDepthResult,
): 'completed' | 'partial' | 'none' => {
  const scores = result.completed ? result.scores : result.partialScores;
  if (!scores || scores.length === 0) return 'none';
  for (let i = 0; i < itMoves.length; i += 1) {
    itMoves[i].rawScore = i < scores.length ? scores[i] : -Infinity;
  }
  return result.completed ? 'completed' : 'partial';
};

const getSelectionBand = (
  difficulty: string,
  openingPhase: boolean,
  tuning: AiTuning,
): number => {
  if (difficulty === 'hard') {
    return openingPhase ? tuning.hardOpeningFallbackBand : tuning.hardBand;
  }
  if (difficulty === 'medium') {
    // Medium adds bounded noise after the search. Include that range when
    // deciding which zero-window upper bounds need an exact re-search.
    return tuning.mediumBand + tuning.mediumNoise;
  }
  return 0;
};

export const searchRootDepth = ({
  game,
  itMoves,
  depth,
  color,
  difficulty,
  openingPhase,
  previousOwnMove,
  tuning,
  recurse,
  rootRepetitionContext: providedRootRepetitionContext,
}: RootSearchDepthParams): RootSearchDepthResult => {
  if (itMoves.length === 0 || searchState.searchAborted) {
    return { completed: false };
  }

  itMoves.sort((a, b) => b.rawScore - a.rawScore);
  const prevBest = itMoves[0].rawScore;
  let lo = depth > 1 ? prevBest - ASPIRATION_DELTA : -Infinity;
  let hi = depth > 1 ? prevBest + ASPIRATION_DELTA : Infinity;
  const selectionBand = getSelectionBand(difficulty, openingPhase, tuning)
    + (previousOwnMove ? tuning.backtrackPenalty : 0);
  const depthScores: number[] = new Array(itMoves.length);
  const rootRepetitionContext = providedRootRepetitionContext ?? createRepetitionContext(game);

  const searchMove = (move: AiMove, alpha: number, beta: number): number => {
    const previousCastlingRights = getCastlingRightsState(game);
    makeMove(game, move);
    const childRepetitionContext = advanceRepetitionContextWithRights(
      rootRepetitionContext,
      move,
      previousCastlingRights,
      getCastlingRightsState(game),
    );
    const score = recurse(
      game,
      depth - 1,
      alpha,
      beta,
      false,
      color,
      tuning,
      0,
      true,
      undefined,
      undefined,
      move,
      childRepetitionContext,
    );
    undoMove(game);
    return score;
  };

  // Moves resolved in the current aspiration pass; a re-search restarts it.
  let resolved = 0;
  const aborted = (): RootSearchDepthResult => (resolved > 0
    ? { completed: false, partialScores: depthScores.slice(0, resolved) }
    : { completed: false });

  retry: for (;;) {
    let bestScore = -Infinity;
    resolved = 0;

    for (let i = 0; i < itMoves.length; i += 1) {
      const { move } = itMoves[i];
      if (i === 0) {
        const score = searchMove(move, lo, hi);
        if (searchState.searchAborted) return aborted();
        if (Number.isFinite(hi) && score >= hi) {
          hi = Infinity;
          continue retry;
        }
        if (score <= lo) {
          lo = -Infinity;
          continue retry;
        }
        depthScores[0] = score;
        bestScore = score;
        resolved = 1;
        continue;
      }

      // Only scores at or above `bestScore - selectionBand` can be picked, so
      // probe that edge with a zero window: an out-of-band move is rejected by
      // this single cheap search. Expert has no band and only needs to know
      // whether a move beats the best one.
      const edgeAlpha = selectionBand > 0 ? bestScore - selectionBand - 1 : bestScore;
      let score = searchMove(move, edgeAlpha, edgeAlpha + 1);
      if (searchState.searchAborted) return aborted();
      if (score <= edgeAlpha) {
        depthScores[i] = -Infinity;
        resolved = i + 1;
        continue;
      }
      if (Number.isFinite(hi) && score >= hi) {
        hi = Infinity;
        continue retry;
      }

      // Selectable (or a new best): resolve its exact score above the edge.
      score = searchMove(move, edgeAlpha, hi);
      if (searchState.searchAborted) return aborted();
      if (Number.isFinite(hi) && score >= hi) {
        hi = Infinity;
        continue retry;
      }
      if (score <= edgeAlpha) {
        // Search instability: the probe failed high but the wider window
        // failed low. Settle it with an unbounded search.
        score = searchMove(move, -Infinity, Infinity);
        if (searchState.searchAborted) return aborted();
      }
      depthScores[i] = score;
      resolved = i + 1;
      if (score > bestScore) bestScore = score;
    }

    return { completed: true, scores: depthScores };
  }
};

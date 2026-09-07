import { Chess, Move } from 'chess.js';
import { searchState } from './chessAISearchDiagnostics';
import type { MinimaxRecurse } from './chessAIPvsSearch';
import { beginSearchTransaction, commitSearchTransaction, discardSearchTransaction } from './chessAISearchTransaction';
import type { AiTuning } from './chessAITuning';
import { advanceRepetitionContext, createRepetitionContext } from './chessAIRepetition';

const ASPIRATION_DELTA = 50;

export type RootSearchMove = {
  move: Move;
  rawScore: number;
};

export type RootSearchDepthParams = {
  game: Chess;
  itMoves: RootSearchMove[];
  depth: number;
  color: 'w' | 'b';
  difficulty: string;
  openingPhase: boolean;
  previousOwnMove?: Move | null;
  tuning: AiTuning;
  recurse: MinimaxRecurse;
};

export type RootSearchDepthResult = {
  completed: boolean;
  scores?: number[];
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
}: RootSearchDepthParams): RootSearchDepthResult => {
  if (itMoves.length === 0 || searchState.searchAborted) {
    return { completed: false };
  }

  beginSearchTransaction();
  let transactionCommitted = false;

  try {
  itMoves.sort((a, b) => b.rawScore - a.rawScore);
  const prevBest = itMoves[0].rawScore;
  let lo = depth > 1 ? prevBest - ASPIRATION_DELTA : -Infinity;
  let hi = depth > 1 ? prevBest + ASPIRATION_DELTA : Infinity;
  const selectionBand = getSelectionBand(difficulty, openingPhase, tuning)
    + (previousOwnMove ? tuning.backtrackPenalty : 0);
  const depthScores: number[] = new Array(itMoves.length);
  const depthScoreExact: boolean[] = new Array(itMoves.length).fill(false);
  const rootRepetitionContext = createRepetitionContext(game);

  const searchMove = (move: Move, alpha: number, beta: number): number => {
    const previousFen = game.fen();
    game.move(move.san);
    const childRepetitionContext = advanceRepetitionContext(
      rootRepetitionContext,
      move,
      previousFen,
      game.fen(),
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
    game.undo();
    return score;
  };

  retry: for (;;) {
    let rootAlpha = lo;

    for (let i = 0; i < itMoves.length; i += 1) {
      const isFirstRootMove = i === 0;
      const probeBeta = isFirstRootMove ? hi : Math.min(hi, rootAlpha + 1);
      let score = searchMove(itMoves[i].move, rootAlpha, probeBeta);

      if (searchState.searchAborted) {
        return { completed: false };
      }
      if (Number.isFinite(hi) && score >= hi) {
        hi = Infinity;
        continue retry;
      }
      if (isFirstRootMove && score <= lo) {
        lo = -Infinity;
        continue retry;
      }

      let scoreIsExact = isFirstRootMove;
      if (!isFirstRootMove && score > rootAlpha && score < hi) {
        // A zero-window fail-high only proves that the move beats alpha. Use
        // a full aspiration window before accepting it as an exact root score.
        score = searchMove(itMoves[i].move, rootAlpha, hi);
        if (searchState.searchAborted) {
          return { completed: false };
        }
        if (Number.isFinite(hi) && score >= hi) {
          hi = Infinity;
          continue retry;
        }
        if (score <= rootAlpha) {
          score = searchMove(itMoves[i].move, -Infinity, Infinity);
          if (searchState.searchAborted) {
            return { completed: false };
          }
        }
        scoreIsExact = true;
      }

      depthScores[i] = score;
      depthScoreExact[i] = scoreIsExact;
      if (score > rootAlpha) rootAlpha = score;

      if (i !== itMoves.length - 1) {
        continue;
      }

      // A zero-window fail-low is an upper bound, not a usable score for
      // band-based move selection. Re-search only bounds that could still be
      // selected; safely discard the rest so they cannot look artificially
      // competitive in the next iteration.
      for (let j = 0; j < itMoves.length; j += 1) {
        if (depthScoreExact[j]) continue;
        if (!(depthScores[j] >= rootAlpha - selectionBand)) {
          depthScores[j] = -Infinity;
          continue;
        }

        depthScores[j] = searchMove(itMoves[j].move, -Infinity, Infinity);
        if (searchState.searchAborted) {
          return { completed: false };
        }
        if (Number.isFinite(hi) && depthScores[j] >= hi) {
          hi = Infinity;
          continue retry;
        }
        depthScoreExact[j] = true;
      }

      if (!commitSearchTransaction()) {
        return { completed: false };
      }
      transactionCommitted = true;
      return { completed: true, scores: depthScores };
    }
  }
  } finally {
    if (!transactionCommitted) {
      discardSearchTransaction();
    }
  }
};

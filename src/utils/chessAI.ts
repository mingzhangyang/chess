import { Chess, Move } from 'chess.js';
import { evaluateBoard, getGamePhase } from './chess-ai/chessAIEvaluation';
import { commitSearchDiagnostics, resetSearchCounters, searchState } from './chess-ai/chessAISearchDiagnostics';
import { DEFAULT_AI_TUNING, type AiStyle, type AiTuning } from './chess-ai/chessAITuning';
import { clearTranspositionTable } from './chess-ai/chessAITranspositionTable';
import { getCommittedOpeningMove, getOpeningBookMove, resetOpeningState, selectCommittedLine } from './chess-ai/chessAIOpeningRuntime';
import { orderMoves, scoreMoveForOrdering } from './chess-ai/chessAIMoveOrdering';
import { minimax, setSearchDeadline } from './chess-ai/chessAISearchCore';
import {
  clearCountermoves,
  clearHistory,
  clearKillers,
  getHistoryScore,
  type CompactMove,
} from './chess-ai/chessAIMoveHeuristics';

export type { AiStyle, AiTuning } from './chess-ai/chessAITuning';
export type { SearchDiagnostics } from './chess-ai/chessAISearchDiagnostics';
export { getLastSearchDiagnostics } from './chess-ai/chessAISearchDiagnostics';
export { DEFAULT_AI_TUNING } from './chess-ai/chessAITuning';
export { TT_BYTES, clearTranspositionTable, initSharedTranspositionTable } from './chess-ai/chessAITranspositionTable';
export { resetOpeningState } from './chess-ai/chessAIOpeningRuntime';
export {
  getLmrReduction,
  shouldAllowNullMoveByStaticEval,
  shouldApplyReverseFutilityPruning,
  shouldPruneMoveByFutility,
  shouldPruneMoveByLmp,
} from './chess-ai/chessAISearchHeuristics';
export { shouldPruneQCaptureByDelta } from './chess-ai/chessAISearchCore';
export {
  applyHistoryBonus,
  applyHistoryMalus,
  clearCountermoves,
  clearHistory,
  getCountermoveScore,
  getHistoryScoreForMove,
  recordCountermove,
} from './chess-ai/chessAIMoveHeuristics';

let activeAiTuning: AiTuning = { ...DEFAULT_AI_TUNING };
const clampToMin = (value: number, min: number): number => (value < min ? min : value);
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const sanitizeAiTuning = (candidate: AiTuning): AiTuning => {
  const safeNumber = (value: number, fallback: number, min: number): number =>
    Number.isFinite(value) ? clampToMin(value, min) : fallback;

  const normalized: AiTuning = {
    backtrackPenalty: safeNumber(candidate.backtrackPenalty, DEFAULT_AI_TUNING.backtrackPenalty, 0),
    openingBookEnabled: Boolean(candidate.openingBookEnabled),
    openingBookMaxPly: Math.floor(safeNumber(candidate.openingBookMaxPly, DEFAULT_AI_TUNING.openingBookMaxPly, 0)),
    hardBand: safeNumber(candidate.hardBand, DEFAULT_AI_TUNING.hardBand, 1),
    hardOpeningBand: safeNumber(candidate.hardOpeningBand, DEFAULT_AI_TUNING.hardOpeningBand, 1),
    hardOpeningFallbackBand: safeNumber(
      candidate.hardOpeningFallbackBand,
      DEFAULT_AI_TUNING.hardOpeningFallbackBand,
      1,
    ),
    hardCandidateCap: Math.floor(safeNumber(candidate.hardCandidateCap, DEFAULT_AI_TUNING.hardCandidateCap, 1)),
    mediumBand: safeNumber(candidate.mediumBand, DEFAULT_AI_TUNING.mediumBand, 1),
    mediumNoise: safeNumber(candidate.mediumNoise, DEFAULT_AI_TUNING.mediumNoise, 0),
    aiStyle: (['aggressive', 'defensive', 'balanced'] as AiStyle[]).includes(candidate.aiStyle)
      ? candidate.aiStyle
      : DEFAULT_AI_TUNING.aiStyle,
    enableNmpStaticGuard: Boolean(candidate.enableNmpStaticGuard),
    nmpStaticGuardMargin: safeNumber(candidate.nmpStaticGuardMargin, DEFAULT_AI_TUNING.nmpStaticGuardMargin, 0),
    enableQDelta: Boolean(candidate.enableQDelta),
    qDeltaMargin: safeNumber(candidate.qDeltaMargin, DEFAULT_AI_TUNING.qDeltaMargin, 0),
    enableRfp: Boolean(candidate.enableRfp),
    rfpDepthLimit: Math.floor(safeNumber(candidate.rfpDepthLimit, DEFAULT_AI_TUNING.rfpDepthLimit, 1)),
    rfpMarginBase: safeNumber(candidate.rfpMarginBase, DEFAULT_AI_TUNING.rfpMarginBase, 0),
    rfpMarginPerDepth: safeNumber(candidate.rfpMarginPerDepth, DEFAULT_AI_TUNING.rfpMarginPerDepth, 0),
    enableFp: Boolean(candidate.enableFp),
    fpDepthLimit: Math.floor(safeNumber(candidate.fpDepthLimit, DEFAULT_AI_TUNING.fpDepthLimit, 1)),
    fpMarginBase: safeNumber(candidate.fpMarginBase, DEFAULT_AI_TUNING.fpMarginBase, 0),
    fpMarginPerDepth: safeNumber(candidate.fpMarginPerDepth, DEFAULT_AI_TUNING.fpMarginPerDepth, 0),
    enableLmp: Boolean(candidate.enableLmp),
    lmpDepthLimit: Math.floor(safeNumber(candidate.lmpDepthLimit, DEFAULT_AI_TUNING.lmpDepthLimit, 1)),
    lmpMoveCountBase: Math.floor(safeNumber(candidate.lmpMoveCountBase, DEFAULT_AI_TUNING.lmpMoveCountBase, 1)),
    lmpMoveCountPerDepth: Math.floor(
      safeNumber(candidate.lmpMoveCountPerDepth, DEFAULT_AI_TUNING.lmpMoveCountPerDepth, 0),
    ),
    lmpEvalMarginBase: safeNumber(candidate.lmpEvalMarginBase, DEFAULT_AI_TUNING.lmpEvalMarginBase, 0),
    lmpEvalMarginPerDepth: safeNumber(
      candidate.lmpEvalMarginPerDepth,
      DEFAULT_AI_TUNING.lmpEvalMarginPerDepth,
      0,
    ),
    enableLmrTable: Boolean(candidate.enableLmrTable),
    enableHistoryMalus: Boolean(candidate.enableHistoryMalus),
    enableCountermove: Boolean(candidate.enableCountermove),
    enableTaperedEval: Boolean(candidate.enableTaperedEval),
    enableNonlinearKingSafety: Boolean(candidate.enableNonlinearKingSafety),
    enableBackwardPawn: Boolean(candidate.enableBackwardPawn),
    enableKnightOutpost: Boolean(candidate.enableKnightOutpost),
    enablePassedPawnKingDistance: Boolean(candidate.enablePassedPawnKingDistance),
    enableRookBehindPassedPawn: Boolean(candidate.enableRookBehindPassedPawn),
    enableTempoBonus: Boolean(candidate.enableTempoBonus),
  };

  if (normalized.hardOpeningFallbackBand < normalized.hardOpeningBand) {
    normalized.hardOpeningFallbackBand = normalized.hardOpeningBand;
  }

  return normalized;
};

const resolveAiTuning = (overrides?: Partial<AiTuning>): AiTuning => {
  if (!overrides || Object.keys(overrides).length === 0) {
    return activeAiTuning;
  }
  return sanitizeAiTuning({
    ...activeAiTuning,
    ...overrides,
  });
};

export const getAiTuning = (): AiTuning => ({ ...activeAiTuning });

export const setAiTuning = (overrides: Partial<AiTuning>): AiTuning => {
  activeAiTuning = sanitizeAiTuning({
    ...activeAiTuning,
    ...overrides,
  });
  return getAiTuning();
};

export const resetAiTuning = (): AiTuning => {
  activeAiTuning = { ...DEFAULT_AI_TUNING };
  resetOpeningState();
  clearTranspositionTable();
  clearHistory();
  clearCountermoves();
  return getAiTuning();
};

export const evaluateBoardForTesting = (
  game: Chess,
  color: 'w' | 'b',
  overrides?: Partial<AiTuning>,
): number => evaluateBoard(game, color, resolveAiTuning(overrides));

export const getGamePhaseForTesting = (game: Chess): number => getGamePhase(game);

// --- Time Management ---
const DEFAULT_TIME_LIMITS_MS: Record<string, number> = {
  medium: 300,
  hard: 1500,
  expert: 3000,
};
const MAX_SEARCH_DEPTH = 20; // Hard cap; the time limit is the real constraint.
const getLastMoveByColor = (game: Chess, color: 'w' | 'b'): Move | null => {
  const history = game.history({ verbose: true }) as Move[];
  for (let i = history.length - 1; i >= 0; i -= 1) {
    if (history[i].color === color) {
      return history[i];
    }
  }
  return null;
};

const isImmediateBacktrack = (move: Move, previousMove: Move | null): boolean => {
  if (!previousMove) {
    return false;
  }

  return move.from === previousMove.to
    && move.to === previousMove.from
    && move.piece === previousMove.piece;
};

const pickMoveFromTopBand = (
  scoredMoves: Array<{ move: Move; score: number }>,
  difficulty: string,
  openingPhase: boolean,
  tuning: AiTuning,
): Move => {
  scoredMoves.sort((a, b) => b.score - a.score);
  const bestScore = scoredMoves[0].score;
  const band = difficulty === 'hard'
    ? (openingPhase ? tuning.hardOpeningBand : tuning.hardBand)
    : tuning.mediumBand;
  let topBandMoves = scoredMoves.filter(({ score }) => score >= bestScore - band);

  if (difficulty === 'hard' && openingPhase && topBandMoves.length === 1 && scoredMoves.length > 1) {
    const fallbackPool = scoredMoves
      .filter(({ score }) => score >= bestScore - tuning.hardOpeningFallbackBand)
      .slice(0, 4);
    if (fallbackPool.length > 1) {
      topBandMoves = fallbackPool;
    }
  }

  if (topBandMoves.length === 1) {
    return topBandMoves[0].move;
  }

  if (difficulty === 'medium') {
    const weightedPool = topBandMoves
      .map((candidate, index) => ({
        candidate,
        weight: Math.max(1, topBandMoves.length - index),
      }));

    const totalWeight = weightedPool.reduce((sum, entry) => sum + entry.weight, 0);
    let threshold = Math.random() * totalWeight;
    for (let i = 0; i < weightedPool.length; i += 1) {
      threshold -= weightedPool[i].weight;
      if (threshold <= 0) {
        return weightedPool[i].candidate.move;
      }
    }
    return weightedPool[weightedPool.length - 1].candidate.move;
  }

  const cappedCandidates = topBandMoves.slice(0, Math.min(topBandMoves.length, tuning.hardCandidateCap));
  const index = Math.floor(Math.random() * cappedCandidates.length);
  return cappedCandidates[index].move;
};

export const getBestMove = (game: Chess, difficulty: string, overrides?: Partial<AiTuning>, timeLimitMs?: number): string | null => {
  const tuning = resolveAiTuning(overrides);
  clearKillers();
  searchState.searchAborted = false;
  resetSearchCounters();

  const moves = orderMoves(game.moves({ verbose: true }) as Move[], game.board());
  if (moves.length === 0) {
    commitSearchDiagnostics(0);
    return null;
  }

  if (difficulty === 'easy') {
    const randomIndex = Math.floor(Math.random() * moves.length);
    commitSearchDiagnostics(0);
    return moves[randomIndex].san;
  }

  const plyCount = game.history().length;
  // Clear history at the very start of each game (plyCount ≤ 1 covers both AI colours).
  if (plyCount <= 1) {
    clearHistory();
    clearCountermoves();
  }
  const color = game.turn();

  if (difficulty === 'hard' || difficulty === 'expert') {
    // Reset and pick a new committed opening line at the start of each game.
    const aiMovesMade = color === 'w' ? Math.floor(plyCount / 2) : Math.floor((plyCount - 1) / 2);
    if (aiMovesMade === 0) {
      selectCommittedLine(color);
    }

    // Follow the committed line if no threat detected
    const committedMove = getCommittedOpeningMove(game, color, plyCount);
    if (committedMove) {
      commitSearchDiagnostics(0);
      return committedMove;
    }

    // Fall back to general opening book
    const openingBookMove = getOpeningBookMove(game, tuning);
    if (openingBookMove) {
      commitSearchDiagnostics(0);
      return openingBookMove;
    }
  }
  if (difficulty === 'medium') {
    const openingBookMove = getOpeningBookMove(game, tuning);
    if (openingBookMove) {
      commitSearchDiagnostics(0);
      return openingBookMove;
    }
  }
  // Time-managed iterative deepening: search from depth 1 upward until the
  // time budget runs out. Scores from the last *completed* depth are always
  // preserved, so an aborted depth never corrupts the result.
  const effectiveTimeLimit = timeLimitMs ?? DEFAULT_TIME_LIMITS_MS[difficulty] ?? 1000;
  const searchDeadline = effectiveTimeLimit > 0 ? performance.now() + effectiveTimeLimit : Infinity;
  setSearchDeadline(searchDeadline);

  const previousOwnMove = getLastMoveByColor(game, color);
  const openingPhase = plyCount < 8;
  let completedDepth = 0;

  // Iterative deepening with aspiration windows.
  const ASPIRATION_DELTA = 50;
  const itMoves: Array<{ move: Move; rawScore: number }> = moves.map((m) => ({
    move: m,
    rawScore: scoreMoveForOrdering(m) + getHistoryScore(m), // seed: captures/promotions + history
  }));

  for (let d = 1; d <= MAX_SEARCH_DEPTH; d++) {
    // Don't start a new depth if the time budget is already spent.
    if (d > 1 && performance.now() >= searchDeadline) break;

    itMoves.sort((a, b) => b.rawScore - a.rawScore);
    const prevBest = itMoves[0].rawScore;
    let lo = d > 1 ? prevBest - ASPIRATION_DELTA : -Infinity;
    let hi = d > 1 ? prevBest + ASPIRATION_DELTA : Infinity;

    // depthScores is a fixed-size parallel buffer; only committed to itMoves
    // when ALL moves have been scored without a window failure.
    const depthScores: number[] = new Array(itMoves.length);
    let committed = false;

    retry: for (;;) {
      let rootAlpha = lo;

      for (let i = 0; i < itMoves.length; i++) {
        game.move(itMoves[i].move.san);
        const v = minimax(game, d - 1, rootAlpha, hi, false, color, tuning, 0, true, undefined, undefined, itMoves[i].move);
        game.undo();

        if (searchState.searchAborted) break retry;                             // abort — never commit
        if (v >= hi)            { hi = Infinity;  break; }                      // fail-high: widen hi, retry
        if (i === 0 && v <= lo) { lo = -Infinity; break; }                      // fail-low on best: widen lo, retry

        depthScores[i] = v;
        if (v > rootAlpha) rootAlpha = v;

        if (i === itMoves.length - 1) { committed = true; break retry; }       // all moves scored — done
      }
      // Loop continues with widened window (lo or hi updated above).
    }

    if (committed) {
      for (let i = 0; i < itMoves.length; i++) itMoves[i].rawScore = depthScores[i];
      completedDepth = d;
    }

    // Abort mid-depth: itMoves still holds the last *completed* depth's scores.
    if (searchState.searchAborted) break;
  }

  // Clean up for subsequent calls.
  commitSearchDiagnostics(completedDepth);
  searchState.searchAborted = false;

  // Apply once-only adjustments then select via band picker.
  const scoredMoves = itMoves.map(({ move, rawScore }) => {
    let score = rawScore;
    if (isImmediateBacktrack(move, previousOwnMove) && !move.isCapture() && !move.isPromotion()) {
      score -= tuning.backtrackPenalty;
    }
    if (difficulty === 'medium') {
      score += Math.random() * tuning.mediumNoise;
    }
    return { move, score };
  });

  const selectedMove = pickMoveFromTopBand(scoredMoves, difficulty, openingPhase, tuning);
  return selectedMove?.san ?? moves[0].san;
};

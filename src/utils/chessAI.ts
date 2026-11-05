import { Chess, Move } from 'chess.js';
import { TS_DEPTH_COMPLETION_FACTOR, TS_MIN_DEPTH_GRACE_MS, TS_SEARCH_TIME_MS } from './aiWorkerPolicy';
import { evaluateBoard, getGamePhase } from './chess-ai/chessAIEvaluation';
import { commitSearchDiagnostics, resetSearchCounters, searchState } from './chess-ai/chessAISearchDiagnostics';
import { DEFAULT_AI_TUNING, type AiStyle, type AiTuning } from './chess-ai/chessAITuning';
import { clearTranspositionTable } from './chess-ai/chessAITranspositionTable';
import { getCommittedOpeningMove, getOpeningBookMove, resetOpeningState, selectCommittedLine } from './chess-ai/chessAIOpeningRuntime';
import { orderMoves, scoreMoveForOrdering } from './chess-ai/chessAIMoveOrdering';
import { pickEasyMove } from './chess-ai/chessAIEasy';
import { generateMoves, moveToSan, type AiMove } from './chess-ai/chessAIBoardOps';
import { createRepetitionContext } from './chess-ai/chessAIRepetition';
import { minimax, setSearchDeadline } from './chess-ai/chessAISearchCore';
import { applyRootDepthResult, getBacktrackPenalty, searchRootDepth } from './chess-ai/chessAIRootSearch';
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
const MAX_SEARCH_TIME_LIMIT_MS = 20_000;
export const SEARCH_FINALIZATION_RESERVE_MS = 25;
export const resolveSearchTimeLimit = (difficulty: string, requested?: number): number => {
  const fallback = TS_SEARCH_TIME_MS[difficulty] ?? 1000;
  if (typeof requested !== 'number' || !Number.isFinite(requested) || requested <= 0) {
    return fallback;
  }
  return Math.min(MAX_SEARCH_TIME_LIMIT_MS, Math.max(1, Math.floor(requested)));
};
/**
 * softMs: no new depth starts after it. hardMs: the depth in progress is
 * aborted at it. A default budget may overrun to finish the current depth;
 * an explicit caller limit (e.g. the Stockfish fallback) is a hard limit.
 */
export const resolveSearchDeadlinesMs = (
  difficulty: string,
  requested?: number,
): { softMs: number; hardMs: number } => {
  const softMs = resolveSearchTimeLimit(difficulty, requested);
  const isExplicit = typeof requested === 'number' && Number.isFinite(requested) && requested > 0;
  return { softMs, hardMs: isExplicit ? softMs : softMs * TS_DEPTH_COMPLETION_FACTOR };
};
export const resolveSearchBudgetMs = (timeLimitMs: number): number => {
  if (!Number.isFinite(timeLimitMs)) return 1;
  return Math.max(1, Math.floor(timeLimitMs) - SEARCH_FINALIZATION_RESERVE_MS);
};
const MAX_SEARCH_DEPTH = 20; // Hard cap; the time limit is the real constraint.
// Depth 1 (every root move followed by a capture search) is what lets the AI
// notice that the piece it just moved can simply be taken. If the clock cut it
// short, move selection fell back to raw capture ordering, where "queen takes
// anything" ranks first. Always finish it, within a generous safety cap.
const MIN_COMPLETED_DEPTH = 1;
const MIN_DEPTH_GRACE_MS = TS_MIN_DEPTH_GRACE_MS;
const getLastMoveByColor = (game: Chess, color: 'w' | 'b'): Move | null => {
  const history = game.history({ verbose: true }) as Move[];
  for (let i = history.length - 1; i >= 0; i -= 1) {
    if (history[i].color === color) {
      return history[i];
    }
  }
  return null;
};

export const hasStandardOpeningProvenance = (game: Chess): boolean => {
  const history = game.history({ verbose: true }) as Move[];
  const replay = new Chess();
  try {
    for (const move of history) {
      replay.move({ from: move.from, to: move.to, promotion: move.promotion });
    }
  } catch {
    return false;
  }
  return replay.fen() === game.fen();
};

const pickMoveFromTopBand = (
  scoredMoves: Array<{ move: AiMove; score: number }>,
  difficulty: string,
  openingPhase: boolean,
  tuning: AiTuning,
): AiMove => {
  scoredMoves.sort((a, b) => b.score - a.score);
  if (difficulty === 'expert') {
    return scoredMoves[0].move;
  }

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

  if (game.isGameOver()) {
    commitSearchDiagnostics(0);
    return null;
  }

  const rootBoard = game.board();
  const moves = orderMoves(generateMoves(game), rootBoard);
  if (moves.length === 0) {
    commitSearchDiagnostics(0);
    return null;
  }

  if (difficulty === 'easy') {
    const selectedMove = pickEasyMove(game, moves);
    commitSearchDiagnostics(0);
    return moveToSan(game, selectedMove);
  }

  const plyCount = game.history().length;
  // Clear history at the very start of each game (plyCount ≤ 1 covers both AI colours).
  if (plyCount <= 1) {
    clearHistory();
    clearCountermoves();
  }
  const color = game.turn();
  const openingProvenance = hasStandardOpeningProvenance(game);

  if (difficulty === 'hard' && tuning.openingBookEnabled && openingProvenance) {
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
  } else if (difficulty === 'hard') {
    // Do not keep a stale committed line around if opening variety is disabled
    // or later re-enabled mid-game.
    resetOpeningState();
  }
  if (difficulty === 'medium' && tuning.openingBookEnabled && openingProvenance) {
    const openingBookMove = getOpeningBookMove(game, tuning);
    if (openingBookMove) {
      commitSearchDiagnostics(0);
      return openingBookMove;
    }
  }
  // Time-managed iterative deepening: search from depth 1 upward until the
  // time budget runs out, then let the depth in progress finish (bounded).
  // An aborted depth never corrupts the result: only completed depths, or a
  // partial depth that re-resolved the previous best move, are used.
  const { softMs, hardMs } = resolveSearchDeadlinesMs(difficulty, timeLimitMs);
  const searchStartedAt = performance.now();
  // No new depth starts after searchDeadline; the depth in progress may run
  // on until depthCompletionDeadline (partial results are used past that).
  const searchDeadline = searchStartedAt + resolveSearchBudgetMs(softMs);
  const depthCompletionDeadline = searchStartedAt + resolveSearchBudgetMs(hardMs);
  const minDepthDeadline = Math.max(depthCompletionDeadline, searchStartedAt + MIN_DEPTH_GRACE_MS);

  const previousOwnMove = getLastMoveByColor(game, color);
  const openingPhase = plyCount < 8;
  let completedDepth = 0;
  let partialDepth = 0;

  // Iterative deepening with aspiration windows.
  // Seed ordering: SEE-aware captures/promotions + history.
  const itMoves: Array<{ move: AiMove; rawScore: number }> = moves.map((m) => ({
    move: m,
    rawScore: scoreMoveForOrdering(m, rootBoard) + getHistoryScore(m),
  }));
  const rootRepetitionContext = createRepetitionContext(game);

  for (let d = 1; d <= MAX_SEARCH_DEPTH; d++) {
    // Don't start a new depth if the time budget is already spent.
    if (d > MIN_COMPLETED_DEPTH && performance.now() >= searchDeadline) break;
    setSearchDeadline(d <= MIN_COMPLETED_DEPTH ? minDepthDeadline : depthCompletionDeadline);

    const depthResult = searchRootDepth({
      game,
      itMoves,
      depth: d,
      color,
      difficulty,
      openingPhase,
      previousOwnMove,
      tuning,
      recurse: minimax,
      rootRepetitionContext,
    });

    // An aborted depth still counts once it re-resolved the previous best
    // move: the moves it finished are compared one ply deeper. Otherwise
    // itMoves keeps the last completed depth's scores.
    const applied = applyRootDepthResult(itMoves, depthResult);
    if (applied === 'completed') completedDepth = d;
    if (applied === 'partial') partialDepth = d;

    if (searchState.searchAborted) break;
  }

  // Clean up for subsequent calls.
  commitSearchDiagnostics(completedDepth, partialDepth);
  searchState.searchAborted = false;

  // Apply once-only adjustments then select via band picker.
  const scoredMoves = itMoves.map(({ move, rawScore }) => {
    let score = rawScore - getBacktrackPenalty(move, previousOwnMove, tuning);
    if (difficulty === 'medium') {
      score += Math.random() * tuning.mediumNoise;
    }
    return { move, score };
  });

  const selectedMove = pickMoveFromTopBand(scoredMoves, difficulty, openingPhase, tuning);
  return moveToSan(game, selectedMove ?? moves[0]);
};

/** Internal comparison entry point. The production worker never imports this module. */
import { Chess, type PieceSymbol, type Square } from 'chess.js';
import { backtrackPenalty, runKernelSearch, type PreviousOwnMove } from './independent/kernelSearch';
import { MAX_MOVES, moveCodeToUci } from './independent/moveCode';
import type { EngineAdapterComputeInput } from '../../workers/engineAdapter';
import { createGameFromInput } from '../../workers/tsEngineAdapter';
import { TS_MIN_DEPTH_GRACE_MS } from '../aiWorkerPolicy';
import { getLastMoveByColor, pickMoveFromTopBand, resolveAiTuning, resolveSearchBudgetMs, resolveSearchDeadlinesMs } from '../chessAI';
import { generateMoves, getBoard, hasLegalMove, moveToSan, searchTurn, type AiMove, type SearchGame } from './chessAIBoardOps';
import { clearCountermoves, clearHistory, clearKillers, getHistoryScore } from './chessAIMoveHeuristics';
import { orderMoves, scoreMoveForOrdering } from './chessAIMoveOrdering';
import { isDraw } from './chessAIQuiescence';
import { createRepetitionContext } from './chessAIRepetition';
import { applyRootDepthResult, getBacktrackPenalty, searchRootDepth } from './chessAIRootSearch';
import { minimax, setSearchDeadline } from './chessAISearchCore';
import { commitSearchDiagnostics, getLastSearchDiagnostics, resetSearchCounters, searchState } from './chessAISearchDiagnostics';
import { setSearchCancellationCheck } from './chessAISearchTiming';
import { clearTranspositionTable } from './chessAITranspositionTable';
import { IndependentTranspositionTable, setIndependentTable } from './independentTranspositionTable';
import { SearchPosition, squareFromAlgebraic, type SearchMove } from './searchPosition';

const independentPositionFromValidated = (input: EngineAdapterComputeInput, validated: Chess): SearchPosition => {
  const standard = new Chess().fen();
  const start = input.historyStartFen ?? standard;
  const moves: SearchMove[] = (input.history ?? []).map((uci) => ({
    from: squareFromAlgebraic(uci.slice(0, 2)),
    to: squareFromAlgebraic(uci.slice(2, 4)),
    ...(uci.length === 5 ? { promotion: uci[4] as SearchMove['promotion'] } : {}),
  }));
  // A custom start FEN does not prove anything about positions before it.
  // Require an explicit completeness assertion unless it is the standard start.
  const historyComplete = input.historyTruncated !== true && (input.history === undefined
    ? input.fen === 'start'
    : (start === standard || input.historyTruncated === false));
  if (input.history === undefined) return new SearchPosition(validated.fen(), { historyComplete });
  return SearchPosition.fromHistory(start, moves, { historyComplete, expectedFen: validated.fen() });
};

/** Validate every historical move and the final FEN once at the boundary. */
export const createIndependentPosition = (input: EngineAdapterComputeInput): SearchPosition =>
  independentPositionFromValidated(input, createGameFromInput(input));

export type ComparisonOptions = {
  /**
   * legacy: chess.js through the shared search modules (production search).
   * reference: SearchPosition through the same shared modules, frozen as the
   * differential reference for the kernel. independent: SearchPosition with
   * the kernel's own integer-move search (independent/kernelSearch.ts).
   */
  backend: 'legacy' | 'reference' | 'independent';
  input: EngineAdapterComputeInput;
  /** Cap iterative deepening; omit for a fixed-time search. */
  maxDepth?: number;
  timeLimitMs?: number;
  random?: () => number;
  shouldAbort?: () => boolean;
  /** Inspect restoration and inject failures in tests. */
  onPosition?: (position: SearchPosition) => void;
};

const uci = (move: AiMove): string => `${move.from}${move.to}${move.promotion ?? ''}`;
const resetHeuristics = (): void => { clearKillers(); clearHistory(); clearCountermoves(); };

/**
 * Runs the same root/PVS/heuristics for each backend. Opening books are omitted
 * so this measures search. A stable UCI tie order and isolated state make fixed
 * depth runs reproducible; normal production selection is unchanged.
 */
export const searchForComparison = (options: ComparisonOptions) => {
  if (options.backend === 'independent') return searchIndependentKernel(options);
  const { input } = options;
  if (!['medium', 'hard', 'expert'].includes(input.difficulty)) throw new Error('comparison supports medium, hard and expert only');
  const root = createGameFromInput(input);
  const game: SearchGame = options.backend === 'reference' ? independentPositionFromValidated(input, root) : root;
  const checkpoint = game instanceof SearchPosition ? game.checkpoint() : 0;
  const tuning = Object.freeze({ ...resolveAiTuning({ ...input.tuning, openingBookEnabled: false }) });
  const color = searchTurn(game);
  const random = options.random ?? (() => 0);
  const maxDepth = Math.min(20, Math.max(1, Math.floor(options.maxDepth ?? 20)));
  let completedDepth = 0; let partialDepth = 0;
  let selected: AiMove | undefined;
  let selectedScore: number | null = null;
  resetHeuristics(); clearTranspositionTable(); resetSearchCounters(); searchState.searchAborted = false;
  setSearchCancellationCheck(options.shouldAbort);
  setIndependentTable(options.backend === 'reference' ? new IndependentTranspositionTable(color, tuning) : undefined);
  try {
    if (game instanceof SearchPosition) options.onPosition?.(game);
    if (!isDraw(game) && hasLegalMove(game)) {
      const board = getBoard(game);
      const moves = orderMoves(generateMoves(game).sort((a, b) => uci(a).localeCompare(uci(b))), board);
      const itMoves = moves.map((move) => ({ move, rawScore: scoreMoveForOrdering(move, board) + getHistoryScore(move) }));
      const previousOwnMove = getLastMoveByColor(root, color);
      const openingPhase = root.history().length < 8;
      const context = createRepetitionContext(game);
      const { softMs, hardMs } = resolveSearchDeadlinesMs(input.difficulty, options.timeLimitMs ?? input.timeLimitMs);
      const start = performance.now();
      const soft = start + resolveSearchBudgetMs(softMs);
      const hard = start + resolveSearchBudgetMs(hardMs);
      const firstDepth = Math.max(hard, start + TS_MIN_DEPTH_GRACE_MS);
      for (let depth = 1; depth <= maxDepth; depth += 1) {
        if (depth > 1 && performance.now() >= soft) break;
        setSearchDeadline(depth === 1 ? firstDepth : hard);
        const result = searchRootDepth({ game, itMoves, depth, color, difficulty: input.difficulty,
          openingPhase, previousOwnMove, tuning, recurse: minimax, rootRepetitionContext: context });
        const applied = applyRootDepthResult(itMoves, result);
        if (applied === 'completed') completedDepth = depth;
        if (applied === 'partial') partialDepth = depth;
        if (searchState.searchAborted) break;
      }
      const scored = itMoves.map(({ move, rawScore }) => ({
        move, score: rawScore - getBacktrackPenalty(move, previousOwnMove, tuning)
          + (input.difficulty === 'medium' ? random() * tuning.mediumNoise : 0),
      }));
      selected = pickMoveFromTopBand(scored, input.difficulty, openingPhase, tuning, random);
      selectedScore = scored.find((entry) => entry.move === selected)?.score ?? null;
    }
    commitSearchDiagnostics(completedDepth, partialDepth);
    const diagnostics = getLastSearchDiagnostics();
    const move = selected ? moveToSan(root, selected) : null;
    if (selected && move === null) throw new Error('independent search returned an illegal root move');
    return { move, uci: selected ? uci(selected) : null, score: selectedScore,
      completedDepth, partialDepth, diagnostics,
      repetitionStatus: game instanceof SearchPosition ? game.repetitionStatus : undefined };
  } finally {
    if (game instanceof SearchPosition) game.restore(checkpoint);
    setIndependentTable(); setSearchCancellationCheck(); setSearchDeadline(Infinity);
    searchState.searchAborted = false;
    resetHeuristics(); clearTranspositionTable();
  }
};

const PIECE_TYPES = ' pnbrqk';

/** The `independent` backend: the same boundary, root selection and diagnostics around the kernel search. */
const searchIndependentKernel = (options: ComparisonOptions) => {
  const { input } = options;
  if (!['medium', 'hard', 'expert'].includes(input.difficulty)) throw new Error('comparison supports medium, hard and expert only');
  const root = createGameFromInput(input);
  const position = independentPositionFromValidated(input, root);
  const checkpoint = position.checkpoint();
  const tuning = Object.freeze({ ...resolveAiTuning({ ...input.tuning, openingBookEnabled: false }) });
  const color = position.turn;
  const random = options.random ?? (() => 0);
  const maxDepth = Math.min(20, Math.max(1, Math.floor(options.maxDepth ?? 20)));
  let completedDepth = 0; let partialDepth = 0;
  let selected: number | undefined;
  let selectedScore: number | null = null;
  resetSearchCounters(); searchState.searchAborted = false;
  setSearchCancellationCheck(options.shouldAbort);
  try {
    options.onPosition?.(position);
    const isDrawn = position.repetitionCount >= 3 || position.isInsufficientMaterial() || position.drawHalfmoveClock >= 100;
    if (!isDrawn && position.hasLegalMove()) {
      const buffer = new Int32Array(MAX_MOVES);
      const rootOrder = Array.from(buffer.subarray(0, position.generateMoveCodes(buffer)))
        .map((move) => ({ move, uci: moveCodeToUci(move) }))
        .sort((a, b) => a.uci.localeCompare(b.uci)).map(({ move }) => move);
      const previous = getLastMoveByColor(root, color);
      const previousOwnMove: PreviousOwnMove | null = previous ? { from: squareFromAlgebraic(previous.from),
        to: squareFromAlgebraic(previous.to), piece: PIECE_TYPES.indexOf(previous.piece) } : null;
      const openingPhase = root.history().length < 8;
      const { softMs, hardMs } = resolveSearchDeadlinesMs(input.difficulty, options.timeLimitMs ?? input.timeLimitMs);
      const start = performance.now();
      const hardDeadline = start + resolveSearchBudgetMs(hardMs);
      const result = runKernelSearch(position, rootOrder, { color, tuning, difficulty: input.difficulty, maxDepth,
        openingPhase, previousOwnMove, softDeadline: start + resolveSearchBudgetMs(softMs), hardDeadline,
        firstDepthDeadline: Math.max(hardDeadline, start + TS_MIN_DEPTH_GRACE_MS) });
      ({ completedDepth, partialDepth } = result);
      const scored = result.rootMoves.map(({ move, rawScore }) => ({
        move, score: rawScore - backtrackPenalty(move, previousOwnMove, tuning)
          + (input.difficulty === 'medium' ? random() * tuning.mediumNoise : 0),
      }));
      selected = pickMoveFromTopBand(scored, input.difficulty, openingPhase, tuning, random);
      selectedScore = scored.find((entry) => entry.move === selected)?.score ?? null;
    }
    commitSearchDiagnostics(completedDepth, partialDepth);
    const diagnostics = getLastSearchDiagnostics();
    const selectedUci = selected === undefined ? null : moveCodeToUci(selected);
    const move = selectedUci ? moveToSan(root, { from: selectedUci.slice(0, 2) as Square, to: selectedUci.slice(2, 4) as Square,
      promotion: (selectedUci[4] as PieceSymbol | undefined) }) : null;
    if (selectedUci && move === null) throw new Error('independent search returned an illegal root move');
    return { move, uci: selectedUci, score: selectedScore, completedDepth, partialDepth, diagnostics,
      repetitionStatus: position.repetitionStatus };
  } finally {
    position.restore(checkpoint);
    setSearchCancellationCheck(); setSearchDeadline(Infinity);
    searchState.searchAborted = false;
  }
};

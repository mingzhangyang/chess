/**
 * The independent kernel as the worker's search stage, behind the default-off
 * `tsSearchKernel: 'independent'` request field. getBestMove (chessAI.ts)
 * still handles game over, easy and the opening books; this module replaces
 * only its time-managed search. Root selection is the production one: the
 * same deadlines, backtrack penalty, medium noise and band picker, with the
 * real random source.
 *
 * Per search it validates nothing twice: the adapter has already replayed the
 * history with chess.js (createGameFromInput), so the position is rebuilt
 * with SearchPosition and checked against that FEN only, and the previous own
 * move comes from the request instead of chess.js history. One transposition
 * table is reused for the worker's lifetime: kept across the moves of one
 * side with one tuning, cleared when either changes.
 */
import { Chess, type PieceSymbol, type Square } from 'chess.js';
import type { EngineAdapterComputeInput } from '../../../workers/engineAdapter';
import { TS_MIN_DEPTH_GRACE_MS } from '../../aiWorkerPolicy';
import { pickMoveFromTopBand, resolveSearchBudgetMs, resolveSearchDeadlinesMs } from '../../chessAI';
import { moveToSan } from '../chessAIBoardOps';
import { commitSearchDiagnostics, resetSearchCounters, searchState } from '../chessAISearchDiagnostics';
import { setSearchCancellationCheck, setSearchDeadline } from '../chessAISearchTiming';
import type { AiTuning } from '../chessAITuning';
import { SearchPosition, squareFromAlgebraic, type SearchMove } from '../searchPosition';
import { backtrackPenalty, KERNEL_FEATURES, runKernelSearch, type KernelFeatures, type PreviousOwnMove } from './kernelSearch';
import { KernelTranspositionTable } from './kernelTranspositionTable';
import { MAX_MOVES, moveCodeToUci } from './moveCode';

export type KernelStageHooks = {
  /** Polled with the deadline; true cancels the search (tests). */
  shouldAbort?: () => boolean;
  /** Sees the root position before the search (tests). */
  onPosition?: (position: SearchPosition) => void;
};

const STANDARD_FEN = new Chess().fen();

/**
 * The search position for a request whose history `validated` (chess.js) has
 * already replayed. Same completeness rule as the research entry
 * (independentSearch.ts): a custom start FEN is complete only when the
 * request says historyTruncated: false.
 */
export const kernelPositionFromInput = (input: EngineAdapterComputeInput, validated: Chess): SearchPosition => {
  const start = input.historyStartFen ?? STANDARD_FEN;
  const historyComplete = input.historyTruncated !== true && (input.history === undefined
    ? input.fen === 'start'
    : (start === STANDARD_FEN || input.historyTruncated === false));
  if (input.history === undefined) return new SearchPosition(validated.fen(), { historyComplete });
  const moves: SearchMove[] = input.history.map((uci) => ({
    from: squareFromAlgebraic(uci.slice(0, 2)),
    to: squareFromAlgebraic(uci.slice(2, 4)),
    ...(uci.length === 5 ? { promotion: uci[4] as SearchMove['promotion'] } : {}),
  }));
  return SearchPosition.fromHistory(start, moves, { historyComplete, expectedFen: validated.fen() });
};

/**
 * The side to move's last move: the request's second-to-last move. Its piece
 * is the one now on the destination (a pawn for a promotion). If the opponent
 * has since captured it no move of ours starts there, so the piece no longer
 * matters for the backtrack penalty.
 */
export const previousOwnMoveFromHistory = (position: SearchPosition, history: readonly string[] | undefined): PreviousOwnMove | null => {
  if (!history || history.length < 2) return null;
  const uci = history[history.length - 2];
  const to = squareFromAlgebraic(uci.slice(2, 4));
  const occupant = position.squares[to];
  const own = occupant !== 0 && (occupant > 0) === (position.sideToMove === 1);
  return { from: squareFromAlgebraic(uci.slice(0, 2)), to, piece: uci.length === 5 ? 1 : own ? Math.abs(occupant) : 0 };
};

let features: Readonly<KernelFeatures> = KERNEL_FEATURES;

/** Match scripts compare feature sets through this worker path (research/scripts/kernel-sprt.ts). */
export const setKernelFeaturesForTesting = (next: Readonly<KernelFeatures> = KERNEL_FEATURES): void => { features = next; };

let table: KernelTranspositionTable | undefined;
/** The perspective and tuning the table's scores belong to. */
let tableOwner = '';

/** The worker's reused kernel table, for tests. */
export const kernelTableForTesting = (): KernelTranspositionTable | undefined => table;

/** Empty entries between profiling samples without allocating a new table. */
export const clearKernelSearchTable = (): void => { table?.clear(); };

/** Search `game` (validated from `input`) with the kernel; SAN or null. May throw: callers fall back. */
export const searchKernelMove = (
  game: Chess,
  input: EngineAdapterComputeInput,
  tuning: AiTuning,
  hooks: KernelStageHooks = {},
  random: () => number = Math.random,
): string | null => {
  const { difficulty } = input;
  const position = kernelPositionFromInput(input, game);
  const checkpoint = position.checkpoint();
  const color = position.turn;
  let completedDepth = 0; let partialDepth = 0;
  let selected: number | undefined;
  resetSearchCounters(); searchState.searchAborted = false;
  setSearchCancellationCheck(hooks.shouldAbort);
  try {
    hooks.onPosition?.(position);
    const isDrawn = position.repetitionCount >= 3 || position.isInsufficientMaterial() || position.drawHalfmoveClock >= 100;
    if (!isDrawn && position.hasLegalMove()) {
      const buffer = new Int32Array(MAX_MOVES);
      const rootOrder = Array.from(buffer.subarray(0, position.generateMoveCodes(buffer)));
      const previousOwnMove = previousOwnMoveFromHistory(position, input.history);
      // getBestMove's openingPhase: the chess.js game's history is exactly input.history.
      const openingPhase = (input.history?.length ?? 0) < 8;
      const { softMs, hardMs } = resolveSearchDeadlinesMs(difficulty, input.timeLimitMs);
      const start = performance.now();
      const hardDeadline = start + resolveSearchBudgetMs(hardMs);
      table ??= new KernelTranspositionTable();
      // Entries are kept across this side's moves; scores depend on the side and tuning.
      const owner = `${color}|${JSON.stringify(tuning)}`;
      if (owner !== tableOwner) { table.clear(); tableOwner = owner; }
      const result = runKernelSearch(position, rootOrder, { color, tuning, difficulty, maxDepth: 20,
        openingPhase, previousOwnMove, softDeadline: start + resolveSearchBudgetMs(softMs), hardDeadline,
        firstDepthDeadline: Math.max(hardDeadline, start + TS_MIN_DEPTH_GRACE_MS), table, features });
      ({ completedDepth, partialDepth } = result);
      const scored = result.rootMoves.map(({ move, rawScore }) => ({
        move, score: rawScore - backtrackPenalty(move, previousOwnMove, tuning)
          + (difficulty === 'medium' ? random() * tuning.mediumNoise : 0),
      }));
      selected = pickMoveFromTopBand(scored, difficulty, openingPhase, tuning, random);
    }
    commitSearchDiagnostics(completedDepth, partialDepth);
    if (selected === undefined) return null;
    const uci = moveCodeToUci(selected);
    const san = moveToSan(game, { from: uci.slice(0, 2) as Square, to: uci.slice(2, 4) as Square,
      promotion: uci[4] as PieceSymbol | undefined });
    if (san === null) throw new Error('independent kernel returned an illegal root move');
    return san;
  } finally {
    position.restore(checkpoint);
    setSearchCancellationCheck(); setSearchDeadline(Infinity);
    searchState.searchAborted = false;
  }
};

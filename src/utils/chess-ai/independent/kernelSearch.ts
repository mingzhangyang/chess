/**
 * Search of the independent kernel: root iteration, PVS, quiescence, pruning
 * and move-ordering heuristics, all on a SearchPosition with integer moves
 * (see moveCode.ts). No chess.js objects, square names or 8x8 grids.
 *
 * The algorithm deliberately reproduces the frozen shared-code search
 * (chessAISearchCore, chessAIPvsSearch, chessAIQuiescence, chessAIRootSearch
 * and their heuristics) decision for decision, including the generation
 * order and stable tie order of moves, so that both visit the same nodes.
 * tests/client/independentKernel.test.ts checks this node for node. Changing
 * search behaviour here therefore needs a deliberate update of that test.
 */
import { evaluateBoard } from '../chessAIEvaluation';
import { searchState } from '../chessAISearchDiagnostics';
import { checkSearchDeadline, setSearchDeadline } from '../chessAISearchTiming';
import type { AiTuning } from '../chessAITuning';
import type { SearchPosition } from '../searchPosition';
import {
  isTacticalMoveCode, MAX_MOVES, moveCaptured, moveFrom, moveKey, movePiece, movePromotion, moveTo,
} from './moveCode';
import { KernelTranspositionTable, TT_EXACT, TT_LOWER, TT_UPPER } from './kernelTranspositionTable';

export const MATE_SCORE = 1000000;
const MATE_SCORE_THRESHOLD = MATE_SCORE - 1000;
const ASPIRATION_DELTA = 50;
const TIME_CHECK_MASK = 255;
const Q_TIME_CHECK_MASK = 63;
const TT_MOVE_BONUS = 20000;

/** Piece values by type (index 1..6 = p, n, b, r, q, k), as PIECE_VALUES. */
const VALUE = [0, 100, 320, 330, 500, 900, 20000];

// --- Heuristic constants, identical to chessAIMoveHeuristics ---
const MAX_KILLER_PLY = 10;
const MAX_HISTORY_SCORE = 8000;
const COUNTERMOVE_BONUS = 75;

// --- LMR table, identical to chessAISearchHeuristics ---
const LMR_MAX = 64;
const LMR_HISTORY_GOOD_THRESHOLD = 48;
const LMR_TABLE = new Uint8Array((LMR_MAX + 1) * (LMR_MAX + 1)).fill(1);
for (let depth = 1; depth <= LMR_MAX; depth += 1) {
  for (let moveNumber = 1; moveNumber <= LMR_MAX; moveNumber += 1) {
    LMR_TABLE[depth * (LMR_MAX + 1) + moveNumber] = Math.max(1, Math.round(0.77 + (Math.log(depth) * Math.log(moveNumber)) / 2.36));
  }
}
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const normalizeMateScore = (score: number, ply: number): number => (
  score >= MATE_SCORE_THRESHOLD ? score + ply : score <= -MATE_SCORE_THRESHOLD ? score - ply : score);
const denormalizeMateScore = (score: number, ply: number): number => (
  score >= MATE_SCORE_THRESHOLD ? score - ply : score <= -MATE_SCORE_THRESHOLD ? score + ply : score);

export type RootMove = { move: number; rawScore: number };
export type PreviousOwnMove = { from: number; to: number; piece: number };

export type KernelSearchOptions = {
  color: 'w' | 'b';
  tuning: AiTuning;
  difficulty: string;
  maxDepth: number;
  openingPhase: boolean;
  previousOwnMove: PreviousOwnMove | null;
  /** performance.now() deadlines: depth 1, start of a new depth, and hard stop. */
  firstDepthDeadline: number;
  softDeadline: number;
  hardDeadline: number;
};

export type KernelSearchResult = { rootMoves: RootMove[]; completedDepth: number; partialDepth: number };

/** Score deducted at selection time from a quiet move that undoes our last move. */
export const backtrackPenalty = (move: number, previous: PreviousOwnMove | null, tuning: AiTuning): number => (
  previous && moveFrom(move) === previous.to && moveTo(move) === previous.from
    && movePiece(move) === previous.piece && !isTacticalMoveCode(move) ? tuning.backtrackPenalty : 0);

const selectionBand = (difficulty: string, openingPhase: boolean, tuning: AiTuning): number => {
  if (difficulty === 'hard') return openingPhase ? tuning.hardOpeningFallbackBand : tuning.hardBand;
  if (difficulty === 'medium') return tuning.mediumBand + tuning.mediumNoise;
  return 0;
};

class Kernel {
  private readonly table = new KernelTranspositionTable();
  private readonly killers = new Int32Array((MAX_KILLER_PLY + 1) * 2);
  private readonly history = new Int32Array(64 * 64);
  private readonly countermoves = new Uint16Array(2 * 64 * 64);
  /** Move and score lists, one pair per active recursion frame. */
  private readonly moveStack: Int32Array[] = [];
  private readonly scoreStack: Int32Array[] = [];
  private readonly quietStack: Int32Array[] = [];
  private frameTop = 0;
  private qChecks = 0;
  private readonly isWhite: boolean;

  constructor(private readonly position: SearchPosition, private readonly color: 'w' | 'b', private readonly tuning: AiTuning) {
    this.isWhite = color === 'w';
  }

  private pushFrame(): number {
    const frame = this.frameTop++;
    if (frame === this.moveStack.length) {
      this.moveStack.push(new Int32Array(MAX_MOVES));
      this.scoreStack.push(new Int32Array(MAX_MOVES));
      this.quietStack.push(new Int32Array(MAX_MOVES));
    }
    return frame;
  }

  // --- Draws and terminal scores ---

  private isDraw(): boolean {
    const p = this.position;
    return p.repetitionCount >= 3 || p.isInsufficientMaterial() || p.drawHalfmoveClock >= 100;
  }

  private drawScore(): number {
    const boardScore = evaluateBoard(this.position, this.color, this.tuning);
    if (boardScore < -200) return 20;
    if (boardScore > 200) return -20;
    return -5;
  }

  private matedScore(ply: number): number {
    return (this.position.sideToMove === 1) === this.isWhite ? -(MATE_SCORE - ply) : MATE_SCORE - ply;
  }

  // --- Move ordering ---

  /** MVV-LVA with a geometric defence test; never used to prune. */
  private orderingScore(move: number): number {
    let score = 0;
    const captured = moveCaptured(move);
    if (captured) {
      const capturedValue = VALUE[captured];
      const attackerValue = VALUE[movePiece(move)];
      score += capturedValue < attackerValue && this.position.isSquareAttackedBy(moveTo(move), -this.position.sideToMove as 1 | -1)
        ? capturedValue - attackerValue
        : capturedValue * 10 - attackerValue;
    }
    const promotion = movePromotion(move);
    if (promotion) score += 20 + VALUE[promotion];
    return score;
  }

  private killerScore(move: number, ply: number): number {
    if (isTacticalMoveCode(move) || ply > MAX_KILLER_PLY) return 0;
    const key = move & 0xfff;
    if (this.killers[ply * 2] === key) return 90;
    if (this.killers[ply * 2 + 1] === key) return 80;
    return 0;
  }

  private storeKiller(move: number, ply: number): void {
    if (ply > MAX_KILLER_PLY) return;
    const key = move & 0xfff;
    if (this.killers[ply * 2] === key) return;
    this.killers[ply * 2 + 1] = this.killers[ply * 2];
    this.killers[ply * 2] = key;
  }

  private historyScore(move: number): number {
    if (isTacticalMoveCode(move)) return 0;
    return (this.history[move & 0xfff] * 70 / MAX_HISTORY_SCORE) | 0;
  }

  private countermoveIndex(previousMove: number): number {
    return (this.position.sideToMove === 1 ? 0 : 4096) + (previousMove & 0xfff);
  }

  /** Stable descending insertion sort of `count` moves by `scores`. */
  private static sort(moves: Int32Array, scores: Int32Array, count: number): void {
    for (let i = 1; i < count; i += 1) {
      const move = moves[i]; const score = scores[i];
      let j = i - 1;
      while (j >= 0 && scores[j] < score) { moves[j + 1] = moves[j]; scores[j + 1] = scores[j]; j -= 1; }
      moves[j + 1] = move; scores[j + 1] = score;
    }
  }

  // --- Main search ---

  minimax(depth: number, alpha: number, beta: number, isMax: boolean, ply: number,
    allowNullMove: boolean, prevMaxStaticEval: number | undefined, prevMinStaticEval: number | undefined,
    previousMove: number): number {
    ++searchState.nodeCount;
    if ((searchState.nodeCount & TIME_CHECK_MASK) === 1 && checkSearchDeadline()) return 0;
    if (searchState.searchAborted) return 0;

    const position = this.position;
    const tuning = this.tuning;
    const inCheck = position.isInCheck();
    if (this.isDraw()) return inCheck && !position.hasLegalMove() ? this.matedScore(ply) : this.drawScore();

    if (depth === 0) {
      // Check extension: search every evasion at full width instead of
      // handing a checked position to quiescence.
      if (inCheck) return this.minimax(1, alpha, beta, isMax, ply, allowNullMove, prevMaxStaticEval, prevMinStaticEval, previousMove);
      return this.quiescence(alpha, beta, isMax, ply);
    }

    const originalAlpha = alpha;
    const originalBeta = beta;
    const table = this.table;
    let ttMove = 0;
    if (table.probe(position, depth)) {
      ttMove = table.move;
      if (table.flag !== 0) {
        const ttScore = denormalizeMateScore(table.score, ply);
        if (table.flag === TT_EXACT) return ttScore;
        if (table.flag === TT_LOWER && ttScore > alpha) alpha = ttScore;
        if (table.flag === TT_UPPER && ttScore < beta) beta = ttScore;
        if (beta <= alpha) return ttScore;
      }
    }

    const isPvNode = beta - alpha > 1;
    const staticEval = evaluateBoard(position, this.color, tuning);
    const isImproving = isMax
      ? (prevMaxStaticEval !== undefined && staticEval > prevMaxStaticEval)
      : (prevMinStaticEval !== undefined && staticEval < prevMinStaticEval);
    const nextPrevMax = isMax ? staticEval : prevMaxStaticEval;
    const nextPrevMin = isMax ? prevMinStaticEval : staticEval;

    // Reverse futility pruning.
    if (tuning.enableRfp && !inCheck && !isPvNode && depth <= tuning.rfpDepthLimit) {
      const margin = tuning.rfpMarginBase + depth * tuning.rfpMarginPerDepth;
      if (isMax ? staticEval - margin >= beta : staticEval + margin <= alpha) {
        // A quiet stalemate must not be returned as a static score.
        if (!position.hasLegalMove()) return this.drawScore();
        searchState.rfpPruneCount += 1;
        return staticEval;
      }
    }

    // Null-move pruning, off in endgames and without non-pawn material.
    if (allowNullMove && isMax && depth >= 3 && !inCheck && this.allowNullMovePruning() && position.hasLegalMove()) {
      if (!tuning.enableNmpStaticGuard || staticEval >= beta - tuning.nmpStaticGuardMargin) {
        const R = depth >= 5 ? 3 : 2;
        if (position.halfmoveClock < 98 && !(position.sideToMove === -1 && position.fullmoveNumber === Number.MAX_SAFE_INTEGER)) {
          searchState.nullMoveAttemptCount += 1;
          position.makeNullMove();
          const nullScore = this.minimax(depth - 1 - R, alpha, beta, false, ply + 1, false, nextPrevMax, nextPrevMin, previousMove);
          position.undo();
          if (!searchState.searchAborted && nullScore >= beta) {
            searchState.nullMoveCutCount += 1;
            return beta;
          }
        }
      }
    }

    // --- PVS over the ordered legal moves ---
    const frame = this.pushFrame();
    const moves = this.moveStack[frame];
    const scores = this.scoreStack[frame];
    const quiets = this.quietStack[frame];
    const count = position.generateMoveCodes(moves);
    const useCountermove = tuning.enableCountermove;
    const counterIndex = previousMove ? this.countermoveIndex(previousMove) : -1;
    const expectedCounter = counterIndex >= 0 ? this.countermoves[counterIndex] : 0;
    for (let i = 0; i < count; i += 1) {
      const move = moves[i];
      const quiet = !isTacticalMoveCode(move);
      scores[i] = this.orderingScore(move) + this.killerScore(move, ply) + this.historyScore(move)
        + (useCountermove && quiet && expectedCounter !== 0 && expectedCounter === moveKey(move) ? COUNTERMOVE_BONUS : 0)
        + (ttMove !== 0 && moveKey(move) === ttMove ? TT_MOVE_BONUS : 0);
    }
    Kernel.sort(moves, scores, count);

    let bestMove = 0;
    let bestVal = isMax ? -Infinity : Infinity;
    let legalMoveCount = 0;
    let quietCount = 0;
    for (let i = 0; i < count; i += 1) {
      const move = moves[i];
      const moveIndex = legalMoveCount;
      const isQuiet = !isTacticalMoveCode(move);
      if (bestMove && isQuiet && !inCheck && !isPvNode) {
        // Late-move pruning.
        if (tuning.enableLmp && depth <= tuning.lmpDepthLimit
          && moveIndex >= tuning.lmpMoveCountBase + depth * tuning.lmpMoveCountPerDepth) {
          const evalMargin = tuning.lmpEvalMarginBase + depth * tuning.lmpEvalMarginPerDepth;
          if (isMax ? staticEval + evalMargin <= alpha : staticEval - evalMargin >= beta) {
            searchState.lmpPruneCount += 1;
            continue;
          }
        }
        // Futility pruning.
        if (tuning.enableFp && depth <= tuning.fpDepthLimit) {
          const margin = tuning.fpMarginBase + depth * tuning.fpMarginPerDepth;
          if (isMax ? staticEval + margin <= alpha : staticEval - margin >= beta) {
            searchState.fpPruneCount += 1;
            continue;
          }
        }
      }
      let reduction = 0;
      if (isQuiet && !inCheck && !isPvNode && depth >= 2 && moveIndex >= 2) {
        reduction = tuning.enableLmrTable
          ? LMR_TABLE[clamp(depth, 1, LMR_MAX) * (LMR_MAX + 1) + clamp(moveIndex + 1, 1, LMR_MAX)]
          : 1;
        if (this.killerScore(move, ply) > 0) reduction -= 1;
        if (this.historyScore(move) >= LMR_HISTORY_GOOD_THRESHOLD) reduction -= 1;
        if (isImproving) reduction -= 1;
        reduction = clamp(reduction, 1, depth - 1);
      }

      position.makeMoveCode(move);
      legalMoveCount += 1;
      let val: number;
      if (moveIndex === 0) {
        val = this.minimax(depth - 1, alpha, beta, !isMax, ply + 1, true, nextPrevMax, nextPrevMin, move);
      } else if (isMax) {
        val = this.minimax(depth - 1 - reduction, alpha, alpha + 1, false, ply + 1, true, nextPrevMax, nextPrevMin, move);
        if (!searchState.searchAborted) {
          if (reduction > 0 && val > alpha) {
            val = this.minimax(depth - 1, alpha, alpha + 1, false, ply + 1, true, nextPrevMax, nextPrevMin, move);
          }
          if (val > alpha && val < beta) {
            val = this.minimax(depth - 1, alpha, beta, false, ply + 1, true, nextPrevMax, nextPrevMin, move);
          }
        }
      } else {
        val = this.minimax(depth - 1 - reduction, beta - 1, beta, true, ply + 1, true, nextPrevMax, nextPrevMin, move);
        if (!searchState.searchAborted) {
          if (reduction > 0 && val < beta) {
            val = this.minimax(depth - 1, beta - 1, beta, true, ply + 1, true, nextPrevMax, nextPrevMin, move);
          }
          if (val < beta && val > alpha) {
            val = this.minimax(depth - 1, alpha, beta, true, ply + 1, true, nextPrevMax, nextPrevMin, move);
          }
        }
      }
      position.undo();

      // An aborted child has no valid score and must not train the heuristics.
      if (searchState.searchAborted) { this.frameTop = frame; return isMax ? -Infinity : Infinity; }

      if (isMax) {
        if (val > bestVal) { bestVal = val; bestMove = move; }
        if (bestVal > alpha) alpha = bestVal;
      } else {
        if (val < bestVal) { bestVal = val; bestMove = move; }
        if (bestVal < beta) beta = bestVal;
      }

      if (beta <= alpha) {
        if (isQuiet) {
          this.storeKiller(move, ply);
          const bonus = depth * depth;
          const history = this.history;
          const index = move & 0xfff;
          history[index] = Math.min(history[index] + bonus, MAX_HISTORY_SCORE);
          if (tuning.enableHistoryMalus) {
            for (let q = 0; q < quietCount; q += 1) {
              const quietIndex = quiets[q] & 0xfff;
              history[quietIndex] = Math.max(history[quietIndex] - bonus, -MAX_HISTORY_SCORE);
            }
          }
          if (useCountermove && counterIndex >= 0) this.countermoves[counterIndex] = moveKey(move);
        }
        break;
      }
      if (isQuiet) quiets[quietCount++] = move;
    }
    this.frameTop = frame;

    if (searchState.searchAborted) return bestVal;
    if (legalMoveCount === 0) return inCheck ? this.matedScore(ply) : this.drawScore();

    if (bestMove && Number.isFinite(bestVal)) {
      const flag = bestVal <= originalAlpha ? TT_UPPER : bestVal >= originalBeta ? TT_LOWER : TT_EXACT;
      table.store(position, depth, normalizeMateScore(bestVal, ply), flag, moveKey(bestMove));
    }
    return bestVal;
  }

  /** Side to move (the AI's color) has non-pawn material and it is not an endgame. */
  private allowNullMovePruning(): boolean {
    const board = this.position.squares;
    let white = 0; let black = 0;
    for (let square = 0; square < 64; square += 1) {
      const piece = board[square];
      if (piece > 1 && piece < 6) white += VALUE[piece];
      else if (piece < -1 && piece > -6) black += VALUE[-piece];
    }
    const mine = this.isWhite ? white : black;
    const theirs = this.isWhite ? black : white;
    return mine > 0 && !(mine < 1300 && theirs < 1300);
  }

  private qDeadline(): boolean {
    if (searchState.searchAborted) return true;
    return ((++this.qChecks) & Q_TIME_CHECK_MASK) === 0 && checkSearchDeadline();
  }

  /** Captures and promotions; every evasion when in check. */
  quiescence(alpha: number, beta: number, isMax: boolean, ply: number): number {
    searchState.qNodeCount += 1;
    if (this.qDeadline()) return 0;

    const position = this.position;
    const tuning = this.tuning;
    const inCheck = position.isInCheck();
    const frame = this.pushFrame();
    const moves = this.moveStack[frame];
    const scores = this.scoreStack[frame];
    const count = position.generateMoveCodes(moves, !inCheck);

    if (count === 0) {
      if (inCheck) { this.frameTop = frame; return this.matedScore(ply); }
      if (!position.hasLegalMove()) { this.frameTop = frame; return this.drawScore(); }
    }
    if (this.isDraw()) { this.frameTop = frame; return this.drawScore(); }

    const standPat = evaluateBoard(position, this.color, tuning);
    if (!inCheck) {
      if (isMax) {
        if (standPat >= beta) { this.frameTop = frame; return standPat; }
        if (standPat > alpha) alpha = standPat;
      } else {
        if (standPat <= alpha) { this.frameTop = frame; return standPat; }
        if (standPat < beta) beta = standPat;
      }
    }
    if (count === 0) { this.frameTop = frame; return standPat; }

    for (let i = 0; i < count; i += 1) scores[i] = this.orderingScore(moves[i]);
    Kernel.sort(moves, scores, count);

    let bestVal = isMax ? (inCheck ? -Infinity : standPat) : (inCheck ? Infinity : standPat);
    for (let i = 0; i < count; i += 1) {
      if (this.qDeadline()) { this.frameTop = frame; return 0; }
      const move = moves[i];
      position.makeMoveCode(move);
      if (isMax && !inCheck && !movePromotion(move) && tuning.enableQDelta) {
        // Delta pruning, unless the capture gives check.
        const gain = VALUE[moveCaptured(move)];
        if (standPat + gain + tuning.qDeltaMargin < alpha && !position.isInCheck()) { position.undo(); continue; }
      }
      const value = this.quiescence(alpha, beta, !isMax, ply + 1);
      position.undo();
      if (searchState.searchAborted) { this.frameTop = frame; return 0; }
      if (isMax) {
        if (value > bestVal) bestVal = value;
        if (bestVal > alpha) alpha = bestVal;
      } else {
        if (value < bestVal) bestVal = value;
        if (bestVal < beta) beta = bestVal;
      }
      if (beta <= alpha) break;
    }
    this.frameTop = frame;
    return bestVal;
  }

  // --- Root ---

  searchRootDepth(rootMoves: RootMove[], depth: number, difficulty: string, openingPhase: boolean,
    previousOwnMove: PreviousOwnMove | null): { completed: boolean; scores?: number[]; partialScores?: number[] } {
    if (rootMoves.length === 0 || searchState.searchAborted) return { completed: false };
    const tuning = this.tuning;
    const penaltyOf = (move: number) => backtrackPenalty(move, previousOwnMove, tuning);
    // Search the previous best after its selection-time penalty first, so a
    // partial depth always includes it.
    rootMoves.sort((a, b) => (b.rawScore - penaltyOf(b.move)) - (a.rawScore - penaltyOf(a.move)));
    const prevBest = rootMoves[0].rawScore;
    let lo = depth > 1 ? prevBest - ASPIRATION_DELTA : -Infinity;
    let hi = depth > 1 ? prevBest + ASPIRATION_DELTA : Infinity;
    const band = selectionBand(difficulty, openingPhase, tuning);
    const depthScores: number[] = new Array(rootMoves.length);
    const position = this.position;

    const searchMove = (move: number, alpha: number, beta: number): number => {
      position.makeMoveCode(move);
      const score = this.minimax(depth - 1, alpha, beta, false, 0, true, undefined, undefined, move);
      position.undo();
      return score;
    };

    let resolved = 0;
    const aborted = () => (resolved > 0 ? { completed: false, partialScores: depthScores.slice(0, resolved) } : { completed: false });

    retry: for (;;) {
      let bestScore = -Infinity;
      resolved = 0;
      for (let i = 0; i < rootMoves.length; i += 1) {
        const { move } = rootMoves[i];
        if (i === 0) {
          const score = searchMove(move, lo, hi);
          if (searchState.searchAborted) return aborted();
          if (Number.isFinite(hi) && score >= hi) { hi = Infinity; continue retry; }
          if (score <= lo) { lo = -Infinity; continue retry; }
          depthScores[0] = score;
          bestScore = score - penaltyOf(move);
          resolved = 1;
          continue;
        }
        // Probe the selection edge with a zero window; only moves above it
        // need an exact score.
        const penalty = penaltyOf(move);
        const edgeAlpha = (band > 0 ? bestScore - band - 1 : bestScore) + penalty;
        let score = searchMove(move, edgeAlpha, edgeAlpha + 1);
        if (searchState.searchAborted) return aborted();
        if (score <= edgeAlpha) { depthScores[i] = -Infinity; resolved = i + 1; continue; }
        if (Number.isFinite(hi) && score >= hi) { hi = Infinity; continue retry; }
        score = searchMove(move, edgeAlpha, hi);
        if (searchState.searchAborted) return aborted();
        if (Number.isFinite(hi) && score >= hi) { hi = Infinity; continue retry; }
        if (score <= edgeAlpha) {
          // Search instability: settle it with an unbounded search.
          score = searchMove(move, -Infinity, Infinity);
          if (searchState.searchAborted) return aborted();
        }
        depthScores[i] = score;
        resolved = i + 1;
        if (score - penalty > bestScore) bestScore = score - penalty;
      }
      return { completed: true, scores: depthScores };
    }
  }

  /** Root order: the given order, then a stable sort by the capture/promotion score. */
  orderRoot(moves: number[]): RootMove[] {
    const scored = moves.map((move) => ({ move, score: this.orderingScore(move) }));
    scored.sort((a, b) => b.score - a.score);
    return scored.map(({ move }) => ({ move, rawScore: this.orderingScore(move) + this.historyScore(move) }));
  }
}

/**
 * Iterative deepening over the root moves of `position`. The caller must have
 * excluded draws and positions without a legal move, set the cancellation
 * hook and reset the diagnostics; the position is left as it was on return,
 * but a throw may leave moves applied (callers restore a checkpoint).
 */
export const runKernelSearch = (position: SearchPosition, rootOrder: number[], options: KernelSearchOptions): KernelSearchResult => {
  const kernel = new Kernel(position, options.color, options.tuning);
  const rootMoves = kernel.orderRoot(rootOrder);
  let completedDepth = 0; let partialDepth = 0;
  for (let depth = 1; depth <= options.maxDepth; depth += 1) {
    if (depth > 1 && performance.now() >= options.softDeadline) break;
    setSearchDeadline(depth === 1 ? options.firstDepthDeadline : options.hardDeadline);
    const result = kernel.searchRootDepth(rootMoves, depth, options.difficulty, options.openingPhase, options.previousOwnMove);
    const scores = result.completed ? result.scores : result.partialScores;
    if (scores && scores.length > 0) {
      for (let i = 0; i < rootMoves.length; i += 1) rootMoves[i].rawScore = i < scores.length ? scores[i] : -Infinity;
      if (result.completed) completedDepth = depth; else partialDepth = depth;
    }
    if (searchState.searchAborted) break;
  }
  return { rootMoves, completedDepth, partialDepth };
};

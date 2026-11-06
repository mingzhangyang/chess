/**
 * Staged move ordering of the independent kernel. Out of check, a picker
 * hands out the legal moves of one node in stages, generating each group
 * only when the search gets to it, so a cutoff by an early move skips the
 * work for the rest:
 *
 *   1. the transposition-table move, checked with legalMoveCode;
 *   2. captures and promotions with a non-negative captureScore, best first;
 *   3. the two killers and the countermove, when legal and quiet;
 *   4. the other quiet moves, by history score;
 *   5. the remaining captures (losing ones, and king captures), best first.
 *
 * In check, every evasion is generated at once and ordered by the combined
 * score the unstaged kernel used for all moves. Sorts are stable, so ties
 * keep generation order. Each move is handed out exactly once, unless the
 * search drops the remaining quiet moves with skipQuiets.
 */
import type { SearchPosition } from '../searchPosition';
import { isTacticalMoveCode, MAX_MOVES, moveCaptured, movePiece, movePromotion, moveTo } from './moveCode';

/** Piece values by type (index 1..6 = p, n, b, r, q, k), as PIECE_VALUES. */
export const VALUE = [0, 100, 320, 330, 500, 900, 20000];
export const MAX_HISTORY_SCORE = 8000;
export const KILLER_SCORES = [90, 80] as const;
export const COUNTERMOVE_BONUS = 75;
export const TT_MOVE_BONUS = 20000;

/** MVV-LVA with a geometric defence test, plus a promotion bonus; never used to prune. */
export const captureScore = (position: SearchPosition, move: number): number => {
  let score = 0;
  const captured = moveCaptured(move);
  if (captured) {
    const capturedValue = VALUE[captured];
    const attackerValue = VALUE[movePiece(move)];
    score += capturedValue < attackerValue && position.isSquareAttackedBy(moveTo(move), -position.sideToMove as 1 | -1)
      ? capturedValue - attackerValue
      : capturedValue * 10 - attackerValue;
  }
  const promotion = movePromotion(move);
  if (promotion) score += 20 + VALUE[promotion];
  return score;
};

/**
 * Capture order by static exchange (feature seeOrdering): captures that do
 * not lose material get MVV-LVA (a king counted as 1,000) plus the promotion
 * bonus, so they are non-negative; losing ones get their exchange value.
 */
export const seeCaptureScore = (position: SearchPosition, move: number): number => {
  const exchange = position.staticExchange(move);
  if (exchange < 0) return exchange;
  const captured = moveCaptured(move);
  const promotion = movePromotion(move);
  return (captured ? VALUE[captured] * 10 - Math.min(VALUE[movePiece(move)], 1000) : 0) + (promotion ? 20 + VALUE[promotion] : 0);
};

/** History bonus of a quiet move: at most 70 either way. */
export const historyScore = (history: Int32Array, move: number): number => (
  isTacticalMoveCode(move) ? 0 : (history[move & 0xfff] * 70 / MAX_HISTORY_SCORE) | 0);

/** Stable descending insertion sort of `moves[from..to)` by `scores`. */
export const sortMoves = (moves: Int32Array, scores: Int32Array, from: number, to: number): void => {
  for (let i = from + 1; i < to; i += 1) {
    const move = moves[i]; const score = scores[i];
    let j = i - 1;
    while (j >= from && scores[j] < score) { moves[j + 1] = moves[j]; scores[j + 1] = scores[j]; j -= 1; }
    moves[j + 1] = move; scores[j + 1] = score;
  }
};

const TT = 0;
const GENERATE_CAPTURES = 1;
const GOOD_CAPTURES = 2;
const KILLER_1 = 3;
const KILLER_2 = 4;
const COUNTERMOVE = 5;
const GENERATE_QUIETS = 6;
const QUIETS = 7;
const BAD_CAPTURES = 8;
const EVASIONS = 9;
const DONE = 10;

export class MovePicker {
  private readonly moves = new Int32Array(MAX_MOVES);
  private readonly scores = new Int32Array(MAX_MOVES);
  private readonly quiets = new Int32Array(MAX_MOVES);
  private readonly quietScores = new Int32Array(MAX_MOVES);
  private position: SearchPosition | null = null;
  private history = new Int32Array(0);
  private stage = DONE;
  private count = 0;
  private index = 0;
  private goodEnd = 0;
  private quietCount = 0;
  private quietIndex = 0;
  private ttKey = 0;
  private killer1 = 0;
  private killer2 = 0;
  private counter = 0;
  /** Keys of the moves handed out by stages 1 and 3, which later stages skip. */
  private ttYielded = 0;
  private killer1Yielded = 0;
  private killer2Yielded = 0;
  private counterYielded = 0;
  /** Classify and order captures by static exchange instead of the geometric defence test. */
  seeOrdering = false;

  /**
   * Start on the current position. `ttKey` and `counterKey` are moveKey
   * values and the killers 12-bit from/to keys; 0 means none. The history
   * table (64 * 64, by from/to) is read while picking, not copied.
   */
  reset(position: SearchPosition, history: Int32Array, ttKey: number, killer1: number, killer2: number, counterKey: number): void {
    this.position = position;
    this.history = history;
    this.ttKey = ttKey; this.killer1 = killer1; this.killer2 = killer2; this.counter = counterKey;
    this.ttYielded = 0; this.killer1Yielded = 0; this.killer2Yielded = 0; this.counterYielded = 0;
    this.count = 0; this.index = 0; this.goodEnd = 0; this.quietCount = 0; this.quietIndex = 0;
    if (position.isInCheck()) this.generateEvasions(position);
    else this.stage = TT;
  }

  private generateEvasions(position: SearchPosition): void {
    const moves = this.moves;
    const scores = this.scores;
    const count = position.generateMoveCodes(moves);
    for (let i = 0; i < count; i += 1) {
      const move = moves[i];
      const key = move & 0x7fff;
      let score = captureScore(position, move) + historyScore(this.history, move);
      if (!isTacticalMoveCode(move)) {
        if ((move & 0xfff) === this.killer1) score += KILLER_SCORES[0];
        else if ((move & 0xfff) === this.killer2) score += KILLER_SCORES[1];
        if (this.counter !== 0 && key === this.counter) score += COUNTERMOVE_BONUS;
      }
      if (this.ttKey !== 0 && key === this.ttKey) score += TT_MOVE_BONUS;
      scores[i] = score;
    }
    sortMoves(moves, scores, 0, count);
    this.count = count;
    this.stage = EVASIONS;
  }

  private alreadyYielded(key: number): boolean {
    return key === this.ttYielded || key === this.killer1Yielded || key === this.killer2Yielded || key === this.counterYielded;
  }

  /** A stored quiet move, if it is legal here and not handed out yet; else 0. */
  private storedQuiet(key: number): number {
    if (key === 0 || this.alreadyYielded(key)) return 0;
    const move = this.position!.legalMoveCode(key);
    return move !== 0 && !isTacticalMoveCode(move) ? move : 0;
  }

  /**
   * Hand out no more quiet moves; losing captures still follow. The search
   * calls this when it prunes a quiet move for a reason that holds for every
   * later quiet move of the node (late-move or futility pruning), so the
   * remaining quiets need not even be generated.
   */
  skipQuiets(): void {
    if (this.stage >= KILLER_1 && this.stage <= QUIETS) this.stage = BAD_CAPTURES;
  }

  /** The next move, or 0 when every legal move has been handed out. */
  next(): number {
    const position = this.position!;
    for (;;) {
      switch (this.stage) {
        case TT: {
          this.stage = GENERATE_CAPTURES;
          if (this.ttKey === 0) break;
          const move = position.legalMoveCode(this.ttKey);
          if (move !== 0) { this.ttYielded = this.ttKey; return move; }
          break;
        }
        case GENERATE_CAPTURES: {
          const moves = this.moves;
          const scores = this.scores;
          const generated = position.generateMoveCodes(moves, true);
          let count = 0;
          for (let i = 0; i < generated; i += 1) {
            const move = moves[i];
            if ((move & 0x7fff) === this.ttYielded) continue;
            moves[count] = move;
            scores[count] = this.seeOrdering ? seeCaptureScore(position, move) : captureScore(position, move);
            count += 1;
          }
          sortMoves(moves, scores, 0, count);
          let goodEnd = 0;
          while (goodEnd < count && scores[goodEnd] >= 0) goodEnd += 1;
          this.count = count; this.goodEnd = goodEnd; this.index = 0;
          this.stage = GOOD_CAPTURES;
          break;
        }
        case GOOD_CAPTURES:
          if (this.index < this.goodEnd) return this.moves[this.index++];
          this.stage = KILLER_1;
          break;
        case KILLER_1: {
          this.stage = KILLER_2;
          const move = this.storedQuiet(this.killer1);
          if (move !== 0) { this.killer1Yielded = this.killer1; return move; }
          break;
        }
        case KILLER_2: {
          this.stage = COUNTERMOVE;
          const move = this.storedQuiet(this.killer2);
          if (move !== 0) { this.killer2Yielded = this.killer2; return move; }
          break;
        }
        case COUNTERMOVE: {
          this.stage = GENERATE_QUIETS;
          const move = this.storedQuiet(this.counter);
          if (move !== 0) { this.counterYielded = this.counter; return move; }
          break;
        }
        case GENERATE_QUIETS: {
          const quiets = this.quiets;
          const scores = this.quietScores;
          const generated = position.generateQuietMoveCodes(quiets);
          let count = 0;
          for (let i = 0; i < generated; i += 1) {
            const move = quiets[i];
            if (this.alreadyYielded(move & 0x7fff)) continue;
            quiets[count] = move;
            scores[count] = (this.history[move & 0xfff] * 70 / MAX_HISTORY_SCORE) | 0;
            count += 1;
          }
          sortMoves(quiets, scores, 0, count);
          this.quietCount = count; this.quietIndex = 0;
          this.stage = QUIETS;
          break;
        }
        case QUIETS:
          if (this.quietIndex < this.quietCount) return this.quiets[this.quietIndex++];
          this.stage = BAD_CAPTURES;
          break;
        case BAD_CAPTURES:
          if (this.index < this.count) return this.moves[this.index++];
          this.stage = DONE;
          return 0;
        case EVASIONS:
          if (this.index < this.count) return this.moves[this.index++];
          this.stage = DONE;
          return 0;
        default:
          return 0;
      }
    }
  }
}

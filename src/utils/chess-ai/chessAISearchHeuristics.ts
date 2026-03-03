import { Chess } from 'chess.js';
import { PIECE_VALUES } from './chessAIEvaluation';
import type { AiTuning } from './chessAITuning';

const pieceValues = PIECE_VALUES;
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const LMR_TABLE_MAX_DEPTH = 64;
const LMR_TABLE_MAX_MOVE_NUMBER = 64;
const LMR_HISTORY_GOOD_THRESHOLD = 48; // getHistoryScore() is normalized to 0..70.

const buildLmrReductionTable = (): number[][] => {
  const table: number[][] = Array.from(
    { length: LMR_TABLE_MAX_DEPTH + 1 },
    () => new Array(LMR_TABLE_MAX_MOVE_NUMBER + 1).fill(1),
  );
  for (let depth = 1; depth <= LMR_TABLE_MAX_DEPTH; depth += 1) {
    for (let moveNumber = 1; moveNumber <= LMR_TABLE_MAX_MOVE_NUMBER; moveNumber += 1) {
      const reduction = Math.max(1, Math.round(0.77 + (Math.log(depth) * Math.log(moveNumber)) / 2.36));
      table[depth][moveNumber] = reduction;
    }
  }
  return table;
};

const LMR_REDUCTION_TABLE = buildLmrReductionTable();

// Null move pruning uses a side-to-move pass and must preserve clocks/castling/en-passant rules.
export const makeNullMove = (game: Chess): Chess | null => {
  const parts = game.fen().split(' ');
  parts[1] = parts[1] === 'w' ? 'b' : 'w';
  parts[3] = '-';
  if (parts[1] === 'w') {
    parts[5] = String(Number(parts[5]) + 1);
  }
  try {
    return new Chess(parts.join(' '));
  } catch {
    return null;
  }
};

// Returns true when null-move pruning is safe: the side to move has non-pawn material,
// AND the position is not an endgame (where Zugzwang makes NMP unreliable).
export const allowNullMovePruning = (board: ReturnType<Chess['board']>, color: 'w' | 'b'): boolean => {
  let myMat = 0; let oppMat = 0;
  for (let r = 0; r < 8; r += 1) {
    for (let f = 0; f < 8; f += 1) {
      const p = board[r][f];
      if (p && p.type !== 'p' && p.type !== 'k') {
        const v = pieceValues[p.type] || 0;
        if (p.color === color) myMat += v; else oppMat += v;
      }
    }
  }
  // Disable if side has no non-pawn material, or if both sides are in endgame territory.
  return myMat > 0 && !(myMat < 1300 && oppMat < 1300);
};

export const shouldAllowNullMoveByStaticEval = (
  staticEval: number,
  beta: number,
  tuning: Pick<AiTuning, 'enableNmpStaticGuard' | 'nmpStaticGuardMargin'>,
): boolean => {
  if (!tuning.enableNmpStaticGuard) {
    return true;
  }
  return staticEval >= beta - tuning.nmpStaticGuardMargin;
};

export const shouldApplyReverseFutilityPruning = (
  context: {
    staticEval: number;
    alpha: number;
    beta: number;
    depth: number;
    isMaximizingPlayer: boolean;
    inCheck: boolean;
    isPvNode: boolean;
  },
  tuning: Pick<AiTuning, 'enableRfp' | 'rfpDepthLimit' | 'rfpMarginBase' | 'rfpMarginPerDepth'>,
): boolean => {
  if (!tuning.enableRfp) return false;
  if (context.inCheck || context.isPvNode) return false;
  if (context.depth <= 0 || context.depth > tuning.rfpDepthLimit) return false;

  const margin = tuning.rfpMarginBase + context.depth * tuning.rfpMarginPerDepth;
  if (context.isMaximizingPlayer) {
    return context.staticEval - margin >= context.beta;
  }
  return context.staticEval + margin <= context.alpha;
};

export const shouldPruneMoveByFutility = (
  context: {
    staticEval: number;
    alpha: number;
    beta: number;
    depth: number;
    isMaximizingPlayer: boolean;
    inCheck: boolean;
    isPvNode: boolean;
    isQuiet: boolean;
  },
  tuning: Pick<AiTuning, 'enableFp' | 'fpDepthLimit' | 'fpMarginBase' | 'fpMarginPerDepth'>,
): boolean => {
  if (!tuning.enableFp) return false;
  if (!context.isQuiet || context.inCheck || context.isPvNode) return false;
  if (context.depth <= 0 || context.depth > tuning.fpDepthLimit) return false;

  const margin = tuning.fpMarginBase + context.depth * tuning.fpMarginPerDepth;
  if (context.isMaximizingPlayer) {
    return context.staticEval + margin <= context.alpha;
  }
  return context.staticEval - margin >= context.beta;
};

export const shouldPruneMoveByLmp = (
  context: {
    staticEval: number;
    alpha: number;
    beta: number;
    depth: number;
    moveIndex: number;
    isMaximizingPlayer: boolean;
    inCheck: boolean;
    isPvNode: boolean;
    isQuiet: boolean;
  },
  tuning: Pick<
    AiTuning,
    | 'enableLmp'
    | 'lmpDepthLimit'
    | 'lmpMoveCountBase'
    | 'lmpMoveCountPerDepth'
    | 'lmpEvalMarginBase'
    | 'lmpEvalMarginPerDepth'
  >,
): boolean => {
  if (!tuning.enableLmp) return false;
  if (!context.isQuiet || context.inCheck || context.isPvNode) return false;
  if (context.depth <= 0 || context.depth > tuning.lmpDepthLimit) return false;

  const moveThreshold = tuning.lmpMoveCountBase + context.depth * tuning.lmpMoveCountPerDepth;
  if (context.moveIndex < moveThreshold) return false;

  const evalMargin = tuning.lmpEvalMarginBase + context.depth * tuning.lmpEvalMarginPerDepth;
  if (context.isMaximizingPlayer) {
    return context.staticEval + evalMargin <= context.alpha;
  }
  return context.staticEval - evalMargin >= context.beta;
};

const getLmrTableReduction = (depth: number, moveNumber: number): number => {
  const safeDepth = clamp(depth, 1, LMR_TABLE_MAX_DEPTH);
  const safeMoveNumber = clamp(moveNumber, 1, LMR_TABLE_MAX_MOVE_NUMBER);
  return LMR_REDUCTION_TABLE[safeDepth][safeMoveNumber];
};

export const getLmrReduction = (
  context: {
    depth: number;
    moveIndex: number;
    inCheck: boolean;
    isPvNode: boolean;
    isQuiet: boolean;
    isImproving: boolean;
    killerMoveScore: number;
    historyMoveScore: number;
  },
  tuning: Pick<AiTuning, 'enableLmrTable'>,
): number => {
  if (!context.isQuiet || context.inCheck || context.isPvNode) return 0;
  if (context.depth < 2 || context.moveIndex < 2) return 0;

  let reduction = tuning.enableLmrTable
    ? getLmrTableReduction(context.depth, context.moveIndex + 1)
    : 1;

  if (context.killerMoveScore > 0) {
    reduction -= 1;
  }
  if (context.historyMoveScore >= LMR_HISTORY_GOOD_THRESHOLD) {
    reduction -= 1;
  }
  if (context.isImproving) {
    reduction -= 1;
  }

  return clamp(reduction, 1, context.depth - 1);
};

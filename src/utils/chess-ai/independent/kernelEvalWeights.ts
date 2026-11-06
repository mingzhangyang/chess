/**
 * Weights of the independent kernel's evaluation (phase 11), as one
 * replaceable object. DEFAULT_KERNEL_EVAL_WEIGHTS reproduces the shared
 * evaluator (chessAIEvaluation.ts with DEFAULT_EVAL_WEIGHTS) exactly; the
 * shared module, the reference backend and the frozen reference evaluator do
 * not read these weights, so tuning them changes only the kernel.
 *
 * Arrays indexed "by type" use the piece codes 1..6 (pawn, knight, bishop,
 * rook, queen, king; index 0 unused). Piece-square arrays have 64 entries,
 * mover-relative: index 0 is a8 for white and a1 for black (row 0 is the
 * mover's far rank). Material and piece-square values must be integers, so
 * SearchPosition's running sums of them are exact.
 *
 * Fields ending in Mg count in the middlegame and Eg in the endgame. King
 * safety counts in the middlegame only and is scaled by kingSafetyPct.
 */
import {
  DEFAULT_EVAL_WEIGHTS, KING_ENDGAME_PST, PIECE_SQUARE_EG, PIECE_SQUARE_MG, PST_BY_TYPE, TYPE_LETTERS,
} from '../evaluationTables';

export interface KernelEvalWeights {
  materialMg: readonly number[];
  materialEg: readonly number[];
  pstMg: readonly (readonly number[])[];
  pstEg: readonly (readonly number[])[];
  mobilityMg: readonly number[];
  mobilityEg: readonly number[];
  rookOpenFileMg: number; rookOpenFileEg: number;
  rookSemiOpenFileMg: number; rookSemiOpenFileEg: number;
  rookSeventhRankMg: number; rookSeventhRankEg: number;
  doubledRooksMg: number; doubledRooksEg: number;
  bishopPairMg: number; bishopPairEg: number;
  knightOutpostMg: number; knightOutpostEg: number;
  doubledPawnMg: number; doubledPawnEg: number;
  isolatedPawnMg: number; isolatedPawnEg: number;
  backwardPawnMg: number; backwardPawnEg: number;
  connectedPawnMg: number; connectedPawnEg: number;
  /** Passed-pawn bonus by advancement (ranks advanced from the start rank side, 0..7). */
  passedPawnMg: readonly number[];
  passedPawnEg: readonly number[];
  rookBehindPassedMg: number; rookBehindPassedEg: number;
  /**
   * King shield, per file next to and on the king's: a pawn one rank ahead
   * (direct, side), two ranks ahead (direct, side), no pawn on the file
   * (direct, side), a pawn elsewhere on the file (direct, side).
   */
  kingShield: readonly number[];
  /** Per unit of enemy attack weight in the 5x5 king zone (capped at 80 units). */
  kingZoneAttack: number;
  /** Per floor(units^2 / 64), with the nonlinear king safety tuning on. */
  kingZoneAttackQuadratic: number;
  /** Attack units by enemy piece type in the king zone. */
  kingAttackByType: readonly number[];
  kingSafetyPct: number;
  tempo: number;
}

const ROOK_BEHIND_PASSED_PAWN_MG_BONUS = 16;
const ROOK_BEHIND_PASSED_PAWN_EG_BONUS = 28;
const TEMPO_BONUS = 10;
const PASSED_PAWN_BONUS = [0, 0, 10, 20, 40, 60, 90, 130];

const byType = (values: { n: number; b: number; r: number; q: number; p?: number }): number[] => (
  TYPE_LETTERS.map((letter) => (letter ? (values as Record<string, number>)[letter] ?? 0 : 0)));
const w = DEFAULT_EVAL_WEIGHTS;
const scaledPst = (percent: number, endgame: boolean): number[][] => TYPE_LETTERS.map((letter, type) => (
  letter ? Array.from(type === 6 && endgame ? KING_ENDGAME_PST : PST_BY_TYPE[type], (v) => (v * percent) / 100) : []));

/** The shared evaluator's weights, in this layout. */
export const DEFAULT_KERNEL_EVAL_WEIGHTS: KernelEvalWeights = Object.freeze({
  materialMg: byType(w.materialMg), materialEg: byType(w.materialEg),
  pstMg: scaledPst(w.pstMgPct, false), pstEg: scaledPst(w.pstEgPct, true),
  mobilityMg: byType(w.mobilityMg), mobilityEg: byType(w.mobilityEg),
  rookOpenFileMg: w.rookOpenFile, rookOpenFileEg: w.rookOpenFile,
  rookSemiOpenFileMg: w.rookSemiOpenFile, rookSemiOpenFileEg: w.rookSemiOpenFile,
  rookSeventhRankMg: w.rookSeventhRank, rookSeventhRankEg: w.rookSeventhRank,
  doubledRooksMg: w.doubledRooks, doubledRooksEg: w.doubledRooks,
  bishopPairMg: w.bishopPair, bishopPairEg: w.bishopPair,
  knightOutpostMg: w.knightOutpostMg, knightOutpostEg: w.knightOutpostEg,
  doubledPawnMg: w.doubledPawn, doubledPawnEg: w.doubledPawn,
  isolatedPawnMg: w.isolatedPawn, isolatedPawnEg: w.isolatedPawn,
  backwardPawnMg: w.backwardPawn, backwardPawnEg: w.backwardPawn,
  connectedPawnMg: w.connectedPawn, connectedPawnEg: w.connectedPawn,
  passedPawnMg: PASSED_PAWN_BONUS.map((v) => (v * w.passedPawnMgPct) / 100),
  passedPawnEg: PASSED_PAWN_BONUS.map((v) => (v * w.passedPawnEgPct) / 100),
  rookBehindPassedMg: ROOK_BEHIND_PASSED_PAWN_MG_BONUS, rookBehindPassedEg: ROOK_BEHIND_PASSED_PAWN_EG_BONUS,
  kingShield: [15, 12, 8, 6, -25, -15, -12, -7],
  kingZoneAttack: -3,
  kingZoneAttackQuadratic: -1,
  kingAttackByType: [0, 0, 4, 4, 7, 10, 0],
  kingSafetyPct: w.kingSafetyPct,
  tempo: TEMPO_BONUS,
});

export type PieceSquareTables = { mg: Int32Array; eg: Int32Array };

const tablesCache = new WeakMap<KernelEvalWeights, PieceSquareTables>();
const sameTable = (a: Int32Array, b: Int32Array) => a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * Material plus piece-square value of each piece on each square, signed from
 * white's side and indexed by `(piece + 6) * 64 + square`, as SearchPosition
 * sums them. Kings carry no material. Weights equal to the default return the
 * shared tables themselves, so default positions need no switch.
 */
export const pieceSquareTables = (weights: KernelEvalWeights): PieceSquareTables => {
  const cached = tablesCache.get(weights);
  if (cached) return cached;
  const build = (material: readonly number[], pst: readonly (readonly number[])[]): Int32Array => {
    const table = new Int32Array(13 * 64);
    for (let piece = -6; piece <= 6; piece += 1) {
      if (piece === 0) continue;
      const type = piece > 0 ? piece : -piece;
      const white = piece > 0;
      for (let square = 0; square < 64; square += 1) {
        const index = (white ? square >> 3 : 7 - (square >> 3)) * 8 + (square & 7);
        const value = (type === 6 ? 0 : material[type]) + pst[type][index];
        if (!Number.isInteger(value)) throw new Error('material and piece-square weights must be integers');
        table[(piece + 6) * 64 + square] = white ? value : -value;
      }
    }
    return table;
  };
  let mg = build(weights.materialMg, weights.pstMg);
  let eg = build(weights.materialEg, weights.pstEg);
  if (sameTable(mg, PIECE_SQUARE_MG)) mg = PIECE_SQUARE_MG;
  if (sameTable(eg, PIECE_SQUARE_EG)) eg = PIECE_SQUARE_EG;
  const tables = { mg, eg };
  tablesCache.set(weights, tables);
  return tables;
};

// --- A flat view, for the tuner ---

type Field = { name: keyof KernelEvalWeights; length: number; rows?: number };
/** Every field in a fixed order, with its length (1 for a scalar; rows x 64 for piece-square tables). */
export const WEIGHT_FIELDS: readonly Field[] = Object.freeze(Object.entries(DEFAULT_KERNEL_EVAL_WEIGHTS).map(([name, value]) => {
  if (typeof value === 'number') return { name: name as keyof KernelEvalWeights, length: 1 };
  const array = value as readonly (number | readonly number[])[];
  if (Array.isArray(array[1])) return { name: name as keyof KernelEvalWeights, length: array.length * 64, rows: array.length };
  return { name: name as keyof KernelEvalWeights, length: array.length };
}));

/** Offset of each field in the flat vector. */
export const WEIGHT_OFFSETS: Readonly<Record<keyof KernelEvalWeights, number>> = (() => {
  const offsets = {} as Record<keyof KernelEvalWeights, number>;
  let offset = 0;
  for (const field of WEIGHT_FIELDS) { offsets[field.name] = offset; offset += field.length; }
  return Object.freeze(offsets);
})();
export const WEIGHT_COUNT = WEIGHT_FIELDS.reduce((sum, field) => sum + field.length, 0);

export const flattenWeights = (weights: KernelEvalWeights): Float64Array => {
  const out = new Float64Array(WEIGHT_COUNT);
  let offset = 0;
  for (const field of WEIGHT_FIELDS) {
    const value = weights[field.name] as number | readonly number[] | readonly (readonly number[])[];
    if (typeof value === 'number') out[offset] = value;
    else if (field.rows) (value as readonly (readonly number[])[]).forEach((row, r) => row.forEach((v, i) => { out[offset + r * 64 + i] = v; }));
    else (value as readonly number[]).forEach((v, i) => { out[offset + i] = v; });
    offset += field.length;
  }
  return out;
};

export const unflattenWeights = (vector: ArrayLike<number>): KernelEvalWeights => {
  if (vector.length !== WEIGHT_COUNT) throw new Error('weight vector has the wrong length');
  const out: Record<string, unknown> = {};
  let offset = 0;
  for (const field of WEIGHT_FIELDS) {
    if (field.length === 1 && !Array.isArray(DEFAULT_KERNEL_EVAL_WEIGHTS[field.name])) out[field.name] = vector[offset];
    else if (field.rows) {
      out[field.name] = Array.from({ length: field.rows }, (_, r) => (
        r === 0 ? [] : Array.from({ length: 64 }, (_, i) => vector[offset + r * 64 + i])));
    } else out[field.name] = Array.from({ length: field.length }, (_, i) => vector[offset + i]);
    offset += field.length;
  }
  return Object.freeze(out) as unknown as KernelEvalWeights;
};

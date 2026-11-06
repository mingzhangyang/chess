/**
 * The kernel evaluation (independent/kernelEvaluation.ts) as a linear
 * function of its weights, for Texel tuning (phase 11).
 *
 * For a position, from white's side:
 *   mg = constMg + sum of weight[i] * coef[i] over middlegame weights
 *   eg = constEg + sum of weight[i] * coef[i] over endgame weights
 *   eval = round((mg * phase + eg * (24 - phase)) / 24) + tempoSign * tempo
 * which is exactly KernelEvaluator.evaluate(position, 'w') for any weights
 * whose fixed fields (kingAttackByType, kingSafetyPct) are the defaults
 * (tests/research/texelTuner.test.ts). The constants are the terms that are
 * not weighted: mop-up and the passed pawns' king distance.
 */
import {
  countRooksBehindPassedPawns, evaluateMopUp, evaluatePassedPawnKingDistance, hasKnightOutpost, MAX_PHASE, POPCOUNT8,
  type EvaluationTuning,
} from '../../../src/utils/chess-ai/chessAIEvaluation';
import { DEFAULT_KERNEL_EVAL_WEIGHTS, WEIGHT_FIELDS, WEIGHT_OFFSETS, type KernelEvalWeights } from '../../../src/utils/chess-ai/independent/kernelEvalWeights';
import { kernelMobility, kingZoneAttackUnits } from '../../../src/utils/chess-ai/independent/kernelEvaluation';
import type { SearchPosition } from '../../../src/utils/chess-ai/searchPosition';

export type WeightClass = 'mg' | 'eg' | 'flat' | 'fixed';
/** The phase each flat weight counts in; 'fixed' weights are not linear and are never tuned. */
export const WEIGHT_CLASS: readonly WeightClass[] = WEIGHT_FIELDS.flatMap((field) => {
  const name = field.name as string;
  const kind: WeightClass = name === 'tempo' ? 'flat'
    : name === 'kingAttackByType' || name === 'kingSafetyPct' ? 'fixed'
      : name.startsWith('king') ? 'mg'
        : name.endsWith('Mg') ? 'mg' : name.endsWith('Eg') ? 'eg' : 'fixed';
  return Array.from({ length: field.length }, () => kind);
});

export type PositionFeatures = {
  phase: number;
  /** +1 white to move, -1 black, 0 with the tempo bonus off. */
  tempoSign: number;
  constMg: number;
  constEg: number;
  index: Int32Array;
  coef: Float64Array;
};

const O = WEIGHT_OFFSETS;
const unpackFiles = (low: number, high: number): Uint8Array => Uint8Array.from([
  low & 0xff, (low >>> 8) & 0xff, (low >>> 16) & 0xff, low >>> 24, high & 0xff, (high >>> 8) & 0xff, (high >>> 16) & 0xff, high >>> 24]);
const atOrAhead = (rank: number, white: boolean): number => (white ? (2 << rank) - 1 : 0xff & ~((1 << rank) - 1));
const ahead = (rank: number, white: boolean): number => (white ? (1 << rank) - 1 : 0xff & ~((2 << rank) - 1));
const hasBit = (mask: number, rank: number): boolean => rank >= 0 && rank < 8 && ((mask >> rank) & 1) === 1;

/** Linear features of `position` (any FEN-built or reached SearchPosition), from white's side. */
export const extractFeatures = (position: SearchPosition, tuning: EvaluationTuning,
  weights: KernelEvalWeights = DEFAULT_KERNEL_EVAL_WEIGHTS): PositionFeatures => {
  if (!tuning.enableTaperedEval || tuning.aiStyle !== 'balanced') throw new Error('only the balanced tapered evaluation is modelled');
  const acc = new Map<number, number>();
  const add = (index: number, value: number) => { if (value !== 0) acc.set(index, (acc.get(index) ?? 0) + value); };
  const both = (mgIndex: number, egIndex: number, value: number) => { add(mgIndex, value); add(egIndex, value); };
  const squares = position.squares;
  const files = position.pawnFileMasks;
  const pawns = { w: unpackFiles(files[0], files[1]), b: unpackFiles(files[2], files[3]) };
  const rooks = { w: new Uint8Array(8), b: new Uint8Array(8) };
  for (let square = 0; square < 64; square += 1) {
    if (squares[square] === 4) rooks.w[square & 7] |= 1 << (square >> 3);
    if (squares[square] === -4) rooks.b[square & 7] |= 1 << (square >> 3);
  }

  // Material, piece-square tables, mobility, rook files and outposts.
  for (let square = 0; square < 64; square += 1) {
    const piece = squares[square];
    if (piece === 0) continue;
    const white = piece > 0;
    const sign = white ? 1 : -1;
    const type = white ? piece : -piece;
    const rank = square >> 3; const file = square & 7;
    const relative = (white ? rank : 7 - rank) * 8 + file;
    if (type !== 6) both(O.materialMg + type, O.materialEg + type, sign);
    both(O.pstMg + type * 64 + relative, O.pstEg + type * 64 + relative, sign);
    if (type < 2 || type > 5) continue;
    const mobility = kernelMobility(position, square, type, white);
    both(O.mobilityMg + type, O.mobilityEg + type, sign * mobility);
    const own = white ? pawns.w : pawns.b; const enemy = white ? pawns.b : pawns.w;
    if (type === 4) {
      if (own[file] === 0) {
        if (enemy[file] === 0) both(O.rookOpenFileMg, O.rookOpenFileEg, sign);
        else both(O.rookSemiOpenFileMg, O.rookSemiOpenFileEg, sign);
      }
      if (rank === (white ? 1 : 6)) both(O.rookSeventhRankMg, O.rookSeventhRankEg, sign);
      if (POPCOUNT8[(white ? rooks.w : rooks.b)[file]] >= 2) both(O.doubledRooksMg, O.doubledRooksEg, sign);
    }
    if (type === 2 && tuning.enableKnightOutpost && hasKnightOutpost(rank, file, white, own, enemy)) {
      both(O.knightOutpostMg, O.knightOutpostEg, sign);
    }
  }
  const bishopPairs = (position.whiteBishopCount >= 2 ? 1 : 0) - (position.blackBishopCount >= 2 ? 1 : 0);
  both(O.bishopPairMg, O.bishopPairEg, bishopPairs);

  // Pawn structure and passed pawns.
  const passed = { w: new Uint8Array(8), b: new Uint8Array(8) };
  for (const color of ['w', 'b'] as const) {
    const white = color === 'w';
    const sign = white ? 1 : -1;
    const mine = pawns[color]; const theirs = white ? pawns.b : pawns.w;
    for (let file = 0; file < 8; file += 1) {
      const filePawns = mine[file];
      if (filePawns === 0) continue;
      const count = POPCOUNT8[filePawns];
      if (count > 1) both(O.doubledPawnMg, O.doubledPawnEg, sign * (count - 1));
      const left = file > 0 ? mine[file - 1] : 0; const right = file < 7 ? mine[file + 1] : 0;
      if (left === 0 && right === 0) both(O.isolatedPawnMg, O.isolatedPawnEg, sign * count);
      const oppLeft = file > 0 ? theirs[file - 1] : 0; const oppRight = file < 7 ? theirs[file + 1] : 0;
      for (let rank = 0; rank < 8; rank += 1) {
        if (((filePawns >> rank) & 1) === 0) continue;
        const blockers = atOrAhead(rank, white);
        if (((oppLeft | theirs[file] | oppRight) & blockers) === 0) {
          const advancement = white ? 7 - rank : rank;
          both(O.passedPawnMg + advancement, O.passedPawnEg + advancement, sign);
          passed[color][file] |= 1 << rank;
        } else if (tuning.enableBackwardPawn && ((left | right) & blockers) === 0 && ((oppLeft | oppRight) & ahead(rank, white)) !== 0) {
          both(O.backwardPawnMg, O.backwardPawnEg, sign);
        }
        const behind = white ? rank + 1 : rank - 1;
        if (hasBit(left, behind) || hasBit(right, behind)) both(O.connectedPawnMg, O.connectedPawnEg, sign);
      }
    }
  }
  const wk = position.whiteKingSquare; const bk = position.blackKingSquare;
  let constMg = 0; let constEg = 0;
  if (passed.w.some((m) => m !== 0) || passed.b.some((m) => m !== 0)) {
    const kingDistanceNet = evaluatePassedPawnKingDistance(passed.w, 'w', wk >> 3, wk & 7, bk >> 3, bk & 7, tuning)
      - evaluatePassedPawnKingDistance(passed.b, 'b', bk >> 3, bk & 7, wk >> 3, wk & 7, tuning);
    constMg += Math.trunc(kingDistanceNet / 2);
    constEg += kingDistanceNet;
    const rooksBehind = countRooksBehindPassedPawns(passed.w, rooks.w, 'w', tuning) - countRooksBehindPassedPawns(passed.b, rooks.b, 'b', tuning);
    both(O.rookBehindPassedMg, O.rookBehindPassedEg, rooksBehind);
  }

  // King safety, middlegame only, scaled by the fixed percentage.
  const scale = weights.kingSafetyPct / 100;
  for (const color of ['w', 'b'] as const) {
    const white = color === 'w';
    const sign = white ? scale : -scale;
    const king = white ? wk : bk;
    const own = pawns[color];
    const kingRank = king >> 3; const kingFile = king & 7;
    const dir = white ? -1 : 1;
    for (let df = -1; df <= 1; df += 1) {
      const f = kingFile + df;
      if (f < 0 || f >= 8) continue;
      const side = df === 0 ? 0 : 1;
      const slot = hasBit(own[f], kingRank + dir) ? side : hasBit(own[f], kingRank + dir * 2) ? 2 + side : own[f] === 0 ? 4 + side : 6 + side;
      add(O.kingShield + slot, sign);
    }
    const units = kingZoneAttackUnits(position, king, color, weights);
    add(O.kingZoneAttack, sign * units);
    if (tuning.enableNonlinearKingSafety && units > 0) add(O.kingZoneAttackQuadratic, sign * Math.floor((units * units) / 64));
  }

  const pawnCount = (m: Uint8Array) => m.reduce((s, v) => s + POPCOUNT8[v], 0);
  constEg += evaluateMopUp(position.whiteNonPawnMaterial, position.blackNonPawnMaterial, pawnCount(pawns.b), wk >> 3, wk & 7, bk >> 3, bk & 7)
    - evaluateMopUp(position.blackNonPawnMaterial, position.whiteNonPawnMaterial, pawnCount(pawns.w), bk >> 3, bk & 7, wk >> 3, wk & 7);

  const entries = [...acc.entries()].filter(([, v]) => v !== 0).sort((a, b) => a[0] - b[0]);
  return {
    phase: Math.max(0, Math.min(MAX_PHASE, position.phaseWeight)),
    tempoSign: tuning.enableTempoBonus ? position.sideToMove : 0,
    constMg, constEg,
    index: Int32Array.from(entries.map(([i]) => i)),
    coef: Float64Array.from(entries.map(([, v]) => v)),
  };
};

/** The evaluation the features give with `weights` (flat), exactly as the kernel rounds it. */
export const linearEvaluation = (features: PositionFeatures, weights: ArrayLike<number>): number => {
  let mg = features.constMg; let eg = features.constEg;
  for (let k = 0; k < features.index.length; k += 1) {
    const i = features.index[k];
    if (WEIGHT_CLASS[i] === 'mg') mg += weights[i] * features.coef[k];
    else eg += weights[i] * features.coef[k];
  }
  return Math.round((mg * features.phase + eg * (MAX_PHASE - features.phase)) / MAX_PHASE)
    + features.tempoSign * weights[WEIGHT_OFFSETS.tempo];
};

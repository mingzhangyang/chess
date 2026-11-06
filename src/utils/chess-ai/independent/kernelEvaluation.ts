/**
 * Evaluation of the independent kernel. Its weights are a KernelEvalWeights
 * object (kernelEvalWeights.ts). With DEFAULT_KERNEL_EVAL_WEIGHTS it returns
 * exactly the score of the shared evaluateBoard (chessAIEvaluation.ts), and
 * therefore of the frozen reference, but takes its inputs from state that is
 * not recomputed per call:
 *
 * - Material and piece-square terms, the game phase, non-pawn material,
 *   bishop counts and per-file pawn masks are maintained by SearchPosition on
 *   every move and undo. Other weights switch the position to their own
 *   material and piece-square tables at the root (usePieceSquareTables).
 * - Pawn-structure terms (doubled, isolated, backward, connected and passed
 *   pawns, and which pawns are passed) depend on the pawns alone. They live in
 *   a fixed typed-array table indexed by the pawn key and verified against the
 *   exact pawn masks, so a key collision can never return another structure's
 *   score. The table belongs to one evaluator, created per search, because the
 *   terms depend on its tuning.
 *
 * Only pieces other than pawns and kings (mobility, rook files, outposts) and
 * the king zone are still evaluated per call, mobility and the king zone from
 * the occupancy bitboards (kernelMobility, kernelKingSafety). The non-tapered evaluation
 * is not the default and is delegated to evaluateBoard unchanged, ignoring the weights.
 * Mop-up and the passed pawns' king distance are not weighted: they stay the shared terms.
 *
 * Every term is an integer or, for king safety, a multiple of one half, so the
 * sums are exact in any order and equal the shared evaluator's sums.
 */
import {
  countRooksBehindPassedPawns, evaluateBoard, evaluateMopUp, evaluatePassedPawnKingDistance,
  hasKnightOutpost, MAX_PHASE, POPCOUNT8, type EvaluationTuning,
} from '../chessAIEvaluation';
import { FIRST_ORTHOGONAL_DIRECTION, KNIGHT_TARGETS, RAY_ASCENDING, RAY_MASKS, RAYS } from '../boardGeometry';
import type { SearchPosition } from '../searchPosition';
import { DEFAULT_KERNEL_EVAL_WEIGHTS, pieceSquareTables, type KernelEvalWeights } from './kernelEvalWeights';

const KNIGHT = 2;
const BISHOP = 3;
const ROOK = 4;
const KING = 6;

// --- Bitboard tables for mobility and the king zone (two 32-bit words per mask) ---
const KNIGHT_MASKS = new Int32Array(128);
const KING_ZONE_MASKS = new Int32Array(128);
const RAY_LENGTHS = new Int8Array(64 * 8);
/** Chebyshev distance, which along a ray is the number of steps. */
const DISTANCE = new Int8Array(64 * 64);
for (let square = 0; square < 64; square += 1) {
  for (const target of KNIGHT_TARGETS[square]) KNIGHT_MASKS[square * 2 + (target >> 5)] |= 1 << (target & 31);
  for (let direction = 0; direction < 8; direction += 1) RAY_LENGTHS[square * 8 + direction] = RAYS[square][direction].length;
  for (let other = 0; other < 64; other += 1) {
    const rankGap = Math.abs((square >> 3) - (other >> 3));
    const fileGap = Math.abs((square & 7) - (other & 7));
    DISTANCE[square * 64 + other] = Math.max(rankGap, fileGap);
    if (rankGap <= 2 && fileGap <= 2) KING_ZONE_MASKS[square * 2 + (other >> 5)] |= 1 << (other & 31);
  }
}
const popcount32 = (value: number): number => {
  let v = value - ((value >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return (Math.imul((v + (v >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24);
};
const lowestBit = (value: number): number => 31 - Math.clz32(value & -value);

/**
 * pseudoMobility (chessAIEvaluation.ts) from the occupancy bitboards: empty
 * or enemy squares a knight, bishop, rook or queen attacks. Along each ray
 * the nearest occupied square ends it; it counts when it holds an enemy.
 */
export const kernelMobility = (position: SearchPosition, square: number, type: number, white: boolean): number => {
  const occupancy = position.occupancy;
  const ownLow = white ? occupancy[0] : occupancy[2];
  const ownHigh = white ? occupancy[1] : occupancy[3];
  if (type === KNIGHT) return popcount32(KNIGHT_MASKS[square * 2] & ~ownLow) + popcount32(KNIGHT_MASKS[square * 2 + 1] & ~ownHigh);
  const allLow = occupancy[0] | occupancy[2];
  const allHigh = occupancy[1] | occupancy[3];
  let count = 0;
  const last = type === BISHOP ? FIRST_ORTHOGONAL_DIRECTION : 8;
  for (let direction = type === ROOK ? FIRST_ORTHOGONAL_DIRECTION : 0; direction < last; direction += 1) {
    const mask = (square * 8 + direction) * 2;
    const blockLow = RAY_MASKS[mask] & allLow;
    const blockHigh = RAY_MASKS[mask + 1] & allHigh;
    if (blockLow === 0 && blockHigh === 0) { count += RAY_LENGTHS[square * 8 + direction]; continue; }
    const blocker = RAY_ASCENDING[direction]
      ? (blockLow !== 0 ? lowestBit(blockLow) : 32 + lowestBit(blockHigh))
      : (blockHigh !== 0 ? 63 - Math.clz32(blockHigh) : 31 - Math.clz32(blockLow));
    const own = ((blocker < 32 ? ownLow >>> blocker : ownHigh >>> (blocker - 32)) & 1) !== 0;
    count += DISTANCE[square * 64 + blocker] - (own ? 1 : 0);
  }
  return count;
};

const hasRank = (mask: number, rank: number): boolean => rank >= 0 && rank < 8 && ((mask >> rank) & 1) === 1;

/**
 * evaluateKingSafety (chessAIEvaluation.ts) for the king on `king`, with the
 * weights' shield and attack values: the pawn shield, and the enemy knights,
 * bishops, rooks and queens in the 5x5 zone around it, found in the officer
 * and occupancy bitboards instead of scanning 25 squares. With the default
 * weights it equals the shared function (tests/client/bitboardAttacks.test.ts).
 */
export const kernelKingSafety = (position: SearchPosition, king: number, myPawns: Uint8Array, color: 'w' | 'b',
  tuning: EvaluationTuning, weights: KernelEvalWeights = DEFAULT_KERNEL_EVAL_WEIGHTS): number => {
  const kingRank = king >> 3; const kingFile = king & 7;
  const shield = weights.kingShield;
  let score = 0;
  const shieldDir = color === 'w' ? -1 : 1;
  for (let df = -1; df <= 1; df += 1) {
    const f = kingFile + df;
    if (f < 0 || f >= 8) continue;
    const side = df === 0 ? 0 : 1;
    if (hasRank(myPawns[f], kingRank + shieldDir)) score += shield[side];
    else if (hasRank(myPawns[f], kingRank + shieldDir * 2)) score += shield[2 + side];
    else if (myPawns[f] === 0) score += shield[4 + side];
    else score += shield[6 + side];
  }
  const cappedAttack = kingZoneAttackUnits(position, king, color, weights);
  score += cappedAttack * weights.kingZoneAttack;
  if (tuning.enableNonlinearKingSafety && cappedAttack > 0) {
    score += Math.floor((cappedAttack * cappedAttack) / 64) * weights.kingZoneAttackQuadratic;
  }
  return score;
};

/** Attack units of the enemy officers in the 5x5 zone of the king on `king`, capped at 80. */
export const kingZoneAttackUnits = (position: SearchPosition, king: number, color: 'w' | 'b',
  weights: KernelEvalWeights = DEFAULT_KERNEL_EVAL_WEIGHTS): number => {
  const occupancy = position.occupancy;
  const officers = position.officerOccupancy;
  const enemy = color === 'w' ? 2 : 0;
  const squares = position.squares;
  const byType = weights.kingAttackByType;
  let attackScore = 0;
  for (let word = 0; word < 2; word += 1) {
    let bits = KING_ZONE_MASKS[king * 2 + word] & officers[word] & occupancy[enemy + word];
    while (bits !== 0) {
      const bit = bits & -bits;
      bits ^= bit;
      const piece = squares[(word << 5) | (31 - Math.clz32(bit))];
      attackScore += byType[piece > 0 ? piece : -piece];
    }
  }
  return Math.min(attackScore, 80);
};

export const KERNEL_PAWN_TABLE_DEFAULT_BITS = 12;
/**
 * Pawn-table slot layout (Int32 words):
 *   [0..3]  pawn file masks, as SearchPosition.pawnFileMasks (the verification)
 *   [4]     1 when the slot is filled
 *   [5] [6] white pawn-structure score (passed pawns included), middlegame and endgame
 *   [7] [8] the same for black
 *   [9..10] white passed-pawn file masks, packed like the pawn masks
 *   [11..12] black passed-pawn file masks
 *   [13] [14] white and black pawn counts
 */
const SLOT = 16;

const unpack = (low: number, high: number, out: Uint8Array): void => {
  out[0] = low & 0xff; out[1] = (low >>> 8) & 0xff; out[2] = (low >>> 16) & 0xff; out[3] = low >>> 24;
  out[4] = high & 0xff; out[5] = (high >>> 8) & 0xff; out[6] = (high >>> 16) & 0xff; out[7] = high >>> 24;
};
const packLow = (files: Uint8Array): number => files[0] | (files[1] << 8) | (files[2] << 16) | (files[3] << 24);
const packHigh = (files: Uint8Array): number => files[4] | (files[5] << 8) | (files[6] << 16) | (files[7] << 24);
const countPawns = (files: Uint8Array): number => {
  let count = 0;
  for (let file = 0; file < 8; file += 1) count += POPCOUNT8[files[file]];
  return count;
};

// Ranks at or nearer the promotion rank than `rank`, and strictly nearer (bit r = rank index r, 0 = eighth rank).
const atOrAhead = (rank: number, white: boolean): number => (white ? (2 << rank) - 1 : 0xff & ~((1 << rank) - 1));
const ahead = (rank: number, white: boolean): number => (white ? (1 << rank) - 1 : 0xff & ~((2 << rank) - 1));
const hasBit = (mask: number, rank: number): boolean => rank >= 0 && rank < 8 && ((mask >> rank) & 1) === 1;

/**
 * evaluatePawnStructure (chessAIEvaluation.ts) with the weights' middlegame
 * and endgame values: doubled, isolated, backward, connected and passed
 * pawns of one side. Marks the passed pawns in `passed`; writes the
 * middlegame and endgame scores to out[0] and out[1].
 */
export const kernelPawnStructure = (myPawns: Uint8Array, oppPawns: Uint8Array, white: boolean, tuning: EvaluationTuning,
  passed: Uint8Array, weights: KernelEvalWeights, out: Int32Array | number[]): void => {
  let mg = 0; let eg = 0;
  for (let file = 0; file < 8; file += 1) {
    passed[file] = 0;
    const pawns = myPawns[file];
    if (pawns === 0) continue;
    const count = POPCOUNT8[pawns];
    if (count > 1) { mg += weights.doubledPawnMg * (count - 1); eg += weights.doubledPawnEg * (count - 1); }
    const left = file > 0 ? myPawns[file - 1] : 0;
    const right = file < 7 ? myPawns[file + 1] : 0;
    if (left === 0 && right === 0) { mg += weights.isolatedPawnMg * count; eg += weights.isolatedPawnEg * count; }
    const oppLeft = file > 0 ? oppPawns[file - 1] : 0;
    const oppRight = file < 7 ? oppPawns[file + 1] : 0;
    for (let rank = 0; rank < 8; rank += 1) {
      if (((pawns >> rank) & 1) === 0) continue;
      const blockers = atOrAhead(rank, white);
      const isPassed = ((oppLeft | oppPawns[file] | oppRight) & blockers) === 0;
      if (isPassed) {
        const advancement = white ? 7 - rank : rank;
        mg += weights.passedPawnMg[advancement]; eg += weights.passedPawnEg[advancement];
        passed[file] |= 1 << rank;
      } else if (tuning.enableBackwardPawn && ((left | right) & blockers) === 0 && ((oppLeft | oppRight) & ahead(rank, white)) !== 0) {
        // Support is an adjacent friendly pawn level with or nearer promotion, as in the shared evaluator.
        mg += weights.backwardPawnMg; eg += weights.backwardPawnEg;
      }
      const behind = white ? rank + 1 : rank - 1;
      if (hasBit(left, behind) || hasBit(right, behind)) { mg += weights.connectedPawnMg; eg += weights.connectedPawnEg; }
    }
  }
  out[0] = mg; out[1] = eg;
};

/** Style terms of the evaluator for the pieces of the side being evaluated; the same amount goes to both phases. */
const styleTerm = (squares: Int8Array, myWhite: boolean, aggressive: boolean, myKing: number, oppKing: number): number => {
  let score = 0;
  const myKingRank = myKing >> 3; const myKingFile = myKing & 7;
  const oppKingRank = oppKing >> 3; const oppKingFile = oppKing & 7;
  for (let square = 0; square < 64; square += 1) {
    const piece = squares[square];
    if (piece === 0 || (piece > 0) !== myWhite) continue;
    const type = piece > 0 ? piece : -piece;
    const rank = square >> 3;
    const file = square & 7;
    if (aggressive) {
      if (type !== KING && type !== 1) score += (14 - (Math.abs(rank - oppKingRank) + Math.abs(file - oppKingFile))) * 2;
      if (rank >= 2 && rank <= 5 && file >= 2 && file <= 5) score += 10;
    } else if (type !== KING) {
      const dist = Math.abs(rank - myKingRank) + Math.abs(file - myKingFile);
      if (dist <= 2) score += 15;
      else if (dist > 5 && type !== 1) score -= 5;
    }
  }
  return score;
};

export class KernelEvaluator {
  private readonly table: Int32Array;
  private readonly mask: number;
  private readonly whitePawns = new Uint8Array(8);
  private readonly blackPawns = new Uint8Array(8);
  private readonly whitePassed = new Uint8Array(8);
  private readonly blackPassed = new Uint8Array(8);
  private readonly whiteRooks = new Uint8Array(8);
  private readonly blackRooks = new Uint8Array(8);
  /** Squares of knights, bishops, rooks and queens of the current call. */
  private readonly pieces = new Int8Array(64);
  /** Offset of the current position's slot after `loadPawns`. */
  private slot = 0;
  private readonly pawnScores = new Int32Array(2);
  private readonly psqMg: Int32Array;
  private readonly psqEg: Int32Array;
  /** Probe statistics, for tuning the table size. */
  probes = 0;
  hits = 0;

  constructor(private readonly tuning: EvaluationTuning, sizeBits = KERNEL_PAWN_TABLE_DEFAULT_BITS,
    private readonly weights: KernelEvalWeights = DEFAULT_KERNEL_EVAL_WEIGHTS) {
    if (!Number.isInteger(sizeBits) || sizeBits < 0 || sizeBits > 20) throw new Error('invalid pawn table size');
    const pawnWeights = [weights.doubledPawnMg, weights.doubledPawnEg, weights.isolatedPawnMg, weights.isolatedPawnEg,
      weights.backwardPawnMg, weights.backwardPawnEg, weights.connectedPawnMg, weights.connectedPawnEg,
      ...weights.passedPawnMg, ...weights.passedPawnEg];
    if (!pawnWeights.every(Number.isInteger)) throw new Error('pawn-structure weights must be integers');
    this.mask = 2 ** sizeBits - 1;
    this.table = new Int32Array(2 ** sizeBits * SLOT);
    ({ mg: this.psqMg, eg: this.psqEg } = pieceSquareTables(weights));
  }

  /** Unpack the pawn and passed-pawn files of `position`, computing its pawn terms on a miss. */
  private loadPawns(position: SearchPosition): void {
    const files = position.pawnFileMasks;
    const table = this.table;
    const slot = (position.pawnKey & this.mask) * SLOT;
    this.slot = slot;
    unpack(files[0], files[1], this.whitePawns);
    unpack(files[2], files[3], this.blackPawns);
    this.probes += 1;
    if (table[slot + 4] === 1 && table[slot] === files[0] && table[slot + 1] === files[1]
      && table[slot + 2] === files[2] && table[slot + 3] === files[3]) {
      this.hits += 1;
      unpack(table[slot + 9], table[slot + 10], this.whitePassed);
      unpack(table[slot + 11], table[slot + 12], this.blackPassed);
      return;
    }
    const scores = this.pawnScores;
    kernelPawnStructure(this.whitePawns, this.blackPawns, true, this.tuning, this.whitePassed, this.weights, scores);
    table[slot + 5] = scores[0]; table[slot + 6] = scores[1];
    kernelPawnStructure(this.blackPawns, this.whitePawns, false, this.tuning, this.blackPassed, this.weights, scores);
    table[slot + 7] = scores[0]; table[slot + 8] = scores[1];
    table[slot] = files[0]; table[slot + 1] = files[1]; table[slot + 2] = files[2]; table[slot + 3] = files[3];
    table[slot + 4] = 1;
    table[slot + 9] = packLow(this.whitePassed); table[slot + 10] = packHigh(this.whitePassed);
    table[slot + 11] = packLow(this.blackPassed); table[slot + 12] = packHigh(this.blackPassed);
    table[slot + 13] = countPawns(this.whitePawns); table[slot + 14] = countPawns(this.blackPawns);
  }

  /** The evaluateBoard score of `position` from `color`'s side. */
  evaluate(position: SearchPosition, color: 'w' | 'b'): number {
    const tuning = this.tuning;
    if (!tuning.enableTaperedEval) return evaluateBoard(position, color, tuning);
    const weights = this.weights;
    // Positions start on the shared tables; switching is a no-op when they match.
    if (position.pieceSquareTableMg !== this.psqMg || position.pieceSquareTableEg !== this.psqEg) {
      position.usePieceSquareTables(this.psqMg, this.psqEg);
    }
    this.loadPawns(position);
    const table = this.table;
    const slot = this.slot;
    const squares = position.squares;
    const myWhite = color === 'w';
    const opponent = myWhite ? 'b' : 'w';
    const myPawns = myWhite ? this.whitePawns : this.blackPawns;
    const oppPawns = myWhite ? this.blackPawns : this.whitePawns;
    const myPassed = myWhite ? this.whitePassed : this.blackPassed;
    const oppPassed = myWhite ? this.blackPassed : this.whitePassed;
    const myRooks = myWhite ? this.whiteRooks : this.blackRooks;
    const oppRooks = myWhite ? this.blackRooks : this.whiteRooks;
    const myKing = myWhite ? position.whiteKingSquare : position.blackKingSquare;
    const oppKing = myWhite ? position.blackKingSquare : position.whiteKingSquare;
    const myKingRank = myKing >> 3; const myKingFile = myKing & 7;
    const oppKingRank = oppKing >> 3; const oppKingFile = oppKing & 7;

    // Pieces other than pawns and kings, and the rook files they need first.
    const whiteRooks = this.whiteRooks; const blackRooks = this.blackRooks;
    for (let file = 0; file < 8; file += 1) { whiteRooks[file] = 0; blackRooks[file] = 0; }
    const pieces = this.pieces;
    const officers = position.officerOccupancy;
    let pieceCount = 0;
    for (let word = 0; word < 2; word += 1) {
      let bits = officers[word];
      while (bits !== 0) {
        const bit = bits & -bits;
        bits ^= bit;
        const square = (word << 5) | (31 - Math.clz32(bit));
        pieces[pieceCount++] = square;
        const piece = squares[square];
        if (piece === ROOK) whiteRooks[square & 7] |= 1 << (square >> 3);
        else if (piece === -ROOK) blackRooks[square & 7] |= 1 << (square >> 3);
      }
    }

    const sign = myWhite ? 1 : -1;
    let mg = sign * position.pieceSquareMg;
    let eg = sign * position.pieceSquareEg;
    for (let index = 0; index < pieceCount; index += 1) {
      const square = pieces[index];
      const piece = squares[square];
      const white = piece > 0;
      const type = white ? piece : -piece;
      const mine = white === myWhite;
      const rank = square >> 3;
      const file = square & 7;
      let mgSigned = 0;
      let egSigned = 0;
      if (type === ROOK) {
        const friendlyPawns = mine ? myPawns : oppPawns;
        const enemyPawns = mine ? oppPawns : myPawns;
        const rooks = mine ? myRooks : oppRooks;
        if (friendlyPawns[file] === 0) {
          if (enemyPawns[file] === 0) { mgSigned += weights.rookOpenFileMg; egSigned += weights.rookOpenFileEg; }
          else { mgSigned += weights.rookSemiOpenFileMg; egSigned += weights.rookSemiOpenFileEg; }
        }
        if (rank === (white ? 1 : 6)) { mgSigned += weights.rookSeventhRankMg; egSigned += weights.rookSeventhRankEg; }
        if (POPCOUNT8[rooks[file]] >= 2) { mgSigned += weights.doubledRooksMg; egSigned += weights.doubledRooksEg; }
      }
      const mobility = kernelMobility(position, square, type, white);
      mgSigned += mobility * weights.mobilityMg[type];
      egSigned += mobility * weights.mobilityEg[type];
      if (type === KNIGHT && tuning.enableKnightOutpost
        && hasKnightOutpost(rank, file, white, mine ? myPawns : oppPawns, mine ? oppPawns : myPawns)) {
        mgSigned += weights.knightOutpostMg;
        egSigned += weights.knightOutpostEg;
      }
      if (mine) { mg += mgSigned; eg += egSigned; } else { mg -= mgSigned; eg -= egSigned; }
    }

    if (tuning.aiStyle !== 'balanced') {
      const style = styleTerm(squares, myWhite, tuning.aiStyle === 'aggressive', myKing, oppKing);
      mg += style;
      eg += style;
    }

    const myBishops = myWhite ? position.whiteBishopCount : position.blackBishopCount;
    const oppBishops = myWhite ? position.blackBishopCount : position.whiteBishopCount;
    const bishopPairs = (myBishops >= 2 ? 1 : 0) - (oppBishops >= 2 ? 1 : 0);
    mg += bishopPairs * weights.bishopPairMg;
    eg += bishopPairs * weights.bishopPairEg;

    const mine = myWhite ? 5 : 7;
    const theirs = myWhite ? 7 : 5;
    mg += table[slot + mine] - table[slot + theirs];
    eg += table[slot + mine + 1] - table[slot + theirs + 1];

    if ((table[slot + 9] | table[slot + 10] | table[slot + 11] | table[slot + 12]) !== 0) {
      const kingDistanceNet = evaluatePassedPawnKingDistance(myPassed, color, myKingRank, myKingFile, oppKingRank, oppKingFile, tuning)
        - evaluatePassedPawnKingDistance(oppPassed, opponent, oppKingRank, oppKingFile, myKingRank, myKingFile, tuning);
      mg += Math.trunc(kingDistanceNet / 2);
      eg += kingDistanceNet;
      const rooksBehindNet = countRooksBehindPassedPawns(myPassed, myRooks, color, tuning)
        - countRooksBehindPassedPawns(oppPassed, oppRooks, opponent, tuning);
      mg += rooksBehindNet * weights.rookBehindPassedMg;
      eg += rooksBehindNet * weights.rookBehindPassedEg;
    }

    const kingSafetyNet = kernelKingSafety(position, myKing, myPawns, color, tuning, weights)
      - kernelKingSafety(position, oppKing, oppPawns, opponent, tuning, weights);
    mg += (kingSafetyNet * weights.kingSafetyPct) / 100;

    const myNonPawn = myWhite ? position.whiteNonPawnMaterial : position.blackNonPawnMaterial;
    const oppNonPawn = myWhite ? position.blackNonPawnMaterial : position.whiteNonPawnMaterial;
    const myPawnCount = table[slot + (myWhite ? 13 : 14)];
    const oppPawnCount = table[slot + (myWhite ? 14 : 13)];
    eg += evaluateMopUp(myNonPawn, oppNonPawn, oppPawnCount, myKingRank, myKingFile, oppKingRank, oppKingFile)
      - evaluateMopUp(oppNonPawn, myNonPawn, myPawnCount, oppKingRank, oppKingFile, myKingRank, myKingFile);

    const phase = Math.max(0, Math.min(MAX_PHASE, position.phaseWeight));
    let score = Math.round((mg * phase + eg * (MAX_PHASE - phase)) / MAX_PHASE);
    if (tuning.enableTempoBonus) score += (position.sideToMove === 1) === myWhite ? weights.tempo : -weights.tempo;
    return score;
  }
}

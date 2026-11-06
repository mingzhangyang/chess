import { FIRST_ORTHOGONAL_DIRECTION, KNIGHT_TARGETS, RAYS } from './boardGeometry';
import { getSquares, searchTurn, type SearchGame } from './chessAIBoardOps';
import {
  DEFAULT_EVAL_WEIGHTS, KING_ENDGAME_PST, PHASE_BY_TYPE, PIECE_VALUES, PST_BY_TYPE, TYPE_LETTERS, type EvalWeights,
} from './evaluationTables';

export { DEFAULT_EVAL_WEIGHTS, PIECE_VALUES, type EvalWeights };

// The evaluator reads the signed 64-square board of SearchPosition (a8 = 0,
// white > 0); chess.js games are converted once per call by getSquares.
const PAWN = 1;
const KNIGHT = 2;
const BISHOP = 3;
const ROOK = 4;
const QUEEN = 5;
const KING = 6;
const _squaresScratch = new Int8Array(64);
const _occupied = new Int8Array(64);

export type EvalStyle = 'aggressive' | 'defensive' | 'balanced';

export interface EvaluationTuning {
  aiStyle: EvalStyle;
  enableTaperedEval: boolean;
  enableNonlinearKingSafety: boolean;
  enableBackwardPawn: boolean;
  enableKnightOutpost: boolean;
  enablePassedPawnKingDistance: boolean;
  enableRookBehindPassedPawn: boolean;
  enableTempoBonus: boolean;
}

const PASSED_PAWN_BONUS = [0, 0, 10, 20, 40, 60, 90, 130];
const KNIGHT_OUTPOST_MG_BONUS = 24;
const PASSED_PAWN_KING_DISTANCE_FACTOR = 3;
export const ROOK_BEHIND_PASSED_PAWN_MG_BONUS = 16;
export const ROOK_BEHIND_PASSED_PAWN_EG_BONUS = 28;
export const TEMPO_BONUS = 10;

const PAWN_SHIELD_DIRECT_BONUS = 15;
const PAWN_SHIELD_SIDE_BONUS = 12;
const PAWN_SHIELD2_DIRECT_BONUS = 8;
const PAWN_SHIELD2_SIDE_BONUS = 6;
const OPEN_FILE_KING_PENALTY = -25;
const OPEN_FILE_KING_PENALTY_SIDE = -15;
const SEMI_OPEN_KING_PENALTY = -12;
const SEMI_OPEN_KING_PENALTY_SIDE = -7;
const KING_ZONE_ATTACK_PENALTY = -3;
const KING_ZONE_ATTACK_QUADRATIC_PENALTY = -1;
const KING_ZONE_ATTACK_QUADRATIC_DIVISOR = 64;
const KING_ATTACK_BY_TYPE = [0, 0, 4, 4, 7, 10, 0] as const;

const OPEN_FILE_ROOK_BONUS = 25;
const SEMI_OPEN_FILE_ROOK_BONUS = 12;
const SEVENTH_RANK_ROOK_BONUS = 40;
const DOUBLED_ROOK_BONUS = 15;

const BISHOP_PAIR_BONUS = 40;
const MOBILITY_FACTOR = 2;


// The term functions below are exported for the kernel evaluator
// (independent/kernelEvaluation.ts), which feeds them incremental and cached
// inputs instead of a census of the board.

// Per-file rank bitmasks (bit r = rank index r, 0 = eighth rank) for the
// side being evaluated ("my") and its opponent. Reused across calls.
const _myPawns = new Uint8Array(8);
const _oppPawns = new Uint8Array(8);
const _myRooks = new Uint8Array(8);
const _oppRooks = new Uint8Array(8);
const _myPassed = new Uint8Array(8);
const _oppPassed = new Uint8Array(8);
export const POPCOUNT8 = Uint8Array.from({ length: 256 }, (_, mask) => {
  let count = 0;
  for (let bit = mask; bit; bit &= bit - 1) count++;
  return count;
});
// Ranks at or nearer the promotion rank than `rank`, and strictly nearer.
const AT_OR_AHEAD = [(rank: number) => 0xff & ~((1 << rank) - 1), (rank: number) => (2 << rank) - 1];
const AHEAD = [(rank: number) => 0xff & ~((2 << rank) - 1), (rank: number) => (1 << rank) - 1];
const atOrAhead = (rank: number, white: boolean): number => AT_OR_AHEAD[white ? 1 : 0](rank);
const ahead = (rank: number, white: boolean): number => AHEAD[white ? 1 : 0](rank);
const hasBit = (mask: number, rank: number): boolean => rank >= 0 && rank < 8 && ((mask >> rank) & 1) === 1;

const resetStructures = (): void => {
  for (let file = 0; file < 8; file++) {
    _myPawns[file] = 0; _oppPawns[file] = 0; _myRooks[file] = 0; _oppRooks[file] = 0;
  }
};

const PIECE_VALUE_BY_TYPE = TYPE_LETTERS.map((letter) => (letter ? PIECE_VALUES[letter] : 0));

type WeightTables = { materialMg: number[]; materialEg: number[]; mobilityMg: number[]; mobilityEg: number[] };
const _weightTables = new WeakMap<EvalWeights, WeightTables>();
// Per-type views of a weights object. Weights are treated as immutable.
const getWeightTables = (weights: EvalWeights): WeightTables => {
  let tables = _weightTables.get(weights);
  if (!tables) {
    const byType = (values: Record<string, number>) => TYPE_LETTERS.map((letter) => (letter ? values[letter] ?? 0 : 0));
    tables = { materialMg: byType(weights.materialMg), materialEg: byType(weights.materialEg),
      mobilityMg: byType(weights.mobilityMg), mobilityEg: byType(weights.mobilityEg) };
    _weightTables.set(weights, tables);
  }
  return tables;
};
export const MAX_PHASE = 24;

// Mop-up: with a decisive material edge against a bare (or nearly bare) king,
// reward driving that king to the edge and walking our own king towards it.
// Basic mates are far beyond the search horizon otherwise, and the endgame
// king table alone is too weak to stop the engine shuffling into a 50-move draw.
const MOPUP_EDGE_WEIGHT = 10;
const MOPUP_KING_PROXIMITY_WEIGHT = 10;
const MOPUP_MAX_WEAK_MATERIAL = 330; // at most one minor piece
const MOPUP_MIN_MATERIAL_EDGE = 400; // e.g. a rook against nothing

const centerDistance = (rank: number, file: number): number =>
  Math.max(3 - rank, rank - 4) + Math.max(3 - file, file - 4);

export const evaluateMopUp = (
  strongNonPawnMaterial: number,
  weakNonPawnMaterial: number,
  weakPawnCount: number,
  strongKingRank: number,
  strongKingFile: number,
  weakKingRank: number,
  weakKingFile: number,
): number => {
  if (
    weakPawnCount > 0
    || weakNonPawnMaterial > MOPUP_MAX_WEAK_MATERIAL
    || strongNonPawnMaterial - weakNonPawnMaterial < MOPUP_MIN_MATERIAL_EDGE
  ) {
    return 0;
  }
  const kingDistance = Math.abs(strongKingRank - weakKingRank) + Math.abs(strongKingFile - weakKingFile);
  return MOPUP_EDGE_WEIGHT * centerDistance(weakKingRank, weakKingFile)
    + MOPUP_KING_PROXIMITY_WEIGHT * (14 - kingDistance);
};

const getSquareBonus = (
  type: number,
  rank: number,
  file: number,
  white: boolean,
  isEndgame = false,
): number => {
  const table = type === KING && isEndgame ? KING_ENDGAME_PST : PST_BY_TYPE[type];
  return table[(white ? rank : 7 - rank) * 8 + file];
};

const isPassedPawn = (file: number, rank: number, white: boolean, oppPawns: Uint8Array): boolean => {
  const blockers = atOrAhead(rank, white);
  for (let f = Math.max(0, file - 1); f <= Math.min(7, file + 1); f++) {
    if (oppPawns[f] & blockers) return false;
  }
  return true;
};

// evaluatePawnStructure() also reports the passed-pawn part of its score here,
// and marks passed pawns in the `passed` masks it is given, so later terms do
// not re-derive them.
let _lastPassedPawnScore = 0;
/** The passed-pawn part of the last evaluatePawnStructure() result. */
export const lastPassedPawnScore = (): number => _lastPassedPawnScore;

export const evaluatePawnStructure = (
  myPawns: Uint8Array,
  oppPawns: Uint8Array,
  color: 'w' | 'b',
  tuning: EvaluationTuning,
  passed: Uint8Array,
  weights: EvalWeights,
): number => {
  const white = color === 'w';
  let score = 0;
  let passedScore = 0;
  for (let file = 0; file < 8; file++) {
    passed[file] = 0;
    const pawns = myPawns[file];
    if (pawns === 0) continue;
    const count = POPCOUNT8[pawns];
    if (count > 1) {
      score += weights.doubledPawn * (count - 1);
    }
    const hasLeft = file > 0 && myPawns[file - 1] !== 0;
    const hasRight = file < 7 && myPawns[file + 1] !== 0;
    if (!hasLeft && !hasRight) {
      score += weights.isolatedPawn * count;
    }
    for (let rank = 0; rank < 8; rank++) {
      if (((pawns >> rank) & 1) === 0) continue;
      const isPassed = isPassedPawn(file, rank, white, oppPawns);
      if (isPassed) {
        const adv = white ? 7 - rank : rank;
        passedScore += PASSED_PAWN_BONUS[adv] ?? 0;
        passed[file] |= 1 << rank;
      }

      if (tuning.enableBackwardPawn && !isPassed) {
        // Matches the tuned evaluator: an adjacent friendly pawn level with or
        // nearer promotion counts as support. (The textbook definition uses
        // pawns level with or behind; changing it needs retuning and a match.)
        const supportRanks = atOrAhead(rank, white);
        const hasAdjacentSupport = (file > 0 && (myPawns[file - 1] & supportRanks) !== 0)
          || (file < 7 && (myPawns[file + 1] & supportRanks) !== 0);
        if (!hasAdjacentSupport) {
          const enemyRanks = ahead(rank, white);
          const enemyAheadOnAdjacent = (file > 0 && (oppPawns[file - 1] & enemyRanks) !== 0)
            || (file < 7 && (oppPawns[file + 1] & enemyRanks) !== 0);
          if (enemyAheadOnAdjacent) {
            score += weights.backwardPawn;
          }
        }
      }
      const behindRank = white ? rank + 1 : rank - 1;
      if ((file > 0 && hasBit(myPawns[file - 1], behindRank)) || (file < 7 && hasBit(myPawns[file + 1], behindRank))) {
        score += weights.connectedPawn;
      }
    }
  }
  _lastPassedPawnScore = passedScore;
  return score + passedScore;
};

export const evaluatePassedPawnKingDistance = (
  passed: Uint8Array,
  color: 'w' | 'b',
  myKingRank: number,
  myKingFile: number,
  oppKingRank: number,
  oppKingFile: number,
  tuning: EvaluationTuning,
): number => {
  if (!tuning.enablePassedPawnKingDistance) return 0;

  let score = 0;
  const promotionRank = color === 'w' ? 0 : 7;
  for (let file = 0; file < 8; file++) {
    const pawns = passed[file];
    if (pawns === 0) continue;
    for (let rank = 0; rank < 8; rank++) {
      if (((pawns >> rank) & 1) === 0) continue;
      const ownKingDist = Math.abs(myKingRank - promotionRank) + Math.abs(myKingFile - file);
      const oppKingDist = Math.abs(oppKingRank - promotionRank) + Math.abs(oppKingFile - file);
      const distanceDelta = oppKingDist - ownKingDist;
      const stepsToPromotion = color === 'w' ? rank : 7 - rank;
      const advancement = Math.max(1, 7 - stepsToPromotion);
      score += Math.trunc((distanceDelta * PASSED_PAWN_KING_DISTANCE_FACTOR * advancement) / 4);
    }
  }

  return score;
};

// Number of passed pawns with a friendly rook behind them.
export const countRooksBehindPassedPawns = (
  passed: Uint8Array,
  myRooks: Uint8Array,
  color: 'w' | 'b',
  tuning: EvaluationTuning,
): number => {
  if (!tuning.enableRookBehindPassedPawn) return 0;

  const white = color === 'w';
  let count = 0;
  for (let file = 0; file < 8; file++) {
    const rooks = myRooks[file];
    const pawns = passed[file];
    if (rooks === 0 || pawns === 0) continue;
    for (let rank = 0; rank < 8; rank++) {
      // "Behind" is further from the promotion rank than the pawn.
      if (((pawns >> rank) & 1) === 1 && (rooks & ~atOrAhead(rank, white) & 0xff) !== 0) count += 1;
    }
  }

  return count;
};

export const evaluateKingSafety = (
  squares: Int8Array,
  kingRank: number,
  kingFile: number,
  myPawns: Uint8Array,
  color: 'w' | 'b',
  tuning: EvaluationTuning,
): number => {
  let score = 0;
  const shieldDir = color === 'w' ? -1 : 1;
  for (let df = -1; df <= 1; df++) {
    const f = kingFile + df;
    if (f < 0 || f >= 8) continue;
    const pawn1 = hasBit(myPawns[f], kingRank + shieldDir);
    const pawn2 = hasBit(myPawns[f], kingRank + shieldDir * 2);
    if (pawn1) {
      score += df === 0 ? PAWN_SHIELD_DIRECT_BONUS : PAWN_SHIELD_SIDE_BONUS;
    } else if (pawn2) {
      score += df === 0 ? PAWN_SHIELD2_DIRECT_BONUS : PAWN_SHIELD2_SIDE_BONUS;
    } else if (myPawns[f] === 0) {
      score += df === 0 ? OPEN_FILE_KING_PENALTY : OPEN_FILE_KING_PENALTY_SIDE;
    } else {
      score += df === 0 ? SEMI_OPEN_KING_PENALTY : SEMI_OPEN_KING_PENALTY_SIDE;
    }
  }

  let attackScore = 0;
  for (let r = Math.max(0, kingRank - 2); r <= Math.min(7, kingRank + 2); r++) {
    for (let f = Math.max(0, kingFile - 2); f <= Math.min(7, kingFile + 2); f++) {
      const piece = squares[r * 8 + f];
      // An enemy piece: its sign differs from ours. Pawns and kings weigh 0.
      if (piece !== 0 && (piece > 0) !== (color === 'w')) {
        attackScore += KING_ATTACK_BY_TYPE[piece > 0 ? piece : -piece];
      }
    }
  }
  const cappedAttack = Math.min(attackScore, 80);
  score += cappedAttack * KING_ZONE_ATTACK_PENALTY;
  if (tuning.enableNonlinearKingSafety && cappedAttack > 0) {
    const nonlinearUnits = Math.floor((cappedAttack * cappedAttack) / KING_ZONE_ATTACK_QUADRATIC_DIVISOR);
    score += nonlinearUnits * KING_ZONE_ATTACK_QUADRATIC_PENALTY;
  }
  return score;
};

// Empty or enemy-occupied squares a piece attacks.
export const pseudoMobility = (
  squares: Int8Array,
  square: number,
  type: number,
  white: boolean,
): number => {
  let count = 0;
  if (type === KNIGHT) {
    const targets = KNIGHT_TARGETS[square];
    for (let i = 0; i < targets.length; i++) {
      const piece = squares[targets[i]];
      if (piece === 0 || (piece > 0) !== white) count++;
    }
    return count;
  }
  const rays = RAYS[square];
  const last = type === BISHOP ? FIRST_ORTHOGONAL_DIRECTION : 8;
  for (let direction = type === ROOK ? FIRST_ORTHOGONAL_DIRECTION : 0; direction < last; direction++) {
    const ray = rays[direction];
    for (let i = 0; i < ray.length; i++) {
      const piece = squares[ray[i]];
      if (piece === 0) count++;
      else {
        if ((piece > 0) !== white) count++;
        break;
      }
    }
  }
  return count;
};

export const hasKnightOutpost = (
  rank: number,
  file: number,
  white: boolean,
  myPawns: Uint8Array,
  oppPawns: Uint8Array,
): boolean => {
  // Only reward advanced outposts in enemy territory.
  if (white ? rank > 3 : rank < 4) return false;

  const supportRank = white ? rank + 1 : rank - 1;
  if (supportRank < 0 || supportRank >= 8) return false;
  const supportedByPawn = (file > 0 && hasBit(myPawns[file - 1], supportRank))
    || (file < 7 && hasBit(myPawns[file + 1], supportRank));
  if (!supportedByPawn) return false;

  // No enemy pawn on an adjacent file can ever attack the square.
  const attackers = ahead(rank, white);
  return !((file > 0 && (oppPawns[file - 1] & attackers) !== 0) || (file < 7 && (oppPawns[file + 1] & attackers) !== 0));
};

export const getGamePhase = (game: SearchGame): number => {
  const squares = getSquares(game, _squaresScratch);
  let phase = 0;
  for (let i = 0; i < 64; i++) {
    const piece = squares[i];
    if (piece !== 0) phase += PHASE_BY_TYPE[piece > 0 ? piece : -piece];
  }
  return Math.max(0, Math.min(MAX_PHASE, phase));
};

// Fills the per-file structures for `myWhite`'s perspective, lists occupied
// squares in ascending order, and returns the facts both evaluators need.
type Census = {
  occupiedCount: number;
  myKingRank: number; myKingFile: number; oppKingRank: number; oppKingFile: number;
  myNonPawnMaterial: number; oppNonPawnMaterial: number;
  myBishops: number; oppBishops: number; myPawnCount: number; oppPawnCount: number; phase: number;
};
const _census: Census = {
  occupiedCount: 0, myKingRank: 0, myKingFile: 0, oppKingRank: 0, oppKingFile: 0,
  myNonPawnMaterial: 0, oppNonPawnMaterial: 0, myBishops: 0, oppBishops: 0, myPawnCount: 0, oppPawnCount: 0, phase: 0,
};

const takeCensus = (squares: Int8Array, myWhite: boolean): Census => {
  resetStructures();
  const census = _census;
  census.myKingRank = 0; census.myKingFile = 0; census.oppKingRank = 0; census.oppKingFile = 0;
  let occupiedCount = 0;
  let myNonPawnMaterial = 0; let oppNonPawnMaterial = 0;
  let myBishops = 0; let oppBishops = 0; let myPawnCount = 0; let oppPawnCount = 0; let phase = 0;
  for (let square = 0; square < 64; square++) {
    const piece = squares[square];
    if (piece === 0) continue;
    _occupied[occupiedCount++] = square;
    const type = piece > 0 ? piece : -piece;
    const mine = (piece > 0) === myWhite;
    const r = square >> 3;
    const f = square & 7;
    phase += PHASE_BY_TYPE[type];
    if (type === KING) {
      if (mine) { census.myKingRank = r; census.myKingFile = f; }
      else { census.oppKingRank = r; census.oppKingFile = f; }
    } else if (type === PAWN) {
      if (mine) { _myPawns[f] |= 1 << r; myPawnCount++; }
      else { _oppPawns[f] |= 1 << r; oppPawnCount++; }
    } else if (mine) {
      myNonPawnMaterial += PIECE_VALUE_BY_TYPE[type];
      if (type === ROOK) _myRooks[f] |= 1 << r;
      if (type === BISHOP) myBishops++;
    } else {
      oppNonPawnMaterial += PIECE_VALUE_BY_TYPE[type];
      if (type === ROOK) _oppRooks[f] |= 1 << r;
      if (type === BISHOP) oppBishops++;
    }
  }
  census.occupiedCount = occupiedCount;
  census.myNonPawnMaterial = myNonPawnMaterial; census.oppNonPawnMaterial = oppNonPawnMaterial;
  census.myBishops = myBishops; census.oppBishops = oppBishops;
  census.myPawnCount = myPawnCount; census.oppPawnCount = oppPawnCount;
  census.phase = phase;
  return census;
};

const evaluateBoardLegacy = (game: SearchGame, color: 'w' | 'b', tuning: EvaluationTuning): number => {
  let value = 0;
  const squares = getSquares(game, _squaresScratch);
  const myWhite = color === 'w';
  const opponent: 'w' | 'b' = color === 'w' ? 'b' : 'w';
  const { occupiedCount, myKingRank, myKingFile, oppKingRank, oppKingFile, myNonPawnMaterial, oppNonPawnMaterial,
    myBishops, oppBishops } = takeCensus(squares, myWhite);

  const isEndgame = myNonPawnMaterial < 1300 && oppNonPawnMaterial < 1300;

  for (let index = 0; index < occupiedCount; index++) {
    const square = _occupied[index];
    const rank = square >> 3;
    const file = square & 7;
    const piece = squares[square];
    const white = piece > 0;
    const type = white ? piece : -piece;
    const mine = white === myWhite;
    const pieceValue = PIECE_VALUE_BY_TYPE[type];
    const squareBonus = getSquareBonus(type, rank, file, white, isEndgame);
    let signedScore = pieceValue + squareBonus;

    if (type === ROOK) {
      const friendlyPawns = mine ? _myPawns : _oppPawns;
      const enemyPawns = mine ? _oppPawns : _myPawns;
      const rooks = mine ? _myRooks : _oppRooks;
      if (friendlyPawns[file] === 0) {
        signedScore += enemyPawns[file] === 0 ? OPEN_FILE_ROOK_BONUS : SEMI_OPEN_FILE_ROOK_BONUS;
      }
      const seventhRank = white ? 1 : 6;
      if (rank === seventhRank) signedScore += SEVENTH_RANK_ROOK_BONUS;
      if (POPCOUNT8[rooks[file]] >= 2) signedScore += DOUBLED_ROOK_BONUS;
    }

    if (type === KNIGHT || type === BISHOP || type === ROOK || type === QUEEN) {
      signedScore += pseudoMobility(squares, square, type, white) * MOBILITY_FACTOR;
    }

    if (tuning.enableKnightOutpost && type === KNIGHT) {
      if (hasKnightOutpost(rank, file, white, mine ? _myPawns : _oppPawns, mine ? _oppPawns : _myPawns)) {
        signedScore += KNIGHT_OUTPOST_MG_BONUS;
      }
    }

    if (tuning.aiStyle !== 'balanced') {
      if (tuning.aiStyle === 'aggressive') {
        if (mine && type !== KING && type !== PAWN) {
          const dist = Math.abs(rank - oppKingRank) + Math.abs(file - oppKingFile);
          signedScore += (14 - dist) * 2;
        }
        if (mine && rank >= 2 && rank <= 5 && file >= 2 && file <= 5) {
          signedScore += 10;
        }
      } else {
        if (mine && type !== KING) {
          const dist = Math.abs(rank - myKingRank) + Math.abs(file - myKingFile);
          if (dist <= 2) signedScore += 15;
          else if (dist > 5 && type !== PAWN) signedScore -= 5;
        }
      }
    }

    value += mine ? signedScore : -signedScore;
  }

  if (myBishops >= 2) value += BISHOP_PAIR_BONUS;
  if (oppBishops >= 2) value -= BISHOP_PAIR_BONUS;

  value += evaluatePawnStructure(_myPawns, _oppPawns, color, tuning, _myPassed, DEFAULT_EVAL_WEIGHTS);
  value -= evaluatePawnStructure(_oppPawns, _myPawns, opponent, tuning, _oppPassed, DEFAULT_EVAL_WEIGHTS);
  value += evaluatePassedPawnKingDistance(
    _myPassed, color, myKingRank, myKingFile, oppKingRank, oppKingFile, tuning,
  );
  value -= evaluatePassedPawnKingDistance(
    _oppPassed, opponent, oppKingRank, oppKingFile, myKingRank, myKingFile, tuning,
  );
  value += ROOK_BEHIND_PASSED_PAWN_MG_BONUS * (
    countRooksBehindPassedPawns(_myPassed, _myRooks, color, tuning)
    - countRooksBehindPassedPawns(_oppPassed, _oppRooks, opponent, tuning)
  );

  if (!isEndgame) {
    value += evaluateKingSafety(squares, myKingRank, myKingFile, _myPawns, color, tuning);
    value -= evaluateKingSafety(squares, oppKingRank, oppKingFile, _oppPawns, opponent, tuning);
  }

  return value;
};

const evaluateBoardTapered = (
  game: SearchGame,
  color: 'w' | 'b',
  tuning: EvaluationTuning,
  weights: EvalWeights = DEFAULT_EVAL_WEIGHTS,
): number => {
  let mgValue = 0;
  let egValue = 0;
  const squares = getSquares(game, _squaresScratch);
  const tables = getWeightTables(weights);
  const myWhite = color === 'w';
  const opponent: 'w' | 'b' = color === 'w' ? 'b' : 'w';
  const { occupiedCount, myKingRank, myKingFile, oppKingRank, oppKingFile, myNonPawnMaterial, oppNonPawnMaterial,
    myBishops, oppBishops, myPawnCount, oppPawnCount } = takeCensus(squares, myWhite);
  const phase = Math.max(0, Math.min(MAX_PHASE, _census.phase));

  for (let index = 0; index < occupiedCount; index++) {
    const square = _occupied[index];
    const rank = square >> 3;
    const file = square & 7;
    const piece = squares[square];
    const white = piece > 0;
    const type = white ? piece : -piece;
    const mine = white === myWhite;
    const mgSquare = getSquareBonus(type, rank, file, white, false);
    const egSquare = type === KING ? getSquareBonus(type, rank, file, white, true) : mgSquare;
    let mgSigned = (type === KING ? PIECE_VALUES.k : tables.materialMg[type]) + (mgSquare * weights.pstMgPct) / 100;
    let egSigned = (type === KING ? PIECE_VALUES.k : tables.materialEg[type]) + (egSquare * weights.pstEgPct) / 100;

    if (type === ROOK) {
      const friendlyPawns = mine ? _myPawns : _oppPawns;
      const enemyPawns = mine ? _oppPawns : _myPawns;
      const rooks = mine ? _myRooks : _oppRooks;
      const rookBonus = friendlyPawns[file] === 0
        ? (enemyPawns[file] === 0 ? weights.rookOpenFile : weights.rookSemiOpenFile)
        : 0;
      const seventhRank = white ? 1 : 6;
      const seventhBonus = rank === seventhRank ? weights.rookSeventhRank : 0;
      const doubledBonus = POPCOUNT8[rooks[file]] >= 2 ? weights.doubledRooks : 0;
      mgSigned += rookBonus + seventhBonus + doubledBonus;
      egSigned += rookBonus + seventhBonus + doubledBonus;
    }

    if (type === KNIGHT || type === BISHOP || type === ROOK || type === QUEEN) {
      const mobility = pseudoMobility(squares, square, type, white);
      mgSigned += mobility * tables.mobilityMg[type];
      egSigned += mobility * tables.mobilityEg[type];
    }

    if (tuning.enableKnightOutpost && type === KNIGHT) {
      if (hasKnightOutpost(rank, file, white, mine ? _myPawns : _oppPawns, mine ? _oppPawns : _myPawns)) {
        mgSigned += weights.knightOutpostMg;
        egSigned += weights.knightOutpostEg;
      }
    }

    if (tuning.aiStyle !== 'balanced') {
      if (tuning.aiStyle === 'aggressive') {
        if (mine && type !== KING && type !== PAWN) {
          const dist = Math.abs(rank - oppKingRank) + Math.abs(file - oppKingFile);
          mgSigned += (14 - dist) * 2;
          egSigned += (14 - dist) * 2;
        }
        if (mine && rank >= 2 && rank <= 5 && file >= 2 && file <= 5) {
          mgSigned += 10;
          egSigned += 10;
        }
      } else {
        if (mine && type !== KING) {
          const dist = Math.abs(rank - myKingRank) + Math.abs(file - myKingFile);
          if (dist <= 2) { mgSigned += 15; egSigned += 15; }
          else if (dist > 5 && type !== PAWN) { mgSigned -= 5; egSigned -= 5; }
        }
      }
    }

    if (mine) {
      mgValue += mgSigned;
      egValue += egSigned;
    } else {
      mgValue -= mgSigned;
      egValue -= egSigned;
    }
  }

  const bishopPair = (myBishops >= 2 ? weights.bishopPair : 0) - (oppBishops >= 2 ? weights.bishopPair : 0);
  mgValue += bishopPair;
  egValue += bishopPair;

  // Pawn structure, with the passed-pawn part scaled separately per phase.
  const myPawnScore = evaluatePawnStructure(_myPawns, _oppPawns, color, tuning, _myPassed, weights);
  const myPassedScore = _lastPassedPawnScore;
  const oppPawnScore = evaluatePawnStructure(_oppPawns, _myPawns, opponent, tuning, _oppPassed, weights);
  const passedNet = myPassedScore - _lastPassedPawnScore;
  const pawnStructureNet = (myPawnScore - myPassedScore) - (oppPawnScore - _lastPassedPawnScore);
  mgValue += pawnStructureNet + (passedNet * weights.passedPawnMgPct) / 100;
  egValue += pawnStructureNet + (passedNet * weights.passedPawnEgPct) / 100;

  const passedPawnKingDistanceNet = evaluatePassedPawnKingDistance(
    _myPassed, color, myKingRank, myKingFile, oppKingRank, oppKingFile, tuning,
  ) - evaluatePassedPawnKingDistance(
    _oppPassed, opponent, oppKingRank, oppKingFile, myKingRank, myKingFile, tuning,
  );
  mgValue += Math.trunc(passedPawnKingDistanceNet / 2);
  egValue += passedPawnKingDistanceNet;

  const rooksBehindPassedPawnsNet = countRooksBehindPassedPawns(_myPassed, _myRooks, color, tuning)
    - countRooksBehindPassedPawns(_oppPassed, _oppRooks, opponent, tuning);
  mgValue += rooksBehindPassedPawnsNet * ROOK_BEHIND_PASSED_PAWN_MG_BONUS;
  egValue += rooksBehindPassedPawnsNet * ROOK_BEHIND_PASSED_PAWN_EG_BONUS;

  const kingSafetyNet = evaluateKingSafety(squares, myKingRank, myKingFile, _myPawns, color, tuning)
    - evaluateKingSafety(squares, oppKingRank, oppKingFile, _oppPawns, opponent, tuning);
  mgValue += (kingSafetyNet * weights.kingSafetyPct) / 100;

  egValue += evaluateMopUp(
    myNonPawnMaterial, oppNonPawnMaterial, oppPawnCount, myKingRank, myKingFile, oppKingRank, oppKingFile,
  ) - evaluateMopUp(
    oppNonPawnMaterial, myNonPawnMaterial, myPawnCount, oppKingRank, oppKingFile, myKingRank, myKingFile,
  );

  return Math.round((mgValue * phase + egValue * (MAX_PHASE - phase)) / MAX_PHASE);
};

export const evaluateBoard = (game: SearchGame, color: 'w' | 'b', tuning: EvaluationTuning): number => {
  let score = tuning.enableTaperedEval
    ? evaluateBoardTapered(game, color, tuning)
    : evaluateBoardLegacy(game, color, tuning);

  if (tuning.enableTempoBonus) {
    score += searchTurn(game) === color ? TEMPO_BONUS : -TEMPO_BONUS;
  }

  return score;
};

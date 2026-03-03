import { Chess } from 'chess.js';

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

export const PIECE_VALUES: Record<string, number> = {
  p: 100,
  n: 320,
  b: 330,
  r: 500,
  q: 900,
  k: 20000,
};

const pieceSquareTables: Record<string, number[][]> = {
  p: [
    [0, 0, 0, 0, 0, 0, 0, 0],
    [50, 50, 50, 50, 50, 50, 50, 50],
    [10, 10, 20, 30, 30, 20, 10, 10],
    [5, 5, 10, 25, 25, 10, 5, 5],
    [0, 0, 0, 20, 20, 0, 0, 0],
    [5, -5, -10, 0, 0, -10, -5, 5],
    [5, 10, 10, -20, -20, 10, 10, 5],
    [0, 0, 0, 0, 0, 0, 0, 0],
  ],
  n: [
    [-50, -40, -30, -30, -30, -30, -40, -50],
    [-40, -20, 0, 5, 5, 0, -20, -40],
    [-30, 5, 10, 15, 15, 10, 5, -30],
    [-30, 0, 15, 20, 20, 15, 0, -30],
    [-30, 5, 15, 20, 20, 15, 5, -30],
    [-30, 0, 10, 15, 15, 10, 0, -30],
    [-40, -20, 0, 0, 0, 0, -20, -40],
    [-50, -40, -30, -30, -30, -30, -40, -50],
  ],
  b: [
    [-20, -10, -10, -10, -10, -10, -10, -20],
    [-10, 0, 0, 0, 0, 0, 0, -10],
    [-10, 0, 5, 10, 10, 5, 0, -10],
    [-10, 5, 5, 10, 10, 5, 5, -10],
    [-10, 0, 10, 10, 10, 10, 0, -10],
    [-10, 10, 10, 10, 10, 10, 10, -10],
    [-10, 5, 0, 0, 0, 0, 5, -10],
    [-20, -10, -10, -10, -10, -10, -10, -20],
  ],
  r: [
    [0, 0, 0, 5, 5, 0, 0, 0],
    [-5, 0, 0, 0, 0, 0, 0, -5],
    [-5, 0, 0, 0, 0, 0, 0, -5],
    [-5, 0, 0, 0, 0, 0, 0, -5],
    [-5, 0, 0, 0, 0, 0, 0, -5],
    [-5, 0, 0, 0, 0, 0, 0, -5],
    [5, 10, 10, 10, 10, 10, 10, 5],
    [0, 0, 0, 0, 0, 0, 0, 0],
  ],
  q: [
    [-20, -10, -10, -5, -5, -10, -10, -20],
    [-10, 0, 0, 0, 0, 0, 0, -10],
    [-10, 0, 5, 5, 5, 5, 0, -10],
    [-5, 0, 5, 5, 5, 5, 0, -5],
    [0, 0, 5, 5, 5, 5, 0, -5],
    [-10, 5, 5, 5, 5, 5, 0, -10],
    [-10, 0, 5, 0, 0, 0, 0, -10],
    [-20, -10, -10, -5, -5, -10, -10, -20],
  ],
  k: [
    [-30, -40, -40, -50, -50, -40, -40, -30],
    [-30, -40, -40, -50, -50, -40, -40, -30],
    [-30, -40, -40, -50, -50, -40, -40, -30],
    [-30, -40, -40, -50, -50, -40, -40, -30],
    [-20, -30, -30, -40, -40, -30, -30, -20],
    [-10, -20, -20, -20, -20, -20, -20, -10],
    [20, 20, 0, 0, 0, 0, 20, 20],
    [20, 30, 10, 0, 0, 10, 30, 20],
  ],
};

const kingEndgamePST: number[][] = [
  [-50, -30, -30, -30, -30, -30, -30, -50],
  [-30, -10, 10, 10, 10, 10, -10, -30],
  [-30, 10, 30, 30, 30, 30, 10, -30],
  [-30, 10, 30, 40, 40, 30, 10, -30],
  [-30, 10, 30, 40, 40, 30, 10, -30],
  [-30, 10, 30, 30, 30, 30, 10, -30],
  [-30, -10, 10, 10, 10, 10, -10, -30],
  [-50, -30, -30, -30, -30, -30, -30, -50],
];

const DOUBLED_PAWN_PENALTY = -20;
const ISOLATED_PAWN_PENALTY = -15;
const CONNECTED_PAWN_BONUS = 8;
const PASSED_PAWN_BONUS = [0, 0, 10, 20, 40, 60, 90, 130];
const BACKWARD_PAWN_PENALTY = -18;
const KNIGHT_OUTPOST_MG_BONUS = 24;
const KNIGHT_OUTPOST_EG_BONUS = 12;
const PASSED_PAWN_KING_DISTANCE_FACTOR = 3;
const ROOK_BEHIND_PASSED_PAWN_MG_BONUS = 16;
const ROOK_BEHIND_PASSED_PAWN_EG_BONUS = 28;
const TEMPO_BONUS = 10;

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
const KING_ATTACK_WEIGHTS: Record<string, number> = { q: 10, r: 7, b: 4, n: 4 };

const OPEN_FILE_ROOK_BONUS = 25;
const SEMI_OPEN_FILE_ROOK_BONUS = 12;
const SEVENTH_RANK_ROOK_BONUS = 40;
const DOUBLED_ROOK_BONUS = 15;

const BISHOP_PAIR_BONUS = 40;
const MOBILITY_FACTOR = 2;

const KNIGHT_JUMPS = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]] as const;
const DIAG_DIRS = [[-1,-1],[-1,1],[1,-1],[1,1]] as const;
const ORTHO_DIRS = [[-1,0],[1,0],[0,-1],[0,1]] as const;

const _myPawnsByFile: number[][] = Array.from({ length: 8 }, () => []);
const _oppPawnsByFile: number[][] = Array.from({ length: 8 }, () => []);
const _myPawnPresence = new Uint8Array(64);
const _oppPawnPresence = new Uint8Array(64);
const _myRooksByFile = new Uint8Array(8);
const _oppRooksByFile = new Uint8Array(8);
const _myRookRanksByFile: number[][] = Array.from({ length: 8 }, () => []);
const _oppRookRanksByFile: number[][] = Array.from({ length: 8 }, () => []);

const PHASE_WEIGHT: Record<string, number> = { p: 0, n: 1, b: 1, r: 2, q: 4, k: 0 };
const MAX_PHASE = 24;

const getSquareBonus = (
  pieceType: string,
  rank: number,
  file: number,
  color: 'w' | 'b',
  isEndgame = false,
): number => {
  const table = pieceType === 'k' && isEndgame ? kingEndgamePST : pieceSquareTables[pieceType];
  if (!table) return 0;
  const row = color === 'w' ? rank : 7 - rank;
  return table[row][file] ?? 0;
};

const isPassedPawn = (
  file: number,
  rank: number,
  color: 'w' | 'b',
  oppPawnsByFile: number[][],
): boolean => {
  for (let df = -1; df <= 1; df++) {
    const f = file + df;
    if (f < 0 || f >= 8) continue;
    for (const oppRank of oppPawnsByFile[f]) {
      if (color === 'w' ? oppRank <= rank : oppRank >= rank) {
        return false;
      }
    }
  }
  return true;
};

const evaluatePawnStructure = (
  myPawnsByFile: number[][],
  oppPawnsByFile: number[][],
  myPawnPresence: Uint8Array,
  color: 'w' | 'b',
  tuning: EvaluationTuning,
): number => {
  let score = 0;
  for (let file = 0; file < 8; file++) {
    const pawns = myPawnsByFile[file];
    if (pawns.length === 0) continue;
    if (pawns.length > 1) {
      score += DOUBLED_PAWN_PENALTY * (pawns.length - 1);
    }
    const hasLeft = file > 0 && myPawnsByFile[file - 1].length > 0;
    const hasRight = file < 7 && myPawnsByFile[file + 1].length > 0;
    if (!hasLeft && !hasRight) {
      score += ISOLATED_PAWN_PENALTY * pawns.length;
    }
    for (const rank of pawns) {
      const isPassed = isPassedPawn(file, rank, color, oppPawnsByFile);
      if (isPassed) {
        const adv = color === 'w' ? 7 - rank : rank;
        score += PASSED_PAWN_BONUS[adv] ?? 0;
      }

      if (tuning.enableBackwardPawn && !isPassed) {
        let hasAdjacentSupport = false;
        for (const df of [-1, 1]) {
          const f = file + df;
          if (f < 0 || f >= 8) continue;
          for (const friendRank of myPawnsByFile[f]) {
            if (color === 'w' ? friendRank <= rank : friendRank >= rank) {
              hasAdjacentSupport = true;
              break;
            }
          }
          if (hasAdjacentSupport) break;
        }

        if (!hasAdjacentSupport) {
          let enemyAheadOnAdjacent = false;
          for (const df of [-1, 1]) {
            const f = file + df;
            if (f < 0 || f >= 8) continue;
            for (const oppRank of oppPawnsByFile[f]) {
              if (color === 'w' ? oppRank < rank : oppRank > rank) {
                enemyAheadOnAdjacent = true;
                break;
              }
            }
            if (enemyAheadOnAdjacent) break;
          }
          if (enemyAheadOnAdjacent) {
            score += BACKWARD_PAWN_PENALTY;
          }
        }
      }
      const behindRank = color === 'w' ? rank + 1 : rank - 1;
      if (behindRank >= 0 && behindRank < 8) {
        const idx = behindRank * 8;
        if ((file > 0 && myPawnPresence[idx + file - 1]) || (file < 7 && myPawnPresence[idx + file + 1])) {
          score += CONNECTED_PAWN_BONUS;
        }
      }
    }
  }
  return score;
};

const evaluatePassedPawnKingDistance = (
  myPawnsByFile: number[][],
  oppPawnsByFile: number[][],
  color: 'w' | 'b',
  myKingRank: number,
  myKingFile: number,
  oppKingRank: number,
  oppKingFile: number,
  tuning: EvaluationTuning,
): number => {
  if (!tuning.enablePassedPawnKingDistance) return 0;

  let score = 0;
  for (let file = 0; file < 8; file++) {
    const pawns = myPawnsByFile[file];
    if (pawns.length === 0) continue;
    for (const rank of pawns) {
      if (!isPassedPawn(file, rank, color, oppPawnsByFile)) continue;

      const promotionRank = color === 'w' ? 0 : 7;
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

const evaluateRookBehindPassedPawn = (
  myPawnsByFile: number[][],
  oppPawnsByFile: number[][],
  myRookRanksByFile: number[][],
  color: 'w' | 'b',
  tuning: EvaluationTuning,
  bonus: number,
): number => {
  if (!tuning.enableRookBehindPassedPawn) return 0;

  let score = 0;
  for (let file = 0; file < 8; file++) {
    const rooks = myRookRanksByFile[file];
    if (rooks.length === 0) continue;

    for (const pawnRank of myPawnsByFile[file]) {
      if (!isPassedPawn(file, pawnRank, color, oppPawnsByFile)) continue;
      const hasRookBehind = rooks.some((rookRank) => (color === 'w' ? rookRank > pawnRank : rookRank < pawnRank));
      if (hasRookBehind) {
        score += bonus;
      }
    }
  }

  return score;
};

const evaluateKingSafety = (
  board: ReturnType<Chess['board']>,
  kingRank: number,
  kingFile: number,
  myPawnsByFile: number[][],
  myPawnPresence: Uint8Array,
  color: 'w' | 'b',
  tuning: EvaluationTuning,
): number => {
  let score = 0;
  const shieldDir = color === 'w' ? -1 : 1;
  for (let df = -1; df <= 1; df++) {
    const f = kingFile + df;
    if (f < 0 || f >= 8) continue;
    const r1 = kingRank + shieldDir;
    const r2 = kingRank + shieldDir * 2;
    const pawn1 = r1 >= 0 && r1 < 8 && myPawnPresence[r1 * 8 + f] !== 0;
    const pawn2 = r2 >= 0 && r2 < 8 && myPawnPresence[r2 * 8 + f] !== 0;
    if (pawn1) {
      score += df === 0 ? PAWN_SHIELD_DIRECT_BONUS : PAWN_SHIELD_SIDE_BONUS;
    } else if (pawn2) {
      score += df === 0 ? PAWN_SHIELD2_DIRECT_BONUS : PAWN_SHIELD2_SIDE_BONUS;
    } else if (myPawnsByFile[f].length === 0) {
      score += df === 0 ? OPEN_FILE_KING_PENALTY : OPEN_FILE_KING_PENALTY_SIDE;
    } else {
      score += df === 0 ? SEMI_OPEN_KING_PENALTY : SEMI_OPEN_KING_PENALTY_SIDE;
    }
  }

  let attackScore = 0;
  for (let r = Math.max(0, kingRank - 2); r <= Math.min(7, kingRank + 2); r++) {
    for (let f = Math.max(0, kingFile - 2); f <= Math.min(7, kingFile + 2); f++) {
      const p = board[r][f];
      if (p && p.color !== color && p.type !== 'p' && p.type !== 'k') {
        attackScore += KING_ATTACK_WEIGHTS[p.type] ?? 0;
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

const pseudoMobility = (
  board: ReturnType<Chess['board']>,
  rank: number,
  file: number,
  pieceType: string,
  color: 'w' | 'b',
): number => {
  let count = 0;
  if (pieceType === 'n') {
    for (const [dr, df] of KNIGHT_JUMPS) {
      const r = rank + dr;
      const f = file + df;
      if (r >= 0 && r < 8 && f >= 0 && f < 8) {
        const sq = board[r][f];
        if (!sq || sq.color !== color) count++;
      }
    }
  }
  if (pieceType === 'b' || pieceType === 'q') {
    for (const [dr, df] of DIAG_DIRS) {
      for (let s = 1; s < 8; s++) {
        const r = rank + dr * s;
        const f = file + df * s;
        if (r < 0 || r >= 8 || f < 0 || f >= 8) break;
        const sq = board[r][f];
        if (!sq) count++;
        else {
          if (sq.color !== color) count++;
          break;
        }
      }
    }
  }
  if (pieceType === 'r' || pieceType === 'q') {
    for (const [dr, df] of ORTHO_DIRS) {
      for (let s = 1; s < 8; s++) {
        const r = rank + dr * s;
        const f = file + df * s;
        if (r < 0 || r >= 8 || f < 0 || f >= 8) break;
        const sq = board[r][f];
        if (!sq) count++;
        else {
          if (sq.color !== color) count++;
          break;
        }
      }
    }
  }
  return count;
};

const hasKnightOutpost = (
  rank: number,
  file: number,
  color: 'w' | 'b',
  myPawnPresence: Uint8Array,
  oppPawnsByFile: number[][],
): boolean => {
  // Only reward advanced outposts in enemy territory.
  if (color === 'w' ? rank > 3 : rank < 4) return false;

  const supportRank = color === 'w' ? rank + 1 : rank - 1;
  if (supportRank < 0 || supportRank >= 8) return false;

  let supportedByPawn = false;
  if (file > 0 && myPawnPresence[supportRank * 8 + (file - 1)] !== 0) supportedByPawn = true;
  if (file < 7 && myPawnPresence[supportRank * 8 + (file + 1)] !== 0) supportedByPawn = true;
  if (!supportedByPawn) return false;

  for (const df of [-1, 1]) {
    const f = file + df;
    if (f < 0 || f >= 8) continue;
    for (const oppRank of oppPawnsByFile[f]) {
      if (color === 'w' ? oppRank < rank : oppRank > rank) {
        return false;
      }
    }
  }
  return true;
};

export const getGamePhase = (game: Chess): number => {
  const board = game.board();
  let phase = 0;
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const p = board[r][f];
      if (!p) continue;
      phase += PHASE_WEIGHT[p.type] ?? 0;
    }
  }
  return Math.max(0, Math.min(MAX_PHASE, phase));
};

const evaluateBoardLegacy = (game: Chess, color: 'w' | 'b', tuning: EvaluationTuning): number => {
  let value = 0;
  const board = game.board();
  const opponent: 'w' | 'b' = color === 'w' ? 'b' : 'w';

  for (let f = 0; f < 8; f++) {
    _myPawnsByFile[f].length = 0;
    _oppPawnsByFile[f].length = 0;
    _myRookRanksByFile[f].length = 0;
    _oppRookRanksByFile[f].length = 0;
  }
  _myPawnPresence.fill(0);
  _oppPawnPresence.fill(0);
  _myRooksByFile.fill(0);
  _oppRooksByFile.fill(0);

  let myKingRank = 0; let myKingFile = 0;
  let oppKingRank = 0; let oppKingFile = 0;
  let myNonPawnMaterial = 0;
  let oppNonPawnMaterial = 0;
  let myBishops = 0;
  let oppBishops = 0;
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const p = board[r][f];
      if (!p) continue;
      if (p.type === 'k') {
        if (p.color === color) { myKingRank = r; myKingFile = f; }
        else { oppKingRank = r; oppKingFile = f; }
      } else if (p.type === 'p') {
        if (p.color === color) {
          _myPawnsByFile[f].push(r);
          _myPawnPresence[r * 8 + f] = 1;
        } else {
          _oppPawnsByFile[f].push(r);
          _oppPawnPresence[r * 8 + f] = 1;
        }
      } else {
        if (p.color === color) {
          myNonPawnMaterial += PIECE_VALUES[p.type] || 0;
          if (p.type === 'r') {
            _myRooksByFile[f]++;
            _myRookRanksByFile[f].push(r);
          }
          if (p.type === 'b') myBishops++;
        } else {
          oppNonPawnMaterial += PIECE_VALUES[p.type] || 0;
          if (p.type === 'r') {
            _oppRooksByFile[f]++;
            _oppRookRanksByFile[f].push(r);
          }
          if (p.type === 'b') oppBishops++;
        }
      }
    }
  }

  const isEndgame = myNonPawnMaterial < 1300 && oppNonPawnMaterial < 1300;

  for (let rank = 0; rank < 8; rank++) {
    for (let file = 0; file < 8; file++) {
      const p = board[rank][file];
      if (!p) continue;
      const pieceValue = PIECE_VALUES[p.type] || 0;
      const squareBonus = getSquareBonus(p.type, rank, file, p.color, isEndgame);
      let signedScore = pieceValue + squareBonus;

      if (p.type === 'r') {
        const friendlyPawns = p.color === color ? _myPawnsByFile : _oppPawnsByFile;
        const enemyPawns = p.color === color ? _oppPawnsByFile : _myPawnsByFile;
        const rooksByFile = p.color === color ? _myRooksByFile : _oppRooksByFile;
        if (friendlyPawns[file].length === 0) {
          signedScore += enemyPawns[file].length === 0 ? OPEN_FILE_ROOK_BONUS : SEMI_OPEN_FILE_ROOK_BONUS;
        }
        const seventhRank = p.color === 'w' ? 1 : 6;
        if (rank === seventhRank) signedScore += SEVENTH_RANK_ROOK_BONUS;
        if (rooksByFile[file] >= 2) signedScore += DOUBLED_ROOK_BONUS;
      }

      if (p.type === 'n' || p.type === 'b' || p.type === 'r' || p.type === 'q') {
        signedScore += pseudoMobility(board, rank, file, p.type, p.color) * MOBILITY_FACTOR;
      }

      if (tuning.enableKnightOutpost && p.type === 'n') {
        const friendlyPawns = p.color === color ? _myPawnPresence : _oppPawnPresence;
        const enemyPawnsByFile = p.color === color ? _oppPawnsByFile : _myPawnsByFile;
        if (hasKnightOutpost(rank, file, p.color, friendlyPawns, enemyPawnsByFile)) {
          signedScore += KNIGHT_OUTPOST_MG_BONUS;
        }
      }

      if (tuning.aiStyle !== 'balanced') {
        if (tuning.aiStyle === 'aggressive') {
          if (p.color === color && p.type !== 'k' && p.type !== 'p') {
            const dist = Math.abs(rank - oppKingRank) + Math.abs(file - oppKingFile);
            signedScore += (14 - dist) * 2;
          }
          if (p.color === color && rank >= 2 && rank <= 5 && file >= 2 && file <= 5) {
            signedScore += 10;
          }
        } else {
          if (p.color === color && p.type !== 'k') {
            const dist = Math.abs(rank - myKingRank) + Math.abs(file - myKingFile);
            if (dist <= 2) signedScore += 15;
            else if (dist > 5 && p.type !== 'p') signedScore -= 5;
          }
        }
      }

      value += p.color === color ? signedScore : -signedScore;
    }
  }

  if (myBishops >= 2) value += BISHOP_PAIR_BONUS;
  if (oppBishops >= 2) value -= BISHOP_PAIR_BONUS;

  value += evaluatePawnStructure(_myPawnsByFile, _oppPawnsByFile, _myPawnPresence, color, tuning);
  value -= evaluatePawnStructure(_oppPawnsByFile, _myPawnsByFile, _oppPawnPresence, opponent, tuning);
  value += evaluatePassedPawnKingDistance(
    _myPawnsByFile,
    _oppPawnsByFile,
    color,
    myKingRank,
    myKingFile,
    oppKingRank,
    oppKingFile,
    tuning,
  );
  value -= evaluatePassedPawnKingDistance(
    _oppPawnsByFile,
    _myPawnsByFile,
    opponent,
    oppKingRank,
    oppKingFile,
    myKingRank,
    myKingFile,
    tuning,
  );
  value += evaluateRookBehindPassedPawn(
    _myPawnsByFile,
    _oppPawnsByFile,
    _myRookRanksByFile,
    color,
    tuning,
    ROOK_BEHIND_PASSED_PAWN_MG_BONUS,
  );
  value -= evaluateRookBehindPassedPawn(
    _oppPawnsByFile,
    _myPawnsByFile,
    _oppRookRanksByFile,
    opponent,
    tuning,
    ROOK_BEHIND_PASSED_PAWN_MG_BONUS,
  );

  if (!isEndgame) {
    value += evaluateKingSafety(board, myKingRank, myKingFile, _myPawnsByFile, _myPawnPresence, color, tuning);
    value -= evaluateKingSafety(board, oppKingRank, oppKingFile, _oppPawnsByFile, _oppPawnPresence, opponent, tuning);
  }

  return value;
};

const evaluateBoardTapered = (game: Chess, color: 'w' | 'b', tuning: EvaluationTuning): number => {
  let mgValue = 0;
  let egValue = 0;
  const board = game.board();
  const opponent: 'w' | 'b' = color === 'w' ? 'b' : 'w';

  for (let f = 0; f < 8; f++) {
    _myPawnsByFile[f].length = 0;
    _oppPawnsByFile[f].length = 0;
    _myRookRanksByFile[f].length = 0;
    _oppRookRanksByFile[f].length = 0;
  }
  _myPawnPresence.fill(0);
  _oppPawnPresence.fill(0);
  _myRooksByFile.fill(0);
  _oppRooksByFile.fill(0);

  let myKingRank = 0; let myKingFile = 0;
  let oppKingRank = 0; let oppKingFile = 0;
  let myBishops = 0;
  let oppBishops = 0;
  let phase = 0;

  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const p = board[r][f];
      if (!p) continue;
      phase += PHASE_WEIGHT[p.type] ?? 0;
      if (p.type === 'k') {
        if (p.color === color) { myKingRank = r; myKingFile = f; }
        else { oppKingRank = r; oppKingFile = f; }
      } else if (p.type === 'p') {
        if (p.color === color) {
          _myPawnsByFile[f].push(r);
          _myPawnPresence[r * 8 + f] = 1;
        } else {
          _oppPawnsByFile[f].push(r);
          _oppPawnPresence[r * 8 + f] = 1;
        }
      } else {
        if (p.color === color) {
          if (p.type === 'r') {
            _myRooksByFile[f]++;
            _myRookRanksByFile[f].push(r);
          }
          if (p.type === 'b') myBishops++;
        } else {
          if (p.type === 'r') {
            _oppRooksByFile[f]++;
            _oppRookRanksByFile[f].push(r);
          }
          if (p.type === 'b') oppBishops++;
        }
      }
    }
  }
  phase = Math.max(0, Math.min(MAX_PHASE, phase));

  for (let rank = 0; rank < 8; rank++) {
    for (let file = 0; file < 8; file++) {
      const p = board[rank][file];
      if (!p) continue;

      let mgSigned = (PIECE_VALUES[p.type] || 0) + getSquareBonus(p.type, rank, file, p.color, false);
      let egSigned = (PIECE_VALUES[p.type] || 0) + getSquareBonus(p.type, rank, file, p.color, true);

      if (p.type === 'r') {
        const friendlyPawns = p.color === color ? _myPawnsByFile : _oppPawnsByFile;
        const enemyPawns = p.color === color ? _oppPawnsByFile : _myPawnsByFile;
        const rooksByFile = p.color === color ? _myRooksByFile : _oppRooksByFile;
        const rookBonus = friendlyPawns[file].length === 0
          ? (enemyPawns[file].length === 0 ? OPEN_FILE_ROOK_BONUS : SEMI_OPEN_FILE_ROOK_BONUS)
          : 0;
        const seventhRank = p.color === 'w' ? 1 : 6;
        const seventhBonus = rank === seventhRank ? SEVENTH_RANK_ROOK_BONUS : 0;
        const doubledBonus = rooksByFile[file] >= 2 ? DOUBLED_ROOK_BONUS : 0;
        mgSigned += rookBonus + seventhBonus + doubledBonus;
        egSigned += rookBonus + seventhBonus + doubledBonus;
      }

      if (p.type === 'n' || p.type === 'b' || p.type === 'r' || p.type === 'q') {
        const mobility = pseudoMobility(board, rank, file, p.type, p.color) * MOBILITY_FACTOR;
        mgSigned += mobility;
        egSigned += mobility;
      }

      if (tuning.enableKnightOutpost && p.type === 'n') {
        const friendlyPawns = p.color === color ? _myPawnPresence : _oppPawnPresence;
        const enemyPawnsByFile = p.color === color ? _oppPawnsByFile : _myPawnsByFile;
        if (hasKnightOutpost(rank, file, p.color, friendlyPawns, enemyPawnsByFile)) {
          mgSigned += KNIGHT_OUTPOST_MG_BONUS;
          egSigned += KNIGHT_OUTPOST_EG_BONUS;
        }
      }

      if (tuning.aiStyle !== 'balanced') {
        if (tuning.aiStyle === 'aggressive') {
          if (p.color === color && p.type !== 'k' && p.type !== 'p') {
            const dist = Math.abs(rank - oppKingRank) + Math.abs(file - oppKingFile);
            mgSigned += (14 - dist) * 2;
            egSigned += (14 - dist) * 2;
          }
          if (p.color === color && rank >= 2 && rank <= 5 && file >= 2 && file <= 5) {
            mgSigned += 10;
            egSigned += 10;
          }
        } else {
          if (p.color === color && p.type !== 'k') {
            const dist = Math.abs(rank - myKingRank) + Math.abs(file - myKingFile);
            if (dist <= 2) { mgSigned += 15; egSigned += 15; }
            else if (dist > 5 && p.type !== 'p') { mgSigned -= 5; egSigned -= 5; }
          }
        }
      }

      if (p.color === color) {
        mgValue += mgSigned;
        egValue += egSigned;
      } else {
        mgValue -= mgSigned;
        egValue -= egSigned;
      }
    }
  }

  const bishopPair = (myBishops >= 2 ? BISHOP_PAIR_BONUS : 0) - (oppBishops >= 2 ? BISHOP_PAIR_BONUS : 0);
  mgValue += bishopPair;
  egValue += bishopPair;

  const pawnNet = evaluatePawnStructure(_myPawnsByFile, _oppPawnsByFile, _myPawnPresence, color, tuning)
    - evaluatePawnStructure(_oppPawnsByFile, _myPawnsByFile, _oppPawnPresence, opponent, tuning);
  mgValue += pawnNet;
  egValue += pawnNet;

  const passedPawnKingDistanceNet = evaluatePassedPawnKingDistance(
    _myPawnsByFile,
    _oppPawnsByFile,
    color,
    myKingRank,
    myKingFile,
    oppKingRank,
    oppKingFile,
    tuning,
  ) - evaluatePassedPawnKingDistance(
    _oppPawnsByFile,
    _myPawnsByFile,
    opponent,
    oppKingRank,
    oppKingFile,
    myKingRank,
    myKingFile,
    tuning,
  );
  mgValue += Math.trunc(passedPawnKingDistanceNet / 2);
  egValue += passedPawnKingDistanceNet;

  const rookBehindPassedPawnMgNet = evaluateRookBehindPassedPawn(
    _myPawnsByFile,
    _oppPawnsByFile,
    _myRookRanksByFile,
    color,
    tuning,
    ROOK_BEHIND_PASSED_PAWN_MG_BONUS,
  ) - evaluateRookBehindPassedPawn(
    _oppPawnsByFile,
    _myPawnsByFile,
    _oppRookRanksByFile,
    opponent,
    tuning,
    ROOK_BEHIND_PASSED_PAWN_MG_BONUS,
  );
  const rookBehindPassedPawnEgNet = evaluateRookBehindPassedPawn(
    _myPawnsByFile,
    _oppPawnsByFile,
    _myRookRanksByFile,
    color,
    tuning,
    ROOK_BEHIND_PASSED_PAWN_EG_BONUS,
  ) - evaluateRookBehindPassedPawn(
    _oppPawnsByFile,
    _myPawnsByFile,
    _oppRookRanksByFile,
    opponent,
    tuning,
    ROOK_BEHIND_PASSED_PAWN_EG_BONUS,
  );
  mgValue += rookBehindPassedPawnMgNet;
  egValue += rookBehindPassedPawnEgNet;

  mgValue += evaluateKingSafety(board, myKingRank, myKingFile, _myPawnsByFile, _myPawnPresence, color, tuning);
  mgValue -= evaluateKingSafety(board, oppKingRank, oppKingFile, _oppPawnsByFile, _oppPawnPresence, opponent, tuning);

  return Math.round((mgValue * phase + egValue * (MAX_PHASE - phase)) / MAX_PHASE);
};

export const evaluateBoard = (game: Chess, color: 'w' | 'b', tuning: EvaluationTuning): number => {
  let score = tuning.enableTaperedEval
    ? evaluateBoardTapered(game, color, tuning)
    : evaluateBoardLegacy(game, color, tuning);

  if (tuning.enableTempoBonus) {
    score += game.turn() === color ? TEMPO_BONUS : -TEMPO_BONUS;
  }

  return score;
};

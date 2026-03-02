import { Chess, Move } from 'chess.js';

export type AiStyle = 'aggressive' | 'defensive' | 'balanced';

export interface AiTuning {
  backtrackPenalty: number;
  openingBookEnabled: boolean;
  openingBookMaxPly: number;
  hardBand: number;
  hardOpeningBand: number;
  hardOpeningFallbackBand: number;
  hardCandidateCap: number;
  mediumBand: number;
  mediumNoise: number;
  aiStyle: AiStyle;
}

export const DEFAULT_AI_TUNING: AiTuning = {
  backtrackPenalty: 45,
  openingBookEnabled: true,
  openingBookMaxPly: 10,
  hardBand: 12,
  hardOpeningBand: 70,
  hardOpeningFallbackBand: 140,
  hardCandidateCap: 3,
  mediumBand: 28,
  mediumNoise: 16,
  aiStyle: 'balanced',
};

let activeAiTuning: AiTuning = { ...DEFAULT_AI_TUNING };

const pieceValues: Record<string, number> = {
  p: 100,
  n: 320,
  b: 330,
  r: 500,
  q: 900,
  k: 20000,
};

const MATE_SCORE = 1000000;

interface OpeningBookEntry {
  sequence: string[];
  replies: string[];
}

const HARD_OPENING_BOOK: OpeningBookEntry[] = [
  { sequence: [], replies: ['e2e4', 'd2d4', 'g1f3', 'c2c4'] },
  { sequence: ['e2e4'], replies: ['e7e5', 'c7c5', 'e7e6', 'c7c6'] },
  { sequence: ['d2d4'], replies: ['d7d5', 'g8f6', 'e7e6'] },
  { sequence: ['g1f3'], replies: ['d7d5', 'g8f6', 'c7c5'] },
  { sequence: ['c2c4'], replies: ['e7e5', 'g8f6', 'c7c5'] },
  { sequence: ['e2e4', 'e7e5'], replies: ['g1f3', 'b1c3', 'f1c4'] },
  { sequence: ['e2e4', 'c7c5'], replies: ['g1f3', 'b1c3', 'c2c3'] },
  { sequence: ['e2e4', 'e7e6'], replies: ['d2d4', 'g1f3'] },
  { sequence: ['e2e4', 'c7c6'], replies: ['d2d4', 'g1f3'] },
  { sequence: ['d2d4', 'g8f6'], replies: ['c2c4', 'g1f3'] },
  { sequence: ['d2d4', 'd7d5'], replies: ['c2c4', 'g1f3', 'c1f4'] },
  { sequence: ['d2d4', 'g8f6', 'c2c4'], replies: ['e7e6', 'g7g6', 'c7c5'] },
  { sequence: ['d2d4', 'g8f6', 'c2c4', 'g7g6'], replies: ['b1c3', 'g1f3'] },
  { sequence: ['e2e4', 'e7e5', 'g1f3'], replies: ['b8c6', 'g8f6'] },
  { sequence: ['e2e4', 'e7e5', 'g1f3', 'b8c6'], replies: ['f1b5', 'f1c4', 'd2d4'] },
  { sequence: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5'], replies: ['a7a6', 'g8f6'] },
  { sequence: ['c2c4', 'e7e5'], replies: ['b1c3', 'g1f3'] },
  { sequence: ['g1f3', 'd7d5'], replies: ['d2d4', 'c2c4', 'g2g3'] },
  // Sicilian Defense: Open Sicilian
  { sequence: ['e2e4', 'c7c5', 'g1f3'], replies: ['d7d6', 'b8c6', 'e7e6'] },
  { sequence: ['e2e4', 'c7c5', 'g1f3', 'd7d6'], replies: ['d2d4'] },
  { sequence: ['e2e4', 'c7c5', 'g1f3', 'd7d6', 'd2d4', 'c5d4'], replies: ['f3d4'] },
  { sequence: ['e2e4', 'c7c5', 'g1f3', 'd7d6', 'd2d4', 'c5d4', 'f3d4'], replies: ['g8f6'] },
  { sequence: ['e2e4', 'c7c5', 'g1f3', 'd7d6', 'd2d4', 'c5d4', 'f3d4', 'g8f6'], replies: ['b1c3'] },
  // French Defense
  { sequence: ['e2e4', 'e7e6', 'd2d4'], replies: ['d7d5'] },
  { sequence: ['e2e4', 'e7e6', 'd2d4', 'd7d5'], replies: ['b1c3', 'e4e5', 'b1d2'] },
  // Caro-Kann
  { sequence: ['e2e4', 'c7c6', 'd2d4'], replies: ['d7d5'] },
  { sequence: ['e2e4', 'c7c6', 'd2d4', 'd7d5'], replies: ['b1c3', 'e4e5', 'e4d5'] },
  // Queen's Gambit
  { sequence: ['d2d4', 'd7d5', 'c2c4'], replies: ['e7e6', 'c7c6', 'd5c4'] },
  { sequence: ['d2d4', 'd7d5', 'c2c4', 'e7e6'], replies: ['b1c3', 'g1f3'] },
  { sequence: ['d2d4', 'd7d5', 'c2c4', 'e7e6', 'b1c3'], replies: ['g8f6', 'c7c5'] },
  // Ruy Lopez continuations
  { sequence: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'a7a6'], replies: ['b5a4'] },
  { sequence: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'a7a6', 'b5a4', 'g8f6'], replies: ['e1g1'] },
  // Italian Game (Black replies to Bc4)
  { sequence: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4'], replies: ['f8c5', 'g8f6'] },
  // Sicilian: Nc6 variation
  { sequence: ['e2e4', 'c7c5', 'g1f3', 'b8c6'], replies: ['d2d4', 'f1b5'] },
  // Scandinavian Defense
  { sequence: ['e2e4', 'd7d5'], replies: ['e4d5'] },
  // Modern Defense
  { sequence: ['e2e4', 'g7g6'], replies: ['d2d4', 'g1f3'] },
  // Pirc Defense
  { sequence: ['e2e4', 'd7d6'], replies: ['d2d4', 'g1f3'] },
  // Alekhine Defense
  { sequence: ['e2e4', 'g8f6'], replies: ['e4e5', 'b1c3'] },
  // QGD: White plays Bg5 or Nf3 after ...Nf6
  { sequence: ['d2d4', 'd7d5', 'c2c4', 'e7e6', 'b1c3', 'g8f6'], replies: ['c1g5', 'g1f3'] },
  // King's Indian: White plays e4 after ...Bg7
  { sequence: ['d2d4', 'g8f6', 'c2c4', 'g7g6', 'b1c3', 'f8g7'], replies: ['e2e4', 'g1f3'] },
  // Nimzo-Indian: White replies to ...Bb4
  { sequence: ['d2d4', 'g8f6', 'c2c4', 'e7e6', 'b1c3', 'f8b4'], replies: ['e2e3', 'd1c2', 'g1f3'] },
  // Slav: after Nc3
  { sequence: ['d2d4', 'd7d5', 'c2c4', 'c7c6', 'g1f3', 'g8f6', 'b1c3'], replies: ['d5c4', 'e7e6'] },
  // London System continuation after ...e6
  { sequence: ['d2d4', 'd7d5', 'g1f3', 'g8f6', 'c1f4', 'e7e6'], replies: ['e2e3', 'c2c3'] },
];

// --- Committed Opening Line System ---
// At game start, AI randomly selects one classical line and follows it until:
//  (a) it is in check, (b) the opponent makes any capture, or (c) the planned move is illegal.
interface OpeningLine {
  name: string;
  aiColor: 'w' | 'b';
  // Interleaved UCI: moves[even]=white, moves[odd]=black.
  // Only the AI-color slots are committed; opponent slots are ignored.
  moves: string[];
}

const COMMITTED_LINES_WHITE: OpeningLine[] = [
  {
    name: 'Ruy Lopez',
    aiColor: 'w',
    moves: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'a7a6', 'b5a4', 'g8f6', 'e1g1'],
  },
  {
    name: 'Italian Game',
    aiColor: 'w',
    moves: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'f8c5', 'c2c3', 'g8f6', 'd2d3'],
  },
  {
    name: "Queen's Gambit",
    aiColor: 'w',
    moves: ['d2d4', 'd7d5', 'c2c4', 'e7e6', 'b1c3', 'g8f6', 'c1g5', 'f8e7', 'g1f3'],
  },
  {
    name: 'London System',
    aiColor: 'w',
    moves: ['d2d4', 'd7d5', 'g1f3', 'g8f6', 'c1f4', 'e7e6', 'e2e3', 'f8d6', 'f1d3'],
  },
  {
    name: 'English Opening',
    aiColor: 'w',
    moves: ['c2c4', 'e7e5', 'b1c3', 'g8f6', 'g2g3', 'f8b4', 'f1g2', 'e8g8', 'e2e4'],
  },
];

const COMMITTED_LINES_BLACK: OpeningLine[] = [
  {
    name: 'Sicilian Najdorf',
    aiColor: 'b',
    moves: ['e2e4', 'c7c5', 'g1f3', 'd7d6', 'd2d4', 'c5d4', 'f3d4', 'g8f6', 'b1c3', 'a7a6'],
  },
  {
    name: 'French Winawer',
    aiColor: 'b',
    moves: ['e2e4', 'e7e6', 'd2d4', 'd7d5', 'b1c3', 'f8b4', 'e4e5', 'c7c5', 'a2a3', 'b4c3'],
  },
  {
    name: "King's Indian Defense",
    aiColor: 'b',
    moves: ['d2d4', 'g8f6', 'c2c4', 'g7g6', 'b1c3', 'f8g7', 'e2e4', 'd7d6', 'g1f3', 'e8g8'],
  },
  {
    name: 'Nimzo-Indian Defense',
    aiColor: 'b',
    moves: ['d2d4', 'g8f6', 'c2c4', 'e7e6', 'b1c3', 'f8b4', 'e2e3', 'e8g8', 'f1d3', 'd7d5'],
  },
  {
    name: 'Slav Defense',
    aiColor: 'b',
    moves: ['d2d4', 'd7d5', 'c2c4', 'c7c6', 'g1f3', 'g8f6', 'b1c3', 'd5c4', 'a2a4', 'c8f5'],
  },
];

let committedLine: OpeningLine | null = null;
let committedLineAborted = false;

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

// King endgame PST: rewards centralization, penalizes edge/corner squares.
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

const clampToMin = (value: number, min: number): number => (value < min ? min : value);

// --- Pawn Structure Constants ---
const DOUBLED_PAWN_PENALTY  = -20;
const ISOLATED_PAWN_PENALTY = -15;
const CONNECTED_PAWN_BONUS  =   8;
// Bonus indexed by advancement rank 0–7 (0 = start, 7 = one step from promotion)
const PASSED_PAWN_BONUS = [0, 0, 10, 20, 40, 60, 90, 130];

// --- King Safety Constants (middlegame only) ---
const PAWN_SHIELD_DIRECT_BONUS  =  15; // pawn 1 step in front, king's file
const PAWN_SHIELD_SIDE_BONUS    =  12; // pawn 1 step in front, adjacent file
const PAWN_SHIELD2_DIRECT_BONUS =   8; // pawn 2 steps in front, king's file
const PAWN_SHIELD2_SIDE_BONUS   =   6; // pawn 2 steps in front, adjacent file
const OPEN_FILE_KING_PENALTY      = -25; // no friendly pawn on file near king
const OPEN_FILE_KING_PENALTY_SIDE = -15; // same, adjacent file (60% of center)
const SEMI_OPEN_KING_PENALTY      = -12; // friendly pawn exists but not in shield zone
const SEMI_OPEN_KING_PENALTY_SIDE =  -7; // same, adjacent file (60% of center)
const KING_ZONE_ATTACK_PENALTY    =  -3; // per point of attacker score (capped at 80)
const KING_ATTACK_WEIGHTS: Record<string, number> = { q: 10, r: 7, b: 4, n: 4 };

// --- Rook Evaluation ---
const OPEN_FILE_ROOK_BONUS      = 25; // rook on fully open file (no pawns of either side)
const SEMI_OPEN_FILE_ROOK_BONUS = 12; // rook on semi-open file (no friendly pawn, enemy pawn exists)
const SEVENTH_RANK_ROOK_BONUS   = 40; // rook on the 7th rank (board index 1 for white, 6 for black)
const DOUBLED_ROOK_BONUS        = 15; // per rook when two rooks share the same file

// --- Bishop Pair Bonus ---
const BISHOP_PAIR_BONUS = 40;

// --- Mobility ---
const MOBILITY_FACTOR = 2; // centipawns per pseudo-legal square available to N/B/R/Q

// --- Shared direction tables (mobility scan + SEE defender check) ---
const KNIGHT_JUMPS = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]] as const;
const DIAG_DIRS    = [[-1,-1],[-1,1],[1,-1],[1,1]] as const;
const ORTHO_DIRS   = [[-1,0],[1,0],[0,-1],[0,1]] as const;

// --- Pre-allocated Zero-GC Buffers for Pawn Tracking ---
// Reused on every evaluateBoard call; avoids repeated heap allocations in the hot path.
const _myPawnsByFile:  number[][] = Array.from({ length: 8 }, () => []);
const _oppPawnsByFile: number[][] = Array.from({ length: 8 }, () => []);
const _myPawnPresence  = new Uint8Array(64); // [rank*8+file] = 1 if my pawn is there
const _oppPawnPresence = new Uint8Array(64);

// Rook-per-file counters (reused each eval call, zero-GC).
const _myRooksByFile  = new Uint8Array(8);
const _oppRooksByFile = new Uint8Array(8);

// Evaluates pawn structure for one side from that side's perspective (positive = good).
// color is the side whose pawns are in myPawnsByFile.
const evaluatePawnStructure = (
  myPawnsByFile: number[][],
  oppPawnsByFile: number[][],
  myPawnPresence: Uint8Array,
  color: 'w' | 'b',
): number => {
  let score = 0;

  for (let file = 0; file < 8; file++) {
    const pawns = myPawnsByFile[file];
    if (pawns.length === 0) continue;

    // Doubled pawns: extra pawns on the same file are a structural weakness.
    if (pawns.length > 1) {
      score += DOUBLED_PAWN_PENALTY * (pawns.length - 1);
    }

    // Isolated pawns: no friendly pawns on either adjacent file.
    const hasLeft  = file > 0 && myPawnsByFile[file - 1].length > 0;
    const hasRight = file < 7 && myPawnsByFile[file + 1].length > 0;
    if (!hasLeft && !hasRight) {
      score += ISOLATED_PAWN_PENALTY * pawns.length;
    }

    for (const rank of pawns) {
      // Passed pawn: no opponent pawn on the same or adjacent files *ahead* of us.
      // White advances toward lower rank index (rank 0 = 8th rank).
      // Black advances toward higher rank index (rank 7 = 1st rank).
      let isPassed = true;
      outer: for (let df = -1; df <= 1; df++) {
        const f = file + df;
        if (f < 0 || f >= 8) continue;
        for (const oppRank of oppPawnsByFile[f]) {
          if (color === 'w' ? oppRank <= rank : oppRank >= rank) {
            isPassed = false;
            break outer;
          }
        }
      }
      if (isPassed) {
        const adv = color === 'w' ? 7 - rank : rank;
        score += PASSED_PAWN_BONUS[adv] ?? 0;
      }

      // Connected pawn: protected by a friendly pawn diagonally *behind* it.
      const behindRank = color === 'w' ? rank + 1 : rank - 1;
      if (behindRank >= 0 && behindRank < 8) {
        const idx = behindRank * 8;
        if ((file > 0 && myPawnPresence[idx + file - 1]) ||
            (file < 7 && myPawnPresence[idx + file + 1])) {
          score += CONNECTED_PAWN_BONUS;
        }
      }
    }
  }

  return score;
};

// Evaluates king safety for one side (positive = good for that side).
// Only meaningful in the middlegame; caller passes isEndgame and returns 0 when true.
const evaluateKingSafety = (
  board: ReturnType<Chess['board']>,
  kingRank: number,
  kingFile: number,
  myPawnsByFile: number[][],
  myPawnPresence: Uint8Array,
  color: 'w' | 'b',
): number => {
  let score = 0;

  // Pawn shield: check the king's file and adjacent files, 1–2 squares in front.
  // "In front" for white = lower rank index; for black = higher rank index.
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
      // Fully open file — rook/queen can attack the king directly.
      score += df === 0 ? OPEN_FILE_KING_PENALTY : OPEN_FILE_KING_PENALTY_SIDE;
    } else {
      // Pawn exists on this file but is not in the shield zone (advanced or behind).
      score += df === 0 ? SEMI_OPEN_KING_PENALTY : SEMI_OPEN_KING_PENALTY_SIDE;
    }
  }

  // King zone attacker count: opponent pieces (non-pawn, non-king) within a 5×5 box.
  let attackScore = 0;
  for (let r = Math.max(0, kingRank - 2); r <= Math.min(7, kingRank + 2); r++) {
    for (let f = Math.max(0, kingFile - 2); f <= Math.min(7, kingFile + 2); f++) {
      const p = board[r][f];
      if (p && p.color !== color && p.type !== 'p' && p.type !== 'k') {
        attackScore += KING_ATTACK_WEIGHTS[p.type] ?? 0;
      }
    }
  }
  score += Math.min(attackScore, 80) * KING_ZONE_ATTACK_PENALTY;

  return score;
};

// Counts pseudo-legal destination squares for a piece (ignores pins/checks).
// Used as a cheap mobility proxy inside evaluateBoard.
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
      const r = rank + dr, f = file + df;
      if (r >= 0 && r < 8 && f >= 0 && f < 8) {
        const sq = board[r][f];
        if (!sq || sq.color !== color) count++;
      }
    }
  }
  if (pieceType === 'b' || pieceType === 'q') {
    for (const [dr, df] of DIAG_DIRS) {
      for (let s = 1; s < 8; s++) {
        const r = rank + dr * s, f = file + df * s;
        if (r < 0 || r >= 8 || f < 0 || f >= 8) break;
        const sq = board[r][f];
        if (!sq) { count++; } else { if (sq.color !== color) count++; break; }
      }
    }
  }
  if (pieceType === 'r' || pieceType === 'q') {
    for (const [dr, df] of ORTHO_DIRS) {
      for (let s = 1; s < 8; s++) {
        const r = rank + dr * s, f = file + df * s;
        if (r < 0 || r >= 8 || f < 0 || f >= 8) break;
        const sq = board[r][f];
        if (!sq) { count++; } else { if (sq.color !== color) count++; break; }
      }
    }
  }
  return count;
};

// Returns true if (rank, file) is attacked by any piece of byColor.
// Uses the board as-is (pre-capture); accurate enough for SEE approximation.
const isSquareAttacked = (
  board: ReturnType<Chess['board']>,
  rank: number,
  file: number,
  byColor: 'w' | 'b',
): boolean => {
  // Pawns: white pawns attack from rank+1 (higher board index), black from rank-1.
  const pawnRank = rank + (byColor === 'w' ? 1 : -1);
  for (const df of [-1, 1]) {
    const f = file + df;
    if (pawnRank >= 0 && pawnRank < 8 && f >= 0 && f < 8) {
      const p = board[pawnRank][f];
      if (p && p.type === 'p' && p.color === byColor) return true;
    }
  }
  // Knights
  for (const [dr, df] of KNIGHT_JUMPS) {
    const r = rank + dr, f = file + df;
    if (r >= 0 && r < 8 && f >= 0 && f < 8) {
      const p = board[r][f];
      if (p && p.type === 'n' && p.color === byColor) return true;
    }
  }
  // Bishops / queen (diagonals)
  for (const [dr, df] of DIAG_DIRS) {
    for (let s = 1; s < 8; s++) {
      const r = rank + dr * s, f = file + df * s;
      if (r < 0 || r >= 8 || f < 0 || f >= 8) break;
      const p = board[r][f];
      if (p) {
        if (p.color === byColor && (p.type === 'b' || p.type === 'q')) return true;
        break;
      }
    }
  }
  // Rooks / queen (orthogonals)
  for (const [dr, df] of ORTHO_DIRS) {
    for (let s = 1; s < 8; s++) {
      const r = rank + dr * s, f = file + df * s;
      if (r < 0 || r >= 8 || f < 0 || f >= 8) break;
      const p = board[r][f];
      if (p) {
        if (p.color === byColor && (p.type === 'r' || p.type === 'q')) return true;
        break;
      }
    }
  }
  // King
  for (let dr = -1; dr <= 1; dr++) {
    for (let df = -1; df <= 1; df++) {
      if (dr === 0 && df === 0) continue;
      const r = rank + dr, f = file + df;
      if (r >= 0 && r < 8 && f >= 0 && f < 8) {
        const p = board[r][f];
        if (p && p.type === 'k' && p.color === byColor) return true;
      }
    }
  }
  return false;
};

const sanitizeAiTuning = (candidate: AiTuning): AiTuning => {
  const safeNumber = (value: number, fallback: number, min: number): number =>
    Number.isFinite(value) ? clampToMin(value, min) : fallback;

  const normalized: AiTuning = {
    backtrackPenalty: safeNumber(candidate.backtrackPenalty, DEFAULT_AI_TUNING.backtrackPenalty, 0),
    openingBookEnabled: Boolean(candidate.openingBookEnabled),
    openingBookMaxPly: Math.floor(safeNumber(candidate.openingBookMaxPly, DEFAULT_AI_TUNING.openingBookMaxPly, 0)),
    hardBand: safeNumber(candidate.hardBand, DEFAULT_AI_TUNING.hardBand, 1),
    hardOpeningBand: safeNumber(candidate.hardOpeningBand, DEFAULT_AI_TUNING.hardOpeningBand, 1),
    hardOpeningFallbackBand: safeNumber(
      candidate.hardOpeningFallbackBand,
      DEFAULT_AI_TUNING.hardOpeningFallbackBand,
      1,
    ),
    hardCandidateCap: Math.floor(safeNumber(candidate.hardCandidateCap, DEFAULT_AI_TUNING.hardCandidateCap, 1)),
    mediumBand: safeNumber(candidate.mediumBand, DEFAULT_AI_TUNING.mediumBand, 1),
    mediumNoise: safeNumber(candidate.mediumNoise, DEFAULT_AI_TUNING.mediumNoise, 0),
    aiStyle: (['aggressive', 'defensive', 'balanced'] as AiStyle[]).includes(candidate.aiStyle)
      ? candidate.aiStyle
      : DEFAULT_AI_TUNING.aiStyle,
  };

  if (normalized.hardOpeningFallbackBand < normalized.hardOpeningBand) {
    normalized.hardOpeningFallbackBand = normalized.hardOpeningBand;
  }

  return normalized;
};

const resolveAiTuning = (overrides?: Partial<AiTuning>): AiTuning => {
  if (!overrides || Object.keys(overrides).length === 0) {
    return activeAiTuning;
  }
  return sanitizeAiTuning({
    ...activeAiTuning,
    ...overrides,
  });
};

export const getAiTuning = (): AiTuning => ({ ...activeAiTuning });

export const setAiTuning = (overrides: Partial<AiTuning>): AiTuning => {
  activeAiTuning = sanitizeAiTuning({
    ...activeAiTuning,
    ...overrides,
  });
  return getAiTuning();
};

export const resetOpeningState = (): void => {
  committedLine = null;
  committedLineAborted = false;
};

export const resetAiTuning = (): AiTuning => {
  activeAiTuning = { ...DEFAULT_AI_TUNING };
  resetOpeningState();
  clearTranspositionTable();
  clearHistory();
  return getAiTuning();
};

// --- Transposition Table (typed-array, optionally SharedArrayBuffer-backed) ---
//
// Buffer layout (10 bytes × TT_SIZE entries = 10 MB):
//   [0,           4×N): Int32Array  – scores
//   [4×N,        5×N): Uint8Array   – depths
//   [5×N,        6×N): Uint8Array   – flags  (0=empty 1=exact 2=lower 3=upper)
//   [6×N,        8×N): Uint16Array  – 16-bit hash suffix (collision guard)
//   [8×N,       10×N): Uint16Array  – best move (from | to<<6 | promo<<12; 0=none)
//
// A plain ArrayBuffer is used by default; initSharedTranspositionTable() replaces
// it with a SharedArrayBuffer so all Lazy-SMP workers share one table.

const TT_BITS        = 20;               // 2^20 = 1 048 576 entries
const TT_SIZE        = 1 << TT_BITS;
const TT_INDEX_MASK  = TT_SIZE - 1;
export const TT_BYTES = TT_SIZE * 10;   // exported so SinglePlayerRoom can allocate

let _ttBuf       = new ArrayBuffer(TT_BYTES);
let _ttScores    = new Int32Array(_ttBuf,  0,             TT_SIZE);
let _ttDepths    = new Uint8Array(_ttBuf,  TT_SIZE * 4,   TT_SIZE);
let _ttFlags     = new Uint8Array(_ttBuf,  TT_SIZE * 5,   TT_SIZE);
let _ttHashKeys  = new Uint16Array(_ttBuf, TT_SIZE * 6,   TT_SIZE);
let _ttBestMoves = new Uint16Array(_ttBuf, TT_SIZE * 8,   TT_SIZE);

// FNV-1a 32-bit — fast and well-distributed for short ASCII strings.
const fnv1a32 = (s: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h  = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
};

// Strip the fullmove number (last field) from FEN while keeping halfmove clock
// for correct 50-move rule tracking.
const makeTTKey = (fen: string): string => fen.slice(0, fen.lastIndexOf(' '));

// Encodes a move's from/to/promotion into a compact Uint16 for TT storage.
// Bit layout: bits[5:0]=from(0–63), bits[11:6]=to(0–63), bits[14:12]=promo(0=none 1=q 2=r 3=b 4=n).
// Value 0 is the "no move" sentinel; a1→a1 is always illegal so 0 is a safe sentinel.
const PROMO_TO_INT: Record<string, number> = { q: 1, r: 2, b: 3, n: 4 };

const encodeTTMove = (move: Move): number => {
  const from  = (move.from.charCodeAt(1) - 49) * 8 + (move.from.charCodeAt(0) - 97);
  const to    = (move.to.charCodeAt(1)   - 49) * 8 + (move.to.charCodeAt(0)   - 97);
  const promo = move.promotion ? (PROMO_TO_INT[move.promotion] ?? 0) : 0;
  return (from & 63) | ((to & 63) << 6) | ((promo & 7) << 12);
};

const ttMoveMatches = (move: Move, encoded: number): boolean => {
  if (encoded === 0) return false;
  const from  = (move.from.charCodeAt(1) - 49) * 8 + (move.from.charCodeAt(0) - 97);
  const to    = (move.to.charCodeAt(1)   - 49) * 8 + (move.to.charCodeAt(0)   - 97);
  const promo = move.promotion ? (PROMO_TO_INT[move.promotion] ?? 0) : 0;
  return ((from & 63) | ((to & 63) << 6) | ((promo & 7) << 12)) === encoded;
};

const lookupTT = (
  key: string,
  depth: number,
): { score?: number; flag?: 'exact' | 'lowerbound' | 'upperbound'; bestMove: number } | undefined => {
  const h   = fnv1a32(key);
  const idx = h & TT_INDEX_MASK;
  const f   = _ttFlags[idx];
  if (f === 0) return undefined;                                     // empty slot
  if (_ttHashKeys[idx] !== ((h >>> 16) & 0xFFFF)) return undefined; // hash collision
  const bestMove = _ttBestMoves[idx];
  if (_ttDepths[idx] < depth) return { bestMove };                   // depth insufficient — move only
  return {
    score:   _ttScores[idx],
    flag:    f === 1 ? 'exact' : f === 2 ? 'lowerbound' : 'upperbound',
    bestMove,
  };
};

const storeTT = (
  key: string,
  score: number,
  depth: number,
  flag: 'exact' | 'lowerbound' | 'upperbound',
  bestMove: Move | null,
): void => {
  const h   = fnv1a32(key);
  const idx = h & TT_INDEX_MASK;
  // Depth-preferred replacement: never displace a deeper entry.
  if (_ttFlags[idx] !== 0 && _ttDepths[idx] > depth) return;
  _ttScores[idx]    = score;
  _ttDepths[idx]    = depth;
  _ttFlags[idx]     = flag === 'exact' ? 1 : flag === 'lowerbound' ? 2 : 3;
  _ttHashKeys[idx]  = (h >>> 16) & 0xFFFF;
  _ttBestMoves[idx] = bestMove ? encodeTTMove(bestMove) : 0;
};

/** Call once per worker to attach a SharedArrayBuffer so all workers share one TT. */
export const initSharedTranspositionTable = (buffer: SharedArrayBuffer): void => {
  _ttBuf       = buffer;
  _ttScores    = new Int32Array(buffer,  0,           TT_SIZE);
  _ttDepths    = new Uint8Array(buffer,  TT_SIZE * 4, TT_SIZE);
  _ttFlags     = new Uint8Array(buffer,  TT_SIZE * 5, TT_SIZE);
  _ttHashKeys  = new Uint16Array(buffer, TT_SIZE * 6, TT_SIZE);
  _ttBestMoves = new Uint16Array(buffer, TT_SIZE * 8, TT_SIZE);
};

export const clearTranspositionTable = (): void => {
  _ttFlags.fill(0); // flag=0 marks every slot as empty
};

const getSquareBonus = (pieceType: string, rank: number, file: number, color: 'w' | 'b', isEndgame = false): number => {
  const table = pieceType === 'k' && isEndgame ? kingEndgamePST : pieceSquareTables[pieceType];
  if (!table) {
    return 0;
  }

  const row = color === 'w' ? rank : 7 - rank;
  return table[row][file] ?? 0;
};

const evaluateBoard = (game: Chess, color: 'w' | 'b', tuning: AiTuning): number => {
  let value = 0;
  const board = game.board();
  const opponent: 'w' | 'b' = color === 'w' ? 'b' : 'w';

  // Reset pawn tracking buffers (zero-GC: reuse pre-allocated module-level arrays).
  for (let f = 0; f < 8; f++) {
    _myPawnsByFile[f].length = 0;
    _oppPawnsByFile[f].length = 0;
  }
  _myPawnPresence.fill(0);
  _oppPawnPresence.fill(0);
  _myRooksByFile.fill(0);
  _oppRooksByFile.fill(0);

  // First pass: locate kings, sum non-pawn material, collect pawn/rook/bishop data.
  let myKingRank = 0; let myKingFile = 0;
  let oppKingRank = 0; let oppKingFile = 0;
  let myNonPawnMaterial = 0;
  let oppNonPawnMaterial = 0;
  let myBishops = 0;
  let oppBishops = 0;
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const p = board[r][f];
      if (p) {
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
            myNonPawnMaterial += pieceValues[p.type] || 0;
            if (p.type === 'r') _myRooksByFile[f]++;
            if (p.type === 'b') myBishops++;
          } else {
            oppNonPawnMaterial += pieceValues[p.type] || 0;
            if (p.type === 'r') _oppRooksByFile[f]++;
            if (p.type === 'b') oppBishops++;
          }
        }
      }
    }
  }

  // Endgame: both sides have dropped below ~R+R in non-pawn material.
  // Tracking per side avoids false positives when one side has a large
  // material lead (e.g. Q+R vs lone king would otherwise count as 1400
  // combined and incorrectly remain in midgame mode).
  const isEndgame = myNonPawnMaterial < 1300 && oppNonPawnMaterial < 1300;

  // Second pass: score all pieces (no intermediate array allocation)
  for (let rank = 0; rank < 8; rank++) {
    for (let file = 0; file < 8; file++) {
      const p = board[rank][file];
      if (!p) continue;

      const pieceValue = pieceValues[p.type] || 0;
      const squareBonus = getSquareBonus(p.type, rank, file, p.color, isEndgame);
      let signedScore = pieceValue + squareBonus;

      // Rook bonuses: open/semi-open file, 7th rank, doubled rooks.
      if (p.type === 'r') {
        const friendlyPawns = p.color === color ? _myPawnsByFile  : _oppPawnsByFile;
        const enemyPawns    = p.color === color ? _oppPawnsByFile : _myPawnsByFile;
        const rooksByFile   = p.color === color ? _myRooksByFile  : _oppRooksByFile;
        if (friendlyPawns[file].length === 0) {
          signedScore += enemyPawns[file].length === 0
            ? OPEN_FILE_ROOK_BONUS
            : SEMI_OPEN_FILE_ROOK_BONUS;
        }
        const seventhRank = p.color === 'w' ? 1 : 6;
        if (rank === seventhRank) signedScore += SEVENTH_RANK_ROOK_BONUS;
        if (rooksByFile[file] >= 2) signedScore += DOUBLED_ROOK_BONUS;
      }

      // Mobility: pseudo-legal square count × MOBILITY_FACTOR for sliding/jumping pieces.
      if (p.type === 'n' || p.type === 'b' || p.type === 'r' || p.type === 'q') {
        signedScore += pseudoMobility(board, rank, file, p.type, p.color) * MOBILITY_FACTOR;
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
        } else { // defensive
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

  // Bishop pair bonus.
  if (myBishops  >= 2) value += BISHOP_PAIR_BONUS;
  if (oppBishops >= 2) value -= BISHOP_PAIR_BONUS;

  // Pawn structure: evaluate both sides and take the net from AI's perspective.
  value += evaluatePawnStructure(_myPawnsByFile, _oppPawnsByFile, _myPawnPresence, color);
  value -= evaluatePawnStructure(_oppPawnsByFile, _myPawnsByFile, _oppPawnPresence, opponent);

  // King safety: only meaningful in the middlegame (king should be active in endgame).
  if (!isEndgame) {
    value += evaluateKingSafety(board, myKingRank, myKingFile, _myPawnsByFile, _myPawnPresence, color);
    value -= evaluateKingSafety(board, oppKingRank, oppKingFile, _oppPawnsByFile, _oppPawnPresence, opponent);
  }

  return value;
};

// isDraw covers threefold repetition, insufficient material, and the 50-move rule.
// Note: isGameOver() is NOT called here because that redundantly checks checkmate/stalemate
// which we already detect via the rawMoves.length === 0 path in minimax.
const isDraw = (game: Chess): boolean =>
  game.isThreefoldRepetition() || game.isInsufficientMaterial() || game.isDrawByFiftyMoves();

const drawScore = (game: Chess, color: 'w' | 'b', tuning: AiTuning): number => {
  const boardScore = evaluateBoard(game, color, tuning);
  if (boardScore < -200) return 20;
  if (boardScore > 200) return -20;
  return -5;
};

// Quiescence search: resolves captures and promotions to avoid the horizon effect.
const quiescence = (
  game: Chess,
  alpha: number,
  beta: number,
  isMaximizingPlayer: boolean,
  color: 'w' | 'b',
  tuning: AiTuning,
): number => {
  if (isDraw(game)) {
    return drawScore(game, color, tuning);
  }

  const allMoves = game.moves({ verbose: true }) as Move[];

  if (allMoves.length === 0) {
    if (game.isCheck()) {
      const aiIsMated = game.turn() === color;
      return aiIsMated ? -MATE_SCORE : MATE_SCORE;
    }
    return drawScore(game, color, tuning);
  }

  const standPat = evaluateBoard(game, color, tuning);
  const inCheckQ = game.isCheck();

  // Stand-pat is only valid when the side to move can choose not to capture.
  // When in check the side is *forced* to move, so stand-pat is meaningless.
  if (!inCheckQ) {
    if (isMaximizingPlayer) {
      if (standPat >= beta) return standPat;
      if (standPat > alpha) alpha = standPat;
    } else {
      if (standPat <= alpha) return standPat;
      if (standPat < beta) beta = standPat;
    }
  }

  // When in check all legal moves are evasions and must be searched — a quiet
  // king step may be the only legal move and ignoring it would return a wrong score.
  // Pass the board to scoreMoveForOrdering so SEE can filter losing captures.
  const qBoard = game.board();
  const captures = inCheckQ
    ? (allMoves as Move[]).sort((a, b) => scoreMoveForOrdering(b, qBoard) - scoreMoveForOrdering(a, qBoard))
    : allMoves
        .filter((m) => m.isCapture() || m.isEnPassant() || m.isPromotion())
        .sort((a, b) => scoreMoveForOrdering(b, qBoard) - scoreMoveForOrdering(a, qBoard));
  if (captures.length === 0) return standPat;

  if (isMaximizingPlayer) {
    let bestVal = standPat;
    for (const move of captures) {
      game.move(move.san);
      bestVal = Math.max(bestVal, quiescence(game, alpha, beta, false, color, tuning));
      game.undo();
      alpha = Math.max(alpha, bestVal);
      if (beta <= alpha) break;
    }
    return bestVal;
  }

  let bestVal = standPat;
  for (const move of captures) {
    game.move(move.san);
    bestVal = Math.min(bestVal, quiescence(game, alpha, beta, true, color, tuning));
    game.undo();
    beta = Math.min(beta, bestVal);
    if (beta <= alpha) break;
  }
  return bestVal;
};

// Returns a move-ordering score. When board is provided, applies a simplified SEE
// correction: losing captures (victim < attacker AND square is defended) are scored
// negatively so they sort below quiet moves and are searched last.
const scoreMoveForOrdering = (move: Move, board?: ReturnType<Chess['board']>): number => {
  let score = 0;

  if (move.isCapture() || move.isEnPassant()) {
    const capturedValue = move.captured ? (pieceValues[move.captured] || 0) : pieceValues.p;
    const attackerValue = pieceValues[move.piece] || 0;
    if (board && capturedValue < attackerValue) {
      // Potentially losing: check if target square is defended by the opponent.
      const toRank = 7 - (move.to.charCodeAt(1) - 49); // board rank index
      const toFile  =     move.to.charCodeAt(0) - 97;  // file index
      const defColor: 'w' | 'b' = move.color === 'w' ? 'b' : 'w';
      if (isSquareAttacked(board, toRank, toFile, defColor)) {
        score += capturedValue - attackerValue; // negative → sorted after quiet moves
      } else {
        score += capturedValue * 10 - attackerValue;
      }
    } else {
      score += capturedValue * 10 - attackerValue;
    }
  }

  if (move.isPromotion()) {
    const promotedPieceValue = move.promotion ? (pieceValues[move.promotion] || 0) : pieceValues.q;
    score += 20 + promotedPieceValue;
  }

  return score;
};

const orderMoves = (moves: Move[], board?: ReturnType<Chess['board']>): Move[] => {
  moves.sort((a, b) => scoreMoveForOrdering(b, board) - scoreMoveForOrdering(a, board));
  return moves;
};

// --- Killer Move Heuristic ---
const MAX_KILLER_PLY = 10;
const killerMoves: Array<[Move | null, Move | null]> = Array.from(
  { length: MAX_KILLER_PLY + 1 },
  () => [null, null],
);

const clearKillers = (): void => {
  for (let i = 0; i <= MAX_KILLER_PLY; i++) {
    killerMoves[i][0] = null;
    killerMoves[i][1] = null;
  }
};

const storeKiller = (move: Move, ply: number): void => {
  if (ply > MAX_KILLER_PLY) return;
  const slot = killerMoves[ply];
  if (slot[0] && slot[0].from === move.from && slot[0].to === move.to) return;
  slot[1] = slot[0];
  slot[0] = move;
};

const killerScore = (move: Move, ply: number): number => {
  if (move.isCapture() || move.isPromotion() || ply > MAX_KILLER_PLY) return 0;
  const slot = killerMoves[ply];
  if (slot[0] && slot[0].from === move.from && slot[0].to === move.to) return 90;
  if (slot[1] && slot[1].from === move.from && slot[1].to === move.to) return 80;
  return 0;
};

// --- History Heuristic ---
// Maps (fromSquare, toSquare) → accumulated score for quiet moves that caused beta cutoffs.
// Persists across moves within a game; cleared at game start and on full reset.
const squareToIndex = (sq: string): number =>
  (sq.charCodeAt(1) - 49) * 8 + (sq.charCodeAt(0) - 97);

const historyTable: number[][] = Array.from({ length: 64 }, () => new Array(64).fill(0));
const MAX_HISTORY_SCORE = 8000;

export const clearHistory = (): void => {
  for (let i = 0; i < 64; i++) historyTable[i].fill(0);
};

// Called on beta cutoff for quiet moves; depth² bonus rewards deeper cutoffs more.
const updateHistory = (move: Move, depth: number): void => {
  const from = squareToIndex(move.from);
  const to = squareToIndex(move.to);
  historyTable[from][to] = Math.min(historyTable[from][to] + depth * depth, MAX_HISTORY_SCORE);
};

// Returns a 0–70 ordering bonus (below killer scores of 80–90) for quiet moves.
const getHistoryScore = (move: Move): number => {
  if (move.isCapture() || move.isPromotion()) return 0;
  const from = squareToIndex(move.from);
  const to = squareToIndex(move.to);
  return (historyTable[from][to] * 70 / MAX_HISTORY_SCORE) | 0;
};

// --- Time Management ---
// All state is module-level so minimax can read it without extra parameters.
const DEFAULT_TIME_LIMITS_MS: Record<string, number> = {
  medium: 300,
  hard: 1500,
  expert: 3000,
};
const MAX_SEARCH_DEPTH = 20; // Hard cap; the time limit is the real constraint.
let searchDeadline = Infinity;
let searchAborted = false;
let nodeCount = 0;
// Check performance.now() every 2048 nodes (bitmask keeps the hot path cheap).
const TIME_CHECK_MASK = 2047;

// --- Null Move Pruning ---
const makeNullMove = (game: Chess): Chess | null => {
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
const allowNullMovePruning = (board: ReturnType<Chess['board']>, color: 'w' | 'b'): boolean => {
  let myMat = 0, oppMat = 0;
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
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

const minimax = (
  game: Chess,
  depth: number,
  alpha: number,
  beta: number,
  isMaximizingPlayer: boolean,
  color: 'w' | 'b',
  tuning: AiTuning,
  ply = 0,
  allowNullMove = true,
): number => {
  // Periodic time check — only calls performance.now() every 2048 nodes.
  if ((++nodeCount & TIME_CHECK_MASK) === 0 && performance.now() >= searchDeadline) {
    searchAborted = true;
  }
  if (searchAborted) return 0; // Result discarded at root; exit fast.

  // Generate moves once per node
  const rawMoves = game.moves({ verbose: true });

  // Terminal: no legal moves
  if (rawMoves.length === 0) {
    if (game.isCheck()) {
      // Checkmate
      const aiIsMated = game.turn() === color;
      return aiIsMated ? -(MATE_SCORE + depth) : MATE_SCORE + depth;
    }
    // Stalemate
    return drawScore(game, color, tuning);
  }

  // Draw detection (threefold repetition, insufficient material, 50-move rule)
  if (isDraw(game)) {
    return drawScore(game, color, tuning);
  }

  // Compute inCheck here so it's available for both the check extension and
  // the LMR / null-move conditions below (avoids a second isCheck() call).
  const inCheck = game.isCheck();

  if (depth === 0) {
    // Check extension: when in check at the horizon, extend by 1 ply so that
    // all forced evasions are searched at full minimax depth rather than being
    // handed off to quiescence (which only looks at captures/promotions and
    // would miss quiet evasions like a king step).
    // The time-limit and chess.js draw detection bound the recursion depth.
    if (inCheck) {
      return minimax(game, 1, alpha, beta, isMaximizingPlayer, color, tuning, ply, allowNullMove);
    }
    return quiescence(game, alpha, beta, isMaximizingPlayer, color, tuning);
  }

  // Transposition table lookup
  const ttKey = makeTTKey(game.fen());
  const originalAlpha = alpha;
  const originalBeta = beta;
  const ttEntry = lookupTT(ttKey, depth);
  const ttBestMove = ttEntry?.bestMove ?? 0;
  if (ttEntry?.score !== undefined && ttEntry.flag !== undefined) {
    if (ttEntry.flag === 'exact') return ttEntry.score;
    if (ttEntry.flag === 'lowerbound' && ttEntry.score > alpha) alpha = ttEntry.score;
    if (ttEntry.flag === 'upperbound' && ttEntry.score < beta) beta = ttEntry.score;
    if (beta <= alpha) return ttEntry.score;
  }

  // Compute board once: used for null-move endgame check and SEE move ordering.
  const board = game.board();

  // Null-move pruning: if we can exceed beta even without moving, prune.
  // Disabled in endgame to avoid Zugzwang errors (allowNullMovePruning checks both).
  if (
    allowNullMove
    && isMaximizingPlayer
    && depth >= 3
    && !inCheck
    && allowNullMovePruning(board, color)
  ) {
    const R = depth >= 5 ? 3 : 2;
    const nullGame = makeNullMove(game);
    if (nullGame) {
      const nullScore = minimax(nullGame, depth - 1 - R, alpha, beta, false, color, tuning, ply + 1, false);
      if (nullScore >= beta) return beta;
    }
  }

  const moves = (rawMoves as Move[]).sort(
    (a, b) =>
      scoreMoveForOrdering(b, board) + killerScore(b, ply) + getHistoryScore(b) + (ttMoveMatches(b, ttBestMove) ? 20000 : 0) -
      (scoreMoveForOrdering(a, board) + killerScore(a, ply) + getHistoryScore(a) + (ttMoveMatches(a, ttBestMove) ? 20000 : 0)),
  );
  let bestMove: Move | null = null;
  let bestVal: number;

  // PVS (Principal Variation Search): first move uses full [alpha,beta] window;
  // subsequent moves use a zero window for fast verification, re-searching with
  // the full window only if the zero window returns a surprisingly good score.
  // LMR (Late Move Reduction) is layered on top: the zero window is searched at
  // reduced depth first, re-searched at full depth if it still fails high.
  if (isMaximizingPlayer) {
    bestVal = -Infinity;
    for (let i = 0; i < moves.length; i += 1) {
      const move = moves[i];
      const isQuiet = !move.isCapture() && !move.isPromotion();
      const canLMR = isQuiet && depth >= 2 && i >= 2 && !inCheck && killerScore(move, ply) === 0;

      game.move(move.san);
      let val: number;
      if (i === 0) {
        // PV move: always search with full window.
        val = minimax(game, depth - 1, alpha, beta, false, color, tuning, ply + 1);
      } else {
        // Non-PV: zero window search, with optional LMR depth reduction.
        const lmrDepth = canLMR ? depth - 2 : depth - 1;
        val = minimax(game, lmrDepth, alpha, alpha + 1, false, color, tuning, ply + 1);
        if (!searchAborted) {
          // If LMR-reduced and failed high, retry at full depth with narrow window.
          if (canLMR && val > alpha) {
            val = minimax(game, depth - 1, alpha, alpha + 1, false, color, tuning, ply + 1);
          }
          // If narrow window failed high (score might be in [alpha+1, beta)), full re-search.
          if (val > alpha && val < beta) {
            val = minimax(game, depth - 1, alpha, beta, false, color, tuning, ply + 1);
          }
        }
      }
      game.undo();
      if (val > bestVal) { bestVal = val; bestMove = move; }
      alpha = Math.max(alpha, bestVal);
      if (beta <= alpha) {
        if (isQuiet) {
          storeKiller(move, ply);
          updateHistory(move, depth);
        }
        break;
      }
    }
  } else {
    bestVal = Infinity;
    for (let i = 0; i < moves.length; i += 1) {
      const move = moves[i];
      const isQuiet = !move.isCapture() && !move.isPromotion();
      const canLMR = isQuiet && depth >= 2 && i >= 2 && !inCheck && killerScore(move, ply) === 0;

      game.move(move.san);
      let val: number;
      if (i === 0) {
        val = minimax(game, depth - 1, alpha, beta, true, color, tuning, ply + 1);
      } else {
        const lmrDepth = canLMR ? depth - 2 : depth - 1;
        val = minimax(game, lmrDepth, beta - 1, beta, true, color, tuning, ply + 1);
        if (!searchAborted) {
          // If LMR-reduced and failed low, retry at full depth with narrow window.
          if (canLMR && val < beta) {
            val = minimax(game, depth - 1, beta - 1, beta, true, color, tuning, ply + 1);
          }
          // If narrow window failed low (score might be in (alpha, beta-1)), full re-search.
          if (val < beta && val > alpha) {
            val = minimax(game, depth - 1, alpha, beta, true, color, tuning, ply + 1);
          }
        }
      }
      game.undo();
      if (val < bestVal) { bestVal = val; bestMove = move; }
      beta = Math.min(beta, bestVal);
      if (beta <= alpha) {
        if (isQuiet) {
          storeKiller(move, ply);
          updateHistory(move, depth);
        }
        break;
      }
    }
  }

  // Store result in transposition table (depth-preferred replacement is handled inside storeTT).
  let flag: 'exact' | 'lowerbound' | 'upperbound';
  if (bestVal <= originalAlpha) {
    flag = 'upperbound';
  } else if (bestVal >= originalBeta) {
    flag = 'lowerbound';
  } else {
    flag = 'exact';
  }
  storeTT(ttKey, bestVal, depth, flag, bestMove);

  return bestVal;
};

const getLastMoveByColor = (game: Chess, color: 'w' | 'b'): Move | null => {
  const history = game.history({ verbose: true }) as Move[];
  for (let i = history.length - 1; i >= 0; i -= 1) {
    if (history[i].color === color) {
      return history[i];
    }
  }
  return null;
};

const isImmediateBacktrack = (move: Move, previousMove: Move | null): boolean => {
  if (!previousMove) {
    return false;
  }

  return move.from === previousMove.to
    && move.to === previousMove.from
    && move.piece === previousMove.piece;
};

const toUci = (move: Pick<Move, 'from' | 'to' | 'promotion'>): string =>
  `${move.from}${move.to}${move.promotion ?? ''}`;

const selectCommittedLine = (color: 'w' | 'b'): void => {
  const lines = color === 'w' ? COMMITTED_LINES_WHITE : COMMITTED_LINES_BLACK;
  committedLine = lines[Math.floor(Math.random() * lines.length)];
  committedLineAborted = false;
};

const getCommittedOpeningMove = (game: Chess, color: 'w' | 'b', plyCount: number): string | null => {
  if (!committedLine || committedLineAborted) return null;

  // Safety: the committed line must have been selected for this side
  if (committedLine.aiColor !== color) {
    committedLineAborted = true;
    return null;
  }

  // Abort on check
  if (game.isCheck()) {
    committedLineAborted = true;
    return null;
  }

  // Abort if opponent's last move was any capture — position may be tactically sharp
  const history = game.history({ verbose: true }) as Move[];
  if (history.length > 0 && history[history.length - 1].captured) {
    committedLineAborted = true;
    return null;
  }

  // Identify which slot in the interleaved line corresponds to our next move
  const aiMovesMade = color === 'w' ? Math.floor(plyCount / 2) : Math.floor((plyCount - 1) / 2);
  const ourSlot = color === 'w' ? aiMovesMade * 2 : aiMovesMade * 2 + 1;
  if (ourSlot >= committedLine.moves.length) return null;

  // Guard: game ply must match the expected slot — catches any state mismatch.
  if (history.length !== ourSlot) {
    committedLineAborted = true;
    return null;
  }

  // Verify the opponent followed the expected line; abort if they deviated
  const opponentSlot = ourSlot - 1;
  if (opponentSlot >= 0 && history.length > 0) {
    const expected = committedLine.moves[opponentSlot];
    const actual = toUci(history[history.length - 1]);
    if (actual !== expected) {
      committedLineAborted = true;
      return null;
    }
  }

  const plannedUci = committedLine.moves[ourSlot];

  // Verify the move is still legal in the current position
  const legalMoves = game.moves({ verbose: true });
  const legalByUci = new Map(legalMoves.map((m) => [toUci(m), m] as const));
  const legal = legalByUci.get(plannedUci);
  if (!legal) {
    committedLineAborted = true;
    return null;
  }

  return legal.san;
};

const getOpeningBookMove = (game: Chess, tuning: AiTuning): string | null => {
  if (!tuning.openingBookEnabled) {
    return null;
  }

  const history = game.history({ verbose: true }) as Move[];
  if (history.length >= tuning.openingBookMaxPly) {
    return null;
  }

  const historyUci = history.map(toUci);
  const matchedEntries = HARD_OPENING_BOOK.filter((entry) => {
    if (entry.sequence.length > historyUci.length) {
      return false;
    }
    for (let i = 0; i < entry.sequence.length; i += 1) {
      if (entry.sequence[i] !== historyUci[i]) {
        return false;
      }
    }
    return true;
  });

  if (matchedEntries.length === 0) {
    return null;
  }

  matchedEntries.sort((a, b) => b.sequence.length - a.sequence.length);
  const longestLength = matchedEntries[0].sequence.length;
  const scopedEntries = matchedEntries.filter((entry) => entry.sequence.length === longestLength);

  const legalMoves = game.moves({ verbose: true });
  const legalByUci = new Map(legalMoves.map((move) => [toUci(move), move] as const));
  const candidateMoves: Move[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < scopedEntries.length; i += 1) {
    const entry = scopedEntries[i];
    for (let j = 0; j < entry.replies.length; j += 1) {
      const reply = entry.replies[j];
      const legalMove = legalByUci.get(reply);
      if (legalMove && !seen.has(reply)) {
        seen.add(reply);
        candidateMoves.push(legalMove);
      }
    }
  }

  if (candidateMoves.length === 0) {
    return null;
  }

  const choiceIndex = Math.floor(Math.random() * candidateMoves.length);
  return candidateMoves[choiceIndex].san;
};

const pickMoveFromTopBand = (
  scoredMoves: Array<{ move: Move; score: number }>,
  difficulty: string,
  openingPhase: boolean,
  tuning: AiTuning,
): Move => {
  scoredMoves.sort((a, b) => b.score - a.score);
  const bestScore = scoredMoves[0].score;
  const band = difficulty === 'hard'
    ? (openingPhase ? tuning.hardOpeningBand : tuning.hardBand)
    : tuning.mediumBand;
  let topBandMoves = scoredMoves.filter(({ score }) => score >= bestScore - band);

  if (difficulty === 'hard' && openingPhase && topBandMoves.length === 1 && scoredMoves.length > 1) {
    const fallbackPool = scoredMoves
      .filter(({ score }) => score >= bestScore - tuning.hardOpeningFallbackBand)
      .slice(0, 4);
    if (fallbackPool.length > 1) {
      topBandMoves = fallbackPool;
    }
  }

  if (topBandMoves.length === 1) {
    return topBandMoves[0].move;
  }

  if (difficulty === 'medium') {
    const weightedPool = topBandMoves
      .map((candidate, index) => ({
        candidate,
        weight: Math.max(1, topBandMoves.length - index),
      }));

    const totalWeight = weightedPool.reduce((sum, entry) => sum + entry.weight, 0);
    let threshold = Math.random() * totalWeight;
    for (let i = 0; i < weightedPool.length; i += 1) {
      threshold -= weightedPool[i].weight;
      if (threshold <= 0) {
        return weightedPool[i].candidate.move;
      }
    }
    return weightedPool[weightedPool.length - 1].candidate.move;
  }

  const cappedCandidates = topBandMoves.slice(0, Math.min(topBandMoves.length, tuning.hardCandidateCap));
  const index = Math.floor(Math.random() * cappedCandidates.length);
  return cappedCandidates[index].move;
};

export const getBestMove = (game: Chess, difficulty: string, overrides?: Partial<AiTuning>, timeLimitMs?: number): string | null => {
  const tuning = resolveAiTuning(overrides);
  clearKillers();

  const moves = orderMoves(game.moves({ verbose: true }) as Move[], game.board());
  if (moves.length === 0) return null;

  if (difficulty === 'easy') {
    const randomIndex = Math.floor(Math.random() * moves.length);
    return moves[randomIndex].san;
  }

  const plyCount = game.history().length;
  // Clear history at the very start of each game (plyCount ≤ 1 covers both AI colours).
  if (plyCount <= 1) {
    clearHistory();
  }
  const color = game.turn();

  if (difficulty === 'hard' || difficulty === 'expert') {
    // Reset and pick a new committed opening line at the start of each game.
    const aiMovesMade = color === 'w' ? Math.floor(plyCount / 2) : Math.floor((plyCount - 1) / 2);
    if (aiMovesMade === 0) {
      selectCommittedLine(color);
    }

    // Follow the committed line if no threat detected
    const committedMove = getCommittedOpeningMove(game, color, plyCount);
    if (committedMove) return committedMove;

    // Fall back to general opening book
    const openingBookMove = getOpeningBookMove(game, tuning);
    if (openingBookMove) {
      return openingBookMove;
    }
  }
  if (difficulty === 'medium') {
    const openingBookMove = getOpeningBookMove(game, tuning);
    if (openingBookMove) return openingBookMove;
  }
  // Time-managed iterative deepening: search from depth 1 upward until the
  // time budget runs out. Scores from the last *completed* depth are always
  // preserved, so an aborted depth never corrupts the result.
  const effectiveTimeLimit = timeLimitMs ?? DEFAULT_TIME_LIMITS_MS[difficulty] ?? 1000;
  searchDeadline = effectiveTimeLimit > 0 ? performance.now() + effectiveTimeLimit : Infinity;
  searchAborted = false;
  nodeCount = 0;

  const previousOwnMove = getLastMoveByColor(game, color);
  const openingPhase = plyCount < 8;

  // Iterative deepening with aspiration windows.
  const ASPIRATION_DELTA = 50;
  const itMoves: Array<{ move: Move; rawScore: number }> = moves.map((m) => ({
    move: m,
    rawScore: scoreMoveForOrdering(m) + getHistoryScore(m), // seed: captures/promotions + history
  }));

  for (let d = 1; d <= MAX_SEARCH_DEPTH; d++) {
    // Don't start a new depth if the time budget is already spent.
    if (d > 1 && performance.now() >= searchDeadline) break;

    itMoves.sort((a, b) => b.rawScore - a.rawScore);
    const prevBest = itMoves[0].rawScore;
    let lo = d > 1 ? prevBest - ASPIRATION_DELTA : -Infinity;
    let hi = d > 1 ? prevBest + ASPIRATION_DELTA : Infinity;

    // depthScores is a fixed-size parallel buffer; only committed to itMoves
    // when ALL moves have been scored without a window failure.
    const depthScores: number[] = new Array(itMoves.length);
    let committed = false;

    retry: for (;;) {
      let rootAlpha = lo;

      for (let i = 0; i < itMoves.length; i++) {
        game.move(itMoves[i].move.san);
        const v = minimax(game, d - 1, rootAlpha, hi, false, color, tuning, 0);
        game.undo();

        if (searchAborted) break retry;                                         // abort — never commit
        if (v >= hi)            { hi = Infinity;  break; }                      // fail-high: widen hi, retry
        if (i === 0 && v <= lo) { lo = -Infinity; break; }                      // fail-low on best: widen lo, retry

        depthScores[i] = v;
        if (v > rootAlpha) rootAlpha = v;

        if (i === itMoves.length - 1) { committed = true; break retry; }       // all moves scored — done
      }
      // Loop continues with widened window (lo or hi updated above).
    }

    if (committed) {
      for (let i = 0; i < itMoves.length; i++) itMoves[i].rawScore = depthScores[i];
    }

    // Abort mid-depth: itMoves still holds the last *completed* depth's scores.
    if (searchAborted) break;
  }

  // Clean up for subsequent calls.
  searchAborted = false;

  // Apply once-only adjustments then select via band picker.
  const scoredMoves = itMoves.map(({ move, rawScore }) => {
    let score = rawScore;
    if (isImmediateBacktrack(move, previousOwnMove) && !move.isCapture() && !move.isPromotion()) {
      score -= tuning.backtrackPenalty;
    }
    if (difficulty === 'medium') {
      score += Math.random() * tuning.mediumNoise;
    }
    return { move, score };
  });

  const selectedMove = pickMoveFromTopBand(scoredMoves, difficulty, openingPhase, tuning);
  return selectedMove?.san ?? moves[0].san;
};

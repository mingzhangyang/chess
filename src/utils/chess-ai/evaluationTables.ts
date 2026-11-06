/**
 * Evaluation constants shared by the evaluator (chessAIEvaluation.ts) and by
 * SearchPosition, which keeps the material and piece-square sums of the
 * tapered evaluation up to date on every move. This module imports nothing,
 * so SearchPosition can use it without an import cycle.
 */
export const TYPE_LETTERS = ['', 'p', 'n', 'b', 'r', 'q', 'k'] as const;

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

// Flat 64-entry tables indexed by piece code; row 0 is the mover's far rank.
export const PST_BY_TYPE: Int16Array[] = TYPE_LETTERS.map((letter) => Int16Array.from(letter ? pieceSquareTables[letter].flat() : []));
export const KING_ENDGAME_PST = Int16Array.from(kingEndgamePST.flat());

/** Game-phase weight by piece type (index 1..6 = p, n, b, r, q, k); 24 is the opening total. */
export const PHASE_BY_TYPE = [0, 0, 1, 1, 2, 4, 0] as const;

type MaterialWeights = { p: number; n: number; b: number; r: number; q: number };
type MobilityWeights = { n: number; b: number; r: number; q: number };

/**
 * Weights of the tapered (default) evaluation, split into middlegame (Mg) and
 * endgame (Eg) values where it matters. Percent fields scale a whole term.
 */
export interface EvalWeights {
  materialMg: MaterialWeights;
  materialEg: MaterialWeights;
  pstMgPct: number;
  pstEgPct: number;
  mobilityMg: MobilityWeights;
  mobilityEg: MobilityWeights;
  passedPawnMgPct: number;
  passedPawnEgPct: number;
  doubledPawn: number;
  isolatedPawn: number;
  backwardPawn: number;
  connectedPawn: number;
  rookOpenFile: number;
  rookSemiOpenFile: number;
  rookSeventhRank: number;
  doubledRooks: number;
  bishopPair: number;
  knightOutpostMg: number;
  knightOutpostEg: number;
  kingSafetyPct: number;
}

// Texel-tuned against Stockfish evaluations of ~3.6k quiet positions drawn
// from ~450 self-play games (bounded to keep conventional piece relations),
// then confirmed by a 64-game match against the previous hand-set weights.
export const DEFAULT_EVAL_WEIGHTS: EvalWeights = {
  materialMg: { p: 100, n: 350, b: 360, r: 470, q: 1100 },
  materialEg: { p: 90, n: 330, b: 340, r: 500, q: 1010 },
  pstMgPct: 100,
  pstEgPct: 60,
  mobilityMg: { n: 5, b: 7, r: 7, q: 2 },
  mobilityEg: { n: 2, b: 1, r: 5, q: 7 },
  passedPawnMgPct: 50,
  passedPawnEgPct: 220,
  doubledPawn: -20,
  isolatedPawn: -9,
  backwardPawn: -6,
  connectedPawn: 5,
  rookOpenFile: 40,
  rookSemiOpenFile: 37,
  rookSeventhRank: 0,
  doubledRooks: 0,
  bishopPair: 50,
  knightOutpostMg: 4,
  knightOutpostEg: 12,
  kingSafetyPct: 150,
};

/**
 * Material plus piece-square value of each piece on each square in the
 * tapered evaluation with DEFAULT_EVAL_WEIGHTS, signed from white's side and
 * indexed by `(piece + 6) * 64 + square` (piece -6..6, 0 = empty). Kings carry
 * no material here: both sides always have one, so it cancels. Every entry is
 * an integer, so a running sum of them is exact in any order.
 */
const pieceSquareTable = (phase: 'mg' | 'eg'): Int32Array => {
  const weights = DEFAULT_EVAL_WEIGHTS;
  const material = phase === 'mg' ? weights.materialMg : weights.materialEg;
  const percent = phase === 'mg' ? weights.pstMgPct : weights.pstEgPct;
  const table = new Int32Array(13 * 64);
  for (let piece = -6; piece <= 6; piece += 1) {
    if (piece === 0) continue;
    const type = piece > 0 ? piece : -piece;
    const white = piece > 0;
    for (let square = 0; square < 64; square += 1) {
      const index = (white ? square >> 3 : 7 - (square >> 3)) * 8 + (square & 7);
      const bonus = type === 6 && phase === 'eg' ? KING_ENDGAME_PST[index] : PST_BY_TYPE[type][index];
      const value = (type === 6 ? 0 : material[TYPE_LETTERS[type] as keyof MaterialWeights]) + (bonus * percent) / 100;
      if (!Number.isInteger(value)) throw new Error('piece-square values must be integers for exact incremental sums');
      table[(piece + 6) * 64 + square] = white ? value : -value;
    }
  }
  return table;
};
export const PIECE_SQUARE_MG = pieceSquareTable('mg');
export const PIECE_SQUARE_EG = pieceSquareTable('eg');

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
];

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

const clampToMin = (value: number, min: number): number => (value < min ? min : value);

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

export const resetAiTuning = (): AiTuning => {
  activeAiTuning = { ...DEFAULT_AI_TUNING };
  return getAiTuning();
};

const getSquareBonus = (pieceType: string, rank: number, file: number, color: 'w' | 'b'): number => {
  const table = pieceSquareTables[pieceType];
  if (!table) {
    return 0;
  }

  const row = color === 'w' ? rank : 7 - rank;
  return table[row][file] ?? 0;
};

const evaluateBoard = (game: Chess, color: 'w' | 'b', tuning: AiTuning) => {
  let value = 0;
  const board = game.board();
  const opponentColor = color === 'w' ? 'b' : 'w';

  // Find kings for style-based evaluation
  let myKingPos = { rank: 0, file: 0 };
  let oppKingPos = { rank: 0, file: 0 };
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const p = board[r][f];
      if (p && p.type === 'k') {
        if (p.color === color) myKingPos = { rank: r, file: f };
        else oppKingPos = { rank: r, file: f };
      }
    }
  }

  for (let rank = 0; rank < 8; rank += 1) {
    for (let file = 0; file < 8; file += 1) {
      const piece = board[rank][file];
      if (piece) {
        const pieceValue = pieceValues[piece.type] || 0;
        const squareBonus = getSquareBonus(piece.type, rank, file, piece.color);
        let signedScore = pieceValue + squareBonus;

        // --- Style Adjustments ---
        if (tuning.aiStyle === 'aggressive') {
          // Bonus for attacking pieces getting closer to enemy king
          if (piece.color === color && piece.type !== 'k' && piece.type !== 'p') {
            const dist = Math.abs(rank - oppKingPos.rank) + Math.abs(file - oppKingPos.file);
            signedScore += (14 - dist) * 2;
          }
          // Extra bonus for central control in aggressive mode
          if (piece.color === color && (rank >= 2 && rank <= 5) && (file >= 2 && file <= 5)) {
            signedScore += 10;
          }
        } else if (tuning.aiStyle === 'defensive') {
          // Bonus for pieces staying close to own king
          if (piece.color === color && piece.type !== 'k') {
            const dist = Math.abs(rank - myKingPos.rank) + Math.abs(file - myKingPos.file);
            if (dist <= 2) {
              signedScore += 15;
            }
          }
          // Slight penalty for having pieces too far away from defense
          if (piece.color === color && piece.type !== 'k' && piece.type !== 'p') {
            const dist = Math.abs(rank - myKingPos.rank) + Math.abs(file - myKingPos.file);
            if (dist > 5) {
              signedScore -= 5;
            }
          }
        }

        value += piece.color === color ? signedScore : -signedScore;
      }
    }
  }

  const mobility = game.moves().length * 2;
  value += game.turn() === color ? mobility : -mobility;

  return value;
};

const evaluateTerminalState = (game: Chess, color: 'w' | 'b', depth: number, tuning: AiTuning): number | null => {
  if (game.isCheckmate()) {
    const aiIsMated = game.turn() === color;
    return aiIsMated ? -(MATE_SCORE + depth) : MATE_SCORE + depth;
  }

  if (game.isDraw()) {
    const boardScore = evaluateBoard(game, color, tuning);
    if (boardScore < -120) {
      return 20;
    }
    if (boardScore > 120) {
      return -20;
    }
    return -5;
  }

  return null;
};

const scoreMoveForOrdering = (game: Chess, move: Move): number => {
  let score = 0;

  if (move.isCapture() || move.isEnPassant()) {
    const capturedValue = move.captured ? (pieceValues[move.captured] || 0) : pieceValues.p;
    const attackerValue = pieceValues[move.piece] || 0;
    score += capturedValue * 10 - attackerValue;
  }

  if (move.isPromotion()) {
    const promotedPieceValue = move.promotion ? (pieceValues[move.promotion] || 0) : pieceValues.q;
    score += 20 + promotedPieceValue;
  }

  game.move(move.san);
  if (game.isCheckmate()) {
    score += MATE_SCORE;
  } else if (game.isCheck()) {
    score += 15;
  }
  game.undo();

  return score;
};

const getOrderedMoves = (game: Chess): Move[] => {
  const moves = game.moves({ verbose: true });
  const scoredMoves = moves.map((move) => ({
    move,
    score: scoreMoveForOrdering(game, move),
  }));

  scoredMoves.sort((a, b) => b.score - a.score);
  return scoredMoves.map(({ move }) => move);
};

const minimax = (
  game: Chess,
  depth: number,
  alpha: number,
  beta: number,
  isMaximizingPlayer: boolean,
  color: 'w' | 'b',
  tuning: AiTuning,
): number => {
  const terminalScore = evaluateTerminalState(game, color, depth, tuning);
  if (terminalScore !== null) {
    return terminalScore;
  }

  if (depth === 0) {
    return evaluateBoard(game, color, tuning);
  }

  const moves = getOrderedMoves(game);

  if (isMaximizingPlayer) {
    let bestVal = -Infinity;
    for (let i = 0; i < moves.length; i += 1) {
      game.move(moves[i].san);
      bestVal = Math.max(bestVal, minimax(game, depth - 1, alpha, beta, !isMaximizingPlayer, color, tuning));
      game.undo();
      alpha = Math.max(alpha, bestVal);
      if (beta <= alpha) {
        break;
      }
    }
    return bestVal;
  }

  let bestVal = Infinity;
  for (let i = 0; i < moves.length; i += 1) {
    game.move(moves[i].san);
    bestVal = Math.min(bestVal, minimax(game, depth - 1, alpha, beta, !isMaximizingPlayer, color, tuning));
    game.undo();
    beta = Math.min(beta, bestVal);
    if (beta <= alpha) {
      break;
    }
  }
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

export const getBestMove = (game: Chess, difficulty: string, overrides?: Partial<AiTuning>): string | null => {
  const tuning = resolveAiTuning(overrides);

  const moves = getOrderedMoves(game);
  if (moves.length === 0) return null;

  if (difficulty === 'easy') {
    const randomIndex = Math.floor(Math.random() * moves.length);
    return moves[randomIndex].san;
  }

  if (difficulty === 'hard') {
    const openingBookMove = getOpeningBookMove(game, tuning);
    if (openingBookMove) {
      return openingBookMove;
    }
  }

  const depth = difficulty === 'hard' ? 3 : 2;
  const color = game.turn();
  const previousOwnMove = getLastMoveByColor(game, color);
  const openingPhase = game.history().length < 8;
  const scoredMoves: Array<{ move: Move; score: number }> = [];

  for (let i = 0; i < moves.length; i += 1) {
    const move = moves[i];
    game.move(move.san);
    const boardValue = minimax(game, depth - 1, -Infinity, Infinity, false, color, tuning);
    const isCheck = game.isCheck();
    const isMate = game.isCheckmate();
    game.undo();

    let finalValue = boardValue;
    if (
      isImmediateBacktrack(move, previousOwnMove)
      && !move.isCapture()
      && !move.isPromotion()
      && !isCheck
      && !isMate
    ) {
      finalValue -= tuning.backtrackPenalty;
    }

    if (difficulty === 'medium') {
      finalValue += Math.random() * tuning.mediumNoise;
    }

    scoredMoves.push({ move, score: finalValue });
  }

  const selectedMove = pickMoveFromTopBand(scoredMoves, difficulty, openingPhase, tuning);
  return selectedMove?.san ?? moves[0].san;
};

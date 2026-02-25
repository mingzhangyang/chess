import { Chess, Move } from 'chess.js';

const pieceValues: Record<string, number> = {
  p: 10,
  n: 30,
  b: 30,
  r: 50,
  q: 90,
  k: 900,
};

const MATE_SCORE = 100000;

const evaluateBoard = (game: Chess, color: 'w' | 'b') => {
  let value = 0;
  const board = game.board();
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 8; j++) {
      const piece = board[i][j];
      if (piece) {
        const pieceValue = pieceValues[piece.type] || 0;
        value += piece.color === color ? pieceValue : -pieceValue;
      }
    }
  }
  return value;
};

const evaluateTerminalState = (game: Chess, color: 'w' | 'b', depth: number): number | null => {
  if (game.isCheckmate()) {
    const aiIsMated = game.turn() === color;
    return aiIsMated ? -(MATE_SCORE + depth) : MATE_SCORE + depth;
  }

  if (game.isDraw()) {
    return 0;
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

const getOrderedMoves = (game: Chess): string[] => {
  const moves = game.moves({ verbose: true });
  const scoredMoves = moves.map((move) => ({
    san: move.san,
    score: scoreMoveForOrdering(game, move),
  }));

  scoredMoves.sort((a, b) => b.score - a.score);
  return scoredMoves.map((move) => move.san);
};

const minimax = (game: Chess, depth: number, alpha: number, beta: number, isMaximizingPlayer: boolean, color: 'w' | 'b'): number => {
  const terminalScore = evaluateTerminalState(game, color, depth);
  if (terminalScore !== null) {
    return terminalScore;
  }

  if (depth === 0) {
    return evaluateBoard(game, color);
  }

  const moves = getOrderedMoves(game);

  if (isMaximizingPlayer) {
    let bestVal = -Infinity;
    for (let i = 0; i < moves.length; i++) {
      game.move(moves[i]);
      bestVal = Math.max(bestVal, minimax(game, depth - 1, alpha, beta, !isMaximizingPlayer, color));
      game.undo();
      alpha = Math.max(alpha, bestVal);
      if (beta <= alpha) {
        break;
      }
    }
    return bestVal;
  } else {
    let bestVal = Infinity;
    for (let i = 0; i < moves.length; i++) {
      game.move(moves[i]);
      bestVal = Math.min(bestVal, minimax(game, depth - 1, alpha, beta, !isMaximizingPlayer, color));
      game.undo();
      beta = Math.min(beta, bestVal);
      if (beta <= alpha) {
        break;
      }
    }
    return bestVal;
  }
};

export const getBestMove = (game: Chess, difficulty: string): string | null => {
  const moves = getOrderedMoves(game);
  if (moves.length === 0) return null;

  if (difficulty === 'easy') {
    const randomIndex = Math.floor(Math.random() * moves.length);
    return moves[randomIndex];
  }

  const depth = difficulty === 'hard' ? 3 : 2;
  const color = game.turn();
  
  let bestMove = null;
  let bestValue = -Infinity;

  for (let i = 0; i < moves.length; i++) {
    const move = moves[i];
    game.move(move);
    const boardValue = minimax(game, depth - 1, -Infinity, Infinity, false, color);
    game.undo();
    
    const randomFactor = difficulty === 'medium' ? Math.random() * 0.05 : 0;
    const finalValue = boardValue + randomFactor;

    if (finalValue > bestValue) {
      bestValue = finalValue;
      bestMove = move;
    }
  }

  return bestMove || moves[0];
};

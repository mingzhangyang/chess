import { Chess } from 'chess.js';

const pieceValues: Record<string, number> = {
  p: 10,
  n: 30,
  b: 30,
  r: 50,
  q: 90,
  k: 900,
};

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

const minimax = (game: Chess, depth: number, alpha: number, beta: number, isMaximizingPlayer: boolean, color: 'w' | 'b'): number => {
  if (depth === 0 || game.isGameOver()) {
    return evaluateBoard(game, color);
  }

  const moves = game.moves();

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
  const moves = game.moves();
  if (moves.length === 0) return null;

  if (difficulty === 'easy') {
    const randomIndex = Math.floor(Math.random() * moves.length);
    return moves[randomIndex];
  }

  const depth = difficulty === 'hard' ? 3 : 2;
  const color = game.turn();
  
  let bestMove = null;
  let bestValue = -Infinity;

  // Sort moves to improve alpha-beta pruning (captures first)
  moves.sort((a, b) => {
    return (b.includes('x') ? 1 : 0) - (a.includes('x') ? 1 : 0);
  });

  for (let i = 0; i < moves.length; i++) {
    const move = moves[i];
    game.move(move);
    const boardValue = minimax(game, depth - 1, -Infinity, Infinity, false, color);
    game.undo();
    
    // Add a tiny random factor to prevent playing the exact same game every time
    const randomFactor = Math.random() * 0.1;
    const finalValue = boardValue + randomFactor;

    if (finalValue > bestValue) {
      bestValue = finalValue;
      bestMove = move;
    }
  }

  return bestMove || moves[0];
};

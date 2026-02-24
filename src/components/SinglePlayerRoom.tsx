import React, { useState, useEffect } from 'react';
import { Chess, Square } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import { LogOut, RefreshCw, Undo2 } from 'lucide-react';
import { getBestMove } from '../utils/chessAI';

interface SinglePlayerRoomProps {
  difficulty: string;
  onLeave: () => void;
}

export default function SinglePlayerRoom({ difficulty, onLeave }: SinglePlayerRoomProps) {
  const [game, setGame] = useState(new Chess());
  const [playerColor, setPlayerColor] = useState<'w' | 'b'>('w');
  const [isThinking, setIsThinking] = useState(false);
  const [moveFrom, setMoveFrom] = useState<string | null>(null);
  const [optionSquares, setOptionSquares] = useState<Record<string, React.CSSProperties>>({});
  const [invalidMoveSquare, setInvalidMoveSquare] = useState<string | null>(null);

  const triggerInvalidMove = (square: string) => {
    setInvalidMoveSquare(square);
    setTimeout(() => setInvalidMoveSquare(null), 500);
  };

  const makeComputerMove = () => {
    setIsThinking(true);
    setTimeout(() => {
      const bestMove = getBestMove(game, difficulty);
      if (bestMove) {
        const newGame = new Chess();
        newGame.loadPgn(game.pgn());
        newGame.move(bestMove);
        setGame(newGame);
      }
      setIsThinking(false);
    }, 300); // Small delay for UX
  };

  useEffect(() => {
    if (game.turn() !== playerColor && !game.isGameOver()) {
      makeComputerMove();
    }
  }, [game, playerColor]);

  useEffect(() => {
    if (!moveFrom) {
      setOptionSquares({});
      return;
    }

    const moves = game.moves({
      square: moveFrom as Square,
      verbose: true
    });

    const newOptionSquares: Record<string, React.CSSProperties> = {};
    
    newOptionSquares[moveFrom] = {
      background: 'rgba(255, 255, 0, 0.4)'
    };

    moves.forEach((move) => {
      newOptionSquares[move.to] = {
        background: 'radial-gradient(circle, rgba(0,0,0,.2) 25%, transparent 25%)',
        borderRadius: '50%'
      };
    });

    setOptionSquares(newOptionSquares);
  }, [moveFrom, game]);

  const onSquareClick = ({ square }: { square: string }) => {
    if (game.turn() !== playerColor) return;
    if (isThinking) return;

    if (!moveFrom) {
      const piece = game.get(square as Square);
      if (piece && piece.color === playerColor) {
        setMoveFrom(square);
      }
      return;
    }

    try {
      const newGame = new Chess();
      newGame.loadPgn(game.pgn());
      const move = newGame.move({
        from: moveFrom,
        to: square,
        promotion: 'q',
      });

      if (move === null) {
        const piece = game.get(square as Square);
        if (piece && piece.color === playerColor) {
          setMoveFrom(square);
        } else {
          triggerInvalidMove(square);
          setMoveFrom(null);
        }
        return;
      }

      setGame(newGame);
      setMoveFrom(null);
    } catch (e) {
      const piece = game.get(square as Square);
      if (piece && piece.color === playerColor) {
        setMoveFrom(square);
      } else {
        triggerInvalidMove(square);
        setMoveFrom(null);
      }
    }
  };

  const onDrop = ({ sourceSquare, targetSquare }: { sourceSquare: string, targetSquare: string | null }) => {
    if (!targetSquare) return false;
    if (game.turn() !== playerColor) return false;
    if (isThinking) return false;

    try {
      const newGame = new Chess();
      newGame.loadPgn(game.pgn());
      const move = newGame.move({
        from: sourceSquare,
        to: targetSquare,
        promotion: 'q',
      });

      if (move === null) {
        triggerInvalidMove(targetSquare);
        return false;
      }

      setGame(newGame);
      setMoveFrom(null);
      return true;
    } catch (e) {
      triggerInvalidMove(targetSquare);
      return false;
    }
  };

  const resetGame = () => {
    setGame(new Chess());
    setMoveFrom(null);
  };

  const undoMove = () => {
    if (isThinking) return;
    
    const gameCopy = new Chess();
    gameCopy.loadPgn(game.pgn());
    
    if (gameCopy.history().length >= 2) {
      gameCopy.undo();
      gameCopy.undo();
    } else if (gameCopy.history().length === 1) {
      gameCopy.undo();
    } else {
      return;
    }
    
    setGame(gameCopy);
    setMoveFrom(null);
    setOptionSquares({});
  };

  const getGameStatus = () => {
    if (game.isCheckmate()) {
      const winner = game.turn() === 'w' ? 'Black' : 'White';
      return `Checkmate! ${winner} wins!`;
    }
    if (game.isStalemate()) return "Stalemate! Game is a draw.";
    if (game.isDraw()) return "Draw!";
    if (game.isCheck()) return "Check!";
    if (game.isGameOver()) return "Game Over!";
    return `${game.turn() === playerColor ? "Your turn" : "Computer is thinking..."}`;
  };

  const history = game.history({ verbose: true });
  const lastMove = history[history.length - 1] as { from: string; to: string } | undefined;

  const currentSquareStyles = { ...optionSquares };
  
  if (lastMove) {
    currentSquareStyles[lastMove.from] = {
      background: 'rgba(255, 255, 0, 0.4)',
      ...currentSquareStyles[lastMove.from],
    };
    currentSquareStyles[lastMove.to] = {
      background: 'rgba(255, 255, 0, 0.4)',
      ...currentSquareStyles[lastMove.to],
    };
  }

  if (invalidMoveSquare) {
    currentSquareStyles[invalidMoveSquare] = {
      ...currentSquareStyles[invalidMoveSquare],
      background: 'rgba(239, 68, 68, 0.6)', // Tailwind red-500 with opacity
    };
  }

  return (
    <div className="flex flex-col h-screen bg-slate-900 text-slate-100">
      <header className="flex items-center justify-between px-6 py-4 bg-slate-800 border-b border-slate-700">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-bold">vs Computer</h1>
          <div className="flex items-center gap-2 px-3 py-1 bg-slate-700 rounded-full text-sm">
            <span className="text-slate-300">Difficulty:</span>
            <span className="font-medium text-indigo-400 capitalize">{difficulty}</span>
          </div>
        </div>
        <button
          onClick={onLeave}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-red-400 hover:bg-red-400/10 rounded-lg transition-colors"
        >
          <LogOut className="w-4 h-4" />
          Leave Game
        </button>
      </header>

      <div className="flex-1 flex flex-col items-center justify-center p-8 bg-slate-900/50">
        <div className="w-full max-w-2xl flex flex-col gap-6">
          <div className="flex items-center justify-between px-4 py-3 bg-slate-800 rounded-xl border border-slate-700">
            <div className="flex items-center gap-3">
              <div className={`w-3 h-3 rounded-full ${game.turn() === 'w' ? 'bg-white' : 'bg-black border border-slate-600'}`} />
              <span className="font-medium">
                {getGameStatus()}
              </span>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-sm text-slate-400">
                Playing as <strong className="text-white">{playerColor === 'w' ? 'White' : 'Black'}</strong>
              </span>
              <button
                onClick={() => setPlayerColor(prev => prev === 'w' ? 'b' : 'w')}
                className="px-3 py-1.5 text-sm font-medium bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors flex items-center gap-2"
                title="Swap Colors"
              >
                <RefreshCw className="w-4 h-4" />
                Swap Colors
              </button>
              <button
                onClick={undoMove}
                disabled={isThinking || game.history().length === 0}
                className="px-3 py-1.5 text-sm font-medium bg-slate-700 hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors flex items-center gap-2"
                title="Undo Move"
              >
                <Undo2 className="w-4 h-4" />
                Undo
              </button>
              <button
                onClick={resetGame}
                className="px-3 py-1.5 text-sm font-medium bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors"
              >
                Reset Game
              </button>
            </div>
          </div>
          
          <div className="aspect-square w-full max-w-[600px] mx-auto shadow-2xl rounded-sm overflow-hidden border-4 border-slate-800">
            <Chessboard
              options={{
                position: game.fen(),
                onPieceDrop: onDrop,
                onSquareClick: onSquareClick,
                boardOrientation: playerColor === 'w' ? 'white' : 'black',
                darkSquareStyle: { backgroundColor: '#475569' },
                lightSquareStyle: { backgroundColor: '#cbd5e1' },
                squareStyles: currentSquareStyles
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

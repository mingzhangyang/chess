import React, { useState, useEffect } from 'react';
import { Chess, Square } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import { LogOut, RefreshCw, Undo2, Menu, X, ChevronUp } from 'lucide-react';
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
  const [showControls, setShowControls] = useState(true);

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 768) {
        setShowControls(false);
      } else {
        setShowControls(true);
      }
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

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
    <div className="flex flex-col md:flex-row h-screen bg-slate-900 text-slate-100 relative overflow-hidden">
      {/* Mobile Menu Button - Only visible on small screens when controls are hidden */}
      {!showControls && (
        <button 
          onClick={() => setShowControls(true)}
          className="md:hidden absolute top-4 right-4 z-50 p-3 bg-slate-800/90 backdrop-blur-sm rounded-full shadow-2xl border border-slate-600 text-slate-200 hover:text-white hover:bg-slate-700 transition-all flex items-center gap-2"
          title="Show Controls"
        >
          <Menu className="w-6 h-6" />
        </button>
      )}

      {/* Controls Sidebar/Header */}
      <div className={`${showControls ? 'flex' : 'hidden'} md:flex flex-col bg-slate-800 border-b md:border-b-0 md:border-r border-slate-700 shrink-0 shadow-lg z-40 md:w-80 md:h-full overflow-y-auto`}>
        <header className="flex flex-col items-center md:items-stretch justify-between px-4 py-3 md:p-6 gap-3 md:gap-6">
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center gap-4">
              <h1 className="text-xl font-bold">vs Computer</h1>
            </div>
            {/* Close button only visible on mobile */}
            <button 
              onClick={() => setShowControls(false)}
              className="md:hidden p-2 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors"
              title="Hide Controls"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
            
            <div className="flex flex-col sm:flex-row md:flex-col gap-3 w-full">
              <div className="flex items-center justify-between px-3 py-2 bg-slate-700 rounded-lg text-sm w-full">
                <span className="text-slate-300">Difficulty:</span>
                <span className="font-medium text-indigo-400 capitalize">{difficulty}</span>
              </div>
              <button
                onClick={onLeave}
                className="flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-red-400 hover:bg-red-400/10 rounded-lg transition-colors w-full border border-red-400/20"
              >
                <LogOut className="w-4 h-4" />
                <span>Leave Game</span>
              </button>
            </div>
          </header>

          <div className="flex flex-col px-4 py-3 md:p-6 bg-slate-800/50 gap-4 border-t border-slate-700/50 md:mt-auto">
            <div className="flex items-center gap-3 w-full justify-center md:justify-start">
              <div className={`w-3 h-3 rounded-full ${game.turn() === 'w' ? 'bg-white' : 'bg-black border border-slate-600'}`} />
              <span className="font-medium">
                {getGameStatus()}
              </span>
            </div>
            <div className="flex flex-col sm:flex-row md:flex-col gap-2 w-full">
              <div className="text-sm text-slate-400 text-center md:text-left py-1">
                Playing as <strong className="text-white">{playerColor === 'w' ? 'White' : 'Black'}</strong>
              </div>
              <div className="flex gap-2 w-full">
                <button
                  onClick={() => setPlayerColor(prev => prev === 'w' ? 'b' : 'w')}
                  className="flex-1 px-3 py-2 text-sm font-medium bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors flex items-center justify-center gap-2"
                  title="Swap Colors"
                >
                  <RefreshCw className="w-4 h-4" />
                  <span className="hidden sm:inline md:inline">Swap</span>
                </button>
                <button
                  onClick={undoMove}
                  disabled={isThinking || game.history().length === 0}
                  className="flex-1 px-3 py-2 text-sm font-medium bg-slate-700 hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors flex items-center justify-center gap-2"
                  title="Undo Move"
                >
                  <Undo2 className="w-4 h-4" />
                  <span className="hidden sm:inline md:inline">Undo</span>
                </button>
              </div>
              <button
                onClick={resetGame}
                className="w-full px-3 py-2 text-sm font-medium bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors mt-1 sm:mt-0 md:mt-2"
              >
                Reset Game
              </button>
            </div>
          </div>
        </div>

      <div className="flex-1 overflow-y-auto bg-slate-900/50 flex flex-col items-center justify-center p-4">
        <div className="w-full max-w-[800px] md:max-w-[85vh] aspect-square shadow-2xl rounded-sm overflow-hidden border-4 border-slate-800 flex-shrink-0">
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
  );
}

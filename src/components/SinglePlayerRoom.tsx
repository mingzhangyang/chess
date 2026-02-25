import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Chess, Square } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import { LogOut, RefreshCw, Undo2, Menu, X } from 'lucide-react';
import { playMoveSound } from '../utils/moveSound';

interface SinglePlayerRoomProps {
  difficulty: string;
  onLeave: () => void;
}

interface AiComputeRequest {
  type: 'compute-best-move';
  requestId: number;
  fen: string;
  difficulty: string;
}

interface AiComputeResponse {
  type: 'best-move-result';
  requestId: number;
  fen: string;
  bestMove: string | null;
  error?: string;
}

export default function SinglePlayerRoom({ difficulty, onLeave }: SinglePlayerRoomProps) {
  const [game, setGame] = useState(new Chess());
  const [playerColor, setPlayerColor] = useState<'w' | 'b'>('w');
  const [isThinking, setIsThinking] = useState(false);
  const [moveFrom, setMoveFrom] = useState<string | null>(null);
  const [optionSquares, setOptionSquares] = useState<Record<string, React.CSSProperties>>({});
  const [invalidMoveSquare, setInvalidMoveSquare] = useState<string | null>(null);
  const [showControls, setShowControls] = useState(true);
  const [resetPulse, setResetPulse] = useState(false);
  const resetFeedbackTimerRef = useRef<number | null>(null);
  const invalidMoveTimerRef = useRef<number | null>(null);
  const gameRef = useRef(game);
  const aiWorkerRef = useRef<Worker | null>(null);
  const aiRequestIdRef = useRef(0);
  const pendingFenRef = useRef<string | null>(null);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(min-width: 768px)');
    const handleLayoutChange = () => {
      setShowControls(mediaQuery.matches);
    };
    handleLayoutChange();
    mediaQuery.addEventListener('change', handleLayoutChange);
    return () => mediaQuery.removeEventListener('change', handleLayoutChange);
  }, []);

  const triggerInvalidMove = (square: string) => {
    setInvalidMoveSquare(square);
    if (invalidMoveTimerRef.current) {
      window.clearTimeout(invalidMoveTimerRef.current);
    }
    invalidMoveTimerRef.current = window.setTimeout(() => setInvalidMoveSquare(null), 500);
  };

  useEffect(() => {
    return () => {
      if (resetFeedbackTimerRef.current) {
        window.clearTimeout(resetFeedbackTimerRef.current);
      }
      if (invalidMoveTimerRef.current) {
        window.clearTimeout(invalidMoveTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    gameRef.current = game;
  }, [game]);

  useEffect(() => {
    const worker = new Worker(new URL('../workers/chessAiWorker.ts', import.meta.url), { type: 'module' });
    aiWorkerRef.current = worker;

    const handleWorkerMessage = (event: MessageEvent<AiComputeResponse>) => {
      const payload = event.data;
      if (!payload || payload.type !== 'best-move-result') {
        return;
      }
      if (payload.requestId !== aiRequestIdRef.current) {
        return;
      }

      setIsThinking(false);
      if (!payload.bestMove || payload.fen !== pendingFenRef.current) {
        return;
      }

      const currentGame = gameRef.current;
      if (currentGame.fen() !== payload.fen || currentGame.isGameOver() || currentGame.turn() === playerColor) {
        return;
      }

      const nextGame = new Chess();
      try {
        nextGame.load(payload.fen);
        const move = nextGame.move(payload.bestMove);
        if (!move) {
          return;
        }
        setGame(nextGame);
        playMoveSound();
      } catch {
        return;
      }
    };

    worker.addEventListener('message', handleWorkerMessage);
    return () => {
      worker.removeEventListener('message', handleWorkerMessage);
      worker.terminate();
      aiWorkerRef.current = null;
      setIsThinking(false);
    };
  }, [playerColor]);

  const makeComputerMove = useCallback(() => {
    const worker = aiWorkerRef.current;
    if (!worker) {
      return;
    }
    const fen = game.fen();
    aiRequestIdRef.current += 1;
    pendingFenRef.current = fen;
    setIsThinking(true);
    const payload: AiComputeRequest = {
      type: 'compute-best-move',
      requestId: aiRequestIdRef.current,
      fen,
      difficulty,
    };
    worker.postMessage(payload);
  }, [difficulty, game]);

  useEffect(() => {
    if (!isThinking && game.turn() !== playerColor && !game.isGameOver()) {
      makeComputerMove();
    }
  }, [game, isThinking, makeComputerMove, playerColor]);

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

  const onSquareClick = useCallback(({ square }: { square: string }) => {
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
      newGame.load(game.fen());
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
      playMoveSound();
    } catch (e) {
      const piece = game.get(square as Square);
      if (piece && piece.color === playerColor) {
        setMoveFrom(square);
      } else {
        triggerInvalidMove(square);
        setMoveFrom(null);
      }
    }
  }, [game, isThinking, moveFrom, playerColor]);

  const onDrop = useCallback(({ sourceSquare, targetSquare }: { sourceSquare: string, targetSquare: string | null }) => {
    if (!targetSquare) return false;
    if (game.turn() !== playerColor) return false;
    if (isThinking) return false;

    try {
      const newGame = new Chess();
      newGame.load(game.fen());
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
      playMoveSound();
      return true;
    } catch (e) {
      triggerInvalidMove(targetSquare);
      return false;
    }
  }, [game, isThinking, playerColor]);

  const resetGame = useCallback(() => {
    setResetPulse(true);
    if (resetFeedbackTimerRef.current) {
      window.clearTimeout(resetFeedbackTimerRef.current);
    }
    resetFeedbackTimerRef.current = window.setTimeout(() => setResetPulse(false), 260);
    setGame(new Chess());
    setMoveFrom(null);
  }, []);

  const undoMove = useCallback(() => {
    if (isThinking) return;
    
    const gameCopy = new Chess();
    gameCopy.load(game.fen());
    
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
  }, [game, isThinking]);

  const gameStatus = useMemo(() => {
    if (game.isCheckmate()) {
      const winner = game.turn() === 'w' ? 'Black' : 'White';
      return `Checkmate! ${winner} wins!`;
    }
    if (game.isStalemate()) return "Stalemate! Game is a draw.";
    if (game.isDraw()) return "Draw!";
    if (game.isCheck()) return "Check!";
    if (game.isGameOver()) return "Game Over!";
    return `${game.turn() === playerColor ? "Your turn" : "Computer is thinking..."}`;
  }, [game, playerColor]);

  const history = useMemo(() => game.history({ verbose: true }), [game]);
  const lastMove = history[history.length - 1] as { from: string; to: string } | undefined;
  const statusAlert = game.isCheck() || game.isCheckmate();
  const canUndo = history.length > 0;

  const currentSquareStyles = useMemo(() => {
    const squareStyles = { ...optionSquares };
    if (lastMove) {
      squareStyles[lastMove.from] = {
        background: 'rgba(255, 255, 0, 0.4)',
        ...squareStyles[lastMove.from],
      };
      squareStyles[lastMove.to] = {
        background: 'rgba(255, 255, 0, 0.4)',
        ...squareStyles[lastMove.to],
      };
    }
    if (invalidMoveSquare) {
      squareStyles[invalidMoveSquare] = {
        ...squareStyles[invalidMoveSquare],
        background: 'rgba(239, 68, 68, 0.6)',
      };
    }
    return squareStyles;
  }, [invalidMoveSquare, lastMove, optionSquares]);

  const boardOptions = useMemo(() => ({
    position: game.fen(),
    onPieceDrop: onDrop,
    onSquareClick: onSquareClick,
    boardOrientation: playerColor === 'w' ? 'white' : 'black',
    darkSquareStyle: { backgroundColor: '#8f6a4f' },
    lightSquareStyle: { backgroundColor: '#f2e6cc' },
    squareStyles: currentSquareStyles,
  }), [currentSquareStyles, game, onDrop, onSquareClick, playerColor]);

  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden text-[var(--text-primary)] md:h-dvh md:flex-row">
      {!showControls && (
        <button
          onClick={() => setShowControls(true)}
          className="surface-panel-strong button-neutral absolute right-4 top-20 z-50 rounded-full p-3 transition-all duration-200 hover:scale-[1.03] md:hidden"
          title="Show Controls"
        >
          <Menu className="w-6 h-6" />
        </button>
      )}

      <div className={`surface-panel-strong enter-fade-up z-40 flex w-full shrink-0 flex-col overflow-hidden border-b border-[var(--panel-border)] transition-[max-height,opacity,transform] duration-300 ease-out md:h-full md:max-h-none md:w-[22rem] md:border-r md:border-b-0 ${showControls ? 'max-h-[62dvh] translate-y-0 opacity-100 pointer-events-auto' : 'max-h-0 -translate-y-3 opacity-0 pointer-events-none border-transparent'} md:translate-y-0 md:opacity-100 md:pointer-events-auto`}>
        <header className="flex flex-col items-center justify-between gap-3 px-4 py-3 md:items-stretch md:p-5">
          <div className="flex items-center justify-between w-full">
            <div className="space-y-1">
              <h1 className="title-serif text-2xl font-semibold">Solo Practice</h1>
              <p className="text-xs text-[var(--text-muted)]">Adaptive engine opponent</p>
            </div>
            <button
              onClick={() => setShowControls(false)}
              className="button-neutral rounded-lg p-2 transition-colors md:hidden"
              title="Hide Controls"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex w-full flex-col gap-3 sm:flex-row md:flex-col">
            <div className="surface-panel flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm">
              <span className="text-[var(--text-muted)]">Difficulty:</span>
              <span className="font-semibold capitalize text-[var(--accent)]">{difficulty}</span>
            </div>
            <button
              onClick={onLeave}
              className="button-danger flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors"
            >
              <LogOut className="w-4 h-4" />
              <span>Leave Game</span>
            </button>
          </div>
        </header>

        <div className="mt-auto flex flex-col gap-4 border-t border-[var(--panel-border)] px-4 py-4 md:p-5">
          <div className={`flex w-full items-center justify-center gap-3 rounded-lg px-2 py-1 md:justify-start ${statusAlert ? 'status-alert bg-[var(--danger-soft)]' : ''}`}>
            <div className={`h-3 w-3 rounded-full ${game.turn() === 'w' ? 'border border-slate-300 bg-white' : 'border border-slate-800 bg-black'}`} />
            <span className="font-medium">
              {gameStatus}
            </span>
          </div>
          <div className="flex w-full flex-col gap-2 sm:flex-row md:flex-col">
            <div className="py-1 text-center text-sm text-[var(--text-muted)] md:text-left">
              Playing as <strong className="text-[var(--text-primary)]">{playerColor === 'w' ? 'White' : 'Black'}</strong>
            </div>
            <div className="flex w-full gap-2">
              <button
                onClick={() => setPlayerColor(prev => prev === 'w' ? 'b' : 'w')}
                className="button-neutral flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors"
                title="Swap Colors"
              >
                <RefreshCw className="w-4 h-4" />
                <span className="hidden sm:inline md:inline">Swap</span>
              </button>
              <button
                onClick={undoMove}
                disabled={isThinking || !canUndo}
                className="button-neutral flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45"
                title="Undo Move"
              >
                <Undo2 className="w-4 h-4" />
                <span className="hidden sm:inline md:inline">Undo</span>
              </button>
            </div>
            <button
              onClick={resetGame}
              className={`button-accent mt-1 w-full rounded-lg px-3 py-2 text-sm font-semibold transition-all duration-200 sm:mt-0 md:mt-2 ${resetPulse ? 'reset-feedback' : ''}`}
            >
              Reset Game
            </button>
          </div>
        </div>
      </div>

      <div className="enter-fade enter-delay-1 flex flex-1 flex-col items-center justify-center overflow-y-auto p-4 sm:p-6">
        <div className="surface-panel-strong aspect-square w-full max-w-[820px] flex-shrink-0 overflow-hidden rounded-2xl border border-[var(--panel-border)] p-2 shadow-2xl">
          <div className="h-full w-full overflow-hidden rounded-lg">
            <Chessboard
              options={boardOptions}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

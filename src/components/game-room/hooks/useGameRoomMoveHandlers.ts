import { useCallback } from 'react';
import { Chess, Square } from 'chess.js';
import type React from 'react';
import { playMoveSound } from '../../../utils/moveSound';
import type { RealtimeClient } from '../../../utils/realtimeClient';
import type { LastMove } from '../../../utils/moveHighlights';
import type { MoveRequestPayload } from '../../../../shared/realtimeProtocol';

interface PendingMove {
  requestId: string;
  optimisticFen: string;
  lastMove: LastMove;
}

interface UseGameRoomMoveHandlersParams {
  game: Chess;
  myColor: 'w' | 'b' | null;
  moveFrom: string | null;
  socket: RealtimeClient | null;
  triggerInvalidMove: (square: string) => void;
  clearInvalidMoveHighlight: () => void;
  pendingMoveRef: React.MutableRefObject<PendingMove | null>;
  moveRequestCounterRef: React.MutableRefObject<number>;
  resetFeedbackTimerRef: React.MutableRefObject<number | null>;
  setGame: React.Dispatch<React.SetStateAction<Chess>>;
  setLastMove: React.Dispatch<React.SetStateAction<LastMove | null>>;
  setMoveFrom: React.Dispatch<React.SetStateAction<string | null>>;
  setResetPulse: React.Dispatch<React.SetStateAction<boolean>>;
}

interface UseGameRoomMoveHandlersResult {
  onSquareClick: ({ square }: { square: string }) => void;
  onDrop: ({ sourceSquare, targetSquare }: { sourceSquare: string; targetSquare: string | null }) => boolean;
  resetGame: () => void;
}

export function useGameRoomMoveHandlers({
  game,
  myColor,
  moveFrom,
  socket,
  triggerInvalidMove,
  clearInvalidMoveHighlight,
  pendingMoveRef,
  moveRequestCounterRef,
  resetFeedbackTimerRef,
  setGame,
  setLastMove,
  setMoveFrom,
  setResetPulse,
}: UseGameRoomMoveHandlersParams): UseGameRoomMoveHandlersResult {
  const onSquareClick = useCallback(({ square }: { square: string }) => {
    if (!socket || socket.connectionState !== 'connected') return;
    if (game.turn() !== myColor) return;

    if (!moveFrom) {
      const piece = game.get(square as Square);
      if (piece && piece.color === myColor) {
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
        if (piece && piece.color === myColor) {
          setMoveFrom(square);
        } else {
          triggerInvalidMove(square);
          setMoveFrom(null);
        }
        return;
      }

      setGame(newGame);
      const nextLastMove: LastMove = { from: move.from, to: move.to };
      setLastMove(nextLastMove);
      setMoveFrom(null);
      clearInvalidMoveHighlight();
      const requestId = `${Date.now()}-${moveRequestCounterRef.current++}`;
      pendingMoveRef.current = {
        requestId,
        optimisticFen: newGame.fen(),
        lastMove: nextLastMove,
      };
      playMoveSound();
      socket.emit('chess-move', { requestId, fen: newGame.fen() } satisfies MoveRequestPayload);
    } catch {
      const piece = game.get(square as Square);
      if (piece && piece.color === myColor) {
        setMoveFrom(square);
      } else {
        triggerInvalidMove(square);
        setMoveFrom(null);
      }
    }
  }, [clearInvalidMoveHighlight, game, moveFrom, myColor, pendingMoveRef, moveRequestCounterRef, setGame, setLastMove, setMoveFrom, socket, triggerInvalidMove]);

  const onDrop = useCallback(({ sourceSquare, targetSquare }: { sourceSquare: string; targetSquare: string | null }) => {
    if (!targetSquare) return false;
    if (!socket || socket.connectionState !== 'connected') return false;
    if (game.turn() !== myColor) return false;

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
      const nextLastMove: LastMove = { from: move.from, to: move.to };
      setLastMove(nextLastMove);
      setMoveFrom(null);
      clearInvalidMoveHighlight();
      const requestId = `${Date.now()}-${moveRequestCounterRef.current++}`;
      pendingMoveRef.current = {
        requestId,
        optimisticFen: newGame.fen(),
        lastMove: nextLastMove,
      };
      playMoveSound();
      socket.emit('chess-move', { requestId, fen: newGame.fen() } satisfies MoveRequestPayload);
      return true;
    } catch {
      triggerInvalidMove(targetSquare);
      return false;
    }
  }, [clearInvalidMoveHighlight, game, myColor, pendingMoveRef, moveRequestCounterRef, setGame, setLastMove, setMoveFrom, socket, triggerInvalidMove]);

  const resetGame = useCallback(() => {
    setResetPulse(true);
    if (resetFeedbackTimerRef.current) {
      window.clearTimeout(resetFeedbackTimerRef.current);
    }
    resetFeedbackTimerRef.current = window.setTimeout(() => setResetPulse(false), 260);
    if (socket) {
      socket.emit('reset-game');
    }
    clearInvalidMoveHighlight();
  }, [clearInvalidMoveHighlight, resetFeedbackTimerRef, setResetPulse, socket]);

  return {
    onSquareClick,
    onDrop,
    resetGame,
  };
}

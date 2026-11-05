import { useCallback } from 'react';
import { Chess, Square } from 'chess.js';
import type React from 'react';
import { getMoveSoundKind, playMoveSound } from '../../../utils/moveSound';
import type { RealtimeClient } from '../../../utils/realtimeClient';
import type { LastMove } from '../../../utils/moveHighlights';
import type { MoveRequestPayload } from '../../../../shared/realtimeProtocol';
import { isPawnPromotionMove, type PromotionPiece } from '../../../utils/chessPromotion';

interface PendingMove {
  requestId: string;
  optimisticFen: string;
  lastMove: LastMove;
}

export interface PendingPromotion {
  from: string;
  to: string;
}

interface UseGameRoomMoveHandlersParams {
  game: Chess;
  fenHistory: readonly string[];
  myColor: 'w' | 'b' | null;
  /** Includes history-only endings (threefold repetition) that `game` cannot see. */
  isGameFinished: boolean;
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
  pendingPromotion: PendingPromotion | null;
  setPendingPromotion: React.Dispatch<React.SetStateAction<PendingPromotion | null>>;
  setResetPulse: React.Dispatch<React.SetStateAction<boolean>>;
}

interface UseGameRoomMoveHandlersResult {
  onSquareClick: ({ square }: { square: string }) => void;
  onDrop: ({ sourceSquare, targetSquare }: { sourceSquare: string; targetSquare: string | null }) => boolean;
  onPromotionSelect: (promotion: PromotionPiece) => void;
  onPromotionCancel: () => void;
  resetGame: () => void;
}

export function useGameRoomMoveHandlers({
  game,
  fenHistory,
  myColor,
  isGameFinished,
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
  pendingPromotion,
  setPendingPromotion,
  setResetPulse,
}: UseGameRoomMoveHandlersParams): UseGameRoomMoveHandlersResult {
  const commitMove = useCallback((sourceSquare: string, targetSquare: string, promotion: PromotionPiece = 'q') => {
    if (isGameFinished) return false;
    if (!socket || socket.connectionState !== 'connected' || game.turn() !== myColor) {
      return false;
    }

    try {
      const newGame = new Chess();
      newGame.load(game.fen());
      const move = newGame.move({
        from: sourceSquare,
        to: targetSquare,
        promotion,
      });

      if (move === null) {
        triggerInvalidMove(targetSquare);
        return false;
      }

      setGame(newGame);
      const nextLastMove: LastMove = { from: move.from, to: move.to };
      setLastMove(nextLastMove);
      setMoveFrom(null);
      setPendingPromotion(null);
      clearInvalidMoveHighlight();
      const requestId = `${Date.now()}-${moveRequestCounterRef.current++}`;
      pendingMoveRef.current = {
        requestId,
        optimisticFen: newGame.fen(),
        lastMove: nextLastMove,
      };
      playMoveSound(getMoveSoundKind(newGame, move, fenHistory));
      socket.emit('chess-move', { requestId, fen: newGame.fen() } satisfies MoveRequestPayload);
      return true;
    } catch {
      triggerInvalidMove(targetSquare);
      return false;
    }
  }, [clearInvalidMoveHighlight, fenHistory, game, isGameFinished, myColor, moveRequestCounterRef, pendingMoveRef, setGame, setLastMove, setMoveFrom, setPendingPromotion, socket, triggerInvalidMove]);

  const isLegalCandidate = useCallback((sourceSquare: string, targetSquare: string): boolean => {
    try {
      const candidate = new Chess();
      candidate.load(game.fen());
      return candidate.move({ from: sourceSquare, to: targetSquare, promotion: 'q' }) !== null;
    } catch {
      return false;
    }
  }, [game]);

  const onSquareClick = useCallback(({ square }: { square: string }) => {
    if (isGameFinished) return;
    if (!socket || socket.connectionState !== 'connected') return;
    if (game.turn() !== myColor) return;
    if (pendingPromotion) return;

    if (!moveFrom) {
      const piece = game.get(square as Square);
      if (piece && piece.color === myColor) {
        setMoveFrom(square);
      }
      return;
    }

    try {
      if (!isLegalCandidate(moveFrom, square)) {
        const piece = game.get(square as Square);
        if (piece && piece.color === myColor) {
          setMoveFrom(square);
        } else {
          triggerInvalidMove(square);
          setMoveFrom(null);
        }
        return;
      }

      if (isPawnPromotionMove(game, moveFrom, square)) {
        setPendingPromotion({ from: moveFrom, to: square });
        setMoveFrom(null);
        return;
      }

      commitMove(moveFrom, square);
    } catch {
      const piece = game.get(square as Square);
      if (piece && piece.color === myColor) {
        setMoveFrom(square);
      } else {
        triggerInvalidMove(square);
        setMoveFrom(null);
      }
    }
  }, [commitMove, game, isGameFinished, isLegalCandidate, moveFrom, myColor, pendingPromotion, setMoveFrom, setPendingPromotion, socket, triggerInvalidMove]);

  const onDrop = useCallback(({ sourceSquare, targetSquare }: { sourceSquare: string; targetSquare: string | null }) => {
    if (!targetSquare) return false;
    if (isGameFinished) return false;
    if (!socket || socket.connectionState !== 'connected') return false;
    if (game.turn() !== myColor) return false;
    if (pendingPromotion) return false;

    if (!isLegalCandidate(sourceSquare, targetSquare)) {
      triggerInvalidMove(targetSquare);
      return false;
    }

    if (isPawnPromotionMove(game, sourceSquare, targetSquare)) {
      setPendingPromotion({ from: sourceSquare, to: targetSquare });
      setMoveFrom(null);
      return false;
    }
    return commitMove(sourceSquare, targetSquare);
  }, [commitMove, game, isGameFinished, isLegalCandidate, myColor, pendingPromotion, setMoveFrom, setPendingPromotion, socket, triggerInvalidMove]);

  const onPromotionSelect = useCallback((promotion: PromotionPiece) => {
    if (!pendingPromotion) return;
    commitMove(pendingPromotion.from, pendingPromotion.to, promotion);
  }, [commitMove, pendingPromotion]);

  const onPromotionCancel = useCallback(() => {
    setPendingPromotion(null);
    setMoveFrom(null);
  }, [setMoveFrom, setPendingPromotion]);

  const resetGame = useCallback(() => {
    setResetPulse(true);
    if (resetFeedbackTimerRef.current) {
      window.clearTimeout(resetFeedbackTimerRef.current);
    }
    resetFeedbackTimerRef.current = window.setTimeout(() => setResetPulse(false), 260);
    if (socket) {
      socket.emit('reset-game');
    }
    setPendingPromotion(null);
    setMoveFrom(null);
    clearInvalidMoveHighlight();
  }, [clearInvalidMoveHighlight, resetFeedbackTimerRef, setMoveFrom, setPendingPromotion, setResetPulse, socket]);

  return {
    onSquareClick,
    onDrop,
    onPromotionSelect,
    onPromotionCancel,
    resetGame,
  };
}

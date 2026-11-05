import { useCallback, useEffect, useRef } from 'react';
import { Chess } from 'chess.js';
import type React from 'react';
import type { ChatMessage, RoomActionType, RoomUser } from '../../../../shared/realtimeProtocol';
import { useRoomConnection } from '../../../hooks/useRoomConnection';
import { useRtcSession } from '../../../hooks/useRtcSession';
import { appendFenHistory } from '../../../utils/fenHistoryReplay';
import { deriveLastMoveFromFen, deriveMoveFromFen } from '../../../utils/lastMove';
import { getMoveSoundKind, playMoveSound } from '../../../utils/moveSound';
import type { LastMove } from '../../../utils/moveHighlights';
import type { RealtimeClient } from '../../../utils/realtimeClient';

interface PendingMove {
  requestId: string;
  optimisticFen: string;
  lastMove: LastMove;
}

export interface PendingRoomAction {
  requestId: string;
  action: RoomActionType;
  requesterName: string;
}

interface Telemetry {
  info: (name: string, data?: Record<string, unknown>) => void;
  warn: (name: string, data?: Record<string, unknown>) => void;
  error: (name: string, data?: Record<string, unknown>) => void;
}

type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

interface UseGameRoomRealtimeParams {
  roomId: string;
  userName: string;
  myColor: 'w' | 'b' | null;
  t: TranslateFn;
  telemetry: Telemetry;
  maxChatMessages: number;
  gameRef: React.MutableRefObject<Chess>;
  fenHistoryRef: React.MutableRefObject<string[]>;
  clientIdRef: React.MutableRefObject<string | null>;
  socketRef: React.MutableRefObject<RealtimeClient | null>;
  pendingMoveRef: React.MutableRefObject<PendingMove | null>;
  resetFeedbackTimerRef: React.MutableRefObject<number | null>;
  chatAutoScrollRef: React.MutableRefObject<boolean>;
  clearInvalidMoveHighlight: () => void;
  isChatNearBottom: () => boolean;
  setClientId: React.Dispatch<React.SetStateAction<string | null>>;
  setMyColor: React.Dispatch<React.SetStateAction<'w' | 'b' | null>>;
  setUsers: React.Dispatch<React.SetStateAction<RoomUser[]>>;
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  setGame: React.Dispatch<React.SetStateAction<Chess>>;
  setFenHistory: React.Dispatch<React.SetStateAction<string[]>>;
  setLastMove: React.Dispatch<React.SetStateAction<LastMove | null>>;
  setMoveFrom: React.Dispatch<React.SetStateAction<string | null>>;
  setConnectionBanner: React.Dispatch<React.SetStateAction<string | null>>;
  setResetPulse: React.Dispatch<React.SetStateAction<boolean>>;
  setPendingRoomAction: React.Dispatch<React.SetStateAction<PendingRoomAction | null>>;
}

interface UseGameRoomRealtimeResult {
  socket: RealtimeClient | null;
  remoteStream: MediaStream | null;
  isMediaEnabled: boolean;
  localVideoRef: React.RefObject<HTMLVideoElement | null>;
  remoteVideoRef: React.RefObject<HTMLVideoElement | null>;
  isMicOn: boolean;
  isVideoOn: boolean;
  toggleMic: () => void;
  toggleVideo: () => void;
  enableMedia: () => void;
  respondToRoomAction: (accept: boolean) => void;
}

function loadFen(fen: string): Chess | null {
  const nextGame = new Chess();
  try {
    nextGame.load(fen);
    return nextGame;
  } catch {
    return null;
  }
}

function shouldInitiatePeer(localId: string | null, remoteId: string): boolean {
  return !!localId && localId < remoteId;
}

export function useGameRoomRealtime({
  roomId,
  userName,
  myColor,
  t,
  telemetry,
  maxChatMessages,
  gameRef,
  fenHistoryRef,
  clientIdRef,
  socketRef,
  pendingMoveRef,
  resetFeedbackTimerRef,
  chatAutoScrollRef,
  clearInvalidMoveHighlight,
  isChatNearBottom,
  setClientId,
  setMyColor,
  setUsers,
  setMessages,
  setGame,
  setFenHistory,
  setLastMove,
  setMoveFrom,
  setConnectionBanner,
  setResetPulse,
  setPendingRoomAction,
}: UseGameRoomRealtimeParams): UseGameRoomRealtimeResult {
  const pendingRoomActionRef = useRef<PendingRoomAction | null>(null);
  const {
    remoteStream,
    isMediaEnabled,
    localVideoRef,
    remoteVideoRef,
    isMicOn,
    isVideoOn,
    toggleMic,
    toggleVideo,
    enableMedia,
    handleUserJoined,
    handleUserLeft,
    handleOffer,
    handleAnswer,
    handleIceCandidate,
  } = useRtcSession({
    roomId,
    userName,
    canUseMedia: myColor !== null,
    onMediaError: (error) => {
      telemetry.error('local-media-failed', { error: String(error) });
      setConnectionBanner(t('game.mediaUnavailable'));
    },
    onIceCandidateError: (error) => {
      telemetry.warn('ice-candidate-error', { error: String(error) });
    },
    onIceConfigWarning: ({ missingTurn, totalServers }) => {
      if (missingTurn) {
        telemetry.warn('turn-server-missing', { totalServers });
      }
    },
  });

  const socket = useRoomConnection({
    roomId,
    handlers: {
      onConnect: ({ socket: activeSocket, recovered }) => {
        socketRef.current = activeSocket;
        const id = activeSocket.id ?? null;
        clientIdRef.current = id;
        setClientId(id);
        pendingMoveRef.current = null;
        setConnectionBanner(recovered ? t('game.reconnected') : null);
        telemetry.info('socket-connected', { recovered });
        activeSocket.emit('join-room', { userName });
      },
      onConnected: ({ id }) => {
        clientIdRef.current = id;
        setClientId(id);
      },
      onReconnecting: ({ attempt, delayMs }) => {
        setConnectionBanner(
          t('game.reconnecting', {
            attempt,
            seconds: Math.ceil(delayMs / 1000),
          }),
        );
      },
      onTransportFallback: ({ index, total }) => {
        setConnectionBanner(t('game.transportFallback', { index, total }));
        telemetry.warn('socket-transport-fallback', { index, total });
      },
      onUnavailable: ({ attempts }) => {
        setConnectionBanner(t('game.unavailable'));
        telemetry.error('socket-unavailable', { attempts });
      },
      onDisconnect: ({ reason }) => {
        if (reason === 'manual') {
          socketRef.current = null;
        }
        clientIdRef.current = null;
        pendingRoomActionRef.current = null;
        setPendingRoomAction(null);
        setClientId(null);
        if (reason !== 'manual') {
          setConnectionBanner(t('game.disconnected'));
        }
      },
      onRoomState: ({ users: roomUsers, fen, fenHistory, myColor }) => {
        setUsers(roomUsers);
        setMyColor(myColor);
        const syncedGame = loadFen(fen);
        if (syncedGame) {
          setLastMove(deriveLastMoveFromFen(gameRef.current, fen));
          setGame(syncedGame);
          const syncedHistory = fenHistory?.at(-1) === fen ? fenHistory : [fen];
          fenHistoryRef.current = syncedHistory;
          setFenHistory(syncedHistory);
        } else {
          telemetry.warn('invalid-room-fen', { fen });
        }
        setMoveFrom(null);
        clearInvalidMoveHighlight();
        pendingMoveRef.current = null;
        setConnectionBanner(null);
        for (const user of roomUsers) {
          if (user.role === 'player' && user.id !== clientIdRef.current) {
            handleUserJoined({
              socket: socketRef.current,
              userId: user.id,
              role: user.role,
              isInitiator: shouldInitiatePeer(clientIdRef.current, user.id),
            });
          }
        }
      },
      onSeatUpdated: ({ myColor }) => {
        setMyColor(myColor);
      },
      onUserJoined: (user) => {
        setUsers((prev) => [...prev, user]);
        handleUserJoined({
          socket: socketRef.current,
          userId: user.id,
          role: user.role,
          isInitiator: shouldInitiatePeer(clientIdRef.current, user.id),
        });
      },
      onUserLeft: (userId) => {
        setUsers((prev) => prev.filter((u) => u.id !== userId));
        handleUserLeft(userId);
      },
      onChatMessage: (msg) => {
        chatAutoScrollRef.current = isChatNearBottom();
        setMessages((prev) => {
          const next = [...prev, msg];
          return next.length > maxChatMessages ? next.slice(-maxChatMessages) : next;
        });
      },
      onMoveAccepted: ({ requestId, fen }) => {
        const pendingMove = pendingMoveRef.current;
        if (!pendingMove || pendingMove.requestId !== requestId) {
          return;
        }
        pendingMoveRef.current = null;
        const syncedGame = loadFen(fen);
        if (syncedGame) {
          setLastMove(fen === pendingMove.optimisticFen ? pendingMove.lastMove : deriveLastMoveFromFen(gameRef.current, fen));
          setGame(syncedGame);
        }
      },
      onMoveRejected: ({ requestId, code, fen }) => {
        const pendingMove = pendingMoveRef.current;
        if (!pendingMove || pendingMove.requestId !== requestId) {
          return;
        }
        pendingMoveRef.current = null;
        const syncedGame = loadFen(fen);
        if (syncedGame) {
          setLastMove(deriveLastMoveFromFen(gameRef.current, fen));
          setGame(syncedGame);
        }
        setMoveFrom(null);
        clearInvalidMoveHighlight();
        telemetry.warn('move-rejected', { code });
      },
      onChessMove: ({ fen, previousFen, actorId }) => {
        const syncedGame = loadFen(fen);
        if (!syncedGame) return;

        // The worker broadcasts the authoritative previous FEN, so an
        // opponent's capture can be recognized even when our state is stale.
        const before = previousFen ? loadFen(previousFen) : gameRef.current;
        const playedMove = before ? deriveMoveFromFen(before, fen) : null;
        const detectedLastMove = playedMove
          ? { from: playedMove.from, to: playedMove.to }
          : deriveLastMoveFromFen(gameRef.current, fen);
        if (pendingMoveRef.current) {
          const pendingMove = pendingMoveRef.current;
          pendingMoveRef.current = null;
          setLastMove(fen === pendingMove.optimisticFen ? pendingMove.lastMove : detectedLastMove);
        } else {
          setLastMove(detectedLastMove);
        }

        const nextHistory = appendFenHistory(fenHistoryRef.current, previousFen, fen);
        fenHistoryRef.current = nextHistory;
        if (playedMove && (!clientIdRef.current || actorId !== clientIdRef.current)) {
          // Local optimistic moves have already sounded. Never replay
          // their server broadcast, including an end-of-game broadcast.
          playMoveSound(getMoveSoundKind(syncedGame, playedMove, nextHistory));
        }
        setGame(syncedGame);
        setFenHistory(nextHistory);
      },
      onResetGame: () => {
        pendingMoveRef.current = null;
        const initialGame = new Chess();
        fenHistoryRef.current = [initialGame.fen()];
        setGame(initialGame);
        setFenHistory(fenHistoryRef.current);
        setMoveFrom(null);
        setLastMove(null);
        clearInvalidMoveHighlight();
        setResetPulse(true);
        if (resetFeedbackTimerRef.current) {
          window.clearTimeout(resetFeedbackTimerRef.current);
        }
        resetFeedbackTimerRef.current = window.setTimeout(() => setResetPulse(false), 260);
      },
      onActionRequested: (payload) => {
        if (payload.requesterId === clientIdRef.current) {
          setConnectionBanner(payload.action === 'undo' ? t('game.awaitingUndoApproval') : t('game.awaitingSwapApproval'));
          return;
        }

        const pendingAction = {
          requestId: payload.requestId,
          action: payload.action,
          requesterName: payload.requesterName,
        } satisfies PendingRoomAction;
        pendingRoomActionRef.current = pendingAction;
        setPendingRoomAction(pendingAction);
      },
      onActionResolved: (payload) => {
        if (pendingRoomActionRef.current?.requestId === payload.requestId) {
          pendingRoomActionRef.current = null;
          setPendingRoomAction(null);
        }
        if (payload.accepted) {
          setConnectionBanner(null);
          return;
        }
        setConnectionBanner(payload.action === 'undo' ? t('game.undoRequestRejected') : t('game.swapRequestRejected'));
      },
      onOffer: async (payload) => {
        try {
          await handleOffer(socketRef.current, payload);
        } catch (error) {
          telemetry.error('offer-handling-failed', { error: String(error) });
        }
      },
      onAnswer: async (payload) => {
        try {
          await handleAnswer(payload);
        } catch (error) {
          telemetry.error('answer-handling-failed', { error: String(error) });
        }
      },
      onIceCandidate: async (payload) => {
        try {
          await handleIceCandidate(payload);
        } catch (error) {
          telemetry.warn('ice-candidate-handling-failed', { error: String(error) });
        }
      },
      onError: (payload) => {
        telemetry.warn('realtime-error', { code: payload.code });
        setConnectionBanner(t('game.serverError', { code: payload.code }));
      },
    },
  });

  useEffect(() => {
    socketRef.current = socket;
    return () => {
      socketRef.current = null;
    };
  }, [socket, socketRef]);

  const respondToRoomAction = useCallback((accept: boolean) => {
    const pendingAction = pendingRoomActionRef.current;
    if (!pendingAction) {
      return;
    }
    socketRef.current?.emit('action-response', {
      requestId: pendingAction.requestId,
      accept,
    });
    pendingRoomActionRef.current = null;
    setPendingRoomAction(null);
  }, [setPendingRoomAction, socketRef]);

  return {
    socket,
    remoteStream,
    isMediaEnabled,
    localVideoRef,
    remoteVideoRef,
    isMicOn,
    isVideoOn,
    toggleMic,
    toggleVideo,
    enableMedia,
    respondToRoomAction,
  };
}

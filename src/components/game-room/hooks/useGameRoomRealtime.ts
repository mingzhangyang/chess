import { useEffect } from 'react';
import { Chess } from 'chess.js';
import type React from 'react';
import type { ChatMessage, RoomUser } from '../../../../shared/realtimeProtocol';
import { useRoomConnection } from '../../../hooks/useRoomConnection';
import { useRtcSession } from '../../../hooks/useRtcSession';
import { deriveLastMoveFromFen } from '../../../utils/lastMove';
import { playMoveSound } from '../../../utils/moveSound';
import type { LastMove } from '../../../utils/moveHighlights';
import type { RealtimeClient } from '../../../utils/realtimeClient';

interface PendingMove {
  requestId: string;
  optimisticFen: string;
  lastMove: LastMove;
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
  t: TranslateFn;
  telemetry: Telemetry;
  maxChatMessages: number;
  gameRef: React.MutableRefObject<Chess>;
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
  setLastMove: React.Dispatch<React.SetStateAction<LastMove | null>>;
  setMoveFrom: React.Dispatch<React.SetStateAction<string | null>>;
  setConnectionBanner: React.Dispatch<React.SetStateAction<string | null>>;
  setResetPulse: React.Dispatch<React.SetStateAction<boolean>>;
}

interface UseGameRoomRealtimeResult {
  socket: RealtimeClient | null;
  remoteStream: MediaStream | null;
  localVideoRef: React.RefObject<HTMLVideoElement | null>;
  remoteVideoRef: React.RefObject<HTMLVideoElement | null>;
  isMicOn: boolean;
  isVideoOn: boolean;
  toggleMic: () => void;
  toggleVideo: () => void;
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

export function useGameRoomRealtime({
  roomId,
  userName,
  t,
  telemetry,
  maxChatMessages,
  gameRef,
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
  setLastMove,
  setMoveFrom,
  setConnectionBanner,
  setResetPulse,
}: UseGameRoomRealtimeParams): UseGameRoomRealtimeResult {
  const {
    remoteStream,
    localVideoRef,
    remoteVideoRef,
    isMicOn,
    isVideoOn,
    toggleMic,
    toggleVideo,
    handleUserJoined,
    handleUserLeft,
    handleOffer,
    handleAnswer,
    handleIceCandidate,
  } = useRtcSession({
    roomId,
    userName,
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
        setClientId(null);
        if (reason !== 'manual') {
          setConnectionBanner(t('game.disconnected'));
        }
      },
      onRoomState: ({ users: roomUsers, fen, myColor }) => {
        setUsers(roomUsers);
        setMyColor(myColor);
        const syncedGame = loadFen(fen);
        if (syncedGame) {
          setLastMove(deriveLastMoveFromFen(gameRef.current, fen));
          setGame(syncedGame);
        } else {
          telemetry.warn('invalid-room-fen', { fen });
        }
        setMoveFrom(null);
        clearInvalidMoveHighlight();
        pendingMoveRef.current = null;
        setConnectionBanner(null);
      },
      onSeatUpdated: ({ myColor }) => {
        setMyColor(myColor);
      },
      onUserJoined: (user) => {
        setUsers((prev) => [...prev, user]);
        handleUserJoined({ socket: socketRef.current, userId: user.id, role: user.role });
      },
      onUserLeft: (userId) => {
        setUsers((prev) => prev.filter((u) => u.id !== userId));
        handleUserLeft();
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
      onChessMove: ({ fen, actorId }) => {
        const syncedGame = loadFen(fen);
        if (!syncedGame) {
          return;
        }
        if (pendingMoveRef.current) {
          const pendingMove = pendingMoveRef.current;
          pendingMoveRef.current = null;
          setLastMove(fen === pendingMove.optimisticFen ? pendingMove.lastMove : deriveLastMoveFromFen(gameRef.current, fen));
        } else {
          setLastMove(deriveLastMoveFromFen(gameRef.current, fen));
        }
        if (!clientIdRef.current || actorId !== clientIdRef.current) {
          playMoveSound();
        }
        setGame(syncedGame);
      },
      onResetGame: () => {
        pendingMoveRef.current = null;
        setGame(new Chess());
        setMoveFrom(null);
        setLastMove(null);
        clearInvalidMoveHighlight();
        setResetPulse(true);
        if (resetFeedbackTimerRef.current) {
          window.clearTimeout(resetFeedbackTimerRef.current);
        }
        resetFeedbackTimerRef.current = window.setTimeout(() => setResetPulse(false), 260);
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

  return {
    socket,
    remoteStream,
    localVideoRef,
    remoteVideoRef,
    isMicOn,
    isVideoOn,
    toggleMic,
    toggleVideo,
  };
}

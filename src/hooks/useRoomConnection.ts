import { useEffect, useRef, useState } from 'react';
import type { ServerEventMap } from '../../shared/realtimeProtocol';
import { createRealtimeClient, type RealtimeClient } from '../utils/realtimeClient';

interface RoomConnectionHandlers {
  onConnect?: (params: { socket: RealtimeClient; recovered: boolean }) => void;
  onConnected?: (payload: ServerEventMap['connected']) => void;
  onReconnecting?: (payload: { attempt: number; delayMs: number }) => void;
  onTransportFallback?: (payload: { url: string; index: number; total: number }) => void;
  onUnavailable?: (payload: { reason: 'reconnect-exhausted'; attempts: number }) => void;
  onDisconnect?: (payload: { reason: 'close' | 'error' | 'manual' }) => void;
  onRoomState?: (payload: ServerEventMap['room-state']) => void;
  onSeatUpdated?: (payload: ServerEventMap['seat-updated']) => void;
  onUserJoined?: (payload: ServerEventMap['user-joined']) => void;
  onUserLeft?: (payload: ServerEventMap['user-left']) => void;
  onChatMessage?: (payload: ServerEventMap['chat-message']) => void;
  onMoveAccepted?: (payload: ServerEventMap['move-accepted']) => void;
  onMoveRejected?: (payload: ServerEventMap['move-rejected']) => void;
  onChessMove?: (payload: ServerEventMap['chess-move']) => void;
  onResetGame?: () => void;
  onActionRequested?: (payload: ServerEventMap['action-requested']) => void;
  onActionResolved?: (payload: ServerEventMap['action-resolved']) => void;
  onOffer?: (payload: ServerEventMap['offer']) => void;
  onAnswer?: (payload: ServerEventMap['answer']) => void;
  onIceCandidate?: (payload: ServerEventMap['ice-candidate']) => void;
  onError?: (payload: ServerEventMap['error']) => void;
}

interface UseRoomConnectionOptions {
  roomId: string;
  handlers: RoomConnectionHandlers;
}

export function useRoomConnection({ roomId, handlers }: UseRoomConnectionOptions): RealtimeClient | null {
  const [socket, setSocket] = useState<RealtimeClient | null>(null);
  const handlersRef = useRef(handlers);

  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  useEffect(() => {
    const currentSocket = createRealtimeClient(roomId);
    setSocket(currentSocket);

    currentSocket.on('connect', ({ recovered }) => {
      handlersRef.current.onConnect?.({ socket: currentSocket, recovered });
    });
    currentSocket.on('connected', (payload) => {
      handlersRef.current.onConnected?.(payload);
    });
    currentSocket.on('reconnecting', (payload) => {
      handlersRef.current.onReconnecting?.(payload);
    });
    currentSocket.on('transport-fallback', (payload) => {
      handlersRef.current.onTransportFallback?.(payload);
    });
    currentSocket.on('unavailable', (payload) => {
      handlersRef.current.onUnavailable?.(payload);
    });
    currentSocket.on('disconnect', (payload) => {
      handlersRef.current.onDisconnect?.(payload);
    });
    currentSocket.on('room-state', (payload) => {
      handlersRef.current.onRoomState?.(payload);
    });
    currentSocket.on('seat-updated', (payload) => {
      handlersRef.current.onSeatUpdated?.(payload);
    });
    currentSocket.on('user-joined', (payload) => {
      handlersRef.current.onUserJoined?.(payload);
    });
    currentSocket.on('user-left', (payload) => {
      handlersRef.current.onUserLeft?.(payload);
    });
    currentSocket.on('chat-message', (payload) => {
      handlersRef.current.onChatMessage?.(payload);
    });
    currentSocket.on('move-accepted', (payload) => {
      handlersRef.current.onMoveAccepted?.(payload);
    });
    currentSocket.on('move-rejected', (payload) => {
      handlersRef.current.onMoveRejected?.(payload);
    });
    currentSocket.on('chess-move', (payload) => {
      handlersRef.current.onChessMove?.(payload);
    });
    currentSocket.on('reset-game', () => {
      handlersRef.current.onResetGame?.();
    });
    currentSocket.on('action-requested', (payload) => {
      handlersRef.current.onActionRequested?.(payload);
    });
    currentSocket.on('action-resolved', (payload) => {
      handlersRef.current.onActionResolved?.(payload);
    });
    currentSocket.on('offer', (payload) => {
      handlersRef.current.onOffer?.(payload);
    });
    currentSocket.on('answer', (payload) => {
      handlersRef.current.onAnswer?.(payload);
    });
    currentSocket.on('ice-candidate', (payload) => {
      handlersRef.current.onIceCandidate?.(payload);
    });
    currentSocket.on('error', (payload) => {
      handlersRef.current.onError?.(payload);
    });

    return () => {
      currentSocket.disconnect();
      setSocket(null);
    };
  }, [roomId]);

  return socket;
}

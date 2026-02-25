import type {
  ClientEventMap,
  ClientEventType,
  ServerEventMap,
  ServerEventType,
} from '../../shared/realtimeProtocol';
import { isObjectRecord, isServerEventType, parseWireEnvelope } from '../../shared/realtimeProtocol';

type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';
type DisconnectReason = 'close' | 'error' | 'manual';

interface LocalEventMap {
  connect: { recovered: boolean };
  disconnect: { reason: DisconnectReason };
  reconnecting: { attempt: number; delayMs: number };
}

type RoomSocketEventMap = ServerEventMap & LocalEventMap;
type EventHandler<K extends keyof RoomSocketEventMap> = (payload: RoomSocketEventMap[K]) => void;

type QueuedMessage = {
  type: ClientEventType;
  payload?: unknown;
};

export interface RoomSocketClient {
  id: string | null;
  connectionState: ConnectionState;
  on: <K extends keyof RoomSocketEventMap>(event: K, handler: EventHandler<K>) => void;
  emit: <K extends ClientEventType>(
    event: K,
    ...payload: ClientEventMap[K] extends undefined ? [] : [ClientEventMap[K]]
  ) => void;
  disconnect: () => void;
}

function nextReconnectDelayMs(attempt: number): number {
  const cappedAttempt = Math.min(attempt, 6);
  const exponential = 500 * 2 ** (cappedAttempt - 1);
  const baseDelay = Math.min(15_000, exponential);
  const jitter = Math.floor(Math.random() * 300);
  return baseDelay + jitter;
}

export function createRoomSocket(roomId: string): RoomSocketClient {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws/${encodeURIComponent(roomId)}`;

  const listeners = new Map<keyof RoomSocketEventMap, Set<(payload: unknown) => void>>();
  const pending: QueuedMessage[] = [];

  let socket: WebSocket | null = null;
  let reconnectTimer: number | null = null;
  let reconnectAttempt = 0;
  let hasConnected = false;
  let manuallyDisconnected = false;

  const dispatch = <K extends keyof RoomSocketEventMap>(event: K, payload: RoomSocketEventMap[K]) => {
    const handlers = listeners.get(event);
    if (!handlers) {
      return;
    }
    for (const handler of handlers) {
      handler(payload);
    }
  };

  const setConnectionState = (state: ConnectionState) => {
    client.connectionState = state;
  };

  const flushPending = (currentSocket: WebSocket) => {
    while (pending.length > 0) {
      const message = pending.shift();
      if (!message) {
        continue;
      }
      currentSocket.send(JSON.stringify(message));
    }
  };

  const scheduleReconnect = () => {
    if (manuallyDisconnected || reconnectTimer !== null) {
      return;
    }

    reconnectAttempt += 1;
    const delayMs = nextReconnectDelayMs(reconnectAttempt);
    dispatch('reconnecting', { attempt: reconnectAttempt, delayMs });

    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delayMs);
  };

  const handleDisconnect = (reason: DisconnectReason, currentSocket: WebSocket) => {
    if (socket !== currentSocket) {
      return;
    }

    socket = null;
    client.id = null;
    dispatch('disconnect', { reason });

    if (manuallyDisconnected) {
      setConnectionState('disconnected');
      return;
    }

    setConnectionState('reconnecting');
    scheduleReconnect();
  };

  const connect = () => {
    if (manuallyDisconnected) {
      return;
    }

    setConnectionState(hasConnected ? 'reconnecting' : 'connecting');

    const currentSocket = new WebSocket(wsUrl);
    socket = currentSocket;

    currentSocket.addEventListener('open', () => {
      if (socket !== currentSocket || manuallyDisconnected) {
        return;
      }

      reconnectAttempt = 0;
      setConnectionState('connected');
      flushPending(currentSocket);

      const recovered = hasConnected;
      hasConnected = true;
      dispatch('connect', { recovered });
    });

    currentSocket.addEventListener('message', (event) => {
      const parsed = parseWireEnvelope(event.data as string);
      if (!parsed || !isServerEventType(parsed.type)) {
        return;
      }

      if (parsed.type === 'connected') {
        const payload = parsed.payload;
        if (isObjectRecord(payload) && typeof payload.id === 'string') {
          client.id = payload.id;
        }
      }

      dispatch(parsed.type, (parsed as { payload?: unknown }).payload as RoomSocketEventMap[ServerEventType]);
    });

    currentSocket.addEventListener('close', () => {
      handleDisconnect('close', currentSocket);
    });

    currentSocket.addEventListener('error', () => {
      handleDisconnect('error', currentSocket);
    });
  };

  const client: RoomSocketClient = {
    id: null,
    connectionState: 'connecting',
    on(event, handler) {
      const handlers = listeners.get(event) ?? new Set<(payload: unknown) => void>();
      handlers.add(handler as (payload: unknown) => void);
      listeners.set(event, handlers);
    },
    emit(event, ...payload) {
      const message: QueuedMessage =
        payload.length > 0 ? { type: event, payload: payload[0] } : { type: event };

      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(message));
        return;
      }

      pending.push(message);
    },
    disconnect() {
      manuallyDisconnected = true;
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (socket) {
        const currentSocket = socket;
        socket = null;
        currentSocket.close();
        dispatch('disconnect', { reason: 'manual' });
      }
      client.id = null;
      setConnectionState('disconnected');
      listeners.clear();
      pending.length = 0;
    },
  };

  connect();
  return client;
}

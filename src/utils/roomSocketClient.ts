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
  'transport-fallback': { url: string; index: number; total: number };
  unavailable: { reason: 'reconnect-exhausted'; attempts: number };
}

type RoomSocketEventMap = ServerEventMap & LocalEventMap;
type EventHandler<K extends keyof RoomSocketEventMap> = (payload: RoomSocketEventMap[K]) => void;

type QueuedMessage = {
  type: ClientEventType;
  payload?: unknown;
};

const DEFAULT_WEBSOCKET_PATHS = ['/ws', '/api/ws'];
const DEFAULT_MAX_RECONNECT_ATTEMPTS = 8;

interface RuntimeLocation {
  protocol: string;
  host: string;
}

interface RuntimeEnv {
  VITE_REALTIME_WS_URL?: unknown;
  VITE_REALTIME_WS_PATHS?: unknown;
  VITE_REALTIME_MAX_RECONNECT_ATTEMPTS?: unknown;
}

export interface RoomSocketRuntimeConfig {
  websocketUrl?: string | null;
  websocketPaths?: string[] | string | null;
  maxReconnectAttempts?: number | string | null;
}

interface BuildUrlCandidatesParams {
  roomId: string;
  location: RuntimeLocation;
  websocketUrl?: string | null;
  websocketPaths?: string[] | string | null;
}

interface ResolvedRuntimeConfig {
  websocketUrl: string | null;
  websocketPaths: string[] | string | null;
  maxReconnectAttempts: number;
}

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

function toWebSocketProtocol(protocol: string): string {
  return protocol === 'https:' ? 'wss:' : 'ws:';
}

function normalizePath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) {
    return '';
  }
  return trimmed.startsWith('/') ? trimmed.replace(/\/+$/, '') : `/${trimmed.replace(/\/+$/, '')}`;
}

function parsePathCandidates(rawPaths?: string[] | string | null): string[] {
  if (Array.isArray(rawPaths)) {
    return rawPaths.map(normalizePath).filter(Boolean);
  }
  if (typeof rawPaths === 'string') {
    return rawPaths
      .split(',')
      .map((entry) => normalizePath(entry))
      .filter(Boolean);
  }
  return [];
}

function parseMaxReconnectAttempts(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
  }
  return DEFAULT_MAX_RECONNECT_ATTEMPTS;
}

function buildUrlFromBase(baseUrl: string, roomId: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  return `${trimmed}/${encodeURIComponent(roomId)}`;
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

export function buildWebSocketUrlCandidates({
  roomId,
  location,
  websocketUrl,
  websocketPaths,
}: BuildUrlCandidatesParams): string[] {
  if (websocketUrl && websocketUrl.trim()) {
    return [buildUrlFromBase(websocketUrl, roomId)];
  }

  const protocol = toWebSocketProtocol(location.protocol);
  const pathCandidates = parsePathCandidates(websocketPaths);
  const paths = pathCandidates.length > 0 ? pathCandidates : DEFAULT_WEBSOCKET_PATHS;
  const urls = paths.map((path) => `${protocol}//${location.host}${path}/${encodeURIComponent(roomId)}`);
  return dedupe(urls);
}

function resolveRuntimeConfig(overrides?: RoomSocketRuntimeConfig): ResolvedRuntimeConfig {
  const runtimeEnv = ((import.meta as { env?: RuntimeEnv }).env ?? {}) as RuntimeEnv;

  const websocketUrl = overrides?.websocketUrl ?? (typeof runtimeEnv.VITE_REALTIME_WS_URL === 'string' ? runtimeEnv.VITE_REALTIME_WS_URL : null);
  const websocketPaths =
    overrides?.websocketPaths ??
    (typeof runtimeEnv.VITE_REALTIME_WS_PATHS === 'string' ? runtimeEnv.VITE_REALTIME_WS_PATHS : null);
  const maxReconnectAttempts = parseMaxReconnectAttempts(
    overrides?.maxReconnectAttempts ?? runtimeEnv.VITE_REALTIME_MAX_RECONNECT_ATTEMPTS,
  );

  return {
    websocketUrl,
    websocketPaths,
    maxReconnectAttempts,
  };
}

export function createRoomSocket(roomId: string, runtimeOverrides?: RoomSocketRuntimeConfig): RoomSocketClient {
  const runtimeConfig = resolveRuntimeConfig(runtimeOverrides);
  const wsUrls = buildWebSocketUrlCandidates({
    roomId,
    location: window.location,
    websocketUrl: runtimeConfig.websocketUrl,
    websocketPaths: runtimeConfig.websocketPaths,
  });

  const listeners = new Map<keyof RoomSocketEventMap, Set<(payload: unknown) => void>>();
  const pending: QueuedMessage[] = [];

  let socket: WebSocket | null = null;
  let reconnectTimer: number | null = null;
  let reconnectAttempt = 0;
  let hasConnected = false;
  let manuallyDisconnected = false;
  let urlIndex = 0;

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

  const connect = () => {
    if (manuallyDisconnected) {
      return;
    }

    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    setConnectionState(hasConnected ? 'reconnecting' : 'connecting');

    const currentUrl = wsUrls[urlIndex] ?? wsUrls[0];
    const currentSocket = new WebSocket(currentUrl);
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

    const handleDisconnect = (reason: DisconnectReason) => {
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

      if (!hasConnected && urlIndex < wsUrls.length - 1) {
        urlIndex += 1;
        dispatch('transport-fallback', {
          url: wsUrls[urlIndex],
          index: urlIndex + 1,
          total: wsUrls.length,
        });
        setConnectionState('connecting');
        connect();
        return;
      }

      if (reconnectAttempt >= runtimeConfig.maxReconnectAttempts) {
        setConnectionState('disconnected');
        dispatch('unavailable', { reason: 'reconnect-exhausted', attempts: reconnectAttempt });
        return;
      }

      reconnectAttempt += 1;
      const delayMs = nextReconnectDelayMs(reconnectAttempt);
      setConnectionState('reconnecting');
      dispatch('reconnecting', { attempt: reconnectAttempt, delayMs });

      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delayMs);
    };

    currentSocket.addEventListener('close', () => {
      handleDisconnect('close');
    });

    currentSocket.addEventListener('error', () => {
      handleDisconnect('error');
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

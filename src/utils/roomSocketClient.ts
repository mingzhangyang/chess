type EventHandler = (payload: any) => void;

interface WireMessage {
  type: string;
  payload?: unknown;
}

export interface RoomSocketClient {
  id: string | null;
  on: (event: string, handler: EventHandler) => void;
  emit: (event: string, payload?: unknown) => void;
  disconnect: () => void;
}

export function createRoomSocket(roomId: string): RoomSocketClient {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws/${encodeURIComponent(roomId)}`;
  const ws = new WebSocket(wsUrl);

  const listeners = new Map<string, Set<EventHandler>>();
  const pending: WireMessage[] = [];

  const client: RoomSocketClient = {
    id: null,
    on(event, handler) {
      const handlers = listeners.get(event) ?? new Set<EventHandler>();
      handlers.add(handler);
      listeners.set(event, handlers);
    },
    emit(event, payload) {
      const message: WireMessage = { type: event, payload };
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
      } else {
        pending.push(message);
      }
    },
    disconnect() {
      ws.close();
      listeners.clear();
      pending.length = 0;
    },
  };

  const dispatch = (event: string, payload: unknown) => {
    const handlers = listeners.get(event);
    if (!handlers) {
      return;
    }
    for (const handler of handlers) {
      handler(payload);
    }
  };

  ws.addEventListener('open', () => {
    while (pending.length > 0) {
      const message = pending.shift();
      if (!message) {
        continue;
      }
      ws.send(JSON.stringify(message));
    }
    dispatch('connect', null);
  });

  ws.addEventListener('message', (event) => {
    try {
      const parsed = JSON.parse(event.data as string) as WireMessage;
      if (!parsed || typeof parsed.type !== 'string') {
        return;
      }

      if (parsed.type === 'connected') {
        const id =
          parsed.payload && typeof parsed.payload === 'object' && 'id' in parsed.payload
            ? (parsed.payload as { id?: unknown }).id
            : null;
        if (typeof id === 'string') {
          client.id = id;
        }
      }

      dispatch(parsed.type, parsed.payload);
    } catch {
      // ignore malformed events
    }
  });

  ws.addEventListener('close', () => {
    dispatch('disconnect', null);
  });

  ws.addEventListener('error', () => {
    dispatch('disconnect', null);
  });

  return client;
}

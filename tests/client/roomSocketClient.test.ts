import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWebSocketUrlCandidates, createRoomSocket } from '../../src/utils/roomSocketClient';

type Listener = (event?: any) => void;

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly url: string;
  readyState = MockWebSocket.CONNECTING;
  sentMessages: string[] = [];
  private readonly listeners = new Map<string, Set<Listener>>();

  constructor(url: string) {
    this.url = url;
    mockSockets.push(this);
  }

  addEventListener(type: string, handler: Listener): void {
    const set = this.listeners.get(type) ?? new Set<Listener>();
    set.add(handler);
    this.listeners.set(type, set);
  }

  send(data: string): void {
    this.sentMessages.push(data);
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.emit('close');
  }

  open(): void {
    this.readyState = MockWebSocket.OPEN;
    this.emit('open');
  }

  error(): void {
    this.emit('error');
  }

  message(payload: unknown): void {
    this.emit('message', { data: JSON.stringify(payload) });
  }

  private emit(type: string, event?: any): void {
    const handlers = this.listeners.get(type);
    if (!handlers) {
      return;
    }
    for (const handler of handlers) {
      handler(event);
    }
  }
}

const mockSockets: MockWebSocket[] = [];

interface ScheduledTimer {
  id: number;
  delayMs: number;
  callback: () => void;
}

function installBrowserMocks() {
  const originalWindow = (globalThis as any).window;
  const originalWebSocket = (globalThis as any).WebSocket;

  mockSockets.length = 0;
  const scheduledTimers: ScheduledTimer[] = [];
  let timerCounter = 0;

  (globalThis as any).window = {
    location: { protocol: 'http:', host: 'example.test' },
    setTimeout: (callback: () => void, delay?: number) => {
      timerCounter += 1;
      scheduledTimers.push({
        id: timerCounter,
        delayMs: typeof delay === 'number' ? delay : 0,
        callback,
      });
      return timerCounter;
    },
    clearTimeout: (id: number) => {
      const index = scheduledTimers.findIndex((timer) => timer.id === id);
      if (index >= 0) {
        scheduledTimers.splice(index, 1);
      }
    },
  };

  (globalThis as any).WebSocket = MockWebSocket;

  const restore = () => {
    (globalThis as any).window = originalWindow;
    (globalThis as any).WebSocket = originalWebSocket;
    mockSockets.length = 0;
  };

  return { scheduledTimers, restore };
}

function parseWireMessage(raw: string): { type: string; payload?: unknown } {
  return JSON.parse(raw) as { type: string; payload?: unknown };
}

test('queues outbound messages before socket open and flushes after connect', () => {
  const { restore } = installBrowserMocks();
  try {
    const client = createRoomSocket('ROOM-A');
    assert.equal(mockSockets.length, 1);

    client.emit('chat-message', 'hello');
    assert.equal(mockSockets[0].sentMessages.length, 0);

    mockSockets[0].open();
    assert.equal(mockSockets[0].sentMessages.length, 1);
    assert.deepEqual(parseWireMessage(mockSockets[0].sentMessages[0]), {
      type: 'chat-message',
      payload: 'hello',
    });
  } finally {
    restore();
  }
});

test('reconnects after disconnect and flushes queued payload on recovered connection', () => {
  const { scheduledTimers, restore } = installBrowserMocks();
  try {
    const client = createRoomSocket('ROOM-B');
    const reconnectingEvents: Array<{ attempt: number; delayMs: number }> = [];
    const connectEvents: Array<{ recovered: boolean }> = [];

    client.on('reconnecting', (payload) => reconnectingEvents.push(payload));
    client.on('connect', (payload) => connectEvents.push(payload));

    assert.equal(mockSockets.length, 1);
    mockSockets[0].open();
    assert.equal(connectEvents.length, 1);
    assert.equal(connectEvents[0].recovered, false);

    mockSockets[0].close();
    assert.equal(client.connectionState, 'reconnecting');
    assert.equal(reconnectingEvents.length, 1);
    assert.ok(reconnectingEvents[0].delayMs >= 500);
    assert.equal(scheduledTimers.length, 1);

    client.emit('chat-message', 'after-close');

    const reconnectTimer = scheduledTimers.shift();
    assert.ok(reconnectTimer);
    reconnectTimer!.callback();

    assert.equal(mockSockets.length, 2);
    mockSockets[1].open();
    assert.equal(connectEvents.length, 2);
    assert.equal(connectEvents[1].recovered, true);

    assert.equal(mockSockets[1].sentMessages.length, 1);
    assert.deepEqual(parseWireMessage(mockSockets[1].sentMessages[0]), {
      type: 'chat-message',
      payload: 'after-close',
    });
  } finally {
    restore();
  }
});

test('updates client id from connected event payload', () => {
  const { restore } = installBrowserMocks();
  try {
    const client = createRoomSocket('ROOM-C');
    assert.equal(mockSockets.length, 1);
    assert.equal(client.id, null);

    mockSockets[0].open();
    mockSockets[0].message({
      type: 'connected',
      payload: { id: 'client-42' },
    });

    assert.equal(client.id, 'client-42');
  } finally {
    restore();
  }
});

test('buildWebSocketUrlCandidates returns default primary and fallback websocket paths', () => {
  const urls = buildWebSocketUrlCandidates({
    roomId: 'ROOM-D',
    location: { protocol: 'https:', host: 'example.test' },
  });

  assert.deepEqual(urls, [
    'wss://example.test/ws/ROOM-D',
    'wss://example.test/api/ws/ROOM-D',
  ]);
});

test('switches to fallback websocket path before first successful connect', () => {
  const { restore } = installBrowserMocks();
  try {
    const client = createRoomSocket('ROOM-E', {
      websocketPaths: ['/ws', '/api/ws'],
      maxReconnectAttempts: 2,
    });

    assert.equal(mockSockets.length, 1);
    assert.equal(mockSockets[0].url, 'ws://example.test/ws/ROOM-E');

    const fallbackEvents: Array<{ url: string; index: number; total: number }> = [];
    client.on('transport-fallback', (payload) => fallbackEvents.push(payload));

    mockSockets[0].close();
    assert.equal(mockSockets.length, 2);
    assert.equal(mockSockets[1].url, 'ws://example.test/api/ws/ROOM-E');
    assert.equal(fallbackEvents.length, 1);
    assert.equal(fallbackEvents[0].index, 2);
  } finally {
    restore();
  }
});

test('emits unavailable after exhausting reconnect attempts', () => {
  const { scheduledTimers, restore } = installBrowserMocks();
  try {
    const client = createRoomSocket('ROOM-F', {
      websocketPaths: ['/ws'],
      maxReconnectAttempts: 2,
    });

    const unavailableEvents: Array<{ reason: string; attempts: number }> = [];
    client.on('unavailable', (payload) => unavailableEvents.push(payload));

    assert.equal(mockSockets.length, 1);
    mockSockets[0].close();
    assert.equal(scheduledTimers.length, 1);
    scheduledTimers.shift()!.callback();

    assert.equal(mockSockets.length, 2);
    mockSockets[1].close();
    assert.equal(scheduledTimers.length, 1);
    scheduledTimers.shift()!.callback();

    assert.equal(mockSockets.length, 3);
    mockSockets[2].close();

    assert.equal(unavailableEvents.length, 1);
    assert.equal(unavailableEvents[0].reason, 'reconnect-exhausted');
    assert.equal(unavailableEvents[0].attempts, 2);
    assert.equal(client.connectionState, 'disconnected');
  } finally {
    restore();
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomDurableObject, MAX_ROOM_SESSIONS } from '../../worker/src/RoomDurableObject';
import { SlidingWindowRateLimiter } from '../../worker/src/rateLimiter';

function createRoom(): RoomDurableObject {
  const state = {
    storage: {
      get: async () => undefined,
    },
    getWebSockets: () => [],
    blockConcurrencyWhile: (callback: () => Promise<unknown>) => {
      void callback();
      return Promise.resolve();
    },
  } as unknown as DurableObjectState;

  return new RoomDurableObject(state, {} as never);
}

class TestSocket {
  peer: TestSocket | null = null;
  readonly incoming: string[] = [];

  send(data: string): void {
    this.peer?.incoming.push(data);
  }

  serializeAttachment(): void {}

  deserializeAttachment(): unknown {
    return null;
  }
}

test('sliding-window limiter allows a bounded burst and recovers after the window', () => {
  const limiter = new SlidingWindowRateLimiter({ maxRequests: 2, windowMs: 1_000 });

  assert.equal(limiter.allow(0), true);
  assert.equal(limiter.allow(100), true);
  assert.equal(limiter.allow(200), false);
  assert.equal(limiter.allow(1_001), true);
});

test('durable-object room refuses new sockets after the connection cap', async () => {
  const room = createRoom();
  const sessions = (room as unknown as { sessions: { add: (ws: WebSocket, session: unknown) => void } }).sessions;

  for (let index = 0; index < MAX_ROOM_SESSIONS; index += 1) {
    sessions.add({} as WebSocket, {
      id: `session-${index}`,
      name: 'Viewer',
      role: 'spectator',
      color: null,
    });
  }

  const response = await room.fetch(new Request('https://example.test/ws/ROOM-00001', {
    headers: { Upgrade: 'websocket' },
  }));

  assert.equal(response.status, 429);
  assert.deepEqual(await response.json(), { error: 'room-full' });
});

test('durable-object rate-limits chat bursts per session', () => {
  const room = createRoom();
  const client = new TestSocket();
  const server = new TestSocket();
  client.peer = server;
  server.peer = client;
  const session = {
    id: 'session-chat',
    name: 'Viewer',
    role: 'spectator' as const,
    color: null,
    joined: true,
  };
  const sessions = (room as unknown as { sessions: { add: (ws: WebSocket, value: unknown) => void } }).sessions;
  sessions.add(server as unknown as WebSocket, session);

  for (let index = 0; index < 11; index += 1) {
    room.webSocketMessage(
      server as unknown as WebSocket,
      JSON.stringify({ type: 'chat-message', payload: `message-${index}` }),
    );
  }

  const rateLimitMessage = client.incoming
    .map((raw) => JSON.parse(raw) as { type?: string; payload?: { code?: string } })
    .find((message) => message.type === 'error' && message.payload?.code === 'rate-limited');
  assert.ok(rateLimitMessage);
});

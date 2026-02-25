import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { RoomDurableObject } from '../../worker/src/RoomDurableObject';

interface WireEnvelope {
  type: string;
  payload?: unknown;
}

class MockSocketEndpoint {
  peer: MockSocketEndpoint | null = null;
  readonly incoming: string[] = [];
  private attachment: unknown = null;

  send(data: string): void {
    if (!this.peer) {
      return;
    }
    this.peer.incoming.push(data);
  }

  serializeAttachment(value: unknown): void {
    this.attachment = value;
  }

  deserializeAttachment(): unknown {
    return this.attachment;
  }
}

class MockDurableObjectStorage {
  private readonly values = new Map<string, unknown>();

  async get<T = unknown>(key: string): Promise<T | undefined> {
    return this.values.get(key) as T | undefined;
  }

  async put<T = unknown>(key: string, value: T): Promise<void> {
    this.values.set(key, value);
  }
}

class MockDurableObjectState {
  readonly storage = new MockDurableObjectStorage();
  private readonly sockets: MockSocketEndpoint[] = [];
  private readonly blockers: Promise<unknown>[] = [];

  acceptWebSocket(webSocket: WebSocket): void {
    this.sockets.push(webSocket as unknown as MockSocketEndpoint);
  }

  getWebSockets(): WebSocket[] {
    return this.sockets as unknown as WebSocket[];
  }

  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T> {
    const pending = callback();
    this.blockers.push(pending);
    return pending;
  }

  async waitForReady(): Promise<void> {
    await Promise.all(this.blockers);
  }
}

function createSocketPair(): { client: MockSocketEndpoint; server: MockSocketEndpoint } {
  const client = new MockSocketEndpoint();
  const server = new MockSocketEndpoint();
  client.peer = server;
  server.peer = client;
  return { client, server };
}

function parseMessages(messages: string[]): WireEnvelope[] {
  return messages.map((raw) => JSON.parse(raw) as WireEnvelope);
}

function findLastMessage(messages: string[], type: string): WireEnvelope | undefined {
  const parsed = parseMessages(messages);
  for (let i = parsed.length - 1; i >= 0; i -= 1) {
    if (parsed[i].type === type) {
      return parsed[i];
    }
  }
  return undefined;
}

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

let sessionCounter = 0;

async function createJoinedSession(
  room: RoomDurableObject,
  state: MockDurableObjectState,
  userName: string,
): Promise<{ client: MockSocketEndpoint; server: MockSocketEndpoint; connectedId: string; roomFen: string }> {
  const { client, server } = createSocketPair();
  const session = {
    id: `session-${sessionCounter++}`,
    name: 'Anonymous',
    role: 'spectator' as const,
    color: null,
  };

  state.acceptWebSocket(server as unknown as WebSocket);
  server.serializeAttachment(session);
  (room as any).sessions.add(server, session);
  (room as any).send(server, {
    type: 'connected',
    payload: { id: session.id },
  });

  await state.waitForReady();

  const connected = findLastMessage(client.incoming, 'connected');
  assert.ok(connected);
  assert.equal(typeof (connected.payload as { id?: unknown })?.id, 'string');
  const connectedId = (connected.payload as { id: string }).id;

  room.webSocketMessage(
    server as unknown as WebSocket,
    JSON.stringify({
      type: 'join-room',
      payload: { userName },
    }),
  );
  await flushAsyncWork();

  const roomState = findLastMessage(client.incoming, 'room-state');
  assert.ok(roomState);
  assert.equal(typeof (roomState.payload as { fen?: unknown })?.fen, 'string');

  return {
    client,
    server,
    connectedId,
    roomFen: (roomState.payload as { fen: string }).fen,
  };
}

test('accepts legal move and emits move-accepted + chess-move broadcast payload', async () => {
  const state = new MockDurableObjectState();
  const room = new RoomDurableObject(state as unknown as DurableObjectState, {} as any);
  const session = await createJoinedSession(room, state, 'Alice');

  const nextGame = new Chess(session.roomFen);
  const move = nextGame.move('e4');
  assert.ok(move);
  const nextFen = nextGame.fen();

  const baselineCount = session.client.incoming.length;
  room.webSocketMessage(
    session.server as unknown as WebSocket,
    JSON.stringify({
      type: 'chess-move',
      payload: { requestId: 'req-1', fen: nextFen },
    }),
  );
  await flushAsyncWork();

  const newMessages = session.client.incoming.slice(baselineCount);
  const moveAccepted = findLastMessage(newMessages, 'move-accepted');
  assert.ok(moveAccepted);
  assert.deepEqual(moveAccepted.payload, {
    requestId: 'req-1',
    fen: nextFen,
  });

  const chessMove = findLastMessage(newMessages, 'chess-move');
  assert.ok(chessMove);
  assert.deepEqual(chessMove.payload, {
    fen: nextFen,
    actorId: session.connectedId,
  });
});

test('rejects illegal move with move-rejected and authoritative fen', async () => {
  const state = new MockDurableObjectState();
  const room = new RoomDurableObject(state as unknown as DurableObjectState, {} as any);
  const session = await createJoinedSession(room, state, 'Bob');

  const baselineCount = session.client.incoming.length;
  room.webSocketMessage(
    session.server as unknown as WebSocket,
    JSON.stringify({
      type: 'chess-move',
      payload: { requestId: 'bad-1', fen: session.roomFen },
    }),
  );
  await flushAsyncWork();

  const newMessages = session.client.incoming.slice(baselineCount);
  const rejected = findLastMessage(newMessages, 'move-rejected');
  assert.ok(rejected);
  assert.deepEqual(rejected.payload, {
    requestId: 'bad-1',
    code: 'illegal-move',
    fen: session.roomFen,
  });

  const chessMove = findLastMessage(newMessages, 'chess-move');
  assert.equal(chessMove, undefined);
});

test('spectator move is rejected with spectator-cannot-move', async () => {
  const state = new MockDurableObjectState();
  const room = new RoomDurableObject(state as unknown as DurableObjectState, {} as any);

  const white = await createJoinedSession(room, state, 'White');
  const _black = await createJoinedSession(room, state, 'Black');
  const spectator = await createJoinedSession(room, state, 'Viewer');

  const spectatorRoomState = findLastMessage(spectator.client.incoming, 'room-state');
  assert.ok(spectatorRoomState);
  assert.equal((spectatorRoomState.payload as { myColor: unknown }).myColor, null);
  assert.equal((spectatorRoomState.payload as { role: unknown }).role, 'spectator');

  const candidateMove = new Chess(white.roomFen);
  const move = candidateMove.move('e4');
  assert.ok(move);
  const attemptedFen = candidateMove.fen();

  const baselineCount = spectator.client.incoming.length;
  room.webSocketMessage(
    spectator.server as unknown as WebSocket,
    JSON.stringify({
      type: 'chess-move',
      payload: { requestId: 'spectator-1', fen: attemptedFen },
    }),
  );
  await flushAsyncWork();

  const newMessages = spectator.client.incoming.slice(baselineCount);
  const rejected = findLastMessage(newMessages, 'move-rejected');
  assert.ok(rejected);
  assert.deepEqual(rejected.payload, {
    requestId: 'spectator-1',
    code: 'spectator-cannot-move',
    fen: white.roomFen,
  });

  assert.equal(findLastMessage(newMessages, 'chess-move'), undefined);
});

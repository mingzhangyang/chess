import type {
  ClientEnvelope,
  Env,
  PlayerColor,
  RoomUser,
  ServerEnvelope,
  StoredRoomState,
} from './types';
import { canResetGame, canonicalFen, newGameFen, validateMove } from './chessRules';

interface Session {
  id: string;
  name: string;
  role: 'player' | 'spectator';
  color: PlayerColor | null;
}

interface JoinPayload {
  userName?: unknown;
}

interface TargetedSignalPayload {
  targetId?: unknown;
  offer?: unknown;
  answer?: unknown;
  candidate?: unknown;
}

const ROOM_STORAGE_KEY = 'room-state';

function parseEvent(raw: string): ClientEnvelope | null {
  try {
    const parsed = JSON.parse(raw) as Partial<ClientEnvelope>;
    if (!parsed || typeof parsed.type !== 'string') {
      return null;
    }
    return {
      type: parsed.type,
      payload: parsed.payload,
    };
  } catch {
    return null;
  }
}

function normalizeUserName(input: unknown): string {
  if (typeof input !== 'string') {
    return 'Anonymous';
  }
  const trimmed = input.trim();
  if (!trimmed) {
    return 'Anonymous';
  }
  return trimmed.slice(0, 32);
}

export class RoomDurableObject {
  private readonly state: DurableObjectState;

  private fen = newGameFen();
  private sessions = new Map<WebSocket, Session>();

  constructor(state: DurableObjectState, _env: Env) {
    this.state = state;

    this.state.blockConcurrencyWhile(async () => {
      const persisted = await this.state.storage.get<StoredRoomState>(ROOM_STORAGE_KEY);
      if (persisted?.fen) {
        const parsedFen = canonicalFen(persisted.fen);
        if (parsedFen) {
          this.fen = parsedFen;
        }
      }

      for (const ws of this.state.getWebSockets()) {
        const session = ws.deserializeAttachment() as Session | null;
        if (session) {
          this.sessions.set(ws, session);
        }
      }
    });
  }

  async fetch(request: Request): Promise<Response> {
    const isUpgrade = request.headers.get('Upgrade')?.toLowerCase() === 'websocket';
    if (!isUpgrade) {
      return new Response('Expected websocket upgrade', { status: 426 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    this.state.acceptWebSocket(server);

    const session: Session = {
      id: crypto.randomUUID(),
      name: 'Anonymous',
      role: 'spectator',
      color: null,
    };

    server.serializeAttachment(session);
    this.sessions.set(server, session);

    this.send(server, {
      type: 'connected',
      payload: { id: session.id },
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): void {
    const session = this.sessions.get(ws);
    if (!session) {
      return;
    }

    const text = typeof message === 'string' ? message : new TextDecoder().decode(message);
    const event = parseEvent(text);

    if (!event) {
      this.sendError(ws, 'invalid-payload');
      return;
    }

    switch (event.type) {
      case 'join-room': {
        this.handleJoin(ws, session, event.payload as JoinPayload | undefined);
        return;
      }

      case 'chat-message': {
        this.handleChat(session, event.payload);
        return;
      }

      case 'chess-move': {
        this.handleChessMove(ws, session, event.payload);
        return;
      }

      case 'reset-game': {
        this.handleResetGame(ws, session);
        return;
      }

      case 'offer': {
        this.handleOfferAnswerCandidate(session, event.payload as TargetedSignalPayload | undefined, 'offer');
        return;
      }

      case 'answer': {
        this.handleOfferAnswerCandidate(session, event.payload as TargetedSignalPayload | undefined, 'answer');
        return;
      }

      case 'ice-candidate': {
        this.handleOfferAnswerCandidate(session, event.payload as TargetedSignalPayload | undefined, 'ice-candidate');
        return;
      }

      default: {
        this.sendError(ws, 'unknown-event');
      }
    }
  }

  webSocketClose(ws: WebSocket): void {
    this.handleDisconnect(ws);
  }

  webSocketError(ws: WebSocket): void {
    this.handleDisconnect(ws);
  }

  private handleJoin(ws: WebSocket, session: Session, payload: JoinPayload | undefined): void {
    session.name = normalizeUserName(payload?.userName);

    if (session.role !== 'player') {
      const availableSeat = this.getAvailableSeat();
      if (availableSeat) {
        session.role = 'player';
        session.color = availableSeat;
      } else {
        session.role = 'spectator';
        session.color = null;
      }
    }

    ws.serializeAttachment(session);

    this.broadcast({
      type: 'user-joined',
      payload: this.toUser(session),
    }, session.id);

    this.syncRoomStateToAll();
  }

  private handleChat(session: Session, payload: unknown): void {
    if (typeof payload !== 'string') {
      return;
    }

    const text = payload.trim().slice(0, 500);
    if (!text) {
      return;
    }

    this.broadcast({
      type: 'chat-message',
      payload: {
        id: `${Date.now()}-${crypto.randomUUID().slice(0, 6)}`,
        senderId: session.id,
        senderName: session.name,
        text,
        timestamp: Date.now(),
      },
    });
  }

  private async handleChessMove(ws: WebSocket, session: Session, payload: unknown): Promise<void> {
    const result = validateMove({
      currentFen: this.fen,
      nextFen: payload,
      role: session.role,
      color: session.color,
    });

    if ('code' in result) {
      this.sendError(ws, result.code);
      return;
    }

    this.fen = result.nextFen;
    await this.persistState();

    this.broadcast({
      type: 'chess-move',
      payload: this.fen,
    });
  }

  private async handleResetGame(ws: WebSocket, session: Session): Promise<void> {
    const resetAllowed = canResetGame(session.role);
    if ('code' in resetAllowed) {
      this.sendError(ws, resetAllowed.code);
      return;
    }

    this.fen = newGameFen();
    await this.persistState();

    this.broadcast({ type: 'reset-game' });
    this.syncRoomStateToAll();
  }

  private handleOfferAnswerCandidate(
    session: Session,
    payload: TargetedSignalPayload | undefined,
    type: 'offer' | 'answer' | 'ice-candidate',
  ): void {
    const targetId = typeof payload?.targetId === 'string' ? payload.targetId : null;
    if (!targetId) {
      return;
    }

    const targetSocket = this.findSocketBySessionId(targetId);
    if (!targetSocket) {
      return;
    }

    if (type === 'offer') {
      this.send(targetSocket, {
        type,
        payload: { senderId: session.id, offer: payload?.offer ?? null },
      });
      return;
    }

    if (type === 'answer') {
      this.send(targetSocket, {
        type,
        payload: { senderId: session.id, answer: payload?.answer ?? null },
      });
      return;
    }

    this.send(targetSocket, {
      type,
      payload: { senderId: session.id, candidate: payload?.candidate ?? null },
    });
  }

  private handleDisconnect(ws: WebSocket): void {
    const session = this.sessions.get(ws);
    if (!session) {
      return;
    }

    this.sessions.delete(ws);

    const vacatedColor = session.role === 'player' ? session.color : null;
    if (vacatedColor) {
      this.promoteSpectatorToPlayer(vacatedColor);
    }

    this.broadcast({
      type: 'user-left',
      payload: session.id,
    });

    this.syncRoomStateToAll();
  }

  private promoteSpectatorToPlayer(color: PlayerColor): void {
    for (const [ws, session] of this.sessions) {
      if (session.role === 'spectator') {
        session.role = 'player';
        session.color = color;
        ws.serializeAttachment(session);

        this.send(ws, {
          type: 'seat-updated',
          payload: { role: session.role, myColor: session.color },
        });
        return;
      }
    }
  }

  private getAvailableSeat(): PlayerColor | null {
    const occupied = new Set<PlayerColor>();
    for (const session of this.sessions.values()) {
      if (session.role === 'player' && session.color) {
        occupied.add(session.color);
      }
    }

    if (!occupied.has('w')) {
      return 'w';
    }

    if (!occupied.has('b')) {
      return 'b';
    }

    return null;
  }

  private findSocketBySessionId(sessionId: string): WebSocket | null {
    for (const [ws, session] of this.sessions) {
      if (session.id === sessionId) {
        return ws;
      }
    }
    return null;
  }

  private toUser(session: Session): RoomUser {
    return {
      id: session.id,
      name: session.name,
      role: session.role,
      color: session.color,
    };
  }

  private users(): RoomUser[] {
    return Array.from(this.sessions.values(), (session) => this.toUser(session));
  }

  private syncRoomStateToAll(): void {
    for (const [ws, session] of this.sessions) {
      this.send(ws, {
        type: 'room-state',
        payload: {
          users: this.users(),
          fen: this.fen,
          myColor: session.color,
          role: session.role,
        },
      });
    }
  }

  private send(ws: WebSocket, message: ServerEnvelope): void {
    try {
      ws.send(JSON.stringify(message));
    } catch {
      this.handleDisconnect(ws);
    }
  }

  private sendError(ws: WebSocket, code: string): void {
    this.send(ws, {
      type: 'error',
      payload: { code },
    });
  }

  private broadcast(message: ServerEnvelope, excludeSessionId?: string): void {
    for (const [ws, session] of this.sessions) {
      if (excludeSessionId && session.id === excludeSessionId) {
        continue;
      }
      this.send(ws, message);
    }
  }

  private async persistState(): Promise<void> {
    await this.state.storage.put(ROOM_STORAGE_KEY, { fen: this.fen } satisfies StoredRoomState);
  }
}

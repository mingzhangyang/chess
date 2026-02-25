import type {
  ClientEnvelope,
  Env,
  MoveRejectCode,
  ServerEnvelope,
  WorkerErrorCode,
} from './types';
import {
  isInboundMessageWithinLimit,
  validateChatPayload,
  validateTargetedSignalPayload,
} from './payloadValidation';
import { isClientEventType, parseWireEnvelope } from '../../shared/realtimeProtocol';
import { RoomStateStore } from './RoomStateStore';
import { SessionRegistry, type Session } from './SessionRegistry';

interface JoinPayload {
  userName?: unknown;
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
  private readonly roomState: RoomStateStore;
  private readonly sessions: SessionRegistry;

  constructor(state: DurableObjectState, _env: Env) {
    this.state = state;
    this.roomState = new RoomStateStore(state);
    this.sessions = new SessionRegistry();

    this.state.blockConcurrencyWhile(async () => {
      await this.roomState.hydrate();
      this.sessions.hydrateFromWebSockets(this.state.getWebSockets());
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
    this.sessions.add(server, session);

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
    if (!isInboundMessageWithinLimit(text)) {
      this.sendError(ws, 'payload-too-large');
      return;
    }

    const envelope = parseWireEnvelope(text);
    if (!envelope) {
      this.sendError(ws, 'invalid-payload');
      return;
    }

    if (!isClientEventType(envelope.type)) {
      this.sendError(ws, 'unknown-event');
      return;
    }

    const event = envelope as ClientEnvelope;

    switch (event.type) {
      case 'join-room': {
        this.handleJoin(ws, session, event.payload as JoinPayload | undefined);
        return;
      }
      case 'chat-message': {
        this.handleChat(ws, session, event.payload);
        return;
      }
      case 'chess-move': {
        void this.handleChessMove(ws, session, event.payload);
        return;
      }
      case 'reset-game': {
        void this.handleResetGame(ws, session);
        return;
      }
      case 'offer': {
        this.handleOfferAnswerCandidate(ws, session, event.payload, 'offer');
        return;
      }
      case 'answer': {
        this.handleOfferAnswerCandidate(ws, session, event.payload, 'answer');
        return;
      }
      case 'ice-candidate': {
        this.handleOfferAnswerCandidate(ws, session, event.payload, 'ice-candidate');
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
    this.sessions.assignSeatIfAvailable(session);
    ws.serializeAttachment(session);

    this.broadcast(
      {
        type: 'user-joined',
        payload: {
          id: session.id,
          name: session.name,
          role: session.role,
          color: session.color,
        },
      },
      session.id,
    );

    this.syncRoomStateToAll();
  }

  private handleChat(ws: WebSocket, session: Session, payload: unknown): void {
    const validated = validateChatPayload(payload);
    if ('code' in validated) {
      if (validated.code !== 'empty-chat-message') {
        this.sendError(ws, validated.code);
      }
      return;
    }

    this.broadcast({
      type: 'chat-message',
      payload: {
        id: `${Date.now()}-${crypto.randomUUID().slice(0, 6)}`,
        senderId: session.id,
        senderName: session.name,
        text: validated.text,
        timestamp: Date.now(),
      },
    });
  }

  private sendMoveRejected(ws: WebSocket, requestId: string, code: MoveRejectCode): void {
    this.send(ws, {
      type: 'move-rejected',
      payload: {
        requestId,
        code,
        fen: this.roomState.getFen(),
      },
    });
  }

  private async handleChessMove(ws: WebSocket, session: Session, payload: unknown): Promise<void> {
    const moveRequest = this.roomState.parseMoveRequestPayload(payload);
    if (!moveRequest) {
      this.sendError(ws, 'invalid-move-payload');
      return;
    }

    const result = await this.roomState.applyMove(moveRequest, {
      role: session.role,
      color: session.color,
    });
    if ('code' in result) {
      this.sendMoveRejected(ws, moveRequest.requestId, result.code);
      return;
    }

    this.send(ws, {
      type: 'move-accepted',
      payload: {
        requestId: moveRequest.requestId,
        fen: result.fen,
      },
    });

    this.broadcast({
      type: 'chess-move',
      payload: { fen: result.fen, actorId: session.id },
    });
  }

  private async handleResetGame(ws: WebSocket, session: Session): Promise<void> {
    const result = await this.roomState.reset(session.role);
    if ('code' in result) {
      this.sendError(ws, result.code);
      return;
    }

    this.broadcast({ type: 'reset-game' });
    this.syncRoomStateToAll();
  }

  private handleOfferAnswerCandidate(
    ws: WebSocket,
    session: Session,
    payload: unknown,
    type: 'offer' | 'answer' | 'ice-candidate',
  ): void {
    const validated = validateTargetedSignalPayload(payload, type);
    if ('code' in validated) {
      this.sendError(ws, validated.code);
      return;
    }

    const targetSocket = this.sessions.findSocketBySessionId(validated.targetId);
    if (!targetSocket) {
      return;
    }

    if (type === 'offer') {
      this.send(targetSocket, {
        type,
        payload: {
          senderId: session.id,
          offer: validated.signalPayload as unknown as RTCSessionDescriptionInit,
        },
      });
      return;
    }

    if (type === 'answer') {
      this.send(targetSocket, {
        type,
        payload: {
          senderId: session.id,
          answer: validated.signalPayload as unknown as RTCSessionDescriptionInit,
        },
      });
      return;
    }

    this.send(targetSocket, {
      type,
      payload: {
        senderId: session.id,
        candidate: validated.signalPayload as unknown as RTCIceCandidateInit,
      },
    });
  }

  private handleDisconnect(ws: WebSocket): void {
    const session = this.sessions.remove(ws);
    if (!session) {
      return;
    }

    const vacatedColor = session.role === 'player' ? session.color : null;
    if (vacatedColor) {
      const promoted = this.sessions.promoteSpectatorToPlayer(vacatedColor);
      if (promoted) {
        promoted.ws.serializeAttachment(promoted.session);
        this.send(promoted.ws, {
          type: 'seat-updated',
          payload: { role: promoted.session.role, myColor: promoted.session.color },
        });
      }
    }

    this.broadcast({
      type: 'user-left',
      payload: session.id,
    });

    this.syncRoomStateToAll();
  }

  private syncRoomStateToAll(): void {
    const users = this.sessions.users();
    const fen = this.roomState.getFen();
    for (const [ws, session] of this.sessions.entries()) {
      this.send(ws, {
        type: 'room-state',
        payload: {
          users,
          fen,
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

  private sendError(ws: WebSocket, code: WorkerErrorCode): void {
    this.send(ws, {
      type: 'error',
      payload: { code },
    });
  }

  private broadcast(message: ServerEnvelope, excludeSessionId?: string): void {
    for (const [ws, session] of this.sessions.entries()) {
      if (excludeSessionId && session.id === excludeSessionId) {
        continue;
      }
      this.send(ws, message);
    }
  }
}

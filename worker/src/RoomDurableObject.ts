import type {
  ClientEnvelope,
  Env,
  MoveRejectCode,
  RoomActionType,
  ServerEnvelope,
  WorkerErrorCode,
} from './types';
import {
  isInboundMessageWithinLimit,
  validateChatPayload,
  validateTargetedSignalPayload,
} from './payloadValidation';
import { SlidingWindowRateLimiter } from './rateLimiter';
import { isClientEventType, parseWireEnvelope } from '../../shared/realtimeProtocol';
import { RoomStateStore } from './RoomStateStore';
import { SessionRegistry, type Session } from './SessionRegistry';

interface JoinPayload {
  userName?: unknown;
}

interface PendingRoomAction {
  requestId: string;
  action: RoomActionType;
  requesterId: string;
  approverId: string;
}

const PENDING_ACTION_TIMEOUT_MS = 60_000;
const PENDING_ACTION_STORAGE_KEY = 'pending-room-action';
export const MAX_ROOM_SESSIONS = 32;
const MESSAGE_RATE_WINDOW_MS = 10_000;
const MAX_MESSAGES_PER_WINDOW = 120;
const MAX_CHAT_MESSAGES_PER_WINDOW = 10;
const MAX_SIGNAL_MESSAGES_PER_WINDOW = 60;

type RateLimitBucket = 'control' | 'chat' | 'signaling';

interface SessionRateLimiters {
  all: SlidingWindowRateLimiter;
  control: SlidingWindowRateLimiter;
  chat: SlidingWindowRateLimiter;
  signaling: SlidingWindowRateLimiter;
  lastNoticeAt: number;
}

function parsePendingRoomAction(value: unknown): PendingRoomAction | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  if (
    typeof record.requestId !== 'string'
    || (record.action !== 'undo' && record.action !== 'swap')
    || typeof record.requesterId !== 'string'
    || typeof record.approverId !== 'string'
  ) {
    return null;
  }

  if (!record.requestId || !record.requesterId || !record.approverId) {
    return null;
  }

  return {
    requestId: record.requestId,
    action: record.action,
    requesterId: record.requesterId,
    approverId: record.approverId,
  };
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
  private readonly rateLimiters = new Map<WebSocket, SessionRateLimiters>();
  private pendingRoomAction: PendingRoomAction | null = null;
  private commandQueue: Promise<void> = Promise.resolve();

  constructor(state: DurableObjectState, _env: Env) {
    this.state = state;
    this.roomState = new RoomStateStore(state);
    this.sessions = new SessionRegistry();

    this.state.blockConcurrencyWhile(async () => {
      await this.roomState.hydrate();
      this.pendingRoomAction = parsePendingRoomAction(
        await this.state.storage.get<unknown>(PENDING_ACTION_STORAGE_KEY),
      );
      this.sessions.hydrateFromWebSockets(this.state.getWebSockets());
    });
  }

  async fetch(request: Request): Promise<Response> {
    const isUpgrade = request.headers.get('Upgrade')?.toLowerCase() === 'websocket';
    if (!isUpgrade) {
      return new Response('Expected websocket upgrade', { status: 426 });
    }

    if (this.sessions.size >= MAX_ROOM_SESSIONS) {
      return Response.json({ error: 'room-full' }, { status: 429 });
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
      joined: false,
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

    if (!this.allowGlobalRateLimit(ws)) {
      this.sendRateLimitError(ws);
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

    const bucket = this.rateLimitBucketForEvent(envelope.type);
    if (!this.allowRateLimitedMessage(ws, bucket)) {
      this.sendRateLimitError(ws);
      return;
    }

    if (envelope.type !== 'join-room' && !session.joined) {
      this.sendError(ws, 'not-joined');
      return;
    }

    const event = envelope as ClientEnvelope;

    switch (event.type) {
      case 'join-room': {
        this.enqueueSessionCommand(ws, session, () => this.handleJoin(ws, session, event.payload as JoinPayload | undefined));
        return;
      }
      case 'chat-message': {
        this.enqueueSessionCommand(ws, session, () => this.handleChat(ws, session, event.payload));
        return;
      }
      case 'chess-move': {
        this.enqueueSessionCommand(ws, session, () => this.handleChessMove(ws, session, event.payload));
        return;
      }
      case 'reset-game': {
        this.enqueueSessionCommand(ws, session, () => this.handleResetGame(ws, session));
        return;
      }
      case 'request-undo': {
        this.enqueueSessionCommand(ws, session, () => this.handleActionRequest(ws, session, 'undo'));
        return;
      }
      case 'request-swap': {
        this.enqueueSessionCommand(ws, session, () => this.handleActionRequest(ws, session, 'swap'));
        return;
      }
      case 'action-response': {
        this.enqueueSessionCommand(ws, session, () => this.handleActionResponse(ws, session, event.payload));
        return;
      }
      case 'offer': {
        this.enqueueSessionCommand(ws, session, () => this.handleOfferAnswerCandidate(ws, session, event.payload, 'offer'));
        return;
      }
      case 'answer': {
        this.enqueueSessionCommand(ws, session, () => this.handleOfferAnswerCandidate(ws, session, event.payload, 'answer'));
        return;
      }
      case 'ice-candidate': {
        this.enqueueSessionCommand(ws, session, () => this.handleOfferAnswerCandidate(ws, session, event.payload, 'ice-candidate'));
        return;
      }
      default: {
        this.sendError(ws, 'unknown-event');
      }
    }
  }

  async alarm(): Promise<void> {
    await this.commandQueue;

    const pendingAction = this.pendingRoomAction;
    if (!pendingAction) {
      return;
    }

    await this.clearPendingRoomAction();
    this.broadcast({
      type: 'action-resolved',
      payload: {
        requestId: pendingAction.requestId,
        action: pendingAction.action,
        accepted: false,
      },
    });
  }

  webSocketClose(ws: WebSocket): void {
    this.handleDisconnect(ws);
  }

  webSocketError(ws: WebSocket): void {
    this.handleDisconnect(ws);
  }

  private handleJoin(ws: WebSocket, session: Session, payload: JoinPayload | undefined): void {
    if (session.joined) {
      this.sendError(ws, 'already-joined');
      return;
    }

    session.name = normalizeUserName(payload?.userName);
    session.joined = true;
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

  private enqueueCommand(command: () => void | Promise<void>): void {
    this.commandQueue = this.commandQueue
      .then(() => command())
      .catch((error: unknown) => {
        console.error(JSON.stringify({ event: 'room-command-failed', error: String(error) }));
      });
  }

  private enqueueSessionCommand(
    ws: WebSocket,
    session: Session,
    command: () => void | Promise<void>,
  ): void {
    this.enqueueCommand(() => {
      if (this.sessions.get(ws) !== session) {
        return;
      }
      return command();
    });
  }

  private async clearPendingRoomAction(): Promise<void> {
    this.pendingRoomAction = null;
    await Promise.all([
      this.state.storage.delete(PENDING_ACTION_STORAGE_KEY),
      this.state.storage.deleteAlarm(),
    ]);
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
      payload: { fen: result.fen, fenHistory: this.roomState.getFenHistory(), actorId: session.id },
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

  private parseActionResponsePayload(payload: unknown): { requestId: string; accept: boolean } | null {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return null;
    }
    const record = payload as Record<string, unknown>;
    if (typeof record.requestId !== 'string' || typeof record.accept !== 'boolean') {
      return null;
    }
    const requestId = record.requestId.trim();
    if (!requestId || requestId.length > 128) {
      return null;
    }
    return { requestId, accept: record.accept };
  }

  private async handleActionRequest(ws: WebSocket, session: Session, action: RoomActionType): Promise<void> {
    if (session.role !== 'player' || !session.color) {
      this.sendError(ws, 'spectator-cannot-request-action');
      return;
    }

    if (this.pendingRoomAction) {
      this.sendError(ws, 'action-request-pending');
      return;
    }

    if (action === 'undo' && !this.roomState.canUndo()) {
      this.sendError(ws, 'cannot-undo');
      return;
    }

    const opponent = this.sessions.findOpponentPlayer(session.id);
    if (!opponent) {
      this.sendError(ws, 'action-requires-opponent');
      return;
    }

    const pendingAction: PendingRoomAction = {
      requestId: crypto.randomUUID(),
      action,
      requesterId: session.id,
      approverId: opponent.session.id,
    };

    try {
      await Promise.all([
        this.state.storage.put(PENDING_ACTION_STORAGE_KEY, pendingAction),
        this.state.storage.setAlarm(Date.now() + PENDING_ACTION_TIMEOUT_MS),
      ]);
      this.pendingRoomAction = pendingAction;
    } catch (error) {
      this.pendingRoomAction = null;
      await Promise.allSettled([
        this.state.storage.delete(PENDING_ACTION_STORAGE_KEY),
        this.state.storage.deleteAlarm(),
      ]);
      console.error(JSON.stringify({ event: 'room-action-persistence-failed', error: String(error) }));
      this.sendError(ws, 'invalid-payload');
      return;
    }

    const requestId = pendingAction.requestId;

    this.broadcast({
      type: 'action-requested',
      payload: {
        requestId,
        action,
        requesterId: session.id,
        requesterName: session.name,
      },
    });
  }

  private async handleActionResponse(ws: WebSocket, session: Session, payload: unknown): Promise<void> {
    const parsedResponse = this.parseActionResponsePayload(payload);
    if (!parsedResponse) {
      this.sendError(ws, 'invalid-action-response');
      return;
    }

    const pendingAction = this.pendingRoomAction;
    if (!pendingAction || pendingAction.requestId !== parsedResponse.requestId) {
      this.sendError(ws, 'action-response-without-request');
      return;
    }

    if (session.id !== pendingAction.approverId) {
      this.sendError(ws, 'action-response-without-request');
      return;
    }

    if (!parsedResponse.accept) {
      await this.clearPendingRoomAction();
      this.broadcast({
        type: 'action-resolved',
        payload: {
          requestId: pendingAction.requestId,
          action: pendingAction.action,
          accepted: false,
        },
      });
      return;
    }

    if (pendingAction.action === 'undo') {
      const undoResult = await this.roomState.undo();
      if ('code' in undoResult) {
        this.sendError(ws, undoResult.code);
        await this.clearPendingRoomAction();
        this.broadcast({
          type: 'action-resolved',
          payload: {
            requestId: pendingAction.requestId,
            action: pendingAction.action,
            accepted: false,
          },
        });
        return;
      }

      await this.clearPendingRoomAction();
      this.broadcast({
        type: 'action-resolved',
        payload: {
          requestId: pendingAction.requestId,
          action: pendingAction.action,
          accepted: true,
        },
      });
      this.syncRoomStateToAll();
      return;
    }

    const swapped = this.sessions.swapPlayerColors();
    if (!swapped) {
      this.sendError(ws, 'action-requires-opponent');
      await this.clearPendingRoomAction();
      this.broadcast({
        type: 'action-resolved',
        payload: {
          requestId: pendingAction.requestId,
          action: pendingAction.action,
          accepted: false,
        },
      });
      return;
    }

    await this.clearPendingRoomAction();
    this.broadcast({
      type: 'action-resolved',
      payload: {
        requestId: pendingAction.requestId,
        action: pendingAction.action,
        accepted: true,
      },
    });
    this.syncRoomStateToAll();
  }

  private handleOfferAnswerCandidate(
    ws: WebSocket,
    session: Session,
    payload: unknown,
    type: 'offer' | 'answer' | 'ice-candidate',
  ): void {
    if (session.role !== 'player' || !session.color) {
      this.sendError(ws, 'invalid-signaling-payload');
      return;
    }

    const validated = validateTargetedSignalPayload(payload, type);
    if ('code' in validated) {
      this.sendError(ws, validated.code);
      return;
    }

    const target = this.sessions.findPlayerSocketBySessionId(validated.targetId);
    if (!target || target.session.id === session.id) {
      this.sendError(ws, 'invalid-signaling-payload');
      return;
    }

    if (type === 'offer') {
      this.send(target.ws, {
        type,
        payload: {
          senderId: session.id,
          offer: validated.signalPayload as unknown as RTCSessionDescriptionInit,
        },
      });
      return;
    }

    if (type === 'answer') {
      this.send(target.ws, {
        type,
        payload: {
          senderId: session.id,
          answer: validated.signalPayload as unknown as RTCSessionDescriptionInit,
        },
      });
      return;
    }

    this.send(target.ws, {
      type,
      payload: {
        senderId: session.id,
        candidate: validated.signalPayload as unknown as RTCIceCandidateInit,
      },
    });
  }

  private handleDisconnect(ws: WebSocket): void {
    const session = this.sessions.remove(ws);
    this.rateLimiters.delete(ws);
    if (!session) {
      return;
    }

    if (
      this.pendingRoomAction
      && (this.pendingRoomAction.requesterId === session.id || this.pendingRoomAction.approverId === session.id)
    ) {
      this.broadcast({
        type: 'action-resolved',
        payload: {
          requestId: this.pendingRoomAction.requestId,
          action: this.pendingRoomAction.action,
          accepted: false,
        },
      });
      this.pendingRoomAction = null;
      void Promise.all([
        this.state.storage.delete(PENDING_ACTION_STORAGE_KEY),
        this.state.storage.deleteAlarm(),
      ]).catch((error: unknown) => {
        console.error(JSON.stringify({ event: 'room-action-cleanup-failed', error: String(error) }));
      });
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
    const fenHistory = this.roomState.getFenHistory();
    for (const [ws, session] of this.sessions.entries()) {
      this.send(ws, {
        type: 'room-state',
        payload: {
          users,
          fen,
          fenHistory,
          myColor: session.color,
          role: session.role,
        },
      });
    }
  }

  private send(ws: WebSocket, message: ServerEnvelope): void {
    this.sendSerialized(ws, JSON.stringify(message));
  }

  private sendSerialized(ws: WebSocket, serializedMessage: string): void {
    try {
      ws.send(serializedMessage);
    } catch {
      this.handleDisconnect(ws);
    }
  }

  private rateLimitBucketForEvent(eventType: string): RateLimitBucket {
    if (eventType === 'chat-message') {
      return 'chat';
    }
    if (eventType === 'offer' || eventType === 'answer' || eventType === 'ice-candidate') {
      return 'signaling';
    }
    return 'control';
  }

  private getRateLimiters(ws: WebSocket): SessionRateLimiters {
    const existing = this.rateLimiters.get(ws);
    if (existing) {
      return existing;
    }

    const created: SessionRateLimiters = {
      all: new SlidingWindowRateLimiter({
        maxRequests: MAX_MESSAGES_PER_WINDOW,
        windowMs: MESSAGE_RATE_WINDOW_MS,
      }),
      control: new SlidingWindowRateLimiter({
        maxRequests: MAX_MESSAGES_PER_WINDOW,
        windowMs: MESSAGE_RATE_WINDOW_MS,
      }),
      chat: new SlidingWindowRateLimiter({
        maxRequests: MAX_CHAT_MESSAGES_PER_WINDOW,
        windowMs: MESSAGE_RATE_WINDOW_MS,
      }),
      signaling: new SlidingWindowRateLimiter({
        maxRequests: MAX_SIGNAL_MESSAGES_PER_WINDOW,
        windowMs: MESSAGE_RATE_WINDOW_MS,
      }),
      lastNoticeAt: 0,
    };
    this.rateLimiters.set(ws, created);
    return created;
  }

  private allowGlobalRateLimit(ws: WebSocket): boolean {
    const limiters = this.getRateLimiters(ws);
    return limiters.all.allow(Date.now());
  }

  private allowRateLimitedMessage(ws: WebSocket, bucket: RateLimitBucket): boolean {
    const limiters = this.getRateLimiters(ws);
    return limiters[bucket].allow(Date.now());
  }

  private sendRateLimitError(ws: WebSocket): void {
    const limiters = this.getRateLimiters(ws);
    const now = Date.now();
    if (now - limiters.lastNoticeAt >= 1_000) {
      limiters.lastNoticeAt = now;
      this.sendError(ws, 'rate-limited');
    }
  }

  private sendError(ws: WebSocket, code: WorkerErrorCode): void {
    this.send(ws, {
      type: 'error',
      payload: { code },
    });
  }

  private broadcast(message: ServerEnvelope, excludeSessionId?: string): void {
    const serializedMessage = JSON.stringify(message);
    for (const [ws, session] of this.sessions.entries()) {
      if (excludeSessionId && session.id === excludeSessionId) {
        continue;
      }
      this.sendSerialized(ws, serializedMessage);
    }
  }
}

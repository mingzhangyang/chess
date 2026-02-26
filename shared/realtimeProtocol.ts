export type PlayerColor = 'w' | 'b';
export type RoomRole = 'player' | 'spectator';

export interface RoomUser {
  id: string;
  name: string;
  role: RoomRole;
  color: PlayerColor | null;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  timestamp: number;
}

export interface JoinRoomPayload {
  userName: string;
}

export interface MoveRequestPayload {
  requestId: string;
  fen: string;
}

export interface MoveAcceptedPayload {
  requestId: string;
  fen: string;
}

export interface MoveRejectedPayload {
  requestId: string;
  fen: string;
  code: MoveRejectCode;
}

export type RoomActionType = 'undo' | 'swap';

export interface ActionResponsePayload {
  requestId: string;
  accept: boolean;
}

export interface ActionRequestedPayload {
  requestId: string;
  action: RoomActionType;
  requesterId: string;
  requesterName: string;
}

export interface ActionResolvedPayload {
  requestId: string;
  action: RoomActionType;
  accepted: boolean;
}

export interface TargetedOfferPayload {
  targetId: string;
  offer: RTCSessionDescriptionInit;
}

export interface TargetedAnswerPayload {
  targetId: string;
  answer: RTCSessionDescriptionInit;
}

export interface TargetedIceCandidatePayload {
  targetId: string;
  candidate: RTCIceCandidateInit;
}

export type SignalType = 'offer' | 'answer' | 'ice-candidate';

export interface RoomStatePayload {
  users: RoomUser[];
  fen: string;
  myColor: PlayerColor | null;
  role: RoomRole;
}

export interface ConnectedPayload {
  id: string;
}

export interface SeatUpdatedPayload {
  role: RoomRole;
  myColor: PlayerColor | null;
}

export interface ChessMoveBroadcastPayload {
  fen: string;
  actorId: string;
}

export interface OfferBroadcastPayload {
  senderId: string;
  offer: RTCSessionDescriptionInit;
}

export interface AnswerBroadcastPayload {
  senderId: string;
  answer: RTCSessionDescriptionInit;
}

export interface IceCandidateBroadcastPayload {
  senderId: string;
  candidate: RTCIceCandidateInit;
}

export type WorkerErrorCode =
  | 'invalid-payload'
  | 'payload-too-large'
  | 'unknown-event'
  | 'invalid-chat-payload'
  | 'empty-chat-message'
  | 'chat-message-too-long'
  | 'invalid-signaling-payload'
  | 'signaling-payload-too-large'
  | 'invalid-fen'
  | 'invalid-move-payload'
  | 'spectator-cannot-move'
  | 'not-your-turn'
  | 'illegal-move'
  | 'spectator-cannot-reset'
  | 'spectator-cannot-request-action'
  | 'action-requires-opponent'
  | 'action-request-pending'
  | 'invalid-action-response'
  | 'action-response-without-request'
  | 'cannot-undo';

export type MoveRejectCode =
  | 'invalid-fen'
  | 'invalid-move-payload'
  | 'spectator-cannot-move'
  | 'not-your-turn'
  | 'illegal-move';

export interface ErrorPayload {
  code: WorkerErrorCode;
}

export interface ClientEventMap {
  'join-room': JoinRoomPayload;
  'chat-message': string;
  'chess-move': MoveRequestPayload;
  'reset-game': undefined;
  'request-undo': undefined;
  'request-swap': undefined;
  'action-response': ActionResponsePayload;
  offer: TargetedOfferPayload;
  answer: TargetedAnswerPayload;
  'ice-candidate': TargetedIceCandidatePayload;
}

export interface ServerEventMap {
  connected: ConnectedPayload;
  'room-state': RoomStatePayload;
  'user-joined': RoomUser;
  'user-left': string;
  'seat-updated': SeatUpdatedPayload;
  'chat-message': ChatMessage;
  'chess-move': ChessMoveBroadcastPayload;
  'move-accepted': MoveAcceptedPayload;
  'move-rejected': MoveRejectedPayload;
  'reset-game': undefined;
  'action-requested': ActionRequestedPayload;
  'action-resolved': ActionResolvedPayload;
  offer: OfferBroadcastPayload;
  answer: AnswerBroadcastPayload;
  'ice-candidate': IceCandidateBroadcastPayload;
  error: ErrorPayload;
}

export type ClientEventType = keyof ClientEventMap;
export type ServerEventType = keyof ServerEventMap;

type EnvelopeFromMap<M extends object, K extends keyof M> = M[K] extends undefined
  ? { type: K }
  : { type: K; payload: M[K] };

export type ClientEnvelope = {
  [K in ClientEventType]: EnvelopeFromMap<ClientEventMap, K>;
}[ClientEventType];

export type ServerEnvelope = {
  [K in ServerEventType]: EnvelopeFromMap<ServerEventMap, K>;
}[ServerEventType];

export function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseWireEnvelope(raw: string): { type: string; payload?: unknown } | null {
  try {
    const parsed = JSON.parse(raw) as { type?: unknown; payload?: unknown };
    if (!parsed || typeof parsed.type !== 'string' || !parsed.type || parsed.type.length > 64) {
      return null;
    }
    if ('payload' in parsed) {
      return { type: parsed.type, payload: parsed.payload };
    }
    return { type: parsed.type };
  } catch {
    return null;
  }
}

const CLIENT_EVENT_TYPES: ReadonlySet<string> = new Set([
  'join-room',
  'chat-message',
  'chess-move',
  'reset-game',
  'request-undo',
  'request-swap',
  'action-response',
  'offer',
  'answer',
  'ice-candidate',
]);

const SERVER_EVENT_TYPES: ReadonlySet<string> = new Set([
  'connected',
  'room-state',
  'user-joined',
  'user-left',
  'seat-updated',
  'chat-message',
  'chess-move',
  'move-accepted',
  'move-rejected',
  'reset-game',
  'action-requested',
  'action-resolved',
  'offer',
  'answer',
  'ice-candidate',
  'error',
]);

export function isClientEventType(type: string): type is ClientEventType {
  return CLIENT_EVENT_TYPES.has(type);
}

export function isServerEventType(type: string): type is ServerEventType {
  return SERVER_EVENT_TYPES.has(type);
}

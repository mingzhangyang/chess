import type {
  ClientEnvelope as SharedClientEnvelope,
  ClientEventType as SharedClientEventType,
  MoveRejectCode as SharedMoveRejectCode,
  MoveRequestPayload as SharedMoveRequestPayload,
  PlayerColor as SharedPlayerColor,
  RoomUser as SharedRoomUser,
  ServerEnvelope as SharedServerEnvelope,
  WorkerErrorCode as SharedWorkerErrorCode,
} from '../../shared/realtimeProtocol';

export type PlayerColor = SharedPlayerColor;
export type RoomUser = SharedRoomUser;
export type ClientEventType = SharedClientEventType;
export type MoveRequestPayload = SharedMoveRequestPayload;
export type MoveRejectCode = SharedMoveRejectCode;
export type WorkerErrorCode = SharedWorkerErrorCode;

export interface StoredRoomState {
  fen: string;
}

export type ClientEnvelope = SharedClientEnvelope;
export type ServerEnvelope = SharedServerEnvelope;

export interface Env {
  ASSETS: Fetcher;
  ROOMS: DurableObjectNamespace;
}

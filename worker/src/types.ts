export type PlayerColor = 'w' | 'b';

export interface RoomUser {
  id: string;
  name: string;
  role: 'player' | 'spectator';
  color: PlayerColor | null;
}

export interface StoredRoomState {
  fen: string;
}

export interface ClientEnvelope {
  type: string;
  payload?: unknown;
}

export interface ServerEnvelope {
  type: string;
  payload?: unknown;
}

export interface Env {
  ASSETS: Fetcher;
  ROOMS: DurableObjectNamespace;
}

import { createRoomSocket, RoomSocketClient } from './roomSocketClient';
import type { ClientEventMap, ClientEventType, ServerEventMap } from '../../shared/realtimeProtocol';

interface LocalEventMap {
  connect: { recovered: boolean };
  disconnect: { reason: 'close' | 'error' | 'manual' };
  reconnecting: { attempt: number; delayMs: number };
}

type RealtimeEventMap = ServerEventMap & LocalEventMap;
type RealtimeEventType = keyof RealtimeEventMap;

export interface RealtimeClient {
  id: string | null | undefined;
  connectionState: 'connecting' | 'connected' | 'reconnecting' | 'disconnected';
  on: <K extends RealtimeEventType>(event: K, handler: (payload: RealtimeEventMap[K]) => void) => void;
  emit: <K extends ClientEventType>(
    event: K,
    ...payload: ClientEventMap[K] extends undefined ? [] : [ClientEventMap[K]]
  ) => void;
  disconnect: () => void;
}

function asRealtimeClient(client: RoomSocketClient): RealtimeClient {
  return client;
}

export function createRealtimeClient(roomId: string): RealtimeClient {
  return asRealtimeClient(createRoomSocket(roomId));
}

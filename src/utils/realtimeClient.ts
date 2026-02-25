import { io } from 'socket.io-client';
import { createRoomSocket, RoomSocketClient } from './roomSocketClient';

export interface RealtimeClient {
  id: string | null | undefined;
  on: (event: string, handler: (...args: any[]) => void) => void;
  emit: (event: string, payload?: unknown) => void;
  disconnect: () => void;
}

function asRealtimeClient(client: RoomSocketClient): RealtimeClient {
  return client;
}

export function createRealtimeClient(roomId: string): RealtimeClient {
  if (import.meta.env.VITE_REALTIME_TRANSPORT === 'worker') {
    return asRealtimeClient(createRoomSocket(roomId));
  }

  return io();
}

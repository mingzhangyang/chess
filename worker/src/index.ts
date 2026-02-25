import type { Env } from './types';
import { RoomDurableObject } from './RoomDurableObject';

function normalizeRoomId(pathname: string): string | null {
  const segments = pathname.split('/').filter(Boolean);
  const rawRoomId = segments[segments.length - 1];
  if (!rawRoomId) {
    return null;
  }

  let roomId: string;
  try {
    roomId = decodeURIComponent(rawRoomId).trim().toUpperCase();
  } catch {
    return null;
  }
  if (!/^[A-Z0-9_-]{2,32}$/.test(roomId)) {
    return null;
  }

  return roomId;
}

const app: ExportedHandler<Env> = {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    const isRealtimePath = url.pathname.startsWith('/ws/') || url.pathname.startsWith('/api/ws/');

    if (url.pathname === '/api/health') {
      return Response.json({ status: 'ok' });
    }

    if (isRealtimePath) {
      const roomId = normalizeRoomId(url.pathname);
      if (!roomId) {
        return Response.json({ error: 'Invalid room id' }, { status: 400 });
      }

      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
        return new Response('Expected websocket upgrade', { status: 426 });
      }

      const id = env.ROOMS.idFromName(roomId);
      const room = env.ROOMS.get(id);
      return room.fetch(request);
    }

    return env.ASSETS.fetch(request);
  },
};

export default app;
export { RoomDurableObject };

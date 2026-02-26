import type { Env } from './types';
import { RoomDurableObject } from './RoomDurableObject';

const EDGE_TTL_LONG_SECONDS = 31_536_000;
const EDGE_TTL_SHORT_SECONDS = 60;
const EDGE_TTL_STATIC_SECONDS = 86_400;
const HASHED_ASSET_PATH_PATTERN = /\/assets\/.+-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/;

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

function resolveAssetCacheTtl(pathname: string): number {
  if (HASHED_ASSET_PATH_PATTERN.test(pathname)) {
    return EDGE_TTL_LONG_SECONDS;
  }

  const lastSegment = pathname.split('/').filter(Boolean).at(-1) ?? '';
  const isHtmlRequest = pathname === '/' || pathname.endsWith('.html') || !lastSegment.includes('.');
  if (isHtmlRequest) {
    return EDGE_TTL_SHORT_SECONDS;
  }

  return EDGE_TTL_STATIC_SECONDS;
}

function buildAssetRequestInit(pathname: string): RequestInit & { cf: { cacheEverything: true; cacheTtl: number } } {
  return {
    cf: {
      cacheEverything: true,
      cacheTtl: resolveAssetCacheTtl(pathname),
    },
  };
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

    return env.ASSETS.fetch(request, buildAssetRequestInit(url.pathname));
  },
};

export default app;
export { RoomDurableObject };

const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:global.stun.twilio.com:3478' },
];

type RuntimeEnv = Record<string, unknown>;

function normalizeIceServers(value: unknown): RTCIceServer[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry): entry is RTCIceServer => !!entry && typeof entry === 'object' && !Array.isArray(entry))
    .filter((entry) => typeof entry.urls === 'string' || (Array.isArray(entry.urls) && entry.urls.every((url) => typeof url === 'string')));
}

export function getIceServersFromEnv(env: RuntimeEnv): RTCIceServer[] {
  const raw = env.VITE_RTC_ICE_SERVERS;
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return [...DEFAULT_ICE_SERVERS];
  }

  try {
    const parsed = JSON.parse(raw);
    const normalized = normalizeIceServers(parsed);
    return normalized.length > 0 ? normalized : [...DEFAULT_ICE_SERVERS];
  } catch {
    return [...DEFAULT_ICE_SERVERS];
  }
}

export function getIceServers(): RTCIceServer[] {
  const runtimeEnv = ((import.meta as { env?: RuntimeEnv }).env ?? {}) as RuntimeEnv;
  return getIceServersFromEnv(runtimeEnv);
}

export function hasTurnServer(servers: RTCIceServer[]): boolean {
  return servers.some((server) => {
    const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
    return urls.some((url) => typeof url === 'string' && url.startsWith('turn:'));
  });
}

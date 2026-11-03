const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "connect-src 'self' ws: wss:",
  "manifest-src 'self'",
].join('; ');

export interface SecurityHeaderOptions {
  isHtml?: boolean;
  isSecure?: boolean;
  cacheControl?: string;
}

function normalizeOrigin(value: string): string | null {
  try {
    const origin = new URL(value.trim());
    if (origin.protocol !== 'http:' && origin.protocol !== 'https:') {
      return null;
    }
    return origin.origin;
  } catch {
    return null;
  }
}

function parseAllowedOrigins(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(',')
    .map(normalizeOrigin)
    .filter((origin): origin is string => origin !== null);
}

export function isAllowedWebSocketOrigin(request: Request, configuredOrigins?: string): boolean {
  const requestOrigin = request.headers.get('Origin');
  if (!requestOrigin) {
    // Non-browser clients do not have to send Origin. Authenticated/private rooms
    // should still use a signed join token; Origin is a browser-side defense.
    return true;
  }
  if (requestOrigin === 'null') {
    return false;
  }

  const normalizedRequestOrigin = normalizeOrigin(requestOrigin);
  if (!normalizedRequestOrigin) {
    return false;
  }

  const allowedOrigins = parseAllowedOrigins(configuredOrigins);
  if (allowedOrigins.length > 0) {
    return allowedOrigins.includes(normalizedRequestOrigin);
  }

  return normalizedRequestOrigin === new URL(request.url).origin;
}

export function withSecurityHeaders(response: Response, options: SecurityHeaderOptions = {}): Response {
  const headers = new Headers(response.headers);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=(), payment=(), usb=()');

  if (options.isSecure) {
    headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  // Cross-origin isolation exposes SharedArrayBuffer, which the threaded
  // Stockfish WASM build needs. COEP is sent on every response, not just
  // documents: in an isolated page the browser refuses to start a dedicated
  // worker (the AI worker, Stockfish's pthreads) whose script lacks it.
  headers.set('Cross-Origin-Embedder-Policy', 'require-corp');

  if (options.isHtml) {
    headers.set('Content-Security-Policy', CONTENT_SECURITY_POLICY);
    headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  }

  if (options.cacheControl) {
    headers.set('Cache-Control', options.cacheControl);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

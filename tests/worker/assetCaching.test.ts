import test from 'node:test';
import assert from 'node:assert/strict';
import app from '../../worker/src/index';

const ctx = {
  waitUntil: () => undefined,
  passThroughOnException: () => undefined,
} as ExecutionContext;

interface AssetCall {
  request: Request;
  init?: RequestInit;
}

function createEnv() {
  const calls: AssetCall[] = [];
  const env = {
    ROOMS: {
      idFromName: (name: string) => ({ name }),
      get: () => ({
        fetch: async () => new Response('room-response'),
      }),
    },
    ASSETS: {
      fetch: async (request: Request, init?: RequestInit) => {
        calls.push({ request, init });
        return new Response('asset-response');
      },
    },
  } as any;

  return { env, calls };
}

test('serves fingerprinted assets with long edge cache ttl', async () => {
  const { env, calls } = createEnv();

  await app.fetch(new Request('https://example.test/assets/index-abc123def.js'), env, ctx);

  assert.equal(calls.length, 1);
  assert.deepEqual((calls[0].init as any)?.cf, {
    cacheEverything: true,
    cacheTtl: 31536000,
  });
});

test('serves html/navigation requests with short edge cache ttl', async () => {
  const { env, calls } = createEnv();

  await app.fetch(new Request('https://example.test/room/ABCD'), env, ctx);

  assert.equal(calls.length, 1);
  assert.deepEqual((calls[0].init as any)?.cf, {
    cacheEverything: true,
    cacheTtl: 60,
  });
});

test('adds browser security and cache headers to html responses', async () => {
  const { env } = createEnv();
  env.ASSETS.fetch = async () => new Response('<!doctype html>', {
    headers: { 'content-type': 'text/html; charset=UTF-8' },
  });

  const response = await app.fetch(new Request('https://example.test/'), env, ctx);

  assert.equal(response.headers.get('Content-Security-Policy')?.includes("default-src 'self'"), true);
  assert.equal(response.headers.get('Cross-Origin-Opener-Policy'), 'same-origin');
  assert.equal(response.headers.get('Cross-Origin-Embedder-Policy'), 'require-corp');
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(response.headers.get('X-Frame-Options'), 'DENY');
  assert.equal(response.headers.get('Cache-Control'), 'no-cache');
});

test('worker and wasm assets carry COEP so they load in a cross-origin isolated page', async () => {
  // In a COEP: require-corp document the browser refuses to start a dedicated
  // worker whose script response lacks COEP. That covers the AI worker and
  // Stockfish's pthread workers, so single-player AI would not start at all.
  const { env } = createEnv();
  const assets: Array<[string, string]> = [
    ['/assets/chessAiWorker-abc123def.js', 'text/javascript'],
    ['/assets/stockfish.worker-abc123def.js', 'text/javascript'],
    ['/assets/stockfish-abc123def.wasm', 'application/wasm'],
  ];

  for (const [pathname, contentType] of assets) {
    env.ASSETS.fetch = async () => new Response('asset', { headers: { 'content-type': contentType } });
    const response = await app.fetch(new Request(`https://example.test${pathname}`), env, ctx);
    assert.equal(response.headers.get('Cross-Origin-Embedder-Policy'), 'require-corp', pathname);
  }
});

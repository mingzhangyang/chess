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

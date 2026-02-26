import test from 'node:test';
import assert from 'node:assert/strict';
import app from '../../worker/src/index';

const ctx = {
  waitUntil: () => undefined,
  passThroughOnException: () => undefined,
} as ExecutionContext;

function createEnv() {
  const calls: string[] = [];
  const assetRequests: string[] = [];
  const env = {
    ROOMS: {
      idFromName: (name: string) => ({ name }),
      get: (id: { name: string }) => ({
        fetch: async () => {
          calls.push(id.name);
          return new Response(`room:${id.name}`);
        },
      }),
    },
    ASSETS: {
      fetch: async (request: Request) => {
        assetRequests.push(new URL(request.url).pathname);
        return new Response('asset-response');
      },
    },
  } as any;

  return { env, calls, assetRequests };
}

test('routes /api/ws/:roomId websocket upgrades to durable object', async () => {
  const { env, calls } = createEnv();

  const response = await app.fetch(
    new Request('https://example.test/api/ws/ROOM-1', {
      headers: { Upgrade: 'websocket' },
    }),
    env,
    ctx,
  );

  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'room:ROOM-1');
  assert.deepEqual(calls, ['ROOM-1']);
});

test('rejects /api/ws/:roomId requests without websocket upgrade header', async () => {
  const { env, calls } = createEnv();

  const response = await app.fetch(new Request('https://example.test/api/ws/ROOM-2'), env, ctx);

  assert.equal(response.status, 426);
  assert.deepEqual(calls, []);
});

test('falls back to static assets for non-websocket paths', async () => {
  const { env } = createEnv();

  const response = await app.fetch(new Request('https://example.test/'), env, ctx);

  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'asset-response');
});

test('rewrites language landing paths to localized index.html assets', async () => {
  const { env, assetRequests } = createEnv();

  const response = await app.fetch(new Request('https://example.test/zh'), env, ctx);

  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'asset-response');
  assert.deepEqual(assetRequests, ['/zh/index.html']);
});

test('rewrites privacy path to privacy index asset', async () => {
  const { env, assetRequests } = createEnv();

  const response = await app.fetch(new Request('https://example.test/privacy'), env, ctx);

  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'asset-response');
  assert.deepEqual(assetRequests, ['/privacy/index.html']);
});

test('rewrites localized privacy path to localized privacy index asset', async () => {
  const { env, assetRequests } = createEnv();

  const response = await app.fetch(new Request('https://example.test/ja/privacy'), env, ctx);

  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'asset-response');
  assert.deepEqual(assetRequests, ['/ja/privacy/index.html']);
});

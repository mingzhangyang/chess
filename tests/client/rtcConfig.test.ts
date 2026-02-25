import test from 'node:test';
import assert from 'node:assert/strict';
import { getIceServersFromEnv, hasTurnServer } from '../../src/utils/rtcConfig';

test('uses default STUN servers when env is missing', () => {
  const servers = getIceServersFromEnv({});
  assert.equal(servers.length, 2);
  assert.equal(hasTurnServer(servers), false);
});

test('parses configured ICE servers and preserves TURN entries', () => {
  const servers = getIceServersFromEnv({
    VITE_RTC_ICE_SERVERS: JSON.stringify([
      { urls: 'stun:stun.example.com:3478' },
      { urls: ['turn:turn.example.com:3478?transport=udp'], username: 'u', credential: 'p' },
    ]),
  });

  assert.equal(servers.length, 2);
  assert.equal(hasTurnServer(servers), true);
});

test('falls back to defaults for invalid ICE server JSON', () => {
  const servers = getIceServersFromEnv({ VITE_RTC_ICE_SERVERS: '{invalid' });
  assert.equal(servers.length, 2);
});

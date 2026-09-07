import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const rtcSessionPath = path.resolve(process.cwd(), 'src/hooks/useRtcSession.ts');

test('media setup effect only depends on stable room identity inputs', () => {
  const source = readFileSync(rtcSessionPath, 'utf8');

  assert.match(
    source,
    /}\s*,\s*\[canUseMedia,\s*closePeerConnection,\s*isMediaEnabled,\s*roomId,\s*userName\]\s*\);/,
    'media setup effect should not restart on every parent render',
  );
});

test('queues peer signaling until local media is ready and closes only the matching peer', () => {
  const source = readFileSync(rtcSessionPath, 'utf8');

  assert.match(source, /pendingOfferRef/);
  assert.match(source, /pendingPeerRef/);
  assert.match(source, /handleUserLeft: \(userId: string\)/);
  assert.match(source, /activePeerIdRef\.current === userId/);
  assert.match(source, /closePeerConnection\(userId\)/);
});

test('does not request media until the room grants media eligibility and the user enables it', () => {
  const source = readFileSync(rtcSessionPath, 'utf8');

  assert.match(source, /isMediaEnabled/);
  assert.match(source, /canUseMedia/);
  assert.match(source, /if \(!canUseMedia \|\| !isMediaEnabled\)/);
});

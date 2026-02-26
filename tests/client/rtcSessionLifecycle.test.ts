import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const rtcSessionPath = path.resolve(process.cwd(), 'src/hooks/useRtcSession.ts');

test('media setup effect only depends on stable room identity inputs', () => {
  const source = readFileSync(rtcSessionPath, 'utf8');

  assert.match(
    source,
    /}\s*,\s*\[roomId,\s*userName\]\s*\);/,
    'media setup effect should not restart on every parent render',
  );
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const gameRoomPath = path.resolve(process.cwd(), 'src/components/GameRoom.tsx');
const singlePlayerPath = path.resolve(process.cwd(), 'src/components/SinglePlayerRoom.tsx');

test('room components avoid verbose move history scans during render', () => {
  const gameRoomSource = readFileSync(gameRoomPath, 'utf8');
  const singlePlayerSource = readFileSync(singlePlayerPath, 'utf8');

  assert.doesNotMatch(gameRoomSource, /game\.history\(\{\s*verbose:\s*true\s*\}\)/);
  assert.doesNotMatch(singlePlayerSource, /game\.history\(\{\s*verbose:\s*true\s*\}\)/);
});

test('chat autoscroll avoids smooth animation work for each incoming message', () => {
  const gameRoomSource = readFileSync(gameRoomPath, 'utf8');

  assert.match(gameRoomSource, /scrollIntoView\(\{\s*behavior:\s*'auto'/);
  assert.doesNotMatch(gameRoomSource, /scrollIntoView\(\{\s*behavior:\s*'smooth'/);
});

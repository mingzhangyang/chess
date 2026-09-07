import assert from 'node:assert/strict';
import test from 'node:test';
import { createRoomId, isValidRoomId } from '../../src/utils/roomId';

test('creates a room id with the accepted format', () => {
  const roomId = createRoomId();
  assert.equal(roomId.length, 10);
  assert.match(roomId, /^[A-Z0-9_-]+$/);
});

test('validates room ids without accepting ambiguous or unsafe input', () => {
  assert.equal(isValidRoomId('AB12CD3456'), true);
  assert.equal(isValidRoomId('ab12cd3456'), true);
  assert.equal(isValidRoomId('A'), false);
  assert.equal(isValidRoomId('AB12CD345'), false);
  assert.equal(isValidRoomId('ROOM/1'), false);
  assert.equal(isValidRoomId('ROOM 1'), false);
  assert.equal(isValidRoomId('A'.repeat(33)), false);
});

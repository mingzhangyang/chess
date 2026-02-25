import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_INBOUND_MESSAGE_BYTES,
  MAX_SIGNAL_PAYLOAD_BYTES,
  isInboundMessageWithinLimit,
  validateChatPayload,
  validateTargetedSignalPayload,
} from '../../worker/src/payloadValidation';

test('rejects oversized inbound websocket message', () => {
  const oversized = 'x'.repeat(MAX_INBOUND_MESSAGE_BYTES + 1);
  assert.equal(isInboundMessageWithinLimit(oversized), false);
});

test('accepts valid chat payload', () => {
  const result = validateChatPayload('  hello there  ');
  assert.deepEqual(result, { ok: true, text: 'hello there' });
});

test('rejects invalid chat payload type', () => {
  const result = validateChatPayload({ text: 'hello' });
  assert.deepEqual(result, { ok: false, code: 'invalid-chat-payload' });
});

test('rejects empty chat payload', () => {
  const result = validateChatPayload('   ');
  assert.deepEqual(result, { ok: false, code: 'empty-chat-message' });
});

test('rejects chat payloads above max length', () => {
  const result = validateChatPayload('x'.repeat(501));
  assert.deepEqual(result, { ok: false, code: 'chat-message-too-long' });
});

test('accepts valid offer payload', () => {
  const result = validateTargetedSignalPayload(
    {
      targetId: 'peer-1',
      offer: { type: 'offer', sdp: 'v=0' },
    },
    'offer',
  );

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.targetId, 'peer-1');
    assert.deepEqual(result.signalPayload, { type: 'offer', sdp: 'v=0' });
  }
});

test('rejects signaling payload when targetId is missing', () => {
  const result = validateTargetedSignalPayload({ offer: { type: 'offer', sdp: 'v=0' } }, 'offer');
  assert.deepEqual(result, { ok: false, code: 'invalid-signaling-payload' });
});

test('rejects signaling payload when event body key is missing', () => {
  const result = validateTargetedSignalPayload({ targetId: 'peer-1' }, 'ice-candidate');
  assert.deepEqual(result, { ok: false, code: 'invalid-signaling-payload' });
});

test('rejects signaling payload above size limit', () => {
  const result = validateTargetedSignalPayload(
    {
      targetId: 'peer-1',
      answer: { sdp: 'x'.repeat(MAX_SIGNAL_PAYLOAD_BYTES + 1) },
    },
    'answer',
  );
  assert.deepEqual(result, { ok: false, code: 'signaling-payload-too-large' });
});

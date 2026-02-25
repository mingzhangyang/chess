import type { SignalType } from '../../shared/realtimeProtocol';

const encoder = new TextEncoder();

export const MAX_INBOUND_MESSAGE_BYTES = 64_000;
export const MAX_CHAT_MESSAGE_LENGTH = 500;
export const MAX_SIGNAL_PAYLOAD_BYTES = 24_000;
const MAX_SIGNAL_TARGET_ID_LENGTH = 64;

function byteLength(value: string): number {
  return encoder.encode(value).length;
}

function jsonByteLength(value: unknown): number {
  try {
    return byteLength(JSON.stringify(value));
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isInboundMessageWithinLimit(raw: string): boolean {
  return byteLength(raw) <= MAX_INBOUND_MESSAGE_BYTES;
}

export function validateChatPayload(payload: unknown):
  | { ok: true; text: string }
  | { ok: false; code: 'invalid-chat-payload' | 'empty-chat-message' | 'chat-message-too-long' } {
  if (typeof payload !== 'string') {
    return { ok: false, code: 'invalid-chat-payload' };
  }

  const text = payload.trim();
  if (!text) {
    return { ok: false, code: 'empty-chat-message' };
  }

  if (text.length > MAX_CHAT_MESSAGE_LENGTH) {
    return { ok: false, code: 'chat-message-too-long' };
  }

  return { ok: true, text };
}

function signalPayloadField(type: SignalType): 'offer' | 'answer' | 'candidate' {
  if (type === 'ice-candidate') {
    return 'candidate';
  }
  return type;
}

export function validateTargetedSignalPayload(payload: unknown, type: SignalType):
  | { ok: true; targetId: string; signalPayload: Record<string, unknown> }
  | { ok: false; code: 'invalid-signaling-payload' | 'signaling-payload-too-large' } {
  if (!isRecord(payload)) {
    return { ok: false, code: 'invalid-signaling-payload' };
  }

  const rawTargetId = payload.targetId;
  if (typeof rawTargetId !== 'string') {
    return { ok: false, code: 'invalid-signaling-payload' };
  }

  const targetId = rawTargetId.trim();
  if (!targetId || targetId.length > MAX_SIGNAL_TARGET_ID_LENGTH) {
    return { ok: false, code: 'invalid-signaling-payload' };
  }

  const field = signalPayloadField(type);
  const signalPayload = payload[field];
  if (!isRecord(signalPayload)) {
    return { ok: false, code: 'invalid-signaling-payload' };
  }

  if (jsonByteLength(signalPayload) > MAX_SIGNAL_PAYLOAD_BYTES) {
    return { ok: false, code: 'signaling-payload-too-large' };
  }

  return { ok: true, targetId, signalPayload };
}

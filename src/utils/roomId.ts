const ROOM_ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const ROOM_ID_LENGTH = 10;
const ROOM_ID_PATTERN = /^[A-Z0-9_-]{2,32}$/i;

export function isValidRoomId(roomId: string): boolean {
  return ROOM_ID_PATTERN.test(roomId.trim());
}

export function createRoomId(): string {
  const values = new Uint32Array(ROOM_ID_LENGTH);
  globalThis.crypto.getRandomValues(values);
  return Array.from(values, (value) => ROOM_ID_ALPHABET[value % ROOM_ID_ALPHABET.length]).join('');
}

# Realtime Protocol (Worker)

All messages use JSON envelopes:

```json
{ "type": "event-name", "payload": { "...": "..." } }
```

Room access and admission:

- Room IDs must contain 10–32 letters, numbers, hyphens, or underscores.
- Browser WebSocket origins must match the Worker origin or an origin listed in `ALLOWED_ORIGINS`.
- A room accepts at most 32 live sessions. Each session is also subject to an overall message limit, a chat limit, and a signaling limit in a rolling 10-second window.

## Client -> Server
- `join-room`: `{ userName: string }`
- `chat-message`: `string`
- `chess-move`: `{ requestId: string, fen: string }`
- `reset-game`: no payload
- `offer`: `{ targetId: string, offer: RTCSessionDescriptionInit }`
- `answer`: `{ targetId: string, answer: RTCSessionDescriptionInit }`
- `ice-candidate`: `{ targetId: string, candidate: RTCIceCandidateInit }`

## Server -> Client
- `connected`: `{ id: string }`
- `room-state`: `{ users, fen, myColor, role }`
- `user-joined`: `user`
- `user-left`: `userId`
- `seat-updated`: `{ role, myColor }`
- `chat-message`: `{ id, senderId, senderName, text, timestamp }`
- `chess-move`: `{ fen, actorId }`
- `move-accepted`: `{ requestId, fen }`
- `move-rejected`: `{ requestId, code, fen }`
- `reset-game`: no payload
- `offer`: `{ senderId, offer }`
- `answer`: `{ senderId, answer }`
- `ice-candidate`: `{ senderId, candidate }`
- `error`: `{ code }`

## Validation Bounds
- Max inbound websocket message size: `64,000` bytes.
- Max `chat-message` length: `500` chars after trim.
- Max signaling payload (`offer` / `answer` / `candidate`) JSON size: `24,000` bytes.
- Overall inbound messages per session: `120` per rolling 10 seconds.
- Chat messages per session: `10` per rolling 10 seconds.
- Signaling messages per session: `60` per rolling 10 seconds.

## Worker Error Codes
- `invalid-payload`
- `payload-too-large`
- `rate-limited`
- `not-joined`
- `already-joined`
- `unknown-event`
- `invalid-chat-payload`
- `empty-chat-message`
- `chat-message-too-long`
- `invalid-signaling-payload`
- `signaling-payload-too-large`
- `invalid-fen`
- `invalid-move-payload`
- `spectator-cannot-move`
- `not-your-turn`
- `illegal-move`
- `spectator-cannot-reset`

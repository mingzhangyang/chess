# Realtime Protocol (Worker)

All messages use JSON envelopes:

```json
{ "type": "event-name", "payload": { "...": "..." } }
```

## Client -> Server
- `join-room`: `{ userName: string }`
- `chat-message`: `string`
- `chess-move`: `string` (FEN)
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
- `chess-move`: `fen`
- `reset-game`: no payload
- `offer`: `{ senderId, offer }`
- `answer`: `{ senderId, answer }`
- `ice-candidate`: `{ senderId, candidate }`
- `error`: `{ code }`

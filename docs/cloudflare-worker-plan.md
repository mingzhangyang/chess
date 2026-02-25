# Cloudflare Worker Migration Plan

## Goal
Migrate this app from `Express + Socket.IO` to a Cloudflare Worker architecture while preserving multiplayer chess, chat, and WebRTC signaling.

## Current Status (2026-02-25)
- Phase 1: completed (Worker + Durable Object scaffolding in repo).
- Phase 2: completed for baseline room flow (room/session/chat/signaling/move-reset handlers implemented).
- Phase 3: completed (server-side move/reset validation + bounded inbound/chat/signaling payload validation).
- Phase 4: completed (frontend realtime path now uses native WebSocket client facade).
- Phase 5: completed in-repo (Worker scripts and automated rules/payload tests are in place; manual Cloudflare deploy/domain mapping remains external).

## Target Architecture
- Frontend: Vite React app built to static assets (`dist/`).
- Edge backend: single Cloudflare Worker handling HTTP and WebSocket upgrades.
- Real-time room state: Durable Object instance per room ID.
- Persistence:
  - Room state (current FEN and metadata) in Durable Object storage.
  - Live clients in Durable Object WebSocket session memory.

## Protocol Direction
- Replace Socket.IO transport with native WebSocket JSON messages.
- Standard envelope:
  - Client -> Server: `{ "type": string, "payload": unknown }`
  - Server -> Client: `{ "type": string, "payload": unknown }`
- Preserve existing event names where possible (`join-room`, `room-state`, `user-joined`, `user-left`, `chat-message`, `offer`, `answer`, `ice-candidate`, `chess-move`, `reset-game`).

## Phases

### Phase 1: Worker Scaffolding
- Add `wrangler.toml` with:
  - Worker entrypoint
  - Durable Object binding
  - migration block
  - static assets binding to `dist`
- Add Worker entrypoint route handling:
  - `GET /api/health`
  - `GET /ws/:roomId` (WebSocket upgrade -> Durable Object)
  - static asset fallback
- Add Durable Object class for room sessions.

### Phase 2: Durable Object Room Logic
- Implement room user lifecycle:
  - join/leave
  - player color assignment (`w`/`b`)
  - spectator role support
- Implement broadcast and targeted messages.
- Implement WebRTC signaling relay (`offer`, `answer`, `ice-candidate`).
- Implement chat broadcast.
- Implement move/reset handling.

### Phase 3: Game Integrity Hardening
- Add server-side move validation for incoming FEN updates:
  - Allow only player whose turn it is.
  - Reject spectator moves.
  - Reject non-legal transitions from current position.
- Add bounded payload validation for chat and signaling.

### Phase 4: Frontend Transport Migration
- Replace `socket.io-client` with a lightweight native WebSocket client module.
- Update `GameRoom` to use the new transport and protocol envelope.
- Keep component behavior unchanged from user perspective.

### Phase 5: QA and Deployment
- Add scripts for Worker dev/build/deploy.
- Add tests for room logic (turn enforcement, illegal move rejection, spectator restrictions).
- Deploy to `*.workers.dev`, validate multiplayer flows, then map custom domain. (manual Cloudflare environment step)

## Deliverables
- `wrangler.toml`
- `worker/src/index.ts`
- `worker/src/RoomDurableObject.ts`
- frontend transport module and `GameRoom` migration
- updated npm scripts and docs

## Rollout Notes
- Keep existing Node `server.ts` temporarily during migration for fallback.
- Cut over only after Phase 4 validation is complete.
- Cutover status: frontend is using the Worker protocol path.

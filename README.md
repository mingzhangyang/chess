<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/4f83a68c-8d9f-4e6f-9e9b-9d16cfebd287

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Cloudflare Worker Migration

Cloudflare migration is implemented in-repo:
- Worker entry: `worker/src/index.ts`
- Durable Object room service: `worker/src/RoomDurableObject.ts`
- Config: `wrangler.toml`
- Migration plan: `docs/cloudflare-worker-plan.md`
- Realtime protocol: `docs/cloudflare-realtime-protocol.md`
- WebSocket client wrapper: `src/utils/roomSocketClient.ts`
- Realtime client facade: `src/utils/realtimeClient.ts` (native WebSocket path)
- Worker rule/payload tests: `tests/worker/*.test.ts`

Commands:
- `npm run worker:dev`
- `npm run worker:typegen`
- `npm run worker:deploy`
- `npm run test`

Deployment and domain mapping still require a real Cloudflare account/environment.

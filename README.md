# Cloud Chess Room

A real-time online chess app with private multiplayer rooms, built-in single-player AI, and multilingual SEO-ready pages.

## Features

- Private multiplayer rooms over WebSocket + Durable Objects
- Single-player mode with difficulty levels
- In-app language switching (`en`, `zh`, `fr`, `es`, `ja`)
- PWA support (manifest + service worker + install prompt)
- Localized SEO entry pages and localized privacy pages
- Cloudflare Worker routing for app pages and realtime endpoints

## Tech Stack

- Frontend: React 19 + Vite + Tailwind CSS 4
- Chess engine/rules: `chess.js`
- Realtime/backend: Cloudflare Workers + Durable Objects + WebSocket
- Tests: Node test runner (`node --test`) + TypeScript checks

## Project Structure

- `src/`: React app and client logic
- `worker/`: Cloudflare Worker and Durable Object service
- `tests/client/`: frontend and config tests
- `tests/worker/`: worker routing and protocol tests
- `public/`: static assets, sitemap, robots, privacy pages
- `docs/`: migration and realtime protocol docs

## Prerequisites

- Node.js (LTS recommended)
- npm
- Cloudflare account (only required for deployment)

## Local Development

1. Install dependencies:
   ```bash
   npm install
   ```
2. Start app locally:
   ```bash
   npm run dev
   ```

The default dev flow runs Vite locally.

## Environment Variables

Copy `.env.example` to your local env file if needed and set values for your environment.

Optional realtime runtime config:

- `VITE_REALTIME_WS_URL`
- `VITE_REALTIME_WS_PATHS` (default: `/ws,/api/ws`)
- `VITE_REALTIME_MAX_RECONNECT_ATTEMPTS` (default: `8`)
- `VITE_RTC_ICE_SERVERS` (JSON array; include TURN for production)

## Commands

- `npm run dev`: start local app
- `npm run build`: production build
- `npm run preview`: preview built app
- `npm run test`: run test suite
- `npm run lint`: TypeScript type-check (`tsc --noEmit`)
- `npm run worker:dev`: run Cloudflare Worker locally
- `npm run worker:typegen`: generate Worker types
- `npm run worker:deploy`: build and deploy Worker

## Cloudflare Deployment

Worker config is in `wrangler.toml`:

- Worker entry: `worker/src/index.ts`
- Durable Object: `RoomDurableObject`
- Static assets binding: `ASSETS` -> `./dist`

Typical deployment flow:

```bash
npm run build
npm run worker:deploy
```

## SEO and Localization

Localized app entry routes:

- `/`
- `/zh/`
- `/fr/`
- `/es/`
- `/ja/`

Localized privacy routes:

- `/privacy/`
- `/zh/privacy/`
- `/fr/privacy/`
- `/es/privacy/`
- `/ja/privacy/`

Sitemap and robots:

- `public/sitemap.xml`
- `public/robots.txt`

## Privacy Contact

For privacy-related requests, contact:

- `contact@orangely.xyz`

## Docs

- `docs/cloudflare-worker-plan.md`
- `docs/cloudflare-realtime-protocol.md`

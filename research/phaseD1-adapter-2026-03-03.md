# Phase D1 Report - EngineAdapter Abstraction

Date: 2026-03-03
Scope: implement adapter abstraction in worker runtime while keeping current TS engine behavior unchanged.

## Changes

1. Added adapter contracts:
- `src/workers/engineAdapter.ts`
  - `AiEngineBackend = 'ts' | 'stockfish-wasm'`
  - `EngineAdapter` interface (`init`, `computeBestMove`, `dispose`)
  - typed init/compute payloads

2. Added current-engine wrapper:
- `src/workers/tsEngineAdapter.ts`
  - wraps existing `getBestMove`
  - supports shared TT init via `initSharedTranspositionTable`

3. Integrated adapter path in worker runtime:
- `src/workers/aiWorkerRuntime.ts`
  - added backend-aware request fields (`backend?`)
  - added adapter resolver + cache
  - default backend remains `ts`
  - requested `stockfish-wasm` currently falls back to `ts` (explicit D1 behavior)
  - `handleAiComputeRequest` and `handleInitSharedTT` are now async

4. Updated worker entrypoint for async runtime:
- `src/workers/chessAiWorker.ts`
  - async message handler
  - same message protocol and response contract

5. Updated tests:
- `tests/client/aiWorkerRuntime.test.ts`
  - migrated to async runtime calls
  - added adapter-injection test coverage
  - added shared-TT init forwarding test

## Validation

- `npm run lint`: pass
- `npm test`: pass (20/20)

## Result

Phase D1 complete. Adapter seam is now in place for D2 `StockfishWasmAdapter` implementation without changing UI protocol.

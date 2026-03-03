# Phase D2 Report - StockfishWasmAdapter Integration

Date: 2026-03-03  
Scope: implement usable Stockfish WASM adapter path (UCI init, difficulty mapping, timeout/fallback), while keeping default TS-engine path unchanged.

## Implemented

1. Package + loader
- Installed dependency: `stockfish.wasm`
- Added `StockfishWasmAdapter` with dynamic module loading:
  - `import('stockfish.wasm')`
  - Vite asset URL resolution for:
    - `stockfish.wasm/stockfish.wasm?url`
    - `stockfish.wasm/stockfish.worker.js?url`
  - `locateFile` wiring to keep wasm/worker asset paths stable after bundling

2. UCI init/config pipeline
- `src/workers/stockfishWasmAdapter.ts` now performs:
  - `uci` -> wait `uciok`
  - `setoption Threads`
  - `setoption Hash`
  - `isready` -> wait `readyok`
- Added command serialization lock to avoid overlapping UCI sessions.

3. Difficulty -> UCI option mapping
- On search, adapter maps difficulty to skill:
  - `easy=3`, `medium=8`, `hard=15`, `expert=20`
- Applies:
  - `setoption name UCI_LimitStrength value true`
  - `setoption name Skill Level value <n>`
  - `setoption name UCI_Elo value <mapped>`
- Position and search:
  - `position startpos` or `position fen ...`
  - `go movetime <ms>`
  - parse `bestmove ...`

4. Timeout + fallback safety
- Adapter waiters enforce command timeouts.
- Worker runtime fallback in `src/workers/aiWorkerRuntime.ts`:
  - non-TS backend init failure -> fallback to TS init
  - non-TS backend compute failure -> fallback to TS compute
- Worker telemetry events now emitted on:
  - `backend-init-fallback`
  - `backend-compute-fallback`
  - `backend-compute-failed`

## Tests Added/Updated

- `tests/client/stockfishWasmAdapter.test.ts`
  - UCI bootstrap and base option setup
  - difficulty mapping + movetime + bestmove parsing
  - timeout failure behavior
- `tests/client/aiWorkerRuntime.test.ts`
  - stockfish->ts fallback on init and compute paths

## Validation

- `npm run lint`: pass
- `npm test`: pass (21/21)
- Engine comparison benchmark: `research/phaseD2-engine-compare-2026-03-03.md`
  - TS avg latency: `2765.02ms`
  - stockfish.wasm avg latency: `716.23ms`
  - Tactical smoke: `4/4` vs `4/4`

## Head-to-Head Quantification

- Match report: `research/phaseD2-headtohead-2026-03-03.md`
- Command:
  - `H2H_MOVE_MS=120 H2H_MAX_PLIES=50 H2H_OPENING_LIMIT=6 H2H_ROUNDS_PER_OPENING=8 node --import tsx research/scripts/phaseD2-headtohead.ts`
- Result summary (stockfish.wasm vs TS):
  - Games: `96`
  - W/D/L: `10/83/3`
  - Score: `53.65%`
  - Elo estimate: `+25.4`
  - 95% CI: `[-44.2, 97.1]`
  - Avg move time: stockfish `132.50ms` vs TS `1174.20ms`

## Remaining in D2

- Worker-level telemetry and baseline quantification are complete.
- Remaining optional work:
  - increase sample size (more openings/rounds) to narrow Elo confidence interval
  - wire production telemetry sink/retention policy if needed

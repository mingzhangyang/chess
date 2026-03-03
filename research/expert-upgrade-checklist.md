# Chess AI Expert Upgrade Checklist

Updated: 2026-03-03  
How to use:

- Mark each item with `[x]` when done.
- Do not check an item unless its acceptance criteria and evidence are filled.
- One PR/session should usually complete only a small set of items.

---

## 0) Project Setup

- [x] Define baseline branch/commit for comparisons
  - Baseline commit: `ae150eb`
  - Candidate branch: `main` (working tree WIP)
- [x] Confirm benchmark environment is fixed (same machine/config)
  - CPU info: AMD Ryzen 7 4700U (8 cores)
  - Browser/Node version: Node v22.15.0 (benchmark run)
- [x] Confirm current test command passes
  - Command: `npm test`
  - Result: pass (2026-03-03, local run)
- [x] Create/update progress log for this phase
  - Log file: `research/session-handoff-template.md` or session-specific note

---

## 1) Phase A - Search Safety Pack

## A1. NMP Static-Eval Guard

- [x] Add feature flag: `enableNmpStaticGuard`
- [x] Implement guard before null-move branch
- [x] Add unit tests: guard triggers and non-triggers
- [x] Verify no regression on check/zugzwang-sensitive FENs
  - Smoke FENs (baseline vs phaseA) all legal and consistent:
    - `6k1/8/8/8/8/8/5q2/6K1 w - - 0 1` -> `Kxf2`
    - `8/8/8/8/8/8/6pk/7K w - - 0 1` -> `Kxh2`
    - `8/p7/8/8/8/8/P7/K6k w - - 0 1` -> `Kb2`
- [x] Record metrics (before/after):
  - Nodes: 800 -> 906 (+13.25%)
  - Avg depth: 3.54 -> 4.54 (+28.24%)
  - Think time (avg ms): 2344.98 -> 1331.71 (-43.21%)

Acceptance:

- [x] Tactical suite unchanged or improved
- [x] No illegal-move or crash regression

Evidence:

- PR/commit: WIP (not committed yet)
- Test output summary: `npm test` pass, `npm run lint` pass, tactical smoke 4/4 -> 4/4 (baseline -> phaseA), benchmark report `research/phaseA-benchmark-2026-03-03.md`

## A2. Quiescence Delta Pruning

- [x] Add feature flag: `enableQDelta`
- [x] Implement delta pruning in non-check q-nodes
- [x] Keep promotions/check-evasion behavior safe
- [x] Add targeted q-search tests (must not prune critical captures)
- [x] Record q-node ratio before/after
  - qNode ratio: 0.8080 -> 0.5062 (-37.35%)

Acceptance:

- [x] q-node count reduced
- [x] Tactical suite unchanged or improved

Evidence:

- PR/commit: WIP (not committed yet)
- Test output summary: `npm test` pass, `npm run lint` pass, benchmark report `research/phaseA-benchmark-2026-03-03.md`

## A3. Reverse Futility Pruning (RFP)

- [x] Add feature flag: `enableRfp`
- [x] Implement conservative RFP margins by depth
- [x] Restrict to non-PV + non-check + shallow depth nodes
- [x] Add tests for "must not prune" tactical cases
- [x] Benchmark node/time impact
  - Avg ms: 2344.98 -> 1331.71 (-43.21%)
  - Avg nodes: 800 -> 906 (+13.25%)

Acceptance:

- [ ] Node reduction with no tactical regressions
  - Tactical: 4/4 -> 4/4 (pass), but node reduction target not met (+13.25%).

Evidence:

- PR/commit: WIP (not committed yet)
- Test output summary: `npm test` pass, `npm run lint` pass, benchmark report `research/phaseA-benchmark-2026-03-03.md`

## A4. Futility Pruning + LMP

- [x] Add feature flags: `enableFp`, `enableLmp`
- [x] Implement FP with depth-based margins
- [x] Implement LMP for late quiet moves only
- [x] Guard conditions: non-PV, non-check, shallow depth, quiet only
- [x] Add tests for pruning boundaries and safety

Acceptance:

- [x] Speedup at equal/acceptable tactical quality
  - Avg ms: -43.21%, Median ms: -38.85%, Tactical smoke unchanged (4/4 -> 4/4)

Evidence:

- PR/commit: WIP (not committed yet)
- Test output summary: `npm test` pass, `npm run lint` pass, benchmark report `research/phaseA-benchmark-2026-03-03.md`

---

## 2) Phase B - Move Ordering Quality Pack

## B1. LMR Formula Upgrade

- [x] Add feature flag: `enableLmrTable`
- [x] Add reduction table based on depth + move index
- [x] Integrate correction terms (history/killer/improving)
- [x] Keep re-search logic correct for fail-high/fail-low paths
- [x] Add tests for LMR boundary behavior

Acceptance:

- [x] Stable PV quality and stronger depth profile under same time budget
  - B1 benchmark: Avg depth `3.79 -> 4.08` (+7.69%), tactical smoke `4/4 -> 4/4` (no regression)

Evidence:

- PR/commit: WIP (not committed yet)
- Test output summary:
  - `npm test` pass, `npm run lint` pass (B1 helper+integration tests added)
  - Benchmark report: `research/phaseB1-benchmark-2026-03-03.md` (phaseA vs phaseA+B1)

## B2. History Malus + Countermove

- [x] Add feature flags: `enableHistoryMalus`, `enableCountermove`
- [x] Implement malus updates for failed quiet moves
- [x] Add countermove table and integrate ordering bonus
- [x] Add tests for history saturation/reset behavior
- [x] Benchmark ordering quality impact

Acceptance:

- [x] Improved ordering metrics with no tactical regression
  - B2 benchmark: Avg depth `3.50 -> 4.46` (+27.38%), tactical smoke `4/4 -> 4/4` (no regression)

Evidence:

- PR/commit: WIP (not committed yet)
- Test output summary:
  - `npm test` pass, `npm run lint` pass (B2 helper+integration tests added)
  - Benchmark report: `research/phaseB2-benchmark-2026-03-03.md` (phaseA+B1 vs phaseA+B1+B2)

---

## 3) Phase C - Evaluation Architecture Upgrade

## C1. Tapered Eval (Must-have)

- [x] Add feature flag: `enableTaperedEval`
- [x] Split evaluator into MG/EG components
- [x] Add phase computation (N/B=1, R=2, Q=4; max=24)
- [x] Replace hard MG/EG switch with interpolation
- [x] Add continuity tests across material transitions

Acceptance:

- [x] No abrupt score jumps on controlled trade sequences
  - Added C1 continuity test: tapered jump < legacy jump across MG/EG boundary pair
- [x] Endgame behavior remains sensible
  - Existing endgame king-centralization test remains green after C1 refactor

Evidence:

- PR/commit: WIP (not committed yet)
- Test output summary: `npm test` pass, `npm run lint` pass (eval split + C1 tests added)

## C2. Positional Terms (One by One)

### C2.1 Nonlinear King Safety
- [x] Implement
- [x] Test
- [x] Benchmark
  - C2.1 benchmark: tactical smoke `4/4 -> 4/4` (neutral), avg depth `3.11 -> 3.50` (+12.50%)

### C2.2 Backward Pawn
- [x] Implement
- [x] Test
- [x] Benchmark
  - C2.2 benchmark: tactical smoke `4/4 -> 4/4` (neutral), avg depth `3.11 -> 3.94` (+26.79%), qNode ratio `0.8549 -> 0.6359` (-25.62%)

### C2.3 Knight Outpost
- [x] Implement
- [x] Test
- [x] Benchmark
  - C2.3 benchmark: tactical smoke `4/4 -> 4/4` (neutral), avg depth `2.56 -> 3.78` (+47.83%), qNode ratio `0.9680 -> 0.5698` (-41.14%)

### C2.4 Passed Pawn King-Distance
- [x] Implement
- [x] Test
- [x] Benchmark
  - C2.4 benchmark: tactical smoke `4/4 -> 4/4` (neutral), avg depth `2.78 -> 3.83` (+38.00%), qNode ratio `0.8374 -> 0.7332` (-12.44%)

### C2.5 Rook Behind Passed Pawn
- [x] Implement
- [x] Test
- [x] Benchmark
  - C2.5 benchmark: tactical smoke `4/4 -> 4/4` (neutral), avg depth `2.89 -> 3.17` (+9.62%), qNode ratio `0.8276 -> 0.6308` (-23.78%), avg ms `3082.83 -> 1759.97` (-42.91%)

### C2.6 Tempo Bonus
- [x] Implement
- [x] Test
- [x] Benchmark
  - C2.6 benchmark: tactical smoke `4/4 -> 4/4` (neutral), avg depth `2.94 -> 3.44` (+16.98%), qNode ratio `0.8137 -> 0.5784` (-28.92%), avg ms `2774.00 -> 1183.37` (-57.34%)

Acceptance (for each sub-item):

- [ ] Positive or neutral tactical/mini-match result vs baseline

Evidence:

- PR/commit:
- Test output summary: `npm test` pass, `npm run lint` pass, benchmark reports `research/phaseC22-benchmark-2026-03-03.md`, `research/phaseC23-benchmark-2026-03-03.md`, `research/phaseC24-benchmark-2026-03-03.md`, `research/phaseC25-benchmark-2026-03-03.md`, `research/phaseC26-benchmark-2026-03-03.md`

---

## 4) Phase D - Optional Expert Backend (WASM Stockfish)

## D1. EngineAdapter Abstraction

- [ ] Create `EngineAdapter` interface
- [ ] Implement `TsEngineAdapter` wrapper for current engine
- [ ] Integrate adapter selection in worker runtime
- [ ] Keep existing behavior unchanged when backend flag is off

Acceptance:

- [ ] No UI behavior regression in current TS path

Evidence:

- PR/commit:
- Test output summary:

## D2. StockfishWasmAdapter

- [ ] Add wasm backend package and loader
- [ ] Implement UCI init/config pipeline
- [ ] Map difficulty to UCI options
- [ ] Add timeout and fallback to TS engine
- [ ] Add worker-level error handling and telemetry

Acceptance:

- [ ] Expert mode stronger while latency remains within target
- [ ] Fallback path works reliably

Evidence:

- PR/commit:
- Test output summary:

---

## 5) Validation Gates (Must Pass Before Merge)

- [ ] Unit tests all pass
  - Command: `npm test`
  - Result:
- [ ] Tactical suite pass/fail recorded
  - Result:
- [ ] Mini-match baseline vs candidate recorded
  - Result:
- [ ] Latency report recorded (median/p95)
  - Result:
- [ ] Rollback plan documented for this PR
  - Location:

---

## 6) Release Readiness

- [ ] Feature flags default values reviewed
- [ ] Risky flags default off unless proven stable
- [ ] Changelog/session handoff updated
- [ ] Open questions tracked for next session

---

## 7) Progress Dashboard

- [ ] Phase A complete
- [ ] Phase B complete
- [ ] Phase C complete
- [ ] Phase D complete

Current focus:

- Active phase:
- Active item:
- Owner/session:

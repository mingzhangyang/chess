# Chess AI Expert Upgrade Checklist

Updated: 2026-03-03  
How to use:

- Mark each item with `[x]` when done.
- Do not check an item unless its acceptance criteria and evidence are filled.
- One PR/session should usually complete only a small set of items.

---

## 0) Project Setup

- [ ] Define baseline branch/commit for comparisons
  - Baseline commit:
  - Candidate branch:
- [ ] Confirm benchmark environment is fixed (same machine/config)
  - CPU info:
  - Browser/Node version:
- [ ] Confirm current test command passes
  - Command: `npm test`
  - Result:
- [ ] Create/update progress log for this phase
  - Log file: `research/session-handoff-template.md` or session-specific note

---

## 1) Phase A - Search Safety Pack

## A1. NMP Static-Eval Guard

- [ ] Add feature flag: `enableNmpStaticGuard`
- [ ] Implement guard before null-move branch
- [ ] Add unit tests: guard triggers and non-triggers
- [ ] Verify no regression on check/zugzwang-sensitive FENs
- [ ] Record metrics (before/after):
  - Nodes:
  - Avg depth:
  - Think time:

Acceptance:

- [ ] Tactical suite unchanged or improved
- [ ] No illegal-move or crash regression

Evidence:

- PR/commit:
- Test output summary:

## A2. Quiescence Delta Pruning

- [ ] Add feature flag: `enableQDelta`
- [ ] Implement delta pruning in non-check q-nodes
- [ ] Keep promotions/check-evasion behavior safe
- [ ] Add targeted q-search tests (must not prune critical captures)
- [ ] Record q-node ratio before/after

Acceptance:

- [ ] q-node count reduced
- [ ] Tactical suite unchanged or improved

Evidence:

- PR/commit:
- Test output summary:

## A3. Reverse Futility Pruning (RFP)

- [ ] Add feature flag: `enableRfp`
- [ ] Implement conservative RFP margins by depth
- [ ] Restrict to non-PV + non-check + shallow depth nodes
- [ ] Add tests for "must not prune" tactical cases
- [ ] Benchmark node/time impact

Acceptance:

- [ ] Node reduction with no tactical regressions

Evidence:

- PR/commit:
- Test output summary:

## A4. Futility Pruning + LMP

- [ ] Add feature flags: `enableFp`, `enableLmp`
- [ ] Implement FP with depth-based margins
- [ ] Implement LMP for late quiet moves only
- [ ] Guard conditions: non-PV, non-check, shallow depth, quiet only
- [ ] Add tests for pruning boundaries and safety

Acceptance:

- [ ] Speedup at equal/acceptable tactical quality

Evidence:

- PR/commit:
- Test output summary:

---

## 2) Phase B - Move Ordering Quality Pack

## B1. LMR Formula Upgrade

- [ ] Add feature flag: `enableLmrTable`
- [ ] Add reduction table based on depth + move index
- [ ] Integrate correction terms (history/killer/improving)
- [ ] Keep re-search logic correct for fail-high/fail-low paths
- [ ] Add tests for LMR boundary behavior

Acceptance:

- [ ] Stable PV quality and stronger depth profile under same time budget

Evidence:

- PR/commit:
- Test output summary:

## B2. History Malus + Countermove

- [ ] Add feature flags: `enableHistoryMalus`, `enableCountermove`
- [ ] Implement malus updates for failed quiet moves
- [ ] Add countermove table and integrate ordering bonus
- [ ] Add tests for history saturation/reset behavior
- [ ] Benchmark ordering quality impact

Acceptance:

- [ ] Improved ordering metrics with no tactical regression

Evidence:

- PR/commit:
- Test output summary:

---

## 3) Phase C - Evaluation Architecture Upgrade

## C1. Tapered Eval (Must-have)

- [ ] Add feature flag: `enableTaperedEval`
- [ ] Split evaluator into MG/EG components
- [ ] Add phase computation (N/B=1, R=2, Q=4; max=24)
- [ ] Replace hard MG/EG switch with interpolation
- [ ] Add continuity tests across material transitions

Acceptance:

- [ ] No abrupt score jumps on controlled trade sequences
- [ ] Endgame behavior remains sensible

Evidence:

- PR/commit:
- Test output summary:

## C2. Positional Terms (One by One)

### C2.1 Nonlinear King Safety
- [ ] Implement
- [ ] Test
- [ ] Benchmark

### C2.2 Backward Pawn
- [ ] Implement
- [ ] Test
- [ ] Benchmark

### C2.3 Knight Outpost
- [ ] Implement
- [ ] Test
- [ ] Benchmark

### C2.4 Passed Pawn King-Distance
- [ ] Implement
- [ ] Test
- [ ] Benchmark

### C2.5 Rook Behind Passed Pawn
- [ ] Implement
- [ ] Test
- [ ] Benchmark

### C2.6 Tempo Bonus
- [ ] Implement
- [ ] Test
- [ ] Benchmark

Acceptance (for each sub-item):

- [ ] Positive or neutral tactical/mini-match result vs baseline

Evidence:

- PR/commit:
- Test output summary:

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

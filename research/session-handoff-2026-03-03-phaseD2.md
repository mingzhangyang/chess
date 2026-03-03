# Session Handoff - 2026-03-03 (Phase D2)

## Completed

- Added `StockfishWasmAdapter` integration path and runtime fallback telemetry.
- Added Node benchmark scripts for adapter latency and head-to-head quantification:
  - `research/scripts/phaseD2-engine-compare.ts`
  - `research/scripts/phaseD2-headtohead.ts`
- Ran large-sample head-to-head baseline (`96` games) with fixed params.

## Evidence

- Unit tests: `npm test` pass (`21/21`, 2026-03-03).
- Tactical smoke parity: `4/4` vs `4/4`.
- Head-to-head quant report:
  - `research/phaseD2-headtohead-2026-03-03.md`
  - Result: stockfish score `53.65%` (W/D/L `10/83/3`), Elo `+25.4`, 95% CI `[-44.2, 97.1]`.
- Latency report:
  - `research/phaseD2-engine-compare-2026-03-03.md`

## Config Review

- Default policy now enables validated heuristics, while keeping unresolved `RFP` off:
  - `src/utils/chess-ai/chessAITuning.ts`
  - default ON: `enableNmpStaticGuard`, `enableQDelta`, `enableFp`, `enableLmp`, `enableLmrTable`, `enableHistoryMalus`, `enableCountermove`, `enableTaperedEval`, `enableNonlinearKingSafety`, `enableBackwardPawn`, `enableKnightOutpost`, `enablePassedPawnKingDistance`, `enableRookBehindPassedPawn`, `enableTempoBonus`
- default OFF: `enableRfp`
- UI compute requests now route backend by difficulty:
  - `expert` posts `compute-best-move` with `backend: 'stockfish-wasm'`
  - `easy/medium/hard` continue with `backend: 'ts'`
  - stockfish path uses single-worker compute to avoid duplicate parallel stockfish searches.

## Rollback Plan

If production issues appear after enabling wasm backend or advanced flags:

1. Force TS backend only at request source (`SinglePlayerRoom`) by omitting backend selection and keeping runtime default (`ts`).
2. Keep all risky AI heuristics OFF by resetting to `DEFAULT_AI_TUNING`.
3. If needed, remove wasm adapter use path by resolving backend to `ts` in `src/workers/aiWorkerRuntime.ts`.
4. If severe packaging/runtime regression appears, revert files introduced in D1/D2 and remove `stockfish.wasm` dependency.

## Open Questions (Next Session)

1. Should expert difficulty switch to `stockfish-wasm` by default, or stay opt-in behind a runtime capability gate?
2. Do we require CI not crossing `0` (e.g., 192+ games) before claiming "expert stronger" in product copy?
3. What telemetry sink/retention policy should be used for `backend-init-fallback` and `backend-compute-fallback` events?
4. Should move-time budgets be rebalanced (`TS` currently averaging far above nominal budget in this benchmark harness)?

## Next

- Decision pass on unresolved checklist acceptance items:
  - A3 node-reduction acceptance criterion.
  - C2 aggregated tactical/mini-match acceptance criterion.

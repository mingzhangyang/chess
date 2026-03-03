# Proposed Expert-Level Architecture (Design Only)

## Goal

Reach practical "expert" quality in human-vs-AI mode with controllable latency on web/mobile, while preserving current UX and worker-based architecture.

## Recommended Strategy: Dual-Engine

## Engine A (Primary): WASM Stockfish backend

- Use browser-compatible Stockfish WASM (`stockfish.js`) as the main expert path.
- Map difficulty to UCI controls:
  - beginner/intermediate: `Skill Level`, `UCI_Elo`
  - hard/expert: higher movetime + stronger skill settings
- Add deterministic time governance:
  - fixed minimum think time
  - per-move budget + move overhead
  - hard timeout guard in worker

Why this is the fastest path:

- Immediate jump to modern NNUE-level play strength.
- Avoids reimplementing years of search/eval optimizations.

## Engine B (Fallback): Keep and evolve current TS engine

Retain current engine for:

- low-end devices,
- restricted browser environments,
- offline-lite mode,
- pedagogical / custom-style modes.

Upgrade path for this fallback engine:

1. Representation/runtime:
- Replace FEN-string TT keying with incremental Zobrist.
- Reduce `chess.js` hot-path overhead where feasible.

2. Evaluation:
- Add compact NNUE-lite or distilled value head (quantized small model).
- Keep current handcrafted terms as explainable fallback.

3. Search:
- Add missing modern heuristics selectively (not all at once).
- Keep strict regression gates (SPRT style) for each change.

## Endgame and Opening Stack

1. Endgame:
- Add tablebase probing path for low-piece-count positions.
- If full tablebases are too large for browser, keep cloud-assisted option and local mini subset.

2. Opening:
- Replace static hand-curated lines with:
  - weighted opening dataset,
  - diversity controls by difficulty,
  - anti-repetition policy (already partially present).

## Validation Pipeline (Required)

1. Tactical/strategic test suite in CI
- fixed-position suites (mates, tactics, endgames).

2. Engine-vs-engine benchmark harness
- baseline: current main branch engine.
- candidate: patch branch.
- collect win/draw/loss and mean depth/time.

3. SPRT-style accept/reject gate
- no merge for "strength" changes without statistical evidence.

## Creative Proposal: Adaptive Hybrid Controller (AHC)

Instead of one fixed search style for all positions:

- Fast classifier computes position volatility and strategic uncertainty.
- Controller dynamically picks one mode:
  - tactical mode: deeper alpha-beta
  - strategic mode: NN-guided move prior
  - endgame mode: tablebase-first
- Time budget is allocated by uncertainty, not only by difficulty label.

Expected benefit:

- Better strength-per-millisecond than uniform search depth.
- More human-like "critical position thinking".

## Phased Execution

1. Phase 1 (fastest strength gain)
- Integrate WASM Stockfish path behind an `EngineAdapter`.
- Keep current engine as fallback.

2. Phase 2 (quality and consistency)
- Add difficulty calibration matrix and regression harness.
- Add opening/endgame data modules.

3. Phase 3 (original innovation)
- Prototype Adaptive Hybrid Controller.
- A/B test against fixed engine policy.

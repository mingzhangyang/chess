# Chess AI Expert Upgrade Playbook (Detailed)

Updated: 2026-03-03  
Scope: design and execution blueprint only (no gameplay code changes in this document)

## 1. Document Purpose

This file is the canonical cross-session plan for upgrading current single-player AI toward a stable "expert" level.

It answers:

- what "expert" means in measurable terms,
- what to change first (and what to delay),
- where to modify in current code,
- how to verify each step safely,
- how to hand off progress across sessions without losing context.

## 2. Baseline: Current Engine Capability

Current implementation already includes many strong search techniques:

- Opening line + opening book:
  - `src/utils/chessAI.ts:49`
  - `src/utils/chessAI.ts:122`
- Typed-array transposition table (SAB capable):
  - `src/utils/chessAI.ts:587`
  - `src/utils/chessAI.ts:682`
- Quiescence, ordering, killer/history:
  - `src/utils/chessAI.ts:850`
  - `src/utils/chessAI.ts:917`
  - `src/utils/chessAI.ts:954`
- Null move pruning + PVS + LMR:
  - `src/utils/chessAI.ts:1026`
  - `src/utils/chessAI.ts:1058`
- Iterative deepening + aspiration:
  - `src/utils/chessAI.ts:1478`
- Multi-worker first-response strategy:
  - `src/components/SinglePlayerRoom.tsx:162`
  - `src/components/SinglePlayerRoom.tsx:252`

Main structural limits:

1. Evaluation quality ceiling (handcrafted eval only; no NNUE-like model).  
2. Hard MG/EG switching logic still present (needs tapered eval).  
3. JS/chess.js throughput and FEN-string TT key path limit deep search efficiency.  
4. No exact endgame tablebase route.  

## 3. Target Definition (What Counts as "Expert")

Use explicit metrics to avoid subjective "feels stronger":

1. Latency
- `hard`: median think time <= 1.8s
- `expert`: median think time <= 3.5s
- p95 not exceeding 2x median

2. Tactical reliability
- >= 90% solve rate on internal mate-in-2/mate-in-3 + tactical motif set

3. Blunder suppression
- vs baseline engine, expert mode reduces severe tactical blunders (>= 250cp loss) by >= 30%

4. Stability
- No increase in illegal move rate, freeze rate, or worker race regressions

5. Regression gate
- Each search/eval patch must pass fixed-suite + mini-match gate before merge

## 4. Prioritized Roadmap

## Phase A (Search Safety Pack, highest ROI first)

Goal: gain strength fast with controlled risk.

### A1. NMP static-eval guard

Problem:
- Null move attempted too often in positions unlikely to fail-high.

Plan:
- Add `staticEval >= beta - margin` precondition before null move branch.
- Keep existing checks: non-check, depth threshold, endgame/zugzwang guards.

Likely edit area:
- `src/utils/chessAI.ts` near null-move block (`~1126+`).

Acceptance:
- Node count decreases in middlegame benchmarks.
- No tactical collapse in zugzwang-like test FENs.

### A2. Quiescence delta pruning

Problem:
- QSearch explores low-value captures that cannot improve alpha.

Plan:
- At non-check q-nodes, skip captures where `standPat + gain + delta < alpha`.
- Keep promotions/check evasions exempt.

Likely edit area:
- `quiescence()` in `src/utils/chessAI.ts` (`~850+`).

Acceptance:
- q-node count down; tactical suite unchanged or improved.

### A3. Reverse futility pruning (RFP)

Problem:
- Some shallow nodes are clearly above beta from static eval.

Plan:
- At shallow non-PV, non-check nodes:
  - if `staticEval - margin(depth) >= beta`, return `staticEval`/beta-bound.

Likely edit area:
- `minimax()` early stage before deep search loops.

Acceptance:
- Fewer nodes at shallow horizons.
- No new tactical misses on forcing lines.

### A4. Futility pruning + LMP (late move pruning)

Problem:
- Low-impact quiet moves searched too deep in late move order.

Plan:
- Non-PV + shallow depth + non-check + quiet late moves:
  - Futility: skip if `staticEval + futilityMargin(depth) <= alpha`.
  - LMP: for late quiets after move-index threshold, prune directly.

Likely edit area:
- Move loop inside `minimax()` (max and min branches).

Acceptance:
- Speedup with neutral or positive tactical outcome.

## Phase B (Move Ordering Quality Pack)

Goal: increase effective depth by improving ordering quality.

### B1. LMR formula upgrade

Problem:
- Current LMR is coarse (`depth-2` or `depth-1` style); reduction not calibrated by depth+moveCount.

Plan:
- Precompute reduction table `R[depth][moveIndex]` (log-like growth).
- Add correction terms:
  - smaller reduction for improving/history-strong/killer moves,
  - larger reduction for quiet late moves.

Likely edit area:
- `canLMR/lmrDepth` logic around `~1158` and `~1196`.

Acceptance:
- More stable principal variation.
- Same latency budget reaches stronger depth profile.

### B2. History malus + countermove heuristic

Problem:
- History only rewards beta cutoffs; no penalty for quiet failures.

Plan:
- Apply malus updates for searched quiets that fail to improve.
- Add countermove table keyed by opponent move -> best known reply.

Likely edit area:
- History table section near `~984+`, move ordering score composition.

Acceptance:
- Better ordering in non-tactical middlegames.

## Phase C (Evaluation Architecture Upgrade)

Goal: remove discontinuity and improve positional understanding.

### C1. Tapered evaluation (must-do)

Problem:
- Hard binary endgame switch causes score discontinuity.

Plan:
- Split eval into MG and EG components:
  - `score = (mg * phase + eg * (maxPhase - phase)) / maxPhase`
- Phase from piece inventory (typical weights):
  - N/B=1, R=2, Q=4 (total max 24)

Likely edit area:
- `evaluateBoard()` path currently tied to `isEndgame`.

Acceptance:
- Smoother score transitions in material-trade sequences.
- Endgame centralization behavior preserved without abrupt jumps.

### C2. Add high-value positional terms incrementally

Priority order:
1. Nonlinear king safety aggregation
2. Backward pawn
3. Knight outpost
4. Passed pawn king-distance correction
5. Rook behind passed pawn
6. Tempo bonus

Rule:
- Add one term at a time with isolated tests and A/B matches.

## Phase D (Optional High-Ceiling Backend)

Goal: provide true expert mode ceiling with lower algorithm risk.

### D1. EngineAdapter abstraction

Introduce interface:

```ts
interface EngineAdapter {
  init(): Promise<void>;
  computeBestMove(input: {
    fen: string;
    difficulty: string;
    timeLimitMs?: number;
    tuning?: object;
  }): Promise<string | null>;
  dispose(): void;
}
```

Implementations:

- `TsEngineAdapter` (current engine)
- `StockfishWasmAdapter` (optional expert backend)

### D2. Difficulty calibration table

Example mapping:

- `easy`: TS engine only, high randomness
- `medium`: TS engine with moderate time
- `hard`: TS engine tuned strong OR stockfish limited skill
- `expert`: stockfish wasm, higher movetime, low randomness

### D3. Runtime fallback policy

If WASM unavailable / isolation missing / init timeout:

- auto-fallback to TS engine,
- keep UI responsive,
- record telemetry event for diagnosis.

### D4. Baseline quant protocol (2026-03-03)

Repro command:

- `H2H_MOVE_MS=120 H2H_MAX_PLIES=50 H2H_OPENING_LIMIT=6 H2H_ROUNDS_PER_OPENING=8 node --import tsx research/scripts/phaseD2-headtohead.ts`

Current baseline result (stockfish.wasm vs TS):

- `96` games, W/D/L=`10/83/3`
- stockfish score=`53.65%`
- Elo estimate (stockfish - TS)=`+25.4`
- 95% CI=`[-44.2, 97.1]`
- avg move time: stockfish=`132.50ms`, TS=`1174.20ms`

Interpretation:

- Strength signal is positive for stockfish, and CI is narrower than small-sample runs; however CI still crosses 0, so this is not yet release-grade significance.
- Next quant iteration should increase sample size and opening coverage.

## 5. Test Strategy and Gates

## 5.1 Unit tests (must expand)

Add focused tests for each heuristic:

- NMP guard trigger/non-trigger cases
- delta pruning skip correctness
- RFP/FP/LMP no-prune in check/PV nodes
- tapered eval continuity tests

Location:
- `tests/client/chessAI.test.ts`

## 5.2 Fixed tactical suite

Maintain `research/testsets/` (to be created in implementation phase):

- `mates.epd`
- `tactics.epd`
- `endgames.epd`

Each patch must report:

- solved/total
- avg time
- worst missed motif class

## 5.3 Head-to-head mini-match gate

Before merging strength patches:

- baseline vs candidate, fixed seeds, mirrored colors.
- require non-negative result plus no tactical regression.

## 5.4 Performance telemetry

Track:

- nodes searched
- depth reached
- q-node ratio
- TT hit rate
- think time (median/p95)

## 6. Rollout Safety and Feature Flags

Every risky heuristic behind toggles in `AiTuning`:

- `enableRfp`
- `enableFp`
- `enableLmp`
- `enableQDelta`
- `enableLmrTable`
- `enableHistoryMalus`
- `enableCountermove`
- `enableTaperedEval`

Benefits:

- quick rollback,
- A/B testing,
- easier bisect in production incidents.

## 7. Risks and Mitigations

1. Over-pruning tactical blindness  
Mitigation: strict node guards + tactical gate mandatory.

2. Elo overfitting to one suite  
Mitigation: diversified test sets (tactics + strategy + endgame).

3. Latency spikes in browser  
Mitigation: hard deadline enforcement + p95 monitoring + fallback.

4. Cross-worker nondeterminism  
Mitigation: seed controls where possible; deterministic match harness.

5. Complexity creep  
Mitigation: one heuristic per PR, each with measurable acceptance.

## 8. Session Handoff Protocol

At end of each implementation session, append to this playbook (or companion changelog):

1. `Completed`:
- exact heuristic(s) added
- file paths + function names

2. `Evidence`:
- test cases added
- benchmark deltas

3. `Config`:
- default values
- new tuning flags

4. `Decision`:
- kept / reverted / needs retune

5. `Next`:
- next smallest safe step

## 9. Immediate Next Action (when implementation starts)

Execute in this order:

1. Add feature flags (no behavior change default off).  
2. Implement `A1 NMP static guard` + tests.  
3. Implement `A2 q-delta pruning` + tests.  
4. Run mini benchmark and decide keep/revert.  

Only then proceed to A3/A4.

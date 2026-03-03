# Assessment of Claude Research Report

Date: 2026-03-03

This note evaluates the report you provided and maps it to an implementation-safe roadmap.

## Overall Verdict

The report direction is mostly correct, especially:

- prioritize search-side pruning/ordering upgrades first,
- then fix evaluation architecture (tapered eval),
- postpone custom NNUE-in-TS as non-first-priority.

But two caveats are critical:

1. Reported Elo gains should be treated as rough heuristics, not additive guarantees.  
2. Stockfish formulas cannot be copied blindly into this engine; they depend on very different move ordering, evaluation scale, and board representation.

## What I Agree With (High Confidence)

1. Add tapered evaluation first among eval changes.
- Current engine still uses hard endgame switch.
- Smooth MG/EG interpolation is a real structural upgrade.

2. Add more selective pruning, but with strict guards.
- RFP, FP, LMP, delta pruning are standard and likely beneficial.
- Must be constrained by: non-check nodes, non-PV nodes, sufficient depth, and tactical safety.

3. Improve LMR policy.
- Current fixed reduction is coarse.
- Depth-and-move-count-based reduction is stronger than fixed `-1`.

4. Add NMP static guard.
- `staticEval >= beta`-style guard usually avoids pointless null-move attempts.

5. NNUE in pure TS is not the first milestone.
- For web production, WASM Stockfish path is much lower risk for large strength jump.

## What Needs Caution

1. Elo numbers in the table.
- Useful for prioritization only.
- Not transferable one-to-one to this codebase.

2. “5 lines / 10 lines” complexity claims.
- True only for minimal insertion, not for stable production behavior.
- Real cost is in guards + regression testing + tuning.

3. LMR formula exact constants.
- Constants like `0.77` / `2.36` are engine-specific tuning outputs.
- We should adopt a parametric formula and tune in our own environment.

## Recommended Adoption Order (Adjusted)

Phase A: Safe search upgrades (first)
- NMP static guard
- QSearch delta pruning
- Basic RFP/FP with conservative thresholds
- LMP (late quiet pruning) with strict non-PV/non-check constraints

Phase B: Move-order quality
- LMR formula upgrade (depth+moveCount table)
- History malus + countermove history

Phase C: Evaluation architecture
- Tapered eval (MG/EG split + phase interpolation)
- then add backward pawn/outpost/rook-behind-passed-pawn terms

Phase D: Engine-level jump
- WASM Stockfish adapter as optional expert backend

## Acceptance Rule (Important)

For each micro-change, require:

- tactical regression set pass,
- no obvious blunder increase in fixed test suites,
- head-to-head mini-match vs baseline before merge.

Without this gate, pruning changes can increase tactical blindness even when nodes go down.

# Independent TypeScript search: phase 9, exact speedups

[Phase 8](search-position-phase8.md) put the kernel behind a default-off
switch. Against Stockfish at 300 ms per move it plays at about Skill 5
strength. This phase is the first of three groups of improvements proposed
afterwards: changes that make the kernel faster **without changing what it
searches**. Algorithmic changes that alter the tree (symmetric pruning, SEE,
keeping the table across moves, better history heuristics) are the second
group and need a match gate instead.

The production default, Stockfish routing, the shared search modules, the
reference evaluator and the reference generator are unchanged.

## Gate: golden search trees

`tests/client/kernelGolden.test.ts`, written before any change, pins the
tree as it stood. Its 32 cases run `runKernelSearch` to a fixed depth with no
deadlines:

- start, ply 40 and ply 80 with history;
- perft-style special positions (castling, en passant, promotions);
- endgames, a mate, and a repetition history;
- eight seeded random-game positions;
- five evaluation and pruning tuning variants.

Every root move's score and the node, quiescence, null-move and pruning
counters must equal `fixtures/kernelGolden.json`. That is about 0.9 million
visits in 3 s. `research/scripts/kernel-golden-fixture.ts` regenerates the
fixture; a change meant to alter the tree must say so. The existing
generation-order, perft, staged-generation, incremental-term and evaluator
tests all pass unchanged.

## Changes

1. **Slider bitboards and pre-checks.** `SearchPosition` now keeps, per
   side, a bitboard of diagonal sliders (bishops and queens) and one of
   orthogonal sliders (rooks and queens). These are updated in `setSquare`
   and saved in the undo frame. The attack test, the king-move test (with
   the king's square vacated), check detection and pin detection now skip
   any ray that holds no enemy slider of its kind, since scanning it could
   not find one. The attack tests first check the union of all four rays of
   a kind, and the adjacent-king test moved out of the ray loop.
2. **Bitboard mobility and king zone.**
   - `kernelMobility` counts a piece's mobility from the occupancy
     bitboards: the nearest blocker on each ray by bit scan, plus the ray
     length or the Chebyshev distance to the blocker, and a knight by
     popcount.
   - `kernelKingSafety` finds the enemy knights, bishops, rooks and queens
     in the 5×5 king zone from the officer bitboard instead of reading 25
     squares.
   - Both are tested equal to the shared `pseudoMobility` and
     `evaluateKingSafety`. The kernel copies their constants, since the
     shared module does not export them, and a test catches any drift.
3. **One table key per node.** The history-aware TT key costs eight `mix32`
   calls per 32-bit word. The kernel now computes it once per node for both
   probe and store (`probeKey` and `storeKey`).

Tests written first (`bitboardAttacks.test.ts` and additions to existing
files):

- attack tests against a naive board scan on every square and both sides of
  about 1,000 positions (more than 100,000 checks);
- the slider bitboards against the board;
- mobility of every piece and king safety of both kings (with the nonlinear
  term on and off) against the shared functions;
- slider and occupancy bitboards in the incremental make/undo test;
- key-based table access against position-based.

## Measurements

Same-run comparison against the commit before this phase (`c2dea07`), in a
worktree. Fixed-depth searches alternate old and new over 9 rounds (medians);
400 ms searches alternate over 8 rounds. Node 22, this 4-CPU container. The
trees are identical, so visits are the same in both columns.

| Search | Visits | Before | After | Speedup |
| --- | ---: | ---: | ---: | ---: |
| Ply 40, depth 5 | 42,397 | 78 ms | 73 ms | 1.06× |
| Ply 40, depth 6 | 116,480 | 216 ms | 177 ms | 1.22× |
| Ply 40, depth 7 | 188,105 | 306 ms | 280 ms | 1.10× |
| Ply 80, depth 9 | 49,032 | 84 ms | 65 ms | 1.30× |
| Ply 80, depth 10 | 100,556 | 162 ms | 123 ms | 1.32× |
| Ply 80, depth 12 | 402,127 | 590 ms | 464 ms | 1.27× |
| 400 ms searches, median visits/s | | 622,743 | 812,133 | **1.30×** |

Noise between runs on this container is about ±10%; in an earlier run the
ply-80 depth-10 ratio came out at 1.06× and at 1.28×. Fixed-depth times
include the per-search setup, which weighs most in short searches.

Profile (`search-position-kernel-profile.ts`, sixteen 400 ms searches, with
the profiler attached): 554k visits/s before, 718k after.

| Self time | Before | After |
| --- | ---: | ---: |
| Evaluation | 27.2% | 20.2% |
| Move generation and legality | 33.8% | 33.5% |
| Search bodies and ordering (now including the inlined table probe) | 11.6% | 13.3% |
| Make/undo and repetition | 10.8% | 13.6% |
| Transposition table (store, now listed under "other") | 9.0% | about 4% |

The shares rose where the absolute time did not change, because the total
fell.

## What is left, and why this group stops here

The gain, about 1.3×, is at the low end of the 1.3–2× estimated beforehand.
The remaining time is spread out, and exact refactors reach little of it:

- **Generation (a third):** mostly writing each legal move in the frozen
  order. The tree depends on that order.
- **Evaluation (a fifth):** the per-piece loop itself.
- **Make/undo:** mostly required bookkeeping, namely the incremental
  evaluation terms and the repetition stack's 64-byte board copy, which
  keeps repetition detection exact. Shrinking the undo frame would save at
  most about 2%.
- **Table stores:** cache misses on a 16 MiB table. A smaller table would
  change which entries survive, and with them the tree.

A larger exact gain needs a structural rewrite: generation fully from
bitboards with precomputed attack tables, and copy-make state. That is a
project of its own, at the same risk level as the second group.

## Next steps

- Second group: changes that alter the tree. First build a match gate, a
  sequential probability ratio test (SPRT) of the new kernel against the
  previous one at fixed time, extending `kernel-match.ts`. Then apply one
  change at a time:
  - symmetric (negamax) null-move and delta pruning;
  - SEE in quiescence and in ordering;
  - keeping the table across moves;
  - continuation and capture history, killers beyond ply 10, and a retuned
    LMR.
- Revisit the structural generator rewrite after the second group, when the
  profile has shifted.

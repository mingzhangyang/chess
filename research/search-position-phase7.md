# Independent TypeScript search: phase 7

This phase gives the new kernel staged move generation, the step that
[phase 6](search-position-phase6.md) left for a separate change because it
alters the search tree. Up to phase 6 the kernel reproduced the frozen
reference node for node. Now it orders moves the reference treats as ties
differently, so its tree differs, and the gate changes accordingly: the kernel must still choose
the reference's move with the reference's score at fixed depths, and the
legacy kernel's at the benchmark depths, while node counts may differ and
are reported. The production worker, default TS search and Stockfish
routing are unchanged. The shared search modules and the reference backend
stay frozen.

## Staged generation

`independent/movePicker.ts` holds one `MovePicker` per search frame. Out of
check it hands out a node's legal moves in stages, generating each group
only when the search reaches it:

1. the transposition-table move, if `legalMoveCode` accepts it;
2. captures and promotions with a non-negative capture score (MVV-LVA with
   the existing defence test), best first;
3. the two killers, then the countermove, when legal and quiet;
4. the remaining quiet moves, by history score;
5. the remaining captures: losing ones, and king captures, which the
   existing score always puts below zero.

In check all evasions are generated at once and ordered by the combined score
the unstaged kernel used. Sorts are stable, so ties keep generation order.
Quiescence is unchanged. To support the stages, `SearchPosition` gained:

- `generateQuietMoveCodes`, the non-tactical moves in generation order (with
  the tactical moves they partition the legal moves);
- `legalMoveCode(key)`, which turns a stored move key (from, to, promotion)
  into its generated code, or 0 when the move is illegal. It generates only
  the moves of that piece to that square.

The first version was slower than phase 6 at ply 80 (−11% visits/s). Each
staged node now made up to six generation calls (TT move, captures, two
killers, countermove, quiets), and each repeated the checker and pin scan.
Checkers, evasion squares and pinned pieces are now bitboards cached per
search depth, together with the in-check answer. A move or null move clears
the slot of the new depth, and undo returns to a slot that still describes
its position. The line of a pinned piece is the direction from the king to
it, so no scratch marks need clearing either.

Staging also makes one exact saving possible. Late-move and futility pruning
of a quiet move depend only on the node, the bounds and the number of moves
searched. None of these change while quiet moves are being skipped, and
losing captures come after the quiets, so once one quiet move is pruned
every later one would be too. `MovePicker.skipQuiets` drops them without
generating them. The tree is the same with and without it (the kernel
test's summed visits are identical); only the pruning counters now count
the first pruned move of a node.

How far the picker gets before a cutoff (one search each, ply 40 at depth 6
and ply 80 at depth 9; "staged" excludes nodes in check):

| | Ply 40 | Ply 80 |
| --- | ---: | ---: |
| Main nodes / of them with a move loop | 37,506 / 6,939 | 32,907 / 14,490 |
| Staged nodes (not in check) | 5,672 | 10,738 |
| Cut off by the TT move, before captures are generated | 12.3% | 24.5% |
| Quiet moves generated | 21.0% | 40.8% |

## Gates

Tests were written before the code.

- `stagedMoveGeneration.test.ts`:
  - Quiet generation equals the non-tactical part of the frozen reference
    generator, in order, on 1,211 positions.
  - On the same positions, `legalMoveCode` gives the generated code, or 0,
    for every key of the side to move's pieces (more than a million keys).
  - The picker's whole sequence equals the documented order, built
    independently from full generation, with legal, illegal, tactical and
    stale TT moves, killers and countermoves and random history, in and out
    of check. Every move comes out exactly once.
  - After `skipQuiets` only the losing captures follow, and quiet moves are
    not generated when skipped before them.
  - Mutations that swap the killers or drop the losing captures fail these
    tests.
- `independentKernel.test.ts`: the node-for-node test is replaced as
  planned. At fixed depths 1, 3 and 5 on its 13 inputs, and for medium and
  hard with a seeded random source, the kernel chooses the reference's move
  with its score. Node counts are printed as test diagnostics. The
  fixed-depth tests against the legacy kernel (depths 1–4 on six inputs,
  ply 40 at depth 6, ply 80 at depth 8) are unchanged and pass.
- The frozen generation-order, perft and chess.js move-set tests pass
  unchanged: staging changes the order in which the search visits moves, not
  what the generator produces.

## Node counts

Visits (main plus quiescence nodes), staged kernel against the tie order of
phase 6, which equals the reference's:

| Search | Phase 6 / reference | Staged | Change |
| --- | ---: | ---: | ---: |
| Kernel test, 13 inputs, depth 1 (sum) | 5,484 | 5,484 | 0.0% |
| Kernel test, 13 inputs, depth 3 (sum) | 52,863 | 52,617 | −0.5% |
| Kernel test, 13 inputs, depth 5 (sum) | 252,792 | 250,926 | −0.7% |
| Ply 40, depth 4 | 32,210 | 32,071 | −0.4% |
| Ply 40, depth 6 | 118,001 | 116,480 | −1.3% |
| Ply 40, depth 7 | 192,553 | 188,105 | −2.3% |
| Ply 80, depth 4 | 2,928 | 2,817 | −3.8% |
| Ply 80, depth 10 | 100,572 | 100,556 | 0.0% |
| Ply 80, depth 12 | 394,227 | 402,127 | +2.0% |

Every one of these searches chose the same move with the same score as
before. The phase 6 kernel already ordered moves by a full sort on almost
the same keys (TT move, then MVV-LVA, killers, countermove and history), so
staging mostly changes ties and the place of losing captures. The trees
therefore stay within a few percent.

## Local benchmark with real history

`node --import tsx research/scripts/search-position-history-benchmark.ts`,
same method as phases 5 and 6. Node v22.23.4, Linux x64, 4 logical CPUs.
Raw data: `results/search-position-history-benchmark.json`.

| Position, 400 ms request | Legacy | Reference | Staged kernel | Staged / reference | Phase 6 run: new / reference |
| --- | ---: | ---: | ---: | ---: | ---: |
| Ply 40 visits/s | 62,343 | 180,511 | 529,036 | 2.9× | 2.8× |
| Ply 40 completed depth | 3 (partial 4) | 5 (partial 6) | 7 in 4 of 5, else 6 | | 7 in 2 of 5 |
| Ply 80 visits/s | 44,041 | 165,469 | 580,016 | 3.5× | 3.1× |
| Ply 80 completed depth | 6 (partial 7) | 9 (partial 10) | 11 | | 11 |

| Position, fixed depth 4 | Legacy | Reference | Staged kernel | Visits, staged / reference | Move (all) |
| --- | ---: | ---: | ---: | ---: | --- |
| Ply 40 | 533 ms | 189 ms | 76 ms | 32,071 / 32,210 | Rg5 (−100) |
| Ply 80 | 61 ms | 40 ms | 32 ms | 2,817 / 2,928 | Kd2 (+1542) |

The 400 ms searches at ply 40 all chose Rg5 (−133), at ply 80 all b5
(a mate score). Noise on this container is about ±10%. The 400 ms visit
rates are 8% (ply 40) and 12% (ply 80) above the phase 6 run, while the
reference moved by +1% and −2%. That is close to the noise and is not by
itself evidence of a gain, because visits per second also shift when the
mix of main and quiescence nodes changes.

A direct comparison is more telling. Here a worktree of the phase 6 commit
(`ecfcb0a`) and this commit alternated in one session, two rounds of five
searches each to a fixed depth (medians):

| Fixed depth | Phase 6 | Staged |
| --- | ---: | ---: |
| Ply 40, depth 5 | 111 / 121 ms | 104 / 105 ms |
| Ply 40, depth 6 | 233 / 226 ms | 226 / 230 ms |
| Ply 40, depth 7 | 392 / 362 ms | 361 / 365 ms |
| Ply 80, depth 8 | 59 / 64 ms | 62 / 62 ms |
| Ply 80, depth 10 | 187 / 190 ms | 186 / 176 ms |
| Ply 80, depth 12 | 683 / 678 ms | 671 / 664 ms |

Time to depth is 0–5% better, within noise. In this kernel, staged generation
is roughly neutral for now:

- Sorting and scoring were already cheap after phase 5 (about 1%).
- Many visits are quiescence nodes, which staging does not touch: two thirds
  of the visits at ply 40 and one third at ply 80.
- The work skipped after early cutoffs is partly paid back by the legality
  checks of stored moves and the extra generation calls.

These are small local samples, not mobile-device, playing-strength or Elo
measurements.

## Where the time goes now

Same method as phase 6: `search-position-kernel-profile.ts` (sixteen 400 ms
searches), bundled with esbuild, `--cpu-prof`, summarised by
`cpu-profile-summary.mjs`. The workload ran at 496,396 visits/s against
482,146 in phase 6 (profiler attached).

| Self time | Phase 6 | Phase 7 |
| --- | ---: | ---: |
| Evaluation | 27.1% | 27.2% |
| Move generation and legality | 34.3% | 33.8% |
| Search bodies and ordering | 12.9% | 10.1% |
| Staged move picker | — | 2.0% |
| Make/undo and repetition | 11.2% | 12.3% |
| Transposition table | 6.6% | 7.3% |
| Search setup (chess.js boundary, allocation) | 3.9% | 3.9% |
| Garbage collection | 2.4% | 2.5% |
| Draw detection | 1.1% | 0.1% |
| Insertion sort | 0.3% | 0.6% |

The largest functions are still the evaluator body (16%), `generateFrom`
(11%), king safety (8%), `generateMoveCodes` (7%) and the king-move attack
test (6%). Shifts of a point or two between "search bodies" and small
helpers such as the draw test reflect V8 inlining, not real changes.

## Next steps

- Quiescence dominates the visits. It still generates and sorts every
  capture up front, and losing captures could be skipped there with a static
  exchange evaluation (which changes results and needs its own gate).
- A static exchange evaluation would also classify good and bad captures
  better than the geometric defence test.
- The phase 6 cost items remain: king safety's zone scan, king-move attack
  tests, and the size of the undo frame.
- The phase 3 gate before any default switch still applies: application and
  engine adjudication must agree (the pinned en-passant threefold case), the
  worker and fallback paths need end-to-end and cancellation tests, and the
  switch needs browser and mobile profiling and a match sample.
- [Phase 8](search-position-phase8.md) works through that gate: draw
  adjudication, the incomplete-history policy, the worker integration behind
  a default-off switch, browser profiling and a match sample.

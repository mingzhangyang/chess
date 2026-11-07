# Independent TypeScript search: phase 10, search changes behind match gates

[Phase 9](search-position-phase9.md) made the kernel about 1.3× faster
without changing its tree. This phase changes the search itself: each
change is a `KernelFeatures` flag, and matches decided whether it stays.

**Result: the kernel with the adopted features is +139 Elo [+63, +215] stronger
than before this phase** (SPRT accepted after 92 games, 100 ms per move).
Against Stockfish see [the ladder below](#against-stockfish-again).

The kernel is still behind the default-off switch from phase 8. The
production default search, Stockfish routing, the shared search modules, the
reference backend and the frozen reference evaluator and generator are
unchanged.

## The gate

`research/scripts/kernel-sprt.ts` plays the working tree's kernel against a
baseline kernel from a git worktree of a frozen commit. Both go through the
production path (`TsEngineAdapter` with `tsSearchKernel`, `expert`, book off,
100 ms per move), each in its own module graph, so they share no state.

- **Openings:** 300 balanced positions, each played with both colors. They
  are the book lines of three or more plies plus seeded two-ply extensions,
  kept when a depth-4 score is within 0.8 pawns.
- **Adjudication:** the application's rules from phase 8, or a draw at
  400 plies.
- **Statistics:** trinomial GSPRT for H0 = 0 Elo against H1 = +25 Elo, with
  alpha = beta = 0.05, so the bounds are ±2.94. The cap is 600 games;
  `--max-games` stops earlier for an estimate instead of a verdict.
- **Feature sets:** `--new-features` and `--base-features` override either
  side's feature set through `setKernelFeaturesForTesting` in the worker's
  kernel stage.

A self-play sanity run (the baseline against itself) gave −10 Elo
[−125, +105] after 34 games, as it should. Four shards play about 15 games a
minute on this 4-CPU container.

## Features and tests

`REFERENCE_FEATURES` (all off) keeps the earlier differential tests: the
kernel must still reproduce the reference's and the legacy search's move and
score at fixed depths. `ALL_FEATURES` is what the tests of the mechanics use
(`tests/client/kernelFeatures.test.ts` and others, written before the code).

| Feature | What it does | Tests |
| --- | --- | --- |
| `symmetricPruning` | Null-move and delta pruning at the opponent's (minimizing) nodes too | More null-move attempts; mates kept |
| `persistentTable` | The worker keeps the kernel table across one side's moves. Entries carry a 6-bit search generation, so older ones stay usable and may be replaced. Cleared when the side or tuning changes | Generations; worker keeps or clears the table |
| `seeQuiescence` | Quiescence skips non-promoting captures that lose material by static exchange | Smaller quiescence search |
| `seeOrdering` | The move picker splits good and losing captures by SEE instead of the geometric defence test | Captures before the quiets have SEE ≥ 0, those after SEE < 0; every move exactly once |
| `checkExtension` | Checks searched one ply deeper. The second version extends only safe checks, at most half the depth on one line | Mates kept; one found a ply earlier |
| `allPlyKillers`, `iir`, `aspirationWidening` | Killers at every ply; internal iterative reduction; root aspiration windows that widen gradually | Each changes the tree and completes its depth |

`SearchPosition.staticExchange` uses the swap algorithm: the least valuable
attacker recaptures, with x-rays found through the occupancy bitboards and
pins ignored. It is tested against a square-by-square implementation on more
than 5,000 captures from random games, and on hand-checked positions,
including an x-ray.

A further check guards every feature: whenever the reference finds a forced
mate at depth 3 or 5 on 13 mating positions, the kernel with all features
must find it too.

## Matches

| Test (100 ms per move) | Games | Result | Elo (95% Wilson) | Verdict |
| --- | ---: | --- | --- | --- |
| Symmetric pruning alone vs none | 600 | +282 =72 −246 | +21 [−7, +49] | Undecided (LLR 1.18) |
| **All five batch-1 features vs none** | 173 | +93 =26 −54 | **+80 [+27, +133]** | **Accepted** |
| Package vs package without: check extension | 303 | +134 =35 −134 | 0 [−39, +39] | Undecided |
| … without: SEE ordering | 303 | +137 =39 −127 | +11 [−28, +51] | Undecided |
| … without: **persistent table** | 196 | +106 =27 −63 | **+77 [+28, +127]** | **Accepted** |
| … without: SEE quiescence | 303 | +140 =42 −121 | +22 [−17, +61] | Undecided |
| … without: symmetric pruning | 303 | +128 =41 −134 | −7 [−46, +32] | Undecided |
| Batch 2 (killers, IIR, aspiration) on the kept set | 600 | +255 =86 −259 | −2 [−30, +25] | Undecided (LLR −2.14) |
| **New default vs before this phase** | 92 | +58 =11 −23 | **+139 [+63, +215]** | **Accepted** |

**Adopted as the default (`KERNEL_FEATURES`):**
- the persistent table;
- SEE quiescence;
- SEE ordering.

Off:
- symmetric pruning (neutral, with a small zugzwang risk);
- both check extensions;
- batch 2.

The final row confirms the adopted set against the kernel before this phase.
Its estimate is above the package's +80 because a different run means
different noise; the intervals overlap. The flags that stay off remain in
the code and documented, so they can be retested at other time controls
(they are cheap when off).

### Notes

- **Check extension.** On the ply-80 benchmark position, a forced mate in a
  queen ending, the first version multiplied the tree about 30-fold: almost
  every frontier move there is a check. Restricting it to safe checks with
  an extension budget did not fix this, because the existing in-check rule
  at depth 0 already turns each extended check into a full ply.
- **The big gain.** The persistent table works because the kernel
  previously cleared its table on every move while the existing search kept
  its own. With it, each move starts from the previous move's tree.

## Against Stockfish, again

The phase 8 ladder repeated with the new default kernel: 300 ms per move
for both sides, the same openings, 25 games per level, and the app's
`StockfishWasmAdapter` in Chromium. Results are in
`results/kernel-vs-stockfish-skill<N>-300ms-phase10*`.

| Stockfish | Phase 8 kernel: W/D/L (score) | Phase 10 kernel: W/D/L (score) | Phase 10 Elo (95% Wilson) |
| --- | --- | --- | --- |
| Skill 5 | 16 / 2 / 7 (68%) | 15 / 2 / 8 (64%) | +100 [−38, +238] |
| Skill 10 | 2 / 0 / 23 (8%) | 1 / 1 / 23 (6%) | −478 [−739, −217] |

The kernel's average completed depth per move rose from 7.9 to 9.1–9.4,
because the persistent table carries the previous move's tree over.
Against Stockfish, however, **the gain does not show** at this sample size.
Twenty-five games per level leave intervals of ±130 Elo or more, wider than
the +80 to +140 measured against the previous kernel, and Skill 5 and
Skill 10 are some 500 Elo apart. These ladder points therefore cannot
measure a gain of this size. A narrower answer would need a level between
5 and 10 and a few hundred games, or a direct match of both kernels against
one fixed Stockfish level.

## Next steps

- The kernel's default switch (phase 8) is still the owner's decision; the
  strength gap to the existing search has grown further.
- Retest the off features at the app's real time controls (3 s for medium,
  10 s for hard); short time controls favour speed over search refinements.
- Evaluation is now the largest lever: tuning the weights on self-play
  positions (Texel tuning) needs its own match gate.
- [Phase 11](search-position-phase11.md) tuned the evaluation on 315,618
  self-play positions: +137 Elo at 100 ms and +66 Elo at 1 s per move, both
  accepted by SPRT; against Stockfish at 300 ms (Skill 5–7, 400 games per
  kernel) only +6 Elo [−40, +53], against +132 in self-play at the same time (on different openings; see phase 11).

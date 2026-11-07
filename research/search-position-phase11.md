# Independent TypeScript search: phase 11, evaluation tuning

[Phase 10](search-position-phase10.md) took most of the easy search gains.
This phase tunes the kernel's evaluation weights on its own self-play
positions (Texel tuning) and gates the result with the same SPRT matches.

**Result: the tuned evaluation is +137 Elo [+63, +211] at 100 ms per move and
+66 Elo [+20, +112] at 1 s per move against the phase 10 kernel.** Both SPRTs
accepted it, so it is now part of the kernel default (`KERNEL_FEATURES`).
Against Stockfish Skill 5 and Skill 7 (100 games each), however, the new and
old kernels score the same within noise (52.0% vs 52.5%, 29.0% vs 31.5%); see
[the ladder](#against-stockfish) for what that does and does not show.

Unchanged:
- the kernel's worker switch (`tsSearchKernel`, default off), so production
  play is unchanged;
- the production default search and Stockfish routing;
- the shared evaluator (`chessAIEvaluation.ts`), the reference backend, and
  the frozen reference evaluator and generator.

The tuned weights act only on the kernel.

## 1. Data set

`research/scripts/texel/selfplay.ts` plays the kernel against itself:
- The engine is the phase 10 default (untuned evaluation) at expert, with no
  book. Each side keeps its own persistent table.
- Both sides get the same 50 ms per move.
- Openings: 4,000 fixed openings (`results/texel/openings.json`). Each is a
  book line of three or more plies plus four seeded random plies, kept when a
  depth-4 score is within one pawn. The SPRT openings are excluded.
- Games end by the engine's rules (equal to the application's, phase 8), as
  a draw at 400 plies, or as a win when the side to move scores at least
  1000 for the same winner on 8 consecutive plies.

The script is resumable per shard. It was restarted once midway, going from three shards to four.

`research/scripts/texel/dataset.ts` keeps a position only when:
- it is at ply 16 or later (after the first 8 moves);
- the side to move is not in check;
- it is quiet: the kernel's capture search returns exactly the static
  evaluation;
- it is new: same placement, side, castling and en passant as no earlier
  position, deduplicated in game order.

| | |
| --- | ---: |
| Games | 4,000 (+1,805 =450 −1,745 for white; mean 128 plies) |
| Endings | 3,245 adjudicated, 305 mates, 204 fifty-move, 142 insufficient material, 93 threefold, 3 stalemates, 8 at 400 plies |
| Positions from ply 16 on | 452,909 |
| **Kept** | **315,618** |
| Training / validation (split by game, about 4:1) | 251,973 / 63,645 |

What is committed:
- the games (`results/texel/games/`, 3.8 MB);
- the openings;
- `dataset-summary.json`.

The 29 MB position file is not committed. `tune.ts --extract` rebuilds it
from the games in about a minute.

## 2. Replaceable weights

`independent/kernelEvalWeights.ts` holds every weight of the kernel's
evaluation in one `KernelEvalWeights` object:
- material and full piece-square tables, middlegame and endgame;
- mobility;
- rook open, semi-open and seventh-rank files, doubled rooks;
- bishop pair and knight outposts;
- doubled, isolated, backward and connected pawns;
- passed pawns by rank and a rook behind a passed pawn;
- the king shield (8 cases) and king-zone attack, linear and quadratic;
- tempo.

Each weight now has separate middlegame and endgame values, including the
ones that were shared before.

`DEFAULT_KERNEL_EVAL_WEIGHTS` is the shared evaluator's weights in this
layout. With it the kernel is unchanged score for score. The commit that
introduced the object passed these unchanged:
- the golden search trees (32 cases, node for node);
- the evaluator parity tests against the shared and frozen evaluators;
- the incremental tests.

A same-run benchmark against the commit before showed identical trees
(193,894 nodes) and no slowdown (1.02×, within noise).

Material and piece-square values are kept as running sums by
`SearchPosition`. With other weights, the kernel switches the root position
to its own tables (`usePieceSquareTables`, allowed only at the root, since
the undo frames of earlier moves hold the old sums). By default positions
use the shared tables, so nothing else changes.

## 3. Texel tuning

- **Features** (`texel/features.ts`): the evaluation, from white's side, as a
  linear function of the weights. A constant covers what is not weighted:
  mop-up and the passed pawns' king distance. A test requires it to equal
  `KernelEvaluator` **exactly** (after the same rounding) on more than
  15,000 position and weight combinations, with the default and with
  randomly perturbed weights (±6 and ±40), under four tuning variants.
- **Not tuned**, because they are nonlinear: the king attack weights by
  piece type (inside the 80-unit cap), the king safety percentage, mop-up
  and the king distance.
- **Tuner** (`texel/tuner.ts`):
  - The expected score is 1 / (1 + 10^(−K·E/400)).
  - K is fitted once on the training set with the default weights
    (golden-section search).
  - Coordinate descent on integer weights: each weight moves at most one
    step per pass, with steps 4, 2, then 1.
  - Weights whose feature occurs in fewer than 1,000 positions stay fixed.
  - An optional L2 pull toward the start.
  - The validation error after every pass picks the best pass.
- **Tests of the tuner** (`tests/research/texelTuner.test.ts`), on synthetic
  results drawn from known weights and a known K = 1.3:
  - K is recovered within 0.01;
  - five changed weights (three piece values, a mobility weight, tempo) are
    recovered within one centipawn;
  - the error never rises during descent;
  - fixed weights never change;
  - a strong L2 pull freezes the weights.

### Error

K = 1.077. Mean squared error before tuning:
- training 0.12028;
- validation 0.10840.

| L2 pull | Best pass | Weights changed | Training | Validation |
| --- | ---: | ---: | ---: | ---: |
| 0 | 1 of 200 | 608 | 0.11723 | 0.10740 |
| 1e-8 | 2 | 530 | 0.11565 | 0.10739 |
| 1e-7 | 17 | 482 | 0.11529 | 0.10719 |
| **1e-6 (chosen)** | 11 | 144 | 0.11776 | **0.10700** |
| 3e-6 | 8 | 62 | 0.11863 | 0.10729 |
| 1e-5 | 6 | 19 | 0.11941 | 0.10769 |

The rows are best-pass values. The exact (rounded) errors agree to 1e-6.

Without the pull the tuner overfits:
- The validation error is lowest after the first pass and then climbs, to
  0.1087 by pass 38, while the training error keeps falling.
- On a 25,000-position trial set (330 games), even material and tempo alone
  raised the validation error.

The positions of one game share its result, so the number of games limits
what can be learnt, not the number of positions.

The chosen set changes the training error by −2.1% and the validation error
by −1.3%.

### What changed (`results/texel/tune-summary.json`)

| Weights | Default → tuned |
| --- | --- |
| Material | Almost unchanged (±1–2); endgame pawn 90 → 98 |
| Mobility, middlegame | Bishop 7 → 4, rook 7 → 3, queen 2 → 0 |
| Mobility, endgame | Knight 2 → −4, rook 5 → 3, queen 7 → 9 |
| Pawns | Doubled −20 → −17, isolated −9 → −8/−6, backward −6 → −2, connected 5 → 12 (mg) / 7 (eg) |
| Rooks | Open file 40 → 38, semi-open 37 → 36, seventh rank 0 → 1/2 |
| King shield | Pawn directly in front 15 → 11, beside 12 → 8; open-file penalties −25/−15 → −23/−11; zone attack −3 → −4 per unit |
| Passed pawns | ±1–2 per rank |
| Tempo | 10 → 1 |
| Piece-square entries | 103 of about 770 (63 middlegame, 40 endgame), mean 1.5 cp, at most 7 |

Two changes stand out:
- **Tempo nearly vanished.** The data set keeps only quiet positions,
  where the side to move has nothing to gain.
- **Mobility weights fell.** The self-play kernel overvalued activity
  against these results.

The tuner only measures how well a weight predicts the results; the matches
decide.

`tune.ts --emit` writes the weights to `independent/kernelTunedWeights.ts`
(`TUNED_KERNEL_EVAL_WEIGHTS`).

## 4. Match gate

The `tunedEvaluation` kernel feature selects the tuned weights:
- It was added off.
- It is on in `ALL_FEATURES`.
- The worker clears its table when the evaluation changes.

`kernel-sprt.ts` played the working tree with `tunedEvaluation` against a
baseline worktree of the same commit with the phase 10 default. The rest is
unchanged from phase 10:
- 300 balanced openings with both colors;
- the production adapter path at expert, book off;
- the trinomial GSPRT with H0 = 0 and H1 = +25 Elo, α = β = 0.05.

| Test | Games | Result | Elo (95% Wilson) | LLR | Verdict |
| --- | ---: | --- | --- | ---: | --- |
| Tuned vs phase 10 default, 100 ms per move | 96 | +61 =10 −25 | **+137 [+63, +211]** | 3.10 | **Accepted** |
| Tuned vs phase 10 default, 1 s per move | 224 | +115 =36 −73 | **+66 [+20, +112]** | 3.03 | **Accepted** |

The gain shrinks at the longer time control but stays clearly positive. At
1 s the first 31 games stood at −34 Elo, a reminder of how noisy small
samples are.

**Adopted:** `KERNEL_FEATURES` now includes `tunedEvaluation`. Three things
changed with it:
- **The golden search-tree fixture** (`tests/client/fixtures/kernelGolden.json`)
  was regenerated. The default evaluation changed, so every case's root
  scores and counters changed. It had still matched node for node after the
  weights were made replaceable; only switching the default changes it.
- **The differential tests against the legacy search**
  (`independentSearch.test.ts`) compare scores, so they now run the kernel
  with the phase 10 default (the shared evaluator). The reference
  comparisons already used `REFERENCE_FEATURES`.
- **The data scripts** pin the phase 10 kernel, so the committed data set
  stays reproducible.

**Not adopted:** none of the other L2 settings was matched. 1e-6 had the
lowest validation error and passed both gates. A version with more changed
weights (1e-7) is the obvious next candidate if the data set grows.

## Against Stockfish

`kernel-match.ts --opponent stockfish` matched both kernels against the
app's `StockfishWasmAdapter` in Chromium:
- **New:** the phase 11 default, from the working tree.
- **Old:** the phase 10 default, from a worktree of the same commit with the
  untuned evaluation.
- 300 ms per move for both sides.
- 100 games per kernel and level: 50 openings from the app's book, each
  played with both colors.
- To keep machine drift out of the comparison, the two kernels alternated in
  blocks of 50 games within one run.

Results are in `results/kernel-vs-stockfish-skill{5,7}-300ms-{phase11,phase10-rerun}*`.

| Stockfish | Kernel | W / D / L | Score | Elo (95% Wilson) | Pentanomial 95% | Mean depth |
| --- | --- | --- | ---: | --- | --- | ---: |
| Skill 5 | **Phase 11** | 49 / 6 / 45 | 52.0% | +14 [−54, +82] | [−52, +81] | 8.9 |
| Skill 5 | Phase 10 | 50 / 5 / 45 | 52.5% | +17 [−50, +85] | [−37, +73] | 9.0 |
| Skill 7 | **Phase 11** | 27 / 4 / 69 | 29.0% | −156 [−230, −81] | [−236, −88] | 9.2 |
| Skill 7 | Phase 10 | 28 / 7 / 65 | 31.5% | −135 [−208, −62] | [−217, −66] | 9.2 |

**Against Stockfish the two kernels are indistinguishable.** At Skill 5
they score 52.0% and 52.5%; at Skill 7, 29.0% and 31.5%. Both differences
are far inside the intervals, which are about ±70 Elo per row, so a
difference between kernels would need to be well over 100 Elo to show. The
ladder therefore cannot confirm the +66 Elo from the 1 s SPRT, nor rule it
out. It does show that the gain is not large against a different engine.

There is a caveat to weigh before treating the SPRT gain as general:
- **The tuning and both gates are self-play.** The weights were fitted to
  games of the phase 10 kernel against itself, then tested against that
  same kernel. Part of the gain may come from exploiting the old kernel's
  own misjudgements, for example its mobility and tempo weights. That would
  not transfer to Stockfish.
- **A direct check** would be a few hundred games of both kernels against
  one fixed Stockfish level (Skill 6 sits between these two). The Skill 5
  rows show 100 games per kernel are too few.

For calibration:
- The kernel's strength sits between Skill 5 (slightly above even) and
  Skill 7 (−135 to −156 Elo).
- The phase 10 rerun at Skill 5 (52.5%, 100 games) fits phase 10's own
  25-game ladder point (64%, interval [−38, +238]).

## 5. Phase 10's off features at 1 s: not retested

Not done in this phase. Symmetric pruning, the check extension and batch 2
were optional retests. Each 1 s SPRT takes several hours on all four CPUs:
the tuned-evaluation test needed 224 games, and an undecided test runs to
the 600-game cap, about 12 hours. The two required gates and the Stockfish
ladder took the available time. They remain the next search-side
measurement, now on top of the tuned evaluation.

## Next steps

- Confirm the gain outside self-play: both kernels against one Stockfish
  level (Skill 6) for a few hundred games each.
- More self-play games, ideally at a longer time control. The number of
  games, not positions, limits how many weights can be tuned without
  overfitting. With more games, retune with a weaker pull (1e-7) and the
  weights fixed here.
- Retest the phase 10 off features at 1 s, as above.
- Tune the nonlinear terms (king attack weights, the safety percentage)
  with a direct search on the match result or a nonlinear fit.
- Real-device profiling and the default switch of the kernel remain the
  owner's decision (phase 8).

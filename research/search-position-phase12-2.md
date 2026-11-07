# Independent TypeScript search: Phase 12.2, legacy strength recalibration

[Phase 12.1](search-position-phase12-1.md) fixed the ordered-prefix defect for
**future** SPRT runs. This phase independently re-reads the committed Phase
10/11 shard logs, validates opening/color slots and reported outcomes, and
reclassifies which old claims the evidence can support. **No new engine
matches were run here; shuffling historical records does not generate new
independent observations.** A true prospective shuffled-gate retest remains
necessary for incomplete historical samples.

## Repeat the audit

```sh
node --import tsx research/scripts/sprt-calibration.ts \
  --output research/results/kernel-sprt/phase12-2-calibration.json
# Inspect the generated JSON; the default invocation prints it to stdout.
node --import tsx research/scripts/sprt-calibration.ts
node --import tsx --test tests/research/sprtCalibration.test.ts
```

The tool reads every committed `shard-*.jsonl` for nine relevant historical
SPRT runs and their original `openings.json`, refuses duplicate/out-of-range
IDs, wrong colors, invalid scores or stale summary counts, and reports
original opening coverage, complete color pairs, score, nominal Wilson 95%
interval, distribution by first move and distribution shift from the planned
full sample. It computes deterministic hashes over openings and sorted
outcomes. Its Skill 6 cross-check requires both kernels to play the **same
opening and color in every slot**, and verifies that those slots equal the
matched Phase 11 self-play openings.

**Statistical limitation:** the nominal Wilson intervals listed below were
calculated on observed games. They are not necessarily sequentially valid
confidence intervals for tests that stopped early, and they say nothing
about unplayed openings. A prior SPRT H1 verdict is historical metadata,
not renewed proof of a full-opening strength gain.

## Raw-record recalibration

| Historical comparison | Time/move | Completed games | Distinct openings / total | Complete color pairs | Recorded Elo (nominal Wilson 95%) | Interpretation |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| Phase 10 final default vs prior | 100 ms | 92 | 58 / 300 | 34 | +139 [+63, +215] | **Unconfirmed for full opening distribution** |
| Phase 10 combined batch 1 | 100 ms | 173 | 88 / 300 | 85 | +80 [+27, +133] | **Unconfirmed for full opening distribution** |
| Persistent table ablation | 100 ms | 196 | 101 / 300 | 95 | +77 [+28, +127] | Positive on sampled slots only |
| Symmetric pruning | 100 ms | 600 | 300 / 300 | 300 | +21 [−7, +49] | Complete sample, inconclusive |
| Batch 2 (killers, IIR, aspiration) | 100 ms | 600 | 300 / 300 | 300 | −2 [−30, +25] | Complete sample, no observed benefit |
| Phase 11 tuned eval gate | 100 ms | 96 | 51 / 300 | 45 | +137 [+63, +211] | **Unconfirmed for full opening distribution** |
| Phase 11 tuned eval gate | 300 ms | 94 | 48 / 300 | 46 | +132 [+57, +206] | **Unconfirmed for full opening distribution** |
| Phase 11 tuned eval gate | 1 s | 224 | 115 / 300 | 109 | +66 [+20, +112] | Still partial, stronger coverage |
| Phase 11 matched opening/color slots | 300 ms | 200 | 100 / 100 | 100 | **+33 [−15, +81]** | Complete *book-slot* sample; small, uncertain gain |

Counts above were re-derived from the archived JSONL logs and matched to
committed summaries, not reconstructed from prose. Phase 10's 92-game
final gate contained 14 c4, 74 d4 and just 4 e4 games, whereas the planned
600 slots contained 40 c4, 284 d4, 266 e4 and 10 Nf3. Phase 11's 96-game
100 ms gate contained 14 c4 and 82 d4 games, **zero e4**.

### Matched Stockfish check

For Stockfish Skill 6 at **300 ms/move**, the Phase 10 and Phase 11 kernels
played all 200 of the same opening/color slots (100 book openings, both
colors). Every slot was rechecked against the archived results and against
the Phase 11 matched self-play sample.

- Old kernel: 82 wins / 14 draws / 104 losses (44.50% score).
- Tuned kernel: 89 wins / 13 draws / 98 losses (47.75% score).
- Difference: **+3.25 score percentage points, about +23 Elo**. The existing
  [Phase 11 report](search-position-phase11.md#against-stockfish) gives the
  Skill 6 difference interval **[−44, +89] Elo**. It includes zero.
- The pooled Skill 5–7 cross-check was **+6 [−40, +53] Elo**; the 300 ms
  matched self-play difference was **+33 [−15, +81] Elo**. These estimates
  are compatible with a small positive, zero, or modest negative effect.

Neither the Phase 10 +139 claim nor Phase 11 +137 claim can be treated as a
confirmed full-opening gain. The tuned evaluation remains enabled in the
*independent kernel* on the present evidence; **production's default-off
kernel selection is untouched**.

## Prospective work still required before promoting new search features

1. **Phase 10 confirmation:** new `--name`, seeded shuffled list, all 300
   openings with both colors available; compare frozen pre-Phase-10 kernel
   with Phase 10 kept features at the **same** 300 ms/move. Report the
   complete-sample result or a properly qualified early-stop SPRT result.
2. **Phase 11 confirmation:** at the *same time control and source openings*
   compare tuned vs untuned evaluation, and retain the 300 ms matched Skill 6
   check as a separately controlled opponent cross-check.
3. **Persistent table and deferred search features:** prioritize repeated
   300 ms and 1 s matches under the new protocol only after (1) and (2).
4. Preserve the seed, published `openings.json`, per-game logs, source and
   baseline commit SHAs, score statistics, game counts and coverage for each
   rerun. Do not overwrite or append new games into legacy run directories.

Full prospective matches require both engine worktrees and dependencies and
many thousands of timed moves; they were not available in the restricted
local environment used for this audit. This phase establishes an accurate,
reproducible retrospective baseline **without fabricating new Elo data**.

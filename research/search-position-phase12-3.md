# Independent TS kernel — Phase 12.3 prospective strength retest

Status: **experimental protocol implemented; engine matches NOT run** (2026-11-07). This report deliberately contains no newly measured Elo.

## 1. Goal and baseline

Re-examine the Phase 10 search optimizations and Phase 11 Texel evaluation under the corrected seeded-opening protocol, at **300 ms/move**, aiming at **300 openings × two opposite colors = 600 game slots per comparison**. The previous early-stopped SPRT results must not be treated as a representative full-opening experiment.

Repository baseline: `main` at **`53be30c3e0804659b9cea9255cf83b884f3e32cd`** (merged PR #24). Its PR CI run **42410810308** concluded **success**. Phase 12.3 uses the independent research branch `feat/phase12-3-prospective-sprt-audit`. Every actual run records its candidate and baseline commit SHAs in an immutable `experiment.json`; **do not assume a branch name is a frozen experimental version**.

Historical commit **`b858380f903ca85e7fd6433d8c2579881d03c639`** precedes Phase 10's worker-kernel integration and is not an interchangeable `--base` adapter worktree. To avoid mixing changes in the interface and search infrastructure with the controlled variable, the prospective comparisons use two isolated copies of the Phase 12.3-compatible kernel with feature overrides; both exact source SHAs and the feature settings are recorded. This is a **functional-configuration recreation** of pre-Phase-10 features, not a byte-for-byte rerun of the historical older source.

## 2. Prespecified comparisons

| Comparison | Candidate configuration | Baseline configuration | Proposed sample |
| --- | --- | --- | --- |
| Phase 10 search | Default Phase 10 kept features (persistent table, SEE quiescence and SEE ordering), `tunedEvaluation=false` | Same kernel, all three Phase 10 kept features **off**, `tunedEvaluation=false` | 600 games; 300 pairs |
| Phase 11 Texel | Same Phase 10 kept search features, `tunedEvaluation=true` | Same kept search features, `tunedEvaluation=false` | 600 games; 300 pairs |

All other feature flags remain at the repository's `KERNEL_FEATURES` defaults (symmetric pruning, check extension, batch 2 off). Each side uses its own independent module graph/worker adapter and search state. Both sides use `expert`, `tsSearchKernel: 'independent'`, the same 300 ms move budget, and the opening book disabled after the prescribed opening. The production/default engine switch remains **off**; Stockfish routing, fallback, UI and rules are unchanged.

Openings: the committed 300-entry `research/results/kernel-sprt/openings.json`, seeded **`99537187`**, shuffled as *whole pairs*. Slots `2k` and `2k+1` always play exactly the same opening, with the candidate as white then black. Each run writes the entire ordered opening snapshot, mode, seed, source fingerprint and snapshot hash. Phase 10 and Phase 11 use separate run names with the same seed and source, so their ordered lists are comparable without reusing game results.

## 3. Protocol and audit safeguards

- `experiment.json` is published once atomically and pins both commit SHAs, seed/snapshot SHA-256, time control, shard count, hypothesis/stop settings and feature overrides. A mismatch or an old unmanifested run with shard logs is **rejected before any new game**.
- One exclusive `shard-i.lock` per writer prevents two processes from playing the same shard concurrently. After an unclean termination, inspect the process and files before manually removing a stale lock. Changing shard count requires a new experiment name.
- Each completed game is saved with ID, candidate color, opening moves, full UCI continuation, result/reason/plies and candidate/baseline search depth/node/q-node/timing totals. Per-shard JSONL updates use atomic copy-and-rename so readers never observe a partial append. Only complete records are resumed; duplicates, wrong shard IDs, wrong opening/color, impossible score/metric shapes and corrupt JSONL fail closed.
- The standalone `sprt-prospective-report.ts` rebuilds counts, Elo, color pairs, missing IDs, opening-family distribution and search metrics **from the original JSONL plus the immutable snapshot**, without importing `chess.js` or the engines. The report includes a deterministic sorted-record digest.
- `--full-pairs` explicitly **disables SPRT boundary stopping**. In that mode the LLR is a diagnostic trace, **not** an early-stop verdict. The paired-opening nominal fixed-sample 95% Elo interval appears only when all slots are present. No CI or significance claim is generated from an incomplete fixed-sample run.
- Without `--full-pairs`, the preexisting SPRT rule (H0=0 Elo, H1=+25 Elo, alpha=beta=0.05, minimum 50 games) can stop early, but the resulting report must retain actual game and opening/color coverage. A nominal fixed-sample interval is **not** a sequentially valid confidence interval.

For strict comparisons, freeze candidate and baseline worktrees to their recorded SHAs once an experiment starts. The time-managed search is not bitwise deterministic under changing CPU scheduling; the protocol and datasets are reproducible, but repeated timed searches need not produce identical moves.

## 4. Actual results and uncertainty

**New prospective games completed in this phase: 0.** No Chess engine dependencies, frozen worktrees or complete repository checkout were available in the current isolated runner; DNS access to github.com failed. Consequently neither the Phase 10 nor Phase 11 600-game prospective match was started, and **no new win/draw/loss, Elo, CI, depth or node statistics exist**.

| Experiment | Status | New games | Coverage | Result |
| --- | --- | ---: | --- | --- |
| Phase 10 kept search vs pre-Phase-10 flags, 300 ms | **Not started** | **0/600** | 0/300 pairs | No prospective estimate |
| Phase 11 tuned vs untuned weights, 300 ms | **Not started** | **0/600** | 0/300 pairs | No prospective estimate |

Existing *historical* calibration (not newly shuffled or replayed):

| Archived experiment | Games | Original 95% interval | Finding |
| --- | ---: | --- | --- |
| Phase 10 final at 100 ms | 92 | +139 Elo [63, 215] | Only 58/300 openings; not representative |
| Phase 11 at 100 ms | 96 | +137 Elo [63, 211] | Only 51/300 openings; not representative |
| Phase 11 complete fixed 300 ms book-slot sample | 200 | +33 Elo [-15, 81] | Includes zero |
| Phase 11 versus Stockfish Skill 6, matched slots | 200 per kernel | +23 Elo [-44, 89] difference | Includes zero |
| Phase 11 pooled Skill 5–7 check | 400 per kernel | +6 Elo [-40, 53] difference | Includes zero |

**Assessment:** the historical Phase 10 +139 Elo and Phase 11 +137 Elo full-opening claims remain **unconfirmed**. Phase 11's matched results are compatible with zero or modest negative gain. This phase supplies a safer measurement mechanism, *not confirmation of improvement*.

## 5. Reproduce on a machine with the repo and dependencies

Use a clean clone of the Phase 12.3 PR branch (or a fixed SHA once merged), `npm ci`, and create a baseline worktree for the **compatible** engine source. On Unix-like systems:

```sh
git worktree add .sprt-base 53be30c3e0804659b9cea9255cf83b884f3e32cd
ln -s ../node_modules .sprt-base/node_modules
npm run lint
node --import tsx --test tests/research/sprtProspective.test.ts tests/research/sprtOpenings.test.ts tests/research/sprtCalibration.test.ts
```

### Phase 10: priority experiment

Use the *same command settings* for `--shard 0/4`, `1/4`, `2/4`, `3/4`, with four independent processes. For instance:

```sh
node --import tsx research/scripts/kernel-sprt.ts \
  --name phase12-3-p10-300ms --shard 0/4 --base .sprt-base \
  --move-time 300 --opening-seed 99537187 --full-pairs \
  --new-features '{"tunedEvaluation":false}' \
  --base-features '{"persistentTable":false,"seeQuiescence":false,"seeOrdering":false,"tunedEvaluation":false}'
```

Repeat the identical command with `--shard 1/4`, `2/4`, `3/4`. Restart a stopped shard with *exactly the same command and frozen worktrees*; it skips completed IDs. If CPU/memory limits preclude four processes, **choose a shard count before starting and never change it within the run** (e.g. `0/1` for one process). No extra GitHub Actions run is needed for this measurement.

After any partial or complete collection:

```sh
node --import tsx research/scripts/sprt-prospective-report.ts phase12-3-p10-300ms \
  --output research/results/kernel-sprt/phase12-3-p10-300ms-summary.json
```

### Phase 11: run only after the Phase 10 priority pass

Again use four matched independent shard processes with the **same** 300-opening source and seed:

```sh
node --import tsx research/scripts/kernel-sprt.ts \
  --name phase12-3-p11-300ms --shard 0/4 --base .sprt-base \
  --move-time 300 --opening-seed 99537187 --full-pairs \
  --new-features '{"tunedEvaluation":true}' \
  --base-features '{"tunedEvaluation":false}'
node --import tsx research/scripts/sprt-prospective-report.ts phase12-3-p11-300ms \
  --output research/results/kernel-sprt/phase12-3-p11-300ms-summary.json
```

Run the other three shard indices as for Phase 10 **before** producing the final report. Do not copy existing Phase 10/11 JSONL into either new name. Commit the actual run's `experiment.json`, `openings.json`, `shard-*.jsonl` and summary when collected; never overwrite the archived Phase 10/11 experiment folders.

## 6. Local verification and boundaries

- New isolated prospective-module tests: **8 passed** (manifest conflicts, unmanifested run refusal, shard locks, full/partial reports, corrupt/duplicate/wrong-slot records, snapshot tamper, atomic JSONL recovery). An isolated `tsc --noEmit` also passed with local minimal dependencies.
- **Not verified here:** real multi-process chess matches, full-repository typecheck, full unit suite, browser checks or production play. These require an actual repository worktree and dependencies. PR-triggered CI, if available, is a separate check.
- No production engine file, Stockfish integration, application UI, difficulty control, evaluation weights or search pruning algorithm was changed.

## 7. Decision gate and Phase 12.4 priority

1. **First finish Phase 10's 600 slots**, validate the stored raw logs and color/opening coverage; compare the paired fixed-sample interval with zero. If insufficient, report uncertainty and retain resumability, not a cherry-picked point estimate.
2. **Then finish Phase 11's 600 slots** under the same 300 ms protocol. Compare with historical +33 [-15, +81] and the matched Stockfish Skill 6 +23 [-44, +89]; do not call a positive point estimate significant if its CI includes zero.
3. Before Phase 12.4, consider a **new, independently held-out Stockfish check** (matched opening/color slots, reproducible opponent settings) and only then assess stronger-engine-assisted evaluation labels or additional self-play training. Do not tune weights based on the Phase 12.3 test set: use it as a hold-out gate.
4. Keep the independent production switch off until the owner explicitly authorizes a release decision.

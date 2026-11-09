# Independent TS kernel — Phase 12.4 prospective execution audit

**Status (2026-11-08): Phase 12.4 prescribed fixed-sample acceptance COMPLETE.** Smoke gate PASSED; Phase 10 COMPLETE 600/600 (+86 Elo, paired nominal 95% CI [+60, +114]); Phase 11 COMPLETE 600/600 (+62 Elo, paired nominal 95% CI [+36, +89]). Both intervals exclude zero **for the fixed 300-opening, 300-ms/move self-play comparisons only**. Section 2 preserves an earlier blocked environment as historical context; Section 4 reports the subsequent genuine execution. Historical logs, tests and fixtures are not prospective games. These outcomes do not establish strength across other time controls, opponents or opening distributions.

## 1. Verified baseline and scope

- Repository: mingzhangyang/chess. **Frozen engine-source commit** for both compared worktrees: **899fd35635db50dbf52abb54564a8a05a344b132** (merged via PR #25); this is **not** a claim that the current `main` still points to that commit. PR #27 was reviewed against `main` at **6b388f7bb3fd6eecac98c2f44f8c3d0e3435555f**. PR #25's automatically triggered CI run [42423074091](https://github.com/mingzhangyang/chess/actions/runs/42423074091) passed ("Typecheck, test and build"); this was **not** a chess match run.
- The research runner imports the candidate TsEngineAdapter from its own worktree and the baseline adapter/diagnostics/feature hooks from a separate worktree path. The harness requests 300 ms/move through the adapter. Source inspection establishes the routing; **actual mean search elapsed times are reported in Section 4**, not inferred from source. The baseline `node_modules` is symlinked to the candidate's (shared third-party packages), while the two worktrees' `src` graphs and engine states are separate; this is not a fully dependency-isolated replication.
- Executed frozen **candidate SHA: 899fd35635db50dbf52abb54564a8a05a344b132**.
- Executed frozen **baseline SHA: 899fd35635db50dbf52abb54564a8a05a344b132**. Equal source SHA is deliberate: two physically distinct detached Git worktrees, separate module graphs and independent engine state, with **only explicit features changed**. Do not use b858380 (pre-Phase-10 adapter incompatibility) for this controlled comparison.
- Keep both detached worktrees unchanged after a run begins. Commit results from a third, editable PR worktree, never by moving either experimental HEAD. Production engine selection, fallback, Stockfish, game rules, UI and tuned weights remain unchanged.

### Opening source and prespecified settings

Committed source is research/results/kernel-sprt/openings.json at the frozen source revision. It contains 300 distinct opening lines, with first-move families c2c4=20, d2d4=142, e2e4=133, g1f3=5. Both formal manifests record the same source fingerprint and seeded opening snapshot.

| Parameter | Phase 10 candidate | Phase 10 baseline | Phase 11 candidate | Phase 11 baseline |
| --- | --- | --- | --- | --- |
| persistentTable | true | false | true | true |
| seeQuiescence | true | false | true | true |
| seeOrdering | true | false | true | true |
| tunedEvaluation | false | false | true | false |
| All other flags | same source defaults (off) | same | same | same |

Both experiments: 300 ms/move, seed **99537187**, 300 shuffled whole openings, both colors per opening, **600 slots / 300 complete color pairs**, "--full-pairs" (never stop on an SPRT crossing). Game records and manifests live under two separate new names, with no historical data reuse:

- phase12-4-p10-300ms-899fd356
- phase12-4-p11-300ms-899fd356

Both completed formal runs used **0/1 shard** to limit CPU contention. The run identity fixes shard count: moving to more shards is not a compatible resume and requires a new experiment identity. The completed smoke run used a separate one-opening/two-color source, name phase12-4-smoke-300ms-899fd356, with concurrent 0/2 and 1/2 shards.

## 2. Earlier blocked execution environment (historical, not the final outcome)

An **earlier session** (before the genuine runs reported in Section 4) encountered the following local limitations:

| Check | Observed result |
| --- | --- |
| git | 2.47.3 |
| node / npm | v22.16.0 / 10.9.2 |
| visible CPUs / visible system RAM | 5 / 5.8 GiB |
| effective cgroup CPU quota | 400000/100000 = 4 CPUs |
| cgroup memory ceiling | 4294967296 bytes = 4 GiB |
| existing Chess Git worktrees | 0 |
| local chess.js / tsx packages | both missing |
| git ls-remote https://github.com/mingzhangyang/chess.git HEAD | **failed**: Could not resolve host: github.com |

In that earlier session, the connected GitHub API allowed file/commit/CI inspection and research-branch updates, but provided no runnable checkout or chess compute worker. Its execution container could not clone the repository or install missing packages because outbound GitHub/DNS access was unavailable. **This blocker did not apply to the later cloud container used for the authentic experiments in Section 4.**

Consequently, **that earlier session** created no pinned worktrees, loaded no real engine module and ran no authentic smoke or full chess match. Its prior Phase 12.3 tests were not rerun locally, and its Bash-wrapper syntax check was not a chess execution test. **These negative statements describe only that historical session**: the later execution passed preflight/smoke, exercised interruption/resume and produced both complete 600-game samples (Section 4).

That earlier session could not verify the 300-ms request empirically. The later smoke and both formal runs **did** record mean engine-search elapsed times (Section 4). These means support timing comparability but do **not** establish that every move met a strict wall-clock deadline; the committed summaries do not independently quantify per-game wall time, peak process RSS or CPU contention.

## 3. Executed protocol and optional reproduction (not pending work)

The following is the prescribed protocol **already completed for Phase 12.4**; the commands are retained solely for an independently authorized replication or audit, **not** as instructions to rerun the 1,200 finished games to close PR #27. The thin wrapper invokes existing Phase 12.3 game/reporter code; it contains no simulated match generation or production engine modifications. To examine the recorded protocol, check out the audited PR #27 HEAD rather than the obsolete research branch:

~~~sh
git clone https://github.com/mingzhangyang/chess.git chess-phase12-4
cd chess-phase12-4
git fetch origin 82708959f10c1402e1916abdcdf40b47bbb2bec1
git switch --detach 82708959f10c1402e1916abdcdf40b47bbb2bec1
bash research/scripts/phase12-4-run.sh prepare
bash research/scripts/phase12-4-run.sh preflight
bash research/scripts/phase12-4-run.sh smoke
~~~

"prepare" creates two separate detached worktrees pinned to the exact SHA above and installs dependencies on the candidate; "preflight" checks source SHAs, worktree cleanliness, dependency usability, TypeScript, the Phase 12.3 research tests, and the new Phase 12.4 provenance/lock-safety regression tests (test fixtures are **not** real matches). "smoke" launches two real-engine Node processes directly with tracked PIDs, forwards INT/TERM/HUP to both, and waits for exit. Since default Node SIGTERM can skip the Phase 12.3 `finally` block, the wrapper now **verifies the lock token's hostname/PID matches that specific reaped engine and removes only that stale lock**; a foreign, malformed, changing, or still-active lock is preserved with an explicit error. It finishes both colors of one committed opening in separate concurrent shards, verifies the complete pair from JSONL and reruns the same slots to ensure resume does not alter the record digest. Smoke results live in their own directory and **must never be appended to either formal sample**.

For any **new replication**, inspect each side's runtime search depth, node and elapsed totals; inspect 300-ms request propagation, wall-clock budget adherence, CPU usage and per-process memory. A measured overrun or inconsistent module/feature configuration must block that new run. The archived Phase 12.4 summaries contain mean engine-search elapsed times, depth and nodes, **not** separately audited per-game wall time, peak RSS or CPU-usage metrics. The two-shard smoke exercises parallel writers, not a claim of proven performance fairness. For a genuine interrupted-mid-game test, send SIGTERM to the smoke wrapper **while both real engine processes are active**, verify both child PIDs have exited, confirm the owned shard locks were removed, and repeat the exact smoke command; no partial JSONL game may be accepted. If the wrapper itself is forcibly killed, or a lock's token cannot be proven to belong to the exited writer, **do not forcibly delete a possibly live writer's lock**. Inspect its hostname, PID, run identity, and active processes; only manually remove a confirmed stale lock after the former owner has exited. Ordinary SIGTERM is handled by verified cleanup, not merely SIGKILL cases. Use a **new smoke name** if you intentionally change sample, source or flags.

After its smoke gate passed, the executed Phase 10 run used the following commands (shown for reproducibility, **not** as an outstanding action):

~~~sh
bash research/scripts/phase12-4-run.sh phase10
bash research/scripts/phase12-4-run.sh report-p10
~~~

A stopped or crashed Phase 10 process can be resumed with **exactly the same phase10 invocation** in the same two frozen worktrees. The persisted manifest must agree on source SHA, baseline SHA, seed, feature flags, stop mode, 300-ms limit and 1-shard partition. Do not delete or edit JSONL or opening snapshots to force a resume. Inspect an orphaned lock and only clear it after confirming the previous writer exited.

Phase 11 **was started only after** Phase 10 achieved a complete, successfully audited 600-game dataset covering all 300 black/white pairs with no missing slots. The wrapper refuses Phase 11 unless the regenerated raw-JSONL audit reports exactly 600 games, 300 distinct openings, 300 complete pairs, zero unpaired/missing slots, the fixed 300-ms budget, the specified seed and single-shard fixed-sample mode. **An additional independent provenance gate** checks both recorded Git SHAs against `899fd35635db50dbf52abb54564a8a05a344b132`, compares exactly the explicit Phase 10 candidate/baseline feature overrides (independent of JSON key order), verifies the source fingerprint `SHA256(JSON.stringify(committedOpenings))`, reconstructs the exact seeded Fisher-Yates order and checks the saved snapshot hash and sorted JSONL record digest before allowing Phase 11:

~~~sh
bash research/scripts/phase12-4-run.sh phase11
bash research/scripts/phase12-4-run.sh report-p11
~~~

Phase 11 used the same committed 300-opening source and seed but its own immutable manifest, 600 new authentic games and different feature overrides. **No Phase 10 games were reused.** For independent verification, the standalone reporter regenerates summaries from experiment.json, openings.json and shard JSONL.

PR #27 **already includes** the independently named smoke, Phase 10 and Phase 11 result directories, manifests, opening snapshots, raw JSONL and summary files under research/results/kernel-sprt/. No new results need to be copied or generated for this report correction. For any separate future replication, copy (do not move) results from frozen experimental worktrees only after reviewing JSONL coverage and digests; never mix a new experiment identity into these completed records.

## 4. Prospective result accounting, 2026-11-08

Executed in a cloud container with 4 CPUs, 15 GiB RAM, Node v22, two detached worktrees at 899fd356 (`prepare`, `preflight` all passed: lint, Phase 12.3 research tests, 5 Phase 12.4 control tests). Note: baseline `node_modules` is a symlink to the candidate's, so third-party packages are shared; only each worktree's `src` module graph is independent.

### 4a. Smoke gate (phase12-4-smoke-300ms-899fd356) — passed

- Concurrent 0/2 and 1/2 shards completed one opening as a full color pair (candidate 0.5 by threefold, 0 by checkmate). Rerunning both shards skipped completed slots and preserved the record digest.
- Measured search time: candidate 285.7 ms/move, baseline 285.8 ms/move (300 ms budget); mean completed depth 7.92 vs 7.42. No stale locks left.
- Interrupt/resume: SIGTERM sent to the Phase 10 wrapper during game 1; both processes exited, the owned shard lock was removed, game 0 was preserved, no partial JSONL record. The identical `phase10` command then resumed from game 1.

### 4b. Results

| Measurement | Phase 10 search configuration | Phase 11 Texel evaluation |
| --- | --- | --- |
| Authentic completed games | **600 / 600** | **600 / 600** |
| Complete color pairs | **300 / 300** | **300 / 300** |
| Opening coverage | **300 / 300** | **300 / 300** |
| Wins / draws / losses (candidate) | **337 / 72 / 191** | **315 / 76 / 209** |
| Score / Elo point estimate | **0.6217 / +86** | **0.5883 / +62** |
| Fixed-sample paired 95% Elo CI | **[+60, +114]** (clustered by opening) | **[+36, +89]** (clustered by opening) |
| Mean completed depth (cand / base) | 8.80 / 8.32 | 8.48 / 8.41 |
| Mean nodes/move (cand / base) | 105,698 / 105,791 | 84,464 / 87,065 |
| Measured elapsed/move (cand / base) | 290.9 ms / 290.6 ms | 294.8 ms / 295.1 ms |
| Sequential SPRT | not applicable (fixed sample); informational LLR 10.891 vs ±2.944 | not applicable (fixed sample); informational LLR 7.204 vs ±2.944 |
| Raw games, config/snapshot, summary | research/results/kernel-sprt/phase12-4-p10-300ms-899fd356{/,-summary.json} | research/results/kernel-sprt/phase12-4-p11-300ms-899fd356{/,-summary.json} |
| Missing slots | 0 | 0 |

Phase 10 per-family score: d2d4 0.643 (284 games), e2e4 0.607 (266), c2c4 0.538 (40), g1f3 0.750 (10). Terminations: checkmate 528, fifty-move 38, insufficient material 17, threefold 13, maxPlies 3, stalemate 1. Records digest `5a78d6501d989acd7624d60ddf841b0f0b292facd32398fc339450ec00413452`. The independent Phase 12.4 provenance verifier (`phase12-4-control.mjs verify-phase10`, exact SHAs, overrides, opening fingerprint, seeded permutation, snapshot hash, 600 records/digest) passed **before the now-completed Phase 11 run**.

Interpretation: on the prescribed 300-opening, 300-ms sample the Phase 10 search features are a confirmed gain, **+86 Elo [+60, +114]**. This is smaller than the historical 100-ms gate (+139 [+63, +215]) but its interval excludes zero. Nodes/move are essentially equal and time use is matched, so the gain comes from search efficiency (deeper completed depth, ~26% fewer quiescence nodes), not from extra time.

Phase 11 (candidate: Phase 10 features + tunedEvaluation; baseline: Phase 10 features only) per-family score: d2d4 0.581 (284 games), e2e4 0.598 (266), c2c4 0.625 (40), g1f3 0.400 (10). Terminations: checkmate 524, fifty-move 41, insufficient material 17, threefold 15, maxPlies 3. Records digest `c56aa405142ccb4e40d2be6545f9f6a744185bc773db1bcf7b5576bdf15ee16a`. Same committed opening source and seeded snapshot as Phase 10 (identical source and snapshot SHA-256), separate manifest and 600 new games; no Phase 10 games reused. No stale locks.

Interpretation: the Texel-tuned evaluation is a confirmed gain on top of the Phase 10 search, **+62 Elo [+36, +89]**. The earlier matched 300-ms 100-opening self-play estimate (+33 [-15, +81]) could not exclude zero; this full 300-opening sample does. Completed depth is almost identical (8.48 vs 8.41) and the tuned side searches ~3% fewer nodes per move, so the gain comes from evaluation quality, not from search speed. g1f3 (10 games) is too small to interpret.

### Historical comparisons (reference only, not Phase 12.4 data)

- Phase 10 final historical 100-ms gate: **+139 Elo [+63,+215]**, 92 games, only **58/300** openings.
- Phase 11 100-ms historical gate: **+137 Elo [+63,+211]**, 96 games, only **51/300** openings.
- Phase 11 complete matched 300-ms self-play 100-opening sample: **+33 Elo [-15,+81]** across 200 games.
- Phase 11 matched 300-ms Stockfish Skill 6 difference: **+23 Elo [-44,+89]**, 200 games per kernel.
- **Historical estimates alone** did not establish either gain on the prescribed prospective sample. **The new, separately collected Phase 12.4 fixed samples now do support gains**: Phase 10 +86 Elo [+60, +114] and Phase 11 +62 Elo [+36, +89], each from 600 authentic games / 300 full color pairs at 300 ms/move. This is not evidence of independent stronger-engine confirmation or other time-control robustness.

These are **complete fixed-sample** comparisons. Their nominal 95% Elo intervals cluster the two colors by opening; neither interval is a sequentially valid SPRT stopping interval. In `--full-pairs` mode the LLR is **informational only**. Both summaries report zero missing/unpaired slots, opening-family scores and observed side-specific depth, nodes/move and search elapsed/move. Do not project the intervals beyond the tested opponent, 300-ms timing, fixed opening set and engine configurations.

## 5. Completed verification, acceptance and remaining research

1. **Completed — preparation and smoke.** `prepare` / `preflight` passed in the connected execution environment (lint, Phase 12.3 research tests and five Phase 12.4 control tests). The two-shard authentic smoke completed both colors, rerun preserved its record digest, and the Phase 10 SIGTERM/resume exercise preserved committed slots without a partial game or stale owned lock. The earlier offline environment in Section 2 is **not** a remaining blocker.
2. **Completed — Phase 10.** A distinct 600/600-game, 300/300-pair, zero-missing fixed sample at 300 ms/move was collected and its provenance verification passed before Phase 11. The nominal opening-clustered 95% Elo CI **[+60, +114]** excludes zero; point estimate **+86 Elo** for the prescribed search-feature comparison.
3. **Completed — Phase 11.** A separate 600/600-game, 300/300-pair, zero-missing sample used the same seeded opening snapshot but its own manifest and raw records. The nominal opening-clustered 95% Elo CI **[+36, +89]** excludes zero; point estimate **+62 Elo** for tuned evaluation added to the Phase 10 search features. The historical +33 Elo estimate with a CI crossing zero remains historical, **not** the current Phase 11 conclusion.
4. **Not established by these runs.** There is no Phase 12.4 held-out stronger-engine test, no validation at other time controls or broader opening populations, and no guarantee against different opponents. Search elapsed/move averages are recorded, but these summaries do not separately audit every move's wall-clock deadline, per-game wall time, peak RSS or CPU contention. Third-party dependencies were shared between the worktrees. The paired CIs are **nominal fixed-sample** intervals; SPRT LLRs are informational only. This review did not independently regenerate the JSONL digests from all 1,200 games.
5. **Optional future research, not Phase 12.4 completion tasks.** If further generalization evidence is needed, preregister a new identity and separately test held-out stronger opponents, different move-time limits and more balanced opening coverage. Avoid converting these optional studies into a requirement to repeat the completed Phase 10/11 samples. Consider evaluation generalization and node/depth efficiency as distinct hypotheses; do not infer a Stockfish-aided training benefit from the present data.
6. **Production and CI unchanged.** Keep the independent TS kernel's existing production selection and feature defaults unchanged. This documentation correction requires no new games, manual GitHub Actions dispatch/retry, deployment or engine-weight change.

**Phase 12.4 acceptance outcome: met for both prescribed 600-game, 300-opening, 300-ms/move fixed-sample comparisons**, as documented by PR #27's committed manifests, JSONL data and summaries. This is **sample-specific evidence** of improvement, not independently validated universal strength, and does not imply that optional follow-up experiments have been performed.
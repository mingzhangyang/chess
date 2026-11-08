# Independent TS kernel — Phase 12.4 prospective execution audit

**Status: BLOCKED before genuine game smoke test; 0 new games (2026-11-07).** This is an honest partial execution report, not a successful strength retest. Do not treat any historical logs, tests, or fixtures as prospective games.

## 1. Verified baseline and scope

- Repository: mingzhangyang/chess, main commit **899fd35635db50dbf52abb54564a8a05a344b132**, merged from PR #25. PR #25 is merged; its final automatically triggered CI run [42423074091](https://github.com/mingzhangyang/chess/actions/runs/42423074091) completed successfully ("Typecheck, test and build"). This is **not** a chess match run.
- The research runner imports the candidate TsEngineAdapter statically from the script's own worktree, and imports the baseline TsEngineAdapter, diagnostics, and feature test hooks from a separate worktree path. The adapter passes the caller's timeLimitMs into the kernel search; the research harness supplies 300 ms explicitly. These are **source-code observations**, not runtime proof of actual search-budget adherence or module isolation.
- Intended frozen **candidate SHA: 899fd35635db50dbf52abb54564a8a05a344b132**.
- Intended frozen **baseline SHA: 899fd35635db50dbf52abb54564a8a05a344b132**. Equal source SHA is deliberate: two physically distinct detached Git worktrees, separate module graphs and independent engine state, with **only explicit features changed**. Do not use b858380 (pre-Phase-10 adapter incompatibility) for this controlled comparison.
- Keep both detached worktrees unchanged after a run begins. Commit results from a third, editable PR worktree, never by moving either experimental HEAD. Production engine selection, fallback, Stockfish, game rules, UI and tuned weights remain unchanged.

### Opening source and prespecified settings

Committed source is research/results/kernel-sprt/openings.json. Independently inspected at current main: 300 distinct opening lines, with first-move families c2c4=20, d2d4=142, e2e4=133, g1f3=5.

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

Formal runs use **0/1 shard** initially to avoid uncontrolled CPU contention. The run identity fixes shard count: moving to more shards is not a compatible resume and requires a new experiment. The smoke run uses a separate one-opening/2-color source, name phase12-4-smoke-300ms-899fd356, and two concurrent 0/2 and 1/2 shards.

## 2. Actual execution environment and blocker

Attempted in this session:

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

The connected GitHub API allowed verifying files, commits and CI, and writing this research branch, but it does **not** provide a runnable checkout or a chess compute worker. The execution container could not clone the repository or install the missing packages because outbound GitHub/DNS access was unavailable.

As a consequence, **no two local pinned worktrees were created**, no actual engine module was loaded in this environment, and no genuine black/white paired smoke match, interruption/resume run, CPU contention measurement or full chess match was performed. Previous Phase 12.3 regression tests are present in the merged source and passed PR CI; they were not rerun locally in this session. A syntax-only check of the accompanying Bash run wrapper passed; this does not validate its chess execution path.

**Do not claim that 300 ms was empirically verified:** the production adapter/source routing was inspected, but no move timings were observed. The first actual smoke match on a connected computer remains a mandatory gate.

## 3. Prespecified authentic execution and resume

From a machine with GitHub network access, a clean clone and the pinned commit available, run the included thin wrapper. It only invokes existing Phase 12.3 game/reporter code; it contains no simulated match generation and no changes to the independent engine.

~~~sh
git clone https://github.com/mingzhangyang/chess.git chess-phase12-4
cd chess-phase12-4
git fetch origin
git switch research/phase12-4-prospective-execution
bash research/scripts/phase12-4-run.sh prepare
bash research/scripts/phase12-4-run.sh preflight
bash research/scripts/phase12-4-run.sh smoke
~~~

"prepare" creates two separate detached worktrees pinned to the exact SHA above and installs dependencies on the candidate; "preflight" checks source SHAs, worktree cleanliness, dependency usability, TypeScript, the Phase 12.3 research tests, and the new Phase 12.4 provenance/lock-safety regression tests (test fixtures are **not** real matches). "smoke" launches two real-engine Node processes directly with tracked PIDs, forwards INT/TERM/HUP to both, and waits for exit. Since default Node SIGTERM can skip the Phase 12.3 `finally` block, the wrapper now **verifies the lock token's hostname/PID matches that specific reaped engine and removes only that stale lock**; a foreign, malformed, changing, or still-active lock is preserved with an explicit error. It finishes both colors of one committed opening in separate concurrent shards, verifies the complete pair from JSONL and reruns the same slots to ensure resume does not alter the record digest. Smoke results live in their own directory and **must never be appended to either formal sample**.

Before proceeding beyond the smoke gate, inspect each side's runtime search depth, node and elapsed totals in the real report; inspect the 300-ms request propagation, actual wall-clock budget adherence, CPU usage and per-process memory. A measured overrun or inconsistent module/feature configuration blocks the formal experiment. The two-shard smoke exercises parallel writers, not a claim of proven performance fairness. For a genuine interrupted-mid-game test, send SIGTERM to the smoke wrapper **while both real engine processes are active**, verify both child PIDs have exited, confirm the owned shard locks were removed, and repeat the exact smoke command; no partial JSONL game may be accepted. If the wrapper itself is forcibly killed, or a lock's token cannot be proven to belong to the exited writer, **do not forcibly delete a possibly live writer's lock**. Inspect its hostname, PID, run identity, and active processes; only manually remove a confirmed stale lock after the former owner has exited. Ordinary SIGTERM is handled by verified cleanup, not merely SIGKILL cases. Use a **new smoke name** if you intentionally change sample, source or flags.

After the smoke is verified, start the priority Phase 10 full sample:

~~~sh
bash research/scripts/phase12-4-run.sh phase10
bash research/scripts/phase12-4-run.sh report-p10
~~~

A stopped or crashed Phase 10 process can be resumed with **exactly the same phase10 invocation** in the same two frozen worktrees. The persisted manifest must agree on source SHA, baseline SHA, seed, feature flags, stop mode, 300-ms limit and 1-shard partition. Do not delete or edit JSONL or opening snapshots to force a resume. Inspect an orphaned lock and only clear it after confirming the previous writer exited.

Only after Phase 10 has a **complete, successfully audited 600-game dataset covering all 300 black/white pairs and no missing slots**, start Phase 11. The wrapper refuses Phase 11 unless the regenerated raw-JSONL audit reports exactly 600 games, 300 distinct openings, 300 complete pairs, zero unpaired/missing slots, the fixed 300-ms budget, the specified seed and single-shard fixed-sample mode. **An additional independent provenance gate** checks both recorded Git SHAs against `899fd35635db50dbf52abb54564a8a05a344b132`, compares exactly the explicit Phase 10 candidate/baseline feature overrides (independent of JSON key order), verifies the source fingerprint `SHA256(JSON.stringify(committedOpenings))`, reconstructs the exact seeded Fisher-Yates order and checks the saved snapshot hash and sorted JSONL record digest before allowing Phase 11:

~~~sh
bash research/scripts/phase12-4-run.sh phase11
bash research/scripts/phase12-4-run.sh report-p11
~~~

Phase 11 uses the same committed 300-opening source and seed but a separate immutable manifest, 600 new real game slots, and different feature overrides. Do **not** copy Phase 10 games into Phase 11. For partial or complete runs, the standalone report regenerates from experiment.json, openings.json and shard JSONL.

To add authentic collected results to the PR, **copy**, rather than move, the uniquely named result directories and corresponding summary files from the detached candidate worktree to research/results/kernel-sprt/ in this PR worktree, review the JSONL slot coverage and sha256 summary, then commit. Do not commit results that do not exist. Keep frozen execution worktrees intact until the 600-slot experiments are finished.

## 4. Prospective result accounting, 2026-11-07

| Measurement | Phase 10 search configuration | Phase 11 Texel evaluation |
| --- | --- | --- |
| Authentic completed games | **0 / 600** | **0 / 600** |
| Complete color pairs | **0 / 300** | **0 / 300** |
| Opening coverage | **0 / 300** | **0 / 300** |
| Wins / draws / losses | unavailable | unavailable |
| New prospective score / Elo | unavailable | unavailable |
| Fixed-sample paired 95% Elo CI | unavailable | unavailable |
| Search depth / nodes / actual elapsed | unavailable | unavailable |
| Sequential SPRT verdict | not applicable (fixed sample) | not applicable (fixed sample) |
| Raw games, prospective config/snapshot, summary | not generated | not generated |
| Missing slots | 600 | 600 |

No artificial placeholder JSONL, random games, reused historical games or invented confidence intervals were written.

### Historical comparisons (reference only, not Phase 12.4 data)

- Phase 10 final historical 100-ms gate: **+139 Elo [+63,+215]**, 92 games, only **58/300** openings.
- Phase 11 100-ms historical gate: **+137 Elo [+63,+211]**, 96 games, only **51/300** openings.
- Phase 11 complete matched 300-ms self-play 100-opening sample: **+33 Elo [-15,+81]** across 200 games.
- Phase 11 matched 300-ms Stockfish Skill 6 difference: **+23 Elo [-44,+89]**, 200 games per kernel.
- Neither Phase 10 nor Phase 11 historical strength gain has been independently confirmed on the prescribed 300-opening prospective sample.

Do not interpret partial fixed-sample Elo as a sequentially valid stopping decision. For the 600-slot target, calculate the paired-by-opening nominal 95% interval only from the complete paired records; show SPRT LLR separately as informational in "--full-pairs" mode. Incomplete pair or missing game counts and the four opening-family scores must be reported explicitly. Compare side-specific mean completed search depth, mean nodes/move and actual elapsed/move; numbers cannot be inferred from code inspection.

## 5. Next actions and outcome-dependent decision gate

1. Remove network/checkout/dependency blocker and **complete the genuine smoke gate**. Record real two-side search metrics, per-game wall time, peak resident memory, interruption/resume and simultaneous-shard result identity. Resolve any genuine harness defect with fresh source SHA / new experiment identity before collecting formal results.
2. Collect all **600** Phase 10 games at 300 ms before drawing a fixed-sample conclusion. Avoid CPU oversubscription; one shard is deliberately conservative without a measured engine throughput baseline. If interrupted, report raw slot IDs, counts and exact restart command, not an interim proof.
3. Then collect an independent **600** Phase 11 games. A positive point estimate alone does not demonstrate a gain: interpret paired CI and engine efficiency.
4. If Phase 10 confirms a benefit, consider independently held-out stronger-opponent checks. If Phase 11 stays uncertain, investigate evaluation generalization rather than immediately retraining. If most gain is nodes/depth per wall-clock unit, focus on performance. Stockfish-aided training needs separate confirmed evidence.
5. Keep kernel production default-off and all existing production engine behavior unchanged. No manual GitHub Actions dispatch/retry was requested or performed.

**Current phase is deliberately incomplete.** PR review should not mark Phase 12.4 as having fulfilled the 600-game acceptance criteria until raw authentic data and auditable reports are present.

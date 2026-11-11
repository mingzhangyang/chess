# Chess Phase 13.1: performance baseline and CPU profiling

Status: real Node 22 baseline and CPU diagnosis COMPLETE (2026-11-10).
Corrected Chromium/worker memory: supplemental desktop run complete; physical iPhone: NOT RUN.
Measured source: `2288b3a5f40a1ae65f8e150ca75a50f757f25a93`.

Report: [measured results and Phase 13.2 scopes](results/phase13-1-2026-11-10.md).
Evidence: [all search samples and CPU summary](results/phase13-1-2026-11-10.json).
Independent measured window: move generation/legality 31.19%, evaluation 23.09%,
make/undo/repetition 15.34%. Begin Phase 13.2 with an exact generator optimization;
this is a recommendation, not an implemented change or proven speedup.
Base main: 2224a908540cdcbc8182821ffbb423d31d53dd99 (merged PR #27).
Scope: measurement and diagnosis only; no engine search, tuning, gameplay, default
switch, Stockfish routing, deployment, or CI workflow changes.

## What existing results do and do not establish

Phase 8 tested the earlier independent kernel against legacy for 200 games at
300 ms/move: +564 Elo [+440,+688]. This does NOT measure the final Phase 11
kernel vs legacy. Phase 12.4 completed two separate 600-game internal kernel
configuration comparisons; do not rerun those games, add their Elo values, or
treat them as a direct comparison against legacy or Stockfish.

The saved browser-kernel-profile.json predates the correction that clears both
transposition tables before each benchmark sample. Its ~10x visit-rate gap is
historical, not a trustworthy cold-state speed ratio. The Phase 9 CPU shares
(move generation/legality about 34%; evaluation about 20%) are hypotheses to
recheck, not authoritative measurements of the latest kernel.

Search visits include main and quiescence nodes. Their unit of work is NOT
equal among chess.js, reference, and independent; prioritize equal-depth
elapsed time, completed depth at equal time, initialization, and real memory.

## Reproducible local-only commands

Requires Node 22, git, local dependencies (npm ci), committed/clean checkout.
Use an output path OUTSIDE the repository and never modify archived research
results. Use a unique directory for each fresh baseline, and the same directory
for subsequent phases of that baseline.

    node research/scripts/phase13-1-run.mjs plan
    npm ci
    node research/scripts/phase13-1-run.mjs capture --out=/tmp/chess-phase13-1
    node research/scripts/phase13-1-run.mjs profile --out=/tmp/chess-phase13-1
    node research/scripts/phase13-1-run.mjs report --out=/tmp/chess-phase13-1

Capture uses search-position-history-benchmark.ts: deterministic
complete-history ply-40/80 positions, five samples, legacy/reference/independent,
fixed depth 4 and 400 ms. It rejects incomplete samples, changed protocols,
invalid moves, incomplete fixed depths, inconsistent main/quiescence totals and stale medians. It also retains 20 boundary-only preparation samples after 5 warmups (history versus FEN-only), separately from the search benchmark. This is a small diagnostic set, not a broad
positional or game-playing experiment.

Profile bundles search-position-kernel-profile.ts and runs it in SEPARATE
Node processes for legacy and independent, each with 8 alternating rounds of
400 ms searches on the SAME fixtures. Inspector starts after fixture generation and warmup, and stops after the 16 measured requests. The named V8 root profileMeasuredSearch excludes driver overhead; rootless GC is accepted only from this bounded recording. Fixture identity is checked against capture. cpu-profile-summary.mjs extracts stack-aware category shares and function self milliseconds, percentages and sample counts (URL/line identities retained) for each; raw profiles remain in the output directory.
Compare absolute time-to-depth and GC as well as percentages.

Optional, on an environment with Playwright/Chromium:

    node research/scripts/phase13-1-run.mjs browser --out=/tmp/chess-phase13-1
    node research/scripts/phase13-1-run.mjs report --out=/tmp/chess-phase13-1

The browser stage resets BOTH search tables for every worker sample, verifies
source SHA and new harness revision, and refuses missing samples or fallback.
On cgroup-v1 systems it uses a CPU quota; on the current read-only cgroup-v2
container it uses a renderer-process signal duty-cycle fallback and records the
achieved factor. The fallback is not equivalent to a kernel quota. Historical
browser measurements without the revision are rejected. All simulated 1x/4x/6x
CPU measurements and the main-thread cross-check are desktop approximations,
NOT tests on a physical iPhone. The old device-side test instructions remain
in research/results/browser-kernel-profile.md.

Output: manifest.json (exact commit, lock SHA-256, Node, CPU, OS, CPU quota),
history.json, cpu-legacy and cpu-independent raw V8 profiles, profiles.json,
optional browser.json, summary.json, summary.md. Missing stages are marked
NOT RUN, never filled from archived or synthetic data. To regenerate a
summary after browser capture, use a fresh output directory or remove ONLY
the locally generated summary.json and summary.md files.

## Phase 13.1 acceptance gates

- [x] Verified clean SHA/lock/Node/environment and complete raw matrix
- [x] Current CPU profiles for BOTH backends and top three actual hot paths
- [x] Corrected real-worker Chromium measurement (supplemental fallback) OR explicitly NOT RUN
- [x] Real iPhone cold/warm search and memory OR explicitly NOT RUN
- [x] Phase 13.2 prioritization grounded in measured fixed-depth time
- [x] No production algorithm changes, no new matches, no manual GitHub CI

Measurement corrections in this continuation:
- Earlier whole-process GC attribution included fixture/warmup GC; bounded Inspector capture fixes it.
- Legacy `_moves`/`_makeMove`/`_undoMove` inside search are no longer labelled setup. Boundary reconstruction is separated by call stack.
- Main and quiescence counts are retained separately. Cross-backend defaults differ (Independent has accepted SEE/tuned evaluation); equal-depth ratios are end-to-end observations, not proof of equal-tree execution speed.
- PR #28's original test typing error is corrected. The shell sandbox denies Node spawnSync (EPERM); local verification and capture need the approved outer executor.

Measurement-tool fixes are committed before capture to give raw data a clean, immutable source SHA. Results/documentation follow in one final result commit. No production source changes.

See Phase 8, 9, 12.4 research reports and the browser profile report.

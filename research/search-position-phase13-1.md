# Chess Phase 13.1: performance baseline and CPU profiling

Status: instrumentation ready for review; NO new engine measurements claimed.
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

Capture reuses search-position-history-benchmark.ts unchanged: deterministic
complete-history ply-40/80 positions, five samples, legacy/reference/independent,
fixed depth 4 and 400 ms. It rejects incomplete samples, changed protocols,
invalid moves and stale medians. This is a small diagnostic set, not a broad
positional or game-playing experiment.

Profile bundles search-position-kernel-profile.ts and runs it in SEPARATE
Node processes for legacy and independent, each with 8 alternating rounds of
400 ms searches on the SAME fixtures. It uses the named V8 profiler root
profileMeasuredSearch, so benchmark-fixture self-play is not included in CPU
sample attribution. The existing cpu-profile-summary.mjs extracts category
and function shares for each; raw profiles remain in the output directory.
Compare absolute time-to-depth and GC as well as percentages.

Optional, on an environment with Playwright/Chromium and Linux cgroup v1/root:

    node research/scripts/phase13-1-run.mjs browser --out=/tmp/chess-phase13-1
    node research/scripts/phase13-1-run.mjs report --out=/tmp/chess-phase13-1

The browser stage resets BOTH search tables for every worker sample, verifies
source SHA and new harness revision, and refuses missing samples or fallback.
Historical browser measurements without the revision are rejected. The
simulated 1x/4x/6x CPU measurements and a main-thread cross-check are still
desktop approximations, NOT tests on a physical iPhone. The old device-side
test instructions remain in research/results/browser-kernel-profile.md.

Output: manifest.json (exact commit, lock SHA-256, Node, CPU, OS, CPU quota),
history.json, cpu-legacy and cpu-independent raw V8 profiles, profiles.json,
optional browser.json, summary.json, summary.md. Missing stages are marked
NOT RUN, never filled from archived or synthetic data. To regenerate a
summary after browser capture, use a fresh output directory or remove ONLY
the locally generated summary.json and summary.md files.

## Phase 13.1 acceptance gates

- [ ] Verified clean SHA/lock/Node/environment and complete raw matrix
- [ ] Current CPU profiles for BOTH backends and top three actual hot paths
- [ ] Corrected real-worker Chromium measurement OR explicitly NOT RUN
- [ ] Real iPhone cold/warm search and memory OR explicitly NOT RUN
- [ ] Phase 13.2 prioritization grounded in measured fixed-depth time
- [ ] No production algorithm changes, no new matches, no manual GitHub CI

In the development environment, checkout/npm dependencies may be inaccessible.
Do not claim local engine runs or iPhone benchmarks without raw results.

See Phase 8, 9, 12.4 research reports and the browser profile report.

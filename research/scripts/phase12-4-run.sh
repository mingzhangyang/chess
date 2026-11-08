#!/usr/bin/env bash
# Phase 12.4: genuine Phase 12.3 chess matches on two frozen, isolated worktrees.
# Never generates simulated games, never rewrites historical match results.
set -euo pipefail

SOURCE_SHA=899fd35635db50dbf52abb54564a8a05a344b132
SEED=99537187
ROOT="$(git rev-parse --show-toplevel)"
CANDIDATE="$(dirname "$ROOT")/.chess-phase12-4-candidate"
BASELINE="$(dirname "$ROOT")/.chess-phase12-4-baseline"
SMOKE=phase12-4-smoke-300ms-899fd356
P10=phase12-4-p10-300ms-899fd356
P11=phase12-4-p11-300ms-899fd356
NO_TUNE='{"persistentTable":true,"seeQuiescence":true,"seeOrdering":true,"tunedEvaluation":false}'
TUNED='{"persistentTable":true,"seeQuiescence":true,"seeOrdering":true,"tunedEvaluation":true}'
NO_P10='{"persistentTable":false,"seeQuiescence":false,"seeOrdering":false,"tunedEvaluation":false}'

check_roots() {
  [[ -d "$CANDIDATE/.git" || -f "$CANDIDATE/.git" ]] || { echo 'Missing candidate worktree: run prepare' >&2; exit 1; }
  [[ -d "$BASELINE/.git" || -f "$BASELINE/.git" ]] || { echo 'Missing baseline worktree: run prepare' >&2; exit 1; }
  for dir in "$CANDIDATE" "$BASELINE"; do
    [[ "$(git -C "$dir" rev-parse HEAD)" == "$SOURCE_SHA" ]] || { echo "Unpinned HEAD: $dir" >&2; exit 1; }
    [[ -z "$(git -C "$dir" status --porcelain --untracked-files=no)" ]] || { echo "Tracked files modified: $dir" >&2; exit 1; }
  done
  [[ "$(realpath "$CANDIDATE")" != "$(realpath "$BASELINE")" ]] || { echo 'Worktrees alias one another' >&2; exit 1; }
  [[ -d "$CANDIDATE/node_modules" ]] || { echo 'Missing candidate node_modules: run prepare' >&2; exit 1; }
  [[ -d "$BASELINE/node_modules" ]] || { echo 'Missing baseline node_modules: run prepare' >&2; exit 1; }
}

report() {
  local name="$1"
  ( cd "$CANDIDATE"
    node --import tsx research/scripts/sprt-prospective-report.ts "$name" \
      --output "research/results/kernel-sprt/$name-summary.json" )
}

# Every launched gate must be a direct, waitable Node process. In particular,
# never background run_gate() itself: that leaves an extra bash parent which can
# exit while its engine keeps writing JSONL and holding the shard lock.
active_gate_pids=()
last_gate_pid=''

stop_gate_processes() {
  trap - EXIT INT TERM HUP
  local pid
  # Forward termination to both running engine processes before reaping either.
  for pid in "${active_gate_pids[@]}"; do kill -TERM "$pid" 2>/dev/null || true; done
  for pid in "${active_gate_pids[@]}"; do wait "$pid" 2>/dev/null || true; done
  active_gate_pids=()
}

trap 'stop_gate_processes; exit 143' TERM
trap 'stop_gate_processes; exit 130' INT
trap 'stop_gate_processes; exit 129' HUP
trap 'stop_gate_processes' EXIT

launch_gate() {
  local name="$1" shard="$2" new_flags="$3" base_flags="$4"
  shift 4
  (
    cd "$CANDIDATE"
    # exec replaces this background subshell: $! identifies the actual engine
    # Node process (the two adapters are modules loaded inside that Node).
    exec node --import tsx research/scripts/kernel-sprt.ts \
      --name "$name" --base "$BASELINE" --shard "$shard" \
      --move-time 300 --opening-seed "$SEED" --full-pairs \
      --new-features "$new_flags" --base-features "$base_flags" "$@"
  ) &
  last_gate_pid=$!
  active_gate_pids+=("$last_gate_pid")
}

wait_gate() {
  local pid="$1" status=0 child
  local -a remaining=()
  wait "$pid" || status=$?
  for child in "${active_gate_pids[@]}"; do
    [[ "$child" == "$pid" ]] || remaining+=("$child")
  done
  active_gate_pids=("${remaining[@]}")
  return "$status"
}

run_gate() {
  launch_gate "$@"
  wait_gate "$last_gate_pid"
}

case "${1:-}" in
  prepare)
    git -C "$ROOT" cat-file -e "${SOURCE_SHA}^{commit}"
    [[ -e "$CANDIDATE" ]] || git -C "$ROOT" worktree add --detach "$CANDIDATE" "$SOURCE_SHA"
    [[ -e "$BASELINE" ]] || git -C "$ROOT" worktree add --detach "$BASELINE" "$SOURCE_SHA"
    [[ -d "$CANDIDATE/node_modules" ]] || ( cd "$CANDIDATE" && npm ci )
    [[ -e "$BASELINE/node_modules" ]] || ln -s "$CANDIDATE/node_modules" "$BASELINE/node_modules"
    check_roots
    echo "Two independent detached worktrees pinned to $SOURCE_SHA"
    ;;
  preflight)
    check_roots
    echo "candidate=$(git -C "$CANDIDATE" rev-parse HEAD)"
    echo "baseline=$(git -C "$BASELINE" rev-parse HEAD)"
    node --version
    npm --version
    getconf _NPROCESSORS_ONLN || true
    [[ ! -f /sys/fs/cgroup/cpu.max ]] || cat /sys/fs/cgroup/cpu.max
    [[ ! -f /sys/fs/cgroup/memory.max ]] || cat /sys/fs/cgroup/memory.max
    ( cd "$CANDIDATE"
      npm run lint
      node --import tsx --test tests/research/sprtProspective.test.ts \
        tests/research/sprtOpenings.test.ts tests/research/sprtCalibration.test.ts )
    ;;
  smoke)
    check_roots
    sample="$CANDIDATE/research/results/kernel-sprt/phase12-4-smoke-source.json"
    SAMPLE_PATH="$sample" SOURCE_PATH="$CANDIDATE/research/results/kernel-sprt/openings.json" node <<'JS'
const fs = require('node:fs');
const source = JSON.parse(fs.readFileSync(process.env.SOURCE_PATH, 'utf8'));
if (!Array.isArray(source) || source.length !== 300) throw new Error('expected committed 300-opening source');
const wanted = JSON.stringify([source[0]]) + '\n';
const name = process.env.SAMPLE_PATH;
if (fs.existsSync(name) && fs.readFileSync(name, 'utf8') !== wanted) throw new Error('smoke opening source changed');
if (!fs.existsSync(name)) fs.writeFileSync(name, wanted, { flag: 'wx' });
JS
    launch_gate "$SMOKE" 0/2 "$NO_TUNE" "$NO_P10" --openings-file "$sample" --max-games 2
    p0="$last_gate_pid"
    launch_gate "$SMOKE" 1/2 "$NO_TUNE" "$NO_P10" --openings-file "$sample" --max-games 2
    p1="$last_gate_pid"
    failure=0
    wait_gate "$p0" || failure=1
    wait_gate "$p1" || failure=1
    [[ "$failure" == 0 ]] || exit 1
    report "$SMOKE"
    ( cd "$CANDIDATE"
      node -e 'const a=require(process.argv[1]);if(a.games!==2||a.completeColorPairs!==1||a.unpairedSlots!==0)process.exit(1)' \
        "./research/results/kernel-sprt/$SMOKE-summary.json" )
    before="$(cd "$CANDIDATE" && node -e 'const a=require(process.argv[1]);process.stdout.write(a.recordsSha256)' "./research/results/kernel-sprt/$SMOKE-summary.json")"
    run_gate "$SMOKE" 0/2 "$NO_TUNE" "$NO_P10" --openings-file "$sample" --max-games 2
    run_gate "$SMOKE" 1/2 "$NO_TUNE" "$NO_P10" --openings-file "$sample" --max-games 2
    report "$SMOKE"
    after="$(cd "$CANDIDATE" && node -e 'const a=require(process.argv[1]);process.stdout.write(a.recordsSha256)' "./research/results/kernel-sprt/$SMOKE-summary.json")"
    [[ "$before" == "$after" ]] || { echo 'Resume changed committed smoke records' >&2; exit 1; }
    echo 'Smoke completed as a genuine color pair; restart preserved the record digest.'
    ;;
  phase10)
    check_roots
    run_gate "$P10" 0/1 "$NO_TUNE" "$NO_P10"
    report "$P10"
    ;;
  phase11)
    check_roots
    [[ -f "$CANDIDATE/research/results/kernel-sprt/$P10/experiment.json" ]] || { echo 'Run Phase 10 first' >&2; exit 1; }
    report "$P10"
    ( cd "$CANDIDATE"
      # This report was regenerated by the strict JSONL/snapshot auditor above.
      # A single completed pair is insufficient: all fixed slots are mandatory.
      node -e '
        const r = require(process.argv[1]);
        const ready = r.status === "complete" &&
          r.games === 600 && r.totalSlots === 600 &&
          r.openings === 300 && r.distinctOpenings === 300 &&
          r.completeColorPairs === 300 && r.unpairedSlots === 0 &&
          Array.isArray(r.missingSlotIds) && r.missingSlotIds.length === 0 &&
          r.manifest?.moveTimeMs === 300 &&
          r.manifest?.stopAtVerdict === false &&
          r.manifest?.openingOrder?.seed === 99537187 &&
          r.manifest?.shards === 1;
        if (!ready) {
          console.error("Phase 11 blocked: Phase 10 needs all 600 audited games, 300 color pairs and zero missing slots.");
          process.exit(1);
        }
      ' "./research/results/kernel-sprt/$P10-summary.json" )
    run_gate "$P11" 0/1 "$TUNED" "$NO_TUNE"
    report "$P11"
    ;;
  report-p10) check_roots; report "$P10" ;;
  report-p11) check_roots; report "$P11" ;;
  report-smoke) check_roots; report "$SMOKE" ;;
  *)
    echo 'Usage: bash research/scripts/phase12-4-run.sh {prepare|preflight|smoke|phase10|phase11|report-p10|report-p11|report-smoke}' >&2
    exit 2
    ;;
esac

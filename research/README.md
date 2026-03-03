# Chess AI Research Workspace

Updated: 2026-03-03 (America/New_York)

This directory is a local research memory system for upgrading single-player AI from "strong hobby engine" to a more reliable expert-level design.

## Files

- `current-implementation-audit.md`
  - What the current AI already does well.
  - Why it still plateaus below expert level.
- `external-sources.md`
  - Curated external references (papers/docs/source) and key takeaways.
- `proposed-expert-architecture.md`
  - A complete target architecture and phased execution plan (no code changes yet).
- `claude-report-assessment.md`
  - Critical assessment of the external Claude report:
  - what to adopt now, what to validate, and safe rollout order.
- `expert-upgrade-playbook.md`
  - Detailed execution playbook with measurable targets, phase-by-phase tasks,
  - code touch points, validation gates, and risk controls.
- `expert-upgrade-checklist.md`
  - Directly checkable task list for progress tracking across sessions.
- `session-handoff-template.md`
  - Structured template for cross-session progress handoff.
- `phaseA-benchmark-2026-03-03.md`
  - Baseline vs Phase-A benchmark snapshot (nodes/qNodes/depth/time/tactical smoke).
- `phaseB1-benchmark-2026-03-03.md`
  - Phase-A vs B1(LMR table) benchmark snapshot (depth/time/tactical smoke).
- `phaseB2-benchmark-2026-03-03.md`
  - B1 baseline vs B2(history malus + countermove) benchmark snapshot.
- `phaseC21-benchmark-2026-03-03.md`
  - C1 baseline vs C2.1(nonlinear king safety) benchmark snapshot.
- `phaseC22-benchmark-2026-03-03.md`
  - C2.1 baseline vs C2.2(backward pawn) benchmark snapshot.
- `phaseC23-benchmark-2026-03-03.md`
  - C2.2 baseline vs C2.3(knight outpost) benchmark snapshot.
- `phaseC24-benchmark-2026-03-03.md`
  - C2.3 baseline vs C2.4(passed pawn king-distance) benchmark snapshot.
- `phaseC25-benchmark-2026-03-03.md`
  - C2.4 baseline vs C2.5(rook behind passed pawn) benchmark snapshot.
- `phaseC26-benchmark-2026-03-03.md`
  - C2.5 baseline vs C2.6(tempo bonus) benchmark snapshot.

## Scope

- No gameplay logic changed in this research step.
- Focus is on algorithm architecture, strength ceiling, deployment constraints, and validation methodology.

# Phase A Benchmark Report

- Date: 2026-03-03T16:07:07.231Z
- Branch: main
- Commit: ae150eb
- Node: v22.15.0
- Platform: linux 6.6.87.2-microsoft-standard-WSL2
- CPU: AMD Ryzen 7 4700U with Radeon Graphics (8 cores)
- Scenarios: 8
- Runs per scenario/config: 3
- Time limit per move: 500ms

## Aggregate Metrics

| Metric | Baseline | PhaseA | Delta (PhaseA vs Baseline) |
| Samples | 24 | 24 | - |
| Avg ms | 2344.98 | 1331.71 | -43.21% |
| Median ms | 1197.48 | 732.24 | -38.85% |
| Avg nodes | 800 | 906 | +13.25% |
| Avg qNodes | 646 | 459 | -29.04% |
| qNode ratio | 0.8080 | 0.5062 | -37.35% |
| Avg depth | 3.54 | 4.54 | +28.24% |
| Avg RFP prunes | 0.00 | 73.79 | n/a |
| Avg FP prunes | 0.00 | 84.75 | n/a |
| Avg LMP prunes | 0.00 | 194.21 | n/a |

## Tactical Smoke Check

### baseline
- Passed: 4/4
- Mate-In-One: pass
- Avoid-Rook-Blunder: pass
- Promote-Passed-Pawn: pass
- Passed-Pawn-Race: pass

### phaseA
- Passed: 4/4
- Mate-In-One: pass
- Avoid-Rook-Blunder: pass
- Promote-Passed-Pawn: pass
- Passed-Pawn-Race: pass

## Notes

- Baseline: all Phase-A toggles off.
- PhaseA: NMP static guard + Q delta + RFP + FP + LMP enabled.
- All runs use search-only configuration (opening book disabled).
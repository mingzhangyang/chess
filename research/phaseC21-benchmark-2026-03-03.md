# Phase C2.1 Benchmark Report

- Date: 2026-03-03T16:50:19.563Z
- Branch: main
- Commit: ae150eb
- Node: v22.15.0
- Platform: linux 6.6.87.2-microsoft-standard-WSL2
- CPU: AMD Ryzen 7 4700U with Radeon Graphics (8 cores)
- Scenarios: 6
- Runs per scenario/config: 3
- Time limit per move: 500ms

## Aggregate Metrics

| Metric | C1 | C1+C2.1 | Delta (C2.1 vs C1) |
| Samples | 18 | 18 | - |
| Avg ms | 3433.78 | 2070.04 | -39.72% |
| Median ms | 1460.02 | 1527.74 | +4.64% |
| Avg nodes | 831 | 961 | +15.68% |
| Avg qNodes | 692 | 610 | -11.86% |
| qNode ratio | 0.8325 | 0.6342 | -23.81% |
| Avg depth | 3.11 | 3.50 | +12.50% |

## Tactical Smoke Check

### c1
- Passed: 4/4
- Mate-In-One: pass
- Avoid-Rook-Blunder: pass
- Preserve-Shield: pass
- Promote-Passed-Pawn: pass

### c1+c2.1
- Passed: 4/4
- Mate-In-One: pass
- Avoid-Rook-Blunder: pass
- Preserve-Shield: pass
- Promote-Passed-Pawn: pass

## Notes

- C1: tapered eval enabled, nonlinear king safety disabled.
- C1+C2.1: nonlinear king safety enabled on top of C1.
- All runs use search-only configuration (opening book disabled).
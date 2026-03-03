# Phase C2.3 Benchmark Report

- Date: 2026-03-03T17:08:57.363Z
- Branch: main
- Commit: ae150eb
- Node: v22.15.0
- Platform: linux 6.6.87.2-microsoft-standard-WSL2
- CPU: AMD Ryzen 7 4700U with Radeon Graphics (8 cores)
- Scenarios: 6
- Runs per scenario/config: 3
- Time limit per move: 500ms

## Aggregate Metrics

| Metric | C1+C2.1+C2.2 | C1+C2.1+C2.2+C2.3 | Delta (C2.3 vs C2.2) |
| Samples | 18 | 18 | - |
| Avg ms | 3324.03 | 2253.08 | -32.22% |
| Median ms | 847.86 | 1207.53 | +42.42% |
| Avg nodes | 740 | 975 | +31.75% |
| Avg qNodes | 717 | 556 | -22.45% |
| qNode ratio | 0.9680 | 0.5698 | -41.14% |
| Avg depth | 2.56 | 3.78 | +47.83% |

## Tactical Smoke Check

### c1+c2.1+c2.2
- Passed: 4/4
- Mate-In-One: pass
- Avoid-Rook-Blunder: pass
- Preserve-Shield: pass
- Promote-Passed-Pawn: pass

### c1+c2.1+c2.2+c2.3
- Passed: 4/4
- Mate-In-One: pass
- Avoid-Rook-Blunder: pass
- Preserve-Shield: pass
- Promote-Passed-Pawn: pass

## Notes

- C1+C2.1+C2.2: nonlinear king safety + backward pawn enabled, knight outpost disabled.
- C1+C2.1+C2.2+C2.3: knight outpost enabled on top of C2.2.
- All runs use search-only configuration (opening book disabled).
# Phase C2.4 Benchmark Report

- Date: 2026-03-03T17:15:44.687Z
- Branch: main
- Commit: ae150eb
- Node: v22.15.0
- Platform: linux 6.6.87.2-microsoft-standard-WSL2
- CPU: AMD Ryzen 7 4700U with Radeon Graphics (8 cores)
- Scenarios: 6
- Runs per scenario/config: 3
- Time limit per move: 500ms

## Aggregate Metrics

| Metric | C1+C2.1+C2.2+C2.3 | C1+C2.1+C2.2+C2.3+C2.4 | Delta (C2.4 vs C2.3) |
| Samples | 18 | 18 | - |
| Avg ms | 2924.90 | 3308.01 | +13.10% |
| Median ms | 1099.55 | 1668.18 | +51.71% |
| Avg nodes | 734 | 1005 | +36.92% |
| Avg qNodes | 615 | 737 | +19.88% |
| qNode ratio | 0.8374 | 0.7332 | -12.44% |
| Avg depth | 2.78 | 3.83 | +38.00% |

## Tactical Smoke Check

### c1+c2.1+c2.2+c2.3
- Passed: 4/4
- Mate-In-One: pass
- Avoid-Rook-Blunder: pass
- Preserve-Shield: pass
- Promote-Passed-Pawn: pass

### c1+c2.1+c2.2+c2.3+c2.4
- Passed: 4/4
- Mate-In-One: pass
- Avoid-Rook-Blunder: pass
- Preserve-Shield: pass
- Promote-Passed-Pawn: pass

## Notes

- C1+C2.1+C2.2+C2.3: nonlinear king safety + backward pawn + knight outpost enabled.
- C1+C2.1+C2.2+C2.3+C2.4: passed pawn king-distance enabled on top of C2.3.
- All runs use search-only configuration (opening book disabled).
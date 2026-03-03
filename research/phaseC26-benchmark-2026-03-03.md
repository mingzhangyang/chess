# Phase C2.6 Benchmark Report

- Date: 2026-03-03T17:27:44.122Z
- Branch: main
- Commit: ae150eb
- Node: v22.15.0
- Platform: linux 6.6.87.2-microsoft-standard-WSL2
- CPU: AMD Ryzen 7 4700U with Radeon Graphics (8 cores)
- Scenarios: 6
- Runs per scenario/config: 3
- Time limit per move: 500ms

## Aggregate Metrics

| Metric | C1+C2.1+C2.2+C2.3+C2.4+C2.5 | C1+C2.1+C2.2+C2.3+C2.4+C2.5+C2.6 | Delta (C2.6 vs C2.5) |
| Samples | 18 | 18 | - |
| Avg ms | 2774.00 | 1183.37 | -57.34% |
| Median ms | 1105.66 | 714.97 | -35.34% |
| Avg nodes | 780 | 809 | +3.69% |
| Avg qNodes | 635 | 468 | -26.30% |
| qNode ratio | 0.8137 | 0.5784 | -28.92% |
| Avg depth | 2.94 | 3.44 | +16.98% |

## Tactical Smoke Check

### c1+c2.1+c2.2+c2.3+c2.4+c2.5
- Passed: 4/4
- Mate-In-One: pass
- Avoid-Rook-Blunder: pass
- Preserve-Shield: pass
- Promote-Passed-Pawn: pass

### c1+c2.1+c2.2+c2.3+c2.4+c2.5+c2.6
- Passed: 4/4
- Mate-In-One: pass
- Avoid-Rook-Blunder: pass
- Preserve-Shield: pass
- Promote-Passed-Pawn: pass

## Notes

- C1+C2.1+C2.2+C2.3+C2.4+C2.5: nonlinear king safety + backward pawn + knight outpost + passed pawn king-distance + rook-behind-passed-pawn enabled.
- C1+C2.1+C2.2+C2.3+C2.4+C2.5+C2.6: tempo bonus enabled on top of C2.5.
- All runs use search-only configuration (opening book disabled).
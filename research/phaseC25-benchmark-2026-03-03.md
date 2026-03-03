# Phase C2.5 Benchmark Report

- Date: 2026-03-03T17:22:25.078Z
- Branch: main
- Commit: ae150eb
- Node: v22.15.0
- Platform: linux 6.6.87.2-microsoft-standard-WSL2
- CPU: AMD Ryzen 7 4700U with Radeon Graphics (8 cores)
- Scenarios: 6
- Runs per scenario/config: 3
- Time limit per move: 500ms

## Aggregate Metrics

| Metric | C1+C2.1+C2.2+C2.3+C2.4 | C1+C2.1+C2.2+C2.3+C2.4+C2.5 | Delta (C2.5 vs C2.4) |
| Samples | 18 | 18 | - |
| Avg ms | 3082.83 | 1759.97 | -42.91% |
| Median ms | 1379.71 | 1429.97 | +3.64% |
| Avg nodes | 795 | 812 | +2.10% |
| Avg qNodes | 658 | 512 | -22.18% |
| qNode ratio | 0.8276 | 0.6308 | -23.78% |
| Avg depth | 2.89 | 3.17 | +9.62% |

## Tactical Smoke Check

### c1+c2.1+c2.2+c2.3+c2.4
- Passed: 4/4
- Mate-In-One: pass
- Avoid-Rook-Blunder: pass
- Preserve-Shield: pass
- Promote-Passed-Pawn: pass

### c1+c2.1+c2.2+c2.3+c2.4+c2.5
- Passed: 4/4
- Mate-In-One: pass
- Avoid-Rook-Blunder: pass
- Preserve-Shield: pass
- Promote-Passed-Pawn: pass

## Notes

- C1+C2.1+C2.2+C2.3+C2.4: nonlinear king safety + backward pawn + knight outpost + passed pawn king-distance enabled.
- C1+C2.1+C2.2+C2.3+C2.4+C2.5: rook behind passed pawn enabled on top of C2.4.
- All runs use search-only configuration (opening book disabled).
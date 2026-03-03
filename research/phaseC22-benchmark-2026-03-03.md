# Phase C2.2 Benchmark Report

- Date: 2026-03-03T16:57:45.497Z
- Branch: main
- Commit: ae150eb
- Node: v22.15.0
- Platform: linux 6.6.87.2-microsoft-standard-WSL2
- CPU: AMD Ryzen 7 4700U with Radeon Graphics (8 cores)
- Scenarios: 6
- Runs per scenario/config: 3
- Time limit per move: 500ms

## Aggregate Metrics

| Metric | C1+C2.1 | C1+C2.1+C2.2 | Delta (C2.2 vs C1+C2.1) |
| Samples | 18 | 18 | - |
| Avg ms | 2850.62 | 2062.26 | -27.66% |
| Median ms | 840.34 | 1200.05 | +42.81% |
| Avg nodes | 752 | 968 | +28.73% |
| Avg qNodes | 643 | 616 | -4.25% |
| qNode ratio | 0.8549 | 0.6359 | -25.62% |
| Avg depth | 3.11 | 3.94 | +26.79% |

## Tactical Smoke Check

### c1+c2.1
- Passed: 4/4
- Mate-In-One: pass
- Avoid-Rook-Blunder: pass
- Preserve-Shield: pass
- Promote-Passed-Pawn: pass

### c1+c2.1+c2.2
- Passed: 4/4
- Mate-In-One: pass
- Avoid-Rook-Blunder: pass
- Preserve-Shield: pass
- Promote-Passed-Pawn: pass

## Notes

- C1+C2.1: nonlinear king safety enabled, backward pawn disabled.
- C1+C2.1+C2.2: backward pawn enabled on top of C2.1.
- All runs use search-only configuration (opening book disabled).
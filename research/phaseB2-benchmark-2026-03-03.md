# Phase B2 Benchmark Report

- Date: 2026-03-03T16:28:16.751Z
- Branch: main
- Commit: ae150eb
- Node: v22.15.0
- Platform: linux 6.6.87.2-microsoft-standard-WSL2
- CPU: AMD Ryzen 7 4700U with Radeon Graphics (8 cores)
- Scenarios: 8
- Runs per scenario/config: 3
- Time limit per move: 500ms

## Aggregate Metrics

| Metric | PhaseA+B1 | PhaseA+B1+B2 | Delta (B2 vs PhaseA+B1) |
| Samples | 24 | 24 | - |
| Avg ms | 2569.42 | 1598.87 | -37.77% |
| Median ms | 958.67 | 744.70 | -22.32% |
| Avg nodes | 826 | 926 | +12.05% |
| Avg qNodes | 595 | 534 | -10.11% |
| qNode ratio | 0.7195 | 0.5772 | -19.78% |
| Avg depth | 3.50 | 4.46 | +27.38% |
| Avg RFP prunes | 55.17 | 50.13 | -9.14% |
| Avg FP prunes | 82.29 | 51.04 | -37.97% |
| Avg LMP prunes | 190.29 | 37.25 | -80.42% |

## Tactical Smoke Check

### phaseA+B1
- Passed: 4/4
- Mate-In-One: pass
- Avoid-Rook-Blunder: pass
- Promote-Passed-Pawn: pass
- Passed-Pawn-Race: pass

### phaseA+B1+B2
- Passed: 4/4
- Mate-In-One: pass
- Avoid-Rook-Blunder: pass
- Promote-Passed-Pawn: pass
- Passed-Pawn-Race: pass

## Notes

- PhaseA+B1: A1-A4 + B1 enabled.
- PhaseA+B1+B2: `enableHistoryMalus=true`, `enableCountermove=true` on top of B1.
- All runs use search-only configuration (opening book disabled).
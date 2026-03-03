# Phase B1 Benchmark Report

- Date: 2026-03-03T16:18:38.249Z
- Branch: main
- Commit: ae150eb
- Node: v22.15.0
- Platform: linux 6.6.87.2-microsoft-standard-WSL2
- CPU: AMD Ryzen 7 4700U with Radeon Graphics (8 cores)
- Scenarios: 8
- Runs per scenario/config: 3
- Time limit per move: 500ms

## Aggregate Metrics

| Metric | PhaseA | PhaseA+B1 | Delta (B1 vs PhaseA) |
| Samples | 24 | 24 | - |
| Avg ms | 2860.03 | 1400.10 | -51.05% |
| Median ms | 1152.43 | 631.68 | -45.19% |
| Avg nodes | 866 | 861 | -0.52% |
| Avg qNodes | 627 | 460 | -26.55% |
| qNode ratio | 0.7241 | 0.5346 | -26.16% |
| Avg depth | 3.79 | 4.08 | +7.69% |
| Avg RFP prunes | 67.88 | 70.79 | +4.30% |
| Avg FP prunes | 73.63 | 55.54 | -24.56% |
| Avg LMP prunes | 183.50 | 62.17 | -66.12% |

## Tactical Smoke Check

### phaseA
- Passed: 4/4
- Mate-In-One: pass
- Avoid-Rook-Blunder: pass
- Promote-Passed-Pawn: pass
- Passed-Pawn-Race: pass

### phaseA+B1
- Passed: 4/4
- Mate-In-One: pass
- Avoid-Rook-Blunder: pass
- Promote-Passed-Pawn: pass
- Passed-Pawn-Race: pass

## Notes

- PhaseA: A1-A4 toggles enabled, LMR table disabled.
- PhaseA+B1: identical config with `enableLmrTable=true`.
- All runs use search-only configuration (opening book disabled).
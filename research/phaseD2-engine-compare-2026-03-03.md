# Phase D2 Engine Comparison (TypeScript vs stockfish.wasm)

- Date: 2026-03-03T18:57:52.318Z
- Node: v22.15.0
- Platform: linux 6.6.87.2-microsoft-standard-WSL2
- CPU: AMD Ryzen 7 4700U with Radeon Graphics (8 cores)
- Runs per scenario/engine: 2
- Scenario count: 6
- Move time limit: 700ms

## Performance

| Metric | TypeScript Engine | stockfish.wasm | Delta (stockfish vs TS) |
| Samples | 12 | 12 | - |
| Avg ms | 2765.02 | 716.23 | -74.10% |
| P50 ms | 1100.48 | 715.34 | -35.00% |
| P95 ms | 16136.74 | 724.05 | -95.51% |
| Avg depth (TS only) | 2.50 | - | - |
| Avg nodes (TS only) | 628 | - | - |
| Avg qNodes (TS only) | 585 | - | - |

## Tactical Smoke

### TypeScript Engine (4/4)
- Mate-In-One: pass
- Forced-King-Capture: pass
- Promote-Passed-Pawn: pass
- Avoid-Rook-Blunder: pass

### stockfish.wasm (4/4)
- Mate-In-One: pass
- Forced-King-Capture: pass
- Promote-Passed-Pawn: pass
- Avoid-Rook-Blunder: pass

## Notes

- For TS engine, opening book and move randomness were disabled for deterministic benchmarking.
- stockfish.wasm benchmarking under Node uses a local fetch patch for absolute/file URLs so package assets can be loaded from `node_modules`.
- stockfish.wasm outputs UCI moves; TS engine outputs SAN. Tactical validation normalizes both forms by applying moves on `chess.js`.

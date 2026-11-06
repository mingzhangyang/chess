# Independent TypeScript search: phase 3

This is the historical phase 3 description. Phase 4 replaced the repetition
ledger and the snapshot-based transposition table described below; see
`search-position-phase4.md` for the current design and a benchmark with real
game history.

The independent position can run the existing evaluation, root search, PVS,
quiescence, move ordering, history/killer/countermove heuristics, LMR, futility
pruning and null-move pruning through the internal `searchForComparison` entry
point. The production worker, Stockfish fallback routing, default TS search and
Easy safety path do not select it. There is no player-facing engine selector.
The comparison runs actual search without the opening book, for medium, hard or
expert, using the same tuning and root band-selection logic as the current path.

## Boundaries and rules

The entry first uses the existing TS adapter to validate every UCI history move
and its final FEN; it then replays that already-validated history into the new
position once. A supplied `historyStartFen` is its starting position, and
`historyTruncated: true` declares an incomplete history. A bare non-start FEN
is also incomplete; `start` and history from the standard initial position are complete. A
custom starting FEN requires the explicit assertion `historyTruncated: false`
to be considered complete from that starting point; otherwise it is unknown. Three observed occurrences prove a
draw even with incomplete history. With fewer observed occurrences the result
remains **unknown**: search continues as an explicitly provisional estimate,
never calls the position certainly non-repeated, and disables independent TT
score reuse for that history. It cannot recover occurrences that were omitted.
This conservative policy is not sufficient to adjudicate an actual game.

The independent table is private to a comparison search and isolated from the
production/shared table. Its index includes the board hash, halfmove clocks,
and a repetition fingerprint; lookup verifies the complete board, side,
castling, legal en-passant, clocks, every history identity and count. The table
is also scoped to the search perspective and exact tuning, and mate scores use
the existing ply normalization. The estimated total snapshot footprint is capped
at 16 MiB, evicting older entries when longer histories consume the budget;
actual JavaScript heap use also includes map and runtime overhead. A hash or history fingerprint collision cannot
by itself match a score. A synthetic null move starts an incomplete repetition
scope, so it cannot add to the real ledger or reuse history-dependent scores.
Its displayed clock advances for existing state semantics, while a separate
rule clock ensures the pass itself cannot trigger a premature fifty-move draw.
Both clocks and the repetition scope unwind on undo. Search uses `try/finally`
for real and null moves. The experiment resets its TT, killers, history and
countermoves between comparisons and on abort or exception.

The boundary returns SAN only after the chosen move is found among chess.js's
legal moves on the original root. Search nodes do not construct chess.js games,
serialize FEN, or replay history. Evaluation reuses the exact old evaluator on a
board view of the independent position. Checkmate takes priority over a claimed
draw. Stalemate, insufficient material, fifty-move and observed threefold
positions are handled; in-check quiescence searches all legal evasions.

## Validation

`tests/client/independentSearch.test.ts` compares both perspectives, three AI
styles, evaluation switches, a seeded 90-ply sample and fixed special positions.
It covers complete, truncated and invalid histories; forced TT collisions,
clock, tuning and perspective isolation; mate normalization; terminal results;
null/real move restoration; cancellation and injected exceptions; promotion,
castling, en passant and quiet evasions; and the two existing hanging-queen
regressions. The shared root/PVS code retains its existing partial-depth tests.
Fixed-depth search comparisons include medium, hard and expert. Eight additional
tactical positions compare the two engines at depth 3; both chose the same move
and score in all eight, including a mate in one, queen capture, promotion,
en-passant check evasion, castling rights, quiet evasion and two queen-blunder
positions. This small tactical set is not a playing-strength or Elo test.

The generators can enumerate equal-priority moves in different orders. For
example, in the benchmark middlegame the two c3-knight quiet moves have the
opposite order after sorting by the existing ordering score. Because PVS and
selective pruning are order sensitive, node totals can differ even when the
fixed-depth result agrees; equal board hashes alone do not imply equal trees.
An earlier 400 ms trial returned `Qd3` versus `f3` in that middlegame after
partial depth 4: both engines returned `Qd3` with score 400 when depth 4 was
allowed to complete, and a regression test checks this. Partial root scores
remain subject to the existing completed-versus-partial iteration rules.

## Local full-search benchmark

Run `node --import tsx research/scripts/search-position-phase3-benchmark.ts`.
Raw five-sample data, moves, scores, completed/partial depths, and environment
are in `results/search-position-phase3-benchmark.json`. The run used Node
v24.22.1, Linux 6.18.57 x64, AMD EPYC 9V74 (9 logical CPUs visible), chess.js
1.4.0. The same process, positions, tuning, deterministic root tie order and
clock policy were used for both paths. Search state and tables were cleared for
every run, order alternated, and both paths were warmed up. Custom FENs were
explicitly marked with `historyTruncated: false` as complete starting positions for this controlled test.
Timings include input validation and state clearing; results are medians of five
runs per position and mode. Depth-zero entries can be counted in both the main
and quiescence counters: `visits` below is their sum, not unique positions or
leaf nodes. Iterative deepening and re-searches are included. The 400 ms request
uses the existing 25 ms finalization reserve, so measured wall time was about
376–378 ms here; the first-depth safety grace can exceed a tiny requested limit.

| Position | Fixed depth | Current median | Independent median | Move / score |
| --- | ---: | ---: | ---: | --- |
| Initial | 4 | 37.86 ms | 39.16 ms | Nc3 / 10 |
| Middlegame | 3 | 216.81 ms | 162.83 ms | f3 / 421 |
| Endgame | 4 | 35.42 ms | 17.47 ms | Rc4 / 54 |

| Position, 400 ms request | Current median visits | Independent median visits | Completed depths, current / independent | Move, current / independent |
| --- | ---: | ---: | --- | --- |
| Initial | 37,253 | 40,078 | 6–7 / 6–7 | Nc3 / Nc3 |
| Middlegame | 24,308 | 34,225 | 3 / 4 | Qd3 / Qd3 |
| Endgame | 18,297 | 49,048 | 6 / 7 | Rxf4+ / Rxf4+ |

Partial-depth outcomes vary with wall time and may use newer scores than the
last completed iteration; the raw data records these separately. In the final
middlegame samples the current path used partial depth 4 (score 400), while
most independent samples used partial depth 5 (score 392). At fully completed
depth 4, both choose Qd3 and score 400. These small local samples do not establish
mobile performance, general speedup, or any Elo gain; the prior phase's perft
microbenchmark cannot establish full-search speed.

## Gate before a default switch

The application still relies on chess.js repetition handling. The pinned
en-passant regression in the tests shows a case where chess.js misses a
threefold draw that the independent position detects. Application and engine
must agree on adjudication before production uses this search. Also required:
end-to-end worker/fallback integration and cancellation tests, representative
browser/mobile profiling and larger tactical or match samples, and a product
policy for incomplete history. This experiment alone is not approval to switch
the default engine.

# Independent TypeScript search: phase 4

Phase 3 benchmarked history-free positions, but the UI always sends the full
move history. With real history the phase 3 kernel lost its advantage: every
transposition-table store cloned the whole repetition ledger and every lookup
compared it, so garbage collection took about 29% of search time at ply 80
and the 16 MiB snapshot budget held only about a thousand entries. The table
key also contained the entire game history, so transpositions almost never
matched. This phase replaces both mechanisms and moves the shared evaluator
onto a typed board. The production worker, default TS search and Stockfish
routing are unchanged; the production TS engine uses the faster evaluator,
whose scores are identical.

## Repetition window

`RepetitionStack` (`searchPositionRepetition.ts`) keeps one entry per position
from the start of the known history to the current node, in typed arrays. A
pawn move, capture or loss of a castling right is irreversible: no earlier
position can occur again, so the repetition window restarts there. Counting
scans only the window, every second entry (same side to move), and still
compares the board, side, castling rights and legal en-passant file after a
hash match, so a hash collision alone cannot count as a repetition.

Completeness is now tracked per node. A root is complete only when the caller
says so, as before. An observed irreversible move makes the window complete,
because nothing before it can repeat. A synthetic null move still opens an
empty, incomplete scope, and an irreversible move inside that scope completes
it again. A bare FEN is still `unknown`, even with a zero halfmove clock,
because the clock is input data rather than an observed move.

## History-aware transposition key

Each window has a commutative 64-bit signature: the sum of mixed position
hashes, maintained in O(1) per move. It identifies the multiset of positions
that can still repeat, together with their counts. The table key combines the
position hash, both halfmove clocks and this signature:

- Transpositions reached after the same irreversible move share a key, because
  move order cannot affect any future draw.
- Positions reached through different reversible positions keep different
  keys, because those positions can still repeat.

`IndependentTranspositionTable` is now a fixed typed-array table: 2^20 slots
of 16 bytes (16 MiB), the same slot count as the production table, with
depth-preferred replacement. Each slot stores both 32-bit key words, and the
slot index is the low 20 bits of the first word. An unrelated position probing
an occupied slot therefore matches only if the other 44 bits agree: about
2^-44 per probe for uniformly distributed keys, against about 2^-32 for the
production table's 32-bit verifier. That is a probabilistic guard, not the
exact snapshot comparison of phase 3. Every key word is derived from the
64-bit position hash, so a stronger guard would need a wider hash. The table
remains scoped to one search, perspective and tuning, and is still disabled
while history is incomplete.

## Shared typed-board evaluator

The evaluator now reads a signed 64-square `Int8Array` (the `SearchPosition`
layout) instead of an 8×8 grid of piece objects. `getSquares` returns a
`SearchPosition`'s live board without copying and converts a chess.js board
once per call, so both kernels share one evaluator. Per-file pawn and rook
ranks are 8-bit masks rather than arrays, whose `length = 0` resets were the
hottest lines; slider rays and knight targets are precomputed per square, and
the second pass visits only occupied squares in the original order.

Scores are unchanged. `tests/client/fixtures/referenceEvaluation.ts` is a
frozen copy of the previous evaluator on chess.js's public board, and
`evaluationParity.test.ts` requires identical scores from both kernels on
more than 9,000 position, perspective and tuning combinations. One quirk is
preserved deliberately: a pawn counts as supported, and so not backward, when
an adjacent friendly pawn is level with it or nearer promotion. The textbook
definition uses pawns level with or behind it; changing that changes play and
needs retuning plus a match.

On 600 positions from random games, one evaluation took about 7.2 µs on a
`SearchPosition` and 7.0 µs on chess.js before, and about 2.2 µs and 3.2 µs
after. The production TS engine therefore also evaluates faster, with
identical results.

## Pin- and check-aware legality

Profiling after the evaluator change showed attack detection and move
generation as the largest costs: every candidate move was tried on the board
and the king tested with a full attack scan. Generation now marks pinned
pieces and, when in check, the checker and its blocking squares once per call:

- Out of check, a move by an unpinned piece other than the king is legal
  without a trial.
- In single check, such a move is legal exactly when it captures the checker
  or blocks its line; a pinned piece never can. In double check only the king
  moves.
- King moves, castling transit, en passant and pinned pieces out of check
  keep the full trial.

`boardGeometry.ts` holds precomputed knight and king targets, slider rays and
pawn attack sources, shared by attack detection, generation and the
evaluator; hot loops no longer destructure direction pairs or allocate small
arrays. `hasLegalMove` stops at the first legal move. Tests add pin, check
evasion and `hasLegalMove` positions and 1,800 random middlegame positions
compared with chess.js; perft totals are unchanged. In the local perft
benchmark, the independent generator now takes 40, 18 and 12 ms (initial,
Kiwipete, endgame), against 140, 76 and 47 ms in phase 2 and 442, 220 and
96 ms for the chess.js fast path.

## Local benchmark with real history

Run `node --import tsx research/scripts/search-position-history-benchmark.ts`.
It self-plays a deterministic game (legacy engine, depth 2) and searches the
positions at ply 40 and 80 with their complete history: five samples per mode,
alternating backend order. Raw data from the latest run is in
`results/search-position-history-benchmark.json`. Local runs on Node v22.23.4,
Linux x64, 4 logical CPUs; visits are main plus quiescence nodes. "Before"
columns come from the same script on the phase 3 commit (`1bed87f`).

| Position, 400 ms request | Legacy before | Phase 3 | + repetition/TT | + evaluator | + legality | Legacy now |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Ply 40 visits/s | 57,903 | 75,284 | 92,585 | 141,529 | 160,967 | 74,577 |
| Ply 40 completed depth | 3 | 3 | 4 | 5 | 5 | 3 |
| Ply 80 visits/s | 47,148 | 52,473 | 103,406 | 137,681 | 153,309 | 49,389 |
| Ply 80 completed depth | 6 | 6 | 8 | 9 | 9 | 6 |

| Position, fixed depth 4 | Legacy before | Phase 3 | + repetition/TT | + evaluator | + legality | Legacy now |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Ply 40 | 551 ms | 455 ms | 379 ms | 235 ms | 213 ms | 454 ms |
| Ply 80 | 68 ms | 70 ms | 57 ms | 39 ms | 40 ms | 56 ms |

All fixed-depth runs chose the same move. In the 400 ms runs on ply 40, the
searches that completed depth 4 or 5 chose Rg5 and the shallower ones Rg4.
Run-to-run noise on this shared container is roughly ±10%, so the legacy
columns and the last two independent columns at ply 80 are within noise of
each other.
After the repetition/TT change, profiling the ply-80 search showed garbage
collection at about 4.5% of samples (29% before). These are small local
samples, not mobile-device, playing-strength or Elo measurements.

## Next steps

### Where the time goes now

Ten 400 ms independent searches of the ply-80 position, after the legality
change (share of all samples; inclusive figures contain their callees):

| Cost | Share |
| --- | ---: |
| Move ordering (`sortMovesByCachedScore`, inclusive) | ~25% |
| of which the per-move score closure (self) | ~13% |
| Quiescence (inclusive) | ~19% |
| Evaluation (inclusive) | ~12% |
| Legal and tactical move generation (inclusive) | ~12% |
| Independent TT `store` (self) | ~9% |
| `IndependentMove` and `getBoard` adapters | ~4% |
| Garbage collection | ~3% |

Move ordering scores every move through the shared `AiMove` objects, using
square-name strings, the 8×8 piece grid and string-encoded TT moves, so it is
the largest remaining cost. The TT figure is unexpectedly high for a few
typed-array writes. A plausible but unverified cause is cache misses: each
slot's six fields live in six separate 16 MiB arrays. Packing a slot into one
16-byte record is a cheap experiment.

### Steps 3 and 4

Done in [phase 5](search-position-phase5.md).


- Encode moves as integers (from, to, promotion and flags) and run ordering,
  killers, history, countermoves and TT moves on them, removing
  `IndependentMove`, `getBoard` and square-name strings from the search.
- Give the independent kernel its own search module (root, PVS, quiescence,
  pruning) instead of the shared `Chess | SearchPosition` code. Freeze the
  legacy kernel as the reference.
- Gates: fixed-depth tests on which the new and legacy kernels choose the same
  move with the same score; parity with the frozen reference evaluator; perft
  and chess.js move-set tests; and visits per second and completed depth at
  ply 40 and 80 in `search-position-history-benchmark.ts`. Equal-priority
  moves may be ordered differently, so node counts can differ even when results
  agree.

The phase 3 gate before any default switch still applies: application and
engine adjudication must agree (the pinned en-passant threefold case), the
worker and fallback paths need end-to-end and cancellation tests, and the
switch needs browser and mobile profiling and a match sample.

### Profiling

`tsx` transpiles each module onto one line, so a CPU profile taken through it
shows anonymous functions without usable positions. Bundle first:

```sh
npx esbuild research/scripts/search-position-history-benchmark.ts --bundle \
  --platform=node --format=esm --outfile=/tmp/bench.mjs
node --cpu-prof --cpu-prof-dir=/tmp/prof /tmp/bench.mjs > /dev/null
```

The profile then has real function names and line numbers in the bundle.
This benchmark runs both kernels, so filter by function (chess.js internals
such as `_moves` belong to the legacy kernel).

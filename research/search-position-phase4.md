# Independent TypeScript search: phase 4

Phase 3 benchmarked history-free positions, but the UI always sends the full
move history. With real history the phase 3 kernel lost its advantage: every
transposition-table store cloned the whole repetition ledger and every lookup
compared it, so garbage collection took about 29% of search time at ply 80
and the 16 MiB snapshot budget held only about a thousand entries. The table
key also contained the entire game history, so transpositions almost never
matched. This phase replaces both mechanisms. The production worker, default
TS search and Stockfish routing are unchanged.

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
depth-preferred replacement. Each slot stores both 32-bit key words, so a slot
or board-hash collision needs a further 64-bit coincidence to match. That is a
probabilistic guarantee (about 2^-64 per probe), not the exact snapshot
comparison of phase 3. The table remains scoped to one search, perspective and
tuning, and is still disabled while history is incomplete.

## Local benchmark with real history

Run `node --import tsx research/scripts/search-position-history-benchmark.ts`.
It self-plays a deterministic game (legacy engine, depth 2) and searches the
positions at ply 40 and 80 with their complete history: five samples per mode,
alternating backend order. Raw data is in
`results/search-position-history-benchmark.json`. One local run on Node
v22.23.4, Linux x64, 4 logical CPUs; visits are main plus quiescence nodes.

| Position, 400 ms request | Legacy visits/s | Phase 3 visits/s | Phase 4 visits/s | Completed depth (legacy / phase 3 / phase 4) |
| --- | ---: | ---: | ---: | --- |
| Ply 40 | 57,903 | 75,284 | 92,585 | 3 / 3 / 4 |
| Ply 80 | 47,148 | 52,473 | 103,406 | 6 / 6 / 8 |

| Position, fixed depth 4 | Legacy | Phase 3 | Phase 4 |
| --- | ---: | ---: | ---: |
| Ply 40 | 551 ms | 455 ms | 379 ms |
| Ply 80 | 68 ms | 70 ms | 57 ms |

All fixed-depth runs chose the same move. At 400 ms on ply 40, phase 4
completed depth 4 and chose Rg5; the shallower searches chose Rg4. The other
kernels' columns come from a run of the same script on the phase 3 commit
(`1bed87f`) on the same machine. After this change, profiling the ply-80
search shows garbage collection at about 4.5% of samples, and evaluation is the
largest single cost (about 20%). These are small local samples, not
mobile-device, playing-strength or Elo measurements.

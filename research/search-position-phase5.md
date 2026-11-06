# Independent TypeScript search: phase 5

Phase 4 ended with move ordering as the largest cost (~25% of the ply-80
profile): every move went through `IndependentMove` and the shared `AiMove`
heuristics, with square-name strings, an 8×8 piece grid and string-encoded TT
moves. This phase carries out steps 3 and 4 from the phase 4 notes: integer
moves, and a search module of the kernel's own. The production worker,
default TS search and Stockfish routing are unchanged.

## Integer moves

`independent/moveCode.ts` encodes a move as a 24-bit integer: from and to
square, promotion type, moving piece type, captured piece type (pawn for en
passant), and en-passant, castling and double-push flags. Its low 15 bits
(from, to, promotion) identify the move within a position; the TT,
killers and countermoves store that key, and history is indexed by from/to.

`SearchPosition.generateMoveCodes(out, tacticalOnly?, firstOnly?)` writes
these codes into a caller-owned `Int32Array` and allocates nothing per move;
`generateLegalMoves`, `generateTacticalMoves` and `hasLegalMove` are now thin
wrappers around it, so the object API and its order are unchanged.
`makeMoveCode` applies a generated code without `makeMove`'s structural
validation; both share one state update. `isInsufficientMaterial` now stops at
the first pawn, rook or queen instead of scanning all 64 squares.

## The kernel's search module

`independent/kernelSearch.ts` holds root iteration with aspiration windows
and selection-band probes, PVS, quiescence, reverse futility, null-move,
futility and late-move pruning, LMR, check extension, and killer, history,
countermove and TT ordering. It works on a `SearchPosition` and integer moves
only: no chess.js objects, square names or grids. Move and score lists live
in per-frame typed arrays and are ordered by a stable insertion sort;
heuristics are typed arrays owned by one search. Its table,
`independent/kernelTranspositionTable.ts`, has the semantics of
`IndependentTranspositionTable` (both history-aware key words stored, so an
unrelated probe of an occupied slot matches with about 2^-44 probability;
depth-preferred replacement; no reuse with incomplete history) but packs each
slot into one 16-byte record of a single `Int32Array`, which was the cheap
experiment suggested in phase 4.

`searchForComparison` now has three backends:

| Backend | Position | Search |
| --- | --- | --- |
| `legacy` | chess.js | shared modules (the production search) |
| `reference` | `SearchPosition` | shared modules: the phase 4 kernel, frozen |
| `independent` | `SearchPosition` | `independent/kernelSearch.ts` |

The shared search modules (`chessAISearchCore`, `chessAIPvsSearch`,
`chessAIQuiescence`, `chessAIRootSearch`, move ordering and heuristics,
`chessAIBoardOps`) and `IndependentTranspositionTable` are not changed: they
are the reference for differential tests. The only shared change is a generic
type parameter on `pickMoveFromTopBand`, so the kernel can pass integer moves.

## Gates

`tests/client/independentKernel.test.ts` was written before the kernel:

- **Move codes.** On special positions and 12 random games, codes list the
  same moves in the same order as the object generator, and every field
  (piece, capture, en passant, castling, double push, promotion, tactical)
  matches chess.js. `makeMoveCode` gives the same FEN, hash, repetition count,
  TT key and completeness as `makeMove` for every legal move of 8 random games.
- **Against the legacy kernel.** At fixed depths 1–4 on the start position,
  the benchmark positions at ply 40 and 80 with their full history, and three
  further positions, and at depth 6 (ply 40) and 8 (ply 80), the new kernel
  chooses the legacy move with the legacy score.
- **Against the frozen reference.** At depths 1, 3 and 5 on 13 inputs, and
  for medium and hard with a seeded random source, the new kernel reproduces
  the reference exactly: move, score, completed depth, main and quiescence
  node counts, and every pruning counter. It keeps the reference's move
  generation order and stable tie order, so it visits the same tree.
  Mutations that change ordering (a countermove bonus above the killers, a
  lower killer score, a later LMR start, an extra history bonus) all fail
  this test; it is a precise guard, and any intended change to search
  behaviour must update it deliberately.
- **Aborts.** An aborted and a 50 ms search return a move and leave the
  position at its root.
- **Failed generation.** If a legality trial throws inside
  `generateMoveCodes`, a `finally` block clears every pin and evasion mark
  and releases the caller's buffer, so a later generation cannot accept a
  move that does not resolve check. This carries the phase 4 fix (`d794401`)
  over to the integer generator; a test injects the failure through the code
  path the kernel uses.
- **Move buffers.** `MAX_MOVES` is 64 × 27 = 1,728, enough for any board
  `SearchPosition` accepts, not just reachable ones (at most 218); a board
  with 265 legal moves is tested against chess.js. A caller buffer that is
  still too small makes generation throw instead of silently dropping moves.
- **Packed table.** `kernelTranspositionTable.test.ts` ports the adversarial
  cases of the reference table: distinct clocks, histories and positions in a
  one-slot table, no reuse with incomplete history, depth-preferred
  replacement, move-only shallow entries, all three bounds with mate and
  extreme scores, promotion move keys, depth clamping, and verification of
  both key words (including keys above 2^31). Each of seven targeted
  mutations of the table fails at least one case.

The existing independent-search tests (evaluation parity, repetition, TT,
null move, tactics, medium/hard selection) now run on the new kernel; the
only change is that the error-injection test patches `generateMoveCodes`.
Perft and chess.js move-set tests are unchanged and pass.

## Local benchmark with real history

`research/scripts/search-position-history-benchmark.ts` now runs all three
backends, rotating their order between samples. Same method as phase 4: a
deterministic legacy depth-2 self-play game, the positions at ply 40 and 80
with complete history, five samples per mode, visits = main + quiescence
nodes. Node v22.23.4, Linux x64, 4 logical CPUs; raw data in
`results/search-position-history-benchmark.json`.

| Position, 400 ms request | Legacy | Reference (phase 4) | New kernel |
| --- | ---: | ---: | ---: |
| Ply 40 visits/s | 84,922 | 211,757 | 375,822 |
| Ply 40 completed depth | 3–4 | 5 (partial 6) | 6 (partial 7 in 3 of 5) |
| Ply 80 visits/s | 53,016 | 207,872 | 485,546 |
| Ply 80 completed depth | 7 | 9 (partial 10) | 10–11 |

| Position, fixed depth 4 | Legacy | Reference (phase 4) | New kernel |
| --- | ---: | ---: | ---: |
| Ply 40 | 430 ms | 174 ms | 97 ms |
| Ply 80 | 48 ms | 29 ms | 26 ms |

The machine was faster in this run than in the phase 4 run (legacy at ply 40:
85k against 75k visits/s), so compare columns within this table rather than
with phase 4. Against the frozen reference in the same run, the new kernel is
1.8× faster at ply 40 and 2.3× at ply 80 in visits per second, and completes
one more depth at both. The fixed-depth ply-80 search is too short (26 ms) to
say much. All fixed-depth runs chose the same move (Rg5, Kd2). In the 400 ms
runs at ply 40 the new kernel chose Ke1, the move all three kernels choose at
fixed depth 6 (score −136); the shallower searches choose Rg5. These are
small local samples, not mobile-device, playing-strength or Elo measurements.

## Where the time goes now

Sixteen 400 ms searches of the ply-40 and ply-80 positions on the new kernel
only (self time, share of all samples):

| Cost | Share |
| --- | ---: |
| Evaluation (tapered, pawn structure, census, king safety, passed pawns) | ~37% |
| Move generation and legality (`generateMoveCodes`, `isLegalCandidate`, `markCheck`) | ~28% |
| `minimax` and `quiescence` bodies, including ordering | ~9% |
| Transposition table `store` and `probe` | ~6% |
| Make/undo and repetition push | ~5% |
| Insertion sort | ~1% |
| Garbage collection | <1% |

Move ordering, the largest cost before, is now about 1% for the sort plus
part of the `minimax` body. The remaining costs are the shared evaluator and
the move generator.

## Next steps

- Incremental evaluation: material and piece-square terms can be updated in
  `makeMoveCode`/`undo` instead of recomputed; the census and pawn-structure
  passes could be cached by a pawn hash. Gate: the frozen reference evaluator
  (`evaluationParity.test.ts`) and the node-for-node kernel test.
- Cheaper legality and generation: in check, generate evasions directly;
  generate captures without scanning quiet rays in quiescence.
- Staged move generation (TT move, captures, killers, quiets) would skip
  generating and scoring moves after an early cutoff. It changes tie order
  and therefore node counts, so it needs a deliberate update of the
  node-for-node test, keeping the fixed-depth move/score test against legacy.
- The phase 3 gate before any default switch still applies: application and
  engine adjudication must agree (the pinned en-passant threefold case), the
  worker and fallback paths need end-to-end and cancellation tests, and the
  switch needs browser and mobile profiling and a match sample.

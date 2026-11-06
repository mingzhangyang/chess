# Independent TypeScript search: phase 6

Phase 5 left evaluation (~37%) and move generation with legality (~28%) as
the largest costs of the integer-move kernel. This phase carries out the
first two of its next steps: incremental evaluation, and cheaper generation
and legality. Both are refactors that preserve behaviour. Scores, the list and
order of moves, and therefore the search tree are unchanged. The kernel still
reproduces the frozen reference node for node.

The production worker, default TS search and Stockfish routing are
unchanged. The shared search modules and the reference backend stay frozen.
The shared evaluator gives the same scores as before: its piece-square data
moved to a leaf module, and its term functions are now exported.

## Incremental evaluation

`SearchPosition.setSquare` now maintains, besides the hash and simple
material, the inputs of the tapered evaluation that change piece by piece:

- material plus piece-square value, middlegame and endgame, white minus
  black, from flat tables (`evaluationTables.ts`, `PIECE_SQUARE_MG/EG`,
  indexed by piece and square);
- the game-phase weight, non-pawn material and bishop count per side;
- a 32-bit pawn Zobrist key and per-file pawn rank masks (four 32-bit words);
- occupancy bitboards per side, and one of all knights, bishops, rooks and
  queens (see below).

`makeMoveCode` and `makeMove` update them through `setSquare`. `undo`
restores them from the move's frame, as it already did for the hash.

`independent/kernelEvaluation.ts` (`KernelEvaluator`, one per search) takes
the material and piece-square sums, phase, non-pawn material, bishop pair and
king squares from the position without looking at the board. Pawn-structure terms
(doubled, isolated, backward, connected and passed pawns, the passed-pawn
masks and the pawn counts) depend on the pawns alone. They live in a
fixed-size `Int32Array` of 4,096 slots × 64 bytes, indexed by the pawn key.
Each slot stores the four pawn-mask words and is used only when all four
match, so a key collision can never return another structure's terms. The
table belongs to one search because the terms depend on its tuning; in the
400 ms benchmark searches 95% (ply 40) and 99% (ply 80) of probes hit. Still computed per call:
mobility, rook files and knight outposts for the pieces in the officer
bitboard, style terms when the style is not balanced, king safety and
mop-up, all with the shared term functions. The non-tapered (legacy)
evaluation is not the default and is delegated to `evaluateBoard` unchanged.

Exactness does not rely on luck. Every piece-square entry is an integer (all
table values are multiples of 5, so 60% of them is integral), and every other
term is an integer or, for king safety, a multiple of one half. The sums are
therefore exact in any order, and the final `Math.round` sees the same value
as the full evaluator. A test checks that the tables are integral, and the
table builder throws if a future weight breaks this.

The reference backend also runs on `SearchPosition`, so its make/undo now
does this bookkeeping as well; its evaluation does not use it.

## Generation and legality

Instrumenting the phase 5 kernel on the benchmark positions (ply 40 at depth
6, ply 80 at depth 9) showed where the trials came from. Almost all of them
were king moves (in check, in full generation, and in `hasLegalMove`), with
a few thousand for pinned pieces. Every generation call also scanned 64
squares and ran the checker scan, after the search had just asked
`isInCheck` separately.

- **Pieces from bitboards.** Own pieces are taken from the occupancy
  bitboards in ascending square order instead of a 64-square scan.
- **Shared check test.** `isInCheck` is cached per position. It is saved in
  the undo frame and invalidated by a move or null move. When the position
  is known not to be in check, generation skips the checker scan.
- **Evasions directly.** In double check only the king is generated. In single check, pinned
  pieces other than pawns, knight targets and whole slider rays that cannot
  reach an evasion square (a bitboard of the checker and the blocking
  squares) are skipped before any candidate is formed.
- **Captures without quiet rays.** Tactical (quiescence) generation finds a
  slider's capture as the nearest set bit of its ray mask and the occupancy:
  the lowest bit on an ascending ray, the highest otherwise.
- **No trials for pins and king moves.** A pinned piece is legal exactly when it stays on the line from the king
  through it (`DIRECTION_BETWEEN`). A king move, and the castling transit, is
  legal when the destination is not attacked with the king's old square
  treated as empty. Only en passant and the castling destination are still
  tried on the board.
- **`hasLegalMove` tries the king last**, because only existence matters
  there.

On the same searches (identical trees: 118,001 and 49,091 visits):

| Per search | Ply 40, phase 5 | Ply 40, now | Ply 80, phase 5 | Ply 80, now |
| --- | ---: | ---: | ---: | ---: |
| Board trials (`isLegalCandidate`) | 70,404 | 22 | 124,359 | 46 |
| Checker scans (`markCheck`) | 91,185 | 11,731 | 40,497 | 5,071 |
| Attack tests (all kinds) | 290,048 | 247,217 | 185,641 | 153,014 |

## Gates

Tests were written before each change.

- **Incremental terms** (`incrementalEvaluation.test.ts`). After every
  legal move of special positions (castling, en passant, promotions) to
  depth 2, and of ten seeded games that favour captures, the maintained
  terms equal those of a position rebuilt from the FEN. The same holds after
  every undo, null move, history replay and checkpoint restore.
- **Evaluator.** On positions reached by make/undo, the kernel evaluator
  equals `evaluateBoard` for six tunings (styles, non-tapered, terms off) and
  both perspectives, also when served from the pawn table. It equals the
  frozen reference evaluator directly. With a one-slot table, which makes
  every structure collide, verification still returns exact scores.
  `evaluationParity.test.ts` is unchanged and passes.
- **Move order** (`moveGenerationOrder.test.ts`). A new frozen reference
  generator (`fixtures/referenceMoveGeneration.ts`) is naive on purpose: its
  own board, its own attack test, legality by making each move on a copy. It
  was checked against the phase 5 generator before any change. Full and
  tactical generation must match it code for code (content and order) on 29
  special positions and their children, and on twelve seeded games with
  sampled children and grandchildren: 14,241 positions, 410 of the sampled
  children in check. The test also checks `firstOnly`, the bitboards and the
  cached check state after make and undo.
- Perft, the chess.js move-set tests and the node-for-node kernel test pass
  without changes.
- One robustness test changed on purpose. It required that a pinned pawn's
  capturing promotion throw when the attack test throws during its trial.
  That move no longer has a trial, so the case is replaced by a test that
  pinned pieces and king moves (in and out of check) are generated with board
  trials disabled. The en passant and castling cases still check that an
  interrupted trial unwinds.

## Local benchmark with real history

`node --import tsx research/scripts/search-position-history-benchmark.ts`,
same method as phase 5: deterministic legacy depth-2 self-play, the positions
at ply 40 and 80 with complete history, five samples per mode with rotating
backend order, visits = main + quiescence nodes. Node v22.23.4, Linux x64,
4 logical CPUs. Raw data: `results/search-position-history-benchmark.json`.

| Position, 400 ms request | Legacy | Reference (phase 4) | New kernel | New / reference |
| --- | ---: | ---: | ---: | ---: |
| Ply 40 visits/s | 62,396 | 178,083 | 491,735 | 2.8× |
| Ply 40 completed depth | 3 (partial 4) | 5 (partial 6) | 6–7 (7 in 2 of 5) | |
| Ply 80 visits/s | 42,714 | 168,724 | 516,668 | 3.1× |
| Ply 80 completed depth | 6 (partial 7) | 9 (partial 10 in 4 of 5) | 11 | |

| Position, fixed depth 4 | Legacy | Reference (phase 4) | New kernel | Move (all) |
| --- | ---: | ---: | ---: | --- |
| Ply 40 | 523 ms | 199 ms | 79 ms | Rg5 (−100) |
| Ply 80 | 62 ms | 44 ms | 35 ms | Kd2 (+1542) |

Run-to-run noise on this shared container is roughly ±10%, and the machine
was slower in this run than in the phase 5 run (legacy at ply 40: 62k against
85k visits/s). Compare backends within this table, not with phase 5's
absolute numbers. Within each run, the new kernel's lead over the reference
grew from 1.8× to 2.8× at ply 40 and from 2.3× to 3.1× at ply 80. It now
completes depth 7 at ply 40 in some runs and depth 11 at ply 80.

The fixed-depth ply-80 search visits only 2,928 nodes. Its time is mostly
per-search setup: chess.js validates the 80-move history, and the 16 MiB
transposition table is allocated. It says little about search speed. All
fixed-depth runs chose the same move with the same score in every backend.
At 400 ms, ply 80 is a mate for all deeper searches (score 999,992). At
ply 40 the new kernel chose Rg5 in four samples and Ke1 in one, the move a
fixed depth-6 search chooses. These are small local samples, not
mobile-device, playing-strength or Elo measurements.

## Where the time goes now

`research/scripts/search-position-kernel-profile.ts` runs sixteen 400 ms
searches of the new kernel alone, alternating ply 40 and 80. Bundle it with
esbuild, run it with `--cpu-prof` (commands in the script header), and
summarise the profile with `research/scripts/cpu-profile-summary.mjs`. The
summary counts self time of samples under `searchIndependentKernel`, which
excludes building the positions, and groups functions by category. Both
columns use this method; the phase 5 column profiles commit `c134032`.
The workload ran at 306,992 visits/s before and 482,146 after (profiler
attached), so the same time budget holds 1.57× as many visits. The per-visit
column converts the shares into cost per visit.

| Self time | Phase 5 share | Now share | Per visit, phase 5 → now |
| --- | ---: | ---: | ---: |
| Evaluation | 40.2% | 27.1% | 1.34 → 0.57 µs |
| Move generation and legality | 28.7% | 34.3% | 0.95 → 0.72 µs |
| Search bodies and ordering | 10.6% | 12.9% | 0.35 → 0.27 µs |
| Make/undo and repetition | 6.1% | 11.2% | 0.20 → 0.24 µs |
| Transposition table | 5.4% | 6.6% | 0.18 → 0.14 µs |
| Search setup (chess.js boundary, allocation) | 3.9% | 3.9% | per search |
| Garbage collection | 2.6% | 2.4% | |
| Draw detection | 1.2% | 1.1% | |
| Insertion sort | 1.0% | 0.3% | |

The largest functions now are the evaluator body (16%, mostly slider
mobility), `generateFrom` (10%), `minimax` (9%), the king-move attack test
(8%), `generateMoveCodes` (7%, including the pin scan) and king safety (7%).
Make/undo grew by the incremental bookkeeping (about 0.04 µs per visit), far
less than evaluation saved.

## Next steps

- Staged move generation (TT move, good captures, killers and countermove,
  quiets, bad captures) would skip generating and scoring moves after an
  early cutoff. It changes the tie order and therefore node counts, so it
  needs a deliberate update of the node-for-node test, keeping the
  fixed-depth move/score tests against the legacy kernel.
- King safety (7%) scans a 5×5 zone per side on every call. Its pawn-shield
  part depends only on pawns and king squares and could share the pawn
  table. The zone attack could use the occupancy bitboards.
- King-move attack tests (8%): an attack map of the opponent, built once per
  generation, would replace several ray scans when the king has many moves.
- Make/undo now copies about 35 fields per frame. Restoring the bitboards by
  XOR instead of from the frame would shrink the frame.
- The phase 3 gate before any default switch still applies: application and
  engine adjudication must agree (the pinned en-passant threefold case), the
  worker and fallback paths need end-to-end and cancellation tests, and the
  switch needs browser and mobile profiling and a match sample.

# Independent search position: phase 2

`SearchPosition` now generates legal moves without chess.js. It remains isolated
from the production AI, Worker, UI and Stockfish. `makeMove` and `fromHistory`
continue to require already-legal moves; callers can pass a move generated on
the same position. `makeMove` is not a general-purpose legality validator.

- `generateLegalMoves()` returns all legal moves, including four choices for
  both quiet and capturing promotions. It does not stop for repetition, the
  fifty-move rule, or any other draw adjudication.
- `generateTacticalMoves()` returns legal captures, en passant and all
  promotions. It is a subset even when the moving side is in check.
- `generateQuiescenceMoves()` returns the full set of legal evasions while in
  check, and tactical moves otherwise. A future quiescence implementation must
  use this distinction and must not stand pat in check.

The generator uses the existing geometric attack detector, including attacks by
pinned pieces. Castling requires the right, king and rook on their home
squares, an empty path, and safe origin, transit and destination. En passant
removes the captured pawn before testing king safety. No candidate may capture
the opposing king.

Legality trials mutate only the private board, never call `makeMove`, and leave
the turn, clocks, rights, king fields, hash, history and undo stack untouched.
They test the original mover's king against the resulting board and restore
all touched squares in a `finally` block. This also covers castling's rook and
en passant's captured pawn. Public `makeMove` retains its phase 1 contract.

## Verification

Run `node --import tsx --test tests/client/searchPositionMoveGeneration.test.ts`.
Fixed special positions and eight seeded legal games compare full and tactical
move sets, including promotion types, against the public chess.js API. Tests
also check quiet evasions, state and prior repetition history restoration,
exception unwinding for en passant, promotion and castling, and perft without
premature draw adjudication. The independent generator drives every ply of:

| Position | Depth | Leaves |
| --- | ---: | ---: |
| Initial | 4 | 197,281 |
| Kiwipete | 3 | 97,862 |
| Reference rook-and-pawn endgame | 4 | 43,238 |

The phase 1 pinned-en-passant repetition regression remains covered. The current
application still uses chess.js for its rules and repetition handling; this
phase does not fix its known pinned-en-passant repetition discrepancy.

## Local generation benchmark

Run `node --import tsx research/scripts/search-position-movegen-benchmark.ts`.
It first verifies identical full move sets at every interior node against the
current fast board path and checks the reference leaf totals. It then times
five perft-style runs per path, alternating their order. Each path generates
legal moves and makes/undoes them; neither performs draw adjudication or a
search evaluation. Timed setup is excluded. The table shows medians from one
local run on Node v24.22.1, Linux 6.18.57 x64, AMD EPYC 9V74 80-Core
Processor (9 logical CPUs reported to the container), chess.js 1.4.0:

| Position | Depth | Leaf nodes | Current fast path | New position |
| --- | ---: | ---: | ---: | ---: |
| Initial | 4 | 197,281 | 398.38 ms | 106.17 ms |
| Kiwipete | 3 | 97,862 | 210.74 ms | 51.97 ms |
| Endgame | 4 | 43,238 | 82.32 ms | 26.21 ms |

These are local move-generation/state-transition measurements, not end-to-end
AI speed, search depth, playing strength, or mobile-device performance. The
existing fast path uses chess.js internals when available; the script stops if
that path is unavailable instead of silently timing the slower fallback.

## Before integration

A later phase must independently validate the full evaluation, search behavior,
transposition-table and repetition context, cancellation, and draw handling,
then integrate behind an appropriate gate. It must coordinate any fix to the
application-level pinned-en-passant repetition discrepancy. None of these are
claimed as completed here.

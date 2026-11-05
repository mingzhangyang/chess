# Independent search position: phase 1

This phase adds an isolated state container and tests. It is **not** connected
to the TypeScript engine, a worker, game rules, the UI, or Stockfish. It does
not generate moves or fully validate them. `makeMove` and `fromHistory` accept
only moves already validated by a trusted caller; structural checks are not a
substitute for checking pins, discovered checks, or arbitrary piece movement.

`SearchPosition` stores signed pieces in a 64-square `Int8Array` (a8 = 0),
side to move, king squares, four castling flags, raw en-passant target, clocks,
simple material balance, a deterministic two-word Zobrist hash, and repetition
history. It reuses per-ply undo records. The balance is not the existing full
tapered evaluation, whose weights and positional features must be preserved
and independently compared when an integration is attempted.

The raw en-passant target can exist without a legal capture. For position
identity, FEN normalization, and repetition, the target contributes only if
at least one capture leaves the moving side's king safe. This also handles the
chess.js 1.4 pinned-en-passant repetition discrepancy in the new container;
the current application still uses chess.js and is not changed by this phase.

`positionHash` includes board, turn, castling rights, and legal en-passant;
it deliberately excludes both clocks. It is **not** a complete transposition
table score key: fifty-move state, repetition context, perspective, tuning and
mate-score handling must be preserved during a future integration. Hashes are
not a persisted format. Repetition lookup verifies the full board and rights
after a hash match, so a collision does not by itself count as a repetition.

A FEN has no prior position history. Its repetition status is `unknown` by
default; a caller may explicitly mark complete history. `fromHistory` replays
validated moves, can check an expected final FEN, and seals the replayed state
as the search root. Undo cannot cross that root. In an incomplete history,
three observed occurrences are conclusive; fewer remain `unknown`.

Null moves use a fresh, incomplete repetition scope rather than inserting the
synthetic pass into the real game history. Nulls are rejected consecutively,
in check, and at a halfmove clock of 98 or greater. Undo restores the previous
scope. The caller must still exclude stalemate and apply all other pruning
guards; this container cannot check whether any legal move exists.
`checkpoint`/`restore` and the synchronous `withMove` helper support
unwinding an aborted search, including nested real and null moves.

Run the focused checks with:

```sh
node --import tsx --test tests/client/searchPosition.test.ts
```

The optional local-only `research/scripts/search-position-benchmark.ts` measures
pre-generated legal moves and undo against the existing fast board operations.
It does not measure move generation, legal-move filtering, the full evaluation,
complete search, playing strength, or browser performance.

The next phase needs its own move generation and legal-attack tests, perft and
move-set comparisons, followed by a separately gated search integration. A
future UI/game-rules fix for pinned-en-passant repetition must be coordinated
with any search change so the AI and application agree on game outcomes.

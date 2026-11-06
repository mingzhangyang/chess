# Independent TypeScript search: phase 8, gates before a default switch

Phases 1–7 built the independent kernel (`independent/kernelSearch.ts` on
`SearchPosition`). At fixed depth it agrees with the reference and legacy
searches, and locally it runs about 3× faster than the reference. Until now
only the research entry `independentSearch.ts` could call it. This phase works
through the [phase 3 gate](search-position-phase3.md#gate-before-a-default-switch)
one item at a time. It connects the kernel to the worker behind a default-off
switch and does **not** switch the default.

The shared search modules, the reference backend, the frozen reference
evaluator and the frozen reference generator are unchanged. With the switch
off, the production search and Stockfish routing are unchanged. Every step
was written test first.

## Summary

| Gate | Status | Evidence |
| --- | --- | --- |
| 1. Application and engine adjudicate draws alike | **Passed** | [Step 1](#1-draw-adjudication) |
| 2. Policy for incomplete history | **Decided by the owner, implemented** | [Step 2](#2-incomplete-history) |
| 3. Worker integration, fallback and cancellation, default off | **Passed** | [Step 3](#3-worker-integration-default-off) |
| 4. Browser/mobile profiling | **Approximation passed; real devices need the owner** | [Step 4](#4-browser-profiling) |
| 5. Match sample | **Passed (conclusive for strength)** | [Step 5](#5-match-sample) |
| Default switch | **Owner's decision; not switched** | [Recommendation](#recommendation) |

## 1. Draw adjudication

### Where draws are decided

Single player (a chess.js game with its full move history):

- `src/utils/gameResult.ts`: `describeGameResult` provides the result modal
  (`SinglePlayerRoom`) and the game-over sound (`moveSound.ts`).
- `src/components/SinglePlayerRoom.tsx`: opening the result modal after a
  move (`applyGameState`), the thinking indicator, the status line
  (checkmate, stalemate, draw, game over) and the mobile status bar.
- `src/hooks/useSinglePlayerAi.ts`: five checks that decide whether to ask
  the AI to move and whether to accept its answer.
- `src/utils/singlePlayerSavedGame.ts`: a finished game is not saved.
  `src/utils/restoreSinglePlayerGame.ts`: a finished game is not restored.
- In the worker, `getBestMove` (`src/utils/chessAI.ts`) returns no move for
  `game.isGameOver()`. It is unchanged. The application no longer asks for a
  move once its rules end the game, and chess.js never reports a repetition
  that these rules do not (below).

Multiplayer (FEN-only chess.js games plus the room's FEN history):

- `worker/src/chessRules.ts`: `isGameFinished` and `validateMove` give the
  server's authority, using chess.js on the current FEN and
  `shared/gameRules.ts`'s `hasThreefoldRepetition` on the room's FEN history
  (`tests/worker/chessRules.test.ts`).
- `src/components/GameRoom.tsx` and `moveSound.ts`: `describeGameResult(game,
  color, fenHistory)` on the client.

### The difference, and why only one position can be miscounted

chess.js keeps an en-passant square in its repetition hash whenever an enemy
pawn stands next to the pawn that has just advanced two squares, even if that
pawn is pinned and cannot capture. Its FEN, like `SearchPosition` and the FIDE
rules, includes the square only when a legal capture exists. A FEN-history
count is therefore already right, and the multiplayer paths were consistent.
The single-player paths used chess.js's hash and could miss a threefold
repetition.

chess.js can only under-count, never over-count: a legal capture implies the
hash key, so positions that differ under FIDE rules also differ in the hash.
It under-counts by at most one occurrence, the position right after the last
pawn move. En-passant squares exist only right after a double push, and pawn
moves cannot be undone, so no other earlier position can share the current
pawn structure.

### Change

`gameResult.ts` gained `isThreefoldRepetition(game, fenHistory?)` and
`isGameOver(game, fenHistory?)`. When chess.js finds a threefold repetition,
that is final. Otherwise the history is replayed only when the current board
could be such a position: a pawn of the side not to move on its fourth rank,
both squares behind it empty, an enemy pawn beside it, and chess.js rejecting
the capture once the square is set. The replay then counts chess.js FENs. The
common case costs one `get` per file (a full replay costs 12–15 ms at 200
plies). `gameResult.ts` keeps a type-only chess.js import: it is reached from
the lobby's saved-game module, whose bundle must stay free of the chess.js
runtime (a test checks this).

All single-player call sites above use these functions now. The fifty-move
rule (`halfmove ≥ 100` against `drawHalfmoveClock ≥ 100`; checkmate on the
hundredth half-move takes precedence in both) and insufficient material
already agreed; tests now pin both.

### Tests (`tests/client/drawAdjudication.test.ts` and others)

- Pinned en passant with a vertical and a horizontal pin, and with a
  diagonal pin reached from the start position (saved-game tests): chess.js
  alone says "not over", the application says threefold, and the engine
  agrees. One cycle earlier, both say the game goes on. A legal en-passant
  control still distinguishes the positions.
- The room worker and a FEN-history client report the same threefold.
- Random games, 90 of them from nine starts (standard, the pin setups, rook and queen
  endings, a middlegame) with a policy that seeks repetitions and mates.
  After every move (3,295 positions), single-player adjudication, the room
  client and the room worker all equal `SearchPosition`'s reason. The sample
  reaches every ending: 46 threefold, 9 fifty-move, 14 insufficient, 12
  checkmate and 4 stalemate, including 14 threefolds that chess.js alone
  misses.
- Insufficient material agrees on more than 900 random legal placements of
  small material sets (19 sets, 60 samples each).
- The research test that recorded the difference ("pinned en-passant history
  retains the known application-level difference") now asserts agreement.

**Status: passed.**

## 2. Incomplete history

### When the UI sends incomplete history

`useSinglePlayerAi` sends `getAiHistoryWindow(game)`. The single-player game
always starts from the standard position, so the whole history goes with
each request until the game exceeds 512 plies (`MAX_REPETITION_HISTORY_LENGTH`).
Beyond that the window starts right after the last irreversible move. The
fifty-move rule caps the reversible tail at 100 plies, so the window always
fits. No omitted position can occur again, yet the window still reported
`historyTruncated: true`. The kernel then treated repetition as unknown and
kept its table off on reversible lines. A bare FEN without history never
comes from the UI. (If `cloneGameWithHistory` ever fell back to a FEN, the
request would fail validation, as before.)

### Options presented, and the decision

| Option | Cost |
| --- | --- |
| **Sender marks complete** (chosen) | One line plus tests. The field's meaning narrows to "positions that can still repeat were omitted". The legacy search and Stockfish do not read it. |
| Keep unknown | No work. Past 512 plies the kernel runs without its table on reversible lines. |
| Worker infers from a zero halfmove clock | Trusts the FEN clock (rejected for bare FENs in phase 4). Misses windows that start after a lost castling right. |
| Route incomplete history to the existing search | Simple, but the kernel never runs past 512 plies. |

The project owner chose the first. `getAiHistoryWindow` now sets
`historyTruncated` only when moves after the last irreversible move were
omitted. The engine boundary already treats `historyStartFen` with
`historyTruncated: false` as complete. The existing window test now expects
`false`. New tests cover a tail longer than the window (still truncated), an
empty window after an irreversible last move, and a game of more than 512
plies whose window gives `SearchPosition` complete history and counts a
repetition inside it.

**Status: decided by the owner, implemented and tested.**

## 3. Worker integration, default off

### Switch

The owner chose a request field plus a local toggle:

- `tsSearchKernel?: 'independent'` on `AiComputeRequest` and
  `EngineAdapterComputeInput`. The worker rejects any other value and
  forwards the field to the TS backend only.
- The single-player hook sets it only for the TS backend, and only when
  `src/utils/aiSearchKernelToggle.ts` says so: `?aiKernel=independent`
  stores `chess:ai-ts-kernel` in localStorage, `?aiKernel=default` removes
  it, and blocked storage leaves it off. Without the toggle no request
  changes, and the kernel module is never loaded. In the build it is an
  18 KB chunk loaded on demand.

### Path

`TsEngineAdapter.computeBestMove` validates the history with chess.js as
before (`createGameFromInput`). With the switch on it calls `getBestMove` with
a new optional `searchStage` argument. That function's game-over, easy and
opening-book steps, including the worker-global committed opening line, run
unchanged. The stage replaces only the time-managed search. It is used only
when those steps have not produced a move. Without a stage, `getBestMove` is
unchanged (one added line).

The stage (`independent/kernelEngine.ts`) rebuilds the position with
`SearchPosition.fromHistory`, using the research entry's completeness rule
and checking against the FEN chess.js produced. It runs `runKernelSearch`
with the production deadlines, then selects the move as production does:
backtrack penalty, medium noise, `pickMoveFromTopBand`, `Math.random`. It
restores the root and resets the cancellation hook, deadline and abort flag
in a `finally` block.

### Failure handling

An error inside the stage becomes `KernelSearchError`. The runtime then emits
`ts-kernel-fallback` (warn) and answers with the existing TS search, without
the field, in the time left (`resolveAiFallbackTimeLimit` from the TS
budget). Errors before the stage, such as invalid history, are reported as
before and not retried. The Stockfish fallback never carries the field.

### Fixed cost per search

| Item (Node, ply 80 unless noted) | Before | Now (switch on) |
| --- | ---: | ---: |
| Kernel table: allocate 16 MiB | 1.7 ms + 16 MiB garbage per search | `clear()` 0.6 ms, one table per worker |
| Previous own move: chess.js `history({ verbose })` | 4.0 ms | from the request, 0 ms |
| `SearchPosition.fromHistory` with FEN check | 0.3 ms | 0.3 ms |
| chess.js validation `createGameFromInput` (40 / 80 plies) | 3.9 / 6.8 ms | unchanged |
| `getBestMove` before the search: `history()`, `hasStandardOpeningProvenance`, book lookup (40 / 80 plies) | 2.1 + 6.8 + 2.2 / 3.6 + 10.8 + 4.0 ms | skipped (see below) |

This chess.js cost comes before the search deadline starts, so it adds
latency rather than taking search time. It is shared with the existing
search.

**Follow-up, approved by the owner (commit `050d271`).** `getBestMove`
used to replay the whole game three times on every medium or hard move:
`history()` for the ply count, `hasStandardOpeningProvenance` (needed only
by the opening-book branches), and the book lookup's history (which answers
null from `openingBookMaxPly` on). It now takes an options object.
Provenance is computed lazily, and the book lookup is skipped past its
range. The worker supplies the ply count, plus the provenance when the
history starts from the standard position, the only requests that keep the
book on. The committed opening line's calls are untouched: its abort state
matters after an undo.

Moves are unchanged. `tests/client/openingProvenance.test.ts` compares call
sequences with and without the supplied context (16 lines, every
difficulty, three tunings, three seeds, random draws included), and checks
the worker's context against computed values for nine input shapes. A
request past the book now replays no chess.js history before the search;
with the kernel switch on, it replays none at all.

Validation plus everything before the search, medium or hard with the book
on, measured in one Node run before and after:

| Position | Before | After |
| --- | ---: | ---: |
| Ply 40 | 16 ms | 4.5 ms |
| Ply 80 | 31 ms | 8 ms |

What remains is `createGameFromInput`'s validation. Both the existing search
and the kernel benefit.

### Tests (`tests/client/kernelWorker.test.ts`, written first)

Requests go through `handleAiComputeRequest` and the real `TsEngineAdapter`:

- Validation of the field.
- Switch on: legal moves for medium, hard and expert, with no telemetry; the
  kernel saw each request.
- Switch off: the kernel is never reached.
- Book and easy parity: twelve opening positions (easy, medium and hard,
  book on) with three seeds each give the same move with and without the
  switch, and the kernel is never reached.
- Medium and hard draw from `Math.random`.
- Cancellation midway, aborting after the 1st, 3rd, 40th and 400th
  check, returns a legal move. The position is back at its root (same FEN,
  ply 0), no abort flag leaks, and the next search is normal.
- A kernel that throws mid-search: the position is restored, the response is a
  legal move from the existing search, `ts-kernel-fallback` is emitted, and the
  second call carries no field and a bounded budget.
- Invalid history is reported, not retried.
- The Stockfish fallback receives no field.
- One reused table across requests (`kernelTableForTesting`). Table tests:
  `clear()` empties, and a search with a dirty, cleared, reused table
  equals one with a fresh table, twice.
- The stage's boundary equals the research entry's on five inputs
  (complete, `start`, bare FEN, truncated, custom start). The previous own
  move matches chess.js's over 160 plies of a capture-heavy game. The stage
  makes no chess.js `history()` call.
- UI: the hook sends the field only through the toggle (source test); the
  toggle's parsing and storage failures.

The full suite (501 tests) and `tsc --noEmit` pass. Existing tests changed
only in steps 1 and 2, and only where the agreed behavior change required it.

**Status: passed.**

## 4. Browser profiling

Details, raw data and the real-device steps are in
[results/browser-kernel-profile.md](results/browser-kernel-profile.md).

The build ran in Chromium 153 on this container. CDP's
`Emulation.setCPUThrottlingRate` does not reach dedicated workers: the worker
target refuses it, and set on the page it leaves the worker at full speed. The
worker runs therefore used a cgroup CPU quota, with the slowdown measured in
the worker. They were cross-checked on the main thread under CDP throttling.
Both methods agree. At 1,000 ms per search, warm worker:

| Achieved slowdown | Ply 40 depth, existing → kernel | Ply 80 depth, existing → kernel |
| --- | ---: | ---: |
| 1× | 5 → 8 | 9 → 12 |
| 4.0× (cgroup) / 4.4× (CDP) | 3 → 6 | 6 → 10 |
| 5.9× (cgroup) / 6.9× (CDP) | 2–3 → 5 | 6 → 9–10 |

Visit rates: about 55k against 555k visits per second at 1×, and 12k against
126k at 4×. The kernel adds about 17 MB of ArrayBuffer memory per worker
(its 16 MiB table, allocated once); the JS heap is unchanged. The first
request of a fresh worker is weak for both engines on a slow CPU (depth 2
against 3 at 4×). The real production bundle played a move through the
kernel with `?aiKernel=independent` and never loaded the chunk with
`?aiKernel=default`.

**Status: the approximation passes. It is not a phone measurement; the
owner needs to run the real-device steps.**

## 5. Match sample

`research/scripts/kernel-match.ts` plays the kernel against the production TS
search through `TsEngineAdapter`, the code paths the switch selects. The
openings are 100 distinct positions from the app's own opening book (book
lines of 3 or more plies, deduplicated by position, longest first). Each is
played twice with colors swapped, for 200 games. Both engines play `expert`
(deterministic selection) with the book off and an explicit 300 ms per move.
Games end by the step 1 rules (`describeGameResult`) or as a draw at 400
plies, which no game reached. The production search's table and heuristics
are cleared at each game start, as in a fresh worker, and kept across its
moves, as in production. The kernel clears its table every move.

The script is interruptible. Shards append one JSON line per finished game,
and a restarted shard skips those (tested by killing and restarting a shard
mid-run). It ran as three shards on this 4-CPU container. Raw games are in
`results/kernel-match/`, the summary in `results/kernel-match-summary.json`.

| | Result |
| --- | --- |
| Kernel wins / draws / losses | **190 / 5 / 5** (score 96.25%) |
| As white / as black | 94 / 100, 98.5 / 100 |
| Elo difference | **+564** |
| 95% interval, Wilson score | **[+440, +688]** |
| 95% interval, normal; pentanomial (100 opening pairs) | [+474, +745]; [+475, +737] |
| Endings | 195 checkmate, 2 insufficient material, 2 fifty-move, 1 threefold |
| Average completed depth per move (kernel / existing) | **7.77 / 5.15** (9,686 and 9,594 moves) |
| Average time per move | 303 ms / 303 ms |

The sample is conclusive about strength: even the lower bound of every
interval is more than 400 Elo. Measuring the size of the gap to ±50 Elo
would take about 1,100 games at this score and variance, but no decision
here depends on it. The match ran in Node on a desktop CPU at equal time
per move. It does not show how the margin changes on a phone. The browser
profile shows the depth advantage persisting under slowdown (3–4 plies at
1×–6×).

**Status: passed.**

### Follow-up: against Stockfish (a skill ladder)

At the owner's request, the same script played the kernel against
Stockfish (`--opponent stockfish`). Both sides ran through the production
runtime in a Chromium worker built from `research/browser`: the kernel with
the switch on, Stockfish through the app's own `StockfishWasmAdapter`
(classical non-NNUE WASM, up to four threads, `Skill Level`). A move that
fell back to the TS search would have stopped the run; none did. The run
used 300 ms per move for both sides, the first 13 openings above with
colors swapped, and 25 games per level (four of them from a pilot, resumed).
Results: `results/kernel-vs-stockfish-skill<N>-300ms*`.

| Stockfish | Kernel W / D / L | Score | Elo difference (95% Wilson) |
| --- | --- | ---: | --- |
| Skill 0 | 24 / 0 / 1 | 96% | +552 [+246, +858] |
| Skill 5 | 16 / 2 / 7 | 68% | +131 [−11, +273] |
| Skill 10 | 2 / 0 / 23 | 8% | −424 [−657, −191] |
| Skill 20 (the app's expert default) | 0 / 0 / 25 | 0% | at most −325 |

At this time control the kernel is about Skill 5 strength. It clearly beats
Skill 0, is clearly beaten from Skill 10 up, and scores nothing against full
strength. Twenty-five games per level give wide intervals: they place the
kernel on the ladder, not to within 100 Elo. The kernel averaged depth
7.3–7.9 per move. Stockfish's skill levels have no fixed Elo; the app's
expert mode (Skill 20, 3.2 s per move) remains far stronger than either TS
search.

## Recommendation

**Switch the default for the TS backend (easy, medium, hard), but only after
the owner's real-device check, and keep the switch as a kill switch.**

- Correctness gates passed: draw adjudication agrees, history completeness
  is settled, and the worker path has end-to-end, cancellation and fallback
  tests. Book, easy and selection behavior equal production.
- Strength: +564 Elo [+440, +688] over the existing search at equal time,
  from 2.6 more plies on average.
- Speed: about 10× the visit rate and 3–4 more plies in the browser, at every
  slowdown tried.
- Costs: about 17 MB more memory per worker (one worker in single player),
  an 18 KB chunk loaded on first use, and the same chess.js validation cost as
  today.
- Still open, and the owner's: phone timings and memory on the slowest
  supported device (steps in `results/browser-kernel-profile.md`). Also a
  product question: the AI becomes much stronger at every level. Medium and
  hard keep the same selection noise and bands, but each now picks among
  better-searched moves, so their difficulty labels may need retuning
  (`TS_SEARCH_TIME_MS` or the bands). That needs play-testing by people.

This phase does not switch the default. With the toggle unset, every request
is unchanged.

## Next steps

- Owner: run the real-device steps on the slowest phone to be supported, and
  decide on the default.
- If the default changes: flip the switch's default in the hook (the field and
  the fallback stay as a kill switch), and keep the existing search as the
  fallback for at least one release.
- Done after approval: the whole-game replays before the search (see
  step 3). The next fixed cost is `createGameFromInput`'s chess.js
  validation (about 7 ms at ply 80). The kernel could validate the history
  with `SearchPosition` instead, but easy and the books still need a
  chess.js game.
- The kernel clears its table every move, while the existing search keeps
  its table across moves. Keeping kernel entries for the same perspective and
  tuning within a game is a likely strength gain, with its own gate.
- The phase 7 next steps (quiescence SEE, king-safety and king-move costs)
  still apply.

Here is a comprehensive review of `src/utils/chessAI.ts`, organized by topic:

---

## Opening Play (σ╝Çσ▒Ç) Review

### Strengths
The committed line system is well-conceived. All 10 lines are solid classical choices:
- **White**: Ruy Lopez, Italian (Giuoco Piano), QGD with Bg5, London, English ΓÇö all theoretically sound.
- **Black**: Sicilian Najdorf, French Winawer, King's Indian, Nimzo-Indian, Slav Main Line ΓÇö excellent coverage of major defenses.

### Issues

**1. Medium difficulty has zero opening book** (`chessAI.ts:781ΓÇô797`)
```typescript
if (difficulty === 'hard' || difficulty === 'expert') {
  // committed line + opening book
}
// depth=2 minimax directly ΓÇö medium gets nothing
```
Medium plays cold minimax from move 1, which produces random-looking, non-classical openings. A subset of `HARD_OPENING_BOOK` should also be applied for medium.

**2. Opening book coverage has gaps** (`chessAI.ts:49ΓÇô84`)
After the committed line aborts (opponent deviation), `HARD_OPENING_BOOK` kicks in. But its reply tree is very shallow:
- `e2e4 e7e5 g1f3 b8c6 f1c4` (Italian) ΓåÆ no reply listed
- `e2e4 e7e5 g1f3 b8c6 f1b5 a7a6 b5a4 g8f6` ΓåÆ no reply listed (the Ruy Lopez open variation)

The AI gets stranded after just a few moves of deviation, exiting the book entirely and falling into depth-3 minimax at move 5ΓÇô6.

**3. Committed line checks only the last opponent move** (`chessAI.ts:638ΓÇô645`)
```typescript
const opponentSlot = ourSlot - 1;
if (opponentSlot >= 0 && history.length > 0) {
  const actual = toUci(history[history.length - 1]); // only last move
```
Early moves are validated lazily (one per call). If something goes wrong in move reconstruction, the line might be followed in the wrong position. A defensive full prefix check at move 1 would be safer, though in practice this rarely matters.

**4. No blending at openingΓåÆmidgame transition**
The opening book ends abruptly. At ply 10 (or when the committed line finishes), the AI switches cold to minimax. A wider `hardOpeningFallbackBand` at ply 8ΓÇô12 could smooth this transition ΓÇö the current `hardOpeningFallbackBand: 140` applies only during `openingPhase` (`plyCount < 8`).

---

## Performance Review

### Critical Issues

**5. Transposition table eviction: entire clear on overflow** (`chessAI.ts:572ΓÇô574`)
```typescript
if (!existingEntry && transpositionTable.size >= TT_MAX_SIZE) {
  transpositionTable.clear(); // ΓåÉ catastrophic
}
```
When the table hits 100,000 entries it wipes everything. This destroys all accumulated knowledge mid-search, causing the next root iteration to restart with no TT hints. A **depth-preferred replacement** policy (keep only entries at ΓëÑ some min depth) or a **two-bucket** scheme (always + depth-preferred) is standard. Simplest fix: use a fixed-size array with modular hash indexing, replacing whenever the new entry has `depth >= existing.depth`.

**6. Captures not ordered in quiescence search** (`chessAI.ts:438ΓÇô461`)
```typescript
const captures = allMoves.filter((m) => m.isCapture() || m.isEnPassant() || m.isPromotion());
// No sort here ΓÇö captures are in chess.js default order
for (const move of captures) { ... }
```
Alpha-beta pruning inside quiescence is almost useless without MVV-LVA ordering. Sorting captures by `scoreMoveForOrdering` (already defined at line 464) would be a one-line fix and could cut quiescence nodes by 40ΓÇô60%.

**7. No killer move heuristic or history heuristic**
Non-capture moves are ordered purely by MVV-LVA score, which gives them all score=0 (no captures, no promotions). This means non-captures are searched in chess.js's default order. Killer moves (quiet moves that caused beta cutoffs at the same depth in sibling nodes) would massively improve ordering and thus pruning.

**8. No null-move pruning**
Standard in engines at this level. If the position is non-critical (not in check, sufficient material), making a "null move" and searching at depthΓêÆ3 is cheap and often causes an early cutoff. This alone can halve node counts in the midgame.

**9. Fixed depth ΓÇö no iterative deepening** (`chessAI.ts:803ΓÇô811`)
The engine searches at a fixed depth. Iterative deepening (ID) would:
- Provide a time-based cutoff (useful if you ever add a time limit)
- Allow the best move from depth N to be tried first at depth N+1 (better move ordering via TT)
- Enable IID (internal iterative deepening) at non-root nodes

**10. Beta is always `Infinity` at root** (`chessAI.ts:827`)
```typescript
const boardValue = minimax(game, depth - 1, rootAlpha, Infinity, false, color, tuning);
```
The root beta never updates even after finding a good move. Aspiration windows (starting from `[bestScoreΓêÆ50, bestScore+50]`) would prune far more effectively, especially at depth 4ΓÇô5.

**11. Duplicate `game.moves()` calls**
- `getBestMove` calls `game.moves()` at line 770 for initial ordering
- `getCommittedOpeningMove` calls `game.moves()` again at line 651
- If the committed move is returned, the first call was wasted

---

## Minor Issues

**12. `m.isEnPassant()` redundant in quiescence** (`chessAI.ts:438`)
In chess.js, en passant is already included in `m.isCapture()`. The extra check is harmless but redundant.

**13. `drawScore` heuristic** (`chessAI.ts:398ΓÇô403`)
```typescript
const boardScore = evaluateBoard(game, color, tuning);
if (boardScore < -120) return 20;  // losing ΓåÆ accept draw
if (boardScore > 120) return -20;  // winning ΓåÆ avoid draw
return -5;
```
The thresholds (┬▒120) are very tight ΓÇö a single pawn + PST bonus easily exceeds 120. This means the AI almost always evaluates draws as ΓêÆ5, rarely recognizing the "accept draw when losing" case.

**14. King PST not used in middlegame** (`chessAI.ts:313ΓÇô321`)
`kingEndgamePST` is only used when `isEndgame=true`. The midgame king PST penalizes the center heavily (which is correct), but the endgame PST encourages centralization. The `isEndgame` threshold (`myNonPawnMaterial < 1300 && oppNonPawnMaterial < 1300`) triggers when both sides have less than R+R, which is a reasonable detection but both sides must be below threshold ΓÇö a Queen advantage situation may never trigger it.

---

## Summary Table

| # | Area | Severity | Fix Complexity |
|---|------|----------|----------------|
| 5 | TT eviction clears entire table | High | Medium |
| 6 | Quiescence captures unordered | High | Low (1 line) |
| 1 | Medium has no opening book | Medium | Low |
| 7 | No killer moves | Medium | Medium |
| 8 | No null-move pruning | Medium | Medium |
| 2 | Opening book gaps | Medium | Low (add entries) |
| 10 | Beta=Γê₧ at root, no aspiration | Medium | Low |
| 9 | No iterative deepening | LowΓÇôMed | High |
| 3 | Single-move opponent check | Low | Low |
| 13 | Draw score threshold too tight | Low | Low |

The most impactful quick wins would be: **(6) sorting quiescence captures** and **(1) adding opening book for medium difficulty** ΓÇö both are small changes with outsized effect.
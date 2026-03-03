# Current Implementation Audit

## Snapshot

Current engine is a handcrafted evaluation + alpha-beta search engine with multiple modern optimizations:

- Opening committed lines + opening book:
  - `src/utils/chessAI.ts:49`
  - `src/utils/chessAI.ts:122`
- Typed-array transposition table, `SharedArrayBuffer` capable:
  - `src/utils/chessAI.ts:587`
  - `src/utils/chessAI.ts:682`
- Evaluation terms beyond pure material:
  - PST, pawn structure, king safety, mobility, bishop pair:
  - `src/utils/chessAI.ts:181`
  - `src/utils/chessAI.ts:705`
- Quiescence search + simplified SEE-style capture ordering:
  - `src/utils/chessAI.ts:850`
  - `src/utils/chessAI.ts:917`
- Move ordering and pruning stack:
  - killer/history, null-move pruning, PVS, LMR:
  - `src/utils/chessAI.ts:954`
  - `src/utils/chessAI.ts:1026`
  - `src/utils/chessAI.ts:1058`
- Iterative deepening + aspiration windows + per-difficulty time budget:
  - `src/utils/chessAI.ts:1014`
  - `src/utils/chessAI.ts:1478`

UI side also already does worker parallelization with shared TT:

- `src/components/SinglePlayerRoom.tsx:162`
- `src/components/SinglePlayerRoom.tsx:202`

## Why It Is Still Below "True Expert"

## 1) Evaluation ceiling (main bottleneck)

The evaluator is still HCE-based (handcrafted centipawn terms). This is strong for tactics and basic structure but weak in deep positional judgment, long-term sacrifices, fortress handling, and subtle king safety tradeoffs.

Evidence in code:

- Material/PST-centric evaluator:
  - `src/utils/chessAI.ts:705`
- No neural net (NNUE / policy-value net) inference path.

Practical result: search quality is constrained by evaluation quality; more depth alone cannot fully close this gap.

## 2) Search still missing top-engine layers

You already have many key heuristics, but compared to modern top engines, some high-impact pieces are still absent:

- No NNUE-guided move ordering / eval replacement.
- No Syzygy tablebase probing (exact endgame play).
- No advanced pruning/extensions stack seen in top engines (e.g., singular extensions, ProbCut-family, richer history/correction terms).

## 3) Efficiency limits from representation/runtime

- Uses `chess.js` object model move generation and `game.fen()`-based TT keying per node:
  - `src/utils/chessAI.ts:621`
  - `src/utils/chessAI.ts:1111`
- This is much heavier than bitboard + incremental Zobrist in native engines.

Even with good pruning, node throughput in JS is a hard cap.

## 4) Parallelism strategy is latency-first, not search-optimal

Current behavior: broadcast same root request to all workers, first response wins.

- `src/components/SinglePlayerRoom.tsx:252`
- `src/components/SinglePlayerRoom.tsx:260`

This reduces wait time but duplicates a lot of root work and does not implement advanced split-point parallel search semantics.

## 5) Opening/endgame data depth is limited

- Opening book is curated but finite and shallow compared with modern opening knowledge.
- Endgame relies on search/eval only; no exact tablebase fallback.

## Priority Gap Ranking

1. `P0`: Add stronger evaluator (NNUE or direct strong engine backend)
2. `P0`: Add exact endgame tablebase path
3. `P1`: Improve engine core throughput/representation and keying
4. `P1`: Strength calibration + regression framework (SPRT/Elo style)
5. `P2`: Expand opening and style system beyond static hand-tuned tables

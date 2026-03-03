# External Sources (Curated)

Collected on 2026-03-03. Focused on primary sources: official docs, official repos, and original papers.

## A) Stockfish ecosystem

1. Stockfish official docs (UCI options and engine controls)  
   https://official-stockfish.github.io/docs/stockfish-wiki/UCI-%26-Commands.html
- Relevant points:
  - `Skill Level`, `UCI_Elo`, `Move Overhead`, `nodestime`, `SyzygyPath`, thread/hash controls.
  - Important for difficulty calibration and deterministic UX.

2. Stockfish official docs (Advanced Topics / terminology)  
   https://official-stockfish.github.io/docs/stockfish-wiki/Advanced-topics.html  
   https://official-stockfish.github.io/docs/stockfish-wiki/Terminology.html
- Relevant points:
  - Modern architecture vocabulary: iterative deepening, aspiration windows, Lazy SMP, etc.

3. Stockfish FAQ (official)  
   https://official-stockfish.github.io/docs/stockfish-wiki/FAQ.html
- Relevant points:
  - Stockfish removed handcrafted evaluation and uses NNUE.
  - Clarifies why neural evaluation is now standard at top strength.

4. Stockfish developer guidance (official)  
   https://official-stockfish.github.io/docs/stockfish-wiki/Developers.html
- Relevant points:
  - Fishtest + SPRT workflow for validating Elo gains.
  - GPLv3 implications when integrating Stockfish code/binaries.

5. Stockfish search source (mirror view of official source)  
   https://cocalc.com/github/official-stockfish/stockfish/blob/master/src/search.cpp
- Relevant points:
  - Shows advanced search stack components beyond basic alpha-beta package.

## B) Browser-deployable strong engine

6. `stockfish.js` official repo README (nmrugg)  
   https://raw.githubusercontent.com/nmrugg/stockfish.js/master/README.md
- Relevant points:
  - Current project tracks Stockfish 17.1 and includes Stockfish 18 binaries.
  - WASM single-thread and multi-thread builds, plus "lite" NNUE model option.
  - Browser/Node usage patterns, practical integration commands.

## C) Leela Chess Zero ecosystem

7. Lc0 official search intro (AlphaZero style search)  
   https://lczero.org/dev/lc0/search/alphazero/
- Relevant points:
  - Policy/value driven MCTS foundation.

8. Lc0 LC3 search architecture overview  
   https://lczero.org/dev/lc0/search/lc3/overview/
- Relevant points:
  - Newer architecture direction with modularized search concepts.

9. Lc0 policy component documentation  
   https://lczero.org/dev/lc0/search/lc3/policy/
- Relevant points:
  - Policy prior roles and node expansion mechanics.

10. Lc0 training repository (official)  
    https://github.com/LeelaChessZero/lczero-training
- Relevant points:
  - Practical training stack assumptions and dependency surface.

## D) Foundational research and evaluation methodology

11. AlphaZero paper (arXiv)  
    https://arxiv.org/abs/1712.01815
- Relevant points:
  - End-to-end self-play policy-value paradigm and search-policy coupling.

12. Fishtest SPRT mathematics (official)  
    https://official-stockfish.github.io/docs/fishtest-wiki/Fishtest-Mathematics.html
- Relevant points:
  - Sequential testing strategy for reliable regression gating.

## E) Web platform constraints

13. SharedArrayBuffer + cross-origin isolation requirements  
    https://web.dev/articles/cross-origin-isolation-guide
- Relevant points:
  - Needed to fully unlock high-performance multi-thread WASM in browser environments.

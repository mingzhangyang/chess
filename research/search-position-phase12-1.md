# Independent TypeScript search: phase 12.1, reproducible SPRT opening order

[Phase 11](search-position-phase11.md) found that the early-stopped SPRTs
had sampled a **sorted prefix** of the opening book. The apparent +132 to
+137 Elo gain shrank to +33 on matched openings; the earlier phase 10
accepted gates may have the same bias. Before retesting or tuning search,
this phase fixes the sampling protocol, **not the search itself**.

## New SPRT runs

- For a fresh `--name`, Fisher-Yates shuffles the **opening positions** with
  a fixed 32-bit seed (`--opening-seed`, default `0x05eed123` = 99537187).
  A seed identifies an exact permutation; the source list is unchanged.
- The two color slots stay paired: game IDs `2*k` and `2*k+1` share opening
  `k`, with the new kernel playing white and black respectively. The
  existing shard rule `id % shards` remains unchanged.
- One atomic `openings.json` snapshot per run contains version, order mode,
  seed, SHA-256 of the original ordered opening list, and the shuffled list.
  Shards share this snapshot and restarts reuse it rather than generating
  a new list. The exclusive hard-link publication avoids partial JSON and
  refuses conflicting simultaneous starts before any game.
- If an explicit `--opening-seed` or `--openings-file` differs from the
  persisted run, startup fails with a request for a new `--name`. `--report`
  includes the persisted opening order information.
- Existing phase 10/11 run directories contain plain JSON arrays. They
  **retain their original, unshuffled slot order** when resumed; they are
  never silently reinterpreted. An explicit seed on such a legacy run is
  rejected. This preserves the historical game records.

For a new shuffled run:

```sh
node --import tsx research/scripts/kernel-sprt.ts \
  --name gate-v2 --opening-seed 99537187 --shard 0/4
# Run shards 1/4 through 3/4 with the SAME name and parameters.
node --import tsx research/scripts/kernel-sprt.ts --name gate-v2 --report
```

`--openings-file` normally shuffles its supplied list too. When comparing
against **exact existing opening/color slot IDs** in a fixed-sample match,
use `--openings-file <list.json> --preserve-openings-order` with a new run
name. This explicitly disables shuffling and **is not suitable for an
opening-balanced early-stop SPRT** if the file is sorted. It cannot be
combined with `--opening-seed`. A run snapshot can also be passed as the
input file; it is parsed as its openings array.

## Verification

- Seed parsing rejects invalid, wrapped or non-integer seeds.
- The same seed produces the same permutation; a different seed changes it.
  The source is not mutated and all 300 opening positions are preserved.
- Every color slot continues to point at its original paired opening.
- A sorted artificial opening list's shuffled prefix covers d4, e4 and c4.
- A persisted run resumes without recomputing the source, including across
  process restarts. Overrides, seed changes and order mode conflicts fail.
- Legacy arrays remain unshuffled. Explicit fixed-slot order is opt-in.
- Two simultaneously started processes with different seeds are forced to
  accept one identical snapshot or reject their conflicting configuration.
  Temporary files are cleaned up.

The isolated TypeScript check and seven dedicated local tests passed in the
restricted environment. The full project test suite, browser tests and
long-running SPRT matches are separate verification steps; no GitHub Actions
CI was manually triggered as part of 12.1.

## Next: phase 12.2

Re-evaluate the most decision-relevant phase 10/11 gains with the new
shuffled and fully reproducible protocol, at matched time controls and
complete opening/color coverage as needed. Early-stop results are still
statistical estimates, not proof of uniform coverage of every opening type.
Do not change the production kernel switch in this phase.

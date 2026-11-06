# Browser profile: existing TS search vs independent kernel

**This is an approximation on a desktop container, not a phone measurement.**
The project owner has to run the real-device steps below before any default
switch.

Raw data: `browser-kernel-profile.json`. Script:
`node --import tsx research/scripts/browser-kernel-profile.ts` (needs root for
the cgroup quota; Chromium 153 from the preinstalled Playwright, 4 logical
CPUs, run on 2026-11-06).

## Setup

- `research/browser/` is a Vite build of the production worker runtime and
  adapters (`aiWorkerRuntime.ts`, `tsEngineAdapter.ts`, the `kernelEngine`
  chunk) in a real dedicated worker. Its message wrapper also posts the search
  diagnostics, which the production entry `chessAiWorker.ts` does not.
- Each request is the production protocol: `expert`, opening book off, an
  explicit 1,000 ms limit, with or without `tsSearchKernel: 'independent'`.
  The positions are ply 40 and 80 of `tests/client/fixtures/selfPlayHistory.ts`
  with complete history (`research/browser/positions.json`).
- Before every measured request the harness clears the existing search's
  table and history heuristics. In production they persist across moves, so a
  benchmark that repeated one position would otherwise flatter that search
  (depth 6 instead of 3 at 4×). The kernel clears its own table every search.
- Three samples per cell, alternating order, after a warm-up round, in one
  worker; medians of visits per second (visits = main + quiescence nodes,
  divided by the whole request time, history validation included).

### How the CPU was slowed

CDP's `Emulation.setCPUThrottlingRate` does not reach dedicated workers. Sent
to the worker target it fails with "Operation is only supported for pages,
not workers". Sent to the page, it leaves the worker at full speed (measured:
81k nodes at 1× and 73k–90k at 4×–6× in a first probe). The worker runs are
therefore slowed with a Linux cgroup v1 CPU quota of 1/rate of one CPU on
Chromium's renderer processes. A fixed integer loop in the worker measured the
achieved slowdown at 4.03× and 5.90×. As a cross-check, the same runtime ran on
the page's main thread under CDP throttling, where it does apply (measured
4.43× and 6.89×). Both methods give the same picture.

## Results (warm worker, 1,000 ms per search)

| Slowdown (achieved) | Position | Existing TS: visits/s, depth | Kernel: visits/s, depth |
| --- | --- | ---: | ---: |
| 1× | ply 40 | 54,333, 5 | 554,858, 8 |
| 1× | ply 80 | 58,567, 9 | 626,742, 12 |
| 4.03× (cgroup) | ply 40 | 12,158, 3 | 126,456, 6 |
| 4.03× (cgroup) | ply 80 | 11,263, 6 | 140,957, 10 |
| 5.90× (cgroup) | ply 40 | 6,312, 2–3 | 76,498, 5 |
| 5.90× (cgroup) | ply 80 | 8,442, 6 | 86,583, 10 |
| 4.43× (CDP, main thread) | ply 40 | 10,331, 3 | 114,692, 6 |
| 4.43× (CDP, main thread) | ply 80 | 11,943, 6 | 114,995, 10 |
| 6.89× (CDP, main thread) | ply 40 | 5,922, 2 | 74,270, 5 |
| 6.89× (CDP, main thread) | ply 80 | 7,687, 6 | 73,430, 9 |

Every sample of both searches at ply 80 played b5. At ply 40 the kernel
played Ke1 (14 of 15 samples, once Rg5); the existing search played Rg5 at 1×
and Bg2 when slowed. In the browser the kernel completes 3–4 more plies than
the existing search at every slowdown. Its visit rate is about 10× higher,
against about 8.5× in Node; the two searches' visits are not the same unit of
work.

**Cold first request** (fresh worker: module and chunk load, JIT, table
allocation; ply 40, 1,000 ms):

| Slowdown | Existing TS | Kernel |
| --- | --- | --- |
| 1× | 1,003 ms, depth 5 | 998 ms, depth 8 |
| 4× | 1,024 ms, depth 2 | 1,197 ms, depth 3 |
| 6× | 1,230 ms, depth 1 | 1,196 ms, depth 2 |

On a slow device the first search of a worker is much weaker than later ones
for both engines. The kernel's first request also loads its 18 KB chunk.

**Memory** (worker target, `Runtime.getHeapUsage`, after four searches and a
forced GC):

| | Existing TS only | Kernel switch on |
| --- | ---: | ---: |
| ArrayBuffer backing stores | 12.7 MB | 29.5 MB |
| JS heap used after GC | 1.37 MB | 1.38 MB |
| JS heap reserved during searches | 15.5 MB | 9.4 MB |

The kernel adds its 16 MiB table plus a 256 KiB pawn table, allocated once per
worker and reused. The existing search's 12.7 MB table stays allocated in the
same worker. Single-player runs one AI worker (`canShare` is false in
`useSinglePlayerAi`), so on a phone the switch costs about 17 MB once.

## Real-app smoke test

The production app build (`vite build`, `vite preview`) was opened in headless
Chromium with a saved `medium` game past the opening book (AI to move):

- With `?aiKernel=independent`, the real `chessAiWorker` requested the
  `kernelEngine` chunk and played 6. d4 with no fallback telemetry.
- With `?aiKernel=default`, the chunk was never requested.

## Real-device steps (for the project owner)

Measure the searches with the profiling page:

1. On a computer on the same Wi-Fi as the phone, at the repository root:
   `npx vite build --config research/browser/vite.config.ts`, then
   `npx vite preview --config research/browser/vite.config.ts --host`.
   Note the "Network" URL (for example `http://192.168.1.20:4173/`).
2. On the phone, open that URL and keep the screen on, the page in front and
   the phone unplugged. Wait 10 s after loading, then tap **Run benchmark**.
   It takes about 30 s.
3. Tap the JSON box, copy everything and save it (one run per phone and
   browser). Run it twice and keep both: the first run includes JIT warm-up.
4. Useful phones: a recent iPhone (Safari) and a mid-range Android (Chrome),
   preferably 3–4 years old. The decision should rest on the slowest phone
   you want to support.
5. Optional, memory: Android Chrome with USB debugging, `chrome://inspect` on
   the computer, inspect the worker, Memory panel. On iOS, Safari's Web
   Inspector with the phone connected.

Then play against the kernel in the real app:

6. Run the app from the same computer (`npm run build`, then
   `npx vite preview --host`, or a preview deployment). Open
   `http://<computer>:4173/?aiKernel=independent` once on the phone. The
   choice is stored in localStorage, so later visits keep it;
   `?aiKernel=default` turns it off again.
7. Play a few medium and hard games (the kernel applies to the TS backend:
   easy, medium and hard; expert uses Stockfish). Note how long the AI takes
   to move, whether the page stays responsive, and any "computer unavailable"
   errors. Remote debugging consoles show `ts-kernel-fallback` warnings if
   the kernel ever failed over.
8. Repeat the same games with `?aiKernel=default` for comparison.

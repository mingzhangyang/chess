# Phase 13.1 supplemental browser profile (2026-11-11 UTC)

This is a desktop Chromium approximation, not a phone measurement. It was
captured from source SHA `786285f90ab225bd203894ec0d1dd41fd29abdd6` with
Chromium `151.0.7922.34`, three samples per warm-worker cell, and a 1,000 ms
search request limit.

Raw evidence: `phase13-1-browser-2026-11-10.json`.

## Method and limitations

The original cgroup-v1 quota is unavailable in this cgroup-v2 read-only
container. The harness now uses a renderer-process `SIGSTOP`/`SIGCONT`
duty-cycle fallback and records the achieved factor rather than treating the
requested rate as measured. This is a reproducible local approximation, not
equivalent to a kernel CPU quota. The main-thread cross-check uses CDP CPU
throttling. No fallback, timeout, or error telemetry occurred in the retained
search samples.

Cold first requests include worker creation, module/JIT work, table allocation,
and the first search; the harness still has no isolated worker-ready timing
handshake. The memory values are worker-target `Runtime.getHeapUsage` values,
not OS resident memory or physical-device measurements.

## Achieved slowdown and warm-worker medians

| Requested rate | Worker achieved | Main-thread CDP achieved |
| ---: | ---: | ---: |
| 1× | 1.00× | 1.00× |
| 4× | 4.09× | 3.40× |
| 6× | 6.74× | 6.15× |

Worker median visits/s and completed depth:

| Worker rate | Position | Existing TS | Independent kernel |
| ---: | --- | ---: | ---: |
| 1.00× | ply 40 | 40,127 / 4–5 | 563,853 / 8 |
| 1.00× | ply 80 | 53,187 / 9 | 635,913 / 12 |
| 4.09× | ply 40 | 7,173 / 2–3 | 124,291 / 6 |
| 4.09× | ply 80 | 10,034 / 6 | 117,525 / 10 |
| 6.74× | ply 40 | 3,421 / 2 | 59,815 / 5 |
| 6.74× | ply 80 | 4,476 / 4–5 | 54,472 / 9 |

Cold ply-40 requests completed without fallback: at 1×, TS/kernel reached
depth 3/7; at 4×, 2/4; and at 6×, 2/3. Elapsed times were approximately
1.0–1.24 seconds, including the existing bounded search-finalization behavior.

## Worker memory after four searches and forced GC

| Backend | JS heap used | ArrayBuffer backing store |
| --- | ---: | ---: |
| Existing TS | 1,335,748 bytes | 12,744,362 bytes |
| Independent kernel | 1,478,308 bytes | 29,566,709 bytes |

The observed backing-store difference is about 16.8 MB, consistent with the
kernel and pawn tables, but it is not a complete worker RSS measurement.

Physical iPhone validation remains **NOT RUN**.

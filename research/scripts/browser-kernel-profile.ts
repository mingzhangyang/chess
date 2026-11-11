/**
 * Browser profile of the existing TS search and the independent kernel in a
 * real Chromium dedicated worker, as a rough stand-in for phones.
 *
 *   node --import tsx research/scripts/browser-kernel-profile.ts
 *
 * Builds research/browser (the production worker runtime and adapters behind
 * a wrapper that also posts search diagnostics) with Vite, serves it with the
 * app's COOP/COEP headers, and drives it with the preinstalled Playwright
 * Chromium. Each request is the production protocol: `expert`, opening book
 * off, an explicit 1,000 ms limit, with or without `tsSearchKernel`.
 *
 * Slowdown: CDP's Emulation.setCPUThrottlingRate only applies to pages; it
 * does not reach dedicated workers ("Operation is only supported for pages,
 * not workers" on the worker target, and no effect through the page). The
 * worker runs use a Linux cgroup (v1) CPU quota when available. On cgroup-v2
 * containers without delegation, they use a renderer-process signal duty
 * cycle and retain the measured achieved factor; this fallback is an
 * approximation, not an equivalent cgroup quota. As a cross-check the same
 * runtime also runs on the page's main thread under CDP throttling. Memory:
 * Runtime.getHeapUsage of the worker target (JS heap plus ArrayBuffer backing
 * stores). Writes research/results/browser-kernel-profile.json.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmdirSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { build, preview } from 'vite';
import { selfPlayHistoryPositions } from '../../tests/client/fixtures/selfPlayHistory';
import { browserRendererPids, createSignalThrottle, hasCgroupV1, installThrottleCleanup } from './renderer-throttle';

// Playwright is installed globally in this environment, so load it with require.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { chromium } = createRequire(import.meta.url)('playwright') as any;

const RATES = [1, 4, 6];
const SAMPLES = 3;
const TIME_LIMIT_MS = 1_000;
const PORT = 4179;
const CGROUP = `/sys/fs/cgroup/cpu/chess-kernel-profile-${process.pid}`;
const HAS_CGROUP_V1 = hasCgroupV1();
const OUTPUT = process.env.CHESS_BROWSER_PROFILE_OUTPUT ?? 'research/results/browser-kernel-profile.json';

type Diagnostics = { nodes: number; qNodes: number; completedDepth: number; partialDepth: number };
type Sample = { backend: string; ply: number; move: string | null; elapsedMs: number; visits: number;
  visitsPerSecond: number; completedDepth: number; partialDepth: number; telemetry: string[] };

const signalThrottle = createSignalThrottle();
// Resume only PIDs stopped by this benchmark, including on SIGINT/SIGTERM/SIGHUP
// or an unexpected process exit. SIGKILL cannot be caught.
installThrottleCleanup(signalThrottle.stop);

const setQuota = async (rate: number, listOwnedRenderers: () => Promise<number[]>): Promise<void> => {
  if (!HAS_CGROUP_V1) {
    // CDP SystemInfo.getProcessInfo is scoped to our launched Chromium browser.
    if (rate === 1) signalThrottle.stop();
    else signalThrottle.start(rate, await listOwnedRenderers());
    return;
  }
  const renderers = await listOwnedRenderers();
  if (!existsSync(CGROUP)) mkdirSync(CGROUP);
  writeFileSync(CGROUP + '/cpu.cfs_period_us', '100000');
  writeFileSync(CGROUP + '/cpu.cfs_quota_us', rate === 1 ? '-1' : String(Math.round(100_000 / rate)));
  for (const pid of renderers) writeFileSync(CGROUP + '/cgroup.procs', String(pid));
};
const releaseQuota = (): void => {
  if (!HAS_CGROUP_V1) {
    signalThrottle.stop();
    return;
  }
  if (!existsSync(CGROUP)) return;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    for (const tid of execFileSync('cat', [`${CGROUP}/tasks`], { encoding: 'utf8' }).trim().split('\n').filter(Boolean)) {
      try { writeFileSync('/sys/fs/cgroup/cpu/tasks', tid); } catch { /* exited */ }
    }
    try { rmdirSync(CGROUP); return; } catch { execFileSync('sleep', ['0.1']); }
  }
  console.warn(`could not remove ${CGROUP}`);
};

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
};

const main = async () => {
  await build({ configFile: 'research/browser/vite.config.ts', logLevel: 'warn' });
  const positions = selfPlayHistoryPositions([40, 80]);
  const server = await preview({ configFile: 'research/browser/vite.config.ts', preview: { port: PORT, strictPort: true } });
  const browser = await chromium.launch();
  const browserCdp = await browser.newBrowserCDPSession();
  const listOwnedRenderers = async (): Promise<number[]> => {
    // This CDP session only knows processes of the Chromium we just launched,
    // unlike a machine-wide pgrep that can freeze unrelated browser sessions.
    const { processInfo } = await browserCdp.send('SystemInfo.getProcessInfo');
    const pids = browserRendererPids(processInfo as { type: string; id: number }[]);
    if (!pids.length) throw new Error('No renderer processes reported for this benchmark browser');
    return pids;
  };
  const result: Record<string, unknown> = { harnessRevision: 'phase13-1-reset-both',
    sourceSha: process.env.PHASE13_SOURCE_SHA ?? null, date: new Date().toISOString(), chromium: browser.version(),
    timeLimitMs: TIME_LIMIT_MS, samples: SAMPLES,
    throttleMode: HAS_CGROUP_V1 ? 'cgroup-v1' : 'renderer-signal-duty-cycle',
    note: 'A desktop container approximation of slower devices, not a phone measurement.' };

  const request = (backend: string, ply: number, requestId: number) => {
    const input = positions.get(ply)!;
    return { type: 'compute-best-move', requestId, fen: input.fen, history: input.history, difficulty: 'expert', backend: 'ts',
      tuning: { openingBookEnabled: false }, timeLimitMs: TIME_LIMIT_MS, ...(backend === 'kernel' ? { tsSearchKernel: 'independent' } : {}) };
  };
  const toSample = (backend: string, ply: number, r: { bestMove: string | null; error?: string; elapsedMs: number; diagnostics: Diagnostics; telemetry: string[] }): Sample => {
    if (r.error || !r.bestMove || r.telemetry.some((event) => /fallback|timeout|error/i.test(event))) {
      throw new Error('Failed or fallback browser sample: ' + String(r.error ?? r.telemetry.join(',')));
    }
    const visits = r.diagnostics.nodes + r.diagnostics.qNodes;
    return { backend, ply, move: r.bestMove, elapsedMs: Math.round(r.elapsedMs), visits, visitsPerSecond: Math.round(visits / (r.elapsedMs / 1000)),
      completedDepth: r.diagnostics.completedDepth, partialDepth: r.diagnostics.partialDepth, telemetry: r.telemetry };
  };

  // Worker target session (flatten: false, so messages go through Target.sendMessageToTarget).
  const attachWorker = async () => {
    const { targetInfos } = await browserCdp.send('Target.getTargets');
    const target = targetInfos.find((t: { type: string; url: string }) => t.type === 'worker' && t.url.includes('profileWorker'));
    const { sessionId } = await browserCdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: false });
    let nextId = 1;
    const waiting = new Map<number, (value: { result?: Record<string, number>; error?: unknown }) => void>();
    const listener = (event: { sessionId: string; message: string }) => {
      if (event.sessionId !== sessionId) return;
      const message = JSON.parse(event.message);
      waiting.get(message.id)?.(message); waiting.delete(message.id);
    };
    browserCdp.on('Target.receivedMessageFromTarget', listener);
    const send = (method: string, params: object = {}) => new Promise<{ result?: Record<string, number>; error?: unknown }>((resolve) => {
      const id = nextId++; waiting.set(id, resolve);
      void browserCdp.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id, method, params }) });
    });
    return { send, detach: async () => { browserCdp.off('Target.receivedMessageFromTarget', listener); await browserCdp.send('Target.detachFromTarget', { sessionId }); } };
  };
  const openPage = async () => {
    const page = await browser.newPage();
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForFunction(() => (window as unknown as { profileReady?: boolean }).profileReady === true);
    return page;
  };

  // Every measured request starts from cold search state: the existing search
  // otherwise keeps its table and heuristics between requests (production
  // behavior), which inflates its depth when one position is repeated.
  const search = (page: { evaluate: Function }, q: unknown, mainThread = false) => page.evaluate(async (args: [unknown, boolean]) => {
    const w = window as unknown as { profileSearch: (q: unknown) => Promise<never>; profileSearchMainThread: (q: unknown) => Promise<never>;
      profileReset: () => Promise<number> };
    if (args[1]) return w.profileSearchMainThread(args[0]);
    await w.profileReset();
    return w.profileSearch(args[0]);
  }, [q, mainThread]);
  const summarize = (label: string, samples: Sample[]) => {
    for (const ply of [40, 80]) for (const backend of ['ts', 'kernel']) {
      const own = samples.filter((s) => s.ply === ply && s.backend === backend);
      console.log(`  ${label} ply ${ply} ${backend}: ${median(own.map((s) => s.visitsPerSecond))} visits/s, depth ${own.map((s) => s.completedDepth).join('/')}, moves ${own.map((s) => s.move).join(' ')}`);
    }
  };

  // --- Cold first requests: a fresh worker per rate (module load, JIT, table allocation) ---
  const coldRuns: Record<string, unknown>[] = [];
  try {
    for (const rate of RATES) {
      const page = await openPage();
      await setQuota(rate, listOwnedRenderers);
      const cold: Sample[] = [];
      let id = 1;
      for (const backend of ['ts', 'kernel']) cold.push(toSample(backend, 40, await search(page, request(backend, 40, id++))));
      coldRuns.push({ rate, cold });
      console.log(`cold rate ${rate}: ${cold.map((s) => `${s.backend} ${s.elapsedMs} ms depth ${s.completedDepth}`).join(', ')}`);
      await setQuota(1, listOwnedRenderers);
      await page.close();
    }
  } finally {
    releaseQuota();
  }
  result.coldFirstRequests = coldRuns;

  // --- Warm worker, cgroup quota: one worker, warmed up unthrottled, then each rate ---
  const workerRuns: Record<string, unknown>[] = [];
  try {
    const page = await openPage();
    const worker = await attachWorker();
    const throttle = await worker.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    result.cdpWorkerThrottle = throttle.error ? String((throttle.error as { message: string }).message) : 'accepted';
    let id = 1;
    for (let round = 0; round < 2; round += 1) for (const ply of [40, 80]) for (const backend of ['ts', 'kernel']) await search(page, request(backend, ply, id++));
    let baseCalibration = 0;
    for (const rate of RATES) {
      await setQuota(rate, listOwnedRenderers);
      const calibration = await page.evaluate(() => (window as unknown as { profileCalibrate: () => Promise<number> }).profileCalibrate());
      if (rate === 1) baseCalibration = calibration;
      const samples: Sample[] = [];
      for (const ply of [40, 80]) for (let sample = 0; sample < SAMPLES; sample += 1) {
        for (const backend of sample % 2 ? ['kernel', 'ts'] : ['ts', 'kernel']) samples.push(toSample(backend, ply, await search(page, request(backend, ply, id++))));
      }
      const heap = (await worker.send('Runtime.getHeapUsage')).result;
      workerRuns.push({ rate, achievedSlowdown: Number((calibration / baseCalibration).toFixed(2)), calibrationMs: Math.round(calibration), samples, heapAfterRuns: heap });
      console.log(`worker rate ${rate}: achieved ${(calibration / baseCalibration).toFixed(2)}x`);
      summarize('worker', samples);
    }
    await setQuota(1, listOwnedRenderers);
    await worker.detach();
    await page.close();
  } finally {
    releaseQuota();
  }
  result.worker = workerRuns;

  // --- Memory per backend, fresh worker each ---
  const memory: Record<string, unknown>[] = [];
  for (const backend of ['ts', 'kernel']) {
    const page = await openPage();
    const worker = await attachWorker();
    await worker.send('HeapProfiler.enable');
    await worker.send('HeapProfiler.collectGarbage');
    const idle = (await worker.send('Runtime.getHeapUsage')).result;
    let id = 1;
    for (const ply of [40, 80, 40, 80]) await search(page, request(backend, ply, id++));
    const afterSearches = (await worker.send('Runtime.getHeapUsage')).result;
    await worker.send('HeapProfiler.collectGarbage');
    const afterGc = (await worker.send('Runtime.getHeapUsage')).result;
    memory.push({ backend, idle, afterSearches, afterGc });
    console.log(`memory ${backend}: backing store idle ${idle?.backingStorageSize}, after GC ${afterGc?.backingStorageSize}; heap used after GC ${afterGc?.usedSize}`);
    await worker.detach();
    await page.close();
  }
  result.memory = memory;

  // --- Cross-check: the same runtime on the page main thread under CDP throttling ---
  const mainRuns: Record<string, unknown>[] = [];
  {
    const page = await openPage();
    const cdp = await page.context().newCDPSession(page);
    let id = 1;
    for (let round = 0; round < 2; round += 1) for (const ply of [40, 80]) for (const backend of ['ts', 'kernel']) await search(page, request(backend, ply, id++), true);
    let mainBase = 0;
    for (const rate of RATES) {
      await cdp.send('Emulation.setCPUThrottlingRate', { rate });
      const calibration = await page.evaluate(() => (window as unknown as { profileCalibrateMainThread: () => Promise<number> }).profileCalibrateMainThread());
      if (rate === 1) mainBase = calibration;
      const samples: Sample[] = [];
      for (const ply of [40, 80]) for (let sample = 0; sample < SAMPLES; sample += 1) {
        for (const backend of sample % 2 ? ['kernel', 'ts'] : ['ts', 'kernel']) samples.push(toSample(backend, ply, await search(page, request(backend, ply, id++), true)));
      }
      mainRuns.push({ rate, achievedSlowdown: Number((calibration / mainBase).toFixed(2)), samples });
      console.log(`main thread CDP rate ${rate}: achieved ${(calibration / mainBase).toFixed(2)}x`);
      summarize('main', samples);
    }
    await page.close();
  }
  result.mainThreadCdp = mainRuns;

  await browser.close();
  await new Promise<void>((resolve) => server.httpServer.close(() => resolve()));
  writeFileSync(OUTPUT, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`wrote ${OUTPUT}`);
};

await main();

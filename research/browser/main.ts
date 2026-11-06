/**
 * Profiling page for research/scripts/browser-kernel-profile.ts. It starts one
 * worker (profileWorker.ts) and exposes window.profileSearch(request), which
 * resolves with the worker's answer, search diagnostics and timings.
 */
type ProfileResult = {
  type: 'profile-result';
  bestMove: string | null;
  error?: string;
  elapsedMs: number;
  diagnostics: { nodes: number; qNodes: number; completedDepth: number; partialDepth: number };
  telemetry: string[];
};

declare global {
  interface Window {
    profileSearch: (request: Record<string, unknown>) => Promise<ProfileResult>;
    profileCalibrate: () => Promise<number>;
    profileReset: () => Promise<number>;
    profileSearchMainThread: (request: Record<string, unknown>) => Promise<ProfileResult>;
    profileCalibrateMainThread: () => Promise<number>;
    profileReady: boolean;
  }
}

const worker = new Worker(new URL('./profileWorker.ts', import.meta.url), { type: 'module' });
let pending: ((result: ProfileResult) => void) | undefined;
let pendingCalibration: ((elapsedMs: number) => void) | undefined;
worker.addEventListener('message', (event: MessageEvent<ProfileResult | { type: 'calibration-result'; elapsedMs: number }>) => {
  if (event.data?.type === 'profile-result') { pending?.(event.data); pending = undefined; }
  if (event.data?.type === 'calibration-result') { pendingCalibration?.(event.data.elapsedMs); pendingCalibration = undefined; }
});
window.profileSearch = (request) => new Promise((resolve) => {
  pending = resolve;
  worker.postMessage(request);
});
window.profileCalibrate = () => new Promise((resolve) => {
  pendingCalibration = resolve;
  worker.postMessage({ type: 'calibrate' });
});
window.profileReset = () => new Promise((resolve) => {
  pendingCalibration = resolve;
  worker.postMessage({ type: 'reset-search-state' });
});

// The same runtime on the page's main thread, where CDP CPU throttling applies
// (it does not reach dedicated workers). A cross-check only: loaded on demand.
window.profileSearchMainThread = async (request) => {
  const [{ handleAiComputeRequest }, { clearCountermoves, clearHistory, clearTranspositionTable, getLastSearchDiagnostics },
    { clearLoadedKernelSearchTable }] = await Promise.all([
    import('../../src/workers/aiWorkerRuntime'), import('../../src/utils/chessAI'),
    import('../../src/workers/tsEngineAdapter')]);
  clearTranspositionTable(); clearHistory(); clearCountermoves(); clearLoadedKernelSearchTable();
  const telemetry: string[] = [];
  const started = performance.now();
  const response = await handleAiComputeRequest(request, {
    emitTelemetry: (message) => { telemetry.push(`${message.level}:${message.name}`); },
  });
  return { type: 'profile-result', bestMove: response?.bestMove ?? null, error: response?.error,
    elapsedMs: performance.now() - started, diagnostics: getLastSearchDiagnostics(), telemetry };
};
window.profileCalibrateMainThread = async () => {
  const { calibrationWork } = await import('./calibration');
  const started = performance.now();
  calibrationWork();
  return performance.now() - started;
};
window.profileReady = true;
document.getElementById('status')!.textContent = `ready (crossOriginIsolated: ${String(crossOriginIsolated)})`;

// --- On-device benchmark: the same measurement as the Playwright script, for phones ---
const runButton = document.getElementById('run') as HTMLButtonElement;
runButton.disabled = false;
runButton.addEventListener('click', async () => {
  runButton.disabled = true;
  const { default: positions } = await import('./positions.json');
  const table = document.getElementById('results') as HTMLTableElement;
  table.innerHTML = '<tr><th>Ply</th><th>Search</th><th>Visits/s (median)</th><th>Completed depth</th><th>ms</th></tr>';
  const status = document.getElementById('status')!;
  const request = (backend: string, ply: '40' | '80', requestId: number) => ({
    type: 'compute-best-move', requestId, fen: positions[ply].fen, history: positions[ply].history, difficulty: 'expert', backend: 'ts',
    tuning: { openingBookEnabled: false }, timeLimitMs: 1000, ...(backend === 'kernel' ? { tsSearchKernel: 'independent' } : {}),
  });
  const reset = () => new Promise<number>((resolve) => { pendingCalibration = resolve; worker.postMessage({ type: 'reset-search-state' }); });
  const rows: Array<Record<string, unknown>> = [];
  let id = 1;
  status.textContent = 'warming up';
  for (const ply of ['40', '80'] as const) for (const backend of ['ts', 'kernel']) { await reset(); await window.profileSearch(request(backend, ply, id++)); }
  const calibrationMs = await window.profileCalibrate();
  for (const ply of ['40', '80'] as const) {
    const samples: Record<string, ProfileResult[]> = { ts: [], kernel: [] };
    for (let sample = 0; sample < 3; sample += 1) for (const backend of sample % 2 ? ['kernel', 'ts'] : ['ts', 'kernel']) {
      status.textContent = `ply ${ply}, ${backend}, sample ${sample + 1}/3`;
      await reset();
      samples[backend].push(await window.profileSearch(request(backend, ply, id++)));
    }
    for (const backend of ['ts', 'kernel']) {
      const rates = samples[backend].map((r) => (r.diagnostics.nodes + r.diagnostics.qNodes) / (r.elapsedMs / 1000)).sort((a, b) => a - b);
      const row = { ply, backend, visitsPerSecond: Math.round(rates[1]), completedDepth: samples[backend].map((r) => r.diagnostics.completedDepth).join('/'),
        elapsedMs: samples[backend].map((r) => Math.round(r.elapsedMs)).join('/'), moves: samples[backend].map((r) => r.bestMove).join(' '),
        telemetry: samples[backend].flatMap((r) => r.telemetry) };
      rows.push(row);
      table.insertAdjacentHTML('beforeend', `<tr><td>${ply}</td><td>${backend === 'ts' ? 'existing TS' : 'kernel'}</td><td>${row.visitsPerSecond}</td><td>${row.completedDepth}</td><td>${row.elapsedMs}</td></tr>`);
    }
  }
  status.textContent = 'done';
  (document.getElementById('json') as HTMLTextAreaElement).value = JSON.stringify({ userAgent: navigator.userAgent,
    hardwareConcurrency: navigator.hardwareConcurrency, calibrationMs: Math.round(calibrationMs), rows }, null, 1);
  runButton.disabled = false;
});

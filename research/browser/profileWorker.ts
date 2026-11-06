/**
 * The production worker runtime and adapters (src/workers/aiWorkerRuntime.ts,
 * tsEngineAdapter.ts, the kernel chunk) behind a message wrapper that also
 * reports the search diagnostics, which the production entry
 * (chessAiWorker.ts) does not post.
 */
import { handleAiComputeRequest } from '../../src/workers/aiWorkerRuntime';
import { clearCountermoves, clearHistory, clearTranspositionTable, getLastSearchDiagnostics } from '../../src/utils/chessAI';
import { calibrationWork } from './calibration';

self.addEventListener('message', async (event: MessageEvent<unknown>) => {
  if ((event.data as { type?: string })?.type === 'reset-search-state') {
    // The existing search keeps its table and history heuristics across
    // requests; reset them so that a repeated benchmark position starts cold.
    clearTranspositionTable(); clearHistory(); clearCountermoves();
    self.postMessage({ type: 'calibration-result', elapsedMs: 0, value: 0 });
    return;
  }
  if ((event.data as { type?: string })?.type === 'calibrate') {
    const started = performance.now();
    const value = calibrationWork();
    self.postMessage({ type: 'calibration-result', elapsedMs: performance.now() - started, value });
    return;
  }
  const telemetry: string[] = [];
  const started = performance.now();
  const response = await handleAiComputeRequest(event.data, {
    emitTelemetry: (message) => { telemetry.push(`${message.level}:${message.name}`); },
  });
  const elapsedMs = performance.now() - started;
  self.postMessage({ type: 'profile-result', bestMove: response?.bestMove ?? null, error: response?.error,
    elapsedMs, diagnostics: getLastSearchDiagnostics(), telemetry });
});

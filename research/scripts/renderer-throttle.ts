import { existsSync } from 'node:fs';

export const hasCgroupV1 = (): boolean => existsSync('/sys/fs/cgroup/cpu/cpu.cfs_period_us')
  && existsSync('/sys/fs/cgroup/cpu/cpu.cfs_quota_us');

export const dutyCycleForRate = (rate: number, cycleMs = 100): { cycleMs: number; runMs: number; pauseMs: number } => {
  if (!Number.isInteger(rate) || rate < 1) throw new RangeError('rate must be a positive integer');
  if (!Number.isInteger(cycleMs) || cycleMs < 4) throw new RangeError('cycle must be at least 4 ms');
  const runMs = rate === 1 ? cycleMs : Math.max(2, Math.round(cycleMs / rate));
  return { cycleMs, runMs, pauseMs: cycleMs - runMs };
};

/** Only processes reported by this benchmark's browser-scoped CDP session. */
export const browserRendererPids = (processInfo: readonly { type: string; id: number }[]): number[] =>
  [...new Set(processInfo.filter((p) => p.type === 'renderer' && Number.isSafeInteger(p.id) && p.id > 0)
    .map((p) => p.id))];

type RendererSignal = 'SIGSTOP' | 'SIGCONT';

/** Tracks only successfully stopped renderer PIDs so cleanup never resumes an unrelated process. */
export const createSignalThrottle = (
  sendSignal: (pid: number, signal: RendererSignal) => void = process.kill,
  schedule: (callback: () => void, ms: number) => ReturnType<typeof setTimeout> = setTimeout,
  cancel: (timer: ReturnType<typeof setTimeout>) => void = clearTimeout,
) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let targets: number[] = [];
  const stopped = new Set<number>();
  const resume = (): void => {
    for (const pid of stopped) {
      try { sendSignal(pid, 'SIGCONT'); } catch { /* renderer exited */ }
    }
    stopped.clear();
  };
  const stop = (): void => {
    if (timer !== undefined) cancel(timer);
    timer = undefined;
    targets = [];
    resume();
  };
  const start = (rate: number, pids: readonly number[]): void => {
    stop();
    if (rate === 1) return;
    const { runMs, pauseMs } = dutyCycleForRate(rate);
    targets = [...new Set(pids)].filter((pid) => Number.isSafeInteger(pid) && pid > 0);
    if (!targets.length) throw new Error('No renderer PIDs owned by the benchmark browser');
    const run = (): void => {
      resume();
      timer = schedule(() => {
        for (const pid of targets) {
          try { sendSignal(pid, 'SIGSTOP'); stopped.add(pid); } catch { /* renderer exited */ }
        }
        timer = schedule(run, pauseMs);
      }, runMs);
    };
    run();
  };
  return { start, stop };
};

type TerminationSignal = 'SIGHUP' | 'SIGINT' | 'SIGTERM';
type TerminationLifecycle = {
  on(event: 'exit', callback: () => void): unknown;
  once(event: TerminationSignal, callback: () => void): unknown;
  exit(code: number): never;
};

/** Exit and catchable termination signals both resume any renderers we stopped. */
export const installThrottleCleanup = (
  stop: () => void,
  lifecycle: TerminationLifecycle = process,
): void => {
  lifecycle.on('exit', stop);
  const codes: Record<TerminationSignal, number> = { SIGHUP: 129, SIGINT: 130, SIGTERM: 143 };
  for (const signal of ['SIGHUP', 'SIGINT', 'SIGTERM'] as const) {
    lifecycle.once(signal, () => { stop(); lifecycle.exit(codes[signal]); });
  }
};

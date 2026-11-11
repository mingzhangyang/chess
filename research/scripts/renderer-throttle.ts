import { existsSync } from 'node:fs';

export const hasCgroupV1 = (): boolean => existsSync('/sys/fs/cgroup/cpu/cpu.cfs_period_us')
  && existsSync('/sys/fs/cgroup/cpu/cpu.cfs_quota_us');

export const dutyCycleForRate = (rate: number, cycleMs = 100): { cycleMs: number; runMs: number; pauseMs: number } => {
  if (!Number.isInteger(rate) || rate < 1) throw new RangeError('rate must be a positive integer');
  if (!Number.isInteger(cycleMs) || cycleMs < 4) throw new RangeError('cycle must be at least 4 ms');
  const runMs = rate === 1 ? cycleMs : Math.max(2, Math.round(cycleMs / rate));
  return { cycleMs, runMs, pauseMs: cycleMs - runMs };
};

import { randomUUID } from 'node:crypto';
import { existsSync, linkSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';

/**
 * The stopping rule of kernel-sprt.ts. A bound crossed before `minGames`
 * games is not a verdict: with a handful of games the trinomial variance
 * estimate can be near zero, inflating the normal-approximation LLR.
 */
export type SprtVerdict = 'H1 accepted (improvement)' | 'H0 accepted (no improvement)' | 'undecided';

export const sprtVerdict = (llr: number, games: number, [lower, upper]: readonly [number, number], minGames: number): SprtVerdict => {
  if (games < minGames) return 'undecided';
  if (llr >= upper) return 'H1 accepted (improvement)';
  if (llr <= lower) return 'H0 accepted (no improvement)';
  return 'undecided';
};

/** Legacy array-based per-run opening list; retained for earlier results. */
export const runOpenings = (stored: string | undefined, requested: string[][], override: boolean): { openings: string[][]; store: boolean } => {
  if (stored === undefined) return { openings: requested, store: true };
  const openings = JSON.parse(stored) as string[][];
  if (override && JSON.stringify(openings) !== JSON.stringify(requested)) {
    throw new Error('this run was started with a different opening list; use another --name');
  }
  return { openings, store: false };
};

/** Publish data atomically under a new filename, without replacing a winner. */
export const publishOnce = (file: string, contents: string): void => {
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, contents, { flag: 'wx' });
    try {
      linkSync(temp, file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  } finally {
    if (existsSync(temp)) unlinkSync(temp);
  }
};

/**
 * Publish the shared default opening cache exactly once, then validate
 * the winner's list (also kept for existing clients and tests).
 */
export const loadRunOpenings = (file: string, requested: () => string[][], override: boolean): string[][] => {
  if (existsSync(file)) {
    return runOpenings(readFileSync(file, 'utf8'), override ? requested() : [], override).openings;
  }
  const candidate = requested();
  publishOnce(file, `${JSON.stringify(candidate)}\n`);
  // This is the canonical published list, not necessarily our proposal.
  return runOpenings(readFileSync(file, 'utf8'), candidate, override).openings;
};

import { randomUUID } from 'node:crypto';
import { existsSync, linkSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';

/**
 * The stopping rule of kernel-sprt.ts. A bound crossed before `minGames`
 * games is not a verdict: with a handful of games the trinomial variance
 * estimate can be near zero (nearly all wins), which inflates the normal-
 * approximation LLR far past either bound.
 */
export type SprtVerdict = 'H1 accepted (improvement)' | 'H0 accepted (no improvement)' | 'undecided';

export const sprtVerdict = (llr: number, games: number, [lower, upper]: readonly [number, number], minGames: number): SprtVerdict => {
  if (games < minGames) return 'undecided';
  if (llr >= upper) return 'H1 accepted (improvement)';
  if (llr <= lower) return 'H0 accepted (no improvement)';
  return 'undecided';
};

/**
 * The opening list of one run. A run stores its list in its own directory
 * the first time, and every restart plays that list: without an override it
 * is reused, and an override that differs is refused, so games resumed by id
 * never mix two opening sets.
 */
export const runOpenings = (stored: string | undefined, requested: string[][], override: boolean): { openings: string[][]; store: boolean } => {
  if (stored === undefined) return { openings: requested, store: true };
  const openings = JSON.parse(stored) as string[][];
  if (override && JSON.stringify(openings) !== JSON.stringify(requested)) {
    throw new Error('this run was started with a different opening list; use another --name');
  }
  return { openings, store: false };
};

/**
 * Publish the openings for this run once and only once, even when shards
 * initialize concurrently. The private file is closed before an atomic hard
 * link exposes it under the shared name. If another shard won, read its full
 * list and reject a conflicting explicit override before playing games.
 * Without an override, a restart must not regenerate the default openings.
 * Caller creates the parent directory before invoking this helper.
 */
export const loadRunOpenings = (file: string, requested: () => string[][], override: boolean): string[][] => {
  if (existsSync(file)) {
    return runOpenings(readFileSync(file, 'utf8'), override ? requested() : [], override).openings;
  }
  const candidate = requested();
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, `${JSON.stringify(candidate)}\n`, { flag: 'wx' });
    try {
      // Atomic, no-replace publication: readers see only complete JSON.
      linkSync(temp, file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  } finally {
    if (existsSync(temp)) unlinkSync(temp);
  }
  // This is the canonical published list, not necessarily our proposal.
  return runOpenings(readFileSync(file, 'utf8'), candidate, override).openings;
};

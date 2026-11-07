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

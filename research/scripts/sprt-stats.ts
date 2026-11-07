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

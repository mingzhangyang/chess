import type { EngineAdapterComputeInput } from '../../../src/workers/engineAdapter';
import { searchForComparison } from '../../../src/utils/chess-ai/independentSearch';
import { createGameFromInput } from '../../../src/workers/tsEngineAdapter';

/**
 * Positions from the deterministic game used by
 * research/scripts/search-position-history-benchmark.ts: the legacy engine
 * plays itself at depth 2 from the start, and each checkpoint carries its
 * complete history.
 */
export const selfPlayHistoryPositions = (checkpoints: readonly number[]): Map<number, EngineAdapterComputeInput> => {
  const tuning = { openingBookEnabled: false };
  const history: string[] = [];
  const game = createGameFromInput({ fen: 'start', history: [], difficulty: 'expert' });
  const positions = new Map<number, EngineAdapterComputeInput>();
  for (let ply = 1; ply <= Math.max(...checkpoints); ply += 1) {
    const step = searchForComparison({ backend: 'legacy',
      input: { fen: game.fen(), history: [...history], difficulty: 'expert', tuning },
      maxDepth: 2, timeLimitMs: 60_000, random: () => 0 });
    if (!step.uci) break;
    game.move({ from: step.uci.slice(0, 2), to: step.uci.slice(2, 4), promotion: step.uci[4] });
    history.push(step.uci);
    if (checkpoints.includes(ply)) positions.set(ply, { fen: game.fen(), history: [...history], difficulty: 'expert', tuning });
  }
  return positions;
};

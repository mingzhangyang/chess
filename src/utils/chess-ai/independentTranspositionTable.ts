import type { AiMove } from './chessAIBoardOps';
import { encodeTTMove } from './chessAITranspositionTable';
import type { AiTuning } from './chessAITuning';
import { SearchPosition, type SearchPositionSnapshot } from './searchPosition';

type Flag = 'exact' | 'lowerbound' | 'upperbound';
type Entry = { snapshot: SearchPositionSnapshot; depth: number; score: number; flag: Flag; bestMove: number; bytes: number };

/** Private to a single comparison search; never shares scores with production. */
export class IndependentTranspositionTable {
  private readonly entries = new Map<string, Entry>();
  private readonly tuningKey: string;
  private snapshotBytes = 0;
  constructor(private readonly color: 'w' | 'b', private readonly tuning: AiTuning,
    private readonly maxSnapshotBytes = 16 * 1024 * 1024) {
    this.tuningKey = JSON.stringify(tuning);
  }

  private key(position: SearchPosition, color: 'w' | 'b', tuning: AiTuning): string | null {
    // Missing earlier history can change the score of any descendant. Do not
    // reuse/store scores until history is known; never call unknown a draw.
    if (!position.hasCompleteHistory || color !== this.color) return null;
    if (!(tuning === this.tuning && Object.isFrozen(tuning)) && JSON.stringify(tuning) !== this.tuningKey) return null;
    return position.transpositionIndex;
  }

  lookup(position: SearchPosition, color: 'w' | 'b', tuning: AiTuning, depth: number):
    { bestMove: number; score?: number; flag?: Flag } | undefined {
    const key = this.key(position, color, tuning);
    const entry = key === null ? undefined : this.entries.get(key);
    if (!entry || !position.matchesSearchSnapshot(entry.snapshot)) return undefined;
    return entry.depth < depth ? { bestMove: entry.bestMove }
      : { bestMove: entry.bestMove, score: entry.score, flag: entry.flag };
  }

  store(position: SearchPosition, color: 'w' | 'b', tuning: AiTuning,
    depth: number, score: number, flag: Flag, move: AiMove): void {
    const key = this.key(position, color, tuning);
    if (key === null) return;
    const old = this.entries.get(key);
    if (old && old.depth > depth && position.matchesSearchSnapshot(old.snapshot)) return;
    if (old) { this.entries.delete(key); this.snapshotBytes -= old.bytes; }
    const bytes = position.estimatedSnapshotBytes;
    if (bytes > this.maxSnapshotBytes) return;
    // Long histories make a full collision-verification snapshot larger. Bound
    // their total estimated footprint instead of just counting table entries.
    while (this.entries.size && (this.snapshotBytes + bytes > this.maxSnapshotBytes || this.entries.size >= 100_000)) {
      const oldest = this.entries.keys().next().value!;
      this.snapshotBytes -= this.entries.get(oldest)!.bytes;
      this.entries.delete(oldest);
    }
    this.entries.set(key, { snapshot: position.captureSearchSnapshot(), depth, score, flag,
      bestMove: encodeTTMove(move), bytes });
    this.snapshotBytes += bytes;
  }
}

let current: IndependentTranspositionTable | undefined;
export const setIndependentTable = (table?: IndependentTranspositionTable): void => { current = table; };
export const getIndependentTable = (): IndependentTranspositionTable | undefined => current;

/**
 * An SPRT must not stop after only the first (sorted) book openings.
 * Shuffle whole openings, not individual game IDs: slots 2*k and 2*k+1
 * always use the same opening with the new kernel playing opposite colors.
 * A run's published snapshot is the authority for every shard and restart.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { publishOnce } from './sprt-stats.ts';

export const DEFAULT_OPENING_SEED = 0x05eed123;
export const OPENING_ORDER_VERSION = 1;
type OrderMode = 'seeded-shuffle' | 'as-provided';

export type RunOpeningOptions = {
  seed: number;
  explicitSeed: boolean;
  sourceOverride: boolean;
  preserveOrder: boolean;
  explicitPreserveOrder: boolean;
};

type OpeningSnapshot = {
  version: typeof OPENING_ORDER_VERSION;
  mode: OrderMode;
  seed: number | null;
  sourceSha256: string;
  openings: string[][];
};

/** A decimal unsigned 32-bit seed; no implicit rounding or integer wrap. */
export const parseOpeningSeed = (value: string): number => {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new Error('--opening-seed must be an unsigned 32-bit decimal integer');
  const seed = Number(value);
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new Error('--opening-seed must be an unsigned 32-bit decimal integer');
  }
  return seed;
};

const checkedOpenings = (value: unknown): string[][] => {
  if (!Array.isArray(value) || value.length === 0 || !value.every((line: unknown) =>
    Array.isArray(line) && line.every((move: unknown) => typeof move === 'string'))) {
    throw new Error('openings must be a non-empty JSON array of UCI move lists');
  }
  return value as string[][];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** Read either a traditional openings array or a versioned run snapshot. */
export const parseOpeningList = (raw: string): string[][] => {
  const value: unknown = JSON.parse(raw);
  if (isRecord(value)) return parseSnapshot(value).openings;
  return checkedOpenings(value);
};

const parseSnapshot = (value: unknown): OpeningSnapshot => {
  if (!isRecord(value) || value.version !== OPENING_ORDER_VERSION ||
      (value.mode !== 'seeded-shuffle' && value.mode !== 'as-provided') ||
      (value.mode === 'seeded-shuffle' &&
        (typeof value.seed !== 'number' || !Number.isInteger(value.seed) || value.seed < 0 || value.seed > 0xffffffff)) ||
      (value.mode === 'as-provided' && value.seed !== null) ||
      typeof value.sourceSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(value.sourceSha256)) {
    throw new Error('unrecognized SPRT openings snapshot format');
  }
  return { version: OPENING_ORDER_VERSION, mode: value.mode, seed: value.seed as number | null,
    sourceSha256: value.sourceSha256, openings: checkedOpenings(value.openings) };
};

const fingerprint = (openings: string[][]): string =>
  createHash('sha256').update(JSON.stringify(openings)).digest('hex');

/** Fisher-Yates driven by a specified 32-bit LCG (deterministic across Node versions). */
export const shuffleOpeningPairs = (openings: readonly (readonly string[])[], seed: number): string[][] => {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('invalid opening seed');
  const result = openings.map((line) => [...line]);
  let state = seed;
  for (let i = result.length - 1; i > 0; i -= 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const j = Math.floor((state / 0x100000000) * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
};

/**
 * A new run atomically publishes its order and seed in ONE file. Legacy
 * (unshuffled) array snapshots are resumed unchanged, including their IDs.
 * In a startup race, a losing shard validates the winner's source/seed/mode.
 * Normal restarts need not regenerate the expensive default opening source.
 */
export const loadShuffledRunOpenings = (
  file: string, requested: () => string[][], options: RunOpeningOptions,
): string[][] => {
  const existed = existsSync(file);
  let source: string[][] | undefined;
  const input = (): string[][] => (source ??= checkedOpenings(requested()));
  const desiredMode: OrderMode = options.preserveOrder ? 'as-provided' : 'seeded-shuffle';
  if (!existed) {
    const original = input();
    const snapshot: OpeningSnapshot = {
      version: OPENING_ORDER_VERSION, mode: desiredMode,
      seed: options.preserveOrder ? null : options.seed,
      sourceSha256: fingerprint(original),
      openings: options.preserveOrder ? original.map((line) => [...line]) : shuffleOpeningPairs(original, options.seed),
    };
    publishOnce(file, `${JSON.stringify(snapshot)}\n`);
  }
  const raw = readFileSync(file, 'utf8');
  const parsed: unknown = JSON.parse(raw);
  if (Array.isArray(parsed)) {
    const legacy = checkedOpenings(parsed);
    if (options.explicitSeed) throw new Error('legacy SPRT run has no seed; use a new --name for shuffled openings');
    if (options.sourceOverride && JSON.stringify(input()) !== JSON.stringify(legacy)) {
      throw new Error('this run was started with a different opening list; use another --name');
    }
    return legacy;
  }
  const snapshot = parseSnapshot(parsed);
  if ((options.explicitSeed || !existed) && snapshot.seed !== (options.preserveOrder ? null : options.seed)) {
    throw new Error('this run was started with a different opening seed; use another --name');
  }
  if ((options.explicitPreserveOrder || !existed) && snapshot.mode !== desiredMode) {
    throw new Error('this run was started with a different opening order mode; use another --name');
  }
  if ((options.sourceOverride || !existed) && snapshot.sourceSha256 !== fingerprint(input())) {
    throw new Error('this run was started with a different opening list; use another --name');
  }
  return snapshot.openings;
};

/** The two game IDs in each opening pair retain opposite new-kernel colors. */
export const openingSlotForGame = (id: number, openings: string[][]): { opening: string[]; newColor: 'w' | 'b' } => {
  if (!Number.isInteger(id) || id < 0 || id >= openings.length * 2) throw new Error('SPRT game ID outside the opening list');
  return { opening: openings[id >> 1], newColor: id % 2 === 0 ? 'w' : 'b' };
};

/** Small metadata block for a saved summary (never guesses a legacy seed). */
export const readRunOpeningOrder = (file: string): { mode: string; seed: number | null; openings: number; sourceSha256?: string } | undefined => {
  if (!existsSync(file)) return undefined;
  const raw: unknown = JSON.parse(readFileSync(file, 'utf8'));
  if (Array.isArray(raw)) return { mode: 'legacy-unshuffled', seed: null, openings: checkedOpenings(raw).length };
  const snapshot = parseSnapshot(raw);
  return { mode: snapshot.mode, seed: snapshot.seed, openings: snapshot.openings.length, sourceSha256: snapshot.sourceSha256 };
};

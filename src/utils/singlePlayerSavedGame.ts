// Read by the eagerly loaded lobby: keep the chess.js runtime out of this
// module (type imports only) so it stays out of the initial bundle.
import type { Chess } from 'chess.js';
import { isGameOver } from './gameResult';

export const SINGLE_PLAYER_SAVED_GAME_KEY = 'single-player-saved-game';
const SAVED_GAME_VERSION = 1;
const DIFFICULTIES = ['easy', 'medium', 'hard', 'expert'];

export interface SavedSinglePlayerGame {
  version: typeof SAVED_GAME_VERSION;
  difficulty: string;
  playerColor: 'w' | 'b';
  /** SAN moves from the standard start position. */
  moves: string[];
  savedAt: number;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** localStorage, or null when the browser blocks it (privacy modes, SSR). */
export function getBrowserStorage(): StorageLike | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Saves an unfinished game; a fresh or finished game clears the entry. */
export function persistSinglePlayerGame(
  storage: StorageLike | null,
  game: Chess,
  difficulty: string,
  playerColor: 'w' | 'b',
  now: number = Date.now(),
): void {
  if (!storage) return;
  try {
    const moves = game.history();
    if (moves.length === 0 || isGameOver(game)) {
      storage.removeItem(SINGLE_PLAYER_SAVED_GAME_KEY);
      return;
    }
    const saved: SavedSinglePlayerGame = {
      version: SAVED_GAME_VERSION,
      difficulty,
      playerColor,
      moves,
      savedAt: now,
    };
    storage.setItem(SINGLE_PLAYER_SAVED_GAME_KEY, JSON.stringify(saved));
  } catch {
    // Saving is a convenience; quota or privacy errors must not break play.
  }
}

function isSavedSinglePlayerGame(value: unknown): value is SavedSinglePlayerGame {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return candidate.version === SAVED_GAME_VERSION
    && typeof candidate.difficulty === 'string'
    && DIFFICULTIES.includes(candidate.difficulty)
    && (candidate.playerColor === 'w' || candidate.playerColor === 'b')
    && Array.isArray(candidate.moves)
    && candidate.moves.length > 0
    && candidate.moves.every((move) => typeof move === 'string')
    && typeof candidate.savedAt === 'number';
}

/**
 * Returns the saved entry if it is well-formed. Move legality is checked when
 * the game is restored, since that needs the chess.js runtime.
 */
export function readSavedSinglePlayerGame(storage: StorageLike | null): SavedSinglePlayerGame | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(SINGLE_PLAYER_SAVED_GAME_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isSavedSinglePlayerGame(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

import type { Chess, Move } from 'chess.js';
import { describeGameResult } from './gameResult';

export type MoveSoundKind = 'move' | 'capture' | 'check' | 'game-over';

const SOUND_ASSETS: Record<MoveSoundKind, string> = {
  move: '/move-self.mp3',
  capture: '/capture.wav',
  check: '/check.wav',
  'game-over': '/game-over.wav',
};

const soundPlayers = new Map<MoveSoundKind, HTMLAudioElement>();
let activeSound: HTMLAudioElement | null = null;
let cachedEnabled: boolean | null = null;
const MOVE_SOUND_ENABLED_KEY = 'chess:move-sound-enabled';

/** One cue per move, with the most important event taking precedence. */
export function getMoveSoundKind(
  game: Chess,
  move: Pick<Move, 'captured'> | null | undefined,
  fenHistory?: readonly string[],
): MoveSoundKind {
  // Multiplayer uses FEN-only Chess objects, so its repetition history must
  // be supplied separately to detect a threefold-repetition ending.
  if (describeGameResult(game, null, fenHistory)) return 'game-over';
  if (game.isCheck()) return 'check';
  if (move?.captured) return 'capture'; // Also covers en passant.
  return 'move';
}

function readMoveSoundEnabled(): boolean {
  if (cachedEnabled !== null) return cachedEnabled;
  if (typeof window === 'undefined') return true;
  try {
    cachedEnabled = window.localStorage.getItem(MOVE_SOUND_ENABLED_KEY) !== 'false';
  } catch {
    cachedEnabled = true;
  }
  return cachedEnabled;
}

export function isMoveSoundEnabled(): boolean {
  return readMoveSoundEnabled();
}

export function setMoveSoundEnabled(enabled: boolean): void {
  cachedEnabled = enabled;
  if (!enabled && activeSound) {
    try {
      activeSound.pause();
      activeSound.currentTime = 0;
    } catch {
      // Sound playback must never interfere with the game.
    }
  }
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(MOVE_SOUND_ENABLED_KEY, enabled ? 'true' : 'false');
  } catch {
    // Allow the toggle to work even when storage is unavailable.
  }
}

export function playMoveSound(kind: MoveSoundKind = 'move'): void {
  if (typeof window === 'undefined' || typeof Audio === 'undefined' || !readMoveSoundEnabled()) {
    return;
  }

  try {
    let sound = soundPlayers.get(kind);
    if (!sound) {
      sound = new Audio(SOUND_ASSETS[kind]);
      sound.preload = 'auto';
      sound.volume = 0.5;
      soundPlayers.set(kind, sound);
    }

    // Rapid consecutive moves should not layer several overlapping effects.
    if (activeSound && activeSound !== sound) {
      activeSound.pause();
      activeSound.currentTime = 0;
    }
    sound.currentTime = 0;
    activeSound = sound;
    const playPromise = sound.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      void playPromise.catch(() => {});
    }
  } catch {
    // Ignore autoplay and decoder errors so gameplay never breaks.
  }
}

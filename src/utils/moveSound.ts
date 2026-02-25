let moveSound: HTMLAudioElement | null = null;
let cachedEnabled: boolean | null = null;
const MOVE_SOUND_ENABLED_KEY = 'chess:move-sound-enabled';

function readMoveSoundEnabled(): boolean {
  if (cachedEnabled !== null) {
    return cachedEnabled;
  }
  if (typeof window === 'undefined') {
    cachedEnabled = true;
    return cachedEnabled;
  }

  const stored = window.localStorage.getItem(MOVE_SOUND_ENABLED_KEY);
  cachedEnabled = stored !== 'false';
  return cachedEnabled;
}

export function isMoveSoundEnabled(): boolean {
  return readMoveSoundEnabled();
}

export function setMoveSoundEnabled(enabled: boolean): void {
  cachedEnabled = enabled;
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(MOVE_SOUND_ENABLED_KEY, enabled ? 'true' : 'false');
}

export function playMoveSound(): void {
  if (typeof window === 'undefined' || typeof Audio === 'undefined') {
    return;
  }
  if (!readMoveSoundEnabled()) {
    return;
  }

  try {
    if (!moveSound) {
      moveSound = new Audio('/move-self.mp3');
      moveSound.preload = 'auto';
      moveSound.volume = 0.5;
    }

    moveSound.currentTime = 0;
    const playPromise = moveSound.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      void playPromise.catch(() => {});
    }
  } catch {
    // Ignore sound errors so gameplay never breaks.
  }
}

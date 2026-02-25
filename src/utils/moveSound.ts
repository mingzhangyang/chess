let audioContext: AudioContext | null = null;

export function playMoveSound(): void {
  if (typeof window === 'undefined' || typeof window.AudioContext === 'undefined') {
    return;
  }

  try {
    if (!audioContext) {
      audioContext = new window.AudioContext();
    }

    const context = audioContext;
    if (context.state === 'suspended') {
      void context.resume();
    }
    if (context.state !== 'running') {
      return;
    }

    const startTime = context.currentTime;
    const oscillator = context.createOscillator();
    const gainNode = context.createGain();

    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(660, startTime);
    oscillator.frequency.exponentialRampToValueAtTime(520, startTime + 0.08);

    gainNode.gain.setValueAtTime(0.0001, startTime);
    gainNode.gain.exponentialRampToValueAtTime(0.055, startTime + 0.012);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.1);

    oscillator.connect(gainNode);
    gainNode.connect(context.destination);

    oscillator.start(startTime);
    oscillator.stop(startTime + 0.1);
    oscillator.onended = () => {
      oscillator.disconnect();
      gainNode.disconnect();
    };
  } catch {
    // Ignore sound errors so gameplay never breaks.
  }
}

import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { playMoveSound, setMoveSoundEnabled } from '../../src/utils/moveSound';

test('all new effects are short, valid PCM WAV files and unused tracks are removed', () => {
  for (const name of ['capture', 'check', 'game-over']) {
    const file = readFileSync(path.resolve(process.cwd(), 'public', `${name}.wav`));
    assert.equal(file.toString('ascii', 0, 4), 'RIFF', name);
    assert.equal(file.toString('ascii', 8, 12), 'WAVE', name);
    assert.equal(file.toString('ascii', 12, 16), 'fmt ', name);
    assert.equal(file.readUInt16LE(20), 1, 'uncompressed PCM');
    assert.equal(file.readUInt16LE(22), 1, 'mono');
    assert.equal(file.readUInt16LE(34), 16, '16-bit');
    assert.equal(file.readUInt32LE(40), file.length - 44, name);
    assert.ok(file.length < 25_000, `${name} should remain small`);
  }
  assert.equal(existsSync(path.resolve(process.cwd(), 'public', 'dun dun dun dun.mp3')), false);
  assert.equal(existsSync(path.resolve(process.cwd(), 'public', 'fahhhahahahah.mp3')), false);
});

test('playback reuses audio objects, stops overlapping cues, and respects mute', () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const originalAudio = Object.getOwnPropertyDescriptor(globalThis, 'Audio');
  const sounds: FakeAudio[] = [];
  class FakeAudio {
    currentTime = 0;
    preload = '';
    volume = 1;
    plays = 0;
    pauses = 0;
    constructor(readonly src: string) {
      sounds.push(this);
    }
    pause() { this.pauses += 1; }
    play() { this.plays += 1; return Promise.resolve(); }
  }
  const saved = new Map<string, string>();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage: {
      getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => { saved.set(key, value); },
    } },
  });
  Object.defineProperty(globalThis, 'Audio', { configurable: true, value: FakeAudio });
  try {
    setMoveSoundEnabled(true);
    playMoveSound('move');
    assert.equal(sounds[0].src, '/move-self.mp3');
    assert.equal(sounds[0].plays, 1);
    playMoveSound('capture');
    assert.equal(sounds[0].pauses, 1);
    assert.equal(sounds[1].src, '/capture.wav');
    playMoveSound('check');
    assert.equal(sounds[1].pauses, 1);
    assert.equal(sounds[2].src, '/check.wav');
    playMoveSound('game-over');
    assert.equal(sounds[2].pauses, 1);
    assert.equal(sounds[3].src, '/game-over.wav');
    playMoveSound('capture');
    assert.equal(sounds.length, 4, 'repeat playback reuses an audio element');
    assert.equal(sounds[1].plays, 2);
    setMoveSoundEnabled(false);
    assert.equal(sounds[1].pauses, 2);
    playMoveSound('game-over');
    assert.equal(sounds[3].plays, 1, 'mute suppresses end-game audio too');
    assert.equal(saved.get('chess:move-sound-enabled'), 'false');
  } finally {
    setMoveSoundEnabled(true);
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else Reflect.deleteProperty(globalThis, 'window');
    if (originalAudio) Object.defineProperty(globalThis, 'Audio', originalAudio);
    else Reflect.deleteProperty(globalThis, 'Audio');
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { browserRendererPids, createSignalThrottle, dutyCycleForRate, installThrottleCleanup } from '../../research/scripts/renderer-throttle';

test('duty-cycle fallback preserves requested 1x and derives slower rates', () => {
  assert.deepEqual(dutyCycleForRate(1), { cycleMs: 100, runMs: 100, pauseMs: 0 });
  assert.deepEqual(dutyCycleForRate(4), { cycleMs: 100, runMs: 25, pauseMs: 75 });
  assert.deepEqual(dutyCycleForRate(6), { cycleMs: 100, runMs: 17, pauseMs: 83 });
});

test('duty-cycle fallback rejects invalid rates and cycles', () => {
  assert.throws(() => dutyCycleForRate(0), /rate/);
  assert.throws(() => dutyCycleForRate(Number.NaN), /rate/);
  assert.throws(() => dutyCycleForRate(4, 1), /cycle/);
});


test('browser-scoped CDP process list excludes unrelated and non-renderer processes', () => {
  assert.deepEqual(browserRendererPids([
    { type: 'browser', id: 12 }, { type: 'renderer', id: 101 },
    { type: 'utility', id: 103 }, { type: 'renderer', id: 102 },
    { type: 'renderer', id: 101 }, { type: 'renderer', id: -1 },
    { type: 'renderer', id: Number.NaN },
  ]), [101, 102]);
});

test('signal throttle pauses only supplied renderers and resumes them on cleanup', () => {
  const events: string[] = [];
  const callbacks = new Map<number, () => void>();
  let next = 0;
  const schedule = (fn: () => void, ms: number) => {
    events.push('timer:' + ms);
    const id = ++next;
    callbacks.set(id, fn);
    return id as unknown as ReturnType<typeof setTimeout>;
  };
  const cancel = (handle: ReturnType<typeof setTimeout>) => { callbacks.delete(handle as unknown as number); };
  const tick = () => {
    const [id, callback] = callbacks.entries().next().value!;
    callbacks.delete(id);
    callback();
  };
  const throttle = createSignalThrottle((pid, signal) => { events.push(signal + ':' + pid); }, schedule, cancel);
  throttle.start(4, [101, 102, 101]);
  assert.deepEqual(events, ['timer:25']);
  tick();
  assert.deepEqual(events, ['timer:25', 'SIGSTOP:101', 'SIGSTOP:102', 'timer:75']);
  throttle.stop();
  assert.deepEqual(events.slice(-2), ['SIGCONT:101', 'SIGCONT:102']);
  assert.equal(callbacks.size, 0);
  throttle.stop();
  assert.equal(events.filter((event) => event.startsWith('SIGCONT')).length, 2);
  assert.ok(!events.some((event) => event.includes('999')));
});

test('rate reset and restart always resume previously stopped PIDs', () => {
  const events: string[] = [];
  const callbacks = new Map<number, () => void>();
  let next = 0;
  const throttle = createSignalThrottle(
    (pid, signal) => { events.push(signal + ':' + pid); },
    (fn) => { const id = ++next; callbacks.set(id, fn); return id as unknown as ReturnType<typeof setTimeout>; },
    (handle) => { callbacks.delete(handle as unknown as number); },
  );
  const tick = () => { const [id, fn] = callbacks.entries().next().value!; callbacks.delete(id); fn(); };
  throttle.start(4, [101]);
  tick(); // SIGSTOP
  throttle.start(6, [102]);
  assert.deepEqual(events, ['SIGSTOP:101', 'SIGCONT:101']);
  tick(); // SIGSTOP for new browser process only
  throttle.start(1, []);
  assert.deepEqual(events, ['SIGSTOP:101', 'SIGCONT:101', 'SIGSTOP:102', 'SIGCONT:102']);
  assert.equal(callbacks.size, 0);
});

test('failed stop signals do not result in a spurious resume', () => {
  const events: string[] = [];
  const callbacks: Array<() => void> = [];
  const throttle = createSignalThrottle((pid, signal) => {
    events.push(signal + ':' + pid);
    if (pid === 102 && signal === 'SIGSTOP') throw new Error('exited');
  }, (fn) => { callbacks.push(fn); return callbacks.length as unknown as ReturnType<typeof setTimeout>; }, () => {});
  throttle.start(4, [101, 102]);
  callbacks.shift()!();
  throttle.stop();
  assert.deepEqual(events, ['SIGSTOP:101', 'SIGSTOP:102', 'SIGCONT:101']);
});

test('termination signal cleanup runs synchronously before exiting', () => {
  const emitter = new EventEmitter();
  const events: string[] = [];
  installThrottleCleanup(() => events.push('resume-owned'), {
    on: (event, callback) => { emitter.on(event, callback); },
    once: (event, callback) => { emitter.once(event, callback); },
    exit: (code) => { events.push('exit:' + code); throw new Error('simulated exit'); },
  });
  assert.throws(() => emitter.emit('SIGTERM'), /simulated exit/);
  assert.deepEqual(events, ['resume-owned', 'exit:143']);
  emitter.emit('exit');
  assert.deepEqual(events, ['resume-owned', 'exit:143', 'resume-owned']);
});

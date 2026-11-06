import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTsSearchKernel, TS_SEARCH_KERNEL_STORAGE_KEY } from '../../src/utils/aiSearchKernelToggle';

class MemoryStorage {
  readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}

test('the TS search kernel switch is off unless explicitly enabled', () => {
  assert.equal(resolveTsSearchKernel('', null), undefined);
  assert.equal(resolveTsSearchKernel('', new MemoryStorage()), undefined);
  const storage = new MemoryStorage();
  storage.setItem(TS_SEARCH_KERNEL_STORAGE_KEY, 'something-else');
  assert.equal(resolveTsSearchKernel('?aiKernel=bogus', storage), undefined);
});

test('a URL parameter turns the switch on or off and remembers it', () => {
  const storage = new MemoryStorage();
  assert.equal(resolveTsSearchKernel('?aiKernel=independent', storage), 'independent');
  assert.equal(storage.getItem(TS_SEARCH_KERNEL_STORAGE_KEY), 'independent');
  assert.equal(resolveTsSearchKernel('', storage), 'independent');
  assert.equal(resolveTsSearchKernel('?lang=en&aiKernel=default', storage), undefined);
  assert.equal(storage.getItem(TS_SEARCH_KERNEL_STORAGE_KEY), null);
  assert.equal(resolveTsSearchKernel('', storage), undefined);
  // Without storage the URL still applies to this request.
  assert.equal(resolveTsSearchKernel('?aiKernel=independent', null), 'independent');
});

test('storage failures leave the switch off', () => {
  const throwing = {
    getItem: () => { throw new Error('denied'); },
    setItem: () => { throw new Error('quota'); },
    removeItem: () => { throw new Error('denied'); },
  };
  assert.equal(resolveTsSearchKernel('', throwing), undefined);
  assert.equal(resolveTsSearchKernel('?aiKernel=independent', throwing), 'independent');
  assert.equal(resolveTsSearchKernel('?aiKernel=default', throwing), undefined);
});

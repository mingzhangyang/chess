import test from 'node:test';
import assert from 'node:assert/strict';
import { RepetitionStack } from '../../src/utils/chess-ai/searchPositionRepetition';

const board = (marker: number): Int8Array => {
  const value = new Int8Array(64);
  value[0] = marker;
  return value;
};
const signature = (stack: RepetitionStack): [number, number] => [stack.signatureLow, stack.signatureHigh];

test('repetition counts verify the full identity when 64-bit hashes collide', () => {
  const stack = new RepetitionStack(true);
  stack.push(7, 9, board(1), 1, 0, -1, 'reversible');
  stack.push(1, 1, board(5), -1, 0, -1, 'reversible');
  stack.push(7, 9, board(2), 1, 0, -1, 'reversible');
  assert.equal(stack.count, 1, 'same hash, different board');
  stack.push(1, 1, board(5), -1, 0, -1, 'reversible');
  stack.push(7, 9, board(1), 1, 0, -1, 'reversible');
  assert.equal(stack.count, 2, 'only the matching board counts');
  stack.pop();
  for (const [side, rights, ep] of [[-1, 0, -1], [1, 1, -1], [1, 0, 3]] as const) {
    stack.push(7, 9, board(1), side, rights, ep, 'reversible');
    assert.equal(stack.count, 1, `side ${side}, rights ${rights}, ep ${ep}`);
    stack.pop();
  }
  assert.throws(() => stack.push(7, 9, new Int8Array(63), 1, 0, -1, 'reversible'));
});

test('an irreversible move starts a new window, completes history, and pop restores the old one', () => {
  const stack = new RepetitionStack(false);
  stack.push(1, 1, board(1), 1, 0, -1, 'reversible');
  stack.push(2, 2, board(2), -1, 0, -1, 'reversible');
  stack.push(1, 1, board(1), 1, 0, -1, 'reversible');
  assert.deepEqual([stack.count, stack.complete, stack.windowLength], [2, false, 3]);
  const before = signature(stack);
  stack.push(3, 3, board(3), -1, 0, -1, 'irreversible');
  assert.deepEqual([stack.count, stack.complete, stack.windowLength], [1, true, 1]);
  stack.push(4, 4, board(4), 1, 0, -1, 'reversible');
  stack.push(3, 3, board(3), -1, 0, -1, 'reversible');
  assert.deepEqual([stack.count, stack.complete, stack.windowLength], [2, true, 3]);
  stack.pop(); stack.pop(); stack.pop();
  assert.deepEqual([stack.count, stack.complete, stack.windowLength], [2, false, 3]);
  assert.deepEqual(signature(stack), before);
});

test('a null move opens an empty incomplete scope that an irreversible move can complete', () => {
  const stack = new RepetitionStack(true);
  stack.push(1, 1, board(1), 1, 0, -1, 'reversible');
  stack.push(2, 2, board(2), -1, 0, -1, 'null');
  assert.deepEqual([stack.count, stack.complete, stack.windowLength], [0, false, 0]);
  assert.deepEqual(signature(stack), [0, 0]);
  stack.push(1, 1, board(1), 1, 0, -1, 'reversible');
  assert.deepEqual([stack.count, stack.complete, stack.windowLength], [1, false, 1], 'no repetition across the pass');
  stack.push(5, 5, board(5), -1, 0, -1, 'irreversible');
  assert.deepEqual([stack.count, stack.complete], [1, true]);
  stack.pop(); stack.pop(); stack.pop();
  assert.deepEqual([stack.count, stack.complete, stack.windowLength], [1, true, 1]);
  assert.throws(() => new RepetitionStack(true).push(1, 1, board(1), 1, 0, -1, 'null'), /root/);
});

test('window signatures identify the multiset of repeatable positions', () => {
  const line = (order: number[], transitions: Array<'reversible' | 'irreversible'> = []) => {
    const stack = new RepetitionStack(true);
    order.forEach((id, index) => stack.push(id, id * 3, board(id), index % 2 ? -1 : 1, 0, -1, transitions[index] ?? 'reversible'));
    return signature(stack);
  };
  assert.deepEqual(line([1, 2, 3, 4, 5]), line([1, 4, 3, 2, 5]), 'order inside a window is irrelevant');
  assert.notDeepEqual(line([1, 2, 1, 2, 5]), line([1, 2, 3, 4, 5]), 'multiplicity changes the signature');
  assert.notDeepEqual(line([1, 2, 3, 4, 5]), line([1, 2, 3, 6, 5]));
  assert.deepEqual(line([1, 2, 3, 4, 5], ['reversible', 'reversible', 'reversible', 'reversible', 'irreversible']),
    line([7, 8, 9, 10, 5], ['reversible', 'reversible', 'reversible', 'reversible', 'irreversible']),
    'positions before an irreversible move cannot repeat and are forgotten');
});

test('the stack grows beyond its initial capacity and rejects popping the root', () => {
  const stack = new RepetitionStack(true, 2);
  for (let i = 0; i < 300; i++) stack.push(i % 4, 0, board(i % 4), i % 2 ? -1 : 1, 0, -1, 'reversible');
  assert.equal(stack.size, 300);
  assert.equal(stack.count, 75);
  for (let i = 0; i < 299; i++) stack.pop();
  assert.equal(stack.size, 1);
  assert.throws(() => stack.pop(), /root/);
});

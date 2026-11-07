/**
 * Phase 10 search features change the kernel's tree on purpose, so they are
 * gated by SPRT matches (research/scripts/kernel-sprt.ts). These tests check
 * the mechanics: each feature is active, and it does not lose forced mates
 * that the reference search finds at the same depth.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { searchForComparison } from '../../src/utils/chess-ai/independentSearch';
import { ALL_FEATURES as KERNEL_FEATURES, REFERENCE_FEATURES, MATE_SCORE } from '../../src/utils/chess-ai/independent/kernelSearch';
import type { EngineAdapterComputeInput } from '../../src/workers/engineAdapter';
import { selfPlayHistoryPositions } from './fixtures/selfPlayHistory';

const fenInput = (fen: string): EngineAdapterComputeInput => ({ fen, historyStartFen: fen, history: [], historyTruncated: false, difficulty: 'expert' });
const MATE_THRESHOLD = MATE_SCORE - 1000;

test("symmetric null-move pruning also prunes the opponent's nodes", () => {
  const history = selfPlayHistoryPositions([40]);
  for (const input of [history.get(40)!, fenInput('r2q1rk1/1b2bppp/p2ppn2/1p6/3NP3/1BN1B3/PPP2PPP/R2Q1RK1 w - - 0 11')]) {
    const reference = searchForComparison({ backend: 'independent', input, maxDepth: 6, timeLimitMs: 60_000, kernelFeatures: REFERENCE_FEATURES });
    const kernel = searchForComparison({ backend: 'independent', input, maxDepth: 6, timeLimitMs: 60_000, kernelFeatures: KERNEL_FEATURES });
    assert.ok(kernel.diagnostics.nullMoveAttempts > reference.diagnostics.nullMoveAttempts,
      `${kernel.diagnostics.nullMoveAttempts} vs ${reference.diagnostics.nullMoveAttempts}`);
    assert.ok(kernel.move);
  }
});

const MATES = [
  '6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1',
  'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4',
  'r1b1kb1r/pppp1ppp/5q2/4n3/3KP3/2N3PN/PPP4P/R1BQ1B1R b kq - 0 1',
  '2k5/8/1K6/8/8/8/8/7R w - - 0 1',
  'k7/8/1K6/8/8/8/8/6Q1 w - - 0 1',
  '8/8/8/8/8/2k5/2q5/K7 b - - 0 1',
  '5rk1/5ppp/8/8/8/8/1Q3PPP/6K1 w - - 0 1',
  '6rk/6pp/8/6N1/8/8/8/6K1 w - - 0 1',
  'r5rk/5p1p/5R2/4B3/8/8/7P/7K w - - 0 1',
  '3r1k2/5ppp/8/8/8/8/5PPP/3RR1K1 w - - 0 1',
  '4k3/R7/4K3/8/8/8/8/8 w - - 0 1',
  '7k/5Q2/6K1/8/8/8/8/8 w - - 0 1',
  // A checking mate found at depth 4 with the check extension, at depth 5 without.
  '6k1/5p1p/6p1/8/8/8/1Q3PPP/1R4K1 w - - 0 1',
];

test('the kernel with its features finds every mate the reference finds at the same depth', () => {
  let mates = 0;
  for (const fen of MATES) for (const depth of [3, 5]) {
    const input = fenInput(fen);
    const reference = searchForComparison({ backend: 'independent', input, maxDepth: depth, timeLimitMs: 60_000, kernelFeatures: REFERENCE_FEATURES });
    const kernel = searchForComparison({ backend: 'independent', input, maxDepth: depth, timeLimitMs: 60_000, kernelFeatures: KERNEL_FEATURES });
    if (reference.score === null || Math.abs(reference.score) < MATE_THRESHOLD) continue;
    mates += 1;
    assert.ok(kernel.score !== null && Math.sign(kernel.score) === Math.sign(reference.score) && Math.abs(kernel.score) >= MATE_THRESHOLD,
      `${fen} depth ${depth}: reference ${reference.score} ${reference.move}, kernel ${kernel.score} ${kernel.move}`);
  }
  assert.ok(mates >= 12, `${mates} mates found by the reference`);
});

test('static-exchange pruning shrinks the quiescence search', () => {
  const history = selfPlayHistoryPositions([40, 80]);
  for (const input of [history.get(40)!, history.get(80)!, fenInput('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1')]) {
    const without = searchForComparison({ backend: 'independent', input, maxDepth: 5, timeLimitMs: 60_000,
      kernelFeatures: { ...KERNEL_FEATURES, seeQuiescence: false } });
    const withSee = searchForComparison({ backend: 'independent', input, maxDepth: 5, timeLimitMs: 60_000, kernelFeatures: KERNEL_FEATURES });
    assert.ok(withSee.diagnostics.qNodes < without.diagnostics.qNodes, `${withSee.diagnostics.qNodes} vs ${without.diagnostics.qNodes}`);
    assert.ok(withSee.move);
  }
});

test('with static-exchange ordering, captures before the quiet moves never lose material and those after always do', async () => {
  const { MovePicker } = await import('../../src/utils/chess-ai/independent/movePicker');
  const { isTacticalMoveCode, MAX_MOVES } = await import('../../src/utils/chess-ai/independent/moveCode');
  const { SearchPosition } = await import('../../src/utils/chess-ai/searchPosition');
  const { Chess } = await import('chess.js');
  let seed = 0x9e1c7;
  const random = (n: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
  const history = new Int32Array(64 * 64);
  const picker = new MovePicker();
  picker.seeOrdering = true;
  let checkedNodes = 0;
  for (let game = 0; game < 20; game += 1) {
    const position = new SearchPosition(new Chess().fen(), { historyComplete: true });
    for (let ply = 0; ply < 100; ply += 1) {
      const all = new Int32Array(MAX_MOVES);
      const count = position.generateMoveCodes(all);
      if (!count) break;
      if (!position.isInCheck()) {
        picker.reset(position, history, 0, 0, 0, 0);
        const sequence: number[] = [];
        for (let move = picker.next(); move !== 0; move = picker.next()) sequence.push(move);
        assert.deepEqual([...sequence].sort((a, b) => a - b), Array.from(all.subarray(0, count)).sort((a, b) => a - b));
        const firstQuiet = sequence.findIndex((move) => !isTacticalMoveCode(move));
        const lastQuiet = sequence.length - 1 - [...sequence].reverse().findIndex((move) => !isTacticalMoveCode(move));
        sequence.forEach((move, index) => {
          if (!isTacticalMoveCode(move)) return;
          const exchange = position.staticExchange(move);
          if (firstQuiet < 0 || index < firstQuiet) assert.ok(exchange >= 0, `${position.toFen()} good ${move} ${exchange}`);
          else if (index > lastQuiet) assert.ok(exchange < 0, `${position.toFen()} bad ${move} ${exchange}`);
        });
        checkedNodes += 1;
      }
      const tactical = position.generateTacticalMoves();
      const legal = position.generateLegalMoves();
      position.makeMove(tactical.length && random(3) === 0 ? tactical[random(tactical.length)] : legal[random(legal.length)]);
    }
  }
  assert.ok(checkedNodes > 1000, `${checkedNodes}`);
});

test('check extension keeps every mate and finds some at a lower depth', () => {
  const without = { ...KERNEL_FEATURES, checkExtension: false };
  let earlier = 0;
  for (const fen of MATES) for (const depth of [2, 3, 4]) {
    const input = fenInput(fen);
    const plain = searchForComparison({ backend: 'independent', input, maxDepth: depth, timeLimitMs: 60_000, kernelFeatures: without });
    const extended = searchForComparison({ backend: 'independent', input, maxDepth: depth, timeLimitMs: 60_000, kernelFeatures: KERNEL_FEATURES });
    const mate = (score: number | null) => score !== null && Math.abs(score) >= MATE_THRESHOLD;
    if (mate(plain.score)) assert.ok(mate(extended.score) && Math.sign(extended.score!) === Math.sign(plain.score!), `${fen} depth ${depth}`);
    if (mate(extended.score) && !mate(plain.score)) earlier += 1;
  }
  assert.ok(earlier > 0, 'some mate is found at a lower depth');
});

test('killers at every ply, IIR and aspiration widening each change the search and keep it sound', () => {
  const history = selfPlayHistoryPositions([40, 80]);
  for (const flag of ['allPlyKillers', 'iir', 'aspirationWidening'] as const) {
    let changed = false;
    // Ply 80 at depth 9 already shows each flag's change, in about 1.5 s per
    // search; depth 11 took about 15 s, too close to the 20 s cap on slower CI runners.
    for (const [input, depth] of [[history.get(40)!, 7], [history.get(80)!, 9]] as const) {
      const without = searchForComparison({ backend: 'independent', input, maxDepth: depth, timeLimitMs: 60_000,
        kernelFeatures: { ...KERNEL_FEATURES, [flag]: false } });
      const withFlag = searchForComparison({ backend: 'independent', input, maxDepth: depth, timeLimitMs: 60_000, kernelFeatures: KERNEL_FEATURES });
      assert.equal(withFlag.completedDepth, depth, flag);
      assert.ok(withFlag.move, flag);
      if (withFlag.diagnostics.nodes !== without.diagnostics.nodes) changed = true;
    }
    assert.ok(changed, `${flag} changes the tree`);
  }
});

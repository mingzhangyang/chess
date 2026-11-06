import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { captureScore, MovePicker } from '../../src/utils/chess-ai/independent/movePicker';
import { isTacticalMoveCode, MAX_MOVES, moveCodeToUci, moveKey } from '../../src/utils/chess-ai/independent/moveCode';
import { SearchPosition } from '../../src/utils/chess-ai/searchPosition';
import { referenceMoveCodes } from './fixtures/referenceMoveGeneration';

const buffer = new Int32Array(MAX_MOVES);
const codesOf = (p: SearchPosition): number[] => Array.from(buffer.subarray(0, p.generateMoveCodes(buffer)));
const quietsOf = (p: SearchPosition): number[] => Array.from(buffer.subarray(0, p.generateQuietMoveCodes(buffer)));
const uci = (codes: number[]) => codes.map(moveCodeToUci);

const SPECIAL_FENS = [
  new Chess().fen(),
  'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
  '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
  'r3k2r/8/8/8/8/5r2/8/R3K2R w KQkq - 0 1',
  '4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1',
  '1r2k3/P7/8/8/8/8/8/4K3 w - - 0 1',
  'n1n5/PPPk4/8/8/8/8/4Kppp/5N1N b - - 0 1',
  '4r1k1/8/8/8/8/8/4N3/4K3 w - - 0 1',
  '4r1k1/8/8/8/1b6/8/8/R3K3 w - - 0 1',
  '4k3/8/8/8/1b6/8/8/4K2R w K - 0 1',
  'rb2k3/P7/K7/8/8/8/8/8 w - - 0 1',
];

/** Seeded positions reached by makeMoveCode, so every incremental structure is exercised. */
const positions = (visit: (p: SearchPosition, random: (n: number) => number) => void) => {
  let seed = 0x5ca1_ab1e;
  const random = (n: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
  for (const fen of SPECIAL_FENS) visit(new SearchPosition(fen), random);
  for (let run = 0; run < 10; run += 1) {
    const p = new SearchPosition(new Chess().fen(), { historyComplete: true });
    for (let ply = 0; ply < 120; ply += 1) {
      visit(p, random);
      const codes = codesOf(p);
      if (!codes.length) break;
      const tactical = codes.filter(isTacticalMoveCode);
      p.makeMoveCode(tactical.length && random(3) === 0 ? tactical[random(tactical.length)] : codes[random(codes.length)]);
    }
  }
};

test('quiet generation is the non-tactical part of full generation, in the same order', () => {
  let compared = 0;
  positions((p) => {
    const fen = p.toFen({ rawEnPassant: true });
    const all = referenceMoveCodes(fen);
    assert.deepEqual(uci(quietsOf(p)), uci(all.filter((code) => !isTacticalMoveCode(code))), fen);
    assert.deepEqual(quietsOf(p), all.filter((code) => !isTacticalMoveCode(code)), fen);
    compared += 1;
  });
  assert.ok(compared > 1000);
});

test('legalMoveCode returns the generated code of exactly the legal move keys', () => {
  let checked = 0;
  positions((p) => {
    const legal = new Map(codesOf(p).map((code) => [moveKey(code), code]));
    for (let from = 0; from < 64; from += 1) {
      const piece = p.pieceAt(from);
      // Every key of the side to move's pieces, plus a sample of empty and enemy squares.
      if (piece === 0 || Math.sign(piece) !== p.sideToMove) { if (from % 9 !== 0) continue; }
      for (let to = 0; to < 64; to += 1) for (const promotion of [0, 2, 3, 4, 5]) {
        const key = from | (to << 6) | (promotion << 12);
        assert.equal(p.legalMoveCode(key), legal.get(key) ?? 0, `${p.toFen()} ${from}-${to}=${promotion}`);
        checked += 1;
      }
    }
  });
  assert.ok(checked > 1_000_000);
});

type Heuristics = { tt: number; killer1: number; killer2: number; counter: number; history: Int32Array };
const historyScore = (h: Heuristics, code: number) => (isTacticalMoveCode(code) ? 0 : (h.history[code & 0xfff] * 70 / 8000) | 0);
const stableDescending = <T>(items: T[], score: (item: T) => number): T[] => items
  .map((item, index) => ({ item, index, value: score(item) }))
  .sort((a, b) => b.value - a.value || a.index - b.index).map(({ item }) => item);

/** The documented order, built from full generation without the picker. */
const expectedOrder = (p: SearchPosition, h: Heuristics): number[] => {
  const all = codesOf(p);
  const quiet = (code: number) => !isTacticalMoveCode(code);
  if (p.isInCheck()) {
    // Evasions: one list, scored as the phase 6 kernel scored every move.
    return stableDescending(all, (code) => captureScore(p, code)
      + (quiet(code) && (code & 0xfff) === h.killer1 ? 90 : quiet(code) && (code & 0xfff) === h.killer2 ? 80 : 0)
      + historyScore(h, code) + (quiet(code) && h.counter !== 0 && moveKey(code) === h.counter ? 75 : 0)
      + (h.tt !== 0 && moveKey(code) === h.tt ? 20000 : 0));
  }
  const out: number[] = [];
  const ttMove = all.find((code) => moveKey(code) === h.tt);
  if (ttMove) out.push(ttMove);
  const tactical = stableDescending(all.filter((code) => !quiet(code) && code !== ttMove), (code) => captureScore(p, code));
  out.push(...tactical.filter((code) => captureScore(p, code) >= 0));
  for (const key of [h.killer1, h.killer2]) {
    const killer = all.find((code) => quiet(code) && (code & 0xfff) === key && !out.includes(code));
    if (killer) out.push(killer);
  }
  const counter = all.find((code) => quiet(code) && moveKey(code) === h.counter && !out.includes(code));
  if (counter) out.push(counter);
  out.push(...stableDescending(all.filter((code) => quiet(code) && !out.includes(code)), (code) => historyScore(h, code)));
  out.push(...tactical.filter((code) => captureScore(p, code) < 0));
  return out;
};

const drain = (picker: MovePicker): number[] => {
  const out: number[] = [];
  for (let move = picker.next(); move !== 0; move = picker.next()) out.push(move);
  return out;
};

test('the move picker yields every legal move once: TT move, good captures, killers, countermove, quiets, bad captures', () => {
  const picker = new MovePicker();
  let compared = 0; let withTt = 0; let withKiller = 0; let withBad = 0; let inCheck = 0;
  positions((p, random) => {
    const all = codesOf(p);
    const quiet = all.filter((code) => !isTacticalMoveCode(code));
    const pick = (list: number[]) => (list.length ? list[random(list.length)] : 0);
    const randomKey = () => random(64) | (random(64) << 6);
    for (let trial = 0; trial < 4; trial += 1) {
      const history = new Int32Array(4096);
      for (const code of all) history[code & 0xfff] = random(16001) - 8000;
      // Heuristic moves: legal, quiet, tactical, stale (from another position) or none.
      const h: Heuristics = {
        tt: [0, moveKey(pick(all)), moveKey(pick(quiet)), randomKey()][trial],
        killer1: [pick(quiet) & 0xfff, 0, randomKey(), pick(all) & 0xfff][trial],
        killer2: [pick(quiet) & 0xfff, pick(quiet) & 0xfff, 0, randomKey()][trial],
        counter: [moveKey(pick(quiet)), 0, moveKey(pick(quiet)), randomKey()][trial],
        history,
      };
      if (h.killer2 === h.killer1) h.killer2 = 0;
      picker.reset(p, history, h.tt, h.killer1, h.killer2, h.counter);
      const actual = drain(picker);
      const expected = expectedOrder(p, h);
      assert.deepEqual(uci(actual), uci(expected), `${p.toFen()} ${JSON.stringify({ ...h, history: undefined })}`);
      assert.deepEqual(actual, expected);
      assert.equal(new Set(actual).size, all.length, 'every legal move exactly once');
      assert.equal(picker.next(), 0, 'stays exhausted');
      compared += 1;
      if (h.tt && all.some((code) => moveKey(code) === h.tt)) withTt += 1;
      if (quiet.some((code) => (code & 0xfff) === h.killer1)) withKiller += 1;
      if (all.some((code) => isTacticalMoveCode(code) && captureScore(p, code) < 0)) withBad += 1;
      if (p.isInCheck()) inCheck += 1;
    }
  });
  assert.ok(compared > 4000 && withTt > 1000 && withKiller > 500 && withBad > 300 && inCheck > 50,
    JSON.stringify({ compared, withTt, withKiller, withBad, inCheck }));
});

test('skipQuiets drops the remaining quiet moves and keeps the losing captures', () => {
  const picker = new MovePicker();
  const history = new Int32Array(4096);
  let skippedBeforeGeneration = 0; let checked = 0;
  positions((p, random) => {
    if (p.isInCheck()) return;
    const all = codesOf(p);
    const quiet = all.filter((code) => !isTacticalMoveCode(code));
    const killer = quiet.length ? quiet[random(quiet.length)] & 0xfff : 0;
    const h = { tt: 0, killer1: killer, killer2: 0, counter: 0, history };
    const expected = expectedOrder(p, h);
    const firstQuiet = expected.findIndex((code) => !isTacticalMoveCode(code));
    if (firstQuiet < 0) return;
    picker.reset(p, history, 0, killer, 0, 0);
    const generate = p.generateQuietMoveCodes;
    let quietGenerations = 0;
    p.generateQuietMoveCodes = (out) => { quietGenerations += 1; return generate.call(p, out); };
    try {
      const seen: number[] = [];
      for (let i = 0; i <= firstQuiet; i += 1) seen.push(picker.next());
      // The search prunes this quiet move, and so every later one: skip them.
      picker.skipQuiets();
      const rest = drain(picker);
      assert.deepEqual(seen, expected.slice(0, firstQuiet + 1));
      assert.deepEqual(rest, expected.slice(firstQuiet + 1).filter(isTacticalMoveCode), p.toFen());
      if (quietGenerations === 0) skippedBeforeGeneration += 1;
      checked += 1;
    } finally { p.generateQuietMoveCodes = generate; }
  });
  assert.ok(checked > 500 && skippedBeforeGeneration > 300, `${checked} ${skippedBeforeGeneration}`);
});

test('a picker reset mid-way starts over and does not leak earlier moves', () => {
  const p = new SearchPosition('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1');
  const picker = new MovePicker();
  const history = new Int32Array(4096);
  picker.reset(p, history, 0, 0, 0, 0);
  for (let i = 0; i < 5; i += 1) picker.next();
  picker.reset(p, history, 0, 0, 0, 0);
  assert.deepEqual(drain(picker), expectedOrder(p, { tt: 0, killer1: 0, killer2: 0, counter: 0, history }));
});

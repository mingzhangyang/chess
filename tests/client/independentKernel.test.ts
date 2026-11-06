import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { generateMoves, generateTacticalMoves } from '../../src/utils/chess-ai/chessAIBoardOps';
import { searchForComparison, type ComparisonOptions } from '../../src/utils/chess-ai/independentSearch';
import {
  isCastlingMove, isDoublePawnMove, isEnPassantMove, isTacticalMoveCode, moveCaptured, moveCodeToUci,
  moveFrom, moveKey, movePiece, movePromotion, moveTo, MAX_MOVES,
} from '../../src/utils/chess-ai/independent/moveCode';
import { SearchPosition, squareToAlgebraic } from '../../src/utils/chess-ai/searchPosition';
import type { EngineAdapterComputeInput } from '../../src/workers/engineAdapter';
import { selfPlayHistoryPositions } from './fixtures/selfPlayHistory';

const TYPES = ' pnbrqk';
const codesOf = (position: SearchPosition, tacticalOnly = false): number[] => {
  const buffer = new Int32Array(MAX_MOVES);
  return Array.from(buffer.subarray(0, position.generateMoveCodes(buffer, tacticalOnly)));
};

const randomGames = (count: number, plies: number, visit: (position: SearchPosition, game: Chess) => void) => {
  let seed = 0x2468ace;
  for (let run = 0; run < count; run += 1) {
    const game = new Chess();
    const position = new SearchPosition(game.fen(), { historyComplete: true });
    for (let ply = 0; ply < plies; ply += 1) {
      visit(position, game);
      const moves = position.generateLegalMoves();
      if (!moves.length) break;
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const move = moves[seed % moves.length];
      position.makeMove(move);
      game.move({ from: squareToAlgebraic(move.from), to: squareToAlgebraic(move.to), promotion: move.promotion });
    }
  }
};

const SPECIAL_FENS = [
  'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
  'r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1',
  '4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1',
  '1r2k3/P7/8/8/8/8/8/4K3 w - - 0 1',
  '4r1k1/8/8/8/8/8/8/4K3 w - - 0 1',
  'n1n5/PPPk4/8/8/8/8/4Kppp/5N1N b - - 0 1',
];

test('integer move codes carry the same moves, in the same order, as the object generator', () => {
  const check = (position: SearchPosition) => {
    for (const tacticalOnly of [false, true]) {
      const objects = tacticalOnly ? position.generateTacticalMoves() : position.generateLegalMoves();
      const codes = codesOf(position, tacticalOnly);
      assert.deepEqual(codes.map(moveCodeToUci), objects.map((m) => `${squareToAlgebraic(m.from)}${squareToAlgebraic(m.to)}${m.promotion ?? ''}`));
    }
  };
  for (const fen of SPECIAL_FENS) check(new SearchPosition(fen));
  randomGames(12, 120, (position) => check(position));
});

test('move code fields match chess.js piece, capture, en passant, castling, double push and promotion', () => {
  const describe = (code: number) => ({
    uci: moveCodeToUci(code), piece: TYPES[movePiece(code)], captured: moveCaptured(code) ? TYPES[moveCaptured(code)] : null,
    promotion: movePromotion(code) ? TYPES[movePromotion(code)] : null, ep: isEnPassantMove(code),
    castle: isCastlingMove(code), double: isDoublePawnMove(code), tactical: isTacticalMoveCode(code),
    key: moveKey(code) === (moveFrom(code) | (moveTo(code) << 6) | (movePromotion(code) << 12)),
  });
  const expected = (fen: string, tacticalOnly: boolean) => (tacticalOnly ? generateTacticalMoves : generateMoves)(new Chess(fen))
    .map((m) => ({ uci: `${m.from}${m.to}${m.promotion ?? ''}`, piece: m.piece, captured: m.captured ?? null,
      promotion: m.promotion ?? null, ep: m.isEnPassant(), castle: m.flags.includes('k') || m.flags.includes('q'),
      double: m.flags.includes('b'), tactical: m.isCapture() || m.isEnPassant() || m.isPromotion(), key: true }))
    .sort((a, b) => a.uci.localeCompare(b.uci));
  const check = (fen: string) => {
    for (const tacticalOnly of [false, true]) {
      const actual = codesOf(new SearchPosition(fen), tacticalOnly).map(describe).sort((a, b) => a.uci.localeCompare(b.uci));
      assert.deepEqual(actual, expected(fen, tacticalOnly), `${fen} ${tacticalOnly}`);
    }
  };
  for (const fen of SPECIAL_FENS) check(fen);
  randomGames(6, 100, (_position, game) => check(game.fen()));
});

test('makeMoveCode produces the same state as makeMove and unwinds identically', () => {
  randomGames(8, 120, (position) => {
    const before = position.toFen();
    const objects = position.generateLegalMoves();
    const codes = codesOf(position);
    for (let i = 0; i < codes.length; i += 1) {
      position.makeMove(objects[i]);
      const viaObject = [position.toFen(), position.positionHash, position.repetitionCount,
        position.transpositionKeyLow, position.transpositionKeyHigh, position.hasCompleteHistory];
      position.undo();
      position.makeMoveCode(codes[i]);
      assert.deepEqual([position.toFen(), position.positionHash, position.repetitionCount,
        position.transpositionKeyLow, position.transpositionKeyHigh, position.hasCompleteHistory], viaObject);
      position.undo();
      assert.equal(position.toFen(), before);
    }
  });
});

const run = (backend: ComparisonOptions['backend'], input: EngineAdapterComputeInput, maxDepth: number,
  extra: Partial<ComparisonOptions> = {}) => searchForComparison({ backend, input, maxDepth, timeLimitMs: 120_000, ...extra });

const HISTORY = selfPlayHistoryPositions([40, 80]);
const DIFFERENTIAL_INPUTS: Array<[string, EngineAdapterComputeInput]> = [
  ['start', { fen: 'start', history: [], difficulty: 'expert' }],
  ['ply 40', HISTORY.get(40)!],
  ['ply 80', HISTORY.get(80)!],
  ...['8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', '4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1',
    'r2q1rk1/1b2bppp/p2ppn2/1p6/3NP3/1BN1B3/PPP2PPP/R2Q1RK1 w - - 0 11']
    .map((fen): [string, EngineAdapterComputeInput] => [fen, { fen, historyStartFen: fen, history: [], historyTruncated: false, difficulty: 'expert' }]),
];

test('fixed-depth searches of the new kernel choose the legacy move with the legacy score', () => {
  for (const [name, input] of DIFFERENTIAL_INPUTS) for (const depth of [1, 2, 3, 4]) {
    const legacy = run('legacy', input, depth);
    const independent = run('independent', input, depth);
    assert.equal(independent.completedDepth, depth, `${name} depth ${depth}`);
    assert.deepEqual([independent.move, independent.score], [legacy.move, legacy.score], `${name} depth ${depth}`);
  }
  // The depths a 400 ms search now reaches on the benchmark positions.
  for (const [ply, depth] of [[40, 6], [80, 8]] as const) {
    const legacy = run('legacy', HISTORY.get(ply)!, depth);
    const independent = run('independent', HISTORY.get(ply)!, depth);
    assert.deepEqual([independent.move, independent.score], [legacy.move, legacy.score], `ply ${ply} depth ${depth}`);
  }
});

test('the new kernel reproduces the frozen shared-code search node for node', () => {
  const inputs: EngineAdapterComputeInput[] = [
    ...DIFFERENTIAL_INPUTS.map(([, input]) => input),
    ...SPECIAL_FENS.map((fen) => ({ fen, historyStartFen: fen, history: [], historyTruncated: false, difficulty: 'expert' })),
    { fen: SPECIAL_FENS[0], difficulty: 'expert' },
  ];
  const signature = (result: ReturnType<typeof run>) => [result.move, result.score, result.completedDepth,
    result.diagnostics.nodes, result.diagnostics.qNodes, result.diagnostics.nullMoveAttempts, result.diagnostics.nullMoveCuts,
    result.diagnostics.rfpPrunes, result.diagnostics.fpPrunes, result.diagnostics.lmpPrunes];
  for (const input of inputs) for (const depth of [1, 3, 5]) {
    assert.deepEqual(signature(run('independent', input, depth)), signature(run('reference', input, depth)), `${input.fen} depth ${depth}`);
  }
  for (const difficulty of ['medium', 'hard'] as const) for (const [, input] of DIFFERENTIAL_INPUTS.slice(0, 3)) {
    let a = 0x1234; let b = 0x1234;
    const lcg = (state: number) => (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const independent = run('independent', { ...input, difficulty }, 3, { random: () => (a = lcg(a)) / 2 ** 32 });
    const reference = run('reference', { ...input, difficulty }, 3, { random: () => (b = lcg(b)) / 2 ** 32 });
    assert.deepEqual(signature(independent), signature(reference), `${difficulty} ${input.fen}`);
  }
});

test('the new kernel honours aborts and leaves the position at its root', () => {
  let position: SearchPosition | undefined; let checks = 0;
  const input = HISTORY.get(40)!;
  const before = new SearchPosition(input.fen).toFen();
  const aborted = run('independent', input, 12, { onPosition: (p) => { position = p; }, shouldAbort: () => ++checks > 200 });
  assert.ok(aborted.diagnostics.searchAborted);
  assert.ok(aborted.completedDepth >= 1 && aborted.move);
  assert.equal(position!.toFen(), before);
  assert.equal(position!.ply, 0);
  const timed = searchForComparison({ backend: 'independent', input, timeLimitMs: 50 });
  assert.ok(timed.completedDepth >= 1 && timed.move);
});

test('a code generation that throws leaves no pin, evasion or output state behind', () => {
  // In check on the e-file with a pinned bishop: a failed generation had marked
  // e2..e8 as evasions and d2 as pinned.
  const fen = '4r1k1/8/8/b7/8/8/R2B4/4K3 w - - 0 1';
  const position = new SearchPosition(fen, { historyComplete: true });
  const internal = position as unknown as { isSquareAttacked: (...args: unknown[]) => boolean;
    pinned: Uint8Array; evasion: Uint8Array; genOut: Int32Array };
  const original = internal.isSquareAttacked;
  internal.isSquareAttacked = () => { throw new Error('injected attack error'); };
  try { assert.throws(() => codesOf(position), /injected attack error/); }
  finally { internal.isSquareAttacked = original; }
  assert.ok(internal.pinned.every((mark) => mark === 0), 'pin marks cleared');
  assert.ok(internal.evasion.every((mark) => mark === 0), 'evasion marks cleared');
  assert.equal(internal.genOut.length, 0, 'the caller buffer is released');
  // Move the king to d1 and give check on the d-file: a2e2 must not count as a block.
  const game = new Chess(fen);
  for (const uci of ['e1d1', 'e8d8']) {
    const code = codesOf(position).find((move) => moveCodeToUci(move) === uci)!;
    position.makeMoveCode(code); game.move({ from: uci.slice(0, 2), to: uci.slice(2, 4) });
  }
  const expected = generateMoves(game).map((m) => `${m.from}${m.to}${m.promotion ?? ''}`).sort();
  assert.deepEqual(codesOf(position).map(moveCodeToUci).sort(), expected);
  assert.equal(position.hasLegalMove(), expected.length > 0);
});

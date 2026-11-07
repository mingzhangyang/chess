import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { evaluateBoard, getGamePhase } from '../../src/utils/chess-ai/chessAIEvaluation';
import { DEFAULT_AI_TUNING } from '../../src/utils/chess-ai/chessAITuning';
import { SearchPosition } from '../../src/utils/chess-ai/searchPosition';
import { createIndependentPosition, searchForComparison } from '../../src/utils/chess-ai/independentSearch';
import { KERNEL_FEATURES } from '../../src/utils/chess-ai/independent/kernelSearch';

/**
 * The kernel's default before the tuned evaluation (phase 11): the
 * comparisons with the legacy search need both to use the shared evaluator.
 */
const SHARED_EVALUATION = { ...KERNEL_FEATURES, tunedEvaluation: false };
import { describeGameResult, isThreefoldRepetition } from '../../src/utils/gameResult';

const FENS = [
  new Chess().fen(),
  'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
  '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
  '4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1',
  '1r2k3/P7/8/8/8/8/8/4K3 w - - 98 1',
];

test('independent evaluation matches the existing evaluator for both sides and configurations', () => {
  const variants = [
    {}, { aiStyle: 'aggressive' as const }, { aiStyle: 'defensive' as const },
    { enableTaperedEval: false, enableTempoBonus: false },
    { enableNonlinearKingSafety: false, enableBackwardPawn: false, enableKnightOutpost: false,
      enablePassedPawnKingDistance: false, enableRookBehindPassedPawn: false },
  ];
  for (const fen of FENS) for (const variant of variants) {
    const game = new Chess(fen); const position = new SearchPosition(fen);
    const tuning = { ...DEFAULT_AI_TUNING, ...variant };
    assert.equal(getGamePhase(position), getGamePhase(game), fen);
    for (const color of ['w', 'b'] as const) {
      assert.equal(evaluateBoard(position, color, tuning), evaluateBoard(game, color, tuning), `${fen} ${color}`);
    }
  }
});

test('search boundary verifies history and preserves unknown repetition', () => {
  const cycle = ['g1f3', 'g8f6', 'f3g1', 'f6g8'];
  const game = new Chess();
  for (const uci of [...cycle, ...cycle]) game.move({ from: uci.slice(0, 2), to: uci.slice(2, 4) });
  const known = createIndependentPosition({ fen: game.fen(), history: [...cycle, ...cycle], difficulty: 'expert' });
  assert.equal(known.repetitionStatus, 'threefold');
  const cycleGame = new Chess();
  for (const uci of cycle) cycleGame.move({ from: uci.slice(0, 2), to: uci.slice(2, 4) });
  const unknown = createIndependentPosition({ fen: cycleGame.fen(), historyStartFen: new Chess().fen(), history: cycle, historyTruncated: true, difficulty: 'expert' });
  assert.equal(unknown.repetitionStatus, 'unknown');
  assert.throws(() => createIndependentPosition({ fen: new Chess().fen(), history: ['e2e5'], difficulty: 'expert' }), /history/i);
  assert.throws(() => createIndependentPosition({ fen: new Chess().fen(), history: ['e2e4'], difficulty: 'expert' }), /FEN/i);
});

test('fixed-depth searches agree on representative deterministic positions', () => {
  for (const fen of [FENS[0], FENS[2], FENS[3], FENS[4]]) {
    const opts = { input: { fen, difficulty: 'expert' }, maxDepth: 2, timeLimitMs: 30_000 };
    const oldResult = searchForComparison({ ...opts, backend: 'legacy' });
    const newResult = searchForComparison({ ...opts, backend: 'independent', kernelFeatures: SHARED_EVALUATION });
    assert.equal(newResult.completedDepth, 2, fen);
    assert.equal(newResult.move, oldResult.move, fen);
    assert.equal(newResult.score, oldResult.score, fen);
  }
});

import { generateMoves } from '../../src/utils/chess-ai/chessAIBoardOps';
import { minimax, setSearchDeadline } from '../../src/utils/chess-ai/chessAISearchCore';
import { drawScore, MATE_SCORE, quiescence } from '../../src/utils/chess-ai/chessAIQuiescence';
import { resetSearchCounters, searchState } from '../../src/utils/chess-ai/chessAISearchDiagnostics';
import { IndependentTranspositionTable } from '../../src/utils/chess-ai/independentTranspositionTable';
import { denormalizeMateScoreFromTT, normalizeMateScoreForTT } from '../../src/utils/chess-ai/chessAITranspositionTable';

const toSearchMove = (u: string) => ({ from: (8 - Number(u[1])) * 8 + u.charCodeAt(0) - 97,
  to: (8 - Number(u[3])) * 8 + u.charCodeAt(2) - 97 });

const terminalScore = (fen: string, color: 'w' | 'b') => {
  const p = new SearchPosition(fen, { historyComplete: true });
  searchState.searchAborted = false; resetSearchCounters(); setSearchDeadline(Infinity);
  return minimax(p, 2, -Infinity, Infinity, p.turn === color, color, DEFAULT_AI_TUNING);
};

test('mate takes precedence over the fifty-move rule; stalemate and material draws are detected', () => {
  const mate = '7k/6Q1/6K1/8/8/8/8/8 b - - 100 1';
  assert.equal(terminalScore(mate, 'b'), -MATE_SCORE);
  assert.equal(terminalScore(mate, 'w'), MATE_SCORE);
  for (const fen of [
    '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1',
    '4k3/8/8/8/8/8/8/4K3 w - - 0 1',
    '4k3/8/8/8/8/8/8/3BK3 w - - 0 1',
    '4k3/8/8/8/8/8/8/R3K3 w - - 100 1',
  ]) {
    const p = new SearchPosition(fen, { historyComplete: true });
    assert.equal(terminalScore(fen, 'w'), drawScore(p, 'w', DEFAULT_AI_TUNING), fen);
  }
  for (const fen of [...FENS, '4k3/8/8/8/8/8/4b3/3BK3 w - - 0 1']) {
    assert.equal(new SearchPosition(fen).isInsufficientMaterial(), new Chess(fen).isInsufficientMaterial(), fen);
  }
});

test('the independent table checks clocks, history, collisions, perspective, tuning and mate distance', () => {
  const fen = new Chess().fen();
  const cycle = ['g1f3', 'g8f6', 'f3g1', 'f6g8'];
  const repeated = SearchPosition.fromHistory(fen, cycle.map(toSearchMove), { historyComplete: true });
  const fresh = new SearchPosition(repeated.toFen(), { historyComplete: true });
  const clock = new SearchPosition(repeated.toFen().replace(' 4 3', ' 5 3'), { historyComplete: true });
  const unrelated = new SearchPosition(FENS[3], { historyComplete: true });
  const tuning = { ...DEFAULT_AI_TUNING };
  // A one-slot table forces every position into the same slot, so only the
  // 64-bit history-aware verifier separates them.
  const table = new IndependentTranspositionTable('w', tuning, 0);
  table.store(repeated, 'w', tuning, 3, 123, 'exact', generateMoves(repeated)[0]);
  assert.equal(table.lookup(repeated, 'w', tuning, 3)?.score, 123);
  assert.equal(table.lookup(fresh, 'w', tuning, 3), undefined);
  assert.equal(table.lookup(clock, 'w', tuning, 3), undefined);
  assert.equal(table.lookup(unrelated, 'w', tuning, 3), undefined);
  assert.equal(table.lookup(repeated, 'b', tuning, 3), undefined);
  tuning.enableTempoBonus = !tuning.enableTempoBonus;
  assert.equal(table.lookup(repeated, 'w', tuning, 3), undefined);
  const unknown = new SearchPosition(repeated.toFen());
  table.store(unknown, 'w', tuning, 3, 99, 'exact', generateMoves(unknown)[0]);
  assert.equal(table.lookup(unknown, 'w', tuning, 3), undefined);
  for (const score of [MATE_SCORE - 10, -MATE_SCORE + 10, 100]) {
    assert.equal(denormalizeMateScoreFromTT(normalizeMateScoreForTT(score, 4), 4), score);
  }
});

test('the independent table shares transpositions after irreversible moves and prefers deeper entries', () => {
  const start = new Chess().fen();
  const a = SearchPosition.fromHistory(start, ['g1f3', 'b8c6', 'b1c3', 'e7e5'].map(toSearchMove), { historyComplete: true });
  const b = SearchPosition.fromHistory(start, ['b1c3', 'b8c6', 'g1f3', 'e7e5'].map(toSearchMove), { historyComplete: true });
  const table = new IndependentTranspositionTable('w', DEFAULT_AI_TUNING);
  table.store(a, 'w', DEFAULT_AI_TUNING, 3, 42, 'lowerbound', generateMoves(a)[0]);
  assert.deepEqual(table.lookup(b, 'w', DEFAULT_AI_TUNING, 3), { bestMove: table.lookup(a, 'w', DEFAULT_AI_TUNING, 3)!.bestMove, score: 42, flag: 'lowerbound' });
  assert.equal(table.lookup(b, 'w', DEFAULT_AI_TUNING, 4)?.score, undefined, 'a shallower entry only supplies its move');
  assert.ok(table.lookup(b, 'w', DEFAULT_AI_TUNING, 4)!.bestMove > 0);

  const other = new SearchPosition(FENS[1], { historyComplete: true });
  const slot = new IndependentTranspositionTable('w', DEFAULT_AI_TUNING, 0);
  slot.store(a, 'w', DEFAULT_AI_TUNING, 3, 10, 'exact', generateMoves(a)[0]);
  slot.store(other, 'w', DEFAULT_AI_TUNING, 2, 20, 'exact', generateMoves(other)[0]);
  assert.equal(slot.lookup(a, 'w', DEFAULT_AI_TUNING, 3)?.score, 10, 'a shallower store does not displace a deeper entry');
  assert.equal(slot.lookup(other, 'w', DEFAULT_AI_TUNING, 2), undefined);
  slot.store(other, 'w', DEFAULT_AI_TUNING, 4, -MATE_SCORE + 7, 'upperbound', generateMoves(other)[0]);
  assert.equal(slot.lookup(other, 'w', DEFAULT_AI_TUNING, 4)?.score, -MATE_SCORE + 7);
  assert.equal(slot.lookup(a, 'w', DEFAULT_AI_TUNING, 3), undefined);
});

test('quiescence searches quiet check evasions and restores state', () => {
  const fen = '4r1k1/8/8/8/8/8/8/4K3 w - - 0 1';
  const game = new Chess(fen); const p = new SearchPosition(fen, { historyComplete: true });
  assert.equal(p.generateTacticalMoves().length, 0);
  assert.ok(p.generateQuiescenceMoves().length > 0);
  setSearchDeadline(Infinity); searchState.searchAborted = false;
  const expected = quiescence(game, -Infinity, Infinity, true, 'w', DEFAULT_AI_TUNING);
  const actual = quiescence(p, -Infinity, Infinity, true, 'w', DEFAULT_AI_TUNING);
  assert.equal(actual, expected);
  assert.equal(p.toFen(), fen);
  assert.equal(p.ply, 0);
});

test('aborted and thrown searches restore all independent state and do not affect the next search', () => {
  let p: SearchPosition | undefined; let checks = 0;
  const input = { fen: 'start', history: [], difficulty: 'expert' };
  const interrupted = searchForComparison({ backend: 'independent', input, maxDepth: 8,
    onPosition: (position) => { p = position; }, shouldAbort: () => ++checks > 45 });
  assert.ok(interrupted.diagnostics.searchAborted);
  assert.equal(p!.toFen(), new Chess().fen());
  assert.equal(p!.ply, 0);
  assert.equal(p!.repetitionCount, 1);
  assert.equal(p!.repetitionStatus, 'not-threefold');
  const stable = searchForComparison({ backend: 'independent', input, maxDepth: 2 });
  const repeat = searchForComparison({ backend: 'independent', input, maxDepth: 2 });
  assert.deepEqual([stable.uci, stable.score, stable.diagnostics.nodes], [repeat.uci, repeat.score, repeat.diagnostics.nodes]);
  assert.throws(() => searchForComparison({ backend: 'independent', input, maxDepth: 4,
    onPosition: (position) => {
      p = position;
      const original = position.generateMoveCodes.bind(position);
      position.generateMoveCodes = (...args) => { if (position.ply >= 2) throw new Error('injected'); return original(...args); };
    } }), /injected/);
  assert.equal(p!.toFen(), new Chess().fen());
  assert.equal(p!.ply, 0);
  assert.equal(p!.repetitionCount, 1);
});

test('independent medium, hard and expert searches avoid the known hanging-queen regressions', () => {
  for (const [fen, forbidden] of [
    ['rnbqkb1r/ppp2ppp/5n2/8/3N4/4P3/PPP2PPP/RNBQKB1R b KQkq - 0 5', ['Qxd4']],
    ['rnbqkbnr/ppp2ppp/4p3/3p4/8/2N5/PPP2PPP/R1BQKBNR w KQkq - 0 4', ['Qxd5', 'Nxd5']],
  ] as const) for (const difficulty of ['medium', 'hard', 'expert']) {
    const result = searchForComparison({ backend: 'independent', input: { fen, difficulty }, maxDepth: 1, timeLimitMs: 1 });
    assert.ok(result.completedDepth >= 1, `${difficulty}: depth 1 completed`);
    assert.ok(result.move && !(forbidden as readonly string[]).includes(result.move), `${difficulty}: ${result.move}`);
  }
});

test('pinned en-passant history: application and engine agree on the threefold draw', () => {
  const start = '4r1k1/3p4/8/4P3/8/8/8/4K3 b - - 0 1';
  const history = ['d7d5', 'e1f1', 'g8h8', 'f1e1', 'h8g8', 'e1f1', 'g8h8', 'f1e1', 'h8g8'];
  const game = new Chess(start);
  for (const u of history) game.move({ from: u.slice(0, 2), to: u.slice(2, 4) });
  const input = { fen: game.fen(), history, historyStartFen: start, difficulty: 'expert' };
  assert.equal(createIndependentPosition(input).repetitionStatus, 'threefold');
  // chess.js alone still misses it; the application's rules do not.
  assert.equal(game.isThreefoldRepetition(), false);
  assert.equal(isThreefoldRepetition(game), true);
  assert.equal(describeGameResult(game, null)?.reason, 'threefold');
  assert.equal(searchForComparison({ backend: 'independent', input, maxDepth: 1 }).move, null);
});

test('search move adapters preserve captures, castling, en passant and every promotion', async () => {
  const { generateTacticalMoves } = await import('../../src/utils/chess-ai/chessAIBoardOps');
  const cases = [
    'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1',
    '4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1',
    '1r2k3/P7/8/8/8/8/8/4K3 w - - 0 1',
    '4r1k1/8/8/8/8/8/8/4K3 w - - 0 1',
  ];
  const map = (moves: ReturnType<typeof generateMoves>) => moves.map((m) => ({
    uci: `${m.from}${m.to}${m.promotion ?? ''}`, piece: m.piece, captured: m.captured ?? null,
    promotion: m.promotion ?? null, capture: m.isCapture(), ep: m.isEnPassant(),
    isPromotion: m.isPromotion(), flags: [...m.flags].sort().join(''),
  })).sort((a, b) => a.uci.localeCompare(b.uci));
  for (const fen of cases) {
    const p = new SearchPosition(fen); const game = new Chess(fen);
    assert.deepEqual(map(generateMoves(p)), map(generateMoves(game)), fen);
    assert.deepEqual(map(generateTacticalMoves(p)), map(generateTacticalMoves(game)), fen);
  }
});

test('medium and hard use the same deterministic root selection and tuning semantics', () => {
  for (const difficulty of ['medium', 'hard', 'expert']) for (const aiStyle of ['aggressive', 'defensive', 'balanced'] as const) {
    const input = { fen: 'start', history: [], difficulty,
      tuning: { aiStyle, enableTempoBonus: false, enableTaperedEval: false, mediumNoise: 0 } };
    const args = { input, maxDepth: 2, timeLimitMs: 10_000, random: () => 0.25 };
    const a = searchForComparison({ ...args, backend: 'legacy' });
    const b = searchForComparison({ ...args, backend: 'independent', kernelFeatures: SHARED_EVALUATION });
    assert.deepEqual([b.move, b.score], [a.move, a.score], `${difficulty} ${aiStyle}`);
  }
});

test('the fixed-time middlegame difference disappears when both complete depth four', () => {
  const fen = 'r2q1rk1/1b2bppp/p2ppn2/1p6/3NP3/1BN1B3/PPP2PPP/R2Q1RK1 w - - 0 11';
  const args = { input: { fen, historyStartFen: fen, history: [], historyTruncated: false, difficulty: 'expert' }, maxDepth: 4, timeLimitMs: 20_000 };
  const a = searchForComparison({ ...args, backend: 'legacy' });
  const b = searchForComparison({ ...args, backend: 'independent', kernelFeatures: SHARED_EVALUATION });
  assert.equal(a.completedDepth, 4); assert.equal(b.completedDepth, 4);
  assert.deepEqual([b.move, b.score], [a.move, a.score]);
});

test('synthetic null does not consume a real halfmove toward the fifty-move draw', async () => {
  const { isDraw } = await import('../../src/utils/chess-ai/chessAIQuiescence');
  const p = new SearchPosition(new Chess().fen().replace(' 0 1', ' 97 1'), { historyComplete: true });
  const before = p.toFen();
  p.makeNullMove();
  for (const uci of ['g8f6', 'g1f3']) {
    const candidate = p.generateLegalMoves().find((m) => `${String.fromCharCode(97 + (m.from & 7))}${8 - (m.from >> 3)}${String.fromCharCode(97 + (m.to & 7))}${8 - (m.to >> 3)}` === uci);
    assert.ok(candidate); p.makeMove(candidate);
  }
  assert.equal(p.halfmoveClock, 100);
  assert.equal(isDraw(p), false, 'the synthetic pass must not create a premature fifty-move draw');
  const next = p.generateLegalMoves().find((m) => m.from === 1 && m.to === 18)!;
  p.makeMove(next);
  assert.equal(isDraw(p), true, 'three real reversible moves reach the threshold');
  p.restore(0); assert.equal(p.toFen(), before); assert.equal(p.repetitionCount, 1);
});

test('independent full search exercises null pruning without contaminating real history', () => {
  let position: SearchPosition | undefined;
  const result = searchForComparison({ backend: 'independent', input: { fen: 'start', history: [], difficulty: 'expert' },
    maxDepth: 5, timeLimitMs: 20_000, onPosition: (p) => { position = p; } });
  assert.equal(result.completedDepth, 5);
  assert.ok(result.diagnostics.nullMoveAttempts > 0);
  assert.equal(position!.ply, 0); assert.equal(position!.repetitionCount, 1);
  assert.equal(position!.repetitionStatus, 'not-threefold');
});

test('tactical comparison agrees on mate, queen capture, promotion, en passant, castling and check evasion', () => {
  const cases = [
    ['7k/5Q2/6K1/8/8/8/8/8 w - - 0 1', 'Qe8#'],
    ['4k3/8/8/3q4/4P3/8/8/4K3 w - - 0 1', 'exd5'],
    ['6k1/4P3/8/8/8/K7/8/8 w - - 0 1', 'e8=Q+'],
    ['6k1/8/8/3pP3/4K3/8/8/8 w - d6 0 2', 'exd6'],
    ['r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', 'Rxa8+'],
    ['4r1k1/8/8/8/8/8/8/4K3 w - - 0 1', 'Kd2'],
  ] as const;
  for (const [fen, expected] of cases) {
    const args = { input: { fen, historyStartFen: fen, history: [], historyTruncated: false, difficulty: 'expert' }, maxDepth: 3, timeLimitMs: 20_000 };
    const legacy = searchForComparison({ ...args, backend: 'legacy' });
    const independent = searchForComparison({ ...args, backend: 'independent', kernelFeatures: SHARED_EVALUATION });
    assert.equal(legacy.move, expected, fen);
    assert.deepEqual([independent.move, independent.score], [legacy.move, legacy.score], fen);
  }
});

test('evaluation matches on seeded games across both perspectives and styles', () => {
  let seed = 872341;
  for (let run = 0; run < 2; run++) {
    const game = new Chess();
    const p = new SearchPosition(game.fen(), { historyComplete: true });
    for (let ply = 0; ply < 45; ply++) {
      for (const aiStyle of ['balanced', 'aggressive', 'defensive'] as const) {
        const tuning = { ...DEFAULT_AI_TUNING, aiStyle, enableTaperedEval: ply % 2 === 0 };
        for (const side of ['w', 'b'] as const) assert.equal(evaluateBoard(p, side, tuning), evaluateBoard(game, side, tuning));
      }
      const moves = p.generateLegalMoves(); if (!moves.length) break;
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const move = moves[seed % moves.length];
      p.makeMove(move);
      game.move({ from: `${String.fromCharCode(97 + (move.from & 7))}${8 - (move.from >> 3)}`,
        to: `${String.fromCharCode(97 + (move.to & 7))}${8 - (move.to >> 3)}`, promotion: move.promotion });
    }
  }
});

test('incomplete history remains unknown until three occurrences are actually observed', () => {
  const start = new Chess().fen();
  const cycle = ['g1f3', 'g8f6', 'f3g1', 'f6g8'];
  const game = new Chess();
  for (const u of [...cycle, ...cycle]) game.move({ from: u.slice(0, 2), to: u.slice(2, 4) });
  const input = { fen: game.fen(), historyStartFen: start, history: [...cycle, ...cycle], historyTruncated: true, difficulty: 'expert' };
  assert.equal(createIndependentPosition(input).repetitionStatus, 'threefold');
  assert.equal(searchForComparison({ backend: 'independent', input, maxDepth: 1 }).move, null);
  assert.equal(createIndependentPosition({ fen: start, difficulty: 'expert' }).repetitionStatus, 'unknown');
});


test('custom starting FEN without an explicit completeness claim stays unknown', () => {
  const fen = '4k3/8/8/8/8/8/4R3/4K3 w - - 12 7';
  const input = { fen, historyStartFen: fen, history: [], difficulty: 'expert' };
  assert.equal(createIndependentPosition(input).repetitionStatus, 'unknown');
  assert.equal(createIndependentPosition({ ...input, historyTruncated: false }).repetitionStatus, 'not-threefold');
});

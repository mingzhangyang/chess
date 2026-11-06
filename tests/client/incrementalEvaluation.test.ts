import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { evaluateBoard } from '../../src/utils/chess-ai/chessAIEvaluation';
import { DEFAULT_AI_TUNING } from '../../src/utils/chess-ai/chessAITuning';
import { PIECE_SQUARE_EG, PIECE_SQUARE_MG } from '../../src/utils/chess-ai/evaluationTables';
import { KernelEvaluator } from '../../src/utils/chess-ai/independent/kernelEvaluation';
import { MAX_MOVES } from '../../src/utils/chess-ai/independent/moveCode';
import { SearchPosition } from '../../src/utils/chess-ai/searchPosition';
import { referenceEvaluateBoard } from './fixtures/referenceEvaluation';

/** Everything SearchPosition maintains incrementally for the kernel evaluator. */
const features = (p: SearchPosition) => ({
  mg: p.pieceSquareMg, eg: p.pieceSquareEg, phase: p.phaseWeight,
  whiteNonPawn: p.whiteNonPawnMaterial, blackNonPawn: p.blackNonPawnMaterial,
  whiteBishops: p.whiteBishopCount, blackBishops: p.blackBishopCount,
  pawnKey: p.pawnKey, pawns: [...p.pawnFileMasks],
});
/** A fresh position computes every term from its board. */
const rebuilt = (p: SearchPosition) => features(new SearchPosition(p.toFen({ rawEnPassant: true })));
const codesOf = (p: SearchPosition): number[] => {
  const buffer = new Int32Array(MAX_MOVES);
  return Array.from(buffer.subarray(0, p.generateMoveCodes(buffer)));
};
const canNull = (p: SearchPosition) => !p.isInCheck() && p.halfmoveClock < 98 && p.hasLegalMove();

/** Seeded games that favour captures and promotions so they reach sparse endgames. */
const randomGames = (count: number, plies: number, visit: (position: SearchPosition) => void) => {
  let seed = 0x51ce_b00c;
  const random = (n: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
  for (let run = 0; run < count; run += 1) {
    const position = new SearchPosition(new Chess().fen(), { historyComplete: true });
    for (let ply = 0; ply < plies; ply += 1) {
      visit(position);
      const moves = position.generateLegalMoves();
      if (!moves.length) break;
      const tactical = position.generateTacticalMoves();
      position.makeMove(tactical.length && random(2) === 0 ? tactical[random(tactical.length)] : moves[random(moves.length)]);
    }
  }
};

const SPECIAL_FENS = [
  'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', // castling both sides
  'r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1',
  '4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1', // en passant
  '4k3/8/8/8/3pP3/8/8/4K3 b - e3 0 1',
  '1r2k3/P7/8/8/8/8/8/4K3 w - - 0 1', // promotion with and without capture
  'n1n5/PPPk4/8/8/8/8/4Kppp/5N1N b - - 0 1',
  '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
];

test('incremental evaluation terms equal a from-scratch rebuild after every move and every undo', () => {
  const walk = (position: SearchPosition, depth: number) => {
    const before = features(position);
    assert.deepEqual(before, rebuilt(position), position.toFen());
    if (depth === 0) return;
    for (const code of codesOf(position)) {
      position.makeMoveCode(code);
      walk(position, depth - 1);
      position.undo();
      assert.deepEqual(features(position), before, `undo ${code} at ${position.toFen()}`);
    }
    if (canNull(position)) {
      position.makeNullMove();
      assert.deepEqual(features(position), before, 'a null move changes no piece');
      position.undo();
      assert.deepEqual(features(position), before);
    }
  };
  for (const fen of SPECIAL_FENS) walk(new SearchPosition(fen), 2);
  let visited = 0;
  randomGames(10, 160, (position) => { walk(position, 1); visited += 1; });
  assert.ok(visited > 800, 'exercise a broad sample');
});

test('incremental terms survive history replay and checkpoint restore', () => {
  const cycle = ['g1f3', 'g8f6', 'f3g1', 'f6g8', 'e2e4', 'd7d5', 'e4d5', 'd8d5'];
  const moves = cycle.map((uci) => ({ from: (8 - Number(uci[1])) * 8 + uci.charCodeAt(0) - 97,
    to: (8 - Number(uci[3])) * 8 + uci.charCodeAt(2) - 97 }));
  const position = SearchPosition.fromHistory(new Chess().fen(), moves, { historyComplete: true });
  const root = features(position);
  assert.deepEqual(root, rebuilt(position));
  const checkpoint = position.checkpoint();
  for (let i = 0; i < 6; i += 1) position.makeMoveCode(codesOf(position)[i % 3]);
  assert.deepEqual(features(position), rebuilt(position));
  position.restore(checkpoint);
  assert.deepEqual(features(position), root);
});

const VARIANTS = [
  {},
  { aiStyle: 'aggressive' as const },
  { aiStyle: 'defensive' as const },
  { enableTaperedEval: false },
  { enableTaperedEval: false, aiStyle: 'defensive' as const, enableTempoBonus: false },
  { enableNonlinearKingSafety: false, enableBackwardPawn: false, enableKnightOutpost: false,
    enablePassedPawnKingDistance: false, enableRookBehindPassedPawn: false, enableTempoBonus: false },
];

test('the kernel evaluator gives the shared evaluator score on positions reached by make and undo', () => {
  const evaluators = VARIANTS.map((variant) => {
    const tuning = { ...DEFAULT_AI_TUNING, ...variant };
    return { tuning, variant, evaluator: new KernelEvaluator(tuning) };
  });
  let compared = 0;
  const check = (position: SearchPosition) => {
    for (const { tuning, variant, evaluator } of evaluators) for (const color of ['w', 'b'] as const) {
      const expected = evaluateBoard(position, color, tuning);
      // The second call is served from the pawn table.
      assert.equal(evaluator.evaluate(position, color), expected, `${position.toFen()} ${color} ${JSON.stringify(variant)}`);
      assert.equal(evaluator.evaluate(position, color), expected, `cached ${position.toFen()} ${color}`);
      compared += 2;
    }
  };
  for (const fen of SPECIAL_FENS) check(new SearchPosition(fen));
  randomGames(8, 160, (position) => {
    check(position);
    // Children are reached incrementally, never through the constructor.
    const codes = codesOf(position);
    for (let i = 0; i < codes.length; i += 7) { position.makeMoveCode(codes[i]); check(position); position.undo(); }
  });
  assert.ok(compared > 20000);
});

test('the kernel evaluator matches the frozen reference directly', () => {
  const evaluators = VARIANTS.map((variant) => {
    const tuning = { ...DEFAULT_AI_TUNING, ...variant };
    return { tuning, evaluator: new KernelEvaluator(tuning) };
  });
  let seed = 0x0dd_ba11;
  const random = (n: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
  for (let gameIndex = 0; gameIndex < 4; gameIndex += 1) {
    const game = new Chess();
    for (let ply = 0; ply < 120 && !game.isGameOver(); ply += 1) {
      const moves = game.moves({ verbose: true });
      const captures = moves.filter((move) => move.captured);
      const pool = captures.length && random(2) === 0 ? captures : moves;
      game.move(pool[random(pool.length)]);
      const position = new SearchPosition(game.fen());
      for (const { tuning, evaluator } of evaluators) for (const color of ['w', 'b'] as const) {
        assert.equal(evaluator.evaluate(position, color), referenceEvaluateBoard(game, color, tuning), `${game.fen()} ${color}`);
      }
    }
  }
});

test('the pawn table verifies every entry against the exact pawn files', () => {
  // A one-slot table makes every pawn structure collide with the previous one.
  const tuning = { ...DEFAULT_AI_TUNING };
  const evaluator = new KernelEvaluator(tuning, 0);
  const fens = [
    '4k3/pp1p1ppp/8/2p5/2P5/8/PP1P1PPP/4K3 w - - 0 1',
    '4k3/pp1p1ppp/8/8/2p5/2P5/PP1P1PPP/4K3 w - - 0 1',
    '4k3/1P6/8/8/8/8/6p1/4K3 w - - 0 1',
    '4k3/8/8/8/8/8/8/4K3 w - - 0 1',
    '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1',
  ];
  for (let round = 0; round < 3; round += 1) for (const fen of fens) for (const color of ['w', 'b'] as const) {
    const position = new SearchPosition(fen);
    assert.equal(evaluator.evaluate(position, color), evaluateBoard(position, color, tuning), `${fen} ${color}`);
  }
  // Mirrored structures have different files but may share low key bits.
  const a = new SearchPosition('4k3/p7/8/8/8/8/7P/4K3 w - - 0 1');
  const b = new SearchPosition('4k3/7p/8/8/8/8/P7/4K3 w - - 0 1');
  assert.notDeepEqual([...a.pawnFileMasks], [...b.pawnFileMasks]);
  for (const position of [a, b, a, b]) assert.equal(evaluator.evaluate(position, 'w'), evaluateBoard(position, 'w', tuning));
});

test('incremental piece-square tables are integral, so summation order cannot change a score', () => {
  for (const table of [PIECE_SQUARE_MG, PIECE_SQUARE_EG]) {
    assert.equal(table.length, 13 * 64);
    for (let i = 0; i < table.length; i += 1) assert.ok(Number.isInteger(table[i]), `entry ${i}`);
    // An empty square contributes nothing; colours mirror each other.
    for (let square = 0; square < 64; square += 1) {
      assert.equal(table[6 * 64 + square], 0);
      for (let type = 1; type <= 6; type += 1) {
        assert.equal(table[(6 + type) * 64 + square] + table[(6 - type) * 64 + (square ^ 56)], 0, `type ${type} square ${square}`);
      }
    }
  }
});

test('kernel evaluator handles accepted boards with more than 32 non-pawn pieces', () => {
  // Promotions can produce boards beyond the ordinary 32-piece starting count.
  // The position model accepts all 64 squares, including positions outside normal play.
  const fens = [
    '7k/8/NNNNNNNN/NNNNNNNN/NNNNNNNN/NNNNNNNN/N7/K7 w - - 0 1', // 33 knights
    'NNBBRRQk/NNBBRRQQ/NNBBRRQQ/NNBBRRQQ/NNBBRRQQ/NNBBRRQQ/NNBBRRQQ/KNNBBRRQ w - - 0 1', // 62 officers
  ];
  for (const fen of fens) {
    const position = new SearchPosition(fen);
    const officers = Array.from(position.squares).filter((piece) => Math.abs(piece) >= 2 && Math.abs(piece) <= 5);
    assert.ok(officers.length > 32, fen);
    for (const variant of VARIANTS) {
      const tuning = { ...DEFAULT_AI_TUNING, ...variant };
      const evaluator = new KernelEvaluator(tuning);
      for (const color of ['w', 'b'] as const) {
        const expected = evaluateBoard(position, color, tuning);
        assert.ok(Number.isFinite(expected), fen + ' ' + color + ': shared evaluator should be finite');
        assert.equal(evaluator.evaluate(position, color), expected, fen + ' ' + color + ' ' + JSON.stringify(variant));
        assert.equal(evaluator.evaluate(position, color), expected, 'cached ' + fen + ' ' + color);
      }
    }
  }
});

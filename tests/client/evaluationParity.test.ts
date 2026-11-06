import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { evaluateBoard, getGamePhase } from '../../src/utils/chess-ai/chessAIEvaluation';
import { DEFAULT_AI_TUNING } from '../../src/utils/chess-ai/chessAITuning';
import { SearchPosition } from '../../src/utils/chess-ai/searchPosition';
import { referenceEvaluateBoard, referenceGamePhase } from './fixtures/referenceEvaluation';

const VARIANTS = [
  {},
  { aiStyle: 'aggressive' as const },
  { aiStyle: 'defensive' as const },
  { enableTaperedEval: false },
  { enableTaperedEval: false, aiStyle: 'aggressive' as const },
  { enableTaperedEval: false, aiStyle: 'defensive' as const, enableTempoBonus: false },
  { enableNonlinearKingSafety: false, enableBackwardPawn: false, enableKnightOutpost: false,
    enablePassedPawnKingDistance: false, enableRookBehindPassedPawn: false, enableTempoBonus: false },
  { enableTaperedEval: false, enableNonlinearKingSafety: false, enableBackwardPawn: false, enableKnightOutpost: false,
    enablePassedPawnKingDistance: false, enableRookBehindPassedPawn: false },
];

const EDGE_FENS = [
  '8/8/8/8/8/2k5/8/K6Q w - - 0 1', // mop-up against a bare king
  '8/8/3k4/8/8/8/1R6/K7 b - - 0 1',
  '8/1P6/8/8/8/k7/8/1R2K3 w - - 0 1', // rook behind a passed pawn
  '1r6/8/8/8/8/k7/1p6/4K3 b - - 0 1',
  'r1bq1rk1/pp3ppp/2n5/3Np3/2P5/8/PP3PPP/R2QKB1R w KQ - 0 1', // knight outpost
  'r1bq1rk1/pp2bppp/2n1p3/3p4/2PP4/2N1PN2/PP3PPP/R2QKB1R w KQ - 0 1',
  '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1',
  'r5k1/1R6/8/8/8/8/6PP/6K1 w - - 0 1', // rook on the seventh
  'rr4k1/8/8/8/8/8/6PP/RR4K1 w - - 0 1', // doubled rooks
  '4k3/pp1p1ppp/8/2p5/2P5/8/PP1P1PPP/4K3 w - - 0 1', // pawn structure
  '4k3/8/8/2Bb4/2bB4/8/8/4K3 w - - 0 1', // bishops of both colours
];

const positions = (): string[] => {
  const fens = [...EDGE_FENS];
  let seed = 0x5eed1234;
  const random = (n: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
  for (let gameIndex = 0; gameIndex < 8; gameIndex++) {
    const game = new Chess();
    for (let ply = 0; ply < 140 && !game.isGameOver(); ply++) {
      const moves = game.moves({ verbose: true });
      // Prefer captures half the time so games reach sparse endgames.
      const captures = moves.filter((move) => move.captured);
      const pool = captures.length && random(2) === 0 ? captures : moves;
      game.move(pool[random(pool.length)]);
      if (ply % 3 === 0) fens.push(game.fen());
    }
  }
  return fens;
};

test('evaluation matches the frozen reference for both backends, perspectives and tunings', () => {
  const fens = positions();
  assert.ok(fens.length > 300, 'exercise a broad sample');
  let compared = 0;
  for (const fen of fens) {
    const game = new Chess(fen);
    const position = new SearchPosition(fen);
    assert.equal(getGamePhase(game), referenceGamePhase(game), fen);
    assert.equal(getGamePhase(position), referenceGamePhase(game), fen);
    for (const variant of VARIANTS) {
      const tuning = { ...DEFAULT_AI_TUNING, ...variant };
      for (const color of ['w', 'b'] as const) {
        const expected = referenceEvaluateBoard(game, color, tuning);
        assert.equal(evaluateBoard(game, color, tuning), expected, `chess.js ${fen} ${color} ${JSON.stringify(variant)}`);
        assert.equal(evaluateBoard(position, color, tuning), expected, `independent ${fen} ${color} ${JSON.stringify(variant)}`);
        compared += 2;
      }
    }
  }
  assert.ok(compared > 9000);
});

test('getSquares gives chess.js games the same signed board layout as SearchPosition', async () => {
  const { getSquares } = await import('../../src/utils/chess-ai/chessAIBoardOps');
  for (const fen of [...EDGE_FENS, new Chess().fen()]) {
    const position = new SearchPosition(fen);
    const scratch = new Int8Array(64);
    assert.deepEqual([...getSquares(new Chess(fen), scratch)], [...position.squares], fen);
    assert.equal(getSquares(position, scratch), position.squares, 'a SearchPosition board is not copied');
  }
});

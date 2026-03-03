import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import {
  DEFAULT_AI_TUNING,
  applyHistoryBonus,
  applyHistoryMalus,
  clearHistory,
  clearTranspositionTable,
  clearCountermoves,
  getCountermoveScore,
  getGamePhaseForTesting,
  getHistoryScoreForMove,
  getLmrReduction,
  getAiTuning,
  getBestMove,
  getLastSearchDiagnostics,
  evaluateBoardForTesting,
  resetAiTuning,
  resetOpeningState,
  recordCountermove,
  setAiTuning,
  shouldApplyReverseFutilityPruning,
  shouldPruneMoveByFutility,
  shouldPruneMoveByLmp,
  shouldPruneQCaptureByDelta,
  shouldAllowNullMoveByStaticEval,
} from '../../src/utils/chessAI';

test('hard mode should provide move variety from the starting position', { timeout: 60_000 }, () => {
  const originalRandom = Math.random;
  const sequence = [0.02, 0.38, 0.71, 0.95, 0.14, 0.52, 0.83, 0.27];
  let cursor = 0;
  Math.random = () => {
    const value = sequence[cursor % sequence.length];
    cursor += 1;
    return value;
  };

  try {
    const uniqueMoves = new Set<string>();
    for (let i = 0; i < 8; i += 1) {
      const game = new Chess();
      const move = getBestMove(game, 'hard');
      assert.ok(move, 'expected AI to choose a move');
      uniqueMoves.add(move as string);
    }
    assert.ok(uniqueMoves.size > 1, `expected variety in hard mode, got only: ${[...uniqueMoves].join(', ')}`);
  } finally {
    Math.random = originalRandom;
  }
});

test('hard mode should avoid immediate non-capturing backtrack move when alternatives exist', { timeout: 60_000 }, () => {
  resetOpeningState();
  clearTranspositionTable();
  const game = new Chess();
  game.move('b4');
  game.move('Nc6');
  game.move('Bb2');
  game.move('Nxb4');
  game.move('h3');
  game.move('Rb8');
  game.move('Nf3');

  const bestMove = getBestMove(game, 'hard');
  assert.ok(bestMove, 'expected AI to choose a move');
  assert.notEqual(bestMove, 'Ra8', 'expected AI to avoid immediate rook shuffle Ra8');
});

test('hard mode should keep taking forced checkmate in one', { timeout: 60_000 }, () => {
  resetOpeningState();
  clearTranspositionTable();
  const game = new Chess('7k/5Q2/6K1/8/8/8/8/8 w - - 0 1');
  const bestMove = getBestMove(game, 'hard');
  assert.ok(bestMove, 'expected a mating move');

  const after = new Chess(game.fen());
  const applied = after.move(bestMove as string);
  assert.ok(applied, 'expected selected move to be legal');
  assert.ok(after.isCheckmate(), `expected checkmate in one, got ${bestMove}`);
});

test('hard mode should use opening book in early game', () => {
  const originalRandom = Math.random;
  Math.random = () => 0;

  try {
    resetAiTuning();
    const game = new Chess();
    game.move('e4');
    game.move('e5');

    const bestMove = getBestMove(game, 'hard');
    assert.equal(bestMove, 'Nf3');
  } finally {
    Math.random = originalRandom;
    resetAiTuning();
  }
});

test('search diagnostics should expose node counters after a search', () => {
  resetOpeningState();
  clearTranspositionTable();
  const game = new Chess('2k5/8/8/3p4/4b3/8/3R4/2K5 w - - 0 1');
  const move = getBestMove(
    game,
    'hard',
    {
      openingBookEnabled: false,
      enableNmpStaticGuard: true,
      enableQDelta: true,
      enableRfp: true,
      enableFp: true,
      enableLmp: true,
    },
    300,
  );
  assert.ok(move, 'expected search to produce a legal move');

  const diag = getLastSearchDiagnostics();
  assert.ok(diag.nodes >= 0, `expected nodes >= 0, got ${diag.nodes}`);
  assert.ok(diag.qNodes >= 0, `expected qNodes >= 0, got ${diag.qNodes}`);
  assert.ok(diag.completedDepth >= 0, `expected completedDepth >= 0, got ${diag.completedDepth}`);
  assert.ok(
    diag.completedDepth === 0 || diag.nodes > 0,
    `expected searched depth to imply node visits (depth=${diag.completedDepth}, nodes=${diag.nodes})`,
  );
});

test('supports runtime AI tuning overrides and reset', () => {
  resetAiTuning();
  const before = getAiTuning();
  assert.deepEqual(before, DEFAULT_AI_TUNING);

  const patched = setAiTuning({
    backtrackPenalty: 120,
    openingBookEnabled: false,
    openingBookMaxPly: 6,
    enableNmpStaticGuard: true,
    nmpStaticGuardMargin: 90,
    enableRfp: true,
    rfpDepthLimit: 2,
    rfpMarginBase: 110,
    rfpMarginPerDepth: 50,
    enableFp: true,
    fpDepthLimit: 2,
    fpMarginBase: 110,
    fpMarginPerDepth: 60,
    enableLmp: true,
    lmpDepthLimit: 2,
    lmpMoveCountBase: 6,
    lmpMoveCountPerDepth: 2,
    lmpEvalMarginBase: 160,
    lmpEvalMarginPerDepth: 80,
    enableLmrTable: true,
    enableHistoryMalus: true,
    enableCountermove: true,
    enableTaperedEval: true,
    enableNonlinearKingSafety: true,
    enableBackwardPawn: true,
    enableKnightOutpost: true,
    enablePassedPawnKingDistance: true,
    enableRookBehindPassedPawn: true,
    enableTempoBonus: true,
  });

  assert.equal(patched.backtrackPenalty, 120);
  assert.equal(patched.openingBookEnabled, false);
  assert.equal(patched.openingBookMaxPly, 6);
  assert.equal(patched.enableNmpStaticGuard, true);
  assert.equal(patched.nmpStaticGuardMargin, 90);
  assert.equal(patched.enableRfp, true);
  assert.equal(patched.rfpDepthLimit, 2);
  assert.equal(patched.rfpMarginBase, 110);
  assert.equal(patched.rfpMarginPerDepth, 50);
  assert.equal(patched.enableFp, true);
  assert.equal(patched.fpDepthLimit, 2);
  assert.equal(patched.fpMarginBase, 110);
  assert.equal(patched.fpMarginPerDepth, 60);
  assert.equal(patched.enableLmp, true);
  assert.equal(patched.lmpDepthLimit, 2);
  assert.equal(patched.lmpMoveCountBase, 6);
  assert.equal(patched.lmpMoveCountPerDepth, 2);
  assert.equal(patched.lmpEvalMarginBase, 160);
  assert.equal(patched.lmpEvalMarginPerDepth, 80);
  assert.equal(patched.enableLmrTable, true);
  assert.equal(patched.enableHistoryMalus, true);
  assert.equal(patched.enableCountermove, true);
  assert.equal(patched.enableTaperedEval, true);
  assert.equal(patched.enableNonlinearKingSafety, true);
  assert.equal(patched.enableBackwardPawn, true);
  assert.equal(patched.enableKnightOutpost, true);
  assert.equal(patched.enablePassedPawnKingDistance, true);
  assert.equal(patched.enableRookBehindPassedPawn, true);
  assert.equal(patched.enableTempoBonus, true);
  assert.equal(getAiTuning().backtrackPenalty, 120);

  const reset = resetAiTuning();
  assert.deepEqual(reset, DEFAULT_AI_TUNING);
  assert.deepEqual(getAiTuning(), DEFAULT_AI_TUNING);
});

test('default tuning should enable validated feature pack while keeping RFP disabled', () => {
  const defaults = resetAiTuning();

  assert.equal(defaults.enableNmpStaticGuard, true);
  assert.equal(defaults.enableQDelta, true);
  assert.equal(defaults.enableRfp, false);
  assert.equal(defaults.enableFp, true);
  assert.equal(defaults.enableLmp, true);
  assert.equal(defaults.enableLmrTable, true);
  assert.equal(defaults.enableHistoryMalus, true);
  assert.equal(defaults.enableCountermove, true);
  assert.equal(defaults.enableTaperedEval, true);
  assert.equal(defaults.enableNonlinearKingSafety, true);
  assert.equal(defaults.enableBackwardPawn, true);
  assert.equal(defaults.enableKnightOutpost, true);
  assert.equal(defaults.enablePassedPawnKingDistance, true);
  assert.equal(defaults.enableRookBehindPassedPawn, true);
  assert.equal(defaults.enableTempoBonus, true);
});

test('NMP static guard helper should honor flag and margin', () => {
  assert.equal(
    shouldAllowNullMoveByStaticEval(50, 120, {
      ...DEFAULT_AI_TUNING,
      enableNmpStaticGuard: false,
      nmpStaticGuardMargin: 120,
    }),
    true,
    'guard disabled: should always allow',
  );

  assert.equal(
    shouldAllowNullMoveByStaticEval(20, 120, {
      ...DEFAULT_AI_TUNING,
      enableNmpStaticGuard: true,
      nmpStaticGuardMargin: 60,
    }),
    false,
    'guard enabled: low static eval should block NMP',
  );

  assert.equal(
    shouldAllowNullMoveByStaticEval(70, 120, {
      ...DEFAULT_AI_TUNING,
      enableNmpStaticGuard: true,
      nmpStaticGuardMargin: 60,
    }),
    true,
    'guard enabled: static eval near beta should allow NMP',
  );
});

test('RFP helper should honor guards and side-to-move direction', () => {
  assert.equal(
    shouldApplyReverseFutilityPruning(
      {
        staticEval: 350,
        alpha: -100,
        beta: 100,
        depth: 1,
        isMaximizingPlayer: true,
        inCheck: false,
        isPvNode: false,
      },
      {
        ...DEFAULT_AI_TUNING,
        enableRfp: false,
      },
    ),
    false,
    'RFP disabled: should never prune',
  );

  assert.equal(
    shouldApplyReverseFutilityPruning(
      {
        staticEval: 350,
        alpha: -100,
        beta: 100,
        depth: 1,
        isMaximizingPlayer: true,
        inCheck: false,
        isPvNode: false,
      },
      {
        ...DEFAULT_AI_TUNING,
        enableRfp: true,
        rfpDepthLimit: 2,
        rfpMarginBase: 120,
        rfpMarginPerDepth: 60,
      },
    ),
    true,
    'maximizing node: high static eval should trigger RFP',
  );

  assert.equal(
    shouldApplyReverseFutilityPruning(
      {
        staticEval: -320,
        alpha: -100,
        beta: 100,
        depth: 1,
        isMaximizingPlayer: false,
        inCheck: false,
        isPvNode: false,
      },
      {
        ...DEFAULT_AI_TUNING,
        enableRfp: true,
        rfpDepthLimit: 2,
        rfpMarginBase: 120,
        rfpMarginPerDepth: 60,
      },
    ),
    true,
    'minimizing node: very low static eval should trigger mirrored RFP condition',
  );

  assert.equal(
    shouldApplyReverseFutilityPruning(
      {
        staticEval: 350,
        alpha: -100,
        beta: 100,
        depth: 3,
        isMaximizingPlayer: true,
        inCheck: false,
        isPvNode: false,
      },
      {
        ...DEFAULT_AI_TUNING,
        enableRfp: true,
        rfpDepthLimit: 2,
        rfpMarginBase: 120,
        rfpMarginPerDepth: 60,
      },
    ),
    false,
    'depth beyond limit: should not prune',
  );

  assert.equal(
    shouldApplyReverseFutilityPruning(
      {
        staticEval: 350,
        alpha: -100,
        beta: 100,
        depth: 1,
        isMaximizingPlayer: true,
        inCheck: true,
        isPvNode: false,
      },
      {
        ...DEFAULT_AI_TUNING,
        enableRfp: true,
      },
    ),
    false,
    'in-check nodes should not be pruned by RFP',
  );

  assert.equal(
    shouldApplyReverseFutilityPruning(
      {
        staticEval: 350,
        alpha: -100,
        beta: 100,
        depth: 1,
        isMaximizingPlayer: true,
        inCheck: false,
        isPvNode: true,
      },
      {
        ...DEFAULT_AI_TUNING,
        enableRfp: true,
      },
    ),
    false,
    'PV node should not be pruned by RFP',
  );
});

test('Q-search delta pruning helper should honor flag and margin', () => {
  assert.equal(
    shouldPruneQCaptureByDelta(100, 20, 200, {
      ...DEFAULT_AI_TUNING,
      enableQDelta: false,
      qDeltaMargin: 120,
    }),
    false,
    'delta disabled: should never prune',
  );

  assert.equal(
    shouldPruneQCaptureByDelta(100, 20, 260, {
      ...DEFAULT_AI_TUNING,
      enableQDelta: true,
      qDeltaMargin: 100,
    }),
    true,
    'delta enabled: low-gain capture should be pruned when far below alpha',
  );

  assert.equal(
    shouldPruneQCaptureByDelta(100, 90, 260, {
      ...DEFAULT_AI_TUNING,
      enableQDelta: true,
      qDeltaMargin: 100,
    }),
    false,
    'delta enabled: potentially useful capture should be kept',
  );
});

test('futility pruning helper should honor guards and side-to-move direction', () => {
  assert.equal(
    shouldPruneMoveByFutility(
      {
        staticEval: 0,
        alpha: 100,
        beta: 300,
        depth: 1,
        isMaximizingPlayer: true,
        inCheck: false,
        isPvNode: false,
        isQuiet: true,
      },
      {
        ...DEFAULT_AI_TUNING,
        enableFp: false,
      },
    ),
    false,
    'FP disabled: should never prune',
  );

  assert.equal(
    shouldPruneMoveByFutility(
      {
        staticEval: -180,
        alpha: 100,
        beta: 300,
        depth: 1,
        isMaximizingPlayer: true,
        inCheck: false,
        isPvNode: false,
        isQuiet: true,
      },
      {
        ...DEFAULT_AI_TUNING,
        enableFp: true,
        fpDepthLimit: 2,
        fpMarginBase: 200,
        fpMarginPerDepth: 80,
      },
    ),
    true,
    'maximizing node: low static eval should allow futility pruning',
  );

  assert.equal(
    shouldPruneMoveByFutility(
      {
        staticEval: 260,
        alpha: -200,
        beta: 100,
        depth: 1,
        isMaximizingPlayer: false,
        inCheck: false,
        isPvNode: false,
        isQuiet: true,
      },
      {
        ...DEFAULT_AI_TUNING,
        enableFp: true,
        fpDepthLimit: 2,
        fpMarginBase: 100,
        fpMarginPerDepth: 60,
      },
    ),
    true,
    'minimizing node: high static eval should allow mirrored futility pruning',
  );

  assert.equal(
    shouldPruneMoveByFutility(
      {
        staticEval: -180,
        alpha: 100,
        beta: 300,
        depth: 1,
        isMaximizingPlayer: true,
        inCheck: true,
        isPvNode: false,
        isQuiet: true,
      },
      {
        ...DEFAULT_AI_TUNING,
        enableFp: true,
      },
    ),
    false,
    'in-check nodes should not use futility pruning',
  );
});

test('LMP helper should honor depth, move index and static-eval guards', () => {
  assert.equal(
    shouldPruneMoveByLmp(
      {
        staticEval: -100,
        alpha: 80,
        beta: 300,
        depth: 2,
        moveIndex: 12,
        isMaximizingPlayer: true,
        inCheck: false,
        isPvNode: false,
        isQuiet: true,
      },
      {
        ...DEFAULT_AI_TUNING,
        enableLmp: false,
      },
    ),
    false,
    'LMP disabled: should never prune',
  );

  assert.equal(
    shouldPruneMoveByLmp(
      {
        staticEval: -220,
        alpha: 100,
        beta: 300,
        depth: 2,
        moveIndex: 12,
        isMaximizingPlayer: true,
        inCheck: false,
        isPvNode: false,
        isQuiet: true,
      },
      {
        ...DEFAULT_AI_TUNING,
        enableLmp: true,
        lmpDepthLimit: 3,
        lmpMoveCountBase: 6,
        lmpMoveCountPerDepth: 2,
        lmpEvalMarginBase: 120,
        lmpEvalMarginPerDepth: 70,
      },
    ),
    true,
    'late quiet move with weak static eval should be pruned by LMP',
  );

  assert.equal(
    shouldPruneMoveByLmp(
      {
        staticEval: -220,
        alpha: 100,
        beta: 300,
        depth: 2,
        moveIndex: 5,
        isMaximizingPlayer: true,
        inCheck: false,
        isPvNode: false,
        isQuiet: true,
      },
      {
        ...DEFAULT_AI_TUNING,
        enableLmp: true,
        lmpDepthLimit: 3,
        lmpMoveCountBase: 6,
        lmpMoveCountPerDepth: 2,
        lmpEvalMarginBase: 180,
        lmpEvalMarginPerDepth: 90,
      },
    ),
    false,
    'early move index should not be pruned by LMP',
  );

  assert.equal(
    shouldPruneMoveByLmp(
      {
        staticEval: -220,
        alpha: 100,
        beta: 300,
        depth: 2,
        moveIndex: 12,
        isMaximizingPlayer: true,
        inCheck: false,
        isPvNode: true,
        isQuiet: true,
      },
      {
        ...DEFAULT_AI_TUNING,
        enableLmp: true,
      },
    ),
    false,
    'PV node should not be pruned by LMP',
  );
});

test('LMR helper should honor flag, boundaries and correction terms', () => {
  assert.equal(
    getLmrReduction(
      {
        depth: 6,
        moveIndex: 8,
        inCheck: false,
        isPvNode: false,
        isQuiet: true,
        isImproving: false,
        killerMoveScore: 0,
        historyMoveScore: 0,
      },
      {
        ...DEFAULT_AI_TUNING,
        enableLmrTable: false,
      },
    ),
    1,
    'feature disabled: should fall back to legacy 1-ply reduction',
  );

  assert.equal(
    getLmrReduction(
      {
        depth: 6,
        moveIndex: 1,
        inCheck: false,
        isPvNode: false,
        isQuiet: true,
        isImproving: false,
        killerMoveScore: 0,
        historyMoveScore: 0,
      },
      {
        ...DEFAULT_AI_TUNING,
        enableLmrTable: true,
      },
    ),
    0,
    'first non-PV reply is not late enough for LMR',
  );

  const base = getLmrReduction(
    {
      depth: 10,
      moveIndex: 12,
      inCheck: false,
      isPvNode: false,
      isQuiet: true,
      isImproving: false,
      killerMoveScore: 0,
      historyMoveScore: 0,
    },
    {
      ...DEFAULT_AI_TUNING,
      enableLmrTable: true,
    },
  );
  assert.ok(base >= 1, `expected base reduction >= 1, got ${base}`);

  const corrected = getLmrReduction(
    {
      depth: 10,
      moveIndex: 12,
      inCheck: false,
      isPvNode: false,
      isQuiet: true,
      isImproving: true,
      killerMoveScore: 90,
      historyMoveScore: 60,
    },
    {
      ...DEFAULT_AI_TUNING,
      enableLmrTable: true,
    },
  );
  assert.ok(
    corrected < base,
    `expected correction terms to reduce LMR amount (base=${base}, corrected=${corrected})`,
  );

  assert.equal(
    getLmrReduction(
      {
        depth: 2,
        moveIndex: 20,
        inCheck: false,
        isPvNode: false,
        isQuiet: true,
        isImproving: false,
        killerMoveScore: 0,
        historyMoveScore: 0,
      },
      {
        ...DEFAULT_AI_TUNING,
        enableLmrTable: true,
      },
    ),
    1,
    'reduction is clamped to keep at least one ply for late-move search at depth=2',
  );
});

test('history helper should saturate bonus/malus and clear correctly', () => {
  clearHistory();
  const move = { from: 'a2', to: 'a3' } as const;

  for (let i = 0; i < 128; i += 1) {
    applyHistoryBonus(move, 12);
  }
  assert.equal(
    getHistoryScoreForMove(move),
    70,
    'history bonus should saturate to +70 ordering points',
  );

  for (let i = 0; i < 256; i += 1) {
    applyHistoryMalus(move, 12);
  }
  assert.equal(
    getHistoryScoreForMove(move),
    -70,
    'history malus should saturate to -70 ordering points',
  );

  clearHistory();
  assert.equal(
    getHistoryScoreForMove(move),
    0,
    'clearHistory should reset score to neutral',
  );
});

test('countermove helper should record, score and clear correctly', () => {
  clearCountermoves();
  const previousMove = { from: 'e2', to: 'e4' } as const;
  const bestReply = { from: 'c7', to: 'c5' } as const;
  const otherReply = { from: 'e7', to: 'e5' } as const;

  assert.equal(
    getCountermoveScore('b', previousMove, bestReply),
    0,
    'before recording countermove, score should be zero',
  );

  recordCountermove('b', previousMove, bestReply);
  assert.ok(
    getCountermoveScore('b', previousMove, bestReply) > 0,
    'recorded countermove should receive ordering bonus',
  );
  assert.equal(
    getCountermoveScore('b', previousMove, otherReply),
    0,
    'different reply should not receive countermove bonus',
  );
  assert.equal(
    getCountermoveScore('w', previousMove, bestReply),
    0,
    'countermove table is side-specific',
  );

  clearCountermoves();
  assert.equal(
    getCountermoveScore('b', previousMove, bestReply),
    0,
    'clearCountermoves should reset bonus to zero',
  );
});

test('C1 phase computation should follow N/B=1, R=2, Q=4 (max=24)', () => {
  const start = new Chess();
  assert.equal(getGamePhaseForTesting(start), 24, 'initial position should have full phase=24');

  const kingsOnly = new Chess('4k3/8/8/8/8/8/8/4K3 w - - 0 1');
  assert.equal(getGamePhaseForTesting(kingsOnly), 0, 'kings-only position should have phase=0');

  const queensAndKnights = new Chess('6k1/3q1ppp/2n2n2/8/8/2N2N2/3Q1PPP/6K1 w - - 0 1');
  assert.equal(getGamePhaseForTesting(queensAndKnights), 12, 'Q+N+N per side should result in phase=12');
});

test('C1 tapered eval should smooth score transition across MG/EG boundary', () => {
  const higherPhase = new Chess('6k1/3q1ppp/2n2n2/8/8/2N2N2/3Q4/4K3 w - - 0 1');
  const lowerPhase = new Chess('6k1/3q1ppp/5n2/8/8/5N2/3Q4/4K3 w - - 0 1');

  const legacyHi = evaluateBoardForTesting(higherPhase, 'w', { enableTaperedEval: false });
  const legacyLo = evaluateBoardForTesting(lowerPhase, 'w', { enableTaperedEval: false });
  const taperedHi = evaluateBoardForTesting(higherPhase, 'w', { enableTaperedEval: true });
  const taperedLo = evaluateBoardForTesting(lowerPhase, 'w', { enableTaperedEval: true });

  const legacyJump = Math.abs(legacyHi - legacyLo);
  const taperedJump = Math.abs(taperedHi - taperedLo);

  assert.ok(
    taperedJump < legacyJump,
    `expected tapered transition to be smoother (legacy=${legacyJump}, tapered=${taperedJump})`,
  );
});

test('C2.1 nonlinear king safety should penalize exposed king attacks more strongly', () => {
  const exposedKing = new Chess('6k1/5ppp/8/8/8/4rq2/4PPPP/4K3 w - - 0 1');

  const linearScore = evaluateBoardForTesting(exposedKing, 'w', {
    enableTaperedEval: true,
    enableNonlinearKingSafety: false,
  });
  const nonlinearScore = evaluateBoardForTesting(exposedKing, 'w', {
    enableTaperedEval: true,
    enableNonlinearKingSafety: true,
  });

  assert.ok(
    nonlinearScore < linearScore,
    `nonlinear king safety should reduce score under strong attack (linear=${linearScore}, nonlinear=${nonlinearScore})`,
  );
});

test('C2.2 backward pawn should be penalized when enabled', () => {
  const backwardPawnPosition = new Chess('6k1/8/8/8/4pp2/3P4/8/4K3 w - - 0 1');

  const withoutBackwardPenalty = evaluateBoardForTesting(backwardPawnPosition, 'w', {
    enableTaperedEval: true,
    enableBackwardPawn: false,
  });
  const withBackwardPenalty = evaluateBoardForTesting(backwardPawnPosition, 'w', {
    enableTaperedEval: true,
    enableBackwardPawn: true,
  });

  assert.ok(
    withBackwardPenalty < withoutBackwardPenalty,
    `backward pawn enabled should reduce score (off=${withoutBackwardPenalty}, on=${withBackwardPenalty})`,
  );
});

test('C2.3 knight outpost should increase score when enabled', () => {
  const knightOutpostPosition = new Chess('6k1/p6p/8/3N4/4P3/8/8/4K3 w - - 0 1');

  const withoutOutpostBonus = evaluateBoardForTesting(knightOutpostPosition, 'w', {
    enableTaperedEval: true,
    enableKnightOutpost: false,
  });
  const withOutpostBonus = evaluateBoardForTesting(knightOutpostPosition, 'w', {
    enableTaperedEval: true,
    enableKnightOutpost: true,
  });

  assert.ok(
    withOutpostBonus > withoutOutpostBonus,
    `knight outpost enabled should increase score (off=${withoutOutpostBonus}, on=${withOutpostBonus})`,
  );
});

test('C2.4 passed pawn king-distance should reward closer friendly king when enabled', () => {
  const passedPawnRace = new Chess('7k/2K5/3P4/8/8/8/8/8 w - - 0 1');

  const withoutKingDistanceBonus = evaluateBoardForTesting(passedPawnRace, 'w', {
    enableTaperedEval: true,
    enablePassedPawnKingDistance: false,
  });
  const withKingDistanceBonus = evaluateBoardForTesting(passedPawnRace, 'w', {
    enableTaperedEval: true,
    enablePassedPawnKingDistance: true,
  });

  assert.ok(
    withKingDistanceBonus > withoutKingDistanceBonus,
    `passed pawn king-distance enabled should increase score (off=${withoutKingDistanceBonus}, on=${withKingDistanceBonus})`,
  );
});

test('C2.5 rook behind passed pawn should increase score when enabled', () => {
  const rookBehindPassedPawn = new Chess('7k/8/4P3/8/8/8/8/4R1K1 w - - 0 1');

  const withoutRookBehindBonus = evaluateBoardForTesting(rookBehindPassedPawn, 'w', {
    enableTaperedEval: true,
    enableRookBehindPassedPawn: false,
  });
  const withRookBehindBonus = evaluateBoardForTesting(rookBehindPassedPawn, 'w', {
    enableTaperedEval: true,
    enableRookBehindPassedPawn: true,
  });

  assert.ok(
    withRookBehindBonus > withoutRookBehindBonus,
    `rook-behind-passed-pawn enabled should increase score (off=${withoutRookBehindBonus}, on=${withRookBehindBonus})`,
  );
});

test('C2.6 tempo bonus should favor side to move when enabled', () => {
  const whiteToMove = new Chess('6k1/8/8/8/3P4/8/8/4K3 w - - 0 1');
  const blackToMove = new Chess('6k1/8/8/8/3P4/8/8/4K3 b - - 0 1');

  const withoutTempoWhite = evaluateBoardForTesting(whiteToMove, 'w', {
    enableTaperedEval: true,
    enableTempoBonus: false,
  });
  const withoutTempoBlack = evaluateBoardForTesting(blackToMove, 'w', {
    enableTaperedEval: true,
    enableTempoBonus: false,
  });
  assert.equal(
    withoutTempoWhite,
    withoutTempoBlack,
    `without tempo bonus expected equal scores (wtm=${withoutTempoWhite}, btm=${withoutTempoBlack})`,
  );

  const withTempoWhite = evaluateBoardForTesting(whiteToMove, 'w', {
    enableTaperedEval: true,
    enableTempoBonus: true,
  });
  const withTempoBlack = evaluateBoardForTesting(blackToMove, 'w', {
    enableTaperedEval: true,
    enableTempoBonus: true,
  });

  assert.ok(
    withTempoWhite > withTempoBlack,
    `tempo bonus should favor side to move (wtm=${withTempoWhite}, btm=${withTempoBlack})`,
  );
});

test('quiescence search prevents horizon-effect blunder (rook not traded for bishop)', { timeout: 60_000 }, () => {
  // White rook can capture the black pawn on d5, but the black bishop on e4
  // immediately recaptures via Bxd5. Net exchange: white loses rook (500) and
  // gains only a pawn (100) = -400 centipawns. After Rxd5 → Bxd5 the resulting
  // king vs king+bishop position is a draw by insufficient material which the
  // draw-score heuristic values at +20. Other continuations with a functioning
  // quiescence search correctly score higher (≈ +50, white is ahead materially),
  // so Rxd5 is rejected in favour of any other rook move.
  resetOpeningState();
  clearTranspositionTable();
  const game = new Chess('2k5/8/8/3p4/4b3/8/3R4/2K5 w - - 0 1');
  const bestMove = getBestMove(game, 'hard', { openingBookEnabled: false, hardBand: 1, hardCandidateCap: 1 });
  assert.ok(bestMove, 'AI should return a move');
  assert.notEqual(bestMove, 'Rxd5', 'AI should not trade rook for bishop (QSearch must detect the recapture)');
});

test('endgame king centralization: king prefers central squares over corner', { timeout: 60_000 }, () => {
  // White king is on a1 with a pawn on a2; black has a pawn on a7 that blocks
  // white's a-pawn from being a passed pawn.  With neither pawn passed, the
  // dominant scoring term is the endgame king PST.
  //
  // Legal king moves from a1:  Kb1 (PST=−30)  Kb2 (PST=−10)
  // Legal pawn moves:          a3  (PST unchanged, not passed → 0 net change)
  //
  // Kb2 gains the most PST value (+40 over current a1=−50) and dominates.
  // hardBand:1 + hardCandidateCap:1 forces the single top-scored move.
  resetOpeningState();
  clearTranspositionTable();
  const originalRandom = Math.random;
  Math.random = () => 0;
  try {
    const game = new Chess('8/p7/8/8/8/8/P7/K6k w - - 0 1');
    const bestMove = getBestMove(game, 'hard', {
      openingBookEnabled: false,
      hardBand: 1,
      hardCandidateCap: 1,
    });
    assert.ok(bestMove, 'AI should return a move in an endgame position');
    assert.equal(bestMove, 'Kb2', 'expected king to centralise (Kb2) using the endgame king PST');
  } finally {
    Math.random = originalRandom;
    resetOpeningState();
    clearTranspositionTable();
  }
});

test('committed line aborts when opponent deviates from expected reply', { timeout: 60_000 }, () => {
  // With random=0 the AI commits to COMMITTED_LINES_WHITE[0] (Ruy Lopez):
  //   moves[0]='e2e4'  moves[1]='e7e5'  moves[2]='g1f3' …
  // White plays e4 (committed move 0). Black deviates by playing d5 instead of
  // the expected e5 (committed slot 1). When white calls getBestMove for move 2,
  // getCommittedOpeningMove checks history.last ('d7d5') against moves[1]
  // ('e7e5'), detects the mismatch, sets committedLineAborted=true and falls
  // through to the search. The AI must still return a valid legal move.
  resetOpeningState();
  clearTranspositionTable();
  const originalRandom = Math.random;
  Math.random = () => 0;
  try {
    const game = new Chess();
    const firstMove = getBestMove(game, 'hard', { openingBookEnabled: false });
    assert.ok(firstMove, 'expected AI to return an opening move');
    game.move(firstMove as string);

    // Black deviates from the expected reply
    game.move('d5');

    // After deviation the committed line is aborted; AI must use the search
    const secondMove = getBestMove(game, 'hard', { openingBookEnabled: false });
    assert.ok(secondMove, 'AI should return a valid move after committed line deviation');
    const verify = new Chess(game.fen());
    assert.ok(verify.move(secondMove as string), 'move returned after deviation must be legal');
  } finally {
    Math.random = originalRandom;
    resetOpeningState();
    clearTranspositionTable();
  }
});

test('resetOpeningState clears committed line so AI falls back to search', { timeout: 60_000 }, () => {
  // After a committed line is selected by the first getBestMove call, invoking
  // resetOpeningState() nulls out committedLine. On the next getBestMove at
  // plyCount > 0 (aiMovesMade > 0), selectCommittedLine is NOT re-triggered,
  // so getCommittedOpeningMove returns null immediately and the search is used.
  resetOpeningState();
  clearTranspositionTable();
  const originalRandom = Math.random;
  Math.random = () => 0;
  try {
    const game = new Chess();
    // First move: selects committed line (Ruy Lopez) and follows it
    const firstMove = getBestMove(game, 'hard', { openingBookEnabled: false });
    assert.ok(firstMove, 'expected first committed-line move');
    game.move(firstMove as string);
    game.move('e5'); // black follows expected reply

    // Reset mid-game: committed line state is cleared
    resetOpeningState();

    // plyCount=2, aiMovesMade=1 → selectCommittedLine is NOT called.
    // committedLine is null → falls straight to search.
    const secondMove = getBestMove(game, 'hard', { openingBookEnabled: false });
    assert.ok(secondMove, 'AI should return a valid move after resetOpeningState');
    const verify = new Chess(game.fen());
    assert.ok(verify.move(secondMove as string), 'move returned after reset must be legal');
  } finally {
    Math.random = originalRandom;
    resetOpeningState();
    clearTranspositionTable();
  }
});

// --- Pawn Structure Tests ---

test('passed pawn: AI promotes pawn on the penultimate rank', { timeout: 30_000 }, () => {
  // White pawn on e7 (one step from queening, no black pawns on d/e/f files).
  // PASSED_PAWN_BONUS[6] = 90 already applies at e7; queening to a queen (900 cp)
  // dwarfs any king move (+40 PST at best) → e8=Q must be the top-scored move.
  // isEndgame=true (no non-pawn material) so king safety is skipped.
  resetOpeningState();
  clearTranspositionTable();
  const game = new Chess('6k1/4P3/8/8/8/K7/8/8 w - - 0 1');
  const move = getBestMove(game, 'hard', {
    openingBookEnabled: false,
    hardBand: 1,
    hardCandidateCap: 1,
  });
  // The queen lands on e8 while the black king is on g8 (same rank) → promotion
  // gives check, so chess.js encodes the SAN as 'e8=Q+'.
  assert.equal(move, 'e8=Q+', 'AI should promote the passed pawn to queen (with check)');
});

test('passed pawn race: AI advances own passed pawn in mutual pawn race', { timeout: 30_000 }, () => {
  // White: King a1, passed pawn a6 (adv=5, bonus=60).
  // Black: King h8, passed pawn h3 (adv=5 for black, bonus=60). Mirror race.
  //
  // At depth 1 (static):  a7 gains +30 passed bonus (PASSED_PAWN_BONUS[6]=90 vs 60)
  //   + +40 PST (50 vs 10) = +70 net pawn improvement vs any king move (+20 king PST at most).
  // At depth 2 (after black replies h2): a7 keeps the race even (both at adv=6, bonus=90),
  //   while a king move falls behind (black pawn scores 90 while white's stays at 60).
  // So a7 should dominate at all search depths.
  resetOpeningState();
  clearTranspositionTable();
  const game = new Chess('7k/8/P7/8/8/7p/8/K7 w - - 0 1');
  const move = getBestMove(game, 'hard', {
    openingBookEnabled: false,
    hardBand: 1,
    hardCandidateCap: 1,
  });
  assert.equal(move, 'a7', 'AI should advance the passed pawn in a pawn race');
});

// --- King Safety Tests ---

test('king safety: AI preserves pawn shield when no tactical reason to break it', { timeout: 30_000 }, () => {
  // White king on g1, pawns f2/g2/h2 intact (full kingside shield).
  // White rook on f1, white queen on d1. Black: king g8, queen d8.
  // With king safety evaluation, shield-breaking advances (g3, h3, f3) incur an
  // OPEN_FILE or SEMI_OPEN penalty, so quiet non-shield moves score higher.
  resetOpeningState();
  clearTranspositionTable();
  const game = new Chess('6k1/3q4/8/8/8/8/3Q1PPP/3R1RK1 w - - 0 1');
  const move = getBestMove(game, 'hard', {
    openingBookEnabled: false,
    hardBand: 30,
    hardCandidateCap: 1,
  });
  assert.ok(move, 'AI should return a move');
  assert.ok(
    !['g3', 'h3', 'f3'].includes(move as string),
    `AI should not voluntarily break pawn shield; chose: ${move}`,
  );
});

test('king safety: evaluation runs correctly when king is exposed to queen attack', { timeout: 30_000 }, () => {
  // White: King e1 (no pawn shield), queen on d1, pawn on e2.
  // Black: Queen on e5 (on e-file pointing at the white king), king on g8.
  // isEndgame=false (both queens → non-pawn material > 1300 per side).
  // King safety evaluation triggers: open files near king + queen in king zone.
  // Verify the AI returns a legal move without errors from the new evaluation code.
  resetOpeningState();
  clearTranspositionTable();
  const game = new Chess('6k1/8/8/4q3/8/8/3QP3/4K3 w - - 0 1');
  const move = getBestMove(game, 'hard', {
    openingBookEnabled: false,
    hardBand: 1,
    hardCandidateCap: 1,
  });
  assert.ok(move, 'AI should return a valid move even when king is exposed');
  const verify = new Chess(game.fen());
  assert.ok(verify.move(move as string), `Move ${move} must be legal`);
});

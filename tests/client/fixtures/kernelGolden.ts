/**
 * Golden search trees of the independent kernel, for refactors that must not
 * change the tree (phase 9): each case runs runKernelSearch to a fixed depth
 * without deadlines and records every root move's score and every search
 * counter. research/scripts/kernel-golden-fixture.ts writes kernelGolden.json
 * from this module; tests/client/kernelGolden.test.ts compares.
 */
import { Chess } from 'chess.js';
import { resolveAiTuning } from '../../../src/utils/chessAI';
import { resetSearchCounters, searchState } from '../../../src/utils/chess-ai/chessAISearchDiagnostics';
import type { AiTuning } from '../../../src/utils/chess-ai/chessAITuning';
import { createIndependentPosition } from '../../../src/utils/chess-ai/independentSearch';
import { runKernelSearch } from '../../../src/utils/chess-ai/independent/kernelSearch';
import { MAX_MOVES, moveCodeToUci } from '../../../src/utils/chess-ai/independent/moveCode';
import type { EngineAdapterComputeInput } from '../../../src/workers/engineAdapter';
import { selfPlayHistoryPositions } from './selfPlayHistory';

export type GoldenCase = { name: string; input: EngineAdapterComputeInput; depth: number; tuning?: Partial<AiTuning> };
export type GoldenResult = {
  name: string; depth: number; completedDepth: number; root: Array<[string, number | string]>;
  counters: { nodes: number; qNodes: number; nullMoveAttempts: number; nullMoveCuts: number; rfp: number; fp: number; lmp: number };
};

const fenInput = (fen: string): EngineAdapterComputeInput => ({ fen, historyStartFen: fen, history: [], historyTruncated: false, difficulty: 'expert' });

/** Positions from seeded random games (capture-biased), with complete history. */
const randomGamePositions = (count: number): Array<[string, EngineAdapterComputeInput]> => {
  let seed = 0x5eed1234;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const out: Array<[string, EngineAdapterComputeInput]> = [];
  while (out.length < count) {
    const game = new Chess();
    const history: string[] = [];
    const target = 16 + Math.floor(random() * 50);
    while (history.length < target && !game.isGameOver()) {
      const moves = game.moves({ verbose: true });
      const captures = moves.filter((m) => m.captured || m.promotion);
      const move = captures.length && random() < 0.4 ? captures[Math.floor(random() * captures.length)] : moves[Math.floor(random() * moves.length)];
      game.move(move);
      history.push(`${move.from}${move.to}${move.promotion ?? ''}`);
    }
    if (game.isGameOver() || history.length < target) continue;
    out.push([`random ${out.length} (ply ${history.length})`, { fen: game.fen(), history, difficulty: 'expert' }]);
  }
  return out;
};

/** Knights out and back, and out again: one more cycle repeats the start position a third time. */
const repetitionInput = (): EngineAdapterComputeInput => {
  const moves = ['g1f3', 'g8f6', 'f3g1', 'f6g8', 'g1f3', 'g8f6', 'f3g1'];
  const game = new Chess();
  for (const u of moves) game.move({ from: u.slice(0, 2), to: u.slice(2, 4) });
  return { fen: game.fen(), history: moves, difficulty: 'expert' };
};

export const goldenCases = (): GoldenCase[] => {
  const history = selfPlayHistoryPositions([40, 80]);
  const cases: GoldenCase[] = [
    { name: 'start', input: { fen: 'start', history: [], difficulty: 'expert' }, depth: 5 },
    { name: 'ply 40', input: history.get(40)!, depth: 6 },
    { name: 'ply 80', input: history.get(80)!, depth: 9 },
    { name: 'kiwipete', input: fenInput('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1'), depth: 4 },
    { name: 'kiwipete, no history', input: { fen: 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', difficulty: 'expert' }, depth: 4 },
    { name: 'rook endgame', input: fenInput('8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1'), depth: 8 },
    { name: 'promotions and checks', input: fenInput('r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1'), depth: 4 },
    { name: 'underpromotion race', input: fenInput('n1n5/PPPk4/8/8/8/8/4Kppp/5N1N b - - 0 1'), depth: 5 },
    { name: 'en passant', input: fenInput('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1'), depth: 9 },
    { name: 'castling rooks', input: fenInput('r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1'), depth: 5 },
    { name: 'middlegame', input: fenInput('r2q1rk1/1b2bppp/p2ppn2/1p6/3NP3/1BN1B3/PPP2PPP/R2Q1RK1 w - - 0 11'), depth: 5 },
    { name: 'mate in two', input: fenInput('6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1'), depth: 5 },
    { name: 'queen vs rook', input: fenInput('8/8/4k3/8/3r4/8/3QK3/8 w - - 0 1'), depth: 7 },
    { name: 'repetition history', input: repetitionInput(), depth: 5 },
    ...randomGamePositions(8).map(([name, input]): GoldenCase => ({ name, input, depth: 4 })),
  ];
  // Evaluation and pruning variants on a few positions.
  const variants: Array<[string, Partial<AiTuning>]> = [
    ['aggressive', { aiStyle: 'aggressive' }],
    ['defensive', { aiStyle: 'defensive' }],
    ['untapered', { enableTaperedEval: false, enableTempoBonus: false }],
    ['plain search', { enableLmrTable: false, enableHistoryMalus: false, enableCountermove: false, enableRfp: false, enableFp: false,
      enableLmp: false, enableQDelta: false, enableNmpStaticGuard: false }],
    ['plain eval', { enableNonlinearKingSafety: false, enableBackwardPawn: false, enableKnightOutpost: false,
      enablePassedPawnKingDistance: false, enableRookBehindPassedPawn: false }],
  ];
  for (const [label, tuning] of variants) {
    cases.push({ name: `ply 40, ${label}`, input: history.get(40)!, depth: 5, tuning });
    cases.push({ name: `middlegame, ${label}`, input: cases[10].input, depth: 4, tuning });
  }
  return cases;
};

export const runGoldenCase = (golden: GoldenCase): GoldenResult => {
  const position = createIndependentPosition(golden.input);
  const tuning = Object.freeze({ ...resolveAiTuning({ ...golden.tuning, openingBookEnabled: false }) });
  const buffer = new Int32Array(MAX_MOVES);
  const rootOrder = Array.from(buffer.subarray(0, position.generateMoveCodes(buffer)))
    .sort((a, b) => moveCodeToUci(a).localeCompare(moveCodeToUci(b)));
  resetSearchCounters(); searchState.searchAborted = false;
  const result = runKernelSearch(position, rootOrder, { color: position.turn, tuning, difficulty: 'expert', maxDepth: golden.depth,
    openingPhase: false, previousOwnMove: null, firstDepthDeadline: Infinity, softDeadline: Infinity, hardDeadline: Infinity });
  return {
    name: golden.name, depth: golden.depth, completedDepth: result.completedDepth,
    // JSON has no -Infinity (a move cut at the selection edge): keep it as a string.
    root: result.rootMoves.map(({ move, rawScore }) => [moveCodeToUci(move), Number.isFinite(rawScore) ? rawScore : String(rawScore)]),
    counters: { nodes: searchState.nodeCount, qNodes: searchState.qNodeCount, nullMoveAttempts: searchState.nullMoveAttemptCount,
      nullMoveCuts: searchState.nullMoveCutCount, rfp: searchState.rfpPruneCount, fp: searchState.fpPruneCount, lmp: searchState.lmpPruneCount },
  };
};

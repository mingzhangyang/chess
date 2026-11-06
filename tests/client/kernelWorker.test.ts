/**
 * End-to-end tests of the independent kernel behind the worker's default-off
 * switch (`tsSearchKernel: 'independent'`): requests go through the worker
 * runtime and the real TypeScript adapter, as in aiWorkerRuntime.test.ts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { handleAiComputeRequest, isAiComputeRequest, type AiTelemetryMessage, type AiWorkerRuntimeDeps } from '../../src/workers/aiWorkerRuntime';
import type { EngineAdapter, EngineAdapterComputeInput } from '../../src/workers/engineAdapter';
import { TsEngineAdapter } from '../../src/workers/tsEngineAdapter';
import { getLastMoveByColor, getLastSearchDiagnostics, resetOpeningState, resolveAiTuning } from '../../src/utils/chessAI';
import { searchState } from '../../src/utils/chess-ai/chessAISearchDiagnostics';
import { createIndependentPosition } from '../../src/utils/chess-ai/independentSearch';
import { kernelPositionFromInput, kernelTableForTesting, previousOwnMoveFromHistory, searchKernelMove } from '../../src/utils/chess-ai/independent/kernelEngine';
import type { SearchPosition } from '../../src/utils/chess-ai/searchPosition';
import { squareFromAlgebraic } from '../../src/utils/chess-ai/searchPosition';

const RUY_LOPEZ = ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'a7a6', 'b5a4', 'g8f6', 'e1g1', 'f8e7'];
const play = (ucis: readonly string[], start?: string): Chess => {
  const game = start ? new Chess(start) : new Chess();
  for (const u of ucis) game.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
  return game;
};
const request = (overrides: Record<string, unknown> = {}) => ({
  type: 'compute-best-move', requestId: 1, fen: play(RUY_LOPEZ).fen(), history: RUY_LOPEZ,
  difficulty: 'hard', backend: 'ts', tuning: { openingBookEnabled: false }, timeLimitMs: 150,
  tsSearchKernel: 'independent', ...overrides,
});
const runtime = (adapter: EngineAdapter, telemetry: AiTelemetryMessage[] = []): Partial<AiWorkerRuntimeDeps> => ({
  resolveBackend: (backend) => backend ?? 'ts',
  getAdapter: () => adapter,
  emitTelemetry: (event) => { telemetry.push(event); },
});
const withRandom = async <T>(random: () => number, run: () => Promise<T> | T): Promise<T> => {
  const original = Math.random;
  Math.random = random;
  try { return await run(); } finally { Math.random = original; }
};
const seeded = (seed: number) => () => {
  seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
  return seed / 4294967296;
};

test('the switch is a validated, optional request field', () => {
  assert.equal(isAiComputeRequest(request()), true);
  assert.equal(isAiComputeRequest(request({ tsSearchKernel: undefined })), true);
  for (const bad of ['legacy', 'Independent', 1, true, null]) assert.equal(isAiComputeRequest(request({ tsSearchKernel: bad })), false, String(bad));
});

test('with the switch on, the worker answers with a legal kernel move', async () => {
  const positions: SearchPosition[] = [];
  const adapter = new TsEngineAdapter({ kernelHooks: { onPosition: (p) => positions.push(p) } });
  for (const difficulty of ['medium', 'hard', 'expert']) {
    const telemetry: AiTelemetryMessage[] = [];
    const response = await handleAiComputeRequest(request({ difficulty }), runtime(adapter, telemetry));
    assert.equal(response?.error, undefined, difficulty);
    assert.ok(response?.bestMove && play(RUY_LOPEZ).move(response.bestMove), `${difficulty}: ${response?.bestMove}`);
    assert.deepEqual(telemetry, [], difficulty);
    assert.ok(getLastSearchDiagnostics().completedDepth >= 1, difficulty);
  }
  assert.equal(positions.length, 3, 'the kernel searched each request');
});

test('with the switch off, the kernel is never reached', async () => {
  const positions: SearchPosition[] = [];
  const adapter = new TsEngineAdapter({ kernelHooks: { onPosition: (p) => positions.push(p) } });
  const response = await handleAiComputeRequest(request({ tsSearchKernel: undefined }), runtime(adapter));
  assert.ok(response?.bestMove);
  assert.equal(positions.length, 0);
});

test('opening book and easy moves are the production ones, with the same random draws', async () => {
  const cases: Array<Record<string, unknown>> = [];
  for (const difficulty of ['easy', 'medium', 'hard']) {
    for (const history of [[], ['e2e4'], ['e2e4', 'e7e5'], ['d2d4', 'g8f6', 'c2c4']]) {
      cases.push({ difficulty, history, fen: play(history).fen(), tuning: { openingBookEnabled: true, openingBookMaxPly: 10 }, timeLimitMs: undefined });
    }
  }
  for (const overrides of cases) for (const seed of [1, 2, 3]) {
    const positions: SearchPosition[] = [];
    const on = new TsEngineAdapter({ kernelHooks: { onPosition: (p) => positions.push(p) } });
    const off = new TsEngineAdapter();
    // The committed opening line is worker-global state: start both runs from the same state.
    resetOpeningState();
    const withSwitch = await withRandom(seeded(seed), () => handleAiComputeRequest(request(overrides), runtime(on)));
    resetOpeningState();
    const without = await withRandom(seeded(seed), () => handleAiComputeRequest(request({ ...overrides, tsSearchKernel: undefined }), runtime(off)));
    assert.equal(withSwitch?.bestMove, without?.bestMove, JSON.stringify(overrides));
    assert.equal(positions.length, 0, `book or easy move expected: ${JSON.stringify(overrides)}`);
  }
});

test('medium and hard selection draws from the real random source', async () => {
  let draws = 0;
  const original = Math.random;
  await withRandom(() => { draws += 1; return original(); }, async () => {
    for (const difficulty of ['medium', 'hard']) {
      const response = await handleAiComputeRequest(request({ difficulty }), runtime(new TsEngineAdapter()));
      assert.ok(response?.bestMove, difficulty);
    }
  });
  assert.ok(draws >= 2, `random draws: ${draws}`);
});

test('a search cancelled midway still returns a legal move and leaves the position at its root', async () => {
  for (const abortAfter of [1, 3, 40, 400]) {
    let checks = 0;
    let position: SearchPosition | undefined;
    let rootFen = '';
    const adapter = new TsEngineAdapter({ kernelHooks: {
      onPosition: (p) => { position = p; rootFen = p.toFen(); },
      shouldAbort: () => (checks += 1) >= abortAfter,
    } });
    const response = await handleAiComputeRequest(request({ timeLimitMs: 5_000, difficulty: 'expert' }), runtime(adapter));
    assert.equal(response?.error, undefined);
    assert.ok(response?.bestMove && play(RUY_LOPEZ).move(response.bestMove), `abort after ${abortAfter}: ${response?.bestMove}`);
    assert.ok(checks >= abortAfter, 'the search was cancelled, not finished');
    assert.equal(position?.toFen(), rootFen);
    assert.equal(position?.ply, 0);
    assert.equal(searchState.searchAborted, false, 'no abort flag leaks into the next search');
  }
  // The next search in the same worker is unaffected.
  const next = await handleAiComputeRequest(request(), runtime(new TsEngineAdapter()));
  assert.ok(next?.bestMove);
  assert.ok(getLastSearchDiagnostics().completedDepth >= 1);
});

test('a kernel that throws mid-search falls back to the existing TS search', async () => {
  let checks = 0;
  let position: SearchPosition | undefined;
  let rootFen = '';
  const telemetry: AiTelemetryMessage[] = [];
  const adapter = new TsEngineAdapter({ kernelHooks: {
    onPosition: (p) => { position = p; rootFen = p.toFen(); },
    shouldAbort: () => { if ((checks += 1) === 20) throw new Error('kernel exploded'); return false; },
  } });
  const calls: EngineAdapterComputeInput[] = [];
  const spy: EngineAdapter = {
    init: () => {},
    computeBestMove: (input) => { calls.push(input); return adapter.computeBestMove(input); },
    dispose: () => {},
  };
  const response = await handleAiComputeRequest(request({ timeLimitMs: 2_000 }), runtime(spy, telemetry));
  assert.equal(response?.error, undefined);
  assert.ok(response?.bestMove && play(RUY_LOPEZ).move(response.bestMove), String(response?.bestMove));
  assert.equal(position?.toFen(), rootFen, 'the kernel restored its position before failing over');
  assert.deepEqual(telemetry.map(({ name, level }) => [name, level]), [['ts-kernel-fallback', 'warn']]);
  assert.match(String(telemetry[0].data?.error), /kernel exploded/);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].tsSearchKernel, undefined, 'the fallback is the existing search');
  assert.ok((calls[1].timeLimitMs ?? 0) > 0 && (calls[1].timeLimitMs ?? 0) <= 2_000, `fallback budget ${calls[1].timeLimitMs}`);
});

test('history errors are reported, not retried, with the switch on', async () => {
  const telemetry: AiTelemetryMessage[] = [];
  const response = await handleAiComputeRequest(request({ history: ['e2e5'], fen: 'start' }), runtime(new TsEngineAdapter(), telemetry));
  assert.equal(response?.bestMove, null);
  assert.equal(response?.error, 'invalid AI move history');
  assert.deepEqual(telemetry.map(({ name }) => name), ['backend-compute-failed']);
});

test('the Stockfish fallback is unaffected by the switch', async () => {
  const received: EngineAdapterComputeInput[] = [];
  const telemetry: AiTelemetryMessage[] = [];
  const response = await handleAiComputeRequest(request({ backend: 'stockfish-wasm', difficulty: 'expert' }), {
    resolveBackend: (backend) => backend ?? 'ts',
    getAdapter: (backend) => (backend === 'stockfish-wasm'
      ? { init: () => {}, computeBestMove: () => { throw new Error('stockfish-wasm-timeout'); }, dispose: () => {} }
      : { init: () => {}, computeBestMove: (input) => { received.push(input); return 'Nc3'; }, dispose: () => {} }),
    emitTelemetry: (event) => { telemetry.push(event); },
  });
  assert.equal(response?.bestMove, 'Nc3');
  assert.deepEqual(telemetry.map(({ name }) => name), ['backend-compute-fallback']);
  assert.equal(received.length, 1);
  assert.equal('tsSearchKernel' in received[0], false);
});

test('the worker reuses one kernel transposition table, cleared for every search', async () => {
  const adapter = new TsEngineAdapter();
  await handleAiComputeRequest(request(), runtime(adapter));
  const table = kernelTableForTesting();
  assert.ok(table);
  await handleAiComputeRequest(request({ difficulty: 'expert' }), runtime(adapter));
  await handleAiComputeRequest(request({ fen: play([...RUY_LOPEZ, 'f1e1']).fen(), history: [...RUY_LOPEZ, 'f1e1'] }), runtime(adapter));
  assert.equal(kernelTableForTesting(), table);
});

test('the kernel stage rebuilds the boundary like the research entry, without chess.js history replays', () => {
  const inputs: EngineAdapterComputeInput[] = [
    { fen: play(RUY_LOPEZ).fen(), history: RUY_LOPEZ, difficulty: 'hard' },
    { fen: 'start', difficulty: 'hard' },
    { fen: '4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1', difficulty: 'hard' },
    { fen: play(['g1f3', 'g8f6'], new Chess().fen()).fen(), historyStartFen: new Chess().fen(), history: ['g1f3', 'g8f6'], historyTruncated: true, difficulty: 'hard' },
    { fen: play(['g1f3'], '4k3/8/8/8/8/8/8/4K1N1 w - - 0 1').fen(), historyStartFen: '4k3/8/8/8/8/8/8/4K1N1 w - - 0 1', history: ['g1f3'], historyTruncated: false, difficulty: 'hard' },
  ];
  for (const input of inputs) {
    const reference = createIndependentPosition(input);
    const game = input.history ? play(input.history, input.historyStartFen) : new Chess(input.fen === 'start' ? undefined : input.fen);
    const position = kernelPositionFromInput(input, game);
    assert.deepEqual([position.toFen(), position.repetitionStatus, position.hasCompleteHistory, position.repetitionCount],
      [reference.toFen(), reference.repetitionStatus, reference.hasCompleteHistory, reference.repetitionCount], JSON.stringify(input));
  }
  // The previous own move comes from the request, not from chess.js history.
  const random = seeded(9);
  const game = new Chess();
  const history: string[] = [];
  for (let ply = 0; ply < 160 && !game.isGameOver(); ply += 1) {
    const moves = game.moves({ verbose: true });
    const captures = moves.filter((m) => m.captured || m.promotion);
    const move = captures.length && random() < 0.5 ? captures[Math.floor(random() * captures.length)] : moves[Math.floor(random() * moves.length)];
    game.move(move);
    history.push(`${move.from}${move.to}${move.promotion ?? ''}`);
    const expected = getLastMoveByColor(game, game.turn());
    const position = kernelPositionFromInput({ fen: game.fen(), history, difficulty: 'hard' }, game);
    const actual = previousOwnMoveFromHistory(position, history);
    if (!expected) { assert.equal(actual, null); continue; }
    assert.equal(actual?.from, squareFromAlgebraic(expected.from));
    assert.equal(actual?.to, squareFromAlgebraic(expected.to));
    // A captured piece cannot move back, so only a piece still standing on its square matters.
    if (game.get(expected.to)?.color === game.turn()) assert.equal(actual?.piece, ' pnbrqk'.indexOf(expected.piece), `${expected.san}`);
  }
  const original = Chess.prototype.history;
  let replays = 0;
  Chess.prototype.history = function (this: Chess, ...args: Parameters<Chess['history']>) {
    replays += 1;
    return original.apply(this, args);
  } as Chess['history'];
  try {
    const input = { fen: play(RUY_LOPEZ).fen(), history: RUY_LOPEZ, difficulty: 'expert', timeLimitMs: 50 };
    const root = play(RUY_LOPEZ);
    replays = 0;
    assert.ok(searchKernelMove(root, input, resolveAiTuning({ openingBookEnabled: false })));
  } finally {
    Chess.prototype.history = original;
  }
  assert.equal(replays, 0, 'chess.js history() calls inside the kernel stage');
});

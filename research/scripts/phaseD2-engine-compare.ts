import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import fs from 'node:fs/promises';
import { Chess, type Move } from 'chess.js';
import { getBestMove, getLastSearchDiagnostics } from '../../src/utils/chessAI';
import { StockfishWasmAdapter } from '../../src/workers/stockfishWasmAdapter';
import type { AiTuning } from '../../src/utils/chessAI';

type Scenario = {
  name: string;
  fen: string;
};

type TacticalCase = {
  name: string;
  fen: string;
  validate: (move: string | null, game: Chess) => boolean;
};

type Sample = {
  engine: 'ts' | 'stockfish-wasm';
  scenario: string;
  move: string | null;
  elapsedMs: number;
  depth?: number;
  nodes?: number;
  qNodes?: number;
};

const RUNS = 2;
const MOVE_TIME_MS = 700;

const TS_OVERRIDES: Partial<AiTuning> = {
  openingBookEnabled: false,
  hardBand: 1,
  hardCandidateCap: 1,
  hardOpeningBand: 1,
  hardOpeningFallbackBand: 1,
};

const SCENARIOS: Scenario[] = [
  { name: 'Complex-Midgame', fen: 'r2q1rk1/pp2bppp/2np1n2/2p1p3/2P1P3/2NP1NP1/PP2PPBP/R1BQ1RK1 w - - 0 10' },
  { name: 'King-Safety-Shield', fen: '6k1/3q4/8/8/8/8/3Q1PPP/3R1RK1 w - - 0 1' },
  { name: 'King-Exposure', fen: '6k1/8/8/4q3/8/8/3QP3/4K3 w - - 0 1' },
  { name: 'QSearch-Recapture', fen: '2k5/8/8/3p4/4b3/8/3R4/2K5 w - - 0 1' },
  { name: 'Passed-Pawn-Race', fen: '7k/8/P7/8/8/7p/8/K7 w - - 0 1' },
  { name: 'Promotion-Case', fen: '6k1/4P3/8/8/8/K7/8/8 w - - 0 1' },
];

const applyEngineMove = (game: Chess, move: string | null): Move | null => {
  if (!move) return null;
  const uci = move.trim();
  if (/^[a-h][1-8][a-h][1-8][qrbn]?$/i.test(uci)) {
    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);
    const promotion = uci.length === 5 ? uci.slice(4).toLowerCase() : undefined;
    return game.move({ from, to, promotion: promotion as 'q' | 'r' | 'b' | 'n' | undefined });
  }
  return game.move(move);
};

const TACTICAL_CASES: TacticalCase[] = [
  {
    name: 'Mate-In-One',
    fen: '7k/5Q2/6K1/8/8/8/8/8 w - - 0 1',
    validate: (move, game) => {
      const next = new Chess(game.fen());
      const applied = applyEngineMove(next, move);
      return Boolean(applied && next.isCheckmate());
    },
  },
  {
    name: 'Forced-King-Capture',
    fen: '6k1/8/8/8/8/8/5q2/6K1 w - - 0 1',
    validate: (move, game) => {
      const next = new Chess(game.fen());
      const applied = applyEngineMove(next, move);
      return Boolean(applied && applied.from === 'g1' && applied.to === 'f2');
    },
  },
  {
    name: 'Promote-Passed-Pawn',
    fen: '6k1/4P3/8/8/8/K7/8/8 w - - 0 1',
    validate: (move, game) => {
      const next = new Chess(game.fen());
      const applied = applyEngineMove(next, move);
      return Boolean(applied && applied.isPromotion());
    },
  },
  {
    name: 'Avoid-Rook-Blunder',
    fen: '2k5/8/8/3p4/4b3/8/3R4/2K5 w - - 0 1',
    validate: (move) => {
      if (!move) return false;
      const normalized = move.toLowerCase();
      return normalized !== 'rxd5' && normalized !== 'd2d5';
    },
  },
];

const average = (values: number[]): number => (values.length === 0 ? 0 : values.reduce((sum, v) => sum + v, 0) / values.length);

const percentile = (values: number[], p: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
};

const patchNodeFetchForStockfish = (): (() => void) => {
  const nativeFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (path.isAbsolute(url)) {
      const buf = await fs.readFile(url);
      return new Response(buf, {
        status: 200,
        headers: { 'content-type': 'application/wasm' },
      });
    }
    if (url.startsWith('file://')) {
      const buf = await fs.readFile(new URL(url));
      return new Response(buf, {
        status: 200,
        headers: { 'content-type': 'application/wasm' },
      });
    }
    return nativeFetch(input, init);
  };
  return () => {
    globalThis.fetch = nativeFetch;
  };
};

const benchmarkTs = (): Sample[] => {
  const samples: Sample[] = [];
  for (let run = 0; run < RUNS; run += 1) {
    for (const scenario of SCENARIOS) {
      const game = new Chess(scenario.fen);
      const t0 = performance.now();
      const move = getBestMove(game, 'expert', TS_OVERRIDES, MOVE_TIME_MS);
      const elapsedMs = performance.now() - t0;
      const diag = getLastSearchDiagnostics();
      samples.push({
        engine: 'ts',
        scenario: scenario.name,
        move,
        elapsedMs,
        depth: diag.completedDepth,
        nodes: diag.nodes,
        qNodes: diag.qNodes,
      });
    }
  }
  return samples;
};

const benchmarkStockfish = async (): Promise<Sample[]> => {
  const restoreFetch = patchNodeFetchForStockfish();
  const adapter = new StockfishWasmAdapter({ initTimeoutMs: 12000 });
  const samples: Sample[] = [];
  try {
    await adapter.init();
    for (let run = 0; run < RUNS; run += 1) {
      for (const scenario of SCENARIOS) {
        const t0 = performance.now();
        const move = await adapter.computeBestMove({
          fen: scenario.fen,
          difficulty: 'expert',
          timeLimitMs: MOVE_TIME_MS,
        });
        const elapsedMs = performance.now() - t0;
        samples.push({
          engine: 'stockfish-wasm',
          scenario: scenario.name,
          move,
          elapsedMs,
        });
      }
    }
  } finally {
    adapter.dispose();
    restoreFetch();
  }
  return samples;
};

const tacticalTs = (): { passed: number; total: number; details: string[] } => {
  let passed = 0;
  const details: string[] = [];
  for (const tc of TACTICAL_CASES) {
    const game = new Chess(tc.fen);
    const move = getBestMove(game, 'expert', TS_OVERRIDES, MOVE_TIME_MS);
    const ok = tc.validate(move, game);
    if (ok) passed += 1;
    details.push(`${tc.name}: ${ok ? 'pass' : `fail (move=${move ?? 'null'})`}`);
  }
  return { passed, total: TACTICAL_CASES.length, details };
};

const tacticalStockfish = async (): Promise<{ passed: number; total: number; details: string[] }> => {
  const restoreFetch = patchNodeFetchForStockfish();
  const adapter = new StockfishWasmAdapter({ initTimeoutMs: 12000 });
  let passed = 0;
  const details: string[] = [];
  try {
    await adapter.init();
    for (const tc of TACTICAL_CASES) {
      const game = new Chess(tc.fen);
      const move = await adapter.computeBestMove({
        fen: tc.fen,
        difficulty: 'expert',
        timeLimitMs: MOVE_TIME_MS,
      });
      const ok = tc.validate(move, game);
      if (ok) passed += 1;
      details.push(`${tc.name}: ${ok ? 'pass' : `fail (move=${move ?? 'null'})`}`);
    }
  } finally {
    adapter.dispose();
    restoreFetch();
  }
  return { passed, total: TACTICAL_CASES.length, details };
};

const summarize = (samples: Sample[]) => {
  const elapsed = samples.map(s => s.elapsedMs);
  return {
    samples: samples.length,
    avgMs: average(elapsed),
    p50Ms: percentile(elapsed, 50),
    p95Ms: percentile(elapsed, 95),
    avgDepth: average(samples.map(s => s.depth ?? 0)),
    avgNodes: average(samples.map(s => s.nodes ?? 0)),
    avgQNodes: average(samples.map(s => s.qNodes ?? 0)),
  };
};

const pct = (before: number, after: number): string => {
  if (before === 0) return 'n/a';
  const delta = ((after - before) / before) * 100;
  return `${delta >= 0 ? '+' : ''}${delta.toFixed(2)}%`;
};

const main = async (): Promise<void> => {
  const nodeVersion = process.version;
  const cpu = os.cpus()[0]?.model ?? 'unknown';
  const cores = os.cpus().length;
  const platform = `${os.platform()} ${os.release()}`;

  const tsSamples = benchmarkTs();
  const sfSamples = await benchmarkStockfish();
  const tsTactical = tacticalTs();
  const sfTactical = await tacticalStockfish();

  const tsSummary = summarize(tsSamples);
  const sfSummary = summarize(sfSamples);

  const rows = [
    ['Metric', 'TypeScript Engine', 'stockfish.wasm', 'Delta (stockfish vs TS)'],
    ['Samples', String(tsSummary.samples), String(sfSummary.samples), '-'],
    ['Avg ms', tsSummary.avgMs.toFixed(2), sfSummary.avgMs.toFixed(2), pct(tsSummary.avgMs, sfSummary.avgMs)],
    ['P50 ms', tsSummary.p50Ms.toFixed(2), sfSummary.p50Ms.toFixed(2), pct(tsSummary.p50Ms, sfSummary.p50Ms)],
    ['P95 ms', tsSummary.p95Ms.toFixed(2), sfSummary.p95Ms.toFixed(2), pct(tsSummary.p95Ms, sfSummary.p95Ms)],
    ['Avg depth (TS only)', tsSummary.avgDepth.toFixed(2), '-', '-'],
    ['Avg nodes (TS only)', tsSummary.avgNodes.toFixed(0), '-', '-'],
    ['Avg qNodes (TS only)', tsSummary.avgQNodes.toFixed(0), '-', '-'],
  ];
  const table = rows.map(r => `| ${r.join(' | ')} |`).join('\n');

  const report = [
    '# Phase D2 Engine Comparison (TypeScript vs stockfish.wasm)',
    '',
    `- Date: ${new Date().toISOString()}`,
    `- Node: ${nodeVersion}`,
    `- Platform: ${platform}`,
    `- CPU: ${cpu} (${cores} cores)`,
    `- Runs per scenario/engine: ${RUNS}`,
    `- Scenario count: ${SCENARIOS.length}`,
    `- Move time limit: ${MOVE_TIME_MS}ms`,
    '',
    '## Performance',
    '',
    table,
    '',
    '## Tactical Smoke',
    '',
    `### TypeScript Engine (${tsTactical.passed}/${tsTactical.total})`,
    ...tsTactical.details.map(d => `- ${d}`),
    '',
    `### stockfish.wasm (${sfTactical.passed}/${sfTactical.total})`,
    ...sfTactical.details.map(d => `- ${d}`),
    '',
    '## Notes',
    '',
    '- For TS engine, opening book and move randomness were disabled for deterministic benchmarking.',
    '- stockfish.wasm benchmarking under Node uses a local fetch patch for absolute/file URLs so package assets can be loaded from `node_modules`.',
    '- stockfish.wasm outputs UCI moves; TS engine outputs SAN. Tactical validation normalizes both forms by applying moves on `chess.js`.',
    '',
  ].join('\n');

  const outDir = path.resolve('research');
  mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `phaseD2-engine-compare-${new Date().toISOString().slice(0, 10)}.md`);
  writeFileSync(outPath, report, 'utf8');
  process.stdout.write(`${outPath}\n`);
};

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});

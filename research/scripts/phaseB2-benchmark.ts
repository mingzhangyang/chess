import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { Chess } from 'chess.js';
import { getBestMove, getLastSearchDiagnostics } from '../../src/utils/chessAI';
import type { AiTuning } from '../../src/utils/chessAI';

type Scenario = {
  name: string;
  fen: string;
};

type Sample = {
  config: string;
  scenario: string;
  move: string | null;
  elapsedMs: number;
  nodes: number;
  qNodes: number;
  depth: number;
  nullMoveAttempts: number;
  nullMoveCuts: number;
  rfpPrunes: number;
  fpPrunes: number;
  lmpPrunes: number;
};

type TacticalCase = {
  name: string;
  fen: string;
  validate: (move: string | null, game: Chess) => boolean;
};

const SCENARIOS: Scenario[] = [
  { name: 'QSearch-Recapture', fen: '2k5/8/8/3p4/4b3/8/3R4/2K5 w - - 0 1' },
  { name: 'King-Centralization', fen: '8/p7/8/8/8/8/P7/K6k w - - 0 1' },
  { name: 'Passed-Pawn-Promotion', fen: '6k1/4P3/8/8/8/K7/8/8 w - - 0 1' },
  { name: 'Passed-Pawn-Race', fen: '7k/8/P7/8/8/7p/8/K7 w - - 0 1' },
  { name: 'King-Safety-Shield', fen: '6k1/3q4/8/8/8/8/3Q1PPP/3R1RK1 w - - 0 1' },
  { name: 'King-Exposure', fen: '6k1/8/8/4q3/8/8/3QP3/4K3 w - - 0 1' },
  { name: 'Mate-In-One', fen: '7k/5Q2/6K1/8/8/8/8/8 w - - 0 1' },
  { name: 'Complex-Midgame', fen: 'r2q1rk1/pp2bppp/2np1n2/2p1p3/2P1P3/2NP1NP1/PP2PPBP/R1BQ1RK1 w - - 0 10' },
];

const TACTICAL_CASES: TacticalCase[] = [
  {
    name: 'Mate-In-One',
    fen: '7k/5Q2/6K1/8/8/8/8/8 w - - 0 1',
    validate: (move, game) => {
      if (!move) return false;
      const next = new Chess(game.fen());
      const applied = next.move(move);
      return Boolean(applied && next.isCheckmate());
    },
  },
  {
    name: 'Avoid-Rook-Blunder',
    fen: '2k5/8/8/3p4/4b3/8/3R4/2K5 w - - 0 1',
    validate: (move) => move !== 'Rxd5',
  },
  {
    name: 'Promote-Passed-Pawn',
    fen: '6k1/4P3/8/8/8/K7/8/8 w - - 0 1',
    validate: (move) => move === 'e8=Q+',
  },
  {
    name: 'Passed-Pawn-Race',
    fen: '7k/8/P7/8/8/7p/8/K7 w - - 0 1',
    validate: (move) => move === 'a7',
  },
];

const BASE_SEARCH_OVERRIDES: Partial<AiTuning> = {
  openingBookEnabled: false,
  hardBand: 1,
  hardCandidateCap: 1,
  hardOpeningBand: 1,
  hardOpeningFallbackBand: 1,
};

const PHASE_A_B1_OVERRIDES: Partial<AiTuning> = {
  ...BASE_SEARCH_OVERRIDES,
  enableNmpStaticGuard: true,
  nmpStaticGuardMargin: 120,
  enableQDelta: true,
  qDeltaMargin: 120,
  enableRfp: true,
  rfpDepthLimit: 2,
  rfpMarginBase: 120,
  rfpMarginPerDepth: 60,
  enableFp: true,
  fpDepthLimit: 2,
  fpMarginBase: 120,
  fpMarginPerDepth: 80,
  enableLmp: true,
  lmpDepthLimit: 3,
  lmpMoveCountBase: 6,
  lmpMoveCountPerDepth: 2,
  lmpEvalMarginBase: 180,
  lmpEvalMarginPerDepth: 90,
  enableLmrTable: true,
};

const PHASE_A_B1_B2_OVERRIDES: Partial<AiTuning> = {
  ...PHASE_A_B1_OVERRIDES,
  enableHistoryMalus: true,
  enableCountermove: true,
};

const CONFIGS = [
  { name: 'phaseA+B1', overrides: PHASE_A_B1_OVERRIDES },
  { name: 'phaseA+B1+B2', overrides: PHASE_A_B1_B2_OVERRIDES },
] as const;

const RUNS = 3;
const TIME_LIMIT_MS = 500;

const average = (xs: number[]): number => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);

const median = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
};

const runBench = (): {
  samples: Sample[];
  tacticalSummary: Record<string, { passed: number; total: number; details: string[] }>;
} => {
  const samples: Sample[] = [];
  const tacticalSummary: Record<string, { passed: number; total: number; details: string[] }> = {};

  for (const cfg of CONFIGS) {
    for (let run = 0; run < RUNS; run += 1) {
      for (const scenario of SCENARIOS) {
        const game = new Chess(scenario.fen);
        const t0 = performance.now();
        const move = getBestMove(game, 'hard', cfg.overrides, TIME_LIMIT_MS);
        const elapsedMs = performance.now() - t0;
        const diag = getLastSearchDiagnostics();

        samples.push({
          config: cfg.name,
          scenario: scenario.name,
          move,
          elapsedMs,
          nodes: diag.nodes,
          qNodes: diag.qNodes,
          depth: diag.completedDepth,
          nullMoveAttempts: diag.nullMoveAttempts,
          nullMoveCuts: diag.nullMoveCuts,
          rfpPrunes: diag.rfpPrunes,
          fpPrunes: diag.fpPrunes,
          lmpPrunes: diag.lmpPrunes,
        });
      }
    }

    let passed = 0;
    const details: string[] = [];
    for (const tc of TACTICAL_CASES) {
      const game = new Chess(tc.fen);
      const move = getBestMove(game, 'hard', cfg.overrides, TIME_LIMIT_MS);
      const ok = tc.validate(move, game);
      if (ok) passed += 1;
      details.push(`${tc.name}: ${ok ? 'pass' : `fail (move=${move ?? 'null'})`}`);
    }
    tacticalSummary[cfg.name] = {
      passed,
      total: TACTICAL_CASES.length,
      details,
    };
  }

  return { samples, tacticalSummary };
};

const summarizeByConfig = (samples: Sample[]) => {
  const grouped = new Map<string, Sample[]>();
  for (const s of samples) {
    if (!grouped.has(s.config)) grouped.set(s.config, []);
    grouped.get(s.config)!.push(s);
  }

  const summary: Record<string, Record<string, number>> = {};
  for (const [config, rows] of grouped.entries()) {
    const elapsed = rows.map(r => r.elapsedMs);
    const nodes = rows.map(r => r.nodes);
    const qNodes = rows.map(r => r.qNodes);
    const depths = rows.map(r => r.depth);
    const totalNodes = nodes.reduce((a, b) => a + b, 0);
    const totalQNodes = qNodes.reduce((a, b) => a + b, 0);

    summary[config] = {
      samples: rows.length,
      avgMs: average(elapsed),
      medianMs: median(elapsed),
      avgNodes: average(nodes),
      avgQNodes: average(qNodes),
      qNodeRatio: totalNodes > 0 ? totalQNodes / totalNodes : 0,
      avgDepth: average(depths),
      avgNullMoveAttempts: average(rows.map(r => r.nullMoveAttempts)),
      avgNullMoveCuts: average(rows.map(r => r.nullMoveCuts)),
      avgRfpPrunes: average(rows.map(r => r.rfpPrunes)),
      avgFpPrunes: average(rows.map(r => r.fpPrunes)),
      avgLmpPrunes: average(rows.map(r => r.lmpPrunes)),
    };
  }
  return summary;
};

const pct = (before: number, after: number): string => {
  if (before === 0) return 'n/a';
  const delta = ((after - before) / before) * 100;
  return `${delta >= 0 ? '+' : ''}${delta.toFixed(2)}%`;
};

const resolveGitInfo = (): { branch: string; commit: string } => {
  try {
    const head = readFileSync(path.resolve('.git/HEAD'), 'utf8').trim();
    if (!head.startsWith('ref:')) {
      return { branch: 'detached', commit: head.slice(0, 7) };
    }
    const ref = head.slice(5).trim();
    const branch = ref.split('/').at(-1) ?? 'unknown';
    const commit = readFileSync(path.resolve('.git', ref), 'utf8').trim().slice(0, 7);
    return { branch, commit };
  } catch {
    return { branch: 'unknown', commit: 'unknown' };
  }
};

const main = (): void => {
  const { branch, commit } = resolveGitInfo();
  const nodeVersion = process.version;
  const cpu = os.cpus()[0]?.model ?? 'unknown';
  const cores = os.cpus().length;
  const platform = `${os.platform()} ${os.release()}`;

  const { samples, tacticalSummary } = runBench();
  const summary = summarizeByConfig(samples);
  const phaseAB1 = summary['phaseA+B1'];
  const phaseAB1B2 = summary['phaseA+B1+B2'];

  const rows = [
    ['Metric', 'PhaseA+B1', 'PhaseA+B1+B2', 'Delta (B2 vs PhaseA+B1)'],
    ['Samples', String(phaseAB1.samples), String(phaseAB1B2.samples), '-'],
    ['Avg ms', phaseAB1.avgMs.toFixed(2), phaseAB1B2.avgMs.toFixed(2), pct(phaseAB1.avgMs, phaseAB1B2.avgMs)],
    ['Median ms', phaseAB1.medianMs.toFixed(2), phaseAB1B2.medianMs.toFixed(2), pct(phaseAB1.medianMs, phaseAB1B2.medianMs)],
    ['Avg nodes', phaseAB1.avgNodes.toFixed(0), phaseAB1B2.avgNodes.toFixed(0), pct(phaseAB1.avgNodes, phaseAB1B2.avgNodes)],
    ['Avg qNodes', phaseAB1.avgQNodes.toFixed(0), phaseAB1B2.avgQNodes.toFixed(0), pct(phaseAB1.avgQNodes, phaseAB1B2.avgQNodes)],
    ['qNode ratio', phaseAB1.qNodeRatio.toFixed(4), phaseAB1B2.qNodeRatio.toFixed(4), pct(phaseAB1.qNodeRatio, phaseAB1B2.qNodeRatio)],
    ['Avg depth', phaseAB1.avgDepth.toFixed(2), phaseAB1B2.avgDepth.toFixed(2), pct(phaseAB1.avgDepth, phaseAB1B2.avgDepth)],
    ['Avg RFP prunes', phaseAB1.avgRfpPrunes.toFixed(2), phaseAB1B2.avgRfpPrunes.toFixed(2), pct(phaseAB1.avgRfpPrunes, phaseAB1B2.avgRfpPrunes)],
    ['Avg FP prunes', phaseAB1.avgFpPrunes.toFixed(2), phaseAB1B2.avgFpPrunes.toFixed(2), pct(phaseAB1.avgFpPrunes, phaseAB1B2.avgFpPrunes)],
    ['Avg LMP prunes', phaseAB1.avgLmpPrunes.toFixed(2), phaseAB1B2.avgLmpPrunes.toFixed(2), pct(phaseAB1.avgLmpPrunes, phaseAB1B2.avgLmpPrunes)],
  ];

  const table = rows.map(r => `| ${r.join(' | ')} |`).join('\n');
  const tacticalLines = CONFIGS.map((cfg) => {
    const t = tacticalSummary[cfg.name];
    return [
      `### ${cfg.name}`,
      `- Passed: ${t.passed}/${t.total}`,
      ...t.details.map(d => `- ${d}`),
    ].join('\n');
  }).join('\n\n');

  const report = [
    '# Phase B2 Benchmark Report',
    '',
    `- Date: ${new Date().toISOString()}`,
    `- Branch: ${branch}`,
    `- Commit: ${commit}`,
    `- Node: ${nodeVersion}`,
    `- Platform: ${platform}`,
    `- CPU: ${cpu} (${cores} cores)`,
    `- Scenarios: ${SCENARIOS.length}`,
    `- Runs per scenario/config: ${RUNS}`,
    `- Time limit per move: ${TIME_LIMIT_MS}ms`,
    '',
    '## Aggregate Metrics',
    '',
    table,
    '',
    '## Tactical Smoke Check',
    '',
    tacticalLines,
    '',
    '## Notes',
    '',
    '- PhaseA+B1: A1-A4 + B1 enabled.',
    '- PhaseA+B1+B2: `enableHistoryMalus=true`, `enableCountermove=true` on top of B1.',
    '- All runs use search-only configuration (opening book disabled).',
  ].join('\n');

  const outDir = path.resolve('research');
  mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'phaseB2-benchmark-2026-03-03.md');
  writeFileSync(outFile, report, 'utf8');

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ summary, tacticalSummary, outFile }, null, 2));
};

main();

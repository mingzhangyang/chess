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
};

type TacticalCase = {
  name: string;
  fen: string;
  validate: (move: string | null, game: Chess) => boolean;
};

const SCENARIOS: Scenario[] = [
  { name: 'Rook-Behind-Passed-Pawn', fen: '7k/8/4P3/8/8/8/8/4R1K1 w - - 0 1' },
  { name: 'King-Safety-Shield', fen: '6k1/3q4/8/8/8/8/3Q1PPP/3R1RK1 w - - 0 1' },
  { name: 'King-Exposure', fen: '6k1/8/8/4q3/8/8/3QP3/4K3 w - - 0 1' },
  { name: 'QSearch-Recapture', fen: '2k5/8/8/3p4/4b3/8/3R4/2K5 w - - 0 1' },
  { name: 'Passed-Pawn-Promotion', fen: '6k1/4P3/8/8/8/K7/8/8 w - - 0 1' },
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
    name: 'Preserve-Shield',
    fen: '6k1/3q4/8/8/8/8/3Q1PPP/3R1RK1 w - - 0 1',
    validate: (move) => Boolean(move && !['g3', 'h3', 'f3'].includes(move)),
  },
  {
    name: 'Promote-Passed-Pawn',
    fen: '6k1/4P3/8/8/8/K7/8/8 w - - 0 1',
    validate: (move) => move === 'e8=Q+',
  },
];

const BASE_SEARCH_OVERRIDES: Partial<AiTuning> = {
  openingBookEnabled: false,
  hardBand: 1,
  hardCandidateCap: 1,
  hardOpeningBand: 1,
  hardOpeningFallbackBand: 1,
};

const C1_C21_C22_OVERRIDES: Partial<AiTuning> = {
  ...BASE_SEARCH_OVERRIDES,
  enableNmpStaticGuard: true,
  enableQDelta: true,
  enableRfp: true,
  enableFp: true,
  enableLmp: true,
  enableLmrTable: true,
  enableHistoryMalus: true,
  enableCountermove: true,
  enableTaperedEval: true,
  enableNonlinearKingSafety: true,
  enableBackwardPawn: true,
  enableKnightOutpost: true,
  enablePassedPawnKingDistance: true,
  enableRookBehindPassedPawn: false,
};

const C1_C21_C22_C23_C24_C25_OVERRIDES: Partial<AiTuning> = {
  ...C1_C21_C22_OVERRIDES,
  enableRookBehindPassedPawn: true,
};

const CONFIGS = [
  { name: 'c1+c2.1+c2.2+c2.3+c2.4', overrides: C1_C21_C22_OVERRIDES },
  { name: 'c1+c2.1+c2.2+c2.3+c2.4+c2.5', overrides: C1_C21_C22_C23_C24_C25_OVERRIDES },
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
    tacticalSummary[cfg.name] = { passed, total: TACTICAL_CASES.length, details };
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
    if (!head.startsWith('ref:')) return { branch: 'detached', commit: head.slice(0, 7) };
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
  const base = summary['c1+c2.1+c2.2+c2.3+c2.4'];
  const c25 = summary['c1+c2.1+c2.2+c2.3+c2.4+c2.5'];

  const rows = [
    ['Metric', 'C1+C2.1+C2.2+C2.3+C2.4', 'C1+C2.1+C2.2+C2.3+C2.4+C2.5', 'Delta (C2.5 vs C2.4)'],
    ['Samples', String(base.samples), String(c25.samples), '-'],
    ['Avg ms', base.avgMs.toFixed(2), c25.avgMs.toFixed(2), pct(base.avgMs, c25.avgMs)],
    ['Median ms', base.medianMs.toFixed(2), c25.medianMs.toFixed(2), pct(base.medianMs, c25.medianMs)],
    ['Avg nodes', base.avgNodes.toFixed(0), c25.avgNodes.toFixed(0), pct(base.avgNodes, c25.avgNodes)],
    ['Avg qNodes', base.avgQNodes.toFixed(0), c25.avgQNodes.toFixed(0), pct(base.avgQNodes, c25.avgQNodes)],
    ['qNode ratio', base.qNodeRatio.toFixed(4), c25.qNodeRatio.toFixed(4), pct(base.qNodeRatio, c25.qNodeRatio)],
    ['Avg depth', base.avgDepth.toFixed(2), c25.avgDepth.toFixed(2), pct(base.avgDepth, c25.avgDepth)],
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
    '# Phase C2.5 Benchmark Report',
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
    '- C1+C2.1+C2.2+C2.3+C2.4: nonlinear king safety + backward pawn + knight outpost + passed pawn king-distance enabled.',
    '- C1+C2.1+C2.2+C2.3+C2.4+C2.5: rook behind passed pawn enabled on top of C2.4.',
    '- All runs use search-only configuration (opening book disabled).',
  ].join('\n');

  const outDir = path.resolve('research');
  mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'phaseC25-benchmark-2026-03-03.md');
  writeFileSync(outFile, report, 'utf8');

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ summary, tacticalSummary, outFile }, null, 2));
};

main();

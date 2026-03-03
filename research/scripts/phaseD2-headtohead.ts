import fs from 'node:fs/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { Chess } from 'chess.js';
import { getBestMove, getLastSearchDiagnostics } from '../../src/utils/chessAI';
import { StockfishWasmAdapter } from '../../src/workers/stockfishWasmAdapter';
import type { AiTuning } from '../../src/utils/chessAI';

type EngineKey = 'ts' | 'stockfish';
type Color = 'w' | 'b';

type Opening = {
  name: string;
  sanMoves: string[];
};

type GameResult = '1-0' | '0-1' | '1/2-1/2';

type GameRecord = {
  id: string;
  opening: string;
  stockfishColor: Color;
  result: GameResult;
  reason: string;
  plyCount: number;
  tsMoveCount: number;
  sfMoveCount: number;
  tsTimeMs: number;
  sfTimeMs: number;
  tsNodes: number;
  tsQNodes: number;
};

const parsePositiveInt = (value: string | undefined, fallback: number): number => {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const MOVE_TIME_MS = parsePositiveInt(process.env.H2H_MOVE_MS, 180);
const MAX_PLIES = parsePositiveInt(process.env.H2H_MAX_PLIES, 80);
const ROUNDS_PER_OPENING = parsePositiveInt(process.env.H2H_ROUNDS_PER_OPENING, 1);

const TS_OVERRIDES: Partial<AiTuning> = {
  openingBookEnabled: false,
  hardBand: 1,
  hardCandidateCap: 1,
  hardOpeningBand: 1,
  hardOpeningFallbackBand: 1,
};

const OPENINGS: Opening[] = [
  {
    name: 'Start Position',
    sanMoves: [],
  },
  {
    name: 'Ruy Lopez',
    sanMoves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6'],
  },
  {
    name: 'Queen Gambit Declined',
    sanMoves: ['d4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6'],
  },
  {
    name: 'Sicilian Najdorf Setup',
    sanMoves: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6'],
  },
  {
    name: 'English Four Knights',
    sanMoves: ['c4', 'e5', 'Nc3', 'Nf6', 'Nf3', 'Nc6'],
  },
  {
    name: 'King Indian Structure',
    sanMoves: ['d4', 'Nf6', 'c4', 'g6', 'Nc3', 'Bg7'],
  },
];
const OPENING_LIMIT = parsePositiveInt(process.env.H2H_OPENING_LIMIT, OPENINGS.length);

const applyEngineMove = (game: Chess, move: string | null): boolean => {
  if (!move) return false;
  const uci = move.trim();
  if (/^[a-h][1-8][a-h][1-8][qrbn]?$/i.test(uci)) {
    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);
    const promotion = uci.length === 5 ? uci.slice(4).toLowerCase() : undefined;
    return Boolean(game.move({ from, to, promotion: promotion as 'q' | 'r' | 'b' | 'n' | undefined }));
  }
  return Boolean(game.move(move));
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

const scoreToElo = (score: number): number => {
  const s = Math.min(0.999, Math.max(0.001, score));
  return -400 * Math.log10((1 / s) - 1);
};

const eloConfidence95 = (score: number, games: number): { lo: number; hi: number } => {
  if (games <= 1) {
    const elo = scoreToElo(score);
    return { lo: elo, hi: elo };
  }
  const s = Math.min(0.999, Math.max(0.001, score));
  const se = Math.sqrt((s * (1 - s)) / games);
  const loScore = Math.max(0.001, s - 1.96 * se);
  const hiScore = Math.min(0.999, s + 1.96 * se);
  return {
    lo: scoreToElo(loScore),
    hi: scoreToElo(hiScore),
  };
};

const average = (values: number[]): number => (values.length === 0 ? 0 : values.reduce((sum, v) => sum + v, 0) / values.length);

const runOneGame = async (
  id: string,
  opening: Opening,
  stockfishColor: Color,
  stockfish: StockfishWasmAdapter,
): Promise<GameRecord> => {
  const game = new Chess();
  for (const san of opening.sanMoves) {
    const ok = game.move(san);
    if (!ok) {
      throw new Error(`invalid-opening-move:${opening.name}:${san}`);
    }
  }

  let tsMoveCount = 0;
  let sfMoveCount = 0;
  let tsTimeMs = 0;
  let sfTimeMs = 0;
  let tsNodes = 0;
  let tsQNodes = 0;
  let reason = 'normal-finish';

  while (!game.isGameOver() && game.history().length < MAX_PLIES) {
    const sideToMove = game.turn() as Color;
    const engine: EngineKey = sideToMove === stockfishColor ? 'stockfish' : 'ts';

    let move: string | null = null;
    if (engine === 'ts') {
      const t0 = performance.now();
      move = getBestMove(game, 'expert', TS_OVERRIDES, MOVE_TIME_MS);
      tsTimeMs += performance.now() - t0;
      tsMoveCount += 1;
      const diag = getLastSearchDiagnostics();
      tsNodes += diag.nodes;
      tsQNodes += diag.qNodes;
    } else {
      const t0 = performance.now();
      try {
        move = await stockfish.computeBestMove({
          fen: game.fen(),
          difficulty: 'expert',
          timeLimitMs: MOVE_TIME_MS,
        });
      } catch (error) {
        reason = `stockfish-compute-error:${error instanceof Error ? error.message : String(error)}`;
        return {
          id,
          opening: opening.name,
          stockfishColor,
          result: stockfishColor === 'w' ? '0-1' : '1-0',
          reason,
          plyCount: game.history().length,
          tsMoveCount,
          sfMoveCount,
          tsTimeMs,
          sfTimeMs,
          tsNodes,
          tsQNodes,
        };
      }
      sfTimeMs += performance.now() - t0;
      sfMoveCount += 1;
    }

    const applied = applyEngineMove(game, move);
    if (!applied) {
      reason = `${engine}-illegal-or-null:${move ?? 'null'}`;
      return {
        id,
        opening: opening.name,
        stockfishColor,
        result: engine === 'stockfish'
          ? (stockfishColor === 'w' ? '0-1' : '1-0')
          : (stockfishColor === 'w' ? '1-0' : '0-1'),
        reason,
        plyCount: game.history().length,
        tsMoveCount,
        sfMoveCount,
        tsTimeMs,
        sfTimeMs,
        tsNodes,
        tsQNodes,
      };
    }
  }

  let result: GameResult;
  if (game.isCheckmate()) {
    const winner = game.turn() === 'w' ? 'b' : 'w';
    result = winner === 'w' ? '1-0' : '0-1';
    reason = 'checkmate';
  } else if (game.isStalemate() || game.isInsufficientMaterial() || game.isThreefoldRepetition() || game.isDrawByFiftyMoves()) {
    result = '1/2-1/2';
    reason = 'draw-rule';
  } else {
    result = '1/2-1/2';
    reason = `adjudicated-max-plies-${MAX_PLIES}`;
  }

  return {
    id,
    opening: opening.name,
    stockfishColor,
    result,
    reason,
    plyCount: game.history().length,
    tsMoveCount,
    sfMoveCount,
    tsTimeMs,
    sfTimeMs,
    tsNodes,
    tsQNodes,
  };
};

const main = async (): Promise<void> => {
  const cpu = os.cpus()[0]?.model ?? 'unknown';
  const cores = os.cpus().length;
  const platform = `${os.platform()} ${os.release()}`;

  const restoreFetch = patchNodeFetchForStockfish();
  const stockfish = new StockfishWasmAdapter({ initTimeoutMs: 15000 });
  const games: GameRecord[] = [];

  try {
    await stockfish.init();
    let gameIndex = 1;
    const selectedOpenings = OPENINGS.slice(0, OPENING_LIMIT);
    const plannedGames = selectedOpenings.length * ROUNDS_PER_OPENING * 2;
    process.stdout.write(
      `planned_games=${plannedGames} move_ms=${MOVE_TIME_MS} max_plies=${MAX_PLIES} openings=${selectedOpenings.length} rounds=${ROUNDS_PER_OPENING}\n`,
    );
    for (const opening of selectedOpenings) {
      for (let round = 1; round <= ROUNDS_PER_OPENING; round += 1) {
        const gameWhite = await runOneGame(`G${gameIndex++}`, opening, 'w', stockfish);
        games.push(gameWhite);
        process.stdout.write(
          `[${games.length}/${plannedGames}] ${gameWhite.id} ${opening.name} SF:w result=${gameWhite.result} reason=${gameWhite.reason}\n`,
        );
        const gameBlack = await runOneGame(`G${gameIndex++}`, opening, 'b', stockfish);
        games.push(gameBlack);
        process.stdout.write(
          `[${games.length}/${plannedGames}] ${gameBlack.id} ${opening.name} SF:b result=${gameBlack.result} reason=${gameBlack.reason}\n`,
        );
      }
    }
  } finally {
    stockfish.dispose();
    restoreFetch();
  }

  let sfWins = 0;
  let tsWins = 0;
  let draws = 0;
  for (const g of games) {
    const sfIsWhite = g.stockfishColor === 'w';
    if (g.result === '1/2-1/2') {
      draws += 1;
    } else if ((g.result === '1-0' && sfIsWhite) || (g.result === '0-1' && !sfIsWhite)) {
      sfWins += 1;
    } else {
      tsWins += 1;
    }
  }

  const totalGames = games.length;
  const sfScore = (sfWins + 0.5 * draws) / totalGames;
  const elo = scoreToElo(sfScore);
  const ci = eloConfidence95(sfScore, totalGames);

  const tsTimePerMove = average(games.map(g => (g.tsMoveCount > 0 ? g.tsTimeMs / g.tsMoveCount : 0)));
  const sfTimePerMove = average(games.map(g => (g.sfMoveCount > 0 ? g.sfTimeMs / g.sfMoveCount : 0)));
  const tsNodesPerMove = average(games.map(g => (g.tsMoveCount > 0 ? g.tsNodes / g.tsMoveCount : 0)));
  const tsQNodesPerMove = average(games.map(g => (g.tsMoveCount > 0 ? g.tsQNodes / g.tsMoveCount : 0)));

  const gameLines = games.map((g) => (
    `| ${g.id} | ${g.opening} | ${g.stockfishColor} | ${g.result} | ${g.reason} | ${g.plyCount} | ${g.tsMoveCount} | ${g.sfMoveCount} | ${g.tsTimeMs.toFixed(0)} | ${g.sfTimeMs.toFixed(0)} |`
  ));

  const report = [
    '# Phase D2 Head-to-Head Quantification (TS vs stockfish.wasm)',
    '',
    `- Date: ${new Date().toISOString()}`,
    `- Platform: ${platform}`,
    `- CPU: ${cpu} (${cores} cores)`,
    `- Move time per side: ${MOVE_TIME_MS}ms`,
    `- Max plies per game: ${MAX_PLIES}`,
    `- Openings used: ${Math.min(OPENING_LIMIT, OPENINGS.length)} / ${OPENINGS.length} (each played with color swap)`,
    `- Rounds per opening: ${ROUNDS_PER_OPENING}`,
    `- Total games: ${totalGames}`,
    '',
    '## Match Result',
    '',
    `- stockfish.wasm wins: ${sfWins}`,
    `- TypeScript engine wins: ${tsWins}`,
    `- Draws: ${draws}`,
    `- stockfish score: ${(sfScore * 100).toFixed(2)}%`,
    `- Elo estimate (stockfish - TS): ${elo.toFixed(1)}`,
    `- Approx 95% CI: [${ci.lo.toFixed(1)}, ${ci.hi.toFixed(1)}]`,
    '',
    '## Performance Summary',
    '',
    `- TS avg move time: ${tsTimePerMove.toFixed(2)}ms`,
    `- stockfish avg move time: ${sfTimePerMove.toFixed(2)}ms`,
    `- TS avg nodes/move: ${tsNodesPerMove.toFixed(0)}`,
    `- TS avg qNodes/move: ${tsQNodesPerMove.toFixed(0)}`,
    '',
    '## Game Ledger',
    '',
    '| Game | Opening | stockfish color | Result | Reason | Ply | TS moves | SF moves | TS time(ms) | SF time(ms) |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...gameLines,
    '',
    '## Notes',
    '',
    '- This is an in-process Node benchmark using the same machine for both engines.',
    '- TS randomness/book were disabled to keep results reproducible.',
    '- stockfish.wasm asset loading in Node uses local fetch patching for package file paths.',
    '',
  ].join('\n');

  const outDir = path.resolve('research');
  mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `phaseD2-headtohead-${new Date().toISOString().slice(0, 10)}.md`);
  writeFileSync(outPath, report, 'utf8');
  process.stdout.write(`${outPath}\n`);
};

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});

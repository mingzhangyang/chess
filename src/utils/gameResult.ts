// Type-only: the lobby's saved-game module imports this file, and the chess.js
// runtime must stay out of the initial bundle.
import type { Chess } from 'chess.js';
import { hasThreefoldRepetition } from '../../shared/gameRules';

export type PlayerColor = 'w' | 'b';
/** `decisive` is a won game seen by a spectator, who neither won nor lost. */
export type GameOutcome = 'win' | 'loss' | 'draw' | 'decisive';
export type GameEndReason = 'checkmate' | 'stalemate' | 'threefold' | 'insufficient' | 'fiftyMove' | 'draw';

export interface GameResult {
  outcome: GameOutcome;
  reason: GameEndReason;
  winner: PlayerColor | null;
}

type Translate = (key: string, params?: Record<string, string | number>) => string;

const FILES = 'abcdefgh';

/**
 * Whether the current board could equal the position right after the last
 * pawn move with an en-passant right that chess.js hashes but that no legal
 * capture can use. chess.js keeps an en-passant square in its repetition hash
 * whenever an enemy pawn stands next to the pawn that just advanced two
 * squares, even if that pawn is pinned; its FEN (and the engine's position)
 * only include the square when the capture is legal. Only that one position
 * can be miscounted: en-passant squares exist only right after a double pawn
 * push, and pawn moves cannot be undone.
 */
function mayHideUnusableEnPassant(game: Chess): boolean {
  const mover = game.turn();
  const pusher = mover === 'w' ? 'b' : 'w';
  const rank = pusher === 'w' ? 4 : 5;
  const forward = pusher === 'w' ? 1 : -1;
  for (let file = 0; file < 8; file += 1) {
    const square = `${FILES[file]}${rank}` as const;
    const pawn = game.get(square as Parameters<Chess['get']>[0]);
    if (pawn?.type !== 'p' || pawn.color !== pusher) continue;
    const behind = `${FILES[file]}${rank - forward}` as Parameters<Chess['get']>[0];
    const start = `${FILES[file]}${rank - 2 * forward}` as Parameters<Chess['get']>[0];
    if (game.get(behind) || game.get(start)) continue;
    const adjacent = [file - 1, file + 1].some((neighbour) => {
      if (neighbour < 0 || neighbour > 7) return false;
      const piece = game.get(`${FILES[neighbour]}${rank}` as Parameters<Chess['get']>[0]);
      return piece?.type === 'p' && piece.color === mover;
    });
    if (!adjacent) continue;
    // chess.js prints the square only when the capture is legal.
    const fields = game.fen().split(' ');
    fields[3] = behind;
    const Game = game.constructor as new (fen: string) => Chess;
    try {
      if (new Game(fields.join(' ')).fen().split(' ')[3] === '-') return true;
    } catch {
      return true;
    }
  }
  return false;
}

/** The game's positions as chess.js FENs, which carry only usable en-passant squares. */
function fenHistoryOf(game: Chess): string[] {
  const history = game.history({ verbose: true });
  if (history.length === 0) return [game.fen()];
  return [history[0].before, ...history.map((move) => move.after)];
}

/**
 * Threefold repetition as the engine counts it (SearchPosition): placement,
 * side to move, castling rights and an en-passant right only when a legal
 * en-passant capture exists. Pass `fenHistory` when `game` was loaded from a
 * FEN and lacks move history. chess.js's own count is exact except after an
 * unusable en-passant right; only then is the move history replayed.
 */
export function isThreefoldRepetition(game: Chess, fenHistory?: readonly string[]): boolean {
  if (game.isThreefoldRepetition()) return true;
  if (fenHistory !== undefined && hasThreefoldRepetition(game.fen(), fenHistory)) return true;
  return mayHideUnusableEnPassant(game) && hasThreefoldRepetition(game.fen(), fenHistoryOf(game));
}

/** The application's game-over test: checkmate, stalemate, insufficient material, fifty moves or threefold. */
export function isGameOver(game: Chess, fenHistory?: readonly string[]): boolean {
  return game.isGameOver() || isThreefoldRepetition(game, fenHistory);
}

function resolveDrawReason(game: Chess, repeated: boolean): GameEndReason {
  if (game.isStalemate()) return 'stalemate';
  if (game.isInsufficientMaterial()) return 'insufficient';
  if (repeated) return 'threefold';
  if (game.isDrawByFiftyMoves()) return 'fiftyMove';
  return 'draw';
}

/**
 * Describes a finished game from `perspective` (null for spectators).
 * Pass `fenHistory` when `game` was loaded from a FEN and lacks move history.
 */
export function describeGameResult(
  game: Chess,
  perspective: PlayerColor | null,
  fenHistory?: readonly string[],
): GameResult | null {
  const repeated = isThreefoldRepetition(game, fenHistory);
  if (!game.isGameOver() && !repeated) return null;

  if (game.isCheckmate()) {
    // The side to move is the side that has been mated.
    const winner: PlayerColor = game.turn() === 'w' ? 'b' : 'w';
    const outcome: GameOutcome = perspective === null ? 'decisive' : perspective === winner ? 'win' : 'loss';
    return { outcome, reason: 'checkmate', winner };
  }

  return { outcome: 'draw', reason: resolveDrawReason(game, repeated), winner: null };
}

export function formatGameResult(result: GameResult | null, t: Translate): { title: string; subtitle: string } {
  if (!result) return { title: '', subtitle: '' };

  const subtitle = t(`result.reason.${result.reason}`);
  switch (result.outcome) {
    case 'win':
      return { title: t('result.youWon'), subtitle };
    case 'loss':
      return { title: t('result.youLost'), subtitle };
    case 'draw':
      return { title: t('result.draw'), subtitle };
    case 'decisive':
      return {
        title: t('result.sideWins', { winner: result.winner === 'w' ? t('common.white') : t('common.black') }),
        subtitle,
      };
  }
}

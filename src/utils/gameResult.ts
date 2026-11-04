import type { Chess } from 'chess.js';

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

// Placement, side to move, castling and en passant rights: the fields that
// define a position for repetition purposes (move clocks are ignored).
function positionKey(fen: string): string {
  return fen.split(' ').slice(0, 4).join(' ');
}

/**
 * Threefold repetition from a list of FENs. Multiplayer clients only hold a
 * FEN-loaded game, which has no move history for chess.js to check, so they
 * pass the server's synchronized history. The current position is counted
 * even if an optimistic move has not been echoed into the history yet.
 */
export function hasThreefoldRepetition(currentFen: string, fenHistory: readonly string[]): boolean {
  const key = positionKey(currentFen);
  let count = fenHistory.at(-1) === currentFen ? 0 : 1;
  for (const fen of fenHistory) {
    if (positionKey(fen) === key) count += 1;
  }
  return count >= 3;
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
  const repeated = game.isThreefoldRepetition()
    || (fenHistory !== undefined && hasThreefoldRepetition(game.fen(), fenHistory));
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

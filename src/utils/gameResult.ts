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

function resolveDrawReason(game: Chess): GameEndReason {
  if (game.isStalemate()) return 'stalemate';
  if (game.isInsufficientMaterial()) return 'insufficient';
  if (game.isThreefoldRepetition()) return 'threefold';
  if (game.isDrawByFiftyMoves()) return 'fiftyMove';
  return 'draw';
}

/** Describes a finished game from `perspective` (null for spectators). */
export function describeGameResult(game: Chess, perspective: PlayerColor | null): GameResult | null {
  if (!game.isGameOver()) return null;

  if (game.isCheckmate()) {
    // The side to move is the side that has been mated.
    const winner: PlayerColor = game.turn() === 'w' ? 'b' : 'w';
    const outcome: GameOutcome = perspective === null ? 'decisive' : perspective === winner ? 'win' : 'loss';
    return { outcome, reason: 'checkmate', winner };
  }

  return { outcome: 'draw', reason: resolveDrawReason(game), winner: null };
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

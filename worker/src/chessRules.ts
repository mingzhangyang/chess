import { Chess } from 'chess.js';
import { hasThreefoldRepetition } from '../../shared/gameRules';
import type { PlayerColor } from './types';

export interface MoveValidationInput {
  currentFen: string;
  nextFen: unknown;
  role: 'player' | 'spectator';
  color: PlayerColor | null;
  /** The room's position history (current position last), for repetition. */
  fenHistory?: readonly string[];
}

export type MoveValidationResult =
  | { ok: true; nextFen: string }
  | { ok: false; code: 'invalid-fen' | 'spectator-cannot-move' | 'not-your-turn' | 'illegal-move' | 'game-over' };

export function newGameFen(): string {
  return new Chess().fen();
}

export function canonicalFen(fen: string): string | null {
  try {
    return new Chess(fen).fen();
  } catch {
    return null;
  }
}

export function legalTransition(currentFen: string, nextFen: string): boolean {
  const normalizedNextFen = canonicalFen(nextFen);
  if (!normalizedNextFen) {
    return false;
  }

  const game = new Chess(currentFen);
  const legalMoves = game.moves();
  for (const move of legalMoves) {
    game.move(move);
    const legalFen = game.fen();
    game.undo();
    if (legalFen === normalizedNextFen) {
      return true;
    }
  }

  return false;
}

/**
 * Whether the game has ended, using the same rules the clients display:
 * checkmate, stalemate, insufficient material, the 50-move rule, and threefold
 * repetition (which needs the history: a FEN-loaded game has none).
 */
export function isGameFinished(currentFen: string, fenHistory: readonly string[] = []): boolean {
  return new Chess(currentFen).isGameOver() || hasThreefoldRepetition(currentFen, fenHistory);
}

export function validateMove(input: MoveValidationInput): MoveValidationResult {
  const { currentFen, nextFen, role, color, fenHistory } = input;

  if (typeof nextFen !== 'string') {
    return { ok: false, code: 'invalid-fen' };
  }

  if (role !== 'player' || !color) {
    return { ok: false, code: 'spectator-cannot-move' };
  }

  if (isGameFinished(currentFen, fenHistory)) {
    return { ok: false, code: 'game-over' };
  }

  const currentGame = new Chess(currentFen);
  if (currentGame.turn() !== color) {
    return { ok: false, code: 'not-your-turn' };
  }

  if (!legalTransition(currentFen, nextFen)) {
    return { ok: false, code: 'illegal-move' };
  }

  const normalizedFen = canonicalFen(nextFen);
  if (!normalizedFen) {
    return { ok: false, code: 'invalid-fen' };
  }

  return { ok: true, nextFen: normalizedFen };
}

export function canResetGame(role: 'player' | 'spectator'): { ok: true } | { ok: false; code: 'spectator-cannot-reset' } {
  if (role !== 'player') {
    return { ok: false, code: 'spectator-cannot-reset' };
  }
  return { ok: true };
}

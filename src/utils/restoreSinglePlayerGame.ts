import { Chess } from 'chess.js';
import { isGameOver } from './gameResult';
import type { LastMove } from './moveHighlights';
import type { SavedSinglePlayerGame } from './singlePlayerSavedGame';

export interface RestoredSinglePlayerGame {
  game: Chess;
  lastMove: LastMove | null;
  playerColor: 'w' | 'b';
}

/** Replays a saved game; null if any move is illegal or the game is over. */
export function restoreSavedSinglePlayerGame(saved: SavedSinglePlayerGame): RestoredSinglePlayerGame | null {
  const game = new Chess();
  try {
    for (const move of saved.moves) {
      game.move(move);
    }
  } catch {
    return null;
  }
  if (game.history().length === 0 || isGameOver(game)) return null;

  const last = game.history({ verbose: true }).at(-1);
  return {
    game,
    lastMove: last ? { from: last.from, to: last.to } : null,
    playerColor: saved.playerColor,
  };
}

// Pure chess rules shared by the client and the room worker. No chess.js
// import, so it costs nothing in either bundle.

// Placement, side to move, castling and en passant rights: the fields that
// define a position for repetition purposes (move clocks are ignored).
function positionKey(fen: string): string {
  return fen.split(' ').slice(0, 4).join(' ');
}

/**
 * Threefold repetition from a list of FENs, for games whose chess.js instance
 * was loaded from a bare FEN and so has no move history to check. The current
 * position is counted even if it has not been appended to the history yet
 * (an optimistic local move the server has not echoed).
 */
export function hasThreefoldRepetition(currentFen: string, fenHistory: readonly string[]): boolean {
  const key = positionKey(currentFen);
  let count = fenHistory.at(-1) === currentFen ? 0 : 1;
  for (const fen of fenHistory) {
    if (positionKey(fen) === key) count += 1;
  }
  return count >= 3;
}

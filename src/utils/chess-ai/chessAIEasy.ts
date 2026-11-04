import type { Chess } from 'chess.js';
import { generateMoves, isTacticalMove, makeMove, undoMove, type AiMove } from './chessAIBoardOps';
import { PIECE_VALUES } from './chessAIEvaluation';

// Easy should play imperfectly, not choose among moves that hang a queen or
// other piece for almost no compensation. Allow small (up to 1.5 pawn) losses.
export const EASY_MAX_IMMEDIATE_LOSS = 150;

const moveMaterialGain = (move: AiMove): number => {
  const captured = move.captured ?? (move.isEnPassant() ? 'p' : undefined);
  const capturedValue = captured ? PIECE_VALUES[captured] : 0;
  const promotionGain = move.isPromotion()
    ? PIECE_VALUES[move.promotion ?? 'q'] - PIECE_VALUES.p
    : 0;
  return capturedValue + promotionGain;
};

/**
 * Worst material swing after a candidate move and one legal opponent tactical
 * reply. Credit only immediate *legal* recaptures on the captured square, so
 * defended queen trades are allowed but pinned or absent defenders do not
 * make a hanging queen look safe. This is a safety floor, not a full search.
 */
export const scoreEasyMoveSafety = (game: Chess, candidate: AiMove): number => {
  const gain = moveMaterialGain(candidate);
  let worstSwing = gain;
  makeMove(game, candidate);
  try {
    for (const reply of generateMoves(game)) {
      if (!isTacticalMove(reply)) continue;
      const replyGain = moveMaterialGain(reply);
      const swingBeforeRecapture = gain - replyGain;
      if (swingBeforeRecapture >= worstSwing) continue;
      // Small losses cannot disqualify a move; avoid generating expensive
      // recapture moves just to refine their harmless material difference.
      if (swingBeforeRecapture >= -EASY_MAX_IMMEDIATE_LOSS) {
        worstSwing = swingBeforeRecapture;
        continue;
      }

      makeMove(game, reply);
      let bestRecapture = 0;
      try {
        for (const recapture of generateMoves(game)) {
          if ((recapture.isCapture() || recapture.isEnPassant()) && recapture.to === reply.to) {
            bestRecapture = Math.max(bestRecapture, moveMaterialGain(recapture));
          }
        }
      } finally {
        undoMove(game);
      }
      worstSwing = Math.min(worstSwing, swingBeforeRecapture + bestRecapture);
    }
  } finally {
    undoMove(game);
  }
  return worstSwing;
};

/** Keep random variety among safe moves; if every move loses material, lose as little as possible. */
export const pickEasyMove = (game: Chess, moves: AiMove[]): AiMove => {
  const scored = moves.map((move) => ({ move, score: scoreEasyMoveSafety(game, move) }));
  const safe = scored.filter(({ score }) => score >= -EASY_MAX_IMMEDIATE_LOSS);
  const best = Math.max(...scored.map(({ score }) => score));
  const pool = safe.length > 0 ? safe : scored.filter(({ score }) => score === best);
  return pool[Math.floor(Math.random() * pool.length)].move;
};

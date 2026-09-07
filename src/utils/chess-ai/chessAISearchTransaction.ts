import {
  beginMoveHeuristicTransaction,
  commitMoveHeuristicTransaction,
  discardMoveHeuristicTransaction,
} from './chessAIMoveHeuristics';
import { beginTTTransaction, commitTTTransaction, discardTTTransaction } from './chessAITranspositionTable';
import { checkSearchDeadline } from './chessAISearchTiming';

export const beginSearchTransaction = (): void => {
  beginMoveHeuristicTransaction();
  beginTTTransaction();
};

export const commitSearchTransaction = (): boolean => {
  // Search hints are optional, so abandon the whole transaction if the root
  // depth completed after the budget. The bounded buffers make the flush below
  // predictable; the post-flush check stops the next depth if the flush itself
  // crosses the deadline.
  if (checkSearchDeadline()) {
    discardSearchTransaction();
    return false;
  }
  commitMoveHeuristicTransaction();
  commitTTTransaction();
  checkSearchDeadline();
  return true;
};

export const discardSearchTransaction = (): void => {
  discardMoveHeuristicTransaction();
  discardTTTransaction();
};

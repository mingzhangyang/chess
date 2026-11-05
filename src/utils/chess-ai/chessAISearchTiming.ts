import { searchState } from './chessAISearchDiagnostics';

let searchDeadline = Infinity;
let cancellationCheck: (() => boolean) | undefined;

export const setSearchDeadline = (deadline: number): void => {
  searchDeadline = deadline;
};

/** Synchronous internal test hook, reset when the experimental search exits. */
export const setSearchCancellationCheck = (check?: () => boolean): void => { cancellationCheck = check; };

export const checkSearchDeadline = (): boolean => {
  if (searchState.searchAborted) {
    return true;
  }

  if (cancellationCheck?.() || performance.now() >= searchDeadline) {
    searchState.searchAborted = true;
    return true;
  }

  return false;
};

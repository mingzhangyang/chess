import { searchState } from './chessAISearchDiagnostics';

let searchDeadline = Infinity;

export const setSearchDeadline = (deadline: number): void => {
  searchDeadline = deadline;
};

export const checkSearchDeadline = (): boolean => {
  if (searchState.searchAborted) {
    return true;
  }

  if (performance.now() >= searchDeadline) {
    searchState.searchAborted = true;
    return true;
  }

  return false;
};

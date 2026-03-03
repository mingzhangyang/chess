export interface SearchDiagnostics {
  nodes: number;
  qNodes: number;
  completedDepth: number;
  searchAborted: boolean;
  nullMoveAttempts: number;
  nullMoveCuts: number;
  rfpPrunes: number;
  fpPrunes: number;
  lmpPrunes: number;
}

const EMPTY_SEARCH_DIAGNOSTICS: SearchDiagnostics = {
  nodes: 0,
  qNodes: 0,
  completedDepth: 0,
  searchAborted: false,
  nullMoveAttempts: 0,
  nullMoveCuts: 0,
  rfpPrunes: 0,
  fpPrunes: 0,
  lmpPrunes: 0,
};

let lastSearchDiagnostics: SearchDiagnostics = { ...EMPTY_SEARCH_DIAGNOSTICS };

export const searchState = {
  searchAborted: false,
  nodeCount: 0,
  qNodeCount: 0,
  nullMoveAttemptCount: 0,
  nullMoveCutCount: 0,
  rfpPruneCount: 0,
  fpPruneCount: 0,
  lmpPruneCount: 0,
};

export const resetSearchCounters = (): void => {
  searchState.nodeCount = 0;
  searchState.qNodeCount = 0;
  searchState.nullMoveAttemptCount = 0;
  searchState.nullMoveCutCount = 0;
  searchState.rfpPruneCount = 0;
  searchState.fpPruneCount = 0;
  searchState.lmpPruneCount = 0;
};

export const commitSearchDiagnostics = (completedDepth: number): void => {
  lastSearchDiagnostics = {
    nodes: searchState.nodeCount,
    qNodes: searchState.qNodeCount,
    completedDepth,
    searchAborted: searchState.searchAborted,
    nullMoveAttempts: searchState.nullMoveAttemptCount,
    nullMoveCuts: searchState.nullMoveCutCount,
    rfpPrunes: searchState.rfpPruneCount,
    fpPrunes: searchState.fpPruneCount,
    lmpPrunes: searchState.lmpPruneCount,
  };
};

export const getLastSearchDiagnostics = (): SearchDiagnostics => ({ ...lastSearchDiagnostics });

// Default-off switch for the independent TS search kernel. Read by the
// single-player hook for each request; no chess.js or engine code here.
export type TsSearchKernel = 'independent';

export const TS_SEARCH_KERNEL_STORAGE_KEY = 'chess:ai-ts-kernel';
const URL_PARAMETER = 'aiKernel';

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/**
 * `?aiKernel=independent` turns the kernel on for this browser and
 * `?aiKernel=default` turns it off again; otherwise the stored choice applies.
 * Anything else, or blocked storage, leaves the production search in place.
 */
export function resolveTsSearchKernel(search: string, storage: StorageLike | null): TsSearchKernel | undefined {
  let requested: string | null = null;
  try {
    requested = new URLSearchParams(search).get(URL_PARAMETER);
  } catch {
    requested = null;
  }
  if (requested === 'independent') {
    try { storage?.setItem(TS_SEARCH_KERNEL_STORAGE_KEY, 'independent'); } catch { /* still applies to this request */ }
    return 'independent';
  }
  if (requested === 'default') {
    try { storage?.removeItem(TS_SEARCH_KERNEL_STORAGE_KEY); } catch { /* nothing stored */ }
    return undefined;
  }
  try {
    return storage?.getItem(TS_SEARCH_KERNEL_STORAGE_KEY) === 'independent' ? 'independent' : undefined;
  } catch {
    return undefined;
  }
}

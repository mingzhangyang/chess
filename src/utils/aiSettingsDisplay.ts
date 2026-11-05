/** Descriptive scale for advanced AI controls; the numeric engine values stay unchanged. */
export type SettingLevel = 'low' | 'medium' | 'high';

export function getSettingLevel(value: number, max: number): SettingLevel {
  if (value < max / 3) return 'low';
  if (value < (max * 2) / 3) return 'medium';
  return 'high';
}

/** Stockfish still receives milliseconds; only the settings label uses seconds. */
export function formatThinkTimeSeconds(milliseconds: number): string {
  return (milliseconds / 1000).toFixed(1);
}

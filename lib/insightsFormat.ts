// Tiny shared formatters for the Analyse page's metric cards — kept separate from
// insightsThemes/insightsSignals/insightsDiscovery/insightsAts/insightsFunnel so those
// modules don't each reinvent "how do I show 'not enough data'."

export const NO_DATA = '—';

export function formatPercent(ratio: number): string {
  return `${Math.round(ratio * 100)} %`;
}

export function formatDays(days: number): string {
  return days < 1 ? '< 1 j' : `${Math.round(days)} j`;
}

export function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function mean(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

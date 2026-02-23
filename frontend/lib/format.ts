/**
 * Format large numbers in compact human-readable form.
 * 1000 → "1K", 1500000 → "1.5M", 98202301000 → "98.2B"
 */
export function formatCompactNumber(value: number): string {
  if (value >= 1_000_000_000) {
    const v = value / 1_000_000_000;
    return v % 1 === 0 ? `${v}B` : `${v.toFixed(1)}B`;
  }
  if (value >= 1_000_000) {
    const v = value / 1_000_000;
    return v % 1 === 0 ? `${v}M` : `${v.toFixed(1)}M`;
  }
  if (value >= 1_000) {
    const v = value / 1_000;
    return v % 1 === 0 ? `${v}K` : `${v.toFixed(1)}K`;
  }
  return value.toString();
}

/**
 * Format basis points as a percentage string.
 * 5001 → "50.0%", 6667 → "66.7%"
 */
export function formatPercent(bps: number): string {
  return (bps / 100).toFixed(1) + "%";
}

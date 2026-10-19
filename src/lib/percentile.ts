/**
 * The one percentile method every Hamilton screen uses (#2048): mid-rank. A price's percentile is
 * the share of peers charging less, plus half the share charging the same, so ties split evenly
 * and a price shared by every peer sits at the 50th. Prices within half a cent count as the same;
 * a caller ranking ratios or rates passes `tolerance: 0`, since half a cent of a fraction is not a
 * rounding difference. Pure, so the browser and the server compute the same figure.
 */
export const PERCENTILE_METHOD = "Percentile: the share of peers charging less, plus half of those charging the same.";

export const SAME_PRICE_TOLERANCE = 0.005;

/** Mid-rank percentile, 0 to 100, to `decimals` places; null with no peers. */
export function midRankPercentile(
  value: number,
  peers: readonly number[],
  { decimals = 0, tolerance = SAME_PRICE_TOLERANCE }: { decimals?: number; tolerance?: number } = {},
): number | null {
  if (!Number.isFinite(value) || peers.length === 0) return null;
  let below = 0;
  let same = 0;
  for (const p of peers) {
    if (Math.abs(p - value) <= tolerance) same++;
    else if (p < value) below++;
  }
  const scale = 10 ** decimals;
  return Math.round(((below + same / 2) / peers.length) * 100 * scale) / scale;
}

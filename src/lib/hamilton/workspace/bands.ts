import type { PriceBand } from "./types";

/** A $0 band, then fixed-width bands sized to the prices, so two banks' spreads read the same way. */
export function priceBands(amounts: number[], current: number | null): PriceBand[] {
  if (amounts.length === 0) return [];
  const max = Math.max(...amounts, current ?? 0);
  const step = max <= 10 ? 2 : max <= 50 ? 5 : max <= 100 ? 10 : 25;
  const bands: PriceBand[] = [{ label: "$0", min: 0, max: 0.005, count: 0 }];
  for (let lo = 0; lo < max + step; lo += step) {
    bands.push({ label: `$${lo === 0 ? "0.01" : lo} to $${lo + step}`, min: lo === 0 ? 0.005 : lo, max: lo + step, count: 0 });
  }
  for (const amount of amounts) {
    const band = bands.find((b) => amount >= b.min && (b.max === null || amount < b.max));
    if (band) band.count++;
  }
  const last = bands.map((b) => b.count > 0).lastIndexOf(true);
  return bands.slice(0, Math.max(last + 1, 1));
}

/** Reading the Model screen's link: the prices to test and the bank's own figures. */

export const MAX_TESTED_PRICES = 4;

/** "0, 25, 37.50" → [0, 25, 37.5]. Drops anything that isn't a price, keeps order, no repeats. */
export function parsePrices(value: string | null | undefined): number[] {
  if (!value) return [];
  const out: number[] = [];
  for (const part of value.split(/[\s,]+/)) {
    const n = Number(part.replace(/^\$/, ""));
    if (part === "" || !Number.isFinite(n) || n < 0 || n > 10000) continue;
    const rounded = Math.round(n * 100) / 100;
    if (!out.includes(rounded)) out.push(rounded);
    if (out.length === MAX_TESTED_PRICES) break;
  }
  return out;
}

export function parseCount(value: string | null | undefined): number | null {
  if (!value) return null;
  const n = Number(value.replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

/** A waiver rate typed as a percent ("12" or "12%"), returned as a share 0 to 1. */
export function parsePercent(value: string | null | undefined): number | null {
  if (!value) return null;
  const n = Number(value.replace(/%$/, ""));
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n / 100 : null;
}

/** Starting prices when none are chosen: no fee, the market middle, and five dollars above today. */
export function defaultPrices(current: number | null, layerMedian: number | null): number[] {
  const out = [0];
  if (layerMedian != null) out.push(Math.round(layerMedian * 100) / 100);
  if (current != null) out.push(current + 5);
  return [...new Set(out)].filter((p) => p !== current);
}

/**
 * A working estimate of items charged a year from the bank's own filing: the filed income line
 * for the fee divided by today's price. Only for a line that carries this fee alone (a credit
 * union's overdraft or NSF line), never a bank's combined overdraft-and-NSF line. Assumes every
 * paid item was charged today's fee; shown only when the reader asks for it.
 */
export function filedVolumeEstimate(
  line: { annualIncome: number; combinedWith?: string } | null | undefined,
  current: number | null,
): number | null {
  if (!line || line.combinedWith || current == null || current <= 0 || line.annualIncome <= 0) return null;
  const items = line.annualIncome / current;
  return items >= 10_000 ? Math.round(items / 1000) * 1000 : Math.round(items);
}

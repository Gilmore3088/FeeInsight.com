/**
 * Pure helpers shared by the Hamilton dashboard kit: number formats named by a string (so a server
 * component can pass a format to a client component as a plain prop) and the one rule that places a
 * fee against a group. Client-safe: no server imports.
 */

/** How a figure prints. Every kit component takes one of these instead of a format function. */
export type FigureFormat =
  /** A fee: "$35", "$7.95", "$1,250". */
  | "money"
  /** A large dollar figure, whole dollars in: "$22.9M", "$4.45B", "$812K". */
  | "dollars"
  /** A percent with two decimals: "1.53%". */
  | "percent"
  /** A percent with one decimal: "64.7%". */
  | "percent1"
  | "count";

export const DASH = "—";

export function formatFigure(value: number | null | undefined, format: FigureFormat): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return DASH;
  switch (format) {
    case "money":
      return Number.isInteger(value)
        ? `$${value.toLocaleString("en-US")}`
        : `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    case "dollars": {
      const abs = Math.abs(value);
      const sign = value < 0 ? "−" : "";
      if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
      if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
      if (abs >= 1e3) return `${sign}$${Math.round(abs / 1e3).toLocaleString("en-US")}K`;
      return `${sign}$${Math.round(abs).toLocaleString("en-US")}`;
    }
    case "percent":
      return `${value.toFixed(2)}%`;
    case "percent1":
      return `${value.toFixed(1)}%`;
    case "count":
      return value.toLocaleString("en-US");
  }
}

/** A signed fee difference: "+$10", "−$2.50", "$0". */
export function signedMoney(value: number): string {
  if (Math.abs(value) < 0.005) return "$0";
  return `${value > 0 ? "+" : "−"}${formatFigure(Math.abs(value), "money")}`;
}

/** Where a fee sits against a group's prices. `too_few` when the group is too small for a band. */
export type FeePosition = "above" | "in_range" | "below" | "too_few";

export const POSITION_MARK: Record<FeePosition, string> = { above: "▲", in_range: "●", below: "▼", too_few: "○" };

export const POSITION_LABEL: Record<FeePosition, string> = {
  above: "Above",
  in_range: "In range",
  below: "Below",
  too_few: "Too few to compare",
};

/**
 * Above the middle half (over the 75th percentile), below it (under the 25th) or within it. A row
 * with no band (fewer institutions publish the fee than a median needs) is `too_few`, never placed.
 */
export function feePosition(yours: number, band: { p25: number | null; p75: number | null }): FeePosition {
  if (band.p25 === null || band.p75 === null) return "too_few";
  if (yours > band.p75) return "above";
  if (yours < band.p25) return "below";
  return "in_range";
}

/** "2026-06-30" to "Q2 2026". */
export function quarterLabel(reportDate: string): string {
  const month = Number(reportDate.slice(5, 7));
  return `Q${Math.ceil(month / 3)} ${reportDate.slice(0, 4)}`;
}

/** "2026-06-30" to "Q2 26", for a chart axis. */
export function shortQuarterLabel(reportDate: string): string {
  const month = Number(reportDate.slice(5, 7));
  return `Q${Math.ceil(month / 3)} ${reportDate.slice(2, 4)}`;
}

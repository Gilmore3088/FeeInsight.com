import { formatCompactDollars } from "@/lib/format";

export type CountUnit = "dollars" | "percent" | "count";

/**
 * A card figure's text. Key figures are drawn still: the first paint is the final number, so a
 * screenshot, a print or a slow device never catches a partial or zero value.
 */
export function formatCardFigure(unit: CountUnit, n: number): string {
  if (unit === "dollars") return formatCompactDollars(n);
  if (unit === "percent") return `${n.toFixed(1)}%`;
  return Math.round(n).toLocaleString("en-US");
}

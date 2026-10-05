/**
 * The Briefing's "three things worth your attention": the fees where the bank sits furthest from
 * its benchmark, written as observations. Deterministic and neutral: it says where the bank sits
 * and how far from the middle, never whether to change anything.
 */
import type { InstitutionPositioning } from "./institution-position";

export interface BriefingObservation {
  feeCategory: string;
  feeName: string;
  headline: string;
  detail: string;
  yourAmount: number;
  benchmarkMedian: number;
  benchmarkCount: number;
}

/** Display names carry abbreviations like "Overdraft (OD)"; prose reads better without them. */
export function plainFeeName(displayName: string): string {
  return displayName.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

export function money(amount: number): string {
  return Number.isInteger(amount) ? `$${amount}` : `$${amount.toFixed(2)}`;
}

export function buildBriefingObservations(
  positioning: InstitutionPositioning | null,
  limit = 3,
): BriefingObservation[] {
  if (!positioning) return [];
  return positioning.entries
    .filter((e) => e.gapPct != null && e.gapAmount !== 0 && e.benchmarkMedian > 0)
    .sort((a, b) => Math.abs(b.gapPct!) - Math.abs(a.gapPct!))
    .slice(0, limit)
    .map((e) => {
      const name = plainFeeName(e.displayName);
      const pct = Math.round(Math.abs(e.gapPct!));
      const side = e.gapAmount > 0 ? "above" : "below";
      return {
        feeCategory: e.feeCategory,
        feeName: name,
        headline: `${name}: ${money(e.yourAmount)} against a median of ${money(e.benchmarkMedian)}`,
        detail: `${pct}% ${side} the middle of ${positioning.benchmarkLabel} (${e.benchmarkCount} institutions).`,
        yourAmount: e.yourAmount,
        benchmarkMedian: e.benchmarkMedian,
        benchmarkCount: e.benchmarkCount,
      };
    });
}

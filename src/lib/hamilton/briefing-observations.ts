/**
 * The Briefing's "three things worth your attention": the fees where the bank sits furthest from
 * its benchmark, written as observations. Deterministic and neutral: it says where the bank sits
 * and how far from the middle, never whether to change anything.
 */
import { STRONG_INSTITUTION_COUNT } from "@/lib/data-store/maturity";
import type { InstitutionPositioning } from "./institution-position";
import { STANDARD_METHOD, type AuditTrail } from "./audit-trail";

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
    // Comparisons against a full peer group come first, so the lead items are the most defensible.
    .sort(
      (a, b) =>
        Number(b.benchmarkCount >= STRONG_INSTITUTION_COUNT) - Number(a.benchmarkCount >= STRONG_INSTITUTION_COUNT) ||
        Math.abs(b.gapPct!) - Math.abs(a.gapPct!),
    )
    .slice(0, limit)
    .map((e) => {
      const name = plainFeeName(e.displayName);
      const pct = Math.round(Math.abs(e.gapPct!));
      const side = e.gapAmount > 0 ? "above" : "below";
      return {
        feeCategory: e.feeCategory,
        feeName: name,
        headline: `${name}: ${money(e.yourAmount)} against a median of ${money(e.benchmarkMedian)}`,
        detail:
          `${pct}% ${side} the median of your peer group (${positioning.benchmarkLabel}), ${e.benchmarkCount} institutions` +
          (e.benchmarkCount < STRONG_INSTITUTION_COUNT ? ", a small group, so read with care." : "."),
        yourAmount: e.yourAmount,
        benchmarkMedian: e.benchmarkMedian,
        benchmarkCount: e.benchmarkCount,
      };
    });
}

/** The Briefing's trail: what the observations compare against and how they were chosen. */
export function briefingAuditTrail(positioning: InstitutionPositioning, now = new Date()): AuditTrail {
  return {
    evidence: "Market data only",
    sources: [
      {
        label: "Your published fees",
        detail: `${positioning.ownFeeCount} fees from ${positioning.institutionName}'s own fee schedule, in Bank Fee Index.`,
        asOf: null,
      },
      {
        label: "Peer group",
        detail:
          positioning.benchmarkSource === "saved-peer-set"
            ? `${positioning.benchmarkLabel}: your saved peer set.`
            : positioning.benchmarkSource === "national"
              ? `${positioning.benchmarkLabel}: every institution nationally, because too few comparable institutions publish these fees.`
              : `${positioning.benchmarkLabel}: comparable institutions by charter, asset size, state and Fed district, widened only when too few publish a fee.`,
        asOf: null,
      },
    ],
    method: [
      ...STANDARD_METHOD,
      `Items are the fees furthest from the peer median in percent terms. Comparisons against at least ${STRONG_INSTITUTION_COUNT} institutions come first; smaller groups are flagged.`,
    ],
    assumptions: ["None. Observations describe where your fees sit; they don't say whether to change them. Open Research for each fee's dated sources."],
    ownFeeRows: [],
    preparedAt: now.toISOString(),
  };
}

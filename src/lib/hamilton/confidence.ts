/**
 * Hamilton Confidence Tiers — data quality gates for simulation.
 *
 * Confidence tiers are snapshot values stored on hamilton_scenarios at creation
 * time (D-04). They do not auto-update if underlying data improves later.
 *
 * Tiers follow the statistics contract (src/lib/data-store/fee-stats.ts): they count
 * distinct institutions, not fee rows, so a simulation badge never disagrees with the
 * index maturity shown everywhere else. Insufficient tier BLOCKS simulation (D-06).
 */

// maturity.ts, not fee-stats.ts: this module is imported by client components.
import { MIN_INSTITUTIONS_FOR_MEDIAN, maturityTier } from "@/lib/data-store/maturity";

/** The three confidence tiers for simulation data quality */
export const CONFIDENCE_TIERS = ["strong", "provisional", "insufficient"] as const;
export type ConfidenceTier = (typeof CONFIDENCE_TIERS)[number];

/** Confidence for a fee category from the number of distinct institutions behind it. */
export function computeConfidenceTier(institutionCount: number): ConfidenceTier {
  return maturityTier(institutionCount);
}

/**
 * Check whether a simulation can proceed for the given tier (D-06).
 * Insufficient tier BLOCKS simulation entirely.
 */
export function canSimulate(
  tier: ConfidenceTier
): { allowed: true } | { allowed: false; reason: string } {
  if (tier === "insufficient") {
    return {
      allowed: false,
      reason: `Simulation blocked: fewer than ${MIN_INSTITUTIONS_FOR_MEDIAN} institutions publish this fee. At least ${MIN_INSTITUTIONS_FOR_MEDIAN} are required for a defensible median.`,
    };
  }
  return { allowed: true };
}

const TIER_LABEL: Record<ConfidenceTier, string> = {
  strong: "Strong data",
  provisional: "Provisional data",
  insufficient: "Insufficient data",
};

/**
 * The grounding line under a simulation: the tier and the data actually behind it,
 * so the label changes with the peer set instead of always claiming the same sources.
 */
export function describeSimulationBasis(
  tier: ConfidenceTier,
  institutionCount: number,
  peerLabel?: string | null
): string {
  const institutions = `${institutionCount.toLocaleString("en-US")} institution${institutionCount === 1 ? "" : "s"}`;
  const peers = peerLabel ? ` (${peerLabel})` : "";
  return `${TIER_LABEL[tier]}: published fee schedules from ${institutions}${peers}.`;
}

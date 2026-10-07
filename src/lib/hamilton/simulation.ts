/**
 * Hamilton Simulation Math — client-safe, pure functions.
 * All inputs come from IndexEntry distribution data fetched from the server.
 * No imports from react, next, or server-side modules.
 */

export interface DistributionData {
  fee_category: string;
  median_amount: number;
  p25_amount: number;
  p75_amount: number;
  min_amount: number;
  max_amount: number;
  approved_count: number;
  /** Distinct institutions behind the distribution (the statistics contract's n). */
  institution_count: number;
  peer_label?: string;
  peer_source?: "saved-peer-set" | "selected-institution-default" | "national";
  peer_set_id?: string | null;
  peer_fallback_reason?: string | null;
}

export interface FeePosition {
  /** 0-100, estimated from p25/median/p75 breakpoints via linear interpolation */
  percentile: number;
  /** proposed - median (negative = below median = cost advantage) */
  medianGap: number;
  riskProfile: "low" | "medium" | "high";
}

export interface TradeoffDeltas {
  revenueImpact: { label: string; value: string; note: string };
  riskMitigation: { label: string; value: string; note: string };
  operationalImpact: { label: string; value: string; note: string };
}

// ─── Core Math ───────────────────────────────────────────────────────────────

function lerp(
  pctLow: number,
  pctHigh: number,
  fee: number,
  low: number,
  high: number
): number {
  if (high === low) return pctLow;
  return pctLow + ((fee - low) / (high - low)) * (pctHigh - pctLow);
}

/**
 * Estimate percentile rank using linear interpolation across p25/median/p75 breakpoints.
 * Below p25 → 0–25 range. Between p25/median → 25–50. Between median/p75 → 50–75. Above p75 → 75–100.
 */
export function estimatePercentile(fee: number, dist: DistributionData): number {
  const { min_amount, p25_amount, median_amount, p75_amount, max_amount } = dist;

  if (fee <= min_amount) return 0;
  if (fee >= max_amount) return 100;

  if (fee <= p25_amount) {
    return lerp(0, 25, fee, min_amount, p25_amount);
  }
  if (fee <= median_amount) {
    return lerp(25, 50, fee, p25_amount, median_amount);
  }
  if (fee <= p75_amount) {
    return lerp(50, 75, fee, median_amount, p75_amount);
  }
  return lerp(75, 100, fee, p75_amount, max_amount);
}

/**
 * Classify risk based on percentile position.
 * low: below P50 (below the peer median)
 * medium: P50–P75 (between the median and the 75th percentile)
 * high: P75 and above (in the top quarter of peers)
 */
export function classifyRisk(percentile: number): "low" | "medium" | "high" {
  if (percentile < 50) return "low";
  if (percentile < 75) return "medium";
  return "high";
}

/**
 * Compute fee position (percentile, medianGap, riskProfile) for a given fee amount.
 */
export function computeFeePosition(fee: number, dist: DistributionData): FeePosition {
  const percentile = Math.round(estimatePercentile(fee, dist));
  const medianGap = parseFloat((fee - dist.median_amount).toFixed(2));
  const riskProfile = classifyRisk(percentile);
  return { percentile, medianGap, riskProfile };
}

/**
 * Compute strategic tradeoffs between current and proposed positions.
 * Returns the three tradeoff dimensions shown in StrategicTradeoffs component.
 */
export function computeTradeoffs(
  currentFee: number,
  proposedFee: number,
  current: FeePosition,
  proposed: FeePosition
): TradeoffDeltas {
  const feeChangePct =
    currentFee > 0
      ? (((proposedFee - currentFee) / currentFee) * 100).toFixed(1)
      : "N/A";
  const direction = proposedFee > currentFee ? "+" : "";
  const percentileDelta = proposed.percentile - current.percentile;
  const riskShift =
    proposed.riskProfile !== current.riskProfile
      ? `${current.riskProfile} → ${proposed.riskProfile}`
      : "no change";

  return {
    revenueImpact: {
      // Price only: without volume data this is the change per incident, not revenue.
      label: "Per-incident price change",
      value: `${direction}${feeChangePct}% per incident`,
      note:
        proposedFee > currentFee
          ? "Higher price per incident; total revenue also depends on incident volume"
          : proposedFee < currentFee
          ? "Lower price per incident; total revenue also depends on incident volume"
          : "No price change",
    },
    riskMitigation: {
      label: "Peer position change",
      value: `${percentileDelta > 0 ? "+" : ""}${percentileDelta} percentile points`,
      note:
        percentileDelta < 0
          ? "Moves lower in the peer distribution"
          : percentileDelta > 0
          ? "Moves higher in the peer distribution"
          : "No change in peer position",
    },
    operationalImpact: {
      label: "Peer band",
      value: riskShift,
      note:
        proposed.riskProfile === "low"
          ? "Below the peer median"
          : proposed.riskProfile === "medium"
          ? "Between the peer median and the 75th percentile"
          : "Above the 75th percentile of peers",
    },
  };
}

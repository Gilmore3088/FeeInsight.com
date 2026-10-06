"use client";

import type { ConfidenceTier } from "@/lib/hamilton/confidence";
import type { FeePosition } from "@/lib/hamilton/simulation";

interface Props {
  confidenceTier: ConfidenceTier;
  proposedFee: number;
  proposedPosition: FeePosition;
  median: number;
  p25: number;
}

const TIER_BADGE: Record<
  ConfidenceTier,
  { label: string; bg: string; text: string }
> = {
  strong: {
    label: "STRONG DATA",
    bg: "var(--hamilton-accent)",
    text: "white",
  },
  provisional: {
    label: "PROVISIONAL",
    bg: "rgb(254 243 199)", // amber-100
    text: "rgb(146 64 14)", // amber-800
  },
  insufficient: {
    label: "INSUFFICIENT",
    bg: "rgb(254 226 226)", // red-100
    text: "rgb(153 27 27)", // red-800
  },
};

function formatDollar(v: number): string {
  return `$${v.toFixed(2)}`;
}

export function RecommendedPositionCard({
  confidenceTier,
  proposedFee,
  proposedPosition,
  median,
  p25,
}: Props) {
  // Insufficient tier: do not render (gate is in SimulateWorkspace)
  if (confidenceTier === "insufficient") return null;

  const badge = TIER_BADGE[confidenceTier];
  const belowMedian = proposedFee < median;
  const belowP25 = proposedFee <= p25;
  const gap = Math.abs(proposedFee - median).toFixed(2);

  const positionDescription = belowP25
    ? `bottom quartile (P${proposedPosition.percentile}), ${formatDollar(Number(gap))} below peer median`
    : belowMedian
    ? `below median (P${proposedPosition.percentile}), ${formatDollar(Number(gap))} below peer median`
    : `above median (P${proposedPosition.percentile}), ${formatDollar(Number(gap))} above peer median`;

  // Describes where the price would sit; Hamilton never recommends or cautions against a price.
  const recommendationText = `${formatDollar(proposedFee)} would sit in the ${positionDescription}.`;

  return (
    <div
      className="rounded-lg border p-4 flex flex-col gap-3"
      style={{
        borderColor: "var(--hamilton-border)",
        background: "var(--hamilton-surface-elevated)",
        boxShadow: "var(--hamilton-shadow-card)",
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <h3
          className="text-base font-semibold leading-snug"
          style={{
            fontFamily: "var(--hamilton-font-serif)",
            color: "var(--hamilton-text-primary)",
          }}
        >
          Where this price would sit
        </h3>
        <span
          className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold flex-shrink-0"
          style={{
            background: badge.bg,
            color: badge.text,
          }}
        >
          {badge.label}
        </span>
      </div>

      <p
        className="text-sm leading-relaxed"
        style={{
          fontFamily: "var(--hamilton-font-serif)",
          color: "var(--hamilton-text-primary)",
        }}
      >
        {recommendationText}
      </p>

      {confidenceTier === "provisional" && (
        <p
          className="text-xs rounded-md px-3 py-2"
          style={{
            background: "rgb(255 251 235)", // amber-50
            color: "rgb(146 64 14)", // amber-800
            borderLeft: "3px solid rgb(245 158 11)", // amber-500
          }}
        >
          Based on provisional data (10–19 approved observations). Verify against full peer set
          before board presentation.
        </p>
      )}
    </div>
  );
}

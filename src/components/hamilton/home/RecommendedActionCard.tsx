/**
 * RecommendedActionCard — the one next step on the Briefing, from the selected
 * institution's largest fee gap against its benchmark. Deterministic: no AI involved.
 * Server component — no "use client".
 */

import Link from "next/link";
import { hrefWithInstitutionContext } from "@/lib/hamilton/context-link";
import { formatAmount } from "@/lib/format";
import type { InstitutionPositionEntry } from "@/lib/hamilton/institution-position";

interface RecommendedActionCardProps {
  /** The institution's largest gap from its benchmark median, when it has one. */
  topGap: InstitutionPositionEntry | null;
  benchmarkLabel?: string | null;
  institutionName?: string | null;
  selectedInstitutionId?: string | null;
}

function describeGap(gap: InstitutionPositionEntry, benchmarkLabel: string): string {
  const base = `the ${benchmarkLabel} median of ${formatAmount(gap.benchmarkMedian)} (${gap.benchmarkCount} institutions)`;
  if (gap.gapPct === null || Math.abs(gap.gapPct) < 0.5) return `in line with ${base}`;
  const direction = gap.gapAmount > 0 ? "above" : "below";
  return `${Math.round(Math.abs(gap.gapPct))}% ${direction} ${base}`;
}

export function RecommendedActionCard({
  topGap,
  benchmarkLabel = null,
  institutionName = null,
  selectedInstitutionId = null,
}: RecommendedActionCardProps) {
  const simulateHref = topGap
    ? hrefWithInstitutionContext(
        `/pro/simulate?category=${encodeURIComponent(topGap.feeCategory)}`,
        selectedInstitutionId,
      )
    : null;
  const settingsHref = hrefWithInstitutionContext("/pro/settings", selectedInstitutionId);
  const message = topGap
    ? (
        <>
          Your <strong style={{ fontWeight: 600 }}>{topGap.displayName}</strong> fee (
          {formatAmount(topGap.yourAmount)}) is {describeGap(topGap, benchmarkLabel ?? "benchmark")}. See
          what a change would do to your position.
        </>
      )
    : selectedInstitutionId
      ? `Hamilton has no verified fees for ${institutionName ?? "your institution"} that match a benchmark yet. Add a fee schedule source in Settings to see where you stand.`
      : "Choose your institution in Settings to see where your fees sit against your peers.";

  return (
    <div
      style={{
        padding: "1.5rem 2rem",
        backgroundColor: "var(--hamilton-surface-container-low)",
        borderRadius: "var(--hamilton-radius-lg)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "1.5rem",
        flexWrap: "wrap",
      }}
    >
      <p
        className="font-headline"
        style={{
          fontSize: "1rem",
          fontStyle: "italic",
          lineHeight: 1.5,
          color: "var(--hamilton-on-surface)",
          flex: 1,
          minWidth: "16rem",
          margin: 0,
        }}
      >
        {message}
      </p>

      {simulateHref ? (
        <Link
          href={simulateHref}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            background: "var(--hamilton-gradient-cta)",
            color: "#ffffff",
            fontSize: "0.875rem",
            fontWeight: 600,
            borderRadius: "var(--hamilton-radius-lg)",
            padding: "0.75rem 1.5rem",
            textDecoration: "none",
            flexShrink: 0,
            letterSpacing: "0.01em",
            boxShadow: "var(--hamilton-shadow-card)",
          }}
        >
          Simulate Change
        </Link>
      ) : (
        <Link
          href={settingsHref}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "var(--hamilton-surface-container)",
            color: "var(--hamilton-primary)",
            fontSize: "0.875rem",
            fontWeight: 500,
            borderRadius: "var(--hamilton-radius-lg)",
            padding: "0.75rem 1.5rem",
            textDecoration: "none",
            flexShrink: 0,
            border: "1px solid var(--hamilton-outline-variant)",
          }}
        >
          {selectedInstitutionId ? "Go to Settings" : "Choose institution"}
        </Link>
      )}
    </div>
  );
}

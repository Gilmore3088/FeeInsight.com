/**
 * PositioningEvidence — the national benchmark for the lead spotlight category:
 * median / P25–P75 / maturity. The institution's own position is InstitutionPositionCard.
 * Renders exclusively from the entries prop — no hardcoded defaults.
 * Server component — no "use client".
 */

import Link from "next/link";
import type { PositioningEntry } from "@/lib/hamilton/home-data";
import { hrefWithInstitutionContext } from "@/lib/hamilton/context-link";
import { formatAmount } from "@/lib/format";

interface PositioningEvidenceProps {
  entries: PositioningEntry[];
  selectedInstitutionId?: string | null;
}

const MATURITY_LABELS: Record<string, string> = {
  strong: "Strong Coverage",
  provisional: "Provisional",
  insufficient: "Insufficient Data",
};

const MATURITY_COLORS: Record<string, string> = {
  strong: "var(--hamilton-primary)",
  provisional: "var(--hamilton-on-surface-variant)",
  insufficient: "var(--hamilton-error)",
};

export function PositioningEvidence({
  entries,
  selectedInstitutionId = null,
}: PositioningEvidenceProps) {
  const first = entries[0] ?? null;

  const marketMedian = first?.medianAmount != null ? formatAmount(first.medianAmount) : null;
  const p25 = first?.p25Amount != null ? formatAmount(first.p25Amount) : null;
  const p75 = first?.p75Amount != null ? formatAmount(first.p75Amount) : null;
  const maturityTier = first?.maturityTier ?? null;
  const institutionCount = first?.institutionCount ?? null;
  const distributionHref = first
    ? hrefWithInstitutionContext(
        `/pro/simulate?category=${encodeURIComponent(first.feeCategory)}`,
        selectedInstitutionId,
      )
    : "/pro/simulate";

  return (
    <div
      className="editorial-shadow p-5 sm:p-8"
      style={{
        backgroundColor: "var(--hamilton-surface-container-lowest)",
        borderRadius: "var(--hamilton-radius-lg)",
      }}
    >
      <h3
        className="font-label"
        style={{
          fontSize: "0.625rem",
          fontWeight: 600,
          letterSpacing: "0.2em",
          textTransform: "uppercase",
          color: "var(--hamilton-on-surface-variant)",
          marginBottom: "2rem",
        }}
      >
        National Benchmark
      </h3>

      {entries.length === 0 ? (
        <p
          style={{
            fontSize: "0.875rem",
            lineHeight: 1.6,
            color: "var(--hamilton-on-surface-variant)",
            padding: "2rem 0",
            textAlign: "center",
            margin: 0,
          }}
        >
          The national fee index is unavailable right now.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-3 md:gap-12">
          {/* Market Median */}
          <div className="min-w-0" style={{ display: "flex", flexDirection: "column" }}>
            <span
              className="font-label"
              style={{
                fontSize: "0.625rem",
                fontWeight: 600,
                letterSpacing: "0.2em",
                textTransform: "uppercase",
                color: "var(--hamilton-on-surface-variant)",
                marginBottom: "0.5rem",
              }}
            >
              National Median
            </span>
            <span
              className="font-headline"
              style={{
                fontSize: "2.25rem",
                color: "var(--hamilton-on-surface)",
                letterSpacing: "-0.02em",
                lineHeight: 1,
              }}
            >
              {marketMedian ?? "—"}
            </span>
            {institutionCount != null && (
              <span
                style={{
                  fontSize: "0.75rem",
                  fontWeight: 500,
                  color: "var(--hamilton-on-surface-variant)",
                  marginTop: "0.5rem",
                }}
              >
                {institutionCount} institutions
              </span>
            )}
          </div>

          {/* P25 / P75 Range */}
          <div className="min-w-0" style={{ display: "flex", flexDirection: "column" }}>
            <span
              className="font-label"
              style={{
                fontSize: "0.625rem",
                fontWeight: 600,
                letterSpacing: "0.2em",
                textTransform: "uppercase",
                color: "var(--hamilton-on-surface-variant)",
                marginBottom: "0.5rem",
              }}
            >
              P25 — P75 Range
            </span>
            <span
              className="font-headline"
              style={{
                fontSize: "2.25rem",
                color: "var(--hamilton-on-surface)",
                letterSpacing: "-0.02em",
                lineHeight: 1,
              }}
            >
              {p25 ?? "—"}
            </span>
            {p75 != null && (
              <span
                style={{
                  fontSize: "0.75rem",
                  fontWeight: 500,
                  color: "var(--hamilton-on-surface-variant)",
                  marginTop: "0.5rem",
                }}
              >
                to {p75}
              </span>
            )}
          </div>

          {/* Coverage / Maturity */}
          <div className="min-w-0" style={{ display: "flex", flexDirection: "column" }}>
            <span
              className="font-label"
              style={{
                fontSize: "0.625rem",
                fontWeight: 600,
                letterSpacing: "0.2em",
                textTransform: "uppercase",
                color: "var(--hamilton-on-surface-variant)",
                marginBottom: "0.5rem",
              }}
            >
              Coverage
            </span>
            <span
              className="font-headline"
              style={{
                fontSize: "2.25rem",
                color: "var(--hamilton-on-surface)",
                letterSpacing: "-0.02em",
                lineHeight: 1,
              }}
            >
              {first?.displayName ?? "—"}
            </span>
            {maturityTier != null && (
              <span
                style={{
                  fontSize: "0.75rem",
                  fontWeight: 700,
                  color: MATURITY_COLORS[maturityTier] ?? "var(--hamilton-on-surface-variant)",
                  marginTop: "0.5rem",
                }}
              >
                {MATURITY_LABELS[maturityTier] ?? maturityTier}
              </span>
            )}
          </div>
        </div>
      )}

      {/* View full distribution link — only shown when real data is available */}
      {entries.length > 0 && (
        <div
          style={{
            marginTop: "2rem",
            paddingTop: "1.5rem",
            borderTop: "1px solid rgba(216, 194, 184, 0.2)",
            display: "flex",
            justifyContent: "flex-end",
          }}
        >
          <Link
            href={distributionHref}
            style={{
              fontSize: "0.75rem",
              fontWeight: 700,
              color: "var(--hamilton-primary)",
              textDecoration: "none",
              flexShrink: 0,
            }}
          >
            View full distribution &rarr;
          </Link>
        </div>
      )}
    </div>
  );
}

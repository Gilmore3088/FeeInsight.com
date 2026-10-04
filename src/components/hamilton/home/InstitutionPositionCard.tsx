/**
 * InstitutionPositionCard — the selected institution's fees against its benchmark median,
 * largest gap first, with the sample size and maturity behind every median.
 * Server component — no "use client".
 */

import Link from "next/link";
import { formatAmount } from "@/lib/format";
import { hrefWithInstitutionContext } from "@/lib/hamilton/context-link";
import type { InstitutionPositioning } from "@/lib/hamilton/institution-position";

interface InstitutionPositionCardProps {
  positioning: InstitutionPositioning;
}

const MATURITY_LABELS: Record<string, string> = {
  strong: "strong",
  provisional: "provisional",
  insufficient: "insufficient",
};

function formatGap(gapAmount: number, gapPct: number | null): string {
  if (Math.abs(gapAmount) < 0.005) return "At median";
  const sign = gapAmount > 0 ? "+" : "−";
  const pct = gapPct === null ? "" : ` (${sign}${Math.round(Math.abs(gapPct))}%)`;
  return `${sign}${formatAmount(Math.abs(gapAmount))}${pct}`;
}

const labelStyle = {
  fontSize: "0.625rem",
  fontWeight: 600,
  letterSpacing: "0.2em",
  textTransform: "uppercase" as const,
  color: "var(--hamilton-on-surface-variant)",
};

export function InstitutionPositionCard({ positioning }: InstitutionPositionCardProps) {
  const institutionId = String(positioning.institutionId);
  return (
    <section
      className="editorial-shadow p-5 sm:p-8"
      style={{
        backgroundColor: "var(--hamilton-surface-container-lowest)",
        borderRadius: "var(--hamilton-radius-lg)",
      }}
    >
      <div className="mb-6 flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
        <h3 className="font-label" style={{ ...labelStyle, margin: 0 }}>
          {positioning.institutionName} · Your position
        </h3>
        <span style={{ fontSize: "0.75rem", color: "var(--hamilton-on-surface-variant)" }}>
          Benchmark: {positioning.benchmarkLabel}
        </span>
      </div>

      {positioning.entries.length === 0 ? (
        <p style={{ fontSize: "0.875rem", lineHeight: 1.6, color: "var(--hamilton-on-surface-variant)", margin: 0 }}>
          {positioning.ownFeeCount === 0
            ? "Hamilton has no verified fees for this institution yet, so there is nothing to compare. The national benchmark below still applies."
            : "This institution's verified fees are in categories where the benchmark has too few institutions for a median."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left" style={{ fontSize: "0.875rem", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--hamilton-border)" }}>
                <th scope="col" className="py-2 pr-4 font-label" style={labelStyle}>Fee</th>
                <th scope="col" className="py-2 pr-4 text-right font-label" style={labelStyle}>Yours</th>
                <th scope="col" className="py-2 pr-4 text-right font-label" style={labelStyle}>Median</th>
                <th scope="col" className="py-2 text-right font-label" style={labelStyle}>Gap</th>
              </tr>
            </thead>
            <tbody>
              {positioning.entries.map((entry) => (
                <tr key={entry.feeCategory} style={{ borderBottom: "1px solid rgba(216, 194, 184, 0.2)" }}>
                  <td className="py-3 pr-4">
                    <Link
                      href={hrefWithInstitutionContext(
                        `/pro/simulate?category=${encodeURIComponent(entry.feeCategory)}`,
                        institutionId,
                      )}
                      style={{ color: "var(--hamilton-on-surface)", textDecoration: "none", fontWeight: 500 }}
                    >
                      {entry.displayName}
                    </Link>
                  </td>
                  <td className="py-3 pr-4 text-right tabular-nums" style={{ color: "var(--hamilton-on-surface)" }}>
                    {formatAmount(entry.yourAmount)}
                  </td>
                  <td className="py-3 pr-4 text-right tabular-nums" style={{ color: "var(--hamilton-on-surface)" }}>
                    {formatAmount(entry.benchmarkMedian)}
                    <span className="block" style={{ fontSize: "0.6875rem", color: "var(--hamilton-on-surface-variant)" }}>
                      n={entry.benchmarkCount} · {MATURITY_LABELS[entry.maturityTier] ?? entry.maturityTier}
                    </span>
                  </td>
                  <td
                    className="py-3 text-right tabular-nums"
                    style={{
                      fontWeight: 600,
                      color: entry.gapAmount > 0 ? "var(--hamilton-error)" : "var(--hamilton-on-surface)",
                    }}
                  >
                    {formatGap(entry.gapAmount, entry.gapPct)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

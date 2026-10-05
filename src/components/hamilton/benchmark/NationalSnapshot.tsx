/**
 * NationalSnapshot — the spotlight fee categories nationally: median, middle half and
 * how many institutions stand behind each, drawn on the same range bar as the position chart.
 * Server component — no "use client".
 */

import Link from "next/link";
import { formatAmount } from "@/lib/format";
import { hrefWithInstitutionContext } from "@/lib/hamilton/context-link";
import type { PositioningEntry } from "@/lib/hamilton/home-data";
import { RangeBar } from "./RangeBar";

const COVERAGE_LABELS: Record<PositioningEntry["maturityTier"], string> = {
  strong: "Strong data",
  provisional: "Provisional",
  insufficient: "Thin data",
};

interface NationalSnapshotProps {
  entries: PositioningEntry[];
  totalInstitutions: number;
  selectedInstitutionId?: string | null;
}

export function NationalSnapshot({ entries, totalInstitutions, selectedInstitutionId = null }: NationalSnapshotProps) {
  const rows = entries.filter((e) => e.medianAmount !== null);
  return (
    <section
      className="rounded-xl border"
      style={{ borderColor: "var(--hamilton-outline-variant)", backgroundColor: "var(--hamilton-surface-container-lowest)" }}
    >
      <div className="border-b px-5 py-3" style={{ borderColor: "var(--hamilton-border)" }}>
        <h2 className="text-sm font-semibold" style={{ color: "var(--hamilton-on-surface)", fontFamily: "var(--hamilton-font-sans)" }}>
          National picture
        </h2>
        <p className="text-xs" style={{ color: "var(--hamilton-text-tertiary)" }}>
          {totalInstitutions > 0
            ? `Key fees across ${totalInstitutions.toLocaleString("en-US")} institutions with published fee schedules`
            : "Key fees across every institution with a published fee schedule"}
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="px-5 py-6 text-sm" style={{ color: "var(--hamilton-text-secondary)" }}>
          The national fee index is unavailable right now.
        </p>
      ) : (
        <ul className="divide-y" style={{ borderColor: "var(--hamilton-border)" }}>
          {rows.map((entry) => (
            <li key={entry.feeCategory} className="px-5 py-3">
              <div className="flex items-baseline justify-between gap-3">
                <Link
                  href={hrefWithInstitutionContext(
                    `/pro/simulate?category=${encodeURIComponent(entry.feeCategory)}`,
                    selectedInstitutionId,
                  )}
                  className="min-w-0 truncate text-sm font-medium no-underline hover:underline"
                  style={{ color: "var(--hamilton-on-surface)" }}
                >
                  {entry.displayName}
                </Link>
                <span className="shrink-0 text-sm font-semibold [font-variant-numeric:tabular-nums]" style={{ color: "var(--hamilton-on-surface)" }}>
                  {formatAmount(entry.medianAmount)}
                </span>
              </div>
              <RangeBar
                median={entry.medianAmount as number}
                p25={entry.p25Amount}
                p75={entry.p75Amount}
                label={`${entry.displayName}: national median ${formatAmount(entry.medianAmount)}, middle half ${formatAmount(entry.p25Amount)} to ${formatAmount(entry.p75Amount)}`}
              />
              <div className="flex justify-between text-xs [font-variant-numeric:tabular-nums]" style={{ color: "var(--hamilton-text-tertiary)" }}>
                <span>
                  {entry.p25Amount !== null && entry.p75Amount !== null
                    ? `Most charge ${formatAmount(entry.p25Amount)} to ${formatAmount(entry.p75Amount)}`
                    : "Range not available"}
                </span>
                <span>
                  {entry.institutionCount.toLocaleString("en-US")} institutions · {COVERAGE_LABELS[entry.maturityTier]}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

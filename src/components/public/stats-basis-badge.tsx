import type { StatsBasis } from "@/lib/data-store/fee-stats";

interface StatsBasisBadgeProps {
  basis: StatsBasis;
  sourcedInstitutions: number;
  totalInstitutions: number;
  className?: string;
}

/**
 * Says where a statistic comes from: only fees traced to a stored fee-schedule
 * document ("Verified sources"), or a blend that still includes the earlier import.
 */
export function StatsBasisBadge({ basis, sourcedInstitutions, totalInstitutions, className = "" }: StatsBasisBadgeProps) {
  const sourced = basis === "sourced";
  const title = sourced
    ? `Computed only from fees traced to a stored fee-schedule document (${sourcedInstitutions.toLocaleString()} institutions).`
    : `${sourcedInstitutions.toLocaleString()} of ${totalInstitutions.toLocaleString()} institutions trace to a stored source document; the rest come from an earlier data import. This switches to verified sources once 20 or more institutions are sourced.`;
  return (
    <span
      title={title}
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
        sourced ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"
      } ${className}`}
    >
      {sourced ? "Verified sources" : "Includes legacy data"}
    </span>
  );
}

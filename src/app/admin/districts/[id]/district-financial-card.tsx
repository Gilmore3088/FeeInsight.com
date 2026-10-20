import { formatCompactDollars } from "@/lib/format";
import type { DistrictFinancialGroup } from "@/lib/data-store/district-financial-summary";

const LABELS: Record<DistrictFinancialGroup["source"], string> = {
  fdic: "Bank deposit service charges (FDIC)",
  ncua: "Credit union fee income (NCUA)",
};

const DATE_FORMAT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

function quarterEnding(reportDate: string): string {
  const parsed = new Date(`${reportDate}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? reportDate : DATE_FORMAT.format(parsed);
}

function GroupRow({ group }: { group: DistrictFinancialGroup }) {
  if (group.status === "unavailable" || group.report_date === null) {
    return (
      <div>
        <div className="text-[11px] font-medium text-gray-500">{LABELS[group.source]}</div>
        <div className="text-[11px] text-gray-400">No {group.source.toUpperCase()} filing on record for this district</div>
      </div>
    );
  }
  return (
    <div title={group.definition}>
      <div className="text-[11px] font-medium text-gray-500">{LABELS[group.source]}</div>
      <span className="text-lg font-bold tabular-nums text-gray-900 dark:text-gray-100">
        {formatCompactDollars(group.total_income_usd)}
      </span>
      <div className="text-[11px] text-gray-400">
        Quarter ending {quarterEnding(group.report_date)} | {group.institution_count} institutions reporting |{" "}
        {group.mean_income_usd === null
          ? `Average withheld below ${group.minimum_mean_count} institutions`
          : `avg ${formatCompactDollars(group.mean_income_usd)}/inst`}
      </div>
    </div>
  );
}

/**
 * The district's call-report income, one row per regulator. Bank and credit-union figures are
 * different measures filed on their own dates, so they are never added together.
 */
export function DistrictFinancialCard({ groups }: { groups: readonly DistrictFinancialGroup[] }) {
  if (!groups.some((g) => g.status === "reported")) return null;
  return (
    <div className="rounded-lg border p-3">
      <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
        Call-report fee income (one quarter)
      </div>
      <div className="space-y-3">
        {groups.map((group) => <GroupRow key={group.source} group={group} />)}
      </div>
    </div>
  );
}

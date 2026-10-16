/**
 * Server-rendered filter bar for /reports — a plain GET form, no JS required.
 * Only shown once there is a published catalog to filter.
 */
import Link from "next/link";
import type { ReportType } from "@/lib/report-engine/types";

// Human-readable labels for report types
export const REPORT_TYPE_LABELS: Record<ReportType, string> = {
  national_index: "National Index",
  state_index: "State Index",
  peer_brief: "Peer Brief",
  monthly_pulse: "Monthly Pulse",
};

// Date range options for the filter
const DATE_RANGE_OPTIONS = [
  { value: "", label: "All time" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "180d", label: "Last 6 months" },
  { value: "365d", label: "Last 12 months" },
];

const SELECT_CLASS =
  "cursor-pointer rounded-md border border-border bg-surface-0 px-3 py-2 text-[13px] text-ink";

interface ReportFiltersProps {
  typeFilter: string | null;
  rawRange: string | undefined;
  filtersActive: boolean;
}

export function ReportFilters({ typeFilter, rawRange, filtersActive }: ReportFiltersProps) {
  return (
    <form method="GET" className="mb-10 flex flex-wrap gap-3">
      <label htmlFor="report-type-filter" className="sr-only">
        Filter by report type
      </label>
      <select
        id="report-type-filter"
        name="type"
        defaultValue={typeFilter ?? ""}
        className={SELECT_CLASS}
      >
        <option value="">All report types</option>
        {Object.entries(REPORT_TYPE_LABELS).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>

      <label htmlFor="report-date-filter" className="sr-only">
        Filter by date range
      </label>
      <select
        id="report-date-filter"
        name="range"
        defaultValue={rawRange ?? ""}
        className={SELECT_CLASS}
      >
        {DATE_RANGE_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>

      <button
        type="submit"
        className="cursor-pointer rounded-md border-0 bg-ink px-4 py-2 text-[13px] font-medium text-surface-0"
      >
        Filter
      </button>

      {filtersActive && (
        <Link
          href="/reports"
          className="inline-flex items-center rounded-md border border-border px-4 py-2 text-[13px] text-ink-soft no-underline"
        >
          Clear filters
        </Link>
      )}
    </form>
  );
}

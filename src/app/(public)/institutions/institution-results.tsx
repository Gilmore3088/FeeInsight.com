import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import type { InstitutionSearchResult } from "@/lib/data-store/search";
import { formatAmount } from "@/lib/format";
import { getCharterLabel, getPublicStatusLabel, getSegmentLabel, toTitleCase } from "../institution/[id]/enum-labels";
import { HEADLINE_FEE_KEYS, isInstitutionRich } from "@/lib/data-store/market-readiness";
import { getHeadlineCoverageLabel } from "../institution/[id]/enum-labels";
import { hasVerifiedFees } from "./directory-sort";

/** Headline categories published per institution id; null when the count could not be read. */
export type HeadlineCoverage = Map<number, number> | null;

function statusChip(row: InstitutionSearchResult, coverage: HeadlineCoverage): { label: string; className: string } {
  // Completeness, never "verified": a published fee is not a checked, complete schedule.
  const categories = coverage?.get(row.id);
  if (hasVerifiedFees(row) && categories !== undefined) {
    return {
      label: getHeadlineCoverageLabel(categories, HEADLINE_FEE_KEYS.length),
      className: isInstitutionRich(categories)
        ? "border-emerald-200 bg-emerald-50 text-emerald-800"
        : "border-[#E0D7C9] bg-white text-[#5A5347]",
    };
  }
  if (hasVerifiedFees(row)) {
    return { label: "Fees published", className: "border-emerald-200 bg-emerald-50 text-emerald-800" };
  }
  if (row.provisional_fee_count > 0 || row.fee_publication_status === "under_review") {
    return { label: "Under review", className: "border-[#C44B2E]/25 bg-[#FDF0ED] text-[#8E2A17]" };
  }
  return { label: getPublicStatusLabel("unavailable"), className: "border-[#E0D7C9] bg-white text-[#6B6255]" };
}

/**
 * A fee the reader arrived to compare (`?fee=overdraft` from a consumer guide). When set,
 * every row shows that fee's published amount next to the national median and links to
 * the highlighted row on the profile.
 */
export interface FeeFocus {
  category: string;
  /** Display name with any abbreviation stripped, e.g. "Overdraft" not "Overdraft (OD)". */
  label: string;
  median: number | null;
}

export function institutionHref(id: number, focus?: FeeFocus | null): string {
  return focus ? `/institution/${id}?fee=${focus.category}#fee-${focus.category}` : `/institution/${id}`;
}

function deltaLabel(amount: number, median: number | null): string | null {
  if (median === null) return null;
  if (amount > median) return `${formatAmount(amount - median)} above median`;
  if (amount < median) return `${formatAmount(median - amount)} below median`;
  return "at the median";
}

/** The focused fee's amount for one row; "Not published" is explicit, never $0. */
function FocusAmount({ row, focus, align = "right" }: { row: InstitutionSearchResult; focus: FeeFocus; align?: "right" | "left" }) {
  const amount = row.focus_fee_amount;
  if (amount === null || amount === undefined) {
    return <span className="text-[11px] text-[#6B6255]">Not published</span>;
  }
  const delta = deltaLabel(amount, focus.median);
  return (
    <span className={`block tabular-nums ${align === "right" ? "text-right" : ""}`}>
      <span className="font-semibold text-[#1A1815]">{formatAmount(amount)}</span>
      {delta && <span className="block text-[10px] text-[#6B6255]">{delta}</span>}
    </span>
  );
}

function locationLabel(row: InstitutionSearchResult): string {
  return [toTitleCase(row.city), row.state_code].filter(Boolean).join(", ");
}

function StatusChip({
  row,
  coverage,
  small = false,
}: {
  row: InstitutionSearchResult;
  coverage: HeadlineCoverage;
  small?: boolean;
}) {
  const chip = statusChip(row, coverage);
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border font-medium ${chip.className} ${
        small ? "px-1.5 py-0.5 text-[11px]" : "px-2 py-1 text-[11px]"
      }`}
    >
      {chip.label}
    </span>
  );
}

function FeeCount({ row }: { row: InstitutionSearchResult }) {
  if (hasVerifiedFees(row)) {
    return (
      <span className="tabular-nums">
        <span className="font-medium text-[#C44B2E]">{row.published_fee_count.toLocaleString("en-US")}</span>
        {row.provisional_fee_count > 0 && (
          <span className="ml-1 text-xs text-[#6B6255]">+{row.provisional_fee_count} under review</span>
        )}
      </span>
    );
  }
  if (row.provisional_fee_count > 0) {
    return <span className="tabular-nums text-[#8E2A17]">{row.provisional_fee_count} under review</span>;
  }
  return <span className="text-[#6B6255]">—</span>;
}

const TH_CLASS = "px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-[#6B6255]";

export function InstitutionResultsTable({
  rows,
  coverage,
  focus = null,
}: {
  rows: InstitutionSearchResult[];
  coverage: HeadlineCoverage;
  focus?: FeeFocus | null;
}) {
  return (
    <div className="hidden overflow-hidden border border-[#E0D7C9] bg-[#FDFBF8] sm:block">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead>
            <tr className="border-b border-[#E0D7C9] bg-[#FAF7F2]">
              <th className={TH_CLASS}>Institution</th>
              <th className={TH_CLASS}>Location</th>
              <th className={`hidden md:table-cell ${TH_CLASS}`}>Type</th>
              {focus && <th className={`text-right ${TH_CLASS}`}>{focus.label}</th>}
              <th className={`text-right ${TH_CLASS}`}>Fees</th>
              <th className={`hidden md:table-cell ${TH_CLASS}`}>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="fi-row-interaction border-b border-[#E0D7C9] last:border-0">
                <td className="px-4 py-3">
                  <Link
                    href={institutionHref(row.id, focus)}
                    className="group flex min-w-0 items-center gap-2 break-words font-medium text-[#1A1815] transition-colors hover:text-[#C44B2E]"
                  >
                    <span className="min-w-0 break-words">{row.institution_name}</span>
                    <ArrowRight className="h-3.5 w-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
                  </Link>
                  <div className="mt-1 md:hidden">
                    <StatusChip row={row} coverage={coverage} small />
                  </div>
                </td>
                <td className="px-4 py-3 text-[#6B6255]">{locationLabel(row)}</td>
                <td className="hidden px-4 py-3 text-[#6B6255] md:table-cell">
                  {getCharterLabel(row.charter_type)}
                  {getSegmentLabel(row.asset_size_tier, row.charter_type) && (
                    <span className="ml-1 text-xs text-[#6B6255]">
                      ({getSegmentLabel(row.asset_size_tier, row.charter_type)})
                    </span>
                  )}
                </td>
                {focus && (
                  <td className="px-4 py-3 text-right">
                    <FocusAmount row={row} focus={focus} />
                  </td>
                )}
                <td className="px-4 py-3 text-right">
                  <FeeCount row={row} />
                </td>
                <td className="hidden px-4 py-3 md:table-cell">
                  <StatusChip row={row} coverage={coverage} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function InstitutionMobileCards({
  rows,
  coverage,
  focus = null,
}: {
  rows: InstitutionSearchResult[];
  coverage: HeadlineCoverage;
  focus?: FeeFocus | null;
}) {
  return (
    <div className="grid gap-2 sm:hidden">
      {rows.map((row) => (
        <Link
          key={row.id}
          href={institutionHref(row.id, focus)}
          className="fi-row-interaction block border border-[#E0D7C9] bg-[#FDFBF8] px-3 py-3"
        >
          <div className="flex min-w-0 items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="break-words text-sm font-semibold leading-snug text-[#1A1815]">
                {row.institution_name}
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-[#6B6255]">
                <span>{getCharterLabel(row.charter_type)}</span>
                {locationLabel(row) && <span>{locationLabel(row)}</span>}
              </div>
              <div className="mt-2">
                <StatusChip row={row} coverage={coverage} small />
              </div>
            </div>
            <div className="shrink-0 text-right text-sm">
              {focus ? (
                <>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#6B6255]">{focus.label}</p>
                  <FocusAmount row={row} focus={focus} />
                </>
              ) : (
                <FeeCount row={row} />
              )}
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}

export function DirectoryPagination({
  page,
  totalPages,
  buildHref,
}: {
  page: number;
  totalPages: number;
  buildHref: (page: number) => string;
}) {
  if (totalPages <= 1) return null;
  const linkClass =
    "inline-flex items-center gap-1.5 rounded-md border border-[#D5CBBF] px-3 py-1.5 text-xs font-medium text-[#1A1815] transition-colors hover:border-[#1A1815]";
  return (
    <div className="mt-6 flex items-center justify-center gap-2">
      {page > 1 && (
        <Link href={buildHref(page - 1)} className={linkClass}>
          <ArrowLeft className="h-3.5 w-3.5" />
          Previous
        </Link>
      )}
      <span className="text-xs text-[#6B6255]">
        Page {page} of {totalPages}
      </span>
      {page < totalPages && (
        <Link href={buildHref(page + 1)} className={linkClass}>
          Next
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      )}
    </div>
  );
}

import Link from "next/link";
import { ArrowLeft, ArrowRight, CircleDashed, Clock3, FileCheck2, MapPin } from "lucide-react";
import type { InstitutionSearchResult } from "@/lib/data-store/search";
import { formatAmount } from "@/lib/format";
import { getCharterLabel, getSegmentLabel, toTitleCase } from "../institution/[id]/enum-labels";
import { HEADLINE_FEE_KEYS, isInstitutionRich } from "@/lib/data-store/market-readiness";
import { getHeadlineCoverageLabel } from "../institution/[id]/enum-labels";
import { hasVerifiedFees } from "./directory-sort";

/** Headline categories published per institution id; null when the count could not be read. */
export type HeadlineCoverage = Map<number, number> | null;

/** The coverage chip; null for a row with nothing published or under review (its fee count already says "None yet"). */
function statusChip(row: InstitutionSearchResult, coverage: HeadlineCoverage): { label: string; className: string } | null {
  // Completeness, never "verified": a published fee is not a checked, complete schedule.
  const categories = coverage?.get(row.id);
  if (hasVerifiedFees(row) && categories !== undefined) {
    return {
      label: getHeadlineCoverageLabel(categories, HEADLINE_FEE_KEYS.length),
      className: isInstitutionRich(categories)
        ? "border-ink/25 bg-surface-200 font-semibold text-ink"
        : "border-border bg-surface-0 text-ink-soft",
    };
  }
  if (hasVerifiedFees(row)) {
    return { label: "Fees published", className: "border-ink/25 bg-surface-200 text-ink" };
  }
  if (row.provisional_fee_count > 0 || row.fee_publication_status === "under_review") {
    return { label: "Under review", className: "border-dashed border-border bg-surface-0 text-ink-soft" };
  }
  return null;
}

/**
 * The table's coverage column: a small meter of the headline fees published, one segment per
 * headline fee, with the count beside it. Rows without a count keep the status chip.
 */
function CoverageCell({ row, coverage }: { row: InstitutionSearchResult; coverage: HeadlineCoverage }) {
  const categories = coverage?.get(row.id);
  if (!hasVerifiedFees(row) || categories === undefined) return <StatusChip row={row} coverage={coverage} />;
  const total = HEADLINE_FEE_KEYS.length;
  return (
    <span className="inline-flex items-center gap-2" title={getHeadlineCoverageLabel(categories, total)}>
      <span aria-hidden="true" className="flex gap-0.5">
        {HEADLINE_FEE_KEYS.map((key, i) => (
          <span key={key} className={`h-2.5 w-1.5 rounded-sm ${i < categories ? "bg-brick" : "bg-surface-200"}`} />
        ))}
      </span>
      <span className="whitespace-nowrap text-[12px] tabular-nums text-ink-soft">
        {categories} of {total}
        <span className="sr-only"> headline fees published</span>
      </span>
    </span>
  );
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
  // Within 1% of the median reads as about the same, as on every other page.
  if (Math.abs(amount - median) <= Math.abs(median) * 0.01) return "About the same as the median";
  if (amount > median) return `${formatAmount(amount - median)} above median`;
  if (amount < median) return `${formatAmount(median - amount)} below median`;
  return "at the median";
}

/** The focused fee's amount for one row; "Not published" is explicit, never $0. */
function FocusAmount({ row, focus, align = "right" }: { row: InstitutionSearchResult; focus: FeeFocus; align?: "right" | "left" }) {
  const amount = row.focus_fee_amount;
  if (amount === null || amount === undefined) {
    return <span className="text-[11px] text-ink-muted">Not published</span>;
  }
  const delta = deltaLabel(amount, focus.median);
  return (
    <span className={`block tabular-nums ${align === "right" ? "text-right" : ""}`}>
      <span className="font-semibold text-ink">{formatAmount(amount)}</span>
      {delta && <span className="block text-[11px] text-ink-muted">{delta}</span>}
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
  if (!chip) return null;
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
    return <span className="font-semibold tabular-nums text-ink">{row.published_fee_count.toLocaleString("en-US")}</span>;
  }
  return <span className="text-ink-muted">None yet</span>;
}

const TH_CLASS = "px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-ink-muted";

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
    <div className="hidden overflow-hidden rounded-xl border border-border bg-surface-0 sm:block">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead>
            <tr className="border-b border-border bg-paper">
              <th className={TH_CLASS}>Institution</th>
              <th className={TH_CLASS}>Location</th>
              <th className={`hidden md:table-cell ${TH_CLASS}`}>Type</th>
              {focus && (
                <th className={`text-right ${TH_CLASS}`}>
                  {focus.label}
                  {focus.median !== null && ` (national median ${formatAmount(focus.median)})`}
                </th>
              )}
              <th className={`text-right ${TH_CLASS}`}>Published fees</th>
              <th className={`hidden md:table-cell ${TH_CLASS}`}>Headline fees</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="fi-row-interaction border-b border-border last:border-0">
                <td className="px-4 py-3">
                  <Link
                    href={institutionHref(row.id, focus)}
                    className="group flex min-w-0 items-center gap-2 break-words font-medium text-ink transition-colors hover:text-brick"
                  >
                    <span className="min-w-0 break-words">{row.institution_name}</span>
                    <ArrowRight className="h-3.5 w-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
                  </Link>
                  <div className="mt-1 md:hidden">
                    <StatusChip row={row} coverage={coverage} small />
                  </div>
                </td>
                <td className="px-4 py-3 text-ink-muted">{locationLabel(row)}</td>
                <td className="hidden px-4 py-3 text-ink-muted md:table-cell">
                  {getSegmentLabel(row.asset_size_tier, row.charter_type) ?? getCharterLabel(row.charter_type)}
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
                  <CoverageCell row={row} coverage={coverage} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * The phone's coverage indicator, up front on each card: an icon and the published fee count
 * ("26 published fees"), "Under review", or "None yet".
 */
function CoverageChip({ row }: { row: InstitutionSearchResult }) {
  if (hasVerifiedFees(row)) {
    const n = row.published_fee_count;
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-brick/30 bg-brick-tint px-2.5 py-1 text-[13px] font-semibold text-brick-ink">
        <FileCheck2 aria-hidden="true" className="size-3.5" strokeWidth={2} />
        <span className="tabular-nums">{n.toLocaleString("en-US")}</span> published {n === 1 ? "fee" : "fees"}
      </span>
    );
  }
  if (row.provisional_fee_count > 0 || row.fee_publication_status === "under_review") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-border bg-surface-0 px-2.5 py-1 text-[13px] font-medium text-ink-soft">
        <Clock3 aria-hidden="true" className="size-3.5" strokeWidth={2} />
        Under review
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-0 px-2.5 py-1 text-[13px] text-ink-muted">
      <CircleDashed aria-hidden="true" className="size-3.5" strokeWidth={2} />
      None yet
    </span>
  );
}

/**
 * Phone results: the name, where it is, and its coverage. Type, asset tier and the headline-fee
 * label are on the profile and in the wider table.
 */
export function InstitutionMobileCards({
  rows,
  focus = null,
}: {
  rows: InstitutionSearchResult[];
  focus?: FeeFocus | null;
}) {
  return (
    <ul className="grid gap-2 sm:hidden">
      {rows.map((row) => {
        const where = locationLabel(row);
        return (
          <li key={row.id}>
            <Link
              href={institutionHref(row.id, focus)}
              className="fi-row-interaction flex min-h-11 items-center gap-3 rounded-xl border border-border bg-surface-0 px-4 py-3"
            >
              <span className="min-w-0 flex-1">
                <span className="block break-words text-[15px] font-semibold leading-snug text-ink">{row.institution_name}</span>
                {where && (
                  <span className="mt-1 flex items-center gap-1 text-[13px] text-ink-muted">
                    <MapPin aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={1.75} />
                    {where}
                  </span>
                )}
                <span className="mt-2 block">
                  <CoverageChip row={row} />
                </span>
              </span>
              {focus ? (
                <span className="shrink-0 text-right text-sm">
                  <span className="block text-[12px] font-semibold text-ink-muted">{focus.label}</span>
                  <FocusAmount row={row} focus={focus} />
                </span>
              ) : (
                <ArrowRight aria-hidden="true" className="size-4 shrink-0 text-ink-muted" />
              )}
            </Link>
          </li>
        );
      })}
    </ul>
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
    "inline-flex min-h-11 items-center gap-1.5 rounded-full border border-border px-4 text-[14px] font-medium text-ink transition-colors hover:border-ink";
  return (
    <div className="mt-6 flex items-center justify-center gap-2">
      {page > 1 && (
        <Link href={buildHref(page - 1)} className={linkClass}>
          <ArrowLeft className="h-3.5 w-3.5" />
          Previous
        </Link>
      )}
      <span className="text-[13px] text-ink-muted">
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

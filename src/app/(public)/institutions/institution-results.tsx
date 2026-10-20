import Link from "next/link";
import { ArrowLeft, ArrowRight, CircleDashed, Clock3, FileCheck2, MapPin } from "lucide-react";
import type { InstitutionSearchResult } from "@/lib/data-store/search";
import { formatAmount } from "@/lib/format";
import { getCharterLabel, getSegmentLabel } from "../institution/[id]/enum-labels";
import { HEADLINE_FEE_KEYS } from "@/lib/data-store/market-readiness";
import { hasVerifiedFees } from "./directory-sort";
import { directoryCity, directoryName } from "./directory-view";

/** Headline categories in the index per institution id; null when the count could not be read. */
export type HeadlineCoverage = Map<number, number> | null;

/** "12 of 15 headline fees available": the dataset's coverage, never a claim about the institution. */
export function coverageLabel(categories: number): string {
  return `${categories} of ${HEADLINE_FEE_KEYS.length} headline fees available`;
}

/**
 * A row's published fee coverage in words: the headline count when it was read, else what is
 * known (fees in the index, under review, or none in the index yet).
 */
export function coverageText(row: InstitutionSearchResult, coverage: HeadlineCoverage): string {
  const categories = coverage?.get(row.id);
  if (hasVerifiedFees(row)) return categories !== undefined ? coverageLabel(categories) : "Fees in the index";
  if (row.provisional_fee_count > 0 || row.fee_publication_status === "under_review") return "Under review";
  return "No fees in the index yet";
}

/** The phone card's shorter form: "12 of 15 fees", so the chip stays on one line at 320px. */
export function shortCoverageText(row: InstitutionSearchResult, coverage: HeadlineCoverage): string {
  const categories = coverage?.get(row.id);
  if (hasVerifiedFees(row) && categories !== undefined) return `${categories} of ${HEADLINE_FEE_KEYS.length} fees`;
  return coverageText(row, coverage);
}

/**
 * The coverage column: a small meter of the headline fees in the index, one segment per headline
 * fee, with the count beside it. Rows without a count say what is known in words.
 */
function CoverageCell({ row, coverage }: { row: InstitutionSearchResult; coverage: HeadlineCoverage }) {
  const categories = coverage?.get(row.id);
  if (!hasVerifiedFees(row) || categories === undefined) {
    return <span className="text-[13px] text-ink-muted">{coverageText(row, coverage)}</span>;
  }
  const total = HEADLINE_FEE_KEYS.length;
  return (
    <span className="inline-flex items-center gap-2">
      <span aria-hidden="true" className="flex gap-0.5">
        {HEADLINE_FEE_KEYS.map((key, i) => (
          <span key={key} className={`h-2.5 w-1.5 rounded-sm ${i < categories ? "bg-brick" : "bg-surface-200"}`} />
        ))}
      </span>
      <span className="whitespace-nowrap text-[13px] tabular-nums text-ink-soft">
        {categories} of {total}
        <span className="sr-only"> headline fees available</span>
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
  return [directoryCity(row.city), row.state_code].filter(Boolean).join(", ");
}

const TH_CLASS = "px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-ink-muted";

export function InstitutionResultsTable({
  rows,
  coverage,
  focus = null,
  caption,
}: {
  rows: InstitutionSearchResult[];
  coverage: HeadlineCoverage;
  focus?: FeeFocus | null;
  /** What the list is, for screen readers ("The 25 largest banks and credit unions by assets"). */
  caption: string;
}) {
  return (
    <div className="hidden overflow-hidden rounded-xl border border-border bg-surface-0 sm:block">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-border bg-paper">
              <th scope="col" className={TH_CLASS}>Institution</th>
              <th scope="col" className={TH_CLASS}>Headquarters</th>
              <th scope="col" className={`hidden md:table-cell ${TH_CLASS}`}>Type</th>
              {focus && (
                <th scope="col" className={`text-right ${TH_CLASS}`}>
                  {focus.label}
                  {focus.median !== null && ` (national median ${formatAmount(focus.median)})`}
                </th>
              )}
              <th scope="col" className={TH_CLASS}>Published fee coverage</th>
              <th scope="col" className={TH_CLASS}>
                <span className="sr-only">View institution</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const name = directoryName(row.institution_name);
              return (
                <tr key={row.id} className="fi-row-interaction border-b border-border last:border-0">
                  <th scope="row" className="px-4 py-3 font-medium">
                    <Link href={institutionHref(row.id, focus)} className="break-words text-ink transition-colors hover:text-brick">
                      {name}
                    </Link>
                  </th>
                  <td className="px-4 py-3 text-ink-muted">{locationLabel(row)}</td>
                  <td className="hidden px-4 py-3 text-ink-muted md:table-cell">
                    {getSegmentLabel(row.asset_size_tier, row.charter_type) ?? getCharterLabel(row.charter_type)}
                  </td>
                  {focus && (
                    <td className="px-4 py-3 text-right">
                      <FocusAmount row={row} focus={focus} />
                    </td>
                  )}
                  <td className="px-4 py-3">
                    <CoverageCell row={row} coverage={coverage} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={institutionHref(row.id, focus)}
                      className="inline-flex min-h-11 items-center gap-1 whitespace-nowrap text-[14px] font-medium text-ink underline decoration-border underline-offset-4 hover:decoration-ink"
                    >
                      View<span className="sr-only"> {name}</span>
                      <ArrowRight aria-hidden="true" className="size-3.5" />
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * The phone's coverage indicator, up front on each card: an icon and the row's coverage
 * ("12 of 15 fees"), "Under review", or "No fees in the index yet".
 */
function CoverageChip({ row, coverage }: { row: InstitutionSearchResult; coverage: HeadlineCoverage }) {
  if (hasVerifiedFees(row)) {
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-brick/30 bg-brick-tint px-2.5 py-1 text-[13px] font-semibold tabular-nums text-brick-ink">
        <FileCheck2 aria-hidden="true" className="size-3.5" strokeWidth={2} />
        {shortCoverageText(row, coverage)}
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
      No fees in the index yet
    </span>
  );
}

/**
 * Phone results: the name, its headquarters, and its coverage. Type and asset tier are on the
 * profile and in the wider table.
 */
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
                <span className="block break-words text-[15px] font-semibold leading-snug text-ink">{directoryName(row.institution_name)}</span>
                {where && (
                  <span className="mt-1 flex items-center gap-1 text-[13px] text-ink-muted">
                    <MapPin aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={1.75} />
                    {where}
                  </span>
                )}
                <span className="mt-2 block">
                  <CoverageChip row={row} coverage={coverage} />
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

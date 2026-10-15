import type { ReactNode } from "react";
import { Button, FeeRange, FeeRangeAxis, SearchInput } from "@/brand/components";
import type { FeeCategorySummary } from "@/lib/data-store/fees";
import { getDisplayName } from "@/lib/fee-taxonomy";
import { formatCount } from "@/lib/public-stats";

/** The institution report's request form (the same anchor the report pages link to). */
export const REPORT_REQUEST_HREF = "/for-institutions?report=institution#report";
export const SAMPLE_REPORT_HREF = "/reports/sample-competitive-fee-position";

export const SANS = { fontFamily: "var(--fi-font-sans)" } as const;
export const TEXT_LINK = "font-semibold text-ink underline underline-offset-4 decoration-border hover:decoration-ink";
export const SECTION_INNER = "mx-auto max-w-6xl px-4 sm:px-6";

export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-muted">{children}</p>;
}

export function SectionHeading({ eyebrow, title }: { eyebrow?: string; title: string }) {
  return (
    <>
      {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
      <h2 className="mt-2 text-[1.75rem] font-bold leading-tight tracking-[-0.02em] text-ink sm:text-[2rem]" style={SANS}>
        {title}
      </h2>
    </>
  );
}

export const money = (v: number) => `$${v.toFixed(2)}`;

/**
 * The institution search: a plain GET to /institutions?q=, the same target as the
 * homepage's WEBSITE_JSON_LD SearchAction, so it works before any script loads.
 */
export function InstitutionSearchForm({ className }: { className?: string }) {
  return (
    <form
      action="/institutions"
      method="get"
      role="search"
      aria-label="Search for a bank or credit union"
      className={["flex flex-col gap-3 sm:flex-row sm:items-end", className].filter(Boolean).join(" ")}
    >
      <SearchInput name="q" label="Your bank or credit union" required autoComplete="off" className="w-full min-w-0 sm:flex-1" />
      <Button type="submit" variant="primary" className="justify-center whitespace-nowrap">
        See where your fees stand
      </Button>
    </form>
  );
}

export type RangeEntry = FeeCategorySummary & {
  min_amount: number;
  p25_amount: number;
  median_amount: number;
  p75_amount: number;
  max_amount: number;
};

/** A category's national row, only when every figure the box plot needs was published. */
export function nationalRange(categories: FeeCategorySummary[], category: string): RangeEntry | null {
  const row = categories.find((c) => c.fee_category === category);
  if (!row) return null;
  const { min_amount, p25_amount, median_amount, p75_amount, max_amount } = row;
  if ([min_amount, p25_amount, median_amount, p75_amount, max_amount].some((v) => v === null)) return null;
  return row as RangeEntry;
}

/** Upper end of the axis: the national maximum, rounded up to the next ten dollars. */
function axisMax(max: number): number {
  return Math.max(10, Math.ceil(max / 10) * 10);
}

/**
 * One live national box plot from the Bank Fee Index snapshot, with its caption.
 * Nothing here is illustrative, so it carries no "Example" tag.
 */
export function NationalRange({
  row,
  label,
  freshnessLabel,
}: {
  row: RangeEntry;
  label?: string;
  freshnessLabel: string;
}) {
  const hi = axisMax(row.max_amount);
  const domain: [number, number] = [0, hi];
  return (
    <figure className="min-w-0">
      <FeeRange
        label={label ?? getDisplayName(row.fee_category)}
        min={row.min_amount}
        q1={row.p25_amount}
        median={row.median_amount}
        q3={row.p75_amount}
        max={row.max_amount}
        domain={domain}
        format={money}
      />
      <FeeRangeAxis ticks={[0, hi / 2, hi]} domain={domain} />
      <figcaption className="mt-3 text-[13px] leading-5 text-ink-muted">
        National range · {formatCount(row.institution_count)} institutions · {freshnessLabel}
      </figcaption>
    </figure>
  );
}

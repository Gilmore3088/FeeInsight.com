import type { ReactNode } from "react";
import { Button, SearchInput } from "@/brand/components";
import type { DimensionBreakdown, FeeCategorySummary } from "@/lib/data-store/fees";
import { MIN_INSTITUTIONS_FOR_MEDIAN } from "@/lib/data-store/maturity";
import { DISTRICT_NAMES } from "@/lib/fed-districts";
import { getDisplayName } from "@/lib/fee-taxonomy";
import type { PublicStatsSummary } from "@/lib/public-stats";

/** The one report request form, on /reports (site v3 brief 05 §3-4, #1171). */
export const REPORT_REQUEST_HREF = "/reports?report=institution#request";
export const SAMPLE_REPORT_HREF = "/reports/sample-competitive-fee-position";

export const SANS = { fontFamily: "var(--fi-font-sans)" } as const;
export const TEXT_LINK = "font-semibold text-ink underline underline-offset-4 decoration-border hover:decoration-ink";
export const SECTION_INNER = "mx-auto max-w-6xl px-4 sm:px-6";
/** Display type set big and tight (brief 06 §1.9). Wrapping stays with the global balance rule. */
// The consumer shell sets h1/h2 to weight 800 unlayered; the homepage display face is 600 (brief 06 §1.9).
export const DISPLAY_H2 = "text-[2rem] !font-semibold leading-[1.05] !tracking-[-0.035em] text-ink sm:text-[2.75rem]";

export function Eyebrow({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <p className={`text-[12px] font-semibold uppercase tracking-[0.14em] text-ink-muted ${className}`}>{children}</p>
  );
}

/** A section's heading and its one line (the homepage copy budget: one sentence a section). */
export function SectionHeading({
  eyebrow,
  title,
  line,
  center = false,
}: {
  eyebrow?: string;
  title: string;
  line?: ReactNode;
  center?: boolean;
}) {
  return (
    <div className={center ? "mx-auto max-w-2xl text-center" : "max-w-xl"}>
      {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
      <h2 className={`${eyebrow ? "mt-3" : ""} ${DISPLAY_H2}`} style={SANS}>
        {title}
      </h2>
      {line ? <p className={`mt-4 text-[17px] leading-relaxed text-ink-soft ${center ? "text-center" : ""}`}>{line}</p> : null}
    </div>
  );
}

export const money = (v: number) => `$${v.toFixed(2)}`;

/** Upper end of an axis: the largest value, rounded up to the next ten dollars. */
export function axisMax(max: number): number {
  return Math.max(10, Math.ceil(max / 10) * 10);
}

/** True when a count label holds a real figure (a failed read shows "—"). */
export const hasFigure = (label: string) => /\d/.test(label);

/**
 * The institution search: a plain GET to /institutions?q=, the same target as the
 * homepage's WEBSITE_JSON_LD SearchAction, so it works before any script loads.
 */
export function InstitutionSearchForm({ className, id }: { className?: string; id?: string }) {
  return (
    <form
      action="/institutions"
      method="get"
      role="search"
      aria-label="Search for a bank or credit union"
      className={["flex flex-col gap-3 sm:flex-row sm:items-end", className].filter(Boolean).join(" ")}
    >
      <SearchInput
        id={id}
        name="q"
        label="Your bank or credit union"
        required
        autoComplete="off"
        className="w-full min-w-0 text-left sm:flex-1"
      />
      <Button type="submit" variant="primary" className="min-h-11 justify-center whitespace-nowrap">
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

function isComplete(row: FeeCategorySummary | undefined): row is RangeEntry {
  if (!row) return false;
  const { min_amount, p25_amount, median_amount, p75_amount, max_amount } = row;
  return [min_amount, p25_amount, median_amount, p75_amount, max_amount].every((v) => v !== null && v !== undefined);
}

/** A category's national row, only when every figure the box plot needs was published. */
export function nationalRange(categories: FeeCategorySummary[], category: string): RangeEntry | null {
  const row = categories.find((c) => c.fee_category === category);
  return isComplete(row) ? row : null;
}

/** One live national fee line, as the exhibits draw it. */
export interface FeeLine {
  key: string;
  label: string;
  row: RangeEntry;
}

/** One Fed district's overdraft median. A district below the minimum is thin and has no median. */
export interface DistrictPoint {
  district: number;
  name: string;
  median: number | null;
  /** The district's lowest and highest fee; null when the district is thin. */
  min: number | null;
  max: number | null;
  institutions: number;
}

/** Everything the homepage exhibits draw, from live reads only. Nothing here is typed by hand. */
export interface HomeData {
  summary: PublicStatsSummary;
  /** National rows for the fee table, in FEE_LINE_ORDER, complete rows only. */
  lines: FeeLine[];
  overdraft: RangeEntry | null;
  /** Overdraft by Fed district, in district order. */
  districts: DistrictPoint[];
}

/** The fees a pricing committee asks about first (brief 08 §A.2), in the order the exhibits list them. */
export const FEE_LINE_ORDER = [
  "overdraft",
  "nsf",
  "stop_payment",
  "wire_domestic_outgoing",
  "monthly_maintenance",
  "atm_non_network",
] as const;
const MAX_LINES = 5;

export function buildHomeData(
  summary: PublicStatsSummary,
  categories: FeeCategorySummary[],
  byDistrict: DimensionBreakdown[] | null | undefined,
): HomeData {
  const lines = FEE_LINE_ORDER.map((key) => categories.find((c) => c.fee_category === key))
    .filter(isComplete)
    .slice(0, MAX_LINES)
    .map((row) => ({ key: row.fee_category, label: getDisplayName(row.fee_category), row }));
  const districts = (byDistrict ?? [])
    .map((row) => {
      const district = Number.parseInt(row.dimension_value.replace(/\D+/g, ""), 10);
      const thin = row.median_amount === null || row.count < MIN_INSTITUTIONS_FOR_MEDIAN;
      return {
        district,
        name: DISTRICT_NAMES[district] ?? row.dimension_value,
        median: thin ? null : Number(row.median_amount),
        min: thin || row.min_amount === null ? null : Number(row.min_amount),
        max: thin || row.max_amount === null ? null : Number(row.max_amount),
        institutions: row.count,
      };
    })
    .filter((row) => Number.isInteger(row.district) && DISTRICT_NAMES[row.district])
    .sort((a, b) => a.district - b.district);
  return { summary, lines, overdraft: nationalRange(categories, "overdraft"), districts };
}

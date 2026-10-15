import type { DimensionBreakdown, FeeCategorySummary } from "@/lib/data-store/fees";
import { MIN_INSTITUTIONS_FOR_MEDIAN } from "@/lib/data-store/maturity";
import { DISTRICT_NAMES, FDIC_TIER_LABELS } from "@/lib/fed-districts";
import { getDisplayName } from "@/lib/fee-taxonomy";
import { STATE_NAMES } from "@/lib/us-states";
import { getSegmentLabel } from "@/app/(public)/institution/[id]/enum-labels";

/** The national spread every row on the page is read against. */
export interface NationalBand {
  min: number;
  p25: number;
  median: number;
  p75: number;
  max: number;
  institutions: number;
}

export type Position = "below" | "within" | "above";

/** One market's median on the shared axis: a district, a charter, a size group or a state. */
export interface MarketDot {
  key: string;
  label: string;
  median: number;
  institutions: number;
  position: Position;
}

export function nationalBand(row: FeeCategorySummary | null | undefined): NationalBand | null {
  if (!row) return null;
  const { min_amount, p25_amount, median_amount, p75_amount, max_amount, institution_count } = row;
  const figures = [min_amount, p25_amount, median_amount, p75_amount, max_amount];
  if (figures.some((v) => v === null || v === undefined || !Number.isFinite(Number(v)))) return null;
  return {
    min: Number(min_amount),
    p25: Number(p25_amount),
    median: Number(median_amount),
    p75: Number(p75_amount),
    max: Number(max_amount),
    institutions: institution_count,
  };
}

export function positionIn(value: number, band: NationalBand): Position {
  if (value < band.p25) return "below";
  if (value > band.p75) return "above";
  return "within";
}

/** Markets with enough institutions for a median, read against the nation, highest median first. */
export function marketDots(
  rows: DimensionBreakdown[],
  band: NationalBand,
  label: (value: string) => string | null,
): MarketDot[] {
  const dots: MarketDot[] = [];
  for (const row of rows) {
    const name = label(row.dimension_value);
    if (!name || row.median_amount === null || row.count < MIN_INSTITUTIONS_FOR_MEDIAN) continue;
    dots.push({
      key: row.dimension_value,
      label: name,
      median: row.median_amount,
      institutions: row.count,
      position: positionIn(row.median_amount, band),
    });
  }
  return dots.sort((a, b) => b.median - a.median || b.institutions - a.institutions);
}

export const districtLabel = (value: string): string | null => {
  const n = Number.parseInt(value.replace("District ", ""), 10);
  return DISTRICT_NAMES[n] ?? null;
};

/**
 * Banks and credit unions from the shared snapshot, the same medians the consumer guides cite,
 * so a reader never meets two figures for one split.
 */
export function charterDots(row: FeeCategorySummary | null | undefined, band: NationalBand): MarketDot[] {
  if (!row) return [];
  const split = [
    { key: "Bank", label: "Banks", median: row.bank_median_amount, institutions: row.bank_count },
    { key: "Credit Union", label: "Credit unions", median: row.cu_median_amount, institutions: row.cu_count },
  ];
  return split
    .filter((d): d is typeof d & { median: number } => d.median !== null && d.institutions >= MIN_INSTITUTIONS_FOR_MEDIAN)
    .map((d) => ({ ...d, median: Number(d.median), position: positionIn(Number(d.median), band) }));
}

export const stateLabel = (value: string): string | null => STATE_NAMES[value] ?? null;

/** "$1B to $10B", from whichever tier vocabulary the row carries. */
export const tierLabel = (value: string): string | null =>
  FDIC_TIER_LABELS[value] ?? getSegmentLabel(value, "bank")?.split(", ")[1] ?? null;

/**
 * The headline over the district plot, and one line under it. When most districts share one
 * median that is the finding; a gap of a dollar or two between two districts is not.
 */
export function districtHeadline(dots: MarketDot[]): { title: string; detail: string | null } | null {
  if (dots.length < 2) return null;
  const money = (n: number) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;
  const high = dots[0];
  const low = dots[dots.length - 1];
  if (high.median === low.median) return { title: `${money(high.median)} in every Fed district`, detail: null };

  const counts = new Map<number, number>();
  for (const d of dots) counts.set(d.median, (counts.get(d.median) ?? 0) + 1);
  const [common, shared] = [...counts].sort((a, b) => b[1] - a[1])[0];
  const range = `${high.label} is highest at ${money(high.median)}, ${low.label} lowest at ${money(low.median)}.`;
  if (shared * 2 > dots.length) {
    return { title: `${money(common)} in ${shared} of ${dots.length} Fed districts`, detail: range };
  }
  return { title: `Highest in ${high.label}, lowest in ${low.label}`, detail: range };
}

/** The dot colours a plot actually draws, so its legend explains only those. */
export function positionsShown(dots: MarketDot[]): Position[] {
  return (["below", "within", "above"] as const).filter((p) => dots.some((d) => d.position === p));
}

/** The free breakdown: banks against credit unions, as one sentence with both medians. */
export function charterFinding(dots: MarketDot[], feeName: string): string | null {
  const banks = dots.find((d) => d.key === "Bank");
  const unions = dots.find((d) => d.key === "Credit Union");
  if (!banks || !unions) return null;
  const fee = feeName.replace(/\s*\([^)]*\)/g, "").toLowerCase();
  const money = (n: number) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;
  const diff = Math.abs(banks.median - unions.median);
  if (diff === 0) return `Banks and credit unions charge the same median ${fee} fee, ${money(banks.median)}.`;
  const [more, less] = banks.median > unions.median ? [banks, unions] : [unions, banks];
  return `${more.label} charge a median ${money(more.median)} for ${article(fee)} fee, ${money(diff)} more than ${less.label.toLowerCase()} (${money(less.median)}).`;
}

const article = (word: string) => `${/^[aeiou]/i.test(word) ? "an" : "a"} ${word}`;

/** The family's other fees with a complete national spread, for the related-fees row. */
export function relatedBands(
  categories: FeeCategorySummary[],
  members: string[],
  limit = 6,
): { category: string; label: string; band: NationalBand }[] {
  const out: { category: string; label: string; band: NationalBand }[] = [];
  for (const category of members) {
    // A daily cap is a limit on what is charged, not a charge, so it is not drawn as a fee.
    if (category.endsWith("_cap")) continue;
    const row = categories.find((c) => c.fee_category === category);
    const band = nationalBand(row);
    if (!band || band.institutions < MIN_INSTITUTIONS_FOR_MEDIAN) continue;
    out.push({ category, label: getDisplayName(category), band });
    if (out.length >= limit) break;
  }
  return out;
}

import type { CpiContext } from "@/lib/data-store/financial";
import type { IndexEntry } from "@/lib/data-store/fee-index";
import type { DimensionBreakdown } from "@/lib/data-store/fees";
import { MIN_INSTITUTIONS_FOR_MEDIAN } from "@/lib/data-store/maturity";
import { DISTRICT_NAMES } from "@/lib/fed-districts";
import { feeRange } from "./national-visuals";
import { getDisplayName } from "@/lib/fee-taxonomy";
import { formatFeeAmount } from "@/lib/format";
import { hasFigure } from "@/app/landing-shared";
import { summarizeFees } from "@/lib/data-store/fee-stats";
import type { FeeInstance } from "@/lib/data-store/fees";

/** A fee's spread, for the range visual: all five figures, or none. */
export interface FeeRange {
  min: number;
  p25: number;
  median: number;
  p75: number;
  max: number;
}

/** One fee's institution count, for the "who publishes it" bars. */
export interface PublishedCount {
  category: string;
  label: string;
  institutions: number;
}

export type NationalFinding =
  | {
      key: "overdraft";
      text: string;
      median: number;
      institutions: number;
      /** Null when any of the five figures is missing; the card then shows the figure only. */
      range: FeeRange | null;
    }
  | {
      key: "most_published";
      text: string;
      category: string;
      label: string;
      institutions: number;
      /**
       * The most-published fees the reader can select, most first. The first is always the
       * finding's own fee, even when the reader's table does not hold it.
       */
      leaders: PublishedCount[];
    }
  | {
      key: "cpi";
      text: string;
      /** "September 2026" */
      month: string;
      bankPct: number;
      allPct: number;
    };

/** How many fees the "who publishes it" bars show. */
export const LEADER_COUNT = 5;

const count = (n: number) => n.toLocaleString("en-US");

function hasMedian(e: IndexEntry): e is IndexEntry & { median_amount: number } {
  return e.median_amount !== null && e.maturity_tier !== "insufficient";
}

/** "+1%" style figures for the CPI sentence, one decimal at most. */
function pct(value: number): string {
  return `${Number(Math.abs(value).toFixed(1))}%`;
}

function cpiFinding(cpi: CpiContext): Extract<NationalFinding, { key: "cpi" }> | null {
  const { bankFees, allItems } = cpi;
  if (!bankFees || !allItems) return null;
  const month = new Date(bankFees.date).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const bank =
    bankFees.yoyPct > 0 ? `rose ${pct(bankFees.yoyPct)}` : bankFees.yoyPct < 0 ? `fell ${pct(bankFees.yoyPct)}` : "were flat";
  const all =
    allItems.yoyPct > 0 ? `a ${pct(allItems.yoyPct)} rise` : allItems.yoyPct < 0 ? `a ${pct(allItems.yoyPct)} fall` : "no change";
  return {
    key: "cpi",
    text: `Prices for bank services ${bank} in the year to ${month}, against ${all} in all consumer prices.`,
    month,
    bankPct: bankFees.yoyPct,
    allPct: allItems.yoyPct,
  };
}

/**
 * The few sentences the national page leads with. Every figure comes from the live national
 * index (the shared public snapshot of published_fee_catalog) or the BLS CPI rows the page
 * already reads; a finding whose figure is missing is left out rather than filled in.
 *
 * `selectable` is the set of fees the reader's table holds. The "most published" bars are built
 * from those fees, so every bar selects a row; when the fee the most institutions publish is not
 * one of them, it still leads the bars (the card names it) and links to its own page instead.
 * Left out, every fee counts as selectable.
 */
export function nationalFindings(
  index: IndexEntry[],
  cpi: CpiContext,
  selectable?: ReadonlySet<string>,
): NationalFinding[] {
  const findings: NationalFinding[] = [];
  const priced = index.filter(hasMedian);

  const overdraft = priced.find((e) => e.fee_category === "overdraft");
  if (overdraft) {
    findings.push({
      key: "overdraft",
      median: overdraft.median_amount,
      institutions: overdraft.institution_count,
      range: feeRange(overdraft),
      text: `The median overdraft fee is ${formatFeeAmount(overdraft.median_amount)}, across ${count(overdraft.institution_count)} banks and credit unions that publish one.`,
    });
  }

  const mostPublished = priced.reduce<(typeof priced)[number] | null>(
    (top, e) => (top === null || e.institution_count > top.institution_count ? e : top),
    null,
  );
  if (mostPublished && mostPublished.fee_category !== "overdraft") {
    const canSelect = (e: IndexEntry) => !selectable || selectable.has(e.fee_category);
    const ranked = priced.filter(canSelect).sort((a, b) => b.institution_count - a.institution_count);
    const leaders = (canSelect(mostPublished) ? ranked : [mostPublished, ...ranked])
      .slice(0, LEADER_COUNT)
      .map((e) => ({ category: e.fee_category, label: getDisplayName(e.fee_category), institutions: e.institution_count }));
    findings.push({
      key: "most_published",
      category: mostPublished.fee_category,
      label: getDisplayName(mostPublished.fee_category),
      institutions: mostPublished.institution_count,
      leaders,
      text: `${getDisplayName(mostPublished.fee_category)} is the fee the most institutions publish (${count(mostPublished.institution_count)}), with a median of ${formatFeeAmount(mostPublished.median_amount)}.`,
    });
  }

  const cpiRow = cpiFinding(cpi);
  if (cpiRow) findings.push(cpiRow);

  return findings;
}

/**
 * The subhead's opening, without its date. A count label with no digits (the unavailable
 * placeholder) drops the count clause instead of reading "of — banks".
 */
export function subheadLead(institutionsLabel: string): string {
  return hasFigure(institutionsLabel)
    ? `Median fees from the published fee schedules of ${institutionsLabel} banks and credit unions`
    : "Median fees from the published fee schedules of U.S. banks and credit unions";
}

/** The Dataset JSON-LD description, with the category count only when it is known. */
export function datasetDescription(categoriesLabel: string): string {
  return hasFigure(categoriesLabel)
    ? `National medians across ${categoriesLabel} bank and credit union fee categories, from published fee schedules.`
    : "National medians across bank and credit union fee categories, from published fee schedules.";
}

/** One Fed district's median for a fee. A district below the minimum sample has no median. */
export interface DistrictMedian {
  district: number;
  name: string;
  median: number | null;
  institutions: number;
}

/**
 * The by-district breakdown of a fee category detail read (the cached read /fees/overdraft
 * and the homepage already make), in district order, with thin districts left without a median.
 */
export function districtMedians(rows: DimensionBreakdown[] | null | undefined): DistrictMedian[] {
  return (rows ?? [])
    .map((row) => {
      const district = Number.parseInt(row.dimension_value.replace(/\D+/g, ""), 10);
      const thin = row.median_amount === null || row.count < MIN_INSTITUTIONS_FOR_MEDIAN;
      return {
        district,
        name: DISTRICT_NAMES[district] ?? row.dimension_value,
        median: thin ? null : Number(row.median_amount),
        institutions: row.count,
      };
    })
    .filter((row) => Number.isInteger(row.district) && DISTRICT_NAMES[row.district])
    .sort((a, b) => a.district - b.district);
}

/**
 * The national median the district map compares against, from the same category detail read
 * as the district medians (sourced rows, one value per institution), the way /fees/[category]
 * takes its headline. Null when that read has no sourced rows.
 */
export function detailNationalMedian(category: string, fees: FeeInstance[] | null | undefined): number | null {
  const rows = (fees ?? []).filter((f) => f.source_document_id !== null).map((f) => ({ ...f, fee_category: category }));
  if (rows.length === 0) return null;
  return summarizeFees(rows).median_amount;
}

import type { CpiContext } from "@/lib/data-store/financial";
import type { IndexEntry } from "@/lib/data-store/fee-index";
import { getDisplayName } from "@/lib/fee-taxonomy";
import { formatFeeAmount } from "@/lib/format";

/**
 * The few sentences the national page leads with. Every figure comes from the live national
 * index (the shared public snapshot of published_fee_catalog) or the BLS CPI rows the page
 * already reads; a finding whose figure is missing is left out rather than filled in.
 */
export interface NationalFinding {
  key: "overdraft" | "most_published" | "cpi";
  text: string;
}

const count = (n: number) => n.toLocaleString("en-US");

function hasMedian(e: IndexEntry): e is IndexEntry & { median_amount: number } {
  return e.median_amount !== null && e.maturity_tier !== "insufficient";
}

/** "+1%" style figures for the CPI sentence, one decimal at most. */
function pct(value: number): string {
  return `${Number(Math.abs(value).toFixed(1))}%`;
}

function cpiSentence(cpi: CpiContext): string | null {
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
  return `Prices for bank services ${bank} in the year to ${month}, against ${all} in all consumer prices.`;
}

export function nationalFindings(index: IndexEntry[], cpi: CpiContext): NationalFinding[] {
  const findings: NationalFinding[] = [];
  const priced = index.filter(hasMedian);

  const overdraft = priced.find((e) => e.fee_category === "overdraft");
  if (overdraft) {
    findings.push({
      key: "overdraft",
      text: `The median overdraft fee is ${formatFeeAmount(overdraft.median_amount)}, across ${count(overdraft.institution_count)} banks and credit unions that publish one.`,
    });
  }

  const mostPublished = priced.reduce<(typeof priced)[number] | null>(
    (top, e) => (top === null || e.institution_count > top.institution_count ? e : top),
    null,
  );
  if (mostPublished && mostPublished.fee_category !== "overdraft") {
    findings.push({
      key: "most_published",
      text: `${getDisplayName(mostPublished.fee_category)} is the fee the most institutions publish (${count(mostPublished.institution_count)}), with a median of ${formatFeeAmount(mostPublished.median_amount)}.`,
    });
  }

  const cpiText = cpiSentence(cpi);
  if (cpiText) findings.push({ key: "cpi", text: cpiText });

  return findings;
}

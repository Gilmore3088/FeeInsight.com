import { cache } from "react";
import { getFeesByInstitution, getPublicInstitutionById } from "@/lib/data-store";
import type { ExtractedFee } from "@/lib/data-store/types";
import type { InstitutionFeeScheduleEvidence } from "@/lib/data-store/institution";
import { formatFeeAmount } from "@/lib/format";
import { NON_PAID_ITEM_OVERDRAFT_PATTERN } from "@/lib/institution-rating";
import type { DisplayFee } from "./fee-schedule-table";
import { getRateFeesByInstitution, type RateFee } from "@/lib/data-store/rate-fees";
import { rateDisplayParts } from "@/lib/percent-fees";
import { feeDisplayName } from "@/lib/fee-display-name";

export const getPublicInstitutionForPage = cache(getPublicInstitutionById);

/** Published catalog fees, minus rejected rows. Cached so metadata and page share one query. */
export const getVisibleFeesForPage = cache(async (institutionId: number): Promise<ExtractedFee[]> => {
  try {
    const fees = await getFeesByInstitution(institutionId);
    return fees.filter((fee) => fee.review_status !== "rejected");
  } catch (error) {
    console.error("Institution page published fees failed:", error);
    return [];
  }
});

/** Live fees stated as a rate ("1.1% of the transaction"), read apart from dollar fees. */
export const getRateFeesForPage = cache(async (institutionId: number): Promise<RateFee[]> => {
  try {
    return await getRateFeesByInstitution(institutionId);
  } catch (error) {
    console.error("Institution page rate fees failed:", error);
    return [];
  }
});

/** Rate fees as table rows: the rate shows in the amount column and never meets a dollar benchmark. */
export function toRateDisplayFees(fees: RateFee[]): DisplayFee[] {
  return fees.map((fee) => ({
    id: `rate-${fee.id}`,
    feeName: fee.fee_name,
    feeCategory: fee.fee_category,
    amount: null,
    frequency: fee.frequency,
    conditions: fee.conditions,
    status: "verified",
    sourceUrl: fee.source_url,
    rate: rateDisplayParts(fee),
  }));
}

export function isVerifiedFee(fee: ExtractedFee): boolean {
  return fee.review_status === "approved";
}

export function toDisplayFees(fees: ExtractedFee[]): DisplayFee[] {
  return fees.map((fee) => ({
    id: `catalog-${fee.id}`,
    feeName: feeDisplayName(fee.fee_name, fee.fee_category),
    feeCategory: fee.fee_category ?? null,
    amount: fee.amount,
    frequency: fee.frequency,
    conditions: fee.conditions,
    status: isVerifiedFee(fee) ? "verified" : "provisional",
    sourceUrl: fee.source_url ?? null,
    account: fee.account ?? null,
  }));
}

const PIPELINE_PREVIEW_LIMIT = 18;

/** Under-review rows from the collection pipeline, used only when the catalog is empty. */
export function toPipelineDisplayFees(evidence: InstitutionFeeScheduleEvidence | null): DisplayFee[] {
  if (!evidence) return [];
  const verified: DisplayFee[] = evidence.verified_fee_preview
    .filter((fee) => fee.review_status !== "rejected")
    .map((fee) => ({
      id: `verified-${fee.fee_verified_id}`,
      feeName: feeDisplayName(fee.fee_name, fee.canonical_fee_key),
      feeCategory: fee.canonical_fee_key,
      amount: fee.amount,
      frequency: fee.frequency,
      conditions: null,
      status: "provisional",
      sourceUrl: fee.source_url,
    }));
  const raw: DisplayFee[] = evidence.raw_fee_preview.map((fee) => ({
    id: `raw-${fee.fee_raw_id}`,
    feeName: fee.fee_name,
    feeCategory: null,
    amount: fee.amount,
    frequency: fee.frequency,
    conditions: fee.conditions,
    status: "provisional",
    sourceUrl: fee.source_url,
  }));
  return [...verified, ...raw].slice(0, PIPELINE_PREVIEW_LIMIT);
}

export interface HeadlineFees {
  overdraft: number | null;
  nsf: number | null;
  monthly: number | null;
  /** The highest monthly amount when accounts differ; the title then shows the range. */
  monthlyHigh?: number | null;
}

/** One verified row behind a headline line. */
export interface HeadlineRow {
  id: number;
  amount: number;
  feeName: string;
  /** The account a monthly fee belongs to; null for other lines or when no record names it. */
  account: string | null;
  minBalanceToAvoid: number | null;
  waiverText: string | null;
  sourceUrl: string | null;
}

/**
 * One headline line: the amount the title and summary lead with (`pick`), the other verified
 * amounts for the same line (`others`, lowest first), and the range they span.
 */
export interface HeadlineLine {
  pick: HeadlineRow;
  others: HeadlineRow[];
  low: number;
  high: number;
}

export interface HeadlineLines {
  overdraft: HeadlineLine | null;
  nsf: HeadlineLine | null;
  monthly: HeadlineLine | null;
}

const MONTHLY_MAINTENANCE_NAME = /monthly|maintenance|service charge|service fee/i;
// "check" as a word only: "Check Printing" and "Cashier's Check" are not account fees, but
// "Everyday Checking Monthly service fee" is (it left Wells Fargo's headline on its one
// unnamed $5 row, Oct 9 2026).
const NOT_A_MONTHLY_FEE = /fax|photocop|copy|per page|statement|research|wire|\bchecks?\b|card/i;

/** A monthly headline must be a recurring account fee, not a per-page or per-item charge in the same category. */
function isMonthlyMaintenanceFee(fee: ExtractedFee): boolean {
  const frequency = (fee.frequency ?? "").toLowerCase();
  const name = fee.fee_name ?? "";
  if (NOT_A_MONTHLY_FEE.test(name)) return false;
  return frequency === "monthly" || MONTHLY_MAINTENANCE_NAME.test(name);
}

function toHeadlineRow(fee: ExtractedFee): HeadlineRow {
  return {
    id: fee.id,
    amount: fee.amount as number,
    feeName: feeDisplayName(fee.fee_name, fee.fee_category),
    account: fee.account?.name ?? null,
    minBalanceToAvoid: fee.account?.minBalanceToAvoid ?? null,
    waiverText: fee.account?.waiverText ?? null,
    sourceUrl: fee.source_url ?? null,
  };
}

/**
 * Every verified row for one line with a positive amount, then the representative one:
 * the lowest for monthly maintenance (an institution's accounts run "from" it), the highest
 * for overdraft and NSF (the standard charge, as fee-stats.ts compares overdraft). Ties go
 * to the row whose fee name sorts first, so the pick is stable.
 */
function headlineLine(
  fees: ExtractedFee[],
  category: string,
  pick: "lowest" | "highest",
  exclude?: RegExp,
  require?: (fee: ExtractedFee) => boolean,
): HeadlineLine | null {
  const rows = fees
    .filter(
      (fee) =>
        fee.fee_category === category &&
        fee.amount !== null &&
        fee.amount > 0 &&
        !(exclude && exclude.test(fee.fee_name)) &&
        (!require || require(fee)),
    )
    .map(toHeadlineRow)
    .sort((a, b) => a.amount - b.amount || a.feeName.localeCompare(b.feeName) || a.id - b.id);
  if (rows.length === 0) return null;
  const chosen = pick === "lowest" ? rows[0] : rows.reduce((top, row) => (row.amount > top.amount ? row : top));
  // The same name and amount twice (one schedule read from two pages) is one product.
  const seen = new Set([`${chosen.feeName.toLowerCase()}|${chosen.amount}`]);
  const others = rows.filter((row) => {
    const key = `${row.feeName.toLowerCase()}|${row.amount}`;
    if (row === chosen || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { pick: chosen, others, low: rows[0].amount, high: rows[rows.length - 1].amount };
}

/**
 * The headline lines for the page title, its search summary and the headline panel.
 * Exact fee_category only — no name matching, so "Overdraft Fee - Per Transfer" can never
 * stand in for the paid-item overdraft charge. The methodology page states this rule
 * (src/app/(public)/methodology/page.tsx, "Headline and benchmark values").
 */
export function pickHeadlineLines(verifiedFees: ExtractedFee[]): HeadlineLines {
  return {
    overdraft: headlineLine(verifiedFees, "overdraft", "highest", NON_PAID_ITEM_OVERDRAFT_PATTERN),
    nsf: headlineLine(verifiedFees, "nsf", "highest"),
    monthly: headlineLine(verifiedFees, "monthly_maintenance", "lowest", undefined, isMonthlyMaintenanceFee),
  };
}

/** Top verified amounts for the page title: overdraft, NSF, monthly maintenance. */
export function pickHeadlineFees(verifiedFees: ExtractedFee[]): HeadlineFees {
  return headlineAmounts(pickHeadlineLines(verifiedFees));
}

export function headlineAmounts(lines: HeadlineLines): HeadlineFees {
  return {
    overdraft: lines.overdraft?.pick.amount ?? null,
    nsf: lines.nsf?.pick.amount ?? null,
    monthly: lines.monthly?.pick.amount ?? null,
    monthlyHigh: lines.monthly && lines.monthly.high !== lines.monthly.low ? lines.monthly.high : null,
  };
}

export function buildProfileTitle(institutionName: string, headline: HeadlineFees): string {
  const monthly =
    headline.monthly === null
      ? null
      : headline.monthlyHigh != null && headline.monthlyHigh !== headline.monthly
        ? `Monthly ${formatFeeAmount(headline.monthly)}\u2013${formatFeeAmount(headline.monthlyHigh)}`
        : `Monthly ${formatFeeAmount(headline.monthly)}`;
  const parts = [
    headline.overdraft !== null ? `Overdraft ${formatFeeAmount(headline.overdraft)}` : null,
    headline.nsf !== null ? `NSF ${formatFeeAmount(headline.nsf)}` : null,
    monthly,
  ].filter((part): part is string => Boolean(part));
  if (parts.length === 0) return `${institutionName} Fees and Fee Schedule`;
  return `${institutionName} Fees: ${parts.join(", ")} (${new Date().getFullYear()})`;
}

/** "wellsfargo.com/checking/clear-access-banking/account-fees-summary": where a row was read. */
export function sourcePageLabel(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/+$/, "");
    return `${parsed.hostname.replace(/^www\./, "")}${path}`;
  } catch {
    return null;
  }
}

/** "Everyday Checking", or a plain statement that the record does not name the account. */
function accountPhrase(row: HeadlineRow): string {
  return row.account ?? "an account the record does not name";
}

/**
 * The search summary (meta description). It names the account behind the monthly figure and
 * says when other accounts cost more, so a product's fee never reads as the bank-wide fee.
 */
export function buildProfileDescription(
  institutionName: string,
  place: string | null,
  lines: HeadlineLines,
  siteName: string,
): string {
  const facts: string[] = [];
  if (lines.overdraft) facts.push(`overdraft ${formatFeeAmount(lines.overdraft.pick.amount)}`);
  if (lines.nsf) facts.push(`NSF ${formatFeeAmount(lines.nsf.pick.amount)}`);
  const monthly = lines.monthly;
  if (monthly) {
    const accounts = monthly.others.length + 1;
    const othersLabel = accounts - 1 === 1 ? "another account" : `${accounts - 1} other accounts`;
    facts.push(
      monthly.others.length === 0
        ? `monthly fee ${formatFeeAmount(monthly.pick.amount)} for ${accountPhrase(monthly.pick)}`
        : monthly.high === monthly.low
          ? `monthly fee ${formatFeeAmount(monthly.pick.amount)} for ${accountPhrase(monthly.pick)} and ${othersLabel}`
          : `monthly fee from ${formatFeeAmount(monthly.pick.amount)} for ${accountPhrase(monthly.pick)}; ${othersLabel} ${otherRange(monthly)}`,
    );
  }
  const lead = `Published fees for ${institutionName}${place ? ` (${place})` : ""}, from its own fee schedule`;
  return `${lead}${facts.length > 0 ? `: ${facts.join("; ")}` : ""}. National benchmarks from ${siteName}.`;
}

/** "$15–$35" or "$15" for the accounts other than the headline one. */
export function otherRange(line: HeadlineLine): string {
  const amounts = line.others.map((row) => row.amount);
  const low = Math.min(...amounts);
  const high = Math.max(...amounts);
  return low === high ? formatFeeAmount(low) ?? "" : `${formatFeeAmount(low)}\u2013${formatFeeAmount(high)}`;
}

/**
 * The location tag's parts with their fee pages: the city page only when this institution
 * has approved fees (so the city page lists it and exists) and the city name survives the
 * city page's slug (no hyphens); the state's fee report whenever the state is known.
 */
export function buildLocationParts(input: {
  city: string | null;
  stateCode: string | null;
  stateName: string | null;
  hasApprovedFees: boolean;
}): Array<{ label: string; href: string | null }> {
  const parts: Array<{ label: string; href: string | null }> = [];
  const code = input.stateCode?.toUpperCase() ?? null;
  if (input.city) {
    const linkable = input.hasApprovedFees && code !== null && !input.city.includes("-");
    parts.push({
      label: input.city,
      href: linkable ? `/fees/city/${code.toLowerCase()}/${encodeURIComponent(input.city.toLowerCase())}` : null,
    });
  }
  if (input.stateName) parts.push({ label: input.stateName, href: code ? `/research/state/${code}` : null });
  return parts;
}

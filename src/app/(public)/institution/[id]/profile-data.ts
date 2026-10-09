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
}

const MONTHLY_MAINTENANCE_NAME = /monthly|maintenance|service charge|service fee/i;
const NOT_A_MONTHLY_FEE = /fax|photocop|copy|per page|statement|research|wire|check|card/i;

function pickAmount(
  fees: ExtractedFee[],
  category: string,
  exclude?: RegExp,
  require?: (fee: ExtractedFee) => boolean,
): number | null {
  const match = fees.find(
    (fee) =>
      fee.fee_category === category &&
      fee.amount !== null &&
      fee.amount > 0 &&
      !(exclude && exclude.test(fee.fee_name)) &&
      (!require || require(fee)),
  );
  return match?.amount ?? null;
}

/** A monthly headline must be a recurring account fee, not a per-page or per-item charge in the same category. */
function isMonthlyMaintenanceFee(fee: ExtractedFee): boolean {
  const frequency = (fee.frequency ?? "").toLowerCase();
  const name = fee.fee_name ?? "";
  if (NOT_A_MONTHLY_FEE.test(name)) return false;
  return frequency === "monthly" || MONTHLY_MAINTENANCE_NAME.test(name);
}

/**
 * Top verified amounts for the page title: overdraft, NSF, monthly maintenance.
 * Exact fee_category only — no name matching, so "Overdraft Fee - Per Transfer"
 * can never stand in for the paid-item overdraft charge.
 */
export function pickHeadlineFees(verifiedFees: ExtractedFee[]): HeadlineFees {
  return {
    overdraft: pickAmount(verifiedFees, "overdraft", NON_PAID_ITEM_OVERDRAFT_PATTERN),
    nsf: pickAmount(verifiedFees, "nsf"),
    monthly: pickAmount(verifiedFees, "monthly_maintenance", undefined, isMonthlyMaintenanceFee),
  };
}

export function buildProfileTitle(institutionName: string, headline: HeadlineFees): string {
  const parts = [
    headline.overdraft !== null ? `Overdraft ${formatFeeAmount(headline.overdraft)}` : null,
    headline.nsf !== null ? `NSF ${formatFeeAmount(headline.nsf)}` : null,
    headline.monthly !== null ? `Monthly ${formatFeeAmount(headline.monthly)}` : null,
  ].filter((part): part is string => Boolean(part));
  if (parts.length === 0) return `${institutionName} Fees and Fee Schedule`;
  return `${institutionName} Fees: ${parts.join(", ")} (${new Date().getFullYear()})`;
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

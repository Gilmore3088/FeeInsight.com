/**
 * Pro is priced by the size of the institution it covers (James, 8 Oct 2026): three tiers
 * by total assets, each one plan for up to 5 people. Annual is ten monthly payments, so it
 * comes with two months free. Consultants and other organizations with no assets of their
 * own pay NON_INSTITUTION_TIER.
 *
 * Pure: no database or Stripe import, so the pricing page, checkout and tests share it.
 */

export type ProPlan = "monthly" | "annual";
export type ProTier = "small" | "mid" | "large";

export interface ProTierDef {
  key: ProTier;
  /** "Under $500M in assets" */
  assetsLabel: string;
  /** Where the tier starts: "$500M" (null for the first tier). */
  fromLabel: string | null;
  monthlyUsd: number;
  annualUsd: number;
}

/** `institution_sources.asset_size` is in thousands of dollars, as call reports file it. */
const MID_FROM_THOUSANDS = 500_000;
const LARGE_FROM_THOUSANDS = 2_000_000;

export const PRO_TIERS: readonly ProTierDef[] = [
  { key: "small", assetsLabel: "Under $500M in assets", fromLabel: null, monthlyUsd: 150, annualUsd: 1_500 },
  { key: "mid", assetsLabel: "$500M to $2B in assets", fromLabel: "$500M", monthlyUsd: 300, annualUsd: 3_000 },
  { key: "large", assetsLabel: "Over $2B in assets", fromLabel: "$2B", monthlyUsd: 500, annualUsd: 5_000 },
];

/** The tier for consultants and other organizations that are not a bank or credit union. */
export const NON_INSTITUTION_TIER: ProTier = "mid";

/**
 * Hamilton reports a month on the consultant plan (James, 8 Oct 2026). Past it, a consultant
 * moves to CONSULTANT_UPGRADE_TIER's price, which has no monthly report cap.
 */
export const CONSULTANT_MONTHLY_REPORTS = 10;
export const CONSULTANT_UPGRADE_TIER: ProTier = "large";

const WHOLE_DOLLARS = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const CENTS = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function isProPlan(value: string | undefined | null): value is ProPlan {
  return value === "monthly" || value === "annual";
}

export function isProTier(value: string | undefined | null): value is ProTier {
  return PRO_TIERS.some((tier) => tier.key === value);
}

export function proTier(key: ProTier): ProTierDef {
  const tier = PRO_TIERS.find((candidate) => candidate.key === key);
  if (!tier) throw new Error(`Unknown Pro tier: ${key}`);
  return tier;
}

/** The tier for an institution's total assets (thousands of dollars); null when unknown. */
export function tierForAssets(assetsThousands: number | null | undefined): ProTier | null {
  if (assetsThousands === null || assetsThousands === undefined) return null;
  if (!Number.isFinite(assetsThousands) || assetsThousands < 0) return null;
  if (assetsThousands < MID_FROM_THOUSANDS) return "small";
  if (assetsThousands < LARGE_FROM_THOUSANDS) return "mid";
  return "large";
}

export function tierPriceUsd(tier: ProTier, plan: ProPlan): number {
  const def = proTier(tier);
  return plan === "monthly" ? def.monthlyUsd : def.annualUsd;
}

/** "$150" or "$1,500" */
export function tierAmountLabel(tier: ProTier, plan: ProPlan): string {
  return WHOLE_DOLLARS.format(tierPriceUsd(tier, plan));
}

/** "$150/mo" or "$1,500/yr" */
export function tierPriceLabel(tier: ProTier, plan: ProPlan): string {
  return `${tierAmountLabel(tier, plan)}${plan === "monthly" ? "/mo" : "/yr"}`;
}

/** Months the annual plan saves against twelve monthly payments: 2 for every tier today. */
export function annualMonthsFree(tier: ProTier): number {
  const def = proTier(tier);
  return Math.round(12 - def.annualUsd / def.monthlyUsd);
}

/**
 * The annual plan as a monthly figure, to the cent when it isn't whole: "$125", "$416.67"
 * ($5,000 / 12; James, Oct 16: not "$416"). A label only: checkout charges the annual price itself.
 */
export function annualPerMonthLabel(tier: ProTier): string {
  const cents = Math.round((proTier(tier).annualUsd * 100) / 12);
  return cents % 100 === 0 ? WHOLE_DOLLARS.format(cents / 100) : CENTS.format(cents / 100);
}

/**
 * Total assets as call reports file them (thousands of dollars), for the line that explains a
 * price: "$4.44B", "$705.55B", "$499M". Cut, never rounded up, so a figure just under a tier's
 * start never reads as the start itself.
 */
export function reportedAssetsLabel(assetsThousands: number): string {
  const millions = assetsThousands / 1_000;
  if (millions >= 1_000) return `$${(Math.floor(millions / 10) / 100).toFixed(2)}B`;
  return `$${Math.floor(millions).toLocaleString("en-US")}M`;
}

/** "Q2 2026 FDIC call report" from a filing's date ("2026-06-30") and source ("fdic"). */
export function callReportLabel(reportDate: string, source: string): string | null {
  const match = /^(\d{4})-(\d{2})-\d{2}/.exec(reportDate);
  if (!match) return null;
  const quarter = Math.ceil(Number(match[2]) / 3);
  const regulator = source.toLowerCase() === "ncua" ? "NCUA" : source.toLowerCase() === "fdic" ? "FDIC" : null;
  return `Q${quarter} ${match[1]}${regulator ? ` ${regulator}` : ""} call report`;
}

/**
 * The figure behind the price, beside its tier (James, Oct 16: "Latest call report" is too vague
 * for the number that sets the bill): "Over $2B in assets: $4.44B reported in its Q2 2026 FDIC call report".
 */
export function assetsDetail(tierLabel: string, assetsThousands: number, report: { reportDate: string; source: string } | null): string {
  const filing = report ? callReportLabel(report.reportDate, report.source) : null;
  const assets = reportedAssetsLabel(assetsThousands);
  return filing ? `${tierLabel}: ${assets} reported in its ${filing}` : `${tierLabel}: ${assets} in total assets on file`;
}

/** What the annual plan saves against twelve monthly payments: "$300". */
export function annualSavingsLabel(tier: ProTier): string {
  const def = proTier(tier);
  return WHOLE_DOLLARS.format(def.monthlyUsd * 12 - def.annualUsd);
}

/** "$1,500 to $5,000 a year" */
export const PRO_ANNUAL_RANGE_LABEL = `${WHOLE_DOLLARS.format(PRO_TIERS[0].annualUsd)} to ${WHOLE_DOLLARS.format(
  PRO_TIERS[PRO_TIERS.length - 1].annualUsd,
)} a year`;

/** The Vercel variable holding the Stripe price for a tier and plan, e.g. STRIPE_PRO_SMALL_ANNUAL_PRICE_ID. */
export function proPriceEnvVar(tier: ProTier, plan: ProPlan): string {
  return `STRIPE_PRO_${tier.toUpperCase()}_${plan.toUpperCase()}_PRICE_ID`;
}

/** Stripe lookup key for a tier and plan, e.g. pro_small_annual (src/lib/stripe-prices.ts). */
export function proLookupKey(tier: ProTier, plan: ProPlan): string {
  return `pro_${tier}_${plan}`;
}

/** The Stripe product the tier prices live on. */
export const PRO_PRODUCT_NAME = "Fee Insight Pro";

/** A price id set by Vercel variable, or null; when null, src/lib/stripe-prices.ts sets one up. */
export function proPriceId(tier: ProTier, plan: ProPlan): string | null {
  return process.env[proPriceEnvVar(tier, plan)]?.trim() || null;
}

/** "Consultants and other organizations pay $300/mo or $3,000/yr, including 10 Hamilton reports a month; ..." */
export const CONSULTANT_PRICE_NOTE = `Consultants and other organizations pay ${tierPriceLabel(
  NON_INSTITUTION_TIER,
  "monthly",
)} or ${tierPriceLabel(NON_INSTITUTION_TIER, "annual")}, including ${CONSULTANT_MONTHLY_REPORTS} Hamilton reports a month; for more, it's ${tierPriceLabel(
  CONSULTANT_UPGRADE_TIER,
  "annual",
)} with no monthly report limit.`;

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
  monthlyUsd: number;
  annualUsd: number;
}

/** `institution_sources.asset_size` is in thousands of dollars, as call reports file it. */
const MID_FROM_THOUSANDS = 500_000;
const LARGE_FROM_THOUSANDS = 2_000_000;

export const PRO_TIERS: readonly ProTierDef[] = [
  { key: "small", assetsLabel: "Under $500M in assets", monthlyUsd: 150, annualUsd: 1_500 },
  { key: "mid", assetsLabel: "$500M to $2B in assets", monthlyUsd: 300, annualUsd: 3_000 },
  { key: "large", assetsLabel: "Over $2B in assets", monthlyUsd: 500, annualUsd: 5_000 },
];

/** The tier for consultants and other organizations that are not a bank or credit union. */
export const NON_INSTITUTION_TIER: ProTier = "mid";

const WHOLE_DOLLARS = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

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

/** "$1,500 to $5,000 a year" */
export const PRO_ANNUAL_RANGE_LABEL = `${WHOLE_DOLLARS.format(PRO_TIERS[0].annualUsd)} to ${WHOLE_DOLLARS.format(
  PRO_TIERS[PRO_TIERS.length - 1].annualUsd,
)} a year`;

/** The Vercel variable holding the Stripe price for a tier and plan, e.g. STRIPE_PRO_SMALL_ANNUAL_PRICE_ID. */
export function proPriceEnvVar(tier: ProTier, plan: ProPlan): string {
  return `STRIPE_PRO_${tier.toUpperCase()}_${plan.toUpperCase()}_PRICE_ID`;
}

/** The configured Stripe price id, or null until James creates it and sets the variable. */
export function proPriceId(tier: ProTier, plan: ProPlan): string | null {
  return process.env[proPriceEnvVar(tier, plan)]?.trim() || null;
}

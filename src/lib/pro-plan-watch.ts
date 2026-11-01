import { PRO_TIERS, tierForAssets, type ProTier } from "@/lib/pro-tiers";

/**
 * Plan watch list (James, 8 Oct 2026): Pro is priced by the bank the buyer picks, so a large
 * bank could pick a small one. Nothing is blocked at checkout; instead the Customers room
 * lists paid plans whose signals don't fit the bank they paid for, and James decides whether
 * to move them to the right price (/subscribe says we may, after an email).
 *
 * Pure: the data-store and Stripe reads live in `getPlanWatchList` (pro-plan-watch-store.ts).
 */

export interface WatchInstitution {
  id: number;
  name: string;
  websiteUrl: string | null;
  assetsThousands: number | null;
}

export interface PlanWatchInput {
  email: string | null;
  paidTier: ProTier | null;
  /** True for the consultant / other-organization plan, which may cover any bank. */
  otherOrganization: boolean;
  /** The buyer picked the size band because the institution had no asset size on file. */
  tierPickedByBuyer?: boolean;
  paidInstitution: WatchInstitution | null;
  /** Institutions this account ran Pro requests on in the look-back window, one entry each. */
  requestedInstitutions: WatchInstitution[];
  /**
   * Institutions whose website is on the buyer's email domain (security review, 2026-11-01): the
   * bank the buyer most likely works for, whichever bank or plan they picked at checkout.
   */
  emailInstitutions?: WatchInstitution[];
}

/** "jane@mail.firstbank.com" -> "firstbank.com"; null when there is no usable domain. */
export function baseDomain(host: string | null | undefined): string | null {
  if (!host) return null;
  const cleaned = host
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .split(/[/?#:]/)[0]
    .replace(/^www\./, "");
  const labels = cleaned.split(".").filter(Boolean);
  if (labels.length < 2) return null;
  return labels.slice(-2).join(".");
}

export function emailDomain(email: string | null | undefined): string | null {
  if (!email || !email.includes("@")) return null;
  return baseDomain(email.split("@").pop());
}

function tierRank(tier: ProTier): number {
  return PRO_TIERS.findIndex((def) => def.key === tier);
}

function assetsLabel(thousands: number | null): string {
  if (thousands === null) return "size unknown";
  const dollars = thousands * 1_000;
  if (dollars >= 1e9) return `$${(dollars / 1e9).toFixed(1)}B`;
  return `$${Math.round(dollars / 1e6)}M`;
}

/** Plain reasons a paid plan may be on the wrong price; empty when nothing looks off. */
export function planWatchReasons(input: PlanWatchInput): string[] {
  if (!input.paidTier) return [];
  const reasons: string[] = [];
  const paidRank = tierRank(input.paidTier);

  // The buyer's own bank, found by email domain, is priced above the plan they paid for. This
  // also covers the other-organization plan, which no bank's assets price.
  const emailBank = (input.emailInstitutions ?? [])
    .filter((institution) => institution.id !== input.paidInstitution?.id)
    .map((institution) => ({ institution, tier: tierForAssets(institution.assetsThousands) }))
    .filter((match): match is { institution: WatchInstitution; tier: ProTier } =>
      match.tier !== null && tierRank(match.tier) > paidRank)
    .sort((a, b) => tierRank(b.tier) - tierRank(a.tier))[0];
  if (emailBank) {
    const plan = input.otherOrganization ? "the other-organization plan" : `the ${input.paidTier} tier`;
    reasons.push(
      `Email is @${emailDomain(input.email)}, the website of ${emailBank.institution.name} (${assetsLabel(emailBank.institution.assetsThousands)}), which is priced above ${plan}`,
    );
  }

  if (input.otherOrganization || !input.paidInstitution) return reasons;
  const paid = input.paidInstitution;

  if (input.tierPickedByBuyer) {
    const band = PRO_TIERS.find((def) => def.key === input.paidTier)?.assetsLabel ?? input.paidTier;
    reasons.push(`No asset size on file for ${paid.name}; the buyer picked "${band}"`);
  }

  const mail = emailDomain(input.email);
  const site = baseDomain(paid.websiteUrl);
  if (mail && site && mail !== site) {
    reasons.push(`Email is @${mail}, but ${paid.name}'s website is ${site}`);
  }

  const larger = input.requestedInstitutions.filter((institution) => {
    if (institution.id === paid.id) return false;
    const tier = tierForAssets(institution.assetsThousands);
    return tier !== null && tierRank(tier) > paidRank;
  });
  if (larger.length > 0) {
    const named = larger
      .slice(0, 3)
      .map((institution) => `${institution.name} (${assetsLabel(institution.assetsThousands)})`)
      .join(", ");
    const more = larger.length > 3 ? ` and ${larger.length - 3} more` : "";
    reasons.push(`Ran Pro work on larger institutions than the plan covers: ${named}${more}`);
  }
  return reasons;
}

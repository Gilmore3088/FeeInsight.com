import { isInPaymentGrace } from "@/lib/access";
import type { User } from "@/lib/auth";
import { tierAmountLabel, type ProTier } from "@/lib/pro-tiers";

/**
 * Self-serve API keys for Pro subscribers (James, 16 Oct 2026): the $300 and $500 plans
 * (and consultants, who pay the $300 price) include the API and the Claude connector; the
 * $150 plan does not. The payer's keys live on an organization of their own, so the existing
 * per-organization allowance (pro, 10,000 calls a month) applies unchanged. The payer and each
 * team seat on their workspace hold one key each there, and the team shares that allowance.
 *
 * Partner keys made by hand in /admin/api-keys live on `api-` organizations
 * (organizationSlug) and are untouched by anything here.
 */
export const SUBSCRIBER_ORG_PREFIX = "pro-user-";

/** Plans whose subscription includes the API. Consultants pay the "mid" price. */
export const API_INCLUDED_TIERS: readonly ProTier[] = ["mid", "large"];

/** Calls a month on a Pro key (the `pro` tier in api-rate-limit.ts). */
export const API_MONTHLY_CALLS = 10_000;
export const API_MONTHLY_CALLS_LABEL = API_MONTHLY_CALLS.toLocaleString("en-US");

/**
 * Calls a minute per plan (per organization, or per anonymous caller), on top of the monthly
 * allowance. Enterprise keys are exempt, as they are from the monthly count.
 */
export const BURST_CALLS_PER_MINUTE = 60;

/** "$300 and $500 plans": the monthly prices of the plans that include the API. */
export const API_PLANS_LABEL = `${API_INCLUDED_TIERS.map((tier) => tierAmountLabel(tier, "monthly")).join(" and ")} plans`;

export function apiIncludedInTier(tier: ProTier | null | undefined): boolean {
  return tier != null && API_INCLUDED_TIERS.includes(tier);
}

export function subscriberOrgSlug(userId: number): string {
  return `${SUBSCRIBER_ORG_PREFIX}${userId}`;
}

/** The subscriber a key's organization belongs to, or null for a hand-made partner key. */
export function subscriberUserIdFromSlug(slug: string | null | undefined): number | null {
  if (!slug?.startsWith(SUBSCRIBER_ORG_PREFIX)) return null;
  const rest = slug.slice(SUBSCRIBER_ORG_PREFIX.length);
  if (!/^\d+$/.test(rest)) return null;
  const id = Number(rest);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * Each person on a plan that includes the API (the payer and every team seat) holds one key,
 * named for them, on the payer's organization, so the whole team shares one allowance.
 */
const KEY_NAME_PREFIX = "Pro user ";

export function subscriberKeyName(userId: number): string {
  return `${KEY_NAME_PREFIX}${userId}`;
}

/** The person a subscriber key belongs to; null for a key with another name (the payer's own). */
export function subscriberKeyUserId(name: string | null | undefined): number | null {
  if (!name?.startsWith(KEY_NAME_PREFIX)) return null;
  const rest = name.slice(KEY_NAME_PREFIX.length);
  if (!/^\d+$/.test(rest)) return null;
  const id = Number(rest);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

interface SubscriptionFields {
  subscription_status: string | null;
  past_due_since?: string | null;
}

/**
 * Whether a subscriber's key may answer calls right now: while Pro is active, and while a
 * failed card is inside the same past-due grace window the site itself uses. A canceled or
 * lapsed subscription stops the key on its next call. The plan check happens when the key
 * is made, and a move down to the $150 plan revokes it (reconcileSubscription).
 */
export function subscriberKeyAllowed(user: SubscriptionFields | null, now: Date = new Date()): boolean {
  if (!user) return false;
  if (user.subscription_status === "active") return true;
  return isInPaymentGrace(user as unknown as User, now);
}

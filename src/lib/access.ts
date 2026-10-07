import type { User } from "@/lib/auth";
import { TAXONOMY_COUNT, getSpotlightCategories } from "@/lib/fee-taxonomy";

/** Days a past_due subscriber keeps access while Stripe retries the card. */
export const PAST_DUE_GRACE_DAYS = 7;

/** True while a past_due subscriber is inside the grace window. */
export function isInPaymentGrace(user: User | null, now: Date = new Date()): boolean {
  if (!user || user.subscription_status !== "past_due") return false;
  // Unknown start (column not yet migrated, or set before it existed): grant grace.
  if (!user.past_due_since) return true;
  const since = new Date(user.past_due_since).getTime();
  if (!Number.isFinite(since)) return true;
  return now.getTime() - since < PAST_DUE_GRACE_DAYS * 24 * 60 * 60 * 1000;
}

/** A past_due subscriber whose grace window has ended. */
export function isPaymentLapsed(user: User | null, now: Date = new Date()): boolean {
  return Boolean(user && user.subscription_status === "past_due" && !isInPaymentGrace(user, now));
}

/** Full premium access for app data, exports, and Hamilton workflows. */
export function canAccessPremium(user: User | null): boolean {
  if (!user) return false;
  if (user.role === "admin" || user.role === "analyst") return true;
  if (hasTeamSeat(user)) return true;
  return user.subscription_status === "active" || isInPaymentGrace(user);
}

/**
 * Holds a seat on a paid institution account (owner included): an active workspace member
 * whose workspace owner's subscription is active or in past-due grace. The flag is loaded
 * with the user (`hasWorkspaceSeat` in auth.ts) and is false when it could not be read.
 */
export function hasTeamSeat(user: User | null): boolean {
  return user?.workspace_seat === true;
}

/** No daily cap on Hamilton questions; the shared provider spend breaker still applies. */
export const UNLIMITED_RESEARCH_QUERIES = Number.POSITIVE_INFINITY;

/** Can see the full fee catalog (free sees the spotlight categories only). */
export function canAccessAllCategories(user: User | null): boolean {
  return canAccessPremium(user);
}

/** Can use peer filters (charter, tier, district). */
export function canAccessPeerFilters(user: User | null): boolean {
  return canAccessPremium(user);
}

/** Can export CSV/bulk data. */
export function canExportData(user: User | null): boolean {
  return canAccessPremium(user);
}

/** Self-serve account API-key controls are disabled while keys require manual workspace setup. */
export function canAccessApiKey(user: User | null): boolean {
  void user;
  return false;
}

/** Can see full district data (Beige Book, indicators, speeches). */
export function canAccessFullDistrict(user: User | null): boolean {
  return canAccessPremium(user);
}

/**
 * Number of fee categories visible to this user.
 *
 * Both figures derive from the taxonomy. The catalog is a curated subset that changes
 * as categories are added or retired, so no count is hardcoded here or advertised in
 * copy — see `docs/plans/guides-remediation-plan-2026-08-15.md`, item E-5.
 */
export function getVisibleCategoryCount(user: User | null): number {
  return canAccessPremium(user) ? TAXONOMY_COUNT : getSpotlightCategories().length;
}

/** Daily Hamilton analysis query limit. */
export function getResearchQueryLimit(user: User | null): number {
  if (!user) return 0;
  // Team seats, the owner included, have no daily question cap.
  if (hasTeamSeat(user)) return UNLIMITED_RESEARCH_QUERIES;
  if (user.role === "admin") return 200;
  if (user.role === "analyst") return 50;
  if (canAccessPremium(user)) return 50;
  return 3; // free registered users
}

import { FEE_FAMILIES } from "@/lib/fee-taxonomy";
import { sanitizeInternalRedirect } from "@/lib/safe-redirect";
import type { ProPlan } from "@/app/subscribe/pricing";
import { checkoutPathFor } from "./checkout-path";

/**
 * Two shapes of the same signup. A consumer arriving from a guide is asked for an
 * email and a password; a professional (buying a plan, accepting a workspace invite,
 * or coming from a Pro page) is also asked about their organization.
 */
export type RegisterVariant = "consumer" | "professional";

export interface RegisterIntent {
  plan: ProPlan | null;
  from?: string | null;
  intent?: string | null;
  category?: string | null;
}

const TAXONOMY = new Set(Object.values(FEE_FAMILIES).flat());

/** Return paths that mean the reader is signing up for professional work. */
const PROFESSIONAL_PATH_PREFIXES = ["/pro", "/subscribe", "/workspace-invite", "/for-institutions", "/account/welcome"];

/** The fee category the signup is about, only when it is a real taxonomy key. */
export function registerCategoryFor(category: string | null | undefined): string | null {
  const value = category?.trim() ?? "";
  return TAXONOMY.has(value) ? value : null;
}

export function registerVariantFor({ plan, from, intent }: RegisterIntent): RegisterVariant {
  if (plan || intent === "professional") return "professional";
  const path = from ? sanitizeInternalRedirect(from, "") : "";
  if (path && PROFESSIONAL_PATH_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}?`))) {
    return "professional";
  }
  return "consumer";
}

/**
 * Where a new account lands. A plan goes straight to checkout; an explicit return path
 * is honoured; a reader who came from a guide about one fee goes to the institution
 * lookup focused on that fee, which is the guide's promised next step.
 */
export function registerDestinationFor({ plan, from, category }: RegisterIntent): string {
  if (plan) return checkoutPathFor(plan, from);
  if (from) {
    const sanitized = sanitizeInternalRedirect(from, "");
    if (sanitized) return sanitized;
  }
  const focus = registerCategoryFor(category);
  if (focus) return `/institutions?fee=${encodeURIComponent(focus)}`;
  return "/account";
}

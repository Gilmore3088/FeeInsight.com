import type { User } from "@/lib/auth";
import { canAccessPremium } from "@/lib/access";
import type { SessionChrome } from "@/components/use-session-chrome";

/**
 * What the site chrome needs to draw itself for this user, never the full user record.
 * Served by /api/session, and passed straight to the header by server layouts that already
 * know the user (Hamilton), so Pro readers never see the public nav first.
 */
export function sessionChromeFor(user: User | null): SessionChrome {
  if (!user) return { signedIn: false };
  const initial = (user.institution_name?.[0] || user.email?.[0] || user.username?.[0] || "U").toUpperCase();
  return {
    signedIn: true,
    initial,
    isStaff: user.role === "admin" || user.role === "analyst",
    isPro: canAccessPremium(user),
    role: user.role,
  };
}

import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
import { NextResponse } from "next/server";
import { getCurrentUser, renewSessionCookie } from "@/lib/auth";
import { canAccessPremium } from "@/lib/access";

export const dynamic = "force-dynamic";

/**
 * Minimal session state for the site chrome.
 *
 * The public layout and consumer nav render statically so that guide pages can be
 * prerendered; anything that depends on who is signed in is fetched from here by a client
 * island after hydration. This returns only what the chrome needs to draw itself — never
 * the full user record.
 */
async function handleGET(): Promise<NextResponse> {
  const headers = { "Cache-Control": "private, no-store" };
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ signedIn: false }, { headers });
    // Sliding sessions: every page that mounts the site chrome calls this endpoint after
    // hydration, so refreshing the cookie here keeps an active reader signed in.
    await renewSessionCookie().catch(() => {});
    const initial = (
      user.institution_name?.[0] ||
      user.email?.[0] ||
      user.username?.[0] ||
      "U"
    ).toUpperCase();
    return NextResponse.json(
      {
        signedIn: true,
        initial,
        isStaff: user.role === "admin" || user.role === "analyst",
        isPro: canAccessPremium(user),
        role: user.role,
      },
      { headers },
    );
  } catch {
    return NextResponse.json({ signedIn: false }, { headers });
  }
}

export const GET = withApiRoutePolicy("api.session", "GET", handleGET);

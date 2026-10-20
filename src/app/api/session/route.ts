import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, getCurrentUser, renewSessionCookie } from "@/lib/auth";
import { sessionChromeFor } from "@/lib/session-chrome";

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
    return NextResponse.json(sessionChromeFor(user), { headers });
  } catch {
    return NextResponse.json({ signedIn: false }, { headers });
  }
}

/**
 * A request with no session cookie is signed out; say so without touching the database (no
 * session lookup, no audit row). Most page views are anonymous, and each one asks this route.
 */
function signedOutWithoutCookie(request: Request | undefined): Response | null {
  const cookieHeader = request?.headers.get("cookie") ?? "";
  const hasSession = cookieHeader.split(";").some((part) => part.trim().startsWith(`${SESSION_COOKIE}=`));
  if (hasSession) return null;
  return NextResponse.json({ signedIn: false }, { headers: { "Cache-Control": "private, no-store" } });
}

export const GET = withApiRoutePolicy<[Request]>("api.session", "GET", handleGET, {
  answerWithoutDatabase: signedOutWithoutCookie,
});

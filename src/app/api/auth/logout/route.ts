import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
import type { NextRequest } from "next/server";
import { logout } from "@/lib/auth";
import { sanitizeInternalRedirect } from "@/lib/safe-redirect";

/**
 * The one sign-out. Every sign-out control is a plain form posting here, so it works after a
 * redeploy (a Server Action from an older build fails with no visible error) and the full page
 * load that follows redraws the header signed out. `next` picks the landing page.
 */
async function handlePOST(request: NextRequest) {
  const form = await request.formData().catch(() => null);
  const next = form?.get("next");
  await logout();
  const destination = sanitizeInternalRedirect(typeof next === "string" ? next : null, "/");
  // 303 so the browser follows with a GET (a 307 re-posts the form to the page), to a
  // same-site path so it lands on the host the reader is on.
  return new Response(null, {
    status: 303,
    headers: { Location: destination, "Cache-Control": "no-store" },
  });
}

export const POST = withApiRoutePolicy("api.auth.logout", "POST", handlePOST);

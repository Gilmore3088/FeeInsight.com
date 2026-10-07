import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
import { NextRequest, NextResponse } from "next/server";
import { READER_COOKIE } from "@/lib/email/subscription-token";
import { knownReaderEmail } from "@/lib/leads/known-reader";

export const dynamic = "force-dynamic";

/**
 * The confirmed reader in this browser, so the free report form can skip asking for the
 * email again. A cookie that no longer matches a confirmed, subscribed address is cleared.
 */
async function handleGET(request: NextRequest) {
  const email = await knownReaderEmail(request).catch(() => null);
  const response = NextResponse.json({ email }, { headers: { "Cache-Control": "private, no-store" } });
  if (!email && request.cookies.has(READER_COOKIE)) response.cookies.delete(READER_COOKIE);
  return response;
}

export const GET = withApiRoutePolicy("api.leads.reader", "GET", handleGET);

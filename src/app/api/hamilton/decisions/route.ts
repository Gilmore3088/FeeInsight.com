import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
/**
 * GET /api/hamilton/decisions?institutionId=
 *
 * The reader's decisions for the selected institution, newest first, and the ledger
 * summed over them (dollars only from options chosen on the bank's own figures).
 *
 * Auth: premium/admin. No provider calls.
 */

import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canAccessPremium } from "@/lib/access";
import { decisionsOverview } from "@/lib/hamilton/decision-service";

export const dynamic = "force-dynamic";

async function handleGET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !canAccessPremium(user)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await decisionsOverview(user, request.nextUrl.searchParams.get("institutionId"));
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    console.error("[hamilton-decisions] list failed", error);
    return NextResponse.json({ error: "Decisions could not be loaded just now." }, { status: 500 });
  }
}

export const GET = withApiRoutePolicy("api.hamilton.decisions", "GET", handleGET);

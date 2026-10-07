import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
/**
 * POST /api/hamilton/ask/market
 *
 * The Ask bar's answer to a local-market question ("who are my local competitors and
 * locations"): the market, its institutions with branches, deposits and published fees, and
 * where the bank's own branches are. Body: { institutionId? }.
 *
 * Auth: premium/admin. Deterministic: no provider calls, so no AI quota is spent.
 */

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canAccessPremium } from "@/lib/access";
import { resolveHamiltonInstitutionContext } from "@/lib/hamilton/workspace-context";
import { getLocalMarketAnswer } from "@/lib/hamilton/local-market-answer";

async function handlePOST(request: Request) {
  const user = await getCurrentUser();
  if (!user || !canAccessPremium(user)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as { institutionId?: unknown } | null;
  const instId = typeof body?.institutionId === "number" || typeof body?.institutionId === "string" ? body.institutionId : null;
  try {
    const resolved = await resolveHamiltonInstitutionContext({ userId: user.id, instId, persistUrlSelection: false });
    if (!resolved.institution) {
      return NextResponse.json({ error: resolved.error ?? "Choose an institution first." }, { status: 400 });
    }
    const answer = await getLocalMarketAnswer(Number(resolved.institution.id));
    if (!answer) {
      return NextResponse.json({ error: "No branch market is on file for this institution yet." }, { status: 404 });
    }
    return NextResponse.json(answer);
  } catch (error) {
    console.error("[hamilton-ask-market] failed", error);
    return NextResponse.json({ error: "Hamilton could not load your market just now." }, { status: 500 });
  }
}

export const POST = withApiRoutePolicy("api.hamilton.ask.market", "POST", handlePOST);

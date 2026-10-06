import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
/**
 * POST /api/hamilton/deliverables
 *
 * "Turn this into". Body: { kind, decisionIds }, where kind is ceo_onepager, board_memo,
 * pricing_packet, competitive_appendix, regulatory_summary or implementation_checklist.
 * Returns the deliverable's sections, built only from sourced figures, the reader's
 * tested prices, management's choice (when one was made) and the implementation plan,
 * with each decision's provenance as an appendix. Logged on each decision.
 *
 * Auth: premium/admin. No provider calls.
 */

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canAccessPremium } from "@/lib/access";
import { makeDeliverable } from "@/lib/hamilton/decision-service";

async function handlePOST(request: Request) {
  const user = await getCurrentUser();
  if (!user || !canAccessPremium(user)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: { kind?: unknown; decisionIds?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  try {
    const result = await makeDeliverable(user, body?.kind, body?.decisionIds);
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    console.error("[hamilton-deliverables] failed", error);
    return NextResponse.json({ error: "The deliverable could not be built just now." }, { status: 500 });
  }
}

export const POST = withApiRoutePolicy("api.hamilton.deliverables", "POST", handlePOST);

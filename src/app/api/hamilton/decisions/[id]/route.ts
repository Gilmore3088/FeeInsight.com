import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
/**
 * GET  /api/hamilton/decisions/[id]  The decision, its log and the state of its watches.
 * POST /api/hamilton/decisions/[id]  { action: "choose", amount, decidedOn? } records the
 *      amount management chose with its implementation plan and watches;
 *      { action: "status", status } moves it to implementing, monitoring or closed.
 *
 * Hamilton never chooses: "choose" records the reader's amount. Auth: premium/admin.
 * No provider calls.
 */

import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canAccessPremium } from "@/lib/access";
import { chooseOption, decisionDetail, moveDecision } from "@/lib/hamilton/decision-service";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

async function handleGET(_request: NextRequest, context: Context) {
  const user = await getCurrentUser();
  if (!user || !canAccessPremium(user)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await context.params;
  try {
    const result = await decisionDetail(user, id);
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    console.error("[hamilton-decisions] detail failed", error);
    return NextResponse.json({ error: "That decision could not be loaded just now." }, { status: 500 });
  }
}

async function handlePOST(request: NextRequest, context: Context) {
  const user = await getCurrentUser();
  if (!user || !canAccessPremium(user)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await context.params;
  let body: { action?: unknown; amount?: unknown; decidedOn?: unknown; status?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  try {
    const result =
      body?.action === "choose"
        ? await chooseOption(user, id, body.amount, body.decidedOn)
        : body?.action === "status"
          ? await moveDecision(user, id, body.status)
          : { status: 400, body: { error: 'Send action "choose" or "status".' } };
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    console.error("[hamilton-decisions] update failed", error);
    return NextResponse.json({ error: "That decision could not be updated just now." }, { status: 500 });
  }
}

export const GET = withApiRoutePolicy("api.hamilton.decisions.detail", "GET", handleGET);
export const POST = withApiRoutePolicy("api.hamilton.decisions.detail", "POST", handlePOST);

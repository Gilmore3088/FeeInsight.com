import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
/**
 * POST /api/hamilton/ask/memo
 *
 * Hamilton's written memo over the storyline the Ask bar just returned. Body: the same
 * { institutionId?, question, objective?, decisionId? } sent to /api/hamilton/ask; the
 * storyline is rebuilt on the server, never taken from the browser.
 * Returns { status: "written", memo } | { status: "withheld" | "unavailable", reason }.
 *
 * Auth: premium/admin. Calls the model: counts against the reader's daily AI quota and
 * Hamilton's provider budget. Every figure is traced to the storyline before it is shown.
 */

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canAccessPremium } from "@/lib/access";
import { answerAskMemo, type AskBody } from "@/lib/hamilton/ask-service";
import { checkProAiQuota, quotaExceededMessage } from "@/lib/hamilton/quota";
import { isProviderLimitError } from "@/lib/ai-provider";
import { HAMILTON_PAUSED_MESSAGE } from "@/lib/hamilton/provider-paused";

async function handlePOST(request: Request) {
  const user = await getCurrentUser();
  if (!user || !canAccessPremium(user)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: AskBody;
  try {
    body = (await request.json()) as AskBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const quota = await checkProAiQuota(user);
  if (!quota.allowed) {
    return NextResponse.json({ status: "unavailable", reason: quotaExceededMessage(quota) }, { status: 200 });
  }
  try {
    const result = await answerAskMemo(user, body);
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    console.error("[hamilton-ask-memo] failed", error);
    if (isProviderLimitError(error)) {
      // The storyline already shown stands; only the written memo is paused.
      return NextResponse.json({ status: "unavailable", reason: HAMILTON_PAUSED_MESSAGE }, { status: 200 });
    }
    return NextResponse.json({ error: "Hamilton could not write that up just now." }, { status: 500 });
  }
}

export const POST = withApiRoutePolicy("api.hamilton.ask.memo", "POST", handlePOST);

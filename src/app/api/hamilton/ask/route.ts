import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
/**
 * POST /api/hamilton/ask
 *
 * The Ask bar. Body: { institutionId?, question?, objective?, decisionId?, answer?: { fieldKey, value } }.
 * Returns a PeerListResponse for an institution-list task, or an AskResponse:
 * a research answer, a scenario, an opinion (only with an
 * objective) or one clarifying question, plus the decisionId it was logged to.
 * An `answer` saves the reader's reply to Hamilton's question to memory.
 *
 * Auth: premium/admin. Deterministic: no provider calls, so no AI quota is spent.
 */

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canAccessPremium } from "@/lib/access";
import { answerAsk, type AskBody } from "@/lib/hamilton/ask-service";
import { answerPeerList } from "@/lib/hamilton/peer-list-service";
import { savePeerResearchSnapshot } from "@/lib/hamilton/peer-list-snapshots";

async function handlePOST(request: Request) {
  const user = await getCurrentUser();
  if (!user || !canAccessPremium(user)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: AskBody & { savePeerResearchSnapshot?: unknown; expectedPeerList?: unknown };
  try {
    body = (await request.json()) as AskBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  try {
    if (body.savePeerResearchSnapshot === true) {
      // Never store browser-supplied lists. Recompute exactly this turn and compare
      // its dated peer/source evidence before saving a user-scoped immutable snapshot.
      const refreshed = await answerPeerList(user, body, false);
      if (!refreshed || refreshed.peerList.status !== "ready")
        return NextResponse.json({ error: "Original peer selection is no longer available. Run it again before saving." }, { status: 409 });
      const saved = await savePeerResearchSnapshot(user, body.question, refreshed, body.expectedPeerList);
      if (!saved) return NextResponse.json({ error: "The selection or published evidence changed. Re-run before saving." }, { status: 409 });
      return NextResponse.json({ savedAnalysisId: saved });
    }
    const peerList = await answerPeerList(user, body);
    if (peerList) return NextResponse.json(peerList);
    const result = await answerAsk(user, body);
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    console.error("[hamilton-ask] failed", error);
    return NextResponse.json({ error: "Hamilton could not answer that just now." }, { status: 500 });
  }
}

export const POST = withApiRoutePolicy("api.hamilton.ask", "POST", handlePOST);

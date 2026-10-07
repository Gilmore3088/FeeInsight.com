import { NextRequest, NextResponse } from "next/server";
import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { getContentDraft } from "@/lib/data-store/content-drafts";
import { depthCard, spreadCard, type DepthFacts, type SpreadFacts } from "@/lib/agents/content/cards";

export const dynamic = "force-dynamic";

/** A draft's square card, drawn only from the facts stored with it. */
async function handleGET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user, "view")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  const draft = await getContentDraft(Number(id));
  if (!draft) return NextResponse.json({ error: "Draft not found" }, { status: 404 });

  if (draft.facts.kind === "depth") return depthCard(draft.facts as unknown as DepthFacts, draft.asOf);
  const facts = draft.facts as unknown as SpreadFacts;
  const values = Array.isArray(facts.values) ? facts.values.map(Number) : [];
  if (values.length === 0) return NextResponse.json({ error: "This draft has no values to draw" }, { status: 422 });
  return spreadCard(facts, values, draft.asOf);
}

export const GET = withApiRoutePolicy("api.admin.content.card", "GET", handleGET);

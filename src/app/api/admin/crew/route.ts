import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { crewMember, getCrewFeed, getCrewStatus } from "@/lib/agents/crew";
import type { AdminAgent } from "@/lib/agents/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Live crew roster and plain-English activity log for the admin crew page (polled). */
async function handleGET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user, "operate")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const agentParam = request.nextUrl.searchParams.get("agent");
  const agent = agentParam && crewMember(agentParam) ? (agentParam as AdminAgent) : null;
  const [crew, feed] = await Promise.all([getCrewStatus(), getCrewFeed({ agent, limit: 40 })]);
  return NextResponse.json({ crew, feed, generatedAt: new Date().toISOString() });
}

export const GET = withApiRoutePolicy("api.admin.crew", "GET", handleGET);

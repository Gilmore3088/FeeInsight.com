import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
import { NextResponse } from "next/server";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { getFlowSnapshot, getFlowWaiting } from "@/lib/agents/flow";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Live flow for the admin Live page (polled): latest institution moves, current work, and cached queue sizes. */
async function handleGET() {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user, "view")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const [snapshot, waiting] = await Promise.all([getFlowSnapshot(), getFlowWaiting().catch(() => null)]);
  return NextResponse.json({ ...snapshot, waiting });
}

export const GET = withApiRoutePolicy("api.admin.flow", "GET", handleGET);

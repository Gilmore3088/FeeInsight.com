import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
import { NextResponse } from "next/server";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { getFlowSnapshot, getFlowWaitingWithin } from "@/lib/agents/flow";

export const dynamic = "force-dynamic";
export const revalidate = 0;
/**
 * One poll of the Live page never holds a pool connection for long (#2016): on 2026-10-18 polls
 * waited the platform's full 300 s on a saturated pool. The snapshot's reads stop after 10 s and
 * the waiting counts are waited for 3 s at most (`lib/agents/flow.ts`).
 */
export const maxDuration = 30;

/** Live flow for the admin Live page (polled): latest institution moves, current work, and cached queue sizes. */
async function handleGET() {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user, "view")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // `waiting` is null when the cached counts are not ready in time; the page keeps its last counts.
  const [snapshot, waiting] = await Promise.all([getFlowSnapshot(), getFlowWaitingWithin()]);
  return NextResponse.json({ ...snapshot, waiting });
}

export const GET = withApiRoutePolicy("api.admin.flow", "GET", handleGET);

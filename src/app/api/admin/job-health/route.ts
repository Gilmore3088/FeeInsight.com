import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
// External pipeline health endpoint for uptime monitors (Better Stack, UptimeRobot,
// Uptime Kuma). Returns 200 when the agent pipeline is ticking, draining, and
// publishing; 503 with plain-language `problems` otherwise, so a plain HTTP check
// is enough to alert. Counts only — no institution or fee data is exposed.

import { NextResponse } from "next/server";
import { pipelineHealthProblems } from "@/lib/job-health";
import { getPipelineHealth } from "@/lib/pipeline-health";

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function handleGET() {
  const health = await getPipelineHealth();
  const problems = pipelineHealthProblems(health);
  return NextResponse.json(
    { ok: problems.length === 0, problems, ...health },
    { status: problems.length > 0 ? 503 : 200 },
  );
}

export const GET = withApiRoutePolicy("api.admin.job_health", "GET", handleGET);

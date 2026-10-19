import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
// External pipeline health endpoint for uptime monitors (Better Stack, UptimeRobot,
// Uptime Kuma). Returns 200 when the agent pipeline is ticking, draining, and
// publishing; 503 with plain-language `problems` otherwise, so a plain HTTP check
// is enough to alert. Counts only — no institution or fee data is exposed.

import { NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { pipelineHealthProblems } from "@/lib/job-health";
import { getPipelineHealth } from "@/lib/pipeline-health";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * How long one health read answers every caller. The endpoint needs no sign-in and each read
 * runs three queries at once (three of an instance's five pool connections), so an anonymous
 * caller polling it could hold the pool; a monitor checking every minute still sees each change.
 */
const JOB_HEALTH_CACHE_SECONDS = 60;

const cachedPipelineHealth = unstable_cache(getPipelineHealth, ["job-health-pipeline-v1"], {
  revalidate: JOB_HEALTH_CACHE_SECONDS,
});

async function readPipelineHealth() {
  try {
    return await cachedPipelineHealth();
  } catch (error) {
    // Outside a Next request (tests) there is no incremental cache; read directly.
    if (error instanceof Error && error.message.startsWith("Invariant: incrementalCache missing")) {
      return getPipelineHealth();
    }
    throw error;
  }
}

async function handleGET() {
  const health = await readPipelineHealth();
  const problems = pipelineHealthProblems(health);
  return NextResponse.json(
    { ok: problems.length === 0, problems, ...health },
    { status: problems.length > 0 ? 503 : 200 },
  );
}

export const GET = withApiRoutePolicy("api.admin.job_health", "GET", handleGET);

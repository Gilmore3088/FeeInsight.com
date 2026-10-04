import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { matchesConfiguredCronSecret } from "@/lib/cron-secret";
import { REGISTRY_SOURCES } from "@/lib/agents/magellan/registry";
import { registryPartitionsBySource, startRegistryRun } from "@/lib/agents/registry-scheduler";

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function isAuthorized(request: NextRequest): Promise<boolean> {
  if (matchesConfiguredCronSecret(request.headers.get("authorization"))) return true;
  if (matchesConfiguredCronSecret(request.headers.get("x-cron-secret"))) return true;
  const user = await getCurrentUser();
  return Boolean(user && hasPermission(user, "trigger_jobs"));
}

/**
 * Queue one regulatory-registry partition as a visible Magellan run. The cron
 * tick executes it; this route never fetches regulator data itself.
 * Body: { source, partition_key?, dry_run? }. Without a partition_key the
 * source's newest partition is used.
 */
async function handlePOST(request: NextRequest) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await request.json().catch(() => ({}))) as {
    source?: unknown;
    partition_key?: unknown;
    dry_run?: unknown;
  };
  const source = typeof body.source === "string" ? body.source : "";
  if (!REGISTRY_SOURCES.some((entry) => entry.source === source)) {
    return NextResponse.json(
      { error: "Unknown registry source", sources: REGISTRY_SOURCES.map((entry) => entry.source) },
      { status: 400 },
    );
  }
  const partitions = registryPartitionsBySource(new Date()).find((entry) => entry.source === source)?.partitions ?? [];
  const requested = typeof body.partition_key === "string" ? body.partition_key.trim() : "";
  const partitionKey = requested || partitions[0];
  if (!partitionKey || (requested && !partitions.includes(requested))) {
    return NextResponse.json({ error: "Unknown partition for this source", partitions: partitions.slice(0, 20) }, { status: 400 });
  }
  const user = await getCurrentUser();
  const started = await startRegistryRun({
    source,
    partitionKey,
    triggeredBy: user ? `admin:${user.id}` : "api.admin.registry.run",
    triggerSource: "admin",
    dryRun: body.dry_run === true,
  });
  return NextResponse.json({
    ok: true,
    runId: started.run.id,
    status: started.run.status,
    reused: started.reused,
    source,
    partitionKey,
  });
}

export const POST = withApiRoutePolicy("api.admin.registry.run", "POST", handlePOST);

import { NextRequest, NextResponse } from "next/server";
import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { startAgentRun } from "@/lib/agents/run-store";
import { registryLedgerAgent } from "@/lib/agents/registry-scheduler";
import {
  HMDA_IDENTITY_REPAIR_STEP_KEY,
  parseHmdaRepairParams,
} from "@/lib/agents/hoovie/hmda-identity-repair";
import { HMDA_REPAIR_WRITES_ENABLED } from "@/lib/agents/hoovie/hmda-repair-release";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const MAX_BODY_BYTES = 4_096;

/** Bound bytes while reading, including requests with no trustworthy length header. */
async function readConfigurationBody(request: NextRequest): Promise<string> {
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_BODY_BYTES)) {
    throw new Error("Invalid configuration body length");
  }
  if (!request.body) throw new Error("Missing configuration body");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new Error("Configuration body exceeds byte bound");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (bytes === 0) throw new Error("Missing configuration body");
  return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
}

/**
 * Queue the committed, digest-pinned HMDA identity review as one manual-only step.
 * No scheduler or cron-secret access; this request never executes the repair.
 * Advance explicitly through /api/admin/agents/runs/[id]/execute after review.
 */
async function handlePOST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user, "trigger_jobs")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let text: string;
  try {
    text = await readConfigurationBody(request);
  } catch {
    return NextResponse.json({ error: "Body must be a JSON object under 4,096 bytes." }, { status: 400 });
  }
  let params: ReturnType<typeof parseHmdaRepairParams>;
  try {
    params = parseHmdaRepairParams(JSON.parse(text));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid repair configuration." }, { status: 400 });
  }

  if (params.mode !== "preview" && !HMDA_REPAIR_WRITES_ENABLED) {
    return NextResponse.json({ error: "HMDA identity apply and rollback are not enabled. A separately reviewed authorization and release are required." }, { status: 423 });
  }

  const ledger = await registryLedgerAgent();
  const title = `HMDA identity repair: ${params.mode} reviewed 10-bank cohort`;
  const started = await startAgentRun({
    agent: ledger.agent,
    kind: params.mode === "preview" ? "dry_run" : "manual_repair",
    title,
    params: { ...params, ...(ledger.fallback ? { ledger_agent_fallback: ledger.fallback } : {}) },
    triggeredBy: `admin:${user.id}`,
    triggerSource: "admin",
    idempotencyKey: `hmda:identity:${params.manifest_digest}:${params.mode}${params.mode === "rollback" ? `:${params.apply_event_id}` : ""}`,
    reuseTerminal: true,
    steps: [{ key: HMDA_IDENTITY_REPAIR_STEP_KEY, agent: ledger.agent, title, input: { ...params } }],
    summary: "Explicit reviewed HMDA identity scope; manual execution only, no provider work. The cron tick cannot advance this step.",
  });

  return NextResponse.json({
    ok: true,
    runId: started.run.id,
    status: started.run.status,
    reused: started.reused,
    mode: params.mode,
    manifestDigest: params.manifest_digest,
    manualExecutionRequired: true,
  }, { status: 202 });
}

export const POST = withApiRoutePolicy("api.admin.registry.hmda-identity-repair", "POST", handlePOST);

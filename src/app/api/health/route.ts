import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
import { NextResponse } from "next/server";
import { sql } from "@/lib/data-store/connection";
import { cachedPublicRead } from "@/lib/data-store/public-read-cache";

/**
 * The live fee count, cached with the other public reads (refreshed when Hamilton publishes, at
 * most an hour old). Counting published_fee_catalog rebuilds the whole view, which an anonymous
 * caller could repeat as fast as it liked; the liveness check below stays a one-row ping.
 */
const liveFeeCount = cachedPublicRead("health-live-fee-count", async (): Promise<number> => {
  const [row] = await sql<{ cnt: number }[]>`SELECT COUNT(*)::int AS cnt FROM published_fee_catalog`;
  return Number(row?.cnt ?? 0);
});

function machineErrorCode(error: unknown): string {
  try {
    const code = error !== null && (typeof error === "object" || typeof error === "function")
      ? (error as { code?: unknown }).code : undefined;
    return typeof code === "string" && code.length > 0 && code.length <= 32 && !/[^A-Z0-9_]/.test(code) ? code : "unknown";
  } catch {
    // A thrown proxy/getter must not turn the generic failure response into another error.
    return "unknown";
  }
}

async function handleGET() {
  let stage: "database_ping" | "live_fee_count" = "database_ping";
  try {
    await sql`SELECT 1`;
    stage = "live_fee_count";
    const feeCount = await liveFeeCount();

    return NextResponse.json({
      status: "ok",
      fee_count: feeCount,
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    try {
      // Never log arbitrary messages, SQL, connection strings, causes or stacks here.
      console.error("Health check failed", { stage, code: machineErrorCode(e) });
    } catch {
      // Logging availability must not change the public failure contract.
    }
    return NextResponse.json(
      { status: "error", message: "Service temporarily unavailable" },
      { status: 503 }
    );
  }
}

export const GET = withApiRoutePolicy("api.health", "GET", handleGET);

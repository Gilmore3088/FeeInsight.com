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

async function handleGET() {
  try {
    await sql`SELECT 1`;
    const feeCount = await liveFeeCount();

    return NextResponse.json({
      status: "ok",
      fee_count: feeCount,
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    return NextResponse.json(
      { status: "error", message: String(e) },
      { status: 503 }
    );
  }
}

export const GET = withApiRoutePolicy("api.health", "GET", handleGET);

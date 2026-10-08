import { NextRequest, NextResponse } from "next/server";
import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
import { insertMarketingTouch } from "@/lib/data-store/marketing-touches";
import { parseMarketingTouch } from "@/lib/marketing-touch";

/** A touch is seven short strings; anything bigger is not from our page. */
const MAX_BODY_BYTES = 2_048;

/**
 * Records one tracked-link visit (growth-os BUILD-PLAN 1.10). Called once per browser
 * session by MarketingTouchRecorder when the landing URL has utm_ tags. Stores the UTM
 * values, landing path and referring host only: no IP, user agent or visitor id.
 */
async function handlePOST(request: NextRequest) {
  const text = await request.text().catch(() => "");
  if (text.length === 0 || text.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Invalid touch" }, { status: 400 });
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Invalid touch" }, { status: 400 });
  }
  const touch = parseMarketingTouch(body);
  if (!touch) {
    return NextResponse.json({ error: "Invalid touch" }, { status: 400 });
  }
  try {
    await insertMarketingTouch(touch);
  } catch (error) {
    console.error("[api/track/touch] insert failed", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  return new NextResponse(null, { status: 204 });
}

export const POST = withApiRoutePolicy("api.track.touch", "POST", handlePOST);

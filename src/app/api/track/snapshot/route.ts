import { NextRequest, NextResponse } from "next/server";
import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
import { insertSnapshotEvent } from "@/lib/data-store/outreach-journey";
import { parseSnapshotEvent } from "@/lib/outreach-journey";

/** An event is an id, an event name and three short strings; anything bigger is not from our page. */
const MAX_BODY_BYTES = 1_024;

/**
 * Records one first-party event on a free market snapshot (/institution/<id>/market): opened,
 * a source schedule opened, another fee or a competitor looked at, a report request clicked.
 * Stores the institution, the event, a fee key and the link's UTM campaign and content only:
 * no IP, user agent or visitor id.
 */
async function handlePOST(request: NextRequest) {
  const text = await request.text().catch(() => "");
  if (text.length === 0 || text.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Invalid event" }, { status: 400 });
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Invalid event" }, { status: 400 });
  }
  const event = parseSnapshotEvent(body);
  if (!event) {
    return NextResponse.json({ error: "Invalid event" }, { status: 400 });
  }
  try {
    await insertSnapshotEvent(event);
  } catch (error) {
    console.error("[api/track/snapshot] insert failed", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  return new NextResponse(null, { status: 204 });
}

export const POST = withApiRoutePolicy("api.track.snapshot", "POST", handlePOST);

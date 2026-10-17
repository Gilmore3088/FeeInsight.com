import { NextResponse, type NextRequest } from "next/server";
import { STATE_NAMES } from "@/lib/us-states";

/**
 * The research hub's state picker submits here without scripts (/research/state?state=FL).
 * A known code goes to its report; anything else goes back to the picker.
 */
export function GET(request: NextRequest) {
  const code = (request.nextUrl.searchParams.get("state") ?? "").trim().toUpperCase();
  const target = /^[A-Z]{2}$/.test(code) && STATE_NAMES[code] ? `/research/state/${code}` : "/research#find";
  return NextResponse.redirect(new URL(target, request.url), 303);
}

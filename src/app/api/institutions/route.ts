import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
import { NextRequest, NextResponse } from "next/server";
import { autocompleteInstitutions } from "@/lib/data-store/search";

// Simple in-memory rate limiter for autocomplete: 60 requests/minute per IP
const searchBuckets = new Map<string, { count: number; resetAt: number }>();

setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of searchBuckets) {
    if (bucket.resetAt <= now) searchBuckets.delete(key);
  }
}, 5 * 60 * 1000);

function checkSearchRateLimit(ip: string): boolean {
  const now = Date.now();
  const windowMs = 60 * 1000;
  const maxRequests = 60;
  const bucket = searchBuckets.get(ip);
  if (!bucket || bucket.resetAt <= now) {
    searchBuckets.set(ip, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (bucket.count >= maxRequests) return false;
  bucket.count++;
  return true;
}

async function handleGET(request: NextRequest) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";

  if (!checkSearchRateLimit(ip)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  // autocompleteInstitutions bounds the term (literal, 2 to 100 characters) and the rows (8).
  const q = request.nextUrl.searchParams.get("q") || "";
  const results = await autocompleteInstitutions(q, 8);
  // The same public suggestions for every visitor: the edge answers a repeated query for five
  // minutes, so neither the read nor this route's audit row runs again.
  return NextResponse.json(results, {
    headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600" },
  });
}

export const GET = withApiRoutePolicy("api.institutions", "GET", handleGET);

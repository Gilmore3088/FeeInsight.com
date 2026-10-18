import { NextResponse } from "next/server";
import { getCityAutocomplete } from "@/lib/data-store";
import { boundedSearchTerm } from "@/lib/api-hardening/query-caps";

/** City names are public and the same for every visitor, so the edge answers repeats. */
const CACHE_HEADERS = { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" };

export async function GET(request: Request) {
  const url = new URL(request.url);
  // A city prefix: at most 64 characters with at least two letters, matched literally.
  const q = boundedSearchTerm(url.searchParams.get("q"), { max: 64 });

  if (!q) {
    return NextResponse.json([], { headers: CACHE_HEADERS });
  }

  const results = await getCityAutocomplete(q, 8);
  return NextResponse.json(results, { headers: CACHE_HEADERS });
}

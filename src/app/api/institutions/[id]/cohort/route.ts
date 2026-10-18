import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
import { NextResponse, type NextRequest } from "next/server";
import { getPublicInstitutionById } from "@/lib/data-store";
import { getFeeShareCohortCached, getInstitutionFinancialHistoryCached } from "@/lib/data-store/public-cached-reads";
import { buildCohortDistribution, searchCohort } from "@/app/(public)/institution/[id]/fee-share-cohort";

/** At most this many members in one answer; "Show all" asks for the whole listable cohort. */
const MAX_MEMBERS = 5000;
const SEARCH_LIMIT = 50;

interface RouteProps {
  params: Promise<{ id: string }>;
}

/**
 * The institution page's size cohort members (call-report filers of the same charter and asset
 * tier, the newest quarter it filed), for the strip's "Find a peer" search and "Show all". The page
 * ships only the bins and the nearest few; this answers the rest on demand. Same reads and the
 * same rules as the page: a share above zero counts, and a peer the site never names is left out.
 */
async function handleGET(request: NextRequest, { params }: RouteProps) {
  const { id } = await params;
  const institutionId = Number(id);
  if (!Number.isSafeInteger(institutionId) || institutionId <= 0) {
    return NextResponse.json({ error: "Invalid institution ID" }, { status: 400 });
  }
  const inst = await getPublicInstitutionById(institutionId).catch(() => null);
  if (!inst?.charter_type) return NextResponse.json({ error: "Institution not found" }, { status: 404 });
  const history = await getInstitutionFinancialHistoryCached(institutionId).catch(() => []);
  const newest = [...history]
    .filter((row) => row.source === "fdic" || row.source === "ncua")
    .sort((a, b) => b.report_date.localeCompare(a.report_date))[0];
  const rows = newest
    ? await getFeeShareCohortCached(inst.charter_type, inst.asset_size_tier ?? null, newest.report_date, newest.source).catch(() => null)
    : null;
  const cohort = buildCohortDistribution(rows, institutionId);
  if (!cohort) return NextResponse.json({ total: 0, members: [] });
  const all = request.nextUrl.searchParams.get("all") === "1";
  const query = (request.nextUrl.searchParams.get("q") ?? "").slice(0, 80);
  const result = searchCohort(cohort, all ? "" : query, all ? MAX_MEMBERS : SEARCH_LIMIT);
  return NextResponse.json(result, { headers: { "Cache-Control": "public, max-age=300, s-maxage=3600" } });
}

export const GET = withApiRoutePolicy("api.institutions.cohort", "GET", handleGET);

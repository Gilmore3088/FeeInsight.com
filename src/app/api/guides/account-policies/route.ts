import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
import { NextResponse } from "next/server";
import { MAX_COMPARED, getAccountPolicies, policySetOf } from "@/lib/data-store/overdraft-policies";

/**
 * Published policy lines for up to three institutions, for a guide's account comparison
 * (`set=overdraft` or `set=atm`). A client island calls it, so the guide page itself stays static and
 * identical for every reader. Public data only: the same rows the fee pages show.
 */
async function handleGET(request: Request): Promise<NextResponse> {
  const params = new URL(request.url).searchParams;
  const raw = params.get("ids") ?? "";
  const set = policySetOf(params.get("set"));
  const ids = raw
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((id) => Number.isSafeInteger(id) && id > 0)
    .slice(0, MAX_COMPARED);
  if (ids.length === 0) return NextResponse.json({ institutions: [] }, { status: 400 });

  try {
    const institutions = await getAccountPolicies(ids, set);
    return NextResponse.json(
      { institutions },
      { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } },
    );
  } catch {
    return NextResponse.json({ institutions: [] }, { status: 503 });
  }
}

export const GET = withApiRoutePolicy("api.guides.account_policies", "GET", handleGET);

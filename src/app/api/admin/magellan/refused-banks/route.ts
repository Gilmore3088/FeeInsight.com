import { NextRequest, NextResponse } from "next/server";

import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
import { getCurrentUser, hasPermission } from "@/lib/auth";
import { refusedHuntCsv } from "@/lib/agents/magellan/hand-supplied-files";
import { getRefusedBanks, REFUSED_LIST_DEFAULT_LIMIT } from "@/lib/data-store/refused-banks";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * The hand-download list as a browser hunt CSV (fix plan step 9): the largest active banks with
 * no live fees whose own site still refuses us (`getRefusedBanks`). A person downloads each
 * schedule once, renames it to the row's file_name and loads it with this CSV at
 * /admin/magellan/hand-supplied. `?limit=` up to 1,000. Admins only; read-only.
 */
async function handleGET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user, "edit")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const limit = Number(request.nextUrl.searchParams.get("limit") ?? REFUSED_LIST_DEFAULT_LIMIT);
  const banks = await getRefusedBanks({ limit: Number.isFinite(limit) ? limit : REFUSED_LIST_DEFAULT_LIMIT });
  const day = new Date().toISOString().slice(0, 10);
  return new NextResponse(refusedHuntCsv(banks), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="refused-banks-${day}.csv"`,
      "cache-control": "no-store",
    },
  });
}

export const GET = withApiRoutePolicy("api.admin.magellan.refused_banks", "GET", handleGET);

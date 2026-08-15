import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getSavedInstitutionFees } from "@/lib/data-store/alerts";
import { FEE_FAMILIES } from "@/lib/fee-taxonomy";

export const dynamic = "force-dynamic";

const TAXONOMY = new Set(Object.values(FEE_FAMILIES).flat());

/**
 * A signed-in reader's saved institutions, with their amount for one fee category.
 *
 * This exists so guide pages can render statically. The personalisation is fetched by a
 * client island after hydration rather than baked into the page, which keeps the guide
 * itself identical for every reader and cacheable at the edge.
 *
 * Signed-out callers get an empty list rather than a 401 — the island simply renders
 * nothing, and no guide content depends on the response.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const category = new URL(request.url).searchParams.get("category")?.trim() ?? "";
  if (!TAXONOMY.has(category)) {
    return NextResponse.json({ institutions: [] }, { status: 400 });
  }

  let user = null;
  try {
    user = await getCurrentUser();
  } catch {
    // No session, or the session store is unavailable.
  }
  if (!user) {
    return NextResponse.json(
      { institutions: [] },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  }

  try {
    const institutions = await getSavedInstitutionFees(user.id, category);
    return NextResponse.json(
      { institutions },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return NextResponse.json(
      { institutions: [] },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  }
}

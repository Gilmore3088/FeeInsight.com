import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
import { NextRequest, NextResponse } from "next/server";
import { getRecentPriceChanges } from "@/lib/data-store";
import { FEE_FAMILIES, getDisplayName } from "@/lib/fee-taxonomy";
import { logApiUsage } from "@/lib/api-usage";
import { API_ATTRIBUTION } from "@/lib/constants";
import { authorizePaidV1 } from "@/lib/api-v1-auth";
import { ApiParamError, apiError, apiOptions, intParam, withApiHeaders } from "@/lib/api-v1";

const KNOWN_CATEGORIES = new Set(Object.values(FEE_FAMILIES).flat());

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function handleGET(request: NextRequest) {
  const caller = await authorizePaidV1(request, "Fee changes");
  if (caller instanceof Response) return caller;
  const { organizationId, anonymousId, rateLimit } = caller;

  const { searchParams } = request.nextUrl;
  let days: number;
  let category: string | null;
  try {
    days = intParam(searchParams, "days", { fallback: 90, min: 1, max: 365 });
    category = searchParams.get("category")?.trim() || null;
    if (category !== null && !KNOWN_CATEGORIES.has(category)) {
      throw new ApiParamError("category must be a category key from /api/v1/fees, e.g. overdraft");
    }
  } catch (error) {
    if (error instanceof ApiParamError) {
      return apiError(400, "invalid_parameter", error.message, { rateLimit });
    }
    throw error;
  }

  const changes = await getRecentPriceChanges(days, category ?? undefined);

  logApiUsage(organizationId, anonymousId, "api.v1.fee_changes", {
    days,
    category,
    count: changes.length,
    status: 200,
  }).catch(() => {});

  return withApiHeaders(
    NextResponse.json({
      days,
      category,
      note: "Changes our monitoring detected when an institution's published fee schedule changed between reads. Coverage is still small and growing; at most 200 changes are returned, newest first.",
      count: changes.length,
      data: changes.map((c) => ({
        institution_id: Number(c.institution_id),
        institution_name: c.institution_name,
        category: c.fee_category,
        display_name: getDisplayName(c.fee_category),
        previous_amount: toNumberOrNull(c.previous_amount),
        new_amount: toNumberOrNull(c.new_amount),
        change: c.change_type,
        detected_at: c.detected_at,
      })),
      attribution: API_ATTRIBUTION,
    }),
    rateLimit,
  );
}

export const GET = withApiRoutePolicy("api.v1.fee_changes", "GET", handleGET);
export const OPTIONS = withApiRoutePolicy("api.v1.fee_changes", "OPTIONS", async () => apiOptions());

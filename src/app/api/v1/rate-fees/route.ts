import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
import { NextRequest, NextResponse } from "next/server";
import { listRateFees } from "@/lib/data-store/rate-fees";
import { apiFeeName } from "@/lib/fee-display-name";
import { FEE_FAMILIES, getDisplayName } from "@/lib/fee-taxonomy";
import { PERCENT_FEE_RANGES } from "@/lib/percent-fees";
import { logApiUsage } from "@/lib/api-usage";
import { API_ATTRIBUTION } from "@/lib/constants";
import { authorizeV1 } from "@/lib/api-v1-auth";
import {
  ApiParamError,
  apiError,
  apiOptions,
  charterParam,
  dateTimeParam,
  intParam,
  stateParam,
  withApiCaching,
  withApiHeaders,
} from "@/lib/api-v1";

// Every category key, plus the rate-only keys a rate may publish under (atm_international is not in a family).
const KNOWN_CATEGORIES = new Set([...Object.values(FEE_FAMILIES).flat(), ...Object.keys(PERCENT_FEE_RANGES)]);

const NOTE =
  "Fees each institution states as a percentage, such as a share of the transaction, read from its own fee schedule. " +
  "rate_percent is the rate in percent; rate_min_amount and rate_max_amount are dollar bounds when the schedule states them. " +
  "These are kept apart from dollar fees and never included in dollar medians. Rows are ordered by publish date, then id.";

async function handleGET(request: NextRequest) {
  const caller = await authorizeV1(request, { paidOnly: "Rate fees", usageEvent: "api.v1.rate_fees" });
  if (caller instanceof Response) return caller;
  const { organizationId, anonymousId, rateLimit } = caller;

  const { searchParams } = request.nextUrl;
  let institutionId: number | null;
  let state: string | null;
  let category: string | null;
  let charter: "bank" | "credit_union" | null;
  let updatedSince: Date | null;
  let page: number;
  let limit: number;
  try {
    institutionId = searchParams.get("institution_id")
      ? intParam(searchParams, "institution_id", { fallback: 0, min: 1, max: 1_000_000_000 })
      : null;
    state = stateParam(searchParams);
    category = searchParams.get("category")?.trim() || null;
    if (category !== null && !KNOWN_CATEGORIES.has(category)) {
      throw new ApiParamError("category must be a category key from /api/v1/fees, e.g. card_foreign_txn");
    }
    charter = charterParam(searchParams);
    updatedSince = dateTimeParam(searchParams, "updated_since");
    page = intParam(searchParams, "page", { fallback: 1, min: 1, max: 10_000 });
    limit = intParam(searchParams, "limit", { fallback: 100, min: 1, max: 500 });
  } catch (error) {
    if (error instanceof ApiParamError) {
      logApiUsage(organizationId, anonymousId, "api.v1.rate_fees", { status: 400 }).catch(() => {});
      return apiError(400, "invalid_parameter", error.message, { rateLimit });
    }
    throw error;
  }

  const result = await listRateFees(
    { institution_id: institutionId, state_code: state, fee_category: category, charter_type: charter, updated_since: updatedSince },
    { limit, offset: (page - 1) * limit },
  );
  const pages = Math.ceil(result.total / limit);

  logApiUsage(organizationId, anonymousId, "api.v1.rate_fees", {
    institution_id: institutionId,
    state,
    category,
    charter_type: charter,
    updated_since: updatedSince?.toISOString() ?? null,
    count: result.rows.length,
    status: 200,
  }).catch(() => {});

  return withApiCaching(request, withApiHeaders(
    NextResponse.json({
      note: NOTE,
      updated_since: updatedSince?.toISOString() ?? null,
      total: result.total,
      page,
      page_size: limit,
      pages,
      has_more: page < pages,
      data: result.rows.map((f) => ({
        id: f.id,
        institution_id: f.institution_id,
        institution_name: f.institution_name,
        state: f.state,
        charter_type: f.charter_type,
        ...apiFeeName(f.fee_name, f.fee_category),
        category: f.fee_category,
        display_name: f.fee_category ? getDisplayName(f.fee_category) : null,
        rate_percent: f.rate_percent,
        rate_min_amount: f.rate_min_amount ?? null,
        rate_max_amount: f.rate_max_amount ?? null,
        rate_basis: f.rate_basis ?? null,
        rate_terms: f.rate_label,
        frequency: f.frequency,
        conditions: f.conditions,
        source_url: f.source_url,
        published_at: f.published_at ?? null,
      })),
      attribution: API_ATTRIBUTION,
    }),
    rateLimit,
  ));
}

export const GET = withApiRoutePolicy("api.v1.rate_fees", "GET", handleGET);
export const OPTIONS = withApiRoutePolicy("api.v1.rate_fees", "OPTIONS", async () => apiOptions());

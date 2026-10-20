import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
import { NextRequest, NextResponse } from "next/server";
import { getDistrictIncomeTrend, getRevenueTrend } from "@/lib/data-store/call-reports";
import { FINANCIAL_SOURCES, type FinancialSource } from "@/lib/data-store/financial-sources";
import { financialMeasureDefinition } from "@/lib/data-store/financial-peer-contract";
import { logApiUsage } from "@/lib/api-usage";
import { API_ATTRIBUTION } from "@/lib/constants";
import { authorizeV1 } from "@/lib/api-v1-auth";
import { ApiParamError, apiError, apiOptions, intParam, withApiCaching, withApiHeaders } from "@/lib/api-v1";

const UNITS =
  "Amounts are in thousands of US dollars per standalone quarter. Each row names its source: FDIC rows are bank " +
  "service charges on deposit accounts; NCUA rows are broader credit-union fee income. The two " +
  "measures are different and are never added together.";

const QUARTER_END: Record<string, string> = { "1": "03-31", "2": "06-30", "3": "09-30", "4": "12-31" };

/** "2026-Q1" -> "2026-03-31"; null for a label the readers never produce. */
function quarterEnd(quarter: string): string | null {
  const match = /^(\d{4})-Q([1-4])$/.exec(quarter);
  return match ? `${match[1]}-${QUARTER_END[match[2]]}` : null;
}

function parseSources(raw: string | null): readonly FinancialSource[] {
  if (raw === null || raw === "") return FINANCIAL_SOURCES;
  if (raw !== "fdic" && raw !== "ncua") throw new ApiParamError("source must be fdic or ncua");
  return [raw];
}

/** One regulator's measure, dated by its own newest quarter. */
function financialGroup(source: FinancialSource, quarters: readonly string[]) {
  const latest = quarters.reduce<string | null>((max, q) => (max === null || q > max ? q : max), null);
  return {
    ...financialMeasureDefinition(source),
    status: latest === null ? "unavailable" : "reported",
    latest_quarter: latest,
    latest_quarter_end: latest === null ? null : quarterEnd(latest),
    quarters_returned: new Set(quarters).size,
  };
}

function rowSource(source: FinancialSource) {
  const { charter_type, measure } = financialMeasureDefinition(source);
  return { source, charter_type, measure };
}

async function districtRows(sources: readonly FinancialSource[], quarters: number) {
  const perSource = await Promise.all(sources.map(async (source) => ({
    source,
    rows: await getDistrictIncomeTrend(quarters, source),
  })));
  return {
    groups: perSource.map(({ source, rows }) => financialGroup(source, rows.map((r) => r.quarter))),
    data: perSource.flatMap(({ source, rows }) => rows.map((r) => ({
      ...rowSource(source),
      quarter: r.quarter,
      quarter_end: quarterEnd(r.quarter),
      fed_district: r.fed_district,
      service_charges: r.total_service_charges,
      institutions: r.institutions,
    }))),
  };
}

async function nationalRows(sources: readonly FinancialSource[], quarters: number) {
  const perSource = await Promise.all(sources.map(async (source) => ({
    source,
    trend: await getRevenueTrend(quarters, source),
  })));
  return {
    groups: perSource.map(({ source, trend }) => financialGroup(source, trend.quarters.map((q) => q.quarter))),
    data: perSource.flatMap(({ source, trend }) => trend.quarters.map((q) => ({
      ...rowSource(source),
      quarter: q.quarter,
      quarter_end: quarterEnd(q.quarter),
      service_charges: q.total_service_charges,
      institutions: q.total_institutions,
      // Withheld: a changing reporting population does not establish constant-cohort growth.
      yoy_change_pct: null,
    }))),
  };
}

async function handleGET(request: NextRequest) {
  const caller = await authorizeV1(request, { paidOnly: "Revenue trends", usageEvent: "api.v1.revenue" });
  if (caller instanceof Response) return caller;
  const { organizationId, keyId, anonymousId, rateLimit } = caller;

  const { searchParams } = request.nextUrl;
  let view: "national" | "districts";
  let quarters: number;
  let sources: readonly FinancialSource[];
  try {
    const viewRaw = searchParams.get("view");
    if (viewRaw !== null && viewRaw !== "" && viewRaw !== "national" && viewRaw !== "districts") {
      throw new ApiParamError("view must be national or districts");
    }
    view = viewRaw === "districts" ? "districts" : "national";
    quarters = intParam(searchParams, "quarters", { fallback: 8, min: 1, max: 66 });
    sources = parseSources(searchParams.get("source"));
  } catch (error) {
    if (error instanceof ApiParamError) {
      logApiUsage(organizationId, anonymousId, "api.v1.revenue", { status: 400 }, keyId).catch(() => {});
      return apiError(400, "invalid_parameter", error.message, { rateLimit });
    }
    throw error;
  }

  const { groups, data } = view === "districts"
    ? await districtRows(sources, quarters)
    : await nationalRows(sources, quarters);
  if (data.length === 0) {
    logApiUsage(organizationId, anonymousId, "api.v1.revenue", { view, quarters, status: 503 }, keyId).catch(() => {});
    return apiError(503, "data_unavailable", "Revenue data is temporarily unavailable", { rateLimit });
  }
  logApiUsage(organizationId, anonymousId, "api.v1.revenue", { view, quarters, status: 200 }, keyId).catch(() => {});
  return withApiCaching(request, withApiHeaders(
    NextResponse.json({ view, units: UNITS, financial_groups: groups, data, attribution: API_ATTRIBUTION }),
    rateLimit,
  ));
}

export const GET = withApiRoutePolicy("api.v1.revenue", "GET", handleGET);
export const OPTIONS = withApiRoutePolicy("api.v1.revenue", "OPTIONS", async () => apiOptions());

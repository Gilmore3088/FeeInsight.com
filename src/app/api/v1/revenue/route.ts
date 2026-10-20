import { withApiRoutePolicy } from "@/lib/api-hardening/route-wrapper";
import { NextRequest, NextResponse } from "next/server";
import {
  getDistrictIncomeTrend,
  getRevenueTrend,
  type DistrictIncomeQuarter,
  type RevenueSnapshot,
} from "@/lib/data-store/call-reports";
import { FINANCIAL_SOURCES, type FinancialSource } from "@/lib/data-store/financial-sources";
import { financialMeasureDefinition } from "@/lib/data-store/financial-peer-contract";
import { logApiUsage } from "@/lib/api-usage";
import { API_ATTRIBUTION } from "@/lib/constants";
import { authorizeV1 } from "@/lib/api-v1-auth";
import { ApiParamError, apiError, apiOptions, intParam, withApiCaching, withApiHeaders } from "@/lib/api-v1";

/** The default response keeps its pre-1.13 wording and shape; paying callers rely on it. */
const LEGACY_UNITS = "Deposit service-charge income from FDIC and NCUA call reports, in thousands of US dollars per quarter.";

const SOURCE_UNITS =
  "Amounts are in thousands of US dollars per standalone quarter. Each row names its source: FDIC rows are bank " +
  "service charges on deposit accounts; NCUA rows are broader credit-union fee income. The two " +
  "measures are different and are never added together.";

const QUARTER_END: Record<string, string> = { "1": "03-31", "2": "06-30", "3": "09-30", "4": "12-31" };

type View = "national" | "districts";

/** "2026-Q1" -> "2026-03-31"; null for a label the readers never produce. */
function quarterEnd(quarter: string): string | null {
  const match = /^(\d{4})-Q([1-4])$/.exec(quarter);
  return match ? `${match[1]}-${QUARTER_END[match[2]]}` : null;
}

function parseSource(raw: string | null): FinancialSource | null {
  if (raw === null || raw === "") return null;
  if (raw !== "fdic" && raw !== "ncua") throw new ApiParamError("source must be fdic or ncua");
  return raw;
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

function regulatorFigure(source: FinancialSource, quarter: string, serviceCharges: number, institutions: number) {
  return { ...rowSource(source), quarter_end: quarterEnd(quarter), service_charges: serviceCharges, institutions };
}

type RegulatorFigure = ReturnType<typeof regulatorFigure>;

function groupBy<T>(items: readonly T[], keyOf: (item: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) out.set(keyOf(item), [...(out.get(keyOf(item)) ?? []), item]);
  return out;
}

async function readNational(sources: readonly FinancialSource[], quarters: number) {
  return Promise.all(sources.map(async (source) => ({ source, rows: (await getRevenueTrend(quarters, source)).quarters })));
}

async function readDistricts(sources: readonly FinancialSource[], quarters: number) {
  return Promise.all(sources.map(async (source) => ({ source, rows: await getDistrictIncomeTrend(quarters, source) })));
}

function nationalFigures(perSource: { source: FinancialSource; rows: RevenueSnapshot[] }[]): RegulatorFigure[] {
  return perSource.flatMap(({ source, rows }) =>
    rows.map((q) => regulatorFigure(source, q.quarter, q.total_service_charges, q.total_institutions)));
}

function districtFigures(perSource: { source: FinancialSource; rows: DistrictIncomeQuarter[] }[]) {
  return perSource.flatMap(({ source, rows }) => rows.map((r) => ({
    key: `${r.quarter}|${r.fed_district}`,
    figure: regulatorFigure(source, r.quarter, r.total_service_charges, r.institutions),
  })));
}

/**
 * The default national response: one row per quarter with the pooled legacy fields exactly as
 * before, plus each regulator's own figures in by_regulator (#2416).
 */
async function legacyNational(quarters: number) {
  const [pooled, perSource] = await Promise.all([getRevenueTrend(quarters), readNational(FINANCIAL_SOURCES, quarters)]);
  const byQuarter = groupBy(nationalFigures(perSource), (f) => f.quarter_end ?? "");
  return {
    units: LEGACY_UNITS,
    groups: perSource.map(({ source, rows }) => financialGroup(source, rows.map((q) => q.quarter))),
    data: pooled.quarters.map((q) => ({
      quarter: q.quarter,
      service_charges: q.total_service_charges,
      bank_service_charges: q.bank_service_charges,
      credit_union_service_charges: q.cu_service_charges,
      institutions: q.total_institutions,
      yoy_change_pct: q.yoy_change_pct === null ? null : Math.round(q.yoy_change_pct * 10) / 10,
      by_regulator: byQuarter.get(quarterEnd(q.quarter) ?? "") ?? [],
    })),
  };
}

/** The default districts response: one pooled row per quarter and district, as before, plus by_regulator. */
async function legacyDistricts(quarters: number) {
  const [pooled, perSource] = await Promise.all([getDistrictIncomeTrend(quarters), readDistricts(FINANCIAL_SOURCES, quarters)]);
  const byKey = groupBy(districtFigures(perSource), (f) => f.key);
  return {
    units: LEGACY_UNITS,
    groups: perSource.map(({ source, rows }) => financialGroup(source, rows.map((r) => r.quarter))),
    data: pooled.map((r) => ({
      quarter: r.quarter,
      fed_district: r.fed_district,
      service_charges: r.total_service_charges,
      institutions: r.institutions,
      by_regulator: (byKey.get(`${r.quarter}|${r.fed_district}`) ?? []).map((f) => f.figure),
    })),
  };
}

/** source=fdic|ncua: only that regulator's rows, each naming its measure. */
async function singleSource(view: View, source: FinancialSource, quarters: number) {
  if (view === "districts") {
    const rows = await getDistrictIncomeTrend(quarters, source);
    return {
      units: SOURCE_UNITS,
      groups: [financialGroup(source, rows.map((r) => r.quarter))],
      data: rows.map((r) => ({
        ...rowSource(source),
        quarter: r.quarter,
        quarter_end: quarterEnd(r.quarter),
        fed_district: r.fed_district,
        service_charges: r.total_service_charges,
        institutions: r.institutions,
      })),
    };
  }
  const { quarters: rows } = await getRevenueTrend(quarters, source);
  return {
    units: SOURCE_UNITS,
    groups: [financialGroup(source, rows.map((q) => q.quarter))],
    data: rows.map((q) => ({
      ...rowSource(source),
      quarter: q.quarter,
      quarter_end: quarterEnd(q.quarter),
      service_charges: q.total_service_charges,
      institutions: q.total_institutions,
      // Withheld: a changing reporting population does not establish constant-cohort growth.
      yoy_change_pct: null,
    })),
  };
}

async function handleGET(request: NextRequest) {
  const caller = await authorizeV1(request, { paidOnly: "Revenue trends", usageEvent: "api.v1.revenue" });
  if (caller instanceof Response) return caller;
  const { organizationId, keyId, anonymousId, rateLimit } = caller;

  const { searchParams } = request.nextUrl;
  let view: View;
  let quarters: number;
  let source: FinancialSource | null;
  try {
    const viewRaw = searchParams.get("view");
    if (viewRaw !== null && viewRaw !== "" && viewRaw !== "national" && viewRaw !== "districts") {
      throw new ApiParamError("view must be national or districts");
    }
    view = viewRaw === "districts" ? "districts" : "national";
    quarters = intParam(searchParams, "quarters", { fallback: 8, min: 1, max: 66 });
    source = parseSource(searchParams.get("source"));
  } catch (error) {
    if (error instanceof ApiParamError) {
      logApiUsage(organizationId, anonymousId, "api.v1.revenue", { status: 400 }, keyId).catch(() => {});
      return apiError(400, "invalid_parameter", error.message, { rateLimit });
    }
    throw error;
  }

  const { units, groups, data } = source !== null
    ? await singleSource(view, source, quarters)
    : view === "districts" ? await legacyDistricts(quarters) : await legacyNational(quarters);
  if (data.length === 0) {
    logApiUsage(organizationId, anonymousId, "api.v1.revenue", { view, quarters, status: 503 }, keyId).catch(() => {});
    return apiError(503, "data_unavailable", "Revenue data is temporarily unavailable", { rateLimit });
  }
  logApiUsage(organizationId, anonymousId, "api.v1.revenue", { view, quarters, status: 200 }, keyId).catch(() => {});
  return withApiCaching(request, withApiHeaders(
    NextResponse.json({ view, units, financial_groups: groups, data, attribution: API_ATTRIBUTION }),
    rateLimit,
  ));
}

export const GET = withApiRoutePolicy("api.v1.revenue", "GET", handleGET);
export const OPTIONS = withApiRoutePolicy("api.v1.revenue", "OPTIONS", async () => apiOptions());

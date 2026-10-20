import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { validateApiKey } from "@/lib/api-auth";
import { checkRateLimitWithTier } from "@/lib/api-rate-limit";
import { getCurrentUser } from "@/lib/auth";
import { canAccessPremium } from "@/lib/access";
import { API_ATTRIBUTION } from "@/lib/constants";
import { getDistrictIncomeTrend, getRevenueTrend } from "@/lib/data-store/call-reports";
import type { FinancialSource } from "@/lib/data-store/financial-sources";
import { GET } from "./route";

vi.mock("@/lib/api-auth", () => ({ validateApiKey: vi.fn() }));
vi.mock("@/lib/api-rate-limit", () => ({
  checkRateLimitWithTier: vi.fn(),
  checkBurstLimitWithTier: vi.fn(() => Promise.resolve({ allowed: true, remaining: 59, limit: 60, reset: new Date("2026-10-17T12:01:00.000Z") })),
}));
vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/access", () => ({ canAccessPremium: vi.fn() }));
vi.mock("@/lib/api-usage", () => ({ logApiUsage: vi.fn(() => Promise.resolve()) }));
vi.mock("@/lib/data-store/call-reports", () => ({
  getRevenueTrend: vi.fn(),
  getDistrictIncomeTrend: vi.fn(),
}));

const URL_BASE = "https://feeinsight.com/api/v1/revenue";

/** The keys every national row carried on main before #2488, in the same meaning. */
const LEGACY_NATIONAL_KEYS = [
  "bank_service_charges", "credit_union_service_charges", "institutions", "quarter", "service_charges", "yoy_change_pct",
];
const LEGACY_UNITS = "Deposit service-charge income from FDIC and NCUA call reports, in thousands of US dollars per quarter.";
const LEGACY_DISTRICT_KEYS = ["fed_district", "institutions", "quarter", "service_charges"];

function snapshot(quarter: string, serviceCharges: number, institutions: number, extra: Partial<{
  bank: number; cu: number; yoy: number | null;
}> = {}) {
  return {
    quarter,
    total_service_charges: serviceCharges,
    total_institutions: institutions,
    bank_service_charges: extra.bank ?? 0,
    cu_service_charges: extra.cu ?? 0,
    yoy_change_pct: extra.yoy ?? null,
  };
}

/** Unscoped read pools both regulators (the legacy figures); scoped reads return one regulator. */
function mockNational(bySource: Partial<Record<FinancialSource | "all", ReturnType<typeof snapshot>[]>>) {
  vi.mocked(getRevenueTrend).mockImplementation(async (_quarters, source) => ({
    quarters: bySource[source ?? "all"] ?? [],
    latest: null,
  }));
}

function without(record: Record<string, unknown>, key: string) {
  return Object.fromEntries(Object.entries(record).filter(([name]) => name !== key));
}

/** A row as a pre-#2488 client sees it: by_regulator is the only field added to it. */
function withoutNewFields(row: Record<string, unknown>) {
  return without(row, "by_regulator");
}

/** A body as a pre-#2488 client sees it: financial_groups and by_regulator are the only additions. */
function legacyView(body: Record<string, unknown> & { data: Record<string, unknown>[] }) {
  return { ...without(body, "financial_groups"), data: body.data.map(withoutNewFields) };
}

describe("/api/v1/revenue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(validateApiKey).mockResolvedValue({ valid: true, organizationId: 7, tier: "enterprise" });
    vi.mocked(checkRateLimitWithTier).mockResolvedValue({
      allowed: true,
      remaining: Infinity,
      limit: Infinity,
      reset: new Date("2026-11-01T00:00:00.000Z"),
    });
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    vi.mocked(canAccessPremium).mockReturnValue(false);
  });

  it("turns away callers with no key", async () => {
    vi.mocked(validateApiKey).mockResolvedValue({ valid: false, organizationId: null, tier: "free" });

    const response = await GET(new NextRequest(URL_BASE));

    expect(response.status).toBe(401);
    expect(getRevenueTrend).not.toHaveBeenCalled();
  });

  it("keeps revenue behind a paid key", async () => {
    vi.mocked(validateApiKey).mockResolvedValue({ valid: true, organizationId: 3, tier: "free" });

    const response = await GET(new NextRequest(URL_BASE));

    expect(response.status).toBe(403);
  });

  describe("default response (unchanged from before source-qualified rows)", () => {
    it("keeps one national row per quarter with the legacy fields and meanings", async () => {
      mockNational({
        all: [snapshot("2026-Q1", 1000, 9000, { bank: 800, cu: 200, yoy: 3.14159 })],
        fdic: [snapshot("2026-Q1", 800, 4000)],
        ncua: [snapshot("2026-Q1", 200, 5000)],
      });

      const response = await GET(new NextRequest(`${URL_BASE}?quarters=20`));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(getRevenueTrend).toHaveBeenCalledWith(20);
      expect(body.view).toBe("national");
      expect(body.units).toBe(LEGACY_UNITS);
      expect(body.data).toHaveLength(1);
      expect(Object.keys(withoutNewFields(body.data[0])).sort()).toEqual(LEGACY_NATIONAL_KEYS);
      expect(withoutNewFields(body.data[0])).toEqual({
        quarter: "2026-Q1",
        service_charges: 1000,
        bank_service_charges: 800,
        credit_union_service_charges: 200,
        institutions: 9000,
        yoy_change_pct: 3.1,
      });
    });

    it("returns the pre-#2488 body exactly once the added fields are set aside", async () => {
      // The fixture and expected body are the national test from main before #2488.
      mockNational({ all: [snapshot("2026-Q1", 1000, 9000, { bank: 800, cu: 200, yoy: 3.14159 })] });

      const body = await (await GET(new NextRequest(`${URL_BASE}?quarters=20`))).json();

      expect(JSON.stringify(legacyView(body))).toBe(JSON.stringify({
        view: "national",
        units: LEGACY_UNITS,
        data: [{
          quarter: "2026-Q1",
          service_charges: 1000,
          bank_service_charges: 800,
          credit_union_service_charges: 200,
          institutions: 9000,
          yoy_change_pct: 3.1,
        }],
        attribution: API_ATTRIBUTION,
      }));
    });

    it("returns the pre-#2488 districts body exactly once the added fields are set aside", async () => {
      vi.mocked(getDistrictIncomeTrend).mockImplementation(async (_quarters, source) => source === undefined
        ? [{ quarter: "2026-Q1", fed_district: 11, total_service_charges: 50, institutions: 400 }]
        : []);

      const body = await (await GET(new NextRequest(`${URL_BASE}?view=districts`))).json();

      expect(JSON.stringify(legacyView(body))).toBe(JSON.stringify({
        view: "districts",
        units: LEGACY_UNITS,
        data: [{ quarter: "2026-Q1", fed_district: 11, service_charges: 50, institutions: 400 }],
        attribution: API_ATTRIBUTION,
      }));
    });

    it("adds each regulator's own figures per quarter as by_regulator", async () => {
      mockNational({
        all: [snapshot("2026-Q2", 810, 4000, { bank: 810 }), snapshot("2026-Q1", 1000, 9000, { bank: 800, cu: 200 })],
        fdic: [snapshot("2026-Q2", 810, 4000), snapshot("2026-Q1", 800, 4000)],
        ncua: [snapshot("2026-Q1", 200, 5000)],
      });

      const body = await (await GET(new NextRequest(URL_BASE))).json();

      expect(getRevenueTrend).toHaveBeenCalledWith(8, "fdic");
      expect(getRevenueTrend).toHaveBeenCalledWith(8, "ncua");
      expect(body.data[0].by_regulator).toEqual([
        { source: "fdic", charter_type: "bank", measure: "deposit_service_charge_income",
          quarter_end: "2026-06-30", service_charges: 810, institutions: 4000 },
      ]);
      expect(body.data[1].by_regulator).toEqual([
        { source: "fdic", charter_type: "bank", measure: "deposit_service_charge_income",
          quarter_end: "2026-03-31", service_charges: 800, institutions: 4000 },
        { source: "ncua", charter_type: "credit_union", measure: "broad_credit_union_fee_income",
          quarter_end: "2026-03-31", service_charges: 200, institutions: 5000 },
      ]);
      expect(body.financial_groups).toEqual([
        expect.objectContaining({ source: "fdic", status: "reported", latest_quarter: "2026-Q2", latest_quarter_end: "2026-06-30", quarters_returned: 2 }),
        expect.objectContaining({ source: "ncua", status: "reported", latest_quarter: "2026-Q1", quarters_returned: 1,
          unit: "thousands of dollars", period_basis: "standalone_quarter", source_period_basis: "year_to_date" }),
      ]);
    });

    it("keeps the legacy rows and marks a regulator unavailable when its own read is empty", async () => {
      mockNational({ all: [snapshot("2026-Q1", 1000, 9000, { bank: 800, cu: 200 })], fdic: [snapshot("2026-Q1", 800, 4000)] });

      const response = await GET(new NextRequest(URL_BASE));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data[0]).toMatchObject({ service_charges: 1000, credit_union_service_charges: 200 });
      expect(body.data[0].by_regulator.map((r: { source: string }) => r.source)).toEqual(["fdic"]);
      expect(body.financial_groups[1]).toMatchObject({ source: "ncua", status: "unavailable", latest_quarter: null, quarters_returned: 0 });
    });

    it("keeps one district row per quarter and district with the legacy fields", async () => {
      vi.mocked(getDistrictIncomeTrend).mockImplementation(async (_quarters, source) => [
        { quarter: "2026-Q1", fed_district: 11,
          total_service_charges: source === "fdic" ? 50 : source === "ncua" ? 7 : 57,
          institutions: source === "fdic" ? 400 : source === "ncua" ? 90 : 490 },
      ]);

      const body = await (await GET(new NextRequest(`${URL_BASE}?view=districts`))).json();

      expect(getDistrictIncomeTrend).toHaveBeenCalledWith(8);
      expect(body.data).toHaveLength(1);
      expect(Object.keys(withoutNewFields(body.data[0])).sort()).toEqual(LEGACY_DISTRICT_KEYS);
      expect(withoutNewFields(body.data[0])).toEqual({ quarter: "2026-Q1", fed_district: 11, service_charges: 57, institutions: 490 });
      expect(body.data[0].by_regulator).toEqual([
        expect.objectContaining({ source: "fdic", quarter_end: "2026-03-31", service_charges: 50, institutions: 400 }),
        expect.objectContaining({ source: "ncua", quarter_end: "2026-03-31", service_charges: 7, institutions: 90 }),
      ]);
    });

    it("says so when the data can't be read, instead of an empty list", async () => {
      mockNational({});

      const response = await GET(new NextRequest(URL_BASE));

      expect(response.status).toBe(503);
    });
  });

  describe("source parameter", () => {
    it("returns only that regulator's national rows, never pooled fields", async () => {
      mockNational({ fdic: [snapshot("2026-Q1", 800, 4000)], ncua: [snapshot("2026-Q1", 200, 5000)] });

      const response = await GET(new NextRequest(`${URL_BASE}?source=fdic&quarters=4`));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(getRevenueTrend).toHaveBeenCalledTimes(1);
      expect(getRevenueTrend).toHaveBeenCalledWith(4, "fdic");
      expect(body.data).toEqual([{
        source: "fdic", charter_type: "bank", measure: "deposit_service_charge_income",
        quarter: "2026-Q1", quarter_end: "2026-03-31", service_charges: 800, institutions: 4000, yoy_change_pct: null,
      }]);
      expect(body.financial_groups.map((g: { source: string }) => g.source)).toEqual(["fdic"]);
      expect(body.units).not.toMatch(/summed|combined/i);
    });

    it("returns only that regulator's district rows", async () => {
      vi.mocked(getDistrictIncomeTrend).mockResolvedValue([
        { quarter: "2026-Q1", fed_district: 11, total_service_charges: 7, institutions: 90 },
      ]);

      const body = await (await GET(new NextRequest(`${URL_BASE}?view=districts&source=ncua`))).json();

      expect(getDistrictIncomeTrend).toHaveBeenCalledTimes(1);
      expect(getDistrictIncomeTrend).toHaveBeenCalledWith(8, "ncua");
      expect(body.data).toEqual([expect.objectContaining({ source: "ncua", fed_district: 11, service_charges: 7, institutions: 90 })]);
      expect(body.data[0]).not.toHaveProperty("by_regulator");
      expect(body.financial_groups.map((g: { source: string }) => g.source)).toEqual(["ncua"]);
    });

    it("says so when that regulator has no figures", async () => {
      mockNational({ fdic: [snapshot("2026-Q1", 800, 4000)] });

      const response = await GET(new NextRequest(`${URL_BASE}?source=ncua`));

      expect(response.status).toBe(503);
    });

    it("rejects an unknown source", async () => {
      const response = await GET(new NextRequest(`${URL_BASE}?source=ffiec`));

      expect(response.status).toBe(400);
      expect(getRevenueTrend).not.toHaveBeenCalled();
    });
  });

  it("rejects too many quarters", async () => {
    const response = await GET(new NextRequest(`${URL_BASE}?quarters=500`));

    expect(response.status).toBe(400);
  });
});

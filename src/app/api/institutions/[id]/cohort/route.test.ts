import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn(async () => []) }));
vi.mock("@/lib/data-store/public-cached-reads", () => ({
  getInstitutionCohortKeyCached: vi.fn(),
  getInstitutionFinancialHistoryCached: vi.fn(),
  getFeeShareCohortCached: vi.fn(),
}));
vi.mock("@/lib/data-store", () => ({
  getPublicInstitutionById: vi.fn(() => {
    throw new Error("the cohort route must read the institution through the cache");
  }),
}));

import {
  getFeeShareCohortCached,
  getInstitutionCohortKeyCached,
  getInstitutionFinancialHistoryCached,
} from "@/lib/data-store/public-cached-reads";
import { COHORT_LIST_CAP } from "@/app/(public)/institution/[id]/fee-share-cohort";
import { GET } from "./route";

const keyMock = vi.mocked(getInstitutionCohortKeyCached);
const historyMock = vi.mocked(getInstitutionFinancialHistoryCached);
const cohortMock = vi.mocked(getFeeShareCohortCached);

function call(id: string, query = "") {
  const request = new NextRequest(`http://localhost/api/institutions/${id}/cohort${query}`);
  return GET(request, { params: Promise.resolve({ id }) });
}

describe("GET /api/institutions/[id]/cohort", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("answers an unknown id from the cached key read, with no other read", async () => {
    keyMock.mockResolvedValue({ found: false });
    const res = await call("999999");
    expect(res.status).toBe(404);
    expect(keyMock).toHaveBeenCalledWith(999999);
    expect(historyMock).not.toHaveBeenCalled();
  });

  it("caps Show all at COHORT_LIST_CAP members and reports the full total", async () => {
    const size = COHORT_LIST_CAP + 200;
    keyMock.mockResolvedValue({ found: true, charterType: "bank", assetSizeTier: "community_small" });
    historyMock.mockResolvedValue([{ source: "fdic", report_date: "2026-06-30" }] as never);
    cohortMock.mockResolvedValue({
      report_date: "2026-06-30",
      source: "fdic",
      charter_type: "bank",
      asset_size_tier: "community_small",
      filers: size + 1,
      members: Array.from({ length: size + 1 }, (_, i) => ({
        id: i + 1,
        name: `Bank ${i + 1}`,
        city: null,
        state: "FL",
        total_assets: 100_000,
        service_charge_income: 100,
        total_revenue: 1000,
        fee_income_ratio: 0.01 + i / 100_000,
      })),
    });
    const res = await call("1", "?all=1");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { total: number; members: unknown[] };
    expect(body.total).toBe(size);
    expect(body.members).toHaveLength(COHORT_LIST_CAP);
    expect(cohortMock).toHaveBeenCalledWith("bank", "community_small", "2026-06-30", "fdic");
  });
});

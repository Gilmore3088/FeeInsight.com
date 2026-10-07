import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./connection", () => {
  const mockSql = vi.fn() as ReturnType<typeof vi.fn> & {
    unsafe: ReturnType<typeof vi.fn>;
  };
  mockSql.unsafe = vi.fn();
  return {
    getSql: () => mockSql,
    sql: mockSql,
  };
});

import {
  getComplaintBenchmark,
  getDistrictComplaintSummary,
  getInstitutionComplaintProfile,
} from "./complaints";
import type {
  DistrictComplaintSummary,
  InstitutionComplaintProfile,
} from "./complaints";
import { getSql } from "./connection";

type MockSql = ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn> };

function getMock(): MockSql {
  return getSql() as unknown as MockSql;
}

function resetMock(mock: MockSql) {
  mock.mockReset();
  mock.unsafe = vi.fn();
}

// ── DistrictComplaintSummary type ────────────────────────────────────────────

describe("DistrictComplaintSummary type", () => {
  it("has required fields with correct types", () => {
    const summary: DistrictComplaintSummary = {
      fed_district: 2,
      total_complaints: 1500,
      fee_related_complaints: 400,
      institution_count: 12,
      top_products: [{ product: "Checking or savings account", count: 900 }],
    };
    expect(summary.fed_district).toBe(2);
    expect(summary.fee_related_complaints).toBe(400);
  });
});

// ── InstitutionComplaintProfile type ─────────────────────────────────────────

describe("InstitutionComplaintProfile type", () => {
  it("has required fields", () => {
    const profile: InstitutionComplaintProfile = {
      institution_id: 42,
      total_complaints: 250,
      by_product: [{ product: "Checking or savings account", count: 200 }],
      by_issue: [{ issue: "Fees or interest", count: 80 }],
      fee_related_pct: 32.0,
    };
    expect(profile.institution_id).toBe(42);
    expect(profile.fee_related_pct).toBe(32.0);
  });
});

// ── getDistrictComplaintSummary ───────────────────────────────────────────────

describe("getDistrictComplaintSummary", () => {
  beforeEach(() => {
    resetMock(getMock());
  });

  it("returns complaint counts aggregated for a district", async () => {
    const mock = getMock();
    // Three unsafe calls: totalRows, feeRows, productRows
    mock.unsafe = vi.fn()
      .mockResolvedValueOnce([{ institution_count: "5", total_complaints: "1200" }])
      .mockResolvedValueOnce([{ fee_complaints: "350" }])
      .mockResolvedValueOnce([
        { product: "Checking or savings account", count: "900" },
        { product: "Credit card", count: "300" },
      ]);

    const result = await getDistrictComplaintSummary(2);

    expect(result.fed_district).toBe(2);
    expect(result.total_complaints).toBe(1200);
    expect(result.fee_related_complaints).toBe(350);
    expect(result.institution_count).toBe(5);
    expect(result.top_products).toHaveLength(2);
    expect(result.top_products[0].product).toBe("Checking or savings account");
    expect(result.top_products[0].count).toBe(900);
  });

  it("returns zero counts for empty district", async () => {
    const mock = getMock();
    mock.unsafe = vi.fn()
      .mockResolvedValueOnce([{ institution_count: "0", total_complaints: "0" }])
      .mockResolvedValueOnce([{ fee_complaints: "0" }])
      .mockResolvedValueOnce([]);

    const result = await getDistrictComplaintSummary(99);

    expect(result.fed_district).toBe(99);
    expect(result.total_complaints).toBe(0);
    expect(result.fee_related_complaints).toBe(0);
    expect(result.institution_count).toBe(0);
    expect(result.top_products).toHaveLength(0);
  });

  it("returns zero counts when rows array is empty", async () => {
    const mock = getMock();
    mock.unsafe = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await getDistrictComplaintSummary(5);

    expect(result.total_complaints).toBe(0);
    expect(result.fee_related_complaints).toBe(0);
    expect(result.institution_count).toBe(0);
  });

  it("accepts optional reportPeriod parameter", async () => {
    const mock = getMock();
    mock.unsafe = vi.fn()
      .mockResolvedValueOnce([{ institution_count: "3", total_complaints: "500" }])
      .mockResolvedValueOnce([{ fee_complaints: "120" }])
      .mockResolvedValueOnce([{ product: "Checking or savings account", count: "500" }]);

    const result = await getDistrictComplaintSummary(1, "2024");

    expect(result.fed_district).toBe(1);
    expect(result.total_complaints).toBe(500);
    // Verify reportPeriod was passed to SQL (second arg of third unsafe call includes year)
    const thirdCallArgs = mock.unsafe.mock.calls[2];
    expect(thirdCallArgs[1]).toContain("2024");
  });
});

// ── getInstitutionComplaintProfile ────────────────────────────────────────────

describe("getInstitutionComplaintProfile", () => {
  beforeEach(() => {
    resetMock(getMock());
  });

  it("returns complaint profile with product and issue breakdown", async () => {
    const mock = getMock();
    // Template-literal calls: totalRow, productRows, issueRows, feeIssueRows
    mock
      .mockResolvedValueOnce([{ total: "300" }])           // total
      .mockResolvedValueOnce([                              // by_product
        { product: "Checking or savings account", count: "250" },
        { product: "Credit card", count: "50" },
      ])
      .mockResolvedValueOnce([                              // by_issue
        { issue: "Fees or interest", count: "80" },
        { issue: "Managing an account", count: "60" },
      ]);
    mock.unsafe.mockResolvedValueOnce([{ fee_count: "140" }]); // fee issues (shared fee definition)

    const result = await getInstitutionComplaintProfile(42);

    expect(result.institution_id).toBe(42);
    expect(result.total_complaints).toBe(300);
    expect(result.by_product).toHaveLength(2);
    expect(result.by_product[0].product).toBe("Checking or savings account");
    expect(result.by_product[0].count).toBe(250);
    expect(result.by_issue).toHaveLength(2);
    expect(result.by_issue[0].issue).toBe("Fees or interest");
  });

  it("computes fee_related_pct correctly", async () => {
    const mock = getMock();
    mock
      .mockResolvedValueOnce([{ total: "200" }])
      .mockResolvedValueOnce([{ product: "Checking or savings account", count: "200" }])
      .mockResolvedValueOnce([
        { issue: "Fees or interest", count: "50" },
        { issue: "Managing an account", count: "50" },
        { issue: "Other", count: "100" },
      ]);
    mock.unsafe.mockResolvedValueOnce([{ fee_count: "100" }]); // 100 fee complaints out of 200 total

    const result = await getInstitutionComplaintProfile(10);

    // fee_related_pct = 100 / 200 total complaints * 100 = 50%
    expect(result.fee_related_pct).toBe(50.0);
  });

  it("returns zero fee_related_pct when no issues exist", async () => {
    const mock = getMock();
    mock
      .mockResolvedValueOnce([{ total: "0" }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    mock.unsafe.mockResolvedValueOnce([{ fee_count: "0" }]);

    const result = await getInstitutionComplaintProfile(99);

    expect(result.total_complaints).toBe(0);
    expect(result.fee_related_pct).toBe(0);
    expect(result.by_product).toHaveLength(0);
    expect(result.by_issue).toHaveLength(0);
  });
});

// ── getComplaintBenchmark ────────────────────────────────────────────────────

describe("getComplaintBenchmark", () => {
  beforeEach(() => resetMock(getMock()));

  const row = (id: number, state: string, district: number, fee: number, extra: Record<string, unknown> = {}) => ({
    institution_id: id,
    institution_name: `Bank ${id}`,
    state_code: state,
    fed_district: district,
    charter_type: "bank",
    asset_size_tier: "community_small",
    deposits: 200_000, // $200M, in thousands
    total_complaints: fee * 2,
    fee_complaints: fee,
    accepted: fee > 0,
    in_review: false,
    ...extra,
  });

  it("says zero plainly and widens from state to district when the state has too few peers", async () => {
    const cohort = [
      row(1, "TN", 6, 0),
      ...Array.from({ length: 4 }, (_, i) => row(10 + i, "TN", 6, 0)),
      ...Array.from({ length: 8 }, (_, i) => row(20 + i, "GA", 6, i < 3 ? 2 : 0)),
      // Awaiting review: its count is unknown, so it is not a peer.
      row(99, "TN", 6, 0, { in_review: true }),
    ];
    getMock().unsafe.mockResolvedValueOnce(cohort).mockResolvedValueOnce([{ loaded: true }]);

    const result = await getComplaintBenchmark(1, 2025);

    expect(result).toMatchObject({
      match_status: "none",
      fee_complaints: 0,
      peer_level: "fed_district",
      peer_label: "Fed District 6",
      peer_count: 12,
      peers_with_fee_complaints: 3,
      peer_median_fee_complaints: 0,
      sub_issues_loaded: true,
    });
    expect(result!.summary).toBe("Bank 1 had 0 CFPB fee complaints in 2025. 3 of 12 community small banks in Fed District 6 had any.");
  });

  it("gives a rate per $1B of deposits next to the peer median", async () => {
    const cohort = [row(1, "TX", 11, 6), ...Array.from({ length: 12 }, (_, i) => row(30 + i, "TX", 11, i < 4 ? 1 : 0))];
    getMock().unsafe.mockResolvedValueOnce(cohort).mockResolvedValueOnce([{ loaded: false }]);

    const result = await getComplaintBenchmark(1, 2025);

    expect(result).toMatchObject({ match_status: "matched", peer_level: "state", fee_complaints_per_billion: 30, peer_median_per_billion: 0 });
  });

  it("shows no count while the institution's CFPB match awaits review", async () => {
    getMock().unsafe.mockResolvedValueOnce([row(1, "OH", 4, 0, { in_review: true, total_complaints: 3511 })]).mockResolvedValueOnce([{ loaded: false }]);
    const result = await getComplaintBenchmark(1, 2025);
    expect(result).toMatchObject({ match_status: "unconfirmed", total_complaints: null, fee_complaints: null, fee_complaints_per_billion: null });
  });

  it("returns null for an unknown institution", async () => {
    getMock().unsafe.mockResolvedValueOnce([]);
    await expect(getComplaintBenchmark(404, 2025)).resolves.toBeNull();
  });
});

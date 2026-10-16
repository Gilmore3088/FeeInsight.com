import { describe, expect, it } from "vitest";
import type { DistrictHubData, HubComplaintGroup } from "@/lib/data-store/district-hub";
import { CPI_BANK_SERVICES_SERIES } from "@/lib/regulatory/fed";
import {
  completeQuarters,
  complaintView,
  cpiBankServices,
  feeChangeSummary,
  hubFeeKeys,
  quarterLabel,
  revenueTrend,
  stateHubRows,
  tierMix,
} from "./district-hub-view";

function hub(over: Partial<DistrictHubData> = {}): DistrictHubData {
  return {
    district: 8,
    states: ["AR", "MO"],
    state_fees: [],
    institutions: [],
    revenue: [],
    branches: null,
    complaints: null,
    demographics: [],
    series: {},
    fee_changes: [],
    fee_changes_capped: false,
    fee_changes_since: "2025-10-16",
    ...over,
  };
}

const rev = (quarter: string, state_code: string, charter_type: "bank" | "credit_union", total: number, institutions: number) => ({
  quarter,
  state_code,
  charter_type,
  total,
  institutions,
});

describe("revenue", () => {
  it("drops a newest quarter that most institutions have not filed yet", () => {
    const h = hub({ revenue: [rev("2026-Q1", "MO", "bank", 100, 100), rev("2026-Q2", "MO", "bank", 40, 50)] });
    expect(completeQuarters(h)).toEqual(["2026-Q1"]);
  });

  it("sums banks and credit unions per quarter in whole dollars, oldest first", () => {
    const h = hub({
      revenue: [
        rev("2026-Q2", "MO", "bank", 100, 10),
        rev("2026-Q2", "AR", "credit_union", 20, 5),
        rev("2026-Q1", "MO", "bank", 90, 15),
      ],
    });
    expect(revenueTrend(h)).toEqual([
      { quarter: "2026-Q1", banks: 90_000, creditUnions: 0, total: 90_000, institutions: 15 },
      { quarter: "2026-Q2", banks: 100_000, creditUnions: 20_000, total: 120_000, institutions: 15 },
    ]);
    expect(quarterLabel("2026-Q2")).toBe("Q2 2026");
  });
});

describe("stateHubRows", () => {
  it("builds each state's figures and leaves unknowns null", () => {
    const h = hub({
      institutions: [
        { state_code: "MO", charter_type: "bank", tier: "community", institutions: 30, with_fees: 15 },
        { state_code: "MO", charter_type: "credit_union", tier: "micro", institutions: 10, with_fees: 5 },
      ],
      state_fees: [{ state_code: "MO", fees: { overdraft: { median: 30, institutions: 12 } } }],
      revenue: [rev("2026-Q2", "MO", "bank", 500, 30)],
      series: {
        MOUR: { series_id: "MOUR", latest: { date: "2026-08-01", value: 3.9 }, year_ago: null, history: [] },
        MONA: { series_id: "MONA", latest: { date: "2026-08-01", value: 3060 }, year_ago: { date: "2025-08-01", value: 3000 }, history: [] },
      },
    });
    const [mo, ...rest] = stateHubRows(h, ["AR", "MO"]);
    expect(rest).toEqual([]); // Arkansas has nothing to show
    expect(mo).toMatchObject({ code: "MO", name: "Missouri", institutions: 40, banks: 30, creditUnions: 10, withFees: 20, coveragePct: 50 });
    expect(mo.serviceCharges).toBe(500_000);
    expect(mo.unemployment).toEqual({ rate: 3.9, date: "2026-08-01" });
    expect(mo.payrollYoyPct).toBeCloseTo(2);
    expect(mo.medianIncome).toBeNull();
    expect(mo.bankBranches).toBeNull();
  });
});

describe("tierMix", () => {
  it("orders sizes smallest first and maps the old tier names", () => {
    const h = hub({
      institutions: [
        { state_code: "MO", charter_type: "bank", tier: "regional", institutions: 2, with_fees: 0 },
        { state_code: "MO", charter_type: "bank", tier: "community_small", institutions: 5, with_fees: 0 },
        { state_code: "AR", charter_type: "credit_union", tier: "micro", institutions: 7, with_fees: 0 },
        { state_code: "AR", charter_type: "bank", tier: null, institutions: 9, with_fees: 0 },
      ],
    });
    expect(tierMix(h).map((t) => [t.tier, t.banks, t.creditUnions])).toEqual([
      ["micro", 5, 7],
      ["regional", 2, 0],
    ]);
    expect(tierMix(h, "AR").map((t) => t.tier)).toEqual(["micro"]);
  });
});

describe("complaintView", () => {
  const group = (fed_district: number, state_code: string, matched: number, rated: number, deposits: number): HubComplaintGroup => ({
    fed_district,
    state_code,
    matched,
    with_deposits: matched,
    fee_complaints: rated,
    total_complaints: rated * 3,
    fee_complaints_rated: rated,
    deposits,
  });

  it("gives a rate only from ten matched institutions and never fills a missing state with zero", () => {
    const view = complaintView(
      hub({
        complaints: {
          year: "2025",
          groups: [group(8, "MO", 12, 24, 4_000_000), group(8, "AR", 3, 9, 1_000_000), group(11, "TX", 40, 40, 20_000_000)],
        },
      }),
      8,
      ["AR", "MO", "TN"],
    )!;
    expect(view.year).toBe("2025");
    expect(view.district.matched).toBe(15);
    expect(view.district.rate).toBeCloseTo(33 / 5);
    expect(view.us.rate).toBeCloseTo(73 / 25);
    const mo = view.states.find((s) => s.code === "MO")!;
    expect(mo.rate).toBeCloseTo(6);
    expect(view.states.find((s) => s.code === "AR")!.rate).toBeNull();
    expect(view.states.find((s) => s.code === "TN")).toBeUndefined();
  });

  it("is null when the district has no matched institutions", () => {
    expect(complaintView(hub({ complaints: { year: "2025", groups: [group(11, "TX", 40, 4, 1)] } }), 8, ["MO"])).toBeNull();
  });
});

describe("feeChangeSummary", () => {
  const change = (id: number, change_type: "increase" | "decrease" | "new" | "removed", fee_category = "overdraft", institution_name = "First Bank") => ({
    id,
    institution_id: id,
    institution_name,
    fee_category,
    old_amount: 30,
    new_amount: 35,
    change_type,
    changed_at: "2026-09-01T00:00:00Z",
    charter_type: "bank",
  });

  it("counts every move, lists only readable fees and never Frost Bank", () => {
    const summary = feeChangeSummary(
      hub({
        fee_changes: [
          change(1, "increase"),
          change(2, "decrease", "some_comprehensive_fee"),
          change(3, "new"),
          change(4, "increase", "overdraft", "Frost Bank"),
          change(5, "removed"),
          change(6, "new"),
        ],
      }),
      false,
    )!;
    expect(summary).toMatchObject({ up: 1, down: 1, added: 2, removed: 1 });
    expect(summary.recent.map((c) => c.id)).toEqual([1]);
  });

  it("is null with no changes, or too few to read as a trend", () => {
    expect(feeChangeSummary(hub(), true)).toBeNull();
    expect(feeChangeSummary(hub({ fee_changes: [change(1, "increase"), change(2, "decrease"), change(3, "new"), change(4, "removed")] }), true)).toBeNull();
  });
});

describe("cpiBankServices", () => {
  it("reads the 12-month change from the stored index", () => {
    const history = [
      { date: "2025-08-01", value: 100 },
      { date: "2026-07-01", value: 102 },
      { date: "2026-08-01", value: 103 },
    ];
    const cpi = cpiBankServices(
      hub({ series: { [CPI_BANK_SERVICES_SERIES]: { series_id: CPI_BANK_SERVICES_SERIES, latest: history[2], year_ago: history[0], history } } }),
    )!;
    expect(cpi.latestPct).toBeCloseTo(3);
    expect(cpi.date).toBe("2026-08-01");
  });
});

describe("hubFeeKeys", () => {
  it("shows Pro every hub fee and free visitors the featured ones", () => {
    expect(hubFeeKeys(true)).toHaveLength(5);
    expect(hubFeeKeys(false)).toContain("overdraft");
  });
});

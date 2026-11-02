import { describe, expect, it } from "vitest";
import type { FinancialPoint } from "@/app/(public)/institution/[id]/financial-history";
import {
  askPrompts,
  buildChanges,
  buildDashboardFinancials,
  buildFeeGroupRows,
  buildScorecard,
  feeShareOfDeposits,
  trailingFour,
} from "./command-center-dashboard";
import type { BriefingLocalMarket, PeerValue } from "../workspace/types";

function point(reportDate: string, over: Partial<FinancialPoint> = {}): FinancialPoint {
  return {
    reportDate, quarter: reportDate, source: "fdic", assets: 4_450_000_000, deposits: 3_800_000_000, loans: null, equity: null, netIncome: null,
    serviceCharges: 5_000_000, roaPct: 1.5, nimPct: 4.3, efficiencyPct: 65, ncoRatePct: null, noncurrentRatePct: null, tier1Pct: null,
    loansRealEstate: null, loansCommercial: null, loansConsumer: null, loansOther: null, loansCreditCard: null, loansAuto: null, securities: null,
    depositsCore: null, depositsBrokered: null, depositsUninsured: null, provision: null, roePct: null, leveragePct: null, totalCapitalPct: null,
    employees: null, members: null, ...over,
  };
}
const DATES = ["2024-06-30", "2024-09-30", "2024-12-31", "2025-03-31", "2025-06-30", "2025-09-30", "2025-12-31", "2026-03-31", "2026-06-30"];

describe("buildDashboardFinancials", () => {
  it("sums four filed quarters, compares them with the four before and reads ratio changes in points", () => {
    const series = DATES.map((d, i) => point(d, { serviceCharges: i < 5 ? 5_000_000 : 6_000_000, roaPct: i === 8 ? 1.53 : 1.46, efficiencyPct: i === 8 ? 64.7 : 65.3 }));
    const view = buildDashboardFinancials(series)!;
    expect(view.latestQuarter).toBe("Q2 2026");
    const [fees, roa, , eff] = view.kpis;
    expect(fees.value).toBe("$24.0M");
    // Last four 24.0M (6M x 4) against the four before 20.0M (5M x 4).
    expect(fees.sub).toBe("▲ 20.0% on the four quarters before");
    expect(roa).toMatchObject({ value: "1.53%", sub: "▲ 0.07 pts on the year", subTone: "good" });
    expect(eff).toMatchObject({ value: "64.7%", sub: "▼ 0.60 pts on the year (better)", subTone: "good" });
    expect(view.trend.quarters[0]).toBe("Q2 2024");
    expect(view.trend.axis.at(-1)).toBe("Q2 26");
    expect(view.footnote).toContain("FDIC call reports, Q2 2024 to Q2 2026");
  });

  it("never sums a year with a quarter missing", () => {
    const series = DATES.map((d, i) => point(d, { serviceCharges: i === 7 ? null : 5_000_000 }));
    expect(trailingFour(series, (p) => p.serviceCharges).latest).toBeNull();
    const view = buildDashboardFinancials(series)!;
    expect(view.kpis[0].value).toBe("—");
    expect(view.kpis[0].sub).toBe("Four filed quarters are not on file");
  });

  it("is null with nothing filed, and names fee income for a credit union", () => {
    expect(buildDashboardFinancials([])).toBeNull();
    expect(buildDashboardFinancials(DATES.map((d) => point(d, { source: "ncua" })))!.kpis[0].label).toBe("Fee income, last 4 quarters");
  });
});

const peer = (id: number, amount: number, countedAs?: number): PeerValue => ({ institutionId: id, institutionName: `P${id}`, amount, stateCode: "FL", sourceDocumentIds: [], documentUrls: [], publishedAt: null, ...(countedAs ? { countedAs } : {}) });

describe("buildFeeGroupRows", () => {
  it("gives a median only at ten institutions, counting sister charters once", () => {
    const ten = Array.from({ length: 10 }, (_, i) => peer(i + 1, 20 + i));
    const rows = buildFeeGroupRows(
      [{ feeCategory: "overdraft", displayName: "Overdraft", current: 35 }, { feeCategory: "nsf", displayName: "NSF", current: 30 }],
      { label: "institutions in Florida", fees: [{ feeCategory: "overdraft", peers: ten }, { feeCategory: "nsf", peers: [...ten.slice(0, 9), peer(99, 40, 1)] }] },
      () => [],
    );
    expect(rows[0]).toMatchObject({ n: 10, min: 20, max: 29, median: 24.5 });
    expect(rows[1]).toMatchObject({ n: 9, median: null, p25: null, p75: null, min: 20, max: 28 });
  });
});

describe("buildScorecard", () => {
  const market: BriefingLocalMarket = {
    info: { basis: "branch_counties", places: ["Leon County"], sodYear: 2025, institutions: 4, source: { label: "SOD" } },
    rows: [
      { institutionId: 1, name: "Harbor Ridge Test Bank", own: true, marketDeposits: null, values: { overdraft: 35, nsf: 35 } },
      { institutionId: 2, name: "Lakeside Test Bank", own: false, marketDeposits: 9, values: { overdraft: 30, nsf: 32 }, several: { nsf: { min: 30, max: 34, fees: [] } as never } },
      { institutionId: 3, name: "Space Coast Credit Union", own: false, marketDeposits: 8, values: { overdraft: 25 } },
      { institutionId: 4, name: "Pine Test Credit Union", own: false, marketDeposits: 7, values: { overdraft: 28 } },
    ],
  };
  const filings = new Map<number, FinancialPoint[]>([
    [1, DATES.slice(-4).map((d) => point(d, { serviceCharges: 5_000_000, deposits: 4_000_000_000 }))],
    [2, DATES.slice(-4).map((d) => point(d, { serviceCharges: 1_000_000, deposits: 2_000_000_000 }))],
    [4, DATES.slice(-4).map((d) => point(d, { source: "ncua", serviceCharges: 1_000_000, deposits: 2_000_000_000 }))],
  ]);

  it("lists the subject first, drops a name the site never shows and compares fee share like for like", () => {
    const card = buildScorecard(market, filings)!;
    expect(card.rows.map((r) => r.label)).toEqual(["Harbor Ridge Test Bank", "Lakeside Test Bank", "Pine Test Credit Union"]);
    expect(card.columns.map((c) => c.key)).toEqual(["assets", "overdraft", "nsf", "share"]);
    expect(card.rows[0].values.share).toBeCloseTo(0.5);
    expect(card.rows[1].values.share).toBeCloseTo(0.2);
    expect(card.rows[1].values.nsf).toBeNull();
    expect(card.rows[2].values.share).toBeNull();
    expect(card.compareValues["2"]).toEqual({ overdraft: 30 });
    expect(card.note).toContain("Leon County");
  });

  it("is null without a local market", () => {
    expect(buildScorecard(null, filings)).toBeNull();
    expect(feeShareOfDeposits([]).pct).toBeNull();
  });
});

describe("buildChanges", () => {
  const change = (name: string, category: string, from: number, to: number, at: string) => ({
    institution_name: name, fee_category: category, display_name: category, old_amount: from, new_amount: to, direction: (to > from ? "up" : "down") as "up" | "down", changed_at: at,
  });
  const base = { institutionName: "Harbor Ridge Test Bank", stateLabel: "Florida", windowDays: 180, ownCategories: new Set(["overdraft"]) };

  it("says plainly when no change touches the institution's fees", () => {
    const out = buildChanges({ ...base, changes: [change("Lakeside Test Bank", "wire", 25, 30, "2026-10-01")] });
    expect(out.headline).toBe("No institution in Florida changed a fee Harbor Ridge Test Bank publishes in the last 180 days. Other confirmed changes in Florida:");
    expect(out.items[0]).toMatchObject({ institution: "Lakeside Test Bank", matches: false, direction: "up" });
    expect(buildChanges({ ...base, changes: [] }).headline).toBe("No institution in Florida has a confirmed fee change in the last 180 days.");
    expect(buildChanges({ ...base, changes: null }).headline).toBe("Fee changes in Florida could not be read just now.");
  });

  it("counts matching changes, newest first, and never names a hidden institution", () => {
    const out = buildChanges({ ...base, changes: [
      change("Lakeside Test Bank", "overdraft", 35, 30, "2026-09-01"),
      change("Space Coast Credit Union", "overdraft", 30, 32, "2026-10-01"),
    ] });
    expect(out.headline).toBe("2 confirmed changes in Florida in the last 180 days to a fee Harbor Ridge Test Bank publishes.");
    expect(out.items.map((i) => i.institution)).toEqual(["Lakeside Test Bank"]);
  });
});

describe("askPrompts", () => {
  it("opens the Ask page with the question and the institution", () => {
    const prompts = askPrompts({ institutionId: 323, topAboveCategory: "atm_non_network", groupLabel: "institutions in Florida", stateLabel: "Florida" });
    expect(prompts[0].label).toBe("How does our non-network ATM fee compare with institutions in Florida?");
    expect(prompts[0].href).toMatch(/^\/pro\/analyze\?q=.+&instId=323$/);
  });
});

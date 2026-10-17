import { describe, expect, it } from "vitest";
import type { CityMarket, CityMarketInstitution, IndexEntry } from "@/lib/data-store";
import { coverage, depositLeaders, depositsLabel, localFees, marketFindings, pctLabel, trend } from "./market-view";

function inst(id: number, over: Partial<CityMarketInstitution> = {}): CityMarketInstitution {
  return {
    id,
    name: `Institution ${id}`,
    charter: "bank",
    hq_city: null,
    hq_state: null,
    branches: 1,
    deposits: null,
    schedule: "none",
    fees: {},
    ...over,
  };
}

function overdraft(amount: number) {
  return { overdraft: { amount, fee_name: "Overdraft", account: null, conditions: [], source_line: null, source_url: null, read_on: null } };
}

function market(institutions: CityMarketInstitution[], areaDeposits = 0): CityMarket {
  return {
    city: "Orlando",
    state: "FL",
    area: "city",
    metro: null,
    sod_year: 2026,
    institutions,
    bank_branches: institutions.filter((i) => i.charter === "bank").reduce((s, i) => s + i.branches, 0),
    cu_branches: institutions.filter((i) => i.charter === "credit_union").reduce((s, i) => s + i.branches, 0),
    points: [],
    unplaced: [],
    deposit_years: [
      { year: 2021, area_deposits: 100, area_branches: 20, state_deposits: 1000, state_branches: 200, us_deposits: 10000, us_branches: 2000 },
      { year: 2026, area_deposits: areaDeposits, area_branches: 10, state_deposits: 1100, state_branches: 180, us_deposits: 12000, us_branches: 1900 },
    ],
    community: { area: null, state: null, us: null },
  };
}

const entry = (fee_category: string, median_amount: number) => ({ fee_category, median_amount }) as IndexEntry;

describe("city market view", () => {
  const published = [30, 32, 34, 35, 36].map((a, i) => inst(i + 1, { schedule: "published", fees: overdraft(a) }));
  const m = market([...published, inst(6, { charter: "credit_union", schedule: "found", branches: 3 }), inst(7)]);

  it("gives a local median only once five institutions publish the fee", () => {
    const fees = localFees(m, [entry("overdraft", 25)], [entry("overdraft", 30)]);
    const od = fees.find((f) => f.key === "overdraft")!;
    expect(od).toMatchObject({ n: 5, min: 30, max: 36, median: 34, state_median: 25, us_median: 30 });
    expect(fees.find((f) => f.key === "nsf")).toMatchObject({ n: 0, median: null });

    const thin = localFees(market(published.slice(0, 4)), [], []);
    expect(thin.find((f) => f.key === "overdraft")!.median).toBeNull();
  });

  it("counts institutions, charters, published schedules and branches", () => {
    expect(coverage(m)).toEqual({ institutions: 7, banks: 6, credit_unions: 1, with_fees: 5, branches: 9 });
  });

  it("states the gap to the state median with its count and never claims a cheapest", () => {
    const findings = marketFindings(localFees(m, [entry("overdraft", 25)], []), "Orlando", "Florida");
    expect(findings[0]).toBe(
      "Among the 5 institutions here that publish an overdraft fee, the median is $34, $9 above the Florida median of $25.",
    );
    expect(findings.join(" ")).not.toMatch(/cheapest|lowest|best/i);
    expect(findings.some((f) => f.includes("monthly maintenance") && f.includes("no local median"))).toBe(true);
  });

  it("ranks banks by deposits here, as a share of all bank deposits here", () => {
    const leaders = depositLeaders(
      market([inst(1, { deposits: 60 }), inst(2, { deposits: 40 }), inst(3, { charter: "credit_union", deposits: null })], 100),
    );
    expect(leaders.map((l) => [l.id, l.share])).toEqual([
      [1, 0.6],
      [2, 0.4],
    ]);
    expect(depositLeaders(market([inst(1, { deposits: 60 })], 0))).toEqual([]);
  });

  it("measures change over the years back from the latest", () => {
    const t = trend(market([], 150).deposit_years, 5, (y) => [y.area_deposits, y.state_deposits, y.us_deposits]);
    expect(t).toEqual({ from: 2021, to: 2026, area: 0.5, state: 0.1, us: 0.2 });
    expect(trend(market([], 150).deposit_years, 10, (y) => [y.area_deposits, y.state_deposits, y.us_deposits])).toBeNull();
  });

  it("labels deposits and percents in plain words", () => {
    expect(depositsLabel(12_345_678)).toBe("$12.3 billion");
    expect(depositsLabel(340_000)).toBe("$340 million");
    expect(pctLabel(0.123)).toBe("+12%");
    expect(pctLabel(-0.05)).toBe("-5%");
    expect(pctLabel(null)).toBe("n/a");
  });
});

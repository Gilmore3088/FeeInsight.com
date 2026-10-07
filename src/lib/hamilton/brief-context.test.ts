import { describe, expect, it } from "vitest";
import { buildIndicatorSeries, type StateEconomicContext } from "@/lib/data-store/economic-context";
import { buildEconomy, buildLocalIncome, buildMarket } from "./brief-context";

const monthly = (start: string, values: number[]) =>
  values.map((value, i) => {
    const d = new Date(`${start}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - i);
    return { observation_date: d.toISOString().slice(0, 10), value };
  });

function ctx(overrides: Partial<StateEconomicContext> = {}): StateEconomicContext {
  return {
    state_unemployment: buildIndicatorSeries("FLUR", monthly("2026-08-01", [4.5, 4.6, 4.7, 4.8, 4.8, 4.7, 4.6, 4.5, 4.3, 4.3, 0, 4.2, 4.0])),
    state_payrolls: buildIndicatorSeries("FLNA", monthly("2026-08-01", [10060, 10050, 10040, 10030, 10020, 10010, 10000, 9990, 9980, 9970, 9960, 9950, 10000])),
    national_unemployment: buildIndicatorSeries("UNRATE", monthly("2026-08-01", [4.1, 4.1, 4.2, 4.3, 4.3, 4.3, 4.4, 4.3, 4.4, 4.5, 0, 4.4, 4.3])),
    fed_funds: null,
    cpi_all_items: buildIndicatorSeries("CUUR0000SA0", monthly("2026-08-01", [103.4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 100])),
    cpi_bank_services: buildIndicatorSeries("CUUR0000SEMC01", monthly("2026-08-01", [102, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 100])),
    beige_book: null,
    regulatory: [],
    ...overrides,
  };
}

describe("buildEconomy", () => {
  it("compares the state rate with the U.S. and a year earlier, and skips months BLS never published", () => {
    const economy = buildEconomy(ctx(), "Florida", "Atlanta")!;
    expect(economy.commentary[0]).toBe(
      "Florida's unemployment rate was 4.5% in August 2026, up from 4.0% a year earlier and above the U.S. rate of 4.1%.",
    );
    expect(economy.commentary[1]).toMatch(/^More people out of work than nationally/);
    expect(economy.commentary.join(" ")).toContain("Payroll jobs in Florida grew 0.6% over the year.");
    expect(economy.commentary.join(" ")).toContain("rose 2.0% over the year, slower than the 3.4% for all consumer prices.");
    expect(economy.unemployment.some((p) => p.state === 0 || p.national === 0)).toBe(false);
    expect(economy.unemployment[economy.unemployment.length - 1]).toEqual({ date: "2026-08-01", state: 4.5, national: 4.1 });
  });

  it("says nothing it has no figure for", () => {
    expect(buildEconomy(ctx({ state_unemployment: null, state_payrolls: null, cpi_bank_services: null, cpi_all_items: null }), "Florida", null)).toBeNull();
  });
});

describe("buildMarket", () => {
  const member = (name: string, deposits: number | null, subject = false) => ({
    institution_id: name.length,
    institution_name: name,
    city: null,
    state_code: null,
    charter_type: null,
    market_deposits: deposits,
    is_subject: subject,
  });

  it("computes shares, HHI and the subject's rank from SOD deposits", () => {
    const market = buildMarket(
      { basis: "branch_counties", places: ["Camp Hill, PA"], county_fips: ["42041"], sod_year: 2026, members: [member("A", 50), member("Us", 30, true), member("B", 20)] },
      "Us",
    )!;
    expect(market.shares.map((s) => [s.name, Math.round(s.share)])).toEqual([["A", 50], ["Us", 30], ["B", 20]]);
    expect(market.hhi).toBe(3800);
    expect(market.commentary[1]).toContain("highly concentrated");
    expect(market.commentary[2]).toBe("Us holds 30.0% of local deposits, number 2 of 3.");
  });

  it("says when the subject is outside the SOD instead of showing a share", () => {
    const market = buildMarket(
      { basis: "hq_city", places: ["Melbourne, FL"], county_fips: ["12009"], sod_year: 2026, members: [member("A", 50), member("B", 50), member("CU", null, true)] },
      "CU",
    )!;
    expect(market.subjectInSod).toBe(false);
    expect(market.commentary[2]).toMatch(/credit unions do not report branch deposits/);
  });
});

describe("buildLocalIncome", () => {
  it("weights county incomes by population against the state", () => {
    const income = buildLocalIncome(
      [{ name: "A County", income: 80000, population: 300 }, { name: "B County", income: 70000, population: 100 }],
      { name: "Pennsylvania", income: 73000 },
      2022,
    )!;
    expect(income.commentary[0]).toBe(
      "Median household income in the 2 market counties is $77,500 (weighted by population), 6% above Pennsylvania's $73,000.",
    );
  });
});

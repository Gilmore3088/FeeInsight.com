import { describe, expect, it } from "vitest";
import type { IndicatorSeries, StateEconomicContext } from "@/lib/data-store/economic-context";
import type { StateVisualsData } from "@/lib/data-store/state-visuals";
import { renderStateFeeIndexReport } from "./state-fee-index";
import { ladderRows, niceTicks, yearOverYear, type StateReportVisuals } from "./state-exhibits";
import { FIXTURE_EMPTY_STATE_REPORT, FIXTURE_STATE_REPORT } from "./__fixtures__/state-report.fixture";

const TN = { ...FIXTURE_STATE_REPORT, stateCode: "TN", stateName: "Tennessee" };

const visualsData: StateVisualsData = {
  sod_year: 2026,
  institutions: [
    { institution_id: 1, name: "First Fixture Bank", charter: "bank", fees: { overdraft: 35, nsf: 30 } },
    { institution_id: 2, name: "Second Fixture Bank", charter: "bank", fees: { overdraft: 32 } },
    { institution_id: 3, name: "Fixture FCU", charter: "credit_union", fees: { overdraft: 25, nsf: 25 } },
    { institution_id: 4, name: "Other FCU", charter: "credit_union", fees: { overdraft: 25 } },
  ],
  counties: [
    { fips: "47037", deposits: 50e9, covered_deposits: 40e9, overdraft: 34, institutions: 30 },
    { fips: "47157", deposits: 30e9, covered_deposits: 20e9, overdraft: 31, institutions: 25 },
    { fips: "47001", deposits: 1e9, covered_deposits: 0, overdraft: null, institutions: 4 },
  ],
  holders: [
    { institution_id: 1, name: "First Fixture Bank, National Association", hq_state: "TN", deposits: 40e9, branches: 200, overdraft: 35 },
    { institution_id: 9, name: "Out of State Bank", hq_state: "NC", deposits: 20e9, branches: 90, overdraft: null },
  ],
};

function series(id: string, start: number, values: number[]): IndicatorSeries {
  const history = values.map((value, i) => {
    const m = start + i;
    return { date: `${Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, "0")}-01`, value };
  });
  return { series_id: id, latest: history[history.length - 1], year_ago: null, history };
}

const start = 2021 * 12;
const economy: StateEconomicContext = {
  state_unemployment: series("TNUR", start, Array.from({ length: 60 }, (_, i) => 3 + (i % 7) / 10)),
  national_unemployment: series("UNRATE", start, Array.from({ length: 60 }, (_, i) => 3.5 + (i % 5) / 10)),
  cpi_all_items: series("CPIAUCSL", start, Array.from({ length: 60 }, (_, i) => 100 * 1.003 ** i)),
  cpi_bank_services: null,
  state_payrolls: null,
  fed_funds: series("FEDFUNDS", start, Array.from({ length: 60 }, (_, i) => Math.min(5.33, i / 8))),
  beige_book: null,
  regulatory: [],
};

const visuals: StateReportVisuals = { data: visualsData, economy };
const html = renderStateFeeIndexReport({ data: TN, generatedAt: "2026-10-06", visuals });

describe("state report exhibits", () => {
  it("draws the county map from Tennessee county outlines", () => {
    expect(html).toContain('id="county-map"');
    expect(html).toContain("Davidson: $34");
    expect(html).toContain("no verified overdraft fee yet");
    // 60B covered of 81B deposits; (34*40 + 31*20) / 60 = $33.
    expect(html).toContain("hold 74% of the deposits at Tennessee branches");
    expect(html).toContain("averages $33.");
  });

  it("places every institution on the fee ladder with the national band", () => {
    const rows = ladderRows(TN, visualsData);
    expect(rows.map((r) => r.label)).toEqual(["Overdraft (OD)"]); // NSF has only 2 institutions
    expect(rows[0].points).toHaveLength(4);
    expect(html).toContain("First Fixture Bank: $35");
    expect(html).toContain("Middle half, U.S.");
  });

  it("lists deposit holders with their overdraft fee or not yet", () => {
    expect(html).toContain("The 2 largest holders of Tennessee deposits");
    expect(html).toContain("based in NC");
    expect(html).toContain("not yet");
    expect(html).toContain("First Fixture Bank<"); // ", National Association" dropped
  });

  it("shows unemployment and prices with their sources", () => {
    expect(html).toContain("Tennessee unemployment was 3.3% in December 2025, against 3.9% nationally");
    expect(html).toContain("BLS consumer price index");
    expect(html).toContain("Fed funds rate");
  });

  it("numbers exhibits in order and uses lower/higher wording", () => {
    const labels = [...html.matchAll(/Exhibit (\d+) · /g)].map((m) => Number(m[1]));
    expect(labels).toEqual(labels.map((_, i) => i + 1));
    expect(html).not.toMatch(/cheaper|pricier/i);
    expect(html.slice(html.indexOf("<body>"))).not.toContain("—");
  });

  it("says so when the chart data is missing", () => {
    const doc = renderStateFeeIndexReport({
      data: FIXTURE_EMPTY_STATE_REPORT,
      generatedAt: "2026-10-06",
      visuals: { data: null, economy: null },
    });
    expect(doc).toContain("Branch deposit figures for Fixture State are not loaded yet");
    expect(doc).toContain("Economic series for Fixture State are not loaded yet");
    expect(doc).not.toContain("<svg class=\"state-chart\"");
  });
});

describe("helpers", () => {
  it("computes change from a year earlier only where that month exists", () => {
    const yoy = yearOverYear([
      { date: "2024-01-01", value: 100 },
      { date: "2024-06-01", value: 101 },
      { date: "2025-01-01", value: 103 },
    ]);
    expect(yoy).toHaveLength(1);
    expect(yoy[0].date).toBe("2025-01-01");
    expect(yoy[0].value).toBeCloseTo(3);
  });

  it("covers the range with round ticks starting at or below zero", () => {
    expect(niceTicks(0, 7.9)).toEqual([0, 2, 4, 6, 8]);
    expect(niceTicks(-1.2, 8.4)).toEqual([-2, 0, 2, 4, 6, 8, 10]);
  });
});

import { describe, expect, it } from "vitest";
import type { NationalQuarterlyPayload } from "@/lib/report-assemblers/national-quarterly";
import type { MonthlyPulsePayload } from "@/lib/report-assemblers/monthly-pulse";
import type { StateReportData } from "@/lib/research-report/state-report-data";
import {
  describeReconciliation,
  nationalPrintedFigures,
  pulsePrintedFigures,
  reconcileFigures,
  reconciliationTiesOut,
  statePrintedFigures,
  type LiveData,
  type LiveFeeRow,
  type PrintedFigures,
} from "./reconcile";

/** Five banks and five credit unions in two states; nsf $10..$28 and $11..$29. */
function rows(): LiveFeeRow[] {
  const out: LiveFeeRow[] = [];
  for (let i = 1; i <= 10; i++) {
    out.push({
      institution_id: i,
      fee_category: "nsf",
      amount: 8 + i * 2,
      charter_type: i <= 5 ? "bank" : "credit_union",
      state_code: i % 2 === 0 ? "VT" : "NH",
      fed_district: 1,
      asset_size_tier: "community_small",
    });
  }
  // A second, higher row at institution 1 counts once (its median), never twice.
  out.push({ ...out[0], amount: 12 });
  return out;
}

const live = (feeRows: LiveFeeRow[] = rows(), extra: Partial<LiveData> = {}): LiveData => ({
  feeRows,
  rateRows: [],
  changeRows: [],
  pulseCoverage: null,
  ...extra,
});

function only(printed: PrintedFigures, ids: string[]): PrintedFigures {
  return { ...printed, figures: printed.figures.filter((f) => ids.includes(f.id)) };
}

const nationalPayload = {
  categories: [
    {
      fee_category: "nsf",
      median_amount: 19,
      p25_amount: null,
      p75_amount: null,
      institution_count: 10,
      bank_median: 14,
      cu_median: 24,
      bank_count: 5,
      cu_count: 5,
    },
  ],
  rate_categories: [],
  regional: {
    districts: [{ key: "1", label: "1 Boston", fees: { nsf: { median: 19, institutions: 10 } } }],
    sizes: [],
    states: [{ key: "VT", label: "Vermont", fees: { nsf: { median: 20, institutions: 5 } } }],
  },
  fee_changes: null,
} as unknown as NationalQuarterlyPayload;

describe("printed figures", () => {
  it("lists a national report's category, charter and regional figures, and what it leaves unchecked", () => {
    const printed = nationalPrintedFigures(nationalPayload);
    const ids = printed.figures.map((f) => f.id);
    expect(ids).toContain("national.nsf.median");
    expect(ids).toContain("charter:bank.nsf.median");
    expect(ids).toContain("district:1.nsf.median");
    expect(ids).toContain("state:VT.nsf.institutions");
    expect(printed.unchecked.map((u) => u.section)).toContain("Service-charge income");
  });

  it("skips a state report's blank national figures and counts its coverage", () => {
    const data = {
      stateCode: "VT",
      comparisons: [
        { fee_category: "nsf", median_amount: 20, p25_amount: null, p75_amount: null, institution_count: 5, bank_count: 2, cu_count: 3, national_median: null, national_p25: null, national_p75: null, delta_pct: null },
      ],
      charterPairs: [],
      verified: { institutions: 5, banks: 2, credit_unions: 3, fees: 5 },
    } as unknown as StateReportData;
    const ids = statePrintedFigures(data).figures.map((f) => f.id);
    expect(ids).not.toContain("national.nsf.median");
    expect(ids).toContain("state:VT.coverage.fee_rows");
  });
});

describe("reconcileFigures", () => {
  it("ties out a report recomputed from the same live rows", () => {
    const printed = nationalPrintedFigures(nationalPayload);
    // p25/p75 printed blank where live has a value: these two are left out of this case.
    const result = reconcileFigures(
      { ...printed, figures: printed.figures.filter((f) => !f.id.endsWith(".p25") && !f.id.endsWith(".p75")) },
      live(),
    );
    expect(result.findings).toEqual([]);
    expect(result.ties_out).toBe(true);
    expect(result.figures_checked).toBe(result.figures_tied);
  });

  it("finds a median more than a cent off, and allows one cent", () => {
    const printed = nationalPrintedFigures(nationalPayload);
    const median = only(printed, ["national.nsf.median"]);
    const cent = { ...median, figures: [{ ...median.figures[0], printed: 19.01 } as PrintedFigures["figures"][number]] };
    expect(reconcileFigures(cent, live()).ties_out).toBe(true);
    const off = { ...median, figures: [{ ...median.figures[0], printed: 19.5 } as PrintedFigures["figures"][number]] };
    const result = reconcileFigures(off, live());
    expect(result.ties_out).toBe(false);
    expect(result.findings[0]).toMatchObject({ id: "national.nsf.median", printed: 19.5, live: 19, reason: "differs" });
  });

  it("allows one institution of difference, not two", () => {
    const printed = only(nationalPrintedFigures(nationalPayload), ["national.nsf.institutions"]);
    expect(reconcileFigures(printed, live(rows().filter((r) => r.institution_id !== 10))).ties_out).toBe(true);
    const result = reconcileFigures(printed, live(rows().filter((r) => Number(r.institution_id) < 9)));
    expect(result.findings[0]).toMatchObject({ printed: 10, live: 8, reason: "differs" });
  });

  it("finds a figure printed where live has none, and one live has that the report left blank", () => {
    const printed = nationalPrintedFigures(nationalPayload);
    const thin = live(rows().filter((r) => Number(r.institution_id) <= 3));
    const medianFinding = reconcileFigures(only(printed, ["national.nsf.median"]), thin).findings[0];
    expect(medianFinding.reason).toBe("printed_without_live_value");
    const blank = reconcileFigures(only(printed, ["national.nsf.p25"]), live()).findings[0];
    expect(blank).toMatchObject({ printed: null, reason: "live_value_not_printed" });
  });

  it("applies the regional display rule: a median under five institutions prints blank", () => {
    const printed = only(nationalPrintedFigures(nationalPayload), ["state:VT.nsf.median"]);
    const four = live(rows().filter((r) => r.institution_id !== 10));
    const blankPrinted = { ...printed, figures: [{ ...printed.figures[0], printed: null } as PrintedFigures["figures"][number]] };
    expect(reconcileFigures(blankPrinted, four).ties_out).toBe(true);
    expect(reconcileFigures(printed, four).findings[0].reason).toBe("printed_without_live_value");
  });

  it("checks that each printed fee change is still a live fee", () => {
    const pulse = {
      changes: [
        { institution_id: 7, institution_name: "Seven CU", fee_category: "nsf", new_amount: 22 },
        { institution_id: 7, institution_name: "Seven CU", fee_category: "nsf", new_amount: 35 },
        { institution_name: "No Id Bank", fee_category: "nsf", new_amount: 10 },
      ],
      coverage: { institutions_live: 10, institutions_added_in_window: 1, live_fees: 11 },
      window_started_at: "2026-09-14T00:00:00.000Z",
    } as unknown as MonthlyPulsePayload;
    const printed = pulsePrintedFigures(pulse);
    const result = reconcileFigures(
      printed,
      live([], {
        changeRows: [{ institution_id: 7, fee_category: "nsf", amount: "22.00" }],
        pulseCoverage: { institutions_live: 10, institutions_added_in_window: 1, live_fees: 30 },
      }),
    );
    expect(result.findings.map((f) => f.reason)).toEqual(["not_live", "cannot_check", "differs"]);
    expect(printed.pulse_window_start).toBe("2026-09-14T00:00:00.000Z");
  });
});

describe("whole-scope totals", () => {
  const pulse = (live_fees: number) =>
    ({
      changes: [],
      coverage: { institutions_live: 4000, institutions_added_in_window: 1, live_fees },
      window_started_at: "2026-09-14T00:00:00.000Z",
    }) as unknown as MonthlyPulsePayload;
  const coverage = (live_fees: number) => live([], { pulseCoverage: { institutions_live: 4007, institutions_added_in_window: 1, live_fees } });

  it("allow drift up to 0.5% or 5, whichever is larger, and record it", () => {
    // 60,000 live fees: 0.5% is 300. 4,000 institutions: 0.5% is 20.
    const result = reconcileFigures(pulsePrintedFigures(pulse(60_000)), coverage(60_250));
    expect(result.ties_out).toBe(true);
    expect(result.drift).toEqual([
      { id: "pulse.coverage.institutions_live", label: "Institutions with live fees", printed: 4000, live: 4007, allowed: 20 },
      { id: "pulse.coverage.live_fees", label: "Live fees", printed: 60_000, live: 60_250, allowed: 300 },
    ]);
  });

  it("block a total that moved more than its allowance", () => {
    const result = reconcileFigures(pulsePrintedFigures(pulse(60_000)), coverage(60_400));
    expect(result.findings.map((f) => f.id)).toEqual(["pulse.coverage.live_fees"]);
  });

  it("allow at least 5 on a small total", () => {
    const result = reconcileFigures(pulsePrintedFigures(pulse(100)), coverage(105));
    expect(result.ties_out).toBe(true);
    expect(reconcileFigures(pulsePrintedFigures(pulse(100)), coverage(106)).ties_out).toBe(false);
  });
});

describe("the Pulse's institutions added this month", () => {
  // #1249: a 30-day window count, not a whole-scope total, so the one-institution rule.
  const pulse = (added: number) =>
    ({
      changes: [],
      coverage: { institutions_live: 4000, institutions_added_in_window: added, live_fees: 60_000 },
      window_started_at: "2026-09-14T00:00:00.000Z",
    }) as unknown as MonthlyPulsePayload;
  const liveAdded = (added: number) =>
    live([], { pulseCoverage: { institutions_live: 4000, institutions_added_in_window: added, live_fees: 60_000 } });

  it("blocks a small month that moved by more than one institution", () => {
    const result = reconcileFigures(pulsePrintedFigures(pulse(2)), liveAdded(7));
    expect(result.findings).toEqual([
      { id: "pulse.coverage.institutions_added_in_window", label: "Institutions added this month", printed: 2, live: 7, reason: "differs" },
    ]);
    expect(result.drift).toEqual([]);
  });

  it("allows one institution and records no drift", () => {
    const result = reconcileFigures(pulsePrintedFigures(pulse(2)), liveAdded(3));
    expect(result.ties_out).toBe(true);
    expect(result.drift).toEqual([]);
    expect(reconcileFigures(pulsePrintedFigures(pulse(2)), liveAdded(4)).ties_out).toBe(false);
  });
});

describe("describeReconciliation and the Publish gate", () => {
  it("names the first figures that failed and how many more", () => {
    const printed = nationalPrintedFigures(nationalPayload);
    const result = reconcileFigures(printed, live([]));
    const line = describeReconciliation(result, 2);
    expect(line).toMatch(/^Reconciliation blocked the report: \d+ of \d+ printed fee figures do not tie out\. /);
    expect(line).toMatch(/National nsf median: printed 19, live blank/);
    expect(line).toMatch(/and \d+ more\.$/);
  });

  it("publishes only a job whose saved reconciliation tied out", () => {
    const tied = reconcileFigures({ report_type: "state_index", figures: [], unchecked: [] }, live());
    expect(reconciliationTiesOut({ reconciliation: tied })).toBe(true);
    expect(reconciliationTiesOut(JSON.stringify({ reconciliation: tied }))).toBe(true);
    expect(reconciliationTiesOut({ reconciliation: { ...tied, ties_out: false } })).toBe(false);
    expect(reconciliationTiesOut(null)).toBe(false);
    expect(reconciliationTiesOut({ queries: [] })).toBe(false);
  });
});

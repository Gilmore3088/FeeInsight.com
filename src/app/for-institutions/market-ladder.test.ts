import { describe, expect, it } from "vitest";
import type { IndexEntry } from "@/lib/data-store/fee-index";
import type { FeeCategorySummary } from "@/lib/data-store/fees";
import type { MarketReport } from "@/lib/custom-report/report-data";
import { buildMarketLadder } from "./market-ladder";

const spread = { min_amount: 0, p25_amount: 25, median_amount: 30, p75_amount: 33, max_amount: 40, institution_count: 50 };
const entry = (fee_category: string, maturity_tier: IndexEntry["maturity_tier"] = "strong") =>
  ({ ...spread, fee_category, maturity_tier }) as IndexEntry;

const sample = {
  data: { subject: { institution_name: "Sample Bank", state_code: "TX", charter_type: "bank" } },
  analysis: {
    lines: [
      {
        key: "overdraft",
        label: "Overdraft",
        comparable: true,
        own: { amount: 35 },
        peers: { n: 12, p25: 28, median: 32, p75: 35, min: 20, max: 36 },
      },
    ],
  },
} as unknown as MarketReport;

describe("buildMarketLadder", () => {
  it("places the sample's fee in each layer it can read, and drops a thin one", () => {
    const ladder = buildMarketLadder({
      sample,
      stateIndex: [entry("overdraft", "insufficient")],
      charterIndex: [entry("overdraft")],
      national: [{ ...spread, fee_category: "overdraft" } as unknown as FeeCategorySummary],
    });
    expect(ladder?.value).toBe(35);
    expect(ladder?.rows.map((r) => r.label)).toEqual(["Local competitors", "Banks nationwide", "The nation"]);
  });

  it("opens on the preferred fee when it can be placed, else falls back, and carries the latest read date", () => {
    const withWire = {
      ...sample,
      analysis: {
        lines: [
          ...sample.analysis.lines,
          {
            key: "wire_intl_outgoing",
            label: "Wire",
            comparable: true,
            own: { amount: 45, schedule_read_on: "2026-10-01" },
            peers: { n: 6, p25: 40, median: 45, p75: 50, min: 35, max: 55 },
            peerFigures: [{ schedule_read_on: "2026-10-09" }, { schedule_read_on: null }],
          },
        ],
      },
    } as unknown as MarketReport;
    const base = { sample: withWire, stateIndex: [], charterIndex: [entry("overdraft"), entry("wire_intl_outgoing")], national: [] };
    const wire = buildMarketLadder({ ...base, preferKey: "wire_intl_outgoing" });
    expect(wire?.value).toBe(45);
    expect(wire?.readOn).toBe("2026-10-09");
    expect(buildMarketLadder({ ...base, preferKey: "monthly_maintenance" })?.value).toBe(35);
    expect(buildMarketLadder(base)?.value).toBe(35);
  });
});

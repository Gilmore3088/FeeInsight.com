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
});

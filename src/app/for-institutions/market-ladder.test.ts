import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IndexEntry } from "@/lib/data-store/fee-index";
import type { FeeCategorySummary } from "@/lib/data-store/fees";
import type { MarketReport } from "@/lib/custom-report/report-data";
import { getPeerIndexCached } from "@/lib/data-store/public-cached-reads";
import { homeReadsCacheable } from "@/app/landing-shared";
import { buildMarketLadder, readSampleLadder } from "./market-ladder";

vi.mock("@/lib/data-store/public-cached-reads", () => ({ getPeerIndexCached: vi.fn() }));

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

describe("readSampleLadder", () => {
  const national = [{ ...spread, fee_category: "overdraft" } as unknown as FeeCategorySummary];
  const peerIndex = vi.mocked(getPeerIndexCached);
  const home = { summary: { complete: true }, categories: national, sampleFailed: false, overdraftFailed: false };

  beforeEach(() => {
    peerIndex.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("reports a failed state or charter read, so the homepage render is not cached", async () => {
    peerIndex.mockImplementation(async (filter) => {
      if ("charter_type" in filter) throw new Error("connection reset");
      return [entry("overdraft")];
    });
    const read = await readSampleLadder(sample, national);
    expect(read.failed).toBe(true);
    expect(read.ladder?.rows.map((r) => r.label)).toEqual(["Local competitors", "Texas", "The nation"]);
    expect(homeReadsCacheable({ ...home, ladderFailed: read.failed })).toBe(false);
  });

  it("leaves a render cacheable when both reads answer", async () => {
    peerIndex.mockResolvedValue([entry("overdraft")]);
    const read = await readSampleLadder(sample, national);
    expect(read.failed).toBe(false);
    expect(read.ladder?.rows).toHaveLength(4);
    expect(homeReadsCacheable({ ...home, ladderFailed: read.failed })).toBe(true);
  });
});

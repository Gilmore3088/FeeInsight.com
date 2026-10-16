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

  it("opens on the preferred fee when it can be placed, else falls back, and carries the latest read date", () => {
    const withWire = {
      ...sample,
      analysis: {
        lines: [
          ...sample.analysis.lines,
          {
            key: "wire_intl_outgoing",
            label: "Outgoing international wire",
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
    // The sample report's own line name, as the other two exhibits show it.
    expect(wire?.feeLabel).toBe("Outgoing international wire");
    expect(wire?.readOn).toBe("2026-10-09");
    expect(buildMarketLadder({ ...base, preferKey: "monthly_maintenance" })?.value).toBe(35);
    expect(buildMarketLadder(base)?.value).toBe(35);
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

  it("reports a failed state read the same way, and keeps the charter row (#1586)", async () => {
    peerIndex.mockImplementation(async (filter) => {
      if ("state_code" in filter) throw new Error("connection reset");
      return [entry("overdraft")];
    });
    const read = await readSampleLadder(sample, national);
    expect(read.failed).toBe(true);
    expect(read.ladder?.rows.map((r) => r.label)).not.toContain("Texas");
    expect(read.ladder?.rows).toHaveLength(3);
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

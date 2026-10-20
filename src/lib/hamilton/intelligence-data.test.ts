import { describe, expect, it, vi } from "vitest";
const readers = vi.hoisted(() => ({ segment: vi.fn() }));
vi.mock("@/lib/data-store/fee-index", () => ({ getSegmentFeeValues: readers.segment, getPeerFeeValues: vi.fn() }));

vi.mock("@/lib/data-store/connection", () => ({ getSql: () => { throw new Error("no database in unit tests"); } }));

import { MIN_INSTITUTIONS_FOR_MEDIAN } from "@/lib/data-store/maturity";
import { buildFeeMap, buildFeeSpread, median, joinSeries, loadComplaintTrend, loadPeerTable, percentChange, yearOverYear } from "./intelligence-data";

it("retains a segment's stated price range and every source in the Intelligence projection (#1993)", async () => {
  const several = { low: 2.5, high: 3, fees: [{ name: "ATM A", amount: 2.5 }, { name: "ATM B", amount: 3 }] };
  const urls = ["https://bank.test/a.pdf", "https://bank.test/b.pdf"];
  readers.segment.mockResolvedValue({ institutionsInSegment: 4, values: [{ institution_id: 1, institution_name: "Bank", amount: 2.75, document_urls: urls, total_assets: 10, charter_type: "bank", published_at: null, several }] });
  expect(await loadPeerTable(null, "all", "atm_non_network")).toMatchObject({ institutionsInScope: 4, rows: [{ amount: 2.75, several, documentUrls: urls, documentUrl: null }] });
});

describe("buildFeeMap", () => {
  it("counts charters that share one fee schedule once, as the landscape table does", () => {
    const rows = Array.from({ length: 6 }, (_, i) => ({ institution_id: i + 1, state_code: "FL", amount: 30 + i }));
    const map = buildFeeMap("overdraft", [...rows, { institution_id: 99, state_code: "FL", amount: 20, counted_as: 1 }]);
    expect(map.nationalInstitutions).toBe(6);
    // Institution 1's schedule counts once, at the lower middle of $30 and $20.
    expect(map.nationalMedian).toBe(median([20, 31, 32, 33, 34, 35]));
  });

  it("withholds a state under the cohort floor instead of reporting its median", () => {
    const thick = Array.from({ length: MIN_INSTITUTIONS_FOR_MEDIAN }, (_, i) => ({ state_code: "TX", amount: 30 + i }));
    const map = buildFeeMap("overdraft", [...thick, { state_code: "VT", amount: 10 }, { state_code: null, amount: 99 }]);
    expect(map.states.find(s => s.stateCode === "TX")?.median).toBe(32);
    expect(map.states.find(s => s.stateCode === "VT")).toEqual({ stateCode: "VT", institutions: 1, median: null });
    expect(map.nationalInstitutions).toBe(MIN_INSTITUTIONS_FOR_MEDIAN + 2);
  });
});

describe("buildFeeSpread", () => {
  it("bins every value into even bands and withholds a cohort under the floor", () => {
    const spread = buildFeeSpread([25, 27, 30, 30, 32, 35, 36, 38]);
    expect(spread).toMatchObject({ count: 8, low: 25, high: 38, median: 31 });
    expect(spread!.bins.reduce((n, b) => n + b.count, 0)).toBe(8);
    expect(spread!.bins.length).toBeLessThanOrEqual(10);
    expect(buildFeeSpread(Array(MIN_INSTITUTIONS_FOR_MEDIAN - 1).fill(10))).toBeNull();
    expect(buildFeeSpread([0, 1, 2, 3, 10000])!.bins.length).toBeLessThanOrEqual(10);
  });
});

describe("series helpers", () => {
  it("computes twelve-month change only where the prior month exists", () => {
    const out = yearOverYear([
      { date: "2025-01-01", value: 100 },
      { date: "2025-02-01", value: 100 },
      { date: "2026-01-01", value: 110 },
    ]);
    expect(out).toEqual([{ date: "2026-01-01", value: expect.closeTo(10, 6) }]);
    expect(percentChange(5, 0)).toBeNull();
  });

  it("joins series by date and leaves gaps as null", () => {
    const rows = joinSeries({ a: [{ date: "2026-01-01", value: 1 }], b: [{ date: "2026-02-01", value: 2 }] });
    expect(rows).toEqual([{ period: "2026-01", a: 1, b: null }, { period: "2026-02", a: null, b: 2 }]);
  });
});

it("returns null rather than zeros when the complaint reader fails", async () => {
  await expect(loadComplaintTrend("TX")).resolves.toBeNull();
});

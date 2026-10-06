import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CustomReportMarketData, MarketFeeLine } from "@/lib/data-store/custom-report-market";

const live = vi.fn();
const saved = vi.fn();
vi.mock("@/lib/data-store/public-cached-reads", () => ({ getCustomReportMarketDataCached: (id: number) => live(id) }));
vi.mock("@/lib/data-store/report-payments", () => ({ getPaidReportSnapshot: (id: number) => saved(id) }));

const { loadMarketReport } = await import("./report-data");

const KEYS = ["overdraft", "nsf", "stop_payment", "cashiers_check", "wire_domestic_outgoing", "card_replacement"];
function market(competitors: number): CustomReportMarketData {
  const lines: MarketFeeLine[] = [];
  const rivals = [];
  for (const key of KEYS) lines.push({ institution_id: 1, line: key, amount: 20, fee_name: key, source_url: null, updated_at: null, schedule_read_on: null, source_line: key });
  for (let i = 0; i < competitors; i += 1) {
    rivals.push({ institution_id: 100 + i, institution_name: `R${i}`, city: null, state_code: "TX", charter_type: "bank", market_deposits: 100 - i });
    for (const key of KEYS) lines.push({ institution_id: 100 + i, line: key, amount: 10 + i, fee_name: key, source_url: null, updated_at: null, schedule_read_on: null, source_line: key });
  }
  return {
    subject: { institution_id: 1, institution_name: "S", city: null, state_code: "TX", charter_type: "bank", market_deposits: null, asset_size: null },
    market: { basis: "branch_counties", county_fips: ["48453"], places: ["Austin, TX"], sod_year: 2025 },
    competitors: rivals,
    lines,
    dropped: {},
  };
}

describe("loadMarketReport", () => {
  beforeEach(() => {
    live.mockReset();
    saved.mockReset();
  });

  it("uses live data when the market passes", async () => {
    live.mockResolvedValue(market(20));
    const report = await loadMarketReport(1);
    expect(report?.savedAt).toBeNull();
    expect(report?.analysis.readiness.ready).toBe(true);
    expect(saved).not.toHaveBeenCalled();
  });

  it("falls back to the copy saved at payment when the live market is thin", async () => {
    live.mockResolvedValue(market(5));
    saved.mockResolvedValue({ data: market(20), savedAt: "2026-10-06T14:00:00Z" });
    const report = await loadMarketReport(1);
    expect(report?.savedAt).toBe("2026-10-06T14:00:00Z");
    expect(report?.analysis.readiness.ready).toBe(true);
  });

  it("shows the thin live market when nothing was paid for", async () => {
    live.mockResolvedValue(market(5));
    saved.mockResolvedValue(null);
    const report = await loadMarketReport(1);
    expect(report?.savedAt).toBeNull();
    expect(report?.analysis.readiness.ready).toBe(false);
  });

  it("survives a failed saved-copy read", async () => {
    live.mockResolvedValue(market(5));
    saved.mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const report = await loadMarketReport(1);
    expect(report?.analysis.readiness.ready).toBe(false);
  });
});

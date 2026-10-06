import { describe, expect, it } from "vitest";
import type { CustomReportMarketData, MarketFeeLine } from "@/lib/data-store/custom-report-market";
import { analyzeMarket, MIN_COMPARABLE_LINES, quantile } from "./analysis";

const KEYS = ["overdraft", "nsf", "stop_payment", "cashiers_check", "wire_domestic_outgoing", "card_replacement"];

function market(opts: { competitors: number; ownKeys?: string[]; ownAmount?: number }): CustomReportMarketData {
  const lines: MarketFeeLine[] = [];
  for (const key of opts.ownKeys ?? KEYS) {
    lines.push({ institution_id: 1, line: key, amount: opts.ownAmount ?? 20, fee_name: `Own ${key}`, source_url: "https://a", updated_at: "2026-10-01", source_line: `${key} | $20` });
  }
  const competitors = [];
  for (let i = 0; i < opts.competitors; i += 1) {
    const id = 100 + i;
    competitors.push({ institution_id: id, institution_name: `Rival ${i}`, city: "X", state_code: "CA", charter_type: "bank", market_deposits: 1000 - i });
    for (const key of KEYS) lines.push({ institution_id: id, line: key, amount: 10 + i, fee_name: key, source_url: null, updated_at: null, source_line: key });
  }
  return {
    subject: { institution_id: 1, institution_name: "Subject Bank", city: "X", state_code: "CA", charter_type: "bank", market_deposits: null, asset_size: null },
    market: { basis: "branch_counties", county_fips: ["6037"], places: ["Los Angeles, CA"], sod_year: 2026 },
    competitors,
    lines,
    dropped: {},
  };
}

describe("analyzeMarket", () => {
  it("is ready with enough comparable lines and competitors with data", () => {
    const result = analyzeMarket(market({ competitors: 20 }));
    expect(result.readiness.ready).toBe(true);
    expect(result.readiness.comparableLines).toBe(KEYS.length);
    expect(result.named).toHaveLength(8);
    expect(result.named[0].institution_name).toBe("Rival 0");
  });

  it("holds when too few local competitors have verified fees", () => {
    const result = analyzeMarket(market({ competitors: 10 }));
    expect(result.readiness.ready).toBe(false);
    expect(result.readiness.reason).toContain("10 of 10 local competitors");
  });

  it("holds when the bank publishes too few lines", () => {
    const result = analyzeMarket(market({ competitors: 20, ownKeys: KEYS.slice(0, MIN_COMPARABLE_LINES - 1) }));
    expect(result.readiness.ready).toBe(false);
    expect(result.readiness.reason).toContain("headline fees verified");
  });

  it("holds when no local market was found", () => {
    const data = market({ competitors: 20 });
    const result = analyzeMarket({ ...data, market: null });
    expect(result.readiness.ready).toBe(false);
  });

  it("places the bank against the local quartiles and states it in the findings", () => {
    const result = analyzeMarket(market({ competitors: 20, ownAmount: 40 }));
    const overdraft = result.lines.find((l) => l.key === "overdraft")!;
    expect(overdraft.peers?.median).toBe(19.5);
    expect(overdraft.position).toBe("above_market");
    expect(overdraft.percentile).toBe(100);
    expect(result.findings[0]).toContain("($40) is above the local range");
    expect(result.findings.at(-1)).toBe("0 of your 6 comparable fee lines sit inside the middle half of your local market.");
  });

  it("never compares a line with fewer than 8 local peers", () => {
    const data = market({ competitors: 20 });
    data.lines = data.lines.filter((l) => !(l.line === "nsf" && l.institution_id >= 107));
    const nsf = analyzeMarket(data).lines.find((l) => l.key === "nsf")!;
    expect(nsf.peers?.n).toBe(7);
    expect(nsf.comparable).toBe(false);
    expect(nsf.position).toBeNull();
  });
});

describe("quantile", () => {
  it("interpolates like percentile_cont", () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantile([1, 2, 3, 4], 0.25)).toBe(1.75);
  });
});

describe("tiered fees", () => {
  it("keeps every stated tier on the bank's own line", () => {
    const data = market({ competitors: 20 });
    const own = data.lines.find((l) => l.institution_id === 1 && l.line === "overdraft")!;
    own.tiers = [
      { amount: 35, fee_name: "Negative from $50.01 and more", source_line: "Negative from $50.01 and more | $35" },
      { amount: 5, fee_name: "Negative $25 or less", source_line: "Negative $25 or less | $5" },
    ];
    const line = analyzeMarket(data).lines.find((l) => l.key === "overdraft")!;
    expect(line.own?.tiers?.map((t) => t.amount)).toEqual([35, 5]);
  });
});

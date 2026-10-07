import { describe, expect, it } from "vitest";
import { feesTouched, isConsumerLaw, marketMediansFrom } from "./regulatory-watch";
import { benchmarkCsvRows, positionAgainst } from "./benchmark-export";

describe("regulatory watch", () => {
  it("flags consumer-law subjects only, not safety-and-soundness ones", () => {
    expect(isConsumerLaw("Consumer Law; Unfair or Deceptive (UDAP)")).toBe(true);
    expect(isConsumerLaw("BSA Internal Controls; BSA Officer")).toBe(false);
    expect(isConsumerLaw(null)).toBe(false);
  });

  it("medians need three competitors", () => {
    const medians = marketMediansFrom(new Map([
      [1, new Map([["overdraft", 30], ["nsf", 25]])],
      [2, new Map([["overdraft", 34]])],
      [3, new Map([["overdraft", 36]])],
    ]));
    expect(medians.get("overdraft")).toEqual({ median: 34, count: 3 });
    expect(medians.get("nsf")).toEqual({ median: null, count: 1 });
  });

  it("ties a rule to the fees it touches, and an all-fees rule to the largest three", () => {
    const own = new Map([["overdraft", 35], ["nsf", 30], ["wire_domestic_outgoing", 25], ["monthly_maintenance", 10]]);
    const medians = new Map([["overdraft", { median: 32, count: 5 }]]);
    const od = feesTouched(["overdraft_nsf"], own, medians);
    expect(od.all_fees).toBe(false);
    expect(od.fees.map((f) => [f.fee_category, f.market_median])).toEqual([["overdraft", 32], ["nsf", null]]);
    const all = feesTouched(["deposit_disclosure"], own, medians);
    expect(all.all_fees).toBe(true);
    expect(all.fees.map((f) => f.fee_category)).toEqual(["overdraft", "nsf", "wire_domestic_outgoing"]);
    expect(feesTouched(["electronic_transfers"], new Map([["overdraft", 35]]), medians).fees).toEqual([]);
  });
});

describe("benchmark export", () => {
  it("places a fee against its asset-size peers", () => {
    const peers = { median: 30, p25: 26, p75: 34, institutions: 300 };
    expect(positionAgainst(25, peers)).toBe("lower");
    expect(positionAgainst(30, peers)).toBe("typical");
    expect(positionAgainst(35, peers)).toBe("higher");
    expect(positionAgainst(35, { median: null, p25: null, p75: null, institutions: 2 })).toBeNull();
  });

  it("writes one CSV row per fee in header order", () => {
    const rows = benchmarkCsvRows({
      institution: { id: 1, name: "B", state: "TX", charter_type: "bank", asset_tier: null },
      groups: { national: "", state: "", asset_peers: "", local_market: null },
      rows: [{
        fee_category: "nsf", display_name: "NSF", family: "Overdraft & NSF", amount: 30,
        national: { median: 29.99, p25: 25, p75: 35, institutions: 900 },
        state: { median: null, p25: null, p75: null, institutions: 2 },
        asset_peers: { median: 30, p25: 26, p75: 34, institutions: 300 },
        local_market: { median: null, institutions: 1 },
        position: "typical", source_url: null,
      }],
    });
    expect(rows).toEqual([["nsf", "NSF", "Overdraft & NSF", 30, 29.99, 25, 35, 900, null, 2, 30, 26, 34, 300, null, 1, "typical", null]]);
  });
});

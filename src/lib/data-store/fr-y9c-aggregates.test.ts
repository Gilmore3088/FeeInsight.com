import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn() }));

import { filerFactsFromRow, groupY9cFilers, medianOf, topTierOf, y9cAssetTier, type Y9cFilerFacts } from "./fr-y9c-aggregates";

const filer = (over: Partial<Y9cFilerFacts>): Y9cFilerFacts => ({
  rssd: "1",
  name: null,
  state: "TX",
  fedDistrict: 11,
  cbsaCode: null,
  cbsaName: null,
  totalAssets: null,
  serviceCharges: null,
  noninterestIncome: null,
  netIncome: null,
  interchange: null,
  deposits: null,
  netChargeOffs: null,
  ...over,
});

describe("fr-y9c aggregates", () => {
  it("medians carry their counts and skip missing values", () => {
    expect(medianOf([3, null, 1, 2])).toEqual({ median: 2, count: 3 });
    expect(medianOf([1, 4])).toEqual({ median: 2.5, count: 2 });
    expect(medianOf([null])).toEqual({ median: null, count: 0 });
  });

  it("tiers from thousands", () => {
    expect(y9cAssetTier(5_000_000)).toBe("midsize");
    expect(y9cAssetTier(null)).toBeNull();
  });

  it("groups by state and asset tier with per-median counts", () => {
    const rows = [
      filer({ rssd: "1", totalAssets: 5_000_000, serviceCharges: 100, noninterestIncome: 400 }),
      filer({ rssd: "2", totalAssets: 3_000_000, serviceCharges: null, noninterestIncome: 200 }),
      filer({ rssd: "3", state: "OK", fedDistrict: 10, totalAssets: 300_000_000 }),
      filer({ rssd: "4", state: null, totalAssets: null }),
    ];
    const byState = groupY9cFilers(rows, "state");
    expect(byState.map((g) => [g.key, g.holdingCompanies])).toEqual([
      ["OK", 1],
      ["TX", 2],
    ]);
    const tx = byState[1];
    expect(tx.serviceCharges).toEqual({ median: 100, count: 1 });
    expect(tx.noninterestIncome).toEqual({ median: 300, count: 2 });
    expect(tx.serviceChargeShareOfNoninterestIncome).toEqual({ median: 0.25, count: 1 });
    expect(groupY9cFilers(rows, "asset_tier").map((g) => g.key)).toEqual(["midsize", "mega"]);
    expect(groupY9cFilers(rows, "fed_district").map((g) => g.label)).toEqual(["Kansas City", "Dallas"]);
  });

  it("derives deposits and net charge-offs only from complete parts", () => {
    const base = {
      rssd: "1", name: null, state: null, fed_district: null, cbsa_code: null, cbsa_name: null, total_assets: "10",
      service_charges: null, noninterest_income: null, net_income: null, interchange: null,
      dep_dom_nib: "2", dep_dom_ib: "3", dep_for_nib: null, dep_for_ib: "1", charge_offs: "5", recoveries: null,
    };
    expect(filerFactsFromRow(base)).toMatchObject({ deposits: 6, netChargeOffs: null, totalAssets: 10 });
    expect(filerFactsFromRow({ ...base, dep_dom_ib: null, recoveries: "2" })).toMatchObject({ deposits: null, netChargeOffs: 3 });
  });

  it("top tier is the deepest open link", () => {
    const link = (parentRssd: string, depth: number) => ({
      parentRssd, parentName: null, entityType: null, state: null, startDate: "2020-01-01", endDate: null,
      relationshipLevel: 1, pctEquity: 100, depth,
    });
    expect(topTierOf([link("10", 1), link("11", 2)])?.parentRssd).toBe("11");
    expect(topTierOf([])).toBeNull();
  });
});

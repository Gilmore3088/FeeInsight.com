import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./connection", () => ({ sql: Object.assign(vi.fn(), { unsafe: vi.fn() }) }));
vi.mock("./peer-markets", () => ({ getHomeMarket: vi.fn(), getMarketInstitutionIds: vi.fn() }));

import { sql } from "./connection";
import { getHomeMarket, getMarketInstitutionIds } from "./peer-markets";
import { PeerSetError, definitionFor, describePeerSet, resolvePeerRequest, resolvePeerSet, type PeerSubject } from "./peer-sets";

const BANK: PeerSubject = {
  id: 12, charter_type: "bank", asset_size: 800_000, asset_size_tier: "community_mid", fed_district: 11,
  state_code: "TX", primary_regulator: "OCC", cu_charter_type: null, holding_company_rssd: "1234",
};
const unsafe = () => vi.mocked((sql as unknown as { unsafe: ReturnType<typeof vi.fn> }).unsafe);

describe("definitionFor", () => {
  it("fills same from the institution", () => {
    const def = definitionFor(BANK, { charter_type: "same", states: "same", regulators: "same", holding_company: "same" }, null);
    expect(def).toEqual({ charter_type: "bank", states: ["TX"], regulators: ["occ"], holding_company_rssd: "1234" });
  });

  it("refuses same for a dimension the institution lacks", () => {
    expect(() => definitionFor(BANK, { cu_charter: "same" }, null)).toThrow(PeerSetError);
    expect(() => definitionFor(BANK, { market: "same" }, null)).toThrow(/branch market/);
  });
});

describe("describePeerSet", () => {
  it("names basic and wider groups in plain words", () => {
    expect(describePeerSet({ charter_type: "bank", asset_tiers: ["community_mid"], fed_districts: [11] }))
      .toBe("Banks with $300M to $1B in assets in Fed district 11 (Dallas)");
    expect(describePeerSet({ charter_type: "credit_union", cu_charter: "state", asset_min: 500_000_000, asset_max: 2_000_000_000, states: ["TX", "OK"] }))
      .toBe("State credit unions with $500M to $2B in assets in TX, OK");
    expect(describePeerSet({ market_code: 19100 }, { code: 19100, name: "Dallas-Fort Worth-Arlington, TX" }))
      .toBe("Institutions with branches in the Dallas-Fort Worth-Arlington, TX metro");
    expect(describePeerSet({ charter_type: "bank", nearest: 20 })).toBe("The 20 banks closest in assets");
    expect(describePeerSet({ institutionIds: [4, 5] })).toBe("2 chosen institutions");
  });
});

describe("resolvePeerSet", () => {
  beforeEach(() => vi.clearAllMocks());

  it("passes a basic definition straight to the fee index", async () => {
    const def = { charter_type: "bank", states: ["TX"] };
    const resolved = await resolvePeerSet(def, BANK);
    expect(resolved.filters).toBe(def);
    expect(unsafe()).not.toHaveBeenCalled();
  });

  it("resolves wider dimensions to the exact institutions, without the subject", async () => {
    unsafe().mockResolvedValue([{ id: 4 }, { id: 5 }]);
    const resolved = await resolvePeerSet({ charter_type: "bank", asset_min: 500_000_000, regulators: ["occ", "fed"] }, BANK);
    expect(resolved.filters).toEqual({ institutionIds: [4, 5] });
    const [query, params] = unsafe().mock.calls[0];
    expect(query).toContain("s.asset_size >= $2");
    expect(query).toContain("s.primary_regulator = ANY($3::text[])");
    expect(query).toContain("s.id <> $4");
    expect(params).toEqual(["bank", 500_000, ["OCC", "Federal Reserve"], 12]);
  });

  it("returns no filters when nobody matches, never everyone", async () => {
    unsafe().mockResolvedValue([]);
    const resolved = await resolvePeerSet({ holding_company_rssd: "999" }, BANK);
    expect(resolved.filters).toBeNull();
  });

  it("limits a metro market to institutions with branches there", async () => {
    vi.mocked(getHomeMarket).mockResolvedValue({ code: 19100, name: "Dallas-Fort Worth-Arlington, TX" });
    vi.mocked(getMarketInstitutionIds).mockResolvedValue({ market: { code: 19100, name: "Dallas-Fort Worth-Arlington, TX" }, ids: new Set([4, 12, 30]) });
    unsafe().mockResolvedValue([{ id: 4 }, { id: 30 }]);
    const resolved = await resolvePeerRequest(BANK, { market: "same", charter_type: "same" });
    expect(resolved.label).toBe("Banks with branches in the Dallas-Fort Worth-Arlington, TX metro");
    expect(resolved.market?.code).toBe(19100);
    expect(getMarketInstitutionIds).toHaveBeenCalledTimes(1);
    expect(unsafe().mock.calls[0][1]).toContainEqual([4, 12, 30]);
  });

  it("orders nearest by asset distance among institutions that publish fees", async () => {
    unsafe().mockResolvedValue([{ id: 7 }]);
    await resolvePeerSet({ charter_type: "bank", nearest: 20 }, BANK);
    const [query, params] = unsafe().mock.calls[0];
    expect(query).toContain("EXISTS (SELECT 1 FROM published_fee_catalog");
    expect(query).toMatch(/ORDER BY ABS\(s\.asset_size - \$\d+::bigint\), s\.id LIMIT \$\d+/);
    expect(params.slice(-2)).toEqual([800_000, 20]);
  });

  it("refuses an unknown metro", async () => {
    vi.mocked(getMarketInstitutionIds).mockResolvedValue(null);
    await expect(resolvePeerSet({ market_code: 1 }, BANK)).rejects.toThrow(/No metro market/);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./connection", () => ({ sql: Object.assign(vi.fn(), { unsafe: vi.fn() }) }));
vi.mock("./peer-markets", () => ({ getHomeMarket: vi.fn(), getMarketInstitutionIds: vi.fn() }));

import { sql } from "./connection";
import { getHomeMarket, getMarketInstitutionIds } from "./peer-markets";
import { PeerSetError, definitionFor, describePeerSet, peerSetMemberIds, resolvePeerRequest, resolvePeerSet, type PeerSubject } from "./peer-sets";

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
      .toBe("Banks with $300M to $1B in assets in the Dallas Fed district");
    expect(describePeerSet({ charter_type: "credit_union", cu_charter: "state", asset_min: 500_000_000, asset_max: 2_000_000_000, states: ["TX", "OK"] }))
      .toBe("State credit unions with $500M to $2B in assets in Texas or Oklahoma");
    expect(describePeerSet({ market_code: 19100 }, { code: 19100, name: "Dallas-Fort Worth-Arlington, TX" }))
      .toBe("Institutions with branches in the Dallas-Fort Worth-Arlington, TX metro");
    expect(describePeerSet({ charter_type: "bank", nearest: 20 })).toBe("The 20 banks closest in assets");
    expect(describePeerSet({ institutionIds: [4, 5] })).toBe("2 chosen institutions");
    expect(describePeerSet({ charter_type: "bank", asset_tiers: ["community_small"], regulators: ["fed", "occ"], fed_districts: [6, 11] }))
      .toBe("Banks under $300M in assets regulated by the Federal Reserve or the OCC in the Atlanta or Dallas Fed districts");
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
    expect(query).toContain("WITH eligible AS MATERIALIZED");
    expect(query).toContain("SELECT DISTINCT institution_id FROM published_fee_catalog WHERE review_status = 'approved'");
    expect(query).toMatch(/ORDER BY ABS\(s\.asset_size - \$\d+::bigint\), s\.id LIMIT \$\d+/);
    expect(params.slice(-2)).toEqual([800_000, 20]);
  });

  /** A fake institution_sources that applies the query's active rule, asset ordering and limit. */
  function nearestDatabase(rows: { id: number; asset_size: number; inactive?: boolean }[]) {
    unsafe().mockImplementation((query: string, params: unknown[]) => {
      const activeOnly = query.includes("s.regulatory_status IS DISTINCT FROM 'inactive'");
      const [own, limit] = params.slice(-2) as number[];
      const picked = rows
        .filter((row) => !activeOnly || !row.inactive)
        .sort((a, b) => Math.abs(a.asset_size - own) - Math.abs(b.asset_size - own) || a.id - b.id)
        .slice(0, limit);
      return Promise.resolve(picked.map((row) => ({ id: row.id })));
    });
  }

  it("should_pick_25_active_institutions_when_an_inactive_one_is_among_the_nearest", async () => {
    // 27 banks; the second closest is inactive, so the set reaches one further for its 25th.
    const rows = Array.from({ length: 27 }, (_, i) => ({ id: 100 + i, asset_size: 800_000 + (i + 1) * 1_000, inactive: i === 1 }));
    nearestDatabase(rows);
    const resolved = await resolvePeerSet({ charter_type: "bank", nearest: 25 }, BANK);
    const ids = resolved.filters?.institutionIds ?? [];
    expect(ids).toHaveLength(25);
    expect(ids).not.toContain(101);
    expect(ids).toContain(125);
    expect(resolved.label).toBe("The 25 banks closest in assets");
  });

  it("should_name_the_real_count_when_fewer_than_25_institutions_are_available", async () => {
    nearestDatabase(Array.from({ length: 9 }, (_, i) => ({ id: 200 + i, asset_size: 700_000 + i * 1_000, inactive: i === 4 })));
    const resolved = await resolvePeerSet({ charter_type: "bank", nearest: 25 }, BANK);
    expect(resolved.filters?.institutionIds).toHaveLength(8);
    expect(resolved.label).toBe("The 8 banks closest in assets");
  });

  it("should_name_a_single_nearest_peer_in_the_singular", async () => {
    nearestDatabase([{ id: 300, asset_size: 790_000 }]);
    const resolved = await resolvePeerSet({ charter_type: "bank", nearest: 25 }, BANK);
    expect(resolved.label).toBe("The 1 bank closest in assets");
  });

  it("refuses an unknown metro", async () => {
    vi.mocked(getMarketInstitutionIds).mockResolvedValue(null);
    await expect(resolvePeerSet({ market_code: 1 }, BANK)).rejects.toThrow(/No metro market/);
  });
});

describe("peerSetMemberIds", () => {
  it("returns resolved ids as they are, none for an empty group, and every match for a basic definition", async () => {
    unsafe().mockReset();
    expect(await peerSetMemberIds({ definition: { nearest: 3 }, filters: { institutionIds: [4, 5, 6] }, label: "x", market: null })).toEqual([4, 5, 6]);
    expect(await peerSetMemberIds({ definition: { states: ["WY"] }, filters: null, label: "x", market: null })).toEqual([]);
    expect(unsafe()).not.toHaveBeenCalled();

    unsafe().mockResolvedValue([{ id: "7" }, { id: 8 }]);
    expect(await peerSetMemberIds({ definition: { charter_type: "bank", states: ["TX"] }, filters: { charter_type: "bank", states: ["TX"] }, label: "x", market: null })).toEqual([7, 8]);
    const [query, params] = unsafe().mock.calls[0];
    expect(query).toContain("s.charter_type = $1");
    expect(query).toContain("s.state_code = ANY($2::text[])");
    // A basic group keeps every matching institution, as the fee index does: no subject is left out.
    expect(query).not.toContain("s.id <>");
    expect(params).toEqual(["bank", ["TX"]]);
  });
});

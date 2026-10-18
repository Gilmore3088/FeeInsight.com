import { describe, expect, it } from "vitest";
import { briefingLocalMarket, choosePeers, feeLayerStamps, localMarketView, marketLayerSets, peerAmounts } from "./research";

const peer = (amount: number, id: number) => ({ institution_id: id, institution_name: `Bank ${id}`, state_code: "TX", amount, source_document_ids: [id], document_urls: [], published_at: null });

describe("choosePeers", () => {
  it("takes the narrowest group with enough peers for each fee, falling back to national", () => {
    const candidates = [
      { state_code: "TX", charter_type: "bank", asset_tiers: ["community_mid"], fed_districts: [11] },
      { state_code: "TX", charter_type: "bank", asset_tiers: ["community_mid"] },
      {},
    ];
    const narrow = new Map([["night_deposit", [1, 2, 3, 4, 5, 6].map((i) => peer(5, i))], ["overdraft", [1, 2, 3, 4].map((i) => peer(35, i))]]);
    const wider = new Map([["overdraft", [1, 2, 3, 4, 5, 6, 7, 8].map((i) => peer(33, i))]]);
    const national = new Map([["rare_fee", [peer(10, 1)]]]);
    const chosen = choosePeers(candidates, [narrow, wider, national], ["night_deposit", "overdraft", "rare_fee"]);
    expect(chosen.get("night_deposit")?.values).toHaveLength(6);
    expect(chosen.get("night_deposit")?.label).toContain("Fed district 11");
    expect(chosen.get("overdraft")?.values).toHaveLength(8);
    expect(chosen.get("overdraft")?.label).toBe("TX · bank · $300M to $1B peers; only 4 of TX · bank · $300M to $1B · Fed district 11 peers publish this fee");
    expect(chosen.get("rare_fee")?.label).toBe("Verified national index; none of TX · bank · $300M to $1B · Fed district 11 peers publish this fee");
  });

  it("counts sister charters on one shared schedule once when it picks the group (rule 7, #1441)", () => {
    const candidates = [{ state_code: "TX", charter_type: "bank" }, {}];
    // Six TX values, but IBC's three charters read one schedule: four institutions count.
    const ibc = [160, 318, 1769].map((id) => ({ ...peer(30, id), ...(id === 160 ? {} : { counted_as: 160 }) }));
    const narrow = new Map([["overdraft", [...ibc, peer(25, 1), peer(35, 2), peer(36, 3)]]]);
    const national = new Map([["overdraft", Array.from({ length: 9 }, (_, i) => peer(30 + i, i + 10))]]);
    expect(peerAmounts(narrow.get("overdraft")!)).toEqual([25, 30, 35, 36]);
    const chosen = choosePeers(candidates, [narrow, national], ["overdraft"]);
    expect(chosen.get("overdraft")?.values).toHaveLength(9);
    expect(chosen.get("overdraft")?.label).toContain("only 4 of TX · bank peers");
  });

  it("says why a fee's peer group differs from the institution's default (#1544)", () => {
    // U.S. Bank's case: overdraft has enough size peers, NSF falls back to the state group.
    const candidates = [{ charter_type: "bank", asset_tiers: ["super_regional"] }, { state_code: "OH", charter_type: "bank" }, {}];
    const size = new Map([["overdraft", [1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => peer(35, i))], ["nsf", [1, 2, 3].map((i) => peer(30, i))]]);
    const state = new Map([["nsf", Array.from({ length: 41 }, (_, i) => peer(25, i + 10))]]);
    const chosen = choosePeers(candidates, [size, state, new Map()], ["overdraft", "nsf"]);
    expect(chosen.get("overdraft")?.label).not.toContain(";");
    expect(chosen.get("nsf")?.label).toMatch(/^OH · bank peers; only 3 of bank · .+ peers publish this fee$/);
  });

  it("leads with the bank's own peer group and says how many it had when a fee widens", () => {
    const candidates = [
      { institutionIds: [1, 2, 3, 4, 5, 6], label: "Lancaster rivals" },
      { state_code: "PA", charter_type: "bank", asset_tiers: ["community_mid"] },
      {},
    ];
    const own = new Map([["overdraft", [1, 2, 3, 4, 5].map((i) => peer(35, i))], ["wire_domestic", [1, 2, 3].map((i) => peer(25, i))]]);
    const state = new Map([["wire_domestic", [1, 2, 3, 4, 5, 6, 7].map((i) => peer(20, i))]]);
    const chosen = choosePeers(candidates, [own, state, new Map()], ["overdraft", "wire_domestic"], { activeFirst: true });
    expect(chosen.get("overdraft")).toMatchObject({ label: "Lancaster rivals" });
    expect(chosen.get("wire_domestic")?.values).toHaveLength(7);
    expect(chosen.get("wire_domestic")?.label).toMatch(/; your group Lancaster rivals has 3 publishing this fee$/);
  });
});

describe("marketLayerSets", () => {
  it("names national, Fed district, state, and charter and size layers", () => {
    const sets = marketLayerSets({ state_code: "TX", charter_type: "credit_union", asset_size_tier: "community_mid", fed_district: 11 });
    expect(sets.map((s) => [s.scope, s.label])).toEqual([
      ["national", "National"],
      ["fed_district", "Fed district 11 (Dallas)"],
      ["state", "Texas"],
      ["charter_size", "Credit unions, $300M to $1B in assets"],
    ]);
    expect(sets[3].filters).toEqual({ charter_type: "credit_union", asset_tiers: ["community_mid"] });
  });

  it("leaves out layers the institution has no data for", () => {
    expect(marketLayerSets({ state_code: null, charter_type: "bank", asset_size_tier: null, fed_district: null }).map((s) => s.scope)).toEqual(["national"]);
  });
});

describe("localMarketView", () => {
  const base = {
    institutionId: 1,
    institutionName: "Subject Bank",
    stateCode: "TX",
    fedDistrict: 11,
    charterType: "bank",
    assetTier: "community_mid",
    peerLabel: "TX peers",
    ownValues: new Map([["overdraft", 30]]),
    ownCategories: new Set(["overdraft"]),
    peers: new Map(),
    layers: [{ scope: "national" as const, label: "National", values: new Map([["overdraft", [peer(35, 2), peer(25, 3), peer(32, 9)]]]) }],
  };
  const market = {
    basis: "branch_counties" as const,
    places: ["Austin, TX"],
    county_fips: ["48453"],
    sod_year: 2026,
    members: [
      { institution_id: 1, institution_name: "Subject Bank", city: "Austin", state_code: "TX", charter_type: "bank", market_deposits: 5e8, is_subject: true },
      { institution_id: 2, institution_name: "Bank 2", city: "Austin", state_code: "TX", charter_type: "bank", market_deposits: 9e8, is_subject: false },
      { institution_id: 3, institution_name: "Bank 3", city: "Austin", state_code: "TX", charter_type: "credit_union", market_deposits: null, is_subject: false },
      { institution_id: 4, institution_name: "No fee published", city: "Austin", state_code: "TX", charter_type: "bank", market_deposits: 1e8, is_subject: false },
    ],
  };

  it("names local competitors that publish the fee, with their deposits, and builds a thin local layer", () => {
    const view = localMarketView(base, market, "overdraft");
    expect(view.competitors?.map((c) => [c.institutionName, c.amount, c.marketDeposits])).toEqual([
      ["Bank 2", 35, 9e8],
      ["Bank 3", 25, null],
    ]);
    expect(view.info).toMatchObject({ basis: "branch_counties", institutions: 3, sodYear: 2026 });
    expect(view.layer).toMatchObject({ scope: "local", label: "Local market (Austin, TX)", n: 2, median: null, amounts: [25, 35] });
  });

  it("returns nothing when no market is on file", () => {
    expect(localMarketView(base, null, "overdraft")).toEqual({ layer: null, competitors: null, info: null });
  });

  it("lists the bank first, then competitors that publish one of its fees, in market order", () => {
    const table = briefingLocalMarket(base, market);
    expect(table?.rows.map((r) => [r.name, r.own, r.marketDeposits, r.values.overdraft])).toEqual([
      ["Subject Bank", true, null, 30],
      ["Bank 2", false, 9e8, 35],
      ["Bank 3", false, null, 25],
    ]);
    expect(table?.info).toMatchObject({ places: ["Austin, TX"], sodYear: 2026, institutions: 3 });
    expect(briefingLocalMarket(base, market, 1)?.rows).toHaveLength(2);
    expect(briefingLocalMarket(base, null)).toBeNull();
  });

  // #1931: a competitor stating several different fees shows them, not their median as its price.
  const levy = { low: 25, high: 45, fees: [{ name: "Overdraft item", amount: 25 }, { name: "Overdraft ACH", amount: 45 }] };
  const severalBase = {
    ...base,
    layers: [{ scope: "national" as const, label: "National", values: new Map([["overdraft", [peer(35, 2), { ...peer(35, 3), several: levy }, peer(32, 9)]]]) }],
  };

  it("carries a competitor's several fees beside its one value, and a single fee as its price", () => {
    const table = briefingLocalMarket(severalBase, market);
    const bank2 = table?.rows.find((r) => r.institutionId === 2);
    const bank3 = table?.rows.find((r) => r.institutionId === 3);
    expect(bank2?.values.overdraft).toBe(35);
    expect(bank2?.several).toBeUndefined();
    expect(bank3?.several?.overdraft).toEqual(levy);
    // The value behind counts stays one per institution.
    expect(bank3?.values.overdraft).toBe(35);
  });

  it("keeps the local layer's statistics one value per institution", () => {
    const view = localMarketView(severalBase, market, "overdraft");
    expect(view.competitors?.find((c) => c.institutionId === 3)?.several).toEqual(levy);
    expect(view.competitors?.find((c) => c.institutionId === 2)?.several).toBeUndefined();
    expect(view.layer?.amounts).toEqual([35, 35]);
  });
});

describe("market layer stamps (#1924)", () => {
  const base = {
    institutionId: 7,
    institutionName: "Subject Bank",
    stateCode: "TX",
    fedDistrict: 11,
    charterType: "bank",
    assetTier: "community_mid",
    peerLabel: "TX peers",
    ownValues: new Map<string, number>(),
    ownCategories: new Set<string>(),
    peers: new Map(),
    readAt: new Date("2026-10-18T14:10:00Z"),
    layers: [
      { scope: "national" as const, label: "National", filters: {}, values: new Map([["overdraft", [{ ...peer(35, 2), published_at: "2026-10-01T00:00:00Z" }]]]) },
      { scope: "state" as const, label: "Texas", filters: { state_code: "TX" }, values: new Map() },
    ],
  };

  it("stamps each layer as a live catalog read with its own filters and the bank left out", () => {
    const stamps = feeLayerStamps(base, "overdraft");
    expect(stamps.national).toMatchObject({ dataset: "published_fee_catalog", mode: "live", readAt: "2026-10-18T14:10:00.000Z", newestRecordAt: "2026-10-01T00:00:00.000Z" });
    expect(stamps.national?.filters.map((f) => f.key)).toContain("exclude:institution:7");
    expect(stamps.state?.filters.map((f) => f.label)).toContain("Institutions in TX");
    expect(stamps.national?.filters.some((f) => f.key.startsWith("peers:"))).toBe(false);
    expect(stamps.state?.newestRecordAt).toBeNull();
  });

  it("gives no stamp without the read time, rather than a guessed one", () => {
    expect(feeLayerStamps({ ...base, readAt: undefined }, "overdraft")).toEqual({});
  });
});

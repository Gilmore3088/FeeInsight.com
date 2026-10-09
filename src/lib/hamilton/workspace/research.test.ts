import { describe, expect, it } from "vitest";
import { choosePeers, localMarketView, marketLayerSets } from "./research";

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
    expect(chosen.get("overdraft")?.label).not.toContain("Fed district");
    expect(chosen.get("rare_fee")).toMatchObject({ label: "Verified national index" });
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
});

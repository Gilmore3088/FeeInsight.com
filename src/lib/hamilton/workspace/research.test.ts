import { describe, expect, it } from "vitest";
import { choosePeers, marketLayerSets } from "./research";

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

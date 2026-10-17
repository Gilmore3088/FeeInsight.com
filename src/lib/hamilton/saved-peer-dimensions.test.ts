import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/connection", () => ({ sql: Object.assign(vi.fn(), { unsafe: vi.fn() }) }));

import { MAX_NEAREST_PEERS, PEER_REGULATORS } from "@/lib/data-store/peer-sets";
import {
  MAX_NEAREST_PEER_COUNT,
  PEER_REGULATOR_LABELS,
  describeSavedPeerDimensions,
  hasSavedPeerDimensions,
  parseSavedPeerDimensions,
} from "./saved-peer-dimensions";

describe("client-safe peer dimensions", () => {
  it("match the shared peer-set module's lists", () => {
    expect(PEER_REGULATOR_LABELS).toEqual(PEER_REGULATORS);
    expect(MAX_NEAREST_PEER_COUNT).toBe(MAX_NEAREST_PEERS);
  });

  it("reads every stored dimension back", () => {
    const stored = {
      asset_min: 500_000_000, asset_max: 2_000_000_000, regulators: ["occ", "fdic"], cu_charter: "federal",
      holding_company_rssd: "1234", market_code: 19100, nearest: 20,
    };
    expect(parseSavedPeerDimensions(stored)).toEqual(stored);
    expect(parseSavedPeerDimensions(JSON.stringify(stored))).toEqual(stored);
  });

  it("leaves out malformed values instead of guessing", () => {
    expect(parseSavedPeerDimensions({
      asset_min: "500", asset_max: -1, regulators: ["occ", "cfpb", 7, "occ"], cu_charter: "national",
      holding_company_rssd: "12a", market_code: 1.5, nearest: 101,
    })).toEqual({ regulators: ["occ"] });
    expect(parseSavedPeerDimensions({ asset_min: 9, asset_max: 3 })).toBeNull();
    expect(parseSavedPeerDimensions({ nearest: 0 })).toBeNull();
    expect(parseSavedPeerDimensions(null)).toBeNull();
    expect(parseSavedPeerDimensions("not json")).toBeNull();
    expect(parseSavedPeerDimensions([1, 2])).toBeNull();
    expect(hasSavedPeerDimensions({})).toBe(false);
  });

  it("describes a group in plain words", () => {
    expect(describeSavedPeerDimensions(
      { asset_min: 500_000_000, asset_max: 2_000_000_000, regulators: ["fed"], market_code: 19100, nearest: 20 },
      "Dallas-Fort Worth-Arlington, TX",
    )).toEqual([
      "Total assets $500M to $2B",
      "Regulator: Federal Reserve",
      "Branches in the Dallas-Fort Worth-Arlington, TX metro",
      "The 20 closest in total assets",
    ]);
    expect(describeSavedPeerDimensions({ market_code: 19100 })).toEqual(["Branches in one metro (name not on record)"]);
    expect(describeSavedPeerDimensions({ market_code: 19100, market_name: "Tallahassee, FL" })).toEqual(["Branches in the Tallahassee, FL metro"]);
    expect(describeSavedPeerDimensions({ holding_company_rssd: "1" })).toEqual(["Same holding company (name not on record)"]);
    expect(describeSavedPeerDimensions({ holding_company_rssd: "1", holding_company_name: "Capital City Bank Group" })).toEqual(["Same holding company: Capital City Bank Group"]);
  });

  it("never reads display names from storage", () => {
    expect(parseSavedPeerDimensions({ market_code: 45220, market_name: "Fake", holding_company_name: "Fake" })).toEqual({ market_code: 45220 });
  });
});

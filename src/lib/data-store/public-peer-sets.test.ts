import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./connection", () => ({ sql: Object.assign(vi.fn(), { unsafe: vi.fn() }) }));
vi.mock("./peer-markets", () => ({ getHomeMarket: vi.fn(), getMarketInstitutionIds: vi.fn() }));

import { sql } from "./connection";
import { getHomeMarket } from "./peer-markets";
import { describePeerSet } from "./peer-sets";
import { getInstitutionPeerChoices, institutionPeerRequest, statePeerDefinitions } from "./public-peer-sets";

const subjectRow = {
  id: 323, charter_type: "bank", asset_size: 4_447_362, asset_size_tier: "community_large", fed_district: 6,
  state_code: "FL", primary_regulator: "Federal Reserve", cu_charter_type: null, holding_company_rssd: "1085509",
};

describe("public peer sets", () => {
  beforeEach(() => vi.clearAllMocks());

  it("splits credit unions by charter where banks split by regulator", () => {
    expect(institutionPeerRequest("regulator", { id: 1, charter_type: "bank" })).toEqual({ charter_type: "same", regulators: "same" });
    expect(institutionPeerRequest("regulator", { id: 1, charter_type: "credit_union" })).toEqual({ charter_type: "same", cu_charter: "same" });
  });

  it("leaves out a choice the institution has no value for, such as a metro", async () => {
    vi.mocked(sql as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([subjectRow]);
    vi.mocked((sql as unknown as { unsafe: ReturnType<typeof vi.fn> }).unsafe).mockResolvedValue([{ id: 4 }]);
    vi.mocked(getHomeMarket).mockResolvedValue(null);
    const choices = await getInstitutionPeerChoices(323);
    expect(choices.map((c) => [c.key, c.label])).toEqual([
      ["state", "Banks in FL"],
      ["district", "Banks in Fed district 6 (Atlanta)"],
      ["size", "Banks with $1B to $10B in assets"],
      ["regulator", "Banks regulated by Federal Reserve"],
      ["nearest", "The 25 banks closest in assets"],
    ]);
  });

  it("names the state groups in plain words", () => {
    const labels = statePeerDefinitions("TX").map(({ def }) => describePeerSet(def));
    expect(labels).toContain("Institutions with under $300M in assets in TX");
    expect(labels).toContain("Banks regulated by OCC in TX");
    expect(labels).toContain("Federal credit unions in TX");
  });
});

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn() }));

import { dataRoomPiles, dataRoomVitals } from "./admin-data-room";
import { CITY_CUT_WIDTH, PRO_INSTITUTION_MIN_FEES, readDataRoomCounts } from "./data-store/data-room";

const counts = {
  liveInstitutions: 3895,
  liveFees: 76548,
  liveRateFees: 808,
  closedInstitutionFees: 490,
  closedInstitutions: 22,
  cityAtLimit: 140,
  proInstitutionsBelowMinimum: 0,
};

describe("Data room frame (#1122 step 5)", () => {
  it("shows what we hold", () => {
    expect(dataRoomVitals(counts).map((vital) => [vital.label, vital.value])).toEqual([
      ["Institutions with live fees", "3,895"],
      ["Live dollar fees", "76,548"],
      ["Live rate fees", "808"],
    ]);
  });

  it("sizes each data pile, Pro institutions first, and says which have no way out yet", () => {
    const piles = dataRoomPiles(counts);
    expect(piles.map((pile) => [pile.key, pile.count])).toEqual([
      ["pro-institutions-below-minimum", 0],
      ["closed-institution-fees", 490],
      ["city-at-limit", 140],
    ]);
    // #1078: Atlas works these on its own; the pile shows whether any is still short.
    expect(piles[0].wayOut).toContain("direct read run");
    expect(piles[1].unit).toBe("fees at 22 inactive or closed institutions");
    expect(piles[1].wayOut).toMatch(/^None yet/);
    // #1213: decided Oct 15; Atlas's daily step restores the cut names.
    expect(piles[2].wayOut).toContain("daily city repair");
  });

  it("says a number is unreadable instead of showing zero", () => {
    expect(dataRoomVitals(null).every((vital) => vital.value === null)).toBe(true);
    expect(dataRoomPiles(null).every((pile) => pile.count === null && pile.note)).toBe(true);
  });

  it("reads the counts in one query", async () => {
    const db = vi.fn().mockResolvedValue([
      { live_institutions: 3895, live_fees: 76548, live_rate_fees: 808, closed_fees: 490, closed_institutions: 22, city_at_limit: 140, pro_below_minimum: 0 },
    ]);
    await expect(readDataRoomCounts(db as never)).resolves.toEqual(counts);
    const [strings, ...params] = db.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
    expect(strings.join(" ")).toContain("published_fee_rate_catalog");
    expect(strings.join(" ")).toContain("institution_workspace_memberships pro");
    expect(params).toEqual([CITY_CUT_WIDTH, PRO_INSTITUTION_MIN_FEES]);
  });
});

import { describe, expect, it } from "vitest";

import { CALL_ITEM_GROUPS, groupExpression } from "./call-report-items";

describe("call report item groupings", () => {
  it("maps every grouping to a fixed institution_sources column, never caller text", () => {
    expect(CALL_ITEM_GROUPS.map(groupExpression)).toEqual(["'US'", "s.state_code", "s.fed_district::text", "s.asset_size_tier", "s.charter_type", "s.cbsa_code"]);
  });
});

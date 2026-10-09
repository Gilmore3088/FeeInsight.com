import { describe, expect, it } from "vitest";
import { endInstitutions, failingEnds, type EndRow } from "./end-check";
import type { MarketRow } from "./market-spread";

const SCHEDULE = ["Fee Schedule", "Non-Sufficient Funds (NSF) Fee | $30.00 per item", "Overdraft Fee | $35.00 per item", "Stop Payment | $25.00"].join("\n");

function row(institution: number, feeName: string, amount: number, text: string | null = SCHEDULE, key = "nsf"): EndRow {
  return { institution_id: institution, fee_name: feeName, amount, canonical_fee_key: key, normalized_text: text };
}

describe("endInstitutions", () => {
  it("finds every institution at the low or the high, one value each", () => {
    const rows: MarketRow[] = [
      { institution_id: 1, cbsa_name: "Tulsa, OK", fee_category: "overdraft", amount: 5 },
      { institution_id: 1, cbsa_name: "Tulsa, OK", fee_category: "overdraft", amount: 35 },
      { institution_id: 2, cbsa_name: "Tulsa, OK", fee_category: "overdraft", amount: 0 },
      { institution_id: 3, cbsa_name: "Tulsa, OK", fee_category: "overdraft", amount: 20 },
      { institution_id: 4, cbsa_name: "Boise City, ID", fee_category: "overdraft", amount: 0 },
    ];
    // Institution 1 counts at its highest tier ($35), so its $5 tier is not the low end.
    expect(endInstitutions(rows, "Tulsa, OK", "overdraft", 0, 35)).toEqual([1, 2]);
  });
});

describe("failingEnds", () => {
  it("passes an end whose amount its own schedule states", () => {
    expect(failingEnds([row(1, "Non-Sufficient Funds (NSF) Fee", 30)])).toEqual([]);
  });

  it("rejects an end the schedule doesn't state, or with no stored text", () => {
    expect(failingEnds([row(1, "Non-Sufficient Funds (NSF) Fee", 3)])).toEqual([1]);
    expect(failingEnds([row(2, "Non-Sufficient Funds (NSF) Fee", 30, null)])).toEqual([2]);
  });

  it("checks only the rows at the institution's value", () => {
    // Overdraft counts at the highest tier: a misread low tier doesn't touch the $35 end.
    const rows = [row(1, "Overdraft Fee", 35, SCHEDULE, "overdraft"), row(1, "Overdraft Fee", 7, SCHEDULE, "overdraft")];
    expect(failingEnds(rows)).toEqual([]);
  });
});

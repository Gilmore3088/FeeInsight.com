import { describe, expect, it } from "vitest";

import { CRE_MISSING_FIELDS, creProxy, proxyChange } from "./cre-concentration";

describe("CRE concentration proxy", () => {
  it("divides all real estate loans by equity and by loans", () => {
    expect(creProxy({ loans_real_estate: 450_000, total_equity: 100_000, total_loans: 600_000 })).toEqual({ re_loans_to_equity_pct: 450, re_share_of_loans_pct: 75 });
  });

  it("leaves the ratio blank without both inputs or with no positive equity", () => {
    expect(creProxy({ loans_real_estate: null, total_equity: 100, total_loans: 100 })).toEqual({ re_loans_to_equity_pct: null, re_share_of_loans_pct: null });
    expect(creProxy({ loans_real_estate: 100, total_equity: 0, total_loans: null }).re_loans_to_equity_pct).toBeNull();
    expect(creProxy({ loans_real_estate: 100, total_equity: -5, total_loans: 0 })).toEqual({ re_loans_to_equity_pct: null, re_share_of_loans_pct: null });
  });

  it("measures change only with both ends", () => {
    expect(proxyChange(450, 380.5)).toBe(69.5);
    expect(proxyChange(450, null)).toBeNull();
  });

  it("names the fields the real ratio needs", () => {
    expect(CRE_MISSING_FIELDS.join(" ")).toMatch(/LNRECONS.*LNREMULT.*LNRENRES.*RWAJT/);
  });
});

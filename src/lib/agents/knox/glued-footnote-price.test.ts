import { describe, expect, it } from "vitest";
import { runFreeSpecialists } from "./specialists";

// North State Bank (institution 796): "$0³ or $10" lost its superscript in the stored text (#1946).
const NORTH_STATE = `Rewards | eChecking | Performance 2.0 | Beyond
Open With | $100 | $100 | $100 | $25
Qualifiers to Waive Monthly Fee
Monthly Fee | $03 or $10 | $03 or $10 | $03 or $20 | $03 or $5`;
// Penn Community Bank (institution 418): "$0¹".
const PENN = `Penn Community Bank network ATM transactions | $0
Non-Penn Community Bank network ATM transactions | $01
Online Bill Pay | $0`;

describe("Knox v106: a footnote glued to a $0 price is never the price (#1946)", () => {
  it("never reads North State's monthly fee at the footnote's $3", () => {
    const { candidates } = runFreeSpecialists(NORTH_STATE, { institutionName: "North State Bank" });
    expect(candidates.some((fee) => fee.amount === 3)).toBe(false);
  });

  it("never reads Penn Community Bank's network ATM fee at $1", () => {
    const { candidates } = runFreeSpecialists(PENN, { institutionName: "Penn Community Bank" });
    expect(candidates.some((fee) => /Non-Penn/i.test(fee.feeName) && fee.amount === 1)).toBe(false);
  });
});

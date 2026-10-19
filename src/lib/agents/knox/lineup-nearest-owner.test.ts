// @vitest-environment node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { groundLineup, lineupCorrections, readableProductName, withLineupFromText, type AccountLineup } from "./lineup";

const empty = (productName: string | null = null): AccountLineup => ({
  productName, minBalanceToAvoid: null, minOpeningDeposit: null, waiverText: null,
});
const read = (excerpt: string, feeName = "Monthly service fee") => ({
  canonicalHint: "monthly_maintenance", feeName, excerpt, amount: 5, lineup: null as AccountLineup | null,
});

describe("nearer explicit generic account ownership (#2269)", () => {
  it("keeps the actual Oakwood Savings owner after the correction reader", () => {
    const text = readFileSync(new URL("./__fixtures__/oakwood-repaired-source.txt", import.meta.url), "utf8");
    expect(createHash("sha256").update(text).digest("hex"))
      .toBe("dc6eb4136b9e193c6b9c250ba56e74499b1b8d29f3276658e6bdd81af9241ccc");
    const candidate = read("• $5.00 monthly fee if balance goes below minimum balance", "monthly fee if balance goes below minimum balance");
    const source = withLineupFromText(candidate, text).lineup!;
    expect(source.productName).toBe("SAVINGS ACCOUNT");
    // Generic ownership is source evidence, independent of the branded display-name helper.
    expect(readableProductName(source.productName)).toBeNull();
    expect(lineupCorrections(candidate, groundLineup(source, text)!, text)).toEqual([]);
  });

  it.each(["Savings Account", "SAVINGS ACCOUNTS", "Personal Savings", "Checking Accounts", "Money Market Accounts"])
    ("keeps %s and never borrows an older account's opening deposit", heading => {
      const excerpt = "Monthly service fee | $5.00";
      const text = ["Premier Money Market", "Minimum Opening Deposit: $2,500", heading, excerpt].join("\n");
      const candidate = read(excerpt);
      expect(withLineupFromText(candidate, text).lineup).toEqual(empty(heading));
      expect(lineupCorrections(candidate, empty(heading), text)).toEqual([]);
      expect(lineupCorrections(candidate, { ...empty(heading), minOpeningDeposit: 2500 }, text))
        .toEqual([{ field: "minOpeningDeposit", old: 2500, new: null }]);
    });

  it.each(["Savings Account", "Checking Accounts"])("stops below the fee at the next %s heading", heading => {
    const excerpt = "Monthly service fee | $5.00";
    const text = ["Freedom Checking", excerpt, heading, "Minimum Opening Deposit: $50"].join("\n");
    expect(withLineupFromText(read(excerpt), text).lineup).toEqual(empty("Freedom Checking"));
  });

  it("keeps an older generic Savings heading out of the nearer Money Market block", () => {
    const excerpt = "Monthly service fee | $5.00";
    const text = ["Savings Account", "Minimum Opening Deposit: $50", "Money Market Account", excerpt].join("\n");
    expect(withLineupFromText(read(excerpt), text).lineup).toEqual(empty("Money Market Account"));
    expect(lineupCorrections(read(excerpt), empty("Money Market Account"), text)).toEqual([]);
  });

  it("does not borrow an older account's waiver or fee-avoidance balance", () => {
    const excerpt = "Monthly service fee | $5.00";
    const text = ["Premier Money Market", "Maintain a minimum daily balance of $2,500 to avoid the monthly fee.",
      "Savings Account", excerpt].join("\n");
    expect(withLineupFromText(read(excerpt), text).lineup).toEqual(empty("Savings Account"));
    expect(lineupCorrections(read(excerpt), { ...empty("Savings Account"), minBalanceToAvoid: 2500,
      waiverText: "avoid the monthly fee" }, text)).toEqual([
      { field: "minBalanceToAvoid", old: 2500, new: null },
      { field: "waiverText", old: "avoid the monthly fee", new: null },
    ]);
  });

  it("does not turn a fee heading into a generic account owner", () => {
    const excerpt = "Monthly service fee | $5.00";
    const text = ["Savings Account", "Early (Share) Savings Account Closing", excerpt].join("\n");
    expect(withLineupFromText(read(excerpt), text).lineup).toBeNull();
  });

  it("does not replace a specific retained product merely because the display helper rejects it", () => {
    // The dated current-source impact frame exposed this real product at institution699/doc30979.
    const excerpt = "THE VIRGINIAN 60 years of age and older Minimum opening deposit of $25 Unlimited check writing and withdrawals $500 minimum balance to avoid monthly maintenance fee of $5 per month";
    const text = ["Checking Accounts", "The Virginian (60 years of age and older) | More | $25.00 | $500.00", excerpt].join("\n");
    expect(readableProductName("The Virginian")).toBeNull();
    expect(lineupCorrections({ feeName: "monthly maintenance fee", excerpt },
      { ...empty("The Virginian"), minBalanceToAvoid: 500 }, text)).toEqual([]);
  });

  it("can still correct a generic owner borrowed from an earlier navigation heading", () => {
    const excerpt = "A $2.00 monthly service fee applies if your average daily balance falls below $200.";
    const text = ["Money Market", "Additional Services", "Personal Checking Account", excerpt].join("\n");
    expect(lineupCorrections(read(excerpt), empty("Money Market"), text))
      .toEqual([{ field: "productName", old: "Money Market", new: "Personal Checking Account" }]);
  });

  it("uses a nearer printed generic account to repair a fee caption, without accepting the caption as an owner", () => {
    const excerpt = "Monthly service fee | $5.00";
    const text = ["Premier Money Market", "Savings Account", excerpt].join("\n");
    expect(lineupCorrections(read(excerpt), empty("Early (Share) Savings Account Closing"), text))
      .toEqual([{ field: "productName", old: "Early (Share) Savings Account Closing", new: "Savings Account" }]);
  });

  it("keeps an explicitly named fee's own account ahead of a different generic heading", () => {
    const excerpt = "Star Checking monthly service fee | $5.00";
    const candidate = read(excerpt, "Star Checking monthly service fee");
    const text = ["Savings Account", excerpt].join("\n");
    expect(withLineupFromText(candidate, text).lineup?.productName).toBe("Star Checking");
    expect(lineupCorrections(candidate, empty("Savings Account"), text))
      .toEqual([{ field: "productName", old: "Savings Account", new: "Star Checking" }]);
  });

  it("does not assign a repeated ambiguous excerpt or make a mixed heading an account", () => {
    const excerpt = "Monthly service fee | $5.00";
    const repeated = ["Savings Account", excerpt, "Checking Accounts", excerpt].join("\n");
    expect(withLineupFromText(read(excerpt), repeated).lineup).toBeNull();
    expect(lineupCorrections(read(excerpt), empty("Savings Account"), repeated)).toEqual([]);
    expect(withLineupFromText(read(excerpt), ["Savings Account", "CHECKING & MONEY MARKET", excerpt].join("\n")).lineup)
      .toBeNull();
  });
});

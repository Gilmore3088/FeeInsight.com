import { describe, expect, it } from "vitest";

import { MT_PREFERRED_MONEY_MARKET_TEXT, MT_WAIVER_EXCERPT } from "./__fixtures__/mt-preferred-money-market-21879";
import { accountProductFor, accountSubjectProduct, withLineupFromText, type AccountLineup } from "./lineup";

const MT = "Manufacturers and Traders Trust Company";

describe("accountSubjectProduct (#1912)", () => {
  it("reads M&T's Preferred Money Market from the sentence above the waiver line", () => {
    expect(accountSubjectProduct(MT_PREFERRED_MONEY_MARKET_TEXT, MT_WAIVER_EXCERPT, 20, MT)).toBe("M&T Preferred Money Market");
  });

  it("gives the M&T read its product through the lineup, the way extraction does", () => {
    const read = withLineupFromText(
      { canonicalHint: "monthly_maintenance", feeName: "Monthly maintenance charge", excerpt: MT_WAIVER_EXCERPT, amount: 20, lineup: null as AccountLineup | null },
      MT_PREFERRED_MONEY_MARKET_TEXT,
      { institutionName: MT },
    );
    expect(read.lineup?.productName).toBe("M&T Preferred Money Market");
  });

  it("reads the fee's own line too, and a minimum balance fee", () => {
    const text = "Fees\n\nThe Everyday Savings account has a $5 minimum balance fee.";
    expect(accountSubjectProduct(text, "The Everyday Savings account has a $5 minimum balance fee.", 5)).toBe("Everyday Savings");
  });

  it("keeps a checking sentence checking", () => {
    const text = "Monthly fee\n\nThe Advantage Checking account has a $12 monthly maintenance fee.\n\nThe $12 monthly maintenance fee is waived if:";
    expect(accountSubjectProduct(text, "The $12 monthly maintenance fee is waived if:", 12)).toBe("Advantage Checking");
    expect(accountProductFor({ feeName: "Checking monthly fee", excerpt: "The $12 monthly maintenance fee is waived if:", amount: 12 }, text, null))
      .toBe("Advantage Checking");
  });

  it("ignores a sentence that does not print the fee's own price", () => {
    expect(accountSubjectProduct(MT_PREFERRED_MONEY_MARKET_TEXT, MT_WAIVER_EXCERPT, 25, MT)).toBeNull();
    const text = "The Premier Savings account has a $10,000 minimum balance.\n\nThe $5 monthly maintenance fee is waived if:";
    expect(accountSubjectProduct(text, "The $5 monthly maintenance fee is waived if:", 5)).toBeNull();
  });

  it("never takes a subject from further away, or a generic or every-account subject", () => {
    const far = "The Premier Savings account has a $5 monthly fee.\n\nSomething else entirely here.\n\nThe $5 monthly fee is waived if:";
    expect(accountSubjectProduct(far, "The $5 monthly fee is waived if:", 5)).toBeNull();
    for (const sentence of [
      "The account has a $5 monthly maintenance fee.",
      "Each savings account has a $5 monthly maintenance fee.",
      "The savings account has a $5 monthly maintenance fee.",
      "This Premier Savings account has a $5 monthly maintenance fee.",
      "The Gold Rewards program has a $5 monthly maintenance fee.",
    ]) {
      expect(accountSubjectProduct(`Fees\n\n${sentence}`, sentence, 5), sentence).toBeNull();
    }
  });

  it("lets the fee's own line decide over the line above (Knox v129)", () => {
    // Own line names another account, with no subject sentence: the line above is not read.
    const named = "The Everyday Savings account has a $5 monthly fee.\n\nBasic Checking: the $5 monthly fee is waived with direct deposit.";
    expect(accountSubjectProduct(named, "Basic Checking: the $5 monthly fee is waived with direct deposit.", 5)).toBeNull();
    // Own line's subject wins over a different subject above.
    const both = "The Everyday Savings account has a $5 monthly fee.\n\nThe Basic Checking account has a $5 monthly fee.";
    expect(accountSubjectProduct(both, "The Basic Checking account has a $5 monthly fee.", 5)).toBe("Basic Checking");
    // Own line names no account: the line above still decides (M&T).
    expect(accountSubjectProduct(MT_PREFERRED_MONEY_MARKET_TEXT, MT_WAIVER_EXCERPT, 20, MT)).toBe("M&T Preferred Money Market");
  });

  it("gives none when two subjects print the same price", () => {
    const text = "The Premier Savings account has a $5 monthly fee. The Gold Money Market account has a $5 monthly fee.\n\nThe $5 monthly fee is waived if:";
    expect(accountSubjectProduct(text, "The $5 monthly fee is waived if:", 5)).toBeNull();
  });

  it("stays behind every other source of the account", () => {
    const text = "Premier Checking\n\nThe Gold Savings account has a $5 monthly maintenance fee.\n\nThe $5 monthly maintenance fee is waived if:";
    // The heading above names the account first; the subject is only a last resort.
    expect(accountProductFor({ feeName: "Monthly maintenance fee", excerpt: "The $5 monthly maintenance fee is waived if:", amount: 5 }, text, "Premier Checking"))
      .toBe("Premier Checking");
    expect(accountProductFor({ feeName: "Monthly maintenance fee", excerpt: "The $5 monthly maintenance fee is waived if:", amount: 5 }, text, null))
      .toBe("Gold Savings");
    // A checking-named fee never takes a savings subject.
    expect(accountProductFor({ feeName: "Checking maintenance fee", excerpt: "The $5 monthly maintenance fee is waived if:", amount: 5 }, text, null))
      .toBeNull();
  });
});

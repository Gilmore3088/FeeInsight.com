import { describe, expect, it } from "vitest";
import { hasBusinessFees, suggestAudience } from "./audience-context";

const suggest = (documentUrl: string | null, text: string, feeName: string, amount: number | null = 30) =>
  suggestAudience({ documentUrl, text, feeName, amount });

describe("Knox audience suggestion from context (#1059)", () => {
  it("lets the fee's own name decide first", () => {
    expect(suggest(null, "Fees\nReturned Deposit Items (Commercial Accounts Only) $10", "Returned Deposit Items (Commercial Accounts Only)", 10))
      .toMatchObject({ audience: "business", source: "fee_name" });
  });

  it("reads the schedule's address", () => {
    expect(suggest("https://www.tabbank.com/uploads/TAB-Business-Checking-Fee-Schedule.pdf", "Stop Payment $30", "Stop Payment"))
      .toMatchObject({ audience: "business", source: "document_url" });
    expect(suggest("https://bank.example/personal/fee-schedule", "Stop Payment $30", "Stop Payment"))
      .toMatchObject({ audience: "consumer", source: "document_url" });
    // An address that names both says nothing.
    expect(suggest("https://bank.example/personal-and-business-fees", "Business Accounts\nStop Payment $30", "Stop Payment")?.source)
      .not.toBe("document_url");
  });

  it("reads a section heading above the fee, and ignores menus, bank names and business days", () => {
    const text = ["Business Online Sign In", "Commercial Bank of Ozark", "Personal Accounts", "Overdraft Fee $30", "Business Accounts", "Overdraft Fee $35"].join("\n");
    expect(suggest(null, text, "Overdraft Fee", 30)).toMatchObject({ audience: "consumer", source: "section_heading", evidence: "Personal Accounts" });
    expect(suggest(null, text, "Overdraft Fee", 35)).toMatchObject({ audience: "business", source: "section_heading", evidence: "Business Accounts" });
    // A line that only says "business days" is no heading.
    expect(suggest(null, "Funds are available in 2 business days.\nWire Transfer $25", "Wire Transfer", 25)?.source).not.toBe("section_heading");
  });

  it("counts a schedule with no business fees as consumer, even when its menu says Business", () => {
    // Stored page text keeps a site's menu as links.
    const site = ["* [Business Banking](https://bank.example/business)", "* [About Us](https://bank.example/about)", "Fee Schedule", "Stop Payment $30", "Overdraft $32"].join("\n");
    expect(hasBusinessFees(site.split("\n"))).toBe(false);
    expect(suggest(null, site, "Stop Payment")).toMatchObject({ audience: "consumer", source: "default_general_schedule" });
    // A menu word whose next heading names another audience owns no prices.
    expect(hasBusinessFees(["Business Banking", "Personal Banking", "Stop Payment $30"])).toBe(false);
    // A business heading with prices under it is business fees, so no default.
    const mixed = ["Fees", "Stop Payment $30", "Business Services", "Lockbox $50"].join("\n");
    expect(hasBusinessFees(mixed.split("\n"))).toBe(true);
    // An unqualified fee in a schedule that also prices business items is listed for every account.
    expect(suggest(null, mixed, "Stop Payment")).toMatchObject({ audience: "both", source: "mixed_schedule_unqualified", evidence: "Lockbox $50" });
  });

  it("never reads a product or a time as an audience", () => {
    // A corporate check is the institution's official check; a personal check is a check type.
    expect(suggest(null, "Fee Schedule\nCorporate Check Stop Payment $30", "Corporate Check Stop Payment")).toMatchObject({ source: "default_general_schedule" });
    expect(suggest(null, "Fee Schedule\nRush Pay transaction (Next Business Day) $15", "Rush Pay transaction (Next Business Day)", 15)).toMatchObject({ source: "default_general_schedule" });
    expect(hasBusinessFees(["Corporate Drafts (per item) | $3.00", "Copyright Oak Tree Business Systems, Inc.", "Stop Payment $30"])).toBe(false);
  });

  it("takes no section from a table row or a menu, but counts a business column", () => {
    // A fee under a consumer | business column header sits in one column; the text does not say which.
    const table = ["CONSUMER CHECKING ACCOUNTS | BUSINESS ACCOUNTS", "Xplore Spend Account* | Xplore Business Savings", "Monthly Service Charge $5.00"].join("\n");
    expect(suggest(null, table, "Monthly Service Charge", 5)).toBeNull();
    // A lone menu word ("Business") with prices under it is not a business section.
    expect(hasBusinessFees(["Business", "Checking", "Stop Payment $30"])).toBe(false);
    expect(suggest(null, ["close Business Banking menu", "Monthly fee $5"].join("\n"), "Monthly fee", 5)).toMatchObject({ source: "default_general_schedule" });
  });

  it("reads a one-fee qualifier as that fee's, and an all-accounts heading as both", () => {
    // "(Personal Accounts)" qualifies the Deposited Return Items price above it, not the fees below.
    const valdosta = ["Deposited Return Items", "(Business accounts)", "$10.00", "(Personal Accounts)", "$5.00", "Stop Payment", "$30.00"].join("\n");
    expect(suggest(null, valdosta, "Stop Payment", 30)).toMatchObject({ audience: "both", source: "mixed_schedule_unqualified" });
    const truity = ["Consumer Fees", "Other Service Fees (apply to all accounts)", "Stop Payment Fee $30.00", "Business Fees", "Business Savings Account Closing Fee $10.00"].join("\n");
    expect(suggest(null, truity, "Stop Payment Fee", 30)).toMatchObject({ audience: "both", source: "section_heading" });
    // With nothing priced for businesses, an all-accounts schedule is the consumer schedule.
    expect(suggest(null, ["Fees Applicable to all accounts", "Stop Payment $30.00"].join("\n"), "Stop Payment", 30)).toMatchObject({ audience: "consumer", source: "default_general_schedule" });
  });

  it("matches a fee's price as a whole token (review of 88e9dc21)", () => {
    const od = ["Personal Accounts", "Overdraft Fee $35", "Business Accounts", "Overdraft Fee $5"].join("\n");
    expect(suggest(null, od, "Overdraft Fee", 5)).toMatchObject({ audience: "business", evidence: "Business Accounts" });
    expect(suggest(null, od, "Overdraft Fee", 35)).toMatchObject({ audience: "consumer", evidence: "Personal Accounts" });
    const coins = ["Personal Accounts", "Coin counting $10", "Business Accounts", "Coin counting $0"].join("\n");
    expect(suggest(null, coins, "Coin counting", 0)).toMatchObject({ audience: "business" });
    // A price on the line below the name counts as well.
    expect(suggest(null, ["Personal Accounts", "Stop Payment", "$35.00", "Business Accounts", "Stop Payment", "$5.00"].join("\n"), "Stop Payment", 5)).toMatchObject({ audience: "business" });
  });

  it("takes no title or heading from a fee name whose price is on the next line (review of 88e9dc21)", () => {
    const title = ["Fee Schedule", "Business Checking Monthly Service Charge", "$10.00", "Stop Payment", "$30.00"].join("\n");
    expect(suggest(null, title, "Stop Payment", 30)).toMatchObject({ audience: "both", source: "mixed_schedule_unqualified" });
    const heading = ["Fees", "Personal Account Research", "$25.00", "Wire Transfer", "$20.00", "Business Services", "Lockbox $50"].join("\n");
    expect(suggest(null, heading, "Wire Transfer", 20)).toMatchObject({ audience: "both", source: "mixed_schedule_unqualified" });
  });

  it("prefers the section above the fee to the page title, and two titles name neither", () => {
    const nav = ["Personal Fee Schedule", "Business Fee Schedule", "Business Accounts", "Lockbox $50", "Personal Accounts", "Stop Payment $30"].join("\n");
    expect(suggest(null, nav, "Lockbox", 50)).toMatchObject({ audience: "business", source: "section_heading" });
    expect(suggest(null, nav, "Stop Payment", 30)).toMatchObject({ audience: "consumer", source: "section_heading" });
  });

  it("keeps a bank-named heading, ignores bank names and non-commercial, and leaves an unfound line unknown", () => {
    const named = ["Personal Accounts", "Stop Payment $30", "Business Banking at Bank of Clarke", "Stop Payment $35"].join("\n");
    expect(suggest(null, named, "Stop Payment", 35)).toMatchObject({ audience: "business", source: "section_heading" });
    expect(suggest(null, ["Commercial Bank of Ozark", "Fee Schedule", "Stop Payment $30"].join("\n"), "Stop Payment", 30)).toMatchObject({ source: "default_general_schedule" });
    expect(suggest(null, ["Fee Schedule", "Non-commercial wire $15"].join("\n"), "Non-commercial wire", 15)).toMatchObject({ source: "default_general_schedule" });
    // In a mixed schedule a fee whose line is not in the text stays unknown.
    expect(suggest(null, ["Fees", "Stop Payment $30", "Business Services", "Lockbox $50"].join("\n"), "Wire Transfer", 20)).toBeNull();
  });
});

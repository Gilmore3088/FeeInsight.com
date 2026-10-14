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
    // Never a title or a heading. An audience-naming line over a price could be either a fee row
    // or a section heading ("Business Fees" / "$35.00 Stop Payment"), so the fee below stays
    // unknown (review of 24ad1339) rather than take that audience.
    const title = ["Fee Schedule", "Business Checking Monthly Service Charge", "$10.00", "Stop Payment", "$30.00"].join("\n");
    expect(suggest(null, title, "Stop Payment", 30)).toBeNull();
    const heading = ["Fees", "Personal Account Research", "$25.00", "Wire Transfer", "$20.00", "Business Services", "Lockbox $50"].join("\n");
    expect(suggest(null, heading, "Wire Transfer", 20)).toBeNull();
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

  it("never takes the next row's price, a description line or a bank's name (review of cfe0873d)", () => {
    const rows = ["Personal Accounts", "Stop Payment $30", "Wire Transfer $20", "Business Accounts", "Stop Payment $20"].join("\n");
    expect(suggest(null, rows, "Stop Payment", 20)).toMatchObject({ audience: "business", evidence: "Business Accounts" });
    const described = ["Fee Schedule", "Personal Accounts", "Stop Payment $30", "Business Accounts", "$100 minimum opening deposit", "Stop Payment $35"].join("\n");
    // A heading over a line that starts with a price could equally be a fee row priced below it:
    // the fee stays unknown, never the Personal heading further up (reviews of cfe0873d, 8dd7af67).
    expect(suggest(null, described, "Stop Payment", 35)).toBeNull();
    expect(suggest(null, ["Personal Accounts", "Stop Payment $30", "Business Checking", "Free checking for 12 months", "Stop Payment $35"].join("\n"), "Stop Payment", 35)).toBeNull();
    for (const bank of ["Commercial State Bank of Wagner Fee Schedule", "Commercial National Bank Schedule of Fees", "First Commercial Bank Fee Schedule"]) {
      expect(suggest(null, [bank, "Stop Payment $30", "Overdraft $25"].join("\n"), "Stop Payment", 30)).toMatchObject({ audience: "consumer", source: "default_general_schedule" });
    }
  });

  it("reads thousands separators and a name printed without its fee word", () => {
    expect(suggest(null, ["Personal Accounts", "Wire $1,500", "Business Accounts", "Wire $1,000"].join("\n"), "Wire", 1000)).toMatchObject({ audience: "business" });
    expect(suggest(null, ["Fees", "Stop Payment $30", "Business Services", "Lockbox $50"].join("\n"), "Stop Payment Fee", 30)).toMatchObject({ audience: "both", source: "mixed_schedule_unqualified" });
  });

  it("treats a fee name over a rate line as a fee row, and short names as whole words (review of 62b31599)", () => {
    for (const [name, price] of [
      ["Business Checking Monthly Service Charge", "$10.00 per month if balance below $500"],
      ["Business Checking Maintenance", "$10.00 per month*"],
      ["Business Account Research", "$25.00 per hour, 1 hour minimum"],
      ["Business Checking Paper Statement", "$5.00 per statement cycle"],
    ]) {
      const text = ["Personal Accounts", name, price, "Stop Payment", "$30.00", "Business Services", "Lockbox $50"].join("\n");
      // Never business from the fee row; unknown, since the row could also be a heading.
      expect(suggest(null, text, "Stop Payment", 30)).toBeNull();
    }
    const rows = (business: string, fee: string) => ["Business Accounts", business, "Personal Accounts", `${fee} $30`].join("\n");
    expect(suggest(null, rows("Wire Transfer $30", "NSF Fee"), "NSF Fee", 30)).toMatchObject({ audience: "consumer" });
    expect(suggest(null, rows("Coin wrappers $2 each", "ACH Fee"), "ACH Fee", 30)).toMatchObject({ audience: "consumer" });
    expect(suggest(null, rows("Wired funds $15", "Wire Fee"), "Wire Fee", 30)).toMatchObject({ audience: "consumer" });
    expect(suggest(null, rows("Monthly Maintenance $30", "Monthly Fee"), "Monthly Fee", 30)).toMatchObject({ audience: "consumer" });
    expect(suggest(null, rows("Night Deposit Service $30", "Service Charge"), "Service Charge", 30)).toMatchObject({ audience: "consumer" });
  });

  it("prefers a priced line under either name, and never guesses over a price line (review of 8dd7af67)", () => {
    const waived = ["Business Accounts", "Stop payment fee waived for Premier Business Checking", "Personal Accounts", "Stop Payment $30.00"].join("\n");
    expect(suggest(null, waived, "Stop Payment Fee", 30)).toMatchObject({ audience: "consumer", evidence: "Personal Accounts" });
    // A fee row priced on the next line, whatever follows the price, never heads the fees below.
    for (const price of ["$10.00 if balance below $500", "$10.00, waived with direct deposit", "$10.00 monthly", "$10.00 for paper statements"]) {
      const text = ["Personal Accounts", "Business Checking Maintenance", price, "Stop Payment", "$30.00", "Business Services", "Lockbox $50"].join("\n");
      expect(suggest(null, text, "Stop Payment", 30)).toBeNull();
    }
    // A heading over a description line never hands the fee below to the heading further up.
    const heading = ["Personal Accounts", "Stop Payment $30", "Business Checking", "$15.00 monthly maintenance, waived with $1,500 balance", "NSF Fee $35"].join("\n");
    expect(suggest(null, heading, "NSF Fee", 35)).toBeNull();
  });

  it("never climbs past an audience line over a price, nor reads a title over one (review of 24ad1339)", () => {
    for (const heading of ["Business Fees", "Business Deposit Accounts", "Business Account Fees", "Business Card Services"]) {
      const text = ["Personal Accounts", "Stop Payment $30", heading, "$35.00 Stop Payment"].join("\n");
      expect(suggest(null, text, "Stop Payment", 35)).toBeNull();
    }
    for (const [title, below] of [["Business Fee Schedule", "$5.00 Paper Statement"], ["Personal Fee Schedule", "Free online banking"], ["Business Schedule of Fees", "Free online banking"]]) {
      expect(suggest(null, [title, below, "Stop Payment $30"].join("\n"), "Stop Payment", 30)).toBeNull();
    }
    // A fee row that names no audience is passed over, so the section heading above still holds.
    expect(suggest(null, ["Business Accounts", "Lockbox", "$50.00", "Stop Payment $35"].join("\n"), "Stop Payment", 35)).toMatchObject({ audience: "business" });
  });

  it("takes no heading or title from a sentence that points to the business schedule (review of 153ca285)", () => {
    const preamble = "These fees are effective January 1, 2026 and replace all earlier schedules. ".repeat(5);
    const crossRef = ["Fee Schedule", preamble, "Monthly Maintenance $10", "Stop Payment $30", "Copies of the Business Schedule of Fees are available on request", "Overdraft Fee $35"].join("\n");
    expect(suggest(null, crossRef, "Stop Payment", 30)).toMatchObject({ audience: "consumer", source: "default_general_schedule" });
    expect(suggest(null, ["Fee Schedule", "Monthly Maintenance $10", "Stop Payment $30", "Commercial service charges are disclosed separately", "Overdraft $35"].join("\n"), "Stop Payment", 30)).toMatchObject({ audience: "consumer" });
    for (const text of [
      ["Fee Schedule", "Stop Payment $30", "Overdraft $35", "For business accounts, see the Business Fee Schedule."],
      ["Fee Schedule", "Effective January 1, 2026", "Stop Payment $30", "Business service charges are listed separately."],
    ]) {
      expect(suggest(null, text.join("\n"), "Stop Payment", 30)).toMatchObject({ audience: "consumer", source: "default_general_schedule" });
    }
    // Above the fee, with no heading further up, such a sentence never makes the fee business.
    for (const text of [
      ["Fee Schedule", "Effective January 1, 2026", "For business accounts, see the Business Fee Schedule.", "Monthly Maintenance $10", "Stop Payment $30"],
      ["Fee Schedule", "Monthly Maintenance $10", "Not for business accounts.", "Stop Payment $30"],
      ["See the Business Schedule of Fees", "Fee Schedule", "Stop Payment $30"],
    ]) {
      expect(suggest(null, text.join("\n"), "Stop Payment", 30)).toMatchObject({ audience: "consumer", source: "default_general_schedule" });
    }
    // A fee row priced "Waived" or "Monthly $10.00" below never heads the fees under it.
    for (const price of ["Waived", "Monthly $10.00"]) {
      expect(suggest(null, ["Personal Accounts", "Business Checking Maintenance", price, "Stop Payment $30"].join("\n"), "Stop Payment", 30)).toBeNull();
    }
  });

  it("keeps headings with a trailing period or colon, and never climbs past an audience sentence (review of bac3d3db)", () => {
    const rows = (amount: number) => [`Wire $${amount}`, `Copies $${amount + 1}`, `Research $${amount + 2}`];
    const under = (top: string, heading: string, amount: number) =>
      [top, ...rows(10), heading, `Stop Payment $${amount}.00`].join("\n");
    expect(suggest(null, under("Consumer Accounts", "BUSINESS ACCOUNTS.", 30), "Stop Payment", 30)).toMatchObject({ audience: "business" });
    expect(suggest(null, under("Business Accounts", "PERSONAL ACCOUNTS.", 28), "Stop Payment", 28)).toMatchObject({ audience: "consumer" });
    expect(suggest(null, under("Consumer Accounts", "Business Accounts:", 30), "Stop Payment", 30)).toMatchObject({ audience: "business" });
    expect(suggest(null, under("Personal Accounts", "Business Accounts available at all branches", 30), "Stop Payment", 30)).toMatchObject({ audience: "business" });
    for (const [top, heading] of [
      ["Personal Accounts", "Business Accounts (not including non-profits)"],
      ["Business Accounts", "Consumer Accounts – see fees below"],
      ["Personal Checking", "Business Checking (not FDIC-insured sweep)"],
      ["Personal Banking Services", "Commercial Services Not Listed Above"],
    ]) {
      expect(suggest(null, under(top, heading, 30), "Stop Payment", 30)).toBeNull();
    }
    // A business-only schedule whose title or heading ends in a period still prices business fees.
    expect(suggest(null, ["BUSINESS FEE SCHEDULE.", "Effective January 1, 2026", "Stop Payment $30.00"].join("\n"), "Stop Payment", 30)).toMatchObject({ audience: "business" });
    expect(suggest(null, ["BUSINESS ACCOUNTS.", "Stop Payment $30.00", "Overdraft $35.00"].join("\n"), "Stop Payment", 30)).toMatchObject({ audience: "business" });
  });

  it("keeps a prose line's period, so a note pointing to the business schedule heads nothing (review of 33d74156)", () => {
    for (const note of [
      "Business account fees are listed in our Business Fee Schedule.",
      "Business accounts have their own fee schedule.",
      "Business accounts are subject to different fees.",
      "Business account fee schedules are available at any branch.",
    ]) {
      expect(suggest(null, ["Fee Schedule", note, "Stop Payment $30", "Overdraft $35"].join("\n"), "Stop Payment", 30)).toMatchObject({ audience: "consumer", source: "default_general_schedule" });
    }
    // Under a consumer heading, the note never wins over it.
    expect(suggest(null, ["Personal Fee Schedule", "Business account fees are listed in our Business Fee Schedule.", "Stop Payment $30"].join("\n"), "Stop Payment", 30)?.audience).not.toBe("business");
  });
});

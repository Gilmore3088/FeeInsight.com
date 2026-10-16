import { describe, expect, it } from "vitest";
import { feeLineIndex, hasBusinessFees, nameAudience, sectionHeadingAudience, suggestAudience } from "./audience-context";

const suggest = (documentUrl: string | null, text: string, feeName: string, amount: number | null = 30) =>
  suggestAudience({ documentUrl, text, feeName, amount });
/** The heading Knox reads above the fee's own line, which no longer decides alone in a mixed schedule. */
const headingAbove = (text: string, feeName: string, amount: number | null = 30) => {
  const lines = text.split("\n");
  return sectionHeadingAudience(lines, feeLineIndex(lines, feeName, amount));
};

describe("Knox audience suggestion from context (#1059)", () => {
  // #1059 gate (a): the dry run left 8.9% unknown; these two rules take the safe part of it.
  it("finds a group-and-row name's line under its group heading, at its price", () => {
    const text = ["Fee Schedule", "Business Checking Maintenance | $15.00", "Wire Transfers", "Incoming | $10.00", "Outgoing | $25.00", "Stop Payment | $30.00"].join("\n");
    expect(feeLineIndex(text.split("\n"), "Wire Transfers: Incoming", 10)).toBe(3);
    expect(feeLineIndex(text.split("\n"), "Wire Transfers: Outgoing", 25)).toBe(4);
    // Listed for every account in a schedule that also prices business items.
    expect(suggest(null, text, "Wire Transfers: Incoming", 10)).toMatchObject({ audience: "both", source: "mixed_schedule_unqualified" });
    // Not at its price, not under its heading, or no real word in the row: still not found.
    expect(feeLineIndex(text.split("\n"), "Wire Transfers: Incoming", 12)).toBe(-1);
    expect(feeLineIndex(["Wire Transfers", ...Array(9).fill("Notary | Free"), "Incoming | $10.00"], "Wire Transfers: Incoming", 10)).toBe(-1);
    expect(feeLineIndex(["Fees", "1 | $10.00"], "Fees: 1", 10)).toBe(-1);
    expect(feeLineIndex(text.split("\n"), "Wire Transfers: Incoming", null)).toBe(-1);
    // The row's own heading still decides: a business heading over it keeps it unknown.
    const business = ["Fee Schedule", "Business Accounts", "Wire Transfers", "Incoming | $10.00", "Stop Payment | $30.00"].join("\n");
    expect(suggest(null, business, "Wire Transfers: Incoming", 10)).toBeNull();
  });

  // Review of #1445: business sections SECTION_HEADING never named.
  it.each(["Commercial Clients", "Small Business", "Business", "COMMERCIAL", "For Business Owners"])(
    "reads a short business heading over a fee row as a business section: %s",
    (heading) => {
      const lines = ["Fee Schedule", "Stop Payment | $30.00", heading, "Account Analysis | $25.00"];
      expect(hasBusinessFees(lines)).toBe(true);
      // Under a consumer sentence, the fee no longer takes the consumer default.
      const text = ["These fees apply to consumer accounts.", "Statement Copy | $5.00", heading, "Account Analysis | $25.00"].join("\n");
      expect(suggest(null, text, "Statement Copy", 5)?.audience).not.toBe("consumer");
    },
  );

  it("keeps a menu word over a promotion, and the credit union's own business, out of business sections", () => {
    expect(hasBusinessFees(["Fee Schedule", "Business Forms", "Refer a Friend and Earn Up to $500", "Stop Payment | $30.00"])).toBe(false);
    expect(hasBusinessFees(["Fee Schedule", "Business", "Checking", "Stop Payment $30"])).toBe(false);
    expect(hasBusinessFees(["Official Checks", "Credit Union Business: No Charge", "Member Request: $5 / Check"])).toBe(false);
  });

  // Review of #1453: "credit union business" is the credit union's own business only when no
  // account word follows; "Credit Union Business Accounts" is business-account wording.
  it.each([
    "Connex Credit Union Business Accounts Fee Schedule",
    "APPLIES TO ALL CREDIT UNION BUSINESS ACCOUNTS",
    "Credit Union Business Checking Monthly Fee",
    ...["account", "accounts", "checking", "savings", "banking", "membership", "visa", "services", "loan", "loans", "card", "cards", "mobile", "online"].map(
      (word) => `Credit Union Business ${word} fee`,
    ),
  ])("keeps business-account wording after \"credit union business\" business: %s", (title) => {
    expect(suggest("https://www.example.org/disclosures/schedule.pdf", "Fees\nStop Payment | $30.00", title)).toMatchObject({
      audience: "business",
      source: "fee_name",
    });
    const text = [title, "Stop Payment | $30.00", "Statement Copy | $5.00"].join("\n");
    expect(suggest("https://www.example.org/disclosures/schedule.pdf", text, "Statement Copy", 5)?.audience).not.toBe("consumer");
  });

  it("still reads the credit union's own business, and a shopping day, as no audience", () => {
    expect(suggest("https://www.example.org/fees.pdf", "Fees\nStop Payment | $30.00", "Credit Union Business: No Charge", 0)?.audience).not.toBe("business");
    expect(suggest("https://www.example.org/fees.pdf", "Fees\nStop Payment | $30.00", "Credit Union Business Only", 0)?.audience).not.toBe("business");
    expect(hasBusinessFees(["Fee Schedule", "Small Business Saturday", "Shop local and save $5 on each purchase", "Stop Payment | $30.00"])).toBe(false);
  });

  it("turns rule B off only for a business heading between the sentence and the fee", () => {
    const consumer = ["These fees apply to consumer accounts.", "Statement Copy | $5.00", "Stop Payment | $30.00"];
    // A footer or report heading below the fee heads other text, not the fee.
    for (const footer of ["Business Credit Cards:", "Small Business Loans"]) {
      expect(suggest(null, [...consumer, footer, "Apply online today."].join("\n"), "Statement Copy", 5)).toMatchObject({
        audience: "consumer",
        source: "default_general_schedule",
      });
    }
    // Between the sentence and the fee, it may head the fee's section.
    const between = ["These fees apply to consumer accounts.", "Small Business", "Ask about our accounts.", "Statement Copy | $5.00"].join("\n");
    expect(suggest(null, between, "Statement Copy", 5)?.audience).not.toBe("consumer");
  });

  it("reads a business price inside a long line", () => {
    const long = `Overdraft fees are explained below in detail for every account type we offer at the bank. ${"Please read carefully. ".repeat(3)}For business accounts overdrawn for 4 or more consecutive days, we will charge an additional $5.00 per day.`;
    expect(long.length).toBeGreaterThan(160);
    expect(hasBusinessFees([long])).toBe(true);
    // "each business day" is a time, not an audience.
    expect(hasBusinessFees([`${"Your account will be charged the overdraft fee as described in this notice. ".repeat(2)}Your account will be charged the $35 overdraft fee only for the first six overdraft items each business day.`])).toBe(false);
  });

  it("stops a group's row search at the next group's heading", () => {
    const lines = ["Wire Transfers", "Outgoing | $25.00", "Collection Items", "Incoming | $10.00"];
    expect(feeLineIndex(lines, "Wire Transfers: Incoming", 10)).toBe(-1);
    // A row label with its price on the next line is still found.
    expect(feeLineIndex(["Wire Transfers", "Incoming", "$10.00"], "Wire Transfers: Incoming", 10)).toBe(1);
  });

  it("gives a consumer sentence with no heading the consumer default, only with no business prices", () => {
    const consumer = ["These fees apply to consumer accounts.", "Statement Copy | $5.00", "Stop Payment | $30.00"].join("\n");
    expect(suggest(null, consumer, "Statement Copy", 5)).toMatchObject({ audience: "consumer", source: "default_general_schedule" });
    // With business prices in the schedule, it stays unknown.
    expect(suggest(null, `${consumer}\nBusiness Checking Maintenance | $15.00`, "Statement Copy", 5)).toBeNull();
    // A farm account page is business by its address, before any default.
    expect(suggest("https://www.minnstarbank.com/agribusiness/ag-savings/", consumer, "Statement Copy", 5)).toMatchObject({ audience: "business", source: "document_url" });
    // A business sentence still leaves the fee unknown.
    const business = ["These fees apply to business accounts.", "Statement Copy | $5.00", "Stop Payment | $30.00"].join("\n");
    expect(suggest(null, business, "Statement Copy", 5)).toBeNull();
  });

  // #1626: live fees whose names the name rule misread (fee_published_id in each comment).
  it.each([
    "Personal Money Order", // 142173, 54818: a product any customer buys
    "Personal Money Orders (customers)",
    "Stop Payment Fee - Personal Money Orders",
    "Subpoena or litigation demand for production of documents or personal appearance: minimum", // 40566
    "Stop payments: Personal Drafts", // 94850
    "Stop Payment (personal draft only)",
    "Convert Personal Draft Into Teller Check",
    "Counter Check: A blank page of 3 personal", // 75914
    "Paper Statement Fee on Checking Accounts (Not applicable when accessing eStatements through Consumer eBanking)", // 85812
    "Check Copy – Personal or Corporate (personal are free on Netbranch)", // 77083
    "Personal, Cashier’s or Bill Pay checks", // 90850
    "Services Stop Payment for checks and Corporate ACH", // 101176
    "» all loan and certificate account balances as of the last business: Inactivity Fee", // 96200
    "Return Item Fee² (Max 6 [$222.00/day] for retail customers) (unlimited for commercial customers)", // 128993
  ])("reads no audience in a product, an exception or a time in the name: %s", (name) => {
    expect(nameAudience(name)).toBeNull();
    // With the name silent, the schedule decides: a general schedule with no business fees is consumer.
    expect(suggest(null, `Fee Schedule\nStop Payment $30`, name)?.source).not.toBe("fee_name");
  });

  it.each([
    "Returned Deposited Item – Member or Business", // 138277
    "Bill Pay: Regular Member Accounts and Business Accounts", // 127883
    "ATM/VISA® Debit Card/VISA® Rewards Debit Card/ VISA® Business Debit Card replacement card fee", // 123246
    "Excessive Withdrawal for Business Share/Savings, Share/Savings and Share Club only", // 129758
    "Stop Payment Fee (Personal/Business)", // 90296
    "Card Replacement (Personal or Business ATM/Debit Card)", // 86165
    "Stop Payment of Personal or Business Check", // 137663
  ])("reads a name that lists both sides as both: %s", (name) => {
    expect(suggest(null, `Fee Schedule\nBusiness Accounts\nStop Payment $30`, name)).toMatchObject({ audience: "both", source: "fee_name" });
  });

  it.each([
    "Commercial Account Continuous Overdraft Fee^", // 130558, Capital City Bank
    "‐ Basic Business or Personal Business Share Draft (average balance below $1,000)", // 140082
    "Business Checking, Savings and Money Market Accounts Monthly Fee",
    "On commercial accounts, if your account balance remains overdrawn for longer than 3 days, the account will be charged a", // 133325
    "Member/Corporate Account Fee",
    "Business Debit/ATM Card replacement",
    "Stop Payment (Business Checking)",
    "5 Business Mobile Deposit is available",
  ])("keeps a business name business: %s", (name) => {
    expect(nameAudience(name)).toBe("business");
  });

  it.each([
    "Individual Retirement Account Closing Fee", // 90972
    "Consumer Loan Origination Fee",
    "Personal Checking Monthly Service Charge",
    "Personal Draft Account Monthly Fee",
  ])("keeps a consumer name consumer: %s", (name) => {
    expect(nameAudience(name)).toBe("consumer");
  });

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
    expect(headingAbove(text, "Overdraft Fee", 30)).toMatchObject({ audience: "consumer", heading: "Personal Accounts" });
    expect(headingAbove(text, "Overdraft Fee", 35)).toMatchObject({ audience: "business", heading: "Business Accounts" });
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

  // #1059 50-fee spot check (86052 gpcu.org, 37392 membersfirstctfcu.com) and the live corporate names
  // it pointed to: a credit union's official check in any spelling is no audience; a corporate
  // account or checking name still is business.
  it.each([
    "Corporate/Cashiers Check Fee",
    "Corporate Bank Check",
    "Corporate/cashier’s check withdrawal payable to third party",
    "Corporate / Cashier’s Checks 5 free then",
    "Corporate/Official Check Issued (each)",
    "Corporate -Bank/Teller Check",
    "Corporate/Teller Checks",
    "Photocopy - Corporate/Member Check",
    "Corporate/personal check copy (per draft)",
    "Corporate or Personal Check Copy",
    "Copy of Corporate Share Draft",
    "Stop Payment on Corporate Share Drafts, Money Orders and/or ACH Items",
    "Check Copy Fee (Corporate One)",
    "Corporate Stop Payment",
    "Check Cashing – Non-member (on-us or Corporate)",
    // Review of #1382: a treasurer's check, a bare money order, the en-dash join.
    "Corporate Treasurer's Check",
    "Corporate Treasurer’s Checks",
    "Corporate Money Order",
    "Corporate – Bank Check",
    "Corporate — Official Check",
    "Member/Corporate Check Copy",
    "Personal or Corporate Share Draft Copy",
    // Live lines with the check word first (documents 3245, 25924 and 26396).
    "Check Copy – Personal or Corporate",
    "Check (Personal/Corporate) Duplicate - each",
    "Stale Corporate Treasurer Check/Money Order processing fee",
  ])("reads an official check as no audience: %s", (name) => {
    expect(suggest(null, `Fee Schedule\n${name} $30`, name)).toMatchObject({ source: "default_general_schedule", audience: "consumer" });
    expect(hasBusinessFees([`${name} | $30.00`, "Stop Payment $30"])).toBe(false);
  });

  it.each([
    "Corporate Checking Monthly Fee",
    "Monthly Service Fee - Corporate Checking",
    "Corporate Account Analysis Fee",
    // Review of #1382: a corporate checking account by its credit union name, a reversed join
    // with no check after it, and the words "one" starts that are not the Corporate One network.
    "Corporate Share Draft Account (Monthly Fee)",
    "Corporate Draft Account Fee",
    "Member/Corporate Account Fee",
    "Member or Corporate Accounts Monthly Fee",
    "Corporate one-time setup fee",
    "Corporate One Card annual fee",
    // Review of #1437: a corporate money order account is an account name.
    "Corporate Money Order Account Fee",
  ])(
    "keeps a corporate account name business: %s",
    (name) => {
      expect(suggest(null, `Fee Schedule\n${name} $30`, name)).toMatchObject({ source: "fee_name", audience: "business" });
    },
  );

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
    expect(headingAbove(truity, "Stop Payment Fee", 30)).toMatchObject({ audience: "both" });
    // With nothing priced for businesses, an all-accounts schedule is the consumer schedule.
    expect(suggest(null, ["Fees Applicable to all accounts", "Stop Payment $30.00"].join("\n"), "Stop Payment", 30)).toMatchObject({ audience: "consumer", source: "default_general_schedule" });
  });

  it("matches a fee's price as a whole token (review of 88e9dc21)", () => {
    const od = ["Personal Accounts", "Overdraft Fee $35", "Business Accounts", "Overdraft Fee $5"].join("\n");
    expect(headingAbove(od, "Overdraft Fee", 5)).toMatchObject({ audience: "business", heading: "Business Accounts" });
    expect(headingAbove(od, "Overdraft Fee", 35)).toMatchObject({ audience: "consumer", heading: "Personal Accounts" });
    const coins = ["Personal Accounts", "Coin counting $10", "Business Accounts", "Coin counting $0"].join("\n");
    expect(headingAbove(coins, "Coin counting", 0)).toMatchObject({ audience: "business" });
    // A price on the line below the name counts as well.
    expect(headingAbove(["Personal Accounts", "Stop Payment", "$35.00", "Business Accounts", "Stop Payment", "$5.00"].join("\n"), "Stop Payment", 5)).toMatchObject({ audience: "business" });
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
    expect(headingAbove(nav, "Lockbox", 50)).toMatchObject({ audience: "business" });
    expect(headingAbove(nav, "Stop Payment", 30)).toMatchObject({ audience: "consumer" });
  });

  it("keeps a bank-named heading, ignores bank names and non-commercial, and leaves an unfound line unknown", () => {
    const named = ["Personal Accounts", "Stop Payment $30", "Business Banking at Bank of Clarke", "Stop Payment $35"].join("\n");
    expect(headingAbove(named, "Stop Payment", 35)).toMatchObject({ audience: "business" });
    expect(suggest(null, ["Commercial Bank of Ozark", "Fee Schedule", "Stop Payment $30"].join("\n"), "Stop Payment", 30)).toMatchObject({ source: "default_general_schedule" });
    expect(suggest(null, ["Fee Schedule", "Non-commercial wire $15"].join("\n"), "Non-commercial wire", 15)).toMatchObject({ source: "default_general_schedule" });
    // In a mixed schedule a fee whose line is not in the text stays unknown.
    expect(suggest(null, ["Fees", "Stop Payment $30", "Business Services", "Lockbox $50"].join("\n"), "Wire Transfer", 20)).toBeNull();
  });

  it("never takes the next row's price, a description line or a bank's name (review of cfe0873d)", () => {
    const rows = ["Personal Accounts", "Stop Payment $30", "Wire Transfer $20", "Business Accounts", "Stop Payment $20"].join("\n");
    expect(headingAbove(rows, "Stop Payment", 20)).toMatchObject({ audience: "business", heading: "Business Accounts" });
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
    expect(headingAbove(["Personal Accounts", "Wire $1,500", "Business Accounts", "Wire $1,000"].join("\n"), "Wire", 1000)).toMatchObject({ audience: "business" });
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
    expect(headingAbove(rows("Wire Transfer $30", "NSF Fee"), "NSF Fee", 30)).toMatchObject({ audience: "consumer" });
    expect(headingAbove(rows("Coin wrappers $2 each", "ACH Fee"), "ACH Fee", 30)).toMatchObject({ audience: "consumer" });
    expect(headingAbove(rows("Wired funds $15", "Wire Fee"), "Wire Fee", 30)).toMatchObject({ audience: "consumer" });
    expect(headingAbove(rows("Monthly Maintenance $30", "Monthly Fee"), "Monthly Fee", 30)).toMatchObject({ audience: "consumer" });
    expect(headingAbove(rows("Night Deposit Service $30", "Service Charge"), "Service Charge", 30)).toMatchObject({ audience: "consumer" });
  });

  it("prefers a priced line under either name, and never guesses over a price line (review of 8dd7af67)", () => {
    const waived = ["Business Accounts", "Stop payment fee waived for Premier Business Checking", "Personal Accounts", "Stop Payment $30.00"].join("\n");
    expect(headingAbove(waived, "Stop Payment Fee", 30)).toMatchObject({ audience: "consumer", heading: "Personal Accounts" });
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
    expect(headingAbove(["Business Accounts", "Lockbox", "$50.00", "Stop Payment $35"].join("\n"), "Stop Payment", 35)).toMatchObject({ audience: "business" });
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
    expect(headingAbove(under("Consumer Accounts", "BUSINESS ACCOUNTS.", 30), "Stop Payment", 30)).toMatchObject({ audience: "business" });
    expect(headingAbove(under("Business Accounts", "PERSONAL ACCOUNTS.", 28), "Stop Payment", 28)).toMatchObject({ audience: "consumer" });
    expect(headingAbove(under("Consumer Accounts", "Business Accounts:", 30), "Stop Payment", 30)).toMatchObject({ audience: "business" });
    expect(headingAbove(under("Personal Accounts", "Business Accounts available at all branches", 30), "Stop Payment", 30)).toMatchObject({ audience: "business" });
    for (const [top, heading] of [
      ["Personal Accounts", "Business Accounts (not including non-profits)"],
      ["Business Accounts", "Consumer Accounts – see fees below"],
      ["Personal Checking", "Business Checking (not FDIC-insured sweep)"],
      ["Personal Banking Services", "Commercial Services Not Listed Above"],
    ]) {
      expect(suggest(null, under(top, heading, 30), "Stop Payment", 30)).toBeNull();
    }
    // A business-only schedule whose title or heading ends in a period still prices business fees.
    expect(suggest(null, ["BUSINESS FEE SCHEDULE.", "Effective January 1, 2026", "Stop Payment $30.00"].join("\n"), "Stop Payment", 30)).toMatchObject({ audience: "business", source: "document_title" });
    expect(headingAbove(["BUSINESS ACCOUNTS.", "Stop Payment $30.00", "Overdraft $35.00"].join("\n"), "Stop Payment", 30)).toMatchObject({ audience: "business" });
    expect(suggest(null, ["BUSINESS ACCOUNTS.", "Stop Payment $30.00", "Overdraft $35.00"].join("\n"), "Stop Payment", 30)?.audience).not.toBe("consumer");
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

  it("reads a colon line as introducing its section, and never defaults past an audience sentence (review of a5bc3ec1)", () => {
    for (const line of [
      "Business accounts:",
      "Fees for business accounts:",
      "Fees that apply to business accounts:",
      "Business Checking Accounts with Analysis:",
      "Business Accounts (fees per item):",
      "BUSINESS ACCOUNTS ARE SUBJECT TO THE FOLLOWING FEES:",
    ]) {
      expect(headingAbove(["Fee Schedule", line, "Stop Payment $30", "Overdraft $35"].join("\n"), "Stop Payment", 30)).toMatchObject({ audience: "business" });
    }
    for (const line of ["Business accounts.", "Business Accounts Are Subject to the Following Fees", "What Business Accounts Are Charged", "Business Checking Is Free"]) {
      expect(suggest(null, ["Fee Schedule", line, "Stop Payment $30", "Overdraft $35"].join("\n"), "Stop Payment", 30)?.audience).not.toBe("consumer");
    }
    const two = ["Fee Schedule", "Personal accounts:", "Stop Payment $30", "Business accounts:", "Stop Payment $35"].join("\n");
    expect(headingAbove(two, "Stop Payment", 30)).toMatchObject({ audience: "consumer" });
    expect(headingAbove(two, "Stop Payment", 35)).toMatchObject({ audience: "business" });
  });

  it("reads a line that points down to its fees as heading them (review of f125b445)", () => {
    for (const line of [
      "The fees listed below apply to business accounts.",
      "Fees for business accounts are listed below:",
      "These services are available to business accounts only.",
      "Business accounts – see below:",
    ]) {
      expect(suggest(null, ["Fee Schedule", line, "Stop Payment $30", "Overdraft $35"].join("\n"), "Stop Payment", 30)?.audience).not.toBe("consumer");
    }
    // A true pointer in a consumer-only schedule keeps the consumer default.
    expect(suggest(null, ["Fee Schedule", "Business accounts: see the Business Fee Schedule.", "Stop Payment $30"].join("\n"), "Stop Payment", 30)).toMatchObject({ audience: "consumer" });
  });

  it("leaves a fee unknown when only a heading naming one audience places it in a mixed schedule (#1059 holdout)", () => {
    const mixed = ["Personal Accounts", "Overdraft Fee $30", "Business Accounts", "Overdraft Fee $35"].join("\n");
    expect(suggest(null, mixed, "Overdraft Fee", 30)).toBeNull();
    expect(suggest(null, mixed, "Overdraft Fee", 35)).toBeNull();
    // A web page whose checking table has a business column claims nothing listed below it.
    const page = ["Checking Accounts", "Business Checking", "$25.00 per month", "Member Service Fees", "Overdraft Privilege $35.00 per item", "Stop Payment $25.00 per item"].join("\n");
    expect(suggest(null, page, "Stop Payment", 25)?.audience).not.toBe("business");
    // A personal heading in a schedule with no business fees still stands, as on main.
    expect(suggest(null, ["Personal Accounts", "Stop Payment $30"].join("\n"), "Stop Payment", 30)).toMatchObject({ audience: "consumer", source: "section_heading" });
    // The fee's own name, the address and an all-accounts heading still decide.
    expect(suggest(null, mixed.replace("Overdraft Fee $35", "Business Overdraft Fee $35"), "Business Overdraft Fee", 35)).toMatchObject({ audience: "business", source: "fee_name" });
    expect(suggest("https://bank.example/business-fee-schedule.pdf", mixed, "Overdraft Fee", 35)).toMatchObject({ audience: "business", source: "document_url" });
    const truity = ["Consumer Fees", "Other Service Fees (apply to all accounts)", "Stop Payment Fee $30.00", "Business Fees", "Business Savings Account Closing Fee $10.00"].join("\n");
    expect(suggest(null, truity, "Stop Payment Fee", 30)).toMatchObject({ audience: "both", source: "section_heading" });
  });

  it("never defaults a fee under a business heading to consumer (#1059 holdout)", () => {
    const filler = Array.from({ length: 20 }, (_, index) => `Note ${index}`).join("\n");
    expect(suggest(null, ["Business Services", filler, "Dormant debit card $5"].join("\n"), "Dormant debit card", 5)?.audience).not.toBe("consumer");
  });

  it("keeps a personal heading in a schedule with no business fees ahead of any title (review of 7c4f3b25)", () => {
    const menu = ["Home", "Business Fee Schedule", "About Us", "", "Personal Checking Accounts", "The charges below apply.", "Stop Payment $30.00", "Overdraft $35.00"].join("\n");
    expect(suggest(null, menu, "Stop Payment", 30)).toMatchObject({ audience: "consumer", source: "section_heading" });
    const titled = ["BUSINESS FEE SCHEDULE", "Personal Checking Accounts", "Effective 2026", "Stop Payment $30.00"].join("\n");
    expect(suggest(null, titled, "Stop Payment", 30)).toMatchObject({ audience: "consumer", source: "section_heading" });
  });

  it("reads \"Business/Non-Personal Accounts\" as a business section (#1059 holdout 4)", () => {
    const lines = ["For Consumer/Personal Accounts", "Stop payment (Per order) $30.00", "For Business/Non-Personal Accounts", "Stop payment (Per order) $30.00"];
    expect(hasBusinessFees(lines)).toBe(true);
    // A schedule that also prices business items: the personal heading alone no longer decides.
    expect(suggest(null, lines.join("\n"), "Stop payment (Per order)", 30)).toBeNull();
  });

  it("never reads \"non-business\" in an address as business (review of 6905fab5)", () => {
    expect(suggest("https://bank.example/fees/non-business/schedule.pdf", "Fee Schedule\nStop Payment $30", "Stop Payment")?.audience).not.toBe("business");
    // "Non-personal" is a bank's word for business accounts (#1059 holdout 5).
    expect(suggest("https://bank.example/fees/non-personal/schedule.pdf", "Fee Schedule\nStop Payment $30", "Stop Payment")).toMatchObject({ audience: "business", source: "document_url" });
  });

  it("reads Non-Personal and Non-Consumer as business (#1059 holdout 5)", () => {
    expect(suggest(null, ["Common Fee Schedule", "Overdraft Item Fee", "Personal Accounts $29.00 per item", "Return Item Fee: Non-Personal Accounts $32.00 per item"].join("\n"), "Return Item Fee: Non-Personal Accounts", 32)).toMatchObject({ audience: "business", source: "fee_name" });
    expect(suggest(null, ["Fees", "Overdraft Paid Item Fee - Consumers: $25.00", "Overdraft Paid Item Fee - Non-Consumer: fee per item $30.00"].join("\n"), "Overdraft Paid Item Fee - Non-Consumer: fee per item", 30)).toMatchObject({ audience: "business", source: "fee_name" });
    // A schedule whose only business wording is "non-personal" is not a general consumer schedule.
    expect(suggest(null, ["Fee Schedule", "Basic Personal Checking $5.00", "Basic Non-Personal Checking $10.00", "Stop Payment $30.00"].join("\n"), "Stop Payment", 30)?.source).not.toBe("default_general_schedule");
    // Non-business stays no audience.
    expect(suggest(null, ["Fee Schedule", "Non-business days: none", "Stop Payment $30"].join("\n"), "Stop Payment", 30)).toMatchObject({ audience: "consumer", source: "default_general_schedule" });
  });

  it("never takes the consumer default for a business schedule flattened into one line or named in the address (#1059 holdout 5)", () => {
    const flat = "BUSINESS SCHEDULE OF FEES AND CHARGES Community Credit Union Effective 2026 Stop Payment $30.00 Copy of Check $5.00 Fax Service $2.00 " + "x".repeat(200);
    expect(suggest(null, flat, "Stop Payment", 30)?.audience).not.toBe("consumer");
    expect(suggest("https://www.ccu.example/documents/ccufl_businessfeeschedule.pdf", "Fees\nStop Payment $30", "Stop Payment", 30)?.audience).not.toBe("consumer");
    // A consumer schedule is unaffected.
    expect(suggest("https://bank.example/fee-schedule.pdf", "Fee Schedule\nStop Payment $30", "Stop Payment", 30)).toMatchObject({ audience: "consumer", source: "default_general_schedule" });
  });

  it("keeps non-personal checks a product, not an audience (review of d31c9248)", () => {
    const cu = ["Schedule of Fees", "Check Cashing - Non-Member (non-personal checks only) $5.00", "Stop Payment $30.00"].join("\n");
    expect(suggest(null, cu, "Check Cashing - Non-Member (non-personal checks only)", 5)).toMatchObject({ audience: "consumer", source: "default_general_schedule" });
    expect(suggest(null, cu, "Stop Payment", 30)).toMatchObject({ audience: "consumer", source: "default_general_schedule" });
    expect(suggest(null, ["Fees", "Non-Personal Check Cashing $5.00"].join("\n"), "Non-Personal Check Cashing", 5)?.audience).not.toBe("business");
    expect(suggest(null, ["Fees", "Copy of Non-Personal Information $5.00"].join("\n"), "Copy of Non-Personal Information", 5)?.audience).not.toBe("business");
  });

  it("strips non-consumer checks as no audience, so a business schedule's fee stays business (review of d71e6929)", () => {
    expect(suggest(null, ["Business Fee Schedule", "Deposited Item Returned - Non-Consumer Checks $10.00"].join("\n"), "Deposited Item Returned - Non-Consumer Checks", 10)?.audience).not.toBe("consumer");
    expect(suggest(null, ["Business Schedule of Fees", "Non-Consumer Information Request $5.00"].join("\n"), "Non-Consumer Information Request", 5)?.audience).not.toBe("consumer");
    expect(suggest("https://bank.example/business/non-consumer-checks.pdf", "Fees\nStop Payment $30", "Stop Payment", 30)?.audience).not.toBe("consumer");
    expect(suggest(null, ["Business Accounts", "Non-Personal Data Export $5.00", "Personal Accounts", "Stop Payment $30"].join("\n"), "Non-Personal Data Export", 5)?.audience).not.toBe("consumer");
  });
});

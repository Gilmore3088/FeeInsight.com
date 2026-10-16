import { describe, expect, it } from "vitest";
import { feeEvidence, headingAbove, printsAmount, storedLineOf, EVIDENCE_MAX_CHARS } from "./fee-evidence";

// 1NB Bank's stored schedule (agent_source_texts 13604, doc 18090), its checking accounts as stored,
// read Oct 16. The two live monthly maintenance fees are catalog ids 60939 and 60940.
const ONE_NB = [
  "Checking Accounts",
  "",
  "Equality Checking",
  "",
  "Equality Checking",
  "",
  "Minimum Balance: None",
  "",
  "Features:",
  "eQuality-Flyer",
  "Frequently Asked Questions",
  "",
  "Carefree Checking",
  "",
  "Carefree Checking",
  "",
  "Minimum Average Daily Balance: $300.00",
  "",
  "Features: This account is available to all Individuals. Students up to age 25, Seniors age 55 and older, Active Military and Churches/Organizations are exempt from the service charges if the minimum balances are not met.  You have a choice of e-statements or paper statements with images. Enjoy all the benefits of unlimited check writing, MasterCard Debit Card and free Internet and Mobile Banking.",
  "",
  "Limitations: You must deposit $300.00 to open this account.",
  "",
  "Account Fees: The monthly service charge if the average daily balance drops below $300.00 during the statement cycle is $5.95. The fee is $4.95 if receiving E-Statements.",
  "",
  "Secure Checking",
  "",
  "Secure Checking",
  "",
  "Minimum Balance: None",
  "",
  "Features: Secure Checking Brochure",
  "",
  "Limitations: You must deposit $100.00 to open this account.",
  "",
  "NOW Checking",
  "",
  "NOW Checking",
  "",
  "Minimum Balance: $500",
  "",
  "Features: This account is available to Individuals, Sole Proprietors, Not-for-Profit Organizations, and Government Units (Partnerships and Corporations not eligible).",
  "",
  "Rate Information: This Account is an interest-bearing account. The interest rate and annual percentage yield are included in the Rate Chart. The interest rate and annual percentage yield may change. At our discretion, we may change the interest rate on the account at any time. Interest begins to accrue no later than the business day we receive credit for the deposit of non-cash items (for example, checks). Interest will be compounded monthly and will be credited to the account monthly.",
  "",
  "Balance Information: We use the daily balance method to calculate the interest on the account. This method applies a daily periodic rate to the collected principal in the account each day.",
  "",
  "Limitations: You must deposit $500.00 to open this account.",
  "",
  "Account Fees: The monthly service charge if the daily balance drops below $500.00 any day of the statement cycle is $10.00.",
  "",
  "Money Market Checking",
  "",
  "Money Market Checking",
  "",
  "Minimum Balance: $1,000",
  "",
  "Features: This account is available to all depositors.",
  "",
  "Rate Information: This Account is an interest-bearing account. The interest rate and annual percentage yield will depend upon the balance in the account as shown on the Rate Chart. The interest rate and annual percentage yield may change. At our discretion, we may change the interest rate on the account at any time. Interest begins to accrue no later than the business day we receive credit for the deposit of noncash items (for example, checks). Interest will be compounded monthly and will be credited to the account monthly.",
  "",
  "Balance Information: We use the daily balance method to calculate the interest on the account. This method applies a daily periodic rate to the collected principal in the account each day.",
  "",
  "Limitations: You must deposit $2,500.00 to open this account.",
  "",
  "Account Fees: The monthly minimum balance fee if the daily balance drops below $1 ,000.00 any day of the statement cycle is $10.00.",
].join("\n");

// Addition Financial FCU's whole stored schedule (agent_source_texts 4178, doc 6231), read Oct 16.
// Its four live monthly maintenance fees: catalog 24183 ($15), 24184 ($5), 24185 ($7.50), 24201 ($0).
const ADDITION = [
  "Personal Fee Schedule",
  "Effective November 15, 2024",
  "Benefits Checking | Service fee waived if either of the following:",
  "Monthly Service Fee | $15.00 | • There is a $2,000 direct deposit monthly",
  "• 20 debit card transactions* per month",
  "Classic Checking | Service fee waived if either of the following:",
  "Checking Monthly Service Fee | $5.00 | • There is a $1,000 direct deposit monthly",
  "• 10 debit card transactions* per month",
  "Accounts | *Each debit card transaction must be at least $10.00.",
  "Free Checking, Student Checking",
  "• | No monthly service fee.",
  "and Opportunity Checking | • | No minimum balance requirement.",
  "Monthly Service Fee | $0",
  "Share Savings | Service fee waived if any of the following:",
  "Monthly Service Fee | $7.50 | • An active AFCU checking account, an open line of credit, an active",
  "Savings | credit card, or loan with AFCU",
  "• $250 cumulative average daily balance of combined deposit",
  "Accounts Savings Plus and | accounts (savings, checking, money market)",
  "• direct deposit to savings or checking ($500 monthly aggregate",
  "Growth Plus Money Market | requirement)",
  "Monthly Service Fee | $0 | • if you are under age 23",
  "Other Services",
  "Account Services | Overdraft",
  "Check orders | prices vary Courtesy Pay to cover overdraft | $35 00",
  "Dormant accounts | $15 00 per month Nonsufficient funds | $35 00",
  "Fee applies after 12 months with no financial activity | Returned check, ATM, ACH or debit card, or Visa® overdraft",
  "Foreign Check Collection | $35 00 Overdraft protection transfer | $3 00",
  "Garnishment/levy services | $100 00",
  "Membership fee (one-time) | $10 00 Wire Services",
  "Money orders | $5 00 Incoming | $10 00",
  "Official check | $5 00 Outgoing (domestic) | $25 00",
  "Paper statement (mailed) | $5 00/statement Outgoing (non-domestic) | $75 00 per $50,000 00",
  "Research (reconciliation) fee at member’s request | $25 00/hr Wire message (non-domestic) | $25 00",
  "Research fee waived if error was made by credit union",
  "Returned check deposit | $15 00",
  "Returned mail/invalid address | $5 00",
  "Shared Branch Transactions | $10 00 each",
  "Stop payment | $30 00",
  "Temporary checks | $3 00/sheet | Complimentary Services",
  "Unclaimed property filing | $100 00 | • Use of Addition Financial ATMs and Publix Presto! ATMs",
  "• AddsUp Savings and Early Pay",
  "• Digital services: Mobile app, Zelle, Bill Pay, instant transfer,",
  "ATM/Debit Transactions | mobile wallet, and more",
  "International service fee | 3 0% | • No fee transfers by digital banking, mobile app, or telephone",
  "International service fee is charged for all transactions | banking",
  "completed in a foreign currency. | • Electronic statements",
  "Non-AFCU ATM Transactions | $2 00 each | • Notary Services",
  "©2026 Addition Financial Credit Union",
  "Federally Insured by NCUA",
].join("\n");

// Bank Iowa's account comparison (doc 31875, lines 533-539 of its stored text, read Oct 16).
const BANK_IOWA = [
  "Learn More",
  "",
  "Business Checking for Ag Our interest-earning account for higher balances Learn More | Freebird Business Checking for Ag No-fee checking** Learn More | Interest Checking for Ag Our interest-earning account for higher balances Learn More | Commercial Checking for Ag Our interest-earning account for higher balances Learn More",
  "",
  "Minimum Opening Deposit | $100 | $100 | $100 | $100",
  "",
  "Monthly Service Charge | $10 monthly service charge ($1,000 minimum balance to avoid monthly service charge)* | $0 | $10 monthly service charge ($500 minimum balance to avoid monthly service charge)* | $20",
  "",
  "Minimum Balance Required | $1,000 to avoid monthly service charge | $0 | $500 to avoid monthly service charge | $0",
].join("\n");
const BANK_IOWA_NOTE =
  'Knox deterministic extraction from Rosetta artifact #29776. excerpt="Monthly Service Charge | $10 monthly service charge ($1,000 minimum balance to avoid monthly service charge)* | $0 | $10 monthly service charge ($500 minimum balance to avoid month"';

const note = (excerpt: string) =>
  `Knox deterministic extraction from Rosetta artifact #13604. canonical_hint=monthly_maintenance; text_hash=abc; excerpt="${excerpt}"`;

describe("feeEvidence", () => {
  it("shows 1NB Bank's price, account, period and condition instead of the bare fee name", () => {
    const now = feeEvidence(
      {
        fee_name: "Account Fees: The monthly service charge",
        amount: "10.00",
        fee_category: "monthly_maintenance",
        extraction_note: note("Account Fees: The monthly service charge if the daily balance drops below $500.00 any day of the statement cycle is $10.00."),
      },
      ONE_NB,
    );
    expect(now).not.toBeNull();
    expect(now!.basis).toBe("traced");
    expect(now!.heading).toBe("NOW Checking");
    expect(now!.line).toContain("$10.00");
    expect(now!.line).toContain("monthly service charge");
    expect(now!.line).toContain("below $500.00");
    expect(now!.condition).toBe("if the daily balance drops below $500.00 any day of the statement cycle");

    const carefree = feeEvidence(
      { fee_name: "Account Fees: The monthly service charge", amount: "5.95", fee_category: "monthly_maintenance", extraction_note: null },
      ONE_NB,
    );
    expect(carefree?.heading).toBe("Carefree Checking");
    expect(carefree?.line).toContain("$5.95");
    // The clause beside the $4.95 price is that price's, never the $5.95 fee's.
    expect(carefree?.condition).toBe("if the average daily balance drops below $300.00 during the statement cycle");
  });

  it("re-cuts a stored line Knox ended before the price (dot leaders past 180 characters)", () => {
    const leader = ".".repeat(170);
    const text = `Account Services\nAccount balancing assistance${leader} $20.00 per hour\nPhotocopies${".".repeat(40)} $1.00`;
    const stored = `Account balancing assistance${leader}`.slice(0, 180);
    const evidence = feeEvidence(
      { fee_name: "Account balancing assistance", amount: 20, fee_category: "account_research", extraction_note: `Knox deterministic extraction from Rosetta artifact #1. excerpt="${stored}"` },
      text,
    );
    expect(printsAmount(stored, 20)).toBe(false);
    expect(evidence?.basis).toBe("traced");
    expect(evidence?.line).toBe("Account balancing assistance … $20.00 per hour");
  });

  it("keeps only the fee's own cells of a two-column row", () => {
    const text = `24-hour automated service${".".repeat(60)}No charge | Same day bill pay${".".repeat(60)} $9.95 per transaction\nWith assistance from an agent ${".".repeat(50)}No charge`;
    const evidence = feeEvidence({ fee_name: "Same day bill pay", amount: 9.95, fee_category: "bill_pay", extraction_note: null }, text);
    expect(evidence?.line).toBe("Same day bill pay … $9.95 per transaction");
  });

  it("never takes a conditional waiver for a $0 price (Addition Financial FCU, catalog 24201)", () => {
    const text = [
      "Classic Checking | Service fee waived if either of the following:",
      "Checking Monthly Service Fee | $5.00 | • There is a $1,000 direct deposit monthly",
      "Free Checking, Student Checking",
      "• | No monthly service fee.",
      "and Opportunity Checking | • | No minimum balance requirement.",
      "Monthly Service Fee | $0",
      "Share Savings | Service fee waived if any of the following:",
      "Monthly Service Fee | $0 | • if you are under age 23",
    ].join("\n");
    const evidence = feeEvidence(
      { fee_name: "Monthly Service Fee", amount: 0, fee_category: "monthly_maintenance", extraction_note: 'Knox read a free fee from Rosetta artifact #4178. excerpt="Monthly Service Fee | $0"' },
      text,
    );
    expect(evidence?.line).toBe("Monthly Service Fee | $0");
    expect(printsAmount("Classic Checking | Service fee waived if either of the following:", 0)).toBe(false);
    expect(printsAmount("Check Cashing Fee - Members | Waived", 0)).toBe(true);
  });

  it("cuts an account-comparison row to the fee's own column, named by its header (Bank Iowa 141041)", () => {
    const evidence = feeEvidence({ fee_name: "Monthly service charge", amount: "20.00", fee_category: "monthly_maintenance", extraction_note: BANK_IOWA_NOTE }, BANK_IOWA);
    expect(evidence).toEqual({ line: "Monthly Service Charge | $20", heading: "Commercial Checking for Ag", condition: null, basis: expect.any(String) });
  });

  it("gives nothing for a several-price row with no header to name the column", () => {
    const text = BANK_IOWA.split("\n").slice(4).join("\n");
    expect(feeEvidence({ fee_name: "Monthly service charge", amount: 20, fee_category: "monthly_maintenance", extraction_note: BANK_IOWA_NOTE }, text)).toBeNull();
    // Nor from the stored line alone: its first price is another account's.
    expect(feeEvidence({ fee_name: "Monthly service charge", amount: 20, fee_category: "monthly_maintenance", extraction_note: BANK_IOWA_NOTE }, null)).toBeNull();
  });

  it("drops a leading cell that belongs to a neighbouring column (American Bank & Trust 23078)", () => {
    const evidence = feeEvidence(
      {
        fee_name: "AB&T Bill Pay +PLUS",
        amount: "10.00",
        fee_category: "bill_pay",
        extraction_note: 'Knox deterministic extraction from Rosetta artifact #5108. excerpt="Non-customer | AB&T Bill Pay +PLUS | $10.00 per month unlimited use"',
      },
      null,
    );
    expect(evidence?.line).toBe("AB&T Bill Pay +PLUS | $10.00 per month unlimited use");
  });

  it("falls back to the stored line only when it prints the price", () => {
    const fee = {
      fee_name: "Stop Payment",
      amount: 20,
      fee_category: "stop_payment",
      extraction_note: 'Knox deterministic extraction from Rosetta artifact #30598. excerpt="Stop Payment = $20.00"',
    };
    expect(feeEvidence(fee, null)).toEqual({ line: "Stop Payment = $20.00", heading: null, condition: null, basis: "stored_line" });
    expect(feeEvidence({ ...fee, extraction_note: 'Knox x from Rosetta artifact #1. excerpt="Stop Payment ......"' }, null)).toBeNull();
  });

  it("gives nothing when neither the document nor the stored line prints the price", () => {
    const evidence = feeEvidence(
      { fee_name: "Account Fees: The monthly service charge", amount: 7.97, fee_category: "monthly_maintenance", extraction_note: null },
      ONE_NB,
    );
    expect(evidence).toBeNull();
    expect(feeEvidence({ fee_name: "Wire", amount: null, fee_category: "wire_domestic_outgoing" }, ONE_NB)).toBeNull();
  });

  it("cuts a long line around its price", () => {
    const filler = "Interest is compounded monthly and credited monthly. ".repeat(10);
    const line = `${filler}Account Fees: The monthly service charge is $12.00 if the balance is under $1,500.00. ${filler}`;
    const evidence = feeEvidence({ fee_name: "Monthly service charge", amount: 12, fee_category: "monthly_maintenance", extraction_note: `Knox a from Rosetta artifact #1. excerpt="${line}"` }, null);
    expect(evidence!.line.length).toBeLessThanOrEqual(EVIDENCE_MAX_CHARS + 4);
    expect(evidence!.line).toContain("$12.00");
    expect(evidence!.line.startsWith("… ")).toBe(true);
  });
});

describe("printsAmount", () => {
  it("reads figures as schedules print them", () => {
    expect(printsAmount("Courtesy Pay .................30.00", 30)).toBe(true);
    expect(printsAmount("Photocopies | $ .25/ea.", 0.25)).toBe(true);
    expect(printsAmount("Account Balancing Assistance (per hour) | $ 025 00", 25)).toBe(true);
    expect(printsAmount("Loan Skip A Pay Fee........ $29. 95/each", 29.95)).toBe(true);
    expect(printsAmount("drops below $1 ,000.00 any day is $10.00.", 1000)).toBe(true);
    expect(printsAmount("Teller Check Cashing | N/C | N/C", 0)).toBe(true);
    expect(printsAmount("Account Fees: The monthly service charge", 5.95)).toBe(false);
    expect(printsAmount("Fee is $25.00", 2.5)).toBe(false);
  });
});

describe("storedLineOf and headingAbove", () => {
  it("reads the excerpt from the note, or from conditions before the note moved", () => {
    expect(storedLineOf({ extraction_note: note("Stop Payment $30") })).toBe("Stop Payment $30");
    expect(storedLineOf({ extraction_note: null, conditions: note("Stop Payment $30") })).toBe("Stop Payment $30");
    expect(storedLineOf({ extraction_note: null, conditions: "Waived for seniors" })).toBeNull();
  });

  it("stops at another fee's priced line and at an ambiguous line", () => {
    const text = "Gold Checking\nMonthly maintenance fee $12.00\nOverdraft fee $35.00";
    expect(headingAbove(text, "Overdraft fee $35.00")).toBeNull();
    expect(headingAbove(text, "Monthly maintenance fee $12.00")).toBe("Gold Checking");
    expect(headingAbove("Gold Checking\nMonthly fee $5\nSilver Checking\nMonthly fee $5", "Monthly fee $5")).toBeNull();
  });
});

describe("the account each monthly price belongs to", () => {
  const addition = (id: number, fee_name: string, amount: string, excerpt: string) => ({
    id,
    fee: {
      fee_name,
      amount,
      fee_category: "monthly_maintenance",
      extraction_note: `Knox deterministic extraction from Rosetta artifact #4178. canonical_hint=monthly_maintenance; excerpt="${excerpt}"`,
    },
  });

  it("names Addition Financial FCU's accounts from the heading row above each price", () => {
    const rows = [
      addition(24183, "Monthly Service Fee", "15.00", "Monthly Service Fee | $15.00 | • There is a $2,000 direct deposit monthly"),
      addition(24184, "Checking Monthly Service Fee", "5.00", "Checking Monthly Service Fee | $5.00 | • There is a $1,000 direct deposit monthly"),
      addition(24185, "Monthly Service Fee", "7.50", "Monthly Service Fee | $7.50 | • An active AFCU checking account, an open line of credit, an active"),
      addition(24201, "Monthly Service Fee", "0.00", "Monthly Service Fee | $0"),
    ];
    const read = Object.fromEntries(rows.map(({ id, fee }) => [id, feeEvidence(fee, ADDITION)]));
    expect(read[24183]).toMatchObject({ line: "Monthly Service Fee | $15.00", heading: "Benefits Checking" });
    expect(read[24184]).toMatchObject({ line: "Checking Monthly Service Fee | $5.00", heading: "Classic Checking" });
    expect(read[24185]).toMatchObject({ line: "Monthly Service Fee | $7.50", heading: "Share Savings" });
    // The $0 sits under "Free Checking, Student Checking ... and Opportunity Checking": three
    // accounts, so no one account's name.
    expect(read[24201]).toMatchObject({ line: "Monthly Service Fee | $0", heading: null });
    // Each waiver is a list ("waived if either of the following:"): one item alone is no condition.
    for (const evidence of Object.values(read)) expect(evidence?.condition).toBeNull();
  });

  it("names the column a comparison row prints the price in (Bank Iowa 141041, Lake Area 104250)", () => {
    const iowa = feeEvidence({ fee_name: "Monthly service charge", amount: "20.00", fee_category: "monthly_maintenance", extraction_note: BANK_IOWA_NOTE }, BANK_IOWA);
    expect(iowa?.heading).toBe("Commercial Checking for Ag");
    // Doc 23885 as stored: the $5.00 is the first account column, and "No monthly maintenance fee"
    // is the second column's price, so the row is a comparison row, not label and price pairs.
    const compare = [
      "Compare Personal Checking Accounts",
      "Print Comparison Table",
      "Swipe Left to Right | Connect Five AccountTM | Classic Five CheckingSM | Club Five CheckingSM",
      "Monthly Fee | $5.00 --but easily waived if under 26 years old; or, by maintaining $500 minimum balance | No monthly maintenance fee | $25.00 --but easily waived by maintaining $25,000+ in combined balances",
      "Minimum Balance Requirement | $500 minimum to avoid fee | None | $25,000 combined eligible balances to avoid fee",
    ].join("\n");
    const five = feeEvidence({ fee_name: "Monthly Fee", amount: 5, fee_category: "monthly_maintenance" }, compare);
    expect(five?.heading).toBe("Connect Five Account");
    expect(five?.condition).toBe("waived if under 26 years old; or, by maintaining $500 minimum balance");
    expect(feeEvidence({ fee_name: "Monthly Fee", amount: 25, fee_category: "monthly_maintenance" }, compare)?.heading).toBe("Club Five Checking");
  });

  it("gives no account when the nearest name isn't clearly the price's own", () => {
    // ServisFirst (doc 19655): each name sits above its price, but "Simple Access" names no kind
    // of account. The old reader called the $5.00 "Student Checking", the $2.00 one's account.
    const servisFirst = [
      "Monthly Service Charge",
      "ServisFirst Checking",
      "$8.00 fee can be avoided by maintaining a $1,500.00 average daily collected balance",
      "Foundation Checking",
      "No monthly fee regardless of balance",
      "Executive Checking",
      "$10.00 fee can be avoided by maintaining a $1,500.00 average daily collected balance",
      "Student Checking",
      "$2.00 maintenance fee regardless of balance",
      "Simple Access",
      "$5.00 maintenance fee regardless of balance",
      "Interest Paid",
    ].join("\n");
    const simple = feeEvidence({ fee_name: "maintenance fee regardless of balance", amount: 5, fee_category: "monthly_maintenance" }, servisFirst);
    expect(simple?.line).toBe("$5.00 maintenance fee regardless of balance");
    expect(simple?.heading).toBeNull();
    expect(feeEvidence({ fee_name: "maintenance fee regardless of balance", amount: 2, fee_category: "monthly_maintenance" }, servisFirst)?.heading).toBe("Student Checking");

    // Doc 28476: "PERSONAL SAVINGS" heads the $5.00 savings fee. It names a group, so the search
    // stops there and never climbs to "REFRESH CHECKING" above it.
    const savings = [
      "REFRESH CHECKING",
      "Rate Information: This account is a non-interest-bearing account.",
      "Account Fees: There is no monthly service charge for this account.",
      "PERSONAL SAVINGS",
      "Rate Information: This Account is an interest-bearing account.",
      "Limitations: You must deposit $50.00 to open this account.",
      "Account Fees: A monthly service charge of $5.00 will be imposed each month if the balance in the account falls below $100.00 any day of the month.",
      "KIDS SAVERS CLUB SAVINGS",
    ].join("\n");
    const personal = feeEvidence({ fee_name: "Account Fees: A monthly service charge", amount: 5, fee_category: "monthly_maintenance" }, savings);
    expect(personal?.heading).toBeNull();
    expect(personal?.condition).toBe("if the balance in the account falls below $100.00 any day of the month");

    // A line naming two accounts, a sentence and a tagline are no heading.
    expect(headingAbove("Free Checking, Student Checking\nMonthly Service Fee | $0", "Monthly Service Fee | $0", 0)).toBeNull();
    expect(headingAbove("Checking for everyone\nMonthly fee $5", "Monthly fee $5", 5)).toBeNull();
    expect(headingAbove("The Flexible Savings Account\nMonthly fee $5", "Monthly fee $5", 5)).toBeNull();
  });

  it("quotes a waiver on the next line only when that line is the waiver alone", () => {
    const text = ["Gold Checking", "Monthly maintenance fee $12.00", "Waived with $1,500 minimum daily balance", "Silver Checking"].join("\n");
    expect(feeEvidence({ fee_name: "Monthly maintenance fee", amount: 12, fee_category: "monthly_maintenance" }, text)).toMatchObject({
      heading: "Gold Checking",
      condition: "Waived with $1,500 minimum daily balance",
    });
    const other = ["Gold Checking", "Monthly maintenance fee $12.00", "If you choose a debit card, there will be an ATM fee of $2.00 per withdrawal"].join("\n");
    expect(feeEvidence({ fee_name: "Monthly maintenance fee", amount: 12, fee_category: "monthly_maintenance" }, other)?.condition).toBeNull();
  });
});

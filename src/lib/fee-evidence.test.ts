import { describe, expect, it } from "vitest";
import { feeEvidence, headingAbove, printsAmount, storedLineOf, EVIDENCE_MAX_CHARS } from "./fee-evidence";

// 1NB Bank's stored schedule (agent_source_texts 13604, doc 18090), the part the two live
// monthly maintenance fees were read from (catalog ids 60939 and 60940).
const ONE_NB = [
  "Carefree Checking",
  "",
  "Carefree Checking",
  "",
  "Minimum Average Daily Balance: $300.00",
  "",
  "Features: This account is available to all Individuals. Students up to age 25, Seniors age 55 and older, Active Military and Churches/Organizations are exempt from the service charges if the minimum balances are not met.  You have a choice of e-statements or paper statements with images. Enjoy all the benefits of unlimited check writing, MasterCard Debit Card and free Internet and Mobile Banking.",
  "",
  "Limitations: You must deposit $300.00 to open this account.",
  "",
  "Account Fees: The monthly service charge if the average daily balance drops below $300.00 during the statement cycle is $5.95. The fee is $4.95 if receiving E-Statements.",
  "",
  "Secure Checking",
  "",
  "Secure Checking",
  "",
  "Minimum Balance: None",
  "",
  "Features: Secure Checking Brochure",
  "",
  "Limitations: You must deposit $100.00 to open this account.",
  "",
  "NOW Checking",
  "",
  "NOW Checking",
  "",
  "Minimum Balance: $500",
  "",
  "Features: This account is available to Individuals, Sole Proprietors, Not-for-Profit Organizations, and Government Units (Partnerships and Corporations not eligible).",
  "",
  "Rate Information: This Account is an interest-bearing account. The interest rate and annual percentage yield are included in the Rate Chart.",
  "",
  "Balance Information: We use the daily balance method to calculate the interest on the account.",
  "",
  "Limitations: You must deposit $500.00 to open this account.",
  "",
  "Account Fees: The monthly service charge if the daily balance drops below $500.00 any day of the statement cycle is $10.00.",
  "",
].join("\n");

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

    const carefree = feeEvidence(
      { fee_name: "Account Fees: The monthly service charge", amount: "5.95", fee_category: "monthly_maintenance", extraction_note: null },
      ONE_NB,
    );
    expect(carefree?.heading).toBe("Carefree Checking");
    expect(carefree?.line).toContain("$5.95");
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

  it("falls back to the stored line only when it prints the price", () => {
    const fee = {
      fee_name: "Stop Payment",
      amount: 20,
      fee_category: "stop_payment",
      extraction_note: 'Knox deterministic extraction from Rosetta artifact #30598. excerpt="Stop Payment = $20.00"',
    };
    expect(feeEvidence(fee, null)).toEqual({ line: "Stop Payment = $20.00", heading: null, basis: "stored_line" });
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

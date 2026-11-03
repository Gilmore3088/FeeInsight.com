import { describe, expect, it } from "vitest";
import { audienceSectionHeading } from "@/lib/agents/knox/audience-section";
import { AUDIENCE_WORDS } from "@/lib/agents/knox/bullet-cell-rows";
import { tidyFeeName } from "@/lib/agents/knox/layout";
import { withLineupFromText, type AccountLineup } from "@/lib/agents/knox/lineup";

type Read = { canonicalHint: string; feeName: string; excerpt: string; amount: number; lineup?: AccountLineup | null; audienceSection?: string };
const asRead = (canonicalHint: string, feeName: string, excerpt: string, amount: number): Read => ({ canonicalHint, feeName, excerpt, amount });
import { channelListHeading, zeroPrintedForRead, zeroPrintedOnLine } from "@/lib/agents/knox/rules";
import { runFreeSpecialists } from "@/lib/agents/knox/specialists";
import { rateBoundOf } from "@/lib/rate-bound";

/** Knox v179: the reads backlog dry run 10 (Nov 3) found wrong or doubtful, each from the bank's own lines. */

// Midwest Members FCU, text 40777, lines 334-350.
const MIDWEST = [
  "Box Drilled Open - Drilled Box Fee | $125",
  "Replacement of Lost Key - Safe Box Key Fee | $20",
  "Senior Perks (60 & Over)",
  "Copy of a Check | FREE",
  "Copy of a Statement | FREE",
  "Fax Service | FREE",
  "Printout of Account Activity - History | FREE",
  "Printed Checks (One Box Per Year) | FREE",
  "Fees effective as of 10/01/2025. Rates Subject to Change.",
].join("\n\n");

// MassMutual FCU, text 11896, lines 28-39 (run-together words as the PDF reader left them).
const MASSMUTUAL = [
  "financialinstitutions.Manyofthese",
  "feescanbeavoidedbyusing | Visa Cr® editCard",
  "alternativeMMFCUservices. | Visa®creditcardreturncheckfee.............$10",
  "AdditionalVisa®creditcard.......................$5",
  "AccountServices | Replacelostcreditcard(each).................$10",
  "Expressplasticcardreplacement(each)..$25",
  "Non-sufficient/Uncollectedfunds..................$10or$25",
  "Includeschecks,ACH,ATM,debitwithdrawals(peritem)",
  "Returneddepositorloanpayment(each)..........,....$10 TellerServices",
  "Overdrafttransfer(from shareaccount).....................$3",
].join("\n");

// Oklahoma Educators FCU, text 34246, lines 194-198 and 230-232.
const OKLAHOMA = [
  "Minimum Interest Charge | If you are charged interest, the charge will be no less than $2.00.",
  "Cash Advance Fee | 2% minimum or $2, maximum fee of $10",
  "Cash Advance Fee (Finance Charge):",
  "$2.00 or 2.00% of the amount of each cash advance, whichever is greater, however, the fee will never exceed $10.00.",
].join("\n\n");

// North State Bank, text 13544, lines 222-228 (footnotes under a product table).
const NORTH_STATE = [
  "1A companion account for North State Bank customers, this account is only available to those who have an active checking account or loan (loan balance must equal or exceed $15,000).",
  "2 No monthly fee and a minimum deposit of $25 for account holders 26 years and younger and 55 years and older.",
  "3 Annual percentage yield. APY available as of October 1, 2026, and is subject to change without notice.  For balances greater than $10,000, a blended APY calculation will be reflected on your statement.",
  "4 Monthly maintenance fee waived when minimum account balance requirement is met.",
].join("\n\n");

// LifeStore Bank, text 13549, lines 523-537.
const LIFESTORE = [
  "Premier Checking",
  "Get rewarded for a sound financial relationship with our Premier Checking account option.",
  "IDProtect® - Identity theft monitoring and resolution service.*4",
  "Online or paper statements",
  "Free Online Bill Pay",
  "Earns interest on daily balance",
  "Minimum opening balance of $100.00",
  "Monthly Service Charge of $15.00",
].join("\n\n");

// Meridia Community FCU, text 4803, lines 31-44 (the reader left control characters in a broken label).
const MERIDIA = [
  "(Debit & ATM) | -Dependent on date of check\u0003 PD[\u0003\u0019\u0003\\HDUV",
  "Overdraft Transfer from Share\u0003",
  "$9.99",
  "Savings | Non-Member Check Cashing | <$2,000 | $5.00",
  "Stop Payment Fee (single or range) | $20.00 ea | Protest Fee | $15.00 ea",
  "IRA Share Savings Account Fees | Wire-Outgoing International | $40.00 ea",
  "Minimum Balance (under $500) | $5.00/Qtr",
].join("\n");

describe("Knox v179: an audience's own section", () => {
  it("files Midwest Members' seniors' free fax under its section, never as the general $1 fax", () => {
    expect(audienceSectionHeading(MIDWEST, "Fax Service | FREE")).toBe("Senior Perks (60 & Over)");
    expect(audienceSectionHeading(MIDWEST, "Replacement of Lost Key - Safe Box Key Fee | $20")).toBeNull();
    const fax = withLineupFromText(asRead("document_reproduction", "Fax Service", "Fax Service | FREE", 0), MIDWEST);
    expect(fax.audienceSection).toBe("Senior Perks (60 & Over)");
    expect(fax.lineup?.productName).toBe("Senior Perks (60 & Over)");
  });

  it("never takes an exemption note for a section", () => {
    for (const note of ["(Youth Accounts exempt from fee)", "No fee for senior citizens (62+)", "(Not applicable if Under 18 or Over 65)"]) {
      expect(audienceSectionHeading(["Account Services", note, "Coin Counting | $5"].join("\n"), "Coin Counting | $5")).toBeNull();
    }
  });

  it("reads '60 & Over' as an audience", () => {
    expect(AUDIENCE_WORDS.test("Senior Perks (60 & Over)")).toBe(true);
    expect(AUDIENCE_WORDS.test("Members 65 and older")).toBe(true);
    expect(AUDIENCE_WORDS.test("Box 10 x 10")).toBe(false);
  });
});

describe("Knox v179: a channel list never chooses the category", () => {
  it("reads MassMutual's run-together overdraft transfer as an overdraft protection transfer, not an ATM fee", () => {
    expect(channelListHeading("Includeschecks,ACH,ATM,debitwithdrawals(peritem)")).toBe(true);
    expect(channelListHeading("ATM FEES PER TRANSACTION")).toBe(false);
    const transfer = runFreeSpecialists(MASSMUTUAL).candidates.filter((read) => /overdraft\s*transfer/i.test(read.excerpt) && read.amount === 3);
    expect(transfer.length).toBeGreaterThan(0);
    for (const read of transfer) expect(read.canonicalHint).toBe("od_protection_transfer");
  });
});

describe("Knox v179: a rate's bound is no flat price", () => {
  it("reads '2% minimum or $2' as the rate's minimum", () => {
    expect(rateBoundOf("Cash Advance Fee | 2% minimum or $2, maximum fee of $10", 2, "Cash Advance Fee")).toMatchObject({ kind: "min", ratePercent: 2, bound: 2 });
    // A minimum payment is no bound of a charge.
    expect(rateBoundOf("Minimum payment: 3.00% or $20.00", 20)).toBeNull();
  });

  it("reads no flat $2 cash advance fee from Oklahoma Educators' lines", () => {
    const run = runFreeSpecialists(OKLAHOMA);
    expect(run.candidates.filter((read) => read.canonicalHint === "cash_advance")).toEqual([]);
  });
});

describe("Knox v179: a $0 needs its line to print it", () => {
  it("prints a free price only on its own line or as the bare cell above it", () => {
    expect(zeroPrintedOnLine("4 Monthly maintenance fee waived when minimum account balance requirement is met.")).toBe(false);
    expect(zeroPrintedOnLine("Monthly Maintenance Fee: $0 or $4.95")).toBe(false);
    expect(zeroPrintedOnLine("Check Cashing Fee - Members | Waived")).toBe(true);
    expect(zeroPrintedOnLine("Fax Service | FREE")).toBe(true);
    expect(zeroPrintedOnLine("Enjoy all these benefits without any monthly service fees.")).toBe(true);
    const stacked = "Overdraft Protection transfers or advances\n\n$0\n\nper transfer/advance from your eligible linked savings account or credit card or line of credit";
    expect(zeroPrintedForRead("per transfer/advance from your eligible linked savings account or credit card or line of credit", stacked)).toBe(true);
  });

  it("reads no $0 from North State Bank's waiver footnote", () => {
    const run = runFreeSpecialists(NORTH_STATE);
    expect([...run.candidates, ...run.held].filter((read) => read.amount === 0 && /waived when minimum/i.test(read.excerpt))).toEqual([]);
  });
});

describe("Knox v179: doubtful reads", () => {
  it("gives LifeStore's $15 monthly service charge to Premier Checking past its marketing sentence", () => {
    const charge = withLineupFromText(asRead("monthly_maintenance", "Monthly Service Charge", "Monthly Service Charge of $15.00", 15), LIFESTORE);
    expect(charge.lineup?.productName).toBe("Premier Checking");
  });

  it("never names Meridia's account from a label with control characters", () => {
    const balance = withLineupFromText(asRead("minimum_balance", "Minimum Balance (under $500)", "Minimum Balance (under $500) | $5.00/Qtr", 5), MERIDIA);
    expect(balance.lineup?.productName ?? "").not.toMatch(/Overdraft Transfer|\u0003/);
  });

  it("names Blackhawk's fee from its own words, not the sentence opening", () => {
    expect(tidyFeeName("This account contains a monthly service charge")).toBe("Monthly service charge");
  });
});

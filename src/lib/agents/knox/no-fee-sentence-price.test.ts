import { describe, expect, it } from "vitest";
import { priceAfterNoFeeSentence } from "./rules";
import { KNOX_RULES_STRATEGY, runFreeSpecialists } from "./specialists";

const reads = (text: string) => runFreeSpecialists(text).candidates.map((fee) => `${fee.canonicalHint}:${fee.amount}`);

// ESL FCU (institution 6843, document 21968, text 18587), the Free Checking page as stored. The $1 is
// the opening deposit; live fee 68597 published it as a $1 monthly maintenance fee.
const ESL = `Free Checking Account

It’s easy to open. It makes banking more convenient. There are no minimum balance requirements or monthly service fees. And you can get started with only a $1 deposit.

We make it convenient for you!

Open an ESL Free Checking Account online in only a few minutes.

Features & Benefits

All this comes free with ESL Free Checking:

No minimum balance or monthly service fees.`;

describe("Knox v143: a price whose sentence names no fee takes none from a \"no ... fees\" sentence", () => {
  it("is the version this read ships under", () => {
    expect(KNOX_RULES_STRATEGY.version).toBeGreaterThanOrEqual(143);
  });

  it("reads no fee from ESL's opening deposit", () => {
    expect(reads(ESL)).toEqual([]);
  });

  it("sees the sentence the price sits in, before and after it", () => {
    const line = "There are no minimum balance requirements or monthly service fees. And you can get started with only a ";
    expect(priceAfterNoFeeSentence(line, " deposit.")).toBe(true);
    // A price named in its own sentence, before or after it, is that fee's.
    expect(priceAfterNoFeeSentence("No monthly service charge if account criteria met (10 or more debit card transactions). If not met ", " Service Charge")).toBe(false);
    expect(priceAfterNoFeeSentence("There is no charge for eStatements. Paper statement fee is waived for owners 60 or older. Paper Statement fee is ", "")).toBe(false);
    // A no-fee sentence with a condition waives the fee the next sentence prices (live 139379).
    expect(priceAfterNoFeeSentence("No monthly service fee with an average daily balance of $750+. Otherwise, it’s only ", "/month")).toBe(false);
    // No earlier "no ... fees" sentence: not this rule's.
    expect(priceAfterNoFeeSentence("It makes banking easy. You can get started with only a ", " deposit.")).toBe(false);
  });

  // The other live fees whose stored line has a "no ... fee" sentence before the price's sentence
  // (Oct 30, prod read-only): each names its fee in the price's own sentence and still reads.
  it.each([
    ["Green Checking\nNo monthly service charge if account criteria met (10 or more debit card transactions, 1 ACH debit or credit, and valid email address for E Statements). If not met $5 Service Charge", "monthly_maintenance:5"],
    ["b First ten bill payments each statement cycle are provided at no charge. Each additional bill payment during the statement cycle will be $.40", "bill_pay:0.4"],
    ["If you meet the requirements, you’ll pay no monthly maintenance fee. If requirements aren’t met a monthly maintenance fee of $8", "monthly_maintenance:8"],
    ["2 There is no charge for eStatements. Paper statement fee is waived for primary owner 60 years or older. Paper Statement fee is $3", "paper_statement:3"],
    ["NJ Consumer Checking\nNo minimum balance. Eight (8) checks may be written per statement cycle at no charge. Monthly maintenance fee of $3.00 per statement", "monthly_maintenance:3"],
    ["There is no charge for Overdraft Defender unless you use it. If an overdraft occurs, the normal overdraft fee of $32 per item", "overdraft:32"],
    ["There's no fee to use the Debit Card to make a purchase. It's a fast and simple way to pay from your Savings Account. There is a $10 Card Replacement Fee.", "card_replacement:10"],
    ["1 There are no minimum balance requirements and the monthly fee is $3.95 per month, or $2.95 per month with regular direct deposit.", "monthly_maintenance:3.95"],
  ])("still reads %j", (text, read) => {
    expect(reads(text)).toContain(read);
  });
});

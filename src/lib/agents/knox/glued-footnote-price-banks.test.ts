import { describe, expect, it } from "vitest";
import { runFreeSpecialists } from "./specialists";
import { checkFeeAgainstSource } from "@/lib/custom-report/source-check";

/**
 * The other three banks of #1946, verbatim from their stored texts (production `agent_source_texts`,
 * read 2026-10-27; blank lines dropped). Each fee went live at its footnote's number and was taken
 * down by hand on 2026-10-18 (`source_mismatch: #1946`); the glued-footnote fixtures before covered
 * only North State Bank and Penn Community Bank.
 */
// Institution 3125, document 18292: three accounts, each "$0" with its own footnote 3, 4 and 5.
const BANK_3125 = `Regular Checking
$1.00 minimum deposit to open
Monthly Service Charge: $03
3If your balance falls below the minimum daily balance of $500 you will be assessed a $5.00 charge once per statement cycle, plus $.10 for each check more than 20 per statement cycle.  This fee is waived for senior citizens over the age of 62 and students under the age of 21.
Variable Interest Rate
Monthly Service Charge: $04
4No monthly fee with a daily balance of $500 or an average daily balance of $800.  You will be assessed a $6.00 charge once per statement cycle unless you maintain these balances.
Variable Interest Rate
Monthly Service Charge: $05
5No monthly fee with an average daily balance of $2,000.  You will be assessed a $10.00 charge once per statement cycle unless you maintain the average daily balance.`;
// Institution 162, document 21374: "$0¹" and "$0²" on the Safe Start Checking page.
const BANK_162 = `Safe Start Checking Account
Monthly service charge: $01
Minimum opening deposit: $02
•  No monthly service charge1`;
// Institution 6942, document 29978: a two-account table, "$0¹ | $0".
const BANK_6942 = `Dividend Rate | Up to 5% 2
Monthly Fee | $01 | $0
All Rates
Apply Now
1 When requirements are not met, a $5 monthly fee will apply.`;

const CASES = [
  { bank: 3125, text: BANK_3125, name: "Monthly Service Charge", footnotes: [3, 4, 5] },
  { bank: 162, text: BANK_162, name: "Safe Start Checking Account Monthly service charge", footnotes: [1] },
  { bank: 6942, text: BANK_6942, name: "Monthly Fee", footnotes: [1] },
];

describe("a footnote glued to a $0 price, at the other #1946 banks", () => {
  it.each(CASES)("Knox never reads institution $bank's fee at its footnote's number", ({ text, footnotes }) => {
    const { candidates } = runFreeSpecialists(text, { institutionName: "Bank" });
    // A real price in a footnote ("a $5.00 charge") is the footnote's own read, not the monthly row's.
    expect(candidates.filter((fee) => /monthly/i.test(fee.feeName) && footnotes.includes(fee.amount)).map((fee) => [fee.feeName, fee.amount])).toEqual([]);
  });

  it.each(CASES)("the shared check refuses institution $bank's live read at the footnote", ({ text, name, footnotes }) => {
    for (const amount of footnotes) {
      const result = checkFeeAgainstSource(text, name, amount, ".", "monthly_maintenance");
      expect(result.ok || result.reason === "tiered_fee").toBe(false);
    }
  });
});

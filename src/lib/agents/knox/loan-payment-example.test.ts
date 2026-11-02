import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { KNOX_RULES_STRATEGY, runFreeSpecialists } from "./specialists";
import { AMOUNT_PATTERN, extractCandidatesFromText, loanPaymentExample } from "./rules";

// #2854: Pelican's disclosures page (institution 7482, document 31892, stored text 29794, read Oct 13)
// prints each sample loan's estimated monthly payment beside its $75 documentation fee. Knox read the
// payments as "Loan Documentation Fee, estimated payment" and four went live (141052-141055).
const PELICAN = readFileSync(join(process.cwd(), "src/lib/agents/knox/__fixtures__/pelican-loan-payment-examples-29794.txt"), "utf8");
const PAYMENTS = [1473.89, 1172.15, 622.75, 870.78, 2201.09];

/** Whether any price on the line equal to `amount` reads as a payment example. */
function exampleAt(line: string, amount: number): boolean {
  for (const match of line.matchAll(new RegExp(AMOUNT_PATTERN.source, "g"))) {
    if (Math.abs(Number(match[1].replace(/,/g, "")) - amount) >= 0.005) continue;
    const start = match.index ?? 0;
    if (loanPaymentExample(line.slice(0, start), line.slice(start + match[0].length))) return true;
  }
  return false;
}

describe("a loan's payment example is never a charge (#2854, v153)", () => {
  it("is on the v153 strategy", () => {
    expect(KNOX_RULES_STRATEGY.version).toBeGreaterThanOrEqual(153);
  });

  it("reads none of Pelican's sample-loan payments, from the bank's stored text", () => {
    const result = runFreeSpecialists(PELICAN, { institutionName: "Pelican Credit Union" });
    for (const amount of PAYMENTS) {
      expect(result.candidates.filter((fee) => fee.amount === amount)).toEqual([]);
      expect(result.held.filter((fee) => fee.amount === amount)).toEqual([]);
    }
    expect(result.candidates.some((fee) => /estimated payment/i.test(fee.feeName))).toBe(false);
  });

  it("leaves the $75 documentation fee in the same sentence as it was (held, not dropped)", () => {
    const result = runFreeSpecialists(PELICAN, { institutionName: "Pelican Credit Union" });
    const doc = [...result.candidates, ...result.held].filter((fee) => fee.amount === 75);
    expect(doc.length).toBeGreaterThan(0);
    expect(doc.every((fee) => /Loan Documentation Fee/.test(fee.feeName ?? ""))).toBe(true);
  });

  it("counts the drop on the rules pass", () => {
    const result = extractCandidatesFromText(PELICAN);
    expect(result.dropped?.loan_payment_example ?? 0).toBeGreaterThan(0);
  });

  it.each([
    ["Loan Documentation Fee, estimated payment of $1,473.89", 1473.89],
    ["APR and the estimated monthly payment of $2,201.09 does include a $25 document fee.", 2201.09],
    ["Sample payment: $18.87", 18.87],
    ["60 monthly payments of $193.33 at 6.00% APR", 193.33],
    ["Your monthly payment would be $412.50 on a $20,000 loan.", 412.5],
    ["Total of payments $23,197.80", 23197.8],
    ["Amount financed: $19,925.00", 19925],
    ["Payment example: $18.53 per $1,000 borrowed for 60 months", 18.53],
    ["A payment of $377.42 for 60 months at 5.24% APR", 377.42],
  ])("reads %s as a payment example", (line, amount) => {
    expect(exampleAt(line, amount)).toBe(true);
  });

  // Live fees that name a payment and must keep passing (issue #2854's measured set, read Nov 1).
  it.each([
    ["Skip-a-Payment Fee-if monthly loan payment is $350 or less | $35 each", 35], // 101785
    ["Skip-a-Payment Fee -if monthly loan payment is over $350 | $55 each", 55], // 101786
    ["Returned Mail ................................................... $2/each3 | Monthly Payment Late Fee (After 15 days) ............. $15", 15], // 20778
    ["Quick Cash loans include a $25.00 Prepaid Finance Charge.", 25], // 141417
    ["Manufactured Home Loans include a $995 Prepaid Finance Charge.", 995], // 141418
    ["Cash Advance Fee (Finance Charge) ….….…. $5.00 or 3%", 5], // 53579
    ["• Skip-A-Pay Fee o Loan payment of $500.01 or more - $50.00", 50], // 142139
    ["Late Fee on Loan Payments | $50.00 at 30 Days Overdue", 50], // 73384
    ["Loan Skip Payment Fee.......................................$100", 100], // 152667
    ["Late payment ......................................................................................$50", 50], // 58500
    ["Cash handling $1.00 per $1,000 deposited", 1],
    ["Monthly maintenance fee $5.00 for 12 months, then $10.00", 5],
  ])("keeps %s", (line, amount) => {
    expect(exampleAt(line, amount)).toBe(false);
  });

  it("still reads the real fees beside payment words on the rules pass", () => {
    const text = [
      "Skip-a-Payment Fee-if monthly loan payment is $350 or less | $35 each",
      "",
      "Monthly Payment Late Fee (After 15 days) ............. $15",
    ].join("\n");
    const amounts = runFreeSpecialists(text).candidates.map((fee) => fee.amount);
    expect(amounts).toEqual(expect.arrayContaining([35, 15]));
  });
});

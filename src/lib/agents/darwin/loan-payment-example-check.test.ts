import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkFeeAgainstSource } from "@/lib/custom-report/source-check";
import {
  findLoanPaymentExamples,
  LOAN_PAYMENT_EXAMPLE_PREFILTER,
  LOAN_PAYMENT_EXAMPLE_TAKEDOWN_LIVE,
  loanPaymentExampleDetail,
  loanPaymentExampleMatch,
  recheckLoanPaymentExamples,
  type LoanPaymentExampleRow,
} from "./loan-payment-example-check";

// #2854: Pelican (7482) stored text 29794, the bank's own words (fixture shared with Knox's test).
const PELICAN = readFileSync(join(process.cwd(), "src/lib/agents/knox/__fixtures__/pelican-loan-payment-examples-29794.txt"), "utf8");

function note(excerpt: string): string {
  return `Knox deterministic extraction from Rosetta artifact #29794. canonical_hint=other_lending_fee; calibrated_confidence=0.92; excerpt="${excerpt}"`;
}

function row(id: number, name: string, amount: number, excerpt: string, key = "other_lending_fee", institution = 7482): LoanPaymentExampleRow {
  return { fee_published_id: id, fee_verified_id: id + 25_000, institution_id: institution, fee_name: name, amount, canonical_fee_key: key, source_line: note(excerpt) };
}

// The four live movers, exactly as stored (raw 669616-669619), and live fees naming payments that stay.
const MOVERS = [
  row(141052, "Loan Documentation Fee, estimated payment", 1473.89, "Loan Documentation Fee, estimated payment of $1,473.89"),
  row(141053, "Loan Documentation Fee, estimated payment", 1172.15, "Loan Documentation Fee, estimated payment of $1,172.15"),
  row(141054, "Loan Documentation Fee, estimated payment", 622.75, "Loan Documentation Fee, estimated payment of $622.75"),
  row(141055, "Loan Documentation Fee, estimated payment", 870.78, "Loan Documentation Fee, estimated payment of $870.78"),
];
const KEPT = [
  row(80375, "Loan Documentation Fee", 75, "APR is 3.99%, which includes a $75.00 Loan Documentation Fee, estimated payment of $1,473.89, with a maximum LTV of 100%, and a minimum credit score of 775"),
  row(101785, "Skip-a-Payment Fee-if monthly loan payment", 35, "Skip-a-Payment Fee-if monthly loan payment is $350 or less | $35 each", "other_lending_fee", 5432),
  row(101786, "Skip-a-Payment Fee -if monthly loan payment is over $350", 55, "Skip-a-Payment Fee -if monthly loan payment is over $350 | $55 each", "other_lending_fee", 5432),
  row(20778, "Monthly Payment Late Fee (After 15 days)", 15, "Returned Mail ................................................... $2/each3 | Monthly Payment Late Fee (After 15 days) ............. $15", "late_payment", 6993),
  row(141417, "Quick Cash Prepaid Finance Charge", 25, "Quick Cash loans include a $25.00 Prepaid Finance Charge.", "other_lending_fee", 8019),
  row(141418, "Manufactured Home Loan Prepaid Finance Charge", 995, "Manufactured Home Loans include a $995 Prepaid Finance Charge.", "other_lending_fee", 8019),
  row(53579, "Cash Advance Fee (Finance Charge)", 5, "Cash Advance Fee (Finance Charge) ….….…. $5.00 or 3%", "cash_advance", 7614),
  row(142139, "Skip-A-Pay Fee o Loan payment of or more", 50, "• Skip-A-Pay Fee o Loan payment of $500.01 or more - $50.00", "other_lending_fee", 8581),
];

describe("Darwin's loan payment example re-check (#2854)", () => {
  it("is off unless the environment turns it on", () => {
    expect(process.env.DARWIN_LOAN_PAYMENT_EXAMPLE_TAKEDOWN_LIVE).not.toBe("true");
    expect(LOAN_PAYMENT_EXAMPLE_TAKEDOWN_LIVE).toBe(false);
  });

  it("finds exactly the four Pelican payments and keeps every real fee naming a payment", () => {
    const found = findLoanPaymentExamples([...KEPT, ...MOVERS]);
    expect(found.checked).toBe(12);
    expect(found.matches.map((fee) => fee.feePublishedId)).toEqual([141052, 141053, 141054, 141055]);
    expect(found.institutions).toBe(1);
    expect(found.matches[0].reason).toBe('loan_payment_example: $1473.89 follows "Documentation Fee, estimated payment of"');
  });

  it("keeps a price the line also prints as a fee", () => {
    expect(loanPaymentExampleMatch("Estimated payment of $35 | Skip-a-Payment Fee | $35", 35)).toBeNull();
    expect(loanPaymentExampleMatch("Estimated payment of $35.00", 35)).not.toBeNull();
  });

  it("each mover's price traces to the bank's text only as the sample loan's payment (shared check sample)", () => {
    for (const mover of MOVERS) {
      const amount = Number(mover.amount);
      // The shared check traces name and price to the text, so it does not refuse these: the price is
      // printed there. What the text prices is the sample loan's payment, which is why Darwin's re-check
      // and not the shared check takes them down.
      const shared = checkFeeAgainstSource(PELICAN, mover.fee_name ?? "", amount, ".", mover.canonical_fee_key);
      if (!shared.ok) throw new Error(`shared check refused ${mover.fee_published_id}: ${shared.reason}`);
      expect(shared.sourceLine).toMatch(/Loan Documentation Fee, estimated payment of \$/);
      const printed = PELICAN.split("\n").find((line) => line.includes(`$${amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}`));
      expect(printed).toMatch(/Sample \w+ loan is \$\d{2},000 for \d+ months/);
      expect(loanPaymentExampleMatch(shared.sourceLine, amount)).not.toBeNull();
    }
  });

  it("selects the movers' stored notes with the SQL prefilter", () => {
    const prefilter = new RegExp(LOAN_PAYMENT_EXAMPLE_PREFILTER.replace(/\\m/g, "\\b").replace(/\\M/g, "\\b"), "i");
    for (const mover of [...MOVERS, ...KEPT.slice(1, 3)]) expect(prefilter.test(mover.source_line ?? "")).toBe(true);
  });

  it("only reports with the switch off, and writes nothing in a dry run", async () => {
    const calls: string[] = [];
    const db = Object.assign(
      (strings: TemplateStringsArray) => {
        calls.push(strings.join("?"));
        return Promise.resolve(/SELECT fp.fee_published_id/.test(strings.join("?")) ? [...MOVERS, ...KEPT] : []);
      },
      { savepoint: undefined },
    );
    const fake = db as unknown as Parameters<typeof recheckLoanPaymentExamples>[0];
    const dry = await recheckLoanPaymentExamples(fake, { runId: 1, dryRun: true });
    expect(dry).toMatchObject({ matched: 4, live: false, takenDown: [] });
    expect(calls.some((text) => /UPDATE|INSERT/.test(text))).toBe(false);
    const off = await recheckLoanPaymentExamples(fake, { runId: 1, dryRun: false });
    expect(off.takenDown).toEqual([]);
    expect(calls.some((text) => /UPDATE published_fee_records/.test(text))).toBe(false);
    expect(loanPaymentExampleDetail(off)).toMatchObject({ check: "darwin.loan_payment_example", switch_live: false, matched: 4 });
  });
});

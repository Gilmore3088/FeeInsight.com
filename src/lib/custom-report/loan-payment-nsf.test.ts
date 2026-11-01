import { describe, expect, it } from "vitest";
import { LOAN_PAYMENT_NSF_NAME, LOAN_PAYMENT_NSF_NAME_SQL, loanPaymentNsfName } from "./loan-payment-nsf";
import { checkFeeCategory, LOAN_PAYMENT_NSF_REFILE_LIVE, loanPaymentNsfRefile, refileCategory } from "@/lib/fee-category-guard";

// Real names: Global FCU's live rows (67831, 67818) and Knox's NSF reads at other institutions (raw_fee_observations, Oct 30).
const BOUNCED_LOAN_PAYMENT = [
  "» NSF mortgage payment: Additional Cenlar charge",
  "From a Savings or Money Market Share or: » NSF mortgage payment: Additional Cenlar charge",
  "NSF Loan Payment",
  "NSF ACH Loan Payment",
  "NSF ACH Loan Payment Fee",
  "NSF for Automatic Loan Payment",
  "NSF Fee for any Loan Payment",
  "NSF Fee - Loan Payment",
  "NSF Loan Payment (per item)",
  "NSF Loan Payment, per item",
  "NSF Loan Payment / per item",
  "NSF Loan Payment, each item",
  "Non-Sufficient Funds (NSF) Loan Payment",
  "NSF - Loan Payment",
  "NSF Loan payment (each occurrence)",
  "MBFS NSF (Business Loan Payment)",
  "Non-Sufficient Funds Fee Loan Payment Reversal",
  "Reversal of NSF Check on Loan Payment",
];
// One price for the account's own items and a loan payment, or no loan payment at all: the account's NSF fee.
const ACCOUNT_NSF = [
  "NSF check/Loan Payment",
  "Non-Sufficient Fund (NSF) ACH, Loan Payment, Debit Card Transaction",
  "Nonsufficient Funds Loan Payment, Returned Check",
  "NSF Returns / Loan Payments (Per Presentment)",
  "NSF/Loan Payment",
  "NSF loan payments and other items",
  "NSF loan payment (per item, also checks and ACH)",
  "NSF (Non-Sufficient Funds) for the following: ACH Share Draft, Debit Card Overdraft, Loan Payment (each presentment)",
  "Non-sufficient funds/NSF (item returned unpaid)",
  "NSF Fee",
];

describe("loanPaymentNsfName", () => {
  it.each(BOUNCED_LOAN_PAYMENT)("reads %s as a bounced loan payment", (name) => {
    expect(loanPaymentNsfName(name)).toBe(true);
  });
  it.each(ACCOUNT_NSF)("leaves %s the account's NSF fee", (name) => {
    expect(loanPaymentNsfName(name)).toBe(false);
  });
  it("writes the Postgres mirror with ARE word boundaries only, and no construct an ARE lacks", () => {
    expect(LOAN_PAYMENT_NSF_NAME_SQL).not.toContain("\\b");
    expect(LOAN_PAYMENT_NSF_NAME_SQL).toContain("\\y");
    expect(LOAN_PAYMENT_NSF_NAME_SQL).not.toMatch(/\(\?<|\(\?</);
  });
  // Side by side: the Postgres text is the same pattern as the JavaScript one but for its word
  // boundary, so with \y read as \b it decides every case the same way. The same cases ran with
  // `~*` on prod (read-only, Oct 31) and Postgres agreed on each.
  const POSTGRES_AS_JS = new RegExp(LOAN_PAYMENT_NSF_NAME_SQL.replace(/\\y/g, "\\b"), "i");
  it.each([...BOUNCED_LOAN_PAYMENT.map((name) => [name, true] as const), ...ACCOUNT_NSF.map((name) => [name, false] as const)])(
    "JavaScript and the Postgres text agree on %s",
    (name, expected) => {
      expect(LOAN_PAYMENT_NSF_NAME.source).toBe(POSTGRES_AS_JS.source);
      expect(LOAN_PAYMENT_NSF_NAME.test(name)).toBe(expected);
      expect(POSTGRES_AS_JS.test(name)).toBe(expected);
    },
  );
});

describe("category guard: bounced loan payment filed as NSF", () => {
  const cenlar = "» NSF mortgage payment: Additional Cenlar charge";
  it("is off by default and reads nothing", () => {
    expect(LOAN_PAYMENT_NSF_REFILE_LIVE).toBe(false);
    expect(loanPaymentNsfRefile("nsf", cenlar)).toBeNull();
    expect(checkFeeCategory("nsf", cenlar).ok).toBe(true);
    expect(refileCategory("nsf", cenlar)).toBe("nsf");
  });
  it("on, fails NSF and re-files to other lending", () => {
    const verdict = checkFeeCategory("nsf", cenlar, undefined, { loanPaymentNsf: true });
    expect(verdict).toMatchObject({ ok: false, code: "name_contradicts" });
    expect(refileCategory("nsf", cenlar, null, { loanPaymentNsf: true })).toBe("other_lending_fee");
    // "NSF Loan Payment" already failed NSF on its "loan" word; on, it is no longer lost.
    expect(refileCategory("nsf", "NSF Loan Payment", null, { loanPaymentNsf: true })).toBe("other_lending_fee");
  });
  it("on, keeps a shared NSF price and other categories", () => {
    expect(checkFeeCategory("nsf", "Nonsufficient Funds Loan Payment, Returned Check", undefined, { loanPaymentNsf: true }).ok).toBe(false); // "loan" word, as before
    expect(refileCategory("nsf", "Nonsufficient Funds Loan Payment, Returned Check", null, { loanPaymentNsf: true })).toBe("nsf");
    expect(loanPaymentNsfRefile("overdraft", cenlar, true)).toBeNull();
    expect(checkFeeCategory("nsf", "Non-sufficient funds/NSF (item returned unpaid)", undefined, { loanPaymentNsf: true }).ok).toBe(true);
  });
});

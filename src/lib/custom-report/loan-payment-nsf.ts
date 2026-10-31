/**
 * A charge for a loan, mortgage or lease payment that came back for insufficient funds ("NSF Loan
 * Payment", "NSF mortgage payment") is the loan's own servicing fee, not the deposit account's NSF
 * fee. Pure, no imports, so Knox's category list, the category guard and the read-only dry run share
 * one definition.
 *
 * Global FCU (institution 5005, documents 1940 and 19930) prints, in a two-column fee schedule,
 *   "» NSF mortgage payment: Additional Cenlar charge ......... $25.00 per item"
 * Cenlar is the credit union's mortgage subservicer: the $25 is what the servicer adds when a
 * mortgage payment bounces. Knox filed the line as NSF by its "NSF" word, and the NSF category guard
 * let it through because its exclusion list names "loan" but not "mortgage", so it went live twice
 * as the credit union's NSF fee (67831, 67818). Knox filed 30 such reads at 16 institutions as NSF
 * (read-only, Oct 30); at the other 15 the name said "loan", which the NSF guard refuses, so none went
 * live as NSF, and none was filed as the loan's fee either.
 *
 * Only a name whose NSF words price the loan payment itself moves: the NSF words, then at most a fee
 * word, a "(NSF)" gloss, a connector ("-", ":", "for", "on") and a qualifier ("automatic", "ACH",
 * "business", "returned", "check on"), then the loan, mortgage or lease payment. One price for the
 * account's own items and a loan payment ("NSF check/Loan Payment", "Non-Sufficient Fund (NSF) ACH,
 * Loan Payment, Debit Card Transaction", "Nonsufficient Funds Loan Payment, Returned Check") stays
 * the account's NSF fee.
 *
 * Written once with `B` for a word boundary: `\b` in JavaScript, `\y` in a Postgres ARE (so the
 * pattern holds no other capital B). The cases in `loan-payment-nsf.test.ts` run against both forms:
 * the JavaScript one there, the Postgres one with `~*` on prod (read-only, Oct 31, all agree).
 */
const NSF_WORDS = String.raw`(?:nsf|non[- ]?sufficient[- ]funds?|insufficient[- ]funds?)`;
const QUALIFIER = String.raw`(?:(?:any|an?|the|automatic|auto|ach|business|returned|(?:checks?|items?)\s+on)\s+)`;
/**
 * A deposit item listed beside the loan payment: one price for both, so the account's NSF fee. After
 * a connector, at most one word before the item ("NSF loan payments and other items"); in a bracket
 * after the payment, any deposit item but a bare "item", which is a unit ("NSF loan payment (per
 * item, also checks and ACH)" stays NSF, "NSF Loan Payment (per item)" moves).
 */
const DEPOSIT_ITEM = String.raw`(?:checks?|ach|debits?|drafts?|items?|shares?|share drafts?)`;
const DEPOSIT_ITEM_BESIDE = String.raw`(?:\s*(?:,|/|&|BorB|BandB)\s*(?:(?!(?:per|each|a)B)\w+\s+)?(?:returned\s+)?${DEPOSIT_ITEM}B|\s*\([^)]*B(?:checks?|ach|debits?|drafts?|shares?|share drafts?)B)`;
const PATTERN = String.raw`B${NSF_WORDS}(?:\s*\(\s*nsf\s*\))?(?:\s+(?:fee|charge)s?)?(?:\s*(?:[-–:(]|BforB|BonB)\s*|\s+)${QUALIFIER}*(?:loan|mortgage|lease)s?\s+payments?B(?!${DEPOSIT_ITEM_BESIDE})`;

/** The JavaScript pattern: an NSF name that prices a loan, mortgage or lease payment. */
export const LOAN_PAYMENT_NSF_NAME = new RegExp(PATTERN.replace(/B/g, String.raw`\b`), "i");

/** The Postgres ARE mirror of `LOAN_PAYMENT_NSF_NAME`, for `~*` in the read-only dry run. */
export const LOAN_PAYMENT_NSF_NAME_SQL = PATTERN.replace(/B/g, String.raw`\y`);

/** Where such a fee is filed. */
export const LOAN_PAYMENT_NSF_TARGET = "other_lending_fee";

/** True when the name prices a bounced loan, mortgage or lease payment (see the module note). */
export function loanPaymentNsfName(name: string | null | undefined): boolean {
  return !!name && LOAN_PAYMENT_NSF_NAME.test(name.replace(/[‘’ʼ`]/g, "'"));
}

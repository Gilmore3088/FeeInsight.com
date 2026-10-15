import type { NonDepositDocumentKind } from "./non-deposit-document";

/**
 * Document addresses and what `nonDepositDocumentKind` must say about each (#1442). The test runs
 * them through the JS classifier; the same list was run through `nonDepositKindSql` on a local
 * Postgres 16 for parity. Hosts are invented except where the issue names the page's bank.
 */
export const NON_DEPOSIT_URL_FIXTURES: Array<{ url: string; kind: NonDepositDocumentKind | null; why: string }> = [
  // Loan, card, mortgage, HELOC and rate pages.
  { url: "https://www.bankofgreene.com/current-rates/", kind: "loan", why: "the issue's rate page (Appraisal $400)" },
  { url: "https://www.example-cu.org/loans/auto-loans", kind: "loan", why: "loan product page" },
  { url: "https://www.example-cu.org/rates/loan-rates", kind: "loan", why: "loan rates page" },
  { url: "https://www.example.com/borrow/mortgage/", kind: "loan", why: "mortgage section" },
  { url: "https://www.example.com/personal/home-equity-line-of-credit", kind: "loan", why: "HELOC page" },
  { url: "https://www.example.com/heloc", kind: "loan", why: "HELOC page" },
  { url: "https://www.example.com/docs/Credit-Card-Agreement-2024.pdf", kind: "loan", why: "card agreement, trailing year" },
  { url: "https://www.example.com/docs/CreditCardAgreement.pdf", kind: "loan", why: "camelCase card agreement" },
  { url: "https://www.example.com/disclosures/visa-platinum-credit-card-agreement", kind: "loan", why: "card agreement with its brand words" },
  { url: "https://www.example.com/personal/debit-cards", kind: null, why: "a debit card page is a deposit page" },
  { url: "https://www.example.com/wp-content/uploads/2023/05/Loan-Fee-Schedule.pdf", kind: "loan", why: "a loan fee schedule" },
  { url: "https://www.example.com/rate-sheet.pdf", kind: "loan", why: "rate sheet" },
  { url: "https://www.example.com/Personal/Fees%20and%20Rates/Consumer-Loan-Rate-Sheet_Jan2025.pdf", kind: "loan", why: "loan rate sheet, escapes and a dated suffix" },
  { url: "https://www.example.com/sites/default/files/2024-03/HELOC_Disclosure_Rev3.pdf", kind: "loan", why: "HELOC disclosure, revision suffix" },
  { url: "https://www.example.com/personal/loans/personal-lines-of-credit/", kind: "loan", why: "line of credit" },
  { url: "https://www.example.com/personal/borrowing/todays-rates?type=mortgage", kind: "loan", why: "today's rates, query ignored" },
  { url: "https://www.example.com/loans-and-credit-cards", kind: "loan", why: "loans and credit cards" },
  // Brokerage, wealth and investment pages.
  { url: "https://www.northerntrust.com/united-states/what-we-do/wealth-management/fee-schedule", kind: "brokerage", why: "wealth fee schedule" },
  { url: "https://www.usbank.com/investing/self-directed-investing/pricing.html", kind: "brokerage", why: "self-directed investing pricing" },
  { url: "https://www.example.com/personal/trust-and-investment-services/", kind: "brokerage", why: "trust and investment" },
  { url: "https://www.example.com/investments/brokerage-fee-schedule.pdf", kind: "brokerage", why: "brokerage fee schedule" },
  { url: "https://www.example.com/private-wealth/advisory-fees", kind: "brokerage", why: "private wealth" },
  { url: "https://wealth.example.com/fees", kind: "brokerage", why: "wealth host" },
  // Deposit schedules: never matched, whatever else the address says.
  { url: "https://www.example.com/fees/loan-payment-fee", kind: null, why: "a fee named after a loan payment" },
  { url: "https://www.example.com/personal/Schedule-of-Fees-Personal-Checking.pdf", kind: null, why: "personal checking schedule" },
  { url: "https://www.example.com/personal/documents/schedule-of-fees-checking-and-savings-2025.pdf", kind: null, why: "checking and savings schedule" },
  { url: "https://www.example.com/personal/checking/fees", kind: null, why: "checking fees page" },
  { url: "https://www.example.com/loans/fee-schedule.pdf", kind: null, why: "the one schedule filed under loans" },
  { url: "https://www.example.com/rates-and-loans/schedule-of-fees", kind: null, why: "schedule under a rates and loans section" },
  { url: "https://www.mspecu.org/rates.php?e=1100", kind: null, why: "a fee schedule served from rates.php" },
  { url: "https://www.spojniacreditunion.org/rates/fee-schedule/", kind: null, why: "fee schedule under /rates/" },
  { url: "https://www.example.com/rates/deposit-rates", kind: null, why: "deposit rates" },
  { url: "https://www.example.com/rates/loan-and-deposit-rates", kind: null, why: "a deposit word wins" },
  { url: "https://www.example.com/disclosures/truth-in-savings.pdf", kind: null, why: "truth in savings" },
  { url: "https://www.example.com/wealth/overdraft-services", kind: null, why: "an overdraft page under any section" },
  { url: "https://www.example.com/fee-schedule", kind: null, why: "plain fee schedule" },
  { url: "https://www.example.com/about/investor-relations", kind: null, why: "investor relations names no brokerage page" },
  { url: "https://www.example.com/learn/whats-a-heloc", kind: null, why: "an article about HELOCs is not named as one" },
  { url: "https://www.example.com/", kind: null, why: "homepage" },
  { url: "", kind: null, why: "no address" },
  // Business documents: out of scope, kept in the catalog on purpose.
  { url: "https://www.example.com/business/loans/rates", kind: null, why: "business loans" },
  { url: "https://www.example.com/business/wealth-management", kind: null, why: "business wealth" },
  { url: "https://www.example.com/business/business-fee-schedule.pdf", kind: null, why: "business schedule" },
  { url: "https://www.example.com/commercial-lending/", kind: null, why: "commercial lending" },
  { url: "https://www.example.com/BusinessBanking/loans", kind: null, why: "camelCase business section" },
];

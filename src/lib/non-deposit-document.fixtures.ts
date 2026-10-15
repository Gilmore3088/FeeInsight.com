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
  // Review of c93910cc (#1442): combined rate-and-fee pages, debit cardholder agreements, deposit
  // products named with investment words.
  { url: "https://www.example.com/uploads/current-rates-fee-schedule.pdf", kind: null, why: "one Rates & Fee Schedule PDF" },
  { url: "https://www.example.com/Rate-Sheet-Fee-Schedule.pdf", kind: null, why: "rate sheet and fee schedule" },
  { url: "https://www.example.com/investments-and-fees", kind: null, why: "a combined investments and fees page" },
  { url: "https://www.example.com/cardholder", kind: null, why: "bare cardholder page" },
  { url: "https://www.example.com/cardholder-agreement.pdf", kind: null, why: "often the debit card agreement" },
  { url: "https://www.example.com/forms/cardholder-agreement", kind: null, why: "often the debit card agreement" },
  { url: "https://www.example.com/credit-card-cardholder-agreement.pdf", kind: "loan", why: "credit card cardholder agreement" },
  { url: "https://www.example.com/personal/investments/ira-fee-schedule", kind: null, why: "an IRA is a deposit product" },
  { url: "https://www.example.com/personal/checking-savings-and-investments-fee-schedule.pdf", kind: null, why: "deposit words win" },
  { url: "https://www.example.com/wp-content/uploads/Investment-and-Deposit-Fee-Schedule.pdf", kind: null, why: "deposit word wins" },
  { url: "https://www.example.com/hsa-investments-fees", kind: null, why: "an HSA is a deposit account" },
  { url: "https://www.example.com/wealth-and-investment-management", kind: "brokerage", why: "wealth and investment management" },
  // Prod read-only check of c93910cc (Oct 15): false positives now null.
  { url: "https://www.amegybank.com/content/dam/amegy/rate-sheets/scheduleoffeesconsut.pdf", kind: null, why: "run-together schedule of fees under rate sheets" },
  { url: "https://www.cu1.org/spend-save/investing/hsa", kind: null, why: "an HSA page under investing" },
  // Prod: rate pages that host a credit union's whole schedule stay "loan" by address; the takedown
  // takes only their lending-category fees (darwin/non-deposit-document-check.ts).
  { url: "https://www.siouxlandfederalcu.org/current-rates", kind: "loan", why: "rate page; only lending fees come down" },
  { url: "https://www.bcscu.com/loan-rates", kind: "loan", why: "loan rates page; only lending fees come down" },
  { url: "https://www.hapo.org/loans/loan-rates", kind: "loan", why: "loan rates page; only lending fees come down" },
  // Prod misses, now loan triggers even when the segment ends in fees or schedule.
  { url: "https://www.bscu.org/wp-content/uploads/Credit-Card-Line-of-Agreement.pdf", kind: "loan", why: "credit card agreement" },
  { url: "https://www.healthcarefcu.org/docs/Credit_Card_Disclosure1.pdf", kind: "loan", why: "credit card disclosure, digit suffix" },
  { url: "https://www.trumark.org/docs/Visa-Credit-Card-Rates-and-Fees-Only.pdf", kind: "loan", why: "credit card rates and fees" },
  { url: "https://www.kitfcu.org/docs/Credit-Card-Solicitation-disclosure.pdf", kind: "loan", why: "credit card solicitation disclosure" },
  { url: "https://www.argentcu.org/docs/Argent-Credit-Card-Fees-and-Terms.pdf", kind: "loan", why: "credit card fees and terms" },
  { url: "https://www.university-bank.com/docs/VISA-Credit-Card-Agreement.pdf", kind: "loan", why: "credit card agreement" },
  { url: "https://www.easternsavingsbank.com/docs/Consumer-Mortgage-Servicing-Fee-Schedule.pdf", kind: "loan", why: "mortgage servicing fee schedule" },
  { url: "https://www.yourgcu.com/docs/Fee-ScheduleLoans.pdf", kind: "loan", why: "fee schedule for loans, run together" },
  { url: "https://www.tiogabank.com/docs/Mortgage-Loan-Servicing-Fees.pdf", kind: "loan", why: "mortgage loan servicing fees" },
  { url: "https://www.greatmidwestbank.com/docs/Loan-Servicing-Fees.pdf", kind: "loan", why: "loan servicing fees" },
  { url: "https://www.northcountrysavings.com/docs/sch%20of%20Loan%20Fees.pdf", kind: "loan", why: "schedule of loan fees" },
  { url: "https://www.mayvillesavings.com/docs/loanfeeschedule.pdf", kind: "loan", why: "loan fee schedule, run together" },
  { url: "https://www.beaconbank.com/docs/consumer-loan-servicing-fee-schedule.pdf", kind: "loan", why: "consumer loan servicing fee schedule" },
  { url: "https://www.example.com/docs/consumer-loans-and-deposit-fees.pdf", kind: null, why: "a deposit word wins" },
  // Business documents: out of scope, kept in the catalog on purpose.
  { url: "https://www.example.com/business/loans/rates", kind: null, why: "business loans" },
  { url: "https://www.example.com/business/wealth-management", kind: null, why: "business wealth" },
  { url: "https://www.example.com/business/business-fee-schedule.pdf", kind: null, why: "business schedule" },
  { url: "https://www.example.com/commercial-lending/", kind: null, why: "commercial lending" },
  { url: "https://www.example.com/BusinessBanking/loans", kind: null, why: "camelCase business section" },
];

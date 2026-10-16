import type { NonDepositVerdict } from "./non-deposit-document-check";

/**
 * Live fees on (or off) non-deposit documents and the verdict Darwin's re-check must give each
 * (#1442, #1518). The test runs them through `findNonDepositFees`; the same rows were run through
 * `nonDepositFeeVerdictsSql` on a local Postgres 16 (UTF8) for parity. `verdict: null` means the
 * document is not a brokerage or loan document, so the fee is not on a matched document at all.
 *
 * Names, amounts and categories are the issue's where it gives them. Document addresses are the
 * issue's or v1's fixtures where known (U.S. Bank investing pricing, yourgcu `Fee-ScheduleLoans`,
 * Beacon Bank's consumer loan servicing schedule, Siouxland's `/current-rates`, Bank of Greene's
 * `/current-rates/`); the ibewfcu and towerfcu addresses, the other U.S. Bank brokerage addresses,
 * the overnight check's category and the subordination fee's exact name are stand-ins.
 */
export const NON_DEPOSIT_FEE_FIXTURES: Array<{
  name: string;
  amount: number;
  key: string;
  url: string;
  verdict: NonDepositVerdict | null;
  why: string;
}> = [
  // #1518: U.S. Bank brokerage pages, deposit categories (docs 3886, 34203, 6158, 23632).
  { name: "Wire", amount: 30, key: "wire_domestic_outgoing", url: "https://www.usbank.com/investing/self-directed-investing/pricing.html", verdict: "brokerage_document", why: "doc 3886 wire" },
  { name: "Research", amount: 20, key: "account_research", url: "https://www.usbank.com/investing/self-directed-investing/pricing.html", verdict: "brokerage_document", why: "doc 3886 Research" },
  { name: "Account transfer / IRA closeout", amount: 100, key: "ira_termination", url: "https://www.usbank.com/investing/self-directed-investing/pricing.html", verdict: "brokerage_document", why: "doc 3886 IRA closeout" },
  { name: "Returned check", amount: 30, key: "nsf", url: "https://www.usbank.com/investing/brokerage-account-fees.html", verdict: "brokerage_document", why: "doc 34203 returned check" },
  { name: "Stop payment", amount: 25, key: "stop_payment", url: "https://www.usbank.com/investing/brokerage-account-fees.html", verdict: "brokerage_document", why: "doc 34203 stop payment" },
  { name: "Overnight check", amount: 15, key: "other", url: "https://www.usbank.com/wealth-management/brokerage-fee-schedule.pdf", verdict: "brokerage_document", why: "doc 6158 overnight check" },
  { name: "Annual account / IRA fee", amount: 60, key: "ira_administration", url: "https://www.usbank.com/investing/self-directed-brokerage-pricing.pdf", verdict: "brokerage_document", why: "doc 23632 annual IRA fee" },
  { name: "Margin Loan Late Fee", amount: 15, key: "late_payment", url: "https://www.usbank.com/investing/self-directed-investing/pricing.html", verdict: "lending_category", why: "a lending category on a brokerage page (v1)" },
  // #1518: lending wording under deposit keys on loan pages.
  { name: "Mortgage processing and research fee", amount: 75, key: "account_research", url: "https://www.yourgcu.com/docs/Fee-ScheduleLoans.pdf", verdict: "lending_wording_on_loan_document", why: "yourgcu mortgage processing" },
  { name: "Late Payment — Return Check", amount: 15, key: "nsf", url: "https://www.ibewfcu.org/loans/loan-fees", verdict: "lending_wording_on_loan_document", why: "ibewfcu late payment, em dash" },
  { name: "Cash Advance ATM", amount: 0.75, key: "atm_non_network", url: "https://www.towerfcu.org/docs/Visa-Credit-Card-Agreement.pdf", verdict: "lending_wording_on_loan_document", why: "towerfcu cash advance ATM" },
  { name: "Subordination Fee", amount: 250, key: "legal_process", url: "https://www.beaconbank.com/docs/consumer-loan-servicing-fee-schedule.pdf", verdict: "lending_wording_on_loan_document", why: "beaconbank subordination" },
  { name: "Payoff Statement", amount: 20, key: "account_research", url: "https://www.beaconbank.com/docs/consumer-loan-servicing-fee-schedule.pdf", verdict: "lending_wording_on_loan_document", why: "payoff" },
  { name: "Escrow Waiver", amount: 50, key: "other", url: "https://www.tiogabank.com/docs/Mortgage-Loan-Servicing-Fees.pdf", verdict: "lending_wording_on_loan_document", why: "escrow" },
  { name: "Loan Modification", amount: 150, key: "other", url: "https://www.greatmidwestbank.com/docs/Loan-Servicing-Fees.pdf", verdict: "lending_wording_on_loan_document", why: "loan modification" },
  { name: "Cash Advance", amount: 3, key: "other", url: "https://www.bankofgreene.com/current-rates/", verdict: "lending_wording_on_loan_document", why: "cash advance on a rate page" },
  // Traps: deposit-side fees on loan pages stay live.
  { name: "Loan Payment by Phone", amount: 5, key: "other", url: "https://www.greatmidwestbank.com/docs/Loan-Servicing-Fees.pdf", verdict: "kept_deposit_category", why: "a bare loan is not lending wording" },
  { name: "Transfer to pay a loan", amount: 2, key: "other", url: "https://www.greatmidwestbank.com/docs/Loan-Servicing-Fees.pdf", verdict: "kept_deposit_category", why: "a transfer to pay a loan" },
  { name: "Mortgage Payment by Phone", amount: 10, key: "other", url: "https://www.tiogabank.com/docs/Mortgage-Loan-Servicing-Fees.pdf", verdict: "kept_deposit_category", why: "by phone keeps it" },
  { name: "Loan Coupon Book", amount: 5, key: "other", url: "https://www.greatmidwestbank.com/docs/Loan-Servicing-Fees.pdf", verdict: "kept_deposit_category", why: "a bare loan" },
  { name: "Skip-a-Pay", amount: 25, key: "other", url: "https://www.greatmidwestbank.com/docs/Loan-Servicing-Fees.pdf", verdict: "kept_deposit_category", why: "not on the allowlist" },
  { name: "Stop Payment", amount: 30, key: "stop_payment", url: "https://www.bankofgreene.com/current-rates/", verdict: "kept_deposit_category", why: "deposit fee on a rate page (v1)" },
  { name: "Safe Deposit Box Late Payment", amount: 10, key: "safe_deposit_box", url: "https://www.siouxlandfederalcu.org/current-rates", verdict: "kept_deposit_category", why: "safe deposit wording keeps it" },
  { name: "Mortgage Payment Transfer from Checking", amount: 3, key: "other", url: "https://www.ibewfcu.org/loans/loan-fees", verdict: "kept_deposit_category", why: "checking and transfer keep it" },
  { name: "Mortgages", amount: 1, key: "other", url: "https://www.example.com/business/loans/rates", verdict: null, why: "business documents are out of scope" },
  // #1518: Siouxland doc 25773, "Late Fee" $5 (late_payment) among the safe deposit box lines.
  { name: "Late Fee", amount: 5, key: "late_payment", url: "https://www.siouxlandfederalcu.org/current-rates", verdict: "kept_generic_on_rate_page", why: "Siouxland safe deposit late fee on a rate page" },
  { name: "Drilling", amount: 150, key: "safe_deposit_box", url: "https://www.siouxlandfederalcu.org/current-rates", verdict: "kept_deposit_category", why: "Siouxland safe deposit line" },
  { name: "Late Charge", amount: 10, key: "late_payment", url: "https://www.example.com/rate-sheet.pdf", verdict: "kept_generic_on_rate_page", why: "a generic late charge on a rate sheet" },
  // v1 behaviour kept: lending categories on loan product pages and lending wording on rate pages.
  { name: "Appraisal", amount: 400, key: "appraisal_fee", url: "https://www.bankofgreene.com/current-rates/", verdict: "lending_category", why: "Bank of Greene appraisal, wording on a rate page" },
  { name: "Late Fee", amount: 25, key: "late_payment", url: "https://www.greatmidwestbank.com/docs/Loan-Servicing-Fees.pdf", verdict: "lending_category", why: "a late fee on a loan servicing schedule" },
  { name: "Late Fee", amount: 15, key: "late_payment", url: "https://www.example-cu.org/rates/loan-rates", verdict: "lending_category", why: "a loan rates page is a loan product page" },
  { name: "Document Prep", amount: 50, key: "loan_origination", url: "https://www.example.com/heloc", verdict: "lending_category", why: "lending category on a HELOC page" },
  // Prod dry run of v2 (#1518): loan fees on rate pages that the rate-page rule kept by mistake
  // (Independent Bank's address is a stand-in; the categories are lending ones, as the verdict was).
  { name: "Standard processing fee", amount: 175, key: "loan_origination", url: "https://www.independentbank.com/current-rates", verdict: "lending_category", why: "fee 86621, processing on a rate page" },
  { name: "Application fee", amount: 100, key: "loan_origination", url: "https://www.bankofgreene.com/current-rates/", verdict: "lending_category", why: "fees 88671 and 88676, application on a rate page" },
  { name: "Credit Report fee", amount: 113.2, key: "other_lending_fee", url: "https://www.bankofgreene.com/current-rates/", verdict: "lending_category", why: "fees 88674, 88677, 88682 and 88683, credit report on a rate page" },
  { name: "Application fee", amount: 25, key: "other", url: "https://www.bankofgreene.com/current-rates/", verdict: "kept_deposit_category", why: "the rate-page extras never act on a deposit category" },
  // Review of v2 (B1): deposit fees the allowlist must not take down from a loan page.
  { name: "ACH Origination", amount: 25, key: "other", url: "https://www.greatmidwestbank.com/docs/Loan-Servicing-Fees.pdf", verdict: "kept_deposit_category", why: "ACH origination is a deposit service" },
  { name: "Wire origination", amount: 30, key: "wire_domestic_outgoing", url: "https://www.greatmidwestbank.com/docs/Loan-Servicing-Fees.pdf", verdict: "kept_deposit_category", why: "wire origination" },
  { name: "Share certificate early payoff", amount: 25, key: "early_closure", url: "https://www.example.com/heloc", verdict: "kept_deposit_category", why: "a certificate's early payoff" },
  { name: "Early payoff of certificate", amount: 25, key: "early_closure", url: "https://www.example.com/heloc", verdict: "kept_deposit_category", why: "a certificate's early payoff" },
  { name: "Early payoff of CD", amount: 25, key: "early_closure", url: "https://www.example.com/heloc", verdict: "kept_deposit_category", why: "a CD's early payoff" },
  { name: "Box rent late payment", amount: 10, key: "safe_deposit_box", url: "https://www.siouxlandfederalcu.org/current-rates", verdict: "kept_deposit_category", why: "safe deposit box rent" },
  { name: "SDB Late Payment", amount: 10, key: "safe_deposit_box", url: "https://www.siouxlandfederalcu.org/current-rates", verdict: "kept_deposit_category", why: "SDB" },
  { name: "Late payment - box rent", amount: 10, key: "safe_deposit_box", url: "https://www.siouxlandfederalcu.org/current-rates", verdict: "kept_deposit_category", why: "box rent" },
  { name: "Debit Card Cash Advance", amount: 5, key: "other", url: "https://www.towerfcu.org/docs/Visa-Credit-Card-Agreement.pdf", verdict: "kept_deposit_category", why: "a debit card cash advance" },
  { name: "Visa debit cash advance", amount: 5, key: "other", url: "https://www.towerfcu.org/docs/Visa-Credit-Card-Agreement.pdf", verdict: "kept_deposit_category", why: "a debit card cash advance" },
  { name: "Club account late payment", amount: 5, key: "other", url: "https://www.ibewfcu.org/loans/loan-fees", verdict: "kept_deposit_category", why: "a club account" },
  { name: "Coin appraisal", amount: 10, key: "other", url: "https://www.ibewfcu.org/loans/loan-fees", verdict: "kept_deposit_category", why: "coin" },
  { name: "Mortgage payment at teller", amount: 5, key: "other", url: "https://www.tiogabank.com/docs/Mortgage-Loan-Servicing-Fees.pdf", verdict: "kept_deposit_category", why: "a payment-channel fee" },
  { name: "Mortgage payment (ACH)", amount: 5, key: "other", url: "https://www.tiogabank.com/docs/Mortgage-Loan-Servicing-Fees.pdf", verdict: "kept_deposit_category", why: "a payment-channel fee" },
  // Review of v2: lending wording that still comes down.
  { name: "Mortgage Processing and Research", amount: 75, key: "account_research", url: "https://www.yourgcu.com/docs/Fee-ScheduleLoans.pdf", verdict: "lending_wording_on_loan_document", why: "prod takedown kept" },
  { name: "Escrow account maintenance", amount: 10, key: "other", url: "https://www.tiogabank.com/docs/Mortgage-Loan-Servicing-Fees.pdf", verdict: "lending_wording_on_loan_document", why: "escrow stays lending" },
  { name: "Loan origination fee", amount: 100, key: "other", url: "https://www.greatmidwestbank.com/docs/Loan-Servicing-Fees.pdf", verdict: "lending_wording_on_loan_document", why: "loan origination" },
  // Deposit documents: never matched.
  { name: "Mortgage Payment", amount: 5, key: "other", url: "https://www.example.com/personal/Schedule-of-Fees-Personal-Checking.pdf", verdict: null, why: "a deposit schedule" },
  { name: "Late Payment", amount: 5, key: "late_payment", url: "https://www.example.com/fee-schedule", verdict: null, why: "a plain fee schedule" },
];

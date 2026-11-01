import type { DocumentOpeningKind, NonDepositDocumentKind } from "./non-deposit-document";

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
  // Prepaid, payroll, gift and travel card programs (#1908): the card's own page, whatever section it sits in.
  { url: "https://www.schoolsfirstfcu.org/disclosures/payroll-card-statement-of-fees-disclosure/", kind: "card_program", why: "the issue's payroll card disclosure" },
  { url: "https://www.acadiafcu.org/checking/cards/prepaid-travel-card/", kind: "card_program", why: "a prepaid card under a checking section" },
  { url: "https://www.coopcu.com/checking-and-savings/ccu-cards/gift-and-travel-cards", kind: "card_program", why: "gift and travel cards under checking and savings" },
  { url: "https://www.example-cu.org/getmedia/11-17-PrePaidVISA-FeeSchedule.pdf", kind: "card_program", why: "camelCase prepaid fee schedule" },
  { url: "https://www.example-cu.org/pdf/Gift_Card_Terms_and_Conditions_0811a.pdf", kind: "card_program", why: "gift card terms, trailing revision" },
  { url: "https://www.example.com/services/debit-gift-cards/", kind: "card_program", why: "a debit-network gift card" },
  { url: "https://www.example-cu.org/Documents/Disclosures/TravelMoney-Card-Agreement.aspx", kind: "card_program", why: "a CO-OP TravelMoney prepaid card agreement" },
  { url: "https://www.example-cu.org/wp-content/uploads/2025/12/cardholder_agreement_travelmoney_english.pdf", kind: "card_program", why: "TravelMoney run together" },
  { url: "https://www.example-cu.org/accounts/checking/central-plus-checking/travel-leisure-discounts/", kind: null, why: "a checking perk page, not a card" },
  { url: "https://www.example.com/prepaid-checking-account/", kind: null, why: "a deposit word in the same segment keeps it a deposit page" },
  { url: "https://www.example.com/gift-cards/fee-schedule-checking.pdf", kind: null, why: "only the last segment names a card program" },
  { url: "https://www.example.com/business/payroll-cards/", kind: null, why: "business documents stay out of scope" },
  { url: "https://www.example.com/fees/prepaid-finance-charge", kind: null, why: "a loan's prepaid finance charge is not a card" },
  { url: "https://www.example.com/prepayment-penalty/", kind: null, why: "prepayment is not prepaid" },
  // Review of #1914: a card program never overrides a loan or brokerage verdict, and a general schedule that mentions a card stays.
  { url: "https://www.example.com/credit-cards/prepaid-card/", kind: "loan", why: "under a credit card section it stays a loan page" },
  { url: "https://www.example.com/credit-cards/visa-signature-travel-card/", kind: "loan", why: "a travel-rewards credit card" },
  { url: "https://www.example.com/loans/credit-cards/gift-cards/", kind: "loan", why: "loan section wins" },
  { url: "https://www.example.com/mortgage/prepaid-items.pdf", kind: "loan", why: "a mortgage's prepaid items" },
  { url: "https://www.example.com/wealth-management/prepaid-card-fees.pdf", kind: "brokerage", why: "brokerage section wins" },
  { url: "https://www.example.com/credit-cards/pay-card-bill/", kind: "loan", why: "a bare pay card is not a card program" },
  { url: "https://www.example.com/docs/fee-schedule-including-gift-cards.pdf", kind: null, why: "a general schedule that mentions gift cards" },
  { url: "https://www.example.com/personal/fees-and-gift-cards/", kind: null, why: "fee words before the card" },
  { url: "https://www.example.com/docs/membership-fee-schedule-prepaid.pdf", kind: null, why: "a membership schedule" },
  { url: "https://www.example.com/docs/prepaid-items.pdf", kind: null, why: "prepaid items outside a loan section" },
];

/**
 * Document openings and what `documentOpeningKind` must say about each (#1944). The loan and youth
 * openings are the first lines of live documents' stored texts (prod, read-only, Oct 25); the
 * near-misses are the general schedules and pages the rule must leave alone, most of them live too.
 * The test runs them through the JS rule; the same list was run through `documentOpeningKindSql`
 * on prod (a read-only VALUES query, Oct 25) for parity.
 */
export const OPENING_FIXTURES: Array<{ text: string; kind: DocumentOpeningKind | null; why: string }> = [
  // The issue's documents.
  { text: "TD Fit Personal Unsecured Consumer Loan Disclosure\nAn ideal option if you are looking to consolidate high interest credit card debt, take a vacation, or make\nhome improvements.", kind: "loan", why: "TD Fit loan disclosure, doc 33822" },
  { text: "ACCOUNT-SPECIFIC DISCLOSURES\nThe following additional disclosures apply to the Volt Teen Banking & Volt Banking accounts:\nVOLT BANKING SAVINGS", kind: "youth_account", why: "Arbor Financial's Volt addendum, doc 2241" },
  // Other live documents of the class.
  { text: "Youth Member Fee Schedule (ages 13-17) (effective 04/01/2026) All fees are subject to change\nDeposit Accounts | Fee Details/services\nACH/Check NSF | $12.00 per item", kind: "youth_account", why: "a youth fee schedule, doc 33234" },
  { text: "Members Preferred Credit Union\nIMPORTANT CREDIT CARD DISCLOSURES\nThe following disclosure represents important details concerning your credit card.", kind: "loan", why: "card disclosure on line 2, doc 20814" },
  { text: "VISA® CREDIT CARD\nAGREEMENT AND DISCLOSURE STATEMENT\nIn this VISA CREDIT CARD AGREEMENT AND DISCLOSURE STATEMENT, the words YOU, YOUR and YOURS mean each", kind: "loan", why: "a title over two lines, doc 35339" },
  { text: "*00000000000000000000000101202200000000000*\nHOME EQUITY LINE OF CREDIT APPLICATION DISCLOSURE\nLea County State Bank", kind: "loan", why: "HELOC application disclosure, doc 35285" },
  { text: "CREDIT CARD LINE OF CREDIT AGREEMENT AND DISCLOSURE STATEMENT\nThe purpose of this Agreement is to establish the terms and conditions of a Credit Card Line of", kind: "loan", why: "card line of credit agreement, doc 2222" },
  { text: "Student Loan Disclosure\nRepayment terms", kind: "loan", why: "loan is asked before youth" },
  { text: "  \n\nTeen Checking Addendum\nThe fees below apply to Teen Checking.", kind: "youth_account", why: "leading blank lines are skipped" },
  // Near-misses: general schedules, menus and passing mentions.
  { text: "FEE SCHEDULE\nThis disclosure contains information about terms, fees, and interest rates for some of the accounts we offer.\nThe following fees apply to Regular Checking, Club Checking, Student Checking (Regular checking account with no monthly flat service", kind: null, why: "a general schedule listing a student account among others, doc 36205" },
  { text: "Consumer Fee Schedule\nMonthly service charge fee does not apply to Youth Savings accounts\nOverdraft | $30", kind: null, why: "a negated youth mention" },
  { text: "MEMBER ACCOUNTS TRUTH-IN-SAVINGS DISCLOSURES Except as specifically described, the following\ndisclosures apply to all accounts: 1. Rate Information.", kind: null, why: "disclosures that apply to all accounts, doc 3615" },
  { text: "Hoyas Bank Here.\nGeorgetown University Alumni and Student Federal Credit Union\nTruth in Savings Disclosure and Fee Schedule", kind: null, why: "a credit union named for students, doc 24481" },
  { text: "OVERDRAFT LINE OF CREDIT AGREEMENT\nPolish-American Federal Credit Union 2889 East Maple Road Troy, MI 48083", kind: null, why: "an overdraft line of credit is the deposit side's, doc 31819" },
  { text: "Platinum Rewards\nBusiness Visa Credit Card Agreement\nEffective 2/1/2011", kind: null, why: "a business card agreement stays out of scope, doc 2035" },
  { text: "Become a Member\nLoan Application\nOnline Banking", kind: null, why: "a menu's loan application link, doc 39364" },
  { text: "Fee Schedule\nEffective as of 4/1/2026 | VISA CREDIT CARDS\nSavings | $5", kind: null, why: "a general schedule with a card section, doc 17160" },
  { text: "SCHEDULE OF FEES AND CHARGES\nGENERAL ACCOUNT FEES | LOAN ACCOUNT FEES", kind: null, why: "a general schedule with a loan section, doc 16925" },
  { text: "Supplemental Terms and Conditions for LCCU Visa Debit, Cash,\nYouth Debit, Tita Debit and HSA Cards (Consumer Accounts)\n(\"Supplement\")", kind: null, why: "debit card terms naming a youth card, doc 36491" },
  { text: "Skip to main content\nFind a Car\nYouth Accounts\nLocations & Hours", kind: null, why: "a menu's youth accounts link, doc 36315" },
  { text: "Personal Account Fee Schedule\nEffective May 1, 2026\nCHECKING ACCOUNTS\nYouth Checking Fee Schedule", kind: null, why: "a youth heading past the third line" },
  // Review of #2671: a sentence about another document, and a general schedule's title above a loan word.
  { text: "Schedule of Fees\nEffective 1/1/2026\nRefer to your loan agreement for loan fees", kind: null, why: "a general schedule's title outweighs line 3" },
  { text: "Fee Schedule\nCredit Cards\nDisclosures", kind: null, why: "a general schedule's title outweighs lines 2 and 3 read together" },
  { text: "details of rate, fee, and other cost information\nAs required by law, rates, fees, and other costs of this credit card offer are\ndisclosed here. All account terms are governed by the credit card Agreement.", kind: null, why: "a loan phrase after \"the\" is a sentence, not a title, doc 18797" },
  { text: "Youth Savings | $5.00 fee schedule", kind: null, why: "a priced line is never a title" },
  { text: "", kind: null, why: "no text" },
];

/**
 * The start of the stored text of live documents that open with a credit card's Truth in Lending
 * rate table, and what `creditTermsOpening` must say about each (#1944 follow-up; prod, read-only,
 * Oct 27, the newest completed `agent_source_texts` row of each document). The near-misses are
 * general schedules and pages the rule must leave alone. The test runs them through the JS rule,
 * and the Postgres parity test (`non-deposit-document.db.test.ts`) through `creditTermsOpeningSql`.
 */
export const GREATER_VALLEY_VISA_TEXT = "Visa® Disclosure\nInterest Rates and Interest Charges\nAnnual Percentage Rate (APR)\nfor Purchases, Balance Transfers and | 12.9% (.03534 Daily Periodic Rate)\nCash Advances\nGrace Period for Repayment of | 25 days after the close of billing cycle*\nBalances for Purchases | Finance charges begin from the date of purchase\nMethod of Computing the Balance | Average daily balance (including new purchases)\nfor Purchases\nMinimum Finance Charge If the total finance charge during any month is\nbetween $.01 and $.50, a minimum finance\ncharge of $.50 will be charged.\nHow to Avoid Paying Interest Your Due Date is at least 21 days after the close\nof each billing cycle. We do not charge interest\non purchases if you pay your entire balance by\nthe Due Date each month.\nWebsite for Additional Information To learn more about factors to consider when\napplying for or using a credit card, visit the\nwebsite of the Consumer Financial Protection\nBureau at: http://www.consumerfinance.gov/.\nOther Terms and Conditions This card is secured. Greater Valley Credit Union\nhas a security interest in all shares, payments on\nshares, dividends on shares, and deposits\n(excluding Individual Retirement Account shares)\nwhich you now have or hereafter may have in this\nCredit Union.\nFees\nAnnual Fee NONE\nBalance Transfer Fee NONE (25 day grace period does not apply to\nbalance transfers)\nForeign Transaction Fee 1% of the transaction amount\nLate Payment Fee 3% of the payment due or $5.00 (whichever is\ngreater) applies after 5:00pm at the end of the\nbilling cycle.\nOver the Credit Limit Fee NONE\n\nResearch Fee $20.00 per hour\nReturned Check Fee $18.00 per returned check\nReplacement Card Fee $5.00 per card\nStatement Copy Fee $2.00 per statement\nTransaction Fee for Cash Advances 1.5% of the cash advance (no charge if advance\nis completed at the Credit Union)";
export const CREDIT_TERMS_FIXTURES: Array<{ text: string; match: boolean; why: string }> = [
  // The follow-ups named on #1944 (comment of Oct 25).
  { text: "CREDIT CARD\nACCOUNT\nOPENING -�\nDISCLOSURE mastercard\nApproved Credit Limit:\nThis Disclosure is incorporated into and becomes part of Your LOANLINER® Consumer Credit Card Agreement &\nDisclosure. Please keep this attached to Your LOANLINER Consumer Credit Card Agreement & Disclosure.\nInterest Rates and Interest Charges\nAnnual Percentage Rate (APR) for | 8.990% to 18.000%, based on your creditworthiness\nPurchases", match: true, why: "ELCA FCU, a title over four lines, doc 33235" },
  { text: GREATER_VALLEY_VISA_TEXT, match: true, why: "Greater Valley, a bare \"Visa® Disclosure\" title, doc 35811" },
  // Other live documents of the class.
  { text: "Salt City | APPLICATION AND\nFederal Credit Union | SOLICITATION\n(315) 488-4433 | DISCLOSURE\nsaltcityfcu.org\nInterest Rates and Interest Charges\nAnnual Percentage Rate (APR) for | Visa Platinum with Rewards\nPurchases | 8.90% to 16.90% , based on your creditworthiness.", match: true, why: "a card disclosure stored at an overdraft-protection address, doc 33884" },
  { text: "Interest Rates and Interest Charges\nInterest Rates and Interest 11.90%\nCharges Annual\nPercentage Rate\n(APR) for Purchases\nAPR For Balance Transfers 11.90%", match: true, why: "the table first, its APR split over lines, doc 31568" },
  { text: "Opening disclosure statement to personal credit card customers\nACCOUNT OPENING DISCLOSURE STATEMENT\nINTEREST RATES AND INTEREST CHARGES\nPersonal Credit Card Annual 13.9%\nPercentage Rate (APR)", match: true, why: "capitals, doc 19927" },
  { text: "Skip to main content\nPersonal Loans\nHome Equity & Mortgages\nSavings\nChecking Accounts\nCredit Card Disclosures\n\nInterest Rates and Interest Charges\n\nAnnual Percentage Rate (APR) for Purchases | 10.75% when you open your account", match: true, why: "a web page's menu above the table, doc 19005" },
  { text: "No annual fee\n\nInterest Rates and Interest Charges:\n\nAnnual Percentage Rate (APR) for Purchases, Balance Transfers, and Cash Advances: 13.56%", match: true, why: "a colon after the heading, doc 17817" },
  { text: "Interest Rates and Interest Charges\r\nAnnual Percentage Rate (APR) for Purchases", match: true, why: "a carriage return before the APR" },
  // Near-misses.
  { text: "Personal Fee Schedule\nEffective March 1, 2026\nOverdraft - paid per day per account | $35.00\nInterest rates and annual percentage yields are shown on the rate sheet", match: false, why: "a general schedule" },
  { text: "MEMBER ACCOUNTS TRUTH-IN-SAVINGS DISCLOSURES\n1. Rate Information. The interest rate and annual percentage yield (APY) are shown on the Rate Schedule.", match: false, why: "a deposit account's rate information" },
  { text: "Fee Schedule\nSee our loan disclosures for interest rates and interest charges on credit cards (APR).", match: false, why: "the heading words mid-sentence, not a line's start" },
  { text: "Interest Rates and Interest Charges\nSee the rate sheet.", match: false, why: "the heading with no APR after it" },
  { text: "APR for Purchases 12.9%\nInterest Rates and Interest Charges", match: false, why: "the APR only before the heading" },
  { text: "Interest Rates and Interest Chargesx APR", match: false, why: "the heading must end on a word boundary" },
  { text: `${"Checking | $5.00\n".repeat(130)}Interest Rates and Interest Charges\nAnnual Percentage Rate (APR)`, match: false, why: "the heading past the opening's first 2,000 characters" },
  { text: "Schedule of Fees and Charges\nOverdraft Line of Credit\nInterest Rates and Interest Charges\nAnnual Percentage Rate (APR) 18%", match: false, why: "a general schedule's title above a credit line's rate table" },
  { text: "", match: false, why: "no text" },
];

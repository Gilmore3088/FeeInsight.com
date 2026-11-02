/**
 * #1092: near-miss texts for the section path (`section-path.ts`), each with the one fee it must
 * read and what it must do with `SECTION_PATH_LIVE` on. `changed` marks the cases main gets wrong
 * (red with the switch off, green with it on); every other case must read the same either way.
 * Built from the measured shapes in the 291 Texas, seven-state and lab texts (named in each case)
 * and from the failure classes the #2863 reviews found. Not real banks' texts.
 */

/** Web pages are stored with a blank line between every line (`read.html_dom`). */
export const spaced = (...lines: string[]) => lines.join("\n\n");
export const single = (...lines: string[]) => lines.join("\n");

export interface AudienceCase {
  name: string;
  text: string;
  fee: { name: string; amount: number };
  /** Darwin's audience with the switch on ("unknown" when it decides none). */
  audience: "consumer" | "business" | "both" | "unknown";
  changed: boolean;
}

export interface RetiredCase {
  name: string;
  text: string;
  fee: { name: string; amount: number; key: string };
  /** True when the shared check must refuse the fee as `discontinued_account` with the switch on. */
  retired: boolean;
  changed: boolean;
}

const PERSONAL_PART = ["Personal Checking", "Essential Checking | Monthly Fee | $6.00", "Stop Payment | $30.00"];

/** The adversarial cases of the review of 863cebf (PR #2872): each read business at that head. */
const REVIEW_AUDIENCE: readonly AudienceCase[] = [
  { name: "review: an all-accounts colon heading after a business section", text: spaced("Fee Schedule", "Personal Checking", "Monthly Fee | $5.00", "Business Checking", "Monthly Fee | $10.00", "Fees applicable to all accounts:", "Stop Payment | $30.00", "Overdraft Fee | $35.00"), fee: { name: "Stop Payment", amount: 30 }, audience: "both", changed: false },
  { name: "review: a general colon heading after a business section", text: spaced("Fee Schedule", "Personal Checking", "Monthly Fee | $5.00", "Business Checking", "Monthly Fee | $10.00", "Other Fees:", "Stop Payment | $30.00"), fee: { name: "Stop Payment", amount: 30 }, audience: "both", changed: false },
  { name: "review: a general title row after a business section", text: spaced("Fee Schedule", "Personal Checking", "Monthly Fee | $5.00", "Business Checking", "Monthly Fee | $10.00", "Other Services | Fee", "Stop Payment | $30.00"), fee: { name: "Stop Payment", amount: 30 }, audience: "unknown", changed: false },
  { name: "review: a consumer heading over twelve words after a business section", text: spaced("Business Accounts", "Effective January 1, 2026", "Business Monthly Fee | $10.00", "Personal Checking, Savings, Money Market and Certificate Account Fees and Service Charges Apply", "Stop Payment | $30.00"), fee: { name: "Stop Payment", amount: 30 }, audience: "unknown", changed: false },
  { name: "review: a bulleted consumer heading after a business heading", text: spaced("Business Checking", "Monthly Fee | $10.00", "• Personal Checking", "Overdraft Fee | $35.00"), fee: { name: "Overdraft Fee", amount: 35 }, audience: "unknown", changed: false },
  { name: "review: a two-item menu then fees", text: spaced("Personal Banking", "Business Banking", "Overdraft Fee | $35.00", "Stop Payment | $30.00"), fee: { name: "Overdraft Fee", amount: 35 }, audience: "unknown", changed: false },
  { name: "review: a dated business heading then Title Case sections that name no audience", text: spaced("Business Account(s)", "Effective April 1, 2026", "Analysis Fee | $15.00", "Safe Deposit Box Fees", "3x5 Box | $25.00", "Checks and Statements", "Statement Copy | $3.00"), fee: { name: "Statement Copy", amount: 3 }, audience: "unknown", changed: false },
  { name: "review: a business scope sentence then a colon heading naming a consumer product", text: spaced("Business Customers", "The following fees apply to business customers only.", "ACH Origination | $25.00", "Kids Savings:", "Excess Withdrawal | $5.00"), fee: { name: "Excess Withdrawal", amount: 5 }, audience: "unknown", changed: false },
  { name: "review: a business day heading under a personal heading", text: spaced("Personal Checking", "Business Day Cutoff", "Overdraft Fee | $35.00", "Business Checking", "Analysis | $15.00"), fee: { name: "Overdraft Fee", amount: 35 }, audience: "unknown", changed: false },
  { name: "review: a personal | business column header then a neutral heading", text: spaced("Personal | Business", "Overdraft Fee | $35.00 | $35.00", "Other Fees", "Stop Payment | $30.00", "Business Analysis | $15.00"), fee: { name: "Stop Payment", amount: 30 }, audience: "both", changed: false },
  { name: "review: a priced waiver line in a business section, then a personal section", text: spaced("Business Checking", "Monthly Fee | $10.00", "Waived with $5,000 balance", "Personal Checking", "Overdraft Fee | $35.00"), fee: { name: "Overdraft Fee", amount: 35 }, audience: "consumer", changed: true },
  { name: "review: a personal section, then a commercial heading at the end", text: spaced("Personal Checking", "Overdraft Fee | $35.00", "Commercial Lending", "Contact us", "Business Analysis | $15.00"), fee: { name: "Overdraft Fee", amount: 35 }, audience: "consumer", changed: true },
  { name: "review: a commercial schedule title over headings that name no audience", text: spaced("Commercial Fee Schedule", "Analysis Fee | $15.00", "Kasasa Cash Checking", "Monthly Fee | $0.00 ", "Student Savings", "Excess Withdrawal | $5.00"), fee: { name: "Excess Withdrawal", amount: 5 }, audience: "business", changed: false },
];

export const AUDIENCE_CASES: readonly AudienceCase[] = [
  ...REVIEW_AUDIENCE,
  {
    name: "a column line whose every cell names business heads both columns (State key 3981)",
    text: single(
      "General Business Service Fees | Business Checking Account Fees",
      "Check Cashing Fee per item ........ $10.00 | Business Checking ........ $5.00 per month",
      "Collection Item - Domestic ........ $30.00 | Share Draft ........ $5.00 monthly",
      "Personal Savings | $5.00 minimum",
    ),
    fee: { name: "Collection Item - Domestic", amount: 30 },
    audience: "business",
    changed: true,
  },
  {
    name: "a business scope sentence holds over capital sub-sections and two-column rows (State key 1338)",
    text: single(
      "Miscellaneous Services Pricing Guide:",
      "All Customers",
      "The following fees apply to all customers and may be assessed at the time of service.",
      "ACCOUNT ASSISTANCE | WIRE TRANSFERS",
      "Garnishments and Levies | $100.00 | Domestic Outgoing (branch assisted) | $35.00",
      "Miscellaneous Services Pricing Guide:",
      "Business Customers",
      "The following fees apply to business customers only and may be assessed at the time of service.",
      "ACCOUNT ASSISTANCE | BUSINESS ONLINE BANKING WIRE TRANSFERS",
      "Account Research Copies (per page) | $2.00 | Domestic Outgoing (Business Online Banking) | $20.00",
      "TREASURY SERVICES: Non-analyzed accounts",
      "ACH Return Items | $7.00",
    ),
    fee: { name: "Account Research Copies (per page)", amount: 2 },
    audience: "business",
    changed: true,
  },
  {
    name: "the all-customers scope above a business scope stays for both",
    text: single(
      "All Customers",
      "The following fees apply to all customers and may be assessed at the time of service.",
      "Stop Payment | $35.00",
      "Business Customers",
      "The following fees apply to business customers only.",
      "ACH Return Items | $7.00",
    ),
    fee: { name: "Stop Payment", amount: 35 },
    audience: "both",
    changed: false,
  },
  {
    name: "a general sub-section under a business heading is left to main's reading (Texas key 2434; review of 863cebf)",
    text: spaced(
      "Consumer & Business Account(s)", "Effective April 1, 2026", "Share Draft Account Fees", "Service | Fee",
      "Stop Payment Fee | $30.00", "Business Account(s)", "Effective April 1, 2026", "Other Services Fees",
      "(applicable to all accounts)", "Service | Fee", "One-Time ACH Origination Transfer Fee | $5.00 per transfer",
    ),
    fee: { name: "One-Time ACH Origination Transfer Fee", amount: 5 },
    audience: "both",
    changed: false,
  },
  {
    name: "a business share section's own heading ties its rows (Texas key 2434)",
    text: spaced(
      "Consumer & Business Account(s)", "Effective April 1, 2026", "Share Account Fees", "Service | Fee",
      "Share Account Telephone Inquiry | $5.00 per call", "Business Account(s)", "Effective April 1, 2026",
      "Member Business Share Account Fees", "Service | Fee", "Account Closing Fee | $25.00 if closed within ninety (90) days of opening",
    ),
    fee: { name: "Account Closing Fee", amount: 25 },
    audience: "business",
    changed: true,
  },
  {
    name: "rows under a consumer-and-business heading stay for both",
    text: spaced(
      "Consumer & Business Account(s)", "Effective April 1, 2026", "Share Draft Account Fees", "Service | Fee",
      "Share Draft Copy Fee | $3.00", "Business Account(s)", "Effective April 1, 2026", "Business Loan Application Fee | $50.00 each",
    ),
    fee: { name: "Share Draft Copy Fee", amount: 3 },
    audience: "both",
    changed: false,
  },
  {
    name: "a business account table's title row heads its rows (Texas key 2437)",
    text: spaced(
      "Savings Accounts", "Alert Me", "Share Savings | Alert Me", "Minimum to Open | $25", "Small Business Accounts",
      "Business Checking | Fee Amount | Alert Me", "Minimum to Open | $250", "Otherwise, Service Fee | $25/mo",
      "Wire Investigation | $15", "VISA® Check Card (Debit Card)", "Fee Amount | Alert Me", "Chargeback | $25",
    ),
    fee: { name: "Wire Investigation", amount: 15 },
    audience: "business",
    changed: true,
  },
  {
    name: "a debit card section after the business table is not business (Texas key 2437)",
    text: spaced(
      "Savings Accounts", "Alert Me", "Share Savings | Alert Me", "Minimum to Open | $25", "Small Business Accounts",
      "Business Checking | Fee Amount | Alert Me", "Minimum to Open | $250", "VISA® Check Card (Debit Card)",
      "Fee Amount | Alert Me", "Chargeback | $25",
    ),
    fee: { name: "Chargeback", amount: 25 },
    audience: "unknown",
    changed: false,
  },
  {
    name: "a money market heading that includes business accounts is for both",
    text: spaced(
      "Checking Accounts", "Monthly Service Fee | $5/mo", "Money Market Accounts (Including Business Accounts)",
      "Fee Amount | Alert Me", "More than 3 Checks per mo. | $10/check", "Small Business Accounts", "Service Fee | $25/mo",
    ),
    fee: { name: "More than 3 Checks per mo.", amount: 10 },
    audience: "unknown",
    changed: false,
  },
  {
    name: "a business day cutoff names a time, not an audience",
    text: single(...PERSONAL_PART, "Business Day Cutoff", "Wire Transfer Outgoing | $25.00", "Business Accounts", "Business Checking Monthly Fee | $15.00"),
    fee: { name: "Wire Transfer Outgoing", amount: 25 },
    audience: "unknown",
    changed: false,
  },
  {
    name: "a box section beside a business checking section is not business (State key 10279)",
    text: spaced(
      "Business Checking Fees", "Item | Fee", "Service Fee | $10.00/month", "Safe Deposit Box Fees", "Item | Fee",
      "Annual Rent Size 3x5 | $25.00", "Personal Checking Fees", "Item | Fee", "Paper Statement | $3.00",
    ),
    fee: { name: "Annual Rent Size 3x5", amount: 25 },
    audience: "unknown",
    changed: false,
  },
  {
    name: "a debit card section beside a business section is not business (State key 3515)",
    text: single(
      "Checking or Savings Account Fees", "Closed account during first 90 days $40.00", "Business Account Fees",
      "Checking statement fee $ 5.00/monthly", "Domestic Debit Card / ATM Fees", "Debit card replacement $10.00",
    ),
    fee: { name: "Debit card replacement", amount: 10 },
    audience: "unknown",
    changed: false,
  },
  {
    name: "sibling table titles: card services after a business table (Texas key 2431)",
    text: spaced(
      "Account | Fee", "Vantage Plus Checking Service Charge | $5 per month", "Business Account | Fee",
      "Business Checking Monthly Service Charge | $9.95 per month", "Card Services | Fee", "Debit Card Reissue | $5",
    ),
    fee: { name: "Debit Card Reissue", amount: 5 },
    audience: "both",
    changed: false,
  },
  {
    name: "rows under a business table title are business",
    text: spaced(
      "Account | Fee", "Vantage Plus Checking Service Charge | $5 per month", "Business Account | Fee",
      "Business Checking Monthly Service Charge | $9.95 per month", "Coin Strap Order | $2 per strap", "Card Services | Fee", "Debit Card Reissue | $5",
    ),
    fee: { name: "Coin Strap Order", amount: 2 },
    audience: "business",
    changed: true,
  },
  {
    name: "a navigation menu naming business above the schedule heads nothing (Texas key 2418)",
    text: spaced("Personal Banking", "Checking", "Business Banking", "Checking", "Loans", "Fee Schedule", "Schedule of Fees", "Account Research | $35.00 per hour", "Business Analysis | $25.00"),
    fee: { name: "Account Research", amount: 35 },
    audience: "both",
    changed: false,
  },
  {
    name: "a three-column page flattened across columns is not tied to its business title (Texas key 2451)",
    text: single(
      "TS | SCHEDULE OF FEES - PERSONAL | SCHEDULE OF FEES - BUSINESS",
      "Return Mail ........ $15 | Return Mail ........ $15",
      "Bill Pay ........ $5.95 | Business Bill Pay ........ $9.95",
    ),
    fee: { name: "Return Mail", amount: 15 },
    audience: "unknown",
    changed: false,
  },
  {
    name: "a business name priced free on its own line is a row, not a heading (State key 6820)",
    text: single("Checking Account Fees", "Business eDeposit No fee", "Check copy $5.00 each", "Business Accounts", "Business Monthly Fee $15.00"),
    fee: { name: "Check copy", amount: 5 },
    audience: "both",
    changed: false,
  },
  {
    name: "paragraphs between a business heading and the rows end the section",
    text: single(
      "Business Accounts",
      "These terms explain how your account works and what we may charge you for it",
      "if you hold one of the accounts we offer and if you use the services we describe",
      "in the sections that follow, as amended from time to time by notice to you",
      "and as permitted by the law that governs your account and this agreement",
      "Stop Payment | $30.00",
      "Personal Checking",
      "Paper Statement | $3.00",
    ),
    fee: { name: "Stop Payment", amount: 30 },
    audience: "unknown",
    changed: false,
  },
  {
    name: "a personal heading in a schedule with a business section is consumer",
    text: spaced("Fee Schedule", "Personal Accounts", "Item | Fee", "Paper Statement | $3.00", "Business Accounts", "Item | Fee", "Business Monthly Fee | $15.00"),
    fee: { name: "Paper Statement", amount: 3 },
    audience: "consumer",
    changed: true,
  },
  {
    name: "a personal section beside a business one ends it",
    text: spaced("Fee Schedule", "Business Accounts", "Item | Fee", "Business Monthly Fee | $15.00", "Personal Checking", "Item | Fee", "Overdraft Fee | $30.00"),
    fee: { name: "Overdraft Fee", amount: 30 },
    audience: "consumer",
    changed: true,
  },
  {
    name: "a personal section nested under a business title leaves the fee unknown",
    text: spaced("BUSINESS FEE SCHEDULE", "Personal Accounts:", "Overdraft Fee | $30.00", "Business Checking | $15.00 per month"),
    fee: { name: "Overdraft Fee", amount: 30 },
    audience: "unknown",
    changed: false,
  },
  {
    name: "a merchant services heading over its rows is business",
    text: spaced(...PERSONAL_PART, "Merchant Services", "Item | Fee", "Chargeback Processing | $25.00", "Other Fees", "Item | Fee", "Notary | $5.00"),
    fee: { name: "Chargeback Processing", amount: 25 },
    audience: "business",
    changed: true,
  },
  {
    name: "stacked name and price lines under a business heading are its rows (live audit 1082)",
    text: single(...PERSONAL_PART, "Business Banking Fees", "Type", "Rate", "RDC Monthly Fee", "$40.00 (if average monthly balance below $25,000.00)", "ACH - Returned Items", "$5.00"),
    fee: { name: "ACH - Returned Items", amount: 5 },
    audience: "business",
    changed: true,
  },
  {
    name: "a corporate check heading names a product, not an audience",
    text: spaced(...PERSONAL_PART, "Corporate Checks", "Item | Fee", "Corporate Check Copy | $5.00", "Business Accounts", "Item | Fee", "Business Monthly Fee | $15.00"),
    fee: { name: "Corporate Check Copy", amount: 5 },
    audience: "unknown",
    changed: false,
  },
  {
    name: "a student checking heading names a product; no audience is read from it",
    text: spaced(...PERSONAL_PART, "Student Checking", "Item | Fee", "Debit Card Replacement | $5.00", "Business Accounts", "Item | Fee", "Business Monthly Fee | $15.00"),
    fee: { name: "Debit Card Replacement", amount: 5 },
    audience: "unknown",
    changed: false,
  },
  {
    name: "a column header naming personal and business columns ties no row to either",
    text: single("Fee Schedule", "Service | Personal | Business", "Stop Payment | $30.00 | $35.00", "Business Accounts", "Business Monthly Fee | $15.00"),
    fee: { name: "Stop Payment", amount: 30 },
    audience: "unknown",
    changed: false,
  },
  {
    name: "a heading for personal and business accounts is for both",
    text: spaced("Business & Personal Accounts", "Item | Fee", "Wire Transfer Outgoing | $25.00", "Business Accounts", "Item | Fee", "Business Monthly Fee | $15.00"),
    fee: { name: "Wire Transfer Outgoing", amount: 25 },
    audience: "both",
    changed: false,
  },
  {
    name: "a business heading ending in a colon heads the rows under it",
    text: single("Fee Schedule", "Business Accounts:", "Night Deposit Bag | $20.00", "Personal Accounts:", "Paper Statement | $3.00"),
    fee: { name: "Night Deposit Bag", amount: 20 },
    audience: "business",
    changed: true,
  },
  {
    name: "a colon heading under a personal heading may be its sub-section: not taken for business",
    text: single(...PERSONAL_PART, "Business Accounts:", "Night Deposit Bag | $20.00", "Coin Counting | $5.00"),
    fee: { name: "Night Deposit Bag", amount: 20 },
    audience: "unknown",
    changed: false,
  },
  {
    name: "an accordion that prints its business title twice is read once",
    text: spaced(...PERSONAL_PART, "Business Services", "Business Services", "Item | Fee", "Positive Pay | $30.00 per month", "Other Services", "Item | Fee", "Notary | $5.00"),
    fee: { name: "Positive Pay", amount: 30 },
    audience: "business",
    changed: true,
  },
  {
    name: "a business cash management heading over its rows is business (live audit 2538)",
    text: single(
      "COMMON FEE SCHEDULE", "Other Bank Fees and Services", "Notary Fee (non-customer)                $5",
      "Business Cash Management - Positive Pay, ACH Services, Remote Deposit Now", "One Time set up fee                $50", "Monthly fee                $25",
    ),
    fee: { name: "Monthly fee", amount: 25 },
    audience: "business",
    changed: true,
  },
  {
    name: "a fee after the business section, under a later personal schedule title, is consumer",
    text: spaced("Business Accounts", "Effective April 1, 2026", "Item | Fee", "Business Monthly Fee | $15.00", "Personal Fee Schedule", "Item | Fee", "Returned Mail | $5.00"),
    fee: { name: "Returned Mail", amount: 5 },
    audience: "consumer",
    changed: false,
  },
];

const GRANDFATHERED = spaced(
  "Fee Schedule", "Item | Amount", "Checking Accounts (Share Drafts)", "Free Checking (CK02) | Free",
  "Rewards Checking (CK06) | $6.00 per month", "Grandfathered Checking Account Types:",
  "Regular Checking Accounts (CK03)* | $5.00 per month Service charge when the average balance for the month is less than $500.00.",
  "Savings Accounts (Share Accounts)", "Closed Account Fee | $10.00 per account",
);

const PREVIOUSLY_OFFERED = spaced(
  "Personal Banking Fee Schedule", "Transactional Fees", "All fees listed may be assessed on a per item basis.",
  "Stop Payment | $30 | $0", "Need more help?", "Contact Us", "Online Banking Guide", "Services and Fees",
  "Previously Offered Products",
  "Click to expand more information about fees and features associated with account types previously offered and no longer available to open by the bank:",
  "Previously Offered Products", "Capital Interest Checking", "Premier Checking", "Money Market", "Transactional Fees",
  "All fees listed may be assessed on a per item basis.", "TRANSACTIONAL FEES1 | CAPITAL INTEREST CHECKING | PREMIER CHECKING",
  "Paid Overdraft Fee | $15 | $15", "Features", "Features | capital interest checking | Premier checking", "Monthly service charge | $0 | $0/$25",
  "Fully digital account opening | Yes | Yes",
);

/** The adversarial cases of the review of 863cebf (PR #2872): the first four and the last were held at that head. */
const REVIEW_RETIRED: readonly RetiredCase[] = [
  { name: "review: a scoped previously offered section, then a current Title Case section", text: spaced("Previously Offered Products", "These accounts were previously offered and are no longer available to open.", "Gold Checking | Monthly Fee | $10.00", "Checking Accounts", "Platinum Checking | Monthly Fee | $12.00"), fee: { name: "Platinum Checking Monthly Fee", amount: 12, key: "monthly_maintenance" }, retired: false, changed: false },
  { name: "review: a scoped previously offered section, then other services", text: spaced("Previously Offered Products", "These accounts were previously offered and are no longer available to open.", "Gold Checking | Monthly Fee | $10.00", "Other Services", "Stop Payment | $30.00"), fee: { name: "Stop Payment", amount: 30, key: "stop_payment" }, retired: false, changed: false },
  { name: "review: a dated legacy heading, then miscellaneous fees", text: spaced("Legacy Accounts", "Effective January 1, 2026", "Gold Checking | Monthly Fee | $10.00", "Miscellaneous Fees", "Stop Payment | $30.00"), fee: { name: "Stop Payment", amount: 30, key: "stop_payment" }, retired: false, changed: false },
  { name: "review: a legacy heading, then a current colon section", text: spaced("Legacy Accounts", "Gold Checking | Monthly Fee | $10.00", "Current Fees:", "Stop Payment | $30.00"), fee: { name: "Stop Payment", amount: 30, key: "stop_payment" }, retired: false, changed: false },
  { name: "review: previous fees, then current fees", text: spaced("Previous Fees", "Stop Payment | $25.00", "Current Fees", "Stop Payment | $30.00"), fee: { name: "Stop Payment", amount: 30, key: "stop_payment" }, retired: false, changed: false },
  { name: "review: a previous balance line", text: spaced("Account Statements", "Previous Balance", "Paper Statement | $3.00"), fee: { name: "Paper Statement", amount: 3, key: "paper_statement" }, retired: false, changed: false },
  { name: "review: prior day reporting", text: spaced("Prior Day Reporting", "Prior Day Balance Report | $15.00"), fee: { name: "Prior Day Balance Report", amount: 15, key: "other" }, retired: false, changed: false },
  { name: "review: old fees with no current schedule beside them", text: spaced("Fee Schedule", "Old Fees", "Overdraft Fee | $30.00"), fee: { name: "Overdraft Fee", amount: 30, key: "overdraft" }, retired: false, changed: false },
  { name: "review: a scoped no-longer-offered section, then debit cards", text: spaced("Accounts No Longer Offered", "The following accounts are no longer offered to new customers.", "Gold Checking | $10.00", "Debit Cards", "Card Replacement | $5.00"), fee: { name: "Card Replacement", amount: 5, key: "card_replacement" }, retired: false, changed: false },
];

export const RETIRED_CASES: readonly RetiredCase[] = [
  ...REVIEW_RETIRED,
  {
    name: "a grandfathered heading over rows set a blank line apart (Texas key 2445)",
    text: GRANDFATHERED,
    fee: { name: "Regular Checking Accounts (CK03) Monthly service charge", amount: 5, key: "monthly_maintenance" },
    retired: true,
    changed: true,
  },
  {
    name: "the current section after the grandfathered one stays current (Texas key 2445)",
    text: GRANDFATHERED,
    fee: { name: "Closed Account Fee", amount: 10, key: "early_closure" },
    retired: false,
    changed: false,
  },
  {
    name: "a previously offered section two headings up, its row named only by a column heading (Texas key 2426)",
    text: PREVIOUSLY_OFFERED,
    fee: { name: "Premier checking Monthly service charge", amount: 25, key: "monthly_maintenance" },
    retired: true,
    changed: true,
  },
  {
    name: "a fee printed in the current schedule above the previously offered one stays current (Texas key 2426)",
    text: PREVIOUSLY_OFFERED,
    fee: { name: "Stop Payment", amount: 30, key: "stop_payment" },
    retired: false,
    changed: false,
  },
  {
    name: "a legacy section with sub-headings, set a blank line apart",
    text: spaced(...PERSONAL_PART, "Legacy Accounts", "Gold Checking:", "Monthly Fee | $15.00", "Paper Statement | $4.00"),
    fee: { name: "Gold Checking Monthly Fee", amount: 15, key: "monthly_maintenance" },
    retired: true,
    changed: true,
  },
  {
    name: "a previous fees section beside the current one: the older price is retired",
    text: spaced("Current Fees", "Item | Fee", "Stop Payment | $35.00", "Previous Fees", "Item | Fee", "Stop Payment | $30.00", "Wire Transfer Outgoing | $20.00"),
    fee: { name: "Wire Transfer Outgoing", amount: 20, key: "wire_domestic_outgoing" },
    retired: true,
    changed: true,
  },
  {
    name: "a prior fee schedule is retired",
    text: spaced("Current Fee Schedule", "Item | Fee", "Stop Payment | $35.00", "Prior Fee Schedule", "Effective January 1, 2024", "Item | Fee", "Cashier's Check | $8.00"),
    fee: { name: "Cashier's Check", amount: 8, key: "cashiers_check" },
    retired: true,
    changed: true,
  },
  {
    name: "the current price beside a previous fees section stays current",
    text: spaced("Current Fees", "Item | Fee", "Stop Payment | $35.00", "Previous Fees", "Item | Fee", "Stop Payment | $30.00"),
    fee: { name: "Stop Payment", amount: 35, key: "stop_payment" },
    retired: false,
    changed: false,
  },
  {
    name: "a previously owned vehicle loan is a product, not a retired section",
    text: spaced("Loan Fees", "Previously Owned Vehicle Loan", "Item | Fee", "Loan Processing Fee | $50.00"),
    fee: { name: "Loan Processing Fee", amount: 50, key: "other_lending_fee" },
    retired: false,
    changed: false,
  },
  {
    name: "a former military members discount is an audience, not a retired section",
    text: spaced("Checking Fees", "Former Military Members Discount", "Item | Fee", "Monthly Service Charge | $5.00"),
    fee: { name: "Monthly Service Charge", amount: 5, key: "monthly_maintenance" },
    retired: false,
    changed: false,
  },
  {
    name: "a prior day balance report is a service",
    text: spaced("Treasury Services", "Prior Day Balance Report", "Item | Fee", "Monthly Report Fee | $15.00"),
    fee: { name: "Monthly Report Fee", amount: 15, key: "monthly_maintenance" },
    retired: false,
    changed: false,
  },
  {
    name: "a carousel's Previous and Next links are not a section (State key 5703)",
    text: spaced("Home", "(current)", "About Us", "Previous", "Next", "Fee Schedule", "Bank Checks | $2.00", "Return Mail | $5.00"),
    fee: { name: "Bank Checks", amount: 2, key: "cashiers_check" },
    retired: false,
    changed: false,
  },
  {
    name: "a current section after a legacy one ends it",
    text: spaced("Legacy Accounts", "Gold Checking | Monthly Fee | $15.00", "Current Accounts", "Item | Fee", "Overdraft Fee | $30.00"),
    fee: { name: "Overdraft Fee", amount: 30, key: "overdraft" },
    retired: false,
    changed: false,
  },
  {
    name: "a schedule title after a previously offered section ends it",
    text: spaced(
      "Previously Offered Products", "Click to expand fees for account types previously offered and no longer available to open:",
      "Transactional Fees", "Paid Overdraft Fee | $15", "Business Banking Fee Schedule", "Transactional Fees", "Wire Transfer Inbound | $12",
    ),
    fee: { name: "Wire Transfer Inbound", amount: 12, key: "wire_domestic_incoming" },
    retired: false,
    changed: false,
  },
  {
    name: "a fee printed in both a grandfathered and a current section stays current",
    text: spaced("Checking Accounts", "Item | Fee", "Stop Payment | $30.00", "Grandfathered Checking Account Types:", "Stop Payment | $30.00"),
    fee: { name: "Stop Payment", amount: 30, key: "stop_payment" },
    retired: false,
    changed: false,
  },
  {
    name: "an old fashioned savings account is a product",
    text: spaced("Savings Accounts", "Old Fashioned Savings", "Item | Fee", "Excess Withdrawal | $3.00"),
    fee: { name: "Excess Withdrawal", amount: 3, key: "excess_withdrawal" },
    retired: false,
    changed: false,
  },
  {
    name: "a legacy checking product is not a legacy accounts section",
    text: spaced("Checking Accounts", "Legacy Checking", "Item | Fee", "Non-network ATM Transaction | $1.00"),
    fee: { name: "Non-network ATM Transaction", amount: 1, key: "atm_non_network" },
    retired: false,
    changed: false,
  },
  {
    name: "an expired card replacement is a fee, not a retired section",
    text: spaced("Card Services", "Expired Card Replacement", "Item | Fee", "Replacement Card | $5.00"),
    fee: { name: "Replacement Card", amount: 5, key: "card_replacement" },
    retired: false,
    changed: false,
  },
  {
    name: "retirement accounts are IRAs, not retired accounts",
    text: spaced("Retirement Accounts", "Item | Fee", "IRA Closing Fee | $25.00"),
    fee: { name: "IRA Closing Fee", amount: 25, key: "ira_termination" },
    retired: false,
    changed: false,
  },
  {
    name: "withdrawal prior to maturity names a charge, not a prior schedule",
    text: spaced("Certificates of Deposit", "Prior to Maturity", "Item | Fee", "Early Withdrawal Fee | $25.00"),
    fee: { name: "Early Withdrawal Fee", amount: 25, key: "early_closure" },
    retired: false,
    changed: false,
  },
  {
    name: "two sections each with its own effective date are both current (State key 11477)",
    text: spaced(
      "Personal Fee Schedule", "Share Draft", "Effective Date: November 9, 2021", "Name | Fee", "Stop Payment | $25.00 per item",
      "Miscellaneous Fees", "Effective Date: May 28, 2026", "Name | Fee", "Money Order | $2.00",
    ),
    fee: { name: "Stop Payment", amount: 25, key: "stop_payment" },
    retired: false,
    changed: false,
  },
  {
    name: "the same effective date under consumer and business headings is current (Texas key 2434)",
    text: spaced(
      "Consumer & Business Account(s)", "Effective April 1, 2026", "Share Draft Account Fees", "Service | Fee", "Stop Payment Fee | $30.00",
      "Business Account(s)", "Effective April 1, 2026", "Member Business Share Draft Account Fees", "Service | Fee", "Stop Payment Fee | $25.00 per item",
    ),
    fee: { name: "Stop Payment Fee", amount: 30, key: "stop_payment" },
    retired: false,
    changed: false,
  },
  {
    name: "a change already in effect, noted in a footnote, is today's price (Texas key 2409)",
    text: single("Date Revised: 10/01/2026", "DEBIT CARD FEES", "NON-NETWORK ATM TRANSACTION FEE | $4.00*", "* ATM surcharge will change from $3 to $4 effective 11/1/2026"),
    fee: { name: "NON-NETWORK ATM TRANSACTION FEE", amount: 4, key: "atm_non_network" },
    retired: false,
    changed: false,
  },
];

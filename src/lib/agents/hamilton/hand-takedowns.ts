import type { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { inSavepoint } from "@/lib/agents/savepoint";
import { recordFeedback, type FeedbackKind, type FeedbackRow } from "@/lib/agents/learning/feedback";
import { recordStepWarning } from "@/lib/agents/hamilton/step-warning";

type SqlTag = typeof sql;

/**
 * Hand takedowns: a short, reviewed list of live fees confirmed wrong against their bank's own
 * stored text. James, Oct 16 03:37 UTC (DECISIONS.md): a batch of fewer than 20 such fees, each
 * confirmed wrong on amount or category against the bank's stored text and checked by a reviewer,
 * comes down this way without asking him ("I don't want to be nickel and dimed every time we have
 * a problem with less than 20 fees"); a ledger line goes on #1026. A batch is the entries filed
 * under one issue (`issue`); the limit is per batch (`HAND_TAKEDOWN_BATCH_LIMIT`), not a total for
 * the list. A batch of 20 or more, category or policy questions, migrations and switches still go
 * to him.
 *
 * A fixed list, not a takedown tool. A row comes down only while it still reads as listed (live,
 * same institution, category, name and price). Its verified row is rejected too, so no later
 * publish brings it back. Archived, never deleted: `rolled_back_reason` is the entry's reason
 * (`source_mismatch: #1496`); clearing `rolled_back_at` (and the verified row's status) restores
 * it. Each takedown records the row in `pipeline_feedback`, and the run gets one event naming every
 * row. Running it again changes nothing: a row already down is skipped. Add later rows below as
 * one entry each, never edit a past one. A failed read or write never fails the publish: it is
 * kept in the result (`error`) and as a `step.warning` run event, so the run ledger shows it.
 */
export const HAND_TAKEDOWN_CHECK = "hamilton.hand_takedown";
export const HAND_TAKEDOWN_FLAG = "hand_rejected:hand_takedown";
/** Most entries one batch (one issue) may hold: James's rule covers fewer than 20 fees at a time. */
export const HAND_TAKEDOWN_BATCH_LIMIT = 19;

export interface HandTakedown {
  feePublishedId: number;
  institutionId: number;
  canonicalFeeKey: string;
  amount: number;
  /** The name the live row carries now. */
  feeName: string;
  /** `rolled_back_reason`, e.g. `source_mismatch: #1496`, or `duplicate of #<kept id> (#<issue>)` for a repeat. */
  reason: string;
  /** The issue that holds the evidence; the entries under one issue are one batch. */
  issue: number;
  kind: Extract<FeedbackKind, "wrong_amount" | "wrong_category" | "not_a_fee" | "duplicate">;
  /** What the bank's own text says, in one line. */
  evidence: string;
  /**
   * A live row this takedown waits on (#1659): the entry comes down only while that row is live at
   * this amount and name, so a duplicate never leaves before the fee it repeats is right. Hand
   * amount corrections run before takedowns in the same publish transaction, so normally both
   * land in one step.
   */
  requiresLive?: { feePublishedId: number; amount: number; feeName: string };
}

export const HAND_TAKEDOWNS: readonly HandTakedown[] = [
  // #1496 (James approved, Oct 16): Barksdale FCU's two-column fee schedule (text 17003) read line by line.
  { feePublishedId: 80423, institutionId: 5433, canonicalFeeKey: "document_reproduction", amount: 15, feeName: "Fax (Local)",
    reason: "source_mismatch: #1496", issue: 1496, kind: "wrong_amount",
    evidence: "Fax (Local) is $5.00 for 2 pages, $2.00 for additional pages; the $15.00 is the next column's Duplicate Key by mail." },
  { feePublishedId: 102440, institutionId: 5433, canonicalFeeKey: "document_reproduction", amount: 2, feeName: "Fax (Long Distance) Minimum Balance",
    reason: "source_mismatch: #1496", issue: 1496, kind: "wrong_amount",
    evidence: "Fax (Long Distance) is $7.00 for 2 pages, $2.00 for additional pages; \"Minimum Balance:\" is the next column's heading." },
  // #1549: Flagstar's overdraft terms (doc 21228, read-only, Oct 16): the $20 is a worked example's remainder.
  { feePublishedId: 83118, institutionId: 33, canonicalFeeKey: "overdraft", amount: 20, feeName: "we may use Overdraft Protection Coverage to pay the remaining",
    reason: "source_mismatch: #1549", issue: 1549, kind: "wrong_amount",
    evidence: "Example: \"…$20 is transferred from your linked account, we may use Overdraft Protection Coverage to pay the remaining $20\"; the same document's price is \"Overdraft Charge $30.00 per Item\"." },
  // #1512: Utility District FCU's two-column fee schedule (doc 3497, read-only, Oct 16).
  { feePublishedId: 45619, institutionId: 7229, canonicalFeeKey: "check_printing", amount: 20, feeName: "Check printing…………………………………………………......…...…(varies by style) | Domestic",
    reason: "source_mismatch: #1512", issue: 1512, kind: "wrong_amount",
    evidence: "Check printing has no price (\"varies by style\"); the $20.00 is the next column's \"Domestic\" line under outgoing wire transfers." },
  // #1370: two subordination fees the switched re-file holds (SUBORDINATION_REFILE_HELD_VERIFIED_IDS),
  // each read from a two-column fee schedule (read-only, Oct 16). Both prices belong to another row.
  { feePublishedId: 116720, institutionId: 8459, canonicalFeeKey: "other_lending_fee", amount: 20, feeName: "SUBORDINATION REQUEST & PARTIAL: WIRE TRANSFER",
    reason: "source_mismatch: #1370", issue: 1370, kind: "wrong_amount",
    evidence: "Crow Wing Power CU (doc 26125): \"SUBORDINATION REQUEST & PARTIAL RELEASE – $250\"; the $20 is the next row's \"WIRE TRANSFER – $20, Charged per outgoing domestic wire transfer\"." },
  { feePublishedId: 134129, institutionId: 4815, canonicalFeeKey: "other_lending_fee", amount: 10, feeName: "Subordination Fee: Business",
    reason: "source_mismatch: #1370", issue: 1370, kind: "wrong_amount",
    evidence: "Ume FCU (doc 7849): the $10 is the next column's \"Checking Accounts | Business | $10 per month\"; the \"Subordination Fee\" line carries no $10." },
  // #1534 review (read-only, Oct 16): three loan-payment fees filed under other categories.
  { feePublishedId: 48113, institutionId: 7483, canonicalFeeKey: "safe_deposit_box", amount: 25, feeName: "Returned loan payment",
    reason: "source_mismatch: #1534", issue: 1534, kind: "wrong_amount",
    evidence: "Together CU (doc 2048): \"Returned loan payment (excludes credit cards) … $15/payment\"; the $25/year is the next column's \"Size 3x5 $25/year\" safe deposit box." },
  { feePublishedId: 87307, institutionId: 5054, canonicalFeeKey: "ach_return", amount: 25, feeName: "Returned Loan Payment (check or ACH returned unpaid; per item)",
    reason: "source_mismatch: #1534", issue: 1534, kind: "wrong_category",
    evidence: "WF FCU (doc 30721), under \"Loan Account Fees\": \"Returned Loan Payment (check or ACH returned unpaid; per item) | $25.00\", a loan fee; the ACH return fee is its own tiered row (\"ACH Returns: $5 … $15 … $25\")." },
  { feePublishedId: 134962, institutionId: 8566, canonicalFeeKey: "account_research", amount: 29.5, feeName: "Loan Payment with Debit Card - Chargeback",
    reason: "source_mismatch: #1534", issue: 1534, kind: "wrong_category",
    evidence: "Texell CU (doc 29092): \"Loan Payment with Debit Card - Chargeback $29.50 per item\", next to \"Loan Payment with Debit Card - Return Item\": a loan payment fee, not account research." },
  // #1571 (read-only, Oct 16): live $0s whose own schedule row prices them under a condition; each
  // re-read against the stored text by the advisor session and checked by a separate reviewer.
  { feePublishedId: 43512, institutionId: 4669, canonicalFeeKey: "dormant_account", amount: 0, feeName: "Dormant Account Fee Accounts with no activity for 12 months. Dormant accounts with",
    reason: "source_mismatch: #1571", issue: 1571, kind: "wrong_amount",
    evidence: "Jersey Central FCU (doc 3614): \"Dormant Account Fee ... Dormant accounts with $0.00 balance will be closed. | $10.00 per quarter\"; the fee is $10.00 a quarter, $0.00 is the closing balance." },
  { feePublishedId: 54014, institutionId: 8259, canonicalFeeKey: "cashiers_check", amount: 0, feeName: "CASHIER’S CHECKS: first three (3)",
    reason: "source_mismatch: #1571", issue: 1571, kind: "wrong_amount",
    evidence: "Southeast Missouri Community FCU (doc 16700): \"CASHIER’S CHECKS: first three (3) FREE per month, $1.50 thereafter; members only\"." },
  { feePublishedId: 61335, institutionId: 6219, canonicalFeeKey: "monthly_maintenance", amount: 0, feeName: "Standard Checking Monthly Fee - Balance over",
    reason: "source_mismatch: #1571", issue: 1571, kind: "wrong_amount",
    evidence: "Irco Community FCU (doc 18184): \"Balance over $250 | FREE\" and the next row \"Balance under $250 | $10.00\"; a balance band, not the price." },
  { feePublishedId: 68893, institutionId: 8536, canonicalFeeKey: "overdraft", amount: 0, feeName: "Courtesy Pay fees are",
    reason: "source_mismatch: #1571", issue: 1571, kind: "wrong_amount",
    evidence: "Downeast FCU (doc 20241): \"Courtesy Pay fees are $0 for transactions $15 and under and then just $15 per item over $15\"." },
  { feePublishedId: 70121, institutionId: 4197, canonicalFeeKey: "card_replacement", amount: 0, feeName: "Lost Card",
    reason: "source_mismatch: #1571", issue: 1571, kind: "wrong_amount",
    evidence: "Carrollton Federal Bank (doc 25216): \"ATM or Debit Card No Charge For First Card --- $10.00 For Lost Card\"; a lost card is $10.00." },
  { feePublishedId: 73737, institutionId: 6300, canonicalFeeKey: "coin_counting", amount: 0, feeName: "Coin Counting (Mbr up to /Mbr over /Non-Mbr)",
    reason: "source_mismatch: #1571", issue: 1571, kind: "wrong_amount",
    evidence: "Aurora FCU (doc 20537): \"Coin Counting (Mbr up to $100/Mbr over $100/Non-Mbr) | FREE/5%/10%\"; free only for members up to $100." },
  { feePublishedId: 77121, institutionId: 5313, canonicalFeeKey: "check_image", amount: 0, feeName: "Check copy that has cleared (per item) - Online copies are",
    reason: "source_mismatch: #1571", issue: 1571, kind: "wrong_amount",
    evidence: "Lakeshore FCU (doc 18957): \"Check copy that has cleared (per item) - Online copies are FREE up to 12 months old | $5.00\"." },
  { feePublishedId: 77122, institutionId: 5313, canonicalFeeKey: "document_reproduction", amount: 0, feeName: "Statement copies (per statement) - Online copies are",
    reason: "source_mismatch: #1571", issue: 1571, kind: "wrong_amount",
    evidence: "Lakeshore FCU (doc 18957): \"Statement copies (per statement) - Online copies are FREE up to 18 months | $5.00\"." },
  { feePublishedId: 77618, institutionId: 7383, canonicalFeeKey: "coin_counting", amount: 0, feeName: "Coin Counting, Free for Kids Club Member or for amounts less than",
    reason: "source_mismatch: #1571", issue: 1571, kind: "wrong_amount",
    evidence: "Members First FCU (doc 16105): \"2.00% of amount | Coin Counting, Free for Kids Club Member or for amounts less than $50.00\"." },
  { feePublishedId: 84553, institutionId: 8221, canonicalFeeKey: "collection_item", amount: 0, feeName: "Foreign Check Deposit (below $10,000)",
    reason: "source_mismatch: #1571", issue: 1571, kind: "wrong_amount",
    evidence: "First Community FCU (doc 6206): \"Foreign Check Deposit (below $10,000) ....FREE\" and \"Foreign Check Deposit ($10,000 or more) .... $125.00\"; an amount band." },
  { feePublishedId: 87079, institutionId: 7736, canonicalFeeKey: "notary_fee", amount: 0, feeName: "Notary Public – (per notarized document)",
    reason: "source_mismatch: #1571", issue: 1571, kind: "wrong_amount",
    evidence: "Del Norte FCU (doc 21594): \"Notary Public – (per notarized document)- FREE for members $5.00\"." },
  { feePublishedId: 87461, institutionId: 8259, canonicalFeeKey: "document_reproduction", amount: 0, feeName: "FAX TRANSMISSION: first five (5) pages",
    reason: "source_mismatch: #1571", issue: 1571, kind: "wrong_amount",
    evidence: "Southeast Missouri Community FCU (doc 16700): \"FAX TRANSMISSION: first five (5) pages FREE per month, $1.00 per page thereafter\"." },
  { feePublishedId: 88213, institutionId: 4236, canonicalFeeKey: "monthly_maintenance", amount: 0, feeName: "Service charge",
    reason: "source_mismatch: #1571", issue: 1571, kind: "wrong_amount",
    evidence: "Citizens State Bank (doc 19551): \"No Charge\" only \"if a minimum balance of $100.00 is maintained\"; \"$5.00\" if it is NOT maintained." },
  { feePublishedId: 91505, institutionId: 4808, canonicalFeeKey: "cashiers_check", amount: 0, feeName: "Third-Party Official Check – Over",
    reason: "source_mismatch: #1571", issue: 1571, kind: "wrong_amount",
    evidence: "NCPD FCU (doc 21964): \"Third-Party Official Check – Over $3,000 | No Charge\" and \"Under $3,000 | $3.00\"; an amount band." },
  { feePublishedId: 120559, institutionId: 5313, canonicalFeeKey: "cashiers_check", amount: 0, feeName: "Cashier's checks - One",
    reason: "source_mismatch: #1571", issue: 1571, kind: "wrong_amount",
    evidence: "Lakeshore FCU (doc 3367): \"Cashier's checks - One FREE check per month (additonal checks each) | $1.00\"." },
  // #1512 (James approved, Oct 16 03:37 UTC, roadmap item 3.8): a joined row whose own price is
  // not the overdraft fee. The other seven #1512/#1513 rows are renamed or re-filed in place
  // (taxonomy-fold HAND_REFILES).
  { feePublishedId: 142965, institutionId: 4965, canonicalFeeKey: "overdraft", amount: 10, feeName: "Courtesy Pay Fee (per transaction) Research & Reconcilement (per hour)",
    reason: "source_mismatch: #1512", issue: 1512, kind: "wrong_amount",
    evidence: "Access FCU (doc 33871): \"Courtesy Pay Fee (per transaction) ……Research & Reconcilement (per hour)…. $10.00$25.00\" joins two lines; the bank's fee table (doc 26372) prints \"Courtesy Pay Fee | $25.00\" and \"Research & Reconcilement (per hour) | $10.00\", so $10 is not the courtesy pay fee." },
  // #1302 leftovers (read-only, Oct 16): near-name pairs the near-name collapse keeps apart. 13188
  // repeats a live read of one printed fee; 144352 (and 114273, the same line on an older copy of
  // the page) publish a rate fee's $35 floor as a flat fee; 114270 reads the page's line-of-credit
  // "$35.00 or 5%" line as a flat $35.
  { feePublishedId: 13188, institutionId: 44, canonicalFeeKey: "gift_card_purchase", amount: 4.25, feeName: "Visa Gift Card",
    reason: "duplicate of #103400 (#1302)", issue: 1302, kind: "duplicate",
    evidence: "Valley (doc 23731, text 20802) prints \"Visa® Gift Cards, each: $4.25.\" once per schedule; 103400 is the Oct 9 read of it. 13188 is the Apr 17 load (raw 5056: no excerpt, no source URL) of the same fee, and the page has no \"Visa Gift Card\" line." },
  { feePublishedId: 144352, institutionId: 6152, canonicalFeeKey: "late_payment", amount: 35, feeName: "Late payment fees",
    reason: "source_mismatch: #1302", issue: 1302, kind: "wrong_amount",
    evidence: "Patriot FCU (doc 34341, text 32389), Flex Equity Line: \"Late payment fees of 5% of the monthly payment or $35.00 whichever is greater\": $35 is the floor of a 5% fee, live as rate fee 114271 (5%, min $35), not a flat $35 a month." },
  { feePublishedId: 114273, institutionId: 6152, canonicalFeeKey: "late_payment", amount: 35, feeName: "Late payment fees",
    reason: "source_mismatch: #1302", issue: 1302, kind: "wrong_amount",
    evidence: "Patriot FCU (doc 21882, text 18514, the Oct 8 copy of the same rates page): the same \"Late payment fees of 5% of the monthly payment or $35.00 whichever is greater\" line read as a flat $35; the 5% fee is live as 114271." },
  { feePublishedId: 114270, institutionId: 6152, canonicalFeeKey: "late_payment", amount: 35, feeName: "Late payment fee",
    reason: "source_mismatch: #1302", issue: 1302, kind: "wrong_amount",
    evidence: "Patriot FCU (doc 34341, text 32389), the line of credit on the same rates page: \"Late payment fee of $35.00 or 5% of the minimum payment may apply\": the fee is $35 or 5% of the payment, not a flat $35." },
  // #1655 (read-only, Oct 16): rows the consumer overdraft guide showed, each read against its own
  // stored text. 5827 repeats the continuous overdraft charge as a daily OD/NSF cap; 84637 puts the
  // personal small-item price on the business line. Primis's 5600 is corrected in place instead
  // (hand-amount-corrections.ts): it is the bank's only live overdraft row.
  { feePublishedId: 5827, institutionId: 1968, canonicalFeeKey: "od_daily_cap", amount: 3.29, feeName: "Continuous Overdraft Charge Daily Cap",
    reason: "duplicate of #43265 (#1655)", issue: 1655, kind: "duplicate",
    evidence: "Welch State Bank (doc 809, text 6350): \"Continuous Overdraft Charge* daily limit not to exceed..$3.29\" is the continuous overdraft charge, live as continuous_od 43265; the OD/NSF cap is \"NSF/OD Fees* daily limit not to exceed…$179.82\" (live as 5825)." },
  { feePublishedId: 84637, institutionId: 97, canonicalFeeKey: "overdraft", amount: 10, feeName: "Overdraft or Returned Item fee (business accounts)",
    reason: "source_mismatch: #1655", issue: 1655, kind: "wrong_amount",
    evidence: "Mechanics Bank (doc 9078, text 2235): \"Overdraft or Returned Item fee (business accounts)…$35.00/presentment\" (live as 125484); the $10 is the personal line \"…for any item $10 or less… (personal accounts)1…$10.00/presentment\"." },
  // #1659 (read-only, Oct 16): rows James saw in the guide comparisons. U.S. Bank's brokerage fees
  // page is not a deposit schedule (the 50 have no brokerage type); 102973 repeats the Bank Smartly
  // fee that 102971 carries once corrected (hand-amount-corrections.ts); 15727 is Navy Federal's
  // credit card cash advance price filed as an ATM fee.
  { feePublishedId: 104565, institutionId: 5, canonicalFeeKey: "nsf", amount: 30, feeName: "Returned check",
    reason: "source_mismatch: #1659", issue: 1659, kind: "wrong_category",
    evidence: "U.S. Bank brokerage fees page (doc 34203, text 32252), under \"Additional brokerage account fees\": \"Returned check | $30 per occurrence\", a self-directed brokerage account fee, not a deposit NSF." },
  { feePublishedId: 104566, institutionId: 5, canonicalFeeKey: "stop_payment", amount: 25, feeName: "Stop payment",
    reason: "source_mismatch: #1659", issue: 1659, kind: "wrong_category",
    evidence: "U.S. Bank brokerage fees page (doc 34203, text 32252), the same table: \"Stop payment | $25 per occurrence\", a brokerage account fee, not a deposit account's stop payment." },
  { feePublishedId: 102973, institutionId: 5, canonicalFeeKey: "monthly_maintenance", amount: 12, feeName: "Monthly maintenance fee",
    reason: "duplicate of #102971 (#1659)", issue: 1659, kind: "duplicate",
    requiresLive: { feePublishedId: 102971, amount: 12, feeName: "Bank Smartly Checking Monthly Maintenance Fee" },
    evidence: "U.S. Bank student checking page (doc 23630, text 20684) prints the $12 only as waived: \"For young adults and students (18 - 24 years old), we always waive the $12 Monthly Maintenance Fee.\" The Bank Smartly Checking price is 102971 (checking-accounts.html, \"$12 Monthly Maintenance Fee can be waived in multiple ways1\")." },
  { feePublishedId: 15727, institutionId: 4956, canonicalFeeKey: "atm_non_network", amount: 1, feeName: "plus ATM owner fees",
    reason: "source_mismatch: #1659", issue: 1659, kind: "wrong_category",
    evidence: "Navy Federal (doc 13439, text 890, the Oct 3 copy of fees-and-charges): \"Credit card cash advance§ / None / $0.50 / $1.00 plus ATM owner fees\": a credit card cash advance at a non-network ATM, named by the price's trailing words; not an ATM use fee." },
  // #1664 (read-only, Oct 16): First National Bank Alaska's Direct Deposit Checking fee, read at $0
  // from its waiver line. The account's price is $7.00, live once already as 125197 from the bank's
  // checking page; correcting this row to $7 would leave a second copy under another name and page,
  // which no duplicate collapse removes. It comes down only while 125197 is live at $7.
  { feePublishedId: 67859, institutionId: 281, canonicalFeeKey: "monthly_maintenance", amount: 0, feeName: "Monthly Service Fee with 1 direct deposit per",
    reason: "duplicate of #125197 (#1664)", issue: 1664, kind: "duplicate",
    requiresLive: { feePublishedId: 125197, amount: 7, feeName: "Monthly Service Fees" },
    evidence: "FNB Alaska personal fee schedule (doc 19925, text 15731): \"Direct Deposit Checking | per statement cycle\" / \"Monthly Service Fee | $7.00\" / \"Monthly Service Fee with 1 direct deposit per | Waived\"; the $0 is the waiver, not the price. The $7 is live as 125197 (checking page, doc 33839): \"Monthly Service Fees | $7, waived each statement cycle with a direct deposit.\"" },
  // #1661 (read-only, Oct 16): Beacon Community FCU's garnishment fee, live from two documents. Doc
  // 30627 is the 2022 rate and fee disclosure PDF ("Last Updated 04/01/2022", Last-Modified Jul 18
  // 2022); doc 35662 is the bank's fee schedule page (its registered fee_schedule_url, fetched Oct
  // 16, rates "as of 07/01/2025"), which supersedes every earlier copy of that page. The $34 is the
  // old price; it comes down only while the current $36 row (112876) is live as listed.
  { feePublishedId: 138829, institutionId: 7204, canonicalFeeKey: "garnishment_levy", amount: 34, feeName: "Judicial Attachment (Garnishment)",
    reason: "duplicate of #112876 (#1661)", issue: 1661, kind: "duplicate",
    requiresLive: { feePublishedId: 112876, amount: 36, feeName: "Judicial Attachment (Garnishment)" },
    evidence: "Beacon Community FCU: the 2022 disclosure PDF (doc 30627, text 28238, \"Last Updated 04/01/2022\") prints \"Judicial Attachment (Garnishment) $34.00\"; the current fee schedule page (doc 35662, text 33767, fetched Oct 16, rates as of 07/01/2025) prints \"Judicial Attachment (Garnishment) | $36.00 per attachment\", live as 112876." },
  // #1196 (read-only, Oct 16): the two category questions left after the #1459 renames. Neither fee
  // has a home among the 50: an own-ATM charge is not what a customer pays at another network's
  // ATM (fee-fold's `ownAtmSection` gives the bank's own ATM no home), and a gift card's inactivity
  // fee is neither a dormant deposit account nor a gift card purchase (the category guard refuses
  // its name under gift_card_purchase: name_contradicts on "Inactiv"). Each price is right for its line, so neither is re-priced.
  { feePublishedId: 131129, institutionId: 5100, canonicalFeeKey: "atm_non_network", amount: 2, feeName: "ATM Transactions at DFCU ATM (Local ATM)",
    reason: "source_mismatch: #1196", issue: 1196, kind: "wrong_category",
    evidence: "Dynamic FCU (doc 28876, text 26315): \"ATM Transactions at DFCU ATM (Local ATM) | 15 free ATM transactions per month and 15 free balance inquiries per month; then $2.00/transaction or balance inquiry\": the credit union's own ATMs, not a non-network ATM fee (that line is \"ATM Transactions at Non-DFCU ATM (Out of Network/Foreign ATM)\")." },
  { feePublishedId: 70319, institutionId: 986, canonicalFeeKey: "dormant_account", amount: 2.95, feeName: "VISA Gift Card Inactivity Fee",
    reason: "source_mismatch: #1196", issue: 1196, kind: "wrong_category",
    evidence: "Bank Forward (doc 20361, text 16150), under MISCELLANEOUS SERVICES: \"VISA Gift Card – Inactivity Fee after 12 Months of Inactivity $2.95/month\": a gift card's fee, not a dormant deposit account (the bank's dormant account fees are 70302 and 105451, $5.00)." },
  // #1666 (read-only, Oct 16): North Central Area FCU's PDF reads its fee names as one run-together
  // line and its prices as another column. The row's name is that line; its $10 is the money
  // market's excessive withdrawal on the same line (live as 130870), not an overdraft transfer.
  { feePublishedId: 140689, institutionId: 7363, canonicalFeeKey: "od_protection_transfer", amount: 10,
    feeName: "See How to avoid them next to the listed fee.Checking AccountsAutomatic Overdraft TransferCopy of DraftCourtesy PayForei",
    reason: "source_mismatch: #1666", issue: 1666, kind: "wrong_amount",
    evidence: "North Central Area FCU (doc 31668, text 29547): names \"…Checking AccountsAutomatic Overdraft TransferCopy of DraftCourtesy PayForeign Check Processing…Money Market Excessive Withdrawal $10.00/withdrawal…\", prices \"Fee$5.00/transfer$5.00$30.00/item…\": the overdraft transfer is $5.00/transfer (live as 41322); the only $10 on the line is the money market's (live as 130870)." },
  // #1668 (read-only, Oct 16): Beacon Community FCU's other rows from documents its current fee
  // schedule page (doc 35662) replaces. The 2022 PDF's $34 prices are now $36; its same-price rows
  // and an Oct 10 copy of the page double-count fees the current page carries; the 2025 PDF (doc
  // 30629) lost every digit after "$3", so its rows read $3 for fees the page prices at $36. Each
  // copy comes down only while the current row it repeats is live as listed.
  { feePublishedId: 138828, institutionId: 7204, canonicalFeeKey: "deposited_item_return", amount: 34, feeName: "Return Deposit Item (1 party)",
    reason: "duplicate of #112893 (#1668)", issue: 1668, kind: "duplicate",
    requiresLive: { feePublishedId: 112893, amount: 36, feeName: "Return Deposit Item (1 party)" },
    evidence: "Beacon 2022 disclosure PDF (doc 30627, text 28238, \"Last Updated 04/01/2022\"): \"Return Deposit Item (1 party) $34.00\"; the current fee schedule page (doc 35662, text 33767, fetched Oct 16): \"Return Deposit Item (1 party) | $36.00 per item\", live as 112893." },
  { feePublishedId: 138832, institutionId: 7204, canonicalFeeKey: "nsf", amount: 34, feeName: "NSF DRAFT, NSF ACH item, or NSF Bill Pay",
    reason: "duplicate of #112881 (#1668)", issue: 1668, kind: "duplicate",
    requiresLive: { feePublishedId: 112881, amount: 36, feeName: "NSF Draft, NSF ACH item or NSF Bill Pay item" },
    evidence: "Beacon 2022 disclosure PDF (doc 30627, text 28238, \"Last Updated 04/01/2022\"): \"NSF DRAFT, NSF ACH item, or NSF Bill Pay $34.00\"; the current fee schedule page (doc 35662, text 33767, fetched Oct 16): \"NSF Draft, NSF ACH item or NSF Bill Pay item | $36.00 per item\", live as 112881." },
  { feePublishedId: 138833, institutionId: 7204, canonicalFeeKey: "nsf", amount: 34, feeName: "NSF/Overdrawn ATM Withdrawal",
    reason: "duplicate of #112915 (#1668)", issue: 1668, kind: "duplicate",
    requiresLive: { feePublishedId: 112915, amount: 36, feeName: "NSF/Overdrawn ATM Withdrawal" },
    evidence: "Beacon 2022 disclosure PDF (doc 30627, text 28238, \"Last Updated 04/01/2022\"): \"NSF/Overdrawn ATM Withdrawal $34.00\"; the current fee schedule page (doc 35662, text 33767, fetched Oct 16): \"NSF/Overdrawn ATM Withdrawal | $36.00 per item\", live as 112915." },
  { feePublishedId: 138839, institutionId: 7204, canonicalFeeKey: "overdraft", amount: 34, feeName: "Courtesy Pay fee (if applicable)",
    reason: "duplicate of #112887 (#1668)", issue: 1668, kind: "duplicate",
    requiresLive: { feePublishedId: 112887, amount: 36, feeName: "Courtesy Pay Fee (if applicable)" },
    evidence: "Beacon 2022 disclosure PDF (doc 30627, text 28238, \"Last Updated 04/01/2022\"): \"Courtesy Pay fee (if applicable) $34.00\"; the current fee schedule page (doc 35662, text 33767, fetched Oct 16): \"Courtesy Pay Fee (if applicable) | $36.00 per item\", live as 112887." },
  { feePublishedId: 138827, institutionId: 7204, canonicalFeeKey: "deposited_item_return", amount: 34, feeName: "Return Deposit Item",
    reason: "source_mismatch: #1668", issue: 1668, kind: "wrong_amount",
    requiresLive: { feePublishedId: 112892, amount: 15, feeName: "Return Deposit Item (2 party)" },
    evidence: "Beacon 2022 disclosure PDF (doc 30627, text 28238, \"Last Updated 04/01/2022\"): \"Return Deposit Item from Shared Branch $34.00\" / \"Return Deposit Item (2 party) $34.00\"; the current fee schedule page (doc 35662, text 33767, fetched Oct 16) has no shared-branch return line and prints \"Return Deposit Item (2 party) | $15.00 per item\", live as 112892: no current return item fee is $34." },
  { feePublishedId: 138834, institutionId: 7204, canonicalFeeKey: "card_replacement", amount: 10, feeName: "Fees: Replacement Card",
    reason: "duplicate of #112883 (#1668)", issue: 1668, kind: "duplicate",
    requiresLive: { feePublishedId: 112883, amount: 10, feeName: "Replacement Card" },
    evidence: "Beacon 2022 disclosure PDF (doc 30627, text 28238, \"Last Updated 04/01/2022\"): \"Replacement Card $10.00\" under ATM and debit card services; the current fee schedule page (doc 35662, text 33767, fetched Oct 16): \"Replacement Card | $10.00 per card\", live as 112883." },
  { feePublishedId: 138841, institutionId: 7204, canonicalFeeKey: "counter_check", amount: 3, feeName: "Starter/Temporary Checks",
    reason: "duplicate of #112895 (#1668)", issue: 1668, kind: "duplicate",
    requiresLive: { feePublishedId: 112895, amount: 3, feeName: "Starter/Temporary Checks" },
    evidence: "Beacon 2022 disclosure PDF (doc 30627, text 28238, \"Last Updated 04/01/2022\"): \"Starter/Temporary Checks $3.00\"; the current fee schedule page (doc 35662, text 33767, fetched Oct 16): \"Starter/Temporary Checks | $3.00 per sheet\", live as 112895." },
  { feePublishedId: 148352, institutionId: 7204, canonicalFeeKey: "counter_check", amount: 3, feeName: "Starter/Temporary Checks",
    reason: "duplicate of #112895 (#1668)", issue: 1668, kind: "duplicate",
    requiresLive: { feePublishedId: 112895, amount: 3, feeName: "Starter/Temporary Checks" },
    evidence: "Beacon fee schedule page, Oct 10 copy (doc 25830, superseded by doc 35662): \"Starter/Temporary Checks | $3.00 per sheet\"; the current copy (doc 35662, text 33767) prints the same line, live as 112895." },
  { feePublishedId: 138831, institutionId: 7204, canonicalFeeKey: "wire_domestic_outgoing", amount: 20, feeName: "Wire Transfer Out fee",
    reason: "duplicate of #112877 (#1668)", issue: 1668, kind: "duplicate",
    requiresLive: { feePublishedId: 112877, amount: 20, feeName: "Wire transfer (domestic) Outgoing" },
    evidence: "Beacon 2022 disclosure PDF (doc 30627, text 28238, \"Last Updated 04/01/2022\"): \"Wire Transfer Out fee $20.00\", its only outgoing wire line; the current fee schedule page (doc 35662, text 33767, fetched Oct 16): \"Wire transfer (domestic) Outgoing | $20.00 per wire\", live as 112877." },
  { feePublishedId: 138830, institutionId: 7204, canonicalFeeKey: "document_reproduction", amount: 4, feeName: "Minimum Balance Requirements: 3 months’ dividends on the deposit; on certificates of greater than: Document Copy",
    reason: "duplicate of #112894 (#1668)", issue: 1668, kind: "duplicate",
    requiresLive: { feePublishedId: 112894, amount: 4, feeName: "Document Copy" },
    evidence: "Beacon 2022 disclosure PDF (doc 30627, text 28238, \"Last Updated 04/01/2022\"): \"Minimum Balance Requirements | 3 months’ dividends on the deposit; on certificates of greater than | Document Copy $4.00\" (two cells of another column joined to the name); the current fee schedule page (doc 35662, text 33767, fetched Oct 16): \"Document Copy | $4.00 per item\", live as 112894." },
  { feePublishedId: 138848, institutionId: 7204, canonicalFeeKey: "atm_non_network", amount: 3, feeName: "ATM SERVICE FEESInitial CardNSF/Overdrawn ATM Withdrawal",
    reason: "source_mismatch: #1668", issue: 1668, kind: "wrong_amount",
    evidence: "Beacon 2025 fee PDF (doc 30629, text 28236), which drops every digit after \"$3\" (\"Judicial Attachment (Garnishment) ....$3\", \"Negative Balance Fee .... up to $3\"): \"ATM SERVICE FEESInitial CardNSF/Overdrawn ATM Withdrawal ....$3\"; the current fee schedule page (doc 35662, text 33767, fetched Oct 16): \"NSF/Overdrawn ATM Withdrawal | $36.00 per item\" (live as 112915), an NSF fee, not a $3 ATM fee." },
  { feePublishedId: 138849, institutionId: 7204, canonicalFeeKey: "cashiers_check", amount: 3, feeName: "Paper statement feeSAVINGS SERVICESCertified Checks/Official Checks-MembersCertified Checks/Official Checks-Non-MembersV",
    reason: "source_mismatch: #1668", issue: 1668, kind: "wrong_amount",
    evidence: "Beacon 2025 fee PDF (doc 30629, text 28236), which drops every digit after \"$3\" (\"Judicial Attachment (Garnishment) ....$3\", \"Negative Balance Fee .... up to $3\"): names run together from \"Paper statement fee\" to \"Visa Gift Cards…Return Deposit Item from Shared Branch....$3\"; the current fee schedule page (doc 35662, text 33767, fetched Oct 16): \"Certified Checks/Official Checks-Members | $5.00 per item\" and \"-Non-Members | $10.00 per item\" (live as 112889, 112890); no cashier's check is $3." },
  { feePublishedId: 138850, institutionId: 7204, canonicalFeeKey: "deposited_item_return", amount: 3, feeName: "Return Deposit Item (2 party)Return Deposit Item (1 party)",
    reason: "source_mismatch: #1668", issue: 1668, kind: "wrong_amount",
    evidence: "Beacon 2025 fee PDF (doc 30629, text 28236), which drops every digit after \"$3\" (\"Judicial Attachment (Garnishment) ....$3\", \"Negative Balance Fee .... up to $3\"): \"Return Deposit Item (2 party)Return Deposit Item (1 party) ....$3\"; the current fee schedule page (doc 35662, text 33767, fetched Oct 16): \"Return Deposit Item (2 party) | $15.00 per item\" and \"(1 party) | $36.00 per item\" (live as 112892, 112893)." },
  { feePublishedId: 138851, institutionId: 7204, canonicalFeeKey: "deposited_item_return", amount: 3, feeName: "Return Deposit Item from Shared Branch",
    reason: "source_mismatch: #1668", issue: 1668, kind: "wrong_amount",
    evidence: "Beacon 2025 fee PDF (doc 30629, text 28236), which drops every digit after \"$3\" (\"Judicial Attachment (Garnishment) ....$3\", \"Negative Balance Fee .... up to $3\"): \"Return Deposit Item from Shared Branch....$3\"; the 2022 PDF prints it at \"$34.00\" (doc 30627) and the current fee schedule page (doc 35662, text 33767, fetched Oct 16) no longer prints the line: $3 is a cut price." },
];

export interface LiveTakedownRow {
  fee_published_id: number | string;
  lineage_ref: number | string | null;
  institution_id: number | string;
  canonical_fee_key: string;
  fee_name: string;
  amount: number | string | null;
}

export interface PlannedHandTakedown {
  feePublishedId: number;
  feeVerifiedId: number | null;
  reason: string;
}

export interface HandTakedownResult {
  dryRun: boolean;
  takenDown: PlannedHandTakedown[];
  /** Listed rows left alone, with why (not live, or changed since it was listed). */
  skipped: Array<{ feePublishedId: number; reason: string }>;
  /** A failed read or write (nothing written); also a `step.warning` run event. */
  error: string | null;
}

/** Pure: how many listed entries each batch (issue) holds, largest first. */
export function handTakedownBatchSizes(list: readonly HandTakedown[] = HAND_TAKEDOWNS): Array<{ issue: number; entries: number }> {
  const sizes = new Map<number, number>();
  for (const entry of list) sizes.set(entry.issue, (sizes.get(entry.issue) ?? 0) + 1);
  return [...sizes].map(([issue, entries]) => ({ issue, entries })).sort((a, b) => b.entries - a.entries || a.issue - b.issue);
}

const sameAmount = (a: number | string | null, b: number) => a != null && Math.abs(Number(a) - b) < 0.005;

/** Pure: which listed rows come down, from their live rows. */
export function planHandTakedowns(live: LiveTakedownRow[], list: readonly HandTakedown[] = HAND_TAKEDOWNS): Pick<HandTakedownResult, "takenDown" | "skipped"> {
  const byId = new Map(live.map((row) => [Number(row.fee_published_id), row]));
  const takenDown: PlannedHandTakedown[] = [];
  const skipped: HandTakedownResult["skipped"] = [];
  for (const entry of list) {
    const row = byId.get(entry.feePublishedId);
    if (!row) {
      skipped.push({ feePublishedId: entry.feePublishedId, reason: "not live" });
      continue;
    }
    if (Number(row.institution_id) !== entry.institutionId || row.canonical_fee_key !== entry.canonicalFeeKey ||
        row.fee_name !== entry.feeName || !sameAmount(row.amount, entry.amount)) {
      skipped.push({ feePublishedId: entry.feePublishedId, reason: "changed since listed" });
      continue;
    }
    if (entry.requiresLive) {
      const needed = byId.get(entry.requiresLive.feePublishedId);
      if (!needed || needed.fee_name !== entry.requiresLive.feeName || !sameAmount(needed.amount, entry.requiresLive.amount)) {
        skipped.push({ feePublishedId: entry.feePublishedId, reason: `waiting on #${entry.requiresLive.feePublishedId}` });
        continue;
      }
    }
    takenDown.push({ feePublishedId: entry.feePublishedId, feeVerifiedId: row.lineage_ref == null ? null : Number(row.lineage_ref), reason: entry.reason });
  }
  return { takenDown, skipped };
}

/**
 * Runs in the publish step. A dry run reports what it would take down and writes nothing. Never
 * blocks the step it runs in.
 */
export async function applyHandTakedowns(
  db: SqlTag,
  options: { runId: number; stepId?: number | null; batchId: string; dryRun: boolean; list?: readonly HandTakedown[] },
): Promise<HandTakedownResult> {
  const list = options.list ?? HAND_TAKEDOWNS;
  const result: HandTakedownResult = { dryRun: options.dryRun, takenDown: [], skipped: [], error: null };
  if (list.length === 0) return result;
  // Each listed row, and each live row an entry waits on (`requiresLive`).
  const ids = [...new Set(list.flatMap((entry) => entry.requiresLive ? [entry.feePublishedId, entry.requiresLive.feePublishedId] : [entry.feePublishedId]))];
  let live: LiveTakedownRow[];
  try {
    live = await inSavepoint(db, (scope) => scope<LiveTakedownRow[]>`
      SELECT fp.fee_published_id, fp.lineage_ref, fp.institution_id, fp.canonical_fee_key, fp.fee_name, fp.amount
        FROM published_fee_records fp
       WHERE fp.fee_published_id = ANY(${ids}::bigint[])
         AND fp.rolled_back_at IS NULL
    `);
  } catch (error) {
    console.error("hand takedowns read failed:", error);
    return { ...result, error: await recordStepWarning(db, { runId: options.runId, stepId: options.stepId, check: HAND_TAKEDOWN_CHECK, what: "Hand takedowns read", error }) };
  }
  const plan = planHandTakedowns(live, list);
  result.skipped = plan.skipped;
  if (options.dryRun) return { ...result, takenDown: plan.takenDown };
  if (plan.takenDown.length === 0) return result;

  try {
    await inSavepoint(db, async (scope) => {
      for (const item of plan.takenDown) {
        const entry = list.find((candidate) => candidate.feePublishedId === item.feePublishedId)!;
        const updated = await scope<{ fee_published_id: number | string }[]>`
          UPDATE published_fee_records
             SET rolled_back_at = NOW(),
                 rolled_back_by_batch_id = ${options.batchId},
                 rolled_back_reason = ${entry.reason}
           WHERE fee_published_id = ${item.feePublishedId}
             AND rolled_back_at IS NULL
             AND institution_id = ${entry.institutionId}
             AND canonical_fee_key = ${entry.canonicalFeeKey}
             AND fee_name = ${entry.feeName}
             AND abs(amount - ${entry.amount}::numeric) < 0.005
          RETURNING fee_published_id
        `;
        if (updated.length === 0) continue;
        if (item.feeVerifiedId != null) {
          await scope`
            UPDATE verified_fee_observations
               SET review_status = 'rejected',
                   outlier_flags = CASE WHEN outlier_flags ? ${HAND_TAKEDOWN_FLAG} THEN outlier_flags
                                        ELSE COALESCE(outlier_flags, '[]'::jsonb) || jsonb_build_array(${HAND_TAKEDOWN_FLAG}::text) END
             WHERE fee_verified_id = ${item.feeVerifiedId}
               AND review_status IN ('verified', 'approved')
          `;
        }
        result.takenDown.push(item);
      }
      const feedback: FeedbackRow[] = result.takenDown.map((item) => {
        const entry = list.find((candidate) => candidate.feePublishedId === item.feePublishedId)!;
        return {
          aboutStage: "extract" as const,
          signal: "wrong" as const,
          kind: entry.kind,
          reportedBy: "gutenberg" as const,
          checkName: HAND_TAKEDOWN_CHECK,
          institutionId: entry.institutionId,
          feeVerifiedId: item.feeVerifiedId,
          feePublishedId: item.feePublishedId,
          canonicalFeeKey: entry.canonicalFeeKey,
          amount: entry.amount,
          runId: options.runId,
          dedupeKey: `${HAND_TAKEDOWN_CHECK}:pub:${item.feePublishedId}`,
          evidence: { fee_name: entry.feeName, reason: entry.reason, issue: entry.issue, source: entry.evidence },
        };
      });
      if (feedback.length > 0) await recordFeedback(scope, feedback);
      if (result.takenDown.length > 0) {
        await scope`
          INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
          VALUES (
            ${options.runId}, ${options.stepId ?? null}, ${HAND_TAKEDOWN_CHECK}, 'completed',
            ${`Took down ${result.takenDown.length} listed live fee(s) confirmed wrong against their bank's own text`},
            ${JSON.stringify({
              taken_down: result.takenDown.map((item) => ({ fee_published_id: item.feePublishedId, fee_verified_id: item.feeVerifiedId, reason: item.reason })),
              skipped: result.skipped,
            })}::jsonb
          )
        `;
      }
    });
  } catch (error) {
    console.error("hand takedowns write failed:", error);
    return { ...result, takenDown: [], error: await recordStepWarning(db, { runId: options.runId, stepId: options.stepId, check: HAND_TAKEDOWN_CHECK, what: "Hand takedowns write", error }) };
  }
  if (result.takenDown.length > 0) invalidatePublicReadCache();
  return result;
}

/**
 * Hand audience fixes (#1302): a short, reviewed list of live fees whose audience is wrong against
 * their bank's own stored text, under the same Oct 16 rule as the takedowns above. The fee stays
 * live; only its audience changes.
 *
 * A fixed list, not an audience editor. A row is fixed only while it still reads as listed (live,
 * same verified row, institution, category, name and price, and still the listed old audience).
 * The verified row takes the new audience with `darwin:` evidence, which the audience trigger keeps
 * (migration 20270110000047), and the live row is touched so it inherits it, as the audience
 * relabel does (`darwin/audience-relabel.ts`). The old value goes to `pipeline_feedback` first
 * (weight 0, a record, not a lesson): setting the verified row back to that audience and evidence
 * and touching the live row undoes it. Running it again changes nothing. Add later rows below as
 * one entry each. A failed read or write never fails the publish: it is kept in the result
 * (`error`) and as a `step.warning` run event.
 */
export const HAND_AUDIENCE_CHECK = "hamilton.hand_audience_fix";
export const HAND_AUDIENCE_KIND = "audience_hand_fixed";
export const HAND_AUDIENCE_EVIDENCE_PREFIX = "darwin:hand_fix";

type ListedAudience = "consumer" | "business" | "both";

export interface HandAudienceFix {
  feePublishedId: number;
  feeVerifiedId: number;
  institutionId: number;
  canonicalFeeKey: string;
  amount: number;
  /** The name the live row carries now. */
  feeName: string;
  /** The verified row's audience now. */
  from: ListedAudience | "unknown";
  to: ListedAudience;
  /** The issue that holds the evidence. */
  issue: number;
  /** What the bank's own text says, in one line. */
  evidence: string;
}

export const HAND_AUDIENCE_FIXES: readonly HandAudienceFix[] = [
  // #1302 (read-only, Oct 16): Rave FCU prints its consumer and business schedules in one document.
  { feePublishedId: 55401, feeVerifiedId: 45477, institutionId: 8652, canonicalFeeKey: "gift_card_purchase", amount: 5, feeName: "Gift Cards",
    from: "unknown", to: "business", issue: 1302,
    evidence: "Rave (doc 2183, text 9544): \"Gift Cards | $ 5.00\" is under \"2019 Business Fee Schedule\"; the consumer schedule's line is \"Gift Card | $5.00\" (55397)." },
  // #1655 (read-only, Oct 16): Mechanics Bank prints personal and business lines side by side; these
  // two business rows showed in the consumer overdraft guide.
  { feePublishedId: 67110, feeVerifiedId: 77129, institutionId: 97, canonicalFeeKey: "od_daily_cap", amount: 350,
    feeName: "Maximum daily Overdraft or Returned Item fees (per day, business accounts)", from: "unknown", to: "business", issue: 1655,
    evidence: "Mechanics Bank (doc 9078, text 2235): \"Maximum daily Overdraft or Returned Item fees (per day, business accounts)…$350.00\"; the personal cap is $140.00 (67109)." },
  { feePublishedId: 125484, feeVerifiedId: 93865, institutionId: 97, canonicalFeeKey: "overdraft", amount: 35,
    feeName: "Overdraft or Returned Item fee (business accounts)", from: "unknown", to: "business", issue: 1655,
    evidence: "Mechanics Bank (doc 9078, text 2235): \"Overdraft or Returned Item fee (business accounts)…$35.00/presentment\"." },
  // #1664 (read-only, Oct 16): Bank Iowa's ag checking page (doc 31875) prints one table of four
  // business accounts for farms ("Bank Iowa Business Checking Accounts - For Ag"); both live rows
  // from it are business fees.
  { feePublishedId: 141041, feeVerifiedId: 166941, institutionId: 511, canonicalFeeKey: "monthly_maintenance", amount: 20,
    feeName: "Monthly service charge", from: "unknown", to: "business", issue: 1664,
    evidence: "Bank Iowa (doc 31875, text 29776): \"Bank Iowa Business Checking Accounts - For Ag\"; \"Monthly Service Charge | … | $20\" is the Commercial Checking for Ag column." },
  { feePublishedId: 141040, feeVerifiedId: 166940, institutionId: 511, canonicalFeeKey: "monthly_maintenance", amount: 10,
    feeName: "Monthly Service Charge", from: "unknown", to: "business", issue: 1664,
    evidence: "Bank Iowa (doc 31875, text 29776): \"Bank Iowa Business Checking Accounts - For Ag\"; \"$10 monthly service charge\" is the Business Checking for Ag and Interest Checking for Ag columns." },
];

export interface LiveAudienceRow {
  fee_published_id: number | string;
  lineage_ref: number | string | null;
  institution_id: number | string;
  canonical_fee_key: string;
  fee_name: string;
  amount: number | string | null;
  /** The verified row's audience and evidence. */
  fee_audience: string | null;
  audience_evidence: string | null;
}

export interface PlannedAudienceFix {
  feePublishedId: number;
  feeVerifiedId: number;
  from: string;
  fromEvidence: string | null;
  to: ListedAudience;
}

export interface HandAudienceResult {
  dryRun: boolean;
  fixed: PlannedAudienceFix[];
  /** Listed rows left alone, with why (not live, already fixed, or changed since it was listed). */
  skipped: Array<{ feePublishedId: number; reason: string }>;
  /** A failed read or write (nothing written); also a `step.warning` run event. */
  error: string | null;
}

/** The evidence a fix writes; it starts with `darwin:` so the trigger keeps it on the verified row. */
export function handAudienceEvidence(fix: HandAudienceFix): string {
  return `${HAND_AUDIENCE_EVIDENCE_PREFIX}: #${fix.issue} ${fix.evidence}`.slice(0, 500);
}

/** Pure: which listed rows take their new audience, from their live rows (verified audience joined in). */
export function planHandAudienceFixes(
  live: LiveAudienceRow[],
  list: readonly HandAudienceFix[] = HAND_AUDIENCE_FIXES,
): Pick<HandAudienceResult, "fixed" | "skipped"> {
  const byId = new Map(live.map((row) => [Number(row.fee_published_id), row]));
  const fixed: PlannedAudienceFix[] = [];
  const skipped: HandAudienceResult["skipped"] = [];
  for (const entry of list) {
    const row = byId.get(entry.feePublishedId);
    if (!row) {
      skipped.push({ feePublishedId: entry.feePublishedId, reason: "not live" });
      continue;
    }
    if (row.fee_audience === entry.to) {
      skipped.push({ feePublishedId: entry.feePublishedId, reason: "already fixed" });
      continue;
    }
    if (Number(row.lineage_ref) !== entry.feeVerifiedId || Number(row.institution_id) !== entry.institutionId ||
        row.canonical_fee_key !== entry.canonicalFeeKey || row.fee_name !== entry.feeName ||
        !sameAmount(row.amount, entry.amount) || row.fee_audience !== entry.from) {
      skipped.push({ feePublishedId: entry.feePublishedId, reason: "changed since listed" });
      continue;
    }
    fixed.push({ feePublishedId: entry.feePublishedId, feeVerifiedId: entry.feeVerifiedId, from: entry.from, fromEvidence: row.audience_evidence, to: entry.to });
  }
  return { fixed, skipped };
}

/** Runs in the publish step after the takedowns. A dry run reports what it would fix and writes nothing. */
export async function applyHandAudienceFixes(
  db: SqlTag,
  options: { runId: number; stepId?: number | null; dryRun: boolean; list?: readonly HandAudienceFix[] },
): Promise<HandAudienceResult> {
  const list = options.list ?? HAND_AUDIENCE_FIXES;
  const result: HandAudienceResult = { dryRun: options.dryRun, fixed: [], skipped: [], error: null };
  if (list.length === 0) return result;
  const ids = [...new Set(list.map((entry) => entry.feePublishedId))];
  let live: LiveAudienceRow[];
  try {
    live = await inSavepoint(db, (scope) => scope<LiveAudienceRow[]>`
      SELECT fp.fee_published_id, fp.lineage_ref, fp.institution_id, fp.canonical_fee_key, fp.fee_name, fp.amount,
             v.fee_audience, v.audience_evidence
        FROM published_fee_records fp
        JOIN verified_fee_observations v ON v.fee_verified_id = fp.lineage_ref
       WHERE fp.fee_published_id = ANY(${ids}::bigint[])
         AND fp.rolled_back_at IS NULL
    `);
  } catch (error) {
    console.error("hand audience fixes read failed:", error);
    return { ...result, error: await recordStepWarning(db, { runId: options.runId, stepId: options.stepId, check: HAND_AUDIENCE_CHECK, what: "Hand audience fixes read", error }) };
  }
  const plan = planHandAudienceFixes(live, list);
  result.skipped = plan.skipped;
  if (options.dryRun) return { ...result, fixed: plan.fixed };
  if (plan.fixed.length === 0) return result;

  try {
    await inSavepoint(db, async (scope) => {
      for (const item of plan.fixed) {
        const entry = list.find((candidate) => candidate.feePublishedId === item.feePublishedId)!;
        const updated = await scope<{ fee_verified_id: number | string }[]>`
          UPDATE verified_fee_observations
             SET fee_audience = ${item.to},
                 audience_evidence = ${handAudienceEvidence(entry)}
           WHERE fee_verified_id = ${item.feeVerifiedId}
             AND fee_audience = ${entry.from}
          RETURNING fee_verified_id
        `;
        if (updated.length === 0) continue;
        // Touching the audience column fires the trigger, which copies the verified row's audience.
        await scope`
          UPDATE published_fee_records SET fee_audience = fee_audience
           WHERE fee_published_id = ${item.feePublishedId}
             AND rolled_back_at IS NULL
        `;
        result.fixed.push(item);
      }
      // The old values, so each fix can be undone; a record, never a lesson.
      const records: FeedbackRow[] = result.fixed.map((item) => {
        const entry = list.find((candidate) => candidate.feePublishedId === item.feePublishedId)!;
        return {
          aboutStage: "verify" as const,
          signal: "wrong" as const,
          kind: HAND_AUDIENCE_KIND,
          reportedBy: "gutenberg" as const,
          checkName: HAND_AUDIENCE_CHECK,
          institutionId: entry.institutionId,
          feeVerifiedId: item.feeVerifiedId,
          feePublishedId: item.feePublishedId,
          canonicalFeeKey: entry.canonicalFeeKey,
          amount: entry.amount,
          weight: 0,
          runId: options.runId,
          dedupeKey: `${HAND_AUDIENCE_CHECK}:pub:${item.feePublishedId}`,
          evidence: { fee_name: entry.feeName, from_audience: item.from, from_evidence: item.fromEvidence, to_audience: item.to, issue: entry.issue, source: entry.evidence },
        };
      });
      if (records.length > 0) await recordFeedback(scope, records);
      if (result.fixed.length > 0) {
        await scope`
          INSERT INTO agent_run_events (agent_run_id, event_type, status, message, detail)
          VALUES (
            ${options.runId}, ${HAND_AUDIENCE_CHECK}, 'completed',
            ${`Set the audience of ${result.fixed.length} listed live fee(s) from their bank's own text`},
            ${JSON.stringify({
              fixed: result.fixed.map((item) => ({ fee_published_id: item.feePublishedId, fee_verified_id: item.feeVerifiedId, from: item.from, to: item.to })),
              skipped: result.skipped,
            })}::jsonb
          )
        `;
      }
    });
  } catch (error) {
    console.error("hand audience fixes write failed:", error);
    return { ...result, fixed: [], error: await recordStepWarning(db, { runId: options.runId, stepId: options.stepId, check: HAND_AUDIENCE_CHECK, what: "Hand audience fixes write", error }) };
  }
  if (result.fixed.length > 0) invalidatePublicReadCache();
  return result;
}

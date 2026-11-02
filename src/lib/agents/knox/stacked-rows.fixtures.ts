/**
 * v151 (#1092) near-miss lines for `stacked-rows.ts`. Each case is a short stored text read by Knox,
 * Darwin's verify and the publish gate (`stacked-rows.test.ts`).
 * - `SAME_AS_MAIN`: a stacked look-alike Knox must not read as a row; it publishes exactly what main
 *   (Knox before v151) publishes.
 * - `ADDED`: a real name over its price that no reader pairs; it publishes main's fees plus exactly one
 *   fee, the one main publishes for the same fee written as a plain label row ("Name | $X unit").
 */

export interface NearMiss {
  label: string;
  lines: readonly string[];
}

export const SAME_AS_MAIN: readonly NearMiss[] = [
  // Limits, caps, minimums, balances and deposits on the price line.
  { label: "a daily cap under the fee", lines: ["Overdraft Fee", "$150 maximum per day"] },
  { label: "a limit with no fee word", lines: ["Courtesy Pay", "Limit of $120 per day"] },
  { label: "an up-to cap", lines: ["Late Payment Fee", "Up to $29"] },
  { label: "a not-to-exceed cap", lines: ["NSF Fee", "$35 not to exceed $105 per day"] },
  { label: "a balance requirement", lines: ["Basic Checking", "$100 minimum balance"] },
  { label: "an opening deposit", lines: ["Savings Account", "$25 opening deposit"] },
  { label: "a balance trigger", lines: ["Monthly Service Charge", "$5.00 if balance falls below $500"] },
  { label: "a required balance", lines: ["Money Market Maintenance Fee", "$10.00 when the required balance is not kept"] },
  // Rates and choices.
  { label: "a rate", lines: ["Cash Advance Fee", "3% of the advance"] },
  { label: "a rate bound", lines: ["Foreign Transaction Fee", "$1.00 or 1% of the amount"] },
  { label: "a choice of price", lines: ["Account Research", "$25.00 or actual cost"] },
  { label: "a cents price", lines: ["Coin Counting Fee", "10¢ per roll"] },
  { label: "a price that varies", lines: ["Check Printing Fee", "Varies by style"] },
  // Other fees on the same line and on neighbouring lines.
  { label: "a second price on the line", lines: ["Stop Payment", "$30.00 Returned Item $35.00"] },
  { label: "a price-first row naming its own fee", lines: ["Overdraft Fee", "$30.00 Stop Payment"] },
  { label: "a range", lines: ["Garnishment Fee", "$50 - $100"] },
  { label: "a slash pair of prices", lines: ["Wire Transfer Outgoing", "$25/$45"] },
  { label: "a lowercase next fee sharing the cell", lines: ["Counter Checks", "$2.00, annual fee $10.00"] },
  { label: "two ATM prices", lines: ["ATM Fee", "$2.00 at other ATMs; $1.00 at our ATMs"] },
  { label: "a priced line above the name", lines: ["Stop Payment $30.00", "Returned Item Fee", "$35.00 Overdraft Fee"] },
  { label: "a pair base already reads", lines: ["Stop Payment Fee", "$30.00 per item", "Returned Item Fee", "$35.00 per item"] },
  // Names that are not a fee's name on their own.
  { label: "a section title", lines: ["Checking Fees", "$5.00 per month"] },
  { label: "a section title with a colon", lines: ["Other Service Fees:", "$10.00"] },
  { label: "a sentence", lines: ["You will be charged a fee", "$5.00"] },
  { label: "a description between the name and its price", lines: ["Counter Check", "An emergency check when you have no checks left", "$1 per check"] },
  { label: "a condition in the name", lines: ["Account Closure (if closed within 90 days)", "$25.00"] },
  { label: "a name ending a sentence", lines: ["This fee is charged on overdrafts.", "$30.00"] },
  { label: "a lowercase name", lines: ["stop payment", "$30.00"] },
  { label: "an account name no rule files", lines: ["Basic Checking", "$3.00"] },
  { label: "a bare section word", lines: ["Services", "$5.00"] },
  { label: "a label cell", lines: ["Fee Amount", "$5.95"] },
  { label: "a table row", lines: ["Stop Payment | Per item", "$30.00"] },
  { label: "a priced name line", lines: ["Stop Payment $30", "$35.00 per item"] },
  // Free allowances that stay out (v147's own refusals).
  { label: "a free stretch of time", lines: ["Monthly Maintenance Fee", "First 6 months free, then $5.00"] },
  { label: "an own-ATM allowance", lines: ["ATM Transaction Fee", "5 free per month, then $1.00"] },
  { label: "an allowance with two prices", lines: ["Counter Checks", "4 free, then $1.00 each or $5.00 per pad"] },
  // Unknown units, abbreviations and all caps: base reads none of these as a row either.
  { label: "a bare price under a heading word", lines: ["Wire Transfers", "$25.00"] },
  { label: "a footnoted price with no name rule", lines: ["Photo Copy Svc", "$1.00*"] },
  // Section breaks, colons and invisible characters.
  { label: "a section break with a colon over a rate", lines: ["Overdraft Fees:", "2% of the item"] },
  { label: "an invisible character before a section title", lines: ["‍Other Service Fees", "‍$10.00"] },
  // Pairs a family reader already reads: v151 adds no second read of them.
  { label: "a plain price base pairs", lines: ["Stop payment orders", "$20.00"] },
  { label: "a name with a colon base pairs", lines: ["Stop Payment:", "$30.00 per item"] },
  { label: "all caps base pairs", lines: ["STOP PAYMENT", "$30.00"] },
  { label: "an unknown unit base pairs", lines: ["Stop Payment", "$30.00 per wk"] },
  { label: "an hourly unit base pairs", lines: ["Account Research", "$25.00 per hour"] },
  { label: "an annual unit base pairs", lines: ["Dormant Account Fee", "$20.00 annually"] },
  { label: "a non-member price base pairs", lines: ["Notary Service", "$5.00 non-members"] },
  { label: "a member name base pairs", lines: ["Non-Member Check Cashing", "$5.00 per check"] },
  { label: "a business heading over a pair base reads", lines: ["Business Account Fees", "Stop Payment", "$30.00"] },
  { label: "a bullet before a price base pairs", lines: ["Stop Payment", "• $30.00 each"] },
  // Lines base holds: a held read keeps its line, so nothing is added beside it.
  { label: "invisible characters on a pair base holds", lines: ["\u200dStop Payment", "\u200d$30.00"] },
  { label: "a waiver on a pair base holds", lines: ["Paper Statement Fee", "$3.00 per month, waived with e-statements"] },
  // v151 allow-lists (review of e9efb05): a unit off the list, or an audience anywhere in the section.
  { label: "a slash period after the price (outside the allow-lists)", lines: ["Privately owned or leased ATM fee", "$ 25.00/monthly"] },
  { label: "a slash unit after the price (outside the allow-lists)", lines: ["Canadian Deposited (check or money order)", "$20.00/each item"] },
  { label: "a business account's own fee (outside the allow-lists)", lines: ["Service Fee for Business Checking Accounts", "$5.00 per month"] },
  { label: "under a business heading (outside the allow-lists)", lines: ["Business Account Fees", "Night Depository Locked Bag", "$35.00"] },
  { label: "under a personal heading (outside the allow-lists)", lines: ["Personal Account Fees", "Night Depository Locked Bag", "$35.00"] },
  // Multiple copies of the same page.
  { label: "two copies of a pair base reads", lines: ["Stop payment orders", "$20.00", "Fee Schedule", "Stop payment orders", "$20.00"] },
];


/**
 * Every probe of the exact-head review of e9efb05 (#2863): each read or published a fee main does not.
 * They read and publish exactly what main does.
 */
export const REVIEW_E9EFB05: readonly NearMiss[] = [
  // Blocker 1: a bare price before the name makes the list price-first.
  { label: "a price-first list, lost card first", lines: ["$10.00", "ATM Card Lost", "$5.00", "ATM Transaction Research"] },
  { label: "a price-first list, research first", lines: ["$10.00", "ATM Transaction Research", "$5.00", "ATM Card Lost"] },
  { label: "a price-first list under a section title", lines: ["Card Services", "$10.00", "ATM Card Lost", "$5.00", "ATM Transaction Research", "$7.00", "Wire Transfer Fee"] },
  // Blocker 2: a second column in the name line.
  { label: "a column gap in the name line", lines: ["ATM Card (Lost or Stolen)      Night Deposit Bag", "$5.00 Per Card"] },
  { label: "a tab in the name line", lines: ["ATM Card (Lost or Stolen)\tNight Deposit Bag", "$5.00 Per Card"] },
  // Blocker 3: a retired fee.
  { label: "a discontinued price", lines: ["ATM Card Lost", "$5.00 discontinued"] },
  { label: "an eliminated price", lines: ["ATM Card Lost", "$5.00 eliminated"] },
  { label: "under a discontinued heading", lines: ["Discontinued", "ATM Card (Lost or Stolen)", "$5.00 Per Card"] },
  { label: "under a no-longer-apply heading", lines: ["The following fees no longer apply:", "ATM Card (Lost or Stolen)", "$5.00 Per Card"] },
  // Blocker 4: an audience lost.
  { label: "a business row under a plain one", lines: ["Returned Check (deposited item)", "$15", "Returned Check (deposited item) - Business", "$25"] },
  { label: "business accounts after the price", lines: ["Returned Check (deposited item)", "$15.00 business accounts"] },
  { label: "for business after the price", lines: ["Returned Check (deposited item)", "$15.00 for business"] },
  { label: "a business name", lines: ["ATM Card Lost (Business)", "$25"] },
  // Blocker 5: a bound or partial price.
  { label: "a per-day total", lines: ["ATM Card Lost", "$5.00 per day total"] },
  { label: "a starting price", lines: ["ATM Card Lost", "$5.00 starting at"] },
  { label: "a price plus shipping", lines: ["ATM Card Lost", "$5.00 plus shipping"] },
  { label: "a price plus cost", lines: ["ATM Card Lost", "$5.00 plus cost"] },
  { label: "each additional", lines: ["ATM Card Lost", "$5.00 each additional"] },
  // Blocker 6: the unit on the next line.
  { label: "a unit on the next line", lines: ["ATM Transaction Research", "$10.00", "per hour"] },
  { label: "a unit and minimum on the next line", lines: ["ATM Transaction Research", "$10.00", "per hour, 1 hour minimum"] },
  // Non-blocking findings.
  { label: "a balance threshold as the name", lines: ["Minimum daily balance to avoid monthly service charge", "$1,000"] },
  { label: "a daily limit as the name", lines: ["ATM Withdrawal limit per day", "$700.00"] },
  { label: "a waived price", lines: ["ATM Card Lost", "$5.00 waived"] },
  { label: "a waived price in brackets", lines: ["ATM Card Lost", "$5.00 (waived)"] },
  { label: "a first-card price over an additional one", lines: ["ATM Card Lost", "$5.00 first card", "$10.00 each additional"] },
  { label: "a second price line", lines: ["ATM Card Lost", "$5.00", "$10.00"] },
  { label: "the price Darwin files beside a card replacement", lines: ["Card Replacement | $5.00", "Other Card Fees", "ATM Card (Lost or Stolen)", "$5.00 Per Card"] },
];

export const ADDED: readonly (NearMiss & { row: readonly string[] })[] = [
  { label: "State key 2017: an allowance under its name", lines: ["Counter Checks", "5 free - $0.25/after"], row: ["Counter Checks | 5 free - $0.25/after"] },
  { label: "live audit 1082: a unit after the price", lines: ["ATM Card (Lost or Stolen)", "$5.00 Per Card"], row: ["ATM Card (Lost or Stolen) | $5.00 Per Card"] },
  { label: "a period in the name", lines: ["ATM Owner Fee (per month)", "$100.00"], row: ["ATM Owner Fee (per month) | $100.00"] },
  { label: "an all-caps word in the name", lines: ["Visa CHECKCARD Replacement Two Day", "$60.00"], row: ["Visa CHECKCARD Replacement Two Day | $60.00"] },
  { label: "a bare whole-dollar price", lines: ["Night Drop Bag & Keys", "$22"], row: ["Night Drop Bag & Keys | $22"] },
  { label: "a club withdrawal", lines: ["Early Christmas Account Withdrawal", "$10"], row: ["Early Christmas Account Withdrawal | $10"] },
  { label: "a returned deposited item", lines: ["Returned Item -- Deposited Check (and other items)", "$20"], row: ["Returned Item -- Deposited Check (and other items) | $20"] },
  { label: "a transfer from savings", lines: ["Insufficient Funds Transfer from Share Account", "$1.00"], row: ["Insufficient Funds Transfer from Share Account | $1.00"] },
  { label: "a late fee per month", lines: ["Safe Box Late Fee - Per Month after 3 months", "$5.00"], row: ["Safe Box Late Fee - Per Month after 3 months | $5.00"] },
];

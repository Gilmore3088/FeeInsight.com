/**
 * #1100 (Knox v149, guard v102): a named service's own monthly charge is not the account's monthly
 * maintenance fee. Schedules price online banking, bill payer, text banking, mobile check deposit,
 * remote capture, balance reporting, coin orders, telephone transfers and debit or merchant card
 * programs "per month" in their own rows ("Bill Payer (monthly fee) | Free", "OLB Monthly Maintenance |
 * $0.00", "Remote Capture Monthly Fee - $50.00", "VISA/MasterCard Monthly Fee | $7.75" under
 * "Merchant Service Fees"). Their "monthly fee" words matched the generic maintenance pattern, so 17
 * live rows at 17 banks sat in monthly maintenance (Nov 1, read-only), 11 of them at $0, pulling the
 * category's free share and medians.
 *
 * v2 (Knox v166, guard v106; re-read backlog dry run, Nov 2): mobile banking and hold mail are such
 * services too ("Mobile Banking Monthly Service Charge | No Fee", BAC Community Bank 1265; "Hold Mail –
 * monthly fee (refer to agreement) | No Fee", Intercredit Bank 827). Neither has a type of the 50.
 *
 * Shared by Knox's classifier (`classifyPatternKey`) and the category guard's monthly maintenance
 * exclusion and re-file rules, so a new read and a live fee are judged by the same words.
 *
 * A service named only inside a waiver ("Use your debit card 15 or more times per month and we'll
 * waive the monthly fee", "monthly service charge waived with online banking") is the account's
 * condition, not the fee's subject, so it does not count; nor do plural "mobile deposits" ("monthly
 * service charge if no direct or mobile deposits"), which read as the account's activity.
 */
const SERVICE_WORDS =
  String.raw`bill\s?pay(?:ers?|ing)|on-?line\s+banking|internet\s+banking|mobile\s+banking|hold\s+mail|olb|text\s+banking|mobile\s+(?:check\s+)?deposit|remote\s+capture|balance\s+reporting|telephone\s+transfers?|coin\s+orders?|visa\s*\/\s*master\s?card|(?:debit|check|atm|visa)\s+cards?`;
const BILL_PAYER_WORDS = String.raw`bill\s?payers?`;
const MOBILE_CHECK_DEPOSIT_WORDS = String.raw`mobile\s+(?:check\s+)?deposit`;

/**
 * A service word counts only when it is the row's subject: not when the name names a deposit account
 * ("Checking with Online Banking: $5 monthly fee", "Kasasa Cash Checking ... 12 debit card purchases"),
 * not inside the account's condition ("waived/avoid/eliminated/exempt/discount/not charged/free with/
 * $0 with/no fee if/required ... online
 * banking", "use your/of ... debit card"), and not as activity ("debit card purchases/transactions").
 * Every regex the guard and Hamilton use to move a fee is built the same way, so a service named in a
 * waiver never re-files an account fee to that service (#2855 review).
 */
function serviceName(words: string): RegExp {
  return new RegExp(
    String.raw`^(?![^|]*\b(?:checking|savings|share\s+(?:accounts?|drafts?)|money\s+market)\b)[^|]*?` +
      String.raw`(?<!(?:\b(?:waiv|avoid|requir|eliminat|exempt|discount)\w*|\bnot\s+(?:charged|using)\b|\bfree\s+(?:with|if|for)\b|\$0\s+(?:with|if|for)\b|\bno\s+(?:monthly\s+)?(?:fees?|charges?)\s+(?:with|if|for)\b)[^|]{0,100})` +
      String.raw`(?<!\buse\s+(?:your\s+|the\s+|a\s+|of\s+)?)` +
      String.raw`\b(?:${words})\b(?!\s+(?:purchases?|transactions?|trans?|uses?|users?|usage|swipes?)\b)`,
    "i",
  );
}

export const SERVICE_MONTHLY_CHARGE_NAME = serviceName(SERVICE_WORDS);

/** "Bill Payer (monthly fee)", "BillPayer Monthly Fee": the bill pay service's monthly fee. */
export const BILL_PAYER_NAME = serviceName(BILL_PAYER_WORDS);

/** "Mobile Check Deposit - Monthly Service": the mobile deposit service's monthly fee. */
export const MOBILE_CHECK_DEPOSIT_NAME = serviceName(MOBILE_CHECK_DEPOSIT_WORDS);

/**
 * Where a monthly charge named for a service belongs: `bill_pay` for a bill payer service,
 * `mobile_deposit` for mobile check deposit, `null` for the other services (no type of the 50 holds
 * online banking, text banking, remote capture, balance reporting, coin orders, telephone transfers
 * or a card program's monthly charge), and `undefined` when the name names no such service.
 */
export function serviceMonthlyTarget(name: string): "bill_pay" | "mobile_deposit" | null | undefined {
  if (!SERVICE_MONTHLY_CHARGE_NAME.test(name)) return undefined;
  if (BILL_PAYER_NAME.test(name)) return "bill_pay";
  if (MOBILE_CHECK_DEPOSIT_NAME.test(name)) return "mobile_deposit";
  return null;
}

/**
 * v3 (Knox v170, re-read backlog dry run 3, Nov 2): a monthly service fee printed in a section of online,
 * electronic or digital services is that service's charge, whatever brand the bank gives it. Cinfed FCU
 * (6561, doc 41914) prints "Cinfed Connection Monthly Service Fee | FREE" as the last row under "Online
 * Fees", beside "Online Banking Monthly Service Fee | FREE" and "Mobile Banking Monthly Service Fee |
 * FREE"; the brand named no service word, so Knox read it as a free account at $0 monthly maintenance.
 * University of Virginia Community CU (7445) has "| Monthly fee | No charge |" live as $0 monthly
 * maintenance (152003) under "Personal Online Banking Fees".
 *
 * The section is the first line above the fee's own line that is not a row: rows (a cell break or a
 * price), a table rule ("|---|"), a column heading ("Fee", "Amount") and a "Rates as of ..." note are
 * passed over. Only a section title counts ("Online Fees", "Electronic Services", "Digital Banking Fees",
 * "Personal Online Banking Fees"): a feature line ("Free Online Banking", "Online and Mobile Banking")
 * over an account's own monthly fee is not one. A name that names an account (checking, savings, share,
 * money market, club, draft, account) is the account's. The fee's line must be printed once in the page:
 * Finex CU (8593) prints "Fee Amount" under every card, and its live "Axcess Cashback Plus maintenance
 * fee" (128838, line "FEE AMOUNT / $5.00") would otherwise find the first "Fee Amount" under
 * "Electronic Service Fees", far above the checking fees it sits among.
 */
export const ONLINE_SERVICES_SECTION =
  /^\s*(?:(?:personal|business|consumer)\s+)?(?:online|internet|electronic|digital|e-?|mobile)(?:\s*(?:&|and|\/)\s*(?:online|internet|electronic|digital|mobile))?\s*(?:banking\s+)?(?:fees?|charges?|services?(?:\s+fees?)?)\s*:?\s*$/i;
const ACCOUNT_NAME = /\b(?:checking|savings|share|money\s+market|club|drafts?|accounts?|certificates?|ira|now)\b/i;
const MONTHLY_NAME = /\bmonthly\b|\bper\s+month\b|\bmaintenance\b/i;
const NOT_A_SECTION_LINE = /^(?:fees?|amount|cost|price|charges?|description|services?|items?|type)\s*:?$|^(?:rates?|fees?)\s+(?:as\s+of|effective)\b|^effective\b/i;
const PRICE = /\$\s*\d|\b\d+\.\d{2}\b/;
const SECTION_REACH = 80;

const squash = (value: string) => value.replace(/^[\s|]+|[\s|]+$/g, "").replace(/\s+/g, " ").trim().toLowerCase();

/** The section title above `line` in `documentText` (see `ONLINE_SERVICES_SECTION`), or null. */
export function sectionAbove(documentText: string, line: string): string | null {
  const probe = squash(line.split(" / ")[0]);
  if (probe.length < 6) return null;
  const lines = documentText.split("\n");
  const holds = (candidate: string) => squash(candidate) === probe || (probe.length >= 20 && squash(candidate).includes(probe));
  const at = lines.findIndex(holds);
  // The fee's own line, printed once: a line the page repeats ("FEE AMOUNT / $5.00" on a card list
  // that prints "Fee Amount" under every fee) names no one place in the page.
  if (at <= 0 || lines.findIndex((candidate, index) => index > at && holds(candidate)) !== -1) return null;
  for (let index = at - 1, seen = 0; index >= 0 && seen < SECTION_REACH; index -= 1) {
    const plain = lines[index].trim();
    if (!plain) continue;
    seen += 1;
    // A line naming an account, a heading with a price ("Business Checking - $10.00 monthly") or a row,
    // is nearer than any section title above it: the fee is that account's (#2963 review).
    if (ACCOUNT_NAME.test(plain)) return plain;
    // A heading printed as a one-cell table row ("| Checking Account Fees |") is a section title too.
    const cells = plain.split("|").map((cell) => cell.trim()).filter(Boolean);
    const heading = plain.includes("|") && cells.length === 1 && !/^[-:\s]+$/.test(cells[0]) ? cells[0] : plain;
    if ((heading === plain && plain.includes("|")) || PRICE.test(heading) || NOT_A_SECTION_LINE.test(heading)) continue;
    return heading;
  }
  return null;
}

/**
 * A monthly service or maintenance fee whose own line sits in a section of online, electronic or
 * digital services (`ONLINE_SERVICES_SECTION`): the section's title, or null. Shared by Knox (the read
 * is not filed as monthly maintenance) and Darwin (verify and the live re-check).
 */
export function onlineServiceMonthlyFee(feeName: string | null | undefined, line: string | null | undefined, documentText: string | null | undefined): string | null {
  const name = (feeName ?? "").trim();
  if (!name || !line || !documentText || !MONTHLY_NAME.test(name) || ACCOUNT_NAME.test(name)) return null;
  const section = sectionAbove(documentText, line);
  return section && ONLINE_SERVICES_SECTION.test(section) ? section : null;
}
